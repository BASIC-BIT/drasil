import {
  Events,
  GuildMember,
  Message,
  MessageType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { EventHandler } from '../../controllers/EventHandler';
import { DetectionType } from '../../repositories/types';

describe('EventHandler (unit)', () => {
  function buildHandler(overrides?: {
    client?: Record<string, unknown>;
    detectionOrchestrator?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    notificationManager?: Record<string, jest.Mock>;
    setupDiagnosticsService?: Record<string, jest.Mock>;
    reportIntakeService?: Record<string, jest.Mock>;
  }): EventHandler {
    const client = overrides?.client ?? { on: jest.fn(), user: { id: 'bot-1' } };
    const detectionOrchestrator = overrides?.detectionOrchestrator ?? {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'hello',
      }),
      detectNewJoin: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.NEW_ACCOUNT,
        triggerContent: 'Server Join',
      }),
    };

    const configService = overrides?.configService ?? {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const notificationManager = overrides?.notificationManager ?? {
      upsertObservedDetectionNotification: jest.fn(),
      setupVerificationChannel: jest.fn(),
    };

    return new EventHandler(
      client as any,
      detectionOrchestrator as any,
      notificationManager as any,
      configService as any,
      { handleSuspiciousMessage: jest.fn(), openCaseForSuspiciousMessage: jest.fn() } as any,
      { handleTestCommands: jest.fn(), registerCommands: jest.fn() } as any,
      { handleButtonInteraction: jest.fn(), handleModalSubmit: jest.fn() } as any,
      { handleThreadMessage: jest.fn().mockResolvedValue(false) } as any,
      undefined,
      overrides?.setupDiagnosticsService as any,
      overrides?.reportIntakeService as any
    );
  }

  function buildMember(permissions: PermissionsBitField): GuildMember {
    return {
      id: 'user-1',
      nickname: null,
      joinedAt: new Date('2024-01-01T00:00:00.000Z'),
      guild: { id: 'guild-1' },
      user: {
        id: 'user-1',
        tag: 'test-user#0001',
        username: 'test-user',
        discriminator: '0001',
        createdTimestamp: new Date('2020-01-01T00:00:00.000Z').getTime(),
      },
      permissions,
    } as unknown as GuildMember;
  }

  function buildMessage(permissions: PermissionsBitField): Message {
    const member = {
      ...buildMember(permissions),
    } as GuildMember;

    return {
      author: { bot: false, id: 'user-1' },
      content: 'free nitro',
      system: false,
      type: MessageType.Default,
      guild: { id: 'guild-1' },
      member,
      channel: { isThread: jest.fn().mockReturnValue(false) },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as Message;
  }

  it('registers Discord event handlers with current event names', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const handler = buildHandler({ client });

    await handler.setupEventHandlers();

    expect(client.on).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberAdd, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildCreate, expect.any(Function));
    expect(client.on).not.toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('delegates legacy test commands to CommandHandler', async () => {
    const commandHandler = {
      handleTestCommands: jest.fn().mockResolvedValue(undefined),
      registerCommands: jest.fn(),
    };
    const handler = new EventHandler(
      { on: jest.fn(), user: { id: 'bot-1' } } as any,
      { detectMessage: jest.fn(), detectNewJoin: jest.fn() } as any,
      {
        upsertObservedDetectionNotification: jest.fn(),
        setupVerificationChannel: jest.fn(),
      } as any,
      {
        initialize: jest.fn(),
        getCachedServerConfig: jest.fn().mockReturnValue({}),
        getServerConfig: jest.fn(),
      } as any,
      { handleSuspiciousMessage: jest.fn(), openCaseForSuspiciousMessage: jest.fn() } as any,
      commandHandler as any,
      { handleButtonInteraction: jest.fn(), handleModalSubmit: jest.fn() } as any,
      { handleThreadMessage: jest.fn().mockResolvedValue(false) } as any
    );
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = '!test spam';

    await (handler as any).handleMessage(message);

    expect(commandHandler.handleTestCommands).toHaveBeenCalledWith(message);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('skips automatic message detection for moderation members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn(),
      getCachedServerConfig: jest.fn().mockReturnValue({
        settings: { automatic_detection_exempt_moderators: true },
      }),
      getServerConfig: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleMessage(
      buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers))
    );

    expect(configService.initialize).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('runs automatic message detection for moderation members when exemption is disabled', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({
        settings: {
          automatic_detection_exempt_moderators: false,
          detection_response_mode: 'notify_only',
        },
      }),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          automatic_detection_exempt_moderators: false,
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleMessage(
      buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers))
    );

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        hasModerationPermissions: true,
        moderationPermissions: expect.arrayContaining(['kick_members']),
      })
    );
  });

  it('runs automatic message detection for regular members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator });

    await (handler as any).handleMessage(buildMessage(new PermissionsBitField()));

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'test-user',
      })
    );
  });

  it('skips automatic detection for Discord system messages', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.system = true;
    message.type = MessageType.UserJoin;

    await (handler as any).handleMessage(message);

    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('records report intake thread messages before automatic detection', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const reportIntakeService = {
      handleThreadMessage: jest.fn().mockResolvedValue(true),
    };
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channel = { id: 'thread-1', isThread: jest.fn().mockReturnValue(true) };
    const handler = buildHandler({ detectionOrchestrator, reportIntakeService });

    await (handler as any).handleMessage(message);

    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('records report intake thread messages from detection-exempt moderators', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn(),
      getCachedServerConfig: jest.fn().mockReturnValue({
        settings: { automatic_detection_exempt_moderators: true },
      }),
      getServerConfig: jest.fn(),
    };
    const reportIntakeService = {
      handleThreadMessage: jest.fn().mockResolvedValue(true),
    };
    const message = buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers)) as any;
    message.channel = { id: 'thread-1', isThread: jest.fn().mockReturnValue(true) };
    const handler = buildHandler({ detectionOrchestrator, configService, reportIntakeService });

    await (handler as any).handleMessage(message);

    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(configService.initialize).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('continues automatic detection when report intake handling fails', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const reportIntakeService = {
      handleThreadMessage: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channel = { id: 'thread-1', isThread: jest.fn().mockReturnValue(true) };
    const handler = buildHandler({ detectionOrchestrator, reportIntakeService });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await (handler as any).handleMessage(message);
    } finally {
      errorSpy.mockRestore();
    }

    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        serverId: 'guild-1',
        userId: 'user-1',
      })
    );
  });

  it('does not run automatic detection for likely report intake threads when intake handling fails', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const reportIntakeService = {
      handleThreadMessage: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channel = {
      id: 'thread-1',
      name: 'Report intake: test-user',
      isThread: jest.fn().mockReturnValue(true),
    };
    const handler = buildHandler({ detectionOrchestrator, reportIntakeService });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await (handler as any).handleMessage(message);
    } finally {
      errorSpy.mockRestore();
    }

    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('passes recent user messages and same-channel context into message detection', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator });
    const permissions = new PermissionsBitField();
    const firstMessage = buildMessage(permissions) as any;
    firstMessage.id = 'message-1';
    firstMessage.content = 'hello everyone';
    firstMessage.createdTimestamp = Date.now() - 1000;
    firstMessage.channelId = 'channel-1';
    firstMessage.channel.messages = { cache: new Map() };

    await (handler as any).handleMessage(firstMessage);

    const triggerMessage = buildMessage(permissions) as any;
    triggerMessage.id = 'message-2';
    triggerMessage.createdTimestamp = Date.now();
    triggerMessage.channelId = 'channel-1';
    triggerMessage.channel.messages = {
      cache: new Map([
        [
          'same-user-message',
          {
            id: 'same-user-message',
            author: { bot: false, id: 'user-1' },
            content: 'same user context should stay in recentMessages only',
            createdTimestamp: Date.now() - 750,
          },
        ],
        [
          'other-message',
          {
            id: 'other-message',
            author: { bot: false, id: 'other-user' },
            content: 'We are joking about giveaways',
            createdTimestamp: Date.now() - 500,
          },
        ],
      ]),
    };

    await (handler as any).handleMessage(triggerMessage);

    expect(detectionOrchestrator.detectMessage).toHaveBeenLastCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        recentMessages: ['hello everyone'],
        channelContext: ['other_user: We are joking about giveaways'],
      })
    );
  });

  it('loads config before exempting moderators when no cached config exists', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue(undefined),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          automatic_detection_exempt_moderators: false,
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleMessage(
      buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers))
    );

    expect(configService.initialize).toHaveBeenCalled();
    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(detectionOrchestrator.detectMessage).toHaveBeenCalled();
  });

  it('loads config before exempting moderator joins when no cached config exists', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.NEW_ACCOUNT,
        triggerContent: 'Server Join',
      }),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue(undefined),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          automatic_detection_exempt_moderators: false,
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleGuildMemberAdd(
      buildMember(new PermissionsBitField(PermissionFlagsBits.KickMembers))
    );

    expect(configService.initialize).toHaveBeenCalled();
    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(detectionOrchestrator.detectNewJoin).toHaveBeenCalled();
  });

  it('skips automatic join detection for moderation members before config lookup', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn(),
      getCachedServerConfig: jest.fn().mockReturnValue({
        settings: { automatic_detection_exempt_moderators: true },
      }),
      getServerConfig: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleGuildMemberAdd(
      buildMember(new PermissionsBitField(PermissionFlagsBits.ModerateMembers))
    );

    expect(configService.initialize).not.toHaveBeenCalled();
    expect(configService.getServerConfig).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectNewJoin).not.toHaveBeenCalled();
  });

  it('runs automatic join detection for regular members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.NEW_ACCOUNT,
        triggerContent: 'Server Join',
      }),
    };
    const handler = buildHandler({ detectionOrchestrator });

    await (handler as any).handleGuildMemberAdd(buildMember(new PermissionsBitField()));

    expect(detectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      expect.objectContaining({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'test-user',
      })
    );
  });

  it('sends a setup nudge to the audit-log installer on guild create', async () => {
    const installer = {
      id: 'installer-1',
      bot: false,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn(),
      setupVerificationChannel: jest.fn(),
    };
    const handler = buildHandler({ configService, notificationManager });
    const auditEntries = [
      {
        target: { id: 'bot-1' },
        executor: installer,
      },
    ];
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockResolvedValue({
        entries: {
          find: jest.fn((predicate: NonNullable<Parameters<typeof auditEntries.find>[0]>) =>
            auditEntries.find(predicate)
          ),
        },
      }),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).handleGuildCreate(guild);

    expect(installer.send).toHaveBeenCalledWith(expect.stringContaining('/config setup'));
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-1',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
    });
    expect(guild.fetchOwner).not.toHaveBeenCalled();
  });

  it('falls back to the guild owner when installer attribution is unavailable', async () => {
    const ownerUser = {
      id: 'owner-1',
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const handler = buildHandler({ configService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockRejectedValue(new Error('missing permission')),
      fetchOwner: jest.fn().mockResolvedValue({ user: ownerUser }),
    } as any;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await (handler as any).handleGuildCreate(guild);
    } finally {
      warnSpy.mockRestore();
    }

    expect(ownerUser.send).toHaveBeenCalledWith(expect.stringContaining('/config validate'));
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'owner-1',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'owner',
    });
  });

  it('skips setup nudge when the fallback owner is a bot', async () => {
    const ownerUser = {
      id: 'owner-bot-1',
      bot: true,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const handler = buildHandler({ configService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockRejectedValue(new Error('missing permission')),
      fetchOwner: jest.fn().mockResolvedValue({ user: ownerUser }),
    } as any;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await (handler as any).handleGuildCreate(guild);
    } finally {
      warnSpy.mockRestore();
    }

    expect(ownerUser.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: null,
      setup_nudge_last_result: 'no_recipient',
      setup_nudge_last_source: null,
    });
  });

  it('does not fail guild create when setup nudge metadata cannot be saved', async () => {
    const installer = {
      id: 'installer-1',
      bot: false,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const handler = buildHandler({ configService });
    const auditEntries = [
      {
        target: { id: 'bot-1' },
        executor: installer,
      },
    ];
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockResolvedValue({
        entries: {
          find: jest.fn((predicate: NonNullable<Parameters<typeof auditEntries.find>[0]>) =>
            auditEntries.find(predicate)
          ),
        },
      }),
      fetchOwner: jest.fn(),
    } as any;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await (handler as any).handleGuildCreate(guild);
    } finally {
      warnSpy.mockRestore();
    }

    expect(installer.send).toHaveBeenCalledWith(expect.stringContaining('/config setup'));
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-1',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
    });
  });

  it('suppresses repeated setup nudges after a recent attempt', async () => {
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date().toISOString(),
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const handler = buildHandler({ configService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn(),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).handleGuildCreate(guild);

    expect(guild.fetchAuditLogs).not.toHaveBeenCalled();
    expect(guild.fetchOwner).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('sends a detection-time setup warning when diagnostics have errors', async () => {
    const installer = {
      id: 'installer-1',
      bot: false,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const setupDiagnosticsService = {
      validateGuildSetup: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [
          {
            severity: 'error',
            code: 'restricted-role-missing',
            message: 'Restricted role is not configured.',
          },
        ],
        errorCount: 1,
        warningCount: 0,
      }),
    };
    const handler = buildHandler({ configService, setupDiagnosticsService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockResolvedValue({
        entries: {
          find: jest.fn().mockReturnValue({ target: { id: 'bot-1' }, executor: installer }),
        },
      }),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).maybeSendDetectionSetupWarning(guild);

    expect(installer.send).toHaveBeenCalledWith(expect.stringContaining('/config validate'));
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-1',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
      setup_warning_last_fingerprint: 'restricted-role-missing',
    });
    expect(installer.send.mock.calls[0][0]).toContain('No message content is included in this DM.');
  });

  it('skips detection-time setup validation immediately after a warning attempt', async () => {
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date().toISOString(),
          setup_warning_last_fingerprint: 'restricted-role-missing',
        },
      }),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const setupDiagnosticsService = {
      validateGuildSetup: jest.fn(),
    };
    const handler = buildHandler({ configService, setupDiagnosticsService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn(),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).maybeSendDetectionSetupWarning(guild);

    expect(setupDiagnosticsService.validateGuildSetup).not.toHaveBeenCalled();
    expect(guild.fetchAuditLogs).not.toHaveBeenCalled();
    expect(guild.fetchOwner).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('dedupes detection-time setup warnings by recipient and diagnostics fingerprint', async () => {
    const installer = {
      id: 'installer-1',
      bot: false,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          setup_nudge_last_recipient_id: 'installer-1',
          setup_warning_last_fingerprint: 'admin-channel-missing|restricted-role-missing',
        },
      }),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const setupDiagnosticsService = {
      validateGuildSetup: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [
          {
            severity: 'error',
            code: 'restricted-role-missing',
            message: 'Restricted role is not configured.',
          },
          {
            severity: 'error',
            code: 'admin-channel-missing',
            message: 'Admin channel is not configured.',
          },
        ],
        errorCount: 2,
        warningCount: 0,
      }),
    };
    const handler = buildHandler({ configService, setupDiagnosticsService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockResolvedValue({
        entries: {
          find: jest.fn().mockReturnValue({ target: { id: 'bot-1' }, executor: installer }),
        },
      }),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).maybeSendDetectionSetupWarning(guild);

    expect(setupDiagnosticsService.validateGuildSetup).toHaveBeenCalledWith(guild);
    expect(installer.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
  });

  it('allows a setup nudge when the resolved recipient changed during suppression window', async () => {
    const installer = {
      id: 'installer-2',
      bot: false,
      send: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date().toISOString(),
          setup_nudge_last_recipient_id: 'installer-1',
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const handler = buildHandler({ configService });
    const guild = {
      id: 'guild-1',
      name: 'Test Guild',
      fetchAuditLogs: jest.fn().mockResolvedValue({
        entries: {
          find: jest.fn().mockReturnValue({ target: { id: 'bot-1' }, executor: installer }),
        },
      }),
      fetchOwner: jest.fn(),
    } as any;

    await (handler as any).handleGuildCreate(guild);

    expect(installer.send).toHaveBeenCalledWith(expect.stringContaining('/config setup'));
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-2',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
    });
  });
});
