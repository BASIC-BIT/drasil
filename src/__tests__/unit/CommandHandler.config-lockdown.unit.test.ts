import { ChannelType, MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler lockdown config commands (unit)', () => {
  it('defers /config lockdown view before loading settings', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: 'verification-channel-1',
      settings: {
        restricted_lockdown_enabled: true,
      },
    });
    const { handler, configService } = buildHandler({ getServerConfig });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.getServerConfig.mock.invocationCallOrder[0]
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Restricted lockdown: `enabled`'),
      allowedMentions: { parse: [] },
    });
  });

  it('defers /config lockdown disable before saving settings', async () => {
    const { handler, configService } = buildHandler();
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_enabled: false,
    });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.updateServerSettings.mock.invocationCallOrder[0]
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Restricted-role lockdown marked disabled. Existing Discord channel overwrites were not removed.',
    });
  });

  it('defers /config lockdown allow-list updates before saving settings', async () => {
    const { handler, configService } = buildHandler({
      getServerConfig: jest.fn().mockResolvedValue({
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('allow-add'),
        getChannel: jest
          .fn()
          .mockReturnValue({ id: 'media-channel-1', type: ChannelType.GuildMedia }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_allowed_channel_ids: ['media-channel-1'],
      restricted_lockdown_allowed_category_ids: [],
    });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.updateServerSettings.mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Channel <#media-channel-1> added to'),
      allowedMentions: { parse: [] },
    });
  });

  it('passes confirmed unsync option and lists lockdown errors before warnings', async () => {
    const lockdownService = {
      auditGuild: jest.fn(),
      applyGuild: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        enabled: false,
        allowedChannelIds: ['allowed-channel-1'],
        allowedCategoryIds: [],
        autoAllowedChannelIds: ['verification-channel-1'],
        issues: [
          {
            severity: 'warning',
            code: 'lockdown-warning',
            message: 'Warning should be listed after blockers.',
          },
          {
            severity: 'error',
            code: 'lockdown-error',
            message: 'Allowed channel is synced under a denied category.',
          },
        ],
        plannedActions: [],
        appliedActions: [],
        failedActions: [],
        syncedAllowedChannels: [
          { scope: 'channel', channelId: 'allowed-channel-1', channelName: 'welcome-center' },
        ],
        unsyncedAllowedChannels: [
          { scope: 'channel', channelId: 'allowed-channel-1', channelName: 'welcome-center' },
        ],
        errorCount: 1,
        warningCount: 1,
      }),
    };
    const { handler } = buildHandler({ restrictedRoleLockdownService: lockdownService });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('apply'),
        getBoolean: jest.fn().mockReturnValue(true),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(lockdownService.applyGuild).toHaveBeenCalledWith(guild, 'admin-1', {
      unsyncAllowedChannels: true,
    });
    const content = interaction.editReply.mock.calls[0][0].content as string;
    expect(content).toContain('Unsynced allowed channels: `1`');
    expect(content.indexOf('[ERROR]')).toBeLessThan(content.indexOf('[WARNING]'));
  });
});
