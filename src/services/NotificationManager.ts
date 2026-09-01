import { injectable, inject, unmanaged } from 'inversify';
import {
  Client,
  EmbedBuilder,
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
  type MessageCreateOptions,
  MessageFlags,
  TextChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import {
  CaseKind,
  DetectionEvent,
  DetectionType,
  VerificationStatus,
  AdminActionType,
  VerificationEvent,
  type VerificationChannelManagedOverwriteState,
  type VerificationChannelPermissionSyncState,
} from '../repositories/types';
import { DetectionHistoryFormatter } from '../utils/DetectionHistoryFormatter';
import type { VerificationThreadAnalysisResult } from './GPTService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { getReportAiSettings, type ReportAttachmentMetadata } from '../utils/reportAiSettings';
import {
  buildSpoilerImageAttachmentFileResult,
  messageAttachmentsToReportMetadata,
  selectEligibleMessageReportImageAttachments,
} from '../utils/reportAttachments';
import { NotificationPresentationBuilder } from './NotificationPresentationBuilder';
import {
  CASE_ROLE_VERIFICATION_ALLOW_PERMISSIONS,
  CASE_ROLE_VERIFICATION_DENY_PERMISSIONS,
} from '../utils/verificationChannelPermissions';

const VERIFICATION_CHANNEL_NAME = 'verification';
const DISCORD_UNKNOWN_CHANNEL_ERROR_CODE = 10003;
const DISCORD_MESSAGE_CONTENT_MAX_LENGTH = 2000;
const MIRRORED_THREAD_MESSAGE_CONTENT_MAX_LENGTH = 1200;
const MIRRORED_THREAD_MESSAGE_ATTACHMENT_LIMIT = 5;
const MIRRORED_THREAD_MESSAGE_TRUNCATION_NOTICE =
  '\n\n[Support-check reply mirror truncated to fit Discord message limits.]';

interface MirroredThreadImageFileResult {
  readonly files: NonNullable<MessageCreateOptions['files']>;
  readonly copiedAttachmentIds: Set<string>;
}

export type AccountQuarantineAttentionReason =
  | 'containment_breach'
  | 'containment_incomplete'
  | 'attention_delivery_incomplete'
  | 'role_restoration_incomplete';

export type CaptchaAttentionReason =
  | 'delivery_failed'
  | 'expired'
  | 'submission_limit'
  | 'automatic_resolution_held';

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
    admin: Pick<User, 'id'>,
    thread?: ThreadChannel
  ): Promise<boolean>;

  /**
   * Sets up a verification channel with appropriate permissions
   * @param guild The Discord guild to set up the channel in
   * @param caseRoleId The ID of the case role
   * @returns The ID of the created channel or null if creation failed
   */
  setupVerificationChannel(
    guild: Guild,
    caseRoleId: string,
    persistConfig?: boolean,
    onChannelCreated?: (
      channelId: string,
      state: VerificationChannelPermissionSyncState
    ) => void | Promise<void>,
    configuredVerificationChannelId?: string,
    onPermissionsUpdated?: (
      snapshot: VerificationPermissionSnapshot,
      state: VerificationChannelPermissionSyncState
    ) => void | Promise<void>,
    previousSyncStateOverride?: VerificationChannelPermissionSyncState
  ): Promise<string | null>;
  restoreVerificationChannelPermissions?(
    guild: Guild,
    snapshot: VerificationPermissionSnapshot
  ): Promise<boolean>;
  restoreVerificationChannelManagedPermissions?(
    guild: Guild,
    state: VerificationChannelPermissionSyncState,
    onPermissionsUpdated?: (snapshot: VerificationPermissionSnapshot) => void
  ): Promise<boolean>;
  restoreLegacyVerificationChannelPermissions?(
    guild: Guild,
    channelId: string,
    caseRoleId: string,
    onPermissionsUpdated?: (snapshot: VerificationPermissionSnapshot) => void
  ): Promise<boolean>;

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

  mirrorVerificationThreadMessageToEvidenceThread(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<boolean>;

  notifyVerificationThreadUserResponse(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<boolean>;

  notifyAccountQuarantineAttention(
    verificationEvent: VerificationEvent,
    reason: AccountQuarantineAttentionReason,
    sourceMessage?: Message
  ): Promise<boolean>;

  notifyCaptchaAttention?(
    verificationEvent: VerificationEvent,
    reason: CaptchaAttentionReason
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
    actionType?: AdminActionType
  ): Promise<boolean>;

  restoreObservedDetectionActions(
    detectionEventId: string,
    actionDescription: string,
    admin: User
  ): Promise<boolean>;
}

export interface VerificationPermissionSnapshotEntry {
  readonly id: string;
  readonly type: 0 | 1;
  readonly allow: bigint;
  readonly deny: bigint;
}

export interface VerificationPermissionSnapshot {
  readonly channelId: string;
  readonly entries: readonly VerificationPermissionSnapshotEntry[];
}

interface VerificationPermissionOverwrite {
  readonly id: string;
  readonly type: 0 | 1;
  readonly allow?: readonly bigint[];
  readonly deny?: readonly bigint[];
}

interface ObservedDetectionMetadata {
  observed_notification_channel_id?: string;
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
  private presentationBuilder: NotificationPresentationBuilder;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @unmanaged()
    presentationBuilder: NotificationPresentationBuilder = new NotificationPresentationBuilder()
  ) {
    this.client = client;
    this.configService = configService;
    this.detectionEventsRepository = detectionEventsRepository;
    this.presentationBuilder = presentationBuilder;
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
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const responseSettings = getDetectionResponseSettings(serverConfig.settings);
    const notificationChannel = await this.getModerationNotificationChannel(
      member.guild.id,
      responseSettings
    );
    if (!notificationChannel) {
      console.error('No moderation notification channel configured');
      return null;
    }

    try {
      const detectionEvents = await this.detectionEventsRepository.findByServerAndUser(
        member.guild.id,
        member.id
      );
      const embed = this.presentationBuilder.createSuspiciousUserEmbed(
        member,
        detectionResult,
        verificationEvent,
        detectionEvents,
        sourceMessage
      );
      this.presentationBuilder.upsertAccountQuarantinePresentation(embed, verificationEvent);
      const actionRows = this.presentationBuilder.createAdminNotificationActionRows(member.id, {
        guildId: member.guild.id,
        verificationEventId: verificationEvent.id,
        verificationStatus: verificationEvent.status,
        caseKind: verificationEvent.case_kind,
        caseMembershipState: this.presentationBuilder.getCaseMembershipState(verificationEvent),
        caseAttentionState: verificationEvent.attention_state,
        includeBanAction: responseSettings.moderatorBanActionEnabled,
      });

      // If we have an existing message, update it, otherwise create new
      if (verificationEvent.notification_message_id) {
        const existingChannel = await this.getStoredNotificationChannel(
          member.guild.id,
          verificationEvent.notification_channel_id,
          notificationChannel
        );
        const existingMessage = await existingChannel.messages
          .fetch(verificationEvent.notification_message_id)
          .catch(() => null);
        if (existingMessage) {
          return await existingMessage.edit({
            allowedMentions: { parse: [] },
            embeds: [embed],
            components: actionRows,
          });
        }
      }

      // Create a new message
      const notificationRoleIds = this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
      return await notificationChannel.send({
        content: this.presentationBuilder.formatRoleMentions(notificationRoleIds),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(notificationRoleIds),
        embeds: [embed],
        components: actionRows,
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
      const notificationChannel = await this.getModerationNotificationChannel(
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
      const embed = this.presentationBuilder.createObservedDetectionEmbed(
        member,
        detectionResult,
        detectionEvents,
        sourceMessage
      );
      const actionDetectionEventId = detectionResult.detectionEventId ?? detectionEvents[0]?.id;
      const components = actionDetectionEventId
        ? this.presentationBuilder.createObservedActionRows(
            member.id,
            actionDetectionEventId,
            member.guild.id,
            {
              includeBanAction: responseSettings.moderatorBanActionEnabled,
              kind:
                detectionResult.triggerSource === DetectionType.USER_REPORT ? 'report' : 'alert',
            }
          )
        : [];

      let notificationMessage: Message | null = null;
      if (existingNotification?.observed_notification_message_id) {
        const existingMessage = await notificationChannel.messages
          .fetch(existingNotification.observed_notification_message_id)
          .catch(() => null);
        if (existingMessage) {
          notificationMessage = await existingMessage.edit({
            allowedMentions: this.presentationBuilder.createAdminAllowedMentions(),
            embeds: [embed],
            components,
          });
        }
      }

      if (!notificationMessage) {
        const notificationRoleIds =
          this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
        notificationMessage = await notificationChannel.send({
          content: this.presentationBuilder.formatRoleMentions(notificationRoleIds),
          allowedMentions: this.presentationBuilder.createAdminAllowedMentions(notificationRoleIds),
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
          observed_notification_channel_id: notificationMessage.channelId,
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
    actionType?: AdminActionType
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
      const fallbackChannel = await this.getModerationNotificationChannel(
        detectionEvent.server_id,
        responseSettings
      );
      const notificationChannel = fallbackChannel
        ? await this.getStoredNotificationChannel(
            detectionEvent.server_id,
            metadata.observed_notification_channel_id,
            fallbackChannel
          )
        : null;
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
      this.presentationBuilder.addObservedActionTakenField(
        updatedEmbed,
        actionDescription,
        admin.id,
        timestamp,
        actionType
      );

      const components = this.presentationBuilder.createObservedActionRows(
        detectionEvent.user_id,
        detectionEvent.id,
        detectionEvent.server_id,
        {
          includeBanAction: responseSettings.moderatorBanActionEnabled,
          actioned: true,
          kind: this.getObservedActionKind(detectionEvent),
        }
      );

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
      const fallbackChannel = await this.getModerationNotificationChannel(
        detectionEvent.server_id,
        responseSettings
      );
      const notificationChannel = fallbackChannel
        ? await this.getStoredNotificationChannel(
            detectionEvent.server_id,
            metadata.observed_notification_channel_id,
            fallbackChannel
          )
        : null;
      if (!notificationChannel) {
        return false;
      }

      const message = await notificationChannel.messages
        .fetch(metadata.observed_notification_message_id)
        .catch(() => null);
      if (!message) {
        return false;
      }

      const components = this.presentationBuilder.createObservedActionRows(
        detectionEvent.user_id,
        detectionEvent.id,
        detectionEvent.server_id,
        {
          includeBanAction: responseSettings.moderatorBanActionEnabled,
          kind: this.getObservedActionKind(detectionEvent),
        }
      );
      if (!message.embeds.length) {
        await message.edit({ allowedMentions: { parse: [] }, components });
        return true;
      }

      const updatedEmbed = EmbedBuilder.from(message.embeds[0]);
      const timestamp = Math.floor(Date.now() / 1000);
      this.presentationBuilder.addObservedActionRevertedField(
        updatedEmbed,
        actionDescription,
        admin.id,
        timestamp
      );

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

  public async mirrorVerificationThreadMessageToEvidenceThread(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<boolean> {
    if (!verificationEvent.private_evidence_thread_id) {
      return false;
    }
    if (verificationEvent.private_evidence_thread_id === message.channelId) {
      return false;
    }

    try {
      const channel = await this.client.channels
        .fetch(verificationEvent.private_evidence_thread_id)
        .catch(() => null);
      const send = (channel as { send?: unknown } | null)?.send;
      if (typeof send !== 'function') {
        return false;
      }

      const imageFiles = await this.buildMirroredThreadImageFiles(verificationEvent, message);
      await (channel as { send: ThreadChannel['send'] }).send({
        content: this.formatVerificationThreadMessageMirror(
          message,
          imageFiles.copiedAttachmentIds
        ),
        ...(imageFiles.files.length ? { files: imageFiles.files } : {}),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(),
      });
      return true;
    } catch (error) {
      console.warn(
        `Failed to mirror verification thread message ${message.id} to private evidence thread ${verificationEvent.private_evidence_thread_id}:`,
        error
      );
      return false;
    }
  }

  public async notifyVerificationThreadUserResponse(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<boolean> {
    try {
      const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
      const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);
      if (!adminChannel) {
        return false;
      }

      const notificationRoleIds = this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
      const responseLabel =
        verificationEvent.case_kind === CaseKind.COMPROMISED_ACCOUNT
          ? 'Quarantined user reports account recovery. Verify before releasing quarantine.'
          : 'Support-check reply needs review.';
      const lines = [
        `${this.presentationBuilder.formatRoleMentions(notificationRoleIds)} ${responseLabel}`.trim(),
        `User: <@${verificationEvent.user_id}> (\`${verificationEvent.user_id}\`)`,
        `Case: \`${verificationEvent.id}\``,
        `Support thread: <#${message.channelId}>`,
        verificationEvent.private_evidence_thread_id
          ? `Evidence thread: <#${verificationEvent.private_evidence_thread_id}>`
          : null,
        `Message: ${message.url}`,
      ].filter((line): line is string => Boolean(line));

      await adminChannel.send({
        content: lines.join('\n'),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(notificationRoleIds),
      });
      return true;
    } catch (error) {
      console.warn(
        `Failed to notify admins about support-check reply for verification event ${verificationEvent.id}:`,
        error
      );
      return false;
    }
  }

  public async notifyAccountQuarantineAttention(
    verificationEvent: VerificationEvent,
    reason: AccountQuarantineAttentionReason,
    sourceMessage?: Message
  ): Promise<boolean> {
    try {
      const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
      const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);
      if (!adminChannel) {
        return false;
      }

      const notificationRoleIds = this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
      const summary =
        reason === 'containment_breach'
          ? 'Quarantine containment breach detected. Review immediately.'
          : reason === 'attention_delivery_incomplete'
            ? 'A quarantine alert may not have been delivered before recovery. Review immediately.'
            : reason === 'role_restoration_incomplete'
              ? 'Account verification completed, but quarantined roles still need restoration.'
              : 'Quarantine containment could not be confirmed. Review immediately.';
      const lines = [
        `${this.presentationBuilder.formatRoleMentions(notificationRoleIds)} ${summary}`.trim(),
        `User: <@${verificationEvent.user_id}> (\`${verificationEvent.user_id}\`)`,
        `Case: \`${verificationEvent.id}\``,
        verificationEvent.thread_id ? `Support thread: <#${verificationEvent.thread_id}>` : null,
        verificationEvent.private_evidence_thread_id
          ? `Evidence thread: <#${verificationEvent.private_evidence_thread_id}>`
          : null,
        sourceMessage ? `Source message: ${sourceMessage.url}` : null,
      ].filter((line): line is string => Boolean(line));
      await adminChannel.send({
        content: lines.join('\n'),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(notificationRoleIds),
      });
      return true;
    } catch (error) {
      console.warn(
        `Failed to notify admins about account quarantine attention for case ${verificationEvent.id}:`,
        error
      );
      return false;
    }
  }

  public async notifyCaptchaAttention(
    verificationEvent: VerificationEvent,
    reason: CaptchaAttentionReason
  ): Promise<boolean> {
    try {
      const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
      const adminChannel = await this.configService.getAdminChannel(verificationEvent.server_id);
      if (!adminChannel) {
        return false;
      }

      const notificationRoleIds = this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
      const summary =
        reason === 'delivery_failed'
          ? 'A browser security check could not be delivered. Review the case and retry when ready.'
          : reason === 'expired'
            ? 'A browser security check expired. The user remains restricted.'
            : reason === 'submission_limit'
              ? 'A browser security check reached its submission limit. The user remains restricted.'
              : 'A browser security check passed, but current case state prevented automatic resolution.';
      const lines = [
        `${this.presentationBuilder.formatRoleMentions(notificationRoleIds)} ${summary}`.trim(),
        `User: <@${verificationEvent.user_id}> (\`${verificationEvent.user_id}\`)`,
        `Case: \`${verificationEvent.id}\``,
        verificationEvent.thread_id ? `Support thread: <#${verificationEvent.thread_id}>` : null,
        verificationEvent.private_evidence_thread_id
          ? `Evidence thread: <#${verificationEvent.private_evidence_thread_id}>`
          : null,
      ].filter((line): line is string => Boolean(line));
      await adminChannel.send({
        content: lines.join('\n'),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(notificationRoleIds),
      });
      return true;
    } catch (error) {
      console.warn(
        `Failed to notify admins about browser security-check attention for case ${verificationEvent.id}:`,
        error
      );
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
    admin: Pick<User, 'id'>,
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

      this.presentationBuilder.upsertAdminActionLog(
        updatedEmbed,
        actionTaken,
        admin.id,
        Math.floor(Date.now() / 1000),
        thread?.url,
        Boolean(message.guildId)
      );

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

      this.presentationBuilder.upsertThreadAnalysisField(
        updatedEmbed,
        analysis,
        analyzedMessageCount
      );

      await message.edit({ allowedMentions: { parse: [] }, embeds: [updatedEmbed] });
      return true;
    } catch (error) {
      console.error('Failed to update verification thread analysis:', error);
      return false;
    }
  }

  private metadataToRecord(metadata: DetectionEvent['metadata']): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...metadata } as Record<string, unknown>;
  }

  private getObservedActionKind(detectionEvent: DetectionEvent): 'alert' | 'report' {
    return detectionEvent.detection_type === DetectionType.USER_REPORT ? 'report' : 'alert';
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

  private async getModerationNotificationChannel(
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

  private async getStoredNotificationChannel(
    guildId: string,
    channelId: string | null | undefined,
    fallbackChannel: TextChannel
  ): Promise<TextChannel> {
    if (!channelId || channelId === fallbackChannel.id) {
      return fallbackChannel;
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    return channel && channel.type === ChannelType.GuildText && channel.guildId === guildId
      ? channel
      : fallbackChannel;
  }

  private async getMessageForVerificationEvent(
    verificationEvent: VerificationEvent
  ): Promise<Message> {
    if (!verificationEvent.notification_message_id) {
      throw new Error('No notification message ID found for verification event');
    }

    const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
    const responseSettings = getDetectionResponseSettings(serverConfig.settings);
    const fallbackChannel = await this.getModerationNotificationChannel(
      verificationEvent.server_id,
      responseSettings
    );

    if (!fallbackChannel) {
      throw new Error('No moderation notification channel found for verification event');
    }

    const notificationChannel = await this.getStoredNotificationChannel(
      verificationEvent.server_id,
      verificationEvent.notification_channel_id,
      fallbackChannel
    );

    return await notificationChannel.messages.fetch(verificationEvent.notification_message_id);
  }

  /**
   * Sets up a verification channel with appropriate permissions
   * @param guild The Discord guild to set up the channel in
   * @param caseRoleId The ID of the case role
   * @returns The ID of the created channel or null if creation failed
   */
  public async setupVerificationChannel(
    guild: Guild,
    caseRoleId: string,
    persistConfig = true,
    onChannelCreated?: (
      channelId: string,
      state: VerificationChannelPermissionSyncState
    ) => void | Promise<void>,
    configuredVerificationChannelId?: string,
    onPermissionsUpdated?: (
      snapshot: VerificationPermissionSnapshot,
      state: VerificationChannelPermissionSyncState
    ) => void | Promise<void>,
    previousSyncStateOverride?: VerificationChannelPermissionSyncState
  ): Promise<string | null> {
    if (!caseRoleId) {
      console.error('Case role ID is required to set up verification channel');
      return null;
    }

    let createdVerificationChannel: GuildBasedChannel | null = null;
    try {
      const serverConfig = await this.configService.getServerConfig(guild.id);
      const previousSyncState =
        previousSyncStateOverride ?? serverConfig.settings.verification_channel_permission_sync;
      const permissionOverwrites = this.buildVerificationChannelPermissionOverwrites(
        guild,
        caseRoleId
      );
      const configuredVerificationChannel = await this.findConfiguredVerificationChannel(
        guild,
        configuredVerificationChannelId
      );
      if (configuredVerificationChannel) {
        const snapshot = this.snapshotPermissionOverwrites(configuredVerificationChannel);
        const nextSyncState = this.buildVerificationPermissionSyncState(
          snapshot,
          previousSyncState,
          permissionOverwrites
        );
        await onPermissionsUpdated?.(snapshot, nextSyncState);
        if (persistConfig) {
          await this.persistVerificationChannelConfiguration(
            guild.id,
            configuredVerificationChannel.id,
            nextSyncState
          );
        }
        await configuredVerificationChannel.permissionOverwrites.set(
          this.mergeVerificationChannelPermissionOverwrites(
            snapshot,
            permissionOverwrites,
            previousSyncState
          ),
          'Sync Drasil verification channel permissions'
        );

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
      createdVerificationChannel = verificationChannel;
      const nextSyncState = this.buildVerificationPermissionSyncState(
        { channelId: verificationChannel.id, entries: [] },
        undefined,
        permissionOverwrites
      );
      await onChannelCreated?.(verificationChannel.id, nextSyncState);

      if (persistConfig) {
        await this.persistVerificationChannelConfiguration(
          guild.id,
          verificationChannel.id,
          nextSyncState
        );
      }

      return verificationChannel.id;
    } catch (error) {
      if (createdVerificationChannel) {
        try {
          await createdVerificationChannel.delete(
            'Rolling back Drasil verification channel after setup persistence failed'
          );
        } catch (rollbackError) {
          console.error('Failed to roll back created verification channel:', rollbackError);
        }
      }
      console.error('Failed to set up verification channel:', error);
      return null;
    }
  }

  private async persistVerificationChannelConfiguration(
    guildId: string,
    channelId: string,
    state: VerificationChannelPermissionSyncState
  ): Promise<void> {
    await this.configService.updateServerSettings(guildId, {
      verification_channel_permission_sync: state,
    });
    await this.configService.updateServerConfig(guildId, {
      verification_channel_id: channelId,
    });
  }

  public async restoreVerificationChannelPermissions(
    guild: Guild,
    snapshot: VerificationPermissionSnapshot
  ): Promise<boolean> {
    try {
      const channel = await guild.channels.fetch(snapshot.channelId).catch(() => null);
      if (channel?.type !== ChannelType.GuildText) {
        return false;
      }
      await channel.permissionOverwrites.set(
        snapshot.entries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          allow: entry.allow,
          deny: entry.deny,
        })),
        'Roll back Drasil verification channel permission sync'
      );
      return true;
    } catch (error) {
      console.error(`Failed to restore verification permissions for ${snapshot.channelId}:`, error);
      return false;
    }
  }

  public async restoreVerificationChannelManagedPermissions(
    guild: Guild,
    state: VerificationChannelPermissionSyncState,
    onPermissionsUpdated?: (snapshot: VerificationPermissionSnapshot) => void
  ): Promise<boolean> {
    try {
      const channel = await guild.channels.fetch(state.channel_id).catch((error: unknown) => {
        if (this.isUnknownChannelError(error)) {
          return null;
        }
        throw error;
      });
      if (!channel) {
        return true;
      }
      if (channel.type !== ChannelType.GuildText) {
        return false;
      }
      const snapshot = this.snapshotPermissionOverwrites(channel);
      onPermissionsUpdated?.(snapshot);
      await channel.permissionOverwrites.set(
        this.restoreManagedPermissionOverwrites(snapshot, state),
        'Restore retired Drasil verification channel permissions'
      );
      return true;
    } catch (error) {
      console.error(
        `Failed to restore Drasil-managed verification permissions for ${state.channel_id}:`,
        error
      );
      return false;
    }
  }

  public async restoreLegacyVerificationChannelPermissions(
    guild: Guild,
    channelId: string,
    caseRoleId: string,
    onPermissionsUpdated?: (snapshot: VerificationPermissionSnapshot) => void
  ): Promise<boolean> {
    // The shipped pre-provenance path replaced the complete overwrite set, so no prior values
    // can be reconstructed. Only stable identities can safely be treated as Drasil-managed:
    // current admin-role permissions may not match the roles setup originally selected.
    const legacyState: VerificationChannelPermissionSyncState = {
      channel_id: channelId,
      managed_overwrites: this.buildLegacyVerificationChannelPermissionOverwrites(
        guild,
        caseRoleId
      ).map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        managed_bits: (
          this.combinePermissionBits(overwrite.allow) | this.combinePermissionBits(overwrite.deny)
        ).toString(),
        original_overwrite: {
          existed: false,
          allow: '0',
          deny: '0',
        },
      })),
    };
    return this.restoreVerificationChannelManagedPermissions(
      guild,
      legacyState,
      onPermissionsUpdated
    );
  }

  private snapshotPermissionOverwrites(channel: TextChannel): VerificationPermissionSnapshot {
    type ExistingOverwrite = {
      readonly id: string;
      readonly type: 0 | 1;
      readonly allow: { readonly bitfield: bigint };
      readonly deny: { readonly bitfield: bigint };
    };
    const cache = channel.permissionOverwrites.cache as
      | { values?: () => IterableIterator<ExistingOverwrite> }
      | undefined;
    const existingOverwrites = typeof cache?.values === 'function' ? [...cache.values()] : [];
    return {
      channelId: channel.id,
      entries: existingOverwrites.map((existing) => ({
        id: existing.id,
        type: existing.type,
        allow: existing.allow.bitfield,
        deny: existing.deny.bitfield,
      })),
    };
  }

  private isUnknownChannelError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === DISCORD_UNKNOWN_CHANNEL_ERROR_CODE
    );
  }

  private buildVerificationChannelPermissionOverwrites(
    guild: Guild,
    caseRoleId: string
  ): VerificationPermissionOverwrite[] {
    const permissionOverwrites = this.buildLegacyVerificationChannelPermissionOverwrites(
      guild,
      caseRoleId
    );

    // Find admin roles by checking for manage channels permission
    const adminRoles = guild.roles.cache.filter((role) =>
      role.permissions.has(PermissionFlagsBits.ManageChannels)
    );

    // Add admin roles to permission overwrites
    adminRoles.forEach((role) => {
      permissionOverwrites.push({
        id: role.id,
        type: 0,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    });

    return permissionOverwrites;
  }

  private buildLegacyVerificationChannelPermissionOverwrites(
    guild: Guild,
    caseRoleId: string
  ): VerificationPermissionOverwrite[] {
    const permissionOverwrites: VerificationPermissionOverwrite[] = [
      // Default role (everyone) - deny access
      {
        id: guild.roles.everyone.id,
        type: 0,
        deny: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.CreatePrivateThreads,
        ],
      },
      // Case role - can use its private thread without posting in the shared parent channel.
      {
        id: caseRoleId,
        type: 0,
        allow: CASE_ROLE_VERIFICATION_ALLOW_PERMISSIONS,
        deny: CASE_ROLE_VERIFICATION_DENY_PERMISSIONS,
      },
    ];

    if (this.client.user?.id) {
      permissionOverwrites.push({
        id: this.client.user.id,
        type: 1,
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

    return permissionOverwrites;
  }

  private mergeVerificationChannelPermissionOverwrites(
    snapshot: VerificationPermissionSnapshot,
    desired: readonly VerificationPermissionOverwrite[],
    previousSyncState: VerificationChannelPermissionSyncState | undefined
  ): OverwriteResolvable[] {
    const desiredIds = new Set(desired.map((overwrite) => overwrite.id));
    const existingById = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
    const preserved = snapshot.entries
      .filter((entry) => !desiredIds.has(entry.id))
      .flatMap((entry) => {
        const previousManagedOverwrite = this.findManagedOverwriteState(
          previousSyncState,
          snapshot.channelId,
          entry.id,
          entry.type
        );
        if (!previousManagedOverwrite) {
          return [{ id: entry.id, type: entry.type, allow: entry.allow, deny: entry.deny }];
        }

        const managedBits = BigInt(previousManagedOverwrite.managed_bits);
        const original = previousManagedOverwrite.original_overwrite;
        const allow = (entry.allow & ~managedBits) | (BigInt(original.allow) & managedBits);
        const deny = (entry.deny & ~managedBits) | (BigInt(original.deny) & managedBits);
        return !original.existed && allow === 0n && deny === 0n
          ? []
          : [{ id: entry.id, type: entry.type, allow, deny }];
      });
    const merged = desired.map((overwrite) => {
      const existing = existingById.get(overwrite.id);
      if (!existing) {
        return overwrite;
      }

      const desiredAllow = this.combinePermissionBits(overwrite.allow);
      const desiredDeny = this.combinePermissionBits(overwrite.deny);
      const desiredManagedBits = desiredAllow | desiredDeny;
      const previousManagedOverwrite = this.findManagedOverwriteState(
        previousSyncState,
        snapshot.channelId,
        overwrite.id,
        existing.type
      );
      const previousManagedBits = previousManagedOverwrite
        ? BigInt(previousManagedOverwrite.managed_bits)
        : 0n;
      const managedBits = desiredManagedBits | previousManagedBits;
      const original = previousManagedOverwrite?.original_overwrite;
      const restoredPreviousAllow = original
        ? BigInt(original.allow) & (previousManagedBits & ~desiredManagedBits)
        : 0n;
      const restoredPreviousDeny = original
        ? BigInt(original.deny) & (previousManagedBits & ~desiredManagedBits)
        : 0n;
      return {
        id: overwrite.id,
        type: existing.type,
        allow: (existing.allow & ~managedBits) | restoredPreviousAllow | desiredAllow,
        deny: (existing.deny & ~managedBits) | restoredPreviousDeny | desiredDeny,
      };
    });

    return [...preserved, ...merged];
  }

  private buildVerificationPermissionSyncState(
    snapshot: VerificationPermissionSnapshot,
    previousSyncState: VerificationChannelPermissionSyncState | undefined,
    desired: readonly VerificationPermissionOverwrite[]
  ): VerificationChannelPermissionSyncState {
    return {
      channel_id: snapshot.channelId,
      managed_overwrites: desired.map((overwrite) => {
        const previous = this.findManagedOverwriteState(
          previousSyncState,
          snapshot.channelId,
          overwrite.id,
          overwrite.type
        );
        if (previous) {
          return {
            ...previous,
            managed_bits: (
              this.combinePermissionBits(overwrite.allow) |
              this.combinePermissionBits(overwrite.deny)
            ).toString(),
          };
        }
        const original = snapshot.entries.find(
          (entry) => entry.id === overwrite.id && entry.type === overwrite.type
        );
        return {
          id: overwrite.id,
          type: overwrite.type,
          managed_bits: (
            this.combinePermissionBits(overwrite.allow) | this.combinePermissionBits(overwrite.deny)
          ).toString(),
          original_overwrite: {
            existed: Boolean(original),
            allow: (original?.allow ?? 0n).toString(),
            deny: (original?.deny ?? 0n).toString(),
          },
        };
      }),
    };
  }

  private findManagedOverwriteState(
    state: VerificationChannelPermissionSyncState | undefined,
    channelId: string,
    id: string,
    type: 0 | 1
  ): VerificationChannelManagedOverwriteState | undefined {
    return state?.channel_id === channelId
      ? state.managed_overwrites.find((entry) => entry.id === id && entry.type === type)
      : undefined;
  }

  private restoreManagedPermissionOverwrites(
    snapshot: VerificationPermissionSnapshot,
    state: VerificationChannelPermissionSyncState
  ): OverwriteResolvable[] {
    const managedIds = new Set(
      state.managed_overwrites.map((entry) => `${entry.type}:${entry.id}`)
    );
    const preserved = snapshot.entries
      .filter((entry) => !managedIds.has(`${entry.type}:${entry.id}`))
      .map((entry) => ({
        id: entry.id,
        type: entry.type,
        allow: entry.allow,
        deny: entry.deny,
      }));
    const currentById = new Map(
      snapshot.entries.map((entry) => [`${entry.type}:${entry.id}`, entry])
    );
    const restored = state.managed_overwrites.flatMap((managed) => {
      const current = currentById.get(`${managed.type}:${managed.id}`);
      const managedBits = BigInt(managed.managed_bits);
      const original = managed.original_overwrite;
      const allow =
        ((current?.allow ?? 0n) & ~managedBits) | (BigInt(original.allow) & managedBits);
      const deny = ((current?.deny ?? 0n) & ~managedBits) | (BigInt(original.deny) & managedBits);
      return !original.existed && allow === 0n && deny === 0n
        ? []
        : [{ id: managed.id, type: managed.type, allow, deny }];
    });
    return [...preserved, ...restored];
  }

  private combinePermissionBits(bits: readonly bigint[] | undefined): bigint {
    return bits?.reduce((combined, bit) => combined | bit, 0n) ?? 0n;
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
    if (!verificationEvent.notification_message_id) {
      throw new Error('No notification message ID found for verification event');
    }

    const message = await this.getMessageForVerificationEvent(verificationEvent);
    const messageEmbeds = (message as { embeds?: Message['embeds'] }).embeds ?? [];
    const updatedEmbed = messageEmbeds.length > 0 ? EmbedBuilder.from(messageEmbeds[0]) : null;

    if (updatedEmbed) {
      this.presentationBuilder.upsertResolvedCasePresentation(
        updatedEmbed,
        verificationEvent,
        newStatus
      );
      this.presentationBuilder.upsertVerificationActionFailureField(
        updatedEmbed,
        verificationEvent
      );
      this.presentationBuilder.upsertAccountQuarantinePresentation(updatedEmbed, verificationEvent);
    }

    const serverConfig = await this.configService
      .getServerConfig(verificationEvent.server_id)
      .catch(() => null);
    const responseSettings = serverConfig
      ? getDetectionResponseSettings(serverConfig.settings)
      : null;

    await message.edit({
      allowedMentions: { parse: [] },
      components: this.presentationBuilder.createAdminNotificationActionRows(
        verificationEvent.user_id,
        {
          guildId: verificationEvent.server_id,
          verificationEventId: verificationEvent.id,
          verificationStatus: newStatus,
          caseKind: verificationEvent.case_kind,
          caseMembershipState: this.presentationBuilder.getCaseMembershipState(verificationEvent),
          caseAttentionState: verificationEvent.attention_state,
          includeBanAction: responseSettings?.moderatorBanActionEnabled ?? true,
        }
      ),
      ...(updatedEmbed ? { embeds: [updatedEmbed] } : {}),
    });
  }

  private formatVerificationThreadMessageMirror(
    message: Message,
    copiedImageIds: Set<string>
  ): string {
    const authorTag = message.author.tag;
    const lines = [
      `Support-check reply from <@${message.author.id}> (${authorTag}).`,
      `Source: ${message.url}`,
      '',
      this.formatMirroredMessageContent(message.content),
    ];

    const attachments = messageAttachmentsToReportMetadata(message).slice(
      0,
      MIRRORED_THREAD_MESSAGE_ATTACHMENT_LIMIT
    );
    if (attachments.length > 0) {
      lines.push(
        '',
        'Attachments:',
        ...attachments.map((attachment) =>
          this.formatMirroredAttachmentLine(attachment, copiedImageIds)
        )
      );
      if (message.attachments.size > attachments.length) {
        lines.push(
          `- ${message.attachments.size - attachments.length} more attachment(s) omitted.`
        );
      }
    }

    return this.enforceMirroredThreadMessageLimit(lines.join('\n'));
  }

  private async buildMirroredThreadImageFiles(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<MirroredThreadImageFileResult> {
    if (message.attachments.size === 0) {
      return { files: [], copiedAttachmentIds: new Set() };
    }

    try {
      const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
      const attachments = selectEligibleMessageReportImageAttachments(
        message,
        getReportAiSettings(serverConfig.settings)
      );
      return await buildSpoilerImageAttachmentFileResult(attachments, { logger: console });
    } catch (error) {
      console.warn(
        `Failed to prepare spoilered support-check image attachments for verification event ${verificationEvent.id}:`,
        error
      );
      return { files: [], copiedAttachmentIds: new Set() };
    }
  }

  private formatMirroredAttachmentLine(
    attachment: ReportAttachmentMetadata,
    copiedImageIds: Set<string>
  ): string {
    const name = attachment.name ?? attachment.id ?? 'attachment';
    if (attachment.id && copiedImageIds.has(attachment.id)) {
      return `- ${name} (copied below as a spoilered image)`;
    }

    return `- ${name}: ${attachment.url ?? 'no URL available'}`;
  }

  private formatMirroredMessageContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return '_No text content._';
    }

    const safeContent = this.truncateMirroredMessageContent(trimmed).replace(/```/g, "''' ");
    return `\`\`\`\n${safeContent}\n\`\`\``;
  }

  private truncateMirroredMessageContent(content: string): string {
    if (content.length <= MIRRORED_THREAD_MESSAGE_CONTENT_MAX_LENGTH) {
      return content;
    }

    return `${content.slice(0, MIRRORED_THREAD_MESSAGE_CONTENT_MAX_LENGTH - 3)}...`;
  }

  private enforceMirroredThreadMessageLimit(content: string): string {
    if (content.length <= DISCORD_MESSAGE_CONTENT_MAX_LENGTH) {
      return content;
    }

    const maxPrefixLength =
      DISCORD_MESSAGE_CONTENT_MAX_LENGTH - MIRRORED_THREAD_MESSAGE_TRUNCATION_NOTICE.length;
    if (maxPrefixLength <= 0) {
      return content.slice(0, DISCORD_MESSAGE_CONTENT_MAX_LENGTH);
    }

    return `${content.slice(0, maxPrefixLength)}${MIRRORED_THREAD_MESSAGE_TRUNCATION_NOTICE}`;
  }
}
