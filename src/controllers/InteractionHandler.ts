import {
  Client,
  Message,
  ButtonInteraction,
  ThreadChannel,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import { IVerificationService } from '../services/VerificationService';
import { VerificationStatus, VerificationEvent } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';

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
  private verificationService: IVerificationService;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.VerificationService) verificationService: IVerificationService
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.verificationService = verificationService;
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
      if (!member) throw new Error('Member not found');

      // Verify the user using VerificationService
      await this.verificationService.verifyUser(
        member, // Pass the GuildMember object
        interaction.user.id,
        'Verified via button interaction'
      );

      // Log the verification action to the original message embed (updates text and color)
      await this.notificationManager.logActionToMessage(
        interaction.message as Message,
        'verified the user', // Action text
        interaction.user, // Admin user who clicked
        undefined // No thread involved in verification itself
      );

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
      if (!member) throw new Error('Member not found');

      // Reject the verification using VerificationService
      await this.verificationService.updateBannedUser(
        member, // Pass the GuildMember object
        interaction.user.id
      );

      // Ban the user via Discord API (VerificationService doesn't ban)
      await member.ban({ reason: 'Banned by moderator during verification (button)' });

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
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
      const thread = await this.notificationManager.createVerificationThread(member, verificationEvent);

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
      await this.verificationService.reopenVerification(
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

  // Helper function to manage thread state
  private async manageThreadState(
    guildId: string,
    userId: string,
    shouldLock: boolean,
    shouldArchive: boolean
  ): Promise<void> {
    try {
      // Use getActiveVerification to find the relevant event
      const verificationEvent = await this.verificationService.getActiveVerification(
        guildId,
        userId
      );

      // If verifying/banning and no *active* event found, check the *most recent* resolved one
      // This handles cases where the button is clicked after the event is already technically resolved
      let eventToCheck = verificationEvent;
      if (!eventToCheck && (shouldArchive || shouldLock)) {
        const history = await this.verificationService.getVerificationHistory(
          await this.client.guilds.fetch(guildId).then((g) => g.members.fetch(userId))
        );
        if (history.length > 0) {
          eventToCheck = history[0]; // Get the most recent one from history
        }
      }

      if (!eventToCheck || !eventToCheck.thread_id) {
        console.log(
          `No suitable verification thread found for user ${userId} in guild ${guildId} to manage state.`
        );
        return;
      }

      const thread = await this.client.channels.fetch(eventToCheck.thread_id).catch(() => null);
      if (!thread || !thread.isThread()) {
        console.warn(`Could not fetch thread ${eventToCheck.thread_id} to manage state.`);
        return;
      }

      const threadChannel = thread as ThreadChannel;

      if (threadChannel.locked !== shouldLock) {
        await threadChannel.setLocked(shouldLock, `Verification status change`);
        console.log(`Set thread ${threadChannel.id} locked state to ${shouldLock}`);
      }

      // Only change archive state if necessary
      if (threadChannel.archived !== shouldArchive) {
        if (shouldArchive && !threadChannel.archived) {
          await threadChannel.setArchived(true, `Verification resolved`);
          console.log(`Archived thread ${threadChannel.id}`);
        } else if (!shouldArchive && threadChannel.archived) {
          await threadChannel.setArchived(false, `Verification reopened`);
          console.log(`Unarchived thread ${threadChannel.id}`);
        }
      }
    } catch (error) {
      console.error(`Error managing thread state for user ${userId} in guild ${guildId}:`, error);
    }
  }
}
