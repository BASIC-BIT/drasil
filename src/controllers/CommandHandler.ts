import {
  Client,
  Message,
  REST,
  Routes,
  ChatInputCommandInteraction,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
  RESTPostAPIApplicationCommandsJSONBody,
  PermissionFlagsBits,
  MessageFlags,
  ThreadChannel,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { IHeuristicService } from '../services/HeuristicService';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { INotificationManager } from '../services/NotificationManager';
import { IConfigService } from '../config/ConfigService';
import { IUserModerationService } from '../services/UserModerationService';
import { ISecurityActionService } from '../services/SecurityActionService';
import { TYPES } from '../di/symbols';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from '../services/ProductAnalyticsService';
import { ISetupDiagnosticsService } from '../services/SetupDiagnosticsService';
import { IRestrictedRoleLockdownService } from '../services/RestrictedRoleLockdownService';
import { ReportSubmissionService } from '../services/ReportSubmissionService';
import {
  buildApplicationCommands,
  REPORT_MESSAGE_CONTEXT_COMMAND_NAME,
  REPORT_USER_CONTEXT_COMMAND_NAME,
} from './commandDefinitions';
import { CaseCommandHandler } from './CaseCommandHandler';
import { ConfigSubcommandHandler } from './ConfigSubcommandHandler';
import { LockdownConfigCommandHandler } from './LockdownConfigCommandHandler';
import { ModerationCommandHandler } from './ModerationCommandHandler';
import { ReportCommandHandler } from './ReportCommandHandler';
import { ReportInstructionsManager } from './ReportInstructionsManager';
import { SetupCommandHandler } from './SetupCommandHandler';
import { TestCommandHandler } from './TestCommandHandler';
import { isUserInstallReportingEnabled } from '../utils/userInstallReporting';
import { IReportIntakeService } from '../services/ReportIntakeService';
import { IModerationQueueService } from '../services/ModerationQueueService';
import { canModerateReportIntake } from '../utils/reportIntakeStaffAuthorization';
import { buildAdminGuildSetupUrl } from '../utils/publicWebLinks';
import 'reflect-metadata';

// Load environment variables
dotenv.config();

const DRASIL_GUILD_INSTALL_PERMISSIONS =
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ViewAuditLog |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.CreatePrivateThreads |
  PermissionFlagsBits.SendMessagesInThreads;

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
  private configService: IConfigService;
  private configSubcommandHandler: ConfigSubcommandHandler;
  private caseCommandHandler: CaseCommandHandler;
  private lockdownConfigCommandHandler: LockdownConfigCommandHandler;
  private moderationCommandHandler: ModerationCommandHandler;
  private reportCommandHandler: ReportCommandHandler;
  private setupCommandHandler: SetupCommandHandler;
  private testCommandHandler: TestCommandHandler;
  private commands: RESTPostAPIApplicationCommandsJSONBody[];
  private reportIntakeService?: IReportIntakeService;

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
    setupDiagnosticsService?: ISetupDiagnosticsService,
    @inject(TYPES.RestrictedRoleLockdownService)
    @optional()
    restrictedRoleLockdownService?: IRestrictedRoleLockdownService,
    @inject(TYPES.ReportIntakeService)
    @optional()
    reportIntakeService?: IReportIntakeService,
    @inject(TYPES.ModerationQueueService)
    @optional()
    moderationQueueService?: IModerationQueueService
  ) {
    this.client = client;
    this.configService = configService;
    this.reportIntakeService = reportIntakeService;
    const resolvedProductAnalyticsService =
      productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE;
    this.configSubcommandHandler = new ConfigSubcommandHandler(
      this.configService,
      heuristicService,
      resolvedProductAnalyticsService,
      moderationQueueService
    );
    this.caseCommandHandler = new CaseCommandHandler(
      this.configService,
      securityActionService,
      (interaction) => this.replyGuildInstallRequired(interaction)
    );
    this.lockdownConfigCommandHandler = new LockdownConfigCommandHandler(
      this.configService,
      restrictedRoleLockdownService
    );
    const reportInstructionsManager = new ReportInstructionsManager(
      this.client,
      this.configService
    );
    const reportSubmissionService = new ReportSubmissionService(
      this.configService,
      securityActionService
    );
    this.moderationCommandHandler = new ModerationCommandHandler(
      this.configService,
      userModerationService,
      securityActionService,
      (interaction) => this.replyGuildInstallRequired(interaction)
    );
    this.reportCommandHandler = new ReportCommandHandler(
      reportSubmissionService,
      reportInstructionsManager,
      (interaction) => this.replyGuildInstallRequired(interaction)
    );
    this.setupCommandHandler = new SetupCommandHandler(
      this.configService,
      notificationManager,
      resolvedProductAnalyticsService,
      setupDiagnosticsService,
      reportInstructionsManager,
      (interaction) => this.replyGuildInstallRequired(interaction)
    );
    this.testCommandHandler = new TestCommandHandler(heuristicService, detectionOrchestrator);

    this.commands = buildApplicationCommands({
      userInstallReportingEnabled: isUserInstallReportingEnabled(),
    });
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
        await this.moderationCommandHandler.handleBanCommand(interaction);
        break;

      case 'report':
        await this.reportCommandHandler.handleReportCommand(interaction);
        break;

      case 'setupverification':
        await this.setupCommandHandler.handleSetupVerificationCommand(interaction);
        break;

      case 'config':
        await this.handleConfigCommand(interaction);
        break;

      case 'audit':
        await this.moderationCommandHandler.handleAuditCommand(interaction);
        break;

      case 'flaguser': // Added case for flaguser
        await this.moderationCommandHandler.handleFlagUserCommand(interaction);
        break;

      case 'case':
        await this.caseCommandHandler.handleCaseCommand(interaction);
        break;

      case 'setupreportbutton': // Added case for setupreportbutton
        await this.reportCommandHandler.handleSetupReportButtonCommand(interaction);
        break;

      case 'close-report':
        await this.handleCloseReportCommand(interaction);
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

    await this.reportCommandHandler.handleReportUserContextCommand(interaction);
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

    await this.reportCommandHandler.handleReportMessageContextCommand(interaction);
  }

  public async handleTestCommands(message: Message): Promise<void> {
    await this.testCommandHandler.handleTestCommands(message);
  }

  private async handleCloseReportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    if (!this.reportIntakeService) {
      await interaction.reply({
        content: 'Report intake tracking is not available.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const thread = this.getInteractionThread(interaction.channel);
    if (!thread) {
      await interaction.reply({
        content: 'Use /close-report inside an open report intake thread.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = await this.client.guilds.fetch(interaction.guildId);
    const result = await this.reportIntakeService.closeIntakeForThread({
      threadId: thread.id,
      closedById: interaction.user.id,
      closedByStaff: await canModerateReportIntake(guild, interaction.user.id, this.configService),
    });

    if (result.closed) {
      await interaction.reply({
        content: result.message,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: result.message,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    if (result.closed) {
      await this.archiveReportIntakeThread(thread);
    }
  }

  private getInteractionThread(
    channel: ChatInputCommandInteraction['channel']
  ): ThreadChannel | null {
    return channel?.isThread() ? channel : null;
  }

  private async archiveReportIntakeThread(thread: ThreadChannel): Promise<void> {
    try {
      if (!thread.archived) {
        await thread.setArchived(true, 'Report intake closed');
      }
    } catch (error) {
      console.warn(`Failed to archive closed report intake thread ${thread.id}:`, error);
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
    if (subcommandGroup === 'lockdown') {
      await this.lockdownConfigCommandHandler.handleLockdownConfigCommand(interaction, guild);
      return;
    }

    if (subcommandGroup === 'role-quarantine') {
      await this.configSubcommandHandler.handleRoleQuarantineConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'heuristic') {
      await this.configSubcommandHandler.handleHeuristicConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'detection') {
      await this.configSubcommandHandler.handleDetectionConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'case-staff') {
      await this.configSubcommandHandler.handleCaseStaffConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'case-review') {
      await this.configSubcommandHandler.handleCaseReviewConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'case-queue') {
      await this.configSubcommandHandler.handleCaseQueueConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'report') {
      await this.configSubcommandHandler.handleReportConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'analytics') {
      await this.configSubcommandHandler.handleAnalyticsConfigCommand(interaction, guild.id);
      return;
    }

    if (subcommandGroup === 'verification') {
      await this.configSubcommandHandler.handleVerificationConfigCommand(interaction, guild.id);
      return;
    }

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === 'setup') {
      await this.setupCommandHandler.handleConfigSetupCommand(interaction, guild);
      return;
    }

    if (subcommand === 'validate') {
      await this.setupCommandHandler.handleConfigValidateCommand(interaction, guild);
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

  private async replyGuildInstallRequired(
    interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction
  ): Promise<void> {
    const installLink = this.getGuildInstallLink();
    const setupLink = interaction.guildId ? buildAdminGuildSetupUrl(interaction.guildId) : null;
    const links = [
      installLink ? `Install: ${installLink}` : null,
      setupLink ? `Setup dashboard: ${setupLink}` : null,
    ].filter((value): value is string => Boolean(value));
    const suffix = links.length ? `\n${links.join('\n')}` : '';
    const content = interaction.guildId
      ? `Drasil is not installed in this server yet. Ask a server admin to install it.${suffix}`
      : `This command can only be used in a server where Drasil is installed.${suffix}`;

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
