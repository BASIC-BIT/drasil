import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  Message,
  ThreadChannel,
} from 'discord.js';
import { DetectionResult } from './DetectionOrchestrator';
import type { ReportAIAnalysis, VerificationThreadAnalysisResult } from './GPTService';
import { CASE_STAFF_ROUTING_METADATA_KEY } from './ThreadManager';
import {
  AdminActionType,
  DetectionEvent,
  DetectionType,
  Server,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import {
  buildCaseAdminActionsCustomId,
  buildObservedAdminActionsCustomId,
} from '../utils/adminActionCustomIds';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { isDetectionEventExcludedFromAccounting } from '../utils/detectionEventAccounting';
import { buildAdminCaseDetailUrl, buildAdminCaseQueueUrl } from '../utils/publicWebLinks';
import { getVerificationActionFailures } from '../utils/verificationActionFailures';

interface AdminActionRowOptions {
  readonly guildId?: string;
  readonly verificationEventId?: string;
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

export class NotificationPresentationBuilder {
  public static readonly THREAD_ANALYSIS_FIELD_NAME = 'AI Thread Analysis';
  public static readonly LATEST_ADMIN_ACTION_FIELD_NAME = 'Latest Admin Action';
  public static readonly MODERATION_ACTION_WARNING_FIELD_NAME = 'Moderation Action Warning';
  public static readonly RESOLUTION_FIELD_NAME = 'Resolution';

  public createSuspiciousUserEmbed(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    detectionEvents: DetectionEvent[],
    sourceMessage?: Message
  ): EmbedBuilder {
    const accountCreatedAt = new Date(member.user.createdTimestamp);
    const joinedServerAt = member.joinedAt;
    const accountCreatedTimestamp = Math.floor(accountCreatedAt.getTime() / 1000);
    const joinedServerTimestamp = joinedServerAt ? Math.floor(joinedServerAt.getTime() / 1000) : 0;
    const accountCreatedFormatted = `<t:${accountCreatedTimestamp}:F> (<t:${accountCreatedTimestamp}:R>)`;
    const joinedServerFormatted = joinedServerAt
      ? `<t:${joinedServerTimestamp}:F> (<t:${joinedServerTimestamp}:R>)`
      : 'Unknown';

    const confidencePercent = detectionResult.confidence * 100;
    let confidenceLevel: string;
    let embedColor = 0xff0000;
    if (confidencePercent <= 40) {
      confidenceLevel = '🟢 Low';
    } else if (confidencePercent <= 70) {
      confidenceLevel = '🟡 Medium';
    } else {
      confidenceLevel = '🔴 High';
    }

    const reasonsFormatted = detectionResult.reasons.map((reason) => `• ${reason}`).join('\n');
    const countedDetectionEvents = detectionEvents.filter(
      (event) => !isDetectionEventExcludedFromAccounting(event)
    );
    const detectionEventsNewestFirst = [...detectionEvents].sort(
      (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
    const detectionHistory = this.formatSuspiciousDetectionHistory(
      detectionEvents,
      member.guild.id
    );

    if (verificationEvent.status === VerificationStatus.VERIFIED) {
      embedColor = 0x00ff00;
    } else if (verificationEvent.status === VerificationStatus.BANNED) {
      embedColor = 0x000000;
    }

    const resolutionPresentation = this.getVerificationResolutionPresentation(verificationEvent);
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(resolutionPresentation?.title ?? this.getPendingCaseTitle(detectionResult))
      .setDescription(
        resolutionPresentation
          ? `<@${member.id}> has been handled. No further moderator action is pending.`
          : countedDetectionEvents.length > 1
            ? `<@${member.id}> has been flagged as suspicious ${countedDetectionEvents.length} times.`
            : `<@${member.id}> has been flagged as suspicious.`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        ...(resolutionPresentation
          ? [
              {
                name: NotificationPresentationBuilder.RESOLUTION_FIELD_NAME,
                value: resolutionPresentation.fieldValue,
                inline: false,
              },
            ]
          : []),
        { name: 'Username', value: member.user.tag, inline: true },
        { name: 'User ID', value: member.id, inline: true },
        { name: 'Account Created', value: accountCreatedFormatted, inline: false },
        { name: 'Joined Server', value: joinedServerFormatted, inline: false },
        { name: 'Detection Confidence', value: confidenceLevel, inline: true },
        {
          name: 'Trigger',
          value: this.formatSuspiciousDetectionTrigger(detectionResult, sourceMessage),
          inline: false,
        },
        { name: 'Reasons', value: reasonsFormatted || 'No specific reason provided', inline: false }
      )
      .setTimestamp();

    this.upsertLatestResolutionField(embed, verificationEvent);
    this.addOptionalAnalysisFields(embed, detectionResult, detectionEventsNewestFirst);

    const actionFailureFieldValue = this.formatVerificationActionFailureFieldValue(
      verificationEvent.metadata
    );
    if (actionFailureFieldValue) {
      embed.addFields({
        name: NotificationPresentationBuilder.MODERATION_ACTION_WARNING_FIELD_NAME,
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

    const caseThreadsFieldValue = this.formatCaseThreadsFieldValue(member, verificationEvent);
    if (caseThreadsFieldValue) {
      embed.addFields({
        name: 'Case Threads',
        value: caseThreadsFieldValue,
        inline: false,
      });
    }

    if (detectionHistory) {
      embed.addFields({ name: 'Detection History', value: detectionHistory, inline: false });
    }

    const persistedThreadAnalysis = this.getThreadAnalysisMetadata(verificationEvent.metadata);
    if (persistedThreadAnalysis?.latestAnalysis) {
      embed.addFields({
        name: NotificationPresentationBuilder.THREAD_ANALYSIS_FIELD_NAME,
        value: this.formatThreadAnalysisFieldValue(persistedThreadAnalysis.latestAnalysis),
        inline: false,
      });
    }

    return embed;
  }

  public createObservedDetectionEmbed(
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
        return `• <t:${timestamp}:R>: ${this.formatDetectionTypeLabel(event.detection_type)} (${Math.round(event.confidence * 100)}% confidence)${this.formatAccountingSuffix(event)}`;
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
            this.formatObservedDetectionTrigger(detectionResult, sourceMessage)
          ),
        },
        {
          name: 'Reasons',
          value: this.truncateEmbedFieldValue(reasonsFormatted || 'No specific reason provided'),
        }
      )
      .setTimestamp();

    this.addOptionalAnalysisFields(embed, detectionResult, detectionEvents);

    if (detectionHistory) {
      embed.addFields({
        name: 'Recent Detection History',
        value: this.truncateEmbedFieldValue(detectionHistory),
      });
    }

    return embed;
  }

  private getPendingCaseTitle(detectionResult: DetectionResult): string {
    if (detectionResult.triggerSource === DetectionType.USER_REPORT) {
      return 'User Report Submitted';
    }

    if (detectionResult.triggerSource === DetectionType.ADMIN_CASE) {
      return 'Admin Review Case Opened';
    }

    return 'Suspicious User Detected';
  }

  public createReportIntakeStartedEmbed(
    reporter: GuildMember,
    thread: ThreadChannel
  ): EmbedBuilder {
    const accountCreatedTimestamp = Math.floor(reporter.user.createdTimestamp / 1000);
    const joinedServerTimestamp = reporter.joinedAt
      ? Math.floor(reporter.joinedAt.getTime() / 1000)
      : null;
    const avatarUrl =
      typeof reporter.user.displayAvatarURL === 'function'
        ? reporter.user.displayAvatarURL()
        : typeof reporter.displayAvatarURL === 'function'
          ? reporter.displayAvatarURL()
          : null;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Report Intake Started')
      .setDescription(
        `A private report intake thread was opened by <@${reporter.id}>. No report has been submitted yet.`
      )
      .addFields(
        { name: 'Reporter', value: `${reporter.user.tag} (${reporter.id})`, inline: false },
        {
          name: 'Report Thread',
          value: `[Open thread](${thread.url}) (${thread.id})`,
          inline: false,
        },
        {
          name: 'Reporter Account Created',
          value: `<t:${accountCreatedTimestamp}:F> (<t:${accountCreatedTimestamp}:R>)`,
          inline: false,
        },
        {
          name: 'Reporter Joined Server',
          value: joinedServerTimestamp
            ? `<t:${joinedServerTimestamp}:F> (<t:${joinedServerTimestamp}:R>)`
            : 'Unknown',
          inline: false,
        }
      )
      .setFooter({ text: 'Drasil will wait for reporter target confirmation before submitting.' })
      .setTimestamp();

    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

    return embed;
  }

  public createActionRow(
    userId: string,
    options: AdminActionRowOptions = {}
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons = [
      new ButtonBuilder()
        .setCustomId(buildCaseAdminActionsCustomId(userId))
        .setLabel('Admin Actions')
        .setStyle(ButtonStyle.Primary),
    ];

    const webCaseUrl =
      options.guildId && options.verificationEventId
        ? buildAdminCaseDetailUrl(options.guildId, options.verificationEventId)
        : null;
    if (webCaseUrl) {
      buttons.push(this.createLinkButton('Web Case', webCaseUrl));
    }

    return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  }

  public createObservedActionRows(
    userId: string,
    detectionEventId: string,
    guildId?: string
  ): ActionRowBuilder<ButtonBuilder>[] {
    const buttons = [
      new ButtonBuilder()
        .setCustomId(buildObservedAdminActionsCustomId(userId, detectionEventId))
        .setLabel('Admin Actions')
        .setStyle(ButtonStyle.Primary),
    ];

    const webQueueUrl = guildId ? buildAdminCaseQueueUrl(guildId) : null;
    if (webQueueUrl) {
      buttons.push(this.createLinkButton('Web Queue', webQueueUrl));
    }

    return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
  }

  private createLinkButton(label: string, url: string): ButtonBuilder {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  }

  public createAdminAllowedMentions(roleIds?: string[] | string | null): {
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

    return { parse: [], roles, users: [], repliedUser: false };
  }

  public getCaseNotificationRoleIds(serverConfig: Server): string[] {
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

  public formatRoleMentions(roleIds: readonly string[]): string | undefined {
    return roleIds.length > 0 ? roleIds.map((roleId) => `<@&${roleId}>`).join(' ') : undefined;
  }

  public addObservedActionTakenField(
    embed: EmbedBuilder,
    actionDescription: string,
    adminId: string,
    timestamp: number
  ): void {
    const field = {
      name: 'Action Taken',
      value: `<@${adminId}> ${actionDescription} <t:${timestamp}:R>`,
      inline: false,
    };
    const existingFields =
      embed.data.fields?.filter(
        (existingField) =>
          existingField.name !== field.name && existingField.name !== 'Action Reverted'
      ) ?? [];
    embed.setFields(...existingFields, field);
  }

  public addObservedActionRevertedField(
    embed: EmbedBuilder,
    actionDescription: string,
    adminId: string,
    timestamp: number
  ): void {
    const field = {
      name: 'Action Reverted',
      value: `<@${adminId}> ${actionDescription} <t:${timestamp}:R>`,
      inline: false,
    };
    const existingFields =
      embed.data.fields?.filter(
        (existingField) =>
          existingField.name !== 'Action Taken' && existingField.name !== field.name
      ) ?? [];
    embed.setFields(...existingFields, field);
  }

  public upsertAdminActionLog(
    embed: EmbedBuilder,
    actionTaken: AdminActionType,
    adminId: string,
    timestamp: number,
    threadUrl?: string,
    hasGuild?: boolean
  ): void {
    const actionLogField = embed.data.fields?.find((field) => field.name === 'Action Log');
    this.upsertLatestAdminActionField(embed, actionTaken, adminId, timestamp);

    if (threadUrl && actionTaken === AdminActionType.CREATE_THREAD) {
      this.upsertField(embed, {
        name: 'Verification Thread',
        value: `[Click here to view the thread](${threadUrl})`,
        inline: false,
      });
    }

    if (hasGuild && actionTaken === AdminActionType.VERIFY) {
      embed.setColor(0x00ff00);
    }
    if (hasGuild && actionTaken === AdminActionType.BAN) {
      embed.setColor(0x000000);
    }
    this.upsertHandledResolutionField(embed, actionTaken, adminId, timestamp);

    const actionLogContent = `• ${this.formatAdminActionEvent(actionTaken, adminId, timestamp)}`;
    if (actionLogField) {
      actionLogField.value = `${actionLogField.value}\n${actionLogContent}`;
    } else {
      embed.addFields({ name: 'Action Log', value: actionLogContent, inline: false });
    }
  }

  public upsertThreadAnalysisField(
    embed: EmbedBuilder,
    analysis: VerificationThreadAnalysisResult,
    analyzedMessageCount: number
  ): void {
    this.upsertField(embed, {
      name: NotificationPresentationBuilder.THREAD_ANALYSIS_FIELD_NAME,
      value: this.formatThreadAnalysisFieldValue({ ...analysis, analyzedMessageCount }),
      inline: false,
    });
  }

  public upsertVerificationActionFailureField(
    embed: EmbedBuilder,
    verificationEvent: VerificationEvent
  ): void {
    const actionFailureFieldValue = this.formatVerificationActionFailureFieldValue(
      verificationEvent.metadata
    );
    const fieldIndex = embed.data.fields?.findIndex(
      (field) => field.name === NotificationPresentationBuilder.MODERATION_ACTION_WARNING_FIELD_NAME
    );

    if (actionFailureFieldValue) {
      const field = {
        name: NotificationPresentationBuilder.MODERATION_ACTION_WARNING_FIELD_NAME,
        value: actionFailureFieldValue,
        inline: false,
      };
      if (fieldIndex !== undefined && fieldIndex >= 0) {
        embed.spliceFields(fieldIndex, 1, field);
      } else {
        embed.addFields(field);
      }
      return;
    }

    if (fieldIndex !== undefined && fieldIndex >= 0) {
      embed.spliceFields(fieldIndex, 1);
    }
  }

  private addOptionalAnalysisFields(
    embed: EmbedBuilder,
    detectionResult: DetectionResult,
    detectionEvents: DetectionEvent[]
  ): void {
    const aiDiagnosticFieldValue = this.formatGptDiagnosticFieldValue(detectionResult);
    if (aiDiagnosticFieldValue) {
      embed.addFields({ name: 'AI Analysis', value: aiDiagnosticFieldValue, inline: false });
    }

    const reportAiFieldValue = this.formatReportAiFieldValue(
      detectionResult.reportAiAnalysis ??
        this.findReportAiAnalysis(detectionEvents, detectionResult.detectionEventId)
    );
    if (reportAiFieldValue) {
      embed.addFields({ name: 'AI Report Triage', value: reportAiFieldValue, inline: false });
    }
  }

  private formatSuspiciousDetectionHistory(
    detectionEvents: DetectionEvent[],
    guildId: string
  ): string {
    if (detectionEvents.length === 0) {
      return '';
    }

    const sortedEvents = [...detectionEvents].sort(
      (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
    const detectionHistory = sortedEvents
      .slice(0, 5)
      .map((event) => {
        const timestamp = Math.floor(new Date(event.detected_at).getTime() / 1000);
        let entry = `• <t:${timestamp}:R>: ${this.formatDetectionTypeLabel(event.detection_type)}`;
        if (event.message_id) {
          entry += ` - [View Message](https://discord.com/channels/${guildId}/${event.channel_id}/${event.message_id})`;
        }
        entry += ` (${(event.confidence * 100).toFixed(0)}% confidence)`;
        entry += this.formatAccountingSuffix(event);
        return entry;
      })
      .join('\n');

    return sortedEvents.length > 5
      ? `${detectionHistory}\n\n*${sortedEvents.length - 5} more events not shown*`
      : detectionHistory;
  }

  private formatObservedDetectionTrigger(
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
    if (detectionResult.triggerSource === DetectionType.ADMIN_CASE) {
      return `Observed via admin-opened case: ${detectionResult.triggerContent || 'Manual review'}`;
    }
    if (detectionResult.triggerSource === DetectionType.ADMIN_FLAG) {
      return `Observed via admin flag: ${detectionResult.triggerContent || 'Manual flag'}`;
    }
    if (detectionResult.triggerSource === DetectionType.ROLE_INTAKE) {
      return `Observed via role intake: ${detectionResult.triggerContent || 'Role intake'}`;
    }
    if (detectionResult.triggerSource === DetectionType.GPT_ANALYSIS) {
      return `Observed via manual review: \`${detectionResult.triggerContent || 'Manual flag'}\``;
    }

    return 'Observed suspicious activity';
  }

  private formatSuspiciousDetectionTrigger(
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): string {
    if (detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`Message content unavailable`';
      return sourceMessage
        ? `[Flagged for message](${sourceMessage.url}): ${safeContent}`
        : `Flagged for message: ${safeContent}`;
    }
    if (detectionResult.triggerSource === DetectionType.USER_REPORT) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`No report reason provided`';
      return `Flagged via user report: ${safeContent}`;
    }
    if (detectionResult.triggerSource === DetectionType.ADMIN_CASE) {
      return `Admin-opened case: ${detectionResult.triggerContent || 'Manual review'}`;
    }
    if (detectionResult.triggerSource === DetectionType.ADMIN_FLAG) {
      return `Admin flag: ${detectionResult.triggerContent || 'Manual flag'}`;
    }
    if (detectionResult.triggerSource === DetectionType.ROLE_INTAKE) {
      return `Role intake: ${detectionResult.triggerContent || 'Role intake'}`;
    }
    if (detectionResult.triggerSource === DetectionType.GPT_ANALYSIS) {
      const safeContent = detectionResult.triggerContent
        ? `\`${detectionResult.triggerContent}\``
        : '`Manual flag`';
      return `Flagged via manual review: ${safeContent}`;
    }
    if (detectionResult.triggerSource === DetectionType.NEW_ACCOUNT) {
      return 'Flagged upon joining server';
    }

    return 'Flagged for suspicious activity';
  }

  private truncateEmbedFieldValue(value: string): string {
    const maxLength = 1024;
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
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
      name: NotificationPresentationBuilder.LATEST_ADMIN_ACTION_FIELD_NAME,
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

  private getVerificationResolutionPresentation(
    verificationEvent: VerificationEvent
  ): { title: string; fieldValue: string } | null {
    const actionTaken =
      verificationEvent.status === VerificationStatus.BANNED
        ? AdminActionType.BAN
        : verificationEvent.status === VerificationStatus.VERIFIED
          ? AdminActionType.VERIFY
          : null;
    if (!actionTaken) {
      return null;
    }

    const resolvedAt = verificationEvent.resolved_at
      ? Math.floor(verificationEvent.resolved_at.getTime() / 1000)
      : null;

    return {
      title: this.formatHandledTitle(actionTaken),
      fieldValue: this.formatResolutionFieldValue(
        actionTaken,
        verificationEvent.resolved_by,
        resolvedAt
      ),
    };
  }

  private upsertHandledResolutionField(
    embed: EmbedBuilder,
    actionTaken: AdminActionType,
    adminId: string,
    timestamp: number
  ): void {
    if (actionTaken !== AdminActionType.VERIFY && actionTaken !== AdminActionType.BAN) {
      return;
    }

    embed.setTitle(this.formatHandledTitle(actionTaken));
    const field = {
      name: NotificationPresentationBuilder.RESOLUTION_FIELD_NAME,
      value: this.formatResolutionFieldValue(actionTaken, adminId, timestamp),
      inline: false,
    };
    const fields = (embed.data.fields ?? []).filter(
      (existingField) => existingField.name !== field.name
    );
    fields.splice(0, 0, field);
    embed.setFields(...fields);
  }

  private formatHandledTitle(actionTaken: AdminActionType): string {
    return `Case Handled: ${this.formatAdminActionLabel(actionTaken)}`;
  }

  private formatResolutionFieldValue(
    actionTaken: AdminActionType,
    adminId: string | null,
    timestamp: number | null
  ): string {
    const actor = adminId ? ` by <@${adminId}>` : '';
    const when = timestamp ? ` at <t:${timestamp}:F>` : '';
    return `${this.formatAdminActionLabel(actionTaken)}${actor}${when}\nNo further moderator action is pending.`;
  }

  private upsertField(
    embed: EmbedBuilder,
    field: { name: string; value: string; inline: boolean }
  ): void {
    const existingFieldIndex = embed.data.fields?.findIndex(
      (embedField) => embedField.name === field.name
    );
    if (existingFieldIndex !== undefined && existingFieldIndex > -1) {
      embed.spliceFields(existingFieldIndex, 1, field);
    } else {
      embed.addFields(field);
    }
  }

  private metadataToRecord(metadata: DetectionEvent['metadata']): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...metadata } as Record<string, unknown>;
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
              ? 'Create admin evidence thread'
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

  private formatDetectionTypeLabel(detectionType: DetectionType): string {
    switch (detectionType) {
      case DetectionType.MESSAGE_FREQUENCY:
        return 'message frequency';
      case DetectionType.SUSPICIOUS_CONTENT:
        return 'suspicious content';
      case DetectionType.GPT_ANALYSIS:
        return 'GPT analysis';
      case DetectionType.NEW_ACCOUNT:
        return 'new account';
      case DetectionType.PATTERN_MATCH:
        return 'pattern match';
      case DetectionType.USER_REPORT:
        return 'user report';
      case DetectionType.ADMIN_CASE:
        return 'admin-opened case';
      case DetectionType.ADMIN_FLAG:
        return 'admin flag';
      case DetectionType.ROLE_INTAKE:
        return 'role intake';
      default: {
        const exhaustive: never = detectionType;
        return String(exhaustive);
      }
    }
  }

  private formatCaseThreadsFieldValue(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): string | null {
    const lines: string[] = [];
    const threadStatus =
      verificationEvent.status === VerificationStatus.VERIFIED ||
      verificationEvent.status === VerificationStatus.BANNED
        ? `${verificationEvent.status}${verificationEvent.resolved_by ? ` by <@${verificationEvent.resolved_by}>` : ''}`
        : 'pending';

    if (verificationEvent.thread_id) {
      lines.push(
        `Verification/review: [thread](https://discord.com/channels/${member.guild.id}/${verificationEvent.thread_id}) status: ${threadStatus}`
      );
    }

    if (verificationEvent.private_evidence_thread_id) {
      lines.push(
        `Admin evidence: [thread](https://discord.com/channels/${member.guild.id}/${verificationEvent.private_evidence_thread_id})`
      );
    }

    return lines.length > 0 ? lines.join('\n') : null;
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
}
