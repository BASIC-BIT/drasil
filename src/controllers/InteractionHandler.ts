import { Client, Message, ButtonInteraction, ThreadChannel } from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import { VerificationStatus } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';
import { IUserModerationService } from '../services/UserModerationService';

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
  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.userModerationService = userModerationService;
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const [action, targetUserId] = interaction.customId.split('_');
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This button can only be used in a server.',
        ephemeral: true,
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
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
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

      // Verify the user using UserModerationService
      await this.userModerationService.verifyUser(member, interaction.user);

      // Update the buttons to show History and Reopen
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        VerificationStatus.VERIFIED
      );

      // Lock and archive the thread if it exists
      await this.manageThreadState(guildId, userId, true, true); // Lock and Archive on Verify

      await interaction.followUp({
        content: `User <@${userId}> has been verified and can now access the server.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error verifying user:', error);
      await interaction.followUp({
        content: 'An error occurred while verifying the user.',
        ephemeral: true,
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

      // Reject the verification using UserModerationService
      await this.userModerationService.banUser(
        member,
        'Banned by moderator during verification (button)',
        interaction.user
      );

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        interaction.message,
        userId,
        VerificationStatus.BANNED
      );

      // Lock and archive the thread if it exists
      await this.manageThreadState(guildId, userId, true, true); // Lock and Archive on Ban

      await interaction.followUp({
        content: `User <@${userId}> has been banned from the server.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error banning user:', error);
      await interaction.followUp({
        content: 'An error occurred while banning the user.',
        ephemeral: true,
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
      const verificationEvent = await this.verificationService.getActiveVerification(
        guildId,
        userId
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      // Create the thread
      const thread = await this.notificationManager.createVerificationThread(
        member,
        verificationEvent
      );

      if (!thread) {
        throw new Error('Failed to create verification thread');
      }

      // Update the buttons (this will remove the Create Thread button)
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        verificationEvent.status
      );

      await interaction.followUp({
        content: `Created verification thread: ${thread.url}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error creating verification thread:', error);
      await interaction.followUp({
        content: 'An error occurred while creating the verification thread.',
        ephemeral: true,
      });
    }
  }

  private async handleHistoryButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Get verification history with actions using the member object
      const history = await this.verificationService.getVerificationHistory(member);

      // Format history using our formatter
      const formattedHistory = VerificationHistoryFormatter.formatForDiscord(history, userId);

      // Send as a text file if it's too long
      if (formattedHistory.length > 2000) {
        const plainTextHistory = VerificationHistoryFormatter.formatForFile(history, userId);
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
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Reopen the verification using VerificationService
      await this.userModerationService.reopenVerification(
        member, // Pass the GuildMember object
        interaction.user.id,
        'Reopened via button interaction'
      );

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        VerificationStatus.PENDING // Set back to PENDING
      );

      // Unlock and unarchive the thread if it exists
      await this.manageThreadState(guildId, userId, false, false); // Unlock and Unarchive on Reopen

      await interaction.followUp({
        content: `Verification for <@${userId}> has been reopened. The user has been restricted again.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error reopening verification:', error);
      await interaction.followUp({
        content: 'An error occurred while reopening the verification.',
        ephemeral: true,
      });
    }
  }
}
