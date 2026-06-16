import {
  ButtonInteraction,
  ChannelType,
  Client,
  Guild,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  User,
} from 'discord.js';
import { InteractionHandler } from '../../controllers/InteractionHandler';
import { INotificationManager } from '../../services/NotificationManager';
import { IUserModerationService } from '../../services/UserModerationService';
import { ISecurityActionService } from '../../services/SecurityActionService';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { IThreadManager } from '../../services/ThreadManager';
import { IAdminActionRepository } from '../../repositories/AdminActionRepository';
import { AdminActionType, VerificationEvent, VerificationStatus } from '../../repositories/types';
import { IConfigService } from '../../config/ConfigService';
import {
  SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_MODAL_ID,
  SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID,
} from '../../constants/setupVerificationWizard';
import {
  MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY,
  MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY,
  OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY,
} from '../../utils/detectionResponseSettings';
import {
  buildCaseReviewDigestSelectCustomId,
  CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID,
} from '../../utils/caseReviewDigestCustomIds';

const buildMember = (guildId: string, userId: string, displayName = 'test-user'): GuildMember =>
  ({
    id: userId,
    guild: { id: guildId } as Guild,
    displayName,
    nickname: displayName,
    user: {
      id: userId,
      username: displayName,
      tag: `${displayName}#0001`,
    } as User,
    permissions: { has: jest.fn().mockReturnValue(false) },
  }) as unknown as GuildMember;

const buildGuildMemberFetchMock = (): jest.Mock =>
  jest.fn(async (query: string | { user?: string | string[] }) => {
    if (typeof query === 'string') {
      return buildMember('guild-1', query);
    }

    const userIds = Array.isArray(query.user) ? query.user : query.user ? [query.user] : [];
    return new Map(userIds.map((userId) => [userId, buildMember('guild-1', userId)]));
  });

const buildInteraction = (customId: string, guildId: string, user: User): ButtonInteraction => {
  const interaction = {
    customId,
    guildId,
    channel: { id: 'channel-1', type: ChannelType.GuildText },
    user,
    deferred: false,
    replied: false,
    deferUpdate: jest.fn().mockImplementation(async () => {
      interaction.deferred = true;
    }),
    deferReply: jest.fn().mockImplementation(async () => {
      interaction.deferred = true;
    }),
    editReply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    update: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    showModal: jest.fn().mockResolvedValue(undefined),
  };
  return interaction as unknown as ButtonInteraction;
};

const buildSelectInteraction = (
  customId: string,
  values: string[],
  guildId: string,
  user: User
): StringSelectMenuInteraction => {
  const interaction = {
    customId,
    values,
    guildId,
    user,
    deferred: false,
    replied: false,
    editReply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
    update: jest.fn().mockImplementation(async () => {
      interaction.replied = true;
    }),
  };
  return interaction as unknown as StringSelectMenuInteraction;
};

const grantInteractionPermissions = (
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
): void => {
  Object.assign(interaction, {
    memberPermissions: { has: jest.fn().mockReturnValue(true) },
  });
};

const grantOnlyModerationPermission = (
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
): void => {
  Object.assign(interaction, {
    memberPermissions: {
      has: jest.fn(
        (permission: bigint) =>
          permission === PermissionFlagsBits.ManageGuild ||
          permission === PermissionFlagsBits.ModerateMembers
      ),
    },
  });
};

const grantOnlyBanMembersPermission = (
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
): void => {
  Object.assign(interaction, {
    memberPermissions: {
      has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.BanMembers),
    },
  });
};

const grantOnlyKickMembersPermission = (
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
): void => {
  Object.assign(interaction, {
    memberPermissions: {
      has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.KickMembers),
    },
  });
};

const buildNoIssueSetupDiagnosticsService = (): any => ({
  validateGuildSetup: jest.fn(),
  validateSetupCandidate: jest.fn().mockResolvedValue({
    guildId: 'guild-1',
    checkedAt: new Date('2026-01-01T00:00:00.000Z'),
    issues: [],
    errorCount: 0,
    warningCount: 0,
  }),
});

const buildVerificationEvent = (
  id: string,
  userId: string,
  updatedAt = new Date('2026-06-01T00:00:00.000Z')
): VerificationEvent => ({
  id,
  server_id: 'guild-1',
  user_id: userId,
  detection_event_id: null,
  thread_id: `thread-${id}`,
  private_evidence_thread_id: null,
  notification_channel_id: null,
  notification_message_id: `message-${id}`,
  status: VerificationStatus.PENDING,
  created_at: updatedAt,
  updated_at: updatedAt,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata: null,
});

