import { injectable, inject } from 'inversify';
import {
  ActionRowBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  ButtonBuilder,
  GuildMember,
  Message,
  User,
  ThreadChannel,
  Guild,
  ChannelType,
  PermissionFlagsBits,
  GuildChannelCreateOptions,
  ButtonInteraction,
  MessageFlags,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import {
  DetectionEvent,
  VerificationStatus,
  AdminActionType,
  VerificationEvent,
  DetectionType,
} from '../repositories/types';
import { DetectionHistoryFormatter } from '../utils/DetectionHistoryFormatter';

export interface NotificationButton {
  id: string;
  label: string;
  style: ButtonStyle;
}

/**
 * Interface for NotificationManager service
 */
export interface INotificationManager {
  /**
   * Creates or updates a notification about a suspicious user
   * @param member The suspicious guild member
   * @param detectionResult The detection result
   * @param verificationEvent The verification event
   * @param sourceMessage Optional message that triggered the detection
   * @returns Promise resolving to the sent/updated message or null if failed
   */
  upsertSuspiciousUserNotification(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    sourceMessage?: Message
  ): Promise<Message | null>;

  /**
   * Log an admin action to the notification message
   * @param verificationEvent The verification event
   * @param actionTaken The action that was taken
   * @param admin The admin who took the action
   * @param thread Optional verification thread that was created
   */
  logActionToMessage(
    verificationEvent: VerificationEvent,
    actionTaken: AdminActionType,
    admin: User,
    thread?: ThreadChannel
  ): Promise<boolean>;

  /**
   * Sets up a verification channel with appropriate permissions
   * @param guild The Discord guild to set up the channel in
   * @param restrictedRoleId The ID of the restricted role
   * @returns The ID of the created channel or null if creation failed
   */
  setupVerificationChannel(guild: Guild, restrictedRoleId: string): Promise<string | null>;

  /**
   * Handle the history button interaction by sending a private ephemeral message with full detection history
   * @param interaction The button interaction
   * @param userId The Discord user ID whose history to show
   * @returns Promise resolving to whether the history was successfully sent
   */
  handleHistoryButtonClick(interaction: ButtonInteraction, userId: string): Promise<boolean>;

  updateNotificationButtons(
    verificationEvent: VerificationEvent,
    newStatus: VerificationStatus
  ): Promise<void>;
}

/**
 * Service for managing notifications to admin/summary channels
 * It is NOT intended to perform any action secondary actions
 * STRICTLY only for calling the discord client to manage messages
 */
@injectable()
export class NotificationManager implements INotificationManager {
  private client: Client;
  private configService: IConfigService;
  private detectionEventsRepository: IDetectionEventsRepository;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository
  ) {
    this.client = client;
    this.configService = configService;
    this.detectionEventsRepository = detectionEventsRepository;
  }

  /**
   * Creates or updates a notification about a suspicious user
   * @param member The suspicious guild member
   * @param detectionResult The detection result
   * @param existingMessageId Optional ID of an existing message to update
   * @param sourceMessage Optional message that triggered the detection
   * @returns Promise resolving to the sent/updated message or null if failed
   */
  public async upsertSuspiciousUserNotification(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    sourceMessage?: Message
  ): Promise<Message | null> {
    const adminChannel = await this.configService.getAdminChannel(member.guild.id);
    if (!adminChannel) {
      console.error('No admin channel ID configured');
      return null;
    }

    try {
      // Create the base embed
      const embed = await this.createSuspiciousUserEmbed(
        member,
        detectionResult,
        verificationEvent,
        sourceMessage
      );

      // Get detection events
      const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
        member.guild.id,
        member.id
      );

      // Create the action row, passing the thread status
      const actionRow = this.createActionRow(
        member.id,
        detectionEvents,
        !!verificationEvent.thread_id // Check for truthiness (not null/undefined)
      );

      // If we have an existing message, update it, otherwise create new
      if (verificationEvent.notification_message_id) {
        const existingMessage = await adminChannel.messages.fetch(
          verificationEvent.notification_message_id
        );
        return await existingMessage.edit({
          embeds: [embed],
          components: [actionRow], // Use the conditionally created action row
        });
      }

      // Create a new message
      const serverConfig = await this.configService.getServerConfig(member.guild.id);
      const adminNotificationRoleId = serverConfig.admin_notification_role_id;
      return await adminChannel.send({
        content: adminNotificationRoleId ? `<@&${adminNotificationRoleId}>` : undefined,
        allowedMentions: adminNotificationRoleId
          ? {
              parse: [],
              roles: [adminNotificationRoleId],
              users: [],
              repliedUser: false,
            }
          : undefined,
        embeds: [embed],
        components: [actionRow], // Use the conditionally created action row
      });
    } catch (error) {
      console.error('Failed to upsert suspicious user notification:', error);
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
    verificationEvent: VerificationEvent,
    actionTaken: AdminActionType,
    admin: User,
    thread?: ThreadChannel
  ): Promise<boolean> {
    try {
      if (!verificationEvent.notification_message_id) {
        throw new Error('No notification message ID found for verification event');
      }

      const message = await this.getMessageForVerificationEvent(verificationEvent);

      // Get the existing embed
      const existingEmbed = message.embeds[0];

      // Create a new embed based on the existing one
      const updatedEmbed = EmbedBuilder.from(existingEmbed);

      // Add or update the Action Log field
      const timestamp = Math.floor(Date.now() / 1000);
      const actionLogField = updatedEmbed.data.fields?.find((field) => field.name === 'Action Log');

      // Create log entry
      let actionLogContent = `• <@${admin.id}> ${actionTaken} <t:${timestamp}:R>`;

      // If a thread was created, update the log entry and add/update a dedicated thread link field
      if (thread && actionTaken === AdminActionType.CREATE_THREAD) {
        actionLogContent = `• <@${admin.id}> created a verification thread <t:${timestamp}:R>`; // Keep log simple
        const threadField = {
          name: 'Verification Thread',
          value: `[Click here to view the thread](${thread.url})`,
          inline: false,
        };
        // Check if thread field already exists
        const existingThreadFieldIndex = updatedEmbed.data.fields?.findIndex(
          (field) => field.name === 'Verification Thread'
        );
        if (existingThreadFieldIndex !== undefined && existingThreadFieldIndex > -1) {
          // Update existing field
          updatedEmbed.spliceFields(existingThreadFieldIndex, 1, threadField);
        } else {
          // Add new field
          updatedEmbed.addFields(threadField);
        }
      }

      // Update the thread status if it's a verification or ban action
      if (message.guildId && actionTaken === AdminActionType.VERIFY) {
        // Update embed color based on resolution
        updatedEmbed.setColor(0x00ff00);
      }

      // Update the thread status if it's a verification or ban action
      if (message.guildId && actionTaken === AdminActionType.BAN) {
        // Update embed color based on resolution
        updatedEmbed.setColor(0x000000);
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

      // Update the message embed. Let button updates be handled separately.
      await message.edit({ embeds: [updatedEmbed] });
      return true;
    } catch (error) {
      console.error('Failed to log action to message:', error);
      return false;
    }
  }

  private async getMessageForVerificationEvent(
    verificationEvent: VerificationEvent
  ): Promise<Message> {
    if (!verificationEvent.notification_message_id) {
      throw new Error('No notification message ID found for verification event');
    }
    const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);

    if (!adminChannel) {
      throw new Error('No admin channel found for verification event');
    }

    return await adminChannel.messages.fetch(verificationEvent.notification_message_id);
  }

  /**
   * Creates an embed for displaying suspicious user information
   * @param member The guild member
   * @param detectionResult The detection result
   * @param sourceMessage Optional message that triggered the detection
   * @returns An EmbedBuilder with user information
   */
  private async createSuspiciousUserEmbed(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    sourceMessage?: Message
  ): Promise<EmbedBuilder> {
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
    let embedColor: number = 0xff0000; // Default red for suspicious/unverified users

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
    if (detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`Message content unavailable`';

      if (sourceMessage) {
        triggerInfo = `[Flagged for message](${sourceMessage.url}): ${safeContent}`;
      } else {
        triggerInfo = `Flagged for message: ${safeContent}`;
      }
    } else if (detectionResult.triggerSource === DetectionType.USER_REPORT) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`No report reason provided`';
      triggerInfo = `Flagged via user report: ${safeContent}`;
    } else if (detectionResult.triggerSource === DetectionType.GPT_ANALYSIS) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`Manual flag`';
      triggerInfo = `Flagged via manual review: ${safeContent}`;
    } else if (detectionResult.triggerSource === DetectionType.NEW_ACCOUNT) {
      triggerInfo = 'Flagged upon joining server';
    } else {
      triggerInfo = 'Flagged for suspicious activity';
    }

    // Get all detection events for this user in this server
    const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
      member.guild.id,
      member.id
    );

    // Format detection history
    let detectionHistory = '';
    if (detectionEvents.length > 0) {
      // Sort events by date, most recent first
      const sortedEvents = detectionEvents.sort(
        (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      );

      // Take the 5 most recent events
      const recentEvents = sortedEvents.slice(0, 5);

      // Format the recent events
      detectionHistory = recentEvents
        .map((event) => {
          const timestamp = Math.floor(new Date(event.detected_at).getTime() / 1000);
          let entry = `• <t:${timestamp}:R>: ${event.detection_type}`;
          if (event.message_id) {
            entry += ` - [View Message](https://discord.com/channels/${member.guild.id}/${event.channel_id}/${event.message_id})`;
          }
          entry += ` (${(event.confidence * 100).toFixed(0)}% confidence)`;
          return entry;
        })
        .join('\n');

      // If there are more events, add a count
      if (sortedEvents.length > 5) {
        detectionHistory += `\n\n*${sortedEvents.length - 5} more events not shown*`;
      }
    }

    // Update embed color based on verification status if thread exists
    if (verificationEvent.status === VerificationStatus.VERIFIED) {
      embedColor = 0x00ff00; // Green for verified users
    } else if (verificationEvent.status === VerificationStatus.BANNED) {
      embedColor = 0x000000; // Black for banned users
    }

    // Create the embed
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('Suspicious User Detected')
      .setDescription(
        detectionEvents.length > 1
          ? `<@${member.id}> has been flagged as suspicious ${detectionEvents.length} times.`
          : `<@${member.id}> has been flagged as suspicious.`
      )
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

    // Add detection history if we have any
    if (detectionHistory) {
      embed.addFields({
        name: 'Detection History',
        value: detectionHistory,
        inline: false,
      });
    }

    // Add verification thread status if it exists
    if (verificationEvent.thread_id) {
      const threadStatus =
        verificationEvent.status === VerificationStatus.VERIFIED ||
        verificationEvent.status === VerificationStatus.BANNED
          ? `${verificationEvent.status} by <@${verificationEvent.resolved_by}>`
          : 'pending'; // Use 'pending' for unresolved states
      embed.addFields({
        name: 'Verification Status',
        value: `[Thread](https://discord.com/channels/${member.guild.id}/${verificationEvent.thread_id}) status: ${threadStatus}`,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * Creates an action row with admin action buttons
   * @param userId The ID of the user the actions apply to
   * @param detectionEvents Array of detection events to determine if history button is needed
   * @param hasThread Whether a verification thread exists for the user
   * @returns An ActionRowBuilder with buttons
   */
  private createActionRow(
    userId: string,
    detectionEvents: DetectionEvent[],
    hasThread: boolean
  ): ActionRowBuilder<ButtonBuilder> {
    // Create action buttons with user ID in the custom ID
    const verifyButton = new ButtonBuilder()
      .setCustomId(`verify_${userId}`)
      .setLabel('Verify User')
      .setStyle(ButtonStyle.Success);

    const banButton = new ButtonBuilder()
      .setCustomId(`ban_${userId}`)
      .setLabel('Ban User')
      .setStyle(ButtonStyle.Danger);

    // Base buttons
    const buttons = [verifyButton, banButton];

    // Add thread button ONLY if no verification event was found OR if the event exists but has no thread_id yet
    if (!hasThread) {
      const threadButton = new ButtonBuilder()
        .setCustomId(`thread_${userId}`)
        .setLabel('Create Thread')
        .setStyle(ButtonStyle.Primary);
      buttons.push(threadButton);
    }

    // Add view history button if we have more than 5 detection events
    if (detectionEvents.length > 5) {
      const historyButton = new ButtonBuilder()
        .setCustomId(`history_${userId}`)
        .setLabel('View Full History')
        .setStyle(ButtonStyle.Secondary);
      buttons.push(historyButton);
    }

    // Add buttons to an action row
    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  }

  /**
   * Sets up a verification channel with appropriate permissions
   * @param guild The Discord guild to set up the channel in
   * @param restrictedRoleId The ID of the restricted role
   * @returns The ID of the created channel or null if creation failed
   */
  public async setupVerificationChannel(
    guild: Guild,
    restrictedRoleId: string
  ): Promise<string | null> {
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

      await this.configService.updateServerConfig(guild.id, {
        verification_channel_id: verificationChannel.id,
      });

      return verificationChannel.id;
    } catch (error) {
      console.error('Failed to set up verification channel:', error);
      return null;
    }
  }

  /**
   * Handle the history button interaction by sending a private ephemeral message with full detection history
   * @param interaction The button interaction
   * @param userId The Discord user ID whose history to show
   * @returns Promise resolving to whether the history was successfully sent
   */
  public async handleHistoryButtonClick(
    interaction: ButtonInteraction,
    userId: string
  ): Promise<boolean> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }

      // Get all detection events for this user in this server
      const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
        interaction.guildId,
        userId
      );

      if (detectionEvents.length === 0) {
        await interaction.reply({
          content: 'No detection history found.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      // Format the history using the utility class
      const fileContent = DetectionHistoryFormatter.formatHistory(
        userId,
        detectionEvents,
        interaction.guildId
      );

      // Create a Buffer from the file content
      const buffer = Buffer.from(fileContent, 'utf-8');

      // Send the file as an ephemeral message
      await interaction.reply({
        content: `Detection history for <@${userId}>:`,
        files: [
          {
            name: `detection_history_${userId}.txt`,
            attachment: buffer,
          },
        ],
        flags: MessageFlags.Ephemeral,
      });

      return true;
    } catch (error) {
      console.error('Failed to handle history button click:', error);
      await interaction.reply({
        content: 'Failed to fetch detection history. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
  }

  async updateNotificationButtons(
    verificationEvent: VerificationEvent,
    newStatus: VerificationStatus
  ): Promise<void> {
    let components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (!verificationEvent.notification_message_id) {
      throw new Error('No notification message ID found for verification event');
    }

    switch (newStatus) {
      case VerificationStatus.VERIFIED:
        // Keep history and add reopen button
        components = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`history_${verificationEvent.user_id}`)
              .setLabel('View Full History')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`reopen_${verificationEvent.user_id}`)
              .setLabel('Reopen Verification')
              .setStyle(ButtonStyle.Primary)
          ),
        ];
        break;

      case VerificationStatus.BANNED:
        // Keep history and add reopen button
        components = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`history_${verificationEvent.user_id}`)
              .setLabel('View Full History')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`reopen_${verificationEvent.user_id}`)
              .setLabel('Reopen Verification')
              .setStyle(ButtonStyle.Primary)
          ),
        ];
        break;

      case VerificationStatus.PENDING:
        // Show all buttons
        components = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`verify_${verificationEvent.user_id}`)
              .setLabel('Verify User')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`ban_${verificationEvent.user_id}`)
              .setLabel('Ban User')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`history_${verificationEvent.user_id}`)
              .setLabel('View Full History')
              .setStyle(ButtonStyle.Secondary)
          ),
        ];
        break;
    }

    // Add create thread button if pending and no thread exists
    if (newStatus === VerificationStatus.PENDING && !verificationEvent.thread_id) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`thread_${verificationEvent.user_id}`)
            .setLabel('Create Thread')
            .setStyle(ButtonStyle.Primary)
        )
      );
    }

    const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);

    if (!adminChannel) {
      throw new Error('No admin channel found for verification event');
    }

    const message = await adminChannel.messages.fetch(verificationEvent.notification_message_id);

    await message.edit({ components });
  }
}
