import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type {
  BotCaptchaImageActions,
  ImageChallengeReference,
  ImageSubmitOutcome,
} from '../application/adapters/captchaImage';
import { createDiscordActionContext } from '../application/context';

const PREFIX = 'captcha:image:';
const ANSWER_FIELD = 'security_check_answer';
type ImageControl = ImageChallengeReference & { action: 'open' | 'answer' | 'help' };
function parseControl(id: string): ImageControl | null {
  if (id.length > 100) return null;
  const match =
    /^captcha:image:(open|answer|help):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]*)$/i.exec(
      id
    );
  if (!match) return null;
  const action = match[1];
  if (action !== 'open' && action !== 'answer' && action !== 'help') return null;
  const generation = Number(match[3]);
  if (!Number.isSafeInteger(generation)) return null;
  return { action, challengeId: match[2], generation };
}
function controls(
  reference: ImageChallengeReference,
  answer: boolean
): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (answer)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}answer:${reference.challengeId}:${reference.generation}`)
        .setLabel('Enter code')
        .setStyle(ButtonStyle.Primary)
    );
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}help:${reference.challengeId}:${reference.generation}`)
      .setLabel('Get help')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row];
}
const unavailable = 'CAPTCHA unavailable. Try opening it again or get help.';
const stale = 'This CAPTCHA is no longer active.';
function submitCopy(outcome: ImageSubmitOutcome): string {
  switch (outcome.kind) {
    case 'passed':
      return 'Code accepted.';
    case 'invalid':
      return `That code doesn't match. ${outcome.remainingAttempts} ${outcome.remainingAttempts === 1 ? 'attempt' : 'attempts'} left.`;
    case 'failed':
      return 'Too many incorrect attempts. Ask a moderator for a new CAPTCHA.';
    case 'denied':
      return 'You can only answer your own CAPTCHA.';
    case 'stale':
      return stale;
    case 'rate_limited':
      return 'Wait a moment, then try again.';
    case 'unavailable':
      return unavailable;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Component data is only a reference. Every member operation rechecks persisted authorization. */
export async function handleCaptchaImageInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  actions: BotCaptchaImageActions
): Promise<boolean> {
  if (!interaction.customId.startsWith(PREFIX)) return false;
  const control = parseControl(interaction.customId);
  // Only a modal opened from this bot's matching private card may replace that card.
  const updatesImage =
    interaction.isModalSubmit() &&
    interaction.isFromMessage() &&
    interaction.message.flags.has(MessageFlags.Ephemeral) &&
    interaction.message.author.id === interaction.client.user.id &&
    interaction.message.components.some(
      (row) =>
        row.type === ComponentType.ActionRow &&
        row.components.some(
          (component) =>
            component.type === ComponentType.Button && component.customId === interaction.customId
        )
    );
  let terminalContent: string | undefined;
  const respond = async (
    content: string,
    mode: 'replace' | 'help' | 'retry_image' = 'replace'
  ): Promise<void> => {
    const payload = {
      content,
      ...(mode === 'retry_image' ? {} : { files: [], attachments: [] }),
      components: mode !== 'replace' && control ? controls(control, mode === 'retry_image') : [],
    };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  };
  try {
    if (
      !control ||
      !interaction.guildId ||
      (interaction.isModalSubmit() && control.action !== 'answer')
    ) {
      await respond('Open the current CAPTCHA in your case thread.');
      return true;
    }
    if (interaction.deferred || interaction.replied) {
      await respond(unavailable, 'help');
      return true;
    }
    if (control.action === 'answer' && !interaction.isModalSubmit()) {
      // Discord requires showModal as the initial response. Authorization and answer
      // attempts belong to submit, not to displaying an empty text field.
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(interaction.customId)
          .setTitle('CAPTCHA')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId(ANSWER_FIELD)
                .setLabel('Code')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(32)
                .setRequired(true)
            )
          )
      );
      return true;
    }
    if (updatesImage && interaction.isModalSubmit()) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const context = createDiscordActionContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      requestId: interaction.id,
    });
    const reference = { challengeId: control.challengeId, generation: control.generation };
    if (interaction.isModalSubmit()) {
      const result = await actions.submit(context, {
        ...reference,
        interactionId: interaction.id,
        answer: interaction.fields.getTextInputValue(ANSWER_FIELD),
      });
      const outcome = result.kind === 'denied' ? { kind: 'denied' as const } : result.outcome;
      if (updatesImage && outcome.kind === 'denied') {
        // A denied operation must not change the source card, even if delivery fails.
        try {
          await interaction.followUp({
            content: submitCopy(outcome),
            flags: MessageFlags.Ephemeral,
          });
        } catch {
          /* The interaction may no longer exist. */
        }
        return true;
      }
      const retry =
        outcome.kind === 'invalid' ||
        outcome.kind === 'unavailable' ||
        outcome.kind === 'rate_limited';
      if (!retry) terminalContent = submitCopy(outcome);
      await respond(
        submitCopy(outcome),
        retry ? (updatesImage ? 'retry_image' : 'help') : 'replace'
      );
    } else if (control.action === 'help') {
      const result = await actions.requestAssistance(context, reference);
      const outcome = result.kind === 'denied' ? { kind: 'denied' as const } : result.outcome;
      await respond(
        outcome.kind === 'queued'
          ? 'Help requested.'
          : outcome.kind === 'stale'
            ? stale
            : outcome.kind === 'denied'
              ? submitCopy({ kind: 'denied' })
              : unavailable,
        outcome.kind === 'unavailable' ? 'help' : 'replace'
      );
    } else {
      const result = await actions.open(context, reference);
      const outcome = result.kind === 'denied' ? { kind: 'denied' as const } : result.outcome;
      if (outcome.kind === 'ready')
        await interaction.editReply({
          content: 'Enter the code in the image.',
          files: [
            new AttachmentBuilder(outcome.png, {
              name: 'captcha.png',
              description: 'CAPTCHA image',
            }),
          ],
          components: controls(reference, true),
        });
      else
        await respond(
          outcome.kind === 'stale'
            ? stale
            : outcome.kind === 'denied'
              ? submitCopy({ kind: 'denied' })
              : unavailable,
          outcome.kind === 'unavailable' ? 'help' : 'replace'
        );
    }
  } catch {
    // Discord delivery and service errors may contain private payloads. Never log them.
    try {
      if (terminalContent)
        await interaction.followUp({ content: terminalContent, flags: MessageFlags.Ephemeral });
      else await respond(unavailable, updatesImage ? 'retry_image' : 'help');
    } catch {
      /* The interaction or its channel may no longer exist. */
    }
  }
  return true;
}
