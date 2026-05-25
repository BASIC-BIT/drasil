import { Client, Guild, GuildMember, Message, User } from 'discord.js';
import { SecurityActionService } from '../../services/SecurityActionService';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { AdminActionType, DetectionType, VerificationStatus } from '../../repositories/types';
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
import { getVerificationActionFailures } from '../../utils/verificationActionFailures';

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    joinedAt: new Date(),
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
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
      resolveVerificationThread: jest.fn().mockResolvedValue(true),
      reopenVerificationThread: jest.fn().mockResolvedValue(true),
    };
    userModerationService = {
      restrictUser: jest.fn().mockResolvedValue(true),
      verifyUser: jest.fn().mockResolvedValue(true),
      banUser: jest.fn().mockResolvedValue(true),
    };

    adminActionService = {
      recordAction: jest.fn().mockResolvedValue({} as any),
      getActionsForUser: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IAdminActionService>;
    gptService = {
      analyzeReportEvidence: jest.fn(),
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
    expect(detectionEvents[0].latest_verification_event_id).toBe(verificationEvents[0].id);

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
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

    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
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
    expect(detectionEvents[0].detection_type).toBe(DetectionType.GPT_ANALYSIS);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'admin_flag',
      adminId: moderatorId,
    });
    expect(userModerationService.restrictUser).toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
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
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
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
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
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
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
  });

  it('opens and audits a case from an observed detection', async () => {
    const guildId = 'guild-observed-open';
    const userId = 'user-observed-open';
    const moderator = { id: 'admin-observed' } as User;
    const member = buildMember(guildId, userId);
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
      moderator
    );
  });

  it('recreates missing threads for observed user reports as moderator-only review threads', async () => {
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

    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(threadManager.createReportReviewThread).toHaveBeenCalledWith(
      member,
      expect.objectContaining({ id: existingCase.id }),
      expect.objectContaining({
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: 'suspicious DM',
      }),
      undefined
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
    });
    expect(notificationManager.markObservedDetectionActionTaken).toHaveBeenCalledWith(
      detectionEvent.id,
      'marked this detection as a false positive',
      moderator,
      { undoButtonLabel: 'Undo False Positive' }
    );
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
      moderator
    );
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
      moderator
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
