import { readFixtureReportBan } from './reportBanFixtures';
import {
  reportQueueItemSchema,
  sortReportQueueItems,
  type ReportQueueAction,
  type ReportQueueItem,
  type ReportQueueStatus,
} from '@drasil/contracts';
import type {
  ActionContext,
  ReportReviewActions,
  ReportClosureAction,
  OpenSubmittedReportCaseResult,
  CloseSubmittedReportResult,
} from '@drasil/application';
import { createWebApplication } from './application/createWebApplication';
import { fixtureSubmittedReports } from './reportFixtures';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';
import { resolveReportSummarySource } from './reportSummaryProvenance';

export type { ReportClosureAction } from '@drasil/application';

export interface ReportQueueDataAdapter {
  listSubmittedReports(guildId: string): Promise<ReportQueueItem[]>;
  countClosedReports(guildId: string): Promise<number>;
  canOpenSubmittedReportCase(): boolean;
  closeSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
      action: ReportClosureAction;
    }
  ): Promise<CloseSubmittedReportResult>;
  openCaseFromSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
    }
  ): Promise<OpenSubmittedReportCaseResult>;
}

interface ReportQueueRow {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: ReportQueueStatus;
  summary: string | null;
  metadata?: unknown;
  confirmed_target_user_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  evidence_count: string | number | null;
  latest_detection_id: string | null;
  latest_detection_user_id: string | null;
  latest_detection_handled: boolean;
  latest_case_id: string | null;
}

const DEFAULT_STALE_HOURS = 24;

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return new Date(value).toISOString();
  }
  return null;
}

function toEvidenceCount(value: string | number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function resolveAllowedActions(row: ReportQueueRow): ReportQueueAction[] {
  const actions: ReportQueueAction[] = [];
  if (row.thread_id) {
    actions.push('open_report_thread');
  }
  const metadata = row.metadata;
  if (
    metadata &&
    typeof metadata === 'object' &&
    'report_ban_operation_id' in metadata &&
    metadata.report_ban_operation_id
  )
    return actions;
  if (row.status !== 'submitted') return actions;
  if (!row.latest_case_id && row.confirmed_target_user_id && row.latest_detection_id) {
    actions.push('open_case');
  }
  if (
    row.confirmed_target_user_id &&
    row.latest_detection_id &&
    !row.latest_detection_handled &&
    row.latest_detection_user_id === row.confirmed_target_user_id
  ) {
    actions.push('ban_user');
  }
  actions.push('mark_actioned', 'dismiss_no_action', 'mark_false_positive');
  return actions;
}

export function parseReportQueueRow(row: ReportQueueRow, now = new Date()): ReportQueueItem {
  const updatedAt = toIsoString(row.updated_at);
  const staleHours = updatedAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(updatedAt)) / 3_600_000))
    : 0;

  return reportQueueItemSchema.parse({
    id: row.id,
    guildId: row.server_id,
    reporterId: row.reporter_id,
    targetUserId: row.confirmed_target_user_id,
    status: row.status,
    summary: row.summary,
    summarySource: resolveReportSummarySource(row.summary, row.metadata),
    createdAt: toIsoString(row.created_at),
    updatedAt,
    stale: staleHours >= DEFAULT_STALE_HOURS,
    staleHours,
    evidenceCount: toEvidenceCount(row.evidence_count),
    reportThreadUrl: row.thread_id ? discordMessageUrl(row.server_id, row.thread_id) : null,
    latestDetectionId: row.latest_detection_id,
    latestCaseId: row.latest_case_id,
    allowedActions: resolveAllowedActions(row),
  });
}

export class PostgresReportQueueDataAdapter implements ReportQueueDataAdapter {
  public constructor(
    private readonly reportReview: Pick<
      ReportReviewActions,
      'close' | 'openCase'
    > = createWebApplication().reportReview
  ) {}

