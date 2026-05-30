import {
  Client,
  Guild,
  Message,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ChatInputCommandInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
  PermissionFlagsBits,
  MessageFlags,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  ActionRowBuilder, // Added
  ButtonBuilder, // Added
  ButtonStyle, // Added
  ChannelType, // Added
  EmbedBuilder, // Added
  TextChannel, // Added
  Role,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { IHeuristicService } from '../services/HeuristicService';
import { UserProfileData } from '../services/GPTService';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { INotificationManager } from '../services/NotificationManager';
import { HeuristicSettings, IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
import { IUserModerationService } from '../services/UserModerationService';
import { ISecurityActionService } from '../services/SecurityActionService';
import { TYPES } from '../di/symbols';
import {
  decodeVerificationPromptTemplateInput,
  resolveVerificationPromptTemplate,
  VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY,
} from '../utils/verificationPromptTemplate';
import {
  decodeExpectedTopicsInput,
  EXPECTED_TOPICS_SETTING_KEY,
  getServerContextSettings,
  hasServerContext,
  SERVER_ABOUT_SETTING_KEY,
  VERIFICATION_CONTEXT_SETTING_KEY,
} from '../utils/serverContextSettings';
import {
  getVerificationThreadAnalysisSettings,
  isVerificationAiMaxAction,
  MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT,
  VERIFICATION_AI_MAX_ACTIONS,
  VERIFICATION_AI_MAX_ACTION_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY,
} from '../utils/verificationThreadAnalysisSettings';
import {
  ANALYTICS_CONSENT_LEVELS,
  ANALYTICS_CONSENT_SETTING_KEY,
  getAnalyticsSettings,
  isAnalyticsConsentLevel,
} from '../utils/analyticsSettings';
import {
  AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY,
  DETECTION_RESPONSE_MODE_SETTING_KEY,
  DETECTION_RESPONSE_MODES,
  JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY,
  MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY,
  MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY,
  OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY,
  OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY,
  OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY,
  OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY,
  getDetectionResponseSettings,
  isDetectionResponseMode,
} from '../utils/detectionResponseSettings';
import {
  getUserReportSettings,
  isUserReportExternalResponseMode,
  REPORT_MESSAGE_MODAL_PREFIX,
  REPORT_MESSAGE_REASON_FIELD_ID,
  USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY,
  USER_REPORT_EXTERNAL_RESPONSE_MODES,
  USER_REPORT_REASON_MAX_LENGTH,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../utils/userReportSettings';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from '../services/ProductAnalyticsService';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticIssue,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';
import {
  CASE_RESPONDER_ROLE_IDS_SETTING_KEY,
  CASE_RESPONDER_ROUTING_MODE_SETTING_KEY,
  CASE_RESPONDER_ROUTING_MODES,
  CASE_RESPONDER_THREAD_MEMBER_CAP_SETTING_KEY,
  getCaseResponderSettings,
  isCaseResponderRoutingMode,
  MAX_CASE_RESPONDER_THREAD_MEMBER_CAP,
  normalizeCaseResponderRoleIds,
} from '../utils/caseResponderSettings';
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
  MAX_REPORT_AI_MAX_IMAGE_BYTES,
  MAX_REPORT_AI_MAX_IMAGES,
} from '../utils/reportAiSettings';
import 'reflect-metadata';

// Load environment variables
dotenv.config();

const REPORT_USER_CONTEXT_COMMAND_NAME = 'Report User';
const REPORT_MESSAGE_CONTEXT_COMMAND_NAME = 'Report Message';
const USER_INSTALL_REPORTING_ENABLED_ENV = 'DRASIL_USER_INSTALL_REPORTING_ENABLED';
const DRASIL_GUILD_INSTALL_PERMISSIONS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ViewAuditLog |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.CreatePrivateThreads;
const REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY = 'report_instructions_channel_id';
const REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY = 'report_instructions_message_id';
const DEFAULT_RESTRICTED_ROLE_NAME = 'Drasil Restricted';
const VERIFICATION_CHANNEL_NAME = 'verification';

function isUserInstallReportingEnabled(): boolean {
  return process.env[USER_INSTALL_REPORTING_ENABLED_ENV] === 'true';
}

/**
 * Interface for the Bot class
 */
export interface ICommandHandler {
  /**
   * Register the commands for the bot
   */
  registerCommands(): Promise<void>;

  /**
   * Handle a slash command
   */
  handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void>;

  handleUserContextMenuCommand(interaction: UserContextMenuCommandInteraction): Promise<void>;

  handleMessageContextMenuCommand(interaction: MessageContextMenuCommandInteraction): Promise<void>;

  // TODO: Rip this out in favor of a slash command
  /**
   * Handle test commands
   */
  handleTestCommands(message: Message): Promise<void>;
}

@injectable()
export class CommandHandler implements ICommandHandler {
  private client: Client;
  private heuristicService: IHeuristicService;
  private detectionOrchestrator: IDetectionOrchestrator;
  private notificationManager: INotificationManager;
  private configService: IConfigService;
  private userModerationService: IUserModerationService;
  private securityActionService: ISecurityActionService;
  private productAnalyticsService: IProductAnalyticsService;
  private setupDiagnosticsService?: ISetupDiagnosticsService;
  private commands: RESTPostAPIApplicationCommandsJSONBody[];

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.HeuristicService) heuristicService: IHeuristicService,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.ProductAnalyticsService)
    @optional()
    productAnalyticsService?: IProductAnalyticsService,
    @inject(TYPES.SetupDiagnosticsService)
    @optional()
    setupDiagnosticsService?: ISetupDiagnosticsService
  ) {
    this.client = client;
    this.heuristicService = heuristicService;
    this.detectionOrchestrator = detectionOrchestrator;
    this.notificationManager = notificationManager;
    this.configService = configService;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;
    this.productAnalyticsService = productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE;
    this.setupDiagnosticsService = setupDiagnosticsService;

    // Define slash commands
    this.commands = [
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
              subcommand
                .setName('keywords-list')
                .setDescription('List configured suspicious keywords')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('keywords-add')
                .setDescription('Add a suspicious keyword')
                .addStringOption((option) =>
                  option
                    .setName('keyword')
                    .setDescription('Keyword or phrase to add')
                    .setRequired(true)
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
              subcommand
                .setName('view')
                .setDescription('View the current detection response policy')
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
                  option
                    .setName('role')
                    .setDescription('Role to notify for cases')
                    .setRequired(true)
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
            .setName('report')
            .setDescription('Manage user report settings')
            .addSubcommand((subcommand) =>
              subcommand.setName('view').setDescription('View user report settings')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('reason-require')
                .setDescription('Require a reason for user reports')
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
              subcommand
                .setName('ai-images-enable')
                .setDescription('Analyze eligible image evidence')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('ai-images-disable')
                .setDescription('Do not analyze image evidence')
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
              subcommand
                .setName('prompt-view')
                .setDescription('View the current verification prompt')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('prompt-set')
                .setDescription('Set a custom verification prompt template')
                .addStringOption((option) =>
                  option
                    .setName('template')
                    .setDescription(
                      'Use {user_mention} and {server_name}. Use \\n for line breaks.'
                    )
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
                    .setDescription(
                      'Expected topics, links, or keywords; separate with commas or \\n'
                    )
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
      new SlashCommandBuilder() // Added flaguser command
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
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Require Admin perms
      new SlashCommandBuilder() // Added setupreportbutton command
        .setName('setupreportbutton')
        .setDescription('Sends report instructions to a channel.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel to send the report button message to.')
            .addChannelTypes(ChannelType.GuildText) // Only allow text channels
            .setRequired(true)
        )
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Require Admin perms
      new ContextMenuCommandBuilder()
        .setName(REPORT_USER_CONTEXT_COMMAND_NAME)
        .setType(ApplicationCommandType.User)
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setContexts(InteractionContextType.Guild),
      ...(isUserInstallReportingEnabled()
        ? [
            new ContextMenuCommandBuilder()
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
              ),
          ]
        : []),
    ].map((command) => command.toJSON());
  }

  public async registerCommands(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;

    if (!token) {
      console.error('DISCORD_TOKEN is not set in environment variables');
      return;
    }

    try {
      const rest = new REST({ version: '10' }).setToken(token);

      // Register commands globally (for all guilds)
      const clientId = this.client.user?.id;

      if (!clientId) {
        console.error('Client ID not available');
        return;
      }

      console.log('Started refreshing application (/) commands.');

      await rest.put(Routes.applicationCommands(clientId), { body: this.commands });

      console.log('Successfully registered application commands.');
    } catch (error) {
      console.error('Failed to register commands:', error);
    }
  }

  public async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    switch (commandName) {
      case 'ban':
        await this.handleBanCommand(interaction);
        break;

      case 'report':
        await this.handleReportCommand(interaction);
        break;

      case 'setupverification':
        await this.handleSetupVerificationCommand(interaction);
        break;

      case 'config':
        await this.handleConfigCommand(interaction);
        break;

      case 'audit':
        await this.handleAuditCommand(interaction);
        break;

      case 'flaguser': // Added case for flaguser
        await this.handleFlagUserCommand(interaction);
        break;

      case 'setupreportbutton': // Added case for setupreportbutton
        await this.handleSetupReportButtonCommand(interaction);
        break;

      default:
        await interaction.reply({
          content: `Unknown command: ${commandName}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  public async handleUserContextMenuCommand(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    if (interaction.commandName !== REPORT_USER_CONTEXT_COMMAND_NAME) {
      await interaction.reply({
        content: `Unknown user command: ${interaction.commandName}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.handleReportUserContextCommand(interaction);
  }

  public async handleMessageContextMenuCommand(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    if (interaction.commandName !== REPORT_MESSAGE_CONTEXT_COMMAND_NAME) {
      await interaction.reply({
        content: `Unknown message command: ${interaction.commandName}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.handleReportMessageContextCommand(interaction);
  }

  private async handleBanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Get the target user
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to ban.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the reason if provided
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Get the GuildMember
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    // Permission gate (defaultMemberPermissions is not a security boundary)
    // Prefer `interaction.memberPermissions` since it includes channel-level overrides.
    let hasBanPermission = interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
    if (hasBanPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasBanPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.BanMembers)
        : false;
    }

    if (!hasBanPermission) {
      await interaction.reply({
        content: 'You need Ban Members permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await this.canUseModeratorBanAction(guild))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await this.userModerationService.banUser(member, reason, interaction.user);
      await interaction.reply({
        content: `User ${targetUser.tag} has been banned.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to ban user via command:', error);
      await interaction.reply({
        content: `Failed to ban ${targetUser.tag}. Please try again later.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async canUseModeratorBanAction(guild: Guild): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (!settings.moderatorBanActionEnabled) {
      return false;
    }

    const botMember =
      guild.members.me ??
      (typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.BanMembers) ?? false;
  }

  private async handleReportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: 'You cannot report yourself.',
      });
      return;
    }

    let reportSettings = getUserReportSettings();
    try {
      const serverConfig = await this.configService.getServerConfig(guild.id);
      reportSettings = getUserReportSettings(serverConfig.settings);
    } catch (error) {
      console.error(`Failed to load report settings for guild ${guild.id}:`, error);
    }

    if (reportSettings.reasonRequired && !reason) {
      await interaction.editReply({
        content: 'Please include a reason for this report.',
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: `Could not find ${targetUser.globalName ?? targetUser.username} in this server.`,
      });
      return;
    }

    try {
      await this.securityActionService.handleUserReport(member, interaction.user, reason);
      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUser.id}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle user report for ${targetUser.id}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  private async handleReportUserContextCommand(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.targetUser;
    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: 'You cannot report yourself.',
      });
      return;
    }

    let reportSettings = getUserReportSettings();
    try {
      const serverConfig = await this.configService.getServerConfig(guild.id);
      reportSettings = getUserReportSettings(serverConfig.settings);
    } catch (error) {
      console.error(`Failed to load report settings for guild ${guild.id}:`, error);
    }

    if (reportSettings.reasonRequired) {
      await interaction.editReply({
        content: 'This server requires a report reason. Please use `/report` instead.',
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: `Could not find ${targetUser.globalName ?? targetUser.username} in this server.`,
      });
      return;
    }

    try {
      await this.securityActionService.handleUserReport(member, interaction.user);
      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUser.id}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle context user report for ${targetUser.id}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  private async handleReportMessageContextCommand(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    if (!isUserInstallReportingEnabled()) {
      await interaction.reply({
        content: 'User-installable message reporting is not enabled for this Drasil deployment.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMessage = interaction.targetMessage;
    const targetUser = targetMessage.author;
    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot report your own message.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId ?? undefined;
    let reasonRequired = false;
    if (guildId) {
      let reportSettings = getUserReportSettings();
      try {
        const serverConfig = await this.configService.getServerConfig(guildId);
        reportSettings = getUserReportSettings(serverConfig.settings);
      } catch (error) {
        console.error(`Failed to load report settings for guild ${guildId}:`, error);
      }

      reasonRequired = reportSettings.reasonRequired;
    }

    const context = interaction.context ?? 'x';
    const modal = new ModalBuilder()
      .setCustomId(
        [
          REPORT_MESSAGE_MODAL_PREFIX,
          targetMessage.id,
          interaction.channelId,
          targetUser.id,
          guildId ?? '0',
          context,
        ].join(':')
      )
      .setTitle('Report Message');
    const reasonInput = new TextInputBuilder()
      .setCustomId(REPORT_MESSAGE_REASON_FIELD_ID)
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('What happened? Include extra context if useful.')
      .setMaxLength(USER_REPORT_REASON_MAX_LENGTH)
      .setRequired(reasonRequired);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  /**
   * Helper method to extract user profile data for GPT analysis
   * Only includes data directly available through Discord.js API
   */
  private extractUserProfileData(member: GuildMember): UserProfileData {
    return {
      username: member.user.username,
      discriminator: member.user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(member.user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      recentMessages: [],
    };
  }

  /**
   * Handles test commands for debugging and testing the bot
   */
  public async handleTestCommands(message: Message): Promise<void> {
    const args = message.content.split(' ');
    const testCommand = args[1]?.toLowerCase();

    if (!testCommand) {
      await message.reply(
        'Available test commands: `!test spam`, `!test newaccount`, `!test spamwords`'
      );
      return;
    }

    try {
      // Declare test variables outside switch to avoid lexical declaration errors
      let newAccountProfile: UserProfileData;
      let newAccountResult;
      let spamMessage: string;
      let spamResult;

      if (!message.member) {
        await message.reply('This command can only be used in a server.');
        return;
      }

      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.reply('You need administrator permissions to use test commands.');
        return;
      }

      switch (testCommand) {
        case 'spam':
          // Simulate message frequency spam
          if (!message.guildId) {
            await message.reply('This command can only be used in a server.');
            return;
          }
          for (let i = 0; i < 10; i++) {
            this.heuristicService.isFrequencyAboveThreshold(message.author.id, message.guildId);
          }
          await message.reply(
            'Simulated rapid message frequency. Next message should trigger detection.'
          );
          break;

        case 'newaccount':
          // Create a simulated profile with recent account creation
          newAccountProfile = {
            ...this.extractUserProfileData(message.member),
            accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old account
            joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
          };

          // Analyze with this profile
          newAccountResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            'Test message with simulated new account',
            newAccountProfile
          );

          await message.reply(
            `Test result: ${newAccountResult.label}\n` +
              `Confidence: ${(newAccountResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${newAccountResult.reasons.join(', ')}\n`
          );
          break;

        case 'spamwords':
          // Test with known spam keywords
          spamMessage = 'free discord nitro gift card claim your prize now';
          spamResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            spamMessage,
            this.extractUserProfileData(message.member)
          );

          await message.reply(
            `Test message: "${spamMessage}"\n` +
              `Result: ${spamResult.label}\n` +
              `Confidence: ${(spamResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${spamResult.reasons.join(', ')}\n`
          );
          break;

        default:
          await message.reply(
            'Unknown test command. Available commands: `!test spam`, `!test newaccount`, `!test spamwords`'
          );
      }
    } catch (error) {
      console.error('Error in test command:', error);
      await message.reply('An error occurred while executing the test command.');
    }
  }

  private async handleSetupVerificationCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasAdminPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (hasAdminPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!invokingMember) {
        hasAdminPermission = false;
      } else if (interaction.channelId) {
        hasAdminPermission = invokingMember
          .permissionsIn(interaction.channelId)
          .has(PermissionFlagsBits.Administrator);
      } else {
        hasAdminPermission = invokingMember.permissions.has(PermissionFlagsBits.Administrator);
      }
    }

    if (!hasAdminPermission) {
      await interaction.reply({
        content: 'You need administrator permissions to set up the verification channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.setupDiagnosticsService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = 'Please check permissions and try again.';

    try {
      const restrictedRole = interaction.options.getRole('restricted-role', true);
      const adminChannel = interaction.options.getChannel('admin-channel', true);
      const verificationChannel = interaction.options.getChannel('verification-channel');

      if (adminChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Admin channel must be a text channel.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (verificationChannel && verificationChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Verification channel must be a text channel.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const verificationChannelCandidate = await this.resolveVerificationChannelCandidate(
        guild,
        verificationChannel?.id ?? null
      );

      if (verificationChannelCandidate.ambiguousChannelIds.length > 0) {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple #${VERIFICATION_CHANNEL_NAME} channels already exist: ` +
            verificationChannelCandidate.ambiguousChannelIds
              .map((channelId) => `<#${channelId}>`)
              .join(', ') +
            '. Choose one with `verification-channel` before rerunning setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }

      const candidateReport = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
        restrictedRoleId: restrictedRole.id,
        willCreateRestrictedRole: false,
        adminChannelId: adminChannel.id,
        verificationChannelId: verificationChannelCandidate.channelId,
        willCreateVerificationChannel: !verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: null,
      });

      if (candidateReport.errorCount > 0) {
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.\n\n${this.formatSetupDiagnosticsReport(candidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      let verificationChannelId = verificationChannel?.id ?? null;
      let verificationChannelAction: 'configured' | 'created' | 'synced' = verificationChannel
        ? 'configured'
        : 'created';
      const createdSetupArtifacts: { verificationChannelId?: string } = {};

      if (!verificationChannelId) {
        const onChannelCreated = (channelId: string): void => {
          createdSetupArtifacts.verificationChannelId = channelId;
        };
        const createdChannelId = verificationChannelCandidate.channelId
          ? await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated,
              verificationChannelCandidate.channelId
            )
          : await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated
            );
        if (!createdChannelId) {
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelId = createdChannelId;
        verificationChannelAction =
          verificationChannelCandidate.channelId && !createdSetupArtifacts.verificationChannelId
            ? 'synced'
            : 'created';
      }

      const finalCandidateReport = await this.setupDiagnosticsService.validateSetupCandidate(
        guild,
        {
          restrictedRoleId: restrictedRole.id,
          willCreateRestrictedRole: false,
          adminChannelId: adminChannel.id,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: null,
        }
      );
      if (finalCandidateReport.errorCount > 0) {
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId,
            'Rolling back Drasil setup after final validation failed'
          );
          setupFailureDetail = rolledBack
            ? 'Final validation failed. The newly created verification channel was removed.'
            : `Final validation failed. The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        const rollbackNote =
          setupFailureDetail !== 'Please check permissions and try again.'
            ? `\n\n${setupFailureDetail}`
            : '';
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(finalCandidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      try {
        await this.configService.updateServerConfig(guild.id, {
          restricted_role_id: restrictedRole.id,
          admin_channel_id: adminChannel.id,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId
          );
          setupFailureDetail = rolledBack
            ? 'Configuration could not be saved. The newly created verification channel was removed.'
            : `Configuration could not be saved. The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        throw error;
      }
      void this.productAnalyticsService.captureGuildEvent(
        guild.id,
        'verification setup completed',
        {
          verification_channel_created: verificationChannelAction === 'created',
          verification_channel_configured: Boolean(verificationChannelId),
          admin_channel_configured: true,
          restricted_role_configured: true,
        }
      );

      const verificationChannelMessage =
        verificationChannelAction === 'created'
          ? `Created verification channel: <#${verificationChannelId}>`
          : verificationChannelAction === 'synced'
            ? `Synced verification channel permissions: <#${verificationChannelId}>`
            : `Verification channel: <#${verificationChannelId}>`;

      const responseLines = [
        'Setup complete.',
        `Restricted role: <@&${restrictedRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        verificationChannelMessage,
      ];

      if (candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsReport(responseLines, candidateReport);
      }

      await interaction.editReply({
        content: this.truncatePreview(responseLines.join('\n'), 1900),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Failed to complete setup verification command:', error);
      const errorResponse = {
        content: `Failed to complete setup verification. ${setupFailureDetail}`,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorResponse);
      } else {
        await interaction.reply({ ...errorResponse, flags: MessageFlags.Ephemeral });
      }
    }
  }

  private async handleAuditCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasManageGuildPermission = interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    );
    if (hasManageGuildPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasManageGuildPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.ManageGuild)
        : false;
    }

    if (!hasManageGuildPermission) {
      await interaction.reply({
        content: 'You need Manage Server permission to audit detection accounting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    const detectionEventId = interaction.options.getString('detection-id', true).trim();
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (subcommand === 'ignore-detection') {
        const updatedDetection = await this.securityActionService.excludeDetectionFromAccounting(
          guild.id,
          detectionEventId,
          interaction.user,
          reason
        );
        await interaction.editReply({
          content: updatedDetection
            ? `Detection ${detectionEventId} is now ignored for future accounting.`
            : `Detection ${detectionEventId} was not found or is not auditable from this server.`,
        });
        return;
      }

      if (subcommand === 'restore-detection') {
        const updatedDetection = await this.securityActionService.restoreDetectionAccounting(
          guild.id,
          detectionEventId,
          interaction.user,
          reason
        );
        await interaction.editReply({
          content: updatedDetection
            ? `Detection ${detectionEventId} now counts toward future accounting again.`
            : `Detection ${detectionEventId} was not found or is not auditable from this server.`,
        });
        return;
      }

      await interaction.editReply({ content: 'Unsupported /audit subcommand.' });
    } catch (error) {
      console.error(`Failed to audit detection ${detectionEventId}:`, error);
      await interaction.editReply({
        content: 'Failed to update detection accounting. Please try again later.',
      });
    }
  }

  /**
   * Handle the /config command to update server configuration
   * @param interaction The slash command interaction
   */
  private async handleConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to configure the bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    if (subcommandGroup === 'heuristic') {
      await this.handleHeuristicConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'detection') {
      await this.handleDetectionConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'case-staff') {
      await this.handleCaseStaffConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'report') {
      await this.handleReportConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'analytics') {
      await this.handleAnalyticsConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'verification') {
      await this.handleVerificationConfigCommand(interaction, guild.id);
      return;
    }

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === 'setup') {
      await this.handleConfigSetupCommand(interaction, guild);
      return;
    }

    if (subcommand === 'validate') {
      await this.handleConfigValidateCommand(interaction, guild);
      return;
    }

    if (subcommand !== 'set') {
      await interaction.reply({
        content: 'Unsupported /config subcommand.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    try {
      await this.configService.updateServerConfig(guild.id, {
        [key]: value,
      });

      await interaction.reply({
        content: `✅ Configuration updated successfully!\n\`${key}\` has been set to \`${value}\``,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error(`Failed to update configuration for guild ${guild.id}:`, error);
      await interaction.reply({
        content: 'An error occurred while updating the configuration. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async resolveVerificationChannelCandidate(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    explicitVerificationChannelId: string | null
  ): Promise<{
    channelId: string | null;
    willSyncPermissions: boolean;
    ambiguousChannelIds: readonly string[];
  }> {
    if (explicitVerificationChannelId) {
      return {
        channelId: explicitVerificationChannelId,
        willSyncPermissions: false,
        ambiguousChannelIds: [],
      };
    }

    const serverConfig = await this.configService.getServerConfig(guild.id).catch(() => null);
    const configuredVerificationChannelId = serverConfig?.verification_channel_id ?? null;
    if (configuredVerificationChannelId) {
      const configuredChannel = await guild.channels
        .fetch(configuredVerificationChannelId)
        .catch(() => null);
      if (configuredChannel?.type === ChannelType.GuildText) {
        return {
          channelId: configuredVerificationChannelId,
          willSyncPermissions: true,
          ambiguousChannelIds: [],
        };
      }
    }

    const matchingChannels = this.findMatchingVerificationChannels(guild);
    if (matchingChannels.length === 1) {
      return {
        channelId: matchingChannels[0].id,
        willSyncPermissions: true,
        ambiguousChannelIds: [],
      };
    }

    return {
      channelId: null,
      willSyncPermissions: false,
      ambiguousChannelIds: matchingChannels.map((channel) => channel.id),
    };
  }

  private findMatchingVerificationChannels(
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): TextChannel[] {
    const guildLike = guild as { channels?: { cache?: unknown } };
    const values = this.getCachedCollectionValues(guildLike.channels?.cache);

    return values.filter((channel): channel is TextChannel =>
      this.isVerificationTextChannel(channel)
    );
  }

  private getCachedCollectionValues(cache: unknown): unknown[] {
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

  private isVerificationTextChannel(channel: unknown): channel is TextChannel {
    const maybeChannel = channel as { type?: ChannelType; name?: string } | null;
    if (!maybeChannel) {
      return false;
    }

    return (
      maybeChannel.type === ChannelType.GuildText && maybeChannel.name === VERIFICATION_CHANNEL_NAME
    );
  }

  private async resolveRestrictedRoleCandidate(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    explicitRestrictedRole: Role | null,
    requestedRoleName: string | null
  ): Promise<{ role: Role | null; roleName: string; ambiguousRoleIds: readonly string[] }> {
    if (explicitRestrictedRole) {
      return {
        role: explicitRestrictedRole,
        roleName: explicitRestrictedRole.name,
        ambiguousRoleIds: [],
      };
    }

    const roleName = requestedRoleName ?? DEFAULT_RESTRICTED_ROLE_NAME;
    const serverConfig = await this.configService.getServerConfig(guild.id).catch(() => null);
    const configuredRestrictedRoleId = serverConfig?.restricted_role_id ?? null;
    if (configuredRestrictedRoleId) {
      const configuredRole = await guild.roles.fetch(configuredRestrictedRoleId).catch(() => null);
      if (configuredRole && (!requestedRoleName || configuredRole.name === roleName)) {
        return { role: configuredRole, roleName: configuredRole.name, ambiguousRoleIds: [] };
      }
    }

    const matchingRoles = this.findMatchingRolesByName(guild, roleName);
    if (matchingRoles.length === 1) {
      return { role: matchingRoles[0], roleName, ambiguousRoleIds: [] };
    }

    return {
      role: null,
      roleName,
      ambiguousRoleIds: matchingRoles.map((role) => role.id),
    };
  }

  private findMatchingRolesByName(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    roleName: string
  ): Role[] {
    const guildLike = guild as { roles?: { cache?: unknown } };
    const values = this.getCachedCollectionValues(guildLike.roles?.cache);

    return values.filter((role): role is Role => this.isRoleNamed(role, roleName));
  }

  private isRoleNamed(role: unknown, roleName: string): role is Role {
    const maybeRole = role as { name?: string } | null;
    return Boolean(maybeRole) && maybeRole?.name === roleName;
  }

  private async handleConfigSetupCommand(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<void> {
    if (!this.setupDiagnosticsService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const adminChannel = interaction.options.getChannel('admin-channel', true);
    const existingRestrictedRole = interaction.options.getRole('restricted-role');
    const requestedRoleName = interaction.options.getString('restricted-role-name')?.trim() || null;
    const verificationChannel = interaction.options.getChannel('verification-channel');
    const reportChannel = interaction.options.getChannel('report-channel');

    if (adminChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Admin channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (verificationChannel && verificationChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Verification channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (reportChannel && reportChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Report channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (existingRestrictedRole && requestedRoleName) {
      await interaction.reply({
        content: '`restricted-role-name` cannot be combined with `restricted-role`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let setupFailureDetail: string | null = null;

    try {
      const verificationChannelCandidate = await this.resolveVerificationChannelCandidate(
        guild,
        verificationChannel?.id ?? null
      );
      const restrictedRoleCandidate = await this.resolveRestrictedRoleCandidate(
        guild,
        existingRestrictedRole as Role | null,
        requestedRoleName
      );

      if (restrictedRoleCandidate.ambiguousRoleIds.length > 0) {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple roles named \`${restrictedRoleCandidate.roleName}\` already exist: ` +
            restrictedRoleCandidate.ambiguousRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') +
            '. Choose one with `restricted-role` before rerunning /config setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (verificationChannelCandidate.ambiguousChannelIds.length > 0) {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple #${VERIFICATION_CHANNEL_NAME} channels already exist: ` +
            verificationChannelCandidate.ambiguousChannelIds
              .map((channelId) => `<#${channelId}>`)
              .join(', ') +
            '. Choose one with `verification-channel` before rerunning /config setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }

      const candidateReport = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
        restrictedRoleId: restrictedRoleCandidate.role?.id ?? null,
        willCreateRestrictedRole: !restrictedRoleCandidate.role,
        adminChannelId: adminChannel.id,
        verificationChannelId: verificationChannelCandidate.channelId,
        willCreateVerificationChannel: !verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: reportChannel?.id ?? null,
      });

      if (candidateReport.errorCount > 0) {
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.\n\n${this.formatSetupDiagnosticsReport(candidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      let createdRestrictedRole: Role | null = null;
      const createdSetupArtifacts: { verificationChannelId?: string } = {};
      let restrictedRole = restrictedRoleCandidate.role;
      if (!restrictedRole) {
        createdRestrictedRole = await guild.roles.create({
          name: restrictedRoleCandidate.roleName,
          permissions: [],
          reason: `Drasil setup requested by ${interaction.user.username}`,
        });
        restrictedRole = createdRestrictedRole;
      }

      const restrictedRoleWasCreated = Boolean(createdRestrictedRole);
      let verificationChannelId = verificationChannel?.id ?? null;
      let verificationChannelAction: 'configured' | 'created' | 'synced' = verificationChannel
        ? 'configured'
        : 'created';

      if (!verificationChannelId) {
        const onChannelCreated = (channelId: string): void => {
          createdSetupArtifacts.verificationChannelId = channelId;
        };
        verificationChannelId = verificationChannelCandidate.channelId
          ? await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated,
              verificationChannelCandidate.channelId
            )
          : await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated
            );
        if (!verificationChannelId) {
          if (createdRestrictedRole) {
            const rolledBack = await this.rollbackCreatedRestrictedRole(
              createdRestrictedRole,
              guild.id
            );
            setupFailureDetail = rolledBack
              ? 'Verification channel setup failed. The newly created restricted role was removed.'
              : `Verification channel setup failed. The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`;
          }
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelAction =
          verificationChannelCandidate.channelId && !createdSetupArtifacts.verificationChannelId
            ? 'synced'
            : 'created';
      }

      const finalCandidateReport = await this.setupDiagnosticsService.validateSetupCandidate(
        guild,
        {
          restrictedRoleId: restrictedRole.id,
          willCreateRestrictedRole: false,
          adminChannelId: adminChannel.id,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: reportChannel?.id ?? null,
        }
      );
      if (finalCandidateReport.errorCount > 0) {
        const rollbackDetails = ['Final validation failed.'];
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId,
            'Rolling back Drasil setup after final validation failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created verification channel was removed.'
              : `The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`
          );
        }
        if (createdRestrictedRole) {
          const rolledBack = await this.rollbackCreatedRestrictedRole(
            createdRestrictedRole,
            guild.id,
            'Rolling back Drasil setup after final validation failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created restricted role was removed.'
              : `The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`
          );
        }
        setupFailureDetail = rollbackDetails.join(' ');
        const rollbackNote = `\n\n${setupFailureDetail}`;
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(finalCandidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      try {
        await this.configService.updateServerConfig(guild.id, {
          restricted_role_id: restrictedRole.id,
          admin_channel_id: adminChannel.id,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        const rollbackDetails = ['Configuration could not be saved.'];
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;

        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created verification channel was removed.'
              : `The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`
          );
        }

        if (createdRestrictedRole) {
          const rolledBack = await this.rollbackCreatedRestrictedRole(
            createdRestrictedRole,
            guild.id,
            'Rolling back Drasil setup after config save failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created restricted role was removed.'
              : `The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`
          );
        }

        setupFailureDetail = rollbackDetails.join(' ');
        throw error;
      }

      let reportInstructionsLine: string | null = null;
      let reportInstructionsWarningLine: string | null = null;
      if (reportChannel) {
        try {
          const result = await this.upsertReportInstructionsMessage(
            guild.id,
            reportChannel as TextChannel
          );
          reportInstructionsLine = `Report instructions ${result.action}: <#${reportChannel.id}>`;
        } catch (error) {
          console.error(`Failed to upsert report instructions for guild ${guild.id}:`, error);
          reportInstructionsWarningLine =
            `[WARNING] Core setup was saved, but report instructions were not updated in <#${reportChannel.id}>. ` +
            'Check Drasil can send messages and embeds there, then rerun setup.';
        }
      }

      const lines = [
        'Setup complete.',
        `${restrictedRoleWasCreated ? 'Created restricted role' : 'Restricted role'}: <@&${restrictedRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        `${verificationChannelAction === 'created' ? 'Created verification channel' : verificationChannelAction === 'synced' ? 'Synced verification channel permissions' : 'Verification channel'}: <#${verificationChannelId}>`,
      ];

      if (reportInstructionsLine) {
        lines.push(reportInstructionsLine);
      }

      if (reportInstructionsWarningLine) {
        lines.push(reportInstructionsWarningLine);
      }

      if (candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsReport(lines, candidateReport);
      }

      await interaction.editReply({
        content: this.truncatePreview(lines.join('\n'), 1900),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to complete config setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: setupFailureDetail
          ? `Failed to complete setup. ${setupFailureDetail}`
          : 'Failed to complete setup. Please check permissions and try again.',
        allowedMentions: { parse: [] },
      });
    }
  }

  private async rollbackCreatedRestrictedRole(
    role: Role,
    guildId: string,
    reason = 'Rolling back Drasil setup after verification channel setup failed'
  ): Promise<boolean> {
    try {
      await role.delete(reason);
      return true;
    } catch (error) {
      console.error(`Failed to roll back restricted role ${role.id} for guild ${guildId}:`, error);
      return false;
    }
  }

  private async rollbackCreatedVerificationChannel(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    channelId: string,
    reason = 'Rolling back Drasil setup after config save failed'
  ): Promise<boolean> {
    try {
      const channel =
        guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error(
          `Could not find text verification channel ${channelId} to roll back for guild ${guild.id}`
        );
        return false;
      }

      await channel.delete(reason);
      return true;
    } catch (error) {
      console.error(
        `Failed to roll back verification channel ${channelId} for guild ${guild.id}:`,
        error
      );
      return false;
    }
  }

  private async handleConfigValidateCommand(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<void> {
    if (!this.setupDiagnosticsService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const report = await this.setupDiagnosticsService.validateGuildSetup(guild);
      await interaction.editReply({
        content: this.formatSetupDiagnosticsReport(report),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to validate setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: 'Failed to validate setup. Please try again later.',
      });
    }
  }

  private formatSetupDiagnosticsReport(report: SetupDiagnosticReport, maxLength = 1900): string {
    const status =
      report.errorCount > 0
        ? `Setup validation failed with ${report.errorCount} error(s) and ${report.warningCount} warning(s).`
        : report.warningCount > 0
          ? `Setup validation passed with ${report.warningCount} warning(s).`
          : 'Setup validation passed with no issues.';

    if (report.issues.length === 0) {
      return `${status}\nGuild ID: \`${report.guildId}\``;
    }

    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const warnings = report.issues.filter((issue) => issue.severity === 'warning');
    const remediationLines = this.formatSetupRemediationLines(errors);
    const issueLines = [
      ...(errors.length > 0
        ? ['Must fix before saving:', ...errors.map((issue) => `- [ERROR] ${issue.message}`)]
        : []),
      ...(warnings.length > 0
        ? ['Saved but warnings:', ...warnings.map((issue) => `- [WARNING] ${issue.message}`)]
        : []),
      ...(remediationLines.length > 0
        ? ['', 'Recommended fix:', ...remediationLines.map((line) => `- ${line}`)]
        : [
            '',
            'Next step:',
            '- Fix the listed Discord roles, channels, or permissions, then rerun `/config validate`.',
          ]),
    ];
    return this.truncatePreview(
      [status, `Guild ID: \`${report.guildId}\``, ...issueLines].join('\n'),
      maxLength
    );
  }

  private formatSetupRemediationLines(issues: readonly SetupDiagnosticIssue[]): readonly string[] {
    const codes = new Set(issues.map((issue) => issue.code));
    const lines = new Set<string>();

    if (
      this.hasAnySetupIssue(codes, [
        'restricted-role-missing',
        'restricted-role-not-found',
        'admin-channel-missing',
        'admin-channel-not-found',
        'verification-channel-missing',
        'verification-channel-not-found',
      ])
    ) {
      lines.add(
        'Run `/config setup admin-channel:<moderator-channel>` to repair core setup. Omit `restricted-role` and `verification-channel` to let Drasil reuse safe defaults or create them.'
      );
    }

    if (codes.has('verification-channel-create-manage-channels')) {
      lines.add(
        'Grant Drasil Manage Channels, or pass `verification-channel:<channel>` to use an existing text channel.'
      );
    }

    if (codes.has('restricted-role-hierarchy')) {
      lines.add('Move the Drasil bot role above the restricted role in Discord role settings.');
    }

    if (codes.has('restricted-role-managed') || codes.has('restricted-role-everyone')) {
      lines.add(
        'Choose a normal assignable restricted role with `/config setup restricted-role:<role>`.'
      );
    }

    if (
      [...codes].some((code) =>
        /-(view|send|embed-links|read-message-history|create-private-threads|send-messages-in-threads|manage-threads|sync-manage-channels)$/.test(
          code
        )
      )
    ) {
      lines.add('Grant the listed channel permission to Drasil, then rerun `/config validate`.');
    }

    return [...lines];
  }

  private hasAnySetupIssue(codes: ReadonlySet<string>, expectedCodes: readonly string[]): boolean {
    return expectedCodes.some((code) => codes.has(code));
  }

  private appendSetupDiagnosticsReport(
    lines: string[],
    report: SetupDiagnosticReport,
    maxLength = 1900
  ): void {
    const prefix = lines.join('\n');
    const separatorLength = prefix.length > 0 ? 2 : 0;
    const budget = Math.max(200, maxLength - prefix.length - separatorLength);
    lines.push('', this.formatSetupDiagnosticsReport(report, budget));
  }

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
      `Observed ban reason required: \`${settings.observedActionBanRequiresReason ? 'yes' : 'no'}\``,
      `Moderator ban action enabled: \`${settings.moderatorBanActionEnabled ? 'yes' : 'no'}\``,
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
      ? `PostHog export: \`configured\` (${runtimeStatus.host})`
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

  private formatReportAiSettings(settings: ReturnType<typeof getReportAiSettings>): string {
    return [
      `Enabled: \`${settings.enabled ? 'yes' : 'no'}\``,
      `Analyze text: \`${settings.analyzeText ? 'yes' : 'no'}\``,
      `Analyze images: \`${settings.analyzeImages ? 'yes' : 'no'}\``,
      `Max recommended action: \`${settings.maxAction}\``,
      `Open-case threshold: \`${Math.round(settings.openCaseThreshold * 100)}%\``,
      `Restrict threshold: \`${Math.round(settings.restrictThreshold * 100)}%\``,
      `Max images: \`${settings.maxImages}\``,
      `Max image size: \`${Math.round(settings.maxImageBytes / (1024 * 1024))} MB\``,
    ].join('\n');
  }

  private formatVerificationPromptPreview(template: string): string {
    return this.truncatePreview(template, 1200);
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
    return this.truncatePreview(lines.join('\n'), 1800);
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

  private async handleDetectionConfigCommand(
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
            auto_restrict: mode === 'restrict',
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

        case 'ban-reason-require':
        case 'ban-reason-optional': {
          const required = subcommand === 'ban-reason-require';
          const updated = await this.configService.updateServerSettings(guildId, {
            [OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY]: required,
          });
          const settings = getDetectionResponseSettings(updated.settings);
          await interaction.reply({
            content:
              'Updated observed notification ban reason policy.\n\n' +
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

  private async handleCaseStaffConfigCommand(
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

  private async handleReportConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const serverConfig = await this.configService.getServerConfig(guildId);
          const settings = getUserReportSettings(serverConfig.settings);
          const aiSettings = getReportAiSettings(serverConfig.settings);
          await interaction.reply({
            content:
              'Current user report settings:\n\n' +
              this.formatUserReportSettings(guildId, settings) +
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

  private async handleAnalyticsConfigCommand(
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

  private async handleVerificationConfigCommand(
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

  private async handleHeuristicConfigCommand(
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

  /**
   * Handle the /flaguser command to manually flag a user
   * @param interaction The slash command interaction
   */
  private async handleFlagUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    // Double-check permissions (though defaultMemberPermissions should handle this)
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the target user
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason'); // Optional

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await this.securityActionService.handleManualFlag(
        targetMember,
        interaction.user,
        reason ?? undefined
      );
      await interaction.reply({
        content: `Flag request for ${targetUser.tag} received. Initiating verification process...`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to manually flag user:', error);
      await interaction.reply({
        content: `Failed to flag ${targetUser.tag}. Please try again later.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle the /setupreportbutton command
   * @param interaction The slash command interaction
   */
  private async handleSetupReportButtonCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    // Double-check permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the target channel
    const channel = interaction.options.getChannel('channel', true);

    // Ensure it's a text channel (though the option restricts this)
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'The specified channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetChannel = channel as TextChannel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await this.upsertReportInstructionsMessage(guild.id, targetChannel);

      await interaction.editReply({
        content: `Report instructions ${result.action} successfully in ${channel}.`,
      });
    } catch (error) {
      console.error('Failed to upsert report button message:', error);
      await interaction.editReply({
        content:
          '❌ Failed to send or update the message. Please ensure the bot has permissions to send messages in that channel.',
      });
    }
  }

  private async upsertReportInstructionsMessage(
    guildId: string,
    targetChannel: TextChannel
  ): Promise<{ action: 'sent' | 'updated' | 'recreated'; messageId: string }> {
    const messagePayload = this.buildReportInstructionsMessagePayload();
    const serverConfig = await this.configService.getServerConfig(guildId);
    const existingChannelId = serverConfig.settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY];
    const existingMessageId = serverConfig.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    let messageId: string;
    let action: 'sent' | 'updated' | 'recreated' = 'sent';

    if (existingChannelId === targetChannel.id && existingMessageId) {
      const existingMessage = await targetChannel.messages
        .fetch(existingMessageId)
        .catch(() => null);

      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await targetChannel.send(messagePayload);
        messageId = sentMessage.id;
        action = 'recreated';
      }
    } else {
      await this.deleteStaleReportInstructionsMessage(existingChannelId, existingMessageId);
      const existingMessage = await this.findExistingReportInstructionsMessage(targetChannel);
      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await targetChannel.send(messagePayload);
        messageId = sentMessage.id;
      }
    }

    await this.configService.updateServerSettings(guildId, {
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: targetChannel.id,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: messageId,
    });

    return { action, messageId };
  }

  private async findExistingReportInstructionsMessage(
    targetChannel: TextChannel
  ): Promise<Message | null> {
    const botUserId = this.client.user?.id;
    if (!botUserId) {
      return null;
    }

    const messageManager = (targetChannel as { messages?: Pick<TextChannel['messages'], 'fetch'> })
      .messages;
    if (!messageManager || typeof messageManager.fetch !== 'function') {
      return null;
    }

    const messages = await Promise.resolve(messageManager.fetch({ limit: 50 })).catch(() => null);
    if (!messages) {
      return null;
    }

    return (
      messages.find(
        (message) =>
          message.author.id === botUserId &&
          message.embeds.some((embed) => embed.title === 'Report a User')
      ) ?? null
    );
  }

  private async deleteStaleReportInstructionsMessage(
    existingChannelId: string | null | undefined,
    existingMessageId: string | null | undefined
  ): Promise<void> {
    if (!existingChannelId || !existingMessageId) {
      return;
    }

    try {
      const existingChannel = await this.client.channels.fetch(existingChannelId).catch(() => null);
      if (!existingChannel || !('messages' in existingChannel)) {
        return;
      }

      const existingMessage = await existingChannel.messages
        .fetch(existingMessageId)
        .catch(() => null);
      await existingMessage?.delete().catch((error) => {
        console.warn('Failed to delete stale report instructions message:', error);
      });
    } catch (error) {
      console.warn('Failed to clean up stale report instructions message:', error);
    }
  }

  private buildReportInstructionsMessagePayload(): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    // Create the embed
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Report a User')
      .setDescription(
        'If you see a user violating server rules or engaging in suspicious activity, ' +
          'use the button below to choose the user and submit the report. ' +
          'You can also use `/report` for the same user picker and reason field, or ' +
          'right-click a user and choose `Apps` -> `Report User`. ' +
          'Your report will be reviewed by the moderation team.'
      )
      .setFooter({ text: 'Your reports help keep the community safe!' });

    // Create the button
    const reportButton = new ButtonBuilder()
      .setCustomId('report_user_initiate') // Unique ID for the button interaction
      .setLabel('Report a user')
      .setStyle(ButtonStyle.Primary);

    // Create an action row for the button
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);

    return { embeds: [embed], components: [row] };
  }

  private async replyGuildInstallRequired(
    interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction
  ): Promise<void> {
    const installLink = this.getGuildInstallLink();
    const content = interaction.guildId
      ? `Drasil is not installed in this server yet. Ask a server admin to install it${installLink ? `: ${installLink}` : '.'}`
      : `This command can only be used in a server where Drasil is installed${installLink ? `: ${installLink}` : '.'}`;

    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }

  private getGuildInstallLink(): string | null {
    const clientId = this.client.user?.id;
    if (!clientId) {
      return null;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'bot applications.commands',
      permissions: DRASIL_GUILD_INSTALL_PERMISSIONS.toString(),
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }
}
