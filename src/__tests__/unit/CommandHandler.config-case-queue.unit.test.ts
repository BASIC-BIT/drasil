import { MessageFlags } from 'discord.js';
import { MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY } from '../../utils/moderationQueueSettings';
import { buildHandler } from './commandHandlerTestHarness';

const buildGuild = () =>
  ({
    id: 'guild-1',
    members: {
      fetch: jest.fn().mockResolvedValue({
        permissions: {
          has: jest.fn().mockReturnValue(true),
        },
      }),
    },
  }) as any;

const buildInteraction = (subcommand: string, overrides: Record<string, unknown> = {}) => {
  const interaction = {
    commandName: 'config',
    user: { id: 'admin-1' },
    guild: buildGuild(),
    deferred: false,
    replied: false,
    options: {
      getSubcommandGroup: jest.fn().mockReturnValue('case-queue'),
      getSubcommand: jest.fn().mockReturnValue(subcommand),
      getChannel: jest.fn().mockReturnValue({ id: 'queue-channel' }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockImplementation(async () => {
      interaction.deferred = true;
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;

  return interaction;
};

describe('CommandHandler case queue config commands (unit)', () => {
  it('defers before syncing queue items when setting the queue channel', async () => {
    const syncServerQueue = jest.fn().mockResolvedValue(undefined);
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: { [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: 'queue-channel' },
    });
    const { handler, configService } = buildHandler({
      updateServerSettings,
      moderationQueueService: { syncServerQueue },
    });
    const interaction = buildInteraction('set-channel');

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: 'queue-channel',
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      syncServerQueue.mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated live moderation queue channel'),
      allowedMentions: { parse: [] },
    });
  });

  it('defers before clearing queue items when disabling the queue channel', async () => {
    const clearServerQueue = jest.fn().mockResolvedValue(3);
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: { [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: null },
    });
    const { handler, configService } = buildHandler({
      updateServerSettings,
      moderationQueueService: { clearServerQueue },
    });
    const interaction = buildInteraction('clear-channel');

    await handler.handleSlashCommand(interaction);

    expect(clearServerQueue).toHaveBeenCalledWith('guild-1');
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: null,
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      clearServerQueue.mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('removed 3 live queue message(s)'),
      allowedMentions: { parse: [] },
    });
  });
});
