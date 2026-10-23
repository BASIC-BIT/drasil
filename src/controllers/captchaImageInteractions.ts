import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
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
        .setLabel('Enter answer')
        .setStyle(ButtonStyle.Primary)
    );
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}help:${reference.challengeId}:${reference.generation}`)
      .setLabel('Ask for help')
      .setStyle(ButtonStyle.Secondary)
  );
  return [row];
}
const unavailable =
  'This security check is temporarily unavailable. Please retry opening it or ask for help.';
const stale =
  'This security check expired, was replaced, or is no longer active. Ask a moderator for review or a new check.';
function submitCopy(outcome: ImageSubmitOutcome): string {
  switch (outcome.kind) {
    case 'passed':
      return 'Security check completed. Moderators will review the case if further action is needed.';
    case 'invalid':
      return `That answer did not match. ${outcome.remainingAttempts} attempts remaining.`;
    case 'failed':
      return 'This security check reached its attempt limit. Your case needs moderator review.';
    case 'denied':
      return 'This security check is only available to the member it was issued to in this server.';
    case 'stale':
      return stale;
    case 'rate_limited':
      return 'Please wait a moment and try again. No answer attempt was used.';
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
  const respond = async (content: string, help = false): Promise<void> => {
    const payload = {
      content,
      files: [],
      attachments: [],
      components: help && control ? controls(control, false) : [],
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
      await respond(
        'This security check control is invalid. Open the current check in your case thread.'
      );
      return true;
    }
    if (interaction.deferred || interaction.replied) {
      await respond(unavailable, true);
      return true;
    }
    if (control.action === 'answer' && !interaction.isModalSubmit()) {
      // Discord requires showModal as the initial response. Authorization and answer
      // attempts belong to submit, not to displaying an empty text field.
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(interaction.customId)
          .setTitle('Security check answer')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId(ANSWER_FIELD)
                .setLabel('Enter the characters in the image')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(32)
                .setRequired(true)
            )
          )
      );
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
      await respond(
        submitCopy(outcome),
        outcome.kind === 'invalid' ||
          outcome.kind === 'unavailable' ||
          outcome.kind === 'rate_limited'
      );
    } else if (control.action === 'help') {
      const result = await actions.requestAssistance(context, reference);
      const outcome = result.kind === 'denied' ? { kind: 'denied' as const } : result.outcome;
      await respond(
        outcome.kind === 'queued'
          ? 'Your request for moderator assistance has been recorded. Your security check remains pending.'
          : outcome.kind === 'stale'
            ? stale
            : outcome.kind === 'denied'
              ? submitCopy({ kind: 'denied' })
              : unavailable,
        outcome.kind === 'unavailable'
      );
    } else {
      const result = await actions.open(context, reference);
      const outcome = result.kind === 'denied' ? { kind: 'denied' as const } : result.outcome;
      if (outcome.kind === 'ready')
        await interaction.editReply({
          content:
            'Read the image, then choose Enter answer. Completing this check does not itself verify your account.',
          files: [
            new AttachmentBuilder(outcome.png, {
              name: 'security-check.png',
              description: 'Security check image',
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
          outcome.kind === 'unavailable'
        );
    }
  } catch {
    // Discord delivery and service errors may contain private payloads. Never log them.
    try {
      await respond(unavailable, true);
    } catch {
      /* The interaction or its channel may no longer exist. */
    }
  }
  return true;
}
