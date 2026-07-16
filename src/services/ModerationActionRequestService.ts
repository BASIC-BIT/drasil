import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Guild,
  GuildMember,
  Message,
  PermissionFlagsBits,
  Role,
  TextChannel,
  ThreadChannel,
  User,
} from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { ReportInstructionsManager } from '../controllers/ReportInstructionsManager';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IModerationActionRequestRepository } from '../repositories/ModerationActionRequestRepository';
import { IMessageDeletionJobRepository } from '../repositories/MessageDeletionJobRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  AdminActionType,
  MessageDeletionBanStatus,
  MessageDeletionCaseFinalizationStatus,
  MessageDeletionJobMode,
  MessageDeletionJobWithItems,
  ModerationActionRequest,
  ModerationActionRequestType,
} from '../repositories/types';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { buildReportIntakeAdminActionsCustomId } from '../utils/reportIntakeAdminActions';
import { IModerationQueueService } from './ModerationQueueService';
import { INotificationManager } from './NotificationManager';
import { NotificationPresentationBuilder } from './NotificationPresentationBuilder';
import { IProductAnalyticsService } from './ProductAnalyticsService';
import { ReportSubmissionService } from './ReportSubmissionService';
import { IReportIntakeService } from './ReportIntakeService';
import { ISecurityActionService } from './SecurityActionService';
import { ISetupDiagnosticsService, SetupDiagnosticReport } from './SetupDiagnosticsService';
import { SetupWorkflowService } from './SetupWorkflowService';
import { IThreadManager } from './ThreadManager';
import { ICombinedBanLifecycleService, IUserModerationService } from './UserModerationService';
import { MessageCleanupService } from './MessageCleanupService';
import { ICaseThreadClosureSweepService } from './CaseThreadClosureSweepService';
import { CaseRoleLockdownReport, ICaseRoleLockdownService } from './CaseRoleLockdownService';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_REQUESTS_PER_TICK = 5;
const REQUEST_HEARTBEAT_INTERVAL_MS = 60_000;
const OBSERVED_BAN_DEFAULT_REASON = 'Banned from observed suspicious notification';
const OBSERVED_KICK_DEFAULT_REASON = 'Kicked from observed suspicious notification';

export interface IModerationActionRequestService {
  start(): void;
  stop(): void;
  processPendingRequests(limit?: number): Promise<number>;
}

