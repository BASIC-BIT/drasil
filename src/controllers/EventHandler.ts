import {
  AuditLogEvent,
  Client,
  Message,
  GuildMember,
  Interaction,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
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
import { Server } from '../repositories/types';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';

const RECENT_USER_CONTEXT_MESSAGE_LIMIT = 5;
const RECENT_USER_CONTEXT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_USER_CONTEXT_CLEANUP_INTERVAL_MS = 60 * 1000;
const RECENT_USER_CONTEXT_MAX_USERS_PER_SERVER = 1000;
const RECENT_USER_CONTEXT_MAX_SERVERS = 100;
const CHANNEL_CONTEXT_MESSAGE_LIMIT = 5;
const SETUP_NUDGE_SUPPRESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_WARNING_LAST_FINGERPRINT_SETTING_KEY = 'setup_warning_last_fingerprint';

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

interface RecentUserMessageContext {
  content: string;
  createdTimestamp: number;
  channelId?: string;
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
  private serverConfigWarmups: Set<string> = new Set();
  private configInitializePromise: Promise<void> | null = null;
  private recentMessagesByServer: Map<string, Map<string, RecentUserMessageContext[]>> = new Map();
  private lastRecentMessageContextCleanupAt = 0;

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
    setupDiagnosticsService?: ISetupDiagnosticsService
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
  }

  public async setupEventHandlers(): Promise<void> {
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('guildCreate', this.handleGuildCreate.bind(this));
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
      } else if (interaction.isUserSelectMenu()) {
        await this.interactionHandler.handleUserSelectMenuInteraction(interaction);
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

    // Extract user data for detection
    const userId = message.author.id;
    const serverId = message.guild.id;
    const content = message.content;
    const recentMessages = this.getRecentUserMessages(serverId, userId);

    if (this.isAutomaticDetectionExemptByCachedSettings(message.member)) {
      this.rememberRecentMessage(message);
      return;
    }

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
      const responseSettings = getDetectionResponseSettings(serverConfig.settings);
      if (responseSettings.mode === 'off') {
        console.log(
          `Automatic detection is disabled for guild ${serverId}; skipping message scan.`
        );
        return;
      }
      if (
        responseSettings.automaticDetectionExemptModerators &&
        this.hasAutomaticDetectionExemptPermissions(message.member)
      ) {
        return;
      }

      // Get user profile data for detection context
      const profileData = this.extractUserProfileData(message.member, {
        recentMessages,
        channelContext: this.getCachedChannelContext(message),
      });

      // Use the detection orchestrator to analyze the message
      const detectionResult = await this.detectionOrchestrator.detectMessage(
        serverId,
        userId,
        content,
        profileData
      );

      await this.handleAutomaticDetection(
        message.member,
        detectionResult,
        responseSettings,
        serverConfig.settings.min_confidence_threshold ??
          globalConfig.getSettings().defaultServerSettings.minConfidenceThreshold,
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

    await this.notificationManager.upsertObservedDetectionNotification(
      member,
      detectionResult,
      sourceMessage
    );
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
    if (
      responseSettings.mode === 'notify_only' ||
      responseSettings.mode === 'open_case' ||
      responseSettings.mode === 'restrict'
    ) {
      void this.maybeSendDetectionSetupWarning(member.guild).catch((error) => {
        console.warn(`Failed to process setup warning for guild ${member.guild.id}:`, error);
      });
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

      case 'open_case':
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
          await this.securityActionService.openCaseForSuspiciousMessage(
            member,
            detectionResult,
            sourceMessage
          );
        } else {
          await this.securityActionService.openCaseForSuspiciousJoin(member, detectionResult);
        }
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

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      console.log(`New member joined: ${member.user.tag} (${member.id})`);

      if (this.isAutomaticDetectionExemptByCachedSettings(member)) {
        return;
      }

      await this.ensureConfigInitialized();

      const serverConfig = await this.configService.getServerConfig(member.guild.id);
      const responseSettings = getDetectionResponseSettings(serverConfig.settings);
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

      // Extract profile data
      const profileData = this.extractUserProfileData(member);

      // Run detection on new join
      const detectionResult = await this.detectionOrchestrator.detectNewJoin(
        member.guild.id, // Pass serverId
        member.id, // Pass userId
        profileData
      );

      await this.handleAutomaticDetection(
        member,
        detectionResult,
        responseSettings,
        serverConfig.settings.min_confidence_threshold ??
          globalConfig.getSettings().defaultServerSettings.minConfidenceThreshold
      );
    } catch (error) {
      console.error('Error handling new member:', error);
    }
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

  private getRecentUserMessages(serverId: string, userId: string): string[] {
    const serverMessages = this.recentMessagesByServer.get(serverId);
    const messages = serverMessages?.get(userId) ?? [];
    const cutoff = Date.now() - RECENT_USER_CONTEXT_MAX_AGE_MS;
    const recentMessages = messages.filter((message) => message.createdTimestamp > cutoff);

    if (serverMessages && recentMessages.length !== messages.length) {
      if (recentMessages.length > 0) {
        serverMessages.set(userId, recentMessages);
      } else {
        serverMessages.delete(userId);
      }
    }

    return recentMessages.map((message) => message.content);
  }

  private rememberRecentMessage(message: Message): void {
    if (!message.guild || message.author.bot) {
      return;
    }

    const content = message.content.trim();
    if (!content) {
      return;
    }

    const now = Date.now();
    this.pruneRecentMessageContext(now);

    const serverId = message.guild.id;
    const userId = message.author.id;
    const serverMessages =
      this.recentMessagesByServer.get(serverId) ?? new Map<string, RecentUserMessageContext[]>();
    const cutoff = now - RECENT_USER_CONTEXT_MAX_AGE_MS;
    const previousMessages = serverMessages.get(userId) ?? [];
    const nextMessages = [
      ...previousMessages.filter((entry) => entry.createdTimestamp > cutoff),
      {
        content,
        createdTimestamp: message.createdTimestamp || now,
        channelId: message.channelId,
      },
    ].slice(-RECENT_USER_CONTEXT_MESSAGE_LIMIT);

    serverMessages.delete(userId);
    serverMessages.set(userId, nextMessages);
    while (serverMessages.size > RECENT_USER_CONTEXT_MAX_USERS_PER_SERVER) {
      const oldestUserId = serverMessages.keys().next().value as string | undefined;
      if (!oldestUserId) {
        break;
      }
      serverMessages.delete(oldestUserId);
    }

    this.recentMessagesByServer.set(serverId, serverMessages);
  }

  private pruneRecentMessageContext(now: number): void {
    if (now - this.lastRecentMessageContextCleanupAt < RECENT_USER_CONTEXT_CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastRecentMessageContextCleanupAt = now;

    const cutoff = now - RECENT_USER_CONTEXT_MAX_AGE_MS;
    for (const [serverId, serverMessages] of this.recentMessagesByServer.entries()) {
      for (const [userId, messages] of serverMessages.entries()) {
        const recentMessages = messages.filter((message) => message.createdTimestamp > cutoff);
        if (recentMessages.length > 0) {
          serverMessages.set(userId, recentMessages);
        } else {
          serverMessages.delete(userId);
        }
      }

      if (serverMessages.size === 0) {
        this.recentMessagesByServer.delete(serverId);
      }
    }

    while (this.recentMessagesByServer.size > RECENT_USER_CONTEXT_MAX_SERVERS) {
      const oldestServerId = this.recentMessagesByServer.keys().next().value as string | undefined;
      if (!oldestServerId) {
        break;
      }
      this.recentMessagesByServer.delete(oldestServerId);
    }
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
        const restrictedRoleId = config.restricted_role_id;
        if (restrictedRoleId) {
          const channelId = await this.notificationManager.setupVerificationChannel(
            guild,
            restrictedRoleId,
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
    return (
      !config.restricted_role_id || !config.admin_channel_id || !config.verification_channel_id
    );
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

    if (!lastAttemptAt) {
      return false;
    }

    const attemptedAtMs = Date.parse(lastAttemptAt);
    if (Number.isNaN(attemptedAtMs)) {
      return false;
    }

    return Date.now() - attemptedAtMs < SETUP_NUDGE_SUPPRESSION_MS;
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
      'Omit `restricted-role` and `verification-channel` if you want Drasil to create safe defaults.',
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
