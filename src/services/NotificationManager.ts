import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  TextChannel,
  ThreadAutoArchiveDuration,
  Message,
  Client,
  User,
  ThreadChannel,
  PermissionFlagsBits,
  GuildChannelCreateOptions,
  Guild,
  ChannelType,
} from 'discord.js';
import { DetectionResult } from './DetectionOrchestrator';
import { ConfigService } from '../config/ConfigService';

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
  private verificationChannelId: string | undefined;
  private client: Client;
  private configService: ConfigService;

  constructor(
    client: Client,
    adminChannelId?: string,
    verificationChannelId?: string,
    configService?: ConfigService
  ) {
    this.client = client;
    this.adminChannelId = adminChannelId;
    this.verificationChannelId = verificationChannelId;
    this.configService = configService || new ConfigService();
  }

  public async initialize(guildId: string): Promise<void> {
    const config = await this.configService.getServerConfig(guildId);
    this.adminChannelId = config.admin_channel_id || this.adminChannelId;
    this.verificationChannelId = config.verification_channel_id || this.verificationChannelId;
  }

  /**
   * Sets the ID of the admin summary channel
   * @param channelId The Discord channel ID for admin notifications
   */
  public setAdminChannelId(channelId: string): void {
    this.adminChannelId = channelId;
  }

  /**
   * Sets the ID of the verification channel
   * @param channelId The Discord channel ID for verification threads
   */
  public setVerificationChannelId(channelId: string): void {
    this.verificationChannelId = channelId;
  }

  /**
   * Sends a notification to the admin channel about a suspicious user
   * @param member The suspicious guild member
   * @param detectionResult The detection result
   * @param sourceMessage Optional message that triggered the detection
   * @returns Promise resolving to the sent message or null if sending failed
   */
  public async notifySuspiciousUser(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<Message | null> {
    if (!this.adminChannelId) {
      console.error('No admin channel ID configured');
      return null;
    }

    try {
      // Get the admin channel
      const channel = await this.getAdminChannel();
      if (!channel) return null;

      // Create the embed with user information
      const embed = this.createSuspiciousUserEmbed(member, detectionResult, sourceMessage);

      // Create buttons for admin actions
      const actionRow = this.createActionRow(member.id);

      // Send the message to the admin channel
      const message = await channel.send({
        embeds: [embed],
        components: [actionRow],
      });

      return message;
    } catch (error) {
      console.error('Failed to send suspicious user notification:', error);
      return null;
    }
  }

  /**
   * Creates a thread for a suspicious user in the verification channel
   * @param member The suspicious guild member
   * @returns Promise resolving to the created thread or null if creation failed
   */
  public async createVerificationThread(member: GuildMember): Promise<ThreadChannel | null> {
    // Try verification channel first, fall back to admin channel if not configured
    const channelId = this.verificationChannelId || this.adminChannelId;

    if (!channelId) {
      console.error('No verification or admin channel ID configured');
      return null;
    }

    try {
      // Get the verification channel or fall back to admin channel
      const channel = this.verificationChannelId
        ? await this.getVerificationChannel()
        : await this.getAdminChannel();

      if (!channel) return null;

      // Create a thread for verification
      const threadName = `Verification: ${member.user.username}`;
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Verification thread for suspicious user: ${member.user.tag}`,
        type: 11, // PrivateThread
      });

      // Add the member to the private thread so they can see it
      await thread.members.add(member.id);

      // Send an initial message to the thread
      await thread.send({
        content: `# Verification for <@${member.id}>\n\nHello <@${member.id}>, your account has been automatically flagged for verification.\n\nTo help us verify your account, please answer these questions:\n\n1. How did you find our community?\n2. What interests you here?\n\nOnce you respond, a moderator will review your answers and grant you full access to the server if everything checks out.`,
      });

      return thread;
    } catch (error) {
      console.error('Failed to create verification thread:', error);
      return null;
    }
  }

  /**
   * Log an admin action to the notification message
   * @param message The original notification message
   * @param actionTaken The action that was taken
   * @param admin The admin who took the action
   * @param thread Optional verification thread that was created
   */
  public async logActionToMessage(
    message: Message,
    actionTaken: string,
    admin: User,
    thread?: ThreadChannel
  ): Promise<boolean> {
    try {
      // Get the existing embed
      const existingEmbed = message.embeds[0];
      if (!existingEmbed) return false;

      // Create a new embed based on the existing one
      const updatedEmbed = EmbedBuilder.from(existingEmbed);

      // Add or update the Action Log field
      const timestamp = Math.floor(Date.now() / 1000);
      const actionLogField = updatedEmbed.data.fields?.find((field) => field.name === 'Action Log');

      // Create log entry, add thread link if provided
      let actionLogContent = `• <@${admin.id}> ${actionTaken} <t:${timestamp}:R>`;
      if (thread && actionTaken.includes('created a verification thread')) {
        actionLogContent = `• <@${admin.id}> [created a verification thread](${thread.url}) <t:${timestamp}:R>`;
      }

      if (actionLogField) {
        // Append to existing log
        actionLogContent = `${actionLogField.value}\n${actionLogContent}`;
      }

      if (actionLogField) {
        // Update existing field
        actionLogField.value = actionLogContent;
      } else {
        // Add new field
        updatedEmbed.addFields({ name: 'Action Log', value: actionLogContent, inline: false });
      }

      // Update the message
      await message.edit({ embeds: [updatedEmbed] });
      return true;
    } catch (error) {
      console.error('Failed to log action to message:', error);
      return false;
    }
  }

  /**
   * Creates an embed for displaying suspicious user information
   * @param member The guild member
   * @param detectionResult The detection result
   * @param sourceMessage Optional message that triggered the detection
   * @returns An EmbedBuilder with user information
   */
  private createSuspiciousUserEmbed(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): EmbedBuilder {
    const accountCreatedAt = new Date(member.user.createdTimestamp);
    const joinedServerAt = member.joinedAt;

    // Get unix timestamps for Discord timestamp formatting
    const accountCreatedTimestamp = Math.floor(accountCreatedAt.getTime() / 1000);
    const joinedServerTimestamp = joinedServerAt ? Math.floor(joinedServerAt.getTime() / 1000) : 0;

    // Format the account timestamps with both absolute and relative format
    const accountCreatedFormatted = `<t:${accountCreatedTimestamp}:F> (<t:${accountCreatedTimestamp}:R>)`;
    const joinedServerFormatted = joinedServerAt
      ? `<t:${joinedServerTimestamp}:F> (<t:${joinedServerTimestamp}:R>)`
      : 'Unknown';

    // Convert confidence to Low/Medium/High
    const confidencePercent = detectionResult.confidence * 100;
    let confidenceLevel: string;
    if (confidencePercent <= 40) {
      confidenceLevel = '🟢 Low';
    } else if (confidencePercent <= 70) {
      confidenceLevel = '🟡 Medium';
    } else {
      confidenceLevel = '🔴 High';
    }

    // Format reasons as bullet points
    const reasonsFormatted = detectionResult.reasons.map((reason) => `• ${reason}`).join('\n');

    // Create trigger information
    let triggerInfo: string;
    if (detectionResult.triggerSource === 'message' && detectionResult.triggerContent) {
      // If we have the source message, create a direct link to it
      if (sourceMessage) {
        triggerInfo = `[Flagged for message](${sourceMessage.url}): "${detectionResult.triggerContent}"`;
      } else {
        triggerInfo = `Flagged for message: "${detectionResult.triggerContent}"`;
      }
    } else {
      triggerInfo = 'Flagged upon joining server';
    }

    return new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('Suspicious User Detected')
      .setDescription(`<@${member.id}> has been flagged as suspicious.`)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'Username', value: member.user.tag, inline: true },
        { name: 'User ID', value: member.id, inline: true },
        { name: 'Account Created', value: accountCreatedFormatted, inline: false },
        { name: 'Joined Server', value: joinedServerFormatted, inline: false },
        { name: 'Detection Confidence', value: confidenceLevel, inline: true },
        { name: 'Trigger', value: triggerInfo, inline: false },
        { name: 'Reasons', value: reasonsFormatted || 'No specific reason provided', inline: false }
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

  /**
   * Helper method to get the verification channel
   * @returns The TextChannel for verification threads, or undefined if not found
   */
  private async getVerificationChannel(): Promise<TextChannel | undefined> {
    if (!this.verificationChannelId) return undefined;

    try {
      const channel = await this.client.channels.fetch(this.verificationChannelId);

      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        console.error(`Channel with ID ${this.verificationChannelId} is not a text channel`);
        return undefined;
      }

      return channel as TextChannel;
    } catch (error) {
      console.error(
        `Failed to fetch verification channel with ID ${this.verificationChannelId}:`,
        error
      );
      return undefined;
    }
  }

  /**
   * Sets up a verification channel with the proper permissions
   * @param guild The guild to create the channel in
   * @param restrictedRoleId The ID of the restricted role
   * @returns Promise resolving to the created channel ID or null if creation failed
   */
  public async setupVerificationChannel(
    guild: Guild,
    restrictedRoleId: string
  ): Promise<string | null> {
    if (!guild) {
      console.error('Guild is required to set up verification channel');
      return null;
    }

    if (!restrictedRoleId) {
      console.error('Restricted role ID is required to set up verification channel');
      return null;
    }

    try {
      // Create permission overwrites for the channel
      const permissionOverwrites = [
        // Default role (everyone) - deny access
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
          ],
        },
        // Restricted role - can view and send messages, but not read history
        {
          id: restrictedRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory, // TODO: Check if users need to be granted this to see history of private thread
            PermissionFlagsBits.SendMessagesInThreads,
          ],
        },
        // Bot - full access
        {
          id: this.client.user?.id || '',
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageThreads,
            PermissionFlagsBits.CreatePublicThreads,
            PermissionFlagsBits.CreatePrivateThreads,
            PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.ModerateMembers,
          ],
        },
      ];

      // Find admin roles by checking for manage channels permission
      const adminRoles = guild.roles.cache.filter((role) =>
        role.permissions.has(PermissionFlagsBits.ManageChannels)
      );

      // Add admin roles to permission overwrites
      adminRoles.forEach((role) => {
        permissionOverwrites.push({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        });
      });

      // Create the verification channel
      const channelOptions: GuildChannelCreateOptions = {
        name: 'verification',
        type: ChannelType.GuildText,
        permissionOverwrites: permissionOverwrites,
        topic:
          'This channel is for verifying users flagged by the anti-spam system. Only admins and flagged users can see this channel.',
      };

      const verificationChannel = await guild.channels.create(channelOptions);

      // Store the channel ID
      this.verificationChannelId = verificationChannel.id;

      return verificationChannel.id;
    } catch (error) {
      console.error('Failed to set up verification channel:', error);
      return null;
    }
  }
}
