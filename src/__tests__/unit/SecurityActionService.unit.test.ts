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
import { IAdminActionService } from '../../services/AdminActionService';

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

    adminActionService = {
      recordAction: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<IAdminActionService>;
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
      client
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
    });

    const verificationEvents = await verificationEventRepository.findByUserAndServer(
      userId,
      guildId
    );
    expect(verificationEvents).toHaveLength(1);
    expect(verificationEvents[0].status).toBe(VerificationStatus.PENDING);
    expect(userModerationService.restrictUser).toHaveBeenCalled();
    expect(threadManager.createVerificationThread).toHaveBeenCalled();
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

  it('adds a manual flag to an existing pending case without creating a duplicate case', async () => {
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
    expect(userModerationService.restrictUser).not.toHaveBeenCalled();
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
    expect(notificationManager.upsertSuspiciousUserNotification).toHaveBeenCalledTimes(1);
  });

  it('opens a new pending case when a user report follows a resolved case', async () => {
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
    expect(verificationEvents).toHaveLength(2);
    expect(verificationEvents.map((event) => event.status).sort()).toEqual([
      VerificationStatus.PENDING,
      VerificationStatus.VERIFIED,
    ]);
    expect(userModerationService.restrictUser).toHaveBeenCalledWith(member);
    expect(threadManager.createVerificationThread).toHaveBeenCalledTimes(1);
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
