import type { QueueAttentionItemRecord, QueueMessageDeleter } from './QueueAttentionService';

export const reportClosureActions = [
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
] as const;

export type ReportClosureAction = (typeof reportClosureActions)[number];
export type ReportReviewActionSurface = 'discord_interaction' | 'web' | 'agent' | 'mcp';
export type ReportReviewClosureStatus = 'actioned' | 'dismissed' | 'false_positive';
export type CloseSubmittedReportStatus = 'closed' | 'already_handled';
export type OpenSubmittedReportCaseStatus =
  | 'opened'
  | 'queued'
  | 'already_handled'
  | 'case_exists'
  | 'missing_detection'
  | 'missing_target'
  | 'opener_unavailable';
export type ReportCaseOpenStatus = 'opened' | 'queued' | 'already_handled' | 'opener_unavailable';
export type ReportQueueCleanupStatus = 'cleared' | 'failed' | 'skipped';

export interface ReportReviewActor {
  readonly id: string;
  readonly surface: ReportReviewActionSurface;
}

export interface ReportReviewRepository {
  closeSubmittedReport(input: {
    readonly reportId: string;
    readonly serverId: string;
    readonly status: ReportReviewClosureStatus;
    readonly closedAt: Date;
    readonly metadata: Record<string, unknown>;
  }): Promise<ReportReviewRecord | null>;
}

export interface ReportReviewRecord {
  readonly id: string;
  readonly server_id: string;
  readonly thread_id: string | null;
  readonly status: string;
}

export interface ReportOpenCaseCandidate {
  readonly id: string;
  readonly server_id: string;
  readonly status: string;
  readonly confirmed_target_user_id: string | null;
  readonly latest_detection_id: string | null;
  readonly latest_case_id: string | null;
}

export interface ReportOpenCaseRepository {
  findSubmittedReportCaseCandidate(input: {
    readonly reportId: string;
    readonly serverId: string;
  }): Promise<ReportOpenCaseCandidate | null>;
}

export interface ReportCaseOpener {
  openObservedDetectionCase(input: {
    readonly actor: ReportReviewActor;
    readonly detectionEventId: string;
    readonly reportId?: string;
    readonly serverId: string;
    readonly userId: string;
  }): Promise<ReportCaseOpenResult>;
}

export interface ReportCaseOpenResult {
  readonly caseId?: string | null;
  readonly requestId?: string | null;
  readonly status: ReportCaseOpenStatus;
}

export interface ReportReviewQueueRepository {
  deleteReportThreadAttention(reportIntakeId: string): Promise<QueueAttentionItemRecord[]>;
}

export interface CloseSubmittedReportInput {
  readonly actor: ReportReviewActor;
  readonly action: ReportClosureAction;
  readonly reportId: string;
  readonly serverId: string;
  readonly now?: Date;
}

export interface CloseSubmittedReportResult {
  readonly actor: ReportReviewActor;
  readonly action: ReportClosureAction;
  readonly reportId: string;
  readonly reportStatus: ReportReviewClosureStatus;
  readonly status: CloseSubmittedReportStatus;
  readonly queueCleanupStatus: ReportQueueCleanupStatus;
}

export interface OpenSubmittedReportCaseInput {
  readonly actor: ReportReviewActor;
  readonly reportId: string;
  readonly serverId: string;
}

export interface OpenSubmittedReportCaseResult {
  readonly actor: ReportReviewActor;
  readonly action: 'open_case';
  readonly caseId: string | null;
  readonly detectionEventId: string | null;
  readonly reportId: string;
  readonly requestId?: string | null;
  readonly status: OpenSubmittedReportCaseStatus;
  readonly targetUserId: string | null;
  readonly queueCleanupStatus: ReportQueueCleanupStatus;
}

export const reportStatusByClosureAction: Record<ReportClosureAction, ReportReviewClosureStatus> = {
  dismiss_no_action: 'dismissed',
  mark_actioned: 'actioned',
  mark_false_positive: 'false_positive',
};

export function isReportClosureAction(action: string): action is ReportClosureAction {
  return reportClosureActions.includes(action as ReportClosureAction);
}

export class ReportReviewService {
  public constructor(
    private readonly repository: ReportReviewRepository,
    private readonly queueRepository?: ReportReviewQueueRepository,
    private readonly queueMessageDeleter?: QueueMessageDeleter,
    private readonly openCaseRepository?: ReportOpenCaseRepository,
    private readonly reportCaseOpener?: ReportCaseOpener
  ) {}

  public canOpenSubmittedReportCase(): boolean {
    return Boolean(this.openCaseRepository && this.reportCaseOpener);
  }

