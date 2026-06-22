import {
  AuditLogEvent,
  Events,
  GuildMember,
  Message,
  MessageType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { EventHandler } from '../../controllers/EventHandler';
import {
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
} from '../../repositories/types';

const DISCORD_UNKNOWN_BAN_ERROR_CODE = 10026;

describe('EventHandler (unit)', () => {
  function buildHandler(overrides?: {
    client?: Record<string, unknown>;
    detectionOrchestrator?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    notificationManager?: Record<string, jest.Mock>;
    securityActionService?: Record<string, jest.Mock>;
    setupDiagnosticsService?: Record<string, jest.Mock>;
    reportIntakeService?: Record<string, jest.Mock>;
    reportIntakeAgentService?: Record<string, jest.Mock>;
    messageContextRepository?: Record<string, jest.Mock>;
    userModerationService?: Record<string, jest.Mock>;
    productAnalyticsService?: Record<string, jest.Mock>;
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
        case_role_id: null,
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
      (overrides?.securityActionService ?? {
        handleSuspiciousMessage: jest.fn(),
        handleSuspiciousJoin: jest.fn(),
        openCaseForSuspiciousMessage: jest.fn(),
        openCaseForSuspiciousJoin: jest.fn(),
        openAdminCase: jest.fn(),
        recordRejoinAfterKickDetection: jest.fn(),
      }) as any,
      { handleTestCommands: jest.fn(), registerCommands: jest.fn() } as any,
      { handleButtonInteraction: jest.fn(), handleModalSubmit: jest.fn() } as any,
      { handleThreadMessage: jest.fn().mockResolvedValue(false) } as any,
      overrides?.productAnalyticsService as any,
      overrides?.setupDiagnosticsService as any,
      overrides?.reportIntakeService as any,
      overrides?.reportIntakeAgentService as any,
      undefined,
      overrides?.messageContextRepository as any,
      overrides?.userModerationService as any
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

  function buildManualIntakeMember(guild: Record<string, unknown>, roleIds: string[]): GuildMember {
    const roleIdSet = new Set(roleIds);
    return {
      id: 'user-1',
      guild,
      roles: {
        cache: {
          has: jest.fn((roleId: string) => roleIdSet.has(roleId)),
        },
        remove: jest.fn().mockResolvedValue(undefined),
      },
      user: {
        id: 'user-1',
        bot: false,
        tag: 'test-user#0001',
        username: 'test-user',
      },
    } as unknown as GuildMember;
  }

  it('registers Discord event handlers with current event names', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const handler = buildHandler({ client });

    await handler.setupEventHandlers();

    expect(client.on).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberAdd, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberUpdate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildMemberRemove, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildBanAdd, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.InteractionCreate, expect.any(Function));
    expect(client.on).toHaveBeenCalledWith(Events.GuildCreate, expect.any(Function));
    expect(client.on).not.toHaveBeenCalledWith('ready', expect.any(Function));
  });

  it('opens a manual intake case when the configured trigger role remains after the grace period', async () => {
    jest.useFakeTimers();
    try {
      const openAdminCase = jest.fn().mockResolvedValue({
        opened: true,
        caseRoleAttempted: true,
        caseRoleActive: true,
      });
      const client = { on: jest.fn(), user: { id: 'bot-1', bot: true } };
      const role = { id: 'manual-role', name: 'Pending Investigation' };
      const moderator = { id: 'mod-1', bot: false };
      const guild = {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { fetch: jest.fn() },
        fetchAuditLogs: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'audit-1',
              target: { id: 'user-1' },
              executor: moderator,
              createdTimestamp: Date.now(),
              changes: [{ key: '$add', new: [{ id: role.id, name: role.name }] }],
            },
          ],
        }),
      };
      const currentMember = buildManualIntakeMember(guild, [role.id]);
      (guild.members.fetch as jest.Mock).mockResolvedValue(currentMember);
      const configService = {
        initialize: jest.fn().mockResolvedValue(undefined),
        getCachedServerConfig: jest.fn().mockReturnValue({}),
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role',
          settings: {
            manual_intake_enabled: true,
            manual_intake_role_id: role.id,
            manual_intake_grace_period_seconds: 0,
          },
        }),
        updateServerConfig: jest.fn().mockResolvedValue({}),
        updateServerSettings: jest.fn().mockResolvedValue({}),
      };
      const handler = buildHandler({
        client,
        configService,
        securityActionService: {
          handleSuspiciousMessage: jest.fn(),
          handleSuspiciousJoin: jest.fn(),
          openCaseForSuspiciousMessage: jest.fn(),
          openCaseForSuspiciousJoin: jest.fn(),
          openAdminCase,
          recordRejoinAfterKickDetection: jest.fn(),
        },
      });
      await handler.setupEventHandlers();
      const updateHandler = client.on.mock.calls.find(
        ([event]) => event === Events.GuildMemberUpdate
      )?.[1];

      await updateHandler?.(
        buildManualIntakeMember(guild, []),
        buildManualIntakeMember(guild, [role.id])
      );
      await jest.runOnlyPendingTimersAsync();

      expect(openAdminCase).toHaveBeenCalledWith(
        currentMember,
        moderator,
        expect.objectContaining({
          action: 'open_case',
          metadata: expect.objectContaining({
            type: 'manual_role_intake',
            bulk_intake: false,
            trigger: 'manual_role_assignment',
            sourceRoleId: role.id,
            sourceRoleName: role.name,
            assignedById: moderator.id,
          }),
        })
      );
      expect(currentMember.roles.remove).toHaveBeenCalledWith(
        role.id,
        'Manual intake trigger role consumed by Drasil'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels manual intake when the trigger role is removed during the grace period', async () => {
    jest.useFakeTimers();
    try {
      const openAdminCase = jest.fn();
      const client = { on: jest.fn(), user: { id: 'bot-1', bot: true } };
      const role = { id: 'manual-role', name: 'Pending Investigation' };
      const guild = {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { fetch: jest.fn() },
        fetchAuditLogs: jest.fn(),
      };
      const configService = {
        initialize: jest.fn().mockResolvedValue(undefined),
        getCachedServerConfig: jest.fn().mockReturnValue({}),
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role',
          settings: {
            manual_intake_enabled: true,
            manual_intake_role_id: role.id,
            manual_intake_grace_period_seconds: 30,
          },
        }),
        updateServerConfig: jest.fn().mockResolvedValue({}),
        updateServerSettings: jest.fn().mockResolvedValue({}),
      };
      const handler = buildHandler({
        client,
        configService,
        securityActionService: {
          handleSuspiciousMessage: jest.fn(),
          handleSuspiciousJoin: jest.fn(),
          openCaseForSuspiciousMessage: jest.fn(),
          openCaseForSuspiciousJoin: jest.fn(),
          openAdminCase,
          recordRejoinAfterKickDetection: jest.fn(),
        },
      });
      await handler.setupEventHandlers();
      const updateHandler = client.on.mock.calls.find(
        ([event]) => event === Events.GuildMemberUpdate
      )?.[1];

      await updateHandler?.(
        buildManualIntakeMember(guild, []),
        buildManualIntakeMember(guild, [role.id])
      );
      await updateHandler?.(
        buildManualIntakeMember(guild, [role.id]),
        buildManualIntakeMember(guild, [])
      );
      await jest.advanceTimersByTimeAsync(30_000);

      expect(openAdminCase).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('delegates observed Discord bans with native audit-log source attribution', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const userModerationService = {
      recordObservedDiscordBan: jest.fn().mockResolvedValue(1),
      recordMemberLeftGuild: jest.fn(),
    };
    const handler = buildHandler({ client, userModerationService });
    await handler.setupEventHandlers();
    const banHandler = client.on.mock.calls.find(([event]) => event === Events.GuildBanAdd)?.[1];

    await banHandler?.({
      guild: {
        id: 'guild-1',
        fetchAuditLogs: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'audit-1',
              target: { id: 'user-1' },
              executor: { id: 'mod-1', bot: false },
            },
          ],
        }),
      },
      user: { id: 'user-1', tag: 'test-user#0001', username: 'test-user' },
      reason: 'native ban reason',
    } as any);

    expect(userModerationService.recordObservedDiscordBan).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'guild-1' }),
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actorId: 'mod-1',
        reason: 'native ban reason',
        auditLogEntryId: 'audit-1',
      })
    );
  });

  it('delegates member removals that are definitely not already bans', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const userModerationService = {
      recordObservedDiscordBan: jest.fn(),
      recordMemberLeftGuild: jest.fn().mockResolvedValue(1),
    };
    const handler = buildHandler({ client, userModerationService });
    await handler.setupEventHandlers();
    const removeHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberRemove
    )?.[1];
    const member = {
      id: 'user-1',
      user: { id: 'user-1', tag: 'test-user#0001' },
      guild: {
        id: 'guild-1',
        bans: { fetch: jest.fn().mockRejectedValue({ code: DISCORD_UNKNOWN_BAN_ERROR_CODE }) },
      },
    };

    await removeHandler?.(member as any);

    expect(userModerationService.recordMemberLeftGuild).toHaveBeenCalledWith(member);
  });

  it('records observed kicks from recent member-kick audit logs instead of member-left', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const userModerationService = {
      recordObservedDiscordBan: jest.fn(),
      recordObservedDiscordKick: jest.fn().mockResolvedValue(1),
      recordMemberLeftGuild: jest.fn(),
    };
    const handler = buildHandler({ client, userModerationService });
    await handler.setupEventHandlers();
    const removeHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberRemove
    )?.[1];
    const member = {
      id: 'user-1',
      user: { id: 'user-1', tag: 'test-user#0001' },
      guild: {
        id: 'guild-1',
        bans: { fetch: jest.fn().mockRejectedValue({ code: DISCORD_UNKNOWN_BAN_ERROR_CODE }) },
        fetchAuditLogs: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'kick-audit-1',
              target: { id: 'user-1' },
              executor: { id: 'native-mod', bot: false },
              reason: 'native kick reason',
              createdTimestamp: Date.now(),
            },
          ],
        }),
      },
    };

    await removeHandler?.(member as any);

    expect(member.guild.fetchAuditLogs).toHaveBeenCalledWith({
      type: AuditLogEvent.MemberKick,
      limit: 5,
    });
    expect(userModerationService.recordObservedDiscordKick).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actorId: 'native-mod',
        reason: 'native kick reason',
        sourceDetail: 'guildMemberRemove:memberKickAuditLog',
        auditLogEntryId: 'kick-audit-1',
        occurredAt: expect.any(Date),
      })
    );
    expect(userModerationService.recordMemberLeftGuild).not.toHaveBeenCalled();
  });

  it('does not mark member removals when ban state cannot be confirmed', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const userModerationService = {
      recordObservedDiscordBan: jest.fn(),
      recordMemberLeftGuild: jest.fn(),
    };
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handler = buildHandler({ client, userModerationService });
    await handler.setupEventHandlers();
    const removeHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberRemove
    )?.[1];
    const member = {
      id: 'user-1',
      user: { id: 'user-1', tag: 'test-user#0001' },
      guild: {
        id: 'guild-1',
        bans: {
          fetch: jest.fn().mockRejectedValue({ code: 50013, message: 'Missing Permissions' }),
        },
      },
    };

    await removeHandler?.(member as any);

    expect(userModerationService.recordMemberLeftGuild).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('Could not confirm ban state for user-1 in guild guild-1:'),
      expect.objectContaining({ code: 50013 })
    );
    consoleWarn.mockRestore();
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

  it('schedules report intake agent analysis after intake thread evidence is recorded', async () => {
    const reportIntakeService = { handleThreadMessage: jest.fn().mockResolvedValue(true) };
    const reportIntakeAgentService = { scheduleAnalysisForThreadMessage: jest.fn() };
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({
      reportIntakeService,
      reportIntakeAgentService,
      detectionOrchestrator,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channel = { isThread: jest.fn().mockReturnValue(true), name: 'report-intake-test' };

    await (handler as any).handleMessage(message);

    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(reportIntakeAgentService.scheduleAnalysisForThreadMessage).toHaveBeenCalledWith(message);
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
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

  it('runs automatic message detection for Discord reply messages', async () => {
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
    const message = buildMessage(new PermissionsBitField()) as any;
    message.type = MessageType.Reply;

    await (handler as any).handleMessage(message);

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
    const messageContextRepository = {
      findRecentByServerAndUser: jest.fn().mockResolvedValue([
        {
          content_preview: 'hello everyone',
        },
      ]),
      recordMessage: jest.fn().mockResolvedValue(undefined),
      pruneExpired: jest.fn().mockResolvedValue(0),
    };
    const handler = buildHandler({ detectionOrchestrator, messageContextRepository });
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
    expect(messageContextRepository.recordMessage).toHaveBeenCalled();
  });

  it('forces GPT for messages inside the configured first-message window', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0.6,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
        gptAnalysis: {
          result: 'OK',
          confidence: 0.8,
          reasons: ['Context looks legitimate'],
          reasonCodes: ['normal_context'],
          primarySignal: 'none',
          summary: 'Context looks legitimate.',
          model: 'test-model',
          promptVersion: 'test-prompt',
          isFallback: false,
        },
        gptTriggerReasons: ['first_recent_messages'],
      }),
      detectNewJoin: jest.fn(),
    };
    const productAnalyticsService = {
      getStatus: jest.fn(),
      captureGuildEvent: jest.fn(),
      captureUserEvent: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'notify_only',
          gpt_message_check_count: 3,
          min_confidence_threshold: 70,
        },
      }),
    };
    const messageContextRepository = {
      findRecentByServerAndUser: jest.fn().mockResolvedValue([]),
      recordMessage: jest.fn().mockResolvedValue(undefined),
      pruneExpired: jest.fn().mockResolvedValue(0),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      messageContextRepository,
      productAnalyticsService,
    });

    await (handler as any).handleMessage(buildMessage(new PermissionsBitField()));

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        recentMessages: [],
      }),
      { forceGpt: true }
    );
    expect(productAnalyticsService.captureUserEvent).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'message detection forced gpt analyzed',
      expect.objectContaining({
        detection_type: DetectionType.SUSPICIOUS_CONTENT,
        detection_label: 'OK',
        confidence: 0.6,
        confidence_bucket: '50-69',
        detection_response_mode: 'notify_only',
        gpt_force_reason: 'first_recent_messages',
        gpt_force_net_new: true,
        gpt_trigger_reasons: ['first_recent_messages'],
        recent_message_count: 0,
        gpt_message_check_count: 3,
        gpt_used: true,
        gpt_result: 'OK',
        gpt_confidence: 0.8,
        gpt_confidence_bucket: '70-89',
        gpt_primary_signal: 'none',
        gpt_reason_codes: ['normal_context'],
        gpt_is_fallback: false,
      }),
      { detectionEventId: undefined }
    );
  });

  it('does not force GPT after the configured first-message window is full', async () => {
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
    const productAnalyticsService = {
      getStatus: jest.fn(),
      captureGuildEvent: jest.fn(),
      captureUserEvent: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'notify_only',
          gpt_message_check_count: 3,
          min_confidence_threshold: 70,
        },
      }),
    };
    const messageContextRepository = {
      findRecentByServerAndUser: jest
        .fn()
        .mockResolvedValue([
          { content_preview: 'message 1' },
          { content_preview: 'message 2' },
          { content_preview: 'message 3' },
        ]),
      recordMessage: jest.fn().mockResolvedValue(undefined),
      pruneExpired: jest.fn().mockResolvedValue(0),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      messageContextRepository,
      productAnalyticsService,
    });

    await (handler as any).handleMessage(buildMessage(new PermissionsBitField()));

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        recentMessages: ['message 1', 'message 2', 'message 3'],
      })
    );
    expect(productAnalyticsService.captureUserEvent).not.toHaveBeenCalled();
  });

  it('clamps the forced GPT message window to retained context capacity', async () => {
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
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'notify_only',
          gpt_message_check_count: 25,
          min_confidence_threshold: 70,
        },
      }),
    };
    const messageContextRepository = {
      findRecentByServerAndUser: jest.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_, index) => ({
          content_preview: `message ${index + 1}`,
        }))
      ),
      recordMessage: jest.fn().mockResolvedValue(undefined),
      pruneExpired: jest.fn().mockResolvedValue(0),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      messageContextRepository,
    });

    await (handler as any).handleMessage(buildMessage(new PermissionsBitField()));

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        recentMessages: expect.arrayContaining(['message 1', 'message 20']),
      })
    );
    expect(detectionOrchestrator.detectMessage.mock.calls[0]).toHaveLength(4);
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

  it('routes rejoin-after-kick through join response without normal profile scan', async () => {
    const priorKick = {
      id: 'out-kick-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_event_id: null,
      verification_event_id: 'ver-kick-1',
      outcome_type: ModerationOutcomeType.KICKED,
      source: ModerationOutcomeSource.NATIVE_DISCORD,
      actor_id: 'native-mod',
      reason: 'prior unresolved legitimacy',
      occurred_at: new Date('2026-06-01T00:00:00.000Z'),
      created_at: new Date('2026-06-01T00:00:00.000Z'),
      metadata: null,
    };
    const detectionResult = {
      label: 'SUSPICIOUS',
      confidence: 1,
      reasons: ['Previously kicked from this server; review required on rejoin.'],
      triggerSource: DetectionType.REJOIN_AFTER_KICK,
      triggerContent: 'Rejoined after prior kick',
      detectionEventId: 'det-rejoin-1',
    };
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const securityActionService = {
      recordRejoinAfterKickDetection: jest.fn().mockResolvedValue(detectionResult),
      openCaseForSuspiciousJoin: jest.fn().mockResolvedValue(true),
      handleSuspiciousJoin: jest.fn().mockResolvedValue(true),
      handleSuspiciousMessage: jest.fn(),
      openCaseForSuspiciousMessage: jest.fn(),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue(null),
      setupVerificationChannel: jest.fn(),
    };
    const userModerationService = {
      findLatestKickOutcome: jest.fn().mockResolvedValue(priorKick),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      securityActionService,
      notificationManager,
      userModerationService,
    });
    const member = buildMember(new PermissionsBitField());

    await (handler as any).handleGuildMemberAdd(member);

    expect(userModerationService.findLatestKickOutcome).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(securityActionService.recordRejoinAfterKickDetection).toHaveBeenCalledWith(
      member,
      priorKick
    );
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      detectionResult,
      undefined
    );
    expect(securityActionService.openCaseForSuspiciousJoin).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectNewJoin).not.toHaveBeenCalled();
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
        case_role_id: null,
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
        case_role_id: null,
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
        case_role_id: null,
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
        case_role_id: null,
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
        case_role_id: null,
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
        case_role_id: null,
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
            code: 'case-role-missing',
            message: 'Case role is not configured.',
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
      setup_warning_last_fingerprint: 'case-role-missing',
    });
    expect(installer.send.mock.calls[0][0]).toContain('No message content is included in this DM.');
  });

  it('skips detection-time setup validation immediately after a warning attempt', async () => {
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date().toISOString(),
          setup_warning_last_fingerprint: 'case-role-missing',
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
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {
          setup_nudge_last_attempt_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          setup_nudge_last_recipient_id: 'installer-1',
          setup_warning_last_fingerprint: 'admin-channel-missing|case-role-missing',
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
            code: 'case-role-missing',
            message: 'Case role is not configured.',
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
        case_role_id: null,
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
