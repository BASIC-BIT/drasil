import {
  operationConfirmationCommand,
  isQueuedOperationCommand,
  isQueuedReportCommand,
  isQueuedSetupCommand,
  decodeQueuedAction,
} from '@drasil/application';
import type { BotApplication } from '../application/createBotApplication';
import { dispatchQueuedAction } from '../application/requestDispatch';
import { Client, Guild, GuildMember, Message, User } from 'discord.js';
import { inject, injectable, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import {
  getReportBanAttemptToken,
  IModerationActionRequestRepository,
} from '../repositories/ModerationActionRequestRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { ModerationActionRequest, ModerationActionRequestType } from '../repositories/types';
import { IModerationQueueService } from './ModerationQueueService';
import { INotificationManager } from './NotificationManager';
import { IProductAnalyticsService } from './ProductAnalyticsService';
import { IReportIntakeService } from './ReportIntakeService';
import { ISecurityActionService } from './SecurityActionService';
import { ISetupDiagnosticsService } from './SetupDiagnosticsService';
import { IThreadManager } from './ThreadManager';
import { ICombinedBanLifecycleService, IUserModerationService } from './UserModerationService';
import { ICaseThreadClosureSweepService } from './CaseThreadClosureSweepService';
import { ICaseRoleLockdownService } from './CaseRoleLockdownService';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_REQUESTS_PER_TICK = 5;
const REQUEST_HEARTBEAT_INTERVAL_MS = 60_000;

export interface IModerationActionRequestService {
  start(): void;
  stop(): void;
  processPendingRequests(limit?: number): Promise<number>;
}

@injectable()
export class ModerationActionRequestService implements IModerationActionRequestService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processingPromise: Promise<number> | null = null;
  private readonly requestProcessors: Partial<
    Record<ModerationActionRequestType, (request: ModerationActionRequest) => Promise<void>>
  > = {
    [ModerationActionRequestType.OPEN_CASE_FROM_OBSERVED_DETECTION]: (request) =>
      this.executeCaseRequest(request),
    [ModerationActionRequestType.OPEN_ADMIN_CASE]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.MANUAL_FLAG_USER]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.SUBMIT_USER_REPORT]: (request) =>
      this.executeReportRequest(request),
    [ModerationActionRequestType.START_REPORT_INTAKE]: (request) =>
      this.executeReportRequest(request),
    [ModerationActionRequestType.CLOSE_REPORT_INTAKE]: (request) =>
      this.executeReportRequest(request),
    [ModerationActionRequestType.DISMISS_OBSERVED_DETECTION]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.MARK_OBSERVED_DETECTION_FALSE_POSITIVE]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.UNDO_OBSERVED_DETECTION_ACTION]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.KICK_OBSERVED_DETECTION]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.BAN_OBSERVED_DETECTION]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.IGNORE_DETECTION_ACCOUNTING]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.RESTORE_DETECTION_ACCOUNTING]: (request) =>
      this.executeDetectionRequest(request),
    [ModerationActionRequestType.VERIFY_CASE_USER]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.PREVIEW_ACCOUNT_QUARANTINE]: (request) =>
      this.executeQuarantineRequest(request),
    [ModerationActionRequestType.QUARANTINE_COMPROMISED_ACCOUNT]: (request) =>
      this.executeQuarantineRequest(request),
    [ModerationActionRequestType.CLOSE_CASE_NO_ACTION]: (request) =>
      this.executeCaseRequest(request),
    [ModerationActionRequestType.KICK_CASE_USER]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.BAN_CASE_USER]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.PREVIEW_CASE_MESSAGE_DELETION]: (request) =>
      this.executeMessageCleanupRequest(request),
    [ModerationActionRequestType.EXECUTE_CASE_MESSAGE_DELETION]: (request) =>
      this.executeMessageCleanupRequest(request),
    [ModerationActionRequestType.BAN_CASE_USER_WITH_MESSAGE_CLEANUP]: (request) =>
      this.executeMessageCleanupRequest(request),
    [ModerationActionRequestType.BAN_CASE_USER_BY_ID]: (request) =>
      this.executeCaseRequest(request),
    [ModerationActionRequestType.REPAIR_ACTIVE_CASE]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.REOPEN_CASE]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.REFRESH_CASE_NOTIFICATION]: (request) =>
      this.executeCaseRequest(request),
    [ModerationActionRequestType.SYNC_MODERATION_QUEUE]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.CLEAR_MODERATION_QUEUE]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.CLOSE_RESOLVED_CASE_THREADS]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.AUDIT_CASE_ROLE_LOCKDOWN]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.APPLY_CASE_ROLE_LOCKDOWN]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.INTAKE_ROLE_MEMBERS]: (request) =>
      this.executeOperationsRequest(request),
    [ModerationActionRequestType.SYNC_EXISTING_BAN]: (request) => this.executeCaseRequest(request),
    [ModerationActionRequestType.COMPLETE_SETUP_VERIFICATION]: (request) =>
      this.executeSetupRequest(request),
    [ModerationActionRequestType.UPSERT_REPORT_INSTRUCTIONS]: (request) =>
      this.executeSetupRequest(request),
    [ModerationActionRequestType.REQUEST_CAPTCHA_CHALLENGE]: (request) =>
      this.executeCaptchaRequest(request),
    [ModerationActionRequestType.RETRY_CAPTCHA_CHALLENGE]: (request) =>
      this.executeCaptchaRequest(request),
    [ModerationActionRequestType.BYPASS_CAPTCHA_CHALLENGE]: (request) =>
      this.executeCaptchaRequest(request),
    [ModerationActionRequestType.APPLY_CAPTCHA_PASS]: (request) =>
      this.executeCaptchaRequest(request),
    [ModerationActionRequestType.NOTIFY_CAPTCHA_ATTENTION]: (request) =>
      this.executeCaptchaRequest(request),
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
    @inject(TYPES.BotApplication)
    @optional()
    private readonly application?: BotApplication
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
    for (let index = 0; index < DEFAULT_MAX_REQUESTS_PER_TICK; index++) {
      const recovery = await this.repository.claimReportBanReconciliation(new Date());
      if (!recovery) break;
      const heartbeat = setInterval(() => {
        void this.repository
          .heartbeat(recovery.id, getReportBanAttemptToken(recovery))
          .catch((error) => console.warn('Report ban lease renewal failed:', error));
      }, REQUEST_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
      try {
        await this.executeDetectionRequest(recovery, true);
      } catch (error) {
        console.warn('Report ban reconciliation failed:', error);
      } finally {
        clearInterval(heartbeat);
      }
    }
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
      void this.repository
        .heartbeat(request.id, getReportBanAttemptToken(request))
        .catch((error) => {
          console.warn(`Failed to heartbeat moderation action request ${request.id}:`, error);
        });
    }, REQUEST_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();
    try {
      const processor = this.requestProcessors[request.action_type];
      if (!processor) {
        await this.repository.fail(
          request.id,
          `Unsupported action request: ${request.action_type}`,
          getReportBanAttemptToken(request)
        );
        return;
      }

      await processor(request);
    } catch (error) {
      await this.repository.fail(
        request.id,
        this.errorMessage(error),
        getReportBanAttemptToken(request)
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeDetectionRequest(
    request: ModerationActionRequest,
    recovery = false
  ): Promise<void> {
    if (!this.application) throw new Error('Detection application is unavailable.');
    const decoded = decodeQueuedAction(request);
    const action = recovery
      ? {
          ...decoded,
          context: {
            ...decoded.context,
            actor: { kind: 'system' as const, purpose: 'report_ban_recovery' as const },
          },
        }
      : decoded;
    if (
      isQueuedOperationCommand(action.command) ||
      isQueuedReportCommand(action.command) ||
      isQueuedSetupCommand(action.command)
    )
      throw new Error('Detection request mismatch.');
    if (!recovery)
      this.application.caseConfirmations.recordVerified(action.context, action.command);
    const outcome = await dispatchQueuedAction(
      { ...this.application, detections: this.application.detectionRuntime.forRequest(request) },
      action
    );
    if (
      recovery &&
      outcome.action_type === 'ban_observed_detection' &&
      outcome.observed_ban_result.status === 'already_handled'
    )
      return;
    await this.repository.complete(request.id, outcome, getReportBanAttemptToken(request));
  }

  private async executeCaseRequest(request: ModerationActionRequest): Promise<void> {
    const action = decodeQueuedAction(request);
    if (
      isQueuedOperationCommand(action.command) ||
      isQueuedReportCommand(action.command) ||
      isQueuedSetupCommand(action.command)
    )
      throw new Error('Case request mismatch.');
    if (!this.application) throw new Error('Case application is unavailable.');
    // The persisted form submission supplies confirmation evidence; the shared
    // operation still checks fresh authority, mutable policy and case binding.
    this.application.caseConfirmations.recordVerified(action.context, action.command);
    const outcome = await dispatchQueuedAction(this.application, action);
    await this.repository.complete(request.id, outcome);
  }

  private async executeReportRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('Report application is unavailable.');
    const action = decodeQueuedAction(request);
    const outcome = await dispatchQueuedAction(this.application, action);
    await this.repository.complete(request.id, outcome);
  }

  private async executeOperationsRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('Operations application is unavailable.');
    const action = decodeQueuedAction(request);
    if (!isQueuedOperationCommand(action.command)) throw new Error('Operation request mismatch.');
    // The worker owns the accepted persisted request. Execute/unsync remain intent;
    // confirmation is issued separately from that authenticated admission envelope.
    this.application.caseConfirmations.recordVerified(
      action.context,
      operationConfirmationCommand(action.context, action.command)
    );
    const outcome = await dispatchQueuedAction(this.application, action);
    await this.repository.complete(request.id, outcome);
  }

  private async executeCaptchaRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('CAPTCHA application is unavailable.');
    const action = await this.application.captchaRuntime.decodeRequest(request);
    if (
      isQueuedOperationCommand(action.command) ||
      isQueuedReportCommand(action.command) ||
      isQueuedSetupCommand(action.command)
    )
      throw new Error('CAPTCHA request mismatch.');
    if (action.context.actor.kind === 'user')
      this.application.caseConfirmations.recordVerified(action.context, action.command);
    const outcome = await dispatchQueuedAction(
      { ...this.application, captcha: this.application.captchaRuntime.forRequest(request) },
      action
    );
    await this.repository.complete(request.id, outcome);
  }

  private async executeQuarantineRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('Quarantine application is unavailable.');
    const action = decodeQueuedAction(request);
    const outcome = await dispatchQueuedAction(
      { ...this.application, quarantine: this.application.quarantineRuntime.forRequest(request) },
      action
    );
    await this.repository.complete(request.id, outcome);
  }

  private async executeMessageCleanupRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('Message cleanup application is unavailable.');
    const runtime = this.application.messageCleanupRuntime;
    const action = await runtime.decodeRequest(request);
    const outcome = await dispatchQueuedAction(
      { ...this.application, messageCleanup: runtime.forRequest(request) },
      action
    );
    await this.repository.complete(request.id, outcome, getReportBanAttemptToken(request));
    await runtime.afterComplete(request);
  }

  private async executeSetupRequest(request: ModerationActionRequest): Promise<void> {
    if (!this.application) throw new Error('Setup application is unavailable.');
    const action = decodeQueuedAction(request);
    const outcome = await dispatchQueuedAction(this.application, action);
    await this.repository.complete(request.id, outcome);
    if (action.command.kind === 'complete_setup_verification' && action.command.onboardingWizard)
      void this.productAnalyticsService.captureGuildEvent(
        request.server_id,
        'setup wizard completed',
        { surface: 'web' }
      );
  }

  private async fetchGuild(serverId: string): Promise<Guild> {
    return this.client.guilds.fetch(serverId);
  }

  private async fetchGuildMember(serverId: string, userId: string): Promise<GuildMember> {
    const guild = await this.fetchGuild(serverId);
    return guild.members.fetch(userId);
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

  private readMetadataString(metadata: unknown, key: string): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  private readMetadataRecord(metadata: unknown, key: string): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const value = (metadata as Record<string, unknown>)[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
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
