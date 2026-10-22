import { hasAuthority, hasStaffAuthority, MODERATION_PERMISSIONS } from '../authorization';
import { z } from 'zod';
import type { ActionContext } from '../context';
import type { ActionDenialCode, ActionResult } from '../results';
import type { QueueAttentionItemRecord } from '../operations/attention';
import type { ReportReviewDependencies } from './ports';

export const reportClosureActions = [
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
] as const;

export type ReportClosureAction = (typeof reportClosureActions)[number];
export type ReportReviewActionSurface = string;
export type ReportReviewClosureStatus = 'actioned' | 'dismissed' | 'false_positive';
export type CloseSubmittedReportStatus = 'closed' | 'already_handled' | 'busy';
export type OpenSubmittedReportCaseStatus =
  | 'busy'
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
  readonly busy?: boolean;
  readonly id: string;
  readonly server_id: string;
  readonly thread_id: string | null;
  readonly status: string;
}

export interface ReportOpenCaseCandidate {
  readonly busy?: boolean;
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
  openObservedDetectionCase(
    context: ActionContext,
    input: {
      readonly detectionEventId: string;
      readonly reportId: string;
      readonly userId: string;
    }
  ): Promise<ReportCaseOpenResult>;
}

export interface ReportCaseOpenResult {
  readonly caseId?: string | null;
  readonly requestId?: string | null;
  readonly status: ReportCaseOpenStatus;
}

export interface ReportReviewQueueRepository {
  deleteReportThreadAttention(reportIntakeId: string): Promise<QueueAttentionItemRecord[]>;
}

export interface CloseSubmittedReportResult {
  readonly actor: ReportReviewActor;
  readonly action: ReportClosureAction;
  readonly reportId: string;
  readonly reportStatus: ReportReviewClosureStatus;
  readonly status: CloseSubmittedReportStatus;
  readonly queueCleanupStatus: ReportQueueCleanupStatus;
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
  return reportClosureActions.some((candidate) => candidate === action);
}

const closeSchema = z
  .object({ reportId: z.string().min(1), action: z.enum(reportClosureActions) })
  .strict();
const openCaseSchema = z.object({ reportId: z.string().min(1) }).strict();

export interface ReportReviewActions {
  prepareSubmittedReportCaseOpen(
    context: ActionContext,
    input: { readonly reportId: string }
  ): Promise<ReportCasePreparation>;
  close(
    context: ActionContext,
    input: { readonly reportId: string; readonly action: ReportClosureAction }
  ): Promise<ActionResult<CloseSubmittedReportResult>>;
  openCase(
    context: ActionContext,
    input: { readonly reportId: string }
  ): Promise<ActionResult<OpenSubmittedReportCaseResult>>;
}

export function createReportReviewActions(deps: ReportReviewDependencies): ReportReviewActions {
  async function authorize(
    context: ActionContext,
    requiredAuthority: 'report_review' | 'case_opening'
  ): Promise<ActionDenialCode | null> {
    if (context.actor.kind !== 'user') return 'permission_denied';
    const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
    if (!facts || !facts.present) return 'actor_unavailable';
    if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
      return 'binding_mismatch';
    if (hasAuthority(facts, MODERATION_PERMISSIONS)) return null;
    if (requiredAuthority === 'case_opening') return 'permission_denied';
    const roleIds = await deps.staffRoles.loadRoleIds(context.guildId);
    return hasStaffAuthority(facts, roleIds) ? null : 'permission_denied';
  }
  async function clearReportThreadAttention(reportId: string): Promise<ReportQueueCleanupStatus> {
    if (!deps.queueRepository || !deps.queueMessageDeleter) return 'skipped';
    const deleter = deps.queueMessageDeleter;
    try {
      const items = await deps.queueRepository.deleteReportThreadAttention(reportId);
      if (!items.length) return 'skipped';
      await Promise.all(items.map((item) => deleter.deleteQueueMessage(item)));
      return 'cleared';
    } catch (error) {
      console.warn(
        '[ReportReview] Failed to clear report-thread attention for intake %s:',
        reportId,
        error
      );
      return 'failed';
    }
  }
  return {
    prepareSubmittedReportCaseOpen: (context, input) =>
      prepareSubmittedReportCaseOpen(context, input, deps),
    async close(context, command): Promise<ActionResult<CloseSubmittedReportResult>> {
      const input = closeSchema.parse(command);
      const denial = await authorize(context, 'report_review');
      if (denial) return { kind: 'denied', code: denial };
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      const actor = { id: context.actor.userId, surface: context.source };
      const closedAt = new Date();
      const reportStatus = reportStatusByClosureAction[input.action];
      const closed = await deps.repository.closeSubmittedReport({
        reportId: input.reportId,
        serverId: context.guildId,
        status: reportStatus,
        closedAt,
        metadata: {
          closed_by: actor.id,
          closed_action: input.action,
          closed_at: closedAt.toISOString(),
          closed_surface: actor.surface,
        },
      });
      const status = closed?.busy ? 'busy' : closed ? 'closed' : 'already_handled';
      return {
        kind: 'outcome',
        outcome: {
          actor,
          action: input.action,
          reportId: input.reportId,
          reportStatus,
          status,
          queueCleanupStatus:
            status === 'closed' ? await clearReportThreadAttention(input.reportId) : 'skipped',
        },
      };
    },
    async openCase(context, command): Promise<ActionResult<OpenSubmittedReportCaseResult>> {
      const prepared = await prepareSubmittedReportCaseOpen(context, command, {
        authority: deps.authority,
        openCaseRepository: deps.reportCaseOpener ? deps.openCaseRepository : null,
      });
      if (prepared.kind !== 'ready') return prepared;
      const { candidate } = prepared.precondition;
      const input = command;
      const result = (
        overrides: Partial<OpenSubmittedReportCaseResult>
      ): ActionResult<OpenSubmittedReportCaseResult> => ({
        kind: 'outcome',
        outcome: { ...prepared.base, ...overrides },
      });
      if (!deps.reportCaseOpener) return result({});
      const opened = await deps.reportCaseOpener.openObservedDetectionCase(context, {
        detectionEventId: prepared.command.detectionEventId,
        reportId: input.reportId,
        userId: prepared.command.targetUserId,
      });
      return result({
        caseId: opened.caseId ?? null,
        detectionEventId: candidate.latest_detection_id,
        ...(opened.requestId ? { requestId: opened.requestId } : {}),
        status: opened.status,
        targetUserId: candidate.confirmed_target_user_id,
        queueCleanupStatus:
          opened.status === 'opened' ? await clearReportThreadAttention(input.reportId) : 'skipped',
      });
    },
  };
}

