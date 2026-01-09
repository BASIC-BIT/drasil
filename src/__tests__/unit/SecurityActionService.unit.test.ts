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
import { IThreadManager } from '../../services/ThreadManager';
import { IUserModerationService } from '../../services/UserModerationService';

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
    };
    threadManager = {
      createVerificationThread: jest
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

    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
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

    await verificationEventRepository.createFromDetection(
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
      detectionEventId: detectionEvent.id,
    };

    const service = new SecurityActionService(
      notificationManager,
      detectionEventsRepository,
      serverMemberRepository,
      verificationEventRepository,
      userRepository,
      serverRepository,
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
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('creates detection event for user report', async () => {
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
    });
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
  });
});
