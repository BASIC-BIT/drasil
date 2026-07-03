import {
  AuditLogEvent,
  Client,
  GuildBan,
  Message,
  GuildMember,
  PartialGuildMember,
  Interaction,
  Guild,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { UserProfileData } from '../services/GPTService';
import { DetectionResult, IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { INotificationManager } from '../services/NotificationManager';
import { IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
import { ISecurityActionService } from '../services/SecurityActionService';
import { TYPES } from '../di/symbols';
import { IInteractionHandler } from './InteractionHandler';
import { ICommandHandler } from './CommandHandler';
import { IVerificationThreadAnalysisService } from '../services/VerificationThreadAnalysisService';
import {
  DetectionResponseSettings,
  getDetectionResponseSettings,
} from '../utils/detectionResponseSettings';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from '../services/ProductAnalyticsService';
import { getConfidenceBucket } from '../utils/analyticsHelpers';
import { REPORT_INTAKE_THREAD_NAME_PREFIX } from '../services/ThreadManager';
import {
  DetectionType,
  type GlobalMessageWatchlistEntry,
  type Server,
  type ServerSettings,
} from '../repositories/types';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';
import { IReportIntakeService } from '../services/ReportIntakeService';
import { IReportIntakeAgentService } from '../services/ReportIntakeAgentService';
import { ICaseReviewReminderService } from '../services/CaseReviewReminderService';
import { isDiscordUnknownBanError } from '../utils/discordErrors';
import { messageAttachmentsToReportMetadata } from '../utils/reportAttachments';
import {
  findMessageWatchlistMatch,
  getMessageDeletionSettings,
  type MessageWatchlistMatch,
} from '../utils/messageDeletionSettings';
import {
  IMessageContextRepository,
  MESSAGE_CONTEXT_PREVIEW_MAX_LENGTH,
  MESSAGE_CONTEXT_RETENTION_DAYS,
  MESSAGE_CONTEXT_USER_LIMIT,
} from '../repositories/MessageContextRepository';
import {
  IUserModerationService,
  ObservedDiscordBanOptions,
  ObservedDiscordKickOptions,
} from '../services/UserModerationService';
import { ModerationOutcomeSource } from '../services/ModerationOutcomeService';
import { IModerationQueueService } from '../services/ModerationQueueService';
import { getManualIntakeSettings } from '../utils/manualIntakeSettings';
import { getRoleGateSettings } from '../utils/roleGateSettings';
import { IRoleQuarantineService } from '../services/RoleQuarantineService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type { IGlobalMessageWatchlistRepository } from '../repositories/GlobalMessageWatchlistRepository';

const CHANNEL_CONTEXT_MESSAGE_LIMIT = 5;
const MESSAGE_CONTEXT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const GLOBAL_MESSAGE_WATCHLIST_CACHE_TTL_MS = 30_000;
const GLOBAL_MESSAGE_WATCHLIST_INITIAL_FAILURE_RETRY_MS = 5_000;
const SETUP_NUDGE_SUPPRESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_WARNING_VALIDATION_PRECHECK_MS = 5 * 60 * 1000;
const SETUP_WARNING_LAST_FINGERPRINT_SETTING_KEY = 'setup_warning_last_fingerprint';
const DISCORD_RECENT_AUDIT_WINDOW_MS = 60 * 1000;
const MANUAL_INTAKE_ROLE_REMOVAL_REASON = 'Manual intake trigger role consumed by Drasil';

type SetupNudgeSource = 'audit_log_installer' | 'owner';
type SetupNudgeResult = 'sent' | 'dm_failed' | 'no_recipient';

interface SetupNudgeRecipient {
  readonly user: SetupNudgeUser;
  readonly source: SetupNudgeSource;
}

interface SetupNudgeUser {
  readonly id: string;
  readonly bot?: boolean;
  send(content: string): Promise<unknown>;
}

type CachedMessageChannel = Message['channel'] & {
  messages: {
    cache: {
      values(): Iterable<Message>;
    };
  };
};

// Load environment variables
dotenv.config();

/**
 * Interface for the Bot class
 */
export interface IEventHandler {
  setupEventHandlers(): Promise<void>;
}

@injectable()
export class EventHandler implements IEventHandler {
  private client: Client;
  private detectionOrchestrator: IDetectionOrchestrator;
  private notificationManager: INotificationManager;
  private configService: IConfigService;
  private securityActionService: ISecurityActionService;
  private commandHandler: ICommandHandler;
  private interactionHandler: IInteractionHandler;
  private verificationThreadAnalysisService: IVerificationThreadAnalysisService;
  private productAnalyticsService: IProductAnalyticsService;
  private setupDiagnosticsService?: ISetupDiagnosticsService;
  private reportIntakeService?: IReportIntakeService;
  private reportIntakeAgentService?: IReportIntakeAgentService;
  private caseReviewReminderService?: ICaseReviewReminderService;
  private messageContextRepository?: IMessageContextRepository;
  private userModerationService?: IUserModerationService;
  private moderationQueueService?: IModerationQueueService;
  private roleQuarantineService?: IRoleQuarantineService;
  private verificationEventRepository?: IVerificationEventRepository;
  private globalMessageWatchlistRepository?: IGlobalMessageWatchlistRepository;
  private serverConfigWarmups: Set<string> = new Set();
  private manualIntakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private configInitializePromise: Promise<void> | null = null;
  private lastMessageContextPruneAt = 0;
  private globalMessageWatchlistCache: readonly GlobalMessageWatchlistEntry[] = [];
  private globalMessageWatchlistLoadedAt = 0;
  private globalMessageWatchlistRetryAfter = 0;
  private globalMessageWatchlistHasLoaded = false;
  private globalMessageWatchlistLoadPromise: Promise<
    readonly GlobalMessageWatchlistEntry[]
  > | null = null;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.CommandHandler) commandHandler: ICommandHandler,
    @inject(TYPES.InteractionHandler) interactionHandler: IInteractionHandler,
    @inject(TYPES.VerificationThreadAnalysisService)
    verificationThreadAnalysisService: IVerificationThreadAnalysisService,
    @inject(TYPES.ProductAnalyticsService)
    @optional()
    productAnalyticsService?: IProductAnalyticsService,
    @inject(TYPES.SetupDiagnosticsService)
    @optional()
    setupDiagnosticsService?: ISetupDiagnosticsService,
    @inject(TYPES.ReportIntakeService)
    @optional()
    reportIntakeService?: IReportIntakeService,
    @inject(TYPES.ReportIntakeAgentService)
    @optional()
    reportIntakeAgentService?: IReportIntakeAgentService,
    @inject(TYPES.CaseReviewReminderService)
    @optional()
    caseReviewReminderService?: ICaseReviewReminderService,
    @inject(TYPES.MessageContextRepository)
    @optional()
    messageContextRepository?: IMessageContextRepository,
    @inject(TYPES.UserModerationService)
    @optional()
    userModerationService?: IUserModerationService,
    @inject(TYPES.ModerationQueueService)
    @optional()
    moderationQueueService?: IModerationQueueService,
    @inject(TYPES.RoleQuarantineService)
    @optional()
    roleQuarantineService?: IRoleQuarantineService,
    @inject(TYPES.VerificationEventRepository)
    @optional()
    verificationEventRepository?: IVerificationEventRepository,
    @inject(TYPES.GlobalMessageWatchlistRepository)
    @optional()
    globalMessageWatchlistRepository?: IGlobalMessageWatchlistRepository
  ) {
    this.client = client;
    this.detectionOrchestrator = detectionOrchestrator;
    this.notificationManager = notificationManager;
    this.configService = configService;
    this.securityActionService = securityActionService;
    this.commandHandler = commandHandler;
    this.interactionHandler = interactionHandler;
    this.verificationThreadAnalysisService = verificationThreadAnalysisService;
    this.productAnalyticsService = productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE;
    this.setupDiagnosticsService = setupDiagnosticsService;
    this.reportIntakeService = reportIntakeService;
    this.reportIntakeAgentService = reportIntakeAgentService;
    this.caseReviewReminderService = caseReviewReminderService;
    this.messageContextRepository = messageContextRepository;
    this.userModerationService = userModerationService;
    this.moderationQueueService = moderationQueueService;
    this.roleQuarantineService = roleQuarantineService;
    this.verificationEventRepository = verificationEventRepository;
    this.globalMessageWatchlistRepository = globalMessageWatchlistRepository;
  }

  public async setupEventHandlers(): Promise<void> {
    this.client.on(Events.ClientReady, this.handleReady.bind(this));
    this.client.on(Events.MessageCreate, this.handleMessage.bind(this));
    this.client.on(Events.GuildMemberAdd, this.handleGuildMemberAdd.bind(this));
    this.client.on(Events.GuildMemberUpdate, this.handleGuildMemberUpdate.bind(this));
    this.client.on(Events.GuildMemberRemove, this.handleGuildMemberRemove.bind(this));
    this.client.on(Events.GuildBanAdd, this.handleGuildBanAdd.bind(this));
    this.client.on(Events.InteractionCreate, this.handleInteraction.bind(this));
    this.client.on(Events.GuildCreate, this.handleGuildCreate.bind(this));
  }

  private async handleReady(): Promise<void> {
    if (!this.client.user) {
      console.error('Client user not available');
      return;
    }

    console.log(`Logged in as ${this.client.user.tag}!`);

    // Initialize services
    await this.ensureConfigInitialized();

    await this.commandHandler.registerCommands();
    void this.moderationQueueService?.syncAllActiveServerQueues().catch((error) => {
      console.warn('Failed to sync live moderation queues on startup:', error);
    });
    this.caseReviewReminderService?.start();
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.commandHandler.handleSlashCommand(interaction);
      } else if (interaction.isUserContextMenuCommand()) {
        await this.commandHandler.handleUserContextMenuCommand(interaction);
      } else if (interaction.isMessageContextMenuCommand()) {
        await this.commandHandler.handleMessageContextMenuCommand(interaction);
      } else if (interaction.isButton()) {
        await this.interactionHandler.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.interactionHandler.handleStringSelectMenuInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        // Added check for modal submit
        await this.interactionHandler.handleModalSubmit(interaction);
      }
    } catch (error) {
      console.error('Error handling interaction:', error);

      // Try to respond if the interaction hasn't been replied to
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing this interaction.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore messages from bots (including self)
    if (message.author.bot) return;
    if (!message.guild || !message.member) return;

    if (message.channel.isThread()) {
      try {
        const reportIntakeHandled = await this.reportIntakeService?.handleThreadMessage(message);
        if (reportIntakeHandled) {
          this.reportIntakeAgentService?.scheduleAnalysisForThreadMessage(message);
          this.rememberRecentMessage(message);
          return;
        }
      } catch (error) {
        console.error('Error handling report intake thread message:', error);
        if (this.isLikelyReportIntakeThread(message)) {
          this.rememberRecentMessage(message);
          return;
        }
      }
    }

    // Handle ping command via traditional message (kept for backward compatibility)
    if (message.content === '!ping') {
      await message.reply('Pong! Note: Please use slash commands instead (e.g. /ping)');
      return;
    }

    // Handle debug/test commands
    if (message.content.startsWith('!test')) {
      await this.commandHandler.handleTestCommands(message);
      return;
    }

    if (message.system) {
      return;
    }

    // Extract user data for detection
    const userId = message.author.id;
    const serverId = message.guild.id;
    const content = message.content;

    try {
      // Ensure the config cache init attempt has completed before processing messages.
      // (Prevents applying global defaults while initialize() is still running.)
      await this.ensureConfigInitialized();

      if (message.channel.isThread()) {
        const handled = await this.verificationThreadAnalysisService.handleThreadMessage(message);
        if (handled) {
          return;
        }
      }

      // Warm the per-guild config cache in the background (no await) so hot-path heuristics
      // can consult the in-memory cache without blocking message handling.
      if (!this.configService.getCachedServerConfig(serverId)) {
        this.warmServerConfigCache(serverId);
      }

      const serverConfig = await this.configService.getServerConfig(serverId);
      const responseSettings = getDetectionResponseSettings(serverConfig.settings, 'message');
      if (responseSettings.mode === 'off') {
        console.log(
          `Automatic detection is disabled for guild ${serverId}; skipping message scan.`
        );
        return;
      }

      let messageDeletionSettings = getMessageDeletionSettings(serverConfig.settings);
      if (messageDeletionSettings.enabled && messageDeletionSettings.watchlistEnabled) {
        const globalMessageWatchlistEntries = await this.getGlobalMessageWatchlistEntries();
        if (globalMessageWatchlistEntries.length > 0) {
          messageDeletionSettings = getMessageDeletionSettings(
            serverConfig.settings,
            globalMessageWatchlistEntries
          );
        }
      }
      const messageAttachments = messageAttachmentsToReportMetadata(message);
      const watchlistMatch = findMessageWatchlistMatch(
        { content, attachments: messageAttachments },
        messageDeletionSettings
      );
      const hasExemptPermissions = this.hasAutomaticDetectionExemptPermissions(message.member);
      if (
        responseSettings.automaticDetectionExemptModerators &&
        hasExemptPermissions &&
        !watchlistMatch
      ) {
        return;
      }

      const recentMessages = await this.getRecentUserMessages(serverId, userId);
      const gptMessageCheckCount = this.getGptMessageCheckCount(serverConfig.settings);
      const forceGpt =
        gptMessageCheckCount !== null && recentMessages.length < gptMessageCheckCount;
      const actionThreshold =
        serverConfig.settings.min_confidence_threshold ??
        globalConfig.getSettings().defaultServerSettings.minConfidenceThreshold;
      const watchlistMatchOpensCase =
        responseSettings.mode === 'restrict' && 100 >= actionThreshold;

      // Get user profile data for detection context
      const profileData = this.extractUserProfileData(message.member, {
        recentMessages,
        channelContext: this.getCachedChannelContext(message),
      });

      // Use the detection orchestrator unless a high-confidence watchlist entry matched.
      const detectionResult = watchlistMatch
        ? this.createWatchlistDetectionResult(
            content,
            watchlistMatch,
            messageDeletionSettings.sourceMessageDeletionEnabled &&
              !hasExemptPermissions &&
              watchlistMatchOpensCase
          )
        : forceGpt
          ? await this.detectionOrchestrator.detectMessage(serverId, userId, content, profileData, {
              forceGpt: true,
            })
          : await this.detectionOrchestrator.detectMessage(serverId, userId, content, profileData);

      if (forceGpt && !watchlistMatch) {
        this.captureForcedGptMessageAnalytics(
          message.member,
          detectionResult,
          responseSettings,
          recentMessages.length,
          gptMessageCheckCount
        );
      }

      // Source deletion never applies to staff/admin posters; the general exemption
      // setting only controls ordinary automatic detections.
      if (watchlistMatch && hasExemptPermissions) {
        await this.securityActionService.observeSuspiciousMessage(
          message.member,
          {
            ...detectionResult,
            reasons: [
              ...detectionResult.reasons,
              'Poster has moderation or administration permissions; automatic deletion and restriction skipped.',
            ],
            messageAction: detectionResult.messageAction
              ? { ...detectionResult.messageAction, kind: 'review_only' }
              : undefined,
          },
          message
        );
        return;
      }

      await this.handleAutomaticDetection(
        message.member,
        detectionResult,
        responseSettings,
        actionThreshold,
        message
      );
    } catch (error) {
      console.error('Error detecting spam:', error);
      console.error(
        `Details: serverId=${serverId}, userId=${userId}, content length=${content.length}`
      );
      if (error instanceof Error) {
        console.error(
          `Error name: ${error.name}, message: ${error.message}, stack: ${error.stack}`
        );
      }
    } finally {
      this.rememberRecentMessage(message);
    }
  }

  private async getGlobalMessageWatchlistEntries(): Promise<
    readonly GlobalMessageWatchlistEntry[]
  > {
    if (!this.globalMessageWatchlistRepository) {
      return [];
    }

    const now = Date.now();
    if (now < this.globalMessageWatchlistRetryAfter) {
      return this.globalMessageWatchlistCache;
    }

    if (now - this.globalMessageWatchlistLoadedAt < GLOBAL_MESSAGE_WATCHLIST_CACHE_TTL_MS) {
      return this.globalMessageWatchlistCache;
    }

    this.globalMessageWatchlistLoadPromise ??= this.refreshGlobalMessageWatchlistEntries();
    return this.globalMessageWatchlistLoadPromise;
  }

  private async refreshGlobalMessageWatchlistEntries(): Promise<
    readonly GlobalMessageWatchlistEntry[]
  > {
    if (!this.globalMessageWatchlistRepository) {
      return [];
    }

    try {
      const entries = await this.globalMessageWatchlistRepository.findEnabled();
      this.globalMessageWatchlistCache = entries;
      this.globalMessageWatchlistLoadedAt = Date.now();
      this.globalMessageWatchlistRetryAfter = 0;
      this.globalMessageWatchlistHasLoaded = true;
      return entries;
    } catch (error) {
      const failedAt = Date.now();
      this.globalMessageWatchlistRetryAfter =
        failedAt +
        (this.globalMessageWatchlistHasLoaded
          ? GLOBAL_MESSAGE_WATCHLIST_CACHE_TTL_MS
          : GLOBAL_MESSAGE_WATCHLIST_INITIAL_FAILURE_RETRY_MS);
      if (this.globalMessageWatchlistHasLoaded) {
        this.globalMessageWatchlistLoadedAt = failedAt;
      }
      console.warn('Failed to load global message watchlist entries; using stale cache.', error);
      return this.globalMessageWatchlistCache;
    } finally {
      this.globalMessageWatchlistLoadPromise = null;
    }
  }

  private createWatchlistDetectionResult(
    content: string,
    match: MessageWatchlistMatch,
    deleteSourceMessage: boolean
  ): DetectionResult {
    return {
      label: 'SUSPICIOUS',
      confidence: 1,
      reasons: [
        `Matched high-confidence message watchlist: ${match.entry.label}`,
        `Matched watchlist term: ${match.matchedTerm}`,
      ],
      triggerSource: DetectionType.PATTERN_MATCH,
      triggerContent: content,
      messageAction: {
        kind: deleteSourceMessage ? 'delete_source_message' : 'review_only',
        source: 'watchlist',
        watchlistEntryId: match.entry.id,
        watchlistEntryLabel: match.entry.label,
        matchedTerm: match.matchedTerm,
      },
    };
  }

  private isLikelyReportIntakeThread(message: Message): boolean {
    if (!message.channel.isThread()) {
      return false;
    }

    const channelName = (message.channel as { name?: unknown }).name;
    return (
      typeof channelName === 'string' && channelName.startsWith(REPORT_INTAKE_THREAD_NAME_PREFIX)
    );
  }

  private warmServerConfigCache(guildId: string): void {
    if (this.serverConfigWarmups.has(guildId)) {
      return;
    }

    this.serverConfigWarmups.add(guildId);
    void this.configService
      .getServerConfig(guildId)
      .catch((error) => {
        console.warn(`Failed to warm server config cache for guild ${guildId}:`, error);
      })
      .finally(() => {
        this.serverConfigWarmups.delete(guildId);
      });
  }

  private async ensureConfigInitialized(): Promise<void> {
    if (!this.configInitializePromise) {
      const wrappedPromise = this.configService.initialize().catch((error) => {
        // If initialization fails, allow a future call to retry.
        if (this.configInitializePromise === wrappedPromise) {
          this.configInitializePromise = null;
        }
        throw error;
      });

      this.configInitializePromise = wrappedPromise;
    }

    await this.configInitializePromise;
  }

  private async notifyObservedDetectionIfEligible(
    member: GuildMember,
    detectionResult: DetectionResult,
    responseSettings: DetectionResponseSettings,
    sourceMessage?: Message
  ): Promise<void> {
    const confidencePercent = detectionResult.confidence * 100;
    if (confidencePercent < responseSettings.observedMinConfidenceThreshold) {
      console.log(
        `Detection confidence ${confidencePercent.toFixed(2)}% is below observed notification threshold ${responseSettings.observedMinConfidenceThreshold}% for guild ${member.guild.id}; recording only.`
      );
      return;
    }

    const notification = await this.notificationManager.upsertObservedDetectionNotification(
      member,
      detectionResult,
      sourceMessage
    );
    if (notification && detectionResult.detectionEventId) {
      try {
        await this.moderationQueueService?.upsertObservedAlertMirrorById(
          detectionResult.detectionEventId
        );
      } catch (error) {
        console.warn(
          `Failed to mirror observed alert ${detectionResult.detectionEventId} to the live moderation queue:`,
          error
        );
      }
    }
  }

  private async handleAutomaticDetection(
    member: GuildMember,
    detectionResult: DetectionResult,
    responseSettings: DetectionResponseSettings,
    actionThreshold: number,
    sourceMessage?: Message
  ): Promise<void> {
    if (detectionResult.label !== 'SUSPICIOUS') {
      return;
    }

    const confidencePercent = detectionResult.confidence * 100;
    if (responseSettings.mode === 'notify_only' || responseSettings.mode === 'restrict') {
      void this.maybeSendDetectionSetupWarning(member.guild).catch((error) => {
        console.warn(`Failed to process setup warning for guild ${member.guild.id}:`, error);
      });
    }

    const routesWithoutCaseHandling =
      responseSettings.mode === 'record_only' ||
      responseSettings.mode === 'notify_only' ||
      confidencePercent < actionThreshold;
    if (sourceMessage && !detectionResult.detectionEventId && routesWithoutCaseHandling) {
      detectionResult.detectionEventId = await this.securityActionService.recordSuspiciousMessage(
        member,
        detectionResult,
        sourceMessage
      );
    }

    switch (responseSettings.mode) {
      case 'record_only':
        console.log(
          `Recorded suspicious detection for ${member.user.tag}; response mode is record_only.`
        );
        return;

      case 'notify_only':
        await this.notifyObservedDetectionIfEligible(
          member,
          detectionResult,
          responseSettings,
          sourceMessage
        );
        return;

      case 'restrict':
        if (confidencePercent < actionThreshold) {
          await this.notifyObservedDetectionIfEligible(
            member,
            detectionResult,
            responseSettings,
            sourceMessage
          );
          return;
        }
        if (sourceMessage) {
          await this.securityActionService.handleSuspiciousMessage(
            member,
            detectionResult,
            sourceMessage
          );
        } else {
          await this.securityActionService.handleSuspiciousJoin(member, detectionResult);
        }
        return;

      case 'off':
        return;
    }
  }

  private async runJoinDetectionForMember(
    member: GuildMember,
    serverConfig: Server
  ): Promise<void> {
    const responseSettings = getDetectionResponseSettings(serverConfig.settings, 'join');
    if (responseSettings.mode === 'off') {
      console.log(
        `Automatic detection is disabled for guild ${member.guild.id}; skipping join scan.`
      );
      return;
    }
    if (
      responseSettings.automaticDetectionExemptModerators &&
      this.hasAutomaticDetectionExemptPermissions(member)
    ) {
      return;
    }

    const actionThreshold =
      serverConfig.settings.min_confidence_threshold ??
      globalConfig.getSettings().defaultServerSettings.minConfidenceThreshold;
    if (await this.handleRejoinAfterKick(member, responseSettings, actionThreshold)) {
      return;
    }

    // Extract profile data
    const profileData = this.extractUserProfileData(member);

    // Run detection on new join
    const detectionResult = await this.detectionOrchestrator.detectNewJoin(
      member.guild.id, // Pass serverId
      member.id, // Pass userId
      profileData
    );

    await this.handleAutomaticDetection(member, detectionResult, responseSettings, actionThreshold);
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      console.log(`New member joined: ${member.user.tag} (${member.id})`);

      if (this.isAutomaticDetectionExemptByCachedSettings(member)) {
        return;
      }

      await this.ensureConfigInitialized();

      const serverConfig = await this.configService.getServerConfig(member.guild.id);

      if (await this.recordDiscordPendingMemberState(member, this.isPendingGuildMember(member))) {
        console.log(
          `Member ${member.user.tag} (${member.id}) is pending Discord membership screening; join detection will run after screening clears.`
        );
        return;
      }

      await this.runJoinDetectionForMember(member, serverConfig);
    } catch (error) {
      console.error('Error handling new member:', error);
    }
  }

  private async handleGuildMemberUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember
  ): Promise<void> {
    try {
      if (oldMember.partial || newMember.user.bot) {
        return;
      }

      await this.ensureConfigInitialized();
      const serverConfig = await this.configService.getServerConfig(newMember.guild.id);

      await this.enforceActiveCaseRoleQuarantine(oldMember, newMember, serverConfig);
      await this.handleDiscordPendingStateChange(oldMember, newMember, serverConfig);

      const manualSettings = getManualIntakeSettings(serverConfig.settings);
      if (manualSettings.enabled && manualSettings.roleId) {
        if (manualSettings.roleId === serverConfig.case_role_id) {
          console.warn(
            `Manual intake trigger role for guild ${newMember.guild.id} matches the case role; skipping role-triggered intake.`
          );
        } else {
          const hadRole = this.memberHasRole(oldMember, manualSettings.roleId);
          const hasRole = this.memberHasRole(newMember, manualSettings.roleId);
          if (!hadRole && hasRole) {
            this.scheduleManualIntake(
              newMember,
              manualSettings.roleId,
              manualSettings.gracePeriodSeconds
            );
          } else if (hadRole && !hasRole) {
            this.cancelManualIntake(newMember.guild.id, newMember.id, manualSettings.roleId);
          }
        }
      }

      const roleGateSettings = getRoleGateSettings(serverConfig.settings);
      if (
        !roleGateSettings.enabled ||
        !roleGateSettings.honeypotRoleId ||
        roleGateSettings.honeypotResponseMode === 'off'
      ) {
        return;
      }

      const honeypotRoleId = roleGateSettings.honeypotRoleId;
      if (oldMember.roles.cache.has(honeypotRoleId) || !newMember.roles.cache.has(honeypotRoleId)) {
        return;
      }

      const role =
        newMember.guild.roles.cache.get(honeypotRoleId) ??
        (await newMember.guild.roles.fetch(honeypotRoleId).catch(() => null));
      await this.securityActionService.handleHoneypotRoleAssignment(newMember, {
        roleId: honeypotRoleId,
        roleName: role?.name ?? null,
        responseMode: roleGateSettings.honeypotResponseMode,
      });
    } catch (error) {
      console.error(`Error handling member role update for ${newMember.id}:`, error);
    }
  }

  private async enforceActiveCaseRoleQuarantine(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    serverConfig: Server
  ): Promise<void> {
    if (!this.roleQuarantineService || !this.verificationEventRepository) {
      return;
    }

    if (!serverConfig.case_role_id || !this.memberHasRole(newMember, serverConfig.case_role_id)) {
      return;
    }

    const gainedRole = [...newMember.roles.cache.values()].some(
      (role) =>
        role.id !== newMember.guild.id &&
        role.id !== serverConfig.case_role_id &&
        !oldMember.roles.cache.has(role.id)
    );
    if (!gainedRole) {
      return;
    }

    const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
      newMember.id,
      newMember.guild.id
    );
    if (!verificationEvent) {
      return;
    }

    const result = await this.roleQuarantineService.enforceActiveCaseRoleUpdate(
      oldMember,
      newMember,
      verificationEvent
    );
    if (result.removedRoleIds.length > 0 || result.failedRemovals.length > 0) {
      console.log(
        `Active-case role quarantine processed ${result.addedRoleIds.length} role(s) for ${newMember.user.tag}: removed ${result.removedRoleIds.length}, failed ${result.failedRemovals.length}.`
      );
    }
  }

  private async handleDiscordPendingStateChange(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    serverConfig: Server
  ): Promise<void> {
    const wasPending = this.isPendingGuildMember(oldMember);
    const isPending = this.isPendingGuildMember(newMember);
    if (wasPending === isPending) {
      return;
    }

    await this.recordDiscordPendingMemberState(newMember, isPending);
    if (isPending) {
      console.log(
        `Member ${newMember.user.tag} (${newMember.id}) entered Discord membership screening.`
      );
      return;
    }

    console.log(
      `Member ${newMember.user.tag} (${newMember.id}) cleared Discord membership screening; running join detection and case repair.`
    );
    await this.deletePendingScreeningQueueItem(newMember.guild.id, newMember.id);
    await this.runJoinDetectionForMember(newMember, serverConfig);

    const repair = await this.securityActionService.repairActiveCase(newMember);
    if (repair.repaired || repair.verificationEventId) {
      console.log(repair.message);
    }
  }

  private async recordDiscordPendingMemberState(
    member: GuildMember,
    pending: boolean
  ): Promise<boolean> {
    await this.securityActionService.recordDiscordPendingMemberState(member, pending);
    return pending;
  }

  private isPendingGuildMember(member: GuildMember | PartialGuildMember): boolean {
    return (member as { pending?: boolean }).pending === true;
  }

  private async deletePendingScreeningQueueItem(serverId: string, userId: string): Promise<void> {
    await this.moderationQueueService
      ?.deletePendingScreeningMember(serverId, userId)
      .catch((error) => {
        console.warn(
          `Failed to delete pending-screening queue item for ${userId} in guild ${serverId}:`,
          error
        );
      });
  }

  private scheduleManualIntake(
    member: GuildMember,
    roleId: string,
    gracePeriodSeconds: number
  ): void {
    const key = this.buildManualIntakeKey(member.guild.id, member.id, roleId);
    if (this.manualIntakeTimers.has(key)) {
      return;
    }

    const timer = setTimeout(() => {
      this.manualIntakeTimers.delete(key);
      void this.runManualIntake(member, roleId, gracePeriodSeconds).catch((error) => {
        console.error(`Failed to process manual intake role ${roleId} for ${member.id}:`, error);
      });
    }, gracePeriodSeconds * 1000);
    (timer as { unref?: () => void }).unref?.();
    this.manualIntakeTimers.set(key, timer);
  }

  private cancelManualIntake(guildId: string, userId: string, roleId: string): void {
    const key = this.buildManualIntakeKey(guildId, userId, roleId);
    const timer = this.manualIntakeTimers.get(key);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.manualIntakeTimers.delete(key);
  }

  private cancelManualIntakeForMember(guildId: string, userId: string): void {
    for (const key of this.manualIntakeTimers.keys()) {
      if (!key.startsWith(`${guildId}:${userId}:`)) {
        continue;
      }

      const timer = this.manualIntakeTimers.get(key);
      if (timer) {
        clearTimeout(timer);
      }
      this.manualIntakeTimers.delete(key);
    }
  }

  private buildManualIntakeKey(guildId: string, userId: string, roleId: string): string {
    return `${guildId}:${userId}:${roleId}`;
  }

  private async runManualIntake(
    originalMember: GuildMember,
    roleId: string,
    scheduledGracePeriodSeconds: number
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(originalMember.guild.id);
    const settings = getManualIntakeSettings(serverConfig.settings);
    if (!settings.enabled || settings.roleId !== roleId) {
      return;
    }
    if (roleId === serverConfig.case_role_id) {
      console.warn(
        `Manual intake trigger role for guild ${originalMember.guild.id} matches the case role; skipping role-triggered intake.`
      );
      return;
    }

    const member = await originalMember.guild.members.fetch(originalMember.id).catch(() => null);
    if (!member || member.user.bot || !this.memberHasRole(member, roleId)) {
      return;
    }

    const auditLogAgeBudgetMs = scheduledGracePeriodSeconds * 1000 + DISCORD_RECENT_AUDIT_WINDOW_MS;
    const assignedBy = await this.resolveManualIntakeAssignedBy(
      member,
      roleId,
      auditLogAgeBudgetMs
    );
    const moderator = assignedBy ?? this.client.user;
    if (!moderator) {
      console.warn(
        `Manual intake role ${roleId} assigned to ${member.id}, but no moderator or bot user was available to open a case.`
      );
      return;
    }

    const roleName = await this.resolveManualIntakeRoleName(member, roleId);
    const result = await this.securityActionService.openAdminCase(member, moderator, {
      action: 'open_case',
      reason: `Manual intake role ${roleName} assigned.`,
      metadata: {
        type: 'manual_role_intake',
        bulk_intake: false,
        trigger: 'manual_role_assignment',
        sourceRoleId: roleId,
        sourceRoleName: roleName,
        assignedById: assignedBy?.id ?? null,
      },
    });

    if (result.opened) {
      await this.removeManualIntakeRole(member, roleId);
    }
  }

  private async resolveManualIntakeRoleName(member: GuildMember, roleId: string): Promise<string> {
    const cachedRole = member.guild.roles.cache.get(roleId);
    if (cachedRole) {
      return cachedRole.name;
    }

    const fetchedRole = await member.guild.roles.fetch(roleId).catch(() => null);
    return fetchedRole?.name ?? roleId;
  }

  private async removeManualIntakeRole(member: GuildMember, roleId: string): Promise<void> {
    if (!this.memberHasRole(member, roleId)) {
      return;
    }

    try {
      await member.roles.remove(roleId, MANUAL_INTAKE_ROLE_REMOVAL_REASON);
    } catch (error) {
      console.warn(
        `Failed to remove manual intake trigger role ${roleId} from ${member.id}:`,
        error
      );
    }
  }

  private async resolveManualIntakeAssignedBy(
    member: GuildMember,
    roleId: string,
    maxAgeMs: number
  ): Promise<User | null> {
    if (typeof member.guild.fetchAuditLogs !== 'function') {
      return null;
    }

    try {
      const auditLogs = await member.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberRoleUpdate,
        limit: 5,
      });
      const roleUpdateEntry = auditLogs.entries.find(
        (entry) =>
          entry.target?.id === member.id &&
          this.isRecentAuditLogEntry(entry, maxAgeMs) &&
          this.auditLogEntryAddedRole(entry, roleId)
      );
      const executor = roleUpdateEntry?.executor;
      if (!executor) {
        return null;
      }

      const userManager = (this.client as { users?: { fetch(id: string): Promise<User> } }).users;
      return (await userManager?.fetch(executor.id).catch(() => null)) ?? (executor as User);
    } catch (error) {
      console.warn(
        `Could not read member role update audit log for guild ${member.guild.id}:`,
        error
      );
      return null;
    }
  }

  private auditLogEntryAddedRole(entry: { changes?: unknown }, roleId: string): boolean {
    if (!Array.isArray(entry.changes)) {
      return false;
    }

    const addedRoles = entry.changes.find(
      (change): change is { key: string; new: Array<{ id?: unknown }> } =>
        typeof change === 'object' &&
        change !== null &&
        'key' in change &&
        change.key === '$add' &&
        'new' in change &&
        Array.isArray(change.new)
    );

    return addedRoles?.new.some((role) => role.id === roleId) ?? false;
  }

  private memberHasRole(member: GuildMember | PartialGuildMember, roleId: string): boolean {
    return member.roles.cache.has(roleId);
  }

  private async handleGuildBanAdd(ban: GuildBan): Promise<void> {
    if (!this.userModerationService) {
      return;
    }

    try {
      const options = await this.resolveObservedBanOptions(ban);
      const resolvedCount = await this.userModerationService.recordObservedDiscordBan(
        ban.guild,
        ban.user,
        options
      );
      if (resolvedCount > 0) {
        console.log(
          `Resolved ${resolvedCount} pending case(s) for ${ban.user.tag} after observing Discord ban in guild ${ban.guild.id}.`
        );
      }
    } catch (error) {
      console.error(`Error handling guild ban for ${ban.user.id} in guild ${ban.guild.id}:`, error);
    }
  }

  private async handleGuildMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    this.cancelManualIntakeForMember(member.guild.id, member.id);

    if (!this.userModerationService) {
      await this.deletePendingScreeningQueueItem(member.guild.id, member.id);
      return;
    }

    try {
      if (!(await this.isDefinitelyNotBanned(member))) {
        return;
      }

      const kickOptions = await this.resolveObservedKickOptions(member);
      if (kickOptions) {
        const kickedCount = await this.userModerationService.recordObservedDiscordKick(
          member,
          kickOptions
        );
        if (kickedCount > 0) {
          console.log(
            `Resolved ${kickedCount} pending case(s) for ${member.user.tag} after observing Discord kick in guild ${member.guild.id}.`
          );
        }
        return;
      }

      const markedCount = await this.userModerationService.recordMemberLeftGuild(member);
      if (markedCount > 0) {
        console.log(
          `Marked ${markedCount} pending case(s) for ${member.user.tag} after member removal in guild ${member.guild.id}.`
        );
      }
    } catch (error) {
      console.error(
        `Error handling member removal for ${member.id} in guild ${member.guild.id}:`,
        error
      );
    }
  }

  private async isDefinitelyNotBanned(member: GuildMember | PartialGuildMember): Promise<boolean> {
    try {
      const existingBan = await member.guild.bans.fetch(member.id);
      return !existingBan;
    } catch (error) {
      if (isDiscordUnknownBanError(error)) {
        return true;
      }

      console.warn(
        `Could not confirm ban state for ${member.id} in guild ${member.guild.id}:`,
        error
      );
      return false;
    }
  }

  private async resolveObservedBanOptions(ban: GuildBan): Promise<ObservedDiscordBanOptions> {
    const baseOptions: ObservedDiscordBanOptions = {
      source: ModerationOutcomeSource.UNKNOWN_EXTERNAL,
      reason: ban.reason ?? null,
      sourceDetail: 'guildBanAdd',
    };

    try {
      const auditLogs = await ban.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberBanAdd,
        limit: 5,
      });
      const banEntry = auditLogs.entries.find((entry) => entry.target?.id === ban.user.id);
      if (!banEntry?.executor) {
        return baseOptions;
      }

      return {
        ...baseOptions,
        source: this.resolveAuditLogOutcomeSource(banEntry.executor.id, banEntry.executor.bot),
        actorId: banEntry.executor.id,
        auditLogEntryId: banEntry.id,
      };
    } catch (error) {
      console.warn(`Could not read ban audit log for guild ${ban.guild.id}:`, error);
      return baseOptions;
    }
  }

  private async resolveObservedKickOptions(
    member: GuildMember | PartialGuildMember
  ): Promise<ObservedDiscordKickOptions | null> {
    if (typeof member.guild.fetchAuditLogs !== 'function') {
      return null;
    }

    try {
      const auditLogs = await member.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberKick,
        limit: 5,
      });
      const kickEntry = auditLogs.entries.find(
        (entry) => entry.target?.id === member.id && this.isRecentAuditLogEntry(entry)
      );
      if (!kickEntry) {
        return null;
      }

      const occurredAt = this.getAuditLogEntryDate(kickEntry);
      return {
        source: kickEntry.executor
          ? this.resolveAuditLogOutcomeSource(kickEntry.executor.id, kickEntry.executor.bot)
          : ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        actorId: kickEntry.executor?.id ?? null,
        reason: kickEntry.reason ?? null,
        sourceDetail: 'guildMemberRemove:memberKickAuditLog',
        auditLogEntryId: kickEntry.id,
        ...(occurredAt ? { occurredAt } : {}),
      };
    } catch (error) {
      console.warn(`Could not read kick audit log for guild ${member.guild.id}:`, error);
      return null;
    }
  }

  private isRecentAuditLogEntry(
    entry: { createdTimestamp?: unknown },
    maxAgeMs = DISCORD_RECENT_AUDIT_WINDOW_MS
  ): boolean {
    if (typeof entry.createdTimestamp !== 'number' || !Number.isFinite(entry.createdTimestamp)) {
      return true;
    }

    return Date.now() - entry.createdTimestamp <= maxAgeMs;
  }

  private getAuditLogEntryDate(entry: { createdTimestamp?: unknown }): Date | null {
    if (typeof entry.createdTimestamp !== 'number' || !Number.isFinite(entry.createdTimestamp)) {
      return null;
    }

    return new Date(entry.createdTimestamp);
  }

  private resolveAuditLogOutcomeSource(
    executorId: string,
    executorIsBot: boolean
  ): ModerationOutcomeSource {
    if (executorId === this.client.user?.id) {
      return ModerationOutcomeSource.DRASIL;
    }

    return executorIsBot
      ? ModerationOutcomeSource.EXTERNAL_BOT
      : ModerationOutcomeSource.NATIVE_DISCORD;
  }

  private async handleRejoinAfterKick(
    member: GuildMember,
    responseSettings: DetectionResponseSettings,
    actionThreshold: number
  ): Promise<boolean> {
    const priorKick = await this.userModerationService?.findLatestKickOutcome(
      member.guild.id,
      member.id
    );
    if (!priorKick) {
      return false;
    }

    const detectionResult = await this.securityActionService.recordRejoinAfterKickDetection(
      member,
      priorKick
    );

    if (responseSettings.mode === 'record_only') {
      console.log(
        `Recorded rejoin-after-kick detection for ${member.user.tag}; response mode is record_only.`
      );
      return true;
    }

    await this.handleAutomaticDetection(member, detectionResult, responseSettings, actionThreshold);
    return true;
  }

  /**
   * Helper method to extract user profile data for GPT analysis
   * Only includes data directly available through Discord.js API
   */
  private extractUserProfileData(
    member: GuildMember,
    context?: Pick<UserProfileData, 'recentMessages' | 'channelContext'>
  ): UserProfileData {
    // Ensure serverId and userId are included for detectNewJoin context
    return {
      serverId: member.guild.id, // Added serverId
      userId: member.id, // Added userId
      username: member.user.username,
      discriminator: member.user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(member.user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      recentMessages: context?.recentMessages ?? [],
      channelContext: context?.channelContext ?? [],
      isGuildOwner: member.guild.ownerId === member.id,
      hasModerationPermissions: this.hasAutomaticDetectionExemptPermissions(member),
      moderationPermissions: this.getModerationPermissionSummary(member),
    };
  }

  private hasAutomaticDetectionExemptPermissions(member: GuildMember): boolean {
    return member.permissions.any([
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ]);
  }

  private isAutomaticDetectionExemptByCachedSettings(member: GuildMember): boolean {
    const cachedConfig = this.configService.getCachedServerConfig(member.guild.id);
    if (!cachedConfig?.settings) {
      return false;
    }

    const responseSettings = getDetectionResponseSettings(cachedConfig.settings);

    return (
      responseSettings.automaticDetectionExemptModerators &&
      this.hasAutomaticDetectionExemptPermissions(member)
    );
  }

  private getModerationPermissionSummary(member: GuildMember): string[] {
    const permissions = [
      { flag: PermissionFlagsBits.Administrator, label: 'administrator' },
      { flag: PermissionFlagsBits.ManageGuild, label: 'manage_guild' },
      { flag: PermissionFlagsBits.ModerateMembers, label: 'moderate_members' },
      { flag: PermissionFlagsBits.KickMembers, label: 'kick_members' },
      { flag: PermissionFlagsBits.BanMembers, label: 'ban_members' },
    ];

    return permissions.filter(({ flag }) => member.permissions.has(flag)).map(({ label }) => label);
  }

  private async getRecentUserMessages(serverId: string, userId: string): Promise<string[]> {
    if (!this.messageContextRepository) {
      return [];
    }

    try {
      const messages = await this.messageContextRepository.findRecentByServerAndUser(
        serverId,
        userId,
        MESSAGE_CONTEXT_USER_LIMIT
      );
      return messages.map((message) => message.content_preview);
    } catch (error) {
      console.warn(
        `Failed to load persistent message context for user ${userId} in guild ${serverId}:`,
        error
      );
      return [];
    }
  }

  private getGptMessageCheckCount(settings: ServerSettings): number | null {
    const configuredCount = settings.gpt_message_check_count;
    if (
      typeof configuredCount === 'number' &&
      Number.isFinite(configuredCount) &&
      configuredCount > 0
    ) {
      return Math.min(configuredCount, MESSAGE_CONTEXT_USER_LIMIT);
    }

    return null;
  }

  private captureForcedGptMessageAnalytics(
    member: GuildMember,
    detectionResult: DetectionResult,
    responseSettings: DetectionResponseSettings,
    recentMessageCount: number,
    gptMessageCheckCount: number
  ): void {
    void this.productAnalyticsService.captureUserEvent(
      member.guild.id,
      member.id,
      'message detection forced gpt analyzed',
      {
        detection_type: detectionResult.triggerSource,
        detection_label: detectionResult.label,
        confidence: detectionResult.confidence,
        confidence_bucket: getConfidenceBucket(detectionResult.confidence),
        detection_response_mode: responseSettings.mode,
        gpt_force_reason: 'first_recent_messages',
        gpt_force_net_new:
          detectionResult.gptTriggerReasons?.length === 1 &&
          detectionResult.gptTriggerReasons[0] === 'first_recent_messages',
        gpt_trigger_reasons: detectionResult.gptTriggerReasons,
        recent_message_count: recentMessageCount,
        gpt_message_check_count: gptMessageCheckCount,
        gpt_used: detectionResult.gptAnalysis !== undefined,
        gpt_result: detectionResult.gptAnalysis?.result,
        gpt_confidence: detectionResult.gptAnalysis?.confidence,
        gpt_confidence_bucket: detectionResult.gptAnalysis
          ? getConfidenceBucket(detectionResult.gptAnalysis.confidence)
          : undefined,
        gpt_primary_signal: detectionResult.gptAnalysis?.primarySignal,
        gpt_reason_codes: detectionResult.gptAnalysis?.reasonCodes,
        gpt_is_fallback: detectionResult.gptAnalysis?.isFallback,
      },
      { detectionEventId: detectionResult.detectionEventId }
    );
  }

  private rememberRecentMessage(message: Message): void {
    if (!this.messageContextRepository || !message.guild || message.author.bot) {
      return;
    }

    const content = message.content.trim();
    if (!content) {
      return;
    }

    const now = Date.now();
    const expiresAt = new Date(now + MESSAGE_CONTEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    void this.messageContextRepository
      .recordMessage({
        serverId: message.guild.id,
        userId: message.author.id,
        messageId: message.id,
        channelId: message.channelId,
        contentPreview: content.slice(0, MESSAGE_CONTEXT_PREVIEW_MAX_LENGTH),
        contentFeatures: this.extractMessageContextFeatures(message, content),
        createdAt: new Date(message.createdTimestamp || now),
        observedAt: new Date(now),
        expiresAt,
      })
      .catch((error) => {
        console.warn(
          `Failed to persist message context for ${message.author.id} in guild ${message.guild?.id}:`,
          error
        );
      });

    if (now - this.lastMessageContextPruneAt >= MESSAGE_CONTEXT_PRUNE_INTERVAL_MS) {
      this.lastMessageContextPruneAt = now;
      void this.messageContextRepository.pruneExpired(new Date(now)).catch((error) => {
        console.warn('Failed to prune expired message context:', error);
      });
    }
  }

  private extractMessageContextFeatures(
    message: Message,
    content: string
  ): Record<string, unknown> {
    const urlMatches = content.match(/https?:\/\/\S+|www\.\S+/gi) ?? [];
    const mentionMatches = content.match(/<[@#&!?]*\d{17,20}>|@(everyone|here)\b/gi) ?? [];
    const attachmentCount = (message as { attachments?: { size: number } }).attachments?.size ?? 0;

    return {
      length: content.length,
      url_count: urlMatches.length,
      mention_count: mentionMatches.length,
      attachment_count: attachmentCount,
      has_discord_invite: /(?:discord\.gg|discord\.com\/invite)\//i.test(content),
      in_thread: message.channel.isThread(),
    };
  }

  private getCachedChannelContext(message: Message): string[] {
    try {
      const cachedMessages = (message.channel as CachedMessageChannel).messages.cache;

      return Array.from(cachedMessages.values())
        .filter(
          (contextMessage) =>
            contextMessage.id !== message.id &&
            contextMessage.createdTimestamp < message.createdTimestamp &&
            contextMessage.author.id !== message.author.id &&
            !contextMessage.author.bot &&
            contextMessage.content.trim()
        )
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, CHANNEL_CONTEXT_MESSAGE_LIMIT)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map((contextMessage) => `other_user: ${contextMessage.content.trim()}`);
    } catch {
      return [];
    }
  }

  /**
   * Handle when the bot joins a new guild
   */
  private async handleGuildCreate(guild: Guild): Promise<void> {
    try {
      console.log(`Bot joined new guild: ${guild.name} (${guild.id})`);

      // Create default configuration for the new guild
      let config = await this.configService.getServerConfig(guild.id);
      console.log(`Created default configuration for guild: ${guild.name} (${guild.id})`);

      // Set up verification channel if auto_setup is enabled globally
      let verificationChannelWasCreated = false;
      if (globalConfig.getSettings().autoSetupVerificationChannels) {
        const caseRoleId = config.case_role_id;
        if (caseRoleId) {
          const channelId = await this.notificationManager.setupVerificationChannel(
            guild,
            caseRoleId,
            false
          );
          if (channelId) {
            // Update the configuration with the new channel ID
            await this.configService.updateServerConfig(guild.id, {
              verification_channel_id: channelId,
            });
            config = { ...config, verification_channel_id: channelId };
            verificationChannelWasCreated = true;
            console.log(`Set up verification channel for guild: ${guild.name} (${guild.id})`);
          }
        }
      }

      void this.productAnalyticsService.captureGuildEvent(guild.id, 'guild installed', {
        auto_setup_verification_channels: globalConfig.getSettings().autoSetupVerificationChannels,
        verification_channel_auto_created: verificationChannelWasCreated,
      });

      const finalConfig = await this.configService.getServerConfig(guild.id).catch(() => config);
      await this.maybeSendSetupNudge(guild, finalConfig);
    } catch (error) {
      console.error(`Failed to handle new guild ${guild.id}:`, error);
    }
  }

  private async maybeSendSetupNudge(guild: Guild, config: Server): Promise<void> {
    if (!this.isSetupIncomplete(config)) {
      return;
    }

    if (
      !config.settings.setup_nudge_last_recipient_id &&
      this.wasSetupNudgeRecentlyAttempted(config.settings.setup_nudge_last_attempt_at, null, null)
    ) {
      return;
    }

    const recipient = await this.resolveSetupNudgeRecipient(guild);
    if (
      this.wasSetupNudgeRecentlyAttempted(
        config.settings.setup_nudge_last_attempt_at,
        config.settings.setup_nudge_last_recipient_id,
        recipient?.user.id ?? null
      )
    ) {
      return;
    }

    const attemptedAt = new Date().toISOString();
    let result: SetupNudgeResult = 'no_recipient';

    if (recipient) {
      try {
        await recipient.user.send(this.buildSetupNudgeMessage(guild));
        result = 'sent';
      } catch (error) {
        result = 'dm_failed';
        console.warn(`Failed to DM setup nudge for guild ${guild.id}:`, error);
      }
    }

    try {
      await this.configService.updateServerSettings(guild.id, {
        setup_nudge_last_attempt_at: attemptedAt,
        setup_nudge_last_recipient_id: recipient?.user.id ?? null,
        setup_nudge_last_result: result,
        setup_nudge_last_source: recipient?.source ?? null,
      });
    } catch (error) {
      console.warn(`Failed to record setup nudge metadata for guild ${guild.id}:`, error);
    }
  }

  private async maybeSendDetectionSetupWarning(guild: Guild): Promise<void> {
    if (!this.setupDiagnosticsService) {
      return;
    }

    const config = await this.configService.getServerConfig(guild.id);
    // Detection warnings share setup nudge metadata with guild-join nudges to keep
    // all setup-related DMs under one short burst guard.
    if (
      this.wasSetupNudgeAttemptedWithin(
        config.settings.setup_nudge_last_attempt_at,
        SETUP_WARNING_VALIDATION_PRECHECK_MS
      )
    ) {
      return;
    }

    const report = await this.setupDiagnosticsService.validateGuildSetup(guild);
    if (report.errorCount === 0) {
      return;
    }

    const fingerprint = this.createSetupWarningFingerprint(report);
    const recipient = await this.resolveSetupNudgeRecipient(guild);
    if (
      this.wasSetupNudgeRecentlyAttempted(
        config.settings.setup_nudge_last_attempt_at,
        config.settings.setup_nudge_last_recipient_id,
        recipient?.user.id ?? null,
        config.settings.setup_warning_last_fingerprint,
        fingerprint
      )
    ) {
      return;
    }

    const attemptedAt = new Date().toISOString();
    let result: SetupNudgeResult = 'no_recipient';

    if (recipient) {
      try {
        await recipient.user.send(this.buildDetectionSetupWarningMessage(guild, report));
        result = 'sent';
      } catch (error) {
        result = 'dm_failed';
        console.warn(`Failed to DM detection setup warning for guild ${guild.id}:`, error);
      }
    }

    try {
      await this.configService.updateServerSettings(guild.id, {
        setup_nudge_last_attempt_at: attemptedAt,
        setup_nudge_last_recipient_id: recipient?.user.id ?? null,
        setup_nudge_last_result: result,
        setup_nudge_last_source: recipient?.source ?? null,
        [SETUP_WARNING_LAST_FINGERPRINT_SETTING_KEY]: fingerprint,
      });
    } catch (error) {
      console.warn(`Failed to record setup warning metadata for guild ${guild.id}:`, error);
    }
  }

  private isSetupIncomplete(config: Server): boolean {
    return !config.case_role_id || !config.admin_channel_id || !config.verification_channel_id;
  }

  private wasSetupNudgeRecentlyAttempted(
    lastAttemptAt: string | null | undefined,
    lastRecipientId: string | null | undefined,
    currentRecipientId: string | null,
    lastFingerprint?: string | null,
    currentFingerprint?: string | null
  ): boolean {
    if ((lastRecipientId ?? null) !== currentRecipientId) {
      return false;
    }

    if (currentFingerprint && lastFingerprint !== currentFingerprint) {
      return false;
    }

    return this.wasSetupNudgeAttemptedWithin(lastAttemptAt, SETUP_NUDGE_SUPPRESSION_MS);
  }

  private wasSetupNudgeAttemptedWithin(
    lastAttemptAt: string | null | undefined,
    windowMs: number
  ): boolean {
    if (!lastAttemptAt) {
      return false;
    }

    const attemptedAtMs = Date.parse(lastAttemptAt);
    if (Number.isNaN(attemptedAtMs)) {
      return false;
    }

    return Date.now() - attemptedAtMs < windowMs;
  }

  private createSetupWarningFingerprint(report: SetupDiagnosticReport): string {
    return report.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => issue.code)
      .sort()
      .join('|');
  }

  private async resolveSetupNudgeRecipient(guild: Guild): Promise<SetupNudgeRecipient | null> {
    const auditLogInstaller = await this.resolveAuditLogInstaller(guild);
    if (auditLogInstaller) {
      return auditLogInstaller;
    }

    return this.resolveOwnerRecipient(guild);
  }

  private async resolveAuditLogInstaller(guild: Guild): Promise<SetupNudgeRecipient | null> {
    const botUserId = this.client.user?.id;
    if (!botUserId) {
      return null;
    }

    try {
      const auditLogs = await guild.fetchAuditLogs({
        type: AuditLogEvent.BotAdd,
        limit: 5,
      });
      const installEntry = auditLogs.entries.find(
        (entry) => entry.target?.id === botUserId && entry.executor && !entry.executor.bot
      );

      return installEntry?.executor
        ? { user: installEntry.executor, source: 'audit_log_installer' }
        : null;
    } catch (error) {
      console.warn(`Could not read bot install audit log for guild ${guild.id}:`, error);
      return null;
    }
  }

  private async resolveOwnerRecipient(guild: Guild): Promise<SetupNudgeRecipient | null> {
    try {
      const owner = await guild.fetchOwner();
      if (owner.user.bot) {
        return null;
      }
      return { user: owner.user, source: 'owner' };
    } catch (error) {
      console.warn(`Could not resolve owner for setup nudge in guild ${guild.id}:`, error);
      return null;
    }
  }

  private buildSetupNudgeMessage(guild: Guild): string {
    return [
      `Thanks for installing Drasil in ${guild.name}.`,
      'Finish setup by running `/config setup admin-channel:<moderator-channel>` in the server.',
      'Omit `case-role` and `verification-channel` if you want Drasil to create safe defaults.',
      'Add `report-channel:<channel>` if you want Drasil to create or update report instructions.',
      'Run `/config validate` afterwards to check permissions, channels, and role hierarchy.',
    ].join('\n');
  }

  private buildDetectionSetupWarningMessage(guild: Guild, report: SetupDiagnosticReport): string {
    const topIssues = report.issues
      .filter((issue) => issue.severity === 'error')
      .slice(0, 5)
      .map((issue) => `- ${issue.message}`);

    return [
      `Drasil detected suspicious activity in ${guild.name}, but setup or permissions may prevent the configured response from working.`,
      'No message content is included in this DM.',
      '',
      'Must fix:',
      ...topIssues,
      '',
      'Run `/config validate` in the server for the full checklist.',
      'Run `/config setup admin-channel:<moderator-channel>` to repair core setup.',
    ].join('\n');
  }
}