export type ReportCasePreparation =
  | { readonly kind: 'denied'; readonly code: ActionDenialCode }
  | { readonly kind: 'outcome'; readonly outcome: OpenSubmittedReportCaseResult }
  | {
      readonly kind: 'ready';
      readonly command: Extract<
        import('../cases/commands').CaseCommand,
        { kind: 'open_case_from_observed_detection' }
      >;
      readonly precondition: ReportCasePrecondition;
      readonly base: OpenSubmittedReportCaseResult;
    };
export interface ReportCasePrecondition {
  readonly kind: 'report_case_candidate';
  readonly candidate: ReportOpenCaseCandidate;
}

export async function prepareSubmittedReportCaseOpen(
  context: ActionContext,
  command: { readonly reportId: string },
  deps: Pick<ReportReviewDependencies, 'authority' | 'openCaseRepository'>
): Promise<ReportCasePreparation> {
  const input = openCaseSchema.parse(command);
  if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
  const facts = await deps.authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts?.present) return { kind: 'denied', code: 'actor_unavailable' };
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
    return { kind: 'denied', code: 'binding_mismatch' };
  if (!hasAuthority(facts, MODERATION_PERMISSIONS))
    return { kind: 'denied', code: 'permission_denied' };
  if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
  const base: OpenSubmittedReportCaseResult = {
    actor: { id: context.actor.userId, surface: context.source },
    action: 'open_case',
    reportId: input.reportId,
    caseId: null,
    detectionEventId: null,
    targetUserId: null,
    status: 'opener_unavailable',
    queueCleanupStatus: 'skipped',
  };
  function result(
    overrides: Partial<OpenSubmittedReportCaseResult>
  ): ActionResult<OpenSubmittedReportCaseResult> {
    return { kind: 'outcome', outcome: { ...base, ...overrides } };
  }
  if (!deps.openCaseRepository) return result({});
  const candidate = await deps.openCaseRepository.findSubmittedReportCaseCandidate({
    reportId: input.reportId,
    serverId: context.guildId,
  });
  if (!candidate) return result({ status: 'already_handled' });
  if (candidate.id !== input.reportId || candidate.server_id !== context.guildId)
    return { kind: 'denied', code: 'binding_mismatch' };
  if (candidate.busy) return result({ status: 'busy' });
  if (candidate.status !== 'submitted') return result({ status: 'already_handled' });
  if (candidate.latest_case_id)
    return result({
      caseId: candidate.latest_case_id,
      detectionEventId: candidate.latest_detection_id,
      status: 'case_exists',
      targetUserId: candidate.confirmed_target_user_id,
    });
  if (!candidate.confirmed_target_user_id)
    return result({
      status: 'missing_target',
      detectionEventId: candidate.latest_detection_id,
    });
  if (!candidate.latest_detection_id)
    return result({
      status: 'missing_detection',
      targetUserId: candidate.confirmed_target_user_id,
    });
  return {
    kind: 'ready',
    command: {
      kind: 'open_case_from_observed_detection',
      detectionEventId: candidate.latest_detection_id,
      reportId: input.reportId,
      targetUserId: candidate.confirmed_target_user_id,
    },
    precondition: { kind: 'report_case_candidate', candidate },
    base,
  };
}
