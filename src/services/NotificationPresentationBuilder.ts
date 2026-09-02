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
  CaptchaChallenge,
  CaptchaChallengeRequestSource,
  CaptchaChallengeStatus,
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
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
import { formatDiscordUserIdentity } from '../utils/discordUserIdentity';
import { buildAdminCaseDetailUrl, buildAdminModerationInboxUrl } from '../utils/publicWebLinks';
import { getVerificationActionFailures } from '../utils/verificationActionFailures';

interface AdminActionRowOptions {
  readonly guildId?: string;
  readonly verificationEventId?: string;
  readonly verificationStatus?: VerificationStatus;
  readonly includeBanAction?: boolean;
  readonly caseMembershipState?: CaseMembershipState;
  readonly caseAttentionState?: CaseAttentionState;
  readonly caseKind?: CaseKind;
}

type CaseMembershipState = 'in_server' | 'left_or_removed';
type ObservedActionKind = 'alert' | 'report';

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
    isFallback: boolean;
    analyzedMessageCount: number;
  };
}

interface VerificationResolutionPresentation {
  title: string;
  fieldValue: string;
}

interface PendingMembershipPresentation {
  title: string;
  description: string;
  fieldValue: string;
}

const EMBED_FIELD_VALUE_MAX_LENGTH = 1024;
const CASE_COLOR_PENDING = 0xff0000;
const CASE_COLOR_WARNING = 0xffc107;
const CASE_COLOR_VERIFIED = 0x00ff00;
const CASE_COLOR_BANNED = 0x000000;
const CASE_COLOR_CLOSED = 0x808080;

export class NotificationPresentationBuilder {
  public static readonly THREAD_ANALYSIS_FIELD_NAME = 'Thread Analysis';
  public static readonly LATEST_ADMIN_ACTION_FIELD_NAME = 'Latest Admin Action';
  public static readonly MODERATION_ACTION_WARNING_FIELD_NAME = 'Moderation Action Warning';
  public static readonly RESOLUTION_FIELD_NAME = 'Resolution';
  public static readonly ACCOUNT_QUARANTINE_FIELD_NAME = 'Account Quarantine';
  public static readonly CAPTCHA_FIELD_NAME = 'Browser Security Check';

  public createSuspiciousUserEmbed(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    detectionEvents: DetectionEvent[],
    sourceMessage?: Message,
    captchaChallenge?: CaptchaChallenge | null
  ): EmbedBuilder {
    const accountCreatedAt = new Date(member.user.createdTimestamp);
    const joinedServerAt = member.joinedAt;
    const accountCreatedTimestamp = Math.floor(accountCreatedAt.getTime() / 1000);
    const joinedServerTimestamp = joinedServerAt ? Math.floor(joinedServerAt.getTime() / 1000) : 0;
    const accountCreatedFormatted = `<t:${accountCreatedTimestamp}:F> (<t:${accountCreatedTimestamp}:R>)`;
    const joinedServerFormatted = joinedServerAt
      ? `<t:${joinedServerTimestamp}:F> (<t:${joinedServerTimestamp}:R>)`
      : 'Unknown';

    const signalField = this.formatSignalField(detectionResult);
    let embedColor = CASE_COLOR_PENDING;

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
      embedColor = CASE_COLOR_VERIFIED;
    } else if (verificationEvent.status === VerificationStatus.BANNED) {
      embedColor = CASE_COLOR_BANNED;
    } else if (verificationEvent.status === VerificationStatus.KICKED) {
      embedColor = CASE_COLOR_WARNING;
    } else if (verificationEvent.status === VerificationStatus.CLOSED_NO_ACTION) {
      embedColor = CASE_COLOR_CLOSED;
    }

