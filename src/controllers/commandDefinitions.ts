import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  RESTPostAPIApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from 'discord.js';
import { MAX_CASE_RESPONDER_THREAD_MEMBER_CAP } from '../utils/caseResponderSettings';
import {
  MAX_CASE_REVIEW_REMINDER_HOURS,
  MIN_CASE_REVIEW_REMINDER_HOURS,
} from '../utils/caseReviewReminderSettings';
import { MAX_REPORT_AI_MAX_IMAGE_BYTES, MAX_REPORT_AI_MAX_IMAGES } from '../utils/reportAiSettings';
import { USER_REPORT_REASON_MAX_LENGTH } from '../utils/userReportSettings';
import { MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT } from '../utils/verificationThreadAnalysisSettings';

export const REPORT_USER_CONTEXT_COMMAND_NAME = 'Report User';
export const REPORT_MESSAGE_CONTEXT_COMMAND_NAME = 'Report Message';

export interface BuildApplicationCommandsOptions {
  userInstallReportingEnabled: boolean;
}

const baseApplicationCommandBuilders = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to ban').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the ban').setRequired(false)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report a user to moderators')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to report').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('What happened?')
        .setRequired(false)
        .setMaxLength(USER_REPORT_REASON_MAX_LENGTH)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('setupverification')
    .setDescription('Set up a dedicated verification channel for restricted users')
    .addRoleOption((option) =>
      option
        .setName('restricted-role')
        .setDescription('Role to apply while a user is restricted')
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('admin-channel')
        .setDescription('Moderator-only channel for Drasil alerts')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('verification-channel')
        .setDescription('Channel where verification threads are created; omit to auto-create')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure server settings')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('validate')
        .setDescription('Check Drasil setup, permissions, channels, and role hierarchy')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('setup')
        .setDescription('Configure required Drasil channels and restricted role')
        .addChannelOption((option) =>
          option
            .setName('admin-channel')
            .setDescription('Moderator-only channel for Drasil alerts')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option
            .setName('restricted-role')
            .setDescription('Existing restricted role; omit to reuse or create a default one')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('restricted-role-name')
            .setDescription('Role name to reuse or create when restricted-role is omitted')
            .setRequired(false)
            .setMaxLength(100)
        )
        .addChannelOption((option) =>
          option
            .setName('verification-channel')
            .setDescription('Existing verification channel; omit to reuse/create #verification')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
        .addChannelOption((option) =>
          option
            .setName('report-channel')
            .setDescription('Optional channel for Drasil report instructions')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Update a general server configuration value')
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('The configuration key to update')
            .setRequired(true)
            .addChoices(
              { name: 'Restricted Role ID', value: 'restricted_role_id' },
              { name: 'Admin Channel ID', value: 'admin_channel_id' },
              { name: 'Verification Channel ID', value: 'verification_channel_id' },
              { name: 'Admin Notification Role ID', value: 'admin_notification_role_id' }
            )
        )
        .addStringOption((option) =>
          option.setName('value').setDescription('The value to set').setRequired(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('lockdown')
        .setDescription('Audit or apply restricted-role quarantine channel overwrites')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View restricted-role lockdown settings')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('audit').setDescription('Preview restricted-role lockdown changes')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('apply')
            .setDescription('Apply missing restricted-role lockdown denies')
            .addBooleanOption((option) =>
              option
                .setName('unsync-allowed')
                .setDescription('Unsync allowed channels that are synced under denied categories')
                .setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('disable')
            .setDescription('Mark lockdown disabled without removing existing overwrites')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('allow-add')
            .setDescription('Exclude a channel or category from restricted-role lockdown')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel or category restricted users may still access')
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                  ChannelType.GuildCategory,
                  ChannelType.GuildVoice,
                  ChannelType.GuildStageVoice,
                  ChannelType.GuildForum,
                  ChannelType.GuildMedia
                )
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('allow-remove')
            .setDescription('Remove a channel or category from the lockdown allow-list')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel or category to remove from the allow-list')
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement,
                  ChannelType.GuildCategory,
                  ChannelType.GuildVoice,
                  ChannelType.GuildStageVoice,
                  ChannelType.GuildForum,
                  ChannelType.GuildMedia
                )
                .setRequired(true)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('heuristic')
        .setDescription('Manage heuristic detection settings')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View the current heuristic configuration')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-threshold')
            .setDescription('Set the message threshold for frequency detection')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription('Messages allowed in the configured timeframe (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-timeframe')
            .setDescription('Set the timeframe in seconds for frequency detection')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription('Timeframe in seconds (1-600)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(600)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('keywords-list').setDescription('List configured suspicious keywords')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('keywords-add')
            .setDescription('Add a suspicious keyword')
            .addStringOption((option) =>
              option.setName('keyword').setDescription('Keyword or phrase to add').setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('keywords-remove')
            .setDescription('Remove a suspicious keyword')
            .addStringOption((option) =>
              option
                .setName('keyword')
                .setDescription('Keyword or phrase to remove')
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('keywords-reset')
            .setDescription('Reset suspicious keywords to defaults')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('reset').setDescription('Reset all heuristic settings to defaults')
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('detection')
        .setDescription('Manage automatic detection response policy')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View the current detection response policy')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-mode')
            .setDescription('Set how automatic detections are handled')
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('off, record_only, notify_only, open_case, or restrict')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Record only', value: 'record_only' },
                  { name: 'Notify only', value: 'notify_only' },
                  { name: 'Open case', value: 'open_case' },
                  { name: 'Restrict pending review', value: 'restrict' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-event-mode')
            .setDescription('Override detection response for message or join events')
            .addStringOption((option) =>
              option
                .setName('event')
                .setDescription('Event type to override')
                .setRequired(true)
                .addChoices(
                  { name: 'Message send', value: 'message' },
                  { name: 'Server join', value: 'join' }
                )
            )
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('off, record_only, notify_only, open_case, or restrict')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Record only', value: 'record_only' },
                  { name: 'Notify only', value: 'notify_only' },
                  { name: 'Open case', value: 'open_case' },
                  { name: 'Restrict pending review', value: 'restrict' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('clear-event-mode')
            .setDescription('Use the default detection response for message or join events')
            .addStringOption((option) =>
              option
                .setName('event')
                .setDescription('Event type to reset')
                .setRequired(true)
                .addChoices(
                  { name: 'Message send', value: 'message' },
                  { name: 'Server join', value: 'join' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-notification-channel')
            .setDescription('Set the observe-only notification channel')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('Channel for notify-only detection alerts')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('clear-notification-channel')
            .setDescription('Use the admin channel for observe-only detection alerts')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-notification-threshold')
            .setDescription('Set minimum confidence for observe-only notifications')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription('Minimum confidence percentage (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-notification-window')
            .setDescription('Set how long repeated detections update one alert')
            .addIntegerOption((option) =>
              option
                .setName('minutes')
                .setDescription('Notification coalescing window in minutes (1-1440)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1440)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('moderator-exemption-enable')
            .setDescription('Skip automatic detection for members with moderation permissions')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('moderator-exemption-disable')
            .setDescription(
              'Allow automatic detection scans for members with moderation permissions'
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ban-reason-require')
            .setDescription('Require a reason when banning from observed notifications')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ban-reason-optional')
            .setDescription('Allow the default reason when banning from observed notifications')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ban-action-enable')
            .setDescription('Show and allow Drasil moderator ban actions')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ban-action-disable')
            .setDescription('Hide and block Drasil moderator ban actions')
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('case-staff')
        .setDescription('Manage case responder staff routing')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View case responder role settings')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('add-role')
            .setDescription('Add a case responder role')
            .addRoleOption((option) =>
              option.setName('role').setDescription('Role to notify for cases').setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('remove-role')
            .setDescription('Remove a case responder role')
            .addRoleOption((option) =>
              option
                .setName('role')
                .setDescription('Role to remove from case notifications')
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-routing')
            .setDescription('Set case responder routing mode')
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('off, ping_only, or ping_and_add_members')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Ping only', value: 'ping_only' },
                  { name: 'Ping and add members', value: 'ping_and_add_members' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-member-cap')
            .setDescription('Set max staff members added to a private case thread')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription('Max members to add per responder role')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_CASE_RESPONDER_THREAD_MEMBER_CAP)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('case-review')
        .setDescription('Manage stale case review reminders')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View stale case review reminder settings')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('enable').setDescription('Enable stale case review reminders')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('disable').setDescription('Disable stale case review reminders')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-stale-hours')
            .setDescription('Set how old a pending case must be before reminder')
            .addIntegerOption((option) =>
              option
                .setName('hours')
                .setDescription('Hours before a pending case is stale')
                .setRequired(true)
                .setMinValue(MIN_CASE_REVIEW_REMINDER_HOURS)
                .setMaxValue(MAX_CASE_REVIEW_REMINDER_HOURS)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-repeat-hours')
            .setDescription('Set minimum hours between repeated stale reminders')
            .addIntegerOption((option) =>
              option
                .setName('hours')
                .setDescription('Hours between repeat reminders')
                .setRequired(true)
                .setMinValue(MIN_CASE_REVIEW_REMINDER_HOURS)
                .setMaxValue(MAX_CASE_REVIEW_REMINDER_HOURS)
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('report')
        .setDescription('Manage user report settings')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View user report settings')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('reason-require').setDescription('Require a reason for user reports')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('reason-optional')
            .setDescription('Allow user reports without a reason')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('external-reports')
            .setDescription('Set how reports from user-installed DMs/GDMs are handled')
            .addStringOption((option) =>
              option
                .setName('mode')
                .setDescription('off, notify_only, or open_case')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Notify only', value: 'notify_only' },
                  { name: 'Open case', value: 'open_case' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-view').setDescription('View AI report triage settings')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-enable').setDescription('Enable AI report triage')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-disable').setDescription('Disable AI report triage')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-text-enable').setDescription('Analyze report/message text')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-text-disable').setDescription('Do not analyze report text')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-images-enable').setDescription('Analyze eligible image evidence')
        )
        .addSubcommand((subcommand) =>
          subcommand.setName('ai-images-disable').setDescription('Do not analyze image evidence')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ai-set-max-action')
            .setDescription('Set the maximum AI report triage recommendation')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('off, hints, open_case, or restrict')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Hints only', value: 'hints' },
                  { name: 'Recommend open case', value: 'open_case' },
                  { name: 'Recommend restriction review', value: 'restrict' }
                )
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ai-set-max-images')
            .setDescription('Set how many report images AI may analyze')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription(`Number of images (0-${MAX_REPORT_AI_MAX_IMAGES})`)
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(MAX_REPORT_AI_MAX_IMAGES)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('ai-set-max-image-mb')
            .setDescription('Set max size per report image AI may analyze')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription(
                  `Megabytes per image (1-${MAX_REPORT_AI_MAX_IMAGE_BYTES / (1024 * 1024)})`
                )
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_REPORT_AI_MAX_IMAGE_BYTES / (1024 * 1024))
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('analytics')
        .setDescription('Manage Drasil product analytics sharing')
        .addSubcommand((subcommand) =>
          subcommand.setName('view').setDescription('View product analytics sharing settings')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set-level')
            .setDescription('Choose what this server shares with Drasil maintainers')
            .addStringOption((option) =>
              option
                .setName('level')
                .setDescription('off, anonymous, or full')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Anonymous statistics', value: 'anonymous' },
                  { name: 'Full statistics', value: 'full' }
                )
            )
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName('verification')
        .setDescription('Manage verification prompt and AI context settings')
        .addSubcommand((subcommand) =>
          subcommand.setName('prompt-view').setDescription('View the current verification prompt')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('prompt-set')
            .setDescription('Set a custom verification prompt template')
            .addStringOption((option) =>
              option
                .setName('template')
                .setDescription('Use {user_mention} and {server_name}. Use \\n for line breaks.')
                .setRequired(true)
                .setMaxLength(1500)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('prompt-reset')
            .setDescription('Reset verification prompt to the default template')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('context-view')
            .setDescription('View the current server context used for AI analysis')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('context-set')
            .setDescription('Set server context used for AI analysis')
            .addStringOption((option) =>
              option
                .setName('server-about')
                .setDescription('Short description of the server or community purpose')
                .setRequired(false)
                .setMaxLength(500)
            )
            .addStringOption((option) =>
              option
                .setName('verification-context')
                .setDescription('What legitimate members would typically know or mention')
                .setRequired(false)
                .setMaxLength(1000)
            )
            .addStringOption((option) =>
              option
                .setName('expected-topics')
                .setDescription('Expected topics, links, or keywords; separate with commas or \\n')
                .setRequired(false)
                .setMaxLength(1000)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('context-reset')
            .setDescription('Reset AI analysis server context to defaults')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('analysis-view')
            .setDescription('View verification thread AI analysis settings')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('analysis-enable')
            .setDescription('Enable AI analysis for flagged-user verification replies')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('analysis-disable')
            .setDescription('Disable AI analysis for verification replies')
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('analysis-set-limit')
            .setDescription('Set how many flagged-user verification replies to analyze')
            .addIntegerOption((option) =>
              option
                .setName('value')
                .setDescription('Number of replies to analyze (1-10)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('analysis-set-max-action')
            .setDescription('Set the maximum verification reply AI recommendation')
            .addStringOption((option) =>
              option
                .setName('action')
                .setDescription('off, hints, or restrict')
                .setRequired(true)
                .addChoices(
                  { name: 'Off', value: 'off' },
                  { name: 'Hints only', value: 'hints' },
                  { name: 'Recommend restriction review', value: 'restrict' }
                )
            )
        )
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Audit detection accounting')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ignore-detection')
        .setDescription('Exclude a detection event from future suspicion accounting')
        .addStringOption((option) =>
          option
            .setName('detection-id')
            .setDescription('Detection event ID from the history export')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why this detection should not count')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('restore-detection')
        .setDescription('Restore a detection event to future suspicion accounting')
        .addStringOption((option) =>
          option
            .setName('detection-id')
            .setDescription('Detection event ID from the history export')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why this detection should count again')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('flaguser')
    .setDescription('Manually flag a user as suspicious and start verification.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to flag').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Optional reason for flagging').setRequired(false)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('case')
    .setDescription('Open moderation cases or bulk-intake restricted users')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('open')
        .setDescription('Open a moderation case without restricting the user')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to review').setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why moderators should review this user')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('restrict')
        .setDescription('Open a moderation case and restrict the user pending review')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to restrict and review').setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why moderators should review this user')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('repair')
        .setDescription('Repair an active user-facing verification case thread')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('The user whose active case to repair')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('intake-role')
        .setDescription('Preview or open cases for members currently in a role')
        .addRoleOption((option) =>
          option
            .setName('role')
            .setDescription('Role to intake; defaults to the configured restricted role')
            .setRequired(false)
        )
        .addBooleanOption((option) =>
          option
            .setName('execute')
            .setDescription('Actually open cases; defaults to false for dry-run preview')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('action')
            .setDescription('Whether to open cases only or restrict users too')
            .setRequired(false)
            .addChoices(
              { name: 'Open cases only', value: 'open_case' },
              { name: 'Restrict pending review', value: 'restrict' }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('Maximum members to intake in this batch, up to 250')
            .setMinValue(1)
            .setMaxValue(250)
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Reason to attach to each intake case')
            .setRequired(false)
            .setMaxLength(500)
        )
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('close-report')
    .setDescription('Close the current report intake thread without submitting a report')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('setupreportbutton')
    .setDescription('Sends report instructions to a channel.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The channel to send the report button message to.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new ContextMenuCommandBuilder()
    .setName(REPORT_USER_CONTEXT_COMMAND_NAME)
    .setType(ApplicationCommandType.User)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
];

function buildReportMessageContextCommand(): ContextMenuCommandBuilder {
  return new ContextMenuCommandBuilder()
    .setName(REPORT_MESSAGE_CONTEXT_COMMAND_NAME)
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel
    );
}

export function buildApplicationCommands({
  userInstallReportingEnabled,
}: BuildApplicationCommandsOptions): RESTPostAPIApplicationCommandsJSONBody[] {
  const commandBuilders = userInstallReportingEnabled
    ? [...baseApplicationCommandBuilders, buildReportMessageContextCommand()]
    : baseApplicationCommandBuilders;

  return commandBuilders.map((command) => command.toJSON());
}
