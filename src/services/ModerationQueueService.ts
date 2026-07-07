import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  MessageCreateOptions,
  MessageEditOptions,
} from 'discord.js';
import { injectable, inject } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IModerationQueueRepository } from '../repositories/ModerationQueueRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  DetectionEvent,
  DetectionType,
  ModerationQueueItem,
  ModerationQueueItemType,
  ReportIntake,
  ServerMember,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { getModerationQueueSettings } from '../utils/moderationQueueSettings';
import { NotificationPresentationBuilder } from './NotificationPresentationBuilder';

const QUEUE_ACK_CUSTOM_ID_PREFIX = 'queue:ack';
const DISCORD_EMBED_FIELD_MAX_LENGTH = 1024;
const QUEUE_PREVIEW_MAX_LENGTH = 700;

interface QueueTextChannel {
  readonly id: string;
  send(options: MessageCreateOptions): Promise<Message>;
  messages: {
    fetch(messageId: string): Promise<Message>;
  };
}

interface QueueMessagePayload {
  readonly content?: string;
  readonly allowedMentions: MessageCreateOptions['allowedMentions'];
  readonly embeds: NonNullable<MessageCreateOptions['embeds']>;
  readonly components: NonNullable<MessageCreateOptions['components']>;
}

export interface IModerationQueueService {
  syncAllActiveServerQueues(): Promise<void>;
  syncServerQueue(serverId: string): Promise<void>;
  clearServerQueue(serverId: string): Promise<number>;
  upsertCaseMirror(verificationEvent: VerificationEvent): Promise<void>;
  deleteCaseMirror(verificationEventId: string): Promise<void>;
  upsertObservedAlertMirror(detectionEvent: DetectionEvent): Promise<void>;
  upsertObservedAlertMirrorById(detectionEventId: string): Promise<void>;
  deleteObservedAlertMirror(detectionEventId: string): Promise<void>;
  upsertPendingScreeningMember(
    member: ServerMember,
    thresholdDays: number,
    now?: Date
  ): Promise<void>;
  upsertPendingScreeningMembers(
    serverId: string,
    members: ServerMember[],
    thresholdDays: number,
    now?: Date
  ): Promise<void>;
  deletePendingScreeningMember(serverId: string, userId: string): Promise<void>;
  recordSupportThreadAttention(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<void>;
  recordReportThreadAttention(reportIntake: ReportIntake, message: Message): Promise<void>;
  deleteReportThreadAttention(reportIntakeId: string): Promise<void>;
  acknowledgeAttentionItem(itemId: string, serverId: string): Promise<boolean>;
}

@injectable()
export class ModerationQueueService implements IModerationQueueService {
  private readonly presentationBuilder = new NotificationPresentationBuilder();

  constructor(
    @inject(TYPES.DiscordClient) private client: Client,
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ModerationQueueRepository)
    private moderationQueueRepository: IModerationQueueRepository
  ) {}

  public static buildAcknowledgeCustomId(itemId: string): string {
    return `${QUEUE_ACK_CUSTOM_ID_PREFIX}:${itemId}`;
  }

  public static parseAcknowledgeCustomId(customId: string): string | null {
    const prefix = `${QUEUE_ACK_CUSTOM_ID_PREFIX}:`;
    return customId.startsWith(prefix) ? customId.slice(prefix.length) : null;
  }

  public async syncAllActiveServerQueues(): Promise<void> {
    const servers = await this.serverRepository.findAllActive();
    for (const server of servers) {
      await this.syncServerQueue(server.guild_id).catch((error) => {
        console.warn(`Failed to sync moderation queue for guild ${server.guild_id}:`, error);
      });
    }
  }

  public async syncServerQueue(serverId: string): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(serverId);
    if (!getModerationQueueSettings(serverConfig.settings).channelId) {
      return;
    }