  public async listSubmittedReports(guildId: string): Promise<ReportQueueItem[]> {
    const result = await getPostgresPool().query<ReportQueueRow>(
      `select
         ri.id,
         ri.server_id,
         ri.reporter_id,
         ri.thread_id,
         ri.status,
         ri.summary,
         ri.metadata,
         ri.confirmed_target_user_id,
         ri.created_at,
         ri.updated_at,
         coalesce(ev.evidence_count, 0)::text as evidence_count,
         de.id as latest_detection_id,
         de.user_id as latest_detection_user_id,
         coalesce(de.metadata, '{}'::jsonb) ? 'observed_action' as latest_detection_handled,
         de.latest_verification_event_id as latest_case_id
       from report_intakes ri
       left join lateral (
         select count(*) as evidence_count
         from report_intake_evidence rie
         where rie.intake_id = ri.id
       ) ev on true
       left join lateral (
         select id, user_id, metadata, latest_verification_event_id
         from detection_events
         where server_id = ri.server_id
           and metadata ->> 'reportIntakeId' = ri.id::text
         order by detected_at desc nulls last
         limit 1
       ) de on true
       where ri.server_id = $1 and ri.status = 'submitted'
       order by ri.updated_at asc`,
      [guildId]
    );
    return sortReportQueueItems(result.rows.map((row) => parseReportQueueRow(row)));
  }

  public async countClosedReports(guildId: string): Promise<number> {
    const result = await getPostgresPool().query<{ count: string }>(
      `select count(*)::text
       from report_intakes
       where server_id = $1 and status in ('actioned', 'dismissed', 'false_positive')`,
      [guildId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public canOpenSubmittedReportCase(): boolean {
    return true;
  }

  public async closeSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
      action: ReportClosureAction;
    }
  ): Promise<CloseSubmittedReportResult> {
    const result = await this.reportReview.close(context, {
      action: input.action,
      reportId: input.reportId,
    });
    if (result.kind === 'denied')
      throw new Error('You need moderation permissions to review reports.');
    return result.outcome;
  }

  public async openCaseFromSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
    }
  ): Promise<OpenSubmittedReportCaseResult> {
    const result = await this.reportReview.openCase(context, { reportId: input.reportId });
    if (result.kind === 'denied')
      throw new Error('You need moderation permissions to review reports.');
    return result.outcome;
  }
}

export class FixtureReportQueueDataAdapter implements ReportQueueDataAdapter {
  public async listSubmittedReports(): Promise<ReportQueueItem[]> {
    const request = await readFixtureReportBan();
    return sortReportQueueItems(
      fixtureSubmittedReports().filter(
        (report) =>
          request?.observedBanResult?.status !== 'banned' || request.reportIntakeId !== report.id
      )
    );
  }

  public async countClosedReports(): Promise<number> {
    return (await readFixtureReportBan())?.observedBanResult?.status === 'banned' ? 5 : 4;
  }

  public canOpenSubmittedReportCase(): boolean {
    return true;
  }

  public async closeSubmittedReport(
    context: ActionContext,
    input: { reportId: string; action: ReportClosureAction }
  ): Promise<CloseSubmittedReportResult> {
    return {
      actor: {
        id: context.actor.kind === 'user' ? context.actor.userId : '',
        surface: context.source,
      },
      action: input.action,
      reportId: input.reportId,
      reportStatus:
        input.action === 'dismiss_no_action'
          ? 'dismissed'
          : input.action === 'mark_actioned'
            ? 'actioned'
            : 'false_positive',
      status: 'closed',
      queueCleanupStatus: 'skipped',
    };
  }

  public async openCaseFromSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
    }
  ): Promise<OpenSubmittedReportCaseResult> {
    const report = fixtureSubmittedReports().find((item) => item.id === input.reportId);
    return {
      actor: {
        id: context.actor.kind === 'user' ? context.actor.userId : '',
        surface: context.source,
      },
      action: 'open_case',
      caseId: report?.latestCaseId ?? `fixture-case-${input.reportId}`,
      detectionEventId: report?.latestDetectionId ?? null,
      reportId: input.reportId,
      requestId: `fixture-report-open-case-${input.reportId}`,
      status: report?.targetUserId && report.latestDetectionId ? 'opened' : 'missing_detection',
      targetUserId: report?.targetUserId ?? null,
      queueCleanupStatus: 'skipped',
    };
  }
}

export function createReportQueueDataAdapter(): ReportQueueDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureReportQueueDataAdapter();
  }

  return new PostgresReportQueueDataAdapter();
}
