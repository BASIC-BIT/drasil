import { Client, Guild, GuildMember, Message, User } from 'discord.js';
import { SecurityActionService } from '../../services/SecurityActionService';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import {
  AdminActionType,
  DetectionType,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  VerificationStatus,
} from '../../repositories/types';
import {
  InMemoryDetectionEventsRepository,
  InMemoryServerMemberRepository,
  InMemoryVerificationEventRepository,
  InMemoryUserRepository,
  InMemoryServerRepository,
} from '../fakes/inMemoryRepositories';
import { INotificationManager } from '../../services/NotificationManager';
import {
  IThreadManager,
  REPORT_REVIEW_THREAD_TYPE,
  VERIFICATION_THREAD_TYPE_METADATA_KEY,
} from '../../services/ThreadManager';
import { IUserModerationService } from '../../services/UserModerationService';
import { IAdminActionService } from '../../services/AdminActionService';
import { USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY } from '../../utils/userReportSettings';
import {
  getVerificationActionFailures,
  VERIFICATION_ACTION_FAILURES_METADATA_KEY,
} from '../../utils/verificationActionFailures';
import type { IModerationQueueService } from '../../services/ModerationQueueService';

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    displayName: 'Test Display',
    nickname: 'Test Nick',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/4.png',
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      globalName: 'Test Global',
      tag: 'test-user#0001',
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/5.png',
    } as User,
  }) as unknown as GuildMember;

const buildMessage = (guildId: string, channelId: string): Message =>
  ({
    id: 'message-1',
    content: 'free discord nitro',
    channelId,
    url: `https://discord.com/channels/${guildId}/${channelId}/message-1`,
  }) as Message;

