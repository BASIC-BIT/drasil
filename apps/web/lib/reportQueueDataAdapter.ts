import {
  reportQueueItemSchema,
  sortReportQueueItems,
  type ReportQueueAction,
  type ReportQueueItem,
  type ReportQueueStatus,
} from '@drasil/contracts';
import { fixtureSubmittedReports } from './reportFixtures';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface ReportQueueDataAdapter {
  listSubmittedReports(guildId: string): Promise<ReportQueueItem[]>;
  countClosedReports(guildId: string): Promise<number>;
  closeSubmittedReport(input: {
    guildId: string;
    reportId: string;
    action: ReportClosureAction;
    adminId: string;
  }): Promise<boolean>;
}

export type ReportClosureAction = Extract<
  ReportQueueAction,
  'mark_actioned' | 'dismiss_no_action' | 'mark_false_positive'
>;

interface ReportQueueRow {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: ReportQueueStatus;
  summary: string | null;
  confirmed_target_user_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  evidence_count: string | number | null;
  latest_detection_id: string | null;
  latest_case_id: string | null;
}

const DEFAULT_STALE_HOURS = 24;

const closureStatusByAction: Record<
  ReportClosureAction,
  Exclude<ReportQueueStatus, 'submitted'>
> = {
  dismiss_no_action: 'dismissed',
  mark_actioned: 'actioned',
  mark_false_positive: 'false_positive',
};

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
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
  if (!row.latest_case_id && row.confirmed_target_user_id) {
    actions.push('open_case');
  }
  actions.push('mark_actioned', 'dismiss_no_action', 'mark_false_positive');
  return actions;
}

export function parseReportQueueRow(row: ReportQueueRow, now = new Date()): ReportQueueItem {
  const updatedAt = new Date(toIsoString(row.updated_at));
  const staleHours = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 3_600_000));

  return reportQueueItemSchema.parse({
    id: row.id,
    guildId: row.server_id,
    reporterId: row.reporter_id,
    targetUserId: row.confirmed_target_user_id,
    status: row.status,
    summary: row.summary,
    createdAt: toIsoString(row.created_at),
    updatedAt: updatedAt.toISOString(),
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
  public async listSubmittedReports(guildId: string): Promise<ReportQueueItem[]> {
    const result = await getPostgresPool().query<ReportQueueRow>(
      `select
         ri.id,
         ri.server_id,
         ri.reporter_id,
         ri.thread_id,
         ri.status,
         ri.summary,
         ri.confirmed_target_user_id,
         ri.created_at,
         ri.updated_at,
         coalesce(ev.evidence_count, 0)::text as evidence_count,
         de.id as latest_detection_id,
         de.latest_verification_event_id as latest_case_id
       from report_intakes ri
       left join lateral (
         select count(*) as evidence_count
         from report_intake_evidence rie
         where rie.intake_id = ri.id
       ) ev on true
       left join lateral (
         select id, latest_verification_event_id
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

  public async closeSubmittedReport(input: {
    guildId: string;
    reportId: string;
    action: ReportClosureAction;
    adminId: string;
  }): Promise<boolean> {
    const status = closureStatusByAction[input.action];
    const result = await getPostgresPool().query<{ id: string }>(
      `update report_intakes
       set status = $3,
           closed_at = now(),
           updated_at = now(),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'closed_by', $4::text,
             'closed_action', $5::text,
             'closed_at', now()
           )
       where id = $1 and server_id = $2 and status = 'submitted'
       returning id`,
      [input.reportId, input.guildId, status, input.adminId, input.action]
    );
    return result.rowCount === 1;
  }
}

export class FixtureReportQueueDataAdapter implements ReportQueueDataAdapter {
  public async listSubmittedReports(): Promise<ReportQueueItem[]> {
    return sortReportQueueItems(fixtureSubmittedReports());
  }

  public async countClosedReports(): Promise<number> {
    return 4;
  }

  public async closeSubmittedReport(): Promise<boolean> {
    return true;
  }
}

export function createReportQueueDataAdapter(): ReportQueueDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureReportQueueDataAdapter();
  }

  return new PostgresReportQueueDataAdapter();
}
