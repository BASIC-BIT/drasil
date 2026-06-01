import {
  Client,
  ButtonInteraction,
  ButtonBuilder,
  MessageFlags,
  ChannelType,
  GuildMember,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  InteractionContextType,
  User,
  ModalSubmitInteraction,
  ButtonStyle,
  Guild,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import { AdminActionType, VerificationStatus } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';
import { IUserModerationService } from '../services/UserModerationService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IThreadManager } from '../services/ThreadManager';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import {
  ISecurityActionService,
  type MessageReportAttachment,
} from '../services/SecurityActionService';
import { IConfigService } from '../config/ConfigService';
import { ISetupDiagnosticsService } from '../services/SetupDiagnosticsService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import {
  DEFAULT_USER_REPORT_REASON_REQUIRED,
  getUserReportSettings,
  REPORT_MESSAGE_MODAL_PREFIX,
  REPORT_MESSAGE_REASON_FIELD_ID,
  USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH,
  USER_REPORT_REASON_MAX_LENGTH,
} from '../utils/userReportSettings';
import {
  parseChannelId,
  parseRoleId,
  SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_CHANNEL_FIELD_ID,
  SETUP_VERIFICATION_MODAL_ID,
  SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID,
} from '../constants/setupVerificationWizard';
// Load environment variables
dotenv.config();

const OBSERVED_ACTION_MODAL_REASON_FIELD_ID = 'observed_ban_reason';
const OBSERVED_BAN_DEFAULT_REASON = 'Banned from observed suspicious notification';
const VERIFICATION_BAN_MODAL_PREFIX = 'verification:ban_modal';
const VERIFICATION_BAN_NOTES_FIELD_ID = 'verification_ban_notes';
const VERIFICATION_BAN_DEFAULT_REASON = 'Banned by moderator during verification';
const REPORT_USER_TYPED_MODAL_ID = 'report_user_modal_submit';
const REPORT_USER_TARGET_FIELD_ID = 'report_target_user_input';
const REPORT_USER_REASON_FIELD_ID = 'report_reason';

type UserResolution =
  | { status: 'found'; userId: string }
  | { status: 'not_found' }
  | { status: 'ambiguous' };

/**
 * Interface for the Bot class
 */
export interface IInteractionHandler {
  /**
   * Handle a button interaction
   */
  handleButtonInteraction(interaction: ButtonInteraction): Promise<void>;

  /**
   * Handle a modal submission interaction
   */
  handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void>; // Added
}

