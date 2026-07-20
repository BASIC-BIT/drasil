import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { HeuristicSettings, IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
import { IHeuristicService } from '../services/HeuristicService';
import { IProductAnalyticsService } from '../services/ProductAnalyticsService';
import {
  ANALYTICS_CONSENT_LEVELS,
  ANALYTICS_CONSENT_SETTING_KEY,
  getAnalyticsSettings,
  isAnalyticsConsentLevel,
} from '../utils/analyticsSettings';
import {
  CASE_RESPONDER_ROLE_IDS_SETTING_KEY,
  CASE_RESPONDER_ROUTING_MODE_SETTING_KEY,
  CASE_RESPONDER_ROUTING_MODES,
  CASE_RESPONDER_THREAD_MEMBER_CAP_SETTING_KEY,
  getCaseResponderSettings,
  isCaseResponderRoutingMode,
  normalizeCaseResponderRoleIds,
} from '../utils/caseResponderSettings';
import {
  CASE_REVIEW_REMINDER_REPEAT_HOURS_SETTING_KEY,
  CASE_REVIEW_REMINDER_STALE_HOURS_SETTING_KEY,
  CASE_REVIEW_REMINDERS_ENABLED_SETTING_KEY,
  CASE_REVIEW_VERY_STALE_DAYS_SETTING_KEY,
  getCaseReviewReminderSettings,
} from '../utils/caseReviewReminderSettings';
import {
  ADMIN_CASE_OPEN_REQUIRES_REASON_SETTING_KEY,
  AUTO_KICK_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY,
  AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY,
  DETECTION_RESPONSE_MODE_SETTING_KEY,
  DETECTION_RESPONSE_MODES,
  JOIN_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY,
  JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY,
  MESSAGE_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY,
  MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY,
  MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY,
  MODERATOR_BAN_ACTION_REQUIRES_REASON_SETTING_KEY,
  MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY,
  MODERATOR_KICK_ACTION_REQUIRES_REASON_SETTING_KEY,
  OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY,
  OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY,
  OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY,
  OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY,
  REPORT_INTAKE_AUTO_KICK_ENABLED_SETTING_KEY,
  getDetectionResponseSettings,
  isDetectionResponseMode,
} from '../utils/detectionResponseSettings';
import {
  getReportAiSettings,
  isReportAiMaxAction,
  REPORT_AI_ANALYZE_IMAGES_SETTING_KEY,
  REPORT_AI_ANALYZE_TEXT_SETTING_KEY,
  REPORT_AI_MAX_ACTIONS,
  REPORT_AI_MAX_ACTION_SETTING_KEY,
  REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY,
  REPORT_AI_MAX_IMAGES_SETTING_KEY,
  REPORT_AI_TRIAGE_ENABLED_SETTING_KEY,
} from '../utils/reportAiSettings';
import {
  getReportIntakeSettings,
  isReportIntakeConfirmedResponseMode,
  REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY,
  REPORT_INTAKE_CONFIRMED_RESPONSE_MODES,
} from '../utils/reportIntakeSettings';
import {
  getRoleQuarantineSettings,
  isRoleQuarantineMode,
  normalizeRoleQuarantineRoleIds,
  ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY,
  ROLE_QUARANTINE_MODE_SETTING_KEY,
  ROLE_QUARANTINE_MODES,
} from '../utils/roleQuarantineSettings';
import {
  getRoleGateSettings,
  HONEYPOT_ROLE_ID_SETTING_KEY,
  HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY,
  MEMBER_ACCESS_ROLE_ID_SETTING_KEY,
  ROLE_GATE_ENABLED_SETTING_KEY,
} from '../utils/roleGateSettings';
import {
  getModerationQueueSettings,
  MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY,
} from '../utils/moderationQueueSettings';
import {
  getManualIntakeSettings,
  MANUAL_INTAKE_ENABLED_SETTING_KEY,
  MANUAL_INTAKE_GRACE_PERIOD_SECONDS_SETTING_KEY,
  MANUAL_INTAKE_ROLE_ID_SETTING_KEY,
} from '../utils/manualIntakeSettings';
import { IModerationQueueService } from '../services/ModerationQueueService';
import {
  decodeExpectedTopicsInput,
  EXPECTED_TOPICS_SETTING_KEY,
  getServerContextSettings,
  hasServerContext,
  SERVER_ABOUT_SETTING_KEY,
  VERIFICATION_CONTEXT_SETTING_KEY,
} from '../utils/serverContextSettings';
import { truncatePreview } from '../utils/textPreview';
import {
  getUserReportSettings,
  isUserReportExternalResponseMode,
  USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY,
  USER_REPORT_EXTERNAL_RESPONSE_MODES,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../utils/userReportSettings';
import {
  decodeVerificationPromptTemplateInput,
  resolveVerificationPromptTemplate,
  VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY,
} from '../utils/verificationPromptTemplate';
import {
  getVerificationThreadAnalysisSettings,
  isVerificationAiMaxAction,
  VERIFICATION_AI_MAX_ACTIONS,
  VERIFICATION_AI_MAX_ACTION_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY,
} from '../utils/verificationThreadAnalysisSettings';

export class ConfigSubcommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly heuristicService: IHeuristicService,
    private readonly productAnalyticsService: IProductAnalyticsService,
    private readonly moderationQueueService?: IModerationQueueService
  ) {}

  private formatKeywordSummary(keywords: readonly string[]): string {
    if (keywords.length === 0) {
      return '(none configured)';
    }

    const preview = keywords
      .slice(0, 20)
      .map((keyword) => `\`${keyword}\``)
      .join(', ');
    if (keywords.length <= 20) {
      return preview;
    }

    return `${preview}, ... (+${keywords.length - 20} more)`;
  }

  private formatHeuristicSettings(settings: HeuristicSettings): string {
    const timeframeSeconds = settings.timeWindowMs / 1000;
    return [
      `Threshold: \`${settings.messageThreshold}\` messages`,
      `Timeframe: \`${timeframeSeconds}\` seconds`,
      `Keywords (${settings.suspiciousKeywords.length}): ${this.formatKeywordSummary(settings.suspiciousKeywords)}`,
    ].join('\n');
  }

  private formatDetectionResponseSettings(
    guildId: string,
    settings: ReturnType<typeof getDetectionResponseSettings>
  ): string {
    return [
      `Mode: \`${settings.mode}\``,
      `Message mode: \`${settings.messageMode}\``,
      `Join mode: \`${settings.joinMode}\``,
      `Moderator/admin exemption: \`${settings.automaticDetectionExemptModerators ? 'enabled' : 'disabled'}\``,
      `Observed notification channel: ${settings.observedNotificationChannelId ? `<#${settings.observedNotificationChannelId}>` : '`admin_channel_id` fallback'}`,
      `Observed notification threshold: \`${settings.observedMinConfidenceThreshold}%\``,
      `Observed notification window: \`${settings.observedNotificationWindowMinutes} minutes\``,
      `Case reason required: \`${settings.adminCaseOpenRequiresReason ? 'yes' : 'no'}\``,
      `Ban reason required: \`${settings.moderatorBanActionRequiresReason ? 'yes' : 'no'}\``,
      `Kick reason required: \`${settings.moderatorKickActionRequiresReason ? 'yes' : 'no'}\``,
      `Moderator ban action enabled: \`${settings.moderatorBanActionEnabled ? 'yes' : 'no'}\``,
      `Moderator kick action enabled: \`${settings.moderatorKickActionEnabled ? 'yes' : 'no'}\``,
      `Observed kick action enabled: \`${settings.observedActionKickEnabled ? 'yes' : 'no'}\``,
      `Message auto-kick: \`${settings.messageDetectionAutoKickEnabled ? 'enabled' : 'disabled'}\``,
      `Join auto-kick: \`${settings.joinDetectionAutoKickEnabled ? 'enabled' : 'disabled'}\``,
      `Report-intake auto-kick: \`${settings.reportIntakeAutoKickEnabled ? 'enabled' : 'disabled'}\``,
      `Auto-kick threshold: \`${settings.autoKickMinConfidenceThreshold}%\``,
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatReportIntakeSettings(settings: ReturnType<typeof getReportIntakeSettings>): string {
    return [`Confirmed report intake response: \`${settings.confirmedResponseMode}\``].join('\n');
  }

  private formatManualIntakeSettings(
    guildId: string,
    settings: ReturnType<typeof getManualIntakeSettings>
  ): string {
    return [
      `Status: \`${settings.enabled ? 'enabled' : 'disabled'}\``,
      `Trigger role: ${settings.roleId ? `<@&${settings.roleId}>` : '`none`'}`,
      `Grace period: \`${settings.gracePeriodSeconds} seconds\``,
      'Action: `open moderation case and apply case role`',
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatUserReportSettings(
    guildId: string,
    settings: ReturnType<typeof getUserReportSettings>
  ): string {
    return [
      `Report reason required: \`${settings.reasonRequired ? 'yes' : 'no'}\``,
      `External reports: \`${settings.externalResponseMode}\``,
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatAnalyticsSettings(
    guildId: string,
    settings: ReturnType<typeof getAnalyticsSettings>
  ): string {
    const runtimeStatus = this.productAnalyticsService.getStatus();
    const runtimeLine = runtimeStatus.configured
      ? `PostHog export: \`configured\` (${runtimeStatus.host}, environment: \`${runtimeStatus.environment ?? 'unknown'}\`)`
      : `PostHog export: \`inactive\` (${runtimeStatus.reason ?? 'not configured'})`;

    return [
      `Sharing level: \`${settings.consentLevel}\``,
      runtimeLine,
      'Anonymous shares hashed IDs and aggregate event properties only.',
      'Full may include raw Discord IDs for future cross-network verification features.',
      `Available levels: ${ANALYTICS_CONSENT_LEVELS.map((level) => `\`${level}\``).join(', ')}`,
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatCaseResponderSettings(
    guildId: string,
    settings: ReturnType<typeof getCaseResponderSettings>
  ): string {
    return [
      `Responder roles: ${settings.roleIds.length ? settings.roleIds.map((roleId) => `<@&${roleId}>`).join(', ') : '`none`'}`,
      `Routing mode: \`${settings.routingMode}\``,
      `Thread member cap: \`${settings.threadMemberCap}\``,
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatCaseQueueSettings(
    guildId: string,
    settings: ReturnType<typeof getModerationQueueSettings>
  ): string {
    return [
      `Queue channel: ${settings.channelId ? `<#${settings.channelId}>` : '`disabled`'}`,
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatRoleQuarantineSettings(
    guildId: string,
    settings: ReturnType<typeof getRoleQuarantineSettings>
  ): string {
    return [
      `Mode: \`${settings.mode}\``,
      `Exempt roles: ${settings.exemptRoleIds.length ? settings.exemptRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') : '`none`'}`,
      'On mode removes all removable non-exempt roles while applying the case role and restores them additively when the case resolves.',
      'Privileged, managed, bot-managed, and above-Drasil roles are always skipped.',
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  private formatRoleGateSettings(
    guildId: string,
    settings: ReturnType<typeof getRoleGateSettings>
  ): string {
    return [
      `Case review enabled: \`${settings.enabled ? 'yes' : 'no'}\``,
      `Honeypot role: ${settings.honeypotRoleId ? `<@&${settings.honeypotRoleId}>` : '`none`'}`,
      `Member access role: ${settings.memberAccessRoleId ? `<@&${settings.memberAccessRoleId}>` : '`none`'}`,
      `Honeypot response: \`${settings.honeypotResponseMode}\``,
      'Verify and close-no-action clean up configured role-gate roles as part of the confirmed action.',
      `Guild ID: \`${guildId}\``,
    ].join('\n');
  }

  public async handleRoleGateConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getRoleGateSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current role gate settings:\n\n' + this.formatRoleGateSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'enable':
        case 'disable': {
          const enabled = subcommand === 'enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [ROLE_GATE_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getRoleGateSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} role gate handling.\n\n` +
              this.formatRoleGateSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-honeypot-role':
        case 'set-member-access-role': {
          const role = interaction.options.getRole('role', true);
          const key =
            subcommand === 'set-honeypot-role'
              ? HONEYPOT_ROLE_ID_SETTING_KEY
              : MEMBER_ACCESS_ROLE_ID_SETTING_KEY;
          const updated = await this.configService.updateServerSettings(guildId, {
            [key]: role.id,
          });
          const settings = getRoleGateSettings(updated.settings);
          await interaction.reply({
            content:
              `Updated ${subcommand === 'set-honeypot-role' ? 'honeypot' : 'member access'} role to <@&${role.id}>.\n\n` +
              this.formatRoleGateSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'clear-honeypot-role':
        case 'clear-member-access-role': {
          const key =
            subcommand === 'clear-honeypot-role'
              ? HONEYPOT_ROLE_ID_SETTING_KEY
              : MEMBER_ACCESS_ROLE_ID_SETTING_KEY;
          const updated = await this.configService.updateServerSettings(guildId, {
            [key]: null,
          });
          const settings = getRoleGateSettings(updated.settings);
          await interaction.reply({
            content:
              `Cleared ${subcommand === 'clear-honeypot-role' ? 'honeypot' : 'member access'} role.\n\n` +
              this.formatRoleGateSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-honeypot-response': {
          const mode = interaction.options.getString('mode', true);
          if (!isDetectionResponseMode(mode)) {
            throw new Error(
              `Invalid honeypot response mode. Use one of: ${DETECTION_RESPONSE_MODES.join(', ')}`
            );
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY]: mode,
          });
          const settings = getRoleGateSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated honeypot role response mode.\n\n' +
              this.formatRoleGateSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported /config role-gate subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = {
        content: `Failed to process role gate settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
  }

  public async handleRoleQuarantineConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getRoleQuarantineSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current role quarantine settings:\n\n' +
              this.formatRoleQuarantineSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-mode': {
          const mode = interaction.options.getString('mode', true);
          if (!isRoleQuarantineMode(mode)) {
            await interaction.reply({
              content: `Unsupported role quarantine mode. Choose one of: ${ROLE_QUARANTINE_MODES.map((value) => `\`${value}\``).join(', ')}`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [ROLE_QUARANTINE_MODE_SETTING_KEY]: mode,
          });
          const settings = getRoleQuarantineSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated role quarantine mode.\n\n' +
              this.formatRoleQuarantineSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'exempt-add':
        case 'exempt-remove': {
          const role = interaction.options.getRole('role', true);
          const serverConfig = await this.configService.getServerConfig(guildId);
          const existingIds = new Set(
            normalizeRoleQuarantineRoleIds(
              serverConfig.settings[ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY]
            )
          );
          if (subcommand === 'exempt-add') {
            existingIds.add(role.id);
          } else {
            existingIds.delete(role.id);
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY]: [...existingIds],
          });
          const settings = getRoleQuarantineSettings(updated.settings);
          await interaction.reply({
            content:
              `Role <@&${role.id}> ${subcommand === 'exempt-add' ? 'added to' : 'removed from'} the role quarantine exemption list.\n\n` +
              this.formatRoleQuarantineSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported /config role-quarantine subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = {
        content: `Failed to process role quarantine settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
  }

  public async handleCaseQueueConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getModerationQueueSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current live moderation queue settings:\n\n' +
              this.formatCaseQueueSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-channel': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const channel = interaction.options.getChannel('channel', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: channel.id,
          });
          await this.moderationQueueService?.syncServerQueue(guildId);
          const settings = getModerationQueueSettings(updated.settings);
          await interaction.editReply({
            content:
              'Updated live moderation queue channel and synced current pending items.\n\n' +
              this.formatCaseQueueSettings(guildId, settings),
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'clear-channel': {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const deletedCount = (await this.moderationQueueService?.clearServerQueue(guildId)) ?? 0;
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY]: null,
          });
          const settings = getModerationQueueSettings(updated.settings);
          await interaction.editReply({
            content:
              `Disabled the live moderation queue and removed ${deletedCount} live queue message(s).\n\n` +
              this.formatCaseQueueSettings(guildId, settings),
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported /config case-queue subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      console.error(`Failed to update live moderation queue settings for guild ${guildId}:`, error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'Failed to update live moderation queue settings. Please try again later.',
        });
        return;
      }

      await interaction.reply({
        content: 'Failed to update live moderation queue settings. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private formatReportAiSettings(settings: ReturnType<typeof getReportAiSettings>): string {
    return [
      `Enabled: \`${settings.enabled ? 'yes' : 'no'}\``,
      `Analyze text: \`${settings.analyzeText ? 'yes' : 'no'}\``,
      `Analyze images: \`${settings.analyzeImages ? 'yes' : 'no'}\``,
      `Max recommended action: \`${settings.maxAction}\``,
      `Open-case threshold: \`${Math.round(settings.openCaseThreshold * 100)}%\``,
      `Max images: \`${settings.maxImages}\``,
      `Max image size: \`${Math.round(settings.maxImageBytes / (1024 * 1024))} MB\``,
    ].join('\n');
  }

  private formatVerificationPromptPreview(template: string): string {
    return truncatePreview(template, 1200);
  }

  private decodeOptionalMultilineInput(rawValue: string | null): string | undefined {
    if (rawValue === null) {
      return undefined;
    }

    const decoded = rawValue.replace(/\\n/g, '\n').trim();
    return decoded ? decoded : undefined;
  }

  private formatServerContextPreview(
    guildId: string,
    settings: ReturnType<typeof getServerContextSettings>
  ): string {
    if (!hasServerContext(settings)) {
      return `Guild ID: \`${guildId}\`\nNo server-specific AI context configured.`;
    }

    const lines: string[] = [];
    if (settings.serverAbout) {
      lines.push(this.formatMultilinePreviewField('Server description', settings.serverAbout));
    }
    if (settings.verificationContext) {
      lines.push(
        this.formatMultilinePreviewField('Legitimate member context', settings.verificationContext)
      );
    }
    if (settings.expectedTopics.length > 0) {
      lines.push(
        `Expected topics (${settings.expectedTopics.length}): ${settings.expectedTopics.map((topic) => `\`${topic}\``).join(', ')}`
      );
    }

    lines.push(`Guild ID: \`${guildId}\``);
    return truncatePreview(lines.join('\n'), 1800);
  }

  private formatMultilinePreviewField(label: string, value: string): string {
    const [firstLine, ...remainingLines] = value.split('\n');
    if (remainingLines.length === 0) {
      return `${label}: ${firstLine}`;
    }

    return [`${label}: ${firstLine}`, ...remainingLines.map((line) => `  ${line}`)].join('\n');
  }

  private truncatePreview(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    const overflow = value.length - maxLength;
    return `${value.slice(0, maxLength)}\n... (truncated ${overflow} characters)`;
  }

  private formatVerificationAnalysisSettings(
    settings: ReturnType<typeof getVerificationThreadAnalysisSettings>
  ): string {
    return [
      `Enabled: \`${settings.enabled ? 'yes' : 'no'}\``,
      `Message limit: \`${settings.messageLimit}\``,
      `Max recommended action: \`${settings.maxAction}\``,
      `Restrict threshold: \`${Math.round(settings.restrictThreshold * 100)}%\``,
    ].join('\n');
  }

  public async handleManualIntakeConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getManualIntakeSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current manual intake settings:\n\n' +
              this.formatManualIntakeSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-role': {
          const role = interaction.options.getRole('role', true);
          const serverConfig = await this.configService.getServerConfig(guildId);
          if (role.id === serverConfig.case_role_id) {
            await interaction.reply({
              content:
                'Manual intake needs a separate trigger role. Do not use the configured case role as the intake trigger.',
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [MANUAL_INTAKE_ROLE_ID_SETTING_KEY]: role.id,
            [MANUAL_INTAKE_ENABLED_SETTING_KEY]: true,
          });
          const settings = getManualIntakeSettings(updated.settings);
          await interaction.reply({
            content:
              `Set manual intake trigger role to <@&${role.id}> and enabled manual intake.\n\n` +
              this.formatManualIntakeSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'clear-role': {
          const updated = await this.configService.updateServerSettings(guildId, {
            [MANUAL_INTAKE_ROLE_ID_SETTING_KEY]: null,
            [MANUAL_INTAKE_ENABLED_SETTING_KEY]: false,
          });
          const settings = getManualIntakeSettings(updated.settings);
          await interaction.reply({
            content:
              'Cleared the manual intake trigger role and disabled manual intake.\n\n' +
              this.formatManualIntakeSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'enable':
        case 'disable': {
          const enabled = subcommand === 'enable';
          const serverConfig = await this.configService.getServerConfig(guildId);
          const currentSettings = getManualIntakeSettings(serverConfig.settings);
          if (enabled && !currentSettings.roleId) {
            await interaction.reply({
              content: 'Set a manual intake trigger role before enabling manual intake.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [MANUAL_INTAKE_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getManualIntakeSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} manual intake.\n\n` +
              this.formatManualIntakeSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-grace-period': {
          const seconds = interaction.options.getInteger('seconds', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [MANUAL_INTAKE_GRACE_PERIOD_SECONDS_SETTING_KEY]: seconds,
          });
          const settings = getManualIntakeSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated manual intake grace period.\n\n' +
              this.formatManualIntakeSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported /config manual-intake subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorResponse = {
        content: `Failed to process manual intake settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
  }

  public async handleDetectionConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getDetectionResponseSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current automatic detection response policy:\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-mode': {
          const mode = interaction.options.getString('mode', true);
          if (!isDetectionResponseMode(mode)) {
            await interaction.reply({
              content: `Unsupported detection response mode. Choose one of: ${DETECTION_RESPONSE_MODES.map((value) => `\`${value}\``).join(', ')}`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [DETECTION_RESPONSE_MODE_SETTING_KEY]: mode,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated automatic detection response policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-event-mode': {
          const event = interaction.options.getString('event', true);
          const mode = interaction.options.getString('mode', true);
          if (event !== 'message' && event !== 'join') {
            throw new Error('Invalid event. Use message or join.');
          }
          if (!isDetectionResponseMode(mode)) {
            await interaction.reply({
              content: `Unsupported detection response mode. Choose one of: ${DETECTION_RESPONSE_MODES.map((value) => `\`${value}\``).join(', ')}`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [event === 'message'
              ? MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY
              : JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY]: mode,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              `Updated ${event} detection response policy.\n\n` +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'clear-event-mode': {
          const event = interaction.options.getString('event', true);
          if (event !== 'message' && event !== 'join') {
            throw new Error('Invalid event. Use message or join.');
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [event === 'message'
              ? MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY
              : JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY]: null,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              `Reset ${event} detection response policy to default.\n\n` +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-notification-channel': {
          const channel = interaction.options.getChannel('channel', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY]: channel.id,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated observe-only notification channel.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'clear-notification-channel': {
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY]: null,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Reset observe-only notifications to use the admin channel.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-notification-threshold': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY]: value,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated observe-only notification threshold.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-notification-window': {
          const minutes = interaction.options.getInteger('minutes', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY]: minutes,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated observe-only notification window.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'moderator-exemption-enable':
        case 'moderator-exemption-disable': {
          const enabled = subcommand === 'moderator-exemption-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY]: enabled,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated automatic detection moderator/admin exemption.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'case-reason-require':
        case 'case-reason-optional': {
          const required = subcommand === 'case-reason-require';
          const updated = await this.configService.updateServerSettings(guildId, {
            [ADMIN_CASE_OPEN_REQUIRES_REASON_SETTING_KEY]: required,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated staff case-open reason policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'ban-reason-require':
        case 'ban-reason-optional': {
          const required = subcommand === 'ban-reason-require';
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATOR_BAN_ACTION_REQUIRES_REASON_SETTING_KEY]: required,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated staff ban reason policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'kick-reason-require':
        case 'kick-reason-optional': {
          const required = subcommand === 'kick-reason-require';
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATOR_KICK_ACTION_REQUIRES_REASON_SETTING_KEY]: required,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated staff kick reason policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'ban-action-enable':
        case 'ban-action-disable': {
          const enabled = subcommand === 'ban-action-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated moderator ban action policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'kick-action-enable':
        case 'kick-action-disable': {
          const enabled = subcommand === 'kick-action-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated moderator kick action policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'observed-kick-enable':
        case 'observed-kick-disable': {
          const enabled = subcommand === 'observed-kick-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated observed alert kick action policy.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'auto-kick-enable':
        case 'auto-kick-disable': {
          const enabled = subcommand === 'auto-kick-enable';
          const source = interaction.options.getString('source', true);
          const sourceSettingKey =
            source === 'message'
              ? MESSAGE_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY
              : source === 'join'
                ? JOIN_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY
                : source === 'report_intake'
                  ? REPORT_INTAKE_AUTO_KICK_ENABLED_SETTING_KEY
                  : null;

          if (!sourceSettingKey) {
            throw new Error('Invalid auto-kick source. Use message, join, or report_intake.');
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [sourceSettingKey]: enabled,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              `Updated ${source.replace('_', '-')} auto-kick policy.\n\n` +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-auto-kick-threshold': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [AUTO_KICK_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY]: value,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated auto-kick confidence threshold.\n\n' +
              this.formatDetectionResponseSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported detection subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing detection settings.';
      await interaction.reply({
        content: `Failed to process detection settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  public async handleCaseStaffConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getCaseResponderSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current case responder settings:\n\n' +
              this.formatCaseResponderSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'add-role':
        case 'remove-role': {
          const role = interaction.options.getRole('role', true);
          const serverConfig = await this.configService.getServerConfig(guildId);
          const currentRoleIds = normalizeCaseResponderRoleIds(
            serverConfig.settings[CASE_RESPONDER_ROLE_IDS_SETTING_KEY]
          );
          const nextRoleIds =
            subcommand === 'add-role'
              ? Array.from(new Set([...currentRoleIds, role.id]))
              : currentRoleIds.filter((roleId) => roleId !== role.id);

          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_RESPONDER_ROLE_IDS_SETTING_KEY]: nextRoleIds,
          });
          const settings = getCaseResponderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated case responder roles.\n\n' +
              this.formatCaseResponderSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-routing': {
          const mode = interaction.options.getString('mode', true);
          if (!isCaseResponderRoutingMode(mode)) {
            throw new Error(
              `Invalid routing mode. Use one of: ${CASE_RESPONDER_ROUTING_MODES.join(', ')}`
            );
          }

          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_RESPONDER_ROUTING_MODE_SETTING_KEY]: mode,
          });
          const settings = getCaseResponderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated case responder routing.\n\n' +
              this.formatCaseResponderSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-member-cap': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_RESPONDER_THREAD_MEMBER_CAP_SETTING_KEY]: value,
          });
          const settings = getCaseResponderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated case responder thread member cap.\n\n' +
              this.formatCaseResponderSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported case-staff subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing case staff settings.';
      await interaction.reply({
        content: `Failed to process case staff settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  public async handleCaseReviewConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getCaseReviewReminderSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current case review and admin reminder settings:\n\n' +
              this.formatCaseReviewReminderSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'enable':
        case 'disable': {
          const enabled = subcommand === 'enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_REVIEW_REMINDERS_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getCaseReviewReminderSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} stale case review reminders.\n\n` +
              this.formatCaseReviewReminderSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-stale-hours': {
          const hours = interaction.options.getInteger('hours', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_REVIEW_REMINDER_STALE_HOURS_SETTING_KEY]: hours,
          });
          const settings = getCaseReviewReminderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated stale case reminder threshold.\n\n' +
              this.formatCaseReviewReminderSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-repeat-hours': {
          const hours = interaction.options.getInteger('hours', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_REVIEW_REMINDER_REPEAT_HOURS_SETTING_KEY]: hours,
          });
          const settings = getCaseReviewReminderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated shared admin reminder repeat interval.\n\n' +
              this.formatCaseReviewReminderSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-very-stale-days': {
          const days = interaction.options.getInteger('days', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [CASE_REVIEW_VERY_STALE_DAYS_SETTING_KEY]: days,
          });
          const settings = getCaseReviewReminderSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated very stale case threshold.\n\n' +
              this.formatCaseReviewReminderSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported case-review subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing case review settings.';
      await interaction.reply({
        content: `Failed to process case review settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private formatCaseReviewReminderSettings(
    settings: ReturnType<typeof getCaseReviewReminderSettings>
  ): string {
    return [
      `Enabled: \`${settings.enabled ? 'yes' : 'no'}\``,
      `Stale threshold: \`${settings.staleHours}h\``,
      `Admin reminder repeat interval: \`${settings.repeatHours}h\``,
      `Very stale threshold: \`${settings.veryStaleDays}d\``,
      'Admin reminder batches post to the admin channel, mention configured case responder roles, and may include long-pending membership screening.',
      'Case review and pending-screening alerts remain independently enabled.',
      'User-facing support reminders post every 24h until the very-stale threshold.',
    ].join('\n');
  }

  public async handleReportConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getUserReportSettings(serverConfig.settings);
          const intakeSettings = getReportIntakeSettings(serverConfig.settings);
          const aiSettings = getReportAiSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current user report settings:\n\n' +
              this.formatUserReportSettings(guildId, settings) +
              '\n\nReport intake:\n' +
              this.formatReportIntakeSettings(intakeSettings) +
              '\n\nAI report triage:\n' +
              this.formatReportAiSettings(aiSettings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'reason-require':
        case 'reason-optional': {
          const required = subcommand === 'reason-require';
          const updated = await this.configService.updateServerSettings(guildId, {
            [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: required,
          });
          const settings = getUserReportSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated user report settings.\n\n' +
              this.formatUserReportSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'external-reports': {
          const mode = interaction.options.getString('mode', true);
          if (!isUserReportExternalResponseMode(mode)) {
            throw new Error(
              `Invalid external report mode. Use one of: ${USER_REPORT_EXTERNAL_RESPONSE_MODES.join(', ')}`
            );
          }
          const updated = await this.configService.updateServerSettings(guildId, {
            [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: mode,
          });
          const settings = getUserReportSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated user report settings.\n\n' +
              this.formatUserReportSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'intake-confirmed-response': {
          const mode = interaction.options.getString('mode', true);
          if (!isReportIntakeConfirmedResponseMode(mode)) {
            throw new Error(
              `Invalid report intake response mode. Use one of: ${REPORT_INTAKE_CONFIRMED_RESPONSE_MODES.join(', ')}`
            );
          }
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY]: mode,
          });
          const settings = getReportIntakeSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated report intake response settings.\n\n' +
              this.formatReportIntakeSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getReportAiSettings(serverConfig.settings);
          await interaction.reply({
            content: 'AI report triage settings:\n\n' + this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-enable':
        case 'ai-disable': {
          const enabled = subcommand === 'ai-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_TRIAGE_ENABLED_SETTING_KEY]: enabled,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} AI report triage.\n\n` +
              this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-text-enable':
        case 'ai-text-disable': {
          const enabled = subcommand === 'ai-text-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_ANALYZE_TEXT_SETTING_KEY]: enabled,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} AI report text analysis.\n\n` +
              this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-images-enable':
        case 'ai-images-disable': {
          const enabled = subcommand === 'ai-images-enable';
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_ANALYZE_IMAGES_SETTING_KEY]: enabled,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              `${enabled ? 'Enabled' : 'Disabled'} AI report image analysis.\n\n` +
              this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-set-max-action': {
          const action = interaction.options.getString('action', true);
          if (!isReportAiMaxAction(action)) {
            throw new Error(
              `Invalid AI report max action. Use one of: ${REPORT_AI_MAX_ACTIONS.join(', ')}`
            );
          }
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_MAX_ACTION_SETTING_KEY]: action,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated AI report triage max action.\n\n' + this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-set-max-images': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_MAX_IMAGES_SETTING_KEY]: value,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated AI report triage max images.\n\n' + this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'ai-set-max-image-mb': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY]: value * 1024 * 1024,
          });
          const settings = getReportAiSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated AI report triage max image size.\n\n' +
              this.formatReportAiSettings(settings),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported report subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing report settings.';
      await interaction.reply({
        content: `Failed to process report settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  public async handleAnalyticsConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getAnalyticsSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current product analytics sharing settings:\n\n' +
              this.formatAnalyticsSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'set-level': {
          const level = interaction.options.getString('level', true);
          if (!isAnalyticsConsentLevel(level)) {
            throw new Error(
              `Invalid analytics sharing level. Use one of: ${ANALYTICS_CONSENT_LEVELS.join(', ')}`
            );
          }

          if (level === 'full' && interaction.guild?.ownerId !== interaction.user.id) {
            await interaction.reply({
              content:
                'Only the server owner can enable full analytics sharing because it may include raw Discord IDs.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const currentConfig = await this.configService.getServerConfig(guildId);
          const previousSettings = getAnalyticsSettings(currentConfig.settings);
          const updated = await this.configService.updateServerSettings(guildId, {
            [ANALYTICS_CONSENT_SETTING_KEY]: level,
          });
          const settings = getAnalyticsSettings(updated.settings);

          if (settings.consentLevel !== 'off') {
            void this.productAnalyticsService.captureGuildEvent(
              guildId,
              'analytics consent updated',
              {
                previous_consent_level: previousSettings.consentLevel,
                new_consent_level: settings.consentLevel,
              },
              { moderatorId: interaction.user.id }
            );
          }

          await interaction.reply({
            content:
              'Updated product analytics sharing settings.\n\n' +
              this.formatAnalyticsSettings(guildId, settings),
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported analytics subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing analytics settings.';
      const errorResponse = {
        content: `Failed to process analytics settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      } as const;

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorResponse);
        } else {
          await interaction.reply(errorResponse);
        }
      } catch (replyError) {
        console.warn('Failed to send analytics settings error response:', replyError);
      }
    }
  }

  public async handleVerificationConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'prompt-view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const configuredTemplate =
            serverConfig.settings[VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY];
          const activeTemplate = resolveVerificationPromptTemplate(configuredTemplate);
          const sourceLabel = configuredTemplate?.trim() ? 'custom' : 'default';

          await interaction.reply({
            content:
              `Verification prompt template (${sourceLabel}):\n\n` +
              `${this.formatVerificationPromptPreview(activeTemplate)}\n\n` +
              'Placeholders: `{user_mention}`, `{server_name}`',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'prompt-set': {
          const rawTemplate = interaction.options.getString('template', true);
          const template = decodeVerificationPromptTemplateInput(rawTemplate);

          if (!template) {
            await interaction.reply({
              content: 'Template cannot be empty.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          await this.configService.updateServerSettings(guildId, {
            verification_prompt_template: template,
          });

          await interaction.reply({
            content:
              '✅ Updated verification prompt template. ' +
              'Use `{user_mention}` and `{server_name}` placeholders as needed. ' +
              'Run `/config verification prompt-view` to preview the active template.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'prompt-reset': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const updatedSettings = { ...serverConfig.settings };
          delete updatedSettings.verification_prompt_template;

          await this.configService.updateServerConfig(guildId, {
            settings: updatedSettings,
          });

          await interaction.reply({
            content:
              '✅ Reset verification prompt template to default. ' +
              'Run `/config verification prompt-view` to preview it.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'context-view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const contextSettings = getServerContextSettings(serverConfig.settings);

          await interaction.reply({
            content:
              'Current AI server context:\n\n' +
              `${this.formatServerContextPreview(guildId, contextSettings)}`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'context-set': {
          const serverAbout = this.decodeOptionalMultilineInput(
            interaction.options.getString('server-about')
          );
          const verificationContext = this.decodeOptionalMultilineInput(
            interaction.options.getString('verification-context')
          );
          const expectedTopicsInput = interaction.options.getString('expected-topics');

          const updates: {
            server_about?: string;
            verification_context?: string;
            expected_topics?: string[];
          } = {};
          if (serverAbout !== undefined) {
            updates[SERVER_ABOUT_SETTING_KEY] = serverAbout;
          }
          if (verificationContext !== undefined) {
            updates[VERIFICATION_CONTEXT_SETTING_KEY] = verificationContext;
          }
          if (expectedTopicsInput !== null) {
            const expectedTopics = decodeExpectedTopicsInput(expectedTopicsInput);
            if (expectedTopics.length > 0) {
              updates[EXPECTED_TOPICS_SETTING_KEY] = expectedTopics;
            }
          }

          if (Object.keys(updates).length === 0) {
            await interaction.reply({
              content: 'Provide at least one server context field to update.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const updated = await this.configService.updateServerSettings(guildId, updates);
          const contextSettings = getServerContextSettings(updated.settings);

          await interaction.reply({
            content:
              '✅ Updated AI server context.\n\n' +
              `${this.formatServerContextPreview(guildId, contextSettings)}`,
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          });
          return;
        }

        case 'context-reset': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const updatedSettings = { ...serverConfig.settings };
          delete updatedSettings[SERVER_ABOUT_SETTING_KEY];
          delete updatedSettings[VERIFICATION_CONTEXT_SETTING_KEY];
          delete updatedSettings[EXPECTED_TOPICS_SETTING_KEY];

          await this.configService.updateServerConfig(guildId, {
            settings: updatedSettings,
          });

          await interaction.reply({
            content: '✅ Reset AI server context to defaults.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'analysis-view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const analysisSettings = getVerificationThreadAnalysisSettings(serverConfig.settings);

          await interaction.reply({
            content:
              'Verification reply AI analysis settings:\n\n' +
              `${this.formatVerificationAnalysisSettings(analysisSettings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'analysis-enable': {
          const updated = await this.configService.updateServerSettings(guildId, {
            [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: true,
          });
          const analysisSettings = getVerificationThreadAnalysisSettings(updated.settings);

          await interaction.reply({
            content:
              '✅ Enabled verification reply AI analysis.\n\n' +
              `${this.formatVerificationAnalysisSettings(analysisSettings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'analysis-disable': {
          const updated = await this.configService.updateServerSettings(guildId, {
            [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: false,
          });
          const analysisSettings = getVerificationThreadAnalysisSettings(updated.settings);

          await interaction.reply({
            content:
              '✅ Disabled verification reply AI analysis.\n\n' +
              `${this.formatVerificationAnalysisSettings(analysisSettings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'analysis-set-limit': {
          const value = interaction.options.getInteger('value', true);
          const updated = await this.configService.updateServerSettings(guildId, {
            [VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY]: value,
          });
          const analysisSettings = getVerificationThreadAnalysisSettings(updated.settings);

          await interaction.reply({
            content:
              '✅ Updated verification reply AI analysis message limit.\n\n' +
              `${this.formatVerificationAnalysisSettings(analysisSettings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'analysis-set-max-action': {
          const action = interaction.options.getString('action', true);
          if (!isVerificationAiMaxAction(action)) {
            throw new Error(
              `Invalid verification AI max action. Use one of: ${VERIFICATION_AI_MAX_ACTIONS.join(', ')}`
            );
          }
          const updated = await this.configService.updateServerSettings(guildId, {
            [VERIFICATION_AI_MAX_ACTION_SETTING_KEY]: action,
          });
          const analysisSettings = getVerificationThreadAnalysisSettings(updated.settings);

          await interaction.reply({
            content:
              '✅ Updated verification reply AI max action.\n\n' +
              `${this.formatVerificationAnalysisSettings(analysisSettings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported verification subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while processing verification settings.';
      await interaction.reply({
        content: `Failed to process verification settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  public async handleHeuristicConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const settings = await this.configService.getHeuristicSettings(guildId);
          await interaction.reply({
            content: `Current heuristic settings:\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-threshold': {
          const value = interaction.options.getInteger('value', true);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            messageThreshold: value,
          });
          await interaction.reply({
            content: `✅ Updated heuristic threshold.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-timeframe': {
          const value = interaction.options.getInteger('value', true);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            timeframeSeconds: value,
          });
          await interaction.reply({
            content: `✅ Updated heuristic timeframe.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-list': {
          const settings = await this.configService.getHeuristicSettings(guildId);
          await interaction.reply({
            content: `Suspicious keywords (${settings.suspiciousKeywords.length}): ${this.formatKeywordSummary(
              settings.suspiciousKeywords
            )}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-add': {
          const keyword = interaction.options.getString('keyword', true).trim();
          if (!keyword) {
            await interaction.reply({
              content: 'Keyword cannot be empty.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const current = await this.configService.getHeuristicSettings(guildId);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: [...current.suspiciousKeywords, keyword],
          });
          await interaction.reply({
            content: `✅ Added suspicious keyword.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-remove': {
          const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
          if (!keyword) {
            await interaction.reply({
              content: 'Keyword cannot be empty.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const current = await this.configService.getHeuristicSettings(guildId);
          const remaining = current.suspiciousKeywords.filter((existing) => existing !== keyword);

          if (remaining.length === current.suspiciousKeywords.length) {
            await interaction.reply({
              content: `Keyword \`${keyword}\` is not in the configured list.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: remaining,
          });
          await interaction.reply({
            content: `✅ Removed suspicious keyword.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-reset': {
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: [...globalConfig.getSettings().defaultSuspiciousKeywords],
          });
          await interaction.reply({
            content: `✅ Reset suspicious keywords to defaults.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'reset': {
          const settings = await this.configService.resetHeuristicSettings(guildId);
          await interaction.reply({
            content: `✅ Reset all heuristic settings to defaults.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported heuristic subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while updating heuristic settings.';
      await interaction.reply({
        content: `Failed to update heuristic settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
