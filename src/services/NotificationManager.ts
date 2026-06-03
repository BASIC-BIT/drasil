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
  GuildBasedChannel,
  OverwriteResolvable,
  ButtonInteraction,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import {
  DetectionEvent,
  Server,
  VerificationStatus,
  AdminActionType,
  VerificationEvent,
  DetectionType,
} from '../repositories/types';
import { DetectionHistoryFormatter } from '../utils/DetectionHistoryFormatter';
import type { ReportAIAnalysis, VerificationThreadAnalysisResult } from './GPTService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { getVerificationActionFailures } from '../utils/verificationActionFailures';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { CASE_STAFF_ROUTING_METADATA_KEY } from './ThreadManager';
import { isDetectionEventExcludedFromAccounting } from '../utils/detectionEventAccounting';
import {
  buildCaseAdminActionsCustomId,
  buildObservedAdminActionsCustomId,
} from '../utils/adminActionCustomIds';

const VERIFICATION_CHANNEL_NAME = 'verification';

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
  setupVerificationChannel(
    guild: Guild,
    restrictedRoleId: string,
    persistConfig?: boolean,
    onChannelCreated?: (channelId: string) => void,
    configuredVerificationChannelId?: string
  ): Promise<string | null>;

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

  updateVerificationThreadAnalysis(
    verificationEvent: VerificationEvent,
    analysis: VerificationThreadAnalysisResult,
    analyzedMessageCount: number
  ): Promise<boolean>;

  upsertObservedDetectionNotification(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<Message | null>;

  markObservedDetectionActionTaken(
    detectionEventId: string,
    actionDescription: string,
    admin: User,
    options?: { undoButtonLabel?: string }
  ): Promise<boolean>;

  restoreObservedDetectionActions(
    detectionEventId: string,
    actionDescription: string,
    admin: User
  ): Promise<boolean>;
}

interface ThreadAnalysisMetadata {
  analyzedMessageIds?: unknown;
  latestAnalysis?: {
    result: 'likely_legitimate' | 'needs_review' | 'likely_suspicious';
    confidence: number;
    summary: string;
    reasonCodes?: string[];
    legitimacySignals?: string[];
    suspicionSignals?: string[];
    recommendedNextQuestion?: string;
    recommendedAction?: 'none' | 'ask_followup' | 'manual_review' | 'restrict';
    analyzedMessageCount: number;
  };
}

interface ObservedDetectionMetadata {
  observed_notification_message_id?: string;
  observed_notification_last_notified_at?: string;
  observed_action?: string;
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
  private static readonly THREAD_ANALYSIS_FIELD_NAME = 'AI Thread Analysis';
  private static readonly LATEST_ADMIN_ACTION_FIELD_NAME = 'Latest Admin Action';

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
      const serverConfig = await this.configService.getServerConfig(member.guild.id);
      const actionRow = this.createActionRow(member.id);

      // If we have an existing message, update it, otherwise create new
      if (verificationEvent.notification_message_id) {
        const existingMessage = await adminChannel.messages.fetch(
          verificationEvent.notification_message_id
        );
        return await existingMessage.edit({
          allowedMentions: { parse: [] },
          embeds: [embed],
          components: [actionRow],
        });
      }

