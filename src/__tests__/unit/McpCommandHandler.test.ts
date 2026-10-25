import { MessageFlags } from 'discord.js';
import type { PublicActionResult } from '@drasil/application';
import { presentApprovalResult } from '@drasil/application/approval-presentation';
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
  it.each([
    [{ state: 'completed', outcome: { status: 'busy' } }, 'Busy: no action was taken'],
    [
      { state: 'completed', outcome: { status: 'already_handled' } },
      'Already handled: no new action was taken',
    ],
    [
      { state: 'partial', outcome: { status: 'closed', queueCleanupStatus: 'failed' } },
      'Queue cleanup failed',
    ],
    [
      { state: 'uncertain', code: 'completion_recording_failed' },
      'completion\\_recording\\_failed',
    ],
  ])('shows the actual safe receipt %j', async (result, expected) => {
    approvals.approve.mockResolvedValue(result);
    const button = interaction(`mcp:approve:${id}`);
    await new McpCommandHandler(approvals).handleButtonInteraction(button as never);
    expect(button.editReply.mock.calls[0][0].content).toContain(expected);
  });
  it('paginates every hostile result item by read-only authorized receipt loads', async () => {
    const result: PublicActionResult = {
      state: 'partial',
      executionId: 'receipt',
      outcome: {
        items: Array.from({ length: 100 }, (_, i) => ({
          itemId: `${i} @everyone **😀**`,
          state: i % 2 ? 'uncertain' : 'completed',
          status: i % 2 ? undefined : 'already_handled',
        })),
      },
    };
    approvals.approve.mockResolvedValue(result);
    approvals.load.mockResolvedValue({
      confirmationId: id,
      summary,
      state: 'consumed',
      receipt: result,
    });
    const handler = new McpCommandHandler(approvals);
    const first = interaction(`mcp:approve:${id}`);
    await handler.handleButtonInteraction(first as never);
    const outputs = [first.editReply.mock.calls[0][0]];
    for (let index = 1; index < 100; index++) {
      if (!JSON.stringify(outputs.at(-1).components).includes('Next')) break;
      const next = interaction(`mcp:result:${index}:${id}`);
      await handler.handleButtonInteraction(next as never);
      outputs.push(next.editReply.mock.calls[0][0]);
    }
    expect(outputs.length).toBeGreaterThan(1);
    for (const output of outputs) {
      expect(output.content.length).toBeLessThanOrEqual(2000);
      expect(output.allowedMentions).toEqual({ parse: [] });
      expect(JSON.stringify(output.components)).not.toContain('Approve');
    }
    const text = outputs
      .map((output) => output.content.replace(/^Action result — page \d+\/\d+\n/, ''))
      .join('');
    for (let i = 0; i < 100; i++) expect(text).toContain(`Item ${i} @\u200beveryone`);
    expect(text).toContain('Already handled: no new action was taken');
    expect(text).toBe(discordSummaryPages(presentApprovalResult(result).join('\n')).join(''));
    expect(approvals.approve).toHaveBeenCalledTimes(1);
    expect(approvals.cancel).not.toHaveBeenCalled();
    expect(approvals.load).toHaveBeenCalledWith('actor', id, 'guild');
  });
  it('refuses DMs and invalid page indices without accepting', async () => {
    const handler = new McpCommandHandler(approvals);
    await handler.handleSlashCommand({ ...interaction(), guildId: null } as never);
    await handler.handleButtonInteraction(interaction(`mcp:page:999:${id}`) as never);
    await handler.handleButtonInteraction(interaction(`mcp:result:999:${id}`) as never);
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