    const pendingCases = await this.verificationEventRepository.findPendingByServer(serverId);
    const observedAlerts =
      await this.detectionEventsRepository.findUnresolvedObservedNotificationsByServer(serverId);

    for (const verificationEvent of pendingCases) {
      await this.upsertCaseMirror(verificationEvent);
    }
    for (const detectionEvent of observedAlerts) {
      await this.upsertObservedAlertMirror(detectionEvent);
    }

    await this.deleteStaleMirrorItems(
      serverId,
      new Set(pendingCases.map((event) => event.id)),
      new Set(observedAlerts.map((event) => event.id))
    );
  }

  public async clearServerQueue(serverId: string): Promise<number> {
    const items = await this.moderationQueueRepository.listByServer(serverId);
    await Promise.all(items.map((item) => this.deleteQueueMessage(item)));
    await Promise.all(items.map((item) => this.moderationQueueRepository.deleteById(item.id)));
    return items.length;
  }

  public async upsertCaseMirror(verificationEvent: VerificationEvent): Promise<void> {
    if (verificationEvent.status !== VerificationStatus.PENDING) {
      await this.deleteCaseMirror(verificationEvent.id);
      return;
    }

    const serverConfig = await this.configService.getServerConfig(verificationEvent.server_id);
    const queueChannel = await this.getQueueChannel(serverConfig.settings);
    if (!queueChannel) {
      return;
    }

    const item = await this.moderationQueueRepository.upsert({
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      itemType: ModerationQueueItemType.CASE_MIRROR,
      verificationEventId: verificationEvent.id,
      detectionEventId: verificationEvent.detection_event_id,
      metadata: this.toJson({ refreshed_at: new Date().toISOString() }),
    });

    const responseSettings = getDetectionResponseSettings(serverConfig.settings);
    const message = await this.sendOrEditQueueMessage(
      item,
      queueChannel,
      this.buildCaseMirrorPayload(verificationEvent, responseSettings.moderatorBanActionEnabled)
    );
    if (message) {
      await this.moderationQueueRepository.updateDiscordMessage(
        item.id,
        message.channelId,
        message.id
      );
    }
  }

  public async deleteCaseMirror(verificationEventId: string): Promise<void> {
    const items = await this.moderationQueueRepository.deleteByCase(verificationEventId);
    await Promise.all(items.map((item) => this.deleteQueueMessage(item)));
  }

  public async upsertObservedAlertMirror(detectionEvent: DetectionEvent): Promise<void> {
    if (
      !detectionEvent.server_id ||
      this.hasObservedAction(detectionEvent) ||
      !this.hasObservedNotification(detectionEvent)
    ) {
      await this.deleteObservedAlertMirror(detectionEvent.id);
      return;
    }

    const serverConfig = await this.configService.getServerConfig(detectionEvent.server_id);
    const queueChannel = await this.getQueueChannel(serverConfig.settings);
    if (!queueChannel) {
      return;
    }

    const item = await this.moderationQueueRepository.upsert({
      serverId: detectionEvent.server_id,
      userId: detectionEvent.user_id,
      itemType: ModerationQueueItemType.OBSERVED_ALERT_MIRROR,
      detectionEventId: detectionEvent.id,
      metadata: this.toJson({ refreshed_at: new Date().toISOString() }),
    });

    const responseSettings = getDetectionResponseSettings(serverConfig.settings);
    const message = await this.sendOrEditQueueMessage(
      item,
      queueChannel,
      this.buildObservedAlertPayload(detectionEvent, responseSettings.moderatorBanActionEnabled)
    );
    if (message) {
      await this.moderationQueueRepository.updateDiscordMessage(
        item.id,
        message.channelId,
        message.id
      );
    }
  }

  public async upsertObservedAlertMirrorById(detectionEventId: string): Promise<void> {
    const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
    if (detectionEvent) {
      await this.upsertObservedAlertMirror(detectionEvent);
    }
  }

  public async deleteObservedAlertMirror(detectionEventId: string): Promise<void> {
    const items = await this.moderationQueueRepository.deleteByObservedAlert(detectionEventId);
    await Promise.all(items.map((item) => this.deleteQueueMessage(item)));
  }

  public async upsertPendingScreeningMember(
    member: ServerMember,
    thresholdDays: number,
    now: Date = new Date()
  ): Promise<void> {
    if (!member.discord_member_pending || !member.discord_member_pending_since) {
      await this.deletePendingScreeningMember(member.server_id, member.user_id);
      return;
    }

    const serverConfig = await this.configService.getServerConfig(member.server_id);
    const queueChannel = await this.getQueueChannel(serverConfig.settings);
    if (!queueChannel) {
      return;
    }

    await this.upsertPendingScreeningMemberInQueue(member, thresholdDays, now, queueChannel);
  }

  public async upsertPendingScreeningMembers(
    serverId: string,
    members: ServerMember[],
    thresholdDays: number,
    now: Date = new Date()
  ): Promise<void> {
    if (members.length === 0) {
      return;
    }

    const serverConfig = await this.configService.getServerConfig(serverId);
    const queueChannel = await this.getQueueChannel(serverConfig.settings);
    if (!queueChannel) {
      return;
    }

    for (const member of members) {
      if (member.server_id !== serverId) {
        continue;
      }

      if (!member.discord_member_pending || !member.discord_member_pending_since) {
        await this.deletePendingScreeningMember(member.server_id, member.user_id);
        continue;
      }

      await this.upsertPendingScreeningMemberInQueue(member, thresholdDays, now, queueChannel);
    }
  }

  private async upsertPendingScreeningMemberInQueue(
    member: ServerMember,
    thresholdDays: number,
    now: Date,
    queueChannel: QueueTextChannel
  ): Promise<void> {
    const pendingSince = member.discord_member_pending_since;
    if (!pendingSince) {
      await this.deletePendingScreeningMember(member.server_id, member.user_id);
      return;
    }

    const item = await this.moderationQueueRepository.upsert({
      serverId: member.server_id,
      userId: member.user_id,
      itemType: ModerationQueueItemType.PENDING_SCREENING_MEMBER,
      metadata: this.toJson({
        pending_since: pendingSince.toISOString(),
        threshold_days: thresholdDays,
        last_checked_at: now.toISOString(),
      }),
    });

    const message = await this.sendOrEditQueueMessage(
      item,
      queueChannel,
      this.buildPendingScreeningPayload(member, thresholdDays, now)
    );
    if (message) {
      await this.moderationQueueRepository.updateDiscordMessage(
        item.id,
        message.channelId,
        message.id
      );
    }
  }

  public async deletePendingScreeningMember(serverId: string, userId: string): Promise<void> {
    const items = await this.moderationQueueRepository.deleteByPendingScreeningMember(
      serverId,
      userId
    );
    await Promise.all(items.map((item) => this.deleteQueueMessage(item)));
  }

  public async recordSupportThreadAttention(
    verificationEvent: VerificationEvent,
    message: Message
  ): Promise<void> {
    if (verificationEvent.status !== VerificationStatus.PENDING) {
      return;
    }

    await this.upsertAttentionItem({
      itemType: ModerationQueueItemType.SUPPORT_THREAD_ATTENTION,
      serverId: verificationEvent.server_id,
      userId: verificationEvent.user_id,
      verificationEventId: verificationEvent.id,
      sourceThreadId: message.channelId,
      message,
      title: 'Support Check Reply Needs Review',
      description: `<@${verificationEvent.user_id}> replied in a pending support-check thread.`,
      subjectFieldName: 'Case',
      subjectFieldValue: `\`${verificationEvent.id}\``,
    });
  }

  public async recordReportThreadAttention(
    reportIntake: ReportIntake,
    message: Message
  ): Promise<void> {
    await this.upsertAttentionItem({
      itemType: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
      serverId: reportIntake.server_id,
      userId: reportIntake.reporter_id,
      reportIntakeId: reportIntake.id,
      sourceThreadId: message.channelId,
      message,
      title: 'Reporter Follow-Up Needs Review',
      description: `<@${reportIntake.reporter_id}> added evidence to a report intake thread.`,
      subjectFieldName: 'Report Intake',
      subjectFieldValue: `\`${reportIntake.id}\``,
    });
  }

  public async deleteReportThreadAttention(reportIntakeId: string): Promise<void> {
    const items = await this.moderationQueueRepository.deleteByReportIntake(reportIntakeId);
    await Promise.all(items.map((item) => this.deleteQueueMessage(item)));
  }

  public async acknowledgeAttentionItem(itemId: string, serverId: string): Promise<boolean> {
    const item = await this.moderationQueueRepository.findById(itemId);
    if (!item || item.server_id !== serverId || !this.isAttentionItem(item)) {
      return false;
    }

    await this.deleteQueueMessage(item);
    await this.moderationQueueRepository.deleteById(item.id);
    return true;
  }

  private async deleteStaleMirrorItems(
    serverId: string,
    activeCaseIds: Set<string>,
    activeObservedIds: Set<string>
  ): Promise<void> {
    const mirrorItems = await this.moderationQueueRepository.listByServerAndTypes(serverId, [
      ModerationQueueItemType.CASE_MIRROR,
      ModerationQueueItemType.OBSERVED_ALERT_MIRROR,
    ]);
    for (const item of mirrorItems) {
      const staleCase =
        item.item_type === ModerationQueueItemType.CASE_MIRROR &&
        (!item.verification_event_id || !activeCaseIds.has(item.verification_event_id));
      const staleObserved =
        item.item_type === ModerationQueueItemType.OBSERVED_ALERT_MIRROR &&
        (!item.detection_event_id || !activeObservedIds.has(item.detection_event_id));
      if (staleCase || staleObserved) {
        await this.deleteQueueMessage(item);
        await this.moderationQueueRepository.deleteById(item.id);
      }
    }
  }

  private async upsertAttentionItem(input: {
    itemType:
      | ModerationQueueItemType.SUPPORT_THREAD_ATTENTION
      | ModerationQueueItemType.REPORT_THREAD_ATTENTION;
    serverId: string;
    userId: string;
    verificationEventId?: string;
    reportIntakeId?: string;
    sourceThreadId: string;
    message: Message;
    title: string;
    description: string;
    subjectFieldName: string;
    subjectFieldValue: string;
  }): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(input.serverId);
    const queueChannel = await this.getQueueChannel(serverConfig.settings);
    if (!queueChannel) {
      return;
    }

    const existing = await this.moderationQueueRepository.findAttentionByThread(
      input.itemType,
      input.sourceThreadId
    );
    if (existing?.last_source_message_id === input.message.id) {
      return;
    }

    const item = await this.moderationQueueRepository.upsert({
      serverId: input.serverId,
      userId: input.userId,
      itemType: input.itemType,
      verificationEventId: input.verificationEventId,
      reportIntakeId: input.reportIntakeId,
      sourceThreadId: input.sourceThreadId,
      lastSourceMessageId: input.message.id,
      lastNotifiedAt: existing?.last_notified_at ?? new Date(),
      metadata: this.toJson({
        latest_message_url: input.message.url,
        latest_message_author_id: input.message.author.id,
        latest_message_at: new Date(input.message.createdTimestamp).toISOString(),
      }),
    });

    const content = existing
      ? undefined
      : this.formatAttentionPing(serverConfig.admin_notification_role_id);
    const message = await this.sendOrEditQueueMessage(
      item,
      queueChannel,
      this.buildAttentionPayload({
        item,
        content,
        title: input.title,
        description: input.description,
        subjectFieldName: input.subjectFieldName,
        subjectFieldValue: input.subjectFieldValue,
        sourceThreadId: input.sourceThreadId,
        message: input.message,
      })
    );
    if (message) {
      await this.moderationQueueRepository.updateDiscordMessage(
        item.id,
        message.channelId,
        message.id
      );
    }
  }

  private buildCaseMirrorPayload(
    verificationEvent: VerificationEvent,
    includeBanAction: boolean
  ): QueueMessagePayload {
    const memberLeft =
      this.toRecord(verificationEvent.metadata).membership_state === 'left_or_removed';
    const embed = new EmbedBuilder()
      .setColor(memberLeft ? 0xffc107 : 0xf97316)
      .setTitle(memberLeft ? 'Pending Case: Member Left Server' : 'Pending Moderation Case')
      .setDescription(
        memberLeft
          ? `<@${verificationEvent.user_id}> left or was removed while this case is still pending.`
          : `<@${verificationEvent.user_id}> has an open case awaiting moderator action.`
      )
      .addFields(
        {
          name: 'User',
          value: `<@${verificationEvent.user_id}> (\`${verificationEvent.user_id}\`)`,
          inline: false,
        },
        { name: 'Case', value: `\`${verificationEvent.id}\``, inline: false },
        {
          name: 'Created',
          value: this.formatTimestamp(verificationEvent.created_at),
          inline: true,
        },
        {
          name: 'Threads',
          value: this.formatCaseThreads(verificationEvent),
          inline: false,
        }
      )
      .setTimestamp();

    const notificationLink = this.formatMessageLink(
      verificationEvent.server_id,
      verificationEvent.notification_channel_id,
      verificationEvent.notification_message_id
    );
    if (notificationLink) {
      embed.addFields({ name: 'Admin Notification', value: notificationLink, inline: false });
    }

    if (memberLeft) {
      embed.addFields({
        name: 'Membership',
        value:
          'Use Ban by ID if moderation should continue, or Close No Action if no action is needed.',
        inline: false,
      });
    }

    return {
      allowedMentions: { parse: [] },
      embeds: [embed],
      components: this.presentationBuilder.createAdminNotificationActionRows(
        verificationEvent.user_id,
        {
          guildId: verificationEvent.server_id,
          verificationEventId: verificationEvent.id,
          verificationStatus: verificationEvent.status,
          caseMembershipState: this.presentationBuilder.getCaseMembershipState(verificationEvent),
          includeBanAction,
        }
      ),
    };
  }

  private buildObservedAlertPayload(
    detectionEvent: DetectionEvent,
    includeBanAction: boolean
  ): QueueMessagePayload {
    const detectedAt = new Date(detectionEvent.detected_at);
    const embed = new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('Observed Alert Pending Review')
      .setDescription(`<@${detectionEvent.user_id}> has an un-actioned observed suspicious alert.`)
      .addFields(
        {
          name: 'User',
          value: `<@${detectionEvent.user_id}> (\`${detectionEvent.user_id}\`)`,
          inline: false,
        },
        { name: 'Detection', value: `\`${detectionEvent.id}\``, inline: false },
        { name: 'Type', value: `\`${detectionEvent.detection_type}\``, inline: true },
        {
          name: 'Confidence',
          value: `${Math.round(detectionEvent.confidence * 100)}%`,
          inline: true,
        },
        { name: 'Detected', value: this.formatTimestamp(detectedAt), inline: true },
        {
          name: 'Reasons',
          value: this.truncateField(
            detectionEvent.reasons.length
              ? detectionEvent.reasons.map((reason) => `- ${reason}`).join('\n')
              : 'No specific reason provided.'
          ),
          inline: false,
        }
      )
      .setTimestamp();

    const metadata = this.toRecord(detectionEvent.metadata);
    const observedNotificationLink = this.formatMessageLink(
      detectionEvent.server_id,
      typeof metadata.observed_notification_channel_id === 'string'
        ? metadata.observed_notification_channel_id
        : null,
      typeof metadata.observed_notification_message_id === 'string'
        ? metadata.observed_notification_message_id
        : null
    );
    if (observedNotificationLink) {
      embed.addFields({
        name: 'Observed Notification',
        value: observedNotificationLink,
        inline: false,
      });
    }

    return {
      allowedMentions: { parse: [] },
      embeds: [embed],
      components: this.presentationBuilder.createObservedActionRows(
        detectionEvent.user_id,
        detectionEvent.id,
        detectionEvent.server_id ?? undefined,
        {
          includeBanAction,
          kind: detectionEvent.detection_type === DetectionType.USER_REPORT ? 'report' : 'alert',
        }
      ),
    };
  }

  private buildAttentionPayload(input: {
    item: ModerationQueueItem;
    content?: string;
    title: string;
    description: string;
    subjectFieldName: string;
    subjectFieldValue: string;
    sourceThreadId: string;
    message: Message;
  }): QueueMessagePayload {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(input.title)
      .setDescription(input.description)
      .addFields(
        { name: input.subjectFieldName, value: input.subjectFieldValue, inline: false },
        { name: 'Thread', value: `<#${input.sourceThreadId}>`, inline: false },
        { name: 'Latest Message', value: `[Open message](${input.message.url})`, inline: false },
        {
          name: 'Preview',
          value: this.truncateField(input.message.content.trim() || '(no text content)'),
          inline: false,
        }
      )
      .setTimestamp();

    return {
      content: input.content,
      allowedMentions: { parse: [], roles: this.readRoleIdsFromContent(input.content) },
      embeds: [embed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(ModerationQueueService.buildAcknowledgeCustomId(input.item.id))
            .setLabel('Acknowledge')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setLabel('Open Thread')
            .setStyle(ButtonStyle.Link)
            .setURL(input.message.url)
        ),
      ],
    };
  }

  private buildPendingScreeningPayload(
    member: ServerMember,
    thresholdDays: number,
    now: Date
  ): QueueMessagePayload {
    const pendingSince = member.discord_member_pending_since;
    const pendingDays = pendingSince
      ? Math.floor((now.getTime() - pendingSince.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const embed = new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('Long-Pending Discord Screening')
      .setDescription(
        `<@${member.user_id}> has been pending Discord membership screening/onboarding longer than the configured threshold.`
      )
      .addFields(
        {
          name: 'User',
          value: `<@${member.user_id}> (\`${member.user_id}\`)`,
          inline: false,
        },
        {
          name: 'Pending Since',
          value: this.formatTimestamp(pendingSince),
          inline: true,
        },
        {
          name: 'Age',
          value:
            pendingDays === null ? 'Unknown' : `${pendingDays} day${pendingDays === 1 ? '' : 's'}`,
          inline: true,
        },
        {
          name: 'Threshold',
          value: `${thresholdDays} day${thresholdDays === 1 ? '' : 's'}`,
          inline: true,
        },
        {
          name: 'Recommended Action',
          value:
            'Review Discord membership screening/onboarding state. This item remains until screening clears or the member leaves.',
          inline: false,
        }
      )
      .setTimestamp(now);

    return {
      allowedMentions: { parse: [] },
      embeds: [embed],
      components: [],
    };
  }

  private async sendOrEditQueueMessage(
    item: ModerationQueueItem,
    queueChannel: QueueTextChannel,
    payload: QueueMessagePayload
  ): Promise<Message | null> {
    const editPayload: MessageEditOptions = {
      content: payload.content,
      allowedMentions: payload.allowedMentions,
      embeds: payload.embeds,
      components: payload.components,
    };

    if (item.queue_channel_id && item.queue_message_id) {
      if (item.queue_channel_id !== queueChannel.id) {
        await this.deleteQueueMessage(item);
      } else {
        const existingMessage = await queueChannel.messages
          .fetch(item.queue_message_id)
          .catch(() => null);
        if (existingMessage) {
          try {
            return await existingMessage.edit(editPayload);
          } catch (error) {
            console.warn(`Failed to edit live moderation queue item ${item.id}:`, error);
            return null;
          }
        }
      }
    }

    try {
      return await queueChannel.send({
        content: payload.content,
        allowedMentions: payload.allowedMentions,
        embeds: payload.embeds,
        components: payload.components,
      });
    } catch (error) {
      console.warn(`Failed to send live moderation queue item ${item.id}:`, error);
      return null;
    }
  }

  private async deleteQueueMessage(item: ModerationQueueItem): Promise<void> {
    if (!item.queue_channel_id || !item.queue_message_id) {
      return;
    }

    const channel = await this.getTextChannel(item.queue_channel_id);
    const message = await channel?.messages.fetch(item.queue_message_id).catch(() => null);
    await message?.delete().catch(() => null);
  }

  private async getQueueChannel(
    settings: Parameters<typeof getModerationQueueSettings>[0]
  ): Promise<QueueTextChannel | null> {
    const queueChannelId = getModerationQueueSettings(settings).channelId;
    if (!queueChannelId) {
      return null;
    }

    return this.getTextChannel(queueChannelId);
  }

  private async getTextChannel(channelId: string): Promise<QueueTextChannel | null> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('send' in channel) || !('messages' in channel)) {
      return null;
    }

    return channel as unknown as QueueTextChannel;
  }

  private hasObservedAction(detectionEvent: DetectionEvent): boolean {
    const metadata = this.toRecord(detectionEvent.metadata);
    return typeof metadata.observed_action === 'string';
  }

  private hasObservedNotification(detectionEvent: DetectionEvent): boolean {
    const metadata = this.toRecord(detectionEvent.metadata);
    return (
      typeof metadata.observed_notification_channel_id === 'string' &&
      typeof metadata.observed_notification_message_id === 'string'
    );
  }

  private isAttentionItem(item: ModerationQueueItem): boolean {
    return (
      item.item_type === ModerationQueueItemType.SUPPORT_THREAD_ATTENTION ||
      item.item_type === ModerationQueueItemType.REPORT_THREAD_ATTENTION
    );
  }

  private formatAttentionPing(roleId: string | null): string | undefined {
    return roleId ? `<@&${roleId}>` : undefined;
  }

  private readRoleIdsFromContent(content?: string): string[] {
    if (!content) {
      return [];
    }
    return [...content.matchAll(/<@&(\d+)>/g)].map((match) => match[1]);
  }

  private formatCaseThreads(verificationEvent: VerificationEvent): string {
    const entries = [
      verificationEvent.thread_id ? `Support check: <#${verificationEvent.thread_id}>` : null,
      verificationEvent.private_evidence_thread_id
        ? `Private evidence: <#${verificationEvent.private_evidence_thread_id}>`
        : null,
    ].filter((value): value is string => Boolean(value));

    return entries.length ? entries.join('\n') : 'No case threads recorded yet.';
  }

  private formatMessageLink(
    guildId: string | null,
    channelId: string | null,
    messageId: string | null
  ): string | null {
    if (!guildId || !channelId || !messageId) {
      return null;
    }

    return `[Open message](https://discord.com/channels/${guildId}/${channelId}/${messageId})`;
  }

  private formatTimestamp(value: Date | string | null): string {
    if (!value) {
      return 'Unknown';
    }

    const timestamp = Math.floor(new Date(value).getTime() / 1000);
    return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
  }

  private truncateField(value: string): string {
    const maxLength = Math.min(DISCORD_EMBED_FIELD_MAX_LENGTH, QUEUE_PREVIEW_MAX_LENGTH);
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 24)}\n... (truncated)`;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private toJson(value: Record<string, unknown>): ModerationQueueItem['metadata'] {
    return value as ModerationQueueItem['metadata'];
  }
}
