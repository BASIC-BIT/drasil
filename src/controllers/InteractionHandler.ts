import { handleCaptchaImageInteraction } from './captchaImageInteractions';
import { createBotCaptchaImageActions } from '../application/adapters/captchaImage';
import { McpCommandHandler } from './McpCommandHandler';
import { requireCaptchaOutcome } from '../application/adapters/captcha';
import { requireQuarantineOutcome } from '../application/adapters/quarantine';
import { requireDetectionOutcome } from '../application/adapters/detections';
import {
  encodeQueuedAction,
  type CaptchaCommand,
  type CaptchaOutcome,
  type DetectionCommand,
  type DetectionOutcome,
  type CaseCommand,
  type CaseOutcome,
} from '@drasil/application';
import { CaseActionDeniedError, requireCaseOutcome } from '../application/adapters/cases';
import type { BotApplication } from '../application/createBotApplication';
import { createDiscordActionContext } from '../application/context';
import { isReportIntakeActionChannel } from '../utils/reportIntakeAdminActions';
import { IReportIntakeRepository } from '../repositories/ReportIntakeRepository';
import { IModerationActionRequestRepository } from '../repositories/ModerationActionRequestRepository';
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
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject, optional } from 'inversify';
import { INotificationManager } from '../services/NotificationManager';
import { TYPES } from '../di/symbols';
import {
  ModerationActionRequestType,
  AdminActionType,
  CaseAttentionState,
  CaseKind,
  CaptchaChallengeStatus,
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
import { IProductAnalyticsService } from '../services/ProductAnalyticsService';
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
import { buildAdminCaseDetailUrl, buildAdminModerationInboxUrl } from '../utils/publicWebLinks';
import {
  handleSlashCommandConfirmationButton,
  isSlashCommandConfirmationCustomId,
} from '../utils/slashCommandConfirmations';
import { ModerationQueueService } from '../services/ModerationQueueService';
import { IRoleGateService, RoleGateResolutionResult } from '../services/RoleGateService';
import { IAccountQuarantineService } from '../services/AccountQuarantineService';
import { getAccountQuarantineSettings } from '../utils/accountQuarantineSettings';
import { getCaptchaSettings } from '../utils/captchaSettings';
import type { ICaptchaChallengeService } from '../services/CaptchaChallengeService';
import { truncatePreview } from '../utils/textPreview';
import {
  MODERATION_ACTION_REASON_FIELD_ID,
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
const ACCOUNT_QUARANTINE_MODAL_PREFIX = 'verification:qa';
const ACCOUNT_QUARANTINE_REASON_FIELD_ID = 'account_quarantine_reason';
const ACCOUNT_QUARANTINE_CONFIRMATION_FINGERPRINT_LENGTH = 20;
const VERIFICATION_KICK_MODAL_PREFIX = 'verification:kick_modal';
const VERIFICATION_KICK_DEFAULT_REASON = 'Kicked by moderator during verification';
const OBSERVED_KICK_MODAL_PREFIX = 'observed:kick_modal';
const MODERATION_ACTION_CONFIRMATION_PREFIX = 'moderation_action_confirm';
const MODERATION_ACTION_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const CASE_REVIEW_DIGEST_PAGE_SIZE = 25;
const ACCOUNT_QUARANTINE_CONFIRMATION_MAX_LENGTH = 1900;
const CAPTCHA_BYPASS_MODAL_PREFIX = 'captcha:bypass';
const CAPTCHA_BYPASS_REASON_FIELD_ID = 'captcha_bypass_reason';

interface PendingModerationActionConfirmation {
  readonly action: ModeratorUserAction;
  readonly targetUserId: string;
  readonly userId: string;
  readonly guildId: string;
  readonly reason: string | null;
  readonly selectedMessage: { readonly channelId: string; readonly messageId: string } | null;
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
  private roleGateService?: IRoleGateService;
  private detectionEventsRepository?: IDetectionEventsRepository;
  private accountQuarantineService?: IAccountQuarantineService;
  private captchaChallengeService?: ICaptchaChallengeService;
  private readonly pendingReportBanModals = new Map<
    string,
    { readonly detectionEventId: string; readonly expiresAt: number }
  >();
  private readonly pendingCaseModalBindings = new Map<
    string,
    { readonly caseId: string; readonly expiresAt: number }
  >();
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
    @inject(TYPES.BotApplication)
    @optional()
    private readonly application?: BotApplication,
    @inject(TYPES.RoleGateService)
    @optional()
    roleGateService?: IRoleGateService,
    @inject(TYPES.DetectionEventsRepository)
    @optional()
    detectionEventsRepository?: IDetectionEventsRepository,
    @inject(TYPES.AccountQuarantineService)
    @optional()
    accountQuarantineService?: IAccountQuarantineService,
    @inject(TYPES.CaptchaChallengeService)
    @optional()
    captchaChallengeService?: ICaptchaChallengeService,
    @inject(TYPES.ModerationActionRequestRepository)
    @optional()
    private readonly actionRequests?: IModerationActionRequestRepository,
    @inject(TYPES.ReportIntakeRepository)
    @optional()
    private readonly reportIntakes?: IReportIntakeRepository
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
    this.roleGateService = roleGateService;
    this.detectionEventsRepository = detectionEventsRepository;
    this.accountQuarantineService = accountQuarantineService;
    this.captchaChallengeService = captchaChallengeService;
    const reportSubmissionService = new ReportSubmissionService(
      this.configService,
      this.securityActionService
    );
    this.reportInteractionHandler = new ReportInteractionHandler(
      this.client,
      reportSubmissionService,
      this.configService,
      this.threadManager,
      reportIntakeService,
      (interaction, intakeId) => this.showReportBanModal(interaction, intakeId),
      application?.reports
    );
    this.setupVerificationModalHandler = new SetupVerificationModalHandler(
      this.client,
      setupDiagnosticsService,
      application
    );
  }

  public async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    if (
      await handleCaptchaImageInteraction(
        interaction,
        this.application?.captchaImage ?? createBotCaptchaImageActions(null)
      )
    )
      return;
    const customId = interaction.customId;
    if (customId.startsWith('mcp:')) {
      await new McpCommandHandler(this.application?.mcp).handleButtonInteraction(interaction);
      return;
    }

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

      if (this.reportInteractionHandler.isReportIntakeAdminActionCustomId(customId)) {
        await this.reportInteractionHandler.handleReportIntakeAdminAction(interaction, customId);
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
    if (!this.application) {
      await interaction.reply({
        content: 'Live moderation queue support is unavailable in this process.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await this.application.attention.acknowledge(
      createDiscordActionContext({
        guildId,
        userId: interaction.user.id,
        requestId: interaction.id,
      }),
      { itemId }
    );
    if (result.kind === 'denied') {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to acknowledge queue reminders.'
      );
      return;
    }
    await interaction.editReply(
      result.outcome.status === 'acknowledged'
        ? 'Queue reminder acknowledged.'
        : 'That queue reminder was already handled.'
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

    if (normalizedParsed.action === 'captcha_bypass') {
      await this.showCaptchaBypassModal(interaction, guildId, normalizedParsed);
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

    const selectedCaseId =
      parsed.verificationEventId ??
      (await this.resolveCaseControlBinding(interaction, guildId, parsed.userId));
    parsed = { ...parsed, verificationEventId: selectedCaseId };
    const selectedCase = await this.verificationEventRepository.findById(selectedCaseId);
    if (
      !selectedCase ||
      selectedCase.server_id !== guildId ||
      selectedCase.user_id !== parsed.userId
    ) {
      throw new Error('The case menu is no longer bound to a stored case.');
    }
    const activeCase = selectedCase.status === VerificationStatus.PENDING ? selectedCase : null;
    const captchaCase = activeCase;
    const serverConfig = await this.configService.getServerConfig(guildId);
    const accountQuarantineEnabled = getAccountQuarantineSettings(serverConfig.settings).enabled;
    const captchaSettings = getCaptchaSettings(serverConfig.settings);
    const history = await this.verificationEventRepository.findByUserAndServer(
      parsed.userId,
      guildId
    );
    const pendingCases = history.filter((event) => event.status === VerificationStatus.PENDING);
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
        if (hasModerationPermission && activeCase.case_kind !== CaseKind.COMPROMISED_ACCOUNT) {
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
            : [])
        );
        if (activeCase.attention_state !== CaseAttentionState.PARKED) {
          if (activeCase.case_kind !== CaseKind.COMPROMISED_ACCOUNT) {
            actionButtons.push(
              this.adminActionButton(
                parsed,
                'close_no_action',
                'Close No Action',
                ButtonStyle.Secondary
              )
            );
          }
          actionButtons.push(
            this.adminActionButton(parsed, 'repair', 'Repair Active Case', ButtonStyle.Primary)
          );
          if (
            this.captchaChallengeService &&
            captchaSettings.mode !== 'off' &&
            captchaCase?.case_kind !== CaseKind.COMPROMISED_ACCOUNT
          ) {
            const captchaChallenge = captchaCase
              ? await this.captchaChallengeService.findByCaseId(captchaCase.id)
              : null;
            const captchaParsed = captchaCase
              ? { ...parsed, verificationEventId: captchaCase.id }
              : parsed;
            if (!alreadyBanned) {
              if (captchaCase && !captchaChallenge) {
                actionButtons.push(
                  this.adminActionButton(
                    captchaParsed,
                    'captcha',
                    'Challenge User',
                    ButtonStyle.Primary
                  )
                );
              } else if (
                captchaChallenge &&
                (captchaChallenge.status === CaptchaChallengeStatus.FAILED ||
                  captchaChallenge.status === CaptchaChallengeStatus.EXPIRED ||
                  captchaChallenge.status === CaptchaChallengeStatus.BYPASSED ||
                  captchaChallenge.status === CaptchaChallengeStatus.CANCELLED ||
                  (captchaChallenge.status === CaptchaChallengeStatus.PENDING &&
                    Boolean(captchaChallenge.delivery_error_code)))
              ) {
                actionButtons.push(
                  this.adminActionButton(
                    {
                      ...captchaParsed,
                      captchaChallengeId: captchaChallenge.id,
                      captchaGeneration: captchaChallenge.generation,
                    },
                    'captcha_retry',
                    'Retry Security Check',
                    ButtonStyle.Primary
                  )
                );
              }
            }
            if (
              captchaCase &&
              captchaChallenge &&
              (captchaChallenge.status === CaptchaChallengeStatus.PENDING ||
                captchaChallenge.status === CaptchaChallengeStatus.FAILED ||
                captchaChallenge.status === CaptchaChallengeStatus.EXPIRED)
            ) {
              actionButtons.push(
                this.adminActionButton(
                  captchaParsed,
                  'captcha_bypass',
                  'Continue Without Check...',
                  ButtonStyle.Secondary
                )
              );
            }
          }
        }
        if (
          this.accountQuarantineService &&
          accountQuarantineEnabled &&
          activeCase.attention_state === CaseAttentionState.REVIEW_REQUIRED
        ) {
          actionButtons.push(
            this.adminActionButton(
              parsed,
              'quarantine',
              activeCase.case_kind === CaseKind.COMPROMISED_ACCOUNT
                ? 'Retry Account Quarantine'
                : 'Quarantine Compromised Account...',
              ButtonStyle.Danger
            )
          );
        }
        if (!activeCase.thread_id && activeCase.attention_state !== CaseAttentionState.PARKED) {
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
    } else if (hasModerationPermission) {
      actionButtons.push(
        this.adminActionButton(parsed, 'reopen', 'Reopen Verification', ButtonStyle.Primary)
      );
    }

    const buttons = [...actionButtons];
    const webCaseUrl = buildAdminCaseDetailUrl(guildId, selectedCase.id);
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
    const latestCaseLinks = this.formatVerificationCaseLinks(guildId, selectedCase, adminChannelId);
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
    const webQueueUrl = buildAdminModerationInboxUrl(guildId);
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
      verificationEventId: selectedCase.id,
    });
  }

  private async showCaseReviewDigestSelector(
    interaction: ButtonInteraction,
    guildId: string,
    page: number,
    options: { update: boolean }
  ): Promise<void> {
    const pendingCases =
      await this.verificationEventRepository.findReviewablePendingByServer(guildId);
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

    const webQueueUrl = buildAdminModerationInboxUrl(guildId);
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
        buildAdminActionCustomId(
          action,
          parsed.surface,
          parsed.userId,
          parsed.detectionEventId,
          parsed.verificationEventId,
          parsed.confirmationFingerprint,
          parsed.captchaChallengeId,
          parsed.captchaGeneration
        )
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
      case 'quarantine':
        return {
          label: 'Continue',
          message: `Prepare to quarantine ${target} as a compromised account?`,
          style: ButtonStyle.Danger,
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
      case 'captcha':
        return {
          label: 'Send Security Check',
          message: `Send a browser security check to ${target} in the current case thread?`,
          style: ButtonStyle.Primary,
        };
      case 'captcha_retry':
        return {
          label: 'Retry Security Check',
          message: `Issue a new browser security check link to ${target}?`,
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
    const isQuarantinePreview = parsed.surface === 'case' && parsed.action === 'quarantine';
    if (isQuarantinePreview) {
      if (options?.update === false)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      else await interaction.deferUpdate();
    }
    if (parsed.surface === 'case' && !parsed.verificationEventId) {
      parsed = {
        ...parsed,
        verificationEventId: await this.resolveCaseControlBinding(
          interaction,
          interaction.guildId ?? '',
          parsed.userId
        ),
      };
    }
    const confirmAction = `confirm_${parsed.action}`;
    const quarantinePreview =
      parsed.surface === 'case' && parsed.action === 'quarantine'
        ? await this.buildAccountQuarantineConfirmationMessage(
            interaction,
            parsed,
            confirmation.message
          )
        : null;
    const confirmationParsed =
      quarantinePreview?.verificationEventId && quarantinePreview.confirmationFingerprint
        ? {
            ...parsed,
            verificationEventId: quarantinePreview.verificationEventId,
            confirmationFingerprint: quarantinePreview.confirmationFingerprint,
          }
        : parsed;
    const canContinue =
      quarantinePreview === null ||
      (quarantinePreview.verificationEventId !== null &&
        quarantinePreview.confirmationFingerprint !== null);
    const buttons = [
      ...(canContinue
        ? [
            this.adminActionButton(
              confirmationParsed,
              confirmAction,
              confirmation.label,
              confirmation.style
            ),
          ]
        : []),
      this.adminActionButton(parsed, 'cancel', 'Cancel', ButtonStyle.Secondary),
    ];
    const components = [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
    const response = {
      content:
        quarantinePreview?.message ??
        (await this.buildAdminActionConfirmationMessage(interaction, parsed, confirmation.message)),
      allowedMentions: { parse: [] },
      components,
    };

    if (isQuarantinePreview) {
      await interaction.editReply(response);
      return;
    }

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
    if (parsed.surface === 'case' && parsed.action === 'verify') {
      const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
        parsed.userId,
        interaction.guildId ?? ''
      );
      if (activeCase?.case_kind === CaseKind.COMPROMISED_ACCOUNT) {
        baseMessage = `${baseMessage}\n\nThis releases the parked account quarantine, restores eligible snapshotted roles, and closes the user verification thread.`;
      }
    }

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

  private async buildAccountQuarantineConfirmationMessage(
    interaction: ButtonInteraction,
    parsed: ParsedAdminActionCustomId,
    baseMessage: string
  ): Promise<{
    readonly message: string;
    readonly verificationEventId: string | null;
    readonly confirmationFingerprint: string | null;
  }> {
    const member = await interaction.guild?.members.fetch(parsed.userId).catch(() => null);
    const activeCase = interaction.guildId
      ? await this.verificationEventRepository.findActiveByUserAndServer(
          parsed.userId,
          interaction.guildId
        )
      : null;
    if (!interaction.guildId || !member || !activeCase || !this.accountQuarantineService) {
      return {
        message: `${baseMessage}\n\nA live containment preview is unavailable; cancel and retry from the active case.`,
        verificationEventId: null,
        confirmationFingerprint: null,
      };
    }

    const context = createDiscordActionContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      requestId: interaction.id,
    });
    const data = this.application
      ? await this.application.quarantine
          .preview(context, { caseId: activeCase.id, targetUserId: parsed.userId })
          .then(requireQuarantineOutcome)
          .catch(() => null)
      : null;
    const preview = data?.preview;
    if (!data || !preview) {
      return {
        message: `${baseMessage}\n\nDrasil could not produce a live containment preview. Cancel and retry after repairing the active case.`,
        verificationEventId: null,
        confirmationFingerprint: null,
      };
    }

    const retained = preview.rolePreview.skippedRoles.map(
      (role) => `<@&${role.role_id}> (${role.reason})`
    );
    const lines = [
      baseMessage,
      '',
      `Roles to remove: ${preview.rolePreview.plannedRoleIds.length}`,
      `Privileged roles to remove: ${preview.rolePreview.privilegedRoleIds.length}`,
      `Roles Drasil cannot remove: ${retained.length}`,
      `Member/channel bypasses: ${preview.memberAudit.bypasses.length}`,
      `Unremovable privilege blockers: ${preview.memberAudit.unremovablePrivilegeReasons.length}`,
      `Lockdown changes still required: ${preview.lockdown.plannedActions.length}`,
      preview.canContain
        ? 'Containment check: ready. Submitting the next form will park this case.'
        : 'Containment check: incomplete. The action will contain what it can, keep the case in review, and report every blocker.',
      '',
      'The user stays in the server. Their verification thread remains open so they can report recovery. No Discord timeout is applied.',
    ];
    if (retained.length > 0) {
      lines.push('', `Unmanageable roles: ${retained.join(', ')}`);
    }
    return {
      message: truncatePreview(lines.join('\n'), ACCOUNT_QUARANTINE_CONFIRMATION_MAX_LENGTH),
      verificationEventId: activeCase.id,
      confirmationFingerprint: data.fingerprint.slice(
        0,
        ACCOUNT_QUARANTINE_CONFIRMATION_FINGERPRINT_LENGTH
      ),
    };
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

  private async showCaptchaBypassModal(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to continue without a security check.'
      );
      return;
    }
    if (!parsed.verificationEventId || !this.captchaChallengeService) {
      await interaction.reply({
        content: 'This security check action is no longer available.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const challenge = await this.captchaChallengeService.findByCaseId(parsed.verificationEventId);
    if (!challenge) {
      await interaction.reply({
        content: 'This security check action is no longer available.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(
        `${CAPTCHA_BYPASS_MODAL_PREFIX}:${parsed.verificationEventId}:${challenge.id}:${challenge.generation}`
      )
      .setTitle('Continue Without Security Check');
    const reason = new TextInputBuilder()
      .setCustomId(CAPTCHA_BYPASS_REASON_FIELD_ID)
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));
    await interaction.showModal(modal);
  }

  private async handleCaptchaBypassModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const guildId = interaction.guildId;
    const [prefix, action, verificationEventId, challengeId, generationValue] =
      interaction.customId.split(':');
    const generation = Number(generationValue);
    if (
      !guildId ||
      `${prefix}:${action}` !== CAPTCHA_BYPASS_MODAL_PREFIX ||
      !verificationEventId ||
      !challengeId ||
      !Number.isInteger(generation) ||
      generation < 1 ||
      !this.captchaChallengeService
    ) {
      await interaction.reply({
        content: 'This security check action is no longer available.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!(await this.hasAnyPermission(interaction, guildId, this.getModerationPermissions()))) {
      await interaction.reply({
        content: 'You need moderation permissions to continue without a security check.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const verificationEvent =
        await this.verificationEventRepository.findById(verificationEventId);
      if (!verificationEvent || verificationEvent.server_id !== guildId) {
        throw new Error('The bound case changed before the security check could be bypassed.');
      }
      const reason = interaction.fields.getTextInputValue(CAPTCHA_BYPASS_REASON_FIELD_ID).trim();
      await this.executeCaptchaAction(interaction, {
        kind: 'bypass_captcha_challenge',
        caseId: verificationEventId,
        targetUserId: verificationEvent.user_id,
        reason,
        expectedChallengeId: challengeId,
        expectedGeneration: generation,
      });
      await interaction.editReply({ content: 'Security check bypass recorded.' });
    } catch (error) {
      console.error('Failed to bypass CAPTCHA challenge from Discord:', error);
      await interaction.editReply({
        content:
          error instanceof Error
            ? error.message
            : 'The security check bypass could not be recorded.',
      });
    }
  }

  private async executeCaptchaAction(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    command: CaptchaCommand
  ): Promise<CaptchaOutcome> {
    if (!this.application || !interaction.guildId)
      throw new Error('CAPTCHA application is unavailable.');
    const context = createDiscordActionContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      requestId: interaction.id,
    });
    this.application.caseConfirmations.recordVerified(context, command);
    return requireCaptchaOutcome(await this.application.captcha.execute(context, command));
  }

  private async executeConfirmedAdminAction(
    interaction: ButtonInteraction,
    guildId: string,
    parsed: ParsedAdminActionCustomId
  ): Promise<void> {
    const action = parsed.action.slice('confirm_'.length);
    const moderationPermissions = this.getModerationPermissions();

    if (action === 'quarantine') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to quarantine a compromised account.'
        );
        return;
      }
      if (!parsed.verificationEventId || !parsed.confirmationFingerprint) {
        await interaction.reply({
          content: 'The live containment preview expired. Return to the active case and retry.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await this.showAccountQuarantineModal(
        interaction,
        parsed.userId,
        parsed.verificationEventId,
        parsed.confirmationFingerprint
      );
      return;
    }

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

    if (action === 'captcha' || action === 'captcha_retry') {
      if (!(await this.hasAnyPermission(interaction, guildId, moderationPermissions))) {
        await this.replyPermissionDenied(
          interaction,
          'You need moderation permissions to request a security check.'
        );
        return;
      }
      if (
        !this.captchaChallengeService ||
        (action === 'captcha' && !parsed.verificationEventId) ||
        (action === 'captcha_retry' && (!parsed.captchaChallengeId || !parsed.captchaGeneration))
      ) {
        await interaction.reply({
          content: 'This security check action is no longer available.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferUpdate();
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const targetMember = await guild.members.fetch(parsed.userId).catch(() => null);
        if (!targetMember) {
          throw new Error('The target is no longer a member of this server.');
        }
        const displayedChallenge =
          action === 'captcha_retry' && parsed.captchaChallengeId
            ? await this.captchaChallengeService.findById(parsed.captchaChallengeId)
            : null;
        if (
          action === 'captcha_retry' &&
          (!displayedChallenge ||
            displayedChallenge.server_id !== guildId ||
            displayedChallenge.user_id !== parsed.userId ||
            displayedChallenge.generation !== parsed.captchaGeneration)
        ) {
          throw new Error('The security check changed. Refresh the case and try again.');
        }
        const caseId = displayedChallenge?.verification_event_id ?? parsed.verificationEventId;
        if (!caseId) throw new Error('The bound case is unavailable.');
        const command: CaptchaCommand =
          action === 'captcha_retry' && displayedChallenge
            ? {
                kind: 'retry_captcha_challenge',
                caseId,
                targetUserId: parsed.userId,
                expectedChallengeId: displayedChallenge.id,
                expectedGeneration: displayedChallenge.generation,
              }
            : { kind: 'request_captcha_challenge', caseId, targetUserId: parsed.userId };
        const result = await this.executeCaptchaAction(interaction, command);
        await interaction.followUp({
          content:
            'delivered' in result && result.delivered
              ? 'Security check sent in the case thread.'
              : 'Security check created, but its case-thread link could not be delivered. Repair the public URL or case thread, then retry.',
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error('Failed to request CAPTCHA challenge from Discord:', error);
        await interaction.followUp({
          content: error instanceof Error ? error.message : 'The security check could not be sent.',
          flags: MessageFlags.Ephemeral,
        });
      }
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

  private async executeDetectionAction(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    command: DetectionCommand
  ): Promise<DetectionOutcome> {
    if (!this.application || !interaction.guildId)
      throw new Error('Detection application is unavailable.');
    const context = createDiscordActionContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      requestId: interaction.id,
    });
    this.application.caseConfirmations.recordVerified(context, command);
    return requireDetectionOutcome(await this.application.detections.execute(context, command));
  }

  private async bindCaseModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    customId: string
  ): Promise<void> {
    const now = Date.now();
    for (const [key, binding] of this.pendingCaseModalBindings) {
      if (binding.expiresAt <= now) this.pendingCaseModalBindings.delete(key);
    }
    const key = `${guildId}:${interaction.user.id}:${customId}`;
    const caseId = await this.resolveCaseControlBinding(interaction, guildId, userId);
    const pending = this.pendingCaseModalBindings.get(key);
    if (pending && pending.caseId !== caseId) {
      throw new Error(
        'A confirmation for another case is still pending. Let it expire before retrying.'
      );
    }
    if (!pending)
      this.pendingCaseModalBindings.set(key, {
        caseId,
        expiresAt: now + MODERATION_ACTION_CONFIRMATION_TTL_MS,
      });
  }

  private consumeCaseModalBinding(interaction: ModalSubmitInteraction, userId: string): string {
    const key = `${interaction.guildId}:${interaction.user.id}:${interaction.customId}`;
    const binding = this.pendingCaseModalBindings.get(key);
    this.pendingCaseModalBindings.delete(key);
    if (!binding || binding.expiresAt <= Date.now() || !interaction.customId.endsWith(`:${userId}`))
      throw new Error('The case confirmation expired. Return to the case and retry.');
    return binding.caseId;
  }

  private async resolveCaseControlBinding(
    interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
    guildId: string,
    userId: string
  ): Promise<string> {
    const parsed = parseAdminActionCustomId(interaction.customId);
    if (parsed?.verificationEventId) return parsed.verificationEventId;
    const history = await this.verificationEventRepository.findByUserAndServer(userId, guildId);
    const matched = history.find(
      (event) =>
        (interaction.message?.id && event.notification_message_id === interaction.message.id) ||
        (interaction.channelId && event.thread_id === interaction.channelId)
    );
    if (!matched)
      throw new Error(
        'The case control is no longer bound to a stored case. Return to the case and retry.'
      );
    return matched.id;
  }

  private async executeConfirmedCaseAction(
    interaction: ButtonInteraction | ModalSubmitInteraction,
    command: CaseCommand
  ): Promise<CaseOutcome> {
    if (!this.application || !interaction.guildId)
      throw new Error('Case application is unavailable.');
    const context = createDiscordActionContext({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      requestId: interaction.id,
    });
    this.application.caseConfirmations.recordVerified(context, command);
    return requireCaseOutcome(await this.application.cases.execute(context, command));
  }

  private async handleRepairActiveCaseButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'repair_active_case',
        intent: 'moderator_repair',
        mode: 'repair_thread',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });
      if (outcome.kind !== 'repair_active_case') throw new Error('Case outcome mismatch.');
      const result = outcome.result;
      await interaction.followUp({
        content: result.message,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      if (error instanceof CaseActionDeniedError && error.code === 'stale_state') {
        const current = await this.verificationEventRepository
          .findActiveByUserAndServer(userId, guildId)
          .catch(() => null);
        if (current?.attention_state === CaseAttentionState.PARKED) {
          await interaction.followUp({
            content:
              'A parked account quarantine can only be released with Verify User, Kick User, or Ban User.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }
      console.error('Error repairing active case:', error);
      const message = error instanceof Error && error.message ? error.message : 'Unknown error';
      await interaction.followUp({
        content: `An error occurred while repairing the active case: ${message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async showAccountQuarantineModal(
    interaction: ButtonInteraction,
    userId: string,
    verificationEventId: string,
    previewFingerprint: string
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(
        `${ACCOUNT_QUARANTINE_MODAL_PREFIX}:${userId}:${verificationEventId}:${previewFingerprint}`
      )
      .setTitle('Quarantine Compromised Account');
    const reasonInput = new TextInputBuilder()
      .setCustomId(ACCOUNT_QUARANTINE_REASON_FIELD_ID)
      .setLabel('Why is this account being quarantined?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500)
      .setPlaceholder('Required for the moderation audit log.');
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
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
      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'sync_existing_ban',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });
      if (outcome.kind !== 'sync_existing_ban') throw new Error('Case outcome mismatch.');
      const syncedCount = outcome.count;

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
    await this.bindCaseModal(interaction, guildId, userId, modal.data.custom_id ?? '');
    await interaction.showModal(modal);
  }

  private async handleCloseNoActionButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'close_case_no_action',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });
      if (outcome.kind !== 'close_case_no_action') throw new Error('Case outcome mismatch.');
      const closedCount = outcome.count;
      const roleGateResult = outcome.roleGateResult;

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
      if (error instanceof CaseActionDeniedError && error.code === 'stale_state') {
        const current = await this.verificationEventRepository
          .findActiveByUserAndServer(userId, guildId)
          .catch(() => null);
        if (current?.case_kind === CaseKind.COMPROMISED_ACCOUNT) {
          await interaction.followUp({
            content:
              'An account quarantine can only be released with Verify User, Kick User, or Ban User.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }
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
      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'verify_case_user',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });
      if (outcome.kind !== 'verify_case_user' || !outcome.succeeded)
        throw new Error('Verification did not complete.');
      const roleGateResult = outcome.roleGateResult;

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
    await this.bindCaseModal(interaction, guildId, userId, modal.data.custom_id ?? '');
    await interaction.showModal(modal);
  }

  private async handleThreadButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'repair_active_case',
        intent: 'moderator_repair',
        mode: 'repair_thread',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });
      if (outcome.kind !== 'repair_active_case' || !outcome.result.threadId)
        throw new Error('Failed to create verification thread');
      const thread = {
        id: outcome.result.threadId,
        url: `https://discord.com/channels/${guildId}/${outcome.result.threadId}`,
      };

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
      await this.executeConfirmedCaseAction(interaction, {
        kind: 'reopen_case',
        caseId: await this.resolveCaseControlBinding(interaction, guildId, userId),
        targetUserId: userId,
      });

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
    if (
      await handleCaptchaImageInteraction(
        interaction,
        this.application?.captchaImage ?? createBotCaptchaImageActions(null)
      )
    )
      return;
    if (interaction.customId.startsWith(`${CAPTCHA_BYPASS_MODAL_PREFIX}:`)) {
      await this.handleCaptchaBypassModalSubmit(interaction);
      return;
    }
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
        if (interaction.customId.startsWith(`${ACCOUNT_QUARANTINE_MODAL_PREFIX}:`)) {
          await this.handleAccountQuarantineModalSubmit(interaction);
          return;
        }
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
        if (
          interaction.customId.startsWith('observed:ban_modal:') ||
          interaction.customId.startsWith('report_ban:')
        ) {
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

    const reason = providedReason || null;
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
      selectedMessage:
        input.sourceChannelId && input.sourceMessageId
          ? { channelId: input.sourceChannelId, messageId: input.sourceMessageId }
          : null,
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

    // Claim the original confirmation before permission/policy reads can yield to another submit.
    this.pendingModerationActionConfirmations.delete(id);
    if (
      !(await this.ensureModerationActionAllowed(interaction, interaction.guildId, pending.action))
    ) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const command =
        pending.action === 'ban'
          ? ({
              kind: 'ban_user',
              intent: 'native_action',
              targetUserId: pending.targetUserId,
              reason: pending.reason,
              selectedMessage: pending.selectedMessage,
            } as const)
          : ({
              kind: 'kick_user',
              targetUserId: pending.targetUserId,
              reason: pending.reason,
              selectedMessage: pending.selectedMessage,
            } as const);
      const outcome = await this.executeConfirmedCaseAction(interaction, command);
      if (outcome.kind === 'kick_user' && !outcome.succeeded) {
        await interaction.editReply({
          content: `Could not find user <@${pending.targetUserId}> in this server.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await interaction.editReply({
        content: `${pending.action === 'ban' ? 'Banned' : 'Kicked'} <@${pending.targetUserId}> from this server.`,
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

      const outcome = await this.executeConfirmedCaseAction(interaction, {
        kind: 'open_admin_case',
        intent: 'native_case_open',
        targetUserId,
        reason: reason ?? null,
        detectionEventId: null,
        selectedMessage:
          'sourceChannelId' in input
            ? { channelId: input.sourceChannelId, messageId: input.sourceMessageId }
            : null,
      });
      if (outcome.kind !== 'open_admin_case') throw new Error('Case outcome mismatch.');
      const result = outcome.result;
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId).catch(() => null);

      const caseId = this.consumeCaseModalBinding(interaction, userId);
      await this.executeConfirmedCaseAction(interaction, {
        kind: member ? 'ban_case_user' : 'ban_case_user_by_id',
        caseId,
        targetUserId: userId,
        reason: finalNotes || null,
        detectionEventId: null,
      });

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

  private async handleAccountQuarantineModalSubmit(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    if (!interaction.guildId || !this.accountQuarantineService) {
      await interaction.reply({
        content: 'Compromised-account quarantine is unavailable here.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !(await this.hasAnyPermission(
        interaction,
        interaction.guildId,
        this.getModerationPermissions()
      ))
    ) {
      await this.replyPermissionDenied(
        interaction,
        'You need moderation permissions to quarantine a compromised account.'
      );
      return;
    }

    const [userId, previewedCaseId, previewedFingerprint] = interaction.customId
      .slice(`${ACCOUNT_QUARANTINE_MODAL_PREFIX}:`.length)
      .split(':');
    const reason = interaction.fields.getTextInputValue(ACCOUNT_QUARANTINE_REASON_FIELD_ID).trim();
    if (!userId || !previewedCaseId || !previewedFingerprint || !reason) {
      await interaction.reply({
        content: 'A target user and quarantine reason are required.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!this.application) throw new Error('Quarantine application is unavailable.');
      const context = createDiscordActionContext({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        requestId: interaction.id,
      });
      const result = requireQuarantineOutcome(
        await this.application.quarantine.execute(context, {
          caseId: previewedCaseId,
          targetUserId: userId,
          reason,
          previewReference: { kind: 'discord_confirmation', fingerprint: previewedFingerprint },
        })
      );
      if (result.status === 'parked') {
        await interaction.editReply({
          content: `Quarantined <@${userId}> and parked the case. The user remains in the server and can reply in their open verification thread when they recover the account.`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await interaction.editReply({
        content: [
          `Containment for <@${userId}> is incomplete, so the case remains in review.`,
          `Failed role removals: ${result.failedRoleRemovals}.`,
          `Retained/unmanageable roles: ${result.retainedRoles}.`,
          `Member/channel bypasses: ${result.memberBypasses}.`,
          `Lockdown changes still required: ${result.lockdownChangesRequired}.`,
        ].join('\n'),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error('Error quarantining compromised account:', error);
      await interaction.editReply({
        content:
          error instanceof Error
            ? `Could not quarantine the compromised account: ${error.message}`
            : 'Could not quarantine the compromised account.',
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await this.client.guilds.fetch(interaction.guildId);
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        throw new Error('Could not find member in guild');
      }

      await this.executeConfirmedCaseAction(interaction, {
        kind: 'kick_case_user',
        caseId: this.consumeCaseModalBinding(interaction, userId),
        targetUserId: userId,
        reason: providedReason || null,
        detectionEventId: null,
      });

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
    const outcome = await this.executeConfirmedCaseAction(interaction, {
      kind: 'open_case_from_observed_detection',
      targetUserId: userId,
      detectionEventId,
      reportId: null,
    });
    if (outcome.kind !== 'open_case_from_observed_detection')
      throw new Error('Case outcome mismatch.');
    const opened = outcome.succeeded;
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

    const reason = providedReason || null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const outcome = await this.executeDetectionAction(interaction, {
        kind: 'kick_observed_detection',
        targetUserId: parsed.userId,
        detectionEventId: parsed.detectionEventId,
        reason,
      });
      if (outcome.kind !== 'kick_observed_detection')
        throw new Error('Detection outcome mismatch.');
      const kicked = outcome.succeeded;
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

  private async showReportBanModal(
    interaction: ButtonInteraction,
    reportId: string
  ): Promise<void> {
    const report = await this.reportIntakes?.findById(reportId);
    const detection = await this.detectionEventsRepository?.findByReportIntakeId(reportId);
    if (
      !interaction.guildId ||
      !report ||
      report.server_id !== interaction.guildId ||
      report.status !== 'submitted' ||
      !report.confirmed_target_user_id ||
      this.metadataToRecord(report.metadata).report_ban_operation_id ||
      !detection ||
      detection.server_id !== interaction.guildId ||
      detection.user_id !== report.confirmed_target_user_id ||
      detection.metadata?.reportIntakeId !== reportId ||
      detection.metadata.observed_action ||
      !(await isReportIntakeActionChannel(
        this.configService,
        interaction.guildId,
        interaction.channelId,
        report.thread_id
      ))
    ) {
      await interaction.reply({
        content: 'This report is no longer available for a ban. Refresh the report.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !(await this.hasAnyPermission(interaction, interaction.guildId, [
        PermissionFlagsBits.BanMembers,
      ])) ||
      !(await this.canUseModeratorBanAction(interaction.guildId))
    ) {
      await interaction.reply({
        content: 'You need Ban Members permission and enabled Drasil ban actions.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await this.showObservedBanModal(
      interaction,
      interaction.guildId,
      report.confirmed_target_user_id,
      detection.id,
      report.id
    );
  }

  private async showObservedBanModal(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string,
    detectionEventId: string,
    reportId?: string
  ): Promise<void> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    const identity = reportId ? await this.client.users.fetch(userId).catch(() => null) : null;
    const modal = new ModalBuilder()
      .setCustomId(
        reportId
          ? `report_ban:${reportId}:${userId}`
          : `observed:ban_modal:${userId}:${detectionEventId}`
      )
      .setTitle(
        reportId ? `Ban ${identity?.username ?? userId}`.slice(0, 45) : 'Confirm Observed Ban'
      );
    const reasonInput = new TextInputBuilder()
      .setCustomId(OBSERVED_ACTION_MODAL_REASON_FIELD_ID)
      .setLabel(
        reportId
          ? `Reason for ${userId}${settings.moderatorBanActionRequiresReason ? '' : ' (optional)'}`
          : settings.moderatorBanActionRequiresReason
            ? 'Ban reason'
            : 'Ban reason (optional)'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(settings.moderatorBanActionRequiresReason)
      .setMaxLength(500)
      .setPlaceholder(
        reportId
          ? `Target: ${identity?.username ?? userId} (${userId})`.slice(0, 100)
          : OBSERVED_BAN_DEFAULT_REASON
      );
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    if (reportId) {
      for (const [key, value] of this.pendingReportBanModals)
        if (value.expiresAt <= Date.now()) this.pendingReportBanModals.delete(key);
      const key = `${guildId}:${interaction.user.id}:report_ban:${reportId}:${userId}`;
      const pending = this.pendingReportBanModals.get(key);
      if (pending && pending.detectionEventId !== detectionEventId)
        throw new Error(
          'A confirmation for another detection is still pending. Let it expire before retrying.'
        );
      this.pendingReportBanModals.set(key, {
        detectionEventId,
        expiresAt: Date.now() + MODERATION_ACTION_CONFIRMATION_TTL_MS,
      });
    }
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

    const reportParts = interaction.customId.startsWith('report_ban:')
      ? interaction.customId.split(':')
      : null;
    const pendingKey = `${interaction.guildId}:${interaction.user.id}:${interaction.customId}`;
    const pending = this.pendingReportBanModals.get(pendingKey);
    this.pendingReportBanModals.delete(pendingKey);
    if (reportParts && (!pending || pending.expiresAt <= Date.now())) {
      await interaction.reply({
        content: 'The report ban confirmation expired. Refresh the report and retry.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const reportDetection = reportParts
      ? await this.detectionEventsRepository?.findByReportIntakeId(reportParts[1])
      : null;
    if (reportParts && reportDetection?.id !== pending?.detectionEventId) {
      await interaction.reply({
        content: 'The report detection changed. Refresh the report and retry.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const parsed =
      reportParts && reportDetection
        ? { action: 'ban_modal', userId: reportParts[2], detectionEventId: reportDetection.id }
        : this.parseObservedActionCustomId(interaction.customId);
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

    const reason = providedReason || null;
    try {
      if (!this.actionRequests || !this.detectionEventsRepository)
        throw new Error('Moderation request queue is unavailable.');
      const detection = await this.detectionEventsRepository.findById(parsed.detectionEventId);
      if (
        !detection ||
        detection.server_id !== interaction.guildId ||
        detection.user_id !== parsed.userId
      )
        throw new Error('Observed target changed.');
      const reportId =
        typeof detection.metadata?.reportIntakeId === 'string'
          ? detection.metadata.reportIntakeId
          : undefined;
      if (reportParts && reportId !== reportParts[1]) throw new Error('Report detection changed.');
      if (reportId) {
        const report = await this.reportIntakes?.findById(reportId);
        if (
          !report ||
          report.server_id !== interaction.guildId ||
          report.status !== 'submitted' ||
          report.confirmed_target_user_id !== parsed.userId ||
          (report.metadata as Record<string, unknown> | null)?.report_ban_operation_id ||
          (reportParts &&
            !(await isReportIntakeActionChannel(
              this.configService,
              interaction.guildId,
              interaction.channelId,
              report.thread_id
            )))
        )
          throw new Error('Report is no longer available for this ban.');
      }
      const command = {
        kind: 'ban_observed_detection' as const,
        targetUserId: parsed.userId,
        detectionEventId: parsed.detectionEventId,
        reason,
        subject: reportId ? { kind: 'report' as const, reportId } : { kind: 'observed' as const },
      };
      const encoded = encodeQueuedAction(
        createDiscordActionContext({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          requestId: interaction.id,
        }),
        command
      );
      const request = await this.actionRequests.enqueue({
        ...encoded,
        actionType: ModerationActionRequestType.BAN_OBSERVED_DETECTION,
      });
      await interaction.reply({
        content: `Ban queued for <@${parsed.userId}>. Operation: ${request.id}. If the outcome remains uncertain, use /review-report-ban with this operation ID.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error handling observed ban modal submission:', error);
      const response = {
        content: 'Could not queue this ban. Refresh the report before trying again.',
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
    const outcome = await this.executeDetectionAction(interaction, {
      kind:
        actionType === AdminActionType.FALSE_POSITIVE
          ? 'mark_observed_detection_false_positive'
          : 'dismiss_observed_detection',
      targetUserId: userId,
      detectionEventId,
    });
    if (
      outcome.kind !== 'dismiss_observed_detection' &&
      outcome.kind !== 'mark_observed_detection_false_positive'
    )
      throw new Error('Detection outcome mismatch.');
    const dismissed = outcome.succeeded;
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
    const outcome = await this.executeDetectionAction(interaction, {
      kind: 'undo_observed_detection_action',
      targetUserId: userId,
      detectionEventId,
    });
    if (outcome.kind !== 'undo_observed_detection_action')
      throw new Error('Detection outcome mismatch.');
    const undoneAction = outcome.undoneAction;
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
