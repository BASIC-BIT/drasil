import {
  Client,
  ButtonInteraction,
  ButtonBuilder,
  MessageFlags,
  GuildMember,
  Message,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import {
  AdminActionType,
  DetectionType,
  VerificationStatus,
  type VerificationEvent,
} from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
import 'reflect-metadata';
import { IUserModerationService } from '../services/UserModerationService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
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
  buildCaseReviewDigestPageCustomId,
  buildCaseReviewDigestSelectCustomId,
  CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID,
  CASE_REVIEW_DIGEST_PAGE_CUSTOM_ID_PREFIX,
  CASE_REVIEW_DIGEST_SELECT_CUSTOM_ID_PREFIX,
  parseCaseReviewDigestPageCustomId,
  parseCaseReviewDigestSelectCustomId,
} from '../utils/caseReviewDigestCustomIds';
import {
  REPORT_USER_INITIATE_CUSTOM_ID,
  REPORT_USER_TYPED_MODAL_ID,
  ReportInteractionHandler,
} from './ReportInteractionHandler';
import {
  OPEN_CASE_CONTEXT_REASON_FIELD_ID,
  OpenCaseMessageContextModalData,
  parseOpenCaseContextModalCustomId,
  parseOpenCaseMessageContextModalCustomId,
} from './CaseCommandHandler';
import { SetupVerificationModalHandler } from './SetupVerificationModalHandler';
import { buildAdminCaseDetailUrl, buildAdminCaseQueueUrl } from '../utils/publicWebLinks';
import {
  handleSlashCommandConfirmationButton,
  isSlashCommandConfirmationCustomId,
} from '../utils/slashCommandConfirmations';
import {
  IModerationQueueService,
  ModerationQueueService,
} from '../services/ModerationQueueService';
import { IRoleGateService, RoleGateResolutionResult } from '../services/RoleGateService';
import {
  MODERATION_ACTION_REASON_FIELD_ID,
  MODERATOR_ACTION_BAN_DEFAULT_REASON,
  MODERATOR_ACTION_KICK_DEFAULT_REASON,
  ModeratorUserAction,
  parseModerationActionReasonModalCustomId,
} from '../utils/moderationActionCustomIds';
// Load environment variables
dotenv.config();

const OBSERVED_ACTION_MODAL_REASON_FIELD_ID = 'observed_ban_reason';
const KICK_ACTION_MODAL_REASON_FIELD_ID = 'kick_action_reason';
const OBSERVED_BAN_DEFAULT_REASON = 'Banned from observed suspicious notification';
const OBSERVED_KICK_DEFAULT_REASON = 'Kicked from observed suspicious notification';
const VERIFICATION_BAN_MODAL_PREFIX = 'verification:ban_modal';
const VERIFICATION_BAN_NOTES_FIELD_ID = 'verification_ban_notes';
const VERIFICATION_BAN_DEFAULT_REASON = 'Banned by moderator during verification';
const VERIFICATION_KICK_MODAL_PREFIX = 'verification:kick_modal';
const VERIFICATION_KICK_DEFAULT_REASON = 'Kicked by moderator during verification';
const OBSERVED_KICK_MODAL_PREFIX = 'observed:kick_modal';
const MODERATION_ACTION_CONFIRMATION_PREFIX = 'moderation_action_confirm';
const MODERATION_ACTION_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const CASE_REVIEW_DIGEST_PAGE_SIZE = 25;

interface PendingModerationActionConfirmation {
  readonly action: ModeratorUserAction;
  readonly targetUserId: string;
  readonly userId: string;
  readonly guildId: string;
  readonly reason: string;
  readonly createdAt: number;
}
/**
 * Interface for the Bot class
 */
export interface IInteractionHandler {
  /**
   * Handle a button interaction
   */
  handleButtonInteraction(interaction: ButtonInteraction): Promise<void>;

  handleStringSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void>;

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
  private serverMemberRepository?: IServerMemberRepository;
  private threadManager: IThreadManager;
  private adminActionRepository: IAdminActionRepository;
  private reportInteractionHandler: ReportInteractionHandler;
  private setupVerificationModalHandler: SetupVerificationModalHandler;
  private moderationQueueService?: IModerationQueueService;
  private roleGateService?: IRoleGateService;
  private detectionEventsRepository?: IDetectionEventsRepository;
  private moderationActionConfirmationCounter = 0;
  private readonly pendingModerationActionConfirmations = new Map<
    string,
    PendingModerationActionConfirmation
  >();

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
    productAnalyticsService?: IProductAnalyticsService,
    @inject(TYPES.ServerMemberRepository)
    @optional()
    serverMemberRepository?: IServerMemberRepository,
    @inject(TYPES.ModerationQueueService)
    @optional()
    moderationQueueService?: IModerationQueueService,
    @inject(TYPES.RoleGateService)
    @optional()
    roleGateService?: IRoleGateService,
    @inject(TYPES.DetectionEventsRepository)
    @optional()
    detectionEventsRepository?: IDetectionEventsRepository
  ) {
    this.client = client;
    this.notificationManager = notificationManager;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;
    this.configService = configService;
    this.verificationEventRepository = verificationEventRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.threadManager = threadManager;
    this.adminActionRepository = adminActionRepository;
    this.moderationQueueService = moderationQueueService;
    this.roleGateService = roleGateService;
    this.detectionEventsRepository = detectionEventsRepository;
    const reportSubmissionService = new ReportSubmissionService(
      this.configService,
      this.securityActionService
    );
    this.reportInteractionHandler = new ReportInteractionHandler(
      this.client,
      reportSubmissionService,
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

      if (isSlashCommandConfirmationCustomId(customId)) {
        await handleSlashCommandConfirmationButton(interaction);
        return;
      }

      if (this.isModerationActionConfirmationCustomId(customId)) {
        await this.handleModerationActionConfirmationButton(interaction, guildId);
        return;
      }

      const queueAcknowledgeItemId = ModerationQueueService.parseAcknowledgeCustomId(customId);
      if (queueAcknowledgeItemId) {
        await this.handleQueueAcknowledgeButtonInteraction(
          interaction,
          guildId,
          queueAcknowledgeItemId
        );
        return;
      }

      if (
        customId === CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID ||
        customId.startsWith(`${CASE_REVIEW_DIGEST_PAGE_CUSTOM_ID_PREFIX}:`)
      ) {
        await this.handleCaseReviewDigestButtonInteraction(interaction, guildId, customId);
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
        case 'restrict':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to repair a case.'
            );
            return;
          }
          await this.showLegacyAdminActionConfirmation(interaction, {
            action: 'repair',
            surface: 'case',
            userId: targetUserId,
          });
          break;
        case 'close':
          if (
            !(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))
          ) {
            await this.replyPermissionDenied(
              interaction,
              'You need moderation permissions to close a case.'
            );
            return;
          }
          await this.showLegacyAdminActionConfirmation(interaction, {
            action: 'close_no_action',
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
          await this.handleBanButton(interaction, guildId, targetUserId);
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

  private async handleQueueAcknowledgeButtonInteraction(
    interaction: ButtonInteraction,
    guildId: string,
    itemId: string
  ): Promise<void> {
    if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to acknowledge queue reminders.'
      );
      return;
    }

    if (!this.moderationQueueService) {
      await interaction.reply({
        content: 'Live moderation queue support is unavailable in this process.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const acknowledged = await this.moderationQueueService.acknowledgeAttentionItem(
      itemId,
      guildId
    );
    await interaction.editReply(
      acknowledged ? 'Queue reminder acknowledged.' : 'That queue reminder was already handled.'
    );
  }

  public async handleStringSelectMenuInteraction(
    interaction: StringSelectMenuInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This menu can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.customId.startsWith(`${CASE_REVIEW_DIGEST_SELECT_CUSTOM_ID_PREFIX}:`)) {
      await this.handleCaseReviewDigestSelectInteraction(interaction, interaction.guildId);
      return;
    }

    await interaction.reply({
      content: 'Unknown selection.',
      flags: MessageFlags.Ephemeral,
    });
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

    const normalizedParsed = this.normalizeLegacyAdminAction(parsed);

    if (normalizedParsed.action === 'cancel') {
      await interaction.update({ content: 'Cancelled.', components: [] });
      return;
    }

    if (normalizedParsed.action === 'menu') {
      await this.showAdminActionsMenu(interaction, guildId, normalizedParsed);
      return;
    }

    if (normalizedParsed.action === 'history') {
      if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to view history.'
        );
        return;
      }
      if (normalizedParsed.surface === 'observed') {
        await this.notificationManager.handleHistoryButtonClick(
          interaction,
          normalizedParsed.userId
        );
      } else {
        await this.handleHistoryButton(interaction, guildId, normalizedParsed.userId);
      }
      return;
    }

    if (normalizedParsed.action === 'ban' || normalizedParsed.action === 'observed_ban') {
      await this.handleAdminActionBan(interaction, guildId, normalizedParsed);
      return;
    }

    if (normalizedParsed.action.startsWith('confirm_')) {
      await this.executeConfirmedAdminAction(interaction, guildId, normalizedParsed);
      return;
    }

    const confirmation = this.getAdminActionConfirmation(normalizedParsed);
    if (!confirmation) {
      await interaction.reply({
        content: 'Unknown admin action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showAdminActionConfirmation(interaction, normalizedParsed, confirmation);
  }

  private normalizeLegacyAdminAction(parsed: ParsedAdminActionCustomId): ParsedAdminActionCustomId {
    switch (parsed.action) {
      case 'restrict_user':
        return { ...parsed, action: 'repair' };
      case 'lift_restriction':
        return { ...parsed, action: 'close_no_action' };
      case 'confirm_restrict_user':
        return { ...parsed, action: 'confirm_repair' };
      case 'confirm_lift_restriction':
        return { ...parsed, action: 'confirm_close_no_action' };
      case 'observed_restrict':
        return { ...parsed, action: 'observed_open' };
      case 'confirm_observed_restrict':
        return { ...parsed, action: 'confirm_observed_open' };
      default:
        return parsed;
    }
  }

  private async showAdminActionsMenu(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
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
    const hasKickMembersPermission = await this.hasAnyPermission(interaction, guildId, [
      PermissionFlagsBits.KickMembers,
    ]);

    if (!hasModerationPermission && !hasBanMembersPermission && !hasKickMembersPermission) {
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
        hasKickMembersPermission,
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
    const memberLeft = activeCase ? this.hasMemberLeft(activeCase) : false;
    const canBan =
      hasBanMembersPermission && !alreadyBanned && (await this.canUseModeratorBanAction(guildId));
    const canKick =
      hasKickMembersPermission &&
      !memberLeft &&
      (await this.canUseModeratorKickAction(guildId, 'case'));
    const actionButtons: ButtonBuilder[] = [];
    if (hasModerationPermission) {
      actionButtons.push(
        this.adminActionButton(parsed, 'history', 'History', ButtonStyle.Secondary)
      );
    }

    if (activeCase?.status === VerificationStatus.PENDING) {
      if (memberLeft) {
        if (hasBanMembersPermission && alreadyBanned) {
          actionButtons.push(
            this.adminActionButton(parsed, 'sync_ban', 'Sync Existing Ban', ButtonStyle.Danger)
          );
        } else if (canBan) {
          actionButtons.push(
            this.adminActionButton(parsed, 'ban', 'Ban by ID...', ButtonStyle.Danger)
          );
        }
        if (hasModerationPermission) {
          actionButtons.push(
            this.adminActionButton(
              parsed,
              'close_no_action',
              'Close No Action',
              ButtonStyle.Secondary
            )
          );
        }
      } else if (hasModerationPermission) {
        actionButtons.push(
          this.adminActionButton(parsed, 'verify', 'Verify User', ButtonStyle.Success),
          ...(canKick
            ? [this.adminActionButton(parsed, 'kick', 'Kick User', ButtonStyle.Danger)]
            : []),
          this.adminActionButton(
            parsed,
            'close_no_action',
            'Close No Action',
            ButtonStyle.Secondary
          ),
          this.adminActionButton(parsed, 'repair', 'Repair Active Case', ButtonStyle.Primary)
        );
        if (!activeCase.thread_id) {
          actionButtons.push(
            this.adminActionButton(parsed, 'thread', 'Create Thread', ButtonStyle.Primary)
          );
        }
      } else if (canKick) {
        actionButtons.push(this.adminActionButton(parsed, 'kick', 'Kick User', ButtonStyle.Danger));
      }
      if (!memberLeft && alreadyBanned) {
        actionButtons.push(
          this.adminActionButton(parsed, 'sync_ban', 'Sync Existing Ban', ButtonStyle.Danger)
        );
      }
      if (!memberLeft && canBan) {
        actionButtons.push(
          this.adminActionButton(parsed, 'ban', 'Ban User...', ButtonStyle.Danger)
        );
      }
    } else if (latestCase && hasModerationPermission) {
      actionButtons.push(
        this.adminActionButton(parsed, 'reopen', 'Reopen Verification', ButtonStyle.Primary)
      );
    }

    const buttons = [...actionButtons];
    const webCaseUrl = latestCase ? buildAdminCaseDetailUrl(guildId, latestCase.id) : null;
    if (webCaseUrl) {
      buttons.push(this.webLinkButton('Web Case', webCaseUrl));
    }

    const adminChannelId = await this.getAdminChannelId(guildId);
    const userLabel = await this.resolveUserDisplayLabel(guildId, parsed.userId);
    const details = [`Admin actions for ${userLabel}.`];
    if (activeCase?.status === VerificationStatus.PENDING) {
      details.push(
        memberLeft
          ? 'Membership: left or removed. Use Ban by ID if moderation should continue, or Close No Action if no action is needed.'
          : 'Case role: applied while this case is open.'
      );
    }
    const latestCaseLinks = latestCase
      ? this.formatVerificationCaseLinks(guildId, latestCase, adminChannelId)
      : [];
    if (latestCaseLinks.length > 0) {
      details.push(`Links: ${latestCaseLinks.join(' | ')}`);
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
        ...pendingCases.slice(0, 5).map((event) => {
          const links = this.formatVerificationCaseLinks(guildId, event, adminChannelId);
          return `Pending case ${event.id}${links.length ? ` - ${links.join(' | ')}` : ''}`;
        })
      );
    }
    if (actionButtons.length === 0) {
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
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId,
    permissions: {
      hasModerationPermission: boolean;
      hasBanMembersPermission: boolean;
      hasKickMembersPermission: boolean;
    }
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
    const canKick =
      permissions.hasKickMembersPermission &&
      (await this.canUseModeratorKickAction(guildId, 'observed'));
    const actionButtons: ButtonBuilder[] = [];
    const observedActionKind = await this.getObservedActionKind(guildId, parsed);
    const closeAction =
      observedActionKind === 'report' ? 'observed_close_report' : 'observed_dismiss';
    const closeLabel = observedActionKind === 'report' ? 'Close Report' : 'Dismiss Alert';
    if (permissions.hasModerationPermission) {
      actionButtons.push(
        this.adminActionButton(parsed, 'observed_open', 'Open Case', ButtonStyle.Primary),
        this.adminActionButton(parsed, closeAction, closeLabel, ButtonStyle.Secondary),
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
        actionButtons.splice(
          1,
          0,
          this.adminActionButton(parsed, 'observed_ban', 'Ban...', ButtonStyle.Danger)
        );
      } else {
        actionButtons.push(
          this.adminActionButton(parsed, 'observed_ban', 'Ban...', ButtonStyle.Danger)
        );
      }
    }
    if (canKick) {
      if (permissions.hasModerationPermission) {
        actionButtons.splice(
          canBan ? 2 : 1,
          0,
          this.adminActionButton(parsed, 'observed_kick', 'Kick', ButtonStyle.Danger)
        );
      } else {
        actionButtons.push(
          this.adminActionButton(parsed, 'observed_kick', 'Kick', ButtonStyle.Danger)
        );
      }
    }

    const buttons = [...actionButtons];
    const webQueueUrl = buildAdminCaseQueueUrl(guildId);
    if (webQueueUrl) {
      buttons.push(this.webLinkButton('Web Queue', webQueueUrl));
    }

    const userLabel = await this.resolveUserDisplayLabel(guildId, parsed.userId);
    await interaction.reply({
      content:
        `Admin actions for observed alert on ${userLabel}.` +
        (actionButtons.length === 0
          ? '\nNo available actions for your current permissions and this alert state.'
          : ''),
      allowedMentions: { parse: [] },
      components: this.createButtonRows(buttons),
      flags: MessageFlags.Ephemeral,
    });
  }

  private async getObservedActionKind(
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<'alert' | 'report'> {
    if (!parsed.detectionEventId || !this.detectionEventsRepository) {
      return 'alert';
    }

    const detectionEvent = await this.detectionEventsRepository
      .findById(parsed.detectionEventId)
      .catch(() => null);
    if (
      detectionEvent?.server_id !== guildId ||
      detectionEvent.user_id !== parsed.userId ||
      detectionEvent.detection_type !== DetectionType.USER_REPORT
    ) {
      return 'alert';
    }

    return 'report';
  }

  private async handleCaseReviewDigestButtonInteraction(
    interaction: ButtonInteraction,
    guildId: string,
    customId: string
  ): Promise<void> {
    if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to review open cases.'
      );
      return;
    }

    const page =
      customId === CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID
        ? 0
        : parseCaseReviewDigestPageCustomId(customId);
    if (page === null) {
      await interaction.reply({
        content: 'Unknown case digest page.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showCaseReviewDigestSelector(interaction, guildId, page, {
      update: customId !== CASE_REVIEW_DIGEST_OPEN_CUSTOM_ID,
    });
  }

  private async handleCaseReviewDigestSelectInteraction(
    interaction: StringSelectMenuInteraction,
    guildId: string
  ): Promise<void> {
    if (parseCaseReviewDigestSelectCustomId(interaction.customId) === null) {
      await interaction.reply({
        content: 'Unknown case digest selection.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to review open cases.'
      );
      return;
    }

    const selectedCaseId = interaction.values[0];
    if (!selectedCaseId) {
      await interaction.reply({
        content: 'No case was selected.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectedCase = await this.verificationEventRepository.findById(selectedCaseId);
    if (
      !selectedCase ||
      selectedCase.server_id !== guildId ||
      selectedCase.status !== VerificationStatus.PENDING ||
      !selectedCase.user_id
    ) {
      await interaction.reply({
        content: 'That case is no longer pending.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.showAdminActionsMenu(interaction, guildId, {
      action: 'menu',
      surface: 'case',
      userId: selectedCase.user_id,
    });
  }

  private async showCaseReviewDigestSelector(
    interaction: ButtonInteraction,
    guildId: string,
    page: number,
    options: { update: boolean }
  ): Promise<void> {
    const pendingCases = await this.verificationEventRepository.findPendingByServer(guildId);
    if (pendingCases.length === 0) {
      const response = {
        content: 'There are no pending cases for this server.',
        components: [],
      };
      if (options.update) {
        await interaction.update(response);
      } else {
        await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    const sortedCases = [...pendingCases].sort(
      (left, right) => left.updated_at.getTime() - right.updated_at.getTime()
    );
    const pageCount = Math.ceil(sortedCases.length / CASE_REVIEW_DIGEST_PAGE_SIZE);
    const safePage = Math.min(Math.max(page, 0), pageCount - 1);
    const pageCases = sortedCases.slice(
      safePage * CASE_REVIEW_DIGEST_PAGE_SIZE,
      (safePage + 1) * CASE_REVIEW_DIGEST_PAGE_SIZE
    );
    const userLabels = await this.resolveUserDisplayLabels(
      guildId,
      pageCases.map((event) => event.user_id)
    );
    const selector = new StringSelectMenuBuilder()
      .setCustomId(buildCaseReviewDigestSelectCustomId(safePage))
      .setPlaceholder('Choose a pending case')
      .addOptions(
        pageCases.map((event) => ({
          label: this.truncateSelectText(
            `Case for ${userLabels.get(event.user_id) ?? event.user_id}`,
            100
          ),
          description: this.truncateSelectText(
            `${this.formatHoursSince(event.updated_at)} since update${event.thread_id ? ` | thread ${event.thread_id}` : ''}`,
            100
          ),
          value: event.id,
        }))
      );
    const components: Array<
      ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
    > = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selector)];

    if (pageCount > 1) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(buildCaseReviewDigestPageCustomId(Math.max(safePage - 1, 0)))
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage === 0),
          new ButtonBuilder()
            .setCustomId(buildCaseReviewDigestPageCustomId(Math.min(safePage + 1, pageCount - 1)))
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= pageCount - 1)
        )
      );
    }

    const webQueueUrl = buildAdminCaseQueueUrl(guildId);
    if (webQueueUrl) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          this.webLinkButton('Open Web Queue', webQueueUrl)
        )
      );
    }

    const response = {
      content: `Open cases for this server (${sortedCases.length} total). Page ${safePage + 1}/${pageCount}. Selecting a case opens the existing Admin Actions menu.`,
      components,
      allowedMentions: { parse: [] },
    };

    if (options.update) {
      await interaction.update(response);
      return;
    }

    await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
  }

  private formatHoursSince(value: Date): string {
    const ageHours = Math.max(1, Math.floor((Date.now() - value.getTime()) / (60 * 60 * 1000)));
    return `${ageHours}h`;
  }

  private async resolveUserDisplayLabel(guildId: string, userId: string): Promise<string> {
    const labels = await this.resolveUserDisplayLabels(guildId, [userId]);
    return labels.get(userId) ?? userId;
  }

  private async resolveUserDisplayLabels(
    guildId: string,
    userIds: string[]
  ): Promise<Map<string, string>> {
    const uniqueUserIds = [...new Set(userIds)];
    const labels = new Map(
      uniqueUserIds.map((userId) => [userId, this.formatUserDisplayLabel(userId, null)])
    );
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return labels;
    }

    const fetchedMembers = await guild.members.fetch({ user: uniqueUserIds }).catch(() => null);
    const fetchedMemberMap = fetchedMembers as {
      get?: (userId: string) => GuildMember | null;
    } | null;
    if (fetchedMemberMap && typeof fetchedMemberMap.get === 'function') {
      for (const userId of uniqueUserIds) {
        labels.set(
          userId,
          this.formatUserDisplayLabel(
            userId,
            this.getMemberDisplayName(fetchedMemberMap.get(userId))
          )
        );
      }
      return labels;
    }

    if (uniqueUserIds.length === 1 && fetchedMembers) {
      const userId = uniqueUserIds[0];
      labels.set(
        userId,
        this.formatUserDisplayLabel(
          userId,
          this.getMemberDisplayName(fetchedMembers as unknown as GuildMember)
        )
      );
    }

    return labels;
  }

  private getMemberDisplayName(member: GuildMember | null): string | null {
    return (
      [member?.displayName, member?.nickname, member?.user.globalName, member?.user.username].find(
        (name) => typeof name === 'string' && name.trim().length > 0
      ) ?? null
    );
  }

  private formatUserDisplayLabel(userId: string, displayName: string | null): string {
    const trimmedDisplayName = displayName?.trim();
    if (!trimmedDisplayName || trimmedDisplayName === userId) {
      return userId;
    }

    return `${trimmedDisplayName} (${userId})`;
  }

  private async getAdminChannelId(guildId: string): Promise<string | null> {
    const cachedAdminChannelId =
      this.configService.getCachedServerConfig(guildId)?.admin_channel_id;
    if (cachedAdminChannelId) {
      return cachedAdminChannelId;
    }

    const server = await this.configService.getServerConfig(guildId).catch(() => null);
    return server?.admin_channel_id ?? null;
  }

  private formatVerificationCaseLinks(
    guildId: string,
    event: VerificationEvent,
    adminChannelId: string | null
  ): string[] {
    return [
      (event.notification_channel_id ?? adminChannelId) && event.notification_message_id
        ? `admin: https://discord.com/channels/${guildId}/${event.notification_channel_id ?? adminChannelId}/${event.notification_message_id}`
        : null,
      event.private_evidence_thread_id
        ? `evidence: https://discord.com/channels/${guildId}/${event.private_evidence_thread_id}`
        : null,
      event.thread_id ? `case: https://discord.com/channels/${guildId}/${event.thread_id}` : null,
      this.formatSourceMessageLink(guildId, event),
    ].filter((value): value is string => Boolean(value));
  }

  private hasMemberLeft(event: VerificationEvent): boolean {
    return this.metadataToRecord(event.metadata).membership_state === 'left_or_removed';
  }

  private formatSourceMessageLink(guildId: string, event: VerificationEvent): string | null {
    const metadata = this.metadataToRecord(event.metadata);
    const sourceChannelId = this.readString(metadata.source_channel_id);
    const sourceMessageId = this.readString(metadata.source_message_id);
    if (!sourceChannelId || !sourceMessageId) {
      return null;
    }

    return `source: https://discord.com/channels/${guildId}/${sourceChannelId}/${sourceMessageId}`;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...(metadata as Record<string, unknown>) };
  }

  private truncateSelectText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return value.slice(0, maxLength);
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

  private webLinkButton(label: string, url: string): ButtonBuilder {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
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
          message: `Verify ${target} and remove the case role?`,
          style: ButtonStyle.Success,
        };
      case 'close_no_action':
        return {
          label: 'Confirm Close',
          message: `Close pending verification cases for ${target} without verifying or banning them? The case role will be removed.`,
          style: ButtonStyle.Secondary,
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
      case 'kick':
        return {
          label: 'Confirm Kick',
          message: `Kick ${target} from this server and resolve pending verification cases as kicked? If they rejoin, Drasil will use the prior kick as review context.`,
          style: ButtonStyle.Danger,
        };
      case 'reopen':
        return {
          label: 'Confirm Reopen',
          message: `Reopen verification for ${target} and apply the case role again?`,
          style: ButtonStyle.Primary,
        };
      case 'observed_open':
        return {
          label: 'Confirm Open Case',
          message: `Open a verification case for observed alert on ${target}?`,
          style: ButtonStyle.Primary,
        };
      case 'observed_kick':
        return {
          label: 'Confirm Kick',
          message: `Kick ${target} from this server for this observed alert? If they rejoin, Drasil will use the prior kick as review context.`,
          style: ButtonStyle.Danger,
        };
      case 'observed_close_report':
        return {
          label: 'Confirm Close Report',
          message: `Close this report for ${target} without additional moderation action?`,
          style: ButtonStyle.Secondary,
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
      content: await this.buildAdminActionConfirmationMessage(
        interaction,
        parsed,
        confirmation.message
      ),
      allowedMentions: { parse: [] },
      components,
    };

    if (options?.update === false) {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update(response);
  }

  private async buildAdminActionConfirmationMessage(
    interaction: ButtonInteraction,
    parsed: ParsedAdminActionCustomId,
    baseMessage: string
  ): Promise<string> {
    if (
      !this.roleGateService ||
      parsed.surface !== 'case' ||
      (parsed.action !== 'verify' && parsed.action !== 'close_no_action')
    ) {
      return baseMessage;
    }

    const member = await interaction.guild?.members.fetch(parsed.userId).catch(() => null);
    if (!member) {
      return baseMessage;
    }

    const roleGateService = this.roleGateService;
    const preview = await roleGateService.previewResolution(member).catch(() => null);
    const roleGateMessage = preview ? roleGateService.formatResolutionConfirmation(preview) : null;
    return roleGateMessage ? `${baseMessage}\n\n${roleGateMessage}` : baseMessage;
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

    await this.handleBanButton(interaction, guildId, parsed.userId);
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

    if (action === 'close_no_action') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to close a case.'
        );
        return;
      }
      await this.handleCloseNoActionButton(interaction, guildId, parsed.userId);
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

    if (action === 'kick') {
      if (!(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.KickMembers]))) {
        await this.replyPermissionDenied(
          interaction,
          'You need Kick Members permission to kick a user.'
        );
        return;
      }
      if (!(await this.canUseModeratorKickAction(guildId, 'case'))) {
        await interaction.reply({
          content:
            'Drasil case kick actions are disabled for this server or the bot lacks Kick Members permission.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await this.showVerificationKickModal(interaction, guildId, parsed.userId);
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

    if (action === 'observed_kick') {
      if (!(await this.hasAnyPermission(interaction, guildId, [PermissionFlagsBits.KickMembers]))) {
        await this.replyPermissionDenied(
          interaction,
          'You need Kick Members permission to kick a user.'
        );
        return;
      }
      if (!(await this.canUseModeratorKickAction(guildId, 'observed'))) {
        await interaction.reply({
          content:
            'Drasil observed alert kick actions are disabled for this server or the bot lacks Kick Members permission.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await this.showObservedKickModal(
        interaction,
        guildId,
        parsed.userId,
        parsed.detectionEventId
      );
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
        await this.openObservedCase(interaction, guildId, parsed.userId, parsed.detectionEventId);
        return;
      case 'observed_close_report':
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
            : AdminActionType.DISMISS,
          action === 'observed_close_report' ? 'report' : 'alert'
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
      const message = error instanceof Error && error.message ? error.message : 'Unknown error';
      await interaction.followUp({
        content: `An error occurred while repairing the active case: ${message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async refreshActiveCaseNotification(guildId: string, userId: string): Promise<void> {
    const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
      userId,
      guildId
    );
    if (!activeCase?.notification_message_id) {
      return;
    }

    await this.notificationManager
      .updateNotificationButtons(activeCase, VerificationStatus.PENDING)
      .catch((error) => {
        console.warn(`Failed to refresh case notification for ${userId}:`, error);
      });
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

  private async showVerificationKickModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const modal = new ModalBuilder()
      .setCustomId(`${VERIFICATION_KICK_MODAL_PREFIX}:${userId}`)
      .setTitle('Confirm User Kick');
    const reasonInput = new TextInputBuilder()
      .setCustomId(KICK_ACTION_MODAL_REASON_FIELD_ID)
      .setLabel(
        settings.moderatorKickActionRequiresReason ? 'Kick reason' : 'Kick reason (optional)'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.moderatorKickActionRequiresReason)
      .setMaxLength(500)
      .setPlaceholder(VERIFICATION_KICK_DEFAULT_REASON);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  private async handleCloseNoActionButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      const roleGatePreview =
        member && this.roleGateService
          ? await this.roleGateService.previewResolution(member).catch(() => undefined)
          : undefined;
      const closedCount = await this.userModerationService.closeCaseNoAction(
        guild,
        userId,
        interaction.user,
        'Closed with no action by moderator.'
      );
      const roleGateResult =
        member && closedCount > 0 && roleGatePreview
          ? await this.roleGateService?.applyResolution(
              member,
              interaction.user,
              'close_no_action',
              roleGatePreview
            )
          : undefined;

      const caseWord = closedCount === 1 ? 'case' : 'cases';
      await interaction.followUp({
        content:
          closedCount === 0
            ? `No pending verification cases remain for <@${userId}>.`
            : `Closed ${closedCount} pending verification ${caseWord} for <@${userId}> with no action.${this.formatRoleGateResolutionResult(roleGateResult)}`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error closing case with no action:', error);
      await interaction.followUp({
        content:
          'Could not close the case with no action. If the user has the case role, confirm Drasil can remove it and try again.',
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
      const roleGatePreview = this.roleGateService
        ? await this.roleGateService.previewResolution(member).catch(() => undefined)
        : undefined;

      await this.userModerationService.verifyUser(member, interaction.user);
      const roleGateResult = roleGatePreview
        ? await this.roleGateService?.applyResolution(
            member,
            interaction.user,
            'verify',
            roleGatePreview
          )
        : undefined;

      await interaction.followUp({
        content: `User <@${userId}> has been verified and can now access the server.${this.formatRoleGateResolutionResult(roleGateResult)}`,
        allowedMentions: { parse: [] },
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

  private formatRoleGateResolutionResult(result?: RoleGateResolutionResult): string {
    if (!result?.applied) {
      return '';
    }

    const lines = [
      ...result.summaryLines,
      ...result.warnings.map((warning) => `Role gate warning: ${warning}`),
    ];
    return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
  }

  private async handleBanButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const modal = new ModalBuilder()
      .setCustomId(`${VERIFICATION_BAN_MODAL_PREFIX}:${userId}`)
      .setTitle('Confirm User Ban');
    const notesInput = new TextInputBuilder()
      .setCustomId(VERIFICATION_BAN_NOTES_FIELD_ID)
      .setLabel(settings.moderatorBanActionRequiresReason ? 'Ban reason' : 'Ban reason (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.moderatorBanActionRequiresReason)
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
        content: `Verification for <@${userId}> has been reopened. The case role has been reapplied.`,
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
    const moderationActionReason = parseModerationActionReasonModalCustomId(interaction.customId);
    if (moderationActionReason) {
      await this.handleModerationActionReasonModalSubmit(interaction, moderationActionReason);
      return;
    }

    const moderationActionConfirmationId = this.parseModerationActionConfirmationModalCustomId(
      interaction.customId
    );
    if (moderationActionConfirmationId) {
      await this.handleModerationActionConfirmationModalSubmit(
        interaction,
        moderationActionConfirmationId
      );
      return;
    }

    const openCaseMessageContext = parseOpenCaseMessageContextModalCustomId(interaction.customId);
    if (openCaseMessageContext) {
      await this.handleOpenCaseContextModalSubmit(interaction, openCaseMessageContext);
      return;
    }

    const openCaseTargetUserId = parseOpenCaseContextModalCustomId(interaction.customId);
    if (openCaseTargetUserId) {
      await this.handleOpenCaseContextModalSubmit(interaction, {
        targetUserId: openCaseTargetUserId,
      });
      return;
    }

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
        if (interaction.customId.startsWith(`${VERIFICATION_KICK_MODAL_PREFIX}:`)) {
          await this.handleVerificationKickModalSubmit(interaction);
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
        if (interaction.customId.startsWith(`${OBSERVED_KICK_MODAL_PREFIX}:`)) {
          await this.handleObservedKickModalSubmit(interaction);
          return;
        }
        console.log(
          `[InteractionHandler] Ignoring unknown modal submission: ${interaction.customId}`
        );
    }
  }

  private nextModerationActionConfirmationId(): string {
    this.moderationActionConfirmationCounter += 1;
    return `${Date.now().toString(36)}${this.moderationActionConfirmationCounter.toString(36)}`;
  }

  private buildModerationActionConfirmationCustomId(
    action: 'confirm' | 'cancel',
    id: string
  ): string {
    return `${MODERATION_ACTION_CONFIRMATION_PREFIX}:${action}:${id}`;
  }

  private parseModerationActionConfirmationCustomId(
    customId: string
  ): { action: 'confirm' | 'cancel'; id: string } | null {
    const [prefix, action, id] = customId.split(':');
    if (prefix !== MODERATION_ACTION_CONFIRMATION_PREFIX || !id) {
      return null;
    }
    if (action !== 'confirm' && action !== 'cancel') {
      return null;
    }

    return { action, id };
  }

  private isModerationActionConfirmationCustomId(customId: string): boolean {
    return this.parseModerationActionConfirmationCustomId(customId) !== null;
  }

  private buildModerationActionConfirmationModalCustomId(id: string): string {
    return `${MODERATION_ACTION_CONFIRMATION_PREFIX}:modal:${id}`;
  }

  private parseModerationActionConfirmationModalCustomId(customId: string): string | null {
    const [prefix, action, id] = customId.split(':');
    if (prefix !== MODERATION_ACTION_CONFIRMATION_PREFIX || action !== 'modal' || !id) {
      return null;
    }

    return id;
  }

  private pruneModerationActionConfirmations(now = Date.now()): void {
    for (const [id, pending] of this.pendingModerationActionConfirmations.entries()) {
      if (now - pending.createdAt > MODERATION_ACTION_CONFIRMATION_TTL_MS) {
        this.pendingModerationActionConfirmations.delete(id);
      }
    }
  }

  private getModerationActionLabel(action: ModeratorUserAction): string {
    return action === 'ban' ? 'Ban User' : 'Kick User';
  }

  private getModerationActionDefaultReason(action: ModeratorUserAction): string {
    return action === 'ban'
      ? MODERATOR_ACTION_BAN_DEFAULT_REASON
      : MODERATOR_ACTION_KICK_DEFAULT_REASON;
  }

  private async getModerationActionReasonRequired(
    guildId: string,
    action: ModeratorUserAction
  ): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    return action === 'ban'
      ? settings.moderatorBanActionRequiresReason
      : settings.moderatorKickActionRequiresReason;
  }

  private async ensureModerationActionAllowed(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    guildId: string,
    action: ModeratorUserAction
  ): Promise<boolean> {
    const permission =
      action === 'ban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.KickMembers;
    const permissionName = action === 'ban' ? 'Ban Members' : 'Kick Members';
    if (!(await this.hasAnyPermission(interaction, guildId, [permission]))) {
      await this.replyPermissionDenied(
        interaction,
        `You need ${permissionName} permission to ${action} a user.`
      );
      return false;
    }

    const actionEnabled =
      action === 'ban'
        ? await this.canUseModeratorBanAction(guildId)
        : await this.canUseModeratorKickAction(guildId, 'case');
    if (!actionEnabled) {
      await interaction.reply({
        content:
          action === 'ban'
            ? 'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.'
            : 'Drasil kick actions are disabled for this server or the bot lacks Kick Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    return true;
  }

  private async handleModerationActionReasonModalSubmit(
    interaction: ModalSubmitInteraction,
    input: {
      action: ModeratorUserAction;
      targetUserId: string;
      sourceChannelId?: string;
      sourceMessageId?: string;
    }
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (input.targetUserId === interaction.user.id) {
      await interaction.reply({
        content: input.action === 'ban' ? 'You cannot ban yourself.' : 'You cannot kick yourself.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.ensureModerationActionAllowed(interaction, interaction.guildId, input.action))
    ) {
      return;
    }

    const providedReason = interaction.fields
      .getTextInputValue(MODERATION_ACTION_REASON_FIELD_ID)
      .trim();
    const reasonRequired = await this.getModerationActionReasonRequired(
      interaction.guildId,
      input.action
    );
    if (reasonRequired && !providedReason) {
      await interaction.reply({
        content:
          input.action === 'ban' ? 'A ban reason is required.' : 'A kick reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || this.getModerationActionDefaultReason(input.action);
    const guild = await this.client.guilds.fetch(interaction.guildId);
    if (input.action === 'kick') {
      const member = await guild.members.fetch(input.targetUserId).catch(() => null);
      if (!member) {
        await interaction.reply({
          content: `Could not find user <@${input.targetUserId}> in this server.`,
          allowedMentions: { parse: [] },
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    this.pruneModerationActionConfirmations();
    const id = this.nextModerationActionConfirmationId();
    this.pendingModerationActionConfirmations.set(id, {
      action: input.action,
      targetUserId: input.targetUserId,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      reason,
      createdAt: Date.now(),
    });

    const label = this.getModerationActionLabel(input.action);
    await interaction.reply({
      content: `${label} for <@${input.targetUserId}>? Confirming will apply this action immediately.`,
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(this.buildModerationActionConfirmationCustomId('confirm', id))
            .setLabel(label)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(this.buildModerationActionConfirmationCustomId('cancel', id))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleModerationActionConfirmationButton(
    interaction: ButtonInteraction,
    guildId: string
  ): Promise<void> {
    const parsed = this.parseModerationActionConfirmationCustomId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: 'Unknown moderation confirmation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    this.pruneModerationActionConfirmations();
    const pending = this.pendingModerationActionConfirmations.get(parsed.id);
    if (!pending) {
      await interaction.reply({
        content: 'That confirmation expired. Start the action again if you still want to continue.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (pending.userId !== interaction.user.id || pending.guildId !== guildId) {
      await interaction.reply({
        content: 'Only the moderator who started this action can use this confirmation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.action === 'cancel') {
      this.pendingModerationActionConfirmations.delete(parsed.id);
      await interaction.update({ content: 'Cancelled.', components: [] });
      return;
    }

    const confirmationText = pending.action.toUpperCase();
    const modal = new ModalBuilder()
      .setCustomId(this.buildModerationActionConfirmationModalCustomId(parsed.id))
      .setTitle(`Confirm ${this.getModerationActionLabel(pending.action)}`);
    const input = new TextInputBuilder()
      .setCustomId('moderation_action_confirmation_text')
      .setLabel(`Type ${confirmationText} to confirm`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(8);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  }

  private async handleModerationActionConfirmationModalSubmit(
    interaction: ModalSubmitInteraction,
    id: string
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    this.pruneModerationActionConfirmations();
    const pending = this.pendingModerationActionConfirmations.get(id);
    if (!pending) {
      await interaction.reply({
        content: 'That confirmation expired. Start the action again if you still want to continue.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (pending.userId !== interaction.user.id || pending.guildId !== interaction.guildId) {
      await interaction.reply({
        content: 'Only the moderator who started this action can use this confirmation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const confirmationText = interaction.fields
      .getTextInputValue('moderation_action_confirmation_text')
      .trim()
      .toUpperCase();
    if (confirmationText !== pending.action.toUpperCase()) {
      await interaction.reply({
        content: `Confirmation text did not match. Type ${pending.action.toUpperCase()} to continue.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.ensureModerationActionAllowed(interaction, interaction.guildId, pending.action))
    ) {
      return;
    }

    this.pendingModerationActionConfirmations.delete(id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      if (pending.action === 'ban') {
        const member = await guild.members.fetch(pending.targetUserId).catch(() => null);
        if (member) {
          await this.userModerationService.banUser(member, pending.reason, interaction.user);
        } else {
          await this.userModerationService.banUserById(
            guild,
            pending.targetUserId,
            pending.reason,
            interaction.user
          );
        }
        await interaction.editReply({
          content: `Banned <@${pending.targetUserId}> from this server.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const member = await guild.members.fetch(pending.targetUserId).catch(() => null);
      if (!member) {
        await interaction.editReply({
          content: `Could not find user <@${pending.targetUserId}> in this server.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await this.userModerationService.kickUser(member, pending.reason, interaction.user);
      await interaction.editReply({
        content: `Kicked <@${pending.targetUserId}> from this server.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to ${pending.action} user from native action:`, error);
      await interaction.editReply({
        content: `Failed to ${pending.action} <@${pending.targetUserId}>. Please try again later.`,
        allowedMentions: { parse: [] },
      });
    }
  }

  private async handleOpenCaseContextModalSubmit(
    interaction: ModalSubmitInteraction,
    input: { targetUserId: string } | OpenCaseMessageContextModalData
  ): Promise<void> {
    const { targetUserId } = input;
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (targetUserId === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot open a case for yourself.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.ModerateMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Moderate Members permission to open a case.'
      );
      return;
    }

    const reason =
      interaction.fields.getTextInputValue(OPEN_CASE_CONTEXT_REASON_FIELD_ID).trim() || undefined;
    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (settings.adminCaseOpenRequiresReason && !reason) {
      await interaction.reply({
        content: 'A case reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
      if (!targetMember) {
        await interaction.editReply({
          content: `Could not find user <@${targetUserId}> in this server.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const sourceMetadata = this.getOpenCaseSourceMetadata(input);
      const sourceMessage = sourceMetadata
        ? await this.fetchOpenCaseSourceMessage(
            sourceMetadata.source_channel_id,
            sourceMetadata.source_message_id
          )
        : undefined;
      const result = await this.securityActionService.openAdminCase(
        targetMember,
        interaction.user,
        {
          action: 'open_case',
          reason,
          ...(sourceMetadata
            ? {
                metadata: sourceMetadata,
                ...(sourceMessage ? { sourceMessage } : {}),
              }
            : {}),
        }
      );
      if (!result.opened) {
        throw new Error('Case flow returned false');
      }

      const content = result.caseRoleActive
        ? `Opened a case for ${targetMember.user.tag} and applied the case role.`
        : `Opened a case for ${targetMember.user.tag}, but I could not apply the case role. Check bot permissions and role hierarchy.`;
      await interaction.editReply({
        content,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Failed to open case from native user action:', error);
      await interaction.editReply({
        content: `Failed to open a case for <@${targetUserId}>. Please try again later.`,
        allowedMentions: { parse: [] },
      });
    }
  }

  private getOpenCaseSourceMetadata(
    input: { targetUserId: string } | OpenCaseMessageContextModalData
  ): { source: string; source_channel_id: string; source_message_id: string } | undefined {
    if (!('sourceChannelId' in input)) {
      return undefined;
    }

    return {
      source: 'message_context_case',
      source_channel_id: input.sourceChannelId,
      source_message_id: input.sourceMessageId,
    };
  }

  private async fetchOpenCaseSourceMessage(
    sourceChannelId: string,
    sourceMessageId: string
  ): Promise<Message | undefined> {
    const channel = await this.client.channels.fetch(sourceChannelId).catch(() => null);
    if (!channel || !('messages' in channel)) {
      return undefined;
    }

    return (await channel.messages.fetch(sourceMessageId).catch(() => null)) ?? undefined;
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
    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (settings.moderatorBanActionRequiresReason && !finalNotes) {
      await interaction.reply({
        content: 'A ban reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const banReason = finalNotes || VERIFICATION_BAN_DEFAULT_REASON;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId).catch(() => null);

      if (member) {
        await this.userModerationService.banUser(member, banReason, interaction.user);
      } else {
        await this.userModerationService.banUserById(guild, userId, banReason, interaction.user);
      }

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

  private async handleVerificationKickModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = interaction.customId.slice(`${VERIFICATION_KICK_MODAL_PREFIX}:`.length);
    if (!userId) {
      await interaction.reply({
        content: 'Unknown kick action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.KickMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Kick Members permission to kick a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorKickAction(interaction.guildId, 'case'))) {
      await interaction.reply({
        content:
          'Drasil case kick actions are disabled for this server or the bot lacks Kick Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providedReason = interaction.fields
      .getTextInputValue(KICK_ACTION_MODAL_REASON_FIELD_ID)
      .trim();
    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (settings.moderatorKickActionRequiresReason && !providedReason) {
      await interaction.reply({
        content: 'A kick reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || VERIFICATION_KICK_DEFAULT_REASON;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        throw new Error('Could not find member in guild');
      }

      await this.userModerationService.kickUser(member, reason, interaction.user);

      await interaction.editReply({
        content: `Kicked <@${userId}> and resolved pending verification cases as kicked.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Error kicking user from case action:', error);
      await interaction.editReply({
        content: 'An error occurred while kicking the user.',
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
    interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
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

  private async canUseModeratorKickAction(
    guildId: string,
    source: 'case' | 'observed' = 'case'
  ): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const policyEnabled =
      source === 'observed'
        ? settings.observedActionKickEnabled
        : settings.moderatorKickActionEnabled;
    if (!policyEnabled) {
      return false;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const botMember =
      guild?.members.me ??
      (guild && typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.KickMembers) ?? false;
  }

  private async isUserBanned(guildId: string, userId: string): Promise<boolean> {
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    const ban = await guild?.bans.fetch(userId).catch(() => null);
    return Boolean(ban);
  }

  private async replyPermissionDenied(
    interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
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

      case 'close_report':
      case 'dismiss':
      case 'false_positive':
        if (!(await hasModerationPermission())) {
          await this.replyPermissionDenied(
            interaction,
            parsed.action === 'close_report'
              ? 'You need moderation permissions to close a report.'
              : 'You need moderation permissions to dismiss an alert.',
            { clearComponents: true }
          );
          return;
        }
        await this.showLegacyAdminActionConfirmation(interaction, {
          action:
            parsed.action === 'false_positive'
              ? 'observed_false_positive'
              : parsed.action === 'close_report'
                ? 'observed_close_report'
                : 'observed_dismiss',
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

  private async showObservedKickModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const modal = new ModalBuilder()
      .setCustomId(`${OBSERVED_KICK_MODAL_PREFIX}:${userId}:${detectionEventId}`)
      .setTitle('Confirm Observed Kick');
    const reasonInput = new TextInputBuilder()
      .setCustomId(KICK_ACTION_MODAL_REASON_FIELD_ID)
      .setLabel(
        settings.moderatorKickActionRequiresReason ? 'Kick reason' : 'Kick reason (optional)'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.moderatorKickActionRequiresReason)
      .setMaxLength(500)
      .setPlaceholder(OBSERVED_KICK_DEFAULT_REASON);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  private async handleObservedKickModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This action can only be performed in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsed = this.parseObservedActionCustomId(interaction.customId);
    if (!parsed || parsed.action !== 'kick_modal') {
      await interaction.reply({
        content: 'Unknown observed kick action.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.KickMembers,
      ]))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need Kick Members permission to kick a user.'
      );
      return;
    }
    if (!(await this.canUseModeratorKickAction(interaction.guildId, 'observed'))) {
      await interaction.reply({
        content:
          'Drasil observed alert kick actions are disabled for this server or the bot lacks Kick Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providedReason = interaction.fields
      .getTextInputValue(KICK_ACTION_MODAL_REASON_FIELD_ID)
      .trim();
    const serverConfig = await this.configService.getServerConfig(interaction.guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (settings.moderatorKickActionRequiresReason && !providedReason) {
      await interaction.reply({
        content: 'A kick reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || OBSERVED_KICK_DEFAULT_REASON;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const member = await this.getObservedTargetMember(interaction.guildId, parsed.userId);
      const kicked = await this.securityActionService.kickObservedDetection(
        member,
        parsed.detectionEventId,
        interaction.user,
        reason
      );
      await interaction.editReply({
        content: kicked
          ? `Kicked <@${parsed.userId}> from the observed alert.`
          : `This observed alert for <@${parsed.userId}> was already actioned.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Error kicking user from observed alert:', error);
      await interaction.editReply({
        content: 'An error occurred while kicking the user.',
      });
    }
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
      .setLabel(settings.moderatorBanActionRequiresReason ? 'Ban reason' : 'Ban reason (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.moderatorBanActionRequiresReason)
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
    if (settings.moderatorBanActionRequiresReason && !providedReason) {
      await interaction.reply({
        content: 'A ban reason is required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = providedReason || OBSERVED_BAN_DEFAULT_REASON;
    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(parsed.userId).catch(() => null);
      const banned = member
        ? await this.securityActionService.banObservedDetection(
            member,
            parsed.detectionEventId,
            interaction.user,
            reason
          )
        : await this.securityActionService.banObservedDetectionById(
            guild,
            parsed.userId,
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
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE,
    kind: 'alert' | 'report' = 'alert'
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
          : kind === 'report'
            ? `Closed the report for <@${userId}>.`
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
