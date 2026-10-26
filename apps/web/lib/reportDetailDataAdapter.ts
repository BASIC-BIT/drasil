import {
  reportAttentionRecordSchema,
  reportDetailSchema,
  type ReportAttentionRecord,
  type ReportDetail,
  type ReportEvidenceAttachment,
  type ReportEvidenceItem,
  type ReportQueueAction,
  type ReportQueueStatus,
} from '@drasil/contracts';
import { discordMessageUrl } from './discordUrls';
import { resolveReportSummarySource } from './reportSummaryProvenance';
import { getPostgresPool } from './setupDataAdapter';

export interface ReportDetailDataAdapter {
  getReportDetail(guildId: string, reportId: string): Promise<ReportDetail | null>;
}

interface ReportDetailRow {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: ReportAttentionRecord['status'];
  summary: string | null;
  metadata?: unknown;
  confirmed_target_user_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  closed_at: unknown;
  latest_detection_id: string | null;
  latest_detection_user_id: string | null;
  latest_detection_handled: boolean;
  latest_case_id: string | null;
  target_display_name?: string | null;
  reporter_display_name?: string | null;
}

interface ReportEvidenceRow {
  id: string;
  kind: ReportEvidenceItem['kind'];
  source_message_id: string | null;
  source_channel_id: string | null;
  attachment_id: string | null;
  content: string | null;
  metadata: unknown;
  created_at: unknown;
}

const reviewedReportStatuses: readonly ReportQueueStatus[] = [
  'submitted',
  'actioned',
  'dismissed',
  'false_positive',
];

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function toNullableIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  return toIsoString(value);
}

function metadataToRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readUrl(value: unknown): string | null {
  const candidate = readString(value);
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function resolveAllowedActions(row: ReportDetailRow): ReportQueueAction[] {
  const actions: ReportQueueAction[] = row.thread_id ? ['open_report_thread'] : [];
  if (row.status !== 'submitted' || metadataToRecord(row.metadata).report_ban_operation_id)
    return actions;
  const detectionMatchesTarget = row.latest_detection_user_id === row.confirmed_target_user_id;
  if (
    row.confirmed_target_user_id &&
    row.latest_detection_id &&
    !row.latest_detection_handled &&
    detectionMatchesTarget
  ) {
    if (!row.latest_case_id) actions.push('open_case');
    actions.push('ban_user');
  }
  if (!row.latest_case_id)
    actions.push('mark_actioned', 'dismiss_no_action', 'mark_false_positive');
  return actions;
}

function parseAttachment(row: ReportEvidenceRow): ReportEvidenceAttachment | null {
  const metadata = metadataToRecord(row.metadata);
  const url = readUrl(metadata.url) ?? readUrl(metadata.proxyUrl);
  if (!row.attachment_id && !url) {
    return null;
  }

  return {
    id: row.attachment_id ?? readString(metadata.id),
    name: readString(metadata.name),
    url,
    contentType: readString(metadata.contentType),
    size: readNumber(metadata.size),
  };
}

function parseEvidenceRow(guildId: string, row: ReportEvidenceRow): ReportEvidenceItem {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    createdAt: toNullableIsoString(row.created_at),
    sourceMessageUrl:
      row.source_channel_id && row.source_message_id
        ? discordMessageUrl(guildId, row.source_channel_id, row.source_message_id)
        : null,
    attachment: parseAttachment(row),
  };
}

function reportFields(row: ReportDetailRow, evidenceRows: readonly ReportEvidenceRow[]) {
  return {
    id: row.id,
    guildId: row.server_id,
    reporterId: row.reporter_id,
    targetUserId: row.confirmed_target_user_id,
    targetDisplayName: row.target_display_name ?? null,
    reporterDisplayName: row.reporter_display_name ?? null,
    status: row.status,
    summary: row.summary,
    summarySource: resolveReportSummarySource(row.summary, row.metadata),
    createdAt: toNullableIsoString(row.created_at),
    updatedAt: toNullableIsoString(row.updated_at),
    closedAt: toNullableIsoString(row.closed_at),
    reportThreadUrl: row.thread_id ? discordMessageUrl(row.server_id, row.thread_id) : null,
    latestDetectionId: row.latest_detection_id,
    latestCaseId: row.latest_case_id,
    evidence: evidenceRows.map((evidence) => parseEvidenceRow(row.server_id, evidence)),
    allowedActions: resolveAllowedActions(row),
  };
}

export function parseReportDetailRows(
  row: ReportDetailRow,
  evidenceRows: readonly ReportEvidenceRow[]
): ReportDetail {
  return reportDetailSchema.parse(reportFields(row, evidenceRows));
}

export function parseReportAttentionRows(
  row: ReportDetailRow,
  evidenceRows: readonly ReportEvidenceRow[]
): ReportAttentionRecord {
  return reportAttentionRecordSchema.parse({
    ...reportFields(row, evidenceRows),
    allowedActions: [],
  });
}

export class PostgresReportDetailDataAdapter implements ReportDetailDataAdapter {
  public async getReportDetail(guildId: string, reportId: string): Promise<ReportDetail | null> {
    const reportResult = await getPostgresPool().query<ReportDetailRow>(
      `select
         ri.id,
         ri.server_id,
         ri.reporter_id,
         ri.thread_id,
         ri.status,
         ri.summary,
         ri.metadata,
         ri.confirmed_target_user_id,
         target.username as target_display_name,
         reporter.username as reporter_display_name,
         ri.created_at,
         ri.updated_at,
         ri.closed_at,
         de.id as latest_detection_id,
         de.user_id as latest_detection_user_id,
         coalesce(de.metadata, '{}'::jsonb) ? 'observed_action' as latest_detection_handled,
         linked_case.id as latest_case_id
       from report_intakes ri
       left join users target on target.discord_id = ri.confirmed_target_user_id
       left join users reporter on reporter.discord_id = ri.reporter_id
       left join lateral (
         select id, user_id, metadata, latest_verification_event_id
         from detection_events
         where server_id = ri.server_id
           and user_id = ri.confirmed_target_user_id
           and metadata ->> 'reportIntakeId' = ri.id::text
         order by detected_at desc nulls last
         limit 1
       ) de on true
       left join verification_events linked_case on linked_case.id = de.latest_verification_event_id and linked_case.server_id = ri.server_id and linked_case.user_id = ri.confirmed_target_user_id
       where ri.id::text = $1 and ri.server_id = $2 and ri.status = any($3::report_intake_status[])
       limit 1`,
      [reportId, guildId, reviewedReportStatuses]
    );
    const report = reportResult.rows[0];
    if (!report) {
      return null;
    }

    const evidenceResult = await getPostgresPool().query<ReportEvidenceRow>(
      `select id, kind, source_message_id, source_channel_id, attachment_id, content, metadata, created_at
       from report_intake_evidence evidence
       where intake_id = $1 and exists (select 1 from report_intakes ri where ri.id = evidence.intake_id and ri.server_id = $2)
       order by created_at asc`,
      [reportId, guildId]
    );
    return parseReportDetailRows(report, evidenceResult.rows);
  }
}

export function createReportDetailDataAdapter(): ReportDetailDataAdapter {
  return new PostgresReportDetailDataAdapter();
}