@injectable()
export class InteractionHandler implements IInteractionHandler {
  private client: Client;
  private notificationManager: INotificationManager;
  private userModerationService: IUserModerationService;
  private securityActionService: ISecurityActionService;
  private configService: IConfigService;
  // TODO: Handlers calling a repository is a smell, and should be improved
  private verificationEventRepository: IVerificationEventRepository;
  private threadManager: IThreadManager;
  private adminActionRepository: IAdminActionRepository;
  private setupDiagnosticsService?: ISetupDiagnosticsService;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.AdminActionRepository) adminActionRepository: IAdminActionRepository,
    @inject(TYPES.SetupDiagnosticsService)
    @optional()
    setupDiagnosticsService?: ISetupDiagnosticsService
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;
    this.configService = configService;
    this.verificationEventRepository = verificationEventRepository;
    this.threadManager = threadManager;
    this.adminActionRepository = adminActionRepository;
    this.setupDiagnosticsService = setupDiagnosticsService;
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This button can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guildId = interaction.guildId;

    try {
      // Exact-match IDs must be routed before parsing action/user IDs.
      if (customId === 'report_user_initiate') {
        await this.handleReportUserInitiate(interaction);
        return;
      }

      if (customId.startsWith('observed:')) {
        await this.handleObservedButtonInteraction(interaction, guildId, customId);
        return;
      }

      const [action, targetUserId] = customId.split('_');
      if (!targetUserId) {
        await interaction.reply({
          content: 'Unknown button action',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      switch (action) {
        case 'verify':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to verify a user.'
            );
            return;
          }
          await this.handleVerifyButton(interaction, guildId, targetUserId);
          break;
        case 'ban':
          if (
            !(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need Ban Members permission to ban a user.'
            );
            return;
          }
          if (!(await this.canUseModeratorBanAction(guildId))) {
            await interaction.reply({
              content:
                'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await this.handleBanButton(interaction, targetUserId);
          break;
        case 'thread':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to create a verification thread.'
            );
            return;
          }
          await this.handleThreadButton(interaction, guildId, targetUserId);
          break;
        case 'history':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to view history.'
            );
            return;
          }
          await this.handleHistoryButton(interaction, guildId, targetUserId);
          break;
        case 'reopen':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to reopen verification.'
            );
            return;
          }
          await this.handleReopenButton(interaction, guildId, targetUserId);
          break;
        default:
          await interaction.reply({
            content: 'Unknown button action',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      const response = {
        content: 'An error occurred while processing your request.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }

  private async handleVerifyButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      await this.userModerationService.verifyUser(member, interaction.user);

      await interaction.followUp({
        content: `User <@${userId}> has been verified and can now access the server.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error verifying user:', error);
      await interaction.followUp({
        content: 'An error occurred while verifying the user.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleBanButton(interaction: ButtonInteraction, userId: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(`${VERIFICATION_BAN_MODAL_PREFIX}:${userId}`)
      .setTitle('Confirm User Ban');
    const notesInput = new TextInputBuilder()
      .setCustomId(VERIFICATION_BAN_NOTES_FIELD_ID)
      .setLabel('Final notes (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500)
      .setPlaceholder('Submitting this form bans the user. Add notes for the audit log.');

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput));
    await interaction.showModal(modal);
  }

  private async handleThreadButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild and member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        throw new Error('Could not find member in guild');
      }

      // Get the active verification event
      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        userId,
        guildId
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      // Create the thread
      const thread = await this.threadManager.createVerificationThread(member, verificationEvent);

      // Update the buttons to hide the Create Thread button
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING
      );

      if (!thread) {
        throw new Error('Failed to create verification thread');
      }

      // Update the buttons (this will remove the Create Thread button)
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING
      );

      await interaction.followUp({
        content: `Created verification thread: ${thread.url}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error creating verification thread:', error);
      await interaction.followUp({
        content: 'An error occurred while creating the verification thread.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleHistoryButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Get verification history with actions using the member object
      const history = await this.verificationEventRepository.findByUserAndServer(userId, guildId);

      // TODO: This is part of the reason why we don't put repositories in handlers, this is strictly a service concern
      const historyWithActions = await Promise.all(
        history.map(async (event) => ({
          ...event,
          actions: await this.adminActionRepository.findByVerificationEvent(event.id),
        }))
      );

      // Format history using our formatter
      const formattedHistory = VerificationHistoryFormatter.formatForDiscord(
        historyWithActions,
        userId
      );

      // Send as a text file if it's too long
      if (formattedHistory.length > 2000) {
        const plainTextHistory = VerificationHistoryFormatter.formatForFile(
          historyWithActions,
          userId
        );
        const buffer = Buffer.from(plainTextHistory, 'utf-8');
        await interaction.editReply({
          content: 'Here is the complete verification history:',
          files: [
            {
              attachment: buffer,
              name: `verification-history-${userId}.txt`,
            },
          ],
        });
      } else {
        await interaction.editReply({
          content: formattedHistory,
        });
      }
    } catch (error) {
      console.error('Error fetching verification history:', error);
      await interaction.editReply({
        content: 'An error occurred while fetching the verification history.',
      });
    }
  }

  private async handleReopenButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // TODO: We unlock the thread, but what actually updates the status? Is this a user moderation service concern?
      // Remind ourselves that the handler/controller layer should focus on user interaction concerns
      // Should we have a whole "display" layer, separate from our service layer (which is our business logic)?
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        userId,
        guildId
      );

      if (verificationEvents.length === 0) {
        throw new Error('No active verification event found');
      }

      const verificationEvent = verificationEvents[0];

      // Reopen the verification using VerificationService
      await this.securityActionService.reopenVerification(verificationEvent, interaction.user);

      await interaction.followUp({
        content: `Verification for <@${userId}> has been reopened. The user has been restricted again.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error reopening verification:', error);
      await interaction.followUp({
        content: 'An error occurred while reopening the verification.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleReportUserInitiate(interaction: ButtonInteraction): Promise<void> {
    const reasonRequired = await this.getUserReportReasonRequired(interaction.guildId ?? undefined);
    const modal = new ModalBuilder()
      .setCustomId(REPORT_USER_TYPED_MODAL_ID)
      .setTitle('Report a User');

    const targetUserInput = new TextInputBuilder()
      .setCustomId(REPORT_USER_TARGET_FIELD_ID)
      .setLabel('User ID, mention, or exact username')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Paste a user ID or @mention when possible')
      .setMaxLength(100)
      .setRequired(true);
    const reasonInput = new TextInputBuilder()
      .setCustomId(REPORT_USER_REASON_FIELD_ID)
      .setLabel(reasonRequired ? 'Context' : 'Context (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(
        'What happened? Include message links, screenshots, or other context if useful.'
      )
      .setMaxLength(USER_REPORT_REASON_MAX_LENGTH)
      .setRequired(reasonRequired);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(targetUserInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput)
    );

    await interaction.showModal(modal);
  }

  public async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    switch (interaction.customId) {
      case REPORT_USER_TYPED_MODAL_ID:
        await this.handleReportUserModalSubmit(interaction);
        return;
      case SETUP_VERIFICATION_MODAL_ID:
        await this.handleSetupVerificationModalSubmit(interaction);
        return;
      default:
        if (interaction.customId.startsWith(`${VERIFICATION_BAN_MODAL_PREFIX}:`)) {
          await this.handleVerificationBanModalSubmit(interaction);
          return;
        }
        if (interaction.customId.startsWith(`${REPORT_MESSAGE_MODAL_PREFIX}:`)) {
          await this.handleReportMessageModalSubmit(interaction);
          return;
        }
        if (interaction.customId.startsWith('observed:ban_modal:')) {
          await this.handleObservedBanModalSubmit(interaction);
          return;
        }
        console.log(
          `[InteractionHandler] Ignoring unknown modal submission: ${interaction.customId}`
        );
    }
  }

  private async handleVerificationBanModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.customId.slice(`${VERIFICATION_BAN_MODAL_PREFIX}:`.length);
    if (!userId) {
      await interaction.reply({
        content: 'Unknown ban action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.BanMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Ban Members permission to ban a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorBanAction(interaction.guildId))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const finalNotes = interaction.fields.getTextInputValue(VERIFICATION_BAN_NOTES_FIELD_ID).trim();
    const banReason = finalNotes || VERIFICATION_BAN_DEFAULT_REASON;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId);

      await this.userModerationService.banUser(member, banReason, interaction.user);

      await interaction.editReply({
        content: `User <@${userId}> has been banned from the server.`,
      });
    } catch (error) {
      console.error('Error banning user:', error);
      await interaction.editReply({
        content: 'An error occurred while banning the user.',
      });
    }
  }

  private async handleReportMessageModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const [, messageId, channelId, targetUserId, guildIdRaw, contextRaw] =
      interaction.customId.split(':');
    if (!messageId || !channelId || !targetUserId || !guildIdRaw || !contextRaw) {
      await interaction.reply({
        content: 'This report form is invalid. Please try reporting the message again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason =
      interaction.fields.getTextInputValue(REPORT_MESSAGE_REASON_FIELD_ID).trim() || undefined;
    const guildId = guildIdRaw === '0' ? undefined : guildIdRaw;
    if (guildId) {
      const reasonRequired = await this.getUserReportReasonRequired(guildId);
      if (reasonRequired && !reason) {
        await interaction.reply({
          content: 'Please include a reason for this report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const targetUser = await this.client.users.fetch(targetUserId).catch(
        () =>
          ({
            id: targetUserId,
            username: targetUserId,
          }) as User
      );
      const message = await this.fetchReportMessage(channelId, messageId);
      const contextNumber = Number(contextRaw);
      const interactionContext =
        contextRaw === 'x' || Number.isNaN(contextNumber)
          ? undefined
          : (contextNumber as InteractionContextType);

      const reportPayload = {
        messageId,
        channelId,
        guildId,
        content: message?.content.slice(0, USER_REPORT_MESSAGE_CONTENT_MAX_LENGTH),
        reason,
        interactionContext,
        ...(message?.attachments.length ? { attachments: message.attachments } : {}),
      };

      await this.securityActionService.handleMessageReport(
        targetUser,
        interaction.user,
        reportPayload
      );

      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUserId}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle message report modal for ${targetUserId}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  private async fetchReportMessage(
    channelId: string,
    messageId: string
  ): Promise<{ content: string; attachments: MessageReportAttachment[] } | null> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('messages' in channel)) {
      return null;
    }

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message || typeof message.content !== 'string') {
      return null;
    }

    const attachments = [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      contentType: attachment.contentType ?? undefined,
      size: attachment.size,
    }));

    return { content: message.content, attachments };
  }

  private async handleReportUserModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const targetUserInputString = interaction.fields.getTextInputValue(
        REPORT_USER_TARGET_FIELD_ID
      );
      const reason =
        interaction.fields.getTextInputValue(REPORT_USER_REASON_FIELD_ID).trim() || undefined;

      if (!targetUserInputString) {
        await interaction.reply({
          content:
            'Error: You must provide the user ID, mention, or username of the user to report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reasonRequired = await this.getUserReportReasonRequired(interaction.guildId);
      if (reasonRequired && !reason) {
        await interaction.editReply({
          content: 'Please include a reason for this report.',
        });
        return;
      }

      const targetUserResolution = await this.resolveUserId(
        interaction.guildId,
        targetUserInputString
      );
      if (targetUserResolution.status === 'not_found') {
        await interaction.editReply({
          content: `Could not find a user matching "${targetUserInputString}".`,
        });
        return;
      }

      if (targetUserResolution.status === 'ambiguous') {
        await interaction.editReply({
          content: 'Multiple users match that name. Please use their ID or @mention instead.',
        });
        return;
      }

      const targetUserId = targetUserResolution.userId;

      if (targetUserId === interaction.user.id) {
        await interaction.editReply({
          content: 'You cannot report yourself.',
        });
        return;
      }

      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(targetUserId).catch(() => null);
      if (!member) {
        await interaction.editReply({
          content: `Could not find a user matching "${targetUserInputString}" in this server.`,
        });
        return;
      }

      await this.securityActionService.handleUserReport(member, interaction.user, reason);

      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUserId}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('[InteractionHandler] Error handling report modal submission:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: 'An error occurred while submitting your report. Please try again later.',
        });
      } else {
        await interaction.followUp({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private parseObservedActionCustomId(customId: string): {
    action: string;
    userId: string;
    detectionEventId: string;
  } | null {
    const [, action, userId, detectionEventId] = customId.split(':');
    if (!action || !userId || !detectionEventId) {
      return null;
    }
    return { action, userId, detectionEventId };
  }

  private async hasAnyPermission(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    guildId: string,
    permissions: bigint[]
  ): Promise<boolean> {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return true;
    }
    if (permissions.some((permission) => interaction.memberPermissions?.has(permission))) {
      return true;
    }

    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return false;
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }
    return permissions.some((permission) => member.permissions.has(permission));
  }

  private async canUseModeratorBanAction(guildId: string): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (!settings.moderatorBanActionEnabled) {
      return false;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const botMember =
      guild?.members.me ??
      (guild && typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.BanMembers) ?? false;
  }

  private async replyPermissionDenied(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    message: string,
    options?: { clearComponents?: boolean }
  ): Promise<void> {
    const response = {
      content: message,
      ...(options?.clearComponents ? { components: [] } : {}),
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
      return;
    }
    await interaction.reply({
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async getObservedTargetMember(guildId: string, userId: string): Promise<GuildMember> {
    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      throw new Error(`Could not find member ${userId} in guild ${guildId}`);
    }
    return member;
  }

  private getModerationPermissions(): bigint[] {
    return [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers];
  }

  private getObservedModerationPermissions(): bigint[] {
    return this.getModerationPermissions();
  }

  private async handleObservedButtonInteraction(
    interaction: ButtonInteraction,
    guildId: string,
    customId: string
  ): Promise<void> {
    const parsed = this.parseObservedActionCustomId(customId);
    if (!parsed) {
      await interaction.reply({
        content: 'Unknown observed action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const moderationPermissions = this.getObservedModerationPermissions();
    let canModerate: boolean | null = null;
    const hasModerationPermission = async (): Promise<boolean> => {
      canModerate ??= await this.hasAnyPermission(interaction, guildId, moderationPermissions);
      return canModerate;
    };

    switch (parsed.action) {
      case 'open':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to open a case.'
          );
          return;
        }
        await interaction.deferUpdate();
        await this.openObservedCase(interaction, guildId, parsed.userId, parsed.detectionEventId);
        return;

      case 'restrict':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to restrict a user.'
          );
          return;
        }
        await interaction.deferUpdate();
        await this.restrictObservedUser(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;

      case 'ban':
        if (
          !(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))
        ) {
          await this.replyPermissionDenied(
            interaction,
            'You need Ban Members permission to ban a user.'
          );
          return;
        }
        if (!(await this.canUseModeratorBanAction(guildId))) {
          await interaction.reply({
            content:
              'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await this.showObservedBanModal(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;

      case 'dismiss_menu':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to dismiss an alert.',
            { clearComponents: true }
          );
          return;
        }
        await interaction.editReply({
          content:
            'Dismiss only closes this alert. False Positive records that this specific detection was incorrect; future independent detections can still notify.',
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`observed:dismiss:${parsed.userId}:${parsed.detectionEventId}`)
                .setLabel('Dismiss Alert')
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`observed:false_positive:${parsed.userId}:${parsed.detectionEventId}`)
                .setLabel('False Positive')
                .setStyle(ButtonStyle.Success)
            ),
          ],
        });
        return;

      case 'dismiss':
      case 'false_positive':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to dismiss an alert.',
            { clearComponents: true }
          );
          return;
        }
        await this.dismissObservedDetection(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId,
          parsed.action === 'false_positive'
            ? AdminActionType.FALSE_POSITIVE
            : AdminActionType.DISMISS
        );
        return;

      case 'undo_dismiss':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to undo a dismissal.',
            { clearComponents: true }
          );
          return;
        }
        await this.undoObservedDismissal(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;

      case 'history':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to view history.'
          );
          return;
        }
        await this.notificationManager.handleHistoryButtonClick(interaction, parsed.userId);
        return;

      default:
        await interaction.reply({
          content: 'Unknown observed action.',
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async openObservedCase(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const member = await this.getObservedTargetMember(guildId, userId);
    const opened = await this.securityActionService.openObservedDetectionCase(
      member,
      detectionEventId,
      interaction.user
    );
    await interaction.followUp({
      content: opened
        ? `Opened a verification case for <@${userId}>.`
        : `This observed alert for <@${userId}> was already actioned.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async restrictObservedUser(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const member = await this.getObservedTargetMember(guildId, userId);
    const restricted = await this.securityActionService.restrictObservedDetection(
      member,
      detectionEventId,
      interaction.user
    );
    await interaction.followUp({
      content: restricted
        ? `Restricted <@${userId}> and opened a verification case.`
        : `This observed alert for <@${userId}> was already actioned.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async showObservedBanModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const modal = new ModalBuilder()
      .setCustomId(`observed:ban_modal:${userId}:${detectionEventId}`)
      .setTitle('Confirm Observed Ban');
    const reasonInput = new TextInputBuilder()
      .setCustomId(OBSERVED_ACTION_MODAL_REASON_FIELD_ID)
      .setLabel(settings.observedActionBanRequiresReason ? 'Ban reason' : 'Ban reason (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.observedActionBanRequiresReason)
      .setMaxLength(500)
      .setPlaceholder(OBSERVED_BAN_DEFAULT_REASON);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  private async handleObservedBanModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsed = this.parseObservedActionCustomId(interaction.customId);
    if (!parsed || parsed.action !== 'ban_modal') {
      await interaction.reply({
        content: 'Unknown observed ban action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.BanMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Ban Members permission to ban a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorBanAction(interaction.guildId))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const providedReason = interaction.fields
      .getTextInputValue(OBSERVED_ACTION_MODAL_REASON_FIELD_ID)
      .trim();
    if (settings.observedActionBanRequiresReason && !providedReason) {
      await interaction.reply({
        content: 'A ban reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || OBSERVED_BAN_DEFAULT_REASON;
    try {
      const member = await this.getObservedTargetMember(interaction.guildId, parsed.userId);
      const banned = await this.securityActionService.banObservedDetection(
        member,
        parsed.detectionEventId,
        interaction.user,
        reason
      );
      await interaction.reply({
        content: banned
          ? `Banned <@${parsed.userId}>.`
          : `This observed alert for <@${parsed.userId}> was already actioned.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error handling observed ban modal submission:', error);
      const response = {
        content:
          'Failed to ban from the observed alert. A verification case may have been opened; check the case before retrying.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }

  private async dismissObservedDetection(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string,
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE
  ): Promise<void> {
    const dismissed = await this.securityActionService.dismissObservedDetection(
      guildId,
      userId,
      detectionEventId,
      interaction.user,
      actionType
    );
    await interaction.editReply({
      content: !dismissed
        ? `This observed alert for <@${userId}> was already actioned.`
        : actionType === AdminActionType.FALSE_POSITIVE
          ? `Marked the detection for <@${userId}> as a false positive.`
          : `Dismissed the observed alert for <@${userId}>.`,
      components: [],
    });
  }

  private async undoObservedDismissal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const undoneAction = await this.securityActionService.undoObservedDetectionAction(
      guildId,
      userId,
      detectionEventId,
      interaction.user
    );
    await interaction.editReply({
      content: !undoneAction
        ? `This observed alert for <@${userId}> does not have a dismissal to undo.`
        : undoneAction === AdminActionType.FALSE_POSITIVE
          ? `Undid the dismissal and reverted the false-positive indication for <@${userId}>.`
          : `Undid the dismissal for <@${userId}>.`,
      components: [],
    });
  }

  private async handleSetupVerificationModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const restrictedRoleInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_RESTRICTED_ROLE_FIELD_ID)
      .trim();
    const adminChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_ADMIN_CHANNEL_FIELD_ID)
      .trim();
    const verificationChannelInput = interaction.fields
      .getTextInputValue(SETUP_VERIFICATION_CHANNEL_FIELD_ID)
      .trim();

    const restrictedRoleId = parseRoleId(restrictedRoleInput);
    if (!restrictedRoleId) {
      await interaction.reply({
        content:
          'Please provide a valid restricted role ID or role mention (for example `<@&123...>`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const adminChannelId = parseChannelId(adminChannelInput);
    if (!adminChannelId) {
      await interaction.reply({
        content:
          'Please provide a valid admin channel ID or channel mention (for example `<#123...>`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providedVerificationChannelId = verificationChannelInput
      ? parseChannelId(verificationChannelInput)
      : null;

    if (verificationChannelInput && !providedVerificationChannelId) {
      await interaction.reply({
        content:
          'Please provide a valid verification channel ID or channel mention, or leave it blank to auto-create one.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = 'Please check permissions and try again.';
    const createdSetupArtifacts: { verificationChannelId?: string } = {};

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const moderator = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!moderator || !moderator.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'You need administrator permissions to complete setup.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const restrictedRole = await guild.roles.fetch(restrictedRoleId);
      if (!restrictedRole) {
        await interaction.reply({
          content: `Could not find restricted role <@&${restrictedRoleId}> in this server.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const adminChannel = await guild.channels.fetch(adminChannelId);
      if (!adminChannel || adminChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: `Admin channel must be a text channel in this server. Received: <#${adminChannelId}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let verificationChannelId = providedVerificationChannelId;
      let verificationChannelWasCreated = false;

      if (verificationChannelId) {
        const verificationChannel = await guild.channels.fetch(verificationChannelId);
        if (!verificationChannel || verificationChannel.type !== ChannelType.GuildText) {
          await interaction.reply({
            content: `Verification channel must be a text channel in this server. Received: <#${verificationChannelId}>.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } else {
        if (this.setupDiagnosticsService) {
          const report = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
            restrictedRoleId,
            willCreateRestrictedRole: false,
            adminChannelId,
            verificationChannelId: null,
            willCreateVerificationChannel: true,
            reportInstructionsChannelId: null,
          });
          if (report.errorCount > 0) {
            await interaction.reply({
              content:
                'Setup not saved. Fix these errors before completing setup:\n' +
                report.issues
                  .filter((issue) => issue.severity === 'error')
                  .map((issue) => `- ${issue.message}`)
                  .join('\n'),
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
            return;
          }
        }

        const createdChannelId = await this.notificationManager.setupVerificationChannel(
          guild,
          restrictedRoleId,
          false,
          (channelId) => {
            createdSetupArtifacts.verificationChannelId = channelId;
          }
        );
        if (!createdChannelId) {
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelId = createdChannelId;
        verificationChannelWasCreated = Boolean(createdSetupArtifacts.verificationChannelId);
      }

      if (this.setupDiagnosticsService) {
        const report = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
          restrictedRoleId,
          willCreateRestrictedRole: false,
          adminChannelId,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: null,
        });
        if (report.errorCount > 0) {
          let rollbackDetail = '';
          if (createdSetupArtifacts.verificationChannelId) {
            const rolledBack = await this.rollbackCreatedVerificationChannel(
              guild,
              createdSetupArtifacts.verificationChannelId,
              'Rolling back Drasil setup after final validation failed'
            );
            rollbackDetail = rolledBack
              ? `\nCreated verification channel <#${createdSetupArtifacts.verificationChannelId}> was removed.`
              : `\nCreated verification channel <#${createdSetupArtifacts.verificationChannelId}> could not be removed; delete it before rerunning setup.`;
          }
          await interaction.reply({
            content:
              'Setup not saved. Fix these errors before completing setup:\n' +
              report.issues
                .filter((issue) => issue.severity === 'error')
                .map((issue) => `- ${issue.message}`)
                .join('\n') +
              rollbackDetail,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }
      }

      try {
        await this.configService.updateServerConfig(interaction.guildId, {
          restricted_role_id: restrictedRoleId,
          admin_channel_id: adminChannelId,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        if (createdSetupArtifacts.verificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdSetupArtifacts.verificationChannelId,
            'Rolling back Drasil setup after config save failed'
          );
          setupFailureDetail = rolledBack
            ? 'Configuration could not be saved. The newly created verification channel was removed.'
            : `Configuration could not be saved. The newly created verification channel <#${createdSetupArtifacts.verificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        throw error;
      }

      const verificationChannelMessage = verificationChannelWasCreated
        ? `Created verification channel: <#${verificationChannelId}>`
        : `Verification channel: <#${verificationChannelId}>`;

      await interaction.reply({
        content:
          'Setup complete.\n' +
          `Restricted role: <@&${restrictedRoleId}>\n` +
          `Admin channel: <#${adminChannelId}>\n` +
          `${verificationChannelMessage}`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(
        '[InteractionHandler] Error handling setup verification modal submission:',
        error
      );
      const errorResponse = {
        content: `Failed to complete setup verification. ${setupFailureDetail}`,
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
  }

  private async rollbackCreatedVerificationChannel(
    guild: Guild,
    channelId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      const deletableChannel = channel as {
        delete?: (deleteReason?: string) => Promise<unknown>;
      } | null;
      if (!deletableChannel?.delete) {
        return false;
      }

      await deletableChannel.delete(reason);
      return true;
    } catch (error) {
      console.error(`Failed to roll back verification channel ${channelId}:`, error);
      return false;
    }
  }

  /**
   * Attempts to resolve a user ID string or tag string to a valid User ID within a guild.
   */
  private async resolveUserId(guildId: string, userInput: string): Promise<UserResolution> {
    const trimmedInput = userInput.trim();
    const mentionMatch = trimmedInput.match(/^<@!?(\d{17,19})>$/);
    const directUserId =
      mentionMatch?.[1] ?? (/^\d{17,19}$/.test(trimmedInput) ? trimmedInput : null);

    if (directUserId) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await guild.members.fetch(directUserId);
        return { status: 'found', userId: directUserId };
      } catch {
        return { status: 'not_found' };
      }
    }

    const normalizedInput = trimmedInput.replace(/^@/, '').toLowerCase();
    if (!normalizedInput) {
      return { status: 'not_found' };
    }

    const tagMatch = trimmedInput.replace(/^@/, '').match(/^(.+)#(\d{4})$/);

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const members = await guild.members.search({
        query: tagMatch ? tagMatch[1] : normalizedInput,
        limit: 100,
      });
      const candidates = Array.from(members.values());

      if (tagMatch) {
        const foundMember = candidates.find(
          (member) =>
            member.user.username.toLowerCase() === tagMatch[1].toLowerCase() &&
            member.user.discriminator === tagMatch[2]
        );
        return foundMember ? { status: 'found', userId: foundMember.id } : { status: 'not_found' };
      }

      const usernameMatch = candidates.find((member) =>
        [member.user.username, member.user.tag]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase() === normalizedInput)
      );
      if (usernameMatch) {
        return { status: 'found', userId: usernameMatch.id };
      }

      const nonUniqueMatches = candidates.filter((member) => {
        const names = [member.user.globalName, member.displayName, member.nickname].filter(
          (value): value is string => Boolean(value)
        );

        return names.some((value) => value.toLowerCase() === normalizedInput);
      });

      if (nonUniqueMatches.length > 1) {
        return { status: 'ambiguous' };
      }

      if (nonUniqueMatches.length === 1) {
        return { status: 'found', userId: nonUniqueMatches[0].id };
      }

      return { status: 'not_found' };
    } catch (error) {
      console.error(`[InteractionHandler] Error fetching members for user resolution: ${error}`);
      return { status: 'not_found' };
    }
  }

  private async getUserReportReasonRequired(guildId: string | undefined): Promise<boolean> {
    if (!guildId) {
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }

    try {
      const serverConfig = await this.configService.getServerConfig(guildId);
      return getUserReportSettings(serverConfig.settings).reasonRequired;
    } catch (error) {
      console.error(
        `[InteractionHandler] Failed to load report settings for guild ${guildId}:`,
        error
      );
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }
  }
}