describe('SecurityActionService (unit)', () => {
  let detectionEventsRepository: InMemoryDetectionEventsRepository;
  let serverMemberRepository: InMemoryServerMemberRepository;
  let verificationEventRepository: InMemoryVerificationEventRepository;
  let userRepository: InMemoryUserRepository;
  let serverRepository: InMemoryServerRepository;
  let notificationManager: jest.Mocked<INotificationManager>;
  let threadManager: jest.Mocked<IThreadManager>;
  let userModerationService: jest.Mocked<IUserModerationService>;
  let adminActionService: jest.Mocked<IAdminActionService>;
  let gptService: { analyzeReportEvidence: jest.Mock };

  beforeEach(() => {
    detectionEventsRepository = new InMemoryDetectionEventsRepository();
    serverMemberRepository = new InMemoryServerMemberRepository();
    verificationEventRepository = new InMemoryVerificationEventRepository();
    userRepository = new InMemoryUserRepository();
    serverRepository = new InMemoryServerRepository();
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue({ id: 'notif-1' } as Message),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(false),
      upsertObservedDetectionNotification: jest
        .fn()
        .mockResolvedValue({ id: 'observe-1' } as Message),
      markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
      restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
    };
    threadManager = {
      createVerificationThread: jest
        .fn()
        .mockResolvedValue({ id: 'thread-1', url: 'https://discord.com/channels/thread-1' } as any),
      createReportReviewThread: jest
        .fn()
        .mockResolvedValue({ id: 'thread-1', url: 'https://discord.com/channels/thread-1' } as any),
      createPrivateEvidenceThread: jest.fn().mockResolvedValue({
        id: 'evidence-1',
        url: 'https://discord.com/channels/evidence-1',
      } as any),
      createObservedEvidenceThread: jest.fn().mockResolvedValue({
        id: 'observed-evidence-1',
        url: 'https://discord.com/channels/observed-evidence-1',
      } as any),
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
    userModerationService = {
      restrictUser: jest.fn().mockImplementation(async (member: GuildMember) => {
        await serverMemberRepository.upsertMember(member.guild.id, member.id, {
          is_restricted: true,
          verification_status: VerificationStatus.PENDING,
        });
        return true;
      }),
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

    adminActionService = {
      recordAction: jest.fn().mockResolvedValue({} as any),
      getActionsForUser: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IAdminActionService>;
    gptService = {
      analyzeReportEvidence: jest.fn().mockResolvedValue({
        result: 'low_risk',
        confidence: 0.2,
        summary: 'Report evidence looks low risk, but moderators should review context.',
        reasonCodes: ['normal_context'],
        evidenceCategories: [],
        concerns: [],
        recommendedAction: 'manual_review',
        analyzedImageCount: 0,
        model: 'gpt-5.4-mini',
        promptVersion: 'report-triage-v1',
        isFallback: false,
      }),
    };
  });

  const buildService = (client: Client = {} as Client): SecurityActionService =>
    new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      client,
      gptService as any
    );

  it('records deterministic rejoin-after-kick detections with prior kick metadata', async () => {
    const guildId = 'guild-rejoin-kick';
    const userId = 'user-rejoin-kick';
    const member = buildMember(guildId, userId);
    const priorKick = {
      id: 'out-kick-1',
      server_id: guildId,
      user_id: userId,
      detection_event_id: null,
      verification_event_id: 'ver-kick-1',
      outcome_type: ModerationOutcomeType.KICKED,
      source: ModerationOutcomeSource.NATIVE_DISCORD,
      actor_id: 'native-mod',
      reason: 'prior kick reason',
      occurred_at: new Date('2026-06-01T00:00:00.000Z'),
      created_at: new Date('2026-06-01T00:00:00.000Z'),
      metadata: null,
    };
    const service = buildService();

    const result = await service.recordRejoinAfterKickDetection(member, priorKick);

    expect(result).toEqual(
      expect.objectContaining({
        label: 'SUSPICIOUS',
        confidence: 1,
        triggerSource: DetectionType.REJOIN_AFTER_KICK,
        triggerContent: 'Rejoined after prior kick',
      })
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'Previously kicked from this server; review required on rejoin.',
        'Prior kick reason: prior kick reason',
      ])
    );
    const detectionEvent = await detectionEventsRepository.findById(result.detectionEventId ?? '');
    expect(detectionEvent).toEqual(
      expect.objectContaining({
        server_id: guildId,
        user_id: userId,
        detection_type: DetectionType.REJOIN_AFTER_KICK,
        confidence: 1,
      })
    );
    expect(detectionEvent?.metadata).toEqual(
      expect.objectContaining({
        rejoin_after_kick: true,
        prior_kick_outcome_id: priorKick.id,
        prior_kick_source: priorKick.source,
        prior_kick_actor_id: priorKick.actor_id,
        prior_kick_at: priorKick.occurred_at.toISOString(),
      })
    );
    await expect(serverRepository.findByGuildId(guildId)).resolves.toEqual(
      expect.objectContaining({ guild_id: guildId })
    );
    await expect(userRepository.findById(userId)).resolves.toEqual(
      expect.objectContaining({ discord_id: userId })
    );
  });

  it('creates detection and verification when none exists', async () => {
    const guildId = 'guild-1';
    const userId = 'user-1';
    const channelId = 'channel-1';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, channelId);

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.handleSuspiciousMessage(member, detectionResult, message);

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].detection_type).toBe(DetectionType.SUSPICIOUS_CONTENT);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(verificationEvents[0].notification_message_id).toBe('notif-1');
    expect(verificationEvents[0].metadata).toEqual(
      expect.objectContaining({
        user_snapshot: expect.objectContaining({
          id: userId,
          username: 'test-user',
          global_name: 'Test Global',
          nickname: 'Test Nick',
          display_name: 'Test Display',
          avatar_url: 'https://cdn.discordapp.com/embed/avatars/4.png',
        }),
      })
    );
    expect(detectionEvents[0].latest_verification_event_id).toBe(verificationEvents[0].id);

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('auto-kicks high-confidence message detections only when message policy allows it', async () => {
    const guildId = 'guild-auto-kick-message';
    const userId = 'user-auto-kick-message';
    const channelId = 'channel-1';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, channelId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        message_detection_auto_kick_enabled: true,
        auto_kick_min_confidence_threshold: 95,
      },
    });
    const botUser = { id: 'bot-1' } as User;
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.99,
      reasons: ['High-confidence scam content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    await expect(
      buildService({ user: botUser } as Client).handleSuspiciousMessage(
        member,
        detectionResult,
        message
      )
    ).resolves.toBe(true);

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(userModerationService.kickUser).toHaveBeenCalledWith(
      member,
      'Suspected compromised account: high-confidence scam activity detected by Drasil.',
      botUser,
      detectionEvents[0].id
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: guildId,
        user_id: userId,
        admin_id: 'bot-1',
        detection_event_id: detectionEvents[0].id,
        action_type: AdminActionType.KICK,
        new_status: VerificationStatus.KICKED,
      })
    );
  });

  it('falls back to restriction when auto-kick confidence is below threshold', async () => {
    const guildId = 'guild-auto-kick-under-threshold';
    const userId = 'user-auto-kick-under-threshold';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        message_detection_auto_kick_enabled: true,
        auto_kick_min_confidence_threshold: 99,
      },
    });
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.98,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    await buildService({ user: { id: 'bot-1' } } as Client).handleSuspiciousMessage(
      member,
      detectionResult,
      message
    );

    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
  });

  it('does not auto-kick on rejoin-after-kick context alone', async () => {
    const guildId = 'guild-auto-kick-rejoin';
    const userId = 'user-auto-kick-rejoin';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        join_detection_auto_kick_enabled: true,
        auto_kick_min_confidence_threshold: 95,
      },
    });
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 1,
      reasons: ['Previously kicked from this server; review required on rejoin.'],
      triggerSource: DetectionType.REJOIN_AFTER_KICK,
      triggerContent: 'Rejoined after prior kick',
    };

    await buildService({ user: { id: 'bot-1' } } as Client).handleSuspiciousJoin(
      member,
      detectionResult
    );

    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
  });

  it('continues case creation when live queue mirroring fails', async () => {
    const guildId = 'guild-queue-fails';
    const userId = 'user-queue-fails';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };
    const moderationQueueService = {
      upsertCaseMirror: jest.fn().mockRejectedValue(new Error('queue unavailable')),
    } as unknown as IModerationQueueService;
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client,
      gptService as any,
      undefined,
      moderationQueueService
    );

    try {
      await expect(service.handleSuspiciousMessage(member, detectionResult, message)).resolves.toBe(
        true
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to mirror case'),
        expect.any(Error)
      );
    } finally {
      consoleWarn.mockRestore();
    }

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(moderationQueueService.upsertCaseMirror).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvents[0].id })
    );
  });

  it('continues case notification when automatic restriction fails', async () => {
    const guildId = 'guild-restrict-fails';
    const userId = 'user-restrict-fails';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });
    userModerationService.restrictUser.mockRejectedValueOnce(new Error('Missing Permissions'));

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        buildService().handleSuspiciousMessage(member, detectionResult, message)
      ).resolves.toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);

    const notifiedVerificationEvent =
      notificationManager.upsertSuspiciousUserNotification.mock.calls[0][2];
    expect(getVerificationActionFailures(notifiedVerificationEvent.metadata)).toEqual([
      expect.objectContaining({ action: 'restrict', message: 'Missing Permissions' }),
    ]);

    const serverMember = await serverMemberRepository.findByServerAndUser(guildId, userId);
    expect(serverMember?.is_restricted).toBe(true);
    expect(serverMember?.verification_status).toBe(VerificationStatus.PENDING);
  });

  it('continues notification when recording a restriction failure fails', async () => {
    const guildId = 'guild-restrict-record-fails';
    const userId = 'user-restrict-record-fails';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    userModerationService.restrictUser.mockRejectedValueOnce(new Error('Missing Permissions'));
    jest.spyOn(verificationEventRepository, 'update').mockRejectedValueOnce(new Error('DB down'));

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        buildService().handleSuspiciousMessage(member, detectionResult, message)
      ).resolves.toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);

    const notifiedVerificationEvent =
      notificationManager.upsertSuspiciousUserNotification.mock.calls[0][2];
    expect(getVerificationActionFailures(notifiedVerificationEvent.metadata)).toEqual([
      expect.objectContaining({ action: 'restrict', message: 'Missing Permissions' }),
    ]);
  });

  it('continues case notification when verification thread creation fails', async () => {
    const guildId = 'guild-thread-fails';
    const userId = 'user-thread-fails';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    threadManager.createVerificationThread.mockRejectedValueOnce(new Error('Missing Access'));

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        buildService().handleSuspiciousMessage(member, detectionResult, message)
      ).resolves.toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);

    const notifiedVerificationEvent =
      notificationManager.upsertSuspiciousUserNotification.mock.calls[0][2];
    expect(getVerificationActionFailures(notifiedVerificationEvent.metadata)).toEqual([
      expect.objectContaining({ action: 'thread', message: 'Missing Access' }),
    ]);
  });

  it('retries failed verification thread setup after Discord propagation delay', async () => {
    jest.useFakeTimers();
    const guildId = 'guild-thread-delayed-repair';
    const userId = 'user-thread-delayed-repair';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-1');
    threadManager.createVerificationThread.mockRejectedValueOnce(new Error('Missing Access'));

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        buildService().handleSuspiciousMessage(member, detectionResult, message)
      ).resolves.toBe(true);

      expect(threadManager.repairVerificationThread).not.toHaveBeenCalled();
      expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(69_999);
      expect(threadManager.repairVerificationThread).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);

      expect(threadManager.repairVerificationThread).toHaveBeenCalledWith(
        member,
        expect.objectContaining({ server_id: guildId, user_id: userId })
      );
      expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(2);
      const refreshedVerificationEvent =
        notificationManager.upsertSuspiciousUserNotification.mock.calls[1][2];
      expect(getVerificationActionFailures(refreshedVerificationEvent.metadata)).toEqual([]);
    } finally {
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('updates notification without creating a new verification', async () => {
    const guildId = 'guild-2';
    const userId = 'user-2';
    const member = buildMember(guildId, userId);

    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });

    const activeCase = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });

    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.85,
      reasons: ['Follow-up detection'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'suspicious follow-up',
    };

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.handleSuspiciousMessage(member, detectionResult);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(2);
    const followUpDetection = detectionEvents.find((event) => event.id !== detectionEvent.id);
    expect(followUpDetection?.latest_verification_event_id).toBe(activeCase.id);

    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('opens a case without restricting when requested by detection policy', async () => {
    const guildId = 'guild-open-case';
    const userId = 'user-open-case';
    const member = buildMember(guildId, userId);
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious content'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: 'free discord nitro',
    };

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.openCaseForSuspiciousMessage(member, detectionResult);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('opens an admin case without restricting the user', async () => {
    const guildId = 'guild-admin-open-case';
    const userId = 'user-admin-open-case';
    const moderator = { id: 'admin-open-case' } as User;
    const member = buildMember(guildId, userId);
    const getOrCreateServer = jest.spyOn(serverRepository, 'getOrCreateServer');
    const getOrCreateUser = jest.spyOn(userRepository, 'getOrCreateUser');
    const getOrCreateMember = jest.spyOn(serverMemberRepository, 'getOrCreateMember');

    await buildService().openAdminCase(member, moderator, {
      action: 'open_case',
      reason: 'manual review',
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'admin_case',
      adminId: moderator.id,
      action: 'open_case',
      reason: 'manual review',
    });

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(getOrCreateServer).toHaveBeenCalledTimes(1);
    expect(getOrCreateUser).toHaveBeenCalledTimes(1);
    expect(getOrCreateMember).toHaveBeenCalledTimes(1);
  });

  it('opens an admin case and restricts the user when requested', async () => {
    const guildId = 'guild-admin-restrict-case';
    const userId = 'user-admin-restrict-case';
    const moderator = { id: 'admin-restrict-case' } as User;
    const member = buildMember(guildId, userId);

    await buildService().openAdminCase(member, moderator, {
      action: 'restrict',
      reason: 'high risk manual review',
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'admin_case',
      adminId: moderator.id,
      action: 'restrict',
    });
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member, moderator);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
  });

  it('restricts an existing active admin case when requested', async () => {
    const guildId = 'guild-admin-restrict-existing-case';
    const userId = 'user-admin-restrict-existing-case';
    const moderator = { id: 'admin-restrict-existing-case' } as User;
    const member = buildMember(guildId, userId);
    const existingDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.GPT_ANALYSIS,
      confidence: 1.0,
      reasons: ['Admin case opened by admin-open-case. No reason provided.'],
      detected_at: new Date(),
    });
    await verificationEventRepository.createFromDetection(
      existingDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    await buildService().openAdminCase(member, moderator, {
      action: 'restrict',
      reason: 'escalated manual review',
    });

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member, moderator);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(threadManager.createVerificationThread.mock.invocationCallOrder[0]).toBeLessThan(
      userModerationService.restrictUser.mock.invocationCallOrder[0]
    );
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('repairs an active restricted case thread and reapplies the restricted role', async () => {
    const guildId = 'guild-case-repair';
    const userId = 'user-case-repair';
    const member = buildMember(guildId, userId);
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'thread-1';
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });

    const result = await buildService().repairActiveCase(member);

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.repairVerificationThread).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: verificationEvent.id, thread_id: 'thread-1' })
    );
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.PENDING
    );
    expect(result).toMatchObject({
      repaired: true,
      verificationEventId: verificationEvent.id,
      threadId: 'thread-1',
      userAdded: true,
      promptSent: true,
    });
  });

  it('clears repaired thread warnings and rebuilds the notification embed', async () => {
    const guildId = 'guild-case-repair-warning-clear';
    const userId = 'user-case-repair-warning-clear';
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.NEW_ACCOUNT,
      confidence: 1,
      reasons: ['New Discord account'],
      detected_at: new Date(),
    });
    const verificationEvent = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'thread-1';
    verificationEvent.notification_message_id = 'notif-1';
    verificationEvent.metadata = {
      [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: [
        {
          action: 'thread',
          message: 'Failed to add flagged user to verification thread: Missing Access',
          at: new Date().toISOString(),
        },
        {
          action: 'restrict',
          message: 'Role hierarchy issue',
          at: new Date().toISOString(),
        },
      ],
    };
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });

    const result = await buildService().repairActiveCase(member);
    const updatedCase = await verificationEventRepository.findById(verificationEvent.id);

    expect(result.repaired).toBe(true);
    expect(getVerificationActionFailures(updatedCase?.metadata)).toEqual([
      expect.objectContaining({ action: 'restrict', message: 'Role hierarchy issue' }),
    ]);
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        id: verificationEvent.id,
        metadata: expect.objectContaining({
          [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: [
            expect.objectContaining({ action: 'restrict' }),
          ],
        }),
      }),
      VerificationStatus.PENDING
    );
    expect(notificationManager.upsertSuspiciousUserNotification).not.toHaveBeenCalled();
  });

  it('reports thread repair success when notification button update fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const guildId = 'guild-case-repair-notification-fails';
    const userId = 'user-case-repair-notification-fails';
    const member = buildMember(guildId, userId);
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'thread-1';
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);
    notificationManager.updateNotificationButtons.mockRejectedValueOnce(
      new Error('Missing Message')
    );

    try {
      const result = await buildService().repairActiveCase(member);

      expect(threadManager.repairVerificationThread).toHaveBeenCalledWith(
        member,
        expect.objectContaining({ id: verificationEvent.id, thread_id: 'thread-1' })
      );
      expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
        expect.objectContaining({ id: verificationEvent.id }),
        VerificationStatus.PENDING
      );
      expect(result).toMatchObject({
        repaired: true,
        verificationEventId: verificationEvent.id,
        threadId: 'thread-1',
        userAdded: true,
        promptSent: true,
      });
      expect(result.message).toContain('Notification buttons could not be updated automatically');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update notification for repaired case'),
        expect.any(Error)
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records a thread warning when active case repair still cannot add the user', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const guildId = 'guild-case-repair-still-fails';
    const userId = 'user-case-repair-still-fails';
    const member = buildMember(guildId, userId);
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'thread-1';
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);
    threadManager.repairVerificationThread.mockRejectedValueOnce(
      new Error('Failed to add flagged user to verification thread: Missing Access')
    );

    try {
      const result = await buildService().repairActiveCase(member);
      const updatedCase = await verificationEventRepository.findById(verificationEvent.id);

      expect(result).toMatchObject({
        repaired: false,
        verificationEventId: verificationEvent.id,
        threadId: null,
        userAdded: false,
      });
      expect(result.message).toContain('Missing Access');
      expect(getVerificationActionFailures(updatedCase?.metadata)).toEqual([
        expect.objectContaining({
          action: 'thread',
          message: 'Failed to add flagged user to verification thread: Missing Access',
        }),
      ]);
      expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
        expect.objectContaining({
          id: verificationEvent.id,
          metadata: expect.objectContaining({
            [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: [
              expect.objectContaining({ action: 'thread' }),
            ],
          }),
        }),
        VerificationStatus.PENDING
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('refreshes the latest resolved case notification from stored state', async () => {
    const member = buildMember('guild-1', 'user-refresh');
    const pendingEvent = await verificationEventRepository.createFromDetection(
      null,
      member.guild.id,
      member.id,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(pendingEvent.id, {
      ...pendingEvent,
      notification_channel_id: 'channel-old',
      notification_message_id: 'message-old',
    });
    const latestEvent = await verificationEventRepository.createFromDetection(
      null,
      member.guild.id,
      member.id,
      VerificationStatus.PENDING
    );
    const verifiedEvent = await verificationEventRepository.update(latestEvent.id, {
      ...latestEvent,
      status: VerificationStatus.VERIFIED,
      resolved_by: 'admin-1',
      resolved_at: new Date('2026-06-12T15:04:12Z'),
      notification_channel_id: 'channel-new',
      notification_message_id: 'message-new',
    });

    const result = await buildService().refreshCaseNotification(member.guild.id, member.user);

    expect(result).toMatchObject({
      refreshed: true,
      verificationEventId: latestEvent.id,
      status: VerificationStatus.VERIFIED,
      notificationChannelId: 'channel-new',
      notificationMessageId: 'message-new',
    });
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      verifiedEvent,
      VerificationStatus.VERIFIED
    );
  });

  it('does not refresh a case without a stored notification message', async () => {
    const member = buildMember('guild-1', 'user-no-notification');
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      member.guild.id,
      member.id,
      VerificationStatus.PENDING
    );

    const result = await buildService().refreshCaseNotification(
      member.guild.id,
      member.user,
      verificationEvent.id
    );

    expect(result).toMatchObject({
      refreshed: false,
      verificationEventId: verificationEvent.id,
      status: VerificationStatus.PENDING,
      notificationMessageId: null,
    });
    expect(result.message).toContain('no stored notification message');
    expect(notificationManager.updateNotificationButtons).not.toHaveBeenCalled();
  });

  it('does not repair moderator-only report review threads as user-facing threads', async () => {
    const guildId = 'guild-case-repair-report-review';
    const userId = 'user-case-repair-report-review';
    const member = buildMember(guildId, userId);
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'thread-1';
    verificationEvent.metadata = {
      [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
    };
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);

    const result = await buildService().repairActiveCase(member);

    expect(threadManager.repairVerificationThread).not.toHaveBeenCalled();
    expect(result.repaired).toBe(false);
    expect(result.message).toContain('moderator-only report review thread');
  });

  it('repairs a missing user-facing thread before restricting an active case', async () => {
    const guildId = 'guild-case-action-restrict-thread';
    const userId = 'user-case-action-restrict-thread';
    const moderator = { id: 'admin-case-action-restrict' } as User;
    const member = buildMember(guildId, userId);
    await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    await buildService().restrictActiveCase(member, moderator);

    expect(threadManager.repairVerificationThread).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ user_id: userId })
    );
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member, moderator);
    expect(threadManager.repairVerificationThread.mock.invocationCallOrder[0]).toBeLessThan(
      userModerationService.restrictUser.mock.invocationCallOrder[0]
    );
  });

  it('does not restrict an already restricted active case again', async () => {
    const guildId = 'guild-case-action-restrict-idempotent';
    const userId = 'user-case-action-restrict-idempotent';
    const moderator = { id: 'admin-case-action-restrict-idempotent' } as User;
    const member = buildMember(guildId, userId);
    await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await serverMemberRepository.upsertMember(guildId, userId, {
      is_restricted: true,
      verification_status: VerificationStatus.PENDING,
    });

    await buildService().restrictActiveCase(member, moderator);

    expect(threadManager.repairVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('creates a new verification thread before restricting a legacy report-review case', async () => {
    const guildId = 'guild-case-action-restrict-report-review';
    const userId = 'user-case-action-restrict-report-review';
    const moderator = { id: 'admin-case-action-restrict-report-review' } as User;
    const member = buildMember(guildId, userId);
    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    verificationEvent.thread_id = 'review-thread-1';
    verificationEvent.metadata = {
      [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
    };
    await verificationEventRepository.update(verificationEvent.id, verificationEvent);

    await buildService().restrictActiveCase(member, moderator);

    expect(threadManager.repairVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: verificationEvent.id, thread_id: 'review-thread-1' })
    );
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member, moderator);
    expect(threadManager.createVerificationThread.mock.invocationCallOrder[0]).toBeLessThan(
      userModerationService.restrictUser.mock.invocationCallOrder[0]
    );
  });

  it('normalizes blank admin case reasons', async () => {
    const guildId = 'guild-admin-blank-reason';
    const userId = 'user-admin-blank-reason';
    const moderator = { id: 'admin-blank-reason' } as User;
    const member = buildMember(guildId, userId);

    await buildService().openAdminCase(member, moderator, {
      action: 'open_case',
      reason: '   ',
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      reason: 'No reason provided.',
    });
    expect(detectionEvents[0].reasons[0]).toBe('Admin case opened by <@admin-blank-reason>.');
    const detectionResult = notificationManager.upsertSuspiciousUserNotification.mock.calls[0][1];
    expect(detectionResult.triggerSource).toBe(DetectionType.ADMIN_CASE);
    expect(detectionResult.triggerContent).toBe('Opened by <@admin-blank-reason>');
  });

  it('preserves trusted admin case metadata over caller metadata', async () => {
    const guildId = 'guild-admin-metadata-spoof';
    const userId = 'user-admin-metadata-spoof';
    const moderator = { id: 'admin-real' } as User;
    const member = buildMember(guildId, userId);

    await buildService().openAdminCase(member, moderator, {
      action: 'open_case',
      reason: 'real reason',
      metadata: {
        type: 'admin_role_intake',
        adminId: 'admin-spoofed',
        action: 'restrict',
        reason: 'spoofed reason',
      },
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'admin_role_intake',
      adminId: 'admin-real',
      action: 'open_case',
      reason: 'real reason',
    });
  });

  it('posts an observed alert for user report without opening a case', async () => {
    const guildId = 'guild-3';
    const userId = 'user-3';
    const reporterId = 'reporter-1';
    const member = buildMember(guildId, userId);

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.handleUserReport(member, { id: reporterId } as User, 'reported');

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].detection_type).toBe(DetectionType.USER_REPORT);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'user_report',
      reporterId,
      content: 'reported',
    });

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(0);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'reported',
      })
    );
  });

  it('excludes user reports from accounting in detection test mode', async () => {
    const originalTestMode = process.env.DRASIL_DETECTION_TEST_MODE;
    const originalTestRunId = process.env.DRASIL_DETECTION_TEST_RUN_ID;
    process.env.DRASIL_DETECTION_TEST_MODE = 'true';
    process.env.DRASIL_DETECTION_TEST_RUN_ID = 'report-test-run';
    const guildId = 'guild-report-test-mode';
    const userId = 'user-report-test-mode';
    const member = buildMember(guildId, userId);

    try {
      await buildService().handleUserReport(
        member,
        { id: 'reporter-test-mode' } as User,
        'reported'
      );

      const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
      expect(detectionEvents).toHaveLength(1);
      expect(detectionEvents[0].metadata).toMatchObject({
        type: 'user_report',
        test_mode: true,
        test_run_id: 'report-test-run',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'system:test-mode',
        accounting_exclusion_reason: 'Detection test mode',
      });
      await expect(
        detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
      ).resolves.toHaveLength(0);
    } finally {
      if (originalTestMode === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_MODE;
      } else {
        process.env.DRASIL_DETECTION_TEST_MODE = originalTestMode;
      }
      if (originalTestRunId === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_RUN_ID;
      } else {
        process.env.DRASIL_DETECTION_TEST_RUN_ID = originalTestRunId;
      }
    }
  });

  it('stores enabled report AI triage as sanitized detection metadata and notification context', async () => {
    const guildId = 'guild-report-ai';
    const userId = 'user-report-ai';
    const reporterId = 'reporter-ai';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'hints',
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValue({
      result: 'likely_abusive',
      confidence: 0.96,
      summary: 'Report text indicates targeted abuse.',
      reasonCodes: ['harassment'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely targeted abuse'],
      recommendedAction: 'restrict',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });

    await buildService().handleUserReport(member, { id: reporterId } as User, 'targeted abuse');

    expect(gptService.analyzeReportEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: guildId,
        targetUserId: userId,
        reporterId,
        reportReason: 'targeted abuse',
      })
    );
    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      report_ai: {
        result: 'likely_abusive',
        recommendedAction: 'manual_review',
      },
    });
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        reportAiAnalysis: expect.objectContaining({
          result: 'likely_abusive',
          recommendedAction: 'manual_review',
        }),
      })
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('caps report AI recommendations by configured thresholds without taking action', async () => {
    const guildId = 'guild-report-ai-threshold';
    const userId = 'user-report-ai-threshold';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'restrict',
        report_ai_open_case_threshold: 0.85,
        report_ai_restrict_threshold: 0.95,
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValue({
      result: 'likely_abusive',
      confidence: 0.9,
      summary: 'Report text indicates targeted abuse.',
      reasonCodes: ['harassment'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely targeted abuse'],
      recommendedAction: 'restrict',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });

    await buildService().handleUserReport(member, { id: 'reporter-threshold' } as User, 'abuse');

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      report_ai: {
        recommendedAction: 'open_case',
      },
    });
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
  });

  it('continues storing user reports when report AI analysis fails', async () => {
    const guildId = 'guild-report-ai-fails';
    const userId = 'user-report-ai-fails';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
      },
    });
    gptService.analyzeReportEvidence.mockRejectedValueOnce(new Error('OpenAI unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        buildService().handleUserReport(member, { id: 'reporter-ai-fails' } as User, 'reported')
      ).resolves.toBe(true);
    } finally {
      warnSpy.mockRestore();
    }

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].metadata?.report_ai).toBeUndefined();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ triggerSource: DetectionType.USER_REPORT })
    );
  });

  it('opens a user-facing case for confirmed report intake when configured and report AI meets threshold', async () => {
    const guildId = 'guild-intake-open-case';
    const userId = 'user-intake-open-case';
    const reporterId = 'reporter-intake-open-case';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_intake_confirmed_response_mode: 'open_case',
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'open_case',
        report_ai_open_case_threshold: 0.85,
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValueOnce({
      result: 'likely_abusive',
      confidence: 0.9,
      summary: 'Report evidence needs moderator case review.',
      reasonCodes: ['harassment'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely targeted abuse'],
      recommendedAction: 'open_case',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });

    await buildService().handleConfirmedReportIntake(member, { id: reporterId } as User, {
      reason: 'intake evidence summary',
      intakeId: 'intake-open-case',
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents[0].metadata).toMatchObject({
      source: 'report_intake',
      reportIntakeId: 'intake-open-case',
      report_ai: { recommendedAction: 'open_case' },
    });
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('warns when confirmed report intake escalation is blocked by report AI max action', async () => {
    const guildId = 'guild-intake-max-action-hints';
    const userId = 'user-intake-max-action-hints';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_intake_confirmed_response_mode: 'open_case',
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'hints',
        report_ai_open_case_threshold: 0.85,
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValueOnce({
      result: 'likely_abusive',
      confidence: 0.9,
      summary: 'Report evidence would otherwise meet case threshold.',
      reasonCodes: ['harassment'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely targeted abuse'],
      recommendedAction: 'open_case',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await buildService().handleConfirmedReportIntake(member, { id: 'reporter-intake' } as User, {
        reason: 'intake evidence summary',
        intakeId: 'intake-max-action-hints',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to observed_alert')
      );
    } finally {
      warnSpy.mockRestore();
    }

    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
  });

  it('restricts a confirmed report intake only when configured and report AI meets restrict threshold', async () => {
    const guildId = 'guild-intake-restrict';
    const userId = 'user-intake-restrict';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_intake_confirmed_response_mode: 'restrict',
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'restrict',
        report_ai_open_case_threshold: 0.85,
        report_ai_restrict_threshold: 0.95,
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValueOnce({
      result: 'likely_abusive',
      confidence: 0.96,
      summary: 'Report evidence meets configured restrict threshold.',
      reasonCodes: ['harassment'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely targeted abuse'],
      recommendedAction: 'restrict',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });

    await buildService().handleConfirmedReportIntake(member, { id: 'reporter-intake' } as User, {
      reason: 'intake evidence summary',
      intakeId: 'intake-restrict',
    });

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).not.toHaveBeenCalled();
  });

  it('auto-kicks confirmed report intake only when kick policy and strict report analysis allow it', async () => {
    const guildId = 'guild-intake-kick';
    const userId = 'user-intake-kick';
    const member = buildMember(guildId, userId);
    const botUser = { id: 'bot-1' } as User;
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_intake_confirmed_response_mode: 'kick',
        report_intake_auto_kick_enabled: true,
        auto_kick_min_confidence_threshold: 95,
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'restrict',
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValueOnce({
      result: 'likely_abusive',
      confidence: 0.96,
      summary: 'Report evidence shows a high-confidence compromise scam.',
      reasonCodes: ['scam'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely compromised account scam'],
      recommendedAction: 'restrict',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });

    await buildService({ user: botUser } as Client).handleConfirmedReportIntake(
      member,
      { id: 'reporter-intake' } as User,
      {
        reason: 'intake evidence summary',
        intakeId: 'intake-kick',
      }
    );

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(userModerationService.kickUser).toHaveBeenCalledWith(
      member,
      'Suspected compromised account: high-confidence scam activity detected by Drasil.',
      botUser,
      detectionEvents[0].id
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).not.toHaveBeenCalled();
  });

  it('falls back to observed alert when report intake kick route is configured but policy is disabled', async () => {
    const guildId = 'guild-intake-kick-disabled';
    const userId = 'user-intake-kick-disabled';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        report_intake_confirmed_response_mode: 'kick',
        report_intake_auto_kick_enabled: false,
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
        report_ai_max_action: 'restrict',
      },
    });
    gptService.analyzeReportEvidence.mockResolvedValueOnce({
      result: 'likely_abusive',
      confidence: 0.99,
      summary: 'Report evidence would otherwise meet kick threshold.',
      reasonCodes: ['scam'],
      evidenceCategories: ['report_text'],
      concerns: ['Likely compromised account scam'],
      recommendedAction: 'restrict',
      analyzedImageCount: 0,
      model: 'gpt-4o-mini',
      promptVersion: 'report-triage-v1',
      isFallback: false,
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await buildService().handleConfirmedReportIntake(member, { id: 'reporter-intake' } as User, {
        reason: 'intake evidence summary',
        intakeId: 'intake-kick-disabled',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('falling back to observed_alert')
      );
    } finally {
      warnSpy.mockRestore();
    }

    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalled();
  });

  it('does not create duplicate detection events when confirmed report intake submission is retried', async () => {
    const guildId = 'guild-intake-retry';
    const userId = 'user-intake-retry';
    const intakeId = 'intake-retry';
    const member = buildMember(guildId, userId);
    const service = buildService();

    await service.handleConfirmedReportIntake(member, { id: 'reporter-intake' } as User, {
      reason: 'intake evidence summary',
      intakeId,
    });
    await service.handleConfirmedReportIntake(member, { id: 'reporter-intake' } as User, {
      reason: 'intake evidence summary',
      intakeId,
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].metadata).toMatchObject({ reportIntakeId: intakeId });
  });

  it('fails user report submission when the observed alert cannot be delivered', async () => {
    const guildId = 'guild-report-alert-fails';
    const userId = 'user-report-alert-fails';
    const reporterId = 'reporter-alert-fails';
    const member = buildMember(guildId, userId);
    notificationManager.upsertObservedDetectionNotification.mockResolvedValueOnce(null);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        buildService().handleUserReport(member, { id: reporterId } as User, 'reported')
      ).rejects.toThrow('Failed to send or update report observed alert');
    } finally {
      consoleError.mockRestore();
    }

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
  });

  it('records a user-installed message report without opening a server case', async () => {
    const service = buildService();

    await service.handleMessageReport(
      { id: 'user-5', username: 'target-user' } as User,
      { id: 'reporter-5' } as User,
      {
        messageId: 'message-5',
        channelId: 'dm-channel-5',
        content: 'suspicious DM',
      }
    );

    const detectionEvent = await detectionEventsRepository.findById('det-1');
    expect(detectionEvent).toMatchObject({
      server_id: null,
      user_id: 'user-5',
      detection_type: DetectionType.USER_REPORT,
      message_id: 'message-5',
      channel_id: 'dm-channel-5',
      metadata: {
        type: 'user_installed_message_report',
        reporterId: 'reporter-5',
        targetUserId: 'user-5',
        targetUsername: 'target-user',
        channelId: 'dm-channel-5',
        messageId: 'message-5',
        content: 'suspicious DM',
      },
    });
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('marks user-installed message reports as globally excluded in detection test mode', async () => {
    const originalTestMode = process.env.DRASIL_DETECTION_TEST_MODE;
    const originalTestRunId = process.env.DRASIL_DETECTION_TEST_RUN_ID;
    process.env.DRASIL_DETECTION_TEST_MODE = 'true';
    process.env.DRASIL_DETECTION_TEST_RUN_ID = 'global-report-test-run';

    try {
      await buildService().handleMessageReport(
        { id: 'user-global-test', username: 'target-user' } as User,
        { id: 'reporter-global-test' } as User,
        {
          messageId: 'message-global-test',
          channelId: 'dm-channel-global-test',
          content: 'suspicious DM',
        }
      );

      const detectionEvent = await detectionEventsRepository.findById('det-1');
      expect(detectionEvent?.metadata).toMatchObject({
        type: 'user_installed_message_report',
        test_mode: true,
        test_run_id: 'global-report-test-run',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'global',
        accounting_excluded_by: 'system:test-mode',
        accounting_exclusion_reason: 'Detection test mode',
      });
    } finally {
      if (originalTestMode === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_MODE;
      } else {
        process.env.DRASIL_DETECTION_TEST_MODE = originalTestMode;
      }
      if (originalTestRunId === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_RUN_ID;
      } else {
        process.env.DRASIL_DETECTION_TEST_RUN_ID = originalTestRunId;
      }
    }
  });

  it('posts observed alerts for message reports from the same guild', async () => {
    const guildId = 'guild-local-message';
    const userId = 'user-local-message';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'off',
      },
    });
    await serverMemberRepository.upsertMember(guildId, userId, {});
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    const service = buildService(client);

    await service.handleMessageReport(
      { id: userId, username: 'target-user' } as User,
      { id: 'reporter-local-message' } as User,
      {
        messageId: 'message-local',
        channelId: 'channel-local',
        guildId,
        content: 'local suspicious message',
      }
    );

    const globalDetectionEvent = await detectionEventsRepository.findById('det-1');
    expect(globalDetectionEvent).toMatchObject({
      server_id: null,
      metadata: {
        type: 'guild_message_report',
        guildId,
      },
    });

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0]).toMatchObject({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      message_id: 'message-local',
      channel_id: 'channel-local',
      metadata: {
        type: 'message_report',
        globalReportId: 'det-1',
        reporterId: 'reporter-local-message',
        sourceGuildId: guildId,
        sourceChannelId: 'channel-local',
      },
    });
    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(0);
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'local suspicious message',
      })
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('continues storing local message reports when report AI analysis fails', async () => {
    const guildId = 'guild-local-message-ai-fails';
    const userId = 'user-local-message-ai-fails';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'off',
        report_ai_triage_enabled: true,
        report_ai_analyze_text: true,
      },
    });
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    gptService.analyzeReportEvidence.mockRejectedValueOnce(new Error('OpenAI unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        buildService(client).handleMessageReport(
          { id: userId, username: 'target-user' } as User,
          { id: 'reporter-local-message' } as User,
          {
            messageId: 'message-local',
            channelId: 'channel-local',
            guildId,
            content: 'local suspicious message',
          }
        )
      ).resolves.toBe(true);
    } finally {
      warnSpy.mockRestore();
    }

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].metadata?.report_ai).toBeUndefined();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ triggerSource: DetectionType.USER_REPORT })
    );
  });

  it('posts local message report alerts even when the target has no stored member row', async () => {
    const guildId = 'guild-local-untracked-message';
    const userId = 'user-local-untracked-message';
    const member = buildMember(guildId, userId);
    await serverRepository.upsertByGuildId(guildId, {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'off',
      },
    });
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    const service = buildService(client);

    await service.handleMessageReport(
      { id: userId, username: 'target-user' } as User,
      { id: 'reporter-local-message' } as User,
      {
        messageId: 'message-local',
        channelId: 'channel-local',
        guildId,
        content: 'local suspicious message',
        reason: 'reported from native context menu',
      }
    );

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'message_report',
      reason: 'reported from native context menu',
    });
    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(0);
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'reported from native context menu',
      })
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('notifies opted-in servers for external message reports', async () => {
    const member = buildMember('guild-external-1', 'user-6');
    await serverRepository.upsertByGuildId('guild-external-1', {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
      },
    });
    await serverMemberRepository.upsertMember('guild-external-1', 'user-6', {});
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    const service = buildService(client);

    await service.handleMessageReport(
      { id: 'user-6', username: 'target-user' } as User,
      { id: 'reporter-6' } as User,
      {
        messageId: 'message-6',
        channelId: 'dm-channel-6',
        content: 'external suspicious DM',
      }
    );

    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'external suspicious DM',
      })
    );
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('posts observed alerts in open-case opted-in servers for external message reports', async () => {
    const member = buildMember('guild-external-2', 'user-7');
    await serverRepository.upsertByGuildId('guild-external-2', {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'open_case',
      },
    });
    await serverMemberRepository.upsertMember('guild-external-2', 'user-7', {});
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    const service = buildService(client);

    await service.handleMessageReport(
      { id: 'user-7', username: 'target-user' } as User,
      { id: 'reporter-7' } as User,
      {
        messageId: 'message-7',
        channelId: 'dm-channel-7',
        content: 'external suspicious DM',
      }
    );

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      'user-7',
      'guild-external-2'
    );
    expect(verificationEvents).toHaveLength(0);
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'external suspicious DM',
      })
    );
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
  });

  it('continues notify-only message report fan-out when one server notification fails', async () => {
    const firstMember = buildMember('guild-external-fail', 'user-8');
    const secondMember = buildMember('guild-external-success', 'user-8');
    await serverRepository.upsertByGuildId('guild-external-fail', {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
      },
    });
    await serverRepository.upsertByGuildId('guild-external-success', {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
      },
    });
    await serverMemberRepository.upsertMember('guild-external-fail', 'user-8', {});
    await serverMemberRepository.upsertMember('guild-external-success', 'user-8', {});
    const client = {
      guilds: {
        fetch: jest.fn().mockImplementation((guildId: string) =>
          Promise.resolve({
            members: {
              fetch: jest
                .fn()
                .mockResolvedValue(guildId === 'guild-external-fail' ? firstMember : secondMember),
            },
          })
        ),
      },
    } as unknown as Client;
    notificationManager.upsertObservedDetectionNotification
      .mockRejectedValueOnce(new Error('notification unavailable'))
      .mockResolvedValue({ id: 'observe-2' } as Message);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = buildService(client);

    await expect(
      service.handleMessageReport(
        { id: 'user-8', username: 'target-user' } as User,
        { id: 'reporter-8' } as User,
        {
          messageId: 'message-8',
          channelId: 'dm-channel-8',
          content: 'external suspicious DM',
        }
      )
    ).resolves.toBe(true);

    try {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to process message report fan-out for guild guild-external-fail:',
        expect.any(Error)
      );
      expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledTimes(2);
      expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
      const firstDetections = await detectionEventsRepository.findByServerAndUser(
        'guild-external-fail',
        'user-8'
      );
      const secondDetections = await detectionEventsRepository.findByServerAndUser(
        'guild-external-success',
        'user-8'
      );
      expect(firstDetections).toHaveLength(1);
      expect(secondDetections).toHaveLength(1);
      expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('continues open-case message report fan-out when one server notification fails', async () => {
    const member = buildMember('guild-external-fail', 'user-9');
    await serverRepository.upsertByGuildId('guild-external-fail', {
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'open_case',
      },
    });
    await serverMemberRepository.upsertMember('guild-external-fail', 'user-9', {});
    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;
    notificationManager.upsertObservedDetectionNotification.mockRejectedValueOnce(
      new Error('notification unavailable')
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = buildService(client);

    try {
      await expect(
        service.handleMessageReport(
          { id: 'user-9', username: 'target-user' } as User,
          { id: 'reporter-9' } as User,
          {
            messageId: 'message-9',
            channelId: 'dm-channel-9',
            content: 'external suspicious DM',
          }
        )
      ).resolves.toBe(true);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to process message report fan-out for guild guild-external-fail:',
        expect.any(Error)
      );
      expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('creates detection event for manual flag', async () => {
    const guildId = 'guild-4';
    const userId = 'user-4';
    const moderatorId = 'admin-1';
    const member = buildMember(guildId, userId);

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.handleManualFlag(member, { id: moderatorId } as User, 'manual flag');

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].detection_type).toBe(DetectionType.ADMIN_FLAG);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'admin_flag',
      adminId: moderatorId,
    });
    expect(userModerationService.restrictUser).toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
  });

  it('excludes manual admin flags from accounting in detection test mode', async () => {
    const originalTestMode = process.env.DRASIL_DETECTION_TEST_MODE;
    const originalTestRunId = process.env.DRASIL_DETECTION_TEST_RUN_ID;
    process.env.DRASIL_DETECTION_TEST_MODE = 'true';
    process.env.DRASIL_DETECTION_TEST_RUN_ID = 'manual-flag-test-run';
    const guildId = 'guild-manual-flag-test-mode';
    const userId = 'user-manual-flag-test-mode';
    const moderatorId = 'admin-manual-flag-test-mode';
    const member = buildMember(guildId, userId);

    try {
      await buildService().handleManualFlag(member, { id: moderatorId } as User, 'manual flag');

      const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
      expect(detectionEvents).toHaveLength(1);
      expect(detectionEvents[0].metadata).toMatchObject({
        type: 'admin_flag',
        adminId: moderatorId,
        test_mode: true,
        test_run_id: 'manual-flag-test-run',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'system:test-mode',
        accounting_exclusion_reason: 'Detection test mode',
      });
      await expect(
        detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
      ).resolves.toHaveLength(0);
    } finally {
      if (originalTestMode === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_MODE;
      } else {
        process.env.DRASIL_DETECTION_TEST_MODE = originalTestMode;
      }
      if (originalTestRunId === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_RUN_ID;
      } else {
        process.env.DRASIL_DETECTION_TEST_RUN_ID = originalTestRunId;
      }
    }
  });

  it('adds a user report to an existing pending case without creating a duplicate case', async () => {
    const guildId = 'guild-4a';
    const userId = 'user-4a';
    const reporterId = 'reporter-2';
    const member = buildMember(guildId, userId);

    const initialDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    const activeCase = await verificationEventRepository.createFromDetection(
      initialDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    await buildService().handleUserReport(member, { id: reporterId } as User, 'follow-up report');

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(2);
    const reportEvent = detectionEvents.find(
      (event) => event.detection_type === DetectionType.USER_REPORT
    );
    expect(reportEvent?.latest_verification_event_id).toBe(activeCase.id);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('adds a manual flag to an existing review-only pending case and restricts the user', async () => {
    const guildId = 'guild-4b';
    const userId = 'user-4b';
    const moderatorId = 'admin-2';
    const member = buildMember(guildId, userId);

    const initialDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Initial report'],
      detected_at: new Date(),
    });
    const activeCase = await verificationEventRepository.createFromDetection(
      initialDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    await buildService().handleManualFlag(member, { id: moderatorId } as User, 'admin follow-up');

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(2);
    const manualFlagEvent = detectionEvents.find((event) => event.metadata?.type === 'admin_flag');
    expect(manualFlagEvent?.metadata).toMatchObject({
      type: 'admin_flag',
      adminId: moderatorId,
    });
    expect(manualFlagEvent?.latest_verification_event_id).toBe(activeCase.id);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: moderatorId })
    );
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('restricts the user when auto-detection follows an existing review-only pending case', async () => {
    const guildId = 'guild-4b-auto';
    const userId = 'user-4b-auto';
    const member = buildMember(guildId, userId);
    const message = buildMessage(guildId, 'channel-4b-auto');

    const initialDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Initial report'],
      detected_at: new Date(),
    });
    const activeCase = await verificationEventRepository.createFromDetection(
      initialDetection.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 0.88,
      reasons: ['Suspicious content after report'],
      triggerSource: DetectionType.SUSPICIOUS_CONTENT,
      triggerContent: message.content,
    };

    await buildService().handleSuspiciousMessage(member, detectionResult, message);

    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    expect(detectionEvents).toHaveLength(2);
    const autoDetectionEvent = detectionEvents.find(
      (event) => event.detection_type === DetectionType.SUSPICIOUS_CONTENT
    );
    expect(autoDetectionEvent?.latest_verification_event_id).toBe(activeCase.id);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('posts an observed alert when a user report follows a resolved case', async () => {
    const guildId = 'guild-4c';
    const userId = 'user-4c';
    const reporterId = 'reporter-3';
    const member = buildMember(guildId, userId);

    const initialDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Initial detection'],
      detected_at: new Date(),
    });
    await verificationEventRepository.createFromDetection(
      initialDetection.id,
      guildId,
      userId,
      VerificationStatus.VERIFIED
    );

    await buildService().handleUserReport(member, { id: reporterId } as User, 'new report');

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.VERIFIED);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertObservedDetectionNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'new report',
      })
    );
  });

  it('opens a new pending case when a manual flag follows a resolved case', async () => {
    const guildId = 'guild-4d';
    const userId = 'user-4d';
    const moderatorId = 'admin-3';
    const member = buildMember(guildId, userId);

    const initialDetection = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Initial report'],
      detected_at: new Date(),
    });
    await verificationEventRepository.createFromDetection(
      initialDetection.id,
      guildId,
      userId,
      VerificationStatus.BANNED
    );

    await buildService().handleManualFlag(member, { id: moderatorId } as User, 'new admin flag');

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(2);
    expect(verificationEvents.map((event) => event.status).sort()).toEqual([
      VerificationStatus.BANNED,
      VerificationStatus.PENDING,
    ]);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: moderatorId })
    );
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
  });

  it('opens and audits a case from an observed detection', async () => {
    const guildId = 'guild-observed-open';
    const userId = 'user-observed-open';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await serverRepository.updateSettings(guildId, { observed_action_kick_enabled: true });
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.88,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { content: 'free discord nitro' },
    });

    await buildService().openObservedDetectionCase(member, detectionEvent.id, moderator);

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_event_id: detectionEvent.id,
        verification_event_id: verificationEvents[0].id,
        action_type: AdminActionType.OPEN_CASE,
      })
    );
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'opened a verification case',
      moderator,
      AdminActionType.OPEN_CASE
    );
  });

  it('converts an observed alert notification into the case notification when opening a case', async () => {
    const guildId = 'guild-observed-adopt';
    const userId = 'user-observed-adopt';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.88,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        content: 'free discord nitro',
        observed_notification_channel_id: 'alerts-channel',
        observed_notification_message_id: 'observed-message',
        observed_evidence_thread_id: 'observed-evidence-thread',
      },
    });
    notificationManager.upsertSuspiciousUserNotification.mockImplementation(
      async (_member, _detectionResult, verificationEvent) =>
        ({
          id: verificationEvent.notification_message_id ?? 'new-message',
          channelId: verificationEvent.notification_channel_id ?? 'new-channel',
        }) as Message
    );

    await buildService().openObservedDetectionCase(member, detectionEvent.id, moderator);

    const [verificationEvent] = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvent).toEqual(
      expect.objectContaining({
        notification_channel_id: 'alerts-channel',
        notification_message_id: 'observed-message',
        private_evidence_thread_id: 'observed-evidence-thread',
        metadata: expect.objectContaining({
          case_origin: 'observed_alert',
          observed_detection_event_id: detectionEvent.id,
        }),
      })
    );
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
    expect(notificationManager.logActionToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ notification_message_id: 'observed-message' }),
      AdminActionType.OPEN_CASE,
      moderator
    );
  });

  it('recreates missing threads for observed user reports as user-facing case threads', async () => {
    const guildId = 'guild-observed-report-open';
    const userId = 'user-observed-report-open';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Reported by user reporter-observed. Reason: suspicious DM'],
      detected_at: new Date(),
      metadata: { type: 'user_report', reporterId: 'reporter-observed', content: 'suspicious DM' },
    });
    const existingCase = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );

    await buildService().openObservedDetectionCase(member, detectionEvent.id, moderator);

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: existingCase.id })
    );
  });

  it('does not action an already handled observed detection', async () => {
    const guildId = 'guild-observed-actioned';
    const userId = 'user-observed-actioned';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.88,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { observed_action: AdminActionType.DISMISS },
    });

    const opened = await buildService().openObservedDetectionCase(
      member,
      detectionEvent.id,
      moderator
    );

    expect(opened).toBe(false);
    expect(await verificationEventRepository.findByUserAndServer(userId, guildId)).toHaveLength(0);
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('records false positive dismissal without opening a case', async () => {
    const guildId = 'guild-observed-dismiss';
    const userId = 'user-observed-dismiss';
    const moderator = { id: 'admin-observed' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });

    await buildService().dismissObservedDetection(
      guildId,
      userId,
      detectionEvent.id,
      moderator,
      AdminActionType.FALSE_POSITIVE
    );

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(0);
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_event_id: detectionEvent.id,
        verification_event_id: null,
        action_type: AdminActionType.FALSE_POSITIVE,
      })
    );
    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.FALSE_POSITIVE,
      observed_action_by: moderator.id,
      excluded_from_accounting: true,
      accounting_exclusion_scope: 'server',
      accounting_excluded_by: moderator.id,
      accounting_exclusion_reason: 'Marked false positive',
    });
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'marked this detection as a false positive',
      moderator,
      AdminActionType.FALSE_POSITIVE
    );
  });

  it('marks an existing detection as ignored for future accounting', async () => {
    const guildId = 'guild-audit-ignore';
    const userId = 'user-audit-ignore';
    const moderator = { id: 'admin-audit' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });

    const updatedDetection = await buildService().excludeDetectionFromAccounting(
      guildId,
      detectionEvent.id,
      moderator,
      'testing false positive'
    );

    expect(updatedDetection?.metadata).toMatchObject({
      excluded_from_accounting: true,
      accounting_exclusion_scope: 'server',
      accounting_excluded_by: moderator.id,
      accounting_exclusion_reason: 'testing false positive',
    });
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_event_id: detectionEvent.id,
        action_type: AdminActionType.FALSE_POSITIVE,
        notes: 'testing false positive',
      })
    );
    await expect(
      detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
    ).resolves.toHaveLength(0);
  });

  it('does not record an ignore audit action when accounting metadata cannot be updated', async () => {
    const guildId = 'guild-audit-ignore-write-fails';
    const userId = 'user-audit-ignore-write-fails';
    const moderator = { id: 'admin-audit' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    const metadataWrite = jest
      .spyOn(detectionEventsRepository, 'markExcludedFromAccounting')
      .mockRejectedValueOnce(new Error('Metadata write failed'));

    await expect(
      buildService().excludeDetectionFromAccounting(
        guildId,
        detectionEvent.id,
        moderator,
        'testing false positive'
      )
    ).rejects.toThrow('Metadata write failed');

    expect(adminActionService.recordAction).not.toHaveBeenCalled();
    metadataWrite.mockRestore();
  });

  it('rolls back ignored accounting metadata when ignore audit recording fails', async () => {
    const guildId = 'guild-audit-ignore-audit-fails';
    const userId = 'user-audit-ignore-audit-fails';
    const moderator = { id: 'admin-audit' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: { preserved: 'value' },
    });
    adminActionService.recordAction.mockRejectedValueOnce(new Error('Audit write failed'));

    await expect(
      buildService().excludeDetectionFromAccounting(
        guildId,
        detectionEvent.id,
        moderator,
        'testing false positive'
      )
    ).rejects.toThrow('Audit write failed');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata).toEqual({ preserved: 'value' });
    await expect(
      detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
    ).resolves.toHaveLength(1);
  });

  it('allows configured global admins to ignore global detections', async () => {
    const originalGlobalAdmins = process.env.DRASIL_GLOBAL_ADMIN_IDS;
    process.env.DRASIL_GLOBAL_ADMIN_IDS = 'admin-global';
    const moderator = { id: 'admin-global' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: null,
      user_id: 'user-global',
      detection_type: DetectionType.USER_REPORT,
      confidence: 1,
      reasons: ['External report'],
      detected_at: new Date(),
    });

    try {
      const updatedDetection = await buildService().excludeDetectionFromAccounting(
        'guild-context',
        detectionEvent.id,
        moderator,
        'global test false positive'
      );

      expect(updatedDetection?.metadata).toMatchObject({
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'global',
        accounting_excluded_by: moderator.id,
        accounting_exclusion_reason: 'global test false positive',
      });
      expect(adminActionService.recordAction).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: null,
          user_id: 'user-global',
          action_type: AdminActionType.FALSE_POSITIVE,
        })
      );
    } finally {
      if (originalGlobalAdmins === undefined) {
        delete process.env.DRASIL_GLOBAL_ADMIN_IDS;
      } else {
        process.env.DRASIL_GLOBAL_ADMIN_IDS = originalGlobalAdmins;
      }
    }
  });

  it('does not let global admins audit another server detection from the wrong guild', async () => {
    const originalGlobalAdmins = process.env.DRASIL_GLOBAL_ADMIN_IDS;
    process.env.DRASIL_GLOBAL_ADMIN_IDS = 'admin-global';
    const moderator = { id: 'admin-global' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: 'owning-guild',
      user_id: 'user-cross-server',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.95,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });

    try {
      const updatedDetection = await buildService().excludeDetectionFromAccounting(
        'other-guild',
        detectionEvent.id,
        moderator,
        'cross-guild attempt'
      );

      expect(updatedDetection).toBeNull();
      expect(adminActionService.recordAction).not.toHaveBeenCalled();
      await expect(
        detectionEventsRepository.findCountedByServerAndUser('owning-guild', 'user-cross-server')
      ).resolves.toHaveLength(1);
    } finally {
      if (originalGlobalAdmins === undefined) {
        delete process.env.DRASIL_GLOBAL_ADMIN_IDS;
      } else {
        process.env.DRASIL_GLOBAL_ADMIN_IDS = originalGlobalAdmins;
      }
    }
  });

  it('restores an ignored detection to future accounting', async () => {
    const guildId = 'guild-audit-restore';
    const userId = 'user-audit-restore';
    const moderator = { id: 'admin-audit' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'previous-admin',
        accounting_excluded_at: new Date().toISOString(),
        accounting_exclusion_reason: 'Marked false positive',
      },
    });

    const updatedDetection = await buildService().restoreDetectionAccounting(
      guildId,
      detectionEvent.id,
      moderator,
      'restored after review'
    );

    expect(updatedDetection?.metadata?.excluded_from_accounting).toBeUndefined();
    expect(updatedDetection?.metadata?.accounting_exclusion_scope).toBeUndefined();
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_event_id: detectionEvent.id,
        action_type: AdminActionType.UNDO_OBSERVED_ACTION,
        notes: 'restored after review',
      })
    );
    await expect(
      detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
    ).resolves.toHaveLength(1);
  });

  it('restores observed false-positive actions when restoring accounting', async () => {
    const guildId = 'guild-audit-restore-observed';
    const userId = 'user-audit-restore-observed';
    const moderator = { id: 'admin-audit' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        observed_action: AdminActionType.FALSE_POSITIVE,
        observed_action_by: 'previous-admin',
        observed_action_at: new Date().toISOString(),
        observed_notification_message_id: 'observed-message-1',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'previous-admin',
        accounting_excluded_at: new Date().toISOString(),
        accounting_exclusion_reason: 'Marked false positive',
      },
    });

    const updatedDetection = await buildService().restoreDetectionAccounting(
      guildId,
      detectionEvent.id,
      moderator,
      'restored after review'
    );

    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.excluded_from_accounting).toBeUndefined();
    expect(notificationManager.restoreObservedDetectionActions).toHaveBeenCalledWith(
      detectionEvent.id,
      'restored this detection to future accounting',
      moderator
    );
  });

  it('rolls back restored accounting metadata when restore audit recording fails', async () => {
    const guildId = 'guild-audit-restore-audit-fails';
    const userId = 'user-audit-restore-audit-fails';
    const moderator = { id: 'admin-audit' } as User;
    const excludedAt = new Date().toISOString();
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.92,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'previous-admin',
        accounting_excluded_at: excludedAt,
        accounting_exclusion_reason: 'Marked false positive',
      },
    });
    adminActionService.recordAction.mockRejectedValueOnce(new Error('Audit write failed'));

    await expect(
      buildService().restoreDetectionAccounting(
        guildId,
        detectionEvent.id,
        moderator,
        'restored after review'
      )
    ).rejects.toThrow('Audit write failed');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata).toMatchObject({
      excluded_from_accounting: true,
      accounting_exclusion_scope: 'server',
      accounting_excluded_by: 'previous-admin',
      accounting_excluded_at: excludedAt,
      accounting_exclusion_reason: 'Marked false positive',
    });
    expect(notificationManager.restoreObservedDetectionActions).not.toHaveBeenCalled();
    await expect(
      detectionEventsRepository.findCountedByServerAndUser(guildId, userId)
    ).resolves.toHaveLength(0);
  });

  it('undoes an observed false positive dismissal and restores actions', async () => {
    const guildId = 'guild-observed-undo';
    const userId = 'user-observed-undo';
    const moderator = { id: 'admin-observed' } as User;
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        observed_action: AdminActionType.FALSE_POSITIVE,
        observed_action_by: 'previous-admin',
        observed_action_at: new Date().toISOString(),
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'previous-admin',
        accounting_excluded_at: new Date().toISOString(),
        accounting_exclusion_reason: 'Marked false positive',
      },
    });

    const undoneAction = await buildService().undoObservedDetectionAction(
      guildId,
      userId,
      detectionEvent.id,
      moderator
    );

    expect(undoneAction).toBe(AdminActionType.FALSE_POSITIVE);
    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.observed_action_by).toBeUndefined();
    expect(updatedDetection?.metadata?.excluded_from_accounting).toBeUndefined();
    expect(updatedDetection?.metadata?.accounting_exclusion_scope).toBeUndefined();
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        detection_event_id: detectionEvent.id,
        verification_event_id: null,
        action_type: AdminActionType.UNDO_OBSERVED_ACTION,
        notes: 'Undid dismissal and reverted false positive indication.',
      })
    );
    expect(notificationManager.restoreObservedDetectionActions).toHaveBeenCalledWith(
      detectionEvent.id,
      'undid the dismissal and reverted the false positive indication',
      moderator
    );
  });

  it('restores observed dismissal metadata if undo audit recording fails', async () => {
    const guildId = 'guild-observed-undo-fails';
    const userId = 'user-observed-undo-fails';
    const moderator = { id: 'admin-observed' } as User;
    const observedActionAt = new Date().toISOString();
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
      metadata: {
        observed_action: AdminActionType.DISMISS,
        observed_action_by: 'previous-admin',
        observed_action_at: observedActionAt,
      },
    });
    adminActionService.recordAction.mockRejectedValueOnce(new Error('Audit write failed'));

    await expect(
      buildService().undoObservedDetectionAction(guildId, userId, detectionEvent.id, moderator)
    ).rejects.toThrow('Audit write failed');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.DISMISS,
      observed_action_by: 'previous-admin',
      observed_action_at: observedActionAt,
    });
    expect(notificationManager.restoreObservedDetectionActions).not.toHaveBeenCalled();
  });

  it('releases an observed ban claim when the ban fails', async () => {
    const guildId = 'guild-observed-ban-fails';
    const userId = 'user-observed-ban-fails';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    userModerationService.banUser.mockRejectedValueOnce(new Error('Missing permissions'));

    await expect(
      buildService().banObservedDetection(member, detectionEvent.id, moderator, 'Confirmed scam')
    ).rejects.toThrow('Missing permissions');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.observed_action_by).toBeUndefined();
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('releases an observed ban claim when the ban service returns false', async () => {
    const guildId = 'guild-observed-ban-false';
    const userId = 'user-observed-ban-false';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    userModerationService.banUser.mockResolvedValueOnce(false);

    await expect(
      buildService().banObservedDetection(member, detectionEvent.id, moderator, 'Confirmed scam')
    ).rejects.toThrow('Failed to ban user test-user#0001');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.observed_action_by).toBeUndefined();
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('keeps an observed ban claim when only notification update fails after banning', async () => {
    const guildId = 'guild-observed-ban-notify-fails';
    const userId = 'user-observed-ban-notify-fails';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    notificationManager.markObservedDetectionActionTaken.mockRejectedValueOnce(
      new Error('Discord unavailable')
    );

    await expect(
      buildService().banObservedDetection(member, detectionEvent.id, moderator, 'Confirmed scam')
    ).rejects.toThrow('Discord unavailable');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(userModerationService.banUser).toHaveBeenCalledWith(
      member,
      'Confirmed scam',
      moderator,
      detectionEvent.id
    );
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.BAN,
      observed_action_by: moderator.id,
    });
  });

  it('kicks an observed detection while preserving observed action provenance', async () => {
    const guildId = 'guild-observed-kick';
    const userId = 'user-observed-kick';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await serverRepository.updateSettings(guildId, { observed_action_kick_enabled: true });
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });

    await expect(
      buildService().kickObservedDetection(
        member,
        detectionEvent.id,
        moderator,
        'Suspected compromised account'
      )
    ).resolves.toBe(true);

    expect(userModerationService.kickUser).toHaveBeenCalledWith(
      member,
      'Suspected compromised account',
      moderator,
      detectionEvent.id
    );
    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.KICK,
      observed_action_by: moderator.id,
    });
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: guildId,
        user_id: userId,
        detection_event_id: detectionEvent.id,
        action_type: AdminActionType.KICK,
        notes: 'Suspected compromised account',
      })
    );
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'kicked this user',
      moderator,
      AdminActionType.KICK
    );
  });

  it('releases an observed kick claim when the kick service returns false', async () => {
    const guildId = 'guild-observed-kick-false';
    const userId = 'user-observed-kick-false';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    await serverRepository.getOrCreateServer(guildId);
    await serverRepository.updateSettings(guildId, { observed_action_kick_enabled: true });
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    userModerationService.kickUser.mockResolvedValueOnce(false);

    await expect(
      buildService().kickObservedDetection(member, detectionEvent.id, moderator, 'Compromised')
    ).rejects.toThrow('Failed to kick user test-user#0001');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.observed_action_by).toBeUndefined();
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('rejects observed kick before claiming metadata when policy is disabled', async () => {
    const guildId = 'guild-observed-kick-disabled';
    const userId = 'user-observed-kick-disabled';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });

    await expect(
      buildService().kickObservedDetection(member, detectionEvent.id, moderator, 'Compromised')
    ).rejects.toThrow('Observed alert kick actions are disabled by server policy.');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(userModerationService.kickUser).not.toHaveBeenCalled();
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
  });

  it('uses a verification thread when restricting an observed user report', async () => {
    const guildId = 'guild-observed-report-restrict';
    const userId = 'user-observed-report-restrict';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Reported by user reporter-observed. Reason: suspicious DM'],
      detected_at: new Date(),
      metadata: { type: 'user_report', reporterId: 'reporter-observed', content: 'suspicious DM' },
    });

    await buildService().restrictObservedDetection(member, detectionEvent.id, moderator);

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'restricted this user',
      moderator,
      AdminActionType.RESTRICT
    );
  });

  it('releases an observed restrict claim when restriction returns false', async () => {
    const guildId = 'guild-observed-restrict-false';
    const userId = 'user-observed-restrict-false';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    userModerationService.restrictUser.mockResolvedValueOnce(false);

    await expect(
      buildService().restrictObservedDetection(member, detectionEvent.id, moderator)
    ).rejects.toThrow('Failed to restrict user test-user#0001');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(updatedDetection?.metadata?.observed_action).toBeUndefined();
    expect(updatedDetection?.metadata?.observed_action_by).toBeUndefined();
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('upgrades an existing report review thread when restricting a user report', async () => {
    const guildId = 'guild-observed-existing-report-restrict';
    const userId = 'user-observed-existing-report-restrict';
    const moderator = { id: 'admin-observed' } as User;
    const reporter = { id: 'reporter-observed' } as User;
    const member = buildMember(guildId, userId);
    const service = buildService();

    await service.handleUserReport(member, reporter, 'suspicious DM');
    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    const reportDetection = detectionEvents.find(
      (event) => event.detection_type === DetectionType.USER_REPORT
    );
    const reviewEvent = await verificationEventRepository.createFromDetection(
      reportDetection!.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(reviewEvent.id, {
      thread_id: 'review-thread-1',
      metadata: {
        [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
      },
    });
    threadManager.createVerificationThread.mockClear();

    await service.restrictObservedDetection(member, reportDetection!.id, moderator);

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
  });

  it('restricts an observed user report even when the missing case thread cannot be recreated', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const guildId = 'guild-observed-report-restrict-thread-fails';
    const userId = 'user-observed-report-restrict-thread-fails';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Reported by user reporter-observed. Reason: suspicious DM'],
      detected_at: new Date(),
      metadata: { type: 'user_report', reporterId: 'reporter-observed', content: 'suspicious DM' },
    });
    const existingCase = await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    threadManager.createVerificationThread.mockResolvedValueOnce(null);

    try {
      await expect(
        buildService().restrictObservedDetection(member, detectionEvent.id, moderator)
      ).resolves.toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }

    const updatedCase = await verificationEventRepository.findById(existingCase.id);
    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(updatedCase?.thread_id).toBeNull();
    expect(getVerificationActionFailures(updatedCase?.metadata)).toEqual([
      expect.objectContaining({
        action: 'thread',
        message: 'Failed to create verification thread for test-user#0001',
      }),
    ]);
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.RESTRICT,
      observed_action_by: moderator.id,
    });
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ triggerSource: DetectionType.USER_REPORT }),
      expect.objectContaining({ id: existingCase.id, thread_id: null }),
      undefined
    );
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'restricted this user',
      moderator,
      AdminActionType.RESTRICT
    );
  });

  it('bans an observed user report without creating a verification thread', async () => {
    const guildId = 'guild-observed-report-ban';
    const userId = 'user-observed-report-ban';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: ['Reported by user reporter-observed. Reason: suspicious DM'],
      detected_at: new Date(),
      metadata: { type: 'user_report', reporterId: 'reporter-observed', content: 'suspicious DM' },
    });

    await buildService().banObservedDetection(
      member,
      detectionEvent.id,
      moderator,
      'Confirmed scam'
    );

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.banUser).toHaveBeenCalledWith(
      member,
      'Confirmed scam',
      moderator,
      detectionEvent.id
    );
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'banned this user',
      moderator,
      AdminActionType.BAN
    );
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: AdminActionType.BAN,
        detection_event_id: detectionEvent.id,
        verification_event_id: null,
        notes: 'Confirmed scam',
      })
    );
  });

  it('does not upgrade an existing report review thread when banning a user report', async () => {
    const guildId = 'guild-observed-existing-report-ban';
    const userId = 'user-observed-existing-report-ban';
    const moderator = { id: 'admin-observed' } as User;
    const reporter = { id: 'reporter-observed' } as User;
    const member = buildMember(guildId, userId);
    const service = buildService();

    await service.handleUserReport(member, reporter, 'suspicious DM');
    const detectionEvents = await detectionEventsRepository.findByServerAndUser(guildId, userId);
    const reportDetection = detectionEvents.find(
      (event) => event.detection_type === DetectionType.USER_REPORT
    );
    const reviewEvent = await verificationEventRepository.createFromDetection(
      reportDetection!.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    await verificationEventRepository.update(reviewEvent.id, {
      thread_id: 'review-thread-1',
      metadata: {
        [VERIFICATION_THREAD_TYPE_METADATA_KEY]: REPORT_REVIEW_THREAD_TYPE,
      },
    });
    threadManager.createVerificationThread.mockClear();

    await service.banObservedDetection(member, reportDetection!.id, moderator, 'Confirmed scam');

    expect(threadManager.createReportReviewThread).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.banUser).toHaveBeenCalledWith(
      member,
      'Confirmed scam',
      moderator,
      reportDetection!.id
    );
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: AdminActionType.BAN,
        detection_event_id: reportDetection!.id,
        verification_event_id: reviewEvent.id,
        notes: 'Confirmed scam',
      })
    );
  });

  it('does not duplicate observed ban audit when ban service already records it', async () => {
    const guildId = 'guild-observed-ban-existing-audit';
    const userId = 'user-observed-ban-existing-audit';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    await verificationEventRepository.createFromDetection(
      detectionEvent.id,
      guildId,
      userId,
      VerificationStatus.PENDING
    );
    adminActionService.getActionsForUser.mockResolvedValueOnce([
      {
        detection_event_id: detectionEvent.id,
        action_type: AdminActionType.BAN,
      } as any,
    ]);

    await buildService().banObservedDetection(
      member,
      detectionEvent.id,
      moderator,
      'Confirmed scam'
    );

    expect(adminActionService.recordAction).not.toHaveBeenCalled();
  });

  it('keeps an observed restrict claim when audit fails after restricting', async () => {
    const guildId = 'guild-observed-restrict-audit-fails';
    const userId = 'user-observed-restrict-audit-fails';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
    const detectionEvent = await detectionEventsRepository.create({
      server_id: guildId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.82,
      reasons: ['Suspicious content'],
      detected_at: new Date(),
    });
    adminActionService.recordAction.mockRejectedValueOnce(new Error('DB unavailable'));

    await expect(
      buildService().restrictObservedDetection(member, detectionEvent.id, moderator)
    ).rejects.toThrow('DB unavailable');

    const updatedDetection = await detectionEventsRepository.findById(detectionEvent.id);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(updatedDetection?.metadata).toMatchObject({
      observed_action: AdminActionType.RESTRICT,
      observed_action_by: moderator.id,
    });
    expect(notificationManager.markObservedDetectionActionTaken).not.toHaveBeenCalled();
  });

  it('reopens verification and re-restricts the user', async () => {
    const guildId = 'guild-5';
    const userId = 'user-5';
    const moderator = { id: 'admin-2' } as User;
    const member = buildMember(guildId, userId);

    const verificationEvent = await verificationEventRepository.createFromDetection(
      null,
      guildId,
      userId,
      VerificationStatus.VERIFIED
    );

    const client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
      adminActionService,
      threadManager,
      userModerationService,
      client
    );

    await service.reopenVerification(verificationEvent, moderator);

    const updatedEvent = await verificationEventRepository.findById(verificationEvent.id);
    expect(updatedEvent?.status).toBe(VerificationStatus.PENDING);
    expect(updatedEvent?.resolved_at).toBeNull();
    expect(updatedEvent?.resolved_by).toBeNull();
    expect(threadManager.reopenVerificationThread).toHaveBeenCalledWith(verificationEvent);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(notificationManager.logActionToMessage).toHaveBeenCalledWith(
      verificationEvent,
      AdminActionType.REOPEN,
      moderator
    );
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalledWith(
      verificationEvent,
      VerificationStatus.PENDING
    );

    expect(adminActionService.recordAction).toHaveBeenCalledWith({
      server_id: guildId,
      user_id: userId,
      admin_id: moderator.id,
      verification_event_id: verificationEvent.id,
      action_type: AdminActionType.REOPEN,
      previous_status: VerificationStatus.VERIFIED,
      new_status: VerificationStatus.PENDING,
      notes: null,
    });
  });
});
