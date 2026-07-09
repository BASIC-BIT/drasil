import {
  reportDetailSchema,
  type ReportDetail,
  type ReportEvidenceAttachment,
  type ReportEvidenceItem,
  type ReportQueueAction,
  type ReportQueueStatus,
} from '@drasil/contracts';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { fixtureReportDetail } from './reportFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface ReportDetailDataAdapter {
  getReportDetail(guildId: string, reportId: string): Promise<ReportDetail | null>;
}

interface ReportDetailRow {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: ReportQueueStatus;
  summary: string | null;
  confirmed_target_user_id: string | null;
  created_at: unknown;
  updated_at: unknown;
  closed_at: unknown;
  latest_detection_id: string | null;
  latest_case_id: string | null;
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
  const actions: ReportQueueAction[] = [];
  if (row.thread_id) {
    actions.push('open_report_thread');
  }
  if (row.latest_case_id) {
    return actions;
  }
  if (row.status === 'submitted' && row.confirmed_target_user_id && row.latest_detection_id) {
    actions.push('open_case');
  }
  if (row.status === 'submitted') {
    actions.push('mark_actioned', 'dismiss_no_action', 'mark_false_positive');
  }
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
    createdAt: toIsoString(row.created_at),
    sourceMessageUrl:
      row.source_channel_id && row.source_message_id
        ? discordMessageUrl(guildId, row.source_channel_id, row.source_message_id)
        : null,
    attachment: parseAttachment(row),
  };
}

export function parseReportDetailRows(
  row: ReportDetailRow,
  evidenceRows: readonly ReportEvidenceRow[]
): ReportDetail {
  return reportDetailSchema.parse({
    id: row.id,
    guildId: row.server_id,
    reporterId: row.reporter_id,
    targetUserId: row.confirmed_target_user_id,
    status: row.status,
    summary: row.summary,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    closedAt: toNullableIsoString(row.closed_at),
    reportThreadUrl: row.thread_id ? discordMessageUrl(row.server_id, row.thread_id) : null,
    latestDetectionId: row.latest_detection_id,
    latestCaseId: row.latest_case_id,
    evidence: evidenceRows.map((evidence) => parseEvidenceRow(row.server_id, evidence)),
    allowedActions: resolveAllowedActions(row),
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
         ri.confirmed_target_user_id,
         ri.created_at,
         ri.updated_at,
         ri.closed_at,
         de.id as latest_detection_id,
         de.latest_verification_event_id as latest_case_id
       from report_intakes ri
       left join lateral (
         select id, latest_verification_event_id
         from detection_events
         where server_id = ri.server_id
           and metadata ->> 'reportIntakeId' = ri.id::text
         order by detected_at desc nulls last
         limit 1
       ) de on true
       where ri.id = $1 and ri.server_id = $2 and ri.status = any($3::report_intake_status[])
       limit 1`,
      [reportId, guildId, reviewedReportStatuses]
    );
    const report = reportResult.rows[0];
    if (!report) {
      return null;
    }

    const evidenceResult = await getPostgresPool().query<ReportEvidenceRow>(
      `select id, kind, source_message_id, source_channel_id, attachment_id, content, metadata, created_at
       from report_intake_evidence
       where intake_id = $1
       order by created_at asc`,
      [reportId]
    );
    return parseReportDetailRows(report, evidenceResult.rows);
  }
}

export class FixtureReportDetailDataAdapter implements ReportDetailDataAdapter {
  public async getReportDetail(_guildId: string, reportId: string): Promise<ReportDetail | null> {
    return fixtureReportDetail(reportId);
  }
}

export function createReportDetailDataAdapter(): ReportDetailDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureReportDetailDataAdapter();
  }

  return new PostgresReportDetailDataAdapter();
}
