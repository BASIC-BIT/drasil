import {
  ButtonInteraction,
  ChannelType,
  Client,
  Guild,
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionFlagsBits,
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
  USER_REPORT_REASON_MAX_LENGTH,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';

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

const buildInteraction = (customId: string, guildId: string, user: User): ButtonInteraction => {
  const interaction = {
    customId,
    guildId,
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
    showModal: jest.fn().mockResolvedValue(undefined),
  };
  return interaction as unknown as ButtonInteraction;
};

const grantInteractionPermissions = (interaction: ButtonInteraction): void => {
  Object.assign(interaction, {
    memberPermissions: { has: jest.fn().mockReturnValue(true) },
  });
};

const grantOnlyBanMembersPermission = (interaction: ButtonInteraction): void => {
  Object.assign(interaction, {
    memberPermissions: {
      has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.BanMembers),
    },
  });
};

describe('InteractionHandler (unit)', () => {
  let client: Client;
  let userModerationService: jest.Mocked<IUserModerationService>;
  let securityActionService: jest.Mocked<ISecurityActionService>;
  let notificationManager: jest.Mocked<INotificationManager>;
  let configService: jest.Mocked<IConfigService>;
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
      openCaseForSuspiciousMessage: jest.fn().mockResolvedValue(true),
      openCaseForSuspiciousJoin: jest.fn().mockResolvedValue(true),
      handleManualFlag: jest.fn().mockResolvedValue(true),
      handleUserReport: jest.fn().mockResolvedValue(true),
      handleMessageReport: jest.fn().mockResolvedValue(true),
      openObservedDetectionCase: jest.fn().mockResolvedValue(true),
      restrictObservedDetection: jest.fn().mockResolvedValue(true),
      banObservedDetection: jest.fn().mockResolvedValue(true),
      dismissObservedDetection: jest.fn().mockResolvedValue(true),
      undoObservedDetectionAction: jest.fn().mockResolvedValue(AdminActionType.DISMISS),
      reopenVerification: jest.fn().mockResolvedValue(true),
    };
    notificationManager = {
      upsertSuspiciousUserNotification: jest.fn().mockResolvedValue(null),
      logActionToMessage: jest.fn().mockResolvedValue(true),
      setupVerificationChannel: jest.fn().mockResolvedValue('channel-1'),
      handleHistoryButtonClick: jest.fn().mockResolvedValue(true),
      updateNotificationButtons: jest.fn().mockResolvedValue(undefined),
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      upsertObservedDetectionNotification: jest.fn().mockResolvedValue(null),
      markObservedDetectionActionTaken: jest.fn().mockResolvedValue(true),
      restoreObservedDetectionActions: jest.fn().mockResolvedValue(true),
    };
    configService = {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn(),
      getServerConfig: jest.fn().mockResolvedValue({}),
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
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('verify_user-1', 'guild-1', {
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

  it('handles ban button by calling UserModerationService', async () => {
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
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );
    const interaction = buildInteraction('thread_user-1', 'guild-1', {
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
    const interaction = buildInteraction('reopen_user-1', 'guild-1', {
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

  it('allows ban button with only BanMembers permission', async () => {
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

    expect(userModerationService.banUser).toHaveBeenCalledTimes(1);
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
    const interaction = buildInteraction('observed:open:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);
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

  it('shows observed ban modal using configured reason policy', async () => {
    (configService.getServerConfig as jest.Mock).mockResolvedValue({
      settings: { observed_action_ban_requires_reason: true },
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
    const interaction = buildInteraction('observed:false_positive:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);
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

  it('acknowledges observed popup action before fetching permissions', async () => {
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
    const interaction = buildInteraction('observed:false_positive:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (client.guilds.fetch as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(securityActionService.dismissObservedDetection).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'det-1',
      interaction.user,
      AdminActionType.FALSE_POSITIVE
    );
  });

  it('keeps observed popup permission denial private after acknowledgement', async () => {
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
    const interaction = buildInteraction('observed:dismiss:user-1:det-1', 'guild-1', {
      id: 'viewer-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'You need moderation permissions to dismiss an alert.',
      components: [],
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
    const interaction = buildInteraction('observed:undo_dismiss:user-1:det-1', 'guild-1', {
      id: 'admin-1',
    } as User);
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
      configService,
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
      allowedMentions: { parse: [] },
    });
  });

  it('returns a friendly report modal error when the member leaves before submission completes', async () => {
    const member = buildMember('guild-1', '123456789012345678');
    const membersFetch = jest
      .fn()
      .mockResolvedValueOnce(member)
      .mockRejectedValueOnce(new Error('member left'));
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
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

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Could not find a user matching "123456789012345678" in this server.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles report modal submission with a modern username', async () => {
    const member = {
      ...buildMember('guild-1', '123456789012345678'),
      displayName: 'Basic Bit',
      nickname: null,
      user: {
        id: '123456789012345678',
        username: 'basic_bit',
        globalName: 'Basic Bit',
        discriminator: '0',
        tag: 'basic_bit',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [member][Symbol.iterator]()),
    };
    const membersFetch = jest.fn().mockImplementation(async (id?: string) => {
      if (id === member.id) {
        return member;
      }
      return null;
    });
    const membersSearch = jest.fn().mockResolvedValue(memberCollection);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
        search: membersSearch,
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
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: 'reporter-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === 'report_target_user_input') {
            return 'basic_bit';
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

    expect(membersSearch).toHaveBeenCalledWith({ query: 'basic_bit', limit: 100 });
    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
  });

  it('handles report modal submission with an at-prefixed legacy username tag', async () => {
    const member = {
      ...buildMember('guild-1', '123456789012345678'),
      user: {
        id: '123456789012345678',
        username: 'LegacyUser',
        globalName: null,
        discriminator: '1234',
        tag: 'LegacyUser#1234',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [member][Symbol.iterator]()),
    };
    const membersFetch = jest.fn().mockImplementation(async (id?: string) => {
      if (id === member.id) {
        return member;
      }
      return null;
    });
    const membersSearch = jest.fn().mockResolvedValue(memberCollection);
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: membersFetch,
        search: membersSearch,
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
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: 'reporter-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === 'report_target_user_input') {
            return '@legacyuser#1234';
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

    expect(membersSearch).toHaveBeenCalledWith({ query: 'legacyuser', limit: 100 });
    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      member,
      interaction.user,
      'reported'
    );
  });

  it('rejects ambiguous report modal name matches', async () => {
    const firstMember = {
      ...buildMember('guild-1', '123456789012345678'),
      displayName: 'Same Name',
      nickname: null,
      user: {
        id: '123456789012345678',
        username: 'first_user',
        globalName: 'Same Name',
        discriminator: '0',
        tag: 'first_user',
      },
    } as unknown as GuildMember;
    const secondMember = {
      ...buildMember('guild-1', '223456789012345678'),
      displayName: 'Same Name',
      nickname: null,
      user: {
        id: '223456789012345678',
        username: 'second_user',
        globalName: 'Same Name',
        discriminator: '0',
        tag: 'second_user',
      },
    } as unknown as GuildMember;
    const memberCollection = {
      values: jest.fn(() => [firstMember, secondMember][Symbol.iterator]()),
    };
    (client.guilds.fetch as jest.Mock).mockResolvedValue({
      members: {
        fetch: jest.fn(),
        search: jest.fn().mockResolvedValue(memberCollection),
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
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: 'reporter-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === 'report_target_user_input') {
            return 'Same Name';
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

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Multiple users match that name. Please use their ID or @mention instead.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('requires report modal reason when configured', async () => {
    configService.getServerConfig.mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    } as any);

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
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: 'reporter-1' } as User,
      fields: {
        getTextInputValue: jest.fn((id: string) => {
          if (id === 'report_target_user_input') {
            return '123456789012345678';
          }
          return '   ';
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    } as unknown as ModalSubmitInteraction;

    await handler.handleModalSubmit(interaction);

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Please include a reason for this report.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects report modal self-reports', async () => {
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
      configService,
      verificationEventRepository,
      threadManager,
      adminActionRepository
    );

    const interaction = {
      customId: 'report_user_modal_submit',
      guildId: 'guild-1',
      user: { id: '123456789012345678' } as User,
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

    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You cannot report yourself.',
      flags: MessageFlags.Ephemeral,
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
    });
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
  });

  it('auto-creates verification channel when field is blank', async () => {
    (notificationManager.setupVerificationChannel as jest.Mock).mockResolvedValue(
      '123456789012345681'
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

    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
      expect.anything(),
      '123456789012345678',
      false
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

  it('routes report button clicks to show the report modal', async () => {
    configService.getCachedServerConfig.mockReturnValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    } as any);

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
    const interaction = buildInteraction('report_user_initiate', 'guild-1', {
      id: 'reporter-1',
    } as User);

    await handler.handleButtonInteraction(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalArg = (interaction.showModal as jest.Mock).mock.calls[0][0] as any;
    const modalJson = modalArg.toJSON();
    expect(modalJson.custom_id).toBe('report_user_modal_submit');
    expect(modalJson.components[0].components[0].label).toBe('User ID, mention, or username');
    expect(modalJson.components[0].components[0].placeholder).toBe(
      '123456789012345678, @username, or username'
    );
    expect(modalJson.components[1].components[0].label).toBe('Reason');
    expect(modalJson.components[1].components[0].max_length).toBe(USER_REPORT_REASON_MAX_LENGTH);
    expect(modalJson.components[1].components[0].required).toBe(true);
    expect(configService.getCachedServerConfig).toHaveBeenCalledWith('guild-1');
    expect(configService.getServerConfig).not.toHaveBeenCalled();
  });
});
