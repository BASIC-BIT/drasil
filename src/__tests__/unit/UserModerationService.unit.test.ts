import { Guild, GuildMember, User } from 'discord.js';
import { UserModerationService } from '../../services/UserModerationService';
import { AdminActionService } from '../../services/AdminActionService';
import { ModerationOutcomeService } from '../../services/ModerationOutcomeService';
import {
  AdminActionType,
  CaptchaChallengeStatus,
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  VerificationEvent,
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
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import type { IRoleQuarantineService } from '../../services/RoleQuarantineService';
import type { ICaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import {
  CASE_ROLE_RELEASE_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_LEASE_MS,
  CASE_TERMINAL_ACTION_ATTEMPT_PREFIX,
} from '../../utils/caseRoleRelease';

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
      cache: new Map(),
      add: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
    kick: jest.fn().mockResolvedValue(undefined),
    ban: jest.fn().mockResolvedValue(undefined),
  }) as unknown as GuildMember;

const buildGuildWithBan = (guildId: string, userId: string, reason?: string): Guild =>
  ({
    id: guildId,
    bans: {
      create: jest.fn().mockResolvedValue({ id: userId }),
      fetch: jest.fn().mockResolvedValue({
        reason,
        user: { id: userId, username: 'test-user', tag: 'test-user#0001' },
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

const buildGuildWithoutMember = (guildId: string): Guild =>
  ({
    id: guildId,
    members: {
      fetch: jest.fn().mockRejectedValue(new Error('Unknown member')),
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
      assignCaseRole: jest.fn().mockResolvedValue(true),
      removeCaseRole: jest.fn().mockResolvedValue(true),
    };
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue({} as any),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(false),
      notifyVerificationThreadUserResponse: jest.fn().mockResolvedValue(true),
      notifyAccountQuarantineAttention: jest.fn().mockResolvedValue(true),
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue({} as any),
      markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
      restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
      updateCaptchaChallengePresentation: jest.fn().mockResolvedValue(true),
    };
    threadManager = {
      sendCaptchaChallenge: jest.fn().mockResolvedValue(true),
      sendCaptchaStatus: jest.fn().mockResolvedValue(true),
      createVerificationThread: jest.fn().mockResolvedValue({} as any),
      createReportReviewThread: jest.fn().mockResolvedValue({} as any),
      createPrivateEvidenceThread: jest.fn().mockResolvedValue({} as any),
      createObservedEvidenceThread: jest.fn().mockResolvedValue({} as any),
      createReportIntakeThread: jest.fn().mockResolvedValue({} as any),
      activateReportIntakeThread: jest.fn().mockResolvedValue(true),
      resolveVerificationThread: jest.fn().mockResolvedValue(true),
      closeResolvedVerificationThreads: jest
        .fn()
        .mockResolvedValue({ closedAny: false, results: [] }),
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
    expect(serverMember?.case_role_active).toBe(false);

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

    expect(roleManager.removeCaseRole).toHaveBeenCalled();
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.VERIFIED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalled();
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
  });

  it('shows a cancelled browser check when another moderation action resolves the case', async () => {
    const guildId = 'guild-captcha-cancel-presentation';
    const userId = 'user-captcha-cancel-presentation';
    const moderator = { id: 'mod-captcha-cancel-presentation' } as User;
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const cancelledChallenge = {
      id: 'challenge-cancelled',
      verification_event_id: verificationEvent.id,
      status: CaptchaChallengeStatus.CANCELLED,
    };
    const captchaChallenges = {
      cancelPendingForCase: jest.fn().mockResolvedValue(true),
      findByCaseId: jest.fn().mockResolvedValue(cancelledChallenge),
    } as unknown as jest.Mocked<ICaptchaChallengeRepository>;
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      undefined,
      undefined,
      captchaChallenges
    );

    await service.verifyUser(member, moderator);

    expect(captchaChallenges.cancelPendingForCase).toHaveBeenCalledWith(verificationEvent.id);
    expect(notificationManager.updateCaptchaChallengePresentation).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      cancelledChallenge
    );
  });

  it('resolves only the exact CAPTCHA-bound case with the system actor', async () => {
    const guildId = 'guild-captcha-resolve';
    const userId = 'user-captcha-resolve';
    const member = buildMember(guildId, userId);
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn().mockResolvedValue({
        status: 'restored',
        snapshotId: 'captcha-role-quarantine-1',
        attemptedRoleIds: ['role-1'],
        restoredRoleIds: ['role-1'],
        skippedRoles: [],
        failedRestores: [],
      }),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({
        status: 'no_active_snapshot',
        snapshotId: null,
      }),
    };
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
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
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-1',
        expectedCaseRevision: 0,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'resolved' });

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        notes: 'Security check completed.',
        resolved_by: 'drasil:captcha',
        status: VerificationStatus.VERIFIED,
      })
    );
    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(roleQuarantineService.restoreMemberRoles).toHaveBeenCalledWith(
      member,
      { id: 'drasil:captcha' },
      expect.objectContaining({ canRestoreRole: expect.any(Function) })
    );
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.VERIFIED,
      'Drasil browser check'
    );
    const actions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(actions).toEqual([
      expect.objectContaining({
        action_type: AdminActionType.VERIFY,
        admin_id: 'drasil:captcha',
        metadata: expect.objectContaining({
          role_quarantine: expect.objectContaining({ restored_role_count: 1 }),
        }),
        verification_event_id: verificationEvent.id,
      }),
    ]);
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes[0]?.metadata).toEqual(
      expect.objectContaining({
        role_quarantine: expect.objectContaining({ restored_role_count: 1 }),
      })
    );
  });

  it('treats a repeated exact-case CAPTCHA resolution as a side-effect-free success', async () => {
    const guildId = 'guild-captcha-idempotent';
    const userId = 'user-captcha-idempotent';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const input = {
      verificationEventId: verificationEvent.id,
      challengeId: 'challenge-idempotent',
      generation: 1,
      expectedCaseRevision: verificationEvent.case_revision,
    };
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

    await expect(service.resolveCaptchaCase(member, input)).resolves.toEqual({
      status: 'resolved',
    });
    const actionCount = (await adminActionRepository.findByUserAndServer(userId, guildId)).length;
    jest.clearAllMocks();
    const upsertMember = jest.spyOn(serverMemberRepository, 'upsertMember');

    await expect(service.resolveCaptchaCase(member, input)).resolves.toEqual({
      status: 'resolved',
    });

    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.logActionToMessage).not.toHaveBeenCalled();
    expect(upsertMember).toHaveBeenCalledWith(
      guildId,
      userId,
      expect.not.objectContaining({ last_status_change: expect.anything() })
    );
    upsertMember.mockRestore();
    await expect(adminActionRepository.findByUserAndServer(userId, guildId)).resolves.toHaveLength(
      actionCount
    );
  });

  it('resumes unfinished CAPTCHA resolution effects after the case commit', async () => {
    const guildId = 'guild-captcha-resume';
    const userId = 'user-captcha-resume';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const input = {
      verificationEventId: verificationEvent.id,
      challengeId: 'challenge-resume',
      generation: 1,
      expectedCaseRevision: verificationEvent.case_revision,
    };
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
    threadManager.resolveVerificationThread.mockRejectedValueOnce(new Error('Discord unavailable'));

    await expect(service.resolveCaptchaCase(member, input)).rejects.toThrow('Discord unavailable');
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        resolved_by: 'drasil:captcha',
        status: VerificationStatus.VERIFIED,
      })
    );
    await expect(adminActionRepository.findByUserAndServer(userId, guildId)).resolves.toHaveLength(
      0
    );

    await expect(service.resolveCaptchaCase(member, input)).resolves.toEqual({
      status: 'resolved',
    });

    expect(roleManager.removeCaseRole).toHaveBeenCalledTimes(1);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledTimes(2);
    await expect(adminActionRepository.findByUserAndServer(userId, guildId)).resolves.toHaveLength(
      1
    );
    await expect(
      moderationOutcomeRepository.findByVerificationEvent(verificationEvent.id)
    ).resolves.toHaveLength(1);
  });

  it('does not finalize a CAPTCHA resolution after the case is concurrently reopened', async () => {
    const guildId = 'guild-captcha-concurrent-reopen';
    const userId = 'user-captcha-concurrent-reopen';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const originalFindById = verificationEventRepository.findById.bind(verificationEventRepository);
    let readCount = 0;
    jest.spyOn(verificationEventRepository, 'findById').mockImplementation(async (id) => {
      const current = await originalFindById(id);
      readCount += 1;
      if (readCount === 2 && current?.status === VerificationStatus.VERIFIED) {
        return verificationEventRepository.reopen(id);
      }
      return current;
    });
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
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-concurrent-reopen',
        expectedCaseRevision: verificationEvent.case_revision,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'case_changed' });

    await expect(originalFindById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        case_revision: verificationEvent.case_revision + 1,
        status: VerificationStatus.PENDING,
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.logActionToMessage).not.toHaveBeenCalled();
    await expect(adminActionRepository.findByUserAndServer(userId, guildId)).resolves.toHaveLength(
      0
    );
    await expect(
      moderationOutcomeRepository.findByVerificationEvent(verificationEvent.id)
    ).resolves.toHaveLength(0);
  });

  it('blocks a reopen while CAPTCHA finalization owns the case lease', async () => {
    const guildId = 'guild-captcha-finalization-lease';
    const userId = 'user-captcha-finalization-lease';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    let reopenDuringFinalization: VerificationEvent | null | undefined;
    jest
      .spyOn(adminActionService, 'getActionsForVerificationEvent')
      .mockImplementation(async () => {
        reopenDuringFinalization = await verificationEventRepository.reopen(verificationEvent.id);
        return [];
      });
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
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-finalization-lease',
        expectedCaseRevision: verificationEvent.case_revision,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'resolved' });

    expect(reopenDuringFinalization).toBeNull();
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        quarantine_attempt_id: null,
        status: VerificationStatus.VERIFIED,
      })
    );
  });

  it('keeps the case role when another pending case exists', async () => {
    const guildId = 'guild-captcha-other-case';
    const userId = 'user-captcha-other-case';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.createFromDetection(
      null,
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
      threadManager
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-1',
        expectedCaseRevision: 0,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'other_pending_case' });

    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.PENDING })
    );
  });

  it('fences role restoration when another case opens during CAPTCHA resolution', async () => {
    const guildId = 'guild-captcha-restore-fence';
    const userId = 'user-captcha-restore-fence';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    let fenceAllowed = true;
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn().mockImplementation(async (_member, _moderator, fence) => {
        await verificationEventRepository.createFromDetection(
          null,
          guildId,
          userId,
          VerificationStatus.PENDING
        );
        fenceAllowed = (await fence?.canRestoreRole()) ?? true;
        return {
          status: 'held_pending_case',
          snapshotId: 'captcha-role-quarantine-fence',
          attemptedRoleIds: ['role-1'],
          restoredRoleIds: [],
          skippedRoles: [],
          failedRestores: [],
        };
      }),
      abandonActiveSnapshot: jest.fn(),
    };
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-restore-fence',
        expectedCaseRevision: verificationEvent.case_revision,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'other_pending_case' });

    expect(fenceAllowed).toBe(false);
    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
  });

  it('restores the case role when the expected-revision completion loses a race', async () => {
    const guildId = 'guild-captcha-race';
    const userId = 'user-captcha-race';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    jest.spyOn(verificationEventRepository, 'completeCaptchaVerification').mockResolvedValue(null);
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-1',
        expectedCaseRevision: 0,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'case_changed' });

    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
  });

  it('restores the case role when CAPTCHA completion throws before committing', async () => {
    const guildId = 'guild-captcha-commit-error';
    const userId = 'user-captcha-commit-error';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    jest
      .spyOn(verificationEventRepository, 'completeCaptchaVerification')
      .mockRejectedValue(new Error('Database unavailable'));
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-1',
        expectedCaseRevision: 0,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).rejects.toThrow('Database unavailable');

    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
  });

  it('does not restore the case role when another resolution wins the race', async () => {
    const guildId = 'guild-captcha-terminal-race';
    const userId = 'user-captcha-terminal-race';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    jest
      .spyOn(verificationEventRepository, 'completeCaptchaVerification')
      .mockImplementation(async () => {
        await verificationEventRepository.update(verificationEvent.id, {
          resolved_at: new Date(),
          resolved_by: 'moderator-1',
          status: VerificationStatus.VERIFIED,
        });
        return null;
      });
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-1',
        expectedCaseRevision: 0,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'case_changed' });

    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(roleManager.assignCaseRole).not.toHaveBeenCalled();
  });

  it('does not resolve a case while account containment is in progress', async () => {
    const guildId = 'guild-quarantine-in-progress';
    const userId = 'user-quarantine-in-progress';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      containment_status: CaseContainmentStatus.IN_PROGRESS,
    });
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

    const moderator = { id: 'moderator-1' } as User;
    await expect(service.verifyUser(member, moderator)).rejects.toThrow(
      'Account quarantine is currently in progress'
    );
    await expect(service.kickUser(member, 'Kick requested', moderator)).rejects.toThrow(
      'Account quarantine is currently in progress'
    );
    await expect(service.banUser(member, 'Ban requested', moderator)).rejects.toThrow(
      'Account quarantine is currently in progress'
    );
    await expect(
      service.closeCaseNoAction(buildGuildWithMember(guildId, member), userId, moderator)
    ).rejects.toThrow('Account quarantine is currently in progress');
    await expect(
      service.resolveCaptchaCase(member, {
        challengeId: 'challenge-containment-race',
        expectedCaseRevision: verificationEvent.case_revision,
        generation: 1,
        verificationEventId: verificationEvent.id,
      })
    ).resolves.toEqual({ status: 'held', reason: 'case_changed' });

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
      })
    );
    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    expect(member.kick).not.toHaveBeenCalled();
    expect(member.ban).not.toHaveBeenCalled();
  });

  it('keeps a parked quarantine pending when case-role removal fails during verification', async () => {
    const guildId = 'guild-verify-case-role-failure';
    const userId = 'user-verify-case-role-failure';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
    roleManager.removeCaseRole.mockResolvedValue(false);
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
      'Failed to remove case role'
    );

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        parked_by: 'moderator-parked',
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
  });

  it('claims a parked quarantine before removing the case role for verification', async () => {
    const guildId = 'guild-verify-release-claim';
    const userId = 'user-verify-release-claim';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
    roleManager.removeCaseRole.mockImplementation(async () => {
      const claimedEvent = await verificationEventRepository.findById(verificationEvent.id);
      expect(claimedEvent?.quarantine_attempt_id).toEqual(
        expect.stringMatching(`^${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}`)
      );
      return true;
    });
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).resolves.toBe(
      true
    );

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.VERIFIED,
        quarantine_attempt_id: null,
      })
    );
  });

  it('claims an incomplete quarantine before removing the case role for verification', async () => {
    const guildId = 'guild-verify-incomplete-release-claim';
    const userId = 'user-verify-incomplete-release-claim';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
    });
    roleManager.removeCaseRole.mockImplementation(async () => {
      const claimedEvent = await verificationEventRepository.findById(verificationEvent.id);
      expect(claimedEvent?.quarantine_attempt_id).toEqual(
        expect.stringMatching(`^${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}`)
      );
      return true;
    });
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).resolves.toBe(
      true
    );

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.VERIFIED,
        quarantine_attempt_id: null,
      })
    );
  });

  it('removes the persisted quarantine role after the configured role changes', async () => {
    const guildId = 'guild-verify-persisted-role';
    const userId = 'user-verify-persisted-role';
    const member = buildMember(guildId, userId);
    member.roles.cache.set('original-case-role', { id: 'original-case-role' } as any);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      quarantine_case_role_id: 'original-case-role',
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).resolves.toBe(
      true
    );

    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member, 'original-case-role');
    expect(roleManager.removeCaseRole).not.toHaveBeenCalledWith(member);
  });

  it('restores containment without partially resolving duplicate cases when persistence fails', async () => {
    const guildId = 'guild-verify-persistence-failure';
    const userId = 'user-verify-persistence-failure';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const duplicateEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const parkedAt = new Date('2026-08-18T09:00:00.000Z');
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: parkedAt,
      parked_by: 'moderator-parked',
    });
    jest.spyOn(verificationEventRepository, 'completeVerificationRelease').mockResolvedValue(null);
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
      'Failed to atomically update verification events'
    );

    expect(roleManager.assignCaseRole).toHaveBeenCalledWith(member);
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        quarantine_attempt_id: null,
        parked_at: parkedAt,
        parked_by: 'moderator-parked',
      })
    );
    await expect(verificationEventRepository.findById(duplicateEvent.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.PENDING })
    );
  });

  it('does not clear another moderator release claim', async () => {
    const guildId = 'guild-verify-concurrent-release';
    const userId = 'user-verify-concurrent-release';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
    await verificationEventRepository.claimCaseRoleRelease(
      verificationEvent.id,
      guildId,
      userId,
      `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}other-moderator`,
      new Date(Date.now() - CASE_ROLE_RELEASE_LEASE_MS)
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
      'Account quarantine is currently in progress'
    );

    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        quarantine_attempt_id: `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}other-moderator`,
      })
    );
  });

  it('blocks a kick while verification owns the release claim', async () => {
    const guildId = 'guild-verify-release-fence';
    const userId = 'user-verify-release-fence';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
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
    roleManager.removeCaseRole.mockImplementation(async () => {
      await expect(
        service.kickUser(member, 'concurrent kick', { id: 'moderator-kick' } as User)
      ).rejects.toThrow('Account quarantine is currently in progress');
      return true;
    });

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).resolves.toBe(
      true
    );

    expect(member.kick).not.toHaveBeenCalled();
  });

  it('claims terminal ownership before kicking a parked account', async () => {
    const guildId = 'guild-kick-terminal-claim';
    const userId = 'user-kick-terminal-claim';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
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
    (member.kick as jest.Mock).mockImplementation(async () => {
      const claimed = await verificationEventRepository.findById(verificationEvent.id);
      expect(claimed?.quarantine_attempt_id).toEqual(
        expect.stringMatching(`^${CASE_TERMINAL_ACTION_ATTEMPT_PREFIX}`)
      );
      await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
        'Account quarantine is currently in progress'
      );
    });

    await expect(
      service.kickUser(member, 'terminal kick', { id: 'moderator-kick' } as User)
    ).resolves.toBe(true);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.KICKED,
        quarantine_attempt_id: null,
      })
    );
  });

  it('claims terminal ownership before kicking a review-required compromised account', async () => {
    const guildId = 'guild-kick-review-required-claim';
    const userId = 'user-kick-review-required-claim';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
    });
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
    (member.kick as jest.Mock).mockImplementation(async () => {
      const claimed = await verificationEventRepository.findById(verificationEvent.id);
      expect(claimed?.quarantine_attempt_id).toEqual(
        expect.stringMatching(`^${CASE_TERMINAL_ACTION_ATTEMPT_PREFIX}`)
      );
      await expect(
        verificationEventRepository.claimQuarantineAttempt(
          verificationEvent.id,
          guildId,
          userId,
          'competing-quarantine',
          new Date(0)
        )
      ).resolves.toBeNull();
    });

    await expect(
      service.kickUser(member, 'terminal kick', { id: 'moderator-kick' } as User)
    ).resolves.toBe(true);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.KICKED,
        quarantine_attempt_id: null,
      })
    );
  });

  it('claims terminal ownership before banning a parked account', async () => {
    const guildId = 'guild-ban-terminal-claim';
    const userId = 'user-ban-terminal-claim';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
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
    (member.ban as jest.Mock).mockImplementation(async () => {
      const claimed = await verificationEventRepository.findById(verificationEvent.id);
      expect(claimed?.quarantine_attempt_id).toEqual(
        expect.stringMatching(`^${CASE_TERMINAL_ACTION_ATTEMPT_PREFIX}`)
      );
      await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
        'Account quarantine is currently in progress'
      );
    });

    await expect(
      service.banUser(member, 'terminal ban', { id: 'moderator-ban' } as User)
    ).resolves.toBe(true);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        quarantine_attempt_id: null,
      })
    );
  });

  it('does not overwrite a terminal outcome that wins the release race', async () => {
    const guildId = 'guild-verify-terminal-race';
    const userId = 'user-verify-terminal-race';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
    roleManager.removeCaseRole.mockImplementation(async () => {
      await verificationEventRepository.update(
        verificationEvent.id,
        {
          status: VerificationStatus.BANNED,
          resolved_by: 'moderator-ban',
          resolved_at: new Date(),
        },
        { allowQuarantineOverride: true }
      );
      return true;
    });
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

    await expect(service.verifyUser(member, { id: 'moderator-verify' } as User)).rejects.toThrow(
      'Failed to atomically update verification events'
    );

    expect(roleManager.assignCaseRole).not.toHaveBeenCalled();
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        resolved_by: 'moderator-ban',
      })
    );
  });

  it('reclaims an expired release lease after a crashed verification attempt', async () => {
    const guildId = 'guild-verify-expired-release';
    const userId = 'user-verify-expired-release';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
    const staleLease = new Date(Date.now() - CASE_ROLE_RELEASE_LEASE_MS - 1);
    await verificationEventRepository.claimCaseRoleRelease(
      verificationEvent.id,
      guildId,
      userId,
      `${CASE_ROLE_RELEASE_ATTEMPT_PREFIX}crashed-moderator`,
      new Date(0)
    );
    await verificationEventRepository.update(verificationEvent.id, {
      quarantine_lease_renewed_at: staleLease,
    });
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

    await expect(service.verifyUser(member, { id: 'moderator-retry' } as User)).resolves.toBe(true);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.VERIFIED,
        quarantine_attempt_id: null,
        quarantine_lease_renewed_at: null,
      })
    );
  });

  it('restores quarantined roles when verifying a user', async () => {
    const guildId = 'guild-verify-restore-roles';
    const userId = 'user-verify-restore-roles';
    const moderator = { id: 'mod-verify-restore' } as User;
    const member = buildMember(guildId, userId);
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn().mockResolvedValue({
        status: 'restored',
        snapshotId: 'role-quarantine-1',
        attemptedRoleIds: ['role-1'],
        restoredRoleIds: ['role-1'],
        skippedRoles: [],
        failedRestores: [],
      }),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({
        status: 'no_active_snapshot',
        snapshotId: null,
      }),
    };

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    await serverMemberRepository.upsertMember(guildId, userId, {
      case_role_active: true,
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

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    await service.verifyUser(member, moderator);

    expect(roleQuarantineService.restoreMemberRoles).toHaveBeenCalledWith(member, moderator);
    expect(roleManager.removeCaseRole.mock.invocationCallOrder[0]).toBeLessThan(
      roleQuarantineService.restoreMemberRoles.mock.invocationCallOrder[0]
    );
    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.metadata).toEqual(
      expect.objectContaining({
        role_quarantine: expect.objectContaining({
          restore: expect.objectContaining({ restored_role_count: 1 }),
        }),
      })
    );
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions[0].metadata).toEqual(
      expect.objectContaining({
        role_quarantine: expect.objectContaining({ restored_role_count: 1 }),
      })
    );
  });

  it('verifies a user when live queue cleanup fails', async () => {
    const guildId = 'guild-verify-queue-fails';
    const userId = 'user-verify-queue-fails';
    const moderator = { id: 'mod-verify-queue-fails' } as User;
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
    const moderationQueueService = {
      deleteCaseMirror: jest.fn().mockRejectedValue(new Error('queue unavailable')),
      deleteCaseAttention: jest.fn().mockRejectedValue(new Error('attention unavailable')),
    } as unknown as IModerationQueueService;
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      moderationQueueService
    );

    try {
      await expect(service.verifyUser(member, moderator)).resolves.toBe(true);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to delete case ${verificationEvent.id}`),
        expect.any(Error)
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to delete case attention for ${verificationEvent.id}`),
        expect.any(Error)
      );
    } finally {
      consoleWarn.mockRestore();
    }

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.VERIFIED);
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].action_type).toBe(AdminActionType.VERIFY);
    expect(moderationQueueService.deleteCaseMirror).toHaveBeenCalledWith(verificationEvent.id);
    expect(moderationQueueService.deleteCaseAttention).toHaveBeenCalledWith(verificationEvent.id);
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
      case_role_active: true,
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
    expect(serverMember?.case_role_active).toBe(false);

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

    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(updateVerificationEvent.mock.invocationCallOrder[0]).toBeLessThan(
      roleManager.removeCaseRole.mock.invocationCallOrder[0]
    );
    expect(roleManager.removeCaseRole.mock.invocationCallOrder[0]).toBeLessThan(
      upsertServerMember.mock.invocationCallOrder[0]
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

  it('rejects close-no-action when the current case is a parked account quarantine', async () => {
    const guildId = 'guild-close-parked';
    const userId = 'user-close-parked';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: new Date('2026-08-18T09:00:00.000Z'),
      parked_by: 'moderator-parked',
    });
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
      service.closeCaseNoAction(buildGuildWithMember(guildId, member), userId, {
        id: 'moderator-close',
      } as User)
    ).rejects.toThrow(
      'An account quarantine can only be released with Verify User, Kick User, or Ban User.'
    );
    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
  });

  it('rejects close-no-action when compromised-account containment is incomplete', async () => {
    const guildId = 'guild-close-incomplete';
    const userId = 'user-close-incomplete';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      quarantine_case_role_id: 'persisted-quarantine-role',
    });
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
      service.closeCaseNoAction(buildGuildWithMember(guildId, member), userId, {
        id: 'moderator-close',
      } as User)
    ).rejects.toThrow(
      'An account quarantine can only be released with Verify User, Kick User, or Ban User.'
    );
    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
  });

  it('retries no-action case role cleanup after case events are already closed', async () => {
    const guildId = 'guild-close-retry';
    const userId = 'user-close-retry';
    const moderator = { id: 'mod-close-retry' } as User;
    const member = buildMember(guildId, userId);
    const guild = buildGuildWithMember(guildId, member);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    await serverMemberRepository.upsertMember(guildId, userId, {
      case_role_active: true,
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
      VerificationStatus.CLOSED_NO_ACTION
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

    const closedCount = await service.closeCaseNoAction(guild, userId, moderator);

    expect(closedCount).toBe(0);
    expect(roleManager.removeCaseRole).toHaveBeenCalledWith(member);
    expect(await verificationEventRepository.findById(verificationEvent.id)).toEqual(
      expect.objectContaining({ status: VerificationStatus.CLOSED_NO_ACTION })
    );
    expect(await serverMemberRepository.findByServerAndUser(guildId, userId)).toEqual(
      expect.objectContaining({
        case_role_active: false,
        verification_status: VerificationStatus.CLOSED_NO_ACTION,
        last_status_change: expect.any(Date),
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.logActionToMessage).not.toHaveBeenCalled();
  });

  it('abandons role quarantine when closing no-action for an absent member', async () => {
    const guildId = 'guild-close-absent';
    const userId = 'user-close-absent';
    const moderator = { id: 'mod-close-absent' } as User;
    const guild = buildGuildWithoutMember(guildId);
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn(),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({
        status: 'abandoned',
        snapshotId: 'role-quarantine-1',
      }),
    };

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    await serverMemberRepository.upsertMember(guildId, userId, {
      case_role_active: true,
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

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    const closedCount = await service.closeCaseNoAction(guild, userId, moderator);

    expect(closedCount).toBe(1);
    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    expect(roleQuarantineService.restoreMemberRoles).not.toHaveBeenCalled();
    expect(roleQuarantineService.abandonActiveSnapshot).toHaveBeenCalledWith(
      guildId,
      userId,
      'close_no_action_member_absent',
      moderator.id
    );
    expect(await verificationEventRepository.findById(verificationEvent.id)).toEqual(
      expect.objectContaining({ status: VerificationStatus.CLOSED_NO_ACTION })
    );
  });

  it('abandons role quarantine when retrying no-action cleanup for an absent member', async () => {
    const guildId = 'guild-close-absent-retry';
    const userId = 'user-close-absent-retry';
    const moderator = { id: 'mod-close-absent-retry' } as User;
    const guild = buildGuildWithoutMember(guildId);
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn(),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({
        status: 'abandoned',
        snapshotId: 'role-quarantine-1',
      }),
    };

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    await serverMemberRepository.upsertMember(guildId, userId, {
      case_role_active: true,
      verification_status: VerificationStatus.CLOSED_NO_ACTION,
    });
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
      VerificationStatus.CLOSED_NO_ACTION
    );

    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager,
      undefined,
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    const closedCount = await service.closeCaseNoAction(guild, userId, moderator);

    expect(closedCount).toBe(0);
    expect(roleManager.removeCaseRole).not.toHaveBeenCalled();
    expect(roleQuarantineService.restoreMemberRoles).not.toHaveBeenCalled();
    expect(roleQuarantineService.abandonActiveSnapshot).toHaveBeenCalledWith(
      guildId,
      userId,
      'close_no_action_member_absent',
      moderator.id
    );
  });

  it('bans a user and records admin action', async () => {
    const guildId = 'guild-ban';
    const userId = 'user-ban';
    const moderator = { id: 'mod-ban' } as User;
    const member = buildMember(guildId, userId);
    const roleQuarantineService: jest.Mocked<IRoleQuarantineService> = {
      previewCompromisedAccount: jest.fn(),
      quarantineCompromisedAccount: jest.fn(),
      quarantineMember: jest.fn(),
      enforceActiveCaseRoleUpdate: jest.fn(),
      restoreMemberRoles: jest.fn(),
      abandonActiveSnapshot: jest.fn().mockResolvedValue({
        status: 'abandoned',
        snapshotId: 'role-quarantine-1',
      }),
    };

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
      moderationOutcomeService,
      undefined,
      roleQuarantineService
    );

    (member.ban as jest.Mock).mockImplementation(async () => {
      await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
        expect.objectContaining({ status: VerificationStatus.PENDING })
      );
      expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
    });

    await service.banUser(member, 'banned in test', moderator);

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.BANNED);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();

    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.BANNED);
    expect(serverMember?.case_role_active).toBe(false);

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
    expect(roleQuarantineService.abandonActiveSnapshot).toHaveBeenCalledWith(
      guildId,
      userId,
      'drasil_ban',
      moderator.id
    );
  });

  it('keeps a combined ban case pending until successful-ban finalization', async () => {
    const guildId = 'guild-combined-ban';
    const userId = 'user-combined-ban';
    const moderator = { id: 'mod-combined-ban' } as User;
    const guild = buildGuildWithBan(guildId, userId, 'combined moderation action');

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

    await service.markCombinedBanCleanupPending(verificationEvent.id, 'cleanup-job-1');
    await service.performDiscordBanById(guild, userId, 'combined moderation action');

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        resolved_at: null,
        metadata: expect.objectContaining({
          active_moderation_operation: expect.objectContaining({
            kind: 'ban_with_message_cleanup',
            operation_id: 'cleanup-job-1',
          }),
        }),
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();

    await service.finalizeSuccessfulCombinedBan(
      guild,
      userId,
      verificationEvent.id,
      'cleanup-job-1',
      'combined moderation action',
      moderator,
      detectionEvent.id
    );

    const finalizedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(finalizedEvent).toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        resolved_by: moderator.id,
      })
    );
    expect(finalizedEvent?.metadata).toHaveProperty(
      'active_moderation_operation.operation_id',
      'cleanup-job-1'
    );
    expect(finalizedEvent?.metadata).toHaveProperty(
      'active_moderation_operation.case_finalized_at',
      expect.any(String)
    );
    const resolutionCalls = (threadManager.resolveVerificationThread as jest.Mock).mock.calls
      .length;
    const adminActionsAfterFirstFinalization = await adminActionRepository.findByUserAndServer(
      userId,
      guildId
    );
    const outcomesAfterFirstFinalization = await moderationOutcomeRepository.findByUserAndServer(
      userId,
      guildId
    );

    await expect(
      service.finalizeSuccessfulCombinedBan(
        guild,
        userId,
        verificationEvent.id,
        'cleanup-job-1',
        'combined moderation action',
        moderator,
        detectionEvent.id
      )
    ).resolves.toBe(true);

    expect(threadManager.resolveVerificationThread).toHaveBeenCalledTimes(resolutionCalls);
    await expect(adminActionRepository.findByUserAndServer(userId, guildId)).resolves.toHaveLength(
      adminActionsAfterFirstFinalization.length
    );
    await expect(
      moderationOutcomeRepository.findByUserAndServer(userId, guildId)
    ).resolves.toHaveLength(outcomesAfterFirstFinalization.length);
    await expect(
      service.clearCombinedBanCleanupMarker(verificationEvent.id, 'cleanup-job-1')
    ).resolves.toBe(true);
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ active_moderation_operation: expect.anything() }),
      })
    );
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.BANNED,
      moderator.id
    );
    expect(guild.bans.create).toHaveBeenCalledWith(userId, {
      reason: 'combined moderation action',
    });
  });

  it('truncates Discord ban audit reasons without truncating the durable moderation reason', async () => {
    const guildId = 'guild-combined-long-reason';
    const userId = 'user-combined-long-reason';
    const reason = 'r'.repeat(700);
    const guild = buildGuildWithBan(guildId, userId, reason);
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

    await service.performDiscordBanById(guild, userId, reason);

    expect(guild.bans.create).toHaveBeenCalledWith(userId, { reason: 'r'.repeat(512) });
  });

  it('resumes combined finalization after a process exit leaves a banned case marker', async () => {
    const guildId = 'guild-combined-resume';
    const userId = 'user-combined-resume';
    const moderator = { id: 'mod-combined-resume' } as User;
    const guild = buildGuildWithBan(guildId, userId, 'combined cleanup');

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
    await service.markCombinedBanCleanupPending(verificationEvent.id, 'cleanup-job-resume');
    const marked = await verificationEventRepository.findById(verificationEvent.id);
    await verificationEventRepository.update(verificationEvent.id, {
      ...marked!,
      status: VerificationStatus.BANNED,
      resolved_at: new Date(),
      resolved_by: moderator.id,
    });
    await expect(
      service.markCombinedBanCleanupPending(verificationEvent.id, 'cleanup-job-resume')
    ).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.BANNED,
        metadata: expect.objectContaining({
          active_moderation_operation: expect.objectContaining({
            operation_id: 'cleanup-job-resume',
          }),
        }),
      })
    );

    await service.finalizeSuccessfulCombinedBan(
      guild,
      userId,
      verificationEvent.id,
      'cleanup-job-resume',
      'combined cleanup',
      moderator,
      detectionEvent.id
    );

    const finalized = await verificationEventRepository.findById(verificationEvent.id);
    expect(finalized?.metadata).toHaveProperty(
      'active_moderation_operation.operation_id',
      'cleanup-job-resume'
    );
    await expect(
      service.clearCombinedBanCleanupMarker(verificationEvent.id, 'cleanup-job-resume')
    ).resolves.toBe(true);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.BANNED,
      moderator.id
    );
  });

  it('ignores an observed Discord ban while combined cleanup is active', async () => {
    const guildId = 'guild-combined-observed-ban';
    const userId = 'user-combined-observed-ban';
    const member = buildMember(guildId, userId);
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

    await service.markCombinedBanCleanupPending(verificationEvent.id, 'cleanup-job-2');

    await expect(
      service.recordObservedDiscordBan(guild, member.user, {
        source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        sourceDetail: 'guildBanAdd',
      })
    ).resolves.toBe(0);
    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({ status: VerificationStatus.PENDING })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
    await expect(moderationOutcomeRepository.findByUserAndServer(userId, guildId)).resolves.toEqual(
      []
    );
  });

  it('clears the combined cleanup marker after the Discord ban fails', async () => {
    const guildId = 'guild-combined-ban-failure';
    const userId = 'user-combined-ban-failure';
    const member = buildMember(guildId, userId);
    (member.ban as jest.Mock).mockRejectedValue(new Error('Missing Ban Members permission'));

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

    await service.markCombinedBanCleanupPending(verificationEvent.id, 'cleanup-job-3');
    await expect(
      service.performDiscordMemberBan(member, 'combined moderation action')
    ).rejects.toThrow('Missing Ban Members permission');
    await expect(
      service.clearCombinedBanCleanupMarker(verificationEvent.id, 'cleanup-job-3')
    ).resolves.toBe(true);

    const pendingEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(pendingEvent?.status).toBe(VerificationStatus.PENDING);
    expect(pendingEvent?.metadata).not.toHaveProperty('active_moderation_operation');
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
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

  it('kicks a pending case and records a recoverable Drasil kick outcome', async () => {
    const guildId = 'guild-kick';
    const userId = 'user-kick';
    const moderator = { id: 'mod-kick' } as User;
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

    await expect(service.kickUser(member, 'unresolved legitimacy', moderator)).resolves.toBe(true);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.KICKED,
        resolved_by: moderator.id,
        notes: 'unresolved legitimacy',
      })
    );
    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.verification_status).toBe(VerificationStatus.KICKED);
    expect(serverMember?.case_role_active).toBe(false);
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0]).toEqual(
      expect.objectContaining({
        action_type: AdminActionType.KICK,
        notes: 'unresolved legitimacy',
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.KICKED,
        source: ModerationOutcomeSource.DRASIL,
        actor_id: moderator.id,
        reason: 'unresolved legitimacy',
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    expect(member.kick).toHaveBeenCalledWith('unresolved legitimacy');
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.KICKED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      AdminActionType.KICK,
      moderator
    );
  });

  it('surfaces post-kick case update failures to callers', async () => {
    const guildId = 'guild-kick-update-fails';
    const userId = 'user-kick-update-fails';
    const moderator = { id: 'mod-kick' } as User;
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
    await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    jest
      .spyOn(verificationEventRepository, 'completeTerminalActions')
      .mockRejectedValueOnce(new Error('DB down'));

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

    await expect(service.kickUser(member, 'unresolved legitimacy', moderator)).rejects.toThrow(
      'DB down'
    );
    expect(member.kick).toHaveBeenCalledWith('unresolved legitimacy');
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
    expect(serverMember?.case_role_active).toBe(false);
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

  it('resolves pending cases when a native Discord kick is observed', async () => {
    const guildId = 'guild-observed-kick';
    const userId = 'user-observed-kick';
    const nativeModeratorId = 'native-mod';
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

    await expect(
      service.recordObservedDiscordKick(member, {
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actorId: nativeModeratorId,
        reason: 'native moderation kick',
        auditLogEntryId: 'audit-kick-1',
      })
    ).resolves.toBe(1);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.KICKED,
        resolved_by: nativeModeratorId,
        notes: 'Observed Discord kick: native moderation kick',
      })
    );
    const adminActions = await adminActionRepository.findByUserAndServer(userId, guildId);
    expect(adminActions).toHaveLength(0);
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.KICKED,
        source: ModerationOutcomeSource.NATIVE_DISCORD,
        actor_id: nativeModeratorId,
        reason: 'native moderation kick',
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.KICKED,
      nativeModeratorId
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
        source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
    expect(threadManager.resolveVerificationThread).not.toHaveBeenCalled();
  });

  it('preserves incomplete containment when a compromised-account member leaves', async () => {
    const guildId = 'guild-quarantined-member-left';
    const userId = 'user-quarantined-member-left';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: 'attempt-1',
      parked_at: new Date(),
      parked_by: 'moderator-1',
    });
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(service.recordMemberLeftGuild(member)).resolves.toBe(1);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        quarantine_attempt_id: null,
        parked_at: null,
        parked_by: null,
      })
    );
  });

  it('preserves a terminal-action claim when guildMemberRemove arrives first', async () => {
    const guildId = 'guild-terminal-member-remove';
    const userId = 'user-terminal-member-remove';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const terminalAttemptId = 'case-terminal-action:attempt-1';
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: terminalAttemptId,
      quarantine_lease_renewed_at: new Date(),
      parked_at: new Date(),
      parked_by: 'moderator-1',
    });
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(service.recordMemberLeftGuild(member)).resolves.toBe(1);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        containment_status: CaseContainmentStatus.IN_PROGRESS,
        quarantine_attempt_id: terminalAttemptId,
      })
    );
  });

  it('does not revive a terminal resolution that completes before the member-left write', async () => {
    const guildId = 'guild-terminal-completes-first';
    const userId = 'user-terminal-completes-first';
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'test-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const terminalAttemptId = 'case-terminal-action:attempt-completes-first';
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.IN_PROGRESS,
      quarantine_attempt_id: terminalAttemptId,
      quarantine_lease_renewed_at: new Date(),
    });
    const updatePendingAfterMemberLeft =
      verificationEventRepository.updatePendingAfterMemberLeft.bind(verificationEventRepository);
    jest
      .spyOn(verificationEventRepository, 'updatePendingAfterMemberLeft')
      .mockImplementationOnce(async (id, expectedAttemptId, data) => {
        await verificationEventRepository.completeTerminalActions(
          [
            {
              id,
              metadata: { terminal_completed: true },
              requiresTerminalActionClaim: true,
            },
          ],
          expectedAttemptId,
          VerificationStatus.KICKED,
          'moderator-1',
          new Date(),
          'Terminal kick completed.'
        );
        return updatePendingAfterMemberLeft(id, expectedAttemptId, data);
      });
    const service = new UserModerationService(
      serverMemberRepository,
      notificationManager,
      roleManager,
      verificationEventRepository,
      adminActionService,
      threadManager
    );

    await expect(service.recordMemberLeftGuild(member)).resolves.toBe(0);

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.KICKED,
        containment_status: CaseContainmentStatus.NOT_APPLICABLE,
        quarantine_attempt_id: null,
        metadata: { terminal_completed: true },
      })
    );
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

  it('bans by ID and resolves pending cases after the member leaves', async () => {
    const guildId = 'guild-ban-by-id';
    const userId = 'user-ban-by-id';
    const moderator = { id: 'mod-ban' } as User;
    const targetUser = {
      id: userId,
      tag: 'left-user#0001',
      username: 'left-user',
      createdTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
    } as User;
    const guild = {
      id: guildId,
      client: { users: { fetch: jest.fn().mockResolvedValue(targetUser) } },
      bans: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as Guild;

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'left-user');

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
    notificationManager.logActionToMessage.mockResolvedValue(false);
    (guild.bans.create as jest.Mock).mockImplementation(async () => {
      const updatedBeforeBan = await verificationEventRepository.findById(verificationEvent.id);
      expect(updatedBeforeBan?.status).toBe(VerificationStatus.PENDING);
      return {};
    });

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
      service.banUserById(guild, userId, 'banned after leave', moderator, detectionEvent.id)
    ).resolves.toBe(true);

    expect(guild.bans.create).toHaveBeenCalledWith(targetUser, { reason: 'banned after leave' });
    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.BANNED);
    expect(updatedEvent?.metadata).toEqual(
      expect.objectContaining({
        membership_state: 'left_or_removed',
        banned_by_id_at: expect.any(String),
      })
    );
    const outcomes = await moderationOutcomeRepository.findByUserAndServer(userId, guildId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toEqual(
      expect.objectContaining({
        outcome_type: ModerationOutcomeType.BANNED,
        source: ModerationOutcomeSource.DRASIL,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
      })
    );
  });

  it('preserves a parked quarantine when a ban by ID fails', async () => {
    const guildId = 'guild-ban-by-id-rollback';
    const userId = 'user-ban-by-id-rollback';
    const moderator = { id: 'mod-ban' } as User;
    const guild = {
      id: guildId,
      client: { users: { fetch: jest.fn().mockRejectedValue(new Error('Unknown user')) } },
      bans: { create: jest.fn().mockRejectedValue(new Error('Missing permissions')) },
    } as unknown as Guild;
    const parkedAt = new Date('2026-08-18T07:00:00Z');

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, 'left-user');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(verificationEvent.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
      parked_at: parkedAt,
      parked_by: moderator.id,
    });
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
      service.banUserById(guild, userId, 'banned after leave', moderator)
    ).rejects.toThrow('Missing permissions');

    await expect(verificationEventRepository.findById(verificationEvent.id)).resolves.toEqual(
      expect.objectContaining({
        status: VerificationStatus.PENDING,
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.PARKED,
        containment_status: CaseContainmentStatus.CONTAINED,
        parked_at: parkedAt,
        parked_by: moderator.id,
      })
    );
  });
});