  public async closeSubmittedReport(
    input: CloseSubmittedReportInput
  ): Promise<CloseSubmittedReportResult> {
    const closedAt = input.now ?? new Date();
    const reportStatus = reportStatusByClosureAction[input.action];
    const closed = await this.repository.closeSubmittedReport({
      reportId: input.reportId,
      serverId: input.serverId,
      status: reportStatus,
      closedAt,
      metadata: {
        closed_by: input.actor.id,
        closed_action: input.action,
        closed_at: closedAt.toISOString(),
        closed_surface: input.actor.surface,
      },
    });

    if (!closed) {
      return {
        actor: input.actor,
        action: input.action,
        reportId: input.reportId,
        reportStatus,
        status: 'already_handled',
        queueCleanupStatus: 'skipped',
      };
    }

    const queueCleanupStatus = await this.clearReportThreadAttention(input.reportId);
    return {
      actor: input.actor,
      action: input.action,
      reportId: input.reportId,
      reportStatus,
      status: 'closed',
      queueCleanupStatus,
    };
  }

  public async openCaseFromSubmittedReport(
    input: OpenSubmittedReportCaseInput
  ): Promise<OpenSubmittedReportCaseResult> {
    const unavailableResult = this.buildOpenCaseResult(input, {
      status: 'opener_unavailable',
    });
    if (!this.openCaseRepository || !this.reportCaseOpener) {
      return unavailableResult;
    }

    const candidate = await this.openCaseRepository.findSubmittedReportCaseCandidate({
      reportId: input.reportId,
      serverId: input.serverId,
    });
    if (!candidate) {
      return this.buildOpenCaseResult(input, { status: 'already_handled' });
    }
    if (candidate.latest_case_id) {
      return this.buildOpenCaseResult(input, {
        caseId: candidate.latest_case_id,
        detectionEventId: candidate.latest_detection_id,
        status: 'case_exists',
        targetUserId: candidate.confirmed_target_user_id,
      });
    }
    if (!candidate.confirmed_target_user_id) {
      return this.buildOpenCaseResult(input, {
        detectionEventId: candidate.latest_detection_id,
        status: 'missing_target',
      });
    }
    if (!candidate.latest_detection_id) {
      return this.buildOpenCaseResult(input, {
        status: 'missing_detection',
        targetUserId: candidate.confirmed_target_user_id,
      });
    }

    const opened = await this.reportCaseOpener.openObservedDetectionCase({
      actor: input.actor,
      detectionEventId: candidate.latest_detection_id,
      reportId: input.reportId,
      serverId: input.serverId,
      userId: candidate.confirmed_target_user_id,
    });
    if (opened.status !== 'opened') {
      return this.buildOpenCaseResult(input, {
        caseId: opened.caseId,
        detectionEventId: candidate.latest_detection_id,
        requestId: opened.requestId,
        status: opened.status,
        targetUserId: candidate.confirmed_target_user_id,
      });
    }

    const queueCleanupStatus = await this.clearReportThreadAttention(input.reportId);
    return this.buildOpenCaseResult(input, {
      caseId: opened.caseId,
      detectionEventId: candidate.latest_detection_id,
      queueCleanupStatus,
      status: 'opened',
      targetUserId: candidate.confirmed_target_user_id,
    });
  }

  private async clearReportThreadAttention(
    reportIntakeId: string
  ): Promise<ReportQueueCleanupStatus> {
    const queueRepository = this.queueRepository;
    const queueMessageDeleter = this.queueMessageDeleter;
    if (!queueRepository || !queueMessageDeleter) {
      return 'skipped';
    }

    try {
      const items = await queueRepository.deleteReportThreadAttention(reportIntakeId);
      if (items.length === 0) {
        return 'skipped';
      }

      await Promise.all(items.map((item) => queueMessageDeleter.deleteQueueMessage(item)));
      return 'cleared';
    } catch (error) {
      console.warn(
        `[ReportReview] Failed to clear report-thread attention for intake ${reportIntakeId}:`,
        error
      );
      return 'failed';
    }
  }

  private buildOpenCaseResult(
    input: OpenSubmittedReportCaseInput,
    overrides: {
      readonly caseId?: string | null;
      readonly detectionEventId?: string | null;
      readonly queueCleanupStatus?: ReportQueueCleanupStatus;
      readonly requestId?: string | null;
      readonly status: OpenSubmittedReportCaseStatus;
      readonly targetUserId?: string | null;
    }
  ): OpenSubmittedReportCaseResult {
    return {
      actor: input.actor,
      action: 'open_case',
      caseId: overrides.caseId ?? null,
      detectionEventId: overrides.detectionEventId ?? null,
      reportId: input.reportId,
      ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
      status: overrides.status,
      targetUserId: overrides.targetUserId ?? null,
      queueCleanupStatus: overrides.queueCleanupStatus ?? 'skipped',
    };
  }
}
