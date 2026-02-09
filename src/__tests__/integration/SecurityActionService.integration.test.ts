import { Client, Guild, GuildMember, Message, User } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { SecurityActionService } from '../../services/SecurityActionService';
import { AdminActionService } from '../../services/AdminActionService';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { AdminActionRepository } from '../../repositories/AdminActionRepository';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { AdminActionType, DetectionType, VerificationStatus } from '../../repositories/types';
import { getPrismaClient } from '../testDb';
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

const describeIntegration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('SecurityActionService (integration)', () => {
  let prisma: PrismaClient;
  let detectionEventsRepository: DetectionEventsRepository;
  let adminActionRepository: AdminActionRepository;
  let serverMemberRepository: ServerMemberRepository;
  let verificationEventRepository: VerificationEventRepository;
  let userRepository: UserRepository;
  let serverRepository: ServerRepository;
  let adminActionService: AdminActionService;

  let notificationManager: jest.Mocked<INotificationManager>;
  let threadManager: jest.Mocked<IThreadManager>;
  let userModerationService: jest.Mocked<IUserModerationService>;

  beforeEach(() => {
    prisma = getPrismaClient();
    detectionEventsRepository = new DetectionEventsRepository(prisma);
    adminActionRepository = new AdminActionRepository(prisma);
    serverMemberRepository = new ServerMemberRepository(prisma);
    verificationEventRepository = new VerificationEventRepository(prisma);
    userRepository = new UserRepository(prisma);
    serverRepository = new ServerRepository(prisma);
    adminActionService = new AdminActionService(
      adminActionRepository,
      userRepository,
      serverRepository
    );
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
      adminActionService,
      threadManager,
      userModerationService,
      {} as Client
    );

    await service.handleSuspiciousMessage(member, detectionResult, message);

    const detectionEvents = await prisma.detection_events.findMany();
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].detection_type).toBe(DetectionType.SUSPICIOUS_CONTENT);

    const verificationEvents = await prisma.verification_events.findMany();
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

    const verificationEvents = await prisma.verification_events.findMany();
    expect(verificationEvents).toHaveLength(1);
    expect(threadManager.createVerificationThread).not.toHaveBeenCalled();
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

    const detectionEvents = await prisma.detection_events.findMany();
    expect(detectionEvents).toHaveLength(1);
    expect(detectionEvents[0].detection_type).toBe(DetectionType.USER_REPORT);
    expect(detectionEvents[0].metadata).toMatchObject({
      type: 'user_report',
      reporterId,
    });
  });

  it('records an admin action when reopening verification', async () => {
    const guildId = 'guild-4';
    const userId = 'user-4';
    const moderatorId = 'admin-1';
    const member = buildMember(guildId, userId);

    await serverRepository.getOrCreateServer(guildId);
    await userRepository.getOrCreateUser(userId, member.user.username);

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

    await service.reopenVerification(verificationEvent, { id: moderatorId } as User);

    const actions = await prisma.admin_actions.findMany();
    expect(actions).toHaveLength(1);
    expect(actions[0].action_type).toBe(AdminActionType.REOPEN);
    expect(actions[0].previous_status).toBe(VerificationStatus.VERIFIED);
    expect(actions[0].new_status).toBe(VerificationStatus.PENDING);
    expect(actions[0].admin_id).toBe(moderatorId);
    expect(actions[0].server_id).toBe(guildId);
    expect(actions[0].user_id).toBe(userId);
    expect(actions[0].verification_event_id).toBe(verificationEvent.id);
  });
});
