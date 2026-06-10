import { Guild, GuildMember, User } from 'discord.js';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import {
  AdminActionType,
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  VerificationStatus,
} from '../../repositories/types';
import {
  InMemoryAdminActionRepository,
  InMemoryDetectionEventsRepository,
  InMemoryModerationOutcomeRepository,
  InMemoryServerMemberRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';
import { INotificationManager } from '../../services/NotificationManager';
import { IRoleManager } from '../../services/RoleManager';
import { IThreadManager } from '../../services/ThreadManager';

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
    } as User,
    roles: {
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    ban: jest.fn().mockResolvedValue(undefined),
  }) as unknown as GuildMember;

const buildGuildWithBan = (guildId: string, userId: string, reason?: string): Guild =>
  ({
    id: guildId,
    bans: {
      fetch: jest.fn().mockResolvedValue({
        reason,
        user: { id: userId, tag: 'test-user#0001' },
      }),
    },
  }) as unknown as Guild;

const buildGuildWithMember = (guildId: string, member: GuildMember): Guild =>
  ({
    id: guildId,
    members: {
      fetch: jest.fn().mockResolvedValue(member),
    },
  }) as unknown as Guild;

describe('UserModerationService (unit)', () => {
  let serverMemberRepository: InMemoryServerMemberRepository;
  let verificationEventRepository: InMemoryVerificationEventRepository;
  let adminActionRepository: InMemoryAdminActionRepository;
  let moderationOutcomeRepository: InMemoryModerationOutcomeRepository;
  let userRepository: InMemoryUserRepository;
  let serverRepository: InMemoryServerRepository;
  let detectionEventsRepository: InMemoryDetectionEventsRepository;
  let adminActionService: AdminActionService;
  let moderationOutcomeService: ModerationOutcomeService;
  let roleManager: jest.Mocked<IRoleManager>;
  let notificationManager: jest.Mocked<INotificationManager>;
  let threadManager: jest.Mocked<IThreadManager>;

  beforeEach(() => {
    serverMemberRepository = new InMemoryServerMemberRepository();
    verificationEventRepository = new InMemoryVerificationEventRepository();
    adminActionRepository = new InMemoryAdminActionRepository();
    moderationOutcomeRepository = new InMemoryModerationOutcomeRepository();
    userRepository = new InMemoryUserRepository();
    serverRepository = new InMemoryServerRepository();
    detectionEventsRepository = new InMemoryDetectionEventsRepository();
    adminActionService = new AdminActionService(
      adminActionRepository,
      userRepository,
      serverRepository
    );
    moderationOutcomeService = new ModerationOutcomeService(
      moderationOutcomeRepository,
      serverRepository,
      userRepository
    );
    roleManager = {
      assignRestrictedRole: jest.fn().mockResolvedValue(true),
      removeRestrictedRole: jest.fn().mockResolvedValue(true),
    };
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue({} as any),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue({} as any),
      markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
      restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
    };
    threadManager = {
      createVerificationThread: jest.fn().mockResolvedValue({} as any),
      createReportReviewThread: jest.fn().mockResolvedValue({} as any),
      createPrivateEvidenceThread: jest.fn().mockResolvedValue({} as any),
      createReportIntakeThread: jest.fn().mockResolvedValue({} as any),
      activateReportIntakeThread: jest.fn().mockResolvedValue(true),
      resolveVerificationThread: jest.fn().mockResolvedValue(true),
      reopenVerificationThread: jest.fn().mockResolvedValue(true),
      repairVerificationThread: jest.fn().mockResolvedValue({
        threadId: 'thread-1',
        threadCreated: false,
        userAdded: true,
        promptSent: true,
        promptAlreadyPresent: false,
      }),
    };
  });

  it('verifies a user and records admin action', async () => {
    const guildId = 'guild-verify';
    const userId = 'user-verify';
    const moderator = { id: 'mod-verify' } as User;
    const member = buildMember(guildId, userId);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });

    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await service.verifyUser(member, moderator);

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.VERIFIED);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();

    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.VERIFIED);
    expect(serverMember?.is_restricted).toBe(false);

    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].action_type).toBe(AdminActionType.VERIFY);

    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.VERIFIED,
        source: ModerationOutcomeSource.DRASIL,
        actor_id: moderator.id,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );

    expect(roleManager.removeRestrictedRole).toHaveBeenCalled();
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.VERIFIED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalled();
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
  });

  it('closes a pending case with no action and removes existing restriction', async () => {
    const guildId = 'guild-close';
    const userId = 'user-close';
    const moderator = { id: 'mod-close' } as User;
    const member = buildMember(guildId, userId);
    const guild = buildGuildWithMember(guildId, member);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      notification_message_id: 'admin-message-1',
    });
    const updateVerificationEvent = jest.spyOn(verificationEventRepository, 'update');
    const upsertServerMember = jest.spyOn(serverMemberRepository, 'upsertMember');

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    const closedCount = await service.closeCaseNoAction(
      guild,
      userId,
      moderator,
      'No further action needed.'
    );

    expect(closedCount).toBe(1);
    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.CLOSED_NO_ACTION);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();
    expect(updatedEvent?.notes).toBe('No further action needed.');

    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.CLOSED_NO_ACTION);
    expect(serverMember?.is_restricted).toBe(false);

    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0]).toEqual(
      expect.objectContaining({
        action_type: AdminActionType.CLOSE_NO_ACTION,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.CLOSED_NO_ACTION,
      })
    );

    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.CLOSED_NO_ACTION,
        source: ModerationOutcomeSource.DRASIL,
        actor_id: moderator.id,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );

    expect(roleManager.removeRestrictedRole).toHaveBeenCalledWith(member);
    expect(updateVerificationEvent.mock.invocationCallOrder[0]).toBeLessThan(
      roleManager.removeRestrictedRole.mock.invocationCallOrder[0]
    );
    expect(upsertServerMember.mock.invocationCallOrder[0]).toBeLessThan(
      roleManager.removeRestrictedRole.mock.invocationCallOrder[0]
    );
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.CLOSED_NO_ACTION,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      AdminActionType.CLOSE_NO_ACTION,
      moderator
    );
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
  });

  it('bans a user and records admin action', async () => {
    const guildId = 'guild-ban';
    const userId = 'user-ban';
    const moderator = { id: 'mod-ban' } as User;
    const member = buildMember(guildId, userId);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });

    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await service.banUser(member, 'banned in test', moderator);

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.BANNED);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();

    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.BANNED);
    expect(serverMember?.is_restricted).toBe(true);

    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].action_type).toBe(AdminActionType.BAN);
    expect(adminActions[0].notes).toBe('banned in test');

    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.BANNED,
        source: ModerationOutcomeSource.DRASIL,
        actor_id: moderator.id,
        reason: 'banned in test',
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );

    expect((member.ban as jest.Mock).mock.calls).toHaveLength(1);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.BANNED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalled();
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
  });

  it('bans all duplicate pending cases for a user', async () => {
    const guildId = 'guild-ban-duplicates';
    const userId = 'user-ban-duplicates';
    const moderator = { id: 'mod-ban' } as User;
    const member = buildMember(guildId, userId);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const firstDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const secondDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.GPT_ANALYSIS,
      confidence: 0.9,
      reasons: ['Manual follow-up'],
      detected_at: new Date(),
    });
    const firstCase = await verificationEventRepository.createFromDetection(
      firstDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const secondCase = await verificationEventRepository.createFromDetection(
      secondDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await service.banUser(member, 'banned duplicate cases', moderator);

    await expect(verificationEventRepository.findById(firstCase.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.BANNED, resolved_by: moderator.id })
    );
    await expect(verificationEventRepository.findById(secondCase.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.BANNED, resolved_by: moderator.id })
    );
    const pendingCases = (
      await verificationEventRepository.findByUserAndServer(userId, guildId)
    ).filter((event) => event.status === VerificationStatus.PENDING);
    expect(pendingCases).toHaveLength(0);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledTimes(2);
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(2);
    expect(adminActions.map((action) => action.verification_event_id).sort()).toEqual(
      [firstCase.id, secondCase.id].sort()
    );
  });

  it('syncs all duplicate pending cases for a user Discord already banned', async () => {
    const guildId = 'guild-sync-ban-duplicates';
    const userId = 'user-sync-ban-duplicates';
    const moderator = { id: 'mod-ban' } as User;
    const guild = buildGuildWithBan(guildId, userId, 'existing Discord ban');

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const firstDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const secondDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.GPT_ANALYSIS,
      confidence: 0.9,
      reasons: ['Manual follow-up'],
      detected_at: new Date(),
    });
    const firstCase = await verificationEventRepository.createFromDetection(
      firstDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const secondCase = await verificationEventRepository.createFromDetection(
      secondDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await expect(service.syncAlreadyBannedUser(guild, userId, moderator)).resolves.toBe(2);

    await expect(verificationEventRepository.findById(firstCase.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.BANNED, resolved_by: moderator.id })
    );
    await expect(verificationEventRepository.findById(secondCase.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.BANNED, resolved_by: moderator.id })
    );
    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.BANNED);
    expect(serverMember?.is_restricted).toBe(true);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledTimes(2);
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(2);
    expect(adminActions.map((action) => action.notes)).toEqual([
      'Synced existing Discord ban: existing Discord ban',
      'Synced existing Discord ban: existing Discord ban',
    ]);
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(2);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome_type: ModerationOutcomeType.BANNED,
          source: ModerationOutcomeSource.MIGRATION_OR_SYNC,
          actor_id: moderator.id,
        }),
      ])
    );
  });

  it('resolves pending cases when a native Discord ban is observed', async () => {
    const guildId = 'guild-observed-ban';
    const userId = 'user-observed-ban';
    const nativeModeratorId = 'native-mod';
    const user = { id: userId, username: 'test-user', tag: 'test-user#0001' } as User;
    const guild = { id: guildId } as Guild;

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await expect(
      service.recordObservedDiscordBan(guild, user, {
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actorId: nativeModeratorId,
        reason: 'native moderation ban',
        auditLogEntryId: 'audit-1',
      })
    ).resolves.toBe(1);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        resolved_by: nativeModeratorId,
        notes: 'Observed Discord ban: native moderation ban',
      })
    );
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(0);
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.BANNED,
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actor_id: nativeModeratorId,
        reason: 'native moderation ban',
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.BANNED,
      nativeModeratorId
    );
  });

  it('ignores observed Drasil bans because the direct ban flow records them', async () => {
    const guildId = 'guild-observed-drasil-ban';
    const userId = 'user-observed-drasil-ban';
    const user = { id: userId, username: 'test-user', tag: 'test-user#0001' } as User;
    const guild = { id: guildId } as Guild;

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await expect(
      service.recordObservedDiscordBan(guild, user, {
        source: ModerationOutcomeSource.DRASIL,
        actorId: 'bot-1',
        reason: 'Drasil-issued ban echo',
        auditLogEntryId: 'audit-1',
      })
    ).resolves.toBe(0);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.PENDING })
    );
    await expect(moderationOutcomeRepository.findByUserAndServer(userId, guildId)).resolves.toEqual(
      []
    );
  });

  it('marks pending cases when a member leaves without closing them', async () => {
    const guildId = 'guild-member-left';
    const userId = 'user-member-left';
    const member = buildMember(guildId, userId);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await expect(service.recordMemberLeftGuild(member)).resolves.toBe(1);

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.PENDING);
    expect(updatedEvent?.metadata).toEqual(
      expect.objectContaining({
        membership_state: 'left_or_removed',
        source_detail: 'guildMemberRemove',
      })
    );
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.MEMBER_LEFT,
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
  });

  it('returns success when post-ban notification updates fail', async () => {
    const guildId = 'guild-ban-post-update-fails';
    const userId = 'user-ban-post-update-fails';
    const moderator = { id: 'mod-ban' } as User;
    const member = buildMember(guildId, userId);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });

    await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    notificationManager.logActionToMessage.mockResolvedValueOnce(false);

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService
    );

    await expect(service.banUser(member, 'banned in test', moderator)).resolves.toBe(true);

    expect(member.ban).toHaveBeenCalledWith({ reason: 'banned in test' });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Ban succeeded for test-user#0001, but post-ban updates failed:'),
      expect.any(Error)
    );
    consoleError.mockRestore();
  });
});
