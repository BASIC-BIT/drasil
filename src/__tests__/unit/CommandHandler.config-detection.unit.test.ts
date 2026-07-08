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
        message_detection_response_mode: 'restrict',
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
        getString: jest.fn((name: string) => (name === 'event' ? 'message' : 'restrict')),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      message_detection_response_mode: 'restrict',
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

  it.each([
    [
      'case-reason-require',
      'admin_case_open_requires_reason',
      true,
      'Case reason required: `yes`',
      undefined,
    ],
    [
      'case-reason-optional',
      'admin_case_open_requires_reason',
      false,
      'Case reason required: `no`',
      undefined,
    ],
    [
      'kick-reason-require',
      'moderator_kick_action_requires_reason',
      true,
      'Kick reason required: `yes`',
      undefined,
    ],
    [
      'kick-reason-optional',
      'moderator_kick_action_requires_reason',
      false,
      'Kick reason required: `no`',
      undefined,
    ],
    [
      'kick-action-enable',
      'moderator_kick_action_enabled',
      true,
      'Moderator kick action enabled: `yes`',
      undefined,
    ],
    [
      'kick-action-disable',
      'moderator_kick_action_enabled',
      false,
      'Moderator kick action enabled: `no`',
      undefined,
    ],
    [
      'observed-kick-enable',
      'observed_action_kick_enabled',
      true,
      'Observed kick action enabled: `yes`',
      undefined,
    ],
    [
      'observed-kick-disable',
      'observed_action_kick_enabled',
      false,
      'Observed kick action enabled: `no`',
      undefined,
    ],
    [
      'auto-kick-enable',
      'message_detection_auto_kick_enabled',
      true,
      'Message auto-kick: `enabled`',
      'message',
    ],
    [
      'auto-kick-disable',
      'message_detection_auto_kick_enabled',
      false,
      'Message auto-kick: `disabled`',
      'message',
    ],
    [
      'auto-kick-enable',
      'join_detection_auto_kick_enabled',
      true,
      'Join auto-kick: `enabled`',
      'join',
    ],
    [
      'auto-kick-disable',
      'join_detection_auto_kick_enabled',
      false,
      'Join auto-kick: `disabled`',
      'join',
    ],
    [
      'auto-kick-enable',
      'report_intake_auto_kick_enabled',
      true,
      'Report-intake auto-kick: `enabled`',
      'report_intake',
    ],
    [
      'auto-kick-disable',
      'report_intake_auto_kick_enabled',
      false,
      'Report-intake auto-kick: `disabled`',
      'report_intake',
    ],
  ])('handles /config detection %s', async (subcommand, key, value, responseText, source) => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [key]: value,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild: {
        id: 'guild-1',
        members: {
          fetch: jest.fn().mockResolvedValue({
            permissions: { has: jest.fn().mockReturnValue(true) },
          }),
        },
      },
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue(subcommand),
        getString: jest.fn().mockReturnValue(source),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [key]: value,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining(responseText),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it.each([
    ['ban-reason-require', true, 'Ban reason required: `yes`'],
    ['ban-reason-optional', false, 'Ban reason required: `no`'],
  ])('handles /config detection %s', async (subcommand, value, responseText) => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        moderator_ban_action_requires_reason: value,
        observed_action_ban_requires_reason: value,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild: {
        id: 'guild-1',
        members: {
          fetch: jest.fn().mockResolvedValue({
            permissions: { has: jest.fn().mockReturnValue(true) },
          }),
        },
      },
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue(subcommand),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      moderator_ban_action_requires_reason: value,
      observed_action_ban_requires_reason: value,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining(responseText),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection set-auto-kick-threshold', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        auto_kick_min_confidence_threshold: 98,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild: {
        id: 'guild-1',
        members: {
          fetch: jest.fn().mockResolvedValue({
            permissions: { has: jest.fn().mockReturnValue(true) },
          }),
        },
      },
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('set-auto-kick-threshold'),
        getInteger: jest.fn().mockReturnValue(98),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      auto_kick_min_confidence_threshold: 98,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Auto-kick threshold: `98%`'),
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
