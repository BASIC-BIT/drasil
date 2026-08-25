import {
  AuditLogEvent,
  Events,
  GuildMember,
  Message,
  MessageFlags,
  MessageType,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { EventHandler } from '../../controllers/EventHandler';
import {
  ActiveAccountQuarantineCache,
  IActiveAccountQuarantineCache,
} from '../../services/ActiveAccountQuarantineCache';
import { globalConfig } from '../../config/GlobalConfig';
import { runSerializedGuildSetup } from '../../services/SetupProvisioningService';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  VerificationStatus,
} from '../../repositories/types';

const DISCORD_UNKNOWN_BAN_ERROR_CODE = 10026;
const GLOBAL_WATCHLIST_ENTRY = {
  id: 'global-video-link-entry',
  label: 'Global video/link watchlist entry',
  term: 'riskydomain.test',
  requiresLinkOrVideo: true,
};
const GLOBAL_WATCHLIST_MESSAGE = `watch this ${GLOBAL_WATCHLIST_ENTRY.term} clip https://example.com/video`;

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
    moderationQueueService?: Record<string, jest.Mock>;
    roleQuarantineService?: Record<string, jest.Mock>;
    verificationEventRepository?: Record<string, jest.Mock>;
    globalMessageWatchlistRepository?: Record<string, jest.Mock>;
    caseRoleReleaseReconciliationService?: Record<string, jest.Mock>;
    activeQuarantineCache?: IActiveAccountQuarantineCache;
    interactionHandler?: Record<string, jest.Mock>;
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
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn(),
      setupVerificationChannel: jest.fn(),
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
      ...overrides?.notificationManager,
    };
    const verificationEventRepository: Record<string, any> | undefined =
      overrides?.verificationEventRepository
        ? {
            findPendingByServer: jest.fn().mockResolvedValue([
              {
                user_id: 'user-1',
                status: VerificationStatus.PENDING,
                case_kind: CaseKind.COMPROMISED_ACCOUNT,
                containment_status: CaseContainmentStatus.CONTAINED,
              },
            ]),
            ...overrides.verificationEventRepository,
          }
        : undefined;
    if (verificationEventRepository) {
      verificationEventRepository.findByUserAndServer ??= jest.fn().mockImplementation(async () => {
        const active = await verificationEventRepository.findActiveByUserAndServer?.();
        return active ? [active] : [];
      });
      verificationEventRepository.claimAccountQuarantineAttention ??= jest
        .fn()
        .mockImplementation(async () => verificationEventRepository.findActiveByUserAndServer?.());
      verificationEventRepository.updateQuarantineAttempt ??= jest
        .fn()
        .mockImplementation(async (_id, _attemptId, data) => ({
          ...(await verificationEventRepository.findActiveByUserAndServer?.()),
          ...data,
        }));
    }

    return new EventHandler(
      client as any,
      detectionOrchestrator as any,
      notificationManager as any,
      configService as any,
      (overrides?.securityActionService ?? {
        handleSuspiciousMessage: jest.fn(),
        handleSuspiciousJoin: jest.fn(),
        handleHoneypotRoleAssignment: jest.fn(),
        openCaseForSuspiciousMessage: jest.fn(),
        openCaseForSuspiciousJoin: jest.fn(),
        openAdminCase: jest.fn(),
        observeSuspiciousMessage: jest.fn(),
        recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
        recordRejoinAfterKickDetection: jest.fn(),
        recordDiscordPendingMemberState: jest.fn().mockResolvedValue(null),
        repairActiveCase: jest.fn().mockResolvedValue({
          repaired: false,
          message: 'No active verification case found.',
          threadId: null,
          threadCreated: false,
          userAdded: false,
          promptSent: false,
          promptAlreadyPresent: false,
        }),
      }) as any,
      { registerCommands: jest.fn() } as any,
      (overrides?.interactionHandler ?? {
        handleButtonInteraction: jest.fn(),
        handleStringSelectMenuInteraction: jest.fn(),
        handleModalSubmit: jest.fn(),
      }) as any,
      { handleThreadMessage: jest.fn().mockResolvedValue(false) } as any,
      overrides?.productAnalyticsService as any,
      overrides?.setupDiagnosticsService as any,
      overrides?.reportIntakeService as any,
      overrides?.reportIntakeAgentService as any,
      undefined,
      overrides?.messageContextRepository as any,
      overrides?.userModerationService as any,
      overrides?.moderationQueueService as any,
      overrides?.roleQuarantineService as any,
      verificationEventRepository as any,
      (overrides?.globalMessageWatchlistRepository ?? {
        findEnabled: jest.fn().mockResolvedValue([]),
      }) as any,
      overrides?.caseRoleReleaseReconciliationService as any,
      overrides?.activeQuarantineCache
    );
  }

  function buildMember(permissions: PermissionsBitField, pending = false): GuildMember {
    return {
      id: 'user-1',
      partial: false,
      pending,
      nickname: null,
      joinedAt: new Date('2024-01-01T00:00:00.000Z'),
      guild: { id: 'guild-1' },
      user: {
        id: 'user-1',
        bot: false,
        tag: 'test-user#0001',
        username: 'test-user',
        discriminator: '0001',
        createdTimestamp: new Date('2020-01-01T00:00:00.000Z').getTime(),
      },
      permissions,
      roles: { cache: new Map() },
    } as unknown as GuildMember;
  }

  function buildReadySetupDiagnosticsService(): Record<string, jest.Mock> {
    return {
      validateGuildSetup: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [],
        errorCount: 0,
        warningCount: 0,
      }),
    };
  }

  function buildGlobalWatchlistRepository(): Record<string, jest.Mock> {
    return {
      findEnabled: jest.fn().mockResolvedValue([GLOBAL_WATCHLIST_ENTRY]),
    };
  }

  function buildQuarantineConfigService(settings: Record<string, unknown> = {}) {
    const serverConfig = {
      case_role_id: 'case-role-1',
      verification_channel_id: '999999999999999999',
      settings: {
        account_quarantine_enabled: true,
        detection_response_mode: 'notify_only',
        min_confidence_threshold: 70,
        ...settings,
      },
    };
    return {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue(serverConfig),
      getServerConfig: jest.fn().mockResolvedValue(serverConfig),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
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
      channelId: 'channel-1',
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

  it('contains expired interactions without attempting another response', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const unknownInteractionError = Object.assign(new Error('Unknown interaction'), {
      code: 10062,
    });
    const interactionHandler = {
      handleButtonInteraction: jest.fn().mockRejectedValue(unknownInteractionError),
      handleStringSelectMenuInteraction: jest.fn(),
      handleModalSubmit: jest.fn(),
    };
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = buildHandler({ client, interactionHandler });
    await handler.setupEventHandlers();
    const interactionCreateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate
    )?.[1];
    const interaction = {
      isChatInputCommand: jest.fn().mockReturnValue(false),
      isUserContextMenuCommand: jest.fn().mockReturnValue(false),
      isMessageContextMenuCommand: jest.fn().mockReturnValue(false),
      isButton: jest.fn().mockReturnValue(true),
      isStringSelectMenu: jest.fn().mockReturnValue(false),
      isModalSubmit: jest.fn().mockReturnValue(false),
      isRepliable: jest.fn().mockReturnValue(true),
      replied: false,
      deferred: false,
      reply: jest.fn(),
    };

    await expect(interactionCreateHandler?.(interaction as any)).resolves.toBeUndefined();

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      'Discord interaction is no longer valid (10062); skipping fallback response.'
    );
    expect(consoleError).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('does not reject when the fallback interaction response has expired', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const interactionHandler = {
      handleButtonInteraction: jest.fn().mockRejectedValue(new Error('button failed')),
      handleStringSelectMenuInteraction: jest.fn(),
      handleModalSubmit: jest.fn(),
    };
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = buildHandler({ client, interactionHandler });
    await handler.setupEventHandlers();
    const interactionCreateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.InteractionCreate
    )?.[1];
    const interaction = {
      isChatInputCommand: jest.fn().mockReturnValue(false),
      isUserContextMenuCommand: jest.fn().mockReturnValue(false),
      isMessageContextMenuCommand: jest.fn().mockReturnValue(false),
      isButton: jest.fn().mockReturnValue(true),
      isStringSelectMenu: jest.fn().mockReturnValue(false),
      isModalSubmit: jest.fn().mockReturnValue(false),
      isRepliable: jest.fn().mockReturnValue(true),
      replied: false,
      deferred: false,
      reply: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 })),
    };

    await expect(interactionCreateHandler?.(interaction as any)).resolves.toBeUndefined();

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'An error occurred while processing this interaction.',
      flags: MessageFlags.Ephemeral,
    });
    expect(consoleError).toHaveBeenCalledWith('Error handling interaction:', expect.any(Error));
    expect(consoleWarn).toHaveBeenCalledWith(
      'Discord interaction expired before the error response could be sent (10062).'
    );

    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('contains unexpected recoverable event handler rejections', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const handler = buildHandler({ client });
    const eventError = new Error('event failed');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (handler as any).handleMessage = jest.fn().mockRejectedValue(eventError);
    await handler.setupEventHandlers();
    const listener = client.on.mock.calls.find(([event]) => event === Events.MessageCreate)?.[1];

    await expect(listener?.({})).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      'Unexpected error in recoverable Discord event "messageCreate":',
      eventError
    );
    consoleError.mockRestore();
  });

  it('keeps ready-time initialization outside the recoverable event boundary', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const handler = buildHandler({ client });
    const startupError = new Error('startup failed');
    (handler as any).handleReady = jest.fn().mockRejectedValue(startupError);
    await handler.setupEventHandlers();
    const readyListener = client.on.mock.calls.find(([event]) => event === Events.ClientReady)?.[1];

    await expect(readyListener?.()).rejects.toBe(startupError);
  });

  it('starts expired release reconciliation after ready-time initialization', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1', tag: 'bot#0001' } };
    const caseRoleReleaseReconciliationService = { start: jest.fn() };
    const handler = buildHandler({ client, caseRoleReleaseReconciliationService });
    await handler.setupEventHandlers();
    const readyListener = client.on.mock.calls.find(([event]) => event === Events.ClientReady)?.[1];

    await readyListener?.();

    expect(caseRoleReleaseReconciliationService.start).toHaveBeenCalledTimes(1);
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

  it('attributes delayed manual intake using the configured grace-period audit window', async () => {
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
      const assignedAt = Date.now();
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
              createdTimestamp: assignedAt,
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
            manual_intake_grace_period_seconds: 120,
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
          metadata: expect.objectContaining({ assignedById: moderator.id }),
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not attribute manual intake to audit entries without role-change details', async () => {
    jest.useFakeTimers();
    try {
      const openAdminCase = jest.fn().mockResolvedValue({
        opened: true,
        caseRoleAttempted: true,
        caseRoleActive: true,
      });
      const client = { on: jest.fn(), user: { id: 'bot-1', bot: true } };
      const role = { id: 'manual-role', name: 'Pending Investigation' };
      const guild = {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { fetch: jest.fn() },
        fetchAuditLogs: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'audit-1',
              target: { id: 'user-1' },
              executor: { id: 'mod-1', bot: false },
              createdTimestamp: Date.now(),
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
        client.user,
        expect.objectContaining({
          metadata: expect.objectContaining({ assignedById: null }),
        })
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

  it('cancels pending manual intake when the member leaves so a later role assignment can reschedule', async () => {
    jest.useFakeTimers();
    try {
      const openAdminCase = jest.fn().mockResolvedValue({
        opened: true,
        caseRoleAttempted: true,
        caseRoleActive: true,
      });
      const client = { on: jest.fn(), user: { id: 'bot-1', bot: true } };
      const role = { id: 'manual-role', name: 'Pending Investigation' };
      const guild = {
        id: 'guild-1',
        roles: { cache: new Map([[role.id, role]]), fetch: jest.fn() },
        members: { fetch: jest.fn() },
        fetchAuditLogs: jest.fn().mockResolvedValue({ entries: [] }),
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
      const removeHandler = client.on.mock.calls.find(
        ([event]) => event === Events.GuildMemberRemove
      )?.[1];

      await updateHandler?.(
        buildManualIntakeMember(guild, []),
        buildManualIntakeMember(guild, [role.id])
      );
      await removeHandler?.(buildManualIntakeMember(guild, [role.id]));
      await jest.advanceTimersByTimeAsync(30_000);

      expect(openAdminCase).not.toHaveBeenCalled();

      await updateHandler?.(
        buildManualIntakeMember(guild, []),
        buildManualIntakeMember(guild, [role.id])
      );
      await jest.advanceTimersByTimeAsync(30_000);

      expect(openAdminCase).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes newly assigned honeypot roles through role gate response mode', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const honeypotRole = { id: '111111111111111111', name: 'Robot' };
    const oldMember = {
      id: 'user-1',
      partial: false,
      user: { id: 'user-1', bot: false, username: 'test-user', tag: 'test-user#0001' },
      roles: { cache: new Map() },
      guild: { id: 'guild-1' },
    };
    const newMember = {
      ...oldMember,
      roles: { cache: new Map([[honeypotRole.id, honeypotRole]]) },
      guild: {
        id: 'guild-1',
        roles: {
          cache: new Map([[honeypotRole.id, honeypotRole]]),
          fetch: jest.fn().mockResolvedValue(honeypotRole),
        },
      },
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        settings: {
          role_gate_enabled: true,
          honeypot_role_id: honeypotRole.id,
          honeypot_role_response_mode: 'restrict',
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn(),
      handleSuspiciousJoin: jest.fn(),
      handleHoneypotRoleAssignment: jest.fn().mockResolvedValue(true),
      openCaseForSuspiciousMessage: jest.fn(),
      openCaseForSuspiciousJoin: jest.fn(),
      recordRejoinAfterKickDetection: jest.fn(),
    };
    const handler = buildHandler({ client, configService, securityActionService });
    await handler.setupEventHandlers();
    const updateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberUpdate
    )?.[1];

    await updateHandler?.(oldMember as any, newMember as any);

    expect(securityActionService.handleHoneypotRoleAssignment).toHaveBeenCalledWith(newMember, {
      roleId: honeypotRole.id,
      roleName: honeypotRole.name,
      responseMode: 'restrict',
    });
  });

  it('enforces active-case role quarantine before role-gate handling', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const caseRole = { id: 'case-role', name: 'Case' };
    const honeypotRole = { id: '111111111111111111', name: 'Robot' };
    const activeCase = {
      id: 'verification-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      metadata: {},
    };
    const oldMember = {
      id: 'user-1',
      partial: false,
      user: { id: 'user-1', bot: false, username: 'test-user', tag: 'test-user#0001' },
      roles: { cache: new Map([[caseRole.id, caseRole]]) },
      guild: { id: 'guild-1' },
    };
    const newMember = {
      ...oldMember,
      roles: {
        cache: new Map([
          [caseRole.id, caseRole],
          [honeypotRole.id, honeypotRole],
        ]),
      },
      guild: {
        id: 'guild-1',
        roles: {
          cache: new Map([[honeypotRole.id, honeypotRole]]),
          fetch: jest.fn().mockResolvedValue(honeypotRole),
        },
      },
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: caseRole.id,
        settings: {
          role_gate_enabled: true,
          honeypot_role_id: honeypotRole.id,
          honeypot_role_response_mode: 'restrict',
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn(),
      handleSuspiciousJoin: jest.fn(),
      handleHoneypotRoleAssignment: jest.fn().mockResolvedValue(true),
      openCaseForSuspiciousMessage: jest.fn(),
      openCaseForSuspiciousJoin: jest.fn(),
      recordRejoinAfterKickDetection: jest.fn(),
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [honeypotRole.id],
        removedRoleIds: [honeypotRole.id],
        skippedRoles: [{ role_id: 'managed-role', reason: 'managed' }],
        failedRemovals: [],
      }),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      findByUserAndServer: jest.fn().mockResolvedValue([activeCase]),
      findById: jest.fn().mockResolvedValue({
        ...activeCase,
        containment_status: CaseContainmentStatus.INCOMPLETE,
      }),
    };
    const notificationManager = {
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
    };
    const moderationQueueService = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const handler = buildHandler({
      client,
      configService,
      securityActionService,
      roleQuarantineService,
      verificationEventRepository,
      notificationManager,
      moderationQueueService,
    });
    await handler.setupEventHandlers();
    const updateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberUpdate
    )?.[1];

    await updateHandler?.(oldMember as any, newMember as any);

    expect(verificationEventRepository.findActiveByUserAndServer).toHaveBeenCalledWith(
      'user-1',
      'guild-1'
    );
    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).toHaveBeenCalledWith(
      oldMember,
      newMember,
      activeCase
    );
    expect(
      roleQuarantineService.enforceActiveCaseRoleUpdate.mock.invocationCallOrder[0]
    ).toBeLessThan(securityActionService.handleHoneypotRoleAssignment.mock.invocationCallOrder[0]);
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      expect.objectContaining({ containment_status: CaseContainmentStatus.INCOMPLETE }),
      VerificationStatus.PENDING
    );
    expect(moderationQueueService.upsertCaseMirror).toHaveBeenCalled();
  });

  it('does not enforce active-case role quarantine after restrictions are lifted', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
    const gainedRole = { id: '111111111111111111', name: 'Member' };
    const oldMember = {
      id: 'user-1',
      partial: false,
      user: { id: 'user-1', bot: false, username: 'test-user', tag: 'test-user#0001' },
      roles: { cache: new Map() },
      guild: { id: 'guild-1' },
    };
    const newMember = {
      ...oldMember,
      roles: { cache: new Map([[gainedRole.id, gainedRole]]) },
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'case-role',
        settings: {},
      }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn(),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn(),
      findByUserAndServer: jest.fn().mockResolvedValue([]),
      findPendingByServer: jest.fn().mockResolvedValue([]),
    };
    const handler = buildHandler({
      client,
      configService,
      roleQuarantineService,
      verificationEventRepository,
    });
    await handler.setupEventHandlers();
    const updateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberUpdate
    )?.[1];

    await updateHandler?.(oldMember as any, newMember as any);

    expect(verificationEventRepository.findActiveByUserAndServer).toHaveBeenCalledWith(
      'user-1',
      'guild-1'
    );
    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).not.toHaveBeenCalled();
  });

  it('handles removal of the required case role from a parked compromised account', async () => {
    const caseRole = { id: 'case-role' };
    const oldMember = {
      id: 'user-1',
      user: { tag: 'test-user#0001' },
      guild: { id: 'guild-1' },
      roles: { cache: new Map([[caseRole.id, caseRole]]) },
    };
    const newMember = {
      ...oldMember,
      roles: { cache: new Map() },
    };
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_case_role_id: caseRole.id,
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [],
        removedRoleIds: [],
        skippedRoles: [],
        failedRemovals: [],
        containmentRegressed: false,
      }),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
    const handler = buildHandler({ roleQuarantineService, verificationEventRepository });

    await (handler as any).enforceActiveCaseRoleQuarantine(oldMember, newMember, {
      case_role_id: 'replacement-case-role',
    });

    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).toHaveBeenCalledWith(
      oldMember,
      newMember,
      activeCase
    );
  });

  it('enforces gained roles for an incomplete compromised case without its case role', async () => {
    const gainedRole = { id: 'privileged-role' };
    const oldMember = {
      id: 'user-1',
      user: { tag: 'test-user#0001' },
      guild: { id: 'guild-1' },
      roles: { cache: new Map() },
    };
    const newMember = {
      ...oldMember,
      roles: { cache: new Map([[gainedRole.id, gainedRole]]) },
    };
    const activeCase = {
      id: 'verification-incomplete',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      quarantine_case_role_id: 'persisted-case-role',
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [gainedRole.id],
        removedRoleIds: [gainedRole.id],
        skippedRoles: [],
        failedRemovals: [],
      }),
    };
    const handler = buildHandler({
      roleQuarantineService,
      verificationEventRepository: {
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      },
    });

    await (handler as any).enforceActiveCaseRoleQuarantine(oldMember, newMember, {
      case_role_id: 'current-case-role',
    });

    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).toHaveBeenCalledWith(
      oldMember,
      newMember,
      activeCase
    );
  });

  it('enforces gained roles when an incomplete compromised case has no case-role identity', async () => {
    const gainedRole = { id: 'privileged-role' };
    const oldMember = {
      id: 'user-1',
      user: { tag: 'test-user#0001' },
      guild: { id: 'guild-1' },
      roles: { cache: new Map() },
    };
    const newMember = {
      ...oldMember,
      roles: { cache: new Map([[gainedRole.id, gainedRole]]) },
    };
    const activeCase = {
      id: 'verification-no-case-role',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      quarantine_case_role_id: null,
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [gainedRole.id],
        removedRoleIds: [gainedRole.id],
        skippedRoles: [],
        failedRemovals: [],
      }),
    };
    const handler = buildHandler({
      roleQuarantineService,
      verificationEventRepository: {
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      },
    });

    await (handler as any).enforceActiveCaseRoleQuarantine(oldMember, newMember, {
      case_role_id: null,
    });

    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).toHaveBeenCalledWith(
      oldMember,
      newMember,
      activeCase
    );
  });

  it('enforces an older parked quarantine when the newest pending case is standard', async () => {
    const persistedCaseRole = { id: 'persisted-case-role' };
    const oldMember = {
      id: 'user-1',
      user: { tag: 'test-user#0001' },
      guild: { id: 'guild-1' },
      roles: { cache: new Map([[persistedCaseRole.id, persistedCaseRole]]) },
    };
    const newMember = { ...oldMember, roles: { cache: new Map() } };
    const newestStandardCase = {
      id: 'verification-standard',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.STANDARD,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
    };
    const parkedCase = {
      id: 'verification-parked',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_case_role_id: persistedCaseRole.id,
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [],
        removedRoleIds: [],
        skippedRoles: [],
        failedRemovals: [],
      }),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(newestStandardCase),
      findByUserAndServer: jest.fn().mockResolvedValue([newestStandardCase, parkedCase]),
    };
    const handler = buildHandler({ roleQuarantineService, verificationEventRepository });

    await (handler as any).enforceActiveCaseRoleQuarantine(oldMember, newMember, {
      case_role_id: 'current-case-role',
    });

    expect(roleQuarantineService.enforceActiveCaseRoleUpdate).toHaveBeenCalledWith(
      oldMember,
      newMember,
      parkedCase
    );
  });

  it('enforces an older incomplete compromised quarantine when the newest case is standard', async () => {
    const newestStandardCase = {
      id: 'verification-standard',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.STANDARD,
      containment_status: CaseContainmentStatus.NOT_APPLICABLE,
    };
    const incompleteCompromisedCase = {
      id: 'verification-compromised',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(newestStandardCase),
      findByUserAndServer: jest
        .fn()
        .mockResolvedValue([newestStandardCase, incompleteCompromisedCase]),
    };
    const handler = buildHandler({ verificationEventRepository });

    await expect((handler as any).findEnforcedActiveCase('user-1', 'guild-1')).resolves.toBe(
      incompleteCompromisedCase
    );
  });

  it('does not refresh parked surfaces for a harmless retained managed role', async () => {
    const caseRole = { id: 'case-role' };
    const managedRole = { id: 'managed-role' };
    const oldMember = {
      id: 'user-1',
      user: { tag: 'test-user#0001' },
      guild: { id: 'guild-1' },
      roles: { cache: new Map([[caseRole.id, caseRole]]) },
    };
    const newMember = {
      ...oldMember,
      roles: {
        cache: new Map([
          [caseRole.id, caseRole],
          [managedRole.id, managedRole],
        ]),
      },
    };
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    };
    const roleQuarantineService = {
      enforceActiveCaseRoleUpdate: jest.fn().mockResolvedValue({
        addedRoleIds: [managedRole.id],
        removedRoleIds: [],
        skippedRoles: [{ role_id: managedRole.id, reason: 'managed role' }],
        failedRemovals: [],
      }),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      findById: jest.fn().mockResolvedValue(activeCase),
    };
    const notificationManager = {
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
    };
    const moderationQueueService = { upsertCaseMirror: jest.fn().mockResolvedValue(undefined) };
    const handler = buildHandler({
      roleQuarantineService,
      verificationEventRepository,
      notificationManager,
      moderationQueueService,
    });

    await (handler as any).enforceActiveCaseRoleQuarantine(oldMember, newMember, {
      case_role_id: caseRole.id,
    });

    expect(notificationManager.updateNotificationButtons).not.toHaveBeenCalled();
    expect(moderationQueueService.upsertCaseMirror).not.toHaveBeenCalled();
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

  it('schedules report intake agent analysis after intake thread evidence is recorded', async () => {
    const reportIntakeService = { handleThreadMessage: jest.fn().mockResolvedValue(true) };
    const reportIntakeAgentService = { scheduleAnalysisForThreadMessage: jest.fn() };
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

  it('records a parked quarantine breach before report-intake handling returns', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
    const reportIntakeService = { handleThreadMessage: jest.fn().mockResolvedValue(true) };
    const reportIntakeAgentService = { scheduleAnalysisForThreadMessage: jest.fn() };
    const detectionOrchestrator = { detectMessage: jest.fn(), detectNewJoin: jest.fn() };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      moderationQueueService,
      verificationEventRepository,
      reportIntakeService,
      reportIntakeAgentService,
      detectionOrchestrator,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channelId = 'report-intake-thread';
    message.channel = { isThread: jest.fn().mockReturnValue(true), name: 'report-intake-test' };

    await (handler as any).handleMessage(message);

    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalledWith(
      activeCase,
      message
    );
    expect(reportIntakeService.handleThreadMessage).toHaveBeenCalledWith(message);
    expect(reportIntakeAgentService.scheduleAnalysisForThreadMessage).toHaveBeenCalledWith(message);
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('directly notifies admins of a parked breach without a moderation queue', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const notificationManager = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      },
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(notificationManager.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      activeCase,
      'containment_breach',
      message
    );
  });

  it('directly notifies admins when the optional breach queue write fails', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const notificationManager = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockRejectedValue(new Error('Queue unavailable')),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager,
      moderationQueueService,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      },
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(notificationManager.notifyAccountQuarantineAttention).toHaveBeenCalledWith(
      activeCase,
      'containment_breach',
      message
    );
  });

  it('deduplicates direct breach notifications while the queue attention item remains open', async () => {
    let currentCase: any = {
      id: 'verification-deduped-breach',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
      parked_at: new Date('2026-08-18T12:00:00.000Z'),
      parked_by: 'moderator-1',
      metadata: {},
    };
    const notificationManager = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest
        .fn()
        .mockResolvedValueOnce({ delivered: true, created: true })
        .mockResolvedValueOnce({ delivered: true, created: false }),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager,
      moderationQueueService,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockImplementation(async () => [currentCase]),
        findActiveByUserAndServer: jest.fn().mockImplementation(async () => currentCase),
        claimAccountQuarantineAttention: jest
          .fn()
          .mockImplementation(async (_id, _serverId, _userId, attemptId) => ({
            ...currentCase,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
          })),
        updateQuarantineAttempt: jest.fn().mockImplementation(async (_id, _attemptId, data) => {
          currentCase = {
            ...currentCase,
            ...data,
            metadata: data.metadata ?? currentCase.metadata,
            quarantine_attempt_id: null,
          };
          return currentCase;
        }),
      },
    });
    const firstMessage = buildMessage(new PermissionsBitField());
    (firstMessage as any).id = 'message-1';
    const secondMessage = { ...firstMessage, id: 'message-2' };

    await (handler as any).recordParkedQuarantineBreach(firstMessage);
    await (handler as any).recordParkedQuarantineBreach(secondMessage);

    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalledTimes(2);
    expect(notificationManager.notifyAccountQuarantineAttention).toHaveBeenCalledTimes(1);
    expect(currentCase.metadata).toEqual(
      expect.objectContaining({
        breach_attention_direct_notified_at: expect.any(String),
        breach_attention_direct_message_id: firstMessage.id,
      })
    );
  });

  it('returns a breach to durable review when every attention delivery path fails', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
      parked_at: new Date('2026-08-18T12:00:00.000Z'),
      parked_by: 'moderator-1',
      metadata: {},
    };
    const updateQuarantineAttempt = jest.fn().mockResolvedValue(activeCase);
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager: {
        notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(false),
      },
      moderationQueueService: {
        recordQuarantineBreachAttention: jest.fn().mockResolvedValue(false),
      },
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
        updateQuarantineAttempt,
      },
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(updateQuarantineAttempt).toHaveBeenCalledWith(
      activeCase.id,
      expect.stringMatching(/^case-attention:/),
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
        metadata: expect.objectContaining({
          breach_attention_message_id: message.id,
        }),
      })
    );
  });

  it('keeps breach monitoring active while compromised containment is incomplete', async () => {
    const activeCase = {
      id: 'verification-incomplete-breach',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      quarantine_attempt_id: null,
      parked_at: null,
      parked_by: null,
      metadata: {},
    };
    const updateQuarantineAttempt = jest.fn().mockResolvedValue(activeCase);
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(true),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager: {
        notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
      },
      moderationQueueService,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
        updateQuarantineAttempt,
      },
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalled();
    expect(updateQuarantineAttempt).toHaveBeenCalledWith(
      activeCase.id,
      expect.stringMatching(/^case-attention:/),
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
      })
    );
  });

  it('suppresses breach attention during an active verification release', async () => {
    const activeCase = {
      id: 'verification-1',
      user_id: 'user-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      quarantine_attempt_id: 'case-role-release:active',
      quarantine_lease_renewed_at: new Date(),
    };
    const notificationManager = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager,
      moderationQueueService,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
      },
    });

    await (handler as any).recordParkedQuarantineBreach(buildMessage(new PermissionsBitField()));

    expect(notificationManager.notifyAccountQuarantineAttention).not.toHaveBeenCalled();
    expect(moderationQueueService.recordQuarantineBreachAttention).not.toHaveBeenCalled();
  });

  it('does not recreate breach attention when release wins after the initial case read', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const notificationManager = {
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const claimAccountQuarantineAttention = jest.fn().mockResolvedValue(null);
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      notificationManager,
      moderationQueueService,
      verificationEventRepository: {
        findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
        findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
        claimAccountQuarantineAttention,
      },
    });

    await (handler as any).recordParkedQuarantineBreach(buildMessage(new PermissionsBitField()));

    expect(claimAccountQuarantineAttention).toHaveBeenCalled();
    expect(notificationManager.notifyAccountQuarantineAttention).not.toHaveBeenCalled();
    expect(moderationQueueService.recordQuarantineBreachAttention).not.toHaveBeenCalled();
  });

  it('waits for configuration initialization before evaluating a parked breach', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const serverConfig = {
      case_role_id: 'case-role-1',
      verification_channel_id: '999999999999999999',
      settings: { account_quarantine_enabled: true },
    };
    let initialized = false;
    const configService = {
      initialize: jest.fn().mockImplementation(async () => {
        initialized = true;
      }),
      getCachedServerConfig: jest
        .fn()
        .mockImplementation(() => (initialized ? serverConfig : undefined)),
      getServerConfig: jest.fn().mockResolvedValue(serverConfig),
      updateServerConfig: jest.fn(),
      updateServerSettings: jest.fn(),
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
    const handler = buildHandler({
      configService,
      moderationQueueService,
      verificationEventRepository,
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(configService.initialize).toHaveBeenCalledTimes(1);
    expect(configService.getCachedServerConfig).toHaveBeenCalledWith('guild-1');
    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalledWith(
      activeCase,
      message
    );
  });

  it('does not treat a recovery-thread reply as a quarantine breach', async () => {
    const activeCase = {
      id: 'verification-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      moderationQueueService,
      verificationEventRepository,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channelId = 'recovery-thread';

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(moderationQueueService.recordQuarantineBreachAttention).not.toHaveBeenCalled();
  });

  it('does not query active cases when account quarantine is disabled in the config cache', async () => {
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([]),
      findActiveByUserAndServer: jest.fn(),
    };
    const handler = buildHandler({ moderationQueueService, verificationEventRepository });

    await (handler as any).recordParkedQuarantineBreach(buildMessage(new PermissionsBitField()));

    expect(verificationEventRepository.findActiveByUserAndServer).not.toHaveBeenCalled();
  });

  it('does not query active cases for an uncached member without the configured case role', async () => {
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([]),
      findActiveByUserAndServer: jest.fn(),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      verificationEventRepository,
    });

    await (handler as any).recordParkedQuarantineBreach(buildMessage(new PermissionsBitField()));

    expect(verificationEventRepository.findPendingByServer).toHaveBeenCalledWith('guild-1');
    expect(verificationEventRepository.findActiveByUserAndServer).not.toHaveBeenCalled();
  });

  it('immediately monitors a newly active quarantine after a cached negative lookup', async () => {
    const activeQuarantineCache = new ActiveAccountQuarantineCache();
    let activeCase: any = null;
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest
        .fn()
        .mockResolvedValue({ delivered: true, created: true }),
    };
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([]),
      findActiveByUserAndServer: jest.fn().mockImplementation(async () => activeCase),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      moderationQueueService,
      verificationEventRepository,
      activeQuarantineCache,
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);
    expect(verificationEventRepository.findActiveByUserAndServer).not.toHaveBeenCalled();

    activeCase = {
      id: 'verification-newly-incomplete',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      server_id: 'guild-1',
      thread_id: 'recovery-thread',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      quarantine_attempt_id: null,
      metadata: {},
    };
    activeQuarantineCache.noteActive('guild-1', 'user-1');

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(verificationEventRepository.findPendingByServer).toHaveBeenCalledTimes(1);
    expect(verificationEventRepository.findActiveByUserAndServer).toHaveBeenCalled();
    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalled();
  });

  it('checks an uncached member who still has the configured case role', async () => {
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([]),
      findActiveByUserAndServer: jest.fn().mockResolvedValue(null),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      verificationEventRepository,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.member.roles.cache.set('case-role-1', { id: 'case-role-1' });

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(verificationEventRepository.findActiveByUserAndServer).toHaveBeenCalledWith(
      'user-1',
      'guild-1'
    );
  });

  it('continues monitoring an existing parked case after new quarantine entry is disabled', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      user_id: 'user-1',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
      thread_id: 'recovery-thread',
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findPendingByServer: jest.fn().mockResolvedValue([activeCase]),
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
    const handler = buildHandler({ moderationQueueService, verificationEventRepository });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(verificationEventRepository.findPendingByServer).toHaveBeenCalledWith('guild-1');
    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalledWith(
      activeCase,
      message
    );
  });

  it.each([
    {
      name: 'channel',
      settings: { case_role_lockdown_allowed_channel_ids: ['111111111111111111'] },
      channelId: '111111111111111111',
      channel: { isThread: (): boolean => false, parentId: '333333333333333333' },
    },
    {
      name: 'parent channel',
      settings: { case_role_lockdown_allowed_channel_ids: ['222222222222222222'] },
      channelId: '444444444444444444',
      channel: {
        isThread: (): boolean => true,
        parentId: '222222222222222222',
        parent: { parentId: '333333333333333333' },
      },
    },
    {
      name: 'category',
      settings: { case_role_lockdown_allowed_category_ids: ['333333333333333333'] },
      channelId: '111111111111111111',
      channel: { isThread: (): boolean => false, parentId: '333333333333333333' },
    },
  ])('does not report messages in an allowed lockdown $name as breaches', async (surface) => {
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn(),
    };
    const handler = buildHandler({
      configService: buildQuarantineConfigService(surface.settings),
      moderationQueueService,
      verificationEventRepository,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.channelId = surface.channelId;
    message.channel = surface.channel;

    await (handler as any).recordParkedQuarantineBreach(message);

    expect(verificationEventRepository.findActiveByUserAndServer).not.toHaveBeenCalled();
    expect(moderationQueueService.recordQuarantineBreachAttention).not.toHaveBeenCalled();
  });

  it('skips automatic message detection for moderation members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({
        settings: {
          automatic_detection_exempt_moderators: true,
          detection_response_mode: 'notify_only',
        },
      }),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          automatic_detection_exempt_moderators: true,
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

  it('routes a parked compromised-account message to moderator attention even if the case role is missing', async () => {
    const activeCase = {
      id: 'verification-1',
      status: VerificationStatus.PENDING,
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_attempt_id: null,
    };
    const moderationQueueService = {
      recordQuarantineBreachAttention: jest.fn().mockResolvedValue(undefined),
    };
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(activeCase),
    };
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
    const handler = buildHandler({
      configService: buildQuarantineConfigService(),
      moderationQueueService,
      verificationEventRepository,
      detectionOrchestrator,
    });
    const message = buildMessage(new PermissionsBitField());

    await (handler as any).handleMessage(message);

    expect(verificationEventRepository.findActiveByUserAndServer).toHaveBeenCalledWith(
      'user-1',
      'guild-1'
    );
    expect(moderationQueueService.recordQuarantineBreachAttention).toHaveBeenCalledWith(
      activeCase,
      message
    );
    expect(detectionOrchestrator.detectMessage).toHaveBeenCalled();
  });

  it('uses normal detection when no global watchlist rows are loaded', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: GLOBAL_WATCHLIST_MESSAGE,
      }),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      GLOBAL_WATCHLIST_MESSAGE,
      expect.any(Object)
    );
  });

  it.each([
    ['message deletion is disabled', { message_deletion_enabled: false }],
    ['message watchlist is disabled', { message_deletion_watchlist_enabled: false }],
  ])('does not load global watchlist rows when %s', async (_label, settings) => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: GLOBAL_WATCHLIST_MESSAGE,
      }),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
          ...settings,
        },
      }),
    };
    const globalMessageWatchlistRepository = buildGlobalWatchlistRepository();
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      globalMessageWatchlistRepository,
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(globalMessageWatchlistRepository.findEnabled).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      GLOBAL_WATCHLIST_MESSAGE,
      expect.any(Object)
    );
  });

  it('briefly backs off after an initial global watchlist database failure', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const detectionOrchestrator = {
        detectMessage: jest.fn().mockResolvedValue({
          label: 'OK',
          confidence: 0,
          reasons: [],
          triggerSource: DetectionType.SUSPICIOUS_CONTENT,
          triggerContent: GLOBAL_WATCHLIST_MESSAGE,
        }),
        detectNewJoin: jest.fn(),
      };
      const configService = {
        initialize: jest.fn().mockResolvedValue(undefined),
        getCachedServerConfig: jest.fn().mockReturnValue({}),
        getServerConfig: jest.fn().mockResolvedValue({
          case_role_id: 'case-role-1',
          admin_channel_id: 'admin-channel-1',
          verification_channel_id: 'verification-channel-1',
          settings: {
            detection_response_mode: 'restrict',
            min_confidence_threshold: 70,
          },
        }),
      };
      const securityActionService = {
        handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
        observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
        recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
      };
      const globalMessageWatchlistRepository = {
        findEnabled: jest
          .fn()
          .mockRejectedValueOnce(new Error('DB down'))
          .mockResolvedValueOnce([GLOBAL_WATCHLIST_ENTRY]),
      };
      const handler = buildHandler({
        detectionOrchestrator,
        configService,
        securityActionService,
        setupDiagnosticsService: buildReadySetupDiagnosticsService(),
        globalMessageWatchlistRepository,
      });
      const firstMessage = buildMessage(new PermissionsBitField()) as any;
      firstMessage.content = GLOBAL_WATCHLIST_MESSAGE;
      const secondMessage = buildMessage(new PermissionsBitField()) as any;
      secondMessage.content = GLOBAL_WATCHLIST_MESSAGE;
      const thirdMessage = buildMessage(new PermissionsBitField()) as any;
      thirdMessage.content = GLOBAL_WATCHLIST_MESSAGE;

      await (handler as any).handleMessage(firstMessage);
      await (handler as any).handleMessage(secondMessage);
      jest.advanceTimersByTime(5_001);
      await (handler as any).handleMessage(thirdMessage);

      expect(globalMessageWatchlistRepository.findEnabled).toHaveBeenCalledTimes(2);
      expect(detectionOrchestrator.detectMessage).toHaveBeenCalledTimes(2);
      expect(securityActionService.handleSuspiciousMessage).toHaveBeenCalledWith(
        thirdMessage.member,
        expect.objectContaining({ triggerSource: DetectionType.PATTERN_MATCH }),
        thirdMessage
      );
    } finally {
      warnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('routes non-staff watchlist matches to restricted source-message deletion handling', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {
          detection_response_mode: 'restrict',
          min_confidence_threshold: 70,
        },
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      securityActionService,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    expect(securityActionService.handleSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        label: 'SUSPICIOUS',
        confidence: 1,
        triggerSource: DetectionType.PATTERN_MATCH,
        messageAction: expect.objectContaining({
          kind: 'delete_source_message',
          source: 'watchlist',
          watchlistEntryId: GLOBAL_WATCHLIST_ENTRY.id,
          matchedTerm: GLOBAL_WATCHLIST_ENTRY.label,
        }),
      }),
      message
    );
    expect(securityActionService.observeSuspiciousMessage).not.toHaveBeenCalled();
  });

  it('records non-staff watchlist matches before record-only response routing', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'record_only',
          min_confidence_threshold: 70,
        },
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      securityActionService,
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    expect(securityActionService.recordSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        triggerSource: DetectionType.PATTERN_MATCH,
        messageAction: expect.objectContaining({ kind: 'review_only' }),
      }),
      message
    );
    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.observeSuspiciousMessage).not.toHaveBeenCalled();
  });

  it('notifies non-staff watchlist matches without deletion intent in notify-only mode', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue(null),
      setupVerificationChannel: jest.fn(),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      notificationManager,
      securityActionService,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField()) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(securityActionService.recordSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        triggerSource: DetectionType.PATTERN_MATCH,
        messageAction: expect.objectContaining({ kind: 'review_only' }),
      }),
      message
    );
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalled();
    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.observeSuspiciousMessage).not.toHaveBeenCalled();
  });

  it('routes staff watchlist matches to observed review without source-message deletion', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        is_active: true,
        settings: {
          detection_response_mode: 'restrict',
          min_confidence_threshold: 70,
        },
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      securityActionService,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers)) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.observeSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        label: 'SUSPICIOUS',
        confidence: 1,
        triggerSource: DetectionType.PATTERN_MATCH,
        reasons: expect.arrayContaining([
          'Poster has moderation or administration permissions; automatic deletion and restriction skipped.',
        ]),
        messageAction: expect.objectContaining({
          kind: 'review_only',
          source: 'watchlist',
          watchlistEntryId: GLOBAL_WATCHLIST_ENTRY.id,
          matchedTerm: GLOBAL_WATCHLIST_ENTRY.label,
        }),
      }),
      message
    );
  });

  it('routes staff watchlist matches to review even when moderator exemptions are disabled', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        is_active: true,
        settings: {
          automatic_detection_exempt_moderators: false,
          detection_response_mode: 'restrict',
          min_confidence_threshold: 70,
        },
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      securityActionService,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers)) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.observeSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        messageAction: expect.objectContaining({ kind: 'review_only' }),
      }),
      message
    );
  });

  it('records staff watchlist matches without opening review when setup is incomplete', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        is_active: false,
        settings: {
          detection_response_mode: 'restrict',
          min_confidence_threshold: 70,
        },
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      observeSuspiciousMessage: jest.fn().mockResolvedValue(true),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      detectionOrchestrator,
      configService,
      securityActionService,
      globalMessageWatchlistRepository: buildGlobalWatchlistRepository(),
    });
    const message = buildMessage(new PermissionsBitField(PermissionFlagsBits.KickMembers)) as any;
    message.content = GLOBAL_WATCHLIST_MESSAGE;

    await (handler as any).handleMessage(message);

    expect(securityActionService.recordSuspiciousMessage).toHaveBeenCalledWith(
      message.member,
      expect.objectContaining({
        messageAction: expect.objectContaining({ kind: 'review_only' }),
      }),
      message
    );
    expect(securityActionService.observeSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
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

  it('records pending screening members and skips join detection until screening clears', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const recordDiscordPendingMemberState = jest.fn().mockResolvedValue({
      wasPending: false,
      isPending: true,
      pendingChanged: true,
    });
    const securityActionService = {
      handleSuspiciousMessage: jest.fn(),
      handleSuspiciousJoin: jest.fn(),
      handleHoneypotRoleAssignment: jest.fn(),
      openCaseForSuspiciousMessage: jest.fn(),
      openCaseForSuspiciousJoin: jest.fn(),
      openAdminCase: jest.fn(),
      recordRejoinAfterKickDetection: jest.fn(),
      recordDiscordPendingMemberState,
      repairActiveCase: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator, securityActionService });
    const member = buildMember(new PermissionsBitField(), true);

    await (handler as any).handleGuildMemberAdd(member);

    expect(recordDiscordPendingMemberState).toHaveBeenCalledWith(member, true);
    expect(detectionOrchestrator.detectNewJoin).not.toHaveBeenCalled();
  });

  it('runs join detection and repairs active cases when pending screening clears', async () => {
    const client = { on: jest.fn(), user: { id: 'bot-1' } };
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
    const recordDiscordPendingMemberState = jest.fn().mockResolvedValue({
      wasPending: true,
      isPending: false,
      pendingChanged: true,
    });
    const repairActiveCase = jest.fn().mockResolvedValue({
      repaired: true,
      message: 'Repaired active verification case.',
      verificationEventId: 'ver-1',
      threadId: 'thread-1',
      threadCreated: false,
      userAdded: true,
      promptSent: false,
      promptAlreadyPresent: true,
    });
    const securityActionService = {
      handleSuspiciousMessage: jest.fn(),
      handleSuspiciousJoin: jest.fn(),
      handleHoneypotRoleAssignment: jest.fn(),
      openCaseForSuspiciousMessage: jest.fn(),
      openCaseForSuspiciousJoin: jest.fn(),
      openAdminCase: jest.fn(),
      recordRejoinAfterKickDetection: jest.fn(),
      recordDiscordPendingMemberState,
      repairActiveCase,
    };
    const handler = buildHandler({ client, detectionOrchestrator, securityActionService });
    await handler.setupEventHandlers();
    const updateHandler = client.on.mock.calls.find(
      ([event]) => event === Events.GuildMemberUpdate
    )?.[1];
    const oldMember = buildMember(new PermissionsBitField(), true);
    const newMember = buildMember(new PermissionsBitField(), false);

    await updateHandler?.(oldMember, newMember);

    expect(recordDiscordPendingMemberState).toHaveBeenCalledWith(newMember, false);
    expect(detectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      expect.objectContaining({ serverId: 'guild-1', userId: 'user-1' })
    );
    expect(repairActiveCase).toHaveBeenCalledWith(newMember);
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
      recordDiscordPendingMemberState: jest.fn().mockResolvedValue(null),
      repairActiveCase: jest.fn(),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue(null),
      setupVerificationChannel: jest.fn(),
    };
    const userModerationService = {
      findLatestKickOutcome: jest.fn().mockResolvedValue(priorKick),
    };
    const serverConfig = {
      case_role_id: 'case-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'verification-channel-1',
      settings: { detection_response_mode: 'notify_only' },
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue(serverConfig),
      getServerConfig: jest.fn().mockResolvedValue(serverConfig),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const handler = buildHandler({
      configService,
      detectionOrchestrator,
      securityActionService,
      notificationManager,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
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
        admin_channel_id: 'admin-channel-1',
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

    const originalPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasil.example';
    try {
      await (handler as any).handleGuildCreate(guild);
    } finally {
      if (originalPublicUrl === undefined) {
        delete process.env.DRASIL_WEB_PUBLIC_URL;
      } else {
        process.env.DRASIL_WEB_PUBLIC_URL = originalPublicUrl;
      }
    }

    expect(installer.send).toHaveBeenCalledWith(
      expect.objectContaining({ components: [expect.anything()], embeds: [expect.anything()] })
    );
    const setupDm = installer.send.mock.calls[0][0];
    expect(setupDm.components[0].toJSON().components[0].url).toBe(
      'https://drasil.example/admin/guild/guild-1/onboarding'
    );
    expect(setupDm.embeds[0].data.footer?.text).toBe(
      'Setup incomplete - 1 of 3 required steps complete'
    );
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-1',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
    });
    expect(guild.fetchOwner).not.toHaveBeenCalled();
  });

  it('waits for in-flight setup before guild-create auto setup reads configuration', async () => {
    const previousAutoSetup = globalConfig.getSettings().autoSetupVerificationChannels;
    globalConfig.updateSettings({ autoSetupVerificationChannels: true });
    const serverConfig = {
      guild_id: 'guild-1',
      case_role_id: 'case-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'verification-channel-1',
      settings: {},
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue(serverConfig),
      getServerConfig: jest.fn().mockResolvedValue(serverConfig),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn(),
      setupVerificationChannel: jest.fn().mockResolvedValue('verification-channel-1'),
    };
    const handler = buildHandler({ configService, notificationManager });
    const guild = { id: 'guild-1', name: 'Test Guild' } as any;
    let markLockAcquired!: () => void;
    let releaseLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const heldSetup = runSerializedGuildSetup('guild-1', async () => {
      markLockAcquired();
      await lockReleased;
    });

    try {
      await lockAcquired;
      const guildCreate = (handler as any).handleGuildCreate(guild);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(configService.getServerConfig).not.toHaveBeenCalled();
      expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();

      releaseLock();
      await heldSetup;
      await guildCreate;

      expect(configService.getServerConfig).toHaveBeenCalledTimes(2);
      expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
        guild,
        'case-role-1'
      );
    } finally {
      releaseLock();
      await heldSetup;
      globalConfig.updateSettings({ autoSetupVerificationChannels: previousAutoSetup });
    }
  });

  it('reactivates a configured server record when the bot rejoins', async () => {
    const previousAutoSetup = globalConfig.getSettings().autoSetupVerificationChannels;
    globalConfig.updateSettings({ autoSetupVerificationChannels: true });
    let serverConfig = {
      guild_id: 'guild-1',
      case_role_id: 'case-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'verification-channel-1',
      settings: {},
      is_active: false,
    };
    const configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn(() => serverConfig),
      getServerConfig: jest.fn(async () => serverConfig),
      updateServerConfig: jest.fn(async (_guildId: string, patch: { is_active?: boolean }) => {
        serverConfig = { ...serverConfig, ...patch };
        return serverConfig;
      }),
      updateServerSettings: jest.fn().mockResolvedValue({}),
    };
    const notificationManager = {
      upsertObservedDetectionNotification: jest.fn(),
      setupVerificationChannel: jest.fn().mockResolvedValue('verification-channel-1'),
    };
    const handler = buildHandler({ configService, notificationManager });
    const guild = { id: 'guild-1', name: 'Test Guild' } as any;

    try {
      await (handler as any).handleGuildCreate(guild);
    } finally {
      globalConfig.updateSettings({ autoSetupVerificationChannels: previousAutoSetup });
    }

    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(guild, 'case-role-1');
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      is_active: true,
    });
    expect(serverConfig.is_active).toBe(true);
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

    expect(ownerUser.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()] })
    );
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

    expect(installer.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()] })
    );
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

  it('downgrades restrictive automatic detection to record-only while setup is incomplete', async () => {
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: null,
        admin_channel_id: 'admin-1',
        verification_channel_id: 'verification-1',
        settings: { setup_nudge_last_attempt_at: new Date().toISOString() },
      }),
    };
    const setupDiagnosticsService = {
      validateGuildSetup: jest.fn().mockResolvedValue({
        guildId: 'guild-1',
        checkedAt: new Date(),
        issues: [{ severity: 'error', code: 'case-role-missing', message: 'Missing role.' }],
        errorCount: 1,
        warningCount: 0,
      }),
    };
    const securityActionService = {
      handleSuspiciousMessage: jest.fn(),
      handleSuspiciousJoin: jest.fn(),
      recordSuspiciousMessage: jest.fn().mockResolvedValue('detection-1'),
    };
    const handler = buildHandler({
      configService,
      setupDiagnosticsService,
      securityActionService,
    });
    const member = {
      guild: { id: 'guild-1' },
      user: { tag: 'test-user#0001' },
    } as any;
    const message = {} as any;

    await (handler as any).handleAutomaticDetection(
      member,
      {
        label: 'SUSPICIOUS',
        confidence: 1,
        reasons: ['test'],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'test',
      },
      { mode: 'restrict' },
      70,
      message
    );

    expect(securityActionService.recordSuspiciousMessage).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ label: 'SUSPICIOUS' }),
      message
    );
    expect(securityActionService.handleSuspiciousMessage).not.toHaveBeenCalled();
    expect(securityActionService.handleSuspiciousJoin).not.toHaveBeenCalled();
  });

  it('fails closed when automatic detection setup diagnostics are unavailable', async () => {
    const handler = buildHandler();

    await expect(
      (handler as any).evaluateAutomaticDetectionSetupSafety({ id: 'guild-1' })
    ).resolves.toEqual({ ready: false });
  });

  it('treats inactive server records as unsafe even when core setup IDs remain', async () => {
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        is_active: false,
        settings: {},
      }),
    };
    const handler = buildHandler({
      configService,
      setupDiagnosticsService: buildReadySetupDiagnosticsService(),
    });

    await expect(
      (handler as any).evaluateAutomaticDetectionSetupSafety({ id: 'guild-1' })
    ).resolves.toMatchObject({ ready: false });
  });

  it('reuses setup readiness briefly across a burst of automatic detections', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'case-role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        is_active: true,
        settings: {},
      }),
    };
    const setupDiagnosticsService = buildReadySetupDiagnosticsService();
    const handler = buildHandler({ configService, setupDiagnosticsService });
    const guild = { id: 'guild-1' } as any;

    await Promise.all([
      (handler as any).evaluateAutomaticDetectionSetupSafety(guild),
      (handler as any).evaluateAutomaticDetectionSetupSafety(guild),
    ]);
    await (handler as any).evaluateAutomaticDetectionSetupSafety(guild);

    expect(configService.getServerConfig).toHaveBeenCalledTimes(1);
    expect(setupDiagnosticsService.validateGuildSetup).toHaveBeenCalledTimes(1);

    now.mockReturnValue(31_001);
    await (handler as any).evaluateAutomaticDetectionSetupSafety(guild);

    expect(configService.getServerConfig).toHaveBeenCalledTimes(2);
    expect(setupDiagnosticsService.validateGuildSetup).toHaveBeenCalledTimes(2);
    now.mockRestore();
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

    expect(installer.send).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [expect.anything()] })
    );
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      setup_nudge_last_attempt_at: expect.any(String),
      setup_nudge_last_recipient_id: 'installer-2',
      setup_nudge_last_result: 'sent',
      setup_nudge_last_source: 'audit_log_installer',
    });
  });
});
