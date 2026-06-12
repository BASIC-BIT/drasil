import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';

const SLASH_CONFIRMATION_PREFIX = 'slash_confirm';
const SLASH_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

interface PendingSlashCommandConfirmation {
  readonly userId: string;
  readonly guildId: string | null;
  readonly createdAt: number;
  readonly execute: (interaction: ButtonInteraction) => Promise<void>;
}

interface SlashCommandConfirmationOptions {
  readonly message: string;
  readonly confirmLabel: string;
  readonly confirmStyle?: ButtonStyle.Danger | ButtonStyle.Primary | ButtonStyle.Success;
  readonly execute: (interaction: ButtonInteraction) => Promise<void>;
}

const pendingConfirmations = new Map<string, PendingSlashCommandConfirmation>();
let confirmationCounter = 0;

function nextConfirmationId(): string {
  confirmationCounter += 1;
  return `${Date.now().toString(36)}${confirmationCounter.toString(36)}`;
}

function buildConfirmationCustomId(action: 'confirm' | 'cancel', id: string): string {
  return `${SLASH_CONFIRMATION_PREFIX}:${action}:${id}`;
}

function parseConfirmationCustomId(
  customId: string
): { action: 'confirm' | 'cancel'; id: string } | null {
  const [prefix, action, id] = customId.split(':');
  if (prefix !== SLASH_CONFIRMATION_PREFIX || !id) {
    return null;
  }
  if (action !== 'confirm' && action !== 'cancel') {
    return null;
  }

  return { action, id };
}

function pruneExpiredConfirmations(now = Date.now()): void {
  for (const [id, pending] of pendingConfirmations.entries()) {
    if (now - pending.createdAt > SLASH_CONFIRMATION_TTL_MS) {
      pendingConfirmations.delete(id);
    }
  }
}

export function isSlashCommandConfirmationCustomId(customId: string): boolean {
  return parseConfirmationCustomId(customId) !== null;
}

export async function requestSlashCommandConfirmation(
  interaction: ChatInputCommandInteraction,
  options: SlashCommandConfirmationOptions
): Promise<void> {
  pruneExpiredConfirmations();
  const id = nextConfirmationId();
  pendingConfirmations.set(id, {
    userId: interaction.user.id,
    guildId: interaction.guildId ?? null,
    createdAt: Date.now(),
    execute: options.execute,
  });

  try {
    await interaction.reply({
      content: options.message,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildConfirmationCustomId('confirm', id))
            .setLabel(options.confirmLabel)
            .setStyle(options.confirmStyle ?? ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(buildConfirmationCustomId('cancel', id))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
  } catch (error) {
    pendingConfirmations.delete(id);
    throw error;
  }
}

export async function handleSlashCommandConfirmationButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  const parsed = parseConfirmationCustomId(interaction.customId);
  if (!parsed) {
    return false;
  }

  pruneExpiredConfirmations();
  const pending = pendingConfirmations.get(parsed.id);
  if (!pending) {
    await interaction.reply({
      content: 'That confirmation expired. Re-run the command if you still want to continue.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
    await interaction.reply({
      content: 'Only the user who ran the command can use this confirmation.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  pendingConfirmations.delete(parsed.id);

  if (parsed.action === 'cancel') {
    await interaction.update({ content: 'Cancelled.', components: [] });
    return true;
  }

  await pending.execute(interaction);
  return true;
}