    const resolutionPresentation = this.getVerificationResolutionPresentation(verificationEvent);
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(
        resolutionPresentation?.title ??
          this.getPendingCaseTitle(detectionResult, verificationEvent)
      )
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
        {
          name: 'User',
          value: formatDiscordUserIdentity(member, { includeSnowflake: false }),
          inline: false,
        },
        { name: 'User ID', value: member.id, inline: true },
        { name: 'Account Created', value: accountCreatedFormatted, inline: false },
        { name: 'Joined Server', value: joinedServerFormatted, inline: false },
        signalField,
        {
          name: 'Trigger',
          value: this.formatSuspiciousDetectionTrigger(detectionResult, sourceMessage),
          inline: false,
        },
        { name: 'Reasons', value: reasonsFormatted || 'No specific reason provided', inline: false }
      )
      .setTimestamp();

    this.upsertPendingMembershipField(embed, verificationEvent);
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

    const roleQuarantineFieldValue = this.formatRoleQuarantineFieldValue(
      verificationEvent.metadata
    );
    if (roleQuarantineFieldValue) {
      embed.addFields({
        name: 'Role Quarantine',
        value: roleQuarantineFieldValue,
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

    if (captchaChallenge !== undefined) {
      this.upsertCaptchaChallengePresentation(embed, captchaChallenge);
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
    const signalField = this.formatSignalField(detectionResult);
    const reasonsFormatted = detectionResult.reasons.map((reason) => `• ${reason}`).join('\n');
    const recentEvents = detectionEvents.slice(0, 5);
    const detectionHistory = recentEvents
      .map((event) => {
        const timestamp = Math.floor(new Date(event.detected_at).getTime() / 1000);
        return `• <t:${timestamp}:R>: ${this.formatDetectionTypeLabel(event.detection_type)} (${this.formatDetectionSignalPhrase(event)})${this.formatAccountingSuffix(event)}`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('Suspicious Activity Observed')
      .setDescription(
        `Drasil observed suspicious activity from <@${member.id}>. No case was opened automatically.`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        {
          name: 'User',
          value: formatDiscordUserIdentity(member, { includeSnowflake: false }),
          inline: false,
        },
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
        signalField,
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

  private getPendingCaseTitle(
    detectionResult: DetectionResult,
    verificationEvent?: VerificationEvent
  ): string {
    const metadata = this.verificationMetadataToRecord(verificationEvent?.metadata);
    if (metadata.case_origin === 'observed_alert') {
      return 'Moderation Case Opened';
    }

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
        {
          name: 'Reporter',
          value: formatDiscordUserIdentity(reporter, { includeSnowflake: false }),
          inline: false,
        },
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
        .setCustomId(buildCaseAdminActionsCustomId(userId, options.verificationEventId))
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

  public createAdminNotificationActionRows(
    userId: string,
    options: AdminActionRowOptions = {}
  ): ActionRowBuilder<ButtonBuilder>[] {
    const isPending =
      !options.verificationStatus || options.verificationStatus === VerificationStatus.PENDING;
    const primaryButtons = isPending
      ? this.createPendingCaseAdminButtons(
          userId,
          options.includeBanAction !== false,
          options.caseMembershipState ?? 'in_server',
          options.caseAttentionState === CaseAttentionState.PARKED,
          options.caseKind === CaseKind.COMPROMISED_ACCOUNT,
          options.verificationEventId
        )
      : [
          this.createCustomButton(`reopen_${userId}`, 'Reopen', ButtonStyle.Primary),
          this.createCustomButton(`history_${userId}`, 'History', ButtonStyle.Secondary),
          this.createCustomButton(
            buildCaseAdminActionsCustomId(userId, options.verificationEventId),
            'Other Actions',
            ButtonStyle.Secondary
          ),
        ];

    const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(...primaryButtons)];
    const webCaseUrl =
      options.guildId && options.verificationEventId
        ? buildAdminCaseDetailUrl(options.guildId, options.verificationEventId)
        : null;
    if (webCaseUrl) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          this.createLinkButton('Web Case', webCaseUrl)
        )
      );
    }

    return rows;
  }

  public createObservedActionRows(
    userId: string,
    detectionEventId: string,
    guildId?: string,
    options: Pick<AdminActionRowOptions, 'includeBanAction'> & {
      actioned?: boolean;
      kind?: ObservedActionKind;
    } = {}
  ): ActionRowBuilder<ButtonBuilder>[] {
    if (options.actioned) {
      const buttons = [
        this.createCustomButton(
          buildObservedAdminActionsCustomId(userId, detectionEventId),
          'Other Actions',
          ButtonStyle.Secondary
        ),
      ];
      const webQueueUrl = guildId ? buildAdminModerationInboxUrl(guildId) : null;
      const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
      if (webQueueUrl) {
        rows.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            this.createLinkButton('Web Queue', webQueueUrl)
          )
        );
      }

      return rows;
    }

    const buttons = [
      this.createCustomButton(
        `observed:open:${userId}:${detectionEventId}`,
        'Open Case',
        ButtonStyle.Primary
      ),
    ];

    if (options.includeBanAction !== false) {
      buttons.push(
        this.createCustomButton(
          `observed:ban:${userId}:${detectionEventId}`,
          'Ban...',
          ButtonStyle.Danger
        )
      );
    }

    buttons.push(
      this.createCustomButton(
        `observed:${options.kind === 'report' ? 'close_report' : 'dismiss'}:${userId}:${detectionEventId}`,
        options.kind === 'report' ? 'Close Report' : 'Dismiss',
        ButtonStyle.Secondary
      ),
      this.createCustomButton(
        buildObservedAdminActionsCustomId(userId, detectionEventId),
        'Other Actions',
        ButtonStyle.Secondary
      )
    );

    const webQueueUrl = guildId ? buildAdminModerationInboxUrl(guildId) : null;
    const rows = [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
    if (webQueueUrl) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          this.createLinkButton('Web Queue', webQueueUrl)
        )
      );
    }

    return rows;
  }

  private createPendingCaseAdminButtons(
    userId: string,
    includeBanAction: boolean,
    caseMembershipState: CaseMembershipState,
    isParked: boolean,
    isCompromisedAccount: boolean,
    verificationEventId?: string
  ): ButtonBuilder[] {
    if (isParked) {
      const buttons = [this.createCustomButton(`verify_${userId}`, 'Verify', ButtonStyle.Success)];
      if (includeBanAction) {
        buttons.push(this.createCustomButton(`ban_${userId}`, 'Ban...', ButtonStyle.Danger));
      }
      buttons.push(
        this.createCustomButton(
          buildCaseAdminActionsCustomId(userId, verificationEventId),
          'Other Actions',
          ButtonStyle.Secondary
        )
      );
      return buttons;
    }

    if (caseMembershipState === 'left_or_removed') {
      const buttons = [
        this.createCustomButton(`history_${userId}`, 'History', ButtonStyle.Secondary),
      ];

      if (includeBanAction) {
        buttons.push(this.createCustomButton(`ban_${userId}`, 'Ban by ID...', ButtonStyle.Danger));
      }

      if (!isCompromisedAccount) {
        buttons.push(this.createCustomButton(`close_${userId}`, 'Close', ButtonStyle.Secondary));
      }
      buttons.push(
        this.createCustomButton(
          buildCaseAdminActionsCustomId(userId, verificationEventId),
          'Other Actions',
          ButtonStyle.Secondary
        )
      );

      return buttons;
    }

    const buttons = [this.createCustomButton(`verify_${userId}`, 'Verify', ButtonStyle.Success)];

    if (includeBanAction) {
      buttons.push(this.createCustomButton(`ban_${userId}`, 'Ban...', ButtonStyle.Danger));
    }

    if (!isCompromisedAccount) {
      buttons.push(this.createCustomButton(`close_${userId}`, 'Close', ButtonStyle.Secondary));
    }
    buttons.push(
      this.createCustomButton(
        buildCaseAdminActionsCustomId(userId, verificationEventId),
        'Other Actions',
        ButtonStyle.Secondary
      )
    );

    return buttons;
  }

  private createCustomButton(customId: string, label: string, style: ButtonStyle): ButtonBuilder {
    return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
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
    timestamp: number,
    actionType?: AdminActionType
  ): void {
    if (actionType) {
      this.applyObservedActionPresentation(embed, actionType);
    }

    const field = {
      name: 'Action Taken',
      value: `${this.formatActorReference(adminId)} ${actionDescription} <t:${timestamp}:R>`,
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
    this.restoreObservedPendingPresentation(embed);
    const field = {
      name: 'Action Reverted',
      value: `${this.formatActorReference(adminId)} ${actionDescription} <t:${timestamp}:R>`,
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

  public upsertAccountQuarantinePresentation(
    embed: EmbedBuilder,
    verificationEvent: VerificationEvent
  ): void {
    const fields = (embed.data.fields ?? []).filter(
      (field) => field.name !== NotificationPresentationBuilder.ACCOUNT_QUARANTINE_FIELD_NAME
    );
    if (
      verificationEvent.status !== VerificationStatus.PENDING ||
      verificationEvent.case_kind !== CaseKind.COMPROMISED_ACCOUNT
    ) {
      embed.setFields(...fields);
      return;
    }

    const metadata = this.verificationMetadataToRecord(verificationEvent.metadata);
    const quarantine = this.verificationMetadataToRecord(metadata.account_quarantine);
    const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
    const failureStage =
      typeof quarantine.failure_stage === 'string' ? quarantine.failure_stage : null;
    const failureMessage = typeof quarantine.error === 'string' ? quarantine.error : null;
    const status =
      quarantine.result === 'failed'
        ? `Containment attempt failed${failureStage ? ` during ${failureStage.replace(/_/g, ' ')}` : ''}${failureMessage ? `: ${failureMessage}.` : '.'} Review the case and repair the failure before retrying quarantine.`
        : verificationEvent.attention_state === CaseAttentionState.PARKED &&
            verificationEvent.containment_status === CaseContainmentStatus.CONTAINED
          ? 'Contained and parked. Keep the verification thread open until the user reports recovery; release only through moderator verification, kick, or ban.'
          : verificationEvent.containment_status === CaseContainmentStatus.IN_PROGRESS
            ? 'Containment is currently in progress. A second quarantine attempt will be rejected.'
            : 'Containment is incomplete. Review and repair the blockers before retrying quarantine.';
    fields.push({
      name: NotificationPresentationBuilder.ACCOUNT_QUARANTINE_FIELD_NAME,
      value: this.truncateEmbedFieldValue(
        [
          status,
          `Removed roles: ${count(quarantine.removed_role_ids)} · Retained roles: ${count(quarantine.retained_roles)} · Failed removals: ${count(quarantine.failed_removals)} · Permission bypasses: ${count(quarantine.member_bypasses)}`,
        ].join('\n')
      ),
      inline: false,
    });
    embed.setColor(CASE_COLOR_WARNING);
    embed.setTitle(
      verificationEvent.attention_state === CaseAttentionState.PARKED
        ? 'Account Quarantine Parked'
        : 'Account Quarantine Needs Review'
    );
    embed.setFields(...fields);
  }

  public upsertCaptchaChallengePresentation(
    embed: EmbedBuilder,
    challenge: CaptchaChallenge | null
  ): void {
    const fields = (embed.data.fields ?? []).filter(
      (field) => field.name !== NotificationPresentationBuilder.CAPTCHA_FIELD_NAME
    );
    if (!challenge) {
      embed.setFields(...fields);
      return;
    }

    const statusLabels: Record<CaptchaChallengeStatus, string> = {
      [CaptchaChallengeStatus.PENDING]: 'Pending',
      [CaptchaChallengeStatus.PASSED]: 'Passed',
      [CaptchaChallengeStatus.FAILED]: 'Attempt limit reached',
      [CaptchaChallengeStatus.EXPIRED]: 'Expired',
      [CaptchaChallengeStatus.BYPASSED]: 'Bypassed by moderator',
      [CaptchaChallengeStatus.CANCELLED]: 'Cancelled',
    };
    const requestedAt = Math.floor(challenge.requested_at.getTime() / 1000);
    const expiresAt = Math.floor(challenge.expires_at.getTime() / 1000);
    const lines = [
      `Status: ${statusLabels[challenge.status]}`,
      `Generation: ${challenge.generation} · Submissions: ${challenge.submission_count}`,
      `Requested: <t:${requestedAt}:F> (<t:${requestedAt}:R>)`,
      challenge.status === CaptchaChallengeStatus.PENDING
        ? `Expires: <t:${expiresAt}:F> (<t:${expiresAt}:R>)`
        : null,
      challenge.requested_by
        ? `Requested by: ${this.formatActorReference(challenge.requested_by)}`
        : challenge.request_source === CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN
          ? 'Requested by: Drasil suspicious-join policy'
          : null,
      challenge.delivered_at
        ? `Link delivered: <t:${Math.floor(challenge.delivered_at.getTime() / 1000)}:R>`
        : challenge.delivery_error_code
          ? `Link delivery: failed (${challenge.delivery_error_code.replace(/_/g, ' ')})`
          : 'Link delivery: pending',
      challenge.passed_at
        ? `Passed: <t:${Math.floor(challenge.passed_at.getTime() / 1000)}:F>`
        : null,
      challenge.bypassed_at
        ? `Bypassed: <t:${Math.floor(challenge.bypassed_at.getTime() / 1000)}:F>${challenge.bypassed_by ? ` by ${this.formatActorReference(challenge.bypassed_by)}` : ''}`
        : null,
      challenge.bypass_reason ? `Bypass reason: ${challenge.bypass_reason}` : null,
    ].filter((line): line is string => Boolean(line));
    fields.push({
      name: NotificationPresentationBuilder.CAPTCHA_FIELD_NAME,
      value: this.truncateEmbedFieldValue(lines.join('\n')),
      inline: false,
    });
    embed.setFields(...fields);
  }

  public upsertResolvedCasePresentation(
    embed: EmbedBuilder,
    verificationEvent: VerificationEvent,
    status: VerificationStatus
  ): void {
    const actionTaken = this.getResolutionAction(status);
    if (!actionTaken) {
      this.clearResolvedCasePresentation(embed);
      this.upsertPendingMembershipField(embed, verificationEvent);
      return;
    }

    if (status === VerificationStatus.VERIFIED) {
      embed.setColor(CASE_COLOR_VERIFIED);
    } else if (status === VerificationStatus.BANNED) {
      embed.setColor(CASE_COLOR_BANNED);
    } else if (status === VerificationStatus.KICKED) {
      embed.setColor(CASE_COLOR_WARNING);
    } else if (status === VerificationStatus.CLOSED_NO_ACTION) {
      embed.setColor(CASE_COLOR_CLOSED);
    }

    const resolvedAt = verificationEvent.resolved_at
      ? Math.floor(verificationEvent.resolved_at.getTime() / 1000)
      : null;
    this.upsertHandledResolutionField(
      embed,
      actionTaken,
      verificationEvent.resolved_by,
      resolvedAt
    );

    if (verificationEvent.resolved_by && resolvedAt) {
      this.upsertLatestAdminActionField(
        embed,
        actionTaken,
        verificationEvent.resolved_by,
        resolvedAt
      );
    }
  }

  private clearResolvedCasePresentation(embed: EmbedBuilder): void {
    const fields = embed.data.fields ?? [];
    const hasResolutionField = fields.some(
      (field) => field.name === NotificationPresentationBuilder.RESOLUTION_FIELD_NAME
    );
    const hasHandledTitle = embed.data.title?.startsWith('Case Handled:') ?? false;
    const hasHandledDescription =
      embed.data.description?.includes('No further moderator action is pending.') ?? false;

    if (!hasResolutionField && !hasHandledTitle && !hasHandledDescription) {
      return;
    }

    embed.setColor(CASE_COLOR_PENDING);
    embed.setTitle(this.getPendingTitleFromExistingEmbed(embed));
    embed.setDescription(this.getPendingDescriptionFromExistingEmbed(embed));
    embed.setFields(
      ...fields.filter(
        (field) =>
          field.name !== NotificationPresentationBuilder.RESOLUTION_FIELD_NAME &&
          field.name !== 'Membership'
      )
    );
  }

  private getPendingTitleFromExistingEmbed(embed: EmbedBuilder): string {
    const trigger = embed.data.fields?.find((field) => field.name === 'Trigger')?.value ?? '';
    if (trigger.startsWith('Flagged via user report:')) {
      return 'User Report Submitted';
    }

    if (trigger.startsWith('Admin-opened case:')) {
      return 'Admin Review Case Opened';
    }

    return 'Suspicious User Detected';
  }

  private getPendingDescriptionFromExistingEmbed(embed: EmbedBuilder): string {
    const userId = embed.data.fields?.find((field) => field.name === 'User ID')?.value;
    if (userId) {
      return `<@${userId}> has been flagged as suspicious.`;
    }

    return 'Case is pending moderator review.';
  }

  private addOptionalAnalysisFields(
    embed: EmbedBuilder,
    detectionResult: DetectionResult,
    detectionEvents: DetectionEvent[]
  ): void {
    const aiDiagnosticFieldValue = this.formatGptDiagnosticFieldValue(detectionResult);
    if (aiDiagnosticFieldValue) {
      embed.addFields({ name: 'Risk Analysis', value: aiDiagnosticFieldValue, inline: false });
    }

    const reportAiFieldValue = this.formatReportAiFieldValue(
      detectionResult.reportAiAnalysis ??
        this.findReportAiAnalysis(detectionEvents, detectionResult.detectionEventId)
    );
    if (reportAiFieldValue) {
      embed.addFields({ name: 'Report Triage', value: reportAiFieldValue, inline: false });
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
          entry += ` - message: https://discord.com/channels/${guildId}/${event.channel_id}/${event.message_id}`;
        }
        entry += ` (${this.formatDetectionSignalPhrase(event)})`;
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
        ? `Observed message: ${safeContent}\nMessage URL: ${sourceMessage.url}`
        : `Observed message: ${safeContent}`;
    }

    if (detectionResult.triggerSource === DetectionType.NEW_ACCOUNT) {
      return 'Observed upon joining server';
    }
    if (detectionResult.triggerSource === DetectionType.REJOIN_AFTER_KICK) {
      return 'Observed on rejoin after prior kick';
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
    if (detectionResult.triggerSource === DetectionType.HONEYPOT_ROLE) {
      return `Observed via honeypot role: ${detectionResult.triggerContent || 'Honeypot role assigned'}`;
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
        ? `Flagged for message: ${safeContent}\nMessage URL: ${sourceMessage.url}`
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
    if (detectionResult.triggerSource === DetectionType.HONEYPOT_ROLE) {
      return `Honeypot role: ${detectionResult.triggerContent || 'Honeypot role assigned'}`;
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
    if (detectionResult.triggerSource === DetectionType.REJOIN_AFTER_KICK) {
      return 'Flagged on rejoin after prior kick';
    }

    return 'Flagged for suspicious activity';
  }

  private truncateEmbedFieldValue(value: string): string {
    return value.length <= EMBED_FIELD_VALUE_MAX_LENGTH
      ? value
      : `${value.slice(0, EMBED_FIELD_VALUE_MAX_LENGTH - 3)}...`;
  }

  private formatCompactEmbedFieldValue(
    primaryLines: string[],
    optionalLines: Array<string | null | undefined> = []
  ): string {
    const lines: string[] = [];
    for (const line of [...primaryLines, ...optionalLines]) {
      const normalized = line?.trim();
      if (!normalized) {
        continue;
      }

      const candidate = [...lines, normalized].join('\n');
      if (candidate.length <= EMBED_FIELD_VALUE_MAX_LENGTH) {
        lines.push(normalized);
      }
    }

    return lines.join('\n') || 'Review manually.';
  }

  private formatAdminActionLabel(actionTaken: AdminActionType): string {
    switch (actionTaken) {
      case AdminActionType.BAN:
        return 'Banned';
      case AdminActionType.KICK:
        return 'Kicked';
      case AdminActionType.CLOSE_NO_ACTION:
        return 'Closed with no action';
      case AdminActionType.VERIFY:
        return 'Verified';
      case AdminActionType.CREATE_THREAD:
        return 'Created verification thread';
      case AdminActionType.REOPEN:
        return 'Reopened verification';
      case AdminActionType.RESTRICT:
        return 'Applied case role';
      case AdminActionType.LIFT_RESTRICTION:
        return 'Removed case role';
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
      case AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT:
        return 'Quarantined compromised account';
      default:
        return actionTaken;
    }
  }

  private formatAdminActionEvent(
    actionTaken: AdminActionType,
    adminId: string,
    timestamp: number
  ): string {
    return `${this.formatAdminActionLabel(actionTaken)} by ${this.formatActorReference(adminId)} at <t:${timestamp}:F>`;
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

    const actionTaken = this.getResolutionAction(verificationEvent.status);
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
  ): VerificationResolutionPresentation | null {
    const actionTaken = this.getResolutionAction(verificationEvent.status);
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
    adminId: string | null,
    timestamp: number | null
  ): void {
    if (
      actionTaken !== AdminActionType.VERIFY &&
      actionTaken !== AdminActionType.BAN &&
      actionTaken !== AdminActionType.KICK &&
      actionTaken !== AdminActionType.CLOSE_NO_ACTION
    ) {
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

  private getResolutionAction(status: VerificationStatus): AdminActionType | null {
    switch (status) {
      case VerificationStatus.BANNED:
        return AdminActionType.BAN;
      case VerificationStatus.KICKED:
        return AdminActionType.KICK;
      case VerificationStatus.VERIFIED:
        return AdminActionType.VERIFY;
      case VerificationStatus.CLOSED_NO_ACTION:
        return AdminActionType.CLOSE_NO_ACTION;
      case VerificationStatus.PENDING:
        return null;
    }
  }

  private formatHandledTitle(actionTaken: AdminActionType): string {
    return `Case Handled: ${this.formatAdminActionLabel(actionTaken)}`;
  }

  private formatResolutionFieldValue(
    actionTaken: AdminActionType,
    adminId: string | null,
    timestamp: number | null
  ): string {
    const actor = adminId ? ` by ${this.formatActorReference(adminId)}` : '';
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

  private formatActorReference(actorId: string): string {
    return actorId === 'drasil:captcha' ? 'Drasil browser check' : `<@${actorId}>`;
  }

  private metadataToRecord(metadata: DetectionEvent['metadata']): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...metadata } as Record<string, unknown>;
  }

  private verificationMetadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...metadata } as Record<string, unknown>;
  }

  public getCaseMembershipState(verificationEvent: VerificationEvent): CaseMembershipState {
    const metadata = this.verificationMetadataToRecord(verificationEvent.metadata);
    return metadata.membership_state === 'left_or_removed' ? 'left_or_removed' : 'in_server';
  }

  private getPendingMembershipPresentation(
    verificationEvent: VerificationEvent
  ): PendingMembershipPresentation | null {
    if (verificationEvent.status !== VerificationStatus.PENDING) {
      return null;
    }

    const metadata = this.verificationMetadataToRecord(verificationEvent.metadata);
    if (metadata.membership_state !== 'left_or_removed') {
      return null;
    }

    const memberLeftAt =
      typeof metadata.member_left_at === 'string'
        ? Math.floor(new Date(metadata.member_left_at).getTime() / 1000)
        : null;
    const when = memberLeftAt && Number.isFinite(memberLeftAt) ? ` at <t:${memberLeftAt}:F>` : '';

    return {
      title: 'Member Left Server',
      description: `<@${verificationEvent.user_id}> left or was removed while this case is still pending. They cannot respond in the verification thread.`,
      fieldValue: `Left or removed${when}. Use Ban by ID if moderation should continue, or Close No Action if no action is needed.`,
    };
  }

  private upsertPendingMembershipField(
    embed: EmbedBuilder,
    verificationEvent: VerificationEvent
  ): void {
    const membershipPresentation = this.getPendingMembershipPresentation(verificationEvent);
    const fields = (embed.data.fields ?? []).filter((field) => field.name !== 'Membership');

    if (!membershipPresentation) {
      embed.setFields(...fields);
      return;
    }

    embed.setColor(CASE_COLOR_WARNING);
    embed.setTitle(membershipPresentation.title);
    embed.setDescription(membershipPresentation.description);
    const triggerIndex = fields.findIndex((field) => field.name === 'Trigger');
    const insertIndex = triggerIndex >= 0 ? triggerIndex : fields.length;
    fields.splice(insertIndex, 0, {
      name: 'Membership',
      value: membershipPresentation.fieldValue,
      inline: false,
    });
    embed.setFields(...fields);
  }

  private applyObservedActionPresentation(embed: EmbedBuilder, actionType: AdminActionType): void {
    const userId = embed.data.fields?.find((field) => field.name === 'User ID')?.value;
    const userReference = userId ? `<@${userId}>` : 'This user';

    switch (actionType) {
      case AdminActionType.DISMISS:
        embed.setColor(CASE_COLOR_CLOSED);
        embed.setTitle('Observed Alert Dismissed');
        embed.setDescription(
          `${userReference}'s observed alert was dismissed. No further moderator action is pending for this alert.`
        );
        return;
      case AdminActionType.FALSE_POSITIVE:
        embed.setColor(CASE_COLOR_VERIFIED);
        embed.setTitle('Observed Alert Marked False Positive');
        embed.setDescription(
          `${userReference}'s observed alert was marked as a false positive. No further moderator action is pending for this alert.`
        );
        return;
      case AdminActionType.BAN:
        embed.setColor(CASE_COLOR_BANNED);
        embed.setTitle('Observed Alert Handled: Banned');
        embed.setDescription(`${userReference} was banned from this observed alert.`);
        return;
      case AdminActionType.RESTRICT:
        embed.setColor(CASE_COLOR_PENDING);
        embed.setTitle('Moderation Case Opened');
        embed.setDescription(`${userReference} was moved into a moderation case.`);
        return;
      case AdminActionType.OPEN_CASE:
        embed.setColor(CASE_COLOR_PENDING);
        embed.setTitle('Moderation Case Opened');
        embed.setDescription(`${userReference} was moved into a moderation case.`);
        return;
      default:
        return;
    }
  }

  private restoreObservedPendingPresentation(embed: EmbedBuilder): void {
    const userId = embed.data.fields?.find((field) => field.name === 'User ID')?.value;
    const userReference = userId ? `<@${userId}>` : 'this user';
    embed.setColor(CASE_COLOR_WARNING);
    embed.setTitle('Suspicious Activity Observed');
    embed.setDescription(
      `Drasil observed suspicious activity from ${userReference}. No case was opened automatically.`
    );
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
          failure.action === 'case_role' || failure.action === 'restrict'
            ? 'Apply case role'
            : failure.action === 'private_evidence_thread'
              ? 'Create admin evidence thread'
              : failure.action === 'role_quarantine'
                ? 'Role quarantine'
                : 'Create case thread';
        const when = Number.isFinite(timestamp) ? ` <t:${timestamp}:R>` : '';
        return `Warning: ${action} failed${when}: ${failure.message}`;
      })
      .join('\n');

    return this.truncateEmbedFieldValue(
      `${value}\nCase record was still created so moderators can review and fix permissions.`
    );
  }

  private formatRoleQuarantineFieldValue(metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const roleQuarantine = (metadata as Record<string, unknown>).role_quarantine;
    if (!roleQuarantine || typeof roleQuarantine !== 'object' || Array.isArray(roleQuarantine)) {
      return null;
    }

    const lines: string[] = [];
    const restriction = (roleQuarantine as Record<string, unknown>).restriction;
    if (restriction && typeof restriction === 'object' && !Array.isArray(restriction)) {
      const record = restriction as Record<string, unknown>;
      const status = this.formatUnknownValue(record.status);
      const mode = this.formatUnknownValue(record.mode);
      const removedCount = this.formatUnknownValue(record.removed_role_count);
      const plannedCount = this.formatUnknownValue(record.planned_role_count);
      const skippedCount = this.formatUnknownValue(record.skipped_role_count);
      const failedCount = this.formatUnknownValue(record.failed_removal_count);
      lines.push(
        `Case role: ${status}${mode ? ` (${mode})` : ''}; removed ${removedCount || '0'} of ${plannedCount || '0'} planned role(s), skipped ${skippedCount || '0'}, failed ${failedCount || '0'}.`
      );
    }

    const restore = (roleQuarantine as Record<string, unknown>).restore;
    if (restore && typeof restore === 'object' && !Array.isArray(restore)) {
      const record = restore as Record<string, unknown>;
      const status = this.formatUnknownValue(record.status);
      const restoredCount = this.formatUnknownValue(record.restored_role_count);
      const attemptedCount = this.formatUnknownValue(record.attempted_role_count);
      const skippedCount = this.formatUnknownValue(record.skipped_role_count);
      const failedCount = this.formatUnknownValue(record.failed_restore_count);
      lines.push(
        `Restore: ${status}; restored ${restoredCount || '0'} of ${attemptedCount || '0'} role(s), skipped ${skippedCount || '0'}, failed ${failedCount || '0'}.`
      );
    }

    if (lines.length === 0) {
      return null;
    }

    return this.truncateEmbedFieldValue(lines.join('\n'));
  }

  private formatUnknownValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    return '';
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
    isFallback: boolean;
    analyzedMessageCount: number;
  }): string {
    if (analysis.isFallback) {
      return this.formatCompactEmbedFieldValue(['**Unavailable**', analysis.summary]);
    }

    const responseLabel = `${analysis.analyzedMessageCount} ${
      analysis.analyzedMessageCount === 1 ? 'response' : 'responses'
    } reviewed`;

    return this.formatCompactEmbedFieldValue(
      [
        `**${this.formatThreadAnalysisResult(analysis.result)}** (${this.formatConfidencePhrase(analysis.confidence)}, ${responseLabel})`,
        `**AI Assessment:** ${this.formatAiAuthoredInlineCode(analysis.summary)}`,
      ],
      [
        analysis.recommendedAction
          ? `**Suggested action:** ${this.formatThreadAnalysisAction(analysis.recommendedAction)}`
          : null,
      ]
    );
  }

  private formatAiAuthoredInlineCode(value: string): string {
    return `\`${value.replace(/`/g, "'")}\``;
  }

  private formatThreadAnalysisResult(
    result: 'likely_legitimate' | 'needs_review' | 'likely_suspicious'
  ): string {
    switch (result) {
      case 'likely_legitimate':
        return 'Likely legitimate';
      case 'needs_review':
        return 'Needs review';
      case 'likely_suspicious':
        return 'Likely suspicious';
    }
  }

  private formatThreadAnalysisAction(
    action: 'none' | 'ask_followup' | 'manual_review' | 'restrict'
  ): string {
    switch (action) {
      case 'none':
        return 'No action';
      case 'ask_followup':
        return 'Ask a follow-up';
      case 'manual_review':
        return 'Manual review';
      case 'restrict':
        return 'Restrict pending review';
    }
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

    if (analysis.isFallback) {
      return this.formatCompactEmbedFieldValue(['**Unavailable**', analysis.summary]);
    }

    return this.formatCompactEmbedFieldValue(
      [
        `**${this.formatReportAnalysisResult(analysis.result)}** (${this.formatConfidencePhrase(analysis.confidence)}${
          analysis.analyzedImageCount > 0
            ? `, ${analysis.analyzedImageCount} ${analysis.analyzedImageCount === 1 ? 'image' : 'images'} analyzed`
            : ''
        })`,
        `**AI Assessment:** ${this.formatAiAuthoredInlineCode(analysis.summary)}`,
      ],
      [`**Suggested action:** ${this.formatReportAnalysisAction(analysis.recommendedAction)}`]
    );
  }

  private formatReportAnalysisResult(result: ReportAIAnalysis['result']): string {
    switch (result) {
      case 'low_risk':
        return 'Low risk';
      case 'needs_review':
        return 'Needs review';
      case 'likely_abusive':
        return 'Likely abusive';
    }
  }

  private formatReportAnalysisAction(action: ReportAIAnalysis['recommendedAction']): string {
    switch (action) {
      case 'none':
        return 'No action';
      case 'monitor':
        return 'Monitor';
      case 'open_case':
        return 'Open a case';
      case 'manual_review':
        return 'Manual review';
    }
  }

  private formatGptDiagnosticFieldValue(detectionResult: DetectionResult): string | null {
    const analysis = detectionResult.gptAnalysis;
    if (!analysis) {
      return null;
    }

    if (analysis.isFallback) {
      return this.formatCompactEmbedFieldValue(['**Unavailable**', analysis.summary]);
    }

    return this.formatCompactEmbedFieldValue([
      `**${analysis.result === 'SUSPICIOUS' ? 'Suspicious' : 'No suspicious signal'}** (${this.formatConfidencePhrase(analysis.confidence)})`,
      `**AI Assessment:** ${this.formatAiAuthoredInlineCode(analysis.summary)}`,
    ]);
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
      case DetectionType.REJOIN_AFTER_KICK:
        return 'rejoin after kick';
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
      case DetectionType.HONEYPOT_ROLE:
        return 'honeypot role';
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
      verificationEvent.status === VerificationStatus.BANNED ||
      verificationEvent.status === VerificationStatus.KICKED ||
      verificationEvent.status === VerificationStatus.CLOSED_NO_ACTION
        ? `${verificationEvent.status}${
            verificationEvent.resolved_by
              ? ` by ${this.formatActorReference(verificationEvent.resolved_by)}`
              : ''
          }`
        : 'pending';

    if (verificationEvent.thread_id) {
      lines.push(
        `Verification/review thread: https://discord.com/channels/${member.guild.id}/${verificationEvent.thread_id} status: ${threadStatus}`
      );
    }

    if (verificationEvent.private_evidence_thread_id) {
      lines.push(
        `Admin evidence thread: https://discord.com/channels/${member.guild.id}/${verificationEvent.private_evidence_thread_id}`
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

    const reasonCodes = Array.isArray(latestAnalysis.reasonCodes)
      ? latestAnalysis.reasonCodes.filter((value): value is string => typeof value === 'string')
      : [];

    return {
      ...metadataRecord,
      latestAnalysis: {
        result,
        confidence: latestAnalysis.confidence,
        summary: latestAnalysis.summary,
        reasonCodes,
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
        isFallback:
          latestAnalysis.isFallback === true || reasonCodes.includes('ai_analysis_unavailable'),
        analyzedMessageCount: latestAnalysis.analyzedMessageCount,
      },
    };
  }

  private formatConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) {
      return 'High';
    }
    if (confidence >= 0.5) {
      return 'Medium';
    }
    return 'Low';
  }

  private formatSignalField(detectionResult: DetectionResult): {
    name: string;
    value: string;
    inline: true;
  } {
    if (detectionResult.triggerSource === DetectionType.USER_REPORT) {
      return { name: 'Report Signal', value: 'Reported by user', inline: true };
    }

    return {
      name: 'Detection Confidence',
      value: this.formatConfidenceLabel(detectionResult.confidence),
      inline: true,
    };
  }

  private formatDetectionSignalPhrase(event: DetectionEvent): string {
    if (event.detection_type === DetectionType.USER_REPORT) {
      return 'report signal';
    }

    return this.formatConfidencePhrase(event.confidence);
  }

  private formatConfidencePhrase(confidence: number): string {
    return `${this.formatConfidenceLabel(confidence)} confidence`;
  }
}
