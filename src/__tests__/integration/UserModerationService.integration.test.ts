import { Guild, GuildMember, User } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { UserModerationService } from '../../services/UserModerationService';
import { ServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { AdminActionRepository } from '../../repositories/AdminActionRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { ServerRepository } from '../../repositories/ServerRepository';
import { AdminActionService } from '../../services/AdminActionService';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { AdminActionType, DetectionType, VerificationStatus } from '../../repositories/types';
import { getPrismaClient } from '../testDb';
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
  }) as GuildMember;

const describeIntegration =
  process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('UserModerationService (integration)', () => {
  let prisma: PrismaClient;
  let serverMemberRepository: ServerMemberRepository;
  let verificationEventRepository: VerificationEventRepository;
  let adminActionRepository: AdminActionRepository;
  let userRepository: UserRepository;
  let serverRepository: ServerRepository;
  let detectionEventsRepository: DetectionEventsRepository;
  let adminActionService: AdminActionService;
  let roleManager: jest.Mocked<IRoleManager>;
  let notificationManager: jest.Mocked<INotificationManager>;
  let threadManager: jest.Mocked<IThreadManager>;

  beforeEach(() => {
    prisma = getPrismaClient();
    serverMemberRepository = new ServerMemberRepository(prisma);
    verificationEventRepository = new VerificationEventRepository(prisma);
    adminActionRepository = new AdminActionRepository(prisma);
    userRepository = new UserRepository(prisma);
    serverRepository = new ServerRepository(prisma);
    detectionEventsRepository = new DetectionEventsRepository(prisma);
    adminActionService = new AdminActionService(
      adminActionRepository,
      userRepository,
      serverRepository
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
    };
    threadManager = {
      createVerificationThread: jest.fn().mockResolvedValue({} as any),
      resolveVerificationThread: jest.fn().mockResolvedValue(true),
      reopenVerificationThread: jest.fn().mockResolvedValue(true),
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
      threadManager
    );

    await service.verifyUser(member, moderator);

    const updatedEvent = await prisma.verification_events.findUnique({
      where: { id: verificationEvent.id },
    });

    expect(updatedEvent?.status).toBe(VerificationStatus.VERIFIED);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();

    const serverMember = await prisma.server_members.findUnique({
      where: { server_id_user_id: { server_id: guildId, user_id: userId } },
    });
    expect(serverMember?.verification_status).toBe(VerificationStatus.VERIFIED);
    expect(serverMember?.is_restricted).toBe(false);

    const adminActions = await prisma.admin_actions.findMany();
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].action_type).toBe(AdminActionType.VERIFY);

    expect(roleManager.removeRestrictedRole).toHaveBeenCalled();
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.VERIFIED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalled();
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
      threadManager
    );

    await service.banUser(member, 'banned in test', moderator);

    const updatedEvent = await prisma.verification_events.findUnique({
      where: { id: verificationEvent.id },
    });

    expect(updatedEvent?.status).toBe(VerificationStatus.BANNED);
    expect(updatedEvent?.resolved_by).toBe(moderator.id);
    expect(updatedEvent?.resolved_at).not.toBeNull();

    const serverMember = await prisma.server_members.findUnique({
      where: { server_id_user_id: { server_id: guildId, user_id: userId } },
    });
    expect(serverMember?.verification_status).toBe(VerificationStatus.BANNED);
    expect(serverMember?.is_restricted).toBe(true);

    const adminActions = await prisma.admin_actions.findMany();
    expect(adminActions).toHaveLength(1);
    expect(adminActions[0].action_type).toBe(AdminActionType.BAN);
    expect(adminActions[0].notes).toBe('banned in test');

    expect((member.ban as jest.Mock).mock.calls.length).toBe(1);
    expect(threadManager.resolveVerificationThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      VerificationStatus.BANNED,
      moderator.id
    );
    expect(notificationManager.logActionToMessage).toHaveBeenCalled();
    expect(notificationManager.updateNotificationButtons).toHaveBeenCalled();
  });
});
