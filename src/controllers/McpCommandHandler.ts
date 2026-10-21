import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { presentApprovalResult } from '@drasil/application/approval-presentation';
import type { AlternativeApprovals, PublicActionResult } from '@drasil/application';

/** Escape each complete Unicode codepoint before budgeting. No surrogate or escape is split. */
export function discordSummaryPages(summary: string): string[] {
  const pages = [''];
  for (const point of summary) {
    const escaped =
      point === '@' ? '@\u200b' : /[\\`*_{}[\]()#+.!|>~\-<>]/.test(point) ? `\\${point}` : point;
    if (pages[pages.length - 1].length + escaped.length > 1800) pages.push('');
    pages[pages.length - 1] += escaped;
  }
  return pages;
}
interface ApprovalResponse {
  content: string;
  components?: ActionRowBuilder<ButtonBuilder>[];
}
type ApprovalInteraction = ChatInputCommandInteraction | ButtonInteraction;
/** Trusted Discord gateway interaction only; actor/guild are never taken from custom IDs. */
export function approveMcpIntentFromDiscord(
  approvals: AlternativeApprovals,
  interaction: ApprovalInteraction,
  confirmationId: string
): Promise<PublicActionResult> {
  if (!interaction.guildId) throw new Error('Guild required.');
  return approvals.approve(interaction.user.id, confirmationId, 'discord', interaction.guildId);
}
export class McpCommandHandler {
  constructor(private readonly approvals?: AlternativeApprovals) {}
  private async respond(
    interaction: ApprovalInteraction,
    operation: (approvals: AlternativeApprovals, guildId: string) => Promise<ApprovalResponse>
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!interaction.guildId || !this.approvals) throw new Error('Unavailable.');
      await interaction.editReply({
        ...(await operation(this.approvals, interaction.guildId)),
        allowedMentions: { parse: [] },
      });
    } catch {
      await interaction.editReply({
        content:
          'This confirmation is unavailable. Check the account, server and connection, then try again.',
        components: [],
        allowedMentions: { parse: [] },
      });
    }
  }
  private async page(
    approvals: AlternativeApprovals,
    actorId: string,
    guildId: string,
    id: string,
    index: number
  ): Promise<ApprovalResponse> {
    const saved = await approvals.load(actorId, id, guildId);
    const pages = discordSummaryPages(saved.summary);
    if (!Number.isSafeInteger(index) || index < 0 || index >= pages.length)
      throw new Error('Invalid page.');
    const row = new ActionRowBuilder<ButtonBuilder>();
    const button = (
      customId: string,
      label: string,
      style = ButtonStyle.Secondary
    ): ButtonBuilder => new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
    if (index > 0) row.addComponents(button(`mcp:page:${index - 1}:${id}`, 'Previous'));
    if (index + 1 < pages.length) row.addComponents(button(`mcp:page:${index + 1}:${id}`, 'Next'));
    if (saved.state === 'pending') {
      if (index === pages.length - 1)
        row.addComponents(button(`mcp:approve:${id}`, 'Approve', ButtonStyle.Success));
      row.addComponents(button(`mcp:cancel:${id}`, 'Cancel'));
    }
    if (saved.receipt) row.addComponents(button(`mcp:result:0:${id}`, 'View result'));
    return {
      content: `Saved action — page ${index + 1}/${pages.length}\n${pages[index]}\nStatus: ${saved.state}`,
      components: row.components.length ? [row] : [],
    };
  }
  private resultPage(result: PublicActionResult, id: string, index: number): ApprovalResponse {
    const pages = discordSummaryPages(presentApprovalResult(result).join('\n'));
    if (!Number.isSafeInteger(index) || index < 0 || index >= pages.length)
      throw new Error('Invalid result page.');
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const [page, label] of [
      [index - 1, 'Previous'],
      [index + 1, 'Next'],
    ] as const) {
      if (page >= 0 && page < pages.length)
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`mcp:result:${page}:${id}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary)
        );
    }
    return {
      content: `Action result — page ${index + 1}/${pages.length}\n${pages[index]}`,
      components: row.components.length ? [row] : [],
    };
  }
  async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await this.respond(interaction, async (approvals, guildId) => {
      const id = interaction.options.getString('confirmation-id', true);
      if (interaction.options.getSubcommand() === 'cancel') {
        const result = await approvals.cancel(interaction.user.id, id, guildId);
        return this.resultPage(result, id, 0);
      }
      return this.page(approvals, interaction.user.id, guildId, id, 0);
    });
  }
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    await this.respond(interaction, async (approvals, guildId) => {
      const match = /^mcp:(?:(page|result):(\d{1,3})|(approve|cancel)):([A-Za-z0-9_-]{43})$/.exec(
        interaction.customId
      );
      if (!match) throw new Error('Invalid confirmation.');
      const id = match[4];
      if (match[1] === 'page')
        return this.page(approvals, interaction.user.id, guildId, id, Number(match[2]));
      if (match[1] === 'result') {
        const saved = await approvals.load(interaction.user.id, id, guildId);
        if (!saved.receipt) throw new Error('Result unavailable.');
        return this.resultPage(saved.receipt, id, Number(match[2]));
      }
      const result =
        match[3] === 'approve'
          ? await approveMcpIntentFromDiscord(approvals, interaction, id)
          : await approvals.cancel(interaction.user.id, id, guildId);
      return this.resultPage(result, id, 0);
    });
  }
}
