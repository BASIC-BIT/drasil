import {
  Client,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder, // Added
  TextInputBuilder, // Added
  TextInputStyle, // Added
  ActionRowBuilder, // Added
  // UserSelectMenuBuilder, // Removed - Cannot be used in Modals
  ModalSubmitInteraction, // Added
  // Interaction, // Removed - Unused
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import { VerificationStatus } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';
import { IUserModerationService } from '../services/UserModerationService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IThreadManager } from '../services/ThreadManager';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import { ISecurityActionService } from '../services/SecurityActionService';
// Load environment variables
dotenv.config();

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
  // TODO: Handlers calling a repository is a smell, and should be improved
  private verificationEventRepository: IVerificationEventRepository;
  private threadManager: IThreadManager;
  private adminActionRepository: IAdminActionRepository;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.AdminActionRepository) adminActionRepository: IAdminActionRepository
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;
    this.verificationEventRepository = verificationEventRepository;
    this.threadManager = threadManager;
    this.adminActionRepository = adminActionRepository;
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
          await this.handleVerifyButton(interaction, guildId, targetUserId);
          break;
        case 'ban':
          await this.handleBanButton(interaction, guildId, targetUserId);
          break;
        case 'thread':
          await this.handleThreadButton(interaction, guildId, targetUserId);
          break;
        case 'history':
          await this.handleHistoryButton(interaction, guildId, targetUserId);
          break;
        case 'reopen':
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
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        flags: MessageFlags.Ephemeral,
      });
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

  private async handleBanButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      const banReason = 'Banned by moderator during verification (button)';
      await this.userModerationService.banUser(member, banReason, interaction.user);

      await interaction.followUp({
        content: `User <@${userId}> has been banned from the server.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error banning user:', error);
      await interaction.followUp({
        content: 'An error occurred while banning the user.',
        flags: MessageFlags.Ephemeral,
      });
    }
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
    // Create the modal
    const modal = new ModalBuilder()
      .setCustomId('report_user_modal_submit') // Unique ID for the modal submission
      .setTitle('Report a User');

    // Create the target user input field
    const targetUserInput = new TextInputBuilder()
      .setCustomId('report_target_user_input') // Changed ID
      .setLabel('User ID or Tag to Report')
      .setPlaceholder('Enter the User ID (e.g., 123456789012345678) or Tag (e.g., username#1234)')
      .setStyle(TextInputStyle.Short) // Use Short style for ID/Tag
      .setRequired(true);
    const targetUserRow = new ActionRowBuilder<TextInputBuilder>().addComponents(targetUserInput);

    // Create the reason text input
    const reasonInput = new TextInputBuilder()
      .setCustomId('report_reason')
      .setLabel('Reason for Report (Optional)')
      .setStyle(TextInputStyle.Paragraph) // Allow multi-line input
      .setPlaceholder('Please provide details about why you are reporting this user.')
      .setRequired(false); // Make reason optional

    const reasonRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);

    // Add components to the modal
    modal.addComponents(targetUserRow, reasonRow); // Use the correct row

    // Show the modal to the user
    await interaction.showModal(modal);
  }

  public async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (interaction.customId !== 'report_user_modal_submit') {
      // If it's not our report modal, ignore it (or handle other modals)
      // You might want a more robust routing system if you have many modals
      console.log(
        `[InteractionHandler] Ignoring unknown modal submission: ${interaction.customId}`
      );
      // Reply ephemerally that the modal isn't recognized, or just do nothing
      // await interaction.reply({ content: 'Unknown modal submission.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // Extract data from the modal components using field custom IDs
      const targetUserInputString = interaction.fields.getTextInputValue(
        'report_target_user_input'
      );
      const reason = interaction.fields.getTextInputValue('report_reason');

      // Basic validation - check if the input string is not empty
      if (!targetUserInputString) {
        await interaction.reply({
          content: 'Error: You must provide the User ID or Tag of the user to report.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetUserId = await this.resolveUserId(interaction.guildId, targetUserInputString);
      if (!targetUserId) {
        await interaction.reply({
          content: `Could not find a user matching "${targetUserInputString}".`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(targetUserId);

      await this.securityActionService.handleUserReport(
        member,
        interaction.user,
        reason || undefined
      );

      await interaction.reply({
        content: `Thank you for your report regarding <@${targetUserId}>. It has been submitted for review.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('[InteractionHandler] Error handling report modal submission:', error);
      // Avoid replying again if already replied
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.followUp({
          content: 'An error occurred while submitting your report. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  /**
   * Attempts to resolve a user ID string or tag string to a valid User ID within a guild.
   */
  private async resolveUserId(guildId: string, userInput: string): Promise<string | null> {
    const trimmedInput = userInput.trim();

    if (/^\d{17,19}$/.test(trimmedInput)) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await guild.members.fetch(trimmedInput);
        return trimmedInput;
      } catch {
        return null;
      }
    }

    const tagMatch = trimmedInput.match(/^(.+)#(\d{4})$/);
    if (tagMatch) {
      const username = tagMatch[1];
      const discriminator = tagMatch[2];
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const members = await guild.members.fetch();
        const foundMember = members.find(
          (m) => m.user.username === username && m.user.discriminator === discriminator
        );
        return foundMember ? foundMember.id : null;
      } catch (error) {
        console.error(`[InteractionHandler] Error fetching members for tag resolution: ${error}`);
        return null;
      }
    }

    return null;
  }
}
