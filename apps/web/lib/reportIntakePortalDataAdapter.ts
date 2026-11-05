import {
  projectReporterIdentityReview,
  reportIntakeStatusLabel,
  type ReporterIdentityReview,
} from '@drasil/contracts';
import type { ActionContext } from '@drasil/application';
import { discordMessageUrl } from './discordUrls';
import { getPostgresPool } from './setupDataAdapter';

export type OpenReportIntakeStatus =
  'collecting_evidence' | 'needs_reporter_confirmation' | 'needs_admin_confirmation';

export interface ReporterOpenReportIntake {
  readonly identityReview?: ReporterIdentityReview | null;
  readonly statusLabel?: string;
  readonly createdAt: string | null;
  readonly guildId: string;
  readonly id: string;
  readonly status: OpenReportIntakeStatus;
  readonly threadId: string | null;
  readonly threadUrl: string | null;
  readonly updatedAt: string | null;
}

export interface ReportIntakePortalDataAdapter {
  getOpenIntakeForReporter(input: {
    readonly guildId: string;
    readonly reporterId: string;
  }): Promise<ReporterOpenReportIntake | null>;
}

interface OpenReportIntakeRow {
  readonly metadata?: unknown;
  readonly created_at: unknown;
  readonly id: string;
  readonly server_id: string;
  readonly status: OpenReportIntakeStatus;
  readonly thread_id: string | null;
  readonly updated_at: unknown;
}

function toIsoString(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseOpenReportIntakeRow(row: OpenReportIntakeRow): ReporterOpenReportIntake {
  const identityReview = projectReporterIdentityReview({
    status: row.status,
    metadata: row.metadata,
  });
  return {
    identityReview,
    statusLabel: reportIntakeStatusLabel(row.status, row.metadata),
    createdAt: toIsoString(row.created_at),
    guildId: row.server_id,
    id: row.id,
    status: row.status,
    threadId: row.thread_id,
    threadUrl: row.thread_id ? discordMessageUrl(row.server_id, row.thread_id) : null,
    updatedAt: toIsoString(row.updated_at),
  };
}

export class PostgresReportIntakePortalDataAdapter implements ReportIntakePortalDataAdapter {
  public async getOpenIntakeForReporter(input: {
    readonly guildId: string;
    readonly reporterId: string;
  }): Promise<ReporterOpenReportIntake | null> {
    const result = await getPostgresPool().query<OpenReportIntakeRow>(
      `select
         id::text,
         server_id,
         thread_id,
         status::text as status,
         metadata,
         created_at,
         updated_at
       from report_intakes
       where server_id = $1
         and reporter_id = $2
         and closed_at is null
         and metadata ->> 'thread_closed_at' is null
         and status in (
           'collecting_evidence',
           'needs_reporter_confirmation',
           'needs_admin_confirmation'
         )
       order by created_at desc nulls last
       limit 1`,
      [input.guildId, input.reporterId]
    );

    const row = result.rows[0];
    return row ? parseOpenReportIntakeRow(row) : null;
  }
}

export function createReportIntakePortalDataAdapter(): ReportIntakePortalDataAdapter {
  return new PostgresReportIntakePortalDataAdapter();
}

export async function loadReporterOpenIntake(
  context: ActionContext
): Promise<ReporterOpenReportIntake | null> {
  if (context.actor.kind !== 'user') return null;
  return createReportIntakePortalDataAdapter().getOpenIntakeForReporter({
    guildId: context.guildId,
    reporterId: context.actor.userId,
  });
}