@injectable()
export class ModerationActionRequestService implements IModerationActionRequestService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processingPromise: Promise<number> | null = null;
  private readonly presentationBuilder = new NotificationPresentationBuilder();
  private readonly requestProcessors: Partial<
    Record<ModerationActionRequestType, (request: ModerationActionRequest) => Promise<void>>
  > = {
    [ModerationActionRequestType.OPEN_CASE_FROM_OBSERVED_DETECTION]: (request) =>
      this.openObservedDetectionCase(request),
    [ModerationActionRequestType.OPEN_ADMIN_CASE]: (request) => this.openAdminCase(request),
    [ModerationActionRequestType.MANUAL_FLAG_USER]: (request) => this.manualFlagUser(request),
    [ModerationActionRequestType.SUBMIT_USER_REPORT]: (request) => this.submitUserReport(request),
    [ModerationActionRequestType.START_REPORT_INTAKE]: (request) => this.startReportIntake(request),
    [ModerationActionRequestType.CLOSE_REPORT_INTAKE]: (request) => this.closeReportIntake(request),
    [ModerationActionRequestType.DISMISS_OBSERVED_DETECTION]: (request) =>
      this.dismissObservedDetection(request, AdminActionType.DISMISS),
    [ModerationActionRequestType.MARK_OBSERVED_DETECTION_FALSE_POSITIVE]: (request) =>
      this.dismissObservedDetection(request, AdminActionType.FALSE_POSITIVE),
    [ModerationActionRequestType.UNDO_OBSERVED_DETECTION_ACTION]: (request) =>
      this.undoObservedDetectionAction(request),
    [ModerationActionRequestType.KICK_OBSERVED_DETECTION]: (request) =>
      this.kickObservedDetection(request),
    [ModerationActionRequestType.BAN_OBSERVED_DETECTION]: (request) =>
      this.banObservedDetection(request),
    [ModerationActionRequestType.IGNORE_DETECTION_ACCOUNTING]: (request) =>
      this.ignoreDetectionAccounting(request),
    [ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING]: (request) =>
      this.restoreDetectionAccounting(request),
    [ModerationActionRequestType.VERIFY_CASE_USER]: (request) => this.verifyCaseUser(request),
    [ModerationActionRequestType.CLOSE_CASE_NO_ACTION]: (request) =>
      this.closeCaseNoAction(request),
    [ModerationActionRequestType.KICK_CASE_USER]: (request) => this.kickCaseUser(request),
    [ModerationActionRequestType.BAN_CASE_USER]: (request) => this.banCaseUser(request),
    [ModerationActionRequestType.PREVIEW_CASE_MESSAGE_DELETION]: (request) =>
      this.previewCaseMessageDeletion(request),
    [ModerationActionRequestType.EXECUTE_CASE_MESSAGE_DELETION]: (request) =>
      this.executeCaseMessageDeletion(request),
    [ModerationActionRequestType.BAN_CASE_USER_WITH_MESSAGE_CLEANUP]: (request) =>
      this.banCaseUserWithMessageCleanup(request),
    [ModerationActionRequestType.BAN_CASE_USER_BY_ID]: (request) => this.banCaseUserById(request),
    [ModerationActionRequestType.REPAIR_ACTIVE_CASE]: (request) => this.repairActiveCase(request),
    [ModerationActionRequestType.REOPEN_CASE]: (request) => this.reopenCase(request),
    [ModerationActionRequestType.REFRESH_CASE_NOTIFICATION]: (request) =>
      this.refreshCaseNotification(request),
    [ModerationActionRequestType.SYNC_MODERATION_QUEUE]: (request) =>
      this.syncModerationQueue(request),
    [ModerationActionRequestType.CLEAR_MODERATION_QUEUE]: (request) =>
      this.clearModerationQueue(request),
    [ModerationActionRequestType.CLOSE_RESOLVED_CASE_THREADS]: (request) =>
      this.closeResolvedCaseThreads(request),
    [ModerationActionRequestType.AUDIT_CASE_ROLE_LOCKDOWN]: (request) =>
      this.auditCaseRoleLockdown(request),
    [ModerationActionRequestType.APPLY_CASE_ROLE_LOCKDOWN]: (request) =>
      this.applyCaseRoleLockdown(request),
    [ModerationActionRequestType.INTAKE_ROLE_MEMBERS]: (request) => this.intakeRoleMembers(request),
    [ModerationActionRequestType.SYNC_EXISTING_BAN]: (request) => this.syncExistingBan(request),
    [ModerationActionRequestType.COMPLETE_SETUP_VERIFICATION]: (request) =>
      this.completeSetupVerification(request),
    [ModerationActionRequestType.UPSERT_REPORT_INSTRUCTIONS]: (request) =>
      this.upsertReportInstructions(request),
  };

  public constructor(
    @inject(TYPES.ModerationActionRequestRepository)
    private readonly repository: IModerationActionRequestRepository,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.ThreadManager)
    private readonly threadManager: IThreadManager,
    @inject(TYPES.ReportIntakeService)
    private readonly reportIntakeService: IReportIntakeService,
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.SecurityActionService)
    private readonly securityActionService: ISecurityActionService,
    @inject(TYPES.UserModerationService)
    private readonly userModerationService: IUserModerationService & ICombinedBanLifecycleService,
    @inject(TYPES.ModerationQueueService)
    private readonly moderationQueueService: IModerationQueueService,
    @inject(TYPES.CaseThreadClosureSweepService)
    private readonly caseThreadClosureSweepService: ICaseThreadClosureSweepService,
    @inject(TYPES.CaseRoleLockdownService)
    private readonly caseRoleLockdownService: ICaseRoleLockdownService,
    @inject(TYPES.NotificationManager)
    private readonly notificationManager: INotificationManager,
    @inject(TYPES.ProductAnalyticsService)
    private readonly productAnalyticsService: IProductAnalyticsService,
    @inject(TYPES.SetupDiagnosticsService)
    private readonly setupDiagnosticsService: ISetupDiagnosticsService,
    @inject(TYPES.MessageDeletionJobRepository)
    private readonly messageDeletionJobs: IMessageDeletionJobRepository,
    @inject(TYPES.MessageCleanupService)
    private readonly messageCleanupService: MessageCleanupService
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.processPendingRequests().catch((error) => {
      console.warn('[ModerationActionRequest] Initial processing failed:', error);
    });
    this.timer = setInterval(() => {
      void this.processPendingRequests().catch((error) => {
        console.warn('[ModerationActionRequest] Background processing failed:', error);
      });
    }, this.resolvePollIntervalMs());
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async processPendingRequests(limit = DEFAULT_MAX_REQUESTS_PER_TICK): Promise<number> {
    if (this.processingPromise) {
      return this.processingPromise;
    }

    const processing = this.drainPendingRequests(limit);
    this.processingPromise = processing;
    try {
      return await processing;
    } finally {
      if (this.processingPromise === processing) {
        this.processingPromise = null;
      }
    }
  }

  private async drainPendingRequests(limit: number): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const request = await this.repository.claimNext();
      if (!request) {
        return processed;
      }

      await this.processClaimedRequest(request);
      processed += 1;
    }

    return processed;
  }

  private async processClaimedRequest(request: ModerationActionRequest): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.repository.heartbeat(request.id).catch((error) => {
        console.warn(`Failed to heartbeat moderation action request ${request.id}:`, error);
      });
    }, REQUEST_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      const processor = this.requestProcessors[request.action_type];
      if (!processor) {
        await this.repository.fail(
          request.id,
          `Unsupported action request: ${request.action_type}`
        );
        return;
      }

      await processor(request);
    } catch (error) {
      await this.repository.fail(request.id, this.errorMessage(error));
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async openObservedDetectionCase(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.detection_event_id) {
      throw new Error('Open-case request is missing target user or detection event.');
    }

    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    const opened = await this.securityActionService.openObservedDetectionCase(
      member,
      request.detection_event_id,
      moderator
    );

    await this.repository.complete(request.id, {
      opened,
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      target_user_id: request.target_user_id,
    });
  }

  private async openAdminCase(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id) {
      throw new Error('Open-admin-case request is missing target user.');
    }

    const reason = await this.resolveOpenAdminCaseReason(request);
    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    const sourceMetadata = this.readOpenAdminCaseSourceMetadata(request);
    const sourceMessage = sourceMetadata
      ? await this.fetchOpenCaseSourceMessage(
          sourceMetadata.source_channel_id,
          sourceMetadata.source_message_id
        )
      : undefined;
    const result = await this.securityActionService.openAdminCase(member, moderator, {
      action: 'open_case',
      metadata: {
        requested_surface: request.actor_surface,
        ...sourceMetadata,
        web_action: 'open_admin_case',
      },
      reason,
      ...(sourceMessage ? { sourceMessage } : {}),
    });

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      case_role_active: result.caseRoleActive,
      case_role_attempted: result.caseRoleAttempted,
      detection_event_id: request.detection_event_id,
      opened: result.opened,
      source_channel_id: sourceMetadata?.source_channel_id ?? null,
      source_message_fetched: Boolean(sourceMessage),
      source_message_id: sourceMetadata?.source_message_id ?? null,
      target_user_id: request.target_user_id,
    });
  }

  private async manualFlagUser(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id) {
      throw new Error('Manual-flag request is missing target user.');
    }

    const reason = this.readMetadataString(request.metadata, 'reason')?.trim() || undefined;
    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    const flagged = await this.securityActionService.handleManualFlag(member, moderator, reason);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      flagged,
      target_user_id: request.target_user_id,
    });
  }

  private async submitUserReport(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id) {
      throw new Error('User-report request is missing target user.');
    }

    const guild = await this.fetchGuild(request.server_id);
    const reporterMember = await guild.members.fetch(request.actor_id).catch(() => null);
    if (!reporterMember) {
      throw new Error('Reporter is not a member of the request guild.');
    }

    const reporter = await this.fetchUser(request.actor_id);
    const targetLabel =
      this.readMetadataString(request.metadata, 'target_label') ?? request.target_user_id;
    const reason = this.readMetadataString(request.metadata, 'reason')?.trim() || undefined;
    const result = await new ReportSubmissionService(
      this.configService,
      this.securityActionService
    ).submitUserReport({
      guild,
      reason,
      reporter,
      targetLabel,
      targetUserId: request.target_user_id,
    });

    if (result.status !== 'submitted') {
      throw new Error(this.describeUserReportFailure(result));
    }

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      reporter_id: request.actor_id,
      server_id: request.server_id,
      submitted: true,
      target_user_id: result.targetUserId,
    });
  }

  private async startReportIntake(request: ModerationActionRequest): Promise<void> {
    const channelId = this.readMetadataString(request.metadata, 'channel_id');
    if (!channelId) {
      throw new Error('Report-intake request is missing target channel.');
    }

    const guild = await this.fetchGuild(request.server_id);
    const reporter = await guild.members.fetch(request.actor_id).catch(() => null);
    if (!reporter) {
      throw new Error('Reporter is not a member of the request guild.');
    }

    const existingIntake = await this.reportIntakeService.findOpenIntakeForReporter({
      reporterId: reporter.id,
      serverId: request.server_id,
    });
    if (existingIntake) {
      await this.repository.complete(request.id, {
        action_type: request.action_type,
        existing_open_intake: true,
        intake_id: existingIntake.id,
        opened: false,
        server_id: request.server_id,
        thread_id: existingIntake.thread_id,
      });
      return;
    }

    const targetChannel = await this.fetchRequestTextChannel(
      request.server_id,
      channelId,
      'Report intake channel'
    );
    let thread: ThreadChannel | null = null;
    let intakeId: string | null = null;
    try {
      thread = await this.threadManager.createReportIntakeThread(targetChannel, reporter);
      if (!thread) {
        throw new Error('Could not open a private report thread.');
      }

      const intake = await this.reportIntakeService.openIntakeFromThread({
        channelId: targetChannel.id,
        reporter,
        serverId: request.server_id,
        threadId: thread.id,
      });
      intakeId = intake.id;

      const activated = await this.threadManager.activateReportIntakeThread(
        thread,
        reporter,
        intake.id
      );
      if (!activated) {
        await this.reportIntakeService.markOpenFailed({
          intakeId: intake.id,
          reason: 'thread_activation_failed',
        });
        await this.deleteFailedReportIntakeThread(thread);
        throw new Error('Could not prepare the private report thread.');
      }

      await this.notifyReportIntakeStarted(request.server_id, reporter, thread, intake.id);

      await this.repository.complete(request.id, {
        action_type: request.action_type,
        channel_id: targetChannel.id,
        intake_id: intake.id,
        opened: true,
        reporter_id: reporter.id,
        server_id: request.server_id,
        thread_id: thread.id,
        thread_url: thread.url,
      });
    } catch (error) {
      if (thread && !intakeId) {
        await this.deleteFailedReportIntakeThread(thread);
      }
      throw error;
    }
  }

  private async closeReportIntake(request: ModerationActionRequest): Promise<void> {
    if (!request.report_intake_id) {
      throw new Error('Close-report-intake request is missing report intake.');
    }

    const intake = await this.reportIntakeService.findIntakeById(request.report_intake_id);
    if (!intake || intake.server_id !== request.server_id) {
      throw new Error('Report intake is no longer available.');
    }
    if (!intake.thread_id) {
      throw new Error('Report intake does not have a Discord thread to close.');
    }

    const thread = await this.fetchReportIntakeThread(intake.thread_id, request.server_id);
    if (!thread) {
      throw new Error('Report intake thread could not be loaded.');
    }

    const result = await this.reportIntakeService.closeIntakeForThread({
      closedById: request.actor_id,
      threadId: intake.thread_id,
    });
    if (!result.closed) {
      throw new Error(result.message);
    }

    await thread
      .send({
        allowedMentions: { parse: [] },
        content: result.message,
      })
      .catch((error) => {
        console.warn(`Failed to post report intake closeout in thread ${thread.id}:`, error);
      });

    if (result.shouldArchiveThread) {
      await this.archiveReportIntakeThread(thread, 'Report intake closed');
    }

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      closed: true,
      message: result.message,
      report_intake_id: request.report_intake_id,
      server_id: request.server_id,
      thread_archived: result.shouldArchiveThread === true,
      thread_id: intake.thread_id,
    });
  }

  private async dismissObservedDetection(
    request: ModerationActionRequest,
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE
  ): Promise<void> {
    if (!request.target_user_id || !request.detection_event_id) {
      throw new Error('Observed dismissal request is missing target user or detection event.');
    }

    const moderator = await this.fetchModerator(request.actor_id);
    const dismissed = await this.securityActionService.dismissObservedDetection(
      request.server_id,
      request.target_user_id,
      request.detection_event_id,
      moderator,
      actionType
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      dismissed,
      target_user_id: request.target_user_id,
    });
  }

  private async undoObservedDetectionAction(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.detection_event_id) {
      throw new Error('Observed undo request is missing target user or detection event.');
    }

    const moderator = await this.fetchModerator(request.actor_id);
    const undoneAction = await this.securityActionService.undoObservedDetectionAction(
      request.server_id,
      request.target_user_id,
      request.detection_event_id,
      moderator
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      target_user_id: request.target_user_id,
      undone_action: undoneAction,
    });
  }

  private async ignoreDetectionAccounting(request: ModerationActionRequest): Promise<void> {
    if (!request.detection_event_id) {
      throw new Error('Detection accounting ignore request is missing detection event.');
    }

    const moderator = await this.fetchModerator(request.actor_id);
    const reason = this.readMetadataString(request.metadata, 'reason')?.trim();
    const updatedDetection = await this.securityActionService.excludeDetectionFromAccounting(
      request.server_id,
      request.detection_event_id,
      moderator,
      reason || undefined
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      ignored: Boolean(updatedDetection),
      target_user_id: request.target_user_id,
    });
  }

  private async restoreDetectionAccounting(request: ModerationActionRequest): Promise<void> {
    if (!request.detection_event_id) {
      throw new Error('Detection accounting restore request is missing detection event.');
    }

    const moderator = await this.fetchModerator(request.actor_id);
    const reason = this.readMetadataString(request.metadata, 'reason')?.trim();
    const updatedDetection = await this.securityActionService.restoreDetectionAccounting(
      request.server_id,
      request.detection_event_id,
      moderator,
      reason || undefined
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      restored: Boolean(updatedDetection),
      target_user_id: request.target_user_id,
    });
  }

  private async kickObservedDetection(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.detection_event_id) {
      throw new Error('Observed kick request is missing target user or detection event.');
    }

    const reason = await this.resolveObservedDestructiveActionReason(request, 'kick');
    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    await this.assertBotPermission(member.guild, PermissionFlagsBits.KickMembers, 'Kick Members');
    const kicked = await this.securityActionService.kickObservedDetection(
      member,
      request.detection_event_id,
      moderator,
      reason
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      detection_event_id: request.detection_event_id,
      kicked,
      target_user_id: request.target_user_id,
    });
  }

  private async banObservedDetection(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.detection_event_id) {
      throw new Error('Observed ban request is missing target user or detection event.');
    }

    const reason = await this.resolveObservedDestructiveActionReason(request, 'ban');
    const [guild, moderator] = await Promise.all([
      this.fetchGuild(request.server_id),
      this.fetchModerator(request.actor_id),
    ]);
    await this.assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Ban Members');
    const member = await guild.members.fetch(request.target_user_id).catch(() => null);
    const banned = member
      ? await this.securityActionService.banObservedDetection(
          member,
          request.detection_event_id,
          moderator,
          reason
        )
      : await this.securityActionService.banObservedDetectionById(
          guild,
          request.target_user_id,
          request.detection_event_id,
          moderator,
          reason
        );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      ban_by_id: !member,
      banned,
      detection_event_id: request.detection_event_id,
      target_user_id: request.target_user_id,
    });
  }

  private async syncExistingBan(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Sync-existing-ban request is missing target user or case id.');
    }

    const [guild, moderator] = await Promise.all([
      this.fetchGuild(request.server_id),
      this.fetchModerator(request.actor_id),
    ]);
    const syncedCount = await this.userModerationService.syncAlreadyBannedUser(
      guild,
      request.target_user_id,
      moderator
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      synced_count: syncedCount,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async repairActiveCase(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Repair-case request is missing target user or case id.');
    }

    const member = await this.fetchGuildMember(request.server_id, request.target_user_id);
    const result = await this.securityActionService.repairActiveCase(member);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      message: result.message,
      repaired: result.repaired,
      target_user_id: request.target_user_id,
      thread_created: result.threadCreated,
      verification_event_id: request.verification_event_id,
    });
  }

  private async reopenCase(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Reopen-case request is missing target user or case id.');
    }

    const [verificationEvent, moderator] = await Promise.all([
      this.verificationEventRepository.findById(request.verification_event_id),
      this.fetchModerator(request.actor_id),
    ]);
    if (!verificationEvent) {
      throw new Error(`Verification event ${request.verification_event_id} not found.`);
    }
    if (
      verificationEvent.server_id !== request.server_id ||
      verificationEvent.user_id !== request.target_user_id
    ) {
      throw new Error('Reopen-case request target does not match the verification event.');
    }

    const reopened = await this.securityActionService.reopenVerification(
      verificationEvent,
      moderator
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      reopened,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async refreshCaseNotification(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Refresh-notification request is missing target user or case id.');
    }

    const targetUser = await this.fetchUser(request.target_user_id);
    const result = await this.securityActionService.refreshCaseNotification(
      request.server_id,
      targetUser,
      request.verification_event_id
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      message: result.message,
      notification_channel_id: result.notificationChannelId ?? null,
      notification_message_id: result.notificationMessageId ?? null,
      refreshed: result.refreshed,
      status: result.status ?? null,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async syncModerationQueue(request: ModerationActionRequest): Promise<void> {
    await this.moderationQueueService.syncServerQueue(request.server_id);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      server_id: request.server_id,
      synced: true,
    });
  }

  private async clearModerationQueue(request: ModerationActionRequest): Promise<void> {
    const removedCount = await this.moderationQueueService.clearServerQueue(request.server_id);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      removed_count: removedCount,
      server_id: request.server_id,
    });
  }

  private async closeResolvedCaseThreads(request: ModerationActionRequest): Promise<void> {
    const report = await this.caseThreadClosureSweepService.sweepResolvedCaseThreads({
      days: this.readMetadataInteger(request.metadata, 'days'),
      execute: this.readMetadataBoolean(request.metadata, 'execute') === true,
      limit: this.readMetadataInteger(request.metadata, 'limit'),
      serverId: request.server_id,
    });

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      already_closed_threads: report.alreadyClosedThreads,
      checked_cases: report.checkedCases,
      checked_threads: report.checkedThreads,
      closed_threads: report.closedThreads,
      days: report.days,
      execute: report.execute,
      failed_threads: report.failedThreads,
      limit: report.limit,
      missing_threads: report.missingThreads,
      server_id: request.server_id,
      would_close_threads: report.wouldCloseThreads,
    });
  }

  private async auditCaseRoleLockdown(request: ModerationActionRequest): Promise<void> {
    const guild = await this.fetchGuild(request.server_id);
    const report = await this.caseRoleLockdownService.auditGuild(guild);
    await this.repository.complete(request.id, this.toCaseRoleLockdownResult(request, report));
  }

  private async applyCaseRoleLockdown(request: ModerationActionRequest): Promise<void> {
    const guild = await this.fetchGuild(request.server_id);
    const report = await this.caseRoleLockdownService.applyGuild(guild, request.actor_id, {
      unsyncAllowedChannels:
        this.readMetadataBoolean(request.metadata, 'unsync_allowed_channels') === true,
    });
    await this.repository.complete(request.id, this.toCaseRoleLockdownResult(request, report));
  }

  private toCaseRoleLockdownResult(
    request: ModerationActionRequest,
    report: CaseRoleLockdownReport
  ): Prisma.JsonObject {
    return {
      action_type: request.action_type,
      applied_writes: report.appliedActions.length,
      enabled: report.enabled,
      error_count: report.errorCount,
      failed_writes: report.failedActions.length,
      issues: report.issues.slice(0, 8).map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
      planned_writes: report.plannedActions.length,
      server_id: request.server_id,
      synced_allowed_channel_blockers: report.syncedAllowedChannels.length,
      unsynced_allowed_channels: report.unsyncedAllowedChannels.length,
      warning_count: report.warningCount,
    };
  }

  private async intakeRoleMembers(request: ModerationActionRequest): Promise<void> {
    const roleId = this.readMetadataString(request.metadata, 'role_id');
    if (!roleId) {
      throw new Error('Role-intake request is missing role id.');
    }

    const execute = this.readMetadataBoolean(request.metadata, 'execute') === true;
    const reason = this.readMetadataString(request.metadata, 'reason')?.trim() || undefined;
    if (execute) {
      const config = await this.configService.getServerConfig(request.server_id);
      const settings = getDetectionResponseSettings(config.settings);
      if (settings.adminCaseOpenRequiresReason && !reason) {
        throw new Error('Role intake execution requires a case reason.');
      }
    }

    const [guild, moderator] = await Promise.all([
      this.fetchGuild(request.server_id),
      this.fetchModerator(request.actor_id),
    ]);
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      throw new Error(`Role ${roleId} was not found.`);
    }

    const result = await this.securityActionService.intakeRoleMembers({
      action: 'open_case',
      execute,
      limit: this.readMetadataInteger(request.metadata, 'limit') ?? undefined,
      moderator,
      reason,
      role,
    });

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      batch_id: result.batchId,
      eligible_members: result.eligibleMembers,
      execute: result.execute,
      failed: result.failed,
      failures: result.failures.slice(0, 8).map((failure) => ({
        message: failure.message,
        user_id: failure.userId,
      })),
      opened: result.opened,
      processed: result.processed,
      role_id: result.roleId,
      role_name: result.roleName,
      server_id: request.server_id,
      skipped_active_cases: result.skippedActiveCases,
      skipped_bots: result.skippedBots,
      skipped_over_limit: result.skippedOverLimit,
      total_members: result.totalMembers,
    });
  }

  private async verifyCaseUser(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Verify-case request is missing target user or case id.');
    }

    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    const verified = await this.userModerationService.verifyUser(member, moderator);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
      verified,
    });
  }

  private async kickCaseUser(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Kick-case request is missing target user or case id.');
    }

    const reason = await this.resolveDestructiveActionReason(request, 'kick');
    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    await this.assertBotPermission(member.guild, PermissionFlagsBits.KickMembers, 'Kick Members');
    const kicked = await this.userModerationService.kickUser(
      member,
      reason,
      moderator,
      request.detection_event_id ?? undefined
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      kicked,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async banCaseUser(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Ban-case request is missing target user or case id.');
    }

    const reason = await this.resolveDestructiveActionReason(request, 'ban');
    const [member, moderator] = await Promise.all([
      this.fetchGuildMember(request.server_id, request.target_user_id),
      this.fetchModerator(request.actor_id),
    ]);
    await this.assertBotPermission(member.guild, PermissionFlagsBits.BanMembers, 'Ban Members');
    const banned = await this.userModerationService.banUser(
      member,
      reason,
      moderator,
      request.detection_event_id ?? undefined
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      banned,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async previewCaseMessageDeletion(request: ModerationActionRequest): Promise<void> {
    const job = await this.requireMessageDeletionJob(request);
    await this.requireCleanupAdministrator(request);
    const preview = await this.messageCleanupService.previewJob(job.id);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      candidate_count: preview.candidate_count,
      coverage: preview.coverage,
      message_deletion_job_id: preview.id,
      mode: preview.mode,
      scope: preview.scope,
      status: preview.status,
      target_user_id: preview.user_id,
      verification_event_id: preview.verification_event_id,
    });
  }

  private async executeCaseMessageDeletion(request: ModerationActionRequest): Promise<void> {
    const job = await this.requireMessageDeletionJob(request, MessageDeletionJobMode.DELETE_ONLY);
    const administrator = await this.requireCleanupAdministrator(request);
    await this.assertBotPermission(
      administrator.guild,
      PermissionFlagsBits.ManageMessages,
      'Manage Messages'
    );
    const result = await this.messageCleanupService.executeJob(job.id);

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      message_deletion_job_id: job.id,
      mode: job.mode,
      ...this.messageCleanupReceipt(result),
    });
  }

  private async banCaseUserWithMessageCleanup(request: ModerationActionRequest): Promise<void> {
    const job = await this.requireMessageDeletionJob(
      request,
      MessageDeletionJobMode.BAN_WITH_CLEANUP
    );
    const administrator = await this.requireCleanupAdministrator(request);
    const guild = administrator.guild;
    const moderator = administrator.user;
    await this.assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Ban Members');
    await this.assertBotPermission(guild, PermissionFlagsBits.ManageMessages, 'Manage Messages');

    await this.userModerationService.markCombinedBanCleanupPending(
      job.verification_event_id,
      job.id
    );
    if (job.ban_status !== MessageDeletionBanStatus.SUCCEEDED) {
      await this.messageDeletionJobs.updateBanStatus(job.id, MessageDeletionBanStatus.PENDING);
      try {
        // Discord's PUT ban operation is idempotent, so a stale request can safely resume here.
        await this.userModerationService.performDiscordBanById(guild, job.user_id, job.reason);
      } catch (error) {
        await Promise.all([
          this.messageDeletionJobs.updateBanStatus(job.id, MessageDeletionBanStatus.FAILED),
          this.userModerationService.clearCombinedBanCleanupMarker(
            job.verification_event_id,
            job.id
          ),
        ]);
        throw error;
      }
      await this.messageDeletionJobs.updateBanStatus(job.id, MessageDeletionBanStatus.SUCCEEDED);
    }

    let cleanupResult: Awaited<ReturnType<MessageCleanupService['executeJob']>>;
    try {
      cleanupResult = await this.messageCleanupService.executeJob(job.id);
    } catch (error) {
      await this.userModerationService.clearCombinedBanCleanupMarker(
        job.verification_event_id,
        job.id
      );
      throw error;
    }

    if (job.case_finalization_status !== MessageDeletionCaseFinalizationStatus.SUCCEEDED) {
      await this.messageDeletionJobs.updateCaseFinalizationStatus(
        job.id,
        MessageDeletionCaseFinalizationStatus.PENDING
      );
      try {
        await this.userModerationService.finalizeSuccessfulCombinedBan(
          guild,
          job.user_id,
          job.verification_event_id,
          job.id,
          job.reason,
          moderator,
          request.detection_event_id ?? undefined
        );
        await this.messageDeletionJobs.updateCaseFinalizationStatus(
          job.id,
          MessageDeletionCaseFinalizationStatus.SUCCEEDED
        );
      } catch (error) {
        await this.messageDeletionJobs.updateCaseFinalizationStatus(
          job.id,
          MessageDeletionCaseFinalizationStatus.FAILED
        );
        await this.userModerationService.clearCombinedBanCleanupMarker(
          job.verification_event_id,
          job.id
        );
        throw error;
      }
    }

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      banned: true,
      case_finalized: true,
      message_deletion_job_id: job.id,
      mode: job.mode,
      ...this.messageCleanupReceipt(cleanupResult),
    });
    try {
      await this.userModerationService.clearCombinedBanCleanupMarker(
        job.verification_event_id,
        job.id
      );
    } catch (error) {
      console.warn(`Failed to clear completed cleanup marker for job ${job.id}:`, error);
    }
  }

  private async banCaseUserById(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Ban-by-ID request is missing target user or case id.');
    }

    const reason = await this.resolveDestructiveActionReason(request, 'ban');
    const [guild, moderator] = await Promise.all([
      this.fetchGuild(request.server_id),
      this.fetchModerator(request.actor_id),
    ]);
    await this.assertBotPermission(guild, PermissionFlagsBits.BanMembers, 'Ban Members');
    const banned = await this.userModerationService.banUserById(
      guild,
      request.target_user_id,
      reason,
      moderator,
      request.detection_event_id ?? undefined
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      banned,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async closeCaseNoAction(request: ModerationActionRequest): Promise<void> {
    if (!request.target_user_id || !request.verification_event_id) {
      throw new Error('Close-no-action request is missing target user or case id.');
    }

    const [guild, moderator] = await Promise.all([
      this.fetchGuild(request.server_id),
      this.fetchModerator(request.actor_id),
    ]);
    const closedCount = await this.userModerationService.closeCaseNoAction(
      guild,
      request.target_user_id,
      moderator,
      'Closed with no action from the web moderation workbench.'
    );

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      closed_count: closedCount,
      target_user_id: request.target_user_id,
      verification_event_id: request.verification_event_id,
    });
  }

  private async completeSetupVerification(request: ModerationActionRequest): Promise<void> {
    const caseRoleId = this.readMetadataString(request.metadata, 'case_role_id');
    const adminChannelId = this.readMetadataString(request.metadata, 'admin_channel_id');
    if (!caseRoleId || !adminChannelId) {
      throw new Error('Setup verification request is missing case role or admin channel.');
    }

    const verificationChannelId = this.readMetadataString(
      request.metadata,
      'verification_channel_id'
    );
    const reportInstructionsChannelId = this.readMetadataString(
      request.metadata,
      'report_instructions_channel_id'
    );
    const guild = await this.fetchGuild(request.server_id);
    const [caseRole] = await Promise.all([
      guild.roles.fetch(caseRoleId).catch(() => null),
      this.fetchRequestTextChannel(request.server_id, adminChannelId, 'Admin channel'),
      verificationChannelId
        ? this.fetchRequestTextChannel(
            request.server_id,
            verificationChannelId,
            'Verification channel'
          )
        : Promise.resolve(null),
    ]);

    if (!caseRole) {
      throw new Error(`Case role ${caseRoleId} was not found.`);
    }

    const setupWorkflowService = new SetupWorkflowService(
      this.configService,
      this.notificationManager,
      this.productAnalyticsService,
      this.setupDiagnosticsService
    );
    const setupResult = await setupWorkflowService.completeSetup({
      adminChannelId,
      captureAnalytics: true,
      caseRole: caseRole as Role,
      candidateVerificationChannelId: verificationChannelId,
      guild,
      initialVerificationChannelId: verificationChannelId,
      reportInstructionsChannelId,
    });

    if (setupResult.status !== 'completed') {
      throw new Error(this.describeSetupWorkflowFailure(setupResult));
    }

    let reportInstructionsAction: string | null = null;
    let reportInstructionsMessageId: string | null = null;
    let reportInstructionsError: string | null = null;
    if (reportInstructionsChannelId) {
      try {
        const reportChannel = await this.fetchRequestTextChannel(
          request.server_id,
          reportInstructionsChannelId,
          'Report instructions channel'
        );
        const reportInstructionsResult = await new ReportInstructionsManager(
          this.client,
          this.configService
        ).upsertReportInstructionsMessage(request.server_id, reportChannel);
        reportInstructionsAction = reportInstructionsResult.action;
        reportInstructionsMessageId = reportInstructionsResult.messageId;
      } catch (error) {
        reportInstructionsError = this.errorMessage(error);
      }
    }

    await this.repository.complete(request.id, {
      action_type: request.action_type,
      admin_channel_id: setupResult.adminChannelId,
      case_role_created: setupResult.caseRoleWasCreated,
      case_role_id: setupResult.caseRoleId,
      report_instructions_action: reportInstructionsAction,
      report_instructions_channel_id: reportInstructionsChannelId,
      report_instructions_error: reportInstructionsError,
      report_instructions_message_id: reportInstructionsMessageId,
      server_id: request.server_id,
      verification_channel_action: setupResult.verificationChannelAction,
      verification_channel_id: setupResult.verificationChannelId,
    });
  }

  private async upsertReportInstructions(request: ModerationActionRequest): Promise<void> {
    const channelId = this.readMetadataString(request.metadata, 'channel_id');
    if (!channelId) {
      throw new Error('Report instructions request is missing target channel.');
    }

    const targetChannel = await this.fetchRequestTextChannel(
      request.server_id,
      channelId,
      'Report instructions channel'
    );
    const manager = new ReportInstructionsManager(this.client, this.configService);
    const result = await manager.upsertReportInstructionsMessage(request.server_id, targetChannel);

    await this.repository.complete(request.id, {
      action: result.action,
      action_type: request.action_type,
      channel_id: targetChannel.id,
      message_id: result.messageId,
      server_id: request.server_id,
    });
  }

  private async notifyReportIntakeStarted(
    guildId: string,
    reporter: GuildMember,
    thread: ThreadChannel,
    reportIntakeId: string
  ): Promise<void> {
    try {
      const adminChannel = await this.configService.getAdminChannel(guildId);
      const serverConfig = await this.configService.getServerConfig(guildId);
      const roleIds = this.presentationBuilder.getCaseNotificationRoleIds(serverConfig);
      const content = this.presentationBuilder.formatRoleMentions(roleIds);
      await adminChannel?.send({
        ...(content ? { content } : {}),
        allowedMentions: this.presentationBuilder.createAdminAllowedMentions(roleIds),
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(buildReportIntakeAdminActionsCustomId(reportIntakeId))
              .setLabel('Admin Actions')
              .setStyle(ButtonStyle.Primary)
          ),
        ],
        embeds: [this.presentationBuilder.createReportIntakeStartedEmbed(reporter, thread)],
      });
    } catch (error) {
      console.warn(`Failed to notify admin channel for report intake thread ${thread.id}:`, error);
    }
  }

  private async deleteFailedReportIntakeThread(thread: ThreadChannel): Promise<void> {
    const deletable = thread as ThreadChannel & {
      delete?: (reason?: string) => Promise<unknown>;
    };
    if (typeof deletable.delete !== 'function') {
      return;
    }

    try {
      await deletable.delete('Report intake setup failed before reporter activation.');
    } catch (error) {
      console.warn(`Failed to delete failed report intake thread ${thread.id}:`, error);
    }
  }

  private async fetchReportIntakeThread(
    threadId: string,
    serverId: string
  ): Promise<ThreadChannel | null> {
    const channel = await this.client.channels.fetch(threadId).catch(() => null);
    const isThread = Boolean(
      channel &&
      'isThread' in channel &&
      typeof channel.isThread === 'function' &&
      channel.isThread()
    );
    if (!isThread) {
      return null;
    }

    const thread = channel as ThreadChannel;
    if (thread.guildId !== serverId) {
      throw new Error('Report intake thread does not belong to the request guild.');
    }
    return thread;
  }

  private async archiveReportIntakeThread(thread: ThreadChannel, reason: string): Promise<void> {
    try {
      if (!thread.archived && typeof thread.setArchived === 'function') {
        await thread.setArchived(true, reason);
      }
    } catch (error) {
      console.warn(`Failed to archive report intake thread ${thread.id}:`, error);
    }
  }

  private async fetchRequestTextChannel(
    serverId: string,
    channelId: string,
    label: string
  ): Promise<TextChannel> {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error(`${label} ${channelId} was not found as a text channel.`);
    }

    const targetChannel = channel as TextChannel;
    if (targetChannel.guildId !== serverId) {
      throw new Error(`${label} does not belong to the request guild.`);
    }

    return targetChannel;
  }

  private describeSetupWorkflowFailure(result: {
    error?: unknown;
    report?: SetupDiagnosticReport;
    setupFailureDetail?: string;
    status: string;
  }): string {
    if (result.report) {
      return `Setup validation failed. ${this.formatSetupDiagnosticSummary(result.report)}${
        result.setupFailureDetail ? ` ${result.setupFailureDetail}` : ''
      }`;
    }

    if (result.setupFailureDetail) {
      return result.setupFailureDetail;
    }

    if (result.error) {
      return this.errorMessage(result.error);
    }

    return `Setup workflow failed with status ${result.status}.`;
  }

  private describeUserReportFailure(result: {
    error?: unknown;
    label?: string;
    status: string;
  }): string {
    switch (result.status) {
      case 'self_report':
        return 'Reporter cannot report themselves.';
      case 'reason_required':
        return 'This server requires a report reason.';
      case 'member_not_found':
        return `Reported member ${result.label ?? 'unknown'} was not found in this guild.`;
      case 'failed':
        return `Report submission failed: ${this.errorMessage(result.error)}`;
      default:
        return `Report submission failed with status ${result.status}.`;
    }
  }

  private formatSetupDiagnosticSummary(report: SetupDiagnosticReport): string {
    const firstError = report.issues.find((issue) => issue.severity === 'error');
    const firstWarning = report.issues.find((issue) => issue.severity === 'warning');
    const firstIssue = firstError ?? firstWarning;
    const firstIssueMessage = firstIssue ? ` First issue: ${firstIssue.message}` : '';
    return `${report.errorCount} error(s), ${report.warningCount} warning(s).${firstIssueMessage}`;
  }

  private async fetchGuild(serverId: string): Promise<Guild> {
    return this.client.guilds.fetch(serverId);
  }

  private async fetchGuildMember(serverId: string, userId: string): Promise<GuildMember> {
    const guild = await this.fetchGuild(serverId);
    return guild.members.fetch(userId);
  }

  private async requireCleanupAdministrator(
    request: ModerationActionRequest
  ): Promise<GuildMember> {
    const administrator = await this.fetchGuildMember(request.server_id, request.actor_id);
    if (!administrator.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new Error('Message cleanup requires current Administrator permission.');
    }
    return administrator;
  }

  private async requireMessageDeletionJob(
    request: ModerationActionRequest,
    expectedMode?: MessageDeletionJobMode
  ): Promise<MessageDeletionJobWithItems> {
    if (
      !request.message_deletion_job_id ||
      !request.target_user_id ||
      !request.verification_event_id
    ) {
      throw new Error('Message cleanup request is missing its job, target user, or case id.');
    }

    const job = await this.messageDeletionJobs.findById(request.message_deletion_job_id);
    if (!job) {
      throw new Error('Message cleanup job was not found.');
    }
    if (
      job.server_id !== request.server_id ||
      job.user_id !== request.target_user_id ||
      job.verification_event_id !== request.verification_event_id ||
      job.requested_by !== request.actor_id ||
      job.actor_surface !== request.actor_surface
    ) {
      throw new Error('Message cleanup job does not match the queued request.');
    }
    if (expectedMode && job.mode !== expectedMode) {
      throw new Error(`Message cleanup job mode must be ${expectedMode}.`);
    }
    return job;
  }

  private messageCleanupReceipt(result: {
    alreadyCompleted: boolean;
    preservedCount: number;
    deletedCount: number;
    alreadyMissingCount: number;
    changedCount: number;
    evidenceFailedCount: number;
    deleteFailedCount: number;
    permissionDeniedCount: number;
  }): Record<string, boolean | number> {
    return {
      already_completed: result.alreadyCompleted,
      preserved_count: result.preservedCount,
      deleted_count: result.deletedCount,
      already_missing_count: result.alreadyMissingCount,
      changed_since_preview_count: result.changedCount,
      evidence_failed_count: result.evidenceFailedCount,
      delete_failed_count: result.deleteFailedCount,
      permission_denied_count: result.permissionDeniedCount,
    };
  }

  private async assertBotPermission(
    guild: Guild,
    permission: bigint,
    label: string
  ): Promise<void> {
    const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!botMember?.permissions.has(permission)) {
      throw new Error(`Drasil is missing ${label} permission in this guild.`);
    }
  }

  private async fetchModerator(userId: string): Promise<User> {
    return this.fetchUser(userId);
  }

  private async fetchUser(userId: string): Promise<User> {
    return this.client.users.fetch(userId);
  }

  private readOpenAdminCaseSourceMetadata(
    request: ModerationActionRequest
  ): { source: string; source_channel_id: string; source_message_id: string } | undefined {
    const sourceChannelId = this.readMetadataString(request.metadata, 'source_channel_id');
    const sourceMessageId = this.readMetadataString(request.metadata, 'source_message_id');
    if (!sourceChannelId || !sourceMessageId) {
      return undefined;
    }

    return {
      source: this.readMetadataString(request.metadata, 'source') ?? 'message_context_case',
      source_channel_id: sourceChannelId,
      source_message_id: sourceMessageId,
    };
  }

  private async fetchOpenCaseSourceMessage(
    sourceChannelId: string,
    sourceMessageId: string
  ): Promise<Message | undefined> {
    const channel = await this.client.channels.fetch(sourceChannelId).catch(() => null);
    const messageChannel = channel as
      | { messages?: { fetch?: (messageId: string) => Promise<Message> } }
      | null
      | undefined;
    if (!messageChannel?.messages?.fetch) {
      return undefined;
    }

    return (await messageChannel.messages.fetch(sourceMessageId).catch(() => null)) ?? undefined;
  }

  private async resolveDestructiveActionReason(
    request: ModerationActionRequest,
    action: 'ban' | 'kick'
  ): Promise<string> {
    const config = await this.configService.getServerConfig(request.server_id);
    const settings = getDetectionResponseSettings(config.settings);
    const isBan = action === 'ban';
    const actionLabel = isBan ? 'ban' : 'kick';
    const enabled = isBan
      ? settings.moderatorBanActionEnabled
      : settings.moderatorKickActionEnabled;
    const requiresReason = isBan
      ? settings.moderatorBanActionRequiresReason
      : settings.moderatorKickActionRequiresReason;
    if (!enabled) {
      throw new Error(`Moderator ${actionLabel} action is disabled for this server.`);
    }

    const reason = this.readMetadataString(request.metadata, 'reason')?.trim();
    if (requiresReason && !reason) {
      throw new Error(`Moderator ${actionLabel} action requires a reason.`);
    }

    return reason || `No reason provided for web ${actionLabel} action.`;
  }

  private async resolveObservedDestructiveActionReason(
    request: ModerationActionRequest,
    action: 'ban' | 'kick'
  ): Promise<string> {
    const config = await this.configService.getServerConfig(request.server_id);
    const settings = getDetectionResponseSettings(config.settings);
    const isBan = action === 'ban';
    const actionLabel = isBan ? 'ban' : 'kick';
    const enabled = isBan ? settings.moderatorBanActionEnabled : settings.observedActionKickEnabled;
    const requiresReason = isBan
      ? settings.moderatorBanActionRequiresReason
      : settings.moderatorKickActionRequiresReason;
    if (!enabled) {
      throw new Error(
        isBan
          ? 'Moderator ban action is disabled for this server.'
          : 'Observed alert kick actions are disabled for this server.'
      );
    }

    const reason = this.readMetadataString(request.metadata, 'reason')?.trim();
    if (requiresReason && !reason) {
      throw new Error(`Moderator ${actionLabel} action requires a reason.`);
    }

    return reason || (isBan ? OBSERVED_BAN_DEFAULT_REASON : OBSERVED_KICK_DEFAULT_REASON);
  }

  private async resolveOpenAdminCaseReason(
    request: ModerationActionRequest
  ): Promise<string | undefined> {
    const config = await this.configService.getServerConfig(request.server_id);
    const settings = getDetectionResponseSettings(config.settings);
    const reason = this.readMetadataString(request.metadata, 'reason')?.trim();
    if (settings.adminCaseOpenRequiresReason && !reason) {
      throw new Error('Open case action requires a reason.');
    }

    return reason || undefined;
  }

  private readMetadataString(metadata: unknown, key: string): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private readMetadataBoolean(metadata: unknown, key: string): boolean | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : null;
  }

  private readMetadataInteger(metadata: unknown, key: string): number | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  private resolvePollIntervalMs(): number {
    const configured = Number(process.env.DRASIL_ACTION_REQUEST_POLL_MS);
    if (Number.isInteger(configured) && configured > 0) {
      return configured;
    }

    return DEFAULT_POLL_INTERVAL_MS;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
