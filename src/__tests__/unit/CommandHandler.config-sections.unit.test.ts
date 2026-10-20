import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import type { ServerSettings } from '../../repositories/types';
import { buildHandler } from './commandHandlerTestHarness';

const rows = [
  ['role-gate', 'enable', {}, { role_gate_enabled: true }],
  ['role-quarantine', 'set-mode', { mode: 'on' }, { role_quarantine_mode: 'on' }],
  ['manual-intake', 'disable', {}, { manual_intake_enabled: false }],
  [
    'case-staff',
    'set-routing',
    { mode: 'ping_only' },
    { case_responder_routing_mode: 'ping_only' },
  ],
  ['case-review', 'disable', {}, { case_review_reminders_enabled: false }],
  ['report', 'reason-require', {}, { user_report_reason_required: true }],
  ['analytics', 'set-level', { level: 'anonymous' }, { analytics_consent_level: 'anonymous' }],
  ['verification', 'analysis-disable', {}, { verification_ai_thread_analysis_enabled: false }],
  ['detection', 'set-mode', { mode: 'record_only' }, { detection_response_mode: 'record_only' }],
] as const;

test.each(rows)(
  'config %s %s reaches the shared boundary and preserves other settings',
  async (group, subcommand, values, patch) => {
    let settings: ServerSettings = { captcha_mode: 'manual', expected_topics: ['keep'] };
    const options: Record<string, string> = values;
    const updateServerSettings = jest.fn(
      async (_guildId: string, changes: Partial<ServerSettings>) => {
        settings = { ...settings, ...changes };
        return { settings };
      }
    );
    const { handler, configService } = buildHandler({
      getServerConfig: jest.fn(async () => ({ settings })),
      updateServerSettings,
    });
    const interaction = {
      id: 'config-request',
      commandName: 'config',
      user: { id: 'admin' },
      guild: {
        id: 'guild-1',
        members: { fetch: jest.fn(async () => ({ permissions: { has: () => true } })) },
      },
      options: {
        getSubcommandGroup: () => group,
        getSubcommand: () => subcommand,
        getString: (name: string) => options[name] ?? null,
        getChannel: () => ({ id: 'channel', type: ChannelType.GuildText }),
      },
      reply: jest.fn(),
      deferReply: jest.fn(),
      editReply: jest.fn(),
    } as unknown as ChatInputCommandInteraction;
    await handler.handleSlashCommand(interaction);
    expect(updateServerSettings).toHaveBeenCalledWith('guild-1', patch);
    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1', {
      forceRefresh: true,
      failOnReadError: true,
    });
    expect(settings).toEqual({ captcha_mode: 'manual', expected_topics: ['keep'], ...patch });
  }
);

test('fresh setup authority can reject a config change after the interaction gate succeeds', async () => {
  const { handler, configService } = buildHandler({
    caseAuthority: {
      async loadFresh(guildId, userId) {
        return { guildId, userId, present: true, owner: false, permissions: '0', roleIds: [] };
      },
    },
  });
  const interaction = {
    id: 'config-request',
    commandName: 'config',
    user: { id: 'admin' },
    guild: {
      id: 'guild-1',
      members: { fetch: jest.fn(async () => ({ permissions: { has: () => true } })) },
    },
    options: { getSubcommandGroup: () => 'role-gate', getSubcommand: () => 'enable' },
    reply: jest.fn(),
  } as unknown as ChatInputCommandInteraction;
  await handler.handleSlashCommand(interaction);
  expect(configService.updateServerSettings).not.toHaveBeenCalled();
  expect(interaction.reply).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.stringContaining('current Administrator permission'),
    })
  );
});

test('bare config set preserves its single column write without an empty settings mutation', async () => {
  const { handler, configService } = buildHandler();
  const interaction = {
    id: 'config-request',
    commandName: 'config',
    user: { id: 'admin' },
    guild: {
      id: 'guild-1',
      members: { fetch: jest.fn(async () => ({ permissions: { has: () => true } })) },
    },
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => 'set',
      getString: (name: string) => (name === 'key' ? 'admin_channel_id' : 'channel'),
    },
    reply: jest.fn(),
  } as unknown as ChatInputCommandInteraction;
  await handler.handleSlashCommand(interaction);
  expect(configService.updateServerConfig).toHaveBeenCalledTimes(1);
  expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
    admin_channel_id: 'channel',
  });
  expect(configService.updateServerSettings).not.toHaveBeenCalled();
});
