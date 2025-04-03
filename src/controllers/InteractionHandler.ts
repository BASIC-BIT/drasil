import { Client, ButtonInteraction, MessageFlags } from 'discord.js';
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
    const [action, targetUserId] = interaction.customId.split('_');
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This button can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guildId = interaction.guildId;

    try {
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
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        userId,
        guildId
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      // Verify the user using UserModerationService
      await this.userModerationService.verifyUser(member, interaction.user);

      // Update the buttons to show History and Reopen
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.VERIFIED
      );

      // Lock and archive the thread if it exists
      await this.threadManager.resolveVerificationThread(
        verificationEvent,
        VerificationStatus.VERIFIED,
        interaction.user.id
      ); // Lock and Archive on Verify

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
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        userId,
        guildId
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      // Reject the verification using UserModerationService
      await this.userModerationService.banUser(
        member,
        'Banned by moderator during verification (button)',
        interaction.user
      );

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.BANNED
      );

      // Lock and archive the thread if it exists
      await this.threadManager.resolveVerificationThread(
        verificationEvent,
        VerificationStatus.BANNED,
        interaction.user.id
      ); // Lock and Archive on Ban

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

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING // Set back to PENDING
      );

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
}
