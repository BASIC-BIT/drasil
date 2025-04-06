import { Client, Message, GuildMember, Interaction, Guild, MessageFlags } from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { UserProfileData } from '../services/GPTService';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { INotificationManager } from '../services/NotificationManager';
import { IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
// import { ISecurityActionService } from '../services/SecurityActionService'; // No longer needed here
import { TYPES } from '../di/symbols';
import { IInteractionHandler } from './InteractionHandler';
import { RestrictionSubscriber } from '../events/subscribers/RestrictionSubscriber'; // Import subscriber
import { NotificationSubscriber } from '../events/subscribers/NotificationSubscriber'; // Import subscriber
import { RoleUpdateSubscriber } from '../events/subscribers/RoleUpdateSubscriber'; // Import subscriber
import { ActionLogSubscriber } from '../events/subscribers/ActionLogSubscriber'; // Import subscriber
import { ServerMemberStatusSubscriber } from '../events/subscribers/ServerMemberStatusSubscriber'; // Import subscriber
import { ICommandHandler } from './CommandHandler';
import { IEventBus } from '../events/EventBus'; // Added EventBus import
import { EventNames } from '../events/events'; // Added EventNames import

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
  // private securityActionService: ISecurityActionService; // Removed
  private commandHandler: ICommandHandler;
  private interactionHandler: IInteractionHandler;
  private restrictionSubscriber: RestrictionSubscriber; // Add property for subscriber
  private notificationSubscriber: NotificationSubscriber; // Add property for subscriber
  private roleUpdateSubscriber: RoleUpdateSubscriber; // Add property for subscriber
  private actionLogSubscriber: ActionLogSubscriber; // Add property for subscriber
  private serverMemberStatusSubscriber: ServerMemberStatusSubscriber; // Add property for subscriber
  private eventBus: IEventBus; // Added EventBus property

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    // @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService, // Removed injection
    @inject(TYPES.CommandHandler) commandHandler: ICommandHandler,
    @inject(TYPES.InteractionHandler) interactionHandler: IInteractionHandler,
    @inject(TYPES.RestrictionSubscriber) restrictionSubscriber: RestrictionSubscriber, // Inject subscriber
    @inject(TYPES.NotificationSubscriber) notificationSubscriber: NotificationSubscriber, // Inject subscriber
    @inject(TYPES.RoleUpdateSubscriber) roleUpdateSubscriber: RoleUpdateSubscriber, // Inject subscriber
    @inject(TYPES.ActionLogSubscriber) actionLogSubscriber: ActionLogSubscriber, // Inject subscriber
    @inject(TYPES.ServerMemberStatusSubscriber)
    serverMemberStatusSubscriber: ServerMemberStatusSubscriber, // Inject subscriber
    @inject(TYPES.EventBus) eventBus: IEventBus // Inject EventBus
  ) {
    this.client = client;
    this.detectionOrchestrator = detectionOrchestrator;
    this.notificationManager = notificationManager;
    this.configService = configService;
    // this.securityActionService = securityActionService; // Removed assignment
    this.commandHandler = commandHandler;
    this.interactionHandler = interactionHandler;
    this.restrictionSubscriber = restrictionSubscriber; // Assign subscriber
    this.notificationSubscriber = notificationSubscriber; // Assign subscriber
    this.roleUpdateSubscriber = roleUpdateSubscriber; // Assign subscriber
    this.actionLogSubscriber = actionLogSubscriber; // Assign subscriber
    this.serverMemberStatusSubscriber = serverMemberStatusSubscriber; // Assign subscriber
    this.eventBus = eventBus; // Assign EventBus
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
    await this.configService.initialize();

    await this.commandHandler.registerCommands();
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.commandHandler.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.interactionHandler.handleButtonInteraction(interaction);
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
    const serverId = message.guild?.id;
    const content = message.content;

    try {
      // Get user profile data if available
      let profileData: UserProfileData | undefined;

      // Only collect profile data if we have access to the user and guild member
      if (message.member && message.author) {
        profileData = this.extractUserProfileData(message.member);
      }

      // Use the detection orchestrator to analyze the message
      const detectionResult = await this.detectionOrchestrator.detectMessage(
        serverId || 'DM',
        userId,
        content,
        profileData
      );

      // If suspicious, delegate to the SecurityActionService
      if (
        detectionResult.label === 'SUSPICIOUS' &&
        message.member &&
        detectionResult.detectionEventId
      ) {
        // Publish event instead of calling service directly
        try {
          // Add try
          this.eventBus.publish(EventNames.UserDetectedSuspicious, {
            userId: userId,
            serverId: serverId || 'DM', // Handle potential DM case? Or should DMs be ignored earlier?
            detectionResult: detectionResult,
            sourceMessageId: message.id, // Pass message ID
            detectionEventId: detectionResult.detectionEventId, // Pass the created event ID
            channelId: message.channelId, // Pass channel ID
          });
        } catch (publishError) {
          console.error(
            '[DEBUG EventHandler] handleMessage - ERROR publishing UserDetectedSuspicious:',
            publishError
          );
        }
      } else if (detectionResult.label === 'SUSPICIOUS' && !detectionResult.detectionEventId) {
        console.warn(
          `EventHandler: Suspicious message detected for ${userId} but detectionEventId is missing from result.`
        );
      }
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
    }
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      console.log(`New member joined: ${member.user.tag} (${member.id})`);

      // Extract profile data
      const profileData = this.extractUserProfileData(member);

      // Run detection on new join
      const detectionResult = await this.detectionOrchestrator.detectNewJoin(
        member.guild.id, // Pass serverId
        member.id, // Pass userId
        profileData
      );

      // If suspicious, publish event instead of calling service directly
      if (detectionResult.label === 'SUSPICIOUS' && detectionResult.detectionEventId) {
        try {
          // Add try
          this.eventBus.publish(EventNames.UserDetectedSuspicious, {
            userId: member.id,
            serverId: member.guild.id,
            detectionResult: detectionResult,
            // No sourceMessageId for join event
            detectionEventId: detectionResult.detectionEventId, // Pass the created event ID
          });
        } catch (publishError) {
          console.error(
            '[DEBUG EventHandler] handleGuildMemberAdd - ERROR publishing UserDetectedSuspicious:',
            publishError
          );
        }
      } else if (detectionResult.label === 'SUSPICIOUS' && !detectionResult.detectionEventId) {
        console.warn(
          `EventHandler: Suspicious join detected for ${member.id} but detectionEventId is missing from result.`
        );
      }
    } catch (error) {
      console.error('Error handling new member:', error);
    }
  }

  /**
   * Helper method to extract user profile data for GPT analysis
   * Only includes data directly available through Discord.js API
   */
  private extractUserProfileData(member: GuildMember): UserProfileData {
    // Ensure serverId and userId are included for detectNewJoin context
    return {
      serverId: member.guild.id, // Added serverId
      userId: member.id, // Added userId
      username: member.user.username,
      discriminator: member.user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(member.user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      recentMessages: [], // This might need adjustment based on how it's used
    };
  }

  /**
   * Handle when the bot joins a new guild
   */
  private async handleGuildCreate(guild: Guild): Promise<void> {
    try {
      console.log(`Bot joined new guild: ${guild.name} (${guild.id})`);

      // Create default configuration for the new guild
      const config = await this.configService.getServerConfig(guild.id);
      console.log(`Created default configuration for guild: ${guild.name} (${guild.id})`);

      // Set up verification channel if auto_setup is enabled globally
      if (globalConfig.getSettings().autoSetupVerificationChannels) {
        const restrictedRoleId = config.restricted_role_id;
        if (restrictedRoleId) {
          const channelId = await this.notificationManager.setupVerificationChannel(
            guild,
            restrictedRoleId
          );
          if (channelId) {
            // Update the configuration with the new channel ID
            await this.configService.updateServerConfig(guild.id, {
              verification_channel_id: channelId,
            });
            console.log(`Set up verification channel for guild: ${guild.name} (${guild.id})`);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to handle new guild ${guild.id}:`, error);
    }
  }
}