      // Create a new message
      const notificationRoleIds = this.getCaseNotificationRoleIds(serverConfig);
      return await adminChannel.send({
        content: this.formatRoleMentions(notificationRoleIds),
        allowedMentions: this.createAdminAllowedMentions(notificationRoleIds),
        embeds: [embed],
        components: [actionRow],
      });
    } catch (error) {
      console.error('Failed to upsert suspicious user notification:', error);
      return null;
    }
  }

  public async upsertObservedDetectionNotification(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<Message | null> {
    try {
      const serverConfig = await this.configService.getServerConfig(member.guild.id);
      const responseSettings = getDetectionResponseSettings(serverConfig.settings);
      const notificationChannel = await this.getObservedDetectionNotificationChannel(
        member.guild.id,
        responseSettings
      );
      if (!notificationChannel) {
        console.error('No observed detection notification channel configured');
        return null;
      }

      const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
        member.guild.id,
        member.id
      );

      const existingNotification = this.findRecentObservedDetectionNotification(
        detectionEvents,
        responseSettings.observedNotificationWindowMinutes
      );
      const embed = this.createObservedDetectionEmbed(
        member,
        detectionResult,
        detectionEvents,
        sourceMessage
      );
      const actionDetectionEventId = detectionResult.detectionEventId ?? detectionEvents[0]?.id;
      const components = actionDetectionEventId
        ? this.createObservedActionRows(member.id, actionDetectionEventId)
        : [];

      let notificationMessage: Message | null = null;
      if (existingNotification?.observed_notification_message_id) {
        const existingMessage = await notificationChannel.messages
          .fetch(existingNotification.observed_notification_message_id)
          .catch(() => null);
        if (existingMessage) {
          notificationMessage = await existingMessage.edit({
            allowedMentions: this.createAdminAllowedMentions(),
            embeds: [embed],
            components,
          });
        }
      }

      if (!notificationMessage) {
        const notificationRoleIds = this.getCaseNotificationRoleIds(serverConfig);
        notificationMessage = await notificationChannel.send({
          content: this.formatRoleMentions(notificationRoleIds),
          allowedMentions: this.createAdminAllowedMentions(notificationRoleIds),
          embeds: [embed],
          components,
        });
      }

      if (detectionResult.detectionEventId) {
        const currentDetection = detectionEvents.find(
          (event) => event.id === detectionResult.detectionEventId
        );
        const metadata = this.metadataToRecord(currentDetection?.metadata);
        await this.detectionEventsRepository.updateMetadata(detectionResult.detectionEventId, {
          ...metadata,
          observed_notification_message_id: notificationMessage.id,
          observed_notification_last_notified_at: new Date().toISOString(),
        });
      }

      return notificationMessage;
    } catch (error) {
      console.error('Failed to upsert observed detection notification:', error);
      return null;
    }
  }

  public async markObservedDetectionActionTaken(
    detectionEventId: string,
    actionDescription: string,
    admin: User,
    _options?: { undoButtonLabel?: string }
  ): Promise<boolean> {
    void _options;
    try {
      const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
      if (!detectionEvent?.server_id) {
        return false;
      }

      const metadata = this.metadataToRecord(detectionEvent.metadata) as ObservedDetectionMetadata;
      if (!metadata.observed_notification_message_id) {
        return false;
      }

      const serverConfig = await this.configService.getServerConfig(detectionEvent.server_id);
      const responseSettings = getDetectionResponseSettings(serverConfig.settings);
      const notificationChannel = await this.getObservedDetectionNotificationChannel(
        detectionEvent.server_id,
        responseSettings
      );
      if (!notificationChannel) {
        return false;
      }

      const message = await notificationChannel.messages
        .fetch(metadata.observed_notification_message_id)
        .catch(() => null);
      if (!message) {
        return false;
      }

      if (!message.embeds.length) {
        await message.edit({ allowedMentions: { parse: [] }, components: [] });
        return false;
      }

      const updatedEmbed = EmbedBuilder.from(message.embeds[0]);
      const timestamp = Math.floor(Date.now() / 1000);
      const field = {
        name: 'Action Taken',
        value: `<@${admin.id}> ${actionDescription} <t:${timestamp}:R>`,
        inline: false,
      };
      const existingFields =
        updatedEmbed.data.fields?.filter(
          (existingField) =>
            existingField.name !== field.name && existingField.name !== 'Action Reverted'
        ) ?? [];
      updatedEmbed.setFields(...existingFields, field);

      const components = this.createObservedActionRows(detectionEvent.user_id, detectionEvent.id);

      await message.edit({
        allowedMentions: { parse: [] },
        embeds: [updatedEmbed],
        components,
      });
      return true;
    } catch (error) {
      console.error('Failed to mark observed detection action:', error);
      return false;
    }
  }

  public async restoreObservedDetectionActions(
    detectionEventId: string,
    actionDescription: string,
    admin: User
  ): Promise<boolean> {
    try {
      const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
      if (!detectionEvent?.server_id) {
        return false;
      }

      const metadata = this.metadataToRecord(detectionEvent.metadata) as ObservedDetectionMetadata;
      if (!metadata.observed_notification_message_id) {
        return false;
      }

      const serverConfig = await this.configService.getServerConfig(detectionEvent.server_id);
      const responseSettings = getDetectionResponseSettings(serverConfig.settings);
      const notificationChannel = await this.getObservedDetectionNotificationChannel(
        detectionEvent.server_id,
        responseSettings
      );
      if (!notificationChannel) {
        return false;
      }

      const message = await notificationChannel.messages
        .fetch(metadata.observed_notification_message_id)
        .catch(() => null);
      if (!message) {
        return false;
      }

      const components = this.createObservedActionRows(detectionEvent.user_id, detectionEvent.id);
      if (!message.embeds.length) {
        await message.edit({ allowedMentions: { parse: [] }, components });
        return true;
      }

      const updatedEmbed = EmbedBuilder.from(message.embeds[0]);
      const timestamp = Math.floor(Date.now() / 1000);
      const field = {
        name: 'Action Reverted',
        value: `<@${admin.id}> ${actionDescription} <t:${timestamp}:R>`,
        inline: false,
      };
      const existingFields =
        updatedEmbed.data.fields?.filter(
          (existingField) =>
            existingField.name !== 'Action Taken' && existingField.name !== field.name
        ) ?? [];
      updatedEmbed.setFields(...existingFields, field);

      await message.edit({
        allowedMentions: { parse: [] },
        embeds: [updatedEmbed],
        components,
      });
      return true;
    } catch (error) {
      console.error('Failed to restore observed detection actions:', error);
      return false;
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

      const timestamp = Math.floor(Date.now() / 1000);
      const actionLogField = updatedEmbed.data.fields?.find((field) => field.name === 'Action Log');
      this.upsertLatestAdminActionField(updatedEmbed, actionTaken, admin.id, timestamp);

      let actionLogContent = `• ${this.formatAdminActionEvent(actionTaken, admin.id, timestamp)}`;

      // If a thread was created, update the log entry and add/update a dedicated thread link field
      if (thread && actionTaken === AdminActionType.CREATE_THREAD) {
        actionLogContent = `• ${this.formatAdminActionEvent(actionTaken, admin.id, timestamp)}`;
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
      await message.edit({ allowedMentions: { parse: [] }, embeds: [updatedEmbed] });
      return true;
    } catch (error) {
      console.error('Failed to log action to message:', error);
      return false;
    }
  }

  public async updateVerificationThreadAnalysis(
    verificationEvent: VerificationEvent,
    analysis: VerificationThreadAnalysisResult,
    analyzedMessageCount: number
  ): Promise<boolean> {
    try {
      const message = await this.getMessageForVerificationEvent(verificationEvent);
      const existingEmbed = message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(existingEmbed);

      const value = this.formatThreadAnalysisFieldValue({
        ...analysis,
        analyzedMessageCount,
      });

      const field = {
        name: NotificationManager.THREAD_ANALYSIS_FIELD_NAME,
        value,
        inline: false,
      };

      const existingFieldIndex = updatedEmbed.data.fields?.findIndex(
        (embedField) => embedField.name === field.name
      );

      if (existingFieldIndex !== undefined && existingFieldIndex > -1) {
        updatedEmbed.spliceFields(existingFieldIndex, 1, field);
      } else {
        updatedEmbed.addFields(field);
      }

      await message.edit({ allowedMentions: { parse: [] }, embeds: [updatedEmbed] });
      return true;
    } catch (error) {
      console.error('Failed to update verification thread analysis:', error);
      return false;
    }
  }

  private truncateEmbedFieldValue(value: string): string {
    const maxLength = 1024;
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }

  private formatAdminActionLabel(actionTaken: AdminActionType): string {
    switch (actionTaken) {
      case AdminActionType.BAN:
        return 'Banned';
      case AdminActionType.VERIFY:
        return 'Verified';
      case AdminActionType.CREATE_THREAD:
        return 'Created verification thread';
      case AdminActionType.REOPEN:
        return 'Reopened verification';
      case AdminActionType.RESTRICT:
        return 'Restricted';
      case AdminActionType.OPEN_CASE:
        return 'Opened case';
      case AdminActionType.DISMISS:
        return 'Dismissed alert';
      case AdminActionType.FALSE_POSITIVE:
        return 'Marked false positive';
      case AdminActionType.UNDO_OBSERVED_ACTION:
        return 'Undid observed action';
      case AdminActionType.REJECT:
        return 'Rejected';
      default:
        return actionTaken;
    }
  }

  private formatAdminActionEvent(
    actionTaken: AdminActionType,
    adminId: string,
    timestamp: number
  ): string {
    return `${this.formatAdminActionLabel(actionTaken)} by <@${adminId}> at <t:${timestamp}:F>`;
  }

  private upsertLatestAdminActionField(
    embed: EmbedBuilder,
    actionTaken: AdminActionType,
    adminId: string,
    timestamp: number
  ): void {
    const field = {
      name: NotificationManager.LATEST_ADMIN_ACTION_FIELD_NAME,
      value: this.formatAdminActionEvent(actionTaken, adminId, timestamp),
      inline: false,
    };
    const fields = (embed.data.fields ?? []).filter(
      (existingField) => existingField.name !== field.name
    );
    const confidenceIndex = fields.findIndex(
      (existingField) => existingField.name === 'Detection Confidence'
    );
    const insertIndex = confidenceIndex >= 0 ? confidenceIndex + 1 : 0;
    fields.splice(insertIndex, 0, field);
    embed.setFields(...fields);
  }

  private upsertLatestResolutionField(
    embed: EmbedBuilder,
    verificationEvent: VerificationEvent
  ): void {
    if (!verificationEvent.resolved_by || !verificationEvent.resolved_at) {
      return;
    }

    const actionTaken =
      verificationEvent.status === VerificationStatus.BANNED
        ? AdminActionType.BAN
        : verificationEvent.status === VerificationStatus.VERIFIED
          ? AdminActionType.VERIFY
          : null;
    if (!actionTaken) {
      return;
    }

    this.upsertLatestAdminActionField(
      embed,
      actionTaken,
      verificationEvent.resolved_by,
      Math.floor(verificationEvent.resolved_at.getTime() / 1000)
    );
  }

  private metadataToRecord(metadata: DetectionEvent['metadata']): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...metadata } as Record<string, unknown>;
  }

  private createAdminAllowedMentions(roleIds?: string[] | string | null): {
    parse: [];
    roles: string[];
    users: [];
    repliedUser: false;
  } {
    const roles = Array.isArray(roleIds)
      ? roleIds
      : typeof roleIds === 'string' && roleIds
        ? [roleIds]
        : [];

    return {
      parse: [],
      roles,
      users: [],
      repliedUser: false,
    };
  }

  private getCaseNotificationRoleIds(serverConfig: Server): string[] {
    const roleIds = new Set<string>();
    if (serverConfig.admin_notification_role_id) {
      roleIds.add(serverConfig.admin_notification_role_id);
    }

    const responderSettings = getCaseResponderSettings(serverConfig.settings);
    if (responderSettings.routingMode !== 'off') {
      responderSettings.roleIds.forEach((roleId) => roleIds.add(roleId));
    }

    return [...roleIds];
  }

  private formatRoleMentions(roleIds: readonly string[]): string | undefined {
    if (roleIds.length === 0) {
      return undefined;
    }

    return roleIds.map((roleId) => `<@&${roleId}>`).join(' ');
  }

  private findRecentObservedDetectionNotification(
    detectionEvents: DetectionEvent[],
    windowMinutes: number
  ): ObservedDetectionMetadata | null {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const actionedMessageIds = new Set(
      detectionEvents
        .map((event) => this.metadataToRecord(event.metadata) as ObservedDetectionMetadata)
        .filter((metadata) => metadata.observed_action)
        .map((metadata) => metadata.observed_notification_message_id)
        .filter((messageId): messageId is string => typeof messageId === 'string')
    );

    for (const event of detectionEvents) {
      const metadata = this.metadataToRecord(event.metadata) as ObservedDetectionMetadata;
      if (!metadata.observed_notification_message_id) {
        continue;
      }
      if (actionedMessageIds.has(metadata.observed_notification_message_id)) {
        continue;
      }

      const lastNotifiedAt = metadata.observed_notification_last_notified_at
        ? new Date(metadata.observed_notification_last_notified_at).getTime()
        : 0;
      if (lastNotifiedAt >= cutoff) {
        return metadata;
      }
    }

    return null;
  }

  private async getObservedDetectionNotificationChannel(
    guildId: string,
    responseSettings: ReturnType<typeof getDetectionResponseSettings>
  ): Promise<TextChannel | null> {
    if (responseSettings.observedNotificationChannelId) {
      const channel = await this.client.channels
        .fetch(responseSettings.observedNotificationChannelId)
        .catch(() => null);
      return channel && channel.type === ChannelType.GuildText && channel.guildId === guildId
        ? channel
        : null;
    }

    return (await this.configService.getAdminChannel(guildId)) ?? null;
  }

  private formatDetectionTrigger(
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): string {
    if (detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`Message content unavailable`';
      return sourceMessage
        ? `[Observed message](${sourceMessage.url}): ${safeContent}`
        : `Observed message: ${safeContent}`;
    }

    if (detectionResult.triggerSource === DetectionType.NEW_ACCOUNT) {
      return 'Observed upon joining server';
    }

    if (detectionResult.triggerSource === DetectionType.USER_REPORT) {
      return `Observed via user report: \`${detectionResult.triggerContent || 'No reason provided'}\``;
    }

    if (detectionResult.triggerSource === DetectionType.GPT_ANALYSIS) {
      return `Observed via manual review: \`${detectionResult.triggerContent || 'Manual flag'}\``;
    }

    return 'Observed suspicious activity';
  }

  private createObservedDetectionEmbed(
    member: GuildMember,
    detectionResult: DetectionResult,
    detectionEvents: DetectionEvent[],
    sourceMessage?: Message
  ): EmbedBuilder {
    const accountCreatedAt = new Date(member.user.createdTimestamp);
    const accountCreatedTimestamp = Math.floor(accountCreatedAt.getTime() / 1000);
    const joinedServerTimestamp = member.joinedAt
      ? Math.floor(member.joinedAt.getTime() / 1000)
      : null;
    const confidencePercent = Math.round(detectionResult.confidence * 100);
    const reasonsFormatted = detectionResult.reasons.map((reason) => `• ${reason}`).join('\n');
    const recentEvents = detectionEvents.slice(0, 5);
    const detectionHistory = recentEvents
      .map((event) => {
        const timestamp = Math.floor(new Date(event.detected_at).getTime() / 1000);
        return `• <t:${timestamp}:R>: ${event.detection_type} (${Math.round(event.confidence * 100)}% confidence)${this.formatAccountingSuffix(event)}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('Suspicious Activity Observed')
      .setDescription(
        `Drasil observed suspicious activity from <@${member.id}>. No automatic restriction was applied.`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'Username', value: member.user.tag, inline: true },
        { name: 'User ID', value: member.id, inline: true },
        {
          name: 'Account Created',
          value: `<t:${accountCreatedTimestamp}:F> (<t:${accountCreatedTimestamp}:R>)`,
          inline: false,
        },
        {
          name: 'Joined Server',
          value: joinedServerTimestamp
            ? `<t:${joinedServerTimestamp}:F> (<t:${joinedServerTimestamp}:R>)`
            : 'Unknown',
          inline: false,
        },
        { name: 'Detection Confidence', value: `${confidencePercent}%`, inline: true },
        {
          name: 'Trigger',
          value: this.truncateEmbedFieldValue(
            this.formatDetectionTrigger(detectionResult, sourceMessage)
          ),
        },
        {
          name: 'Reasons',
          value: this.truncateEmbedFieldValue(reasonsFormatted || 'No specific reason provided'),
        }
      )
      .setTimestamp();

    const aiDiagnosticFieldValue = this.formatGptDiagnosticFieldValue(detectionResult);
    if (aiDiagnosticFieldValue) {
      embed.addFields({
        name: 'AI Analysis',
        value: aiDiagnosticFieldValue,
        inline: false,
      });
    }

    const reportAiFieldValue = this.formatReportAiFieldValue(
      detectionResult.reportAiAnalysis ??
        this.findReportAiAnalysis(detectionEvents, detectionResult.detectionEventId)
    );
    if (reportAiFieldValue) {
      embed.addFields({
        name: 'AI Report Triage',
        value: reportAiFieldValue,
        inline: false,
      });
    }

    if (detectionHistory) {
      embed.addFields({
        name: 'Recent Detection History',
        value: this.truncateEmbedFieldValue(detectionHistory),
      });
    }

    return embed;
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
    const countedDetectionEvents = detectionEvents.filter(
      (event) => !isDetectionEventExcludedFromAccounting(event)
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
          entry += this.formatAccountingSuffix(event);
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
        countedDetectionEvents.length > 1
          ? `<@${member.id}> has been flagged as suspicious ${countedDetectionEvents.length} times.`
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

    this.upsertLatestResolutionField(embed, verificationEvent);

    const aiDiagnosticFieldValue = this.formatGptDiagnosticFieldValue(detectionResult);
    if (aiDiagnosticFieldValue) {
      embed.addFields({
        name: 'AI Analysis',
        value: aiDiagnosticFieldValue,
        inline: false,
      });
    }

    const reportAiFieldValue = this.formatReportAiFieldValue(
      detectionResult.reportAiAnalysis ??
        this.findReportAiAnalysis(detectionEvents, detectionResult.detectionEventId)
    );
    if (reportAiFieldValue) {
      embed.addFields({
        name: 'AI Report Triage',
        value: reportAiFieldValue,
        inline: false,
      });
    }

    const actionFailureFieldValue = this.formatVerificationActionFailureFieldValue(
      verificationEvent.metadata
    );
    if (actionFailureFieldValue) {
      embed.addFields({
        name: 'Moderation Action Warning',
        value: actionFailureFieldValue,
        inline: false,
      });
    }

    const caseStaffWarningFieldValue = this.formatCaseStaffRoutingWarningFieldValue(
      verificationEvent.metadata
    );
    if (caseStaffWarningFieldValue) {
      embed.addFields({
        name: 'Case Staff Routing Warning',
        value: caseStaffWarningFieldValue,
        inline: false,
      });
    }

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

    const persistedThreadAnalysis = this.getThreadAnalysisMetadata(verificationEvent.metadata);
    if (persistedThreadAnalysis?.latestAnalysis) {
      embed.addFields({
        name: NotificationManager.THREAD_ANALYSIS_FIELD_NAME,
        value: this.formatThreadAnalysisFieldValue(persistedThreadAnalysis.latestAnalysis),
        inline: false,
      });
    }

    return embed;
  }

  private formatVerificationActionFailureFieldValue(metadata: unknown): string | null {
    const failures = getVerificationActionFailures(metadata);
    if (failures.length === 0) {
      return null;
    }

    const value = failures
      .slice(-3)
      .map((failure) => {
        const timestamp = Math.floor(new Date(failure.at).getTime() / 1000);
        const action =
          failure.action === 'restrict'
            ? 'Apply restricted role'
            : failure.action === 'private_evidence_thread'
              ? 'Create private evidence thread'
              : 'Create case thread';
        const when = Number.isFinite(timestamp) ? ` <t:${timestamp}:R>` : '';
        return `Warning: ${action} failed${when}: ${failure.message}`;
      })
      .join('\n');

    return this.truncateEmbedFieldValue(
      `${value}\nCase record was still created so moderators can review and fix permissions.`
    );
  }

  private formatCaseStaffRoutingWarningFieldValue(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const routing = (metadata as Record<string, unknown>)[CASE_STAFF_ROUTING_METADATA_KEY];
    if (!routing || typeof routing !== 'object' || Array.isArray(routing)) {
      return null;
    }

    const warnings = (routing as { warnings?: unknown }).warnings;
    if (!Array.isArray(warnings) || warnings.length === 0) {
      return null;
    }

    return this.truncateEmbedFieldValue(
      warnings
        .filter((warning): warning is string => typeof warning === 'string' && warning.length > 0)
        .slice(-3)
        .map((warning) => `Warning: ${warning}`)
        .join('\n')
    );
  }

  private formatThreadAnalysisFieldValue(analysis: {
    result: 'likely_legitimate' | 'needs_review' | 'likely_suspicious';
    confidence: number;
    summary: string;
    reasonCodes?: string[];
    legitimacySignals?: string[];
    suspicionSignals?: string[];
    recommendedNextQuestion?: string;
    recommendedAction?: 'none' | 'ask_followup' | 'manual_review' | 'restrict';
    analyzedMessageCount: number;
  }): string {
    const confidencePercent = Math.round(analysis.confidence * 100);
    const lines = [
      `Result: **${analysis.result}** (${confidencePercent}% confidence)`,
      `Analyzed responses: ${analysis.analyzedMessageCount}`,
      `Summary: ${analysis.summary}`,
    ];
    if (analysis.reasonCodes?.length) {
      lines.push(`Reason codes: ${analysis.reasonCodes.join(', ')}`);
    }
    if (analysis.legitimacySignals?.length) {
      lines.push(`Legitimacy signals: ${analysis.legitimacySignals.join('; ')}`);
    }
    if (analysis.suspicionSignals?.length) {
      lines.push(`Suspicion signals: ${analysis.suspicionSignals.join('; ')}`);
    }
    if (analysis.recommendedNextQuestion) {
      lines.push(`Next question: ${analysis.recommendedNextQuestion}`);
    }
    if (analysis.recommendedAction) {
      lines.push(`Recommended action: ${analysis.recommendedAction}`);
    }

    return this.truncateEmbedFieldValue(lines.join('\n'));
  }

  private findReportAiAnalysis(
    detectionEvents: DetectionEvent[],
    detectionEventId?: string
  ): ReportAIAnalysis | null {
    const candidates = detectionEventId
      ? detectionEvents.filter((event) => event.id === detectionEventId)
      : detectionEvents;

    for (const event of candidates) {
      const metadata = this.metadataToRecord(event.metadata);
      const reportAi = metadata.report_ai;
      if (reportAi && typeof reportAi === 'object' && !Array.isArray(reportAi)) {
        return reportAi as ReportAIAnalysis;
      }
    }

    return null;
  }

  private formatReportAiFieldValue(analysis: ReportAIAnalysis | null): string | null {
    if (!analysis) {
      return null;
    }

    const confidencePercent = Math.round(analysis.confidence * 100);
    const lines = [
      `Result: **${analysis.result}** (${confidencePercent}% confidence)`,
      `Summary: ${analysis.summary}`,
      `Recommended action: ${analysis.recommendedAction}`,
      `Images analyzed: ${analysis.analyzedImageCount}`,
    ];
    if (analysis.reasonCodes.length) {
      lines.push(`Reason codes: ${analysis.reasonCodes.join(', ')}`);
    }
    if (analysis.evidenceCategories.length) {
      lines.push(`Evidence: ${analysis.evidenceCategories.join(', ')}`);
    }
    if (analysis.concerns.length) {
      lines.push(`Concerns: ${analysis.concerns.join('; ')}`);
    }

    return this.truncateEmbedFieldValue(lines.join('\n'));
  }

  private formatGptDiagnosticFieldValue(detectionResult: DetectionResult): string | null {
    const analysis = detectionResult.gptAnalysis;
    if (!analysis) {
      return null;
    }

    const confidencePercent = Math.round(analysis.confidence * 100);
    const reasonCodes = analysis.reasonCodes.length ? analysis.reasonCodes.join(', ') : 'none';
    const resultLine = analysis.isFallback
      ? 'Result: **Unavailable**'
      : `Result: **${analysis.result}** (${confidencePercent}% confidence)`;
    return this.truncateEmbedFieldValue(
      [
        resultLine,
        `Primary signal: ${analysis.primarySignal}`,
        `Reason codes: ${reasonCodes}`,
        `Summary: ${analysis.summary}`,
      ].join('\n')
    );
  }

  private formatAccountingSuffix(event: DetectionEvent): string {
    return isDetectionEventExcludedFromAccounting(event) ? ' - ignored for future accounting' : '';
  }

  private getThreadAnalysisMetadata(
    metadata: VerificationEvent['metadata']
  ): ThreadAnalysisMetadata | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const threadAnalysis = (metadata as { thread_analysis?: unknown }).thread_analysis;
    if (!threadAnalysis || typeof threadAnalysis !== 'object' || Array.isArray(threadAnalysis)) {
      return null;
    }

    const metadataRecord = threadAnalysis as ThreadAnalysisMetadata;
    const latestAnalysis =
      metadataRecord.latestAnalysis &&
      typeof metadataRecord.latestAnalysis === 'object' &&
      !Array.isArray(metadataRecord.latestAnalysis)
        ? (metadataRecord.latestAnalysis as Record<string, unknown>)
        : null;
    if (!latestAnalysis) {
      return metadataRecord;
    }

    const rawResult = latestAnalysis.result;
    const result =
      rawResult === 'likely_legitimate' ||
      rawResult === 'needs_review' ||
      rawResult === 'likely_suspicious'
        ? rawResult
        : rawResult === 'OK'
          ? 'likely_legitimate'
          : rawResult === 'SUSPICIOUS'
            ? 'likely_suspicious'
            : null;

    if (
      !result ||
      typeof latestAnalysis.confidence !== 'number' ||
      typeof latestAnalysis.summary !== 'string' ||
      typeof latestAnalysis.analyzedMessageCount !== 'number'
    ) {
      return metadataRecord;
    }

    return {
      ...metadataRecord,
      latestAnalysis: {
        result,
        confidence: latestAnalysis.confidence,
        summary: latestAnalysis.summary,
        reasonCodes: Array.isArray(latestAnalysis.reasonCodes)
          ? latestAnalysis.reasonCodes.filter((value): value is string => typeof value === 'string')
          : [],
        legitimacySignals: Array.isArray(latestAnalysis.legitimacySignals)
          ? latestAnalysis.legitimacySignals.filter(
              (value): value is string => typeof value === 'string'
            )
          : [],
        suspicionSignals: Array.isArray(latestAnalysis.suspicionSignals)
          ? latestAnalysis.suspicionSignals.filter(
              (value): value is string => typeof value === 'string'
            )
          : [],
        recommendedNextQuestion:
          typeof latestAnalysis.recommendedNextQuestion === 'string'
            ? latestAnalysis.recommendedNextQuestion
            : undefined,
        recommendedAction:
          latestAnalysis.recommendedAction === 'none' ||
          latestAnalysis.recommendedAction === 'ask_followup' ||
          latestAnalysis.recommendedAction === 'manual_review' ||
          latestAnalysis.recommendedAction === 'restrict'
            ? latestAnalysis.recommendedAction
            : 'manual_review',
        analyzedMessageCount: latestAnalysis.analyzedMessageCount,
      },
    };
  }

  /**
   * Creates an action row with admin action buttons
   * @param userId The ID of the user the actions apply to
   * @returns An ActionRowBuilder with buttons
   */
  private createActionRow(userId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildCaseAdminActionsCustomId(userId))
        .setLabel('Admin Actions')
        .setStyle(ButtonStyle.Primary)
    );
  }

  private createObservedActionRows(
    userId: string,
    detectionEventId: string
  ): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildObservedAdminActionsCustomId(userId, detectionEventId))
          .setLabel('Admin Actions')
          .setStyle(ButtonStyle.Primary)
      ),
    ];
  }

  /**
   * Sets up a verification channel with appropriate permissions
   * @param guild The Discord guild to set up the channel in
   * @param restrictedRoleId The ID of the restricted role
   * @returns The ID of the created channel or null if creation failed
   */
  public async setupVerificationChannel(
    guild: Guild,
    restrictedRoleId: string,
    persistConfig = true,
    onChannelCreated?: (channelId: string) => void,
    configuredVerificationChannelId?: string
  ): Promise<string | null> {
    if (!restrictedRoleId) {
      console.error('Restricted role ID is required to set up verification channel');
      return null;
    }

    try {
      const permissionOverwrites = this.buildVerificationChannelPermissionOverwrites(
        guild,
        restrictedRoleId
      );
      const configuredVerificationChannel = await this.findConfiguredVerificationChannel(
        guild,
        configuredVerificationChannelId
      );
      if (configuredVerificationChannel) {
        await configuredVerificationChannel.permissionOverwrites.set(
          permissionOverwrites,
          'Sync Drasil verification channel permissions'
        );

        if (persistConfig) {
          await this.configService.updateServerConfig(guild.id, {
            verification_channel_id: configuredVerificationChannel.id,
          });
        }

        return configuredVerificationChannel.id;
      }

      // Create the verification channel
      const channelOptions: GuildChannelCreateOptions = {
        name: VERIFICATION_CHANNEL_NAME,
        type: ChannelType.GuildText,
        permissionOverwrites: permissionOverwrites,
        topic:
          'This channel is for verifying users flagged by the anti-spam system. Only admins and flagged users can see this channel.',
      };

      const verificationChannel = await guild.channels.create(channelOptions);
      onChannelCreated?.(verificationChannel.id);

      if (persistConfig) {
        await this.configService.updateServerConfig(guild.id, {
          verification_channel_id: verificationChannel.id,
        });
      }

      return verificationChannel.id;
    } catch (error) {
      console.error('Failed to set up verification channel:', error);
      return null;
    }
  }

  private buildVerificationChannelPermissionOverwrites(
    guild: Guild,
    restrictedRoleId: string
  ): OverwriteResolvable[] {
    const permissionOverwrites: OverwriteResolvable[] = [
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
    ];

    if (this.client.user?.id) {
      permissionOverwrites.push({
        id: this.client.user.id,
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
      });
    }

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

    return permissionOverwrites;
  }

  private async findConfiguredVerificationChannel(
    guild: Guild,
    resolvedVerificationChannelId?: string
  ): Promise<TextChannel | null> {
    let verificationChannelId = resolvedVerificationChannelId ?? null;
    if (!verificationChannelId) {
      const serverConfig = await this.configService.getServerConfig(guild.id).catch((error) => {
        console.warn(
          'Failed to load server config while checking for an existing verification channel:',
          error
        );
        return null;
      });
      verificationChannelId = serverConfig?.verification_channel_id ?? null;
    }

    if (!verificationChannelId) {
      const matchingChannels = this.findMatchingVerificationChannels(guild);
      if (matchingChannels.length === 1) {
        return matchingChannels[0];
      }
      if (matchingChannels.length > 1) {
        console.warn(
          `Multiple #${VERIFICATION_CHANNEL_NAME} channels found in guild ${guild.id}; require an explicit verification channel.`
        );
      }
      return null;
    }

    const cachedChannel = guild.channels.cache.find(
      (channel) => channel.id === verificationChannelId
    );
    if (this.isTextChannel(cachedChannel)) {
      return cachedChannel;
    }

    const fetchedChannel = await guild.channels.fetch(verificationChannelId).catch((error) => {
      console.warn(
        'Failed to fetch configured verification channel while setting up permissions:',
        error
      );
      return null;
    });

    return this.isTextChannel(fetchedChannel) ? fetchedChannel : null;
  }

  private findMatchingVerificationChannels(guild: Guild): TextChannel[] {
    const guildLike = guild as { channels?: { cache?: unknown } };
    const values = this.getCachedChannelValues(guildLike.channels?.cache);

    return values.filter(
      (channel): channel is TextChannel =>
        this.isTextChannel(channel as GuildBasedChannel | null | undefined) &&
        (channel as TextChannel).name === VERIFICATION_CHANNEL_NAME
    );
  }

  private getCachedChannelValues(cache: unknown): unknown[] {
    const cacheWithValues = cache as { values?: unknown } | null;
    if (typeof cacheWithValues?.values === 'function') {
      return [...(cacheWithValues.values as () => Iterable<unknown>)()];
    }

    const iterableCache = cache as { [Symbol.iterator]?: unknown } | null;
    if (typeof iterableCache?.[Symbol.iterator] === 'function') {
      return [...(cache as Iterable<unknown>)];
    }

    return [];
  }

  private isTextChannel(channel: GuildBasedChannel | null | undefined): channel is TextChannel {
    return channel?.type === ChannelType.GuildText;
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

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      // Get all detection events for this user in this server
      const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
        interaction.guildId,
        userId
      );

      if (detectionEvents.length === 0) {
        await interaction.editReply({
          content: 'No detection history found.',
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
      await interaction.editReply({
        content: `Detection history for <@${userId}>:`,
        files: [
          {
            name: `detection_history_${userId}.txt`,
            attachment: buffer,
          },
        ],
      });

      return true;
    } catch (error) {
      console.error('Failed to handle history button click:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'Failed to fetch detection history. Please try again later.',
        });
      } else {
        await interaction.reply({
          content: 'Failed to fetch detection history. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return false;
    }
  }

  async updateNotificationButtons(
    verificationEvent: VerificationEvent,
    newStatus: VerificationStatus
  ): Promise<void> {
    void newStatus;

    if (!verificationEvent.notification_message_id) {
      throw new Error('No notification message ID found for verification event');
    }

    const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);

    if (!adminChannel) {
      throw new Error('No admin channel found for verification event');
    }

    const message = await adminChannel.messages.fetch(verificationEvent.notification_message_id);

    await message.edit({
      allowedMentions: { parse: [] },
      components: [this.createActionRow(verificationEvent.user_id)],
    });
  }
}
