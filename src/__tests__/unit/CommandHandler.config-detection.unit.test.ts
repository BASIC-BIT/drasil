import { MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler detection config commands (unit)', () => {
  it('handles /config detection set-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        auto_restrict: false,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('set-mode'),
        getString: jest.fn().mockReturnValue('notify_only'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      detection_response_mode: 'notify_only',
      auto_restrict: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated automatic detection response policy'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection set-event-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        message_detection_response_mode: 'open_case',
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('set-event-mode'),
        getString: jest.fn((name: string) => (name === 'event' ? 'message' : 'open_case')),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      message_detection_response_mode: 'open_case',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated message detection response policy'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection clear-event-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        join_detection_response_mode: null,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('clear-event-mode'),
        getString: jest.fn().mockReturnValue('join'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      join_detection_response_mode: null,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Reset join detection response policy to default'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection moderator-exemption-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        automatic_detection_exempt_moderators: false,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('moderator-exemption-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      automatic_detection_exempt_moderators: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator/admin exemption: `disabled`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection ban-action-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        moderator_ban_action_enabled: false,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('ban-action-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      moderator_ban_action_enabled: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator ban action enabled: `no`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection ban-action-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        moderator_ban_action_enabled: true,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('ban-action-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      moderator_ban_action_enabled: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator ban action enabled: `yes`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection moderator-exemption-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        automatic_detection_exempt_moderators: true,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('moderator-exemption-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      automatic_detection_exempt_moderators: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator/admin exemption: `enabled`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });
});
