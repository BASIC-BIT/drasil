import {
  Client,
  ButtonInteraction,
  ButtonBuilder,
  MessageFlags,
  GuildMember,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  ButtonStyle,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import { AdminActionType, VerificationStatus } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';
import { IUserModerationService } from '../services/UserModerationService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IThreadManager } from '../services/ThreadManager';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import { ISecurityActionService } from '../services/SecurityActionService';
import { IConfigService } from '../config/ConfigService';
import { ISetupDiagnosticsService } from '../services/SetupDiagnosticsService';
import { IReportIntakeService } from '../services/ReportIntakeService';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from '../services/ProductAnalyticsService';
import { ReportSubmissionService } from '../services/ReportSubmissionService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { REPORT_MESSAGE_MODAL_PREFIX } from '../utils/userReportSettings';
import { SETUP_VERIFICATION_MODAL_ID } from '../constants/setupVerificationWizard';
import {
  ADMIN_ACTION_CUSTOM_ID_PREFIX,
  buildAdminActionCustomId,
  parseAdminActionCustomId,
  type ParsedAdminActionCustomId,
} from '../utils/adminActionCustomIds';
import {
  REPORT_USER_INITIATE_CUSTOM_ID,
  REPORT_USER_TYPED_MODAL_ID,
  ReportInteractionHandler,
} from './ReportInteractionHandler';
import { SetupVerificationModalHandler } from './SetupVerificationModalHandler';
// Load environment variables
dotenv.config();

const OBSERVED_ACTION_MODAL_REASON_FIELD_ID = 'observed_ban_reason';
const OBSERVED_BAN_DEFAULT_REASON = 'Banned from observed suspicious notification';
const VERIFICATION_BAN_MODAL_PREFIX = 'verification:ban_modal';
const VERIFICATION_BAN_NOTES_FIELD_ID = 'verification_ban_notes';
const VERIFICATION_BAN_DEFAULT_REASON = 'Banned by moderator during verification';
/**
 * Interface for the Bot class
 */
export interface IInteractionHandler {
  /**
   * Handle a button interaction
   */
  handleButtonInteraction(interaction: ButtonInteraction): Promise<void>;

  /**
   * Handle a modal submission interaction
   */
  handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void>; // Added
}

@injectable()
export class InteractionHandler implements IInteractionHandler {
  private client: Client;
  private notificationManager: INotificationManager;
  private userModerationService: IUserModerationService;
  private securityActionService: ISecurityActionService;
  private configService: IConfigService;
  // TODO: Handlers calling a repository is a smell, and should be improved
  private verificationEventRepository: IVerificationEventRepository;
  private threadManager: IThreadManager;
  private adminActionRepository: IAdminActionRepository;
  private reportSubmissionService: ReportSubmissionService;
  private reportInteractionHandler: ReportInteractionHandler;
  private setupVerificationModalHandler: SetupVerificationModalHandler;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.AdminActionRepository) adminActionRepository: IAdminActionRepository,
    @inject(TYPES.SetupDiagnosticsService)
    @optional()
    setupDiagnosticsService?: ISetupDiagnosticsService,
    @inject(TYPES.ReportIntakeService)
    @optional()
    reportIntakeService?: IReportIntakeService,
    @inject(TYPES.ProductAnalyticsService)
    @optional()
    productAnalyticsService?: IProductAnalyticsService
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;
    this.configService = configService;
    this.verificationEventRepository = verificationEventRepository;
    this.threadManager = threadManager;
    this.adminActionRepository = adminActionRepository;
    this.reportSubmissionService = new ReportSubmissionService(
      this.configService,
      this.securityActionService
    );
    this.reportInteractionHandler = new ReportInteractionHandler(
      this.client,
      this.reportSubmissionService,
      this.configService,
      this.threadManager,
      reportIntakeService
    );
    this.setupVerificationModalHandler = new SetupVerificationModalHandler(
      this.client,
      this.notificationManager,
      this.configService,
      setupDiagnosticsService,
      productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE
    );
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This button can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guildId = interaction.guildId;

    try {
      // Exact-match IDs must be routed before parsing action/user IDs.
      if (customId === REPORT_USER_INITIATE_CUSTOM_ID) {
        await this.reportInteractionHandler.handleReportUserInitiate(interaction);
        return;
      }

      if (this.reportInteractionHandler.isReportIntakeConfirmCustomId(customId)) {
        await this.reportInteractionHandler.handleReportIntakeConfirm(interaction, customId);
        return;
      }

      if (customId.startsWith(`${ADMIN_ACTION_CUSTOM_ID_PREFIX}:`)) {
        await this.handleAdminActionsButtonInteraction(interaction, guildId, customId);
        return;
      }

      if (customId.startsWith('observed:')) {
        await this.handleObservedButtonInteraction(interaction, guildId, customId);
        return;
      }

      const [action, targetUserId] = customId.split('_');
      if (!targetUserId) {
        await interaction.reply({
          content: 'Unknown button action',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      switch (action) {
        case 'verify':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to verify a user.'
            );
            return;
          }
          await this.showLegacyAdminActionConfirmation(interaction, {
            action: 'verify',
            surface: 'case',
            userId: targetUserId,
          });
          break;
        case 'ban':
          if (
            !(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need Ban Members permission to ban a user.'
            );
            return;
          }
          if (!(await this.canUseModeratorBanAction(guildId))) {
            await interaction.reply({
              content:
                'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await this.handleBanButton(interaction, targetUserId);
          break;
        case 'thread':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to create a verification thread.'
            );
            return;
          }
          await this.showLegacyAdminActionConfirmation(interaction, {
            action: 'thread',
            surface: 'case',
            userId: targetUserId,
          });
          break;
        case 'history':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to view history.'
            );
            return;
          }
          await this.handleHistoryButton(interaction, guildId, targetUserId);
          break;
        case 'reopen':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to reopen verification.'
            );
            return;
          }
          await this.showLegacyAdminActionConfirmation(interaction, {
            action: 'reopen',
            surface: 'case',
            userId: targetUserId,
          });
          break;
        default:
          await interaction.reply({
            content: 'Unknown button action',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      const response = {
        content: 'An error occurred while processing your request.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }

  private async handleAdminActionsButtonInteraction(
    interaction: ButtonInteraction,
    guildId: string,
    customId: string
  ): Promise<void> {
    const parsed = parseAdminActionCustomId(customId);
    if (!parsed) {
      await interaction.reply({
        content: 'Unknown admin action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.action === 'cancel') {
      await interaction.update({ content: 'Cancelled.', components: [] });
      return;
    }

    if (parsed.action === 'menu') {
      await this.showAdminActionsMenu(interaction, guildId, parsed);
      return;
    }

    if (parsed.action === 'history') {
      if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to view history.'
        );
        return;
      }
      if (parsed.surface === 'observed') {
        await this.notificationManager.handleHistoryButtonClick(interaction, parsed.userId);
      } else {
        await this.handleHistoryButton(interaction, guildId, parsed.userId);
      }
      return;
    }

    if (parsed.action === 'ban' || parsed.action === 'observed_ban') {
      await this.handleAdminActionBan(interaction, guildId, parsed);
      return;
    }

    if (parsed.action.startsWith('confirm_')) {
      await this.executeConfirmedAdminAction(interaction, guildId, parsed);
      return;
    }

    const confirmation = this.getAdminActionConfirmation(parsed);
    if (!confirmation) {
      await interaction.reply({
        content: 'Unknown admin action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showAdminActionConfirmation(interaction, parsed, confirmation);
  }

  private async showAdminActionsMenu(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    const hasModerationPermission = await this.hasAnyPermission(
      interaction,
      guildId,
      this.getModerationPermissions()
    );
    const hasBanMembersPermission = await this.hasAnyPermission(interaction, guildId, [
      PermissionFlagsBits.BanMembers,
    ]);

    if (!hasModerationPermission && !hasBanMembersPermission) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to use admin actions.'
      );
      return;
    }

    if (parsed.surface === 'observed') {
      await this.showObservedAdminActionsMenu(interaction, guildId, parsed, {
        hasModerationPermission,
        hasBanMembersPermission,
      });
      return;
    }

    const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
      parsed.userId,
      guildId
    );
    const history = await this.verificationEventRepository.findByUserAndServer(
      parsed.userId,
      guildId
    );
    const pendingCases = history.filter((event) => event.status === VerificationStatus.PENDING);
    const latestHistoryCase = history.length > 0 ? history[0] : null;
    const latestCase = activeCase ?? latestHistoryCase;
    const alreadyBanned =
      activeCase?.status === VerificationStatus.PENDING && hasBanMembersPermission
        ? await this.isUserBanned(guildId, parsed.userId)
        : false;
    const canBan =
      hasBanMembersPermission && !alreadyBanned && (await this.canUseModeratorBanAction(guildId));

    const buttons: ButtonBuilder[] = [];
    if (hasModerationPermission) {
      buttons.push(this.adminActionButton(parsed, 'history', 'History', ButtonStyle.Secondary));
    }

    if (activeCase?.status === VerificationStatus.PENDING) {
      if (hasModerationPermission) {
        buttons.push(
          this.adminActionButton(parsed, 'verify', 'Verify User', ButtonStyle.Success),
          this.adminActionButton(parsed, 'repair', 'Repair Active Case', ButtonStyle.Primary)
        );
        if (!activeCase.thread_id) {
          buttons.push(
            this.adminActionButton(parsed, 'thread', 'Create Thread', ButtonStyle.Primary)
          );
        }
      }
      if (alreadyBanned) {
        buttons.push(
          this.adminActionButton(parsed, 'sync_ban', 'Sync Existing Ban', ButtonStyle.Danger)
        );
      }
      if (canBan) {
        buttons.push(this.adminActionButton(parsed, 'ban', 'Ban User...', ButtonStyle.Danger));
      }
    } else if (latestCase && hasModerationPermission) {
      buttons.push(
        this.adminActionButton(parsed, 'reopen', 'Reopen Verification', ButtonStyle.Primary)
      );
    }

    const details = [
      `Admin actions for <@${parsed.userId}>.`,
      'Mutating actions require a confirmation step before they run.',
    ];
    if (activeCase?.thread_id) {
      details.push(`Case thread: https://discord.com/channels/${guildId}/${activeCase.thread_id}`);
    }
    if (activeCase?.private_evidence_thread_id) {
      details.push(
        `Private evidence: https://discord.com/channels/${guildId}/${activeCase.private_evidence_thread_id}`
      );
    }
    if (alreadyBanned) {
      details.push(
        'Discord already shows this user as banned. Use Sync Existing Ban to resolve pending case rows without attempting another ban.'
      );
    }
    if (pendingCases.length > 1) {
      details.push(
        `Warning: ${pendingCases.length} pending cases exist for this user. Terminal actions will resolve all pending case rows.`
      );
      details.push(
        ...pendingCases
          .slice(0, 5)
          .map(
            (event) =>
              `Pending case ${event.id}${event.thread_id ? `: https://discord.com/channels/${guildId}/${event.thread_id}` : ''}`
          )
      );
    }
    if (buttons.length === 0) {
      details.push('No available actions for your current permissions and this case state.');
    }

    await interaction.reply({
      content: details.join('\n'),
      allowedMentions: { parse: [] },
      components: this.createButtonRows(buttons),
      flags: MessageFlags.Ephemeral,
    });
  }

  private async showObservedAdminActionsMenu(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId,
    permissions: { hasModerationPermission: boolean; hasBanMembersPermission: boolean }
  ): Promise<void> {
    if (!parsed.detectionEventId) {
      await interaction.reply({
        content: 'This observed action is missing its detection event.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const canBan =
      permissions.hasBanMembersPermission && (await this.canUseModeratorBanAction(guildId));
    const buttons: ButtonBuilder[] = [];
    if (permissions.hasModerationPermission) {
      buttons.push(
        this.adminActionButton(parsed, 'observed_open', 'Open Case', ButtonStyle.Primary),
        this.adminActionButton(parsed, 'observed_restrict', 'Restrict', ButtonStyle.Danger),
        this.adminActionButton(parsed, 'observed_dismiss', 'Dismiss Alert', ButtonStyle.Secondary),
        this.adminActionButton(
          parsed,
          'observed_false_positive',
          'False Positive',
          ButtonStyle.Success
        ),
        this.adminActionButton(
          parsed,
          'observed_undo_dismiss',
          'Undo Dismissal',
          ButtonStyle.Primary
        ),
        this.adminActionButton(parsed, 'history', 'History', ButtonStyle.Secondary)
      );
    }
    if (canBan) {
      if (permissions.hasModerationPermission) {
        buttons.splice(
          2,
          0,
          this.adminActionButton(parsed, 'observed_ban', 'Ban...', ButtonStyle.Danger)
        );
      } else {
        buttons.push(this.adminActionButton(parsed, 'observed_ban', 'Ban...', ButtonStyle.Danger));
      }
    }

    await interaction.reply({
      content:
        `Admin actions for observed alert on <@${parsed.userId}>.\nMutating actions require a confirmation step before they run.` +
        (buttons.length === 0
          ? '\nNo available actions for your current permissions and this alert state.'
          : ''),
      allowedMentions: { parse: [] },
      components: this.createButtonRows(buttons),
      flags: MessageFlags.Ephemeral,
    });
  }

  private adminActionButton(
    parsed: ParsedAdminActionCustomId,
    action: string,
    label: string,
    style: ButtonStyle
  ): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId(
        buildAdminActionCustomId(action, parsed.surface, parsed.userId, parsed.detectionEventId)
      )
      .setLabel(label)
      .setStyle(style);
  }

  private createButtonRows(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let index = 0; index < buttons.length; index += 5) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(index, index + 5))
      );
    }
    return rows;
  }

  private getAdminActionConfirmation(parsed: ParsedAdminActionCustomId): {
    label: string;
    message: string;
    style: ButtonStyle.Danger | ButtonStyle.Primary | ButtonStyle.Success | ButtonStyle.Secondary;
  } | null {
    const target = `<@${parsed.userId}>`;
    switch (parsed.action) {
      case 'verify':
        return {
          label: 'Confirm Verify',
          message: `Verify ${target} and remove verification restrictions?`,
          style: ButtonStyle.Success,
        };
      case 'thread':
        return {
          label: 'Confirm Create Thread',
          message: `Create a user-facing verification thread for ${target}?`,
          style: ButtonStyle.Primary,
        };
      case 'repair':
        return {
          label: 'Confirm Repair',
          message: `Repair the active verification case for ${target}?`,
          style: ButtonStyle.Primary,
        };
      case 'sync_ban':
        return {
          label: 'Confirm Sync Ban',
          message: `Sync pending verification cases for ${target} to banned because Discord already has an existing ban?`,
          style: ButtonStyle.Danger,
        };
      case 'reopen':
        return {
          label: 'Confirm Reopen',
          message: `Reopen verification for ${target} and restrict them again?`,
          style: ButtonStyle.Primary,
        };
      case 'observed_open':
        return {
          label: 'Confirm Open Case',
          message: `Open a verification case for observed alert on ${target}?`,
          style: ButtonStyle.Primary,
        };
      case 'observed_restrict':
        return {
          label: 'Confirm Restrict',
          message: `Restrict ${target} and open a verification case from this observed alert?`,
          style: ButtonStyle.Danger,
        };
      case 'observed_dismiss':
        return {
          label: 'Confirm Dismiss',
          message: `Dismiss this observed alert for ${target}?`,
          style: ButtonStyle.Secondary,
        };
      case 'observed_false_positive':
        return {
          label: 'Confirm False Positive',
          message: `Mark this observed alert for ${target} as a false positive?`,
          style: ButtonStyle.Success,
        };
      case 'observed_undo_dismiss':
        return {
          label: 'Confirm Undo',
          message: `Undo a dismissal or false-positive mark for this observed alert on ${target}?`,
          style: ButtonStyle.Primary,
        };
      default:
        return null;
    }
  }

  private async showAdminActionConfirmation(
    interaction: ButtonInteraction,
    parsed: ParsedAdminActionCustomId,
    confirmation: NonNullable<ReturnType<InteractionHandler['getAdminActionConfirmation']>>,
    options?: { update?: boolean }
  ): Promise<void> {
    const confirmAction = `confirm_${parsed.action}`;
    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.adminActionButton(parsed, confirmAction, confirmation.label, confirmation.style),
        this.adminActionButton(parsed, 'cancel', 'Cancel', ButtonStyle.Secondary)
      ),
    ];
    const response = {
      content: confirmation.message,
      allowedMentions: { parse: [] },
      components,
    };

    if (options?.update === false) {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update(response);
  }

  private async showLegacyAdminActionConfirmation(
    interaction: ButtonInteraction,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    const confirmation = this.getAdminActionConfirmation(parsed);
    if (!confirmation) {
      await interaction.reply({
        content: 'Unknown admin action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showAdminActionConfirmation(interaction, parsed, confirmation, { update: false });
  }

  private async handleAdminActionBan(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    if (!(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))) {
      await this.replyPermissionDenied(
        interaction,
        'You need Ban Members permission to ban a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorBanAction(guildId))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.surface === 'observed') {
      if (!parsed.detectionEventId) {
        await interaction.reply({
          content: 'This observed action is missing its detection event.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await this.showObservedBanModal(interaction, guildId, parsed.userId, parsed.detectionEventId);
      return;
    }

    await this.handleBanButton(interaction, parsed.userId);
  }

  private async executeConfirmedAdminAction(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    const action = parsed.action.slice('confirm_'.length);
    const moderationPermissions = this.getModerationPermissions();

    if (action === 'verify') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to verify a user.'
        );
        return;
      }
      await this.handleVerifyButton(interaction, guildId, parsed.userId);
      return;
    }

    if (action === 'thread') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to create a verification thread.'
        );
        return;
      }
      await this.handleThreadButton(interaction, guildId, parsed.userId);
      return;
    }

    if (action === 'repair') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to repair a verification case.'
        );
        return;
      }
      await this.handleRepairActiveCaseButton(interaction, guildId, parsed.userId);
      return;
    }

    if (action === 'sync_ban') {
      if (!(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))) {
        await this.replyPermissionDenied(
          interaction,
          'You need Ban Members permission to sync an existing ban.'
        );
        return;
      }
      await this.handleSyncAlreadyBannedButton(interaction, guildId, parsed.userId);
      return;
    }

    if (action === 'reopen') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to reopen verification.'
        );
        return;
      }
      await this.handleReopenButton(interaction, guildId, parsed.userId);
      return;
    }

    if (!parsed.detectionEventId) {
      await interaction.reply({
        content: 'This observed action is missing its detection event.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.hasAnyPermission(interaction, guildId, this.getObservedModerationPermissions()))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to use this observed action.'
      );
      return;
    }

    switch (action) {
      case 'observed_open':
        await interaction.deferUpdate();
        await this.openObservedCase(interaction, guildId, parsed.userId, parsed.detectionEventId);
        return;
      case 'observed_restrict':
        await interaction.deferUpdate();
        await this.restrictObservedUser(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;
      case 'observed_dismiss':
      case 'observed_false_positive':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.dismissObservedDetection(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId,
          action === 'observed_false_positive'
            ? AdminActionType.FALSE_POSITIVE
            : AdminActionType.DISMISS
        );
        return;
      case 'observed_undo_dismiss':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.undoObservedDismissal(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;
      default:
        await interaction.reply({
          content: 'Unknown admin action.',
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async handleRepairActiveCaseButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        throw new Error('Could not find member in guild');
      }

      const result = await this.securityActionService.repairActiveCase(member);
      await interaction.followUp({
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error repairing active case:', error);
      await interaction.followUp({
        content: 'An error occurred while repairing the active case.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleSyncAlreadyBannedButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const syncedCount = await this.userModerationService.syncAlreadyBannedUser(
        guild,
        userId,
        interaction.user
      );

      const caseWord = syncedCount === 1 ? 'case' : 'cases';
      await interaction.followUp({
        content:
          syncedCount === 0
            ? `No pending verification cases remain for <@${userId}>.`
            : `Synced ${syncedCount} pending verification ${caseWord} for <@${userId}> to banned because Discord already has an existing ban.`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error syncing already-banned user:', error);
      await interaction.followUp({
        content:
          'Could not sync the existing ban. Confirm the user is still banned and Drasil can view server bans.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleVerifyButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      await this.userModerationService.verifyUser(member, interaction.user);

      await interaction.followUp({
        content: `User <@${userId}> has been verified and can now access the server.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error verifying user:', error);
      await interaction.followUp({
        content: 'An error occurred while verifying the user.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleBanButton(interaction: ButtonInteraction, userId: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(`${VERIFICATION_BAN_MODAL_PREFIX}:${userId}`)
      .setTitle('Confirm User Ban');
    const notesInput = new TextInputBuilder()
      .setCustomId(VERIFICATION_BAN_NOTES_FIELD_ID)
      .setLabel('Final notes (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(500)
      .setPlaceholder('Submitting this form bans the user. Add notes for the audit log.');

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput));
    await interaction.showModal(modal);
  }

  private async handleThreadButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild and member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        throw new Error('Could not find member in guild');
      }

      // Get the active verification event
      const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        userId,
        guildId
      );

      if (!verificationEvent) {
        throw new Error('No active verification event found');
      }

      // Create the thread
      const thread = await this.threadManager.createVerificationThread(member, verificationEvent);

      // Update the buttons to hide the Create Thread button
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING
      );

      if (!thread) {
        throw new Error('Failed to create verification thread');
      }

      // Update the buttons (this will remove the Create Thread button)
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING
      );

      await interaction.followUp({
        content: `Created verification thread: ${thread.url}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error creating verification thread:', error);
      await interaction.followUp({
        content: 'An error occurred while creating the verification thread.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleHistoryButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Get verification history with actions using the member object
      const history = await this.verificationEventRepository.findByUserAndServer(userId, guildId);

      // TODO: This is part of the reason why we don't put repositories in handlers, this is strictly a service concern
      const historyWithActions = await Promise.all(
        history.map(async (event) => ({
          ...event,
          actions: await this.adminActionRepository.findByVerificationEvent(event.id),
        }))
      );

      // Format history using our formatter
      const formattedHistory = VerificationHistoryFormatter.formatForDiscord(
        historyWithActions,
        userId
      );

      // Send as a text file if it's too long
      if (formattedHistory.length > 2000) {
        const plainTextHistory = VerificationHistoryFormatter.formatForFile(
          historyWithActions,
          userId
        );
        const buffer = Buffer.from(plainTextHistory, 'utf-8');
        await interaction.editReply({
          content: 'Here is the complete verification history:',
          files: [
            {
              attachment: buffer,
              name: `verification-history-${userId}.txt`,
            },
          ],
        });
      } else {
        await interaction.editReply({
          content: formattedHistory,
        });
      }
    } catch (error) {
      console.error('Error fetching verification history:', error);
      await interaction.editReply({
        content: 'An error occurred while fetching the verification history.',
      });
    }
  }

  private async handleReopenButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // TODO: We unlock the thread, but what actually updates the status? Is this a user moderation service concern?
      // Remind ourselves that the handler/controller layer should focus on user interaction concerns
      // Should we have a whole "display" layer, separate from our service layer (which is our business logic)?
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        userId,
        guildId
      );

      if (verificationEvents.length === 0) {
        throw new Error('No active verification event found');
      }

      const verificationEvent = verificationEvents[0];

      // Reopen the verification using VerificationService
      await this.securityActionService.reopenVerification(verificationEvent, interaction.user);

      await interaction.followUp({
        content: `Verification for <@${userId}> has been reopened. The user has been restricted again.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error reopening verification:', error);
      await interaction.followUp({
        content: 'An error occurred while reopening the verification.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  public async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    switch (interaction.customId) {
      case REPORT_USER_TYPED_MODAL_ID:
        await this.reportInteractionHandler.handleReportUserModalSubmit(interaction);
        return;
      case SETUP_VERIFICATION_MODAL_ID:
        await this.setupVerificationModalHandler.handleSetupVerificationModalSubmit(interaction);
        return;
      default:
        if (interaction.customId.startsWith(`${VERIFICATION_BAN_MODAL_PREFIX}:`)) {
          await this.handleVerificationBanModalSubmit(interaction);
          return;
        }
        if (interaction.customId.startsWith(`${REPORT_MESSAGE_MODAL_PREFIX}:`)) {
          await this.reportInteractionHandler.handleReportMessageModalSubmit(interaction);
          return;
        }
        if (interaction.customId.startsWith('observed:ban_modal:')) {
          await this.handleObservedBanModalSubmit(interaction);
          return;
        }
        console.log(
          `[InteractionHandler] Ignoring unknown modal submission: ${interaction.customId}`
        );
    }
  }

  private async handleVerificationBanModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.customId.slice(`${VERIFICATION_BAN_MODAL_PREFIX}:`.length);
    if (!userId) {
      await interaction.reply({
        content: 'Unknown ban action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.BanMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Ban Members permission to ban a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorBanAction(interaction.guildId))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const finalNotes = interaction.fields.getTextInputValue(VERIFICATION_BAN_NOTES_FIELD_ID).trim();
    const banReason = finalNotes || VERIFICATION_BAN_DEFAULT_REASON;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId);

      await this.userModerationService.banUser(member, banReason, interaction.user);

      await interaction.editReply({
        content: `User <@${userId}> has been banned from the server.`,
      });
    } catch (error) {
      console.error('Error banning user:', error);
      await interaction.editReply({
        content: 'An error occurred while banning the user.',
      });
    }
  }

  private parseObservedActionCustomId(customId: string): {
    action: string;
    userId: string;
    detectionEventId: string;
  } | null {
    const [, action, userId, detectionEventId] = customId.split(':');
    if (!action || !userId || !detectionEventId) {
      return null;
    }
    return { action, userId, detectionEventId };
  }

  private async hasAnyPermission(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    guildId: string,
    permissions: bigint[]
  ): Promise<boolean> {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return true;
    }
    if (permissions.some((permission) => interaction.memberPermissions?.has(permission))) {
      return true;
    }

    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      return false;
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }
    return permissions.some((permission) => member.permissions.has(permission));
  }

  private async canUseModeratorBanAction(guildId: string): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (!settings.moderatorBanActionEnabled) {
      return false;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const botMember =
      guild?.members.me ??
      (guild && typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.BanMembers) ?? false;
  }

  private async isUserBanned(guildId: string, userId: string): Promise<boolean> {
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const ban = await guild?.bans.fetch(userId).catch(() => null);
    return Boolean(ban);
  }

  private async replyPermissionDenied(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    message: string,
    options?: { clearComponents?: boolean }
  ): Promise<void> {
    const response = {
      content: message,
      ...(options?.clearComponents ? { components: [] } : {}),
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
      return;
    }
    await interaction.reply({
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async getObservedTargetMember(guildId: string, userId: string): Promise<GuildMember> {
    const guild = await this.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      throw new Error(`Could not find member ${userId} in guild ${guildId}`);
    }
    return member;
  }

  private getModerationPermissions(): bigint[] {
    return [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ModerateMembers];
  }

  private getObservedModerationPermissions(): bigint[] {
    return this.getModerationPermissions();
  }

  private async handleObservedButtonInteraction(
    interaction: ButtonInteraction,
    guildId: string,
    customId: string
  ): Promise<void> {
    const parsed = this.parseObservedActionCustomId(customId);
    if (!parsed) {
      await interaction.reply({
        content: 'Unknown observed action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const moderationPermissions = this.getObservedModerationPermissions();
    let canModerate: boolean | null = null;
    const hasModerationPermission = async (): Promise<boolean> => {
      canModerate ??= await this.hasAnyPermission(interaction, guildId, moderationPermissions);
      return canModerate;
    };

    switch (parsed.action) {
      case 'open':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to open a case.'
          );
          return;
        }
        await this.showLegacyAdminActionConfirmation(interaction, {
          action: 'observed_open',
          surface: 'observed',
          userId: parsed.userId,
          detectionEventId: parsed.detectionEventId,
        });
        return;

      case 'restrict':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to restrict a user.'
          );
          return;
        }
        await this.showLegacyAdminActionConfirmation(interaction, {
          action: 'observed_restrict',
          surface: 'observed',
          userId: parsed.userId,
          detectionEventId: parsed.detectionEventId,
        });
        return;

      case 'ban':
        if (
          !(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.BanMembers]))
        ) {
          await this.replyPermissionDenied(
            interaction,
            'You need Ban Members permission to ban a user.'
          );
          return;
        }
        if (!(await this.canUseModeratorBanAction(guildId))) {
          await interaction.reply({
            content:
              'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await this.showObservedBanModal(
          interaction,
          guildId,
          parsed.userId,
          parsed.detectionEventId
        );
        return;

      case 'dismiss_menu':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to dismiss an alert.',
            { clearComponents: true }
          );
          return;
        }
        await interaction.editReply({
          content:
            'Dismiss only closes this alert. False Positive records that this specific detection was incorrect; future independent detections can still notify.',
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`observed:dismiss:${parsed.userId}:${parsed.detectionEventId}`)
                .setLabel('Dismiss Alert')
                .setStyle(ButtonStyle.Secondary),
              new ButtonBuilder()
                .setCustomId(`observed:false_positive:${parsed.userId}:${parsed.detectionEventId}`)
                .setLabel('False Positive')
                .setStyle(ButtonStyle.Success)
            ),
          ],
        });
        return;

      case 'dismiss':
      case 'false_positive':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to dismiss an alert.',
            { clearComponents: true }
          );
          return;
        }
        await this.showLegacyAdminActionConfirmation(interaction, {
          action:
            parsed.action === 'false_positive' ? 'observed_false_positive' : 'observed_dismiss',
          surface: 'observed',
          userId: parsed.userId,
          detectionEventId: parsed.detectionEventId,
        });
        return;

      case 'undo_dismiss':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to undo a dismissal.',
            { clearComponents: true }
          );
          return;
        }
        await this.showLegacyAdminActionConfirmation(interaction, {
          action: 'observed_undo_dismiss',
          surface: 'observed',
          userId: parsed.userId,
          detectionEventId: parsed.detectionEventId,
        });
        return;

      case 'history':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            'You need moderation permissions to view history.'
          );
          return;
        }
        await this.notificationManager.handleHistoryButtonClick(interaction, parsed.userId);
        return;

      default:
        await interaction.reply({
          content: 'Unknown observed action.',
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async openObservedCase(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const member = await this.getObservedTargetMember(guildId, userId);
    const opened = await this.securityActionService.openObservedDetectionCase(
      member,
      detectionEventId,
      interaction.user
    );
    await interaction.followUp({
      content: opened
        ? `Opened a verification case for <@${userId}>.`
        : `This observed alert for <@${userId}> was already actioned.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async restrictObservedUser(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const member = await this.getObservedTargetMember(guildId, userId);
    const restricted = await this.securityActionService.restrictObservedDetection(
      member,
      detectionEventId,
      interaction.user
    );
    await interaction.followUp({
      content: restricted
        ? `Restricted <@${userId}> and opened a verification case.`
        : `This observed alert for <@${userId}> was already actioned.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private async showObservedBanModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const modal = new ModalBuilder()
      .setCustomId(`observed:ban_modal:${userId}:${detectionEventId}`)
      .setTitle('Confirm Observed Ban');
    const reasonInput = new TextInputBuilder()
      .setCustomId(OBSERVED_ACTION_MODAL_REASON_FIELD_ID)
      .setLabel(settings.observedActionBanRequiresReason ? 'Ban reason' : 'Ban reason (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.observedActionBanRequiresReason)
      .setMaxLength(500)
      .setPlaceholder(OBSERVED_BAN_DEFAULT_REASON);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  private async handleObservedBanModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsed = this.parseObservedActionCustomId(interaction.customId);
    if (!parsed || parsed.action !== 'ban_modal') {
      await interaction.reply({
        content: 'Unknown observed ban action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.BanMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Ban Members permission to ban a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorBanAction(interaction.guildId))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const providedReason = interaction.fields
      .getTextInputValue(OBSERVED_ACTION_MODAL_REASON_FIELD_ID)
      .trim();
    if (settings.observedActionBanRequiresReason && !providedReason) {
      await interaction.reply({
        content: 'A ban reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || OBSERVED_BAN_DEFAULT_REASON;
    try {
      const member = await this.getObservedTargetMember(interaction.guildId, parsed.userId);
      const banned = await this.securityActionService.banObservedDetection(
        member,
        parsed.detectionEventId,
        interaction.user,
        reason
      );
      await interaction.reply({
        content: banned
          ? `Banned <@${parsed.userId}>.`
          : `This observed alert for <@${parsed.userId}> was already actioned.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error handling observed ban modal submission:', error);
      const response = {
        content:
          'Failed to ban from the observed alert. A verification case may have been opened; check the case before retrying.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }

  private async dismissObservedDetection(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string,
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE
  ): Promise<void> {
    const dismissed = await this.securityActionService.dismissObservedDetection(
      guildId,
      userId,
      detectionEventId,
      interaction.user,
      actionType
    );
    await interaction.editReply({
      content: !dismissed
        ? `This observed alert for <@${userId}> was already actioned.`
        : actionType === AdminActionType.FALSE_POSITIVE
          ? `Marked the detection for <@${userId}> as a false positive.`
          : `Dismissed the observed alert for <@${userId}>.`,
      components: [],
    });
  }

  private async undoObservedDismissal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const undoneAction = await this.securityActionService.undoObservedDetectionAction(
      guildId,
      userId,
      detectionEventId,
      interaction.user
    );
    await interaction.editReply({
      content: !undoneAction
        ? `This observed alert for <@${userId}> does not have a dismissal to undo.`
        : undoneAction === AdminActionType.FALSE_POSITIVE
          ? `Undid the dismissal and reverted the false-positive indication for <@${userId}>.`
          : `Undid the dismissal for <@${userId}>.`,
      components: [],
    });
  }
}
