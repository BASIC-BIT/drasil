import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  ThreadAutoArchiveDuration,
  Client,
} from 'discord.js';
import { DetectionResult } from './DetectionOrchestrator';

export interface NotificationButton {
  id: string;
  label: string;
  style: ButtonStyle;
}

/**
 * Service for managing notifications to admin/summary channels
 */
export class NotificationManager {
  private adminChannelId: string | undefined;
  private client: Client;

  constructor(client: Client, adminChannelId?: string) {
    this.client = client;
    this.adminChannelId = adminChannelId || process.env.ADMIN_CHANNEL_ID;
  }

  /**
   * Sets the ID of the admin summary channel
   * @param channelId The Discord channel ID for admin notifications
   */
  public setAdminChannelId(channelId: string): void {
    this.adminChannelId = channelId;
  }

  /**
   * Sends a notification to the admin channel about a suspicious user
   * @param member The suspicious guild member
   * @param detectionResult The detection result
   * @returns Promise resolving to true if the notification was sent, false otherwise
   */
  public async notifySuspiciousUser(
    member: GuildMember,
    detectionResult: DetectionResult
  ): Promise<boolean> {
    if (!this.adminChannelId) {
      console.error('No admin channel ID configured');
      return false;
    }

    try {
      // Get the admin channel
      const channel = await this.getAdminChannel();
      if (!channel) return false;

      // Create the embed with user information
      const embed = this.createSuspiciousUserEmbed(member, detectionResult);

      // Create buttons for admin actions
      const actionRow = this.createActionRow(member.id);

      // Send the message to the admin channel
      await channel.send({
        embeds: [embed],
        components: [actionRow],
      });

      return true;
    } catch (error) {
      console.error('Failed to send suspicious user notification:', error);
      return false;
    }
  }

  /**
   * Creates a thread for a suspicious user in the admin channel
   * @param member The suspicious guild member
   * @returns Promise resolving to the created thread, or undefined if creation failed
   */
  public async createVerificationThread(member: GuildMember): Promise<boolean> {
    if (!this.adminChannelId) {
      console.error('No admin channel ID configured');
      return false;
    }

    try {
      // Get the admin channel
      const channel = await this.getAdminChannel();
      if (!channel) return false;

      // Create a thread for verification
      const threadName = `Verification: ${member.user.username}`;
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Verification thread for suspicious user: ${member.user.tag}`,
      });

      // Send an initial message to the thread
      await thread.send({
        content: `Verification thread for <@${member.id}> (${member.user.tag}).
        
Please ask the user for more information to determine if they are legitimate or a potential scammer.`,
      });

      return true;
    } catch (error) {
      console.error('Failed to create verification thread:', error);
      return false;
    }
  }

  /**
   * Creates an embed for displaying suspicious user information
   * @param member The guild member
   * @param detectionResult The detection result
   * @returns An EmbedBuilder with user information
   */
  private createSuspiciousUserEmbed(
    member: GuildMember,
    detectionResult: DetectionResult
  ): EmbedBuilder {
    const accountCreatedAt = new Date(member.user.createdTimestamp);
    const joinedServerAt = member.joinedAt;

    return new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('Suspicious User Detected')
      .setDescription(`<@${member.id}> has been flagged as suspicious.`)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'Username', value: member.user.tag, inline: true },
        { name: 'User ID', value: member.id, inline: true },
        { name: 'Account Created', value: accountCreatedAt.toLocaleString(), inline: true },
        {
          name: 'Joined Server',
          value: joinedServerAt ? joinedServerAt.toLocaleString() : 'Unknown',
          inline: true,
        },
        {
          name: 'Detection Confidence',
          value: `${(detectionResult.confidence * 100).toFixed(2)}%`,
          inline: true,
        },
        { name: 'Used GPT', value: detectionResult.usedGPT ? 'Yes' : 'No', inline: true },
        {
          name: 'Reason',
          value: detectionResult.reason || 'No specific reason provided',
          inline: false,
        }
      )
      .setTimestamp();
  }

  /**
   * Creates an action row with admin action buttons
   * @param userId The ID of the user the actions apply to
   * @returns An ActionRowBuilder with buttons
   */
  private createActionRow(userId: string): ActionRowBuilder<ButtonBuilder> {
    // Create action buttons with user ID in the custom ID
    const verifyButton = new ButtonBuilder()
      .setCustomId(`verify_${userId}`)
      .setLabel('Verify User')
      .setStyle(ButtonStyle.Success);

    const banButton = new ButtonBuilder()
      .setCustomId(`ban_${userId}`)
      .setLabel('Ban User')
      .setStyle(ButtonStyle.Danger);

    const threadButton = new ButtonBuilder()
      .setCustomId(`thread_${userId}`)
      .setLabel('Create Thread')
      .setStyle(ButtonStyle.Primary);

    // Add buttons to an action row
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      verifyButton,
      banButton,
      threadButton
    );
  }

  /**
   * Helper method to get the admin channel
   * @returns The TextChannel for admin notifications, or undefined if not found
   */
  private async getAdminChannel(): Promise<TextChannel | undefined> {
    if (!this.adminChannelId) return undefined;

    try {
      const channel = await this.client.channels.fetch(this.adminChannelId);

      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        console.error(`Channel with ID ${this.adminChannelId} is not a text channel`);
        return undefined;
      }

      return channel as TextChannel;
    } catch (error) {
      console.error(`Failed to fetch admin channel with ID ${this.adminChannelId}:`, error);
      return undefined;
    }
  }
}
