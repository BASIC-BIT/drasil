import { MessageFlags } from 'discord.js';
import { McpCommandHandler, discordSummaryPages } from '../../controllers/McpCommandHandler';

describe('McpCommandHandler', () => {
  const id = 'a'.repeat(43);
  const summary = '@everyone **<script>😀** '.repeat(300);
  const approvals = {
    load: jest.fn().mockResolvedValue({
      confirmationId: id,
      summary,
      state: 'pending',
      expiresAt: '2026-01-01',
    }),
    approve: jest.fn().mockResolvedValue({ state: 'queued', executionId: 'receipt' }),
    cancel: jest.fn().mockResolvedValue({ state: 'denied', code: 'cancelled' }),
  };
  const interaction = (customId?: string) => ({
    user: { id: 'actor' },
    guildId: 'guild',
    customId,
    options: { getString: () => id, getSubcommand: () => 'confirm' },
    deferReply: jest.fn(),
    editReply: jest.fn(),
  });
  beforeEach(() => {
    approvals.load.mockResolvedValue({
      confirmationId: id,
      summary,
      state: 'pending',
      expiresAt: '2026-01-01',
    });
    approvals.approve.mockResolvedValue({ state: 'queued', executionId: 'receipt' });
    approvals.cancel.mockResolvedValue({ state: 'denied', code: 'cancelled' });
  });
  it('shows every escaped Unicode summary page without approving on slash or navigation', async () => {
    const handler = new McpCommandHandler(approvals);
    const slash = interaction();
    await handler.handleSlashCommand(slash as never);
    expect(slash.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const pages = discordSummaryPages(summary);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join('')).toBe(
      summary.replace(/([\\`*_{}[\]()#+.!|>~\-<>])/g, '\\$1').replace(/@/g, '@\u200b')
    );
    for (let page = 0; page < pages.length; page++) {
      const button = interaction(`mcp:page:${page}:${id}`);
      await handler.handleButtonInteraction(button as never);
      const payload = button.editReply.mock.calls[0][0];
      expect(payload.content.length).toBeLessThanOrEqual(2000);
      expect(payload.allowedMentions).toEqual({ parse: [] });
      expect(JSON.stringify(payload.components)).toContain('Cancel');
      expect(JSON.stringify(payload.components).includes('Approve')).toBe(
        page === pages.length - 1
      );
    }
    expect(approvals.approve).not.toHaveBeenCalled();
  });
  it('derives actor and guild from the interaction for explicit approval', async () => {
    const handler = new McpCommandHandler(approvals);
    await handler.handleButtonInteraction(interaction(`mcp:approve:${id}`) as never);
    expect(approvals.approve).toHaveBeenCalledWith('actor', id, 'discord', 'guild');
  });
  it('cancels before the final page', async () => {
    await new McpCommandHandler(approvals).handleButtonInteraction(
      interaction(`mcp:cancel:${id}`) as never
    );
    expect(approvals.cancel).toHaveBeenCalledWith('actor', id, 'guild');
    expect(approvals.approve).not.toHaveBeenCalled();
  });
  it('refuses DMs and invalid page indices without accepting', async () => {
    const handler = new McpCommandHandler(approvals);
    await handler.handleSlashCommand({ ...interaction(), guildId: null } as never);
    await handler.handleButtonInteraction(interaction(`mcp:page:999:${id}`) as never);
    expect(approvals.approve).not.toHaveBeenCalled();
  });
});

it('registers guild-only approvals without excluding Ban/Kick-only moderators', async () => {
  const { buildApplicationCommands } = await import('../../controllers/commandDefinitions');
  const command = buildApplicationCommands({ userInstallReportingEnabled: false }).find(
    (entry) => entry.name === 'mcp'
  );
  expect(command).toBeDefined();
  expect(command?.default_member_permissions).toBeUndefined();
  expect(command?.contexts).toEqual([0]);
});
