import {
  ButtonInteraction,
  Client,
  Guild,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  User,
} from 'discord.js';
import { InteractionHandler } from '../../controllers/InteractionHandler';
import { INotificationManager } from '../../services/NotificationManager';
import { IUserModerationService } from '../../services/UserModerationService';
import { ISecurityActionService } from '../../services/SecurityActionService';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { IThreadManager } from '../../services/ThreadManager';
import { IAdminActionRepository } from '../../repositories/AdminActionRepository';
import { VerificationEvent, VerificationStatus } from '../../repositories/types';

const buildMember = (guildId: string, userId: string): GuildMember =>
  ({
    id: userId,
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
    } as User,
  }) as unknown as GuildMember;

const buildInteraction = (customId: string, guildId: string, user: User): ButtonInteraction =>
  ({
    customId,
    guildId,
    user,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ButtonInteraction;

describe('InteractionHandler (unit)', () => {
  let client: Client;
  let userModerationService: jest.Mocked<IUserModerationService>;
  let securityActionService: jest.Mocked<ISecurityActionService>;
  let notificationManager: jest.Mocked<INotificationManager>;
  let verificationEventRepository: jest.Mocked<IVerificationEventRepository>;
  let threadManager: jest.Mocked<IThreadManager>;
  let adminActionRepository: jest.Mocked<IAdminActionRepository>;

  beforeEach(() => {
    const member = buildMember('guild-1', 'user-1');
    client = {
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          members: {
            fetch: jest.fn().mockResolvedValue(member),
          },
        }),
      },
    } as unknown as Client;

    userModerationService = {
      restrictUser: jest.fn().mockResolvedValue(true),
      verifyUser: jest.fn().mockResolvedValue(true),
      banUser: jest.fn().mockResolvedValue(true),
    };
    securityActionService = {
      handleSuspiciousMessage: jest.fn().mockResolvedValue(true),
      handleSuspiciousJoin: jest.fn().mockResolvedValue(true),
      handleManualFlag: jest.fn().mockResolvedValue(true),
      handleUserReport: jest.fn().mockResolvedValue(true),
      reopenVerification: jest.fn().mockResolvedValue(true),
    };
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue(null),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
    };
    verificationEventRepository = {
      findActiveByUserAndServer: jest.fn(),
      findByUserAndServer: jest.fn(),
      findByDetectionEvent: jest.fn(),
      createFromDetection: jest.fn(),
      getVerificationHistory: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
    };
    threadManager = {
      createVerificationThread: jest
        .fn()
        .mockResolvedValue({ url: 'https://discord.com/channels/thread-1' } as any),
      resolveVerificationThread: jest.fn(),
      reopenVerificationThread: jest.fn(),
    };
    adminActionRepository = {
      findByUserAndServer: jest.fn(),
      findByAdmin: jest.fn(),
      findByVerificationEvent: jest.fn(),
      createAction: jest.fn(),
      getActionHistory: jest.fn(),
    };
  });

  it('handles verify button by calling UserModerationService', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('verify_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.verifyUser).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'User <@user-1> has been verified and can now access the server.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles ban button by calling UserModerationService', async () => {
    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('ban_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(userModerationService.banUser).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'User <@user-1> has been banned from the server.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles thread button and creates a verification thread', async () => {
    const verificationEvent: VerificationEvent = {
      id: 'ver-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_event_id: null,
      thread_id: null,
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
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('thread_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);

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
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('reopen_user-1', 'guild-1', {
      id: 'admin-1',
    } as User);

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

  it('handles report modal submission', async () => {
    const member = buildMember('guild-1', '123456789012345678');
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn().mockResolvedValue(member),
      },
    });

    const handler = new InteractionHandler(
      client,
      notificationManager,
      userModerationService,
      securityActionService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    const interaction = {
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: 'reporter-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === 'report_target_user_input') {
            return '123456789012345678';
          }
          return 'reported';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Thank you for your report regarding <@123456789012345678>. It has been submitted for review.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