describe('InteractionHandler (unit)', () => {
  const originalDrasilWebPublicUrl = process.env.DRASIL_WEB_PUBLIC_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  let client: Client;
  let userModerationService: jest.Mocked<IUserModerationService>;
  let securityActionService: jest.Mocked<ISecurityActionService>;
  let notificationManager: jest.Mocked<INotificationManager>;
  let configService: jest.Mocked<IConfigService>;
  let verificationEventRepository: jest.Mocked<IVerificationEventRepository>;
  let threadManager: jest.Mocked<IThreadManager>;
  let adminActionRepository: jest.Mocked<IAdminActionRepository>;

  beforeEach(() => {
    delete process.env.DRASIL_WEB_PUBLIC_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            me: { permissions: { has: jest.fn().mockReturnValue(true) } },
            fetch: buildGuildMemberFetchMock(),
          },
        }),
      },
    } as unknown as Client;

    userModerationService = {
      restrictUser: jest.fn().mockResolvedValue(true),
      liftRestriction: jest.fn().mockResolvedValue(true),
      verifyUser: jest.fn().mockResolvedValue(true),
      kickUser: jest.fn().mockResolvedValue(true),
      banUser: jest.fn().mockResolvedValue(true),
      banUserById: jest.fn().mockResolvedValue(true),
      syncAlreadyBannedUser: jest.fn().mockResolvedValue(1),
      closeCaseNoAction: jest.fn().mockResolvedValue(1),
      recordObservedDiscordBan: jest.fn().mockResolvedValue(0),
      recordObservedDiscordKick: jest.fn().mockResolvedValue(0),
      findLatestKickOutcome: jest.fn().mockResolvedValue(null),
      recordMemberLeftGuild: jest.fn().mockResolvedValue(0),
    };
    securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      handleSuspiciousJoin: jest.fn().mockResolvedValue(true),
      openCaseForSuspiciousMessage: jest.fn().mockResolvedValue(true),
      openCaseForSuspiciousJoin: jest.fn().mockResolvedValue(true),
      handleManualFlag: jest.fn().mockResolvedValue(true),
      openAdminCase: jest.fn().mockResolvedValue({
        opened: true,
        restrictionAttempted: false,
        restricted: false,
      }),
      refreshCaseNotification: jest.fn().mockResolvedValue({
        refreshed: true,
        message: 'Refreshed pending case notification for test-user#0001.',
      }),
      repairActiveCase: jest.fn().mockResolvedValue({
        repaired: true,
        message: 'Repaired active verification case for test-user#0001.',
        threadId: 'thread-1',
        threadCreated: false,
        userAdded: true,
        promptSent: true,
        promptAlreadyPresent: false,
      }),
      restrictActiveCase: jest.fn().mockResolvedValue(true),
      intakeRoleMembers: jest.fn().mockResolvedValue({} as any),
      handleUserReport: jest.fn().mockResolvedValue(true),
      handleConfirmedReportIntake: jest.fn().mockResolvedValue(true),
      handleMessageReport: jest.fn().mockResolvedValue(true),
      openObservedDetectionCase: jest.fn().mockResolvedValue(true),
      restrictObservedDetection: jest.fn().mockResolvedValue(true),
      banObservedDetection: jest.fn().mockResolvedValue(true),
      kickObservedDetection: jest.fn().mockResolvedValue(true),
      banObservedDetectionById: jest.fn().mockResolvedValue(true),
      dismissObservedDetection: jest.fn().mockResolvedValue(true),
      undoObservedDetectionAction: jest.fn().mockResolvedValue(AdminActionType.DISMISS),
      excludeDetectionFromAccounting: jest.fn().mockResolvedValue({} as any),
      restoreDetectionAccounting: jest.fn().mockResolvedValue({} as any),
      recordRejoinAfterKickDetection: jest.fn().mockResolvedValue({} as any),
      reopenVerification: jest.fn().mockResolvedValue(true),
    };
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue(null),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(false),
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue(null),
      markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
      restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
    };
    configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn(),
      getServerConfig: jest.fn().mockResolvedValue({ settings: {} }),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      getServerSettings: jest.fn(),
      updateServerSettings: jest.fn(),
      getHeuristicSettings: jest.fn(),
      updateHeuristicSettings: jest.fn(),
      resetHeuristicSettings: jest.fn(),
      getAdminChannel: jest.fn(),
      getVerificationChannel: jest.fn(),
      getRestrictedRole: jest.fn(),
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<IConfigService>;
    verificationEventRepository = {
      findActiveByUserAndServer: jest.fn(),
      findByUserAndServer: jest.fn(),
      findByDetectionEvent: jest.fn(),
      findPendingByServer: jest.fn(),
      createFromDetection: jest.fn(),
      getVerificationHistory: jest.fn(),
      findById: jest.fn(),
      findByThreadId: jest.fn(),
      update: jest.fn(),
    };
    threadManager = {
      createVerificationThread: jest
        .fn()
        .mockResolvedValue({ url: 'https://discord.com/channels/thread-1' } as any),
      createReportReviewThread: jest
        .fn()
        .mockResolvedValue({ url: 'https://discord.com/channels/thread-1' } as any),
      createPrivateEvidenceThread: jest
        .fn()
        .mockResolvedValue({ url: 'https://discord.com/channels/evidence-1' } as any),
      createObservedEvidenceThread: jest.fn().mockResolvedValue({
        id: 'observed-evidence-1',
        url: 'https://discord.com/channels/observed-evidence-1',
      } as any),
      createReportIntakeThread: jest.fn().mockResolvedValue({
        id: 'report-thread-1',
        url: 'https://discord.com/channels/report-thread-1',
      } as any),
      activateReportIntakeThread: jest.fn().mockResolvedValue(true),
      resolveVerificationThread: jest.fn(),
      reopenVerificationThread: jest.fn(),
      repairVerificationThread: jest.fn().mockResolvedValue({
        threadId: 'thread-1',
        threadCreated: false,
        userAdded: true,
        promptSent: true,
        promptAlreadyPresent: false,
      }),
    };
    adminActionRepository = {
      findByUserAndServer: jest.fn(),
      findByAdmin: jest.fn(),
      findByVerificationEvent: jest.fn(),
      createAction: jest.fn(),
      getActionHistory: jest.fn(),
    };
  });

  afterEach(() => {
    if (originalDrasilWebPublicUrl === undefined) {
      delete process.env.DRASIL_WEB_PUBLIC_URL;
    } else {
      process.env.DRASIL_WEB_PUBLIC_URL = originalDrasilWebPublicUrl;
    }

    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
  });

  const enableModeratorBanActions = (): void => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true },
    });
  };

  const enableCaseKickActions = (): void => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: { [MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY]: true },
    });
  };

  const enableObservedKickActions = (): void => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: { [OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY]: true },
    });
  };

  it('handles verify button by calling UserModerationService', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:confirm_verify:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.verifyUser).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'User <@user-1> has been verified and can now access the server.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles restrict-user case action without resolving the case', async () => {
    const activeCase = buildVerificationEvent('ver-restrict', 'user-1');
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(activeCase);
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_restrict_user:case:user-1',
      'guild-1',
      { id: 'admin-1' } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.restrictActiveCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      interaction.user
    );
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      activeCase,
      VerificationStatus.PENDING
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Restricted <@user-1> while keeping the case open.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it.each([
    ['restrict_user-1', 'Restrict <@user-1> while keeping their case pending?'],
    [
      'close_user-1',
      'Close pending verification cases for <@user-1> without verifying or banning them? If Drasil has them marked restricted, the restricted role will be removed.',
    ],
  ])('opens an ephemeral confirmation for persistent %s button', async (customId, message) => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(customId, 'guild-1', { id: 'admin-1' } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: message, flags: MessageFlags.Ephemeral })
    );
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('handles lift-restriction case action without resolving the case', async () => {
    const activeCase = buildVerificationEvent('ver-lift', 'user-1');
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(activeCase);
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_lift_restriction:case:user-1',
      'guild-1',
      { id: 'admin-1' } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.liftRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      interaction.user
    );
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      activeCase,
      VerificationStatus.PENDING
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Lifted restrictions for <@user-1> while keeping the case open.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles close-no-action button by calling UserModerationService', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_close_no_action:case:user-1',
      'guild-1',
      { id: 'admin-1' } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.closeCaseNoAction).toHaveBeenCalledWith(
      expect.objectContaining({ members: expect.any(Object) }),
      'user-1',
      interaction.user,
      'Closed with no action by moderator.'
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Closed 1 pending verification case for <@user-1> with no action.',
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  });

  it('opens a paginated pending-case selector from the digest button', async () => {
    const pendingCases = Array.from({ length: 26 }, (_, index) =>
      buildVerificationEvent(`ver-${index + 1}`, `user-${index + 1}`)
    );
    verificationEventRepository.findPendingByServer.mockResolvedValue(pendingCases);
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID, 'guild-1', {
      id: 'admin-1',
    } as User);
    grantOnlyModerationPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Open cases for this server (26 total). Page 1/2.'),
        flags: MessageFlags.Ephemeral,
      })
    );
    const response = (interaction.reply as jest.Mock).mock.calls[0][0] as any;
    const selectMenu = response.components[0].toJSON().components[0];
    expect(selectMenu.options).toHaveLength(25);
    expect(selectMenu.options[0].label).toBe('Case for test-user (user-1)');
    expect(selectMenu.options[0].value).toBe('ver-1');
    const buttons = response.components[1].toJSON().components;
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(false);
  });

  it('truncates case digest select text to the provided limit', () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    expect((handler as any).truncateSelectText('a'.repeat(101), 100)).toHaveLength(100);
  });

  it('opens existing admin actions after a digest case is selected', async () => {
    process.env.DRASIL_WEB_PUBLIC_URL = 'https://drasilbot.com';
    const selectedCase: VerificationEvent = {
      ...buildVerificationEvent('ver-selected', 'user-selected'),
      private_evidence_thread_id: 'evidence-thread-1',
      metadata: {
        source_channel_id: 'source-channel-1',
        source_message_id: 'source-message-1',
      },
    };
    verificationEventRepository.findById.mockResolvedValue(selectedCase);
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(selectedCase);
    verificationEventRepository.findByUserAndServer.mockResolvedValue([selectedCase]);
    (configService.getCachedServerConfig as jest.Mock).mockReturnValue({
      admin_channel_id: 'admin-channel-1',
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildSelectInteraction(
      buildCaseReviewDigestSelectCustomId(0),
      ['ver-selected'],
      'guild-1',
      { id: 'admin-1' } as User
    );
    grantOnlyModerationPermission(interaction);

    await handler.handleStringSelectMenuInteraction(interaction);

    expect(verificationEventRepository.findById).toHaveBeenCalledWith('ver-selected');
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Admin actions for test-user (user-selected).'),
        flags: MessageFlags.Ephemeral,
      })
    );
    const response = (interaction.reply as jest.Mock).mock.calls[0][0] as any;
    expect(response.content).toContain(
      'Links: admin: https://discord.com/channels/guild-1/admin-channel-1/message-ver-selected | evidence: https://discord.com/channels/guild-1/evidence-thread-1 | case: https://discord.com/channels/guild-1/thread-ver-selected | source: https://discord.com/channels/guild-1/source-channel-1/source-message-1'
    );
    expect(response.content).not.toContain('Mutating actions require a confirmation step');
    const buttons = response.components.flatMap(
      (row: { toJSON(): { components: any[] } }) => row.toJSON().components
    );
    expect(buttons.map((button: { label?: string }) => button.label)).toContain('Web Case');
    expect(buttons.find((button: { label?: string }) => button.label === 'Web Case')).toMatchObject(
      {
        url: 'https://drasilbot.com/admin/guild/guild-1/cases/ver-selected',
      }
    );
  });

  it('shows case kick action to kick-only moderators when enabled', async () => {
    enableCaseKickActions();
    const activeCase = buildVerificationEvent('ver-1', 'user-1');
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(activeCase);
    verificationEventRepository.findByUserAndServer.mockResolvedValue([activeCase]);
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:m:c:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantOnlyKickMembersPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    const response = (interaction.reply as jest.Mock).mock.calls[0][0] as any;
    const buttons = response.components.flatMap(
      (row: { toJSON(): { components: any[] } }) => row.toJSON().components
    );
    expect(buttons.map((button: { label?: string }) => button.label)).toEqual(['Kick User']);
  });

  it('shows observed admin actions with a resolved display label and no confirmation copy', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:m:o:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantOnlyModerationPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    const response = (interaction.reply as jest.Mock).mock.calls[0][0] as any;
    expect(response.content).toContain('Admin actions for observed alert on test-user (user-1).');
    expect(response.content).not.toContain('Mutating actions require a confirmation step');
  });

  it('rejects digest-selected cases without a user id', async () => {
    const selectedCase = {
      ...buildVerificationEvent('ver-selected', 'user-selected'),
      user_id: null,
    } as unknown as VerificationEvent;
    verificationEventRepository.findById.mockResolvedValue(selectedCase);
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildSelectInteraction(
      buildCaseReviewDigestSelectCustomId(0),
      ['ver-selected'],
      'guild-1',
      { id: 'admin-1' } as User
    );
    grantOnlyModerationPermission(interaction);

    await handler.handleStringSelectMenuInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'That case is no longer pending.',
      flags: MessageFlags.Ephemeral,
    });
    expect(verificationEventRepository.findActiveByUserAndServer).not.toHaveBeenCalled();
  });

  it('shows a confirmation modal for the ban button', async () => {
    enableModeratorBanActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('ban_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls[0][0] as any;
    expect(modal.toJSON().custom_id).toBe('verification:ban_modal:user-1');
    expect(JSON.stringify(modal.toJSON())).toContain('Final notes (optional)');
  });

  it('shows sync existing ban to a Ban Members moderator when a pending case user is already banned', async () => {
    const verificationEvent: VerificationEvent = {
      id: 'ver-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_event_id: null,
      thread_id: null,
      private_evidence_thread_id: null,
      notification_channel_id: null,
      notification_message_id: 'message-1',
      status: VerificationStatus.PENDING,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      notes: null,
      metadata: null,
    };
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(verificationEvent);
    verificationEventRepository.findByUserAndServer.mockResolvedValue([verificationEvent]);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      bans: { fetch: jest.fn().mockResolvedValue({ user: { id: 'user-1' } }) },
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        fetch: jest.fn().mockResolvedValue(buildMember('guild-1', 'admin-1')),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      buildNoIssueSetupDiagnosticsService()
    );
    const interaction = buildInteraction('admin_actions:menu:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantOnlyBanMembersPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Discord already shows this user as banned'),
        components: expect.any(Array),
        flags: MessageFlags.Ephemeral,
      })
    );
    const reply = (interaction.reply as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(reply.components)).toContain('Sync Existing Ban');
    expect(JSON.stringify(reply.components)).not.toContain('Ban User');
  });

  it('syncs pending cases for an already-banned user after confirmation', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      buildNoIssueSetupDiagnosticsService()
    );
    const interaction = buildInteraction('admin_actions:confirm_sync_ban:case:user-1', 'guild-1', {
      id: 'ban-mod-1',
    } as User);
    grantOnlyBanMembersPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.syncAlreadyBannedUser).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      interaction.user
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        'Synced 1 pending verification case for <@user-1> to banned because Discord already has an existing ban.',
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  });

  it('shows ban-by-id and close actions for a departed pending case', async () => {
    const verificationEvent = {
      ...buildVerificationEvent('ver-left', 'user-1'),
      metadata: { membership_state: 'left_or_removed' },
    };
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(verificationEvent);
    verificationEventRepository.findByUserAndServer.mockResolvedValue([verificationEvent]);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      bans: { fetch: jest.fn().mockRejectedValue({ code: 10026 }) },
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        fetch: jest.fn().mockResolvedValue(buildMember('guild-1', 'admin-1')),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      buildNoIssueSetupDiagnosticsService()
    );
    const interaction = buildInteraction('admin_actions:menu:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    const reply = (interaction.reply as jest.Mock).mock.calls[0][0];
    const renderedComponents = JSON.stringify(reply.components);
    expect(reply.content).toContain('Membership: left or removed');
    expect(renderedComponents).toContain('Ban by ID');
    expect(renderedComponents).toContain('Close No Action');
    expect(renderedComponents).not.toContain('Verify User');
    expect(renderedComponents).not.toContain('Restrict User');
  });

  it('handles thread button and creates a verification thread', async () => {
    const verificationEvent: VerificationEvent = {
      id: 'ver-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_event_id: null,
      thread_id: null,
      private_evidence_thread_id: null,
      notification_channel_id: null,
      notification_message_id: 'message-1',
      status: VerificationStatus.PENDING,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      notes: null,
      metadata: null,
    };
    verificationEventRepository.findActiveByUserAndServer.mockResolvedValue(verificationEvent);

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:confirm_thread:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Created verification thread: https://discord.com/channels/thread-1',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles reopen button by calling SecurityActionService', async () => {
    const verificationEvent: VerificationEvent = {
      id: 'ver-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_event_id: null,
      thread_id: null,
      private_evidence_thread_id: null,
      notification_channel_id: null,
      notification_message_id: 'message-1',
      status: VerificationStatus.VERIFIED,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: new Date(),
      resolved_by: 'admin-1',
      notes: null,
      metadata: null,
    };
    verificationEventRepository.findByUserAndServer.mockResolvedValue([verificationEvent]);

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:confirm_reopen:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.reopenVerification).toHaveBeenCalledWith(
      verificationEvent,
      interaction.user
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Verification for <@user-1> has been reopened. The user has been restricted again.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles history button for members with moderation permissions', async () => {
    verificationEventRepository.findByUserAndServer.mockResolvedValue([]);

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('history_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(verificationEventRepository.findByUserAndServer).toHaveBeenCalledWith(
      'user-1',
      'guild-1'
    );
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it.each([
    ['verify_user-1', 'You need moderation permissions to verify a user.'],
    ['ban_user-1', 'You need Ban Members permission to ban a user.'],
    ['thread_user-1', 'You need moderation permissions to create a verification thread.'],
    ['history_user-1', 'You need moderation permissions to view history.'],
    ['reopen_user-1', 'You need moderation permissions to reopen verification.'],
  ])(
    'denies legacy moderation button %s without moderator permissions',
    async (customId, message) => {
      (client.guilds.fetch as jest.Mock).mockResolvedValue({
        members: {
          fetch: jest.fn().mockResolvedValue({
            permissions: { has: jest.fn().mockReturnValue(false) },
          }),
        },
      });
      const handler = new InteractionHandler(
        client,
        notificationManager,
        userModerationService,
        securityActionService,
        configService,
        verificationEventRepository,
        threadManager,
        adminActionRepository
      );
      const interaction = buildInteraction(customId, 'guild-1', { id: 'viewer-1' } as User);
      Object.assign(interaction, {
        memberPermissions: { has: jest.fn().mockReturnValue(false) },
      });

      await handler.handleButtonInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(userModerationService.verifyUser).not.toHaveBeenCalled();
      expect(userModerationService.banUser).not.toHaveBeenCalled();
      expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
      expect(notificationManager.handleHistoryButtonClick).not.toHaveBeenCalled();
      expect(securityActionService.reopenVerification).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['verify_user-1', 'You need moderation permissions to verify a user.'],
    ['thread_user-1', 'You need moderation permissions to create a verification thread.'],
    ['history_user-1', 'You need moderation permissions to view history.'],
    ['reopen_user-1', 'You need moderation permissions to reopen verification.'],
  ])(
    'denies non-ban legacy button %s with only BanMembers permission',
    async (customId, message) => {
      (client.guilds.fetch as jest.Mock).mockResolvedValue({
        members: {
          fetch: jest.fn().mockResolvedValue({
            permissions: {
              has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.BanMembers),
            },
          }),
        },
      });
      const handler = new InteractionHandler(
        client,
        notificationManager,
        userModerationService,
        securityActionService,
        configService,
        verificationEventRepository,
        threadManager,
        adminActionRepository
      );
      const interaction = buildInteraction(customId, 'guild-1', { id: 'ban-mod-1' } as User);
      grantOnlyBanMembersPermission(interaction);

      await handler.handleButtonInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: message,
        flags: MessageFlags.Ephemeral,
      });
      expect(userModerationService.verifyUser).not.toHaveBeenCalled();
      expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
      expect(notificationManager.handleHistoryButtonClick).not.toHaveBeenCalled();
      expect(securityActionService.reopenVerification).not.toHaveBeenCalled();
    }
  );

  it('allows ban confirmation with only BanMembers permission', async () => {
    enableModeratorBanActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('ban_user-1', 'guild-1', {
      id: 'ban-mod-1',
    } as User);
    grantOnlyBanMembersPermission(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(userModerationService.banUser).not.toHaveBeenCalled();
  });

  it('submits verifier ban modal with final notes', async () => {
    enableModeratorBanActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = {
      customId: 'verification:ban_modal:user-1',
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn(() => 'admin final notes'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;
    grantOnlyBanMembersPermission(interaction);

    await handler.handleModalSubmit(interaction);

    expect(userModerationService.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'admin final notes',
      interaction.user
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'User <@user-1> has been banned from the server.',
    });
  });

  it('submits verifier ban modal by ID when the member left', async () => {
    enableModeratorBanActions();
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      id: 'guild-1',
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
        fetch: jest.fn().mockRejectedValue(new Error('Unknown Member')),
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = {
      customId: 'verification:ban_modal:user-left',
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn(() => 'ban after leave'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;
    grantOnlyBanMembersPermission(interaction);

    await handler.handleModalSubmit(interaction);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(userModerationService.banUserById).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'guild-1' }),
      'user-left',
      'ban after leave',
      interaction.user
    );
  });

  it('submits verifier ban modal with the default reason when notes are blank', async () => {
    enableModeratorBanActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = {
      customId: 'verification:ban_modal:user-1',
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn(() => '   '),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;
    grantOnlyBanMembersPermission(interaction);

    await handler.handleModalSubmit(interaction);

    expect(userModerationService.banUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'Banned by moderator during verification',
      interaction.user
    );
  });

  it('rejects verifier ban modal submission without BanMembers permission', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(false) },
        }),
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = {
      customId: 'verification:ban_modal:user-1',
      guildId: 'guild-1',
      user: { id: 'viewer-1' } as User,
      memberPermissions: { has: jest.fn().mockReturnValue(false) },
      fields: {
        getTextInputValue: jest.fn(),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(interaction.fields.getTextInputValue).not.toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need Ban Members permission to ban a user.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles observed open case button', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_open:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.openObservedDetectionCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'det-1',
      interaction.user
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Opened a verification case for <@user-1>.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles observed kick button for present members', async () => {
    enableObservedKickActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_kick:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.kickObservedDetection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'det-1',
      interaction.user,
      'Kicked from observed suspicious notification'
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Kicked <@user-1> from the observed alert.',
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  });

  it('reports observed kick failures after deferred confirmation', async () => {
    enableObservedKickActions();
    securityActionService.kickObservedDetection.mockRejectedValueOnce(
      new Error('Discord rejected')
    );
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_kick:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'An error occurred while kicking the user.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles case kick button when case kick policy is enabled', async () => {
    enableCaseKickActions();
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:confirm_kick:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.kickUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'Kicked by moderator during verification',
      interaction.user
    );
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Kicked <@user-1> and resolved pending verification cases as kicked.',
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  });

  it('blocks confirmed case kick when the case kick policy is disabled', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('admin_actions:confirm_kick:case:user-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Drasil case kick actions are disabled for this server or the bot lacks Kick Members permission.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('blocks confirmed observed kick when the observed kick policy is disabled', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_kick:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.kickObservedDetection).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Drasil observed alert kick actions are disabled for this server or the bot lacks Kick Members permission.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('shows observed ban modal using configured reason policy', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: {
        [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true,
        observed_action_ban_requires_reason: true,
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('observed:ban:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as jest.Mock).mock.calls[0][0] as any;
    expect(modal.toJSON().custom_id).toBe('observed:ban_modal:user-1:det-1');
    expect(JSON.stringify(modal.toJSON())).toContain('Ban reason');
  });

  it('handles observed false positive dismissal', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_false_positive:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.dismissObservedDetection).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      interaction.user,
      AdminActionType.FALSE_POSITIVE
    );
    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Marked the detection for <@user-1> as a false positive.',
      components: [],
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('acknowledges observed dismiss menu before fetching permissions', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('observed:dismiss_menu:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (client.guilds.fetch as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Dismiss only closes this alert. False Positive records that this specific detection was incorrect; future independent detections can still notify.',
      components: expect.any(Array),
    });
  });

  it('shows confirmation for observed popup action before fetching permissions', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:observed_false_positive:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );

    await handler.handleButtonInteraction(interaction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Mark this observed alert'),
        components: expect.any(Array),
      })
    );
    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(securityActionService.dismissObservedDetection).not.toHaveBeenCalled();
  });

  it('keeps confirmed observed action permission denial private', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(false) },
        }),
      },
    });
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_dismiss:observed:user-1:det-1',
      'guild-1',
      {
        id: 'viewer-1',
      } as User
    );

    await handler.handleButtonInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need moderation permissions to use this observed action.',
      flags: MessageFlags.Ephemeral,
    });
    expect(securityActionService.dismissObservedDetection).not.toHaveBeenCalled();
  });

  it('handles observed false positive undo', async () => {
    securityActionService.undoObservedDetectionAction.mockResolvedValueOnce(
      AdminActionType.FALSE_POSITIVE
    );
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction(
      'admin_actions:confirm_observed_undo_dismiss:observed:user-1:det-1',
      'guild-1',
      {
        id: 'admin-1',
      } as User
    );
    grantInteractionPermissions(interaction);

    await handler.handleButtonInteraction(interaction);

    expect(securityActionService.undoObservedDetectionAction).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      interaction.user
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Undid the dismissal and reverted the false-positive indication for <@user-1>.',
      components: [],
    });
  });

  it('handles setup verification modal and updates config', async () => {
    const channelFetch = jest.fn().mockImplementation(async (id: string) => {
      if (id === '123456789012345679' || id === '123456789012345680') {
        return { id, type: 0 };
      }
      return null;
    });

    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue({ id: '123456789012345678' }),
      },
      channels: {
        fetch: channelFetch,
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      buildNoIssueSetupDiagnosticsService()
    );

    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return '123456789012345678';
          }
          if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) {
            return '123456789012345679';
          }
          if (id === SETUP_VERIFICATION_CHANNEL_FIELD_ID) {
            return '123456789012345680';
          }
          return '';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      restricted_role_id: '123456789012345678',
      admin_channel_id: '123456789012345679',
      verification_channel_id: '123456789012345680',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nRestricted role: <@&123456789012345678>\nAdmin channel: <#123456789012345679>\nVerification channel: <#123456789012345680>',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
  });

  it('auto-creates verification channel when field is blank', async () => {
    (notificationManager.setupVerificationChannel as jest.Mock).mockImplementation(
      async (_guild, _roleId, _persist, onChannelCreated) => {
        onChannelCreated?.('123456789012345681');
        return '123456789012345681';
      }
    );

    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue({ id: '123456789012345678' }),
      },
      channels: {
        fetch: jest
          .fn()
          .mockResolvedValue({ id: '123456789012345679', type: ChannelType.GuildText }),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      buildNoIssueSetupDiagnosticsService()
    );

    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return '123456789012345678';
          }
          if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) {
            return '123456789012345679';
          }
          return '';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
      expect.anything(),
      '123456789012345678',
      false,
      expect.any(Function)
    );
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      restricted_role_id: '123456789012345678',
      admin_channel_id: '123456789012345679',
      verification_channel_id: '123456789012345681',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nRestricted role: <@&123456789012345678>\nAdmin channel: <#123456789012345679>\nCreated verification channel: <#123456789012345681>',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('rejects setup verification modal when diagnostics are unavailable', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return '123456789012345678';
          }
          if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) {
            return '123456789012345679';
          }
          return '';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Setup diagnostics are not available in this runtime.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rolls back an auto-created verification channel when final setup diagnostics fail', async () => {
    const createdChannel = {
      id: '123456789012345681',
      type: ChannelType.GuildText,
      delete: jest.fn().mockResolvedValue(undefined),
    };
    (notificationManager.setupVerificationChannel as jest.Mock).mockImplementation(
      async (_guild, _roleId, _persist, onChannelCreated) => {
        onChannelCreated?.('123456789012345681');
        return '123456789012345681';
      }
    );
    const setupDiagnosticsService = {
      validateSetupCandidate: jest
        .fn()
        .mockResolvedValueOnce({
          guildId: 'guild-1',
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
          issues: [],
          errorCount: 0,
          warningCount: 0,
        })
        .mockResolvedValueOnce({
          guildId: 'guild-1',
          checkedAt: new Date('2026-01-01T00:00:00.000Z'),
          issues: [
            {
              severity: 'error',
              code: 'verification-channel-send',
              message: 'Drasil is missing Send Messages in the verification channel.',
            },
          ],
          errorCount: 1,
          warningCount: 0,
        }),
    } as any;

    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue({ id: '123456789012345678' }),
      },
      channels: {
        fetch: jest.fn((id: string) => {
          if (id === '123456789012345679') {
            return Promise.resolve({ id, type: ChannelType.GuildText });
          }
          if (id === '123456789012345681') {
            return Promise.resolve(createdChannel);
          }
          return Promise.resolve(null);
        }),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository,
      setupDiagnosticsService
    );
    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return '123456789012345678';
          }
          if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) {
            return '123456789012345679';
          }
          return '';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(createdChannel.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after final validation failed'
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining(
        'Created verification channel <#123456789012345681> was removed.'
      ),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('rejects setup verification modal when role is invalid', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return 'not-a-role';
          }
          return '123456789012345678';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Please provide a valid restricted role ID or role mention (for example `<@&123...>`).',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects setup verification modal when submitter is not admin', async () => {
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(false),
          },
        }),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    const interaction = {
      customId: SETUP_VERIFICATION_MODAL_ID,
      guildId: 'guild-1',
      user: { id: 'admin-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID) {
            return '123456789012345678';
          }
          if (id === SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID) {
            return '123456789012345679';
          }
          return '';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need administrator permissions to complete setup.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
