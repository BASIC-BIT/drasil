import {
  reportQueueItemSchema,
  sortReportQueueItems,
  type ReportQueueAction,
  type ReportQueueItem,
  type ReportQueueStatus,
} from '@drasil/contracts';
import type { QueueAttentionItemRecord } from '../../../src/services/QueueAttentionService';
import {
  ReportReviewService,
  type ReportCaseOpener,
  type ReportClosureAction,
  type OpenSubmittedReportCaseResult,
  type ReportOpenCaseCandidate,
  type ReportOpenCaseRepository,
  type ReportReviewClosureStatus,
  type ReportReviewQueueRepository,
  type ReportReviewRecord,
  type ReportReviewRepository,
} from '../../../src/services/ReportReviewService';
import { deleteBotMessage } from './discordApi';
import { fixtureSubmittedReports } from './reportFixtures';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { queueModerationActionRequest } from './moderationActionRequestQueue';
import { getPostgresPool } from './setupDataAdapter';

export type { ReportClosureAction } from '../../../src/services/ReportReviewService';

export interface ReportQueueDataAdapter {
  listSubmittedReports(guildId: string): Promise<ReportQueueItem[]>;
  countClosedReports(guildId: string): Promise<number>;
  canOpenSubmittedReportCase(): boolean;
  closeSubmittedReport(input: {
    guildId: string;
    reportId: string;
    action: ReportClosureAction;
    adminId: string;
  }): Promise<boolean>;
  openCaseFromSubmittedReport(input: {
    guildId: string;
    reportId: string;
    adminId: string;
  }): Promise<OpenSubmittedReportCaseResult>;
}

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
  if (!row.latest_case_id && row.confirmed_target_user_id && row.latest_detection_id) {
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

class PostgresReportReviewRepository implements ReportReviewRepository {
  public async closeSubmittedReport(input: {
    reportId: string;
    serverId: string;
    status: ReportReviewClosureStatus;
    closedAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<ReportReviewRecord | null> {
    const result = await getPostgresPool().query<ReportReviewRecord>(
      `update report_intakes
       set status = $3,
           closed_at = $4,
           updated_at = $4,
           metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb
       where id = $1 and server_id = $2 and status = 'submitted'
       returning id, server_id, thread_id, status`,
      [input.reportId, input.serverId, input.status, input.closedAt, JSON.stringify(input.metadata)]
    );
    return result.rows[0] ?? null;
  }
}

class PostgresReportReviewQueueRepository implements ReportReviewQueueRepository {
  public async deleteReportThreadAttention(
    reportIntakeId: string
  ): Promise<QueueAttentionItemRecord[]> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `delete from moderation_queue_items
       where report_intake_id = $1 and item_type = 'report_thread_attention'
       returning id, server_id, item_type, queue_channel_id, queue_message_id`,
      [reportIntakeId]
    );
    return result.rows;
  }
}

class PostgresReportOpenCaseRepository implements ReportOpenCaseRepository {
  public async findSubmittedReportCaseCandidate(input: {
    reportId: string;
    serverId: string;
  }): Promise<ReportOpenCaseCandidate | null> {
    const result = await getPostgresPool().query<ReportOpenCaseCandidate>(
      `select
         ri.id,
         ri.server_id,
         ri.status,
         ri.confirmed_target_user_id,
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
       where ri.id = $1 and ri.server_id = $2 and ri.status = 'submitted'
       limit 1`,
      [input.reportId, input.serverId]
    );
    return result.rows[0] ?? null;
  }
}

class PostgresQueuedReportCaseOpener implements ReportCaseOpener {
  public async openObservedDetectionCase(input: {
    actor: { id: string; surface: string };
    detectionEventId: string;
    reportId?: string;
    serverId: string;
    userId: string;
  }): Promise<{ status: 'queued' | 'already_handled' }> {
    const status = await queueModerationActionRequest({
      actionType: 'open_case_from_observed_detection',
      actorId: input.actor.id,
      actorSurface: input.actor.surface,
      detectionEventId: input.detectionEventId,
      idempotencyKey: `web:report-open-case:${input.serverId}:${input.reportId ?? 'no-report'}:${input.detectionEventId}`,
      metadata: {
        requested_surface: input.actor.surface,
        report_intake_id: input.reportId ?? null,
      },
      reportIntakeId: input.reportId ?? null,
      serverId: input.serverId,
      targetUserId: input.userId,
    });
    return { status: status === 'completed' ? 'already_handled' : 'queued' };
  }
}

function createPostgresReportReviewService(): ReportReviewService {
  return new ReportReviewService(
    new PostgresReportReviewRepository(),
    new PostgresReportReviewQueueRepository(),
    {
      deleteQueueMessage: async (item) => {
        if (!item.queue_channel_id || !item.queue_message_id) {
          return;
        }

        await deleteBotMessage(item.queue_channel_id, item.queue_message_id);
      },
    },
    new PostgresReportOpenCaseRepository(),
    new PostgresQueuedReportCaseOpener()
  );
}

export class PostgresReportQueueDataAdapter implements ReportQueueDataAdapter {
  public constructor(
    private readonly reportReviewService: Pick<
      ReportReviewService,
      'canOpenSubmittedReportCase' | 'closeSubmittedReport' | 'openCaseFromSubmittedReport'
    > = createPostgresReportReviewService()
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

  public canOpenSubmittedReportCase(): boolean {
    return this.reportReviewService.canOpenSubmittedReportCase();
  }

  public async closeSubmittedReport(input: {
    guildId: string;
    reportId: string;
    action: ReportClosureAction;
    adminId: string;
  }): Promise<boolean> {
    const result = await this.reportReviewService.closeSubmittedReport({
      actor: { id: input.adminId, surface: 'web' },
      action: input.action,
      reportId: input.reportId,
      serverId: input.guildId,
    });
    return result.status === 'closed';
  }

  public async openCaseFromSubmittedReport(input: {
    guildId: string;
    reportId: string;
    adminId: string;
  }): Promise<OpenSubmittedReportCaseResult> {
    return this.reportReviewService.openCaseFromSubmittedReport({
      actor: { id: input.adminId, surface: 'web' },
      reportId: input.reportId,
      serverId: input.guildId,
    });
  }
}

export class FixtureReportQueueDataAdapter implements ReportQueueDataAdapter {
  public async listSubmittedReports(): Promise<ReportQueueItem[]> {
    return sortReportQueueItems(fixtureSubmittedReports());
  }

  public async countClosedReports(): Promise<number> {
    return 4;
  }

  public canOpenSubmittedReportCase(): boolean {
    return true;
  }

  public async closeSubmittedReport(): Promise<boolean> {
    return true;
  }

  public async openCaseFromSubmittedReport(input: {
    guildId: string;
    reportId: string;
    adminId: string;
  }): Promise<OpenSubmittedReportCaseResult> {
    const report = fixtureSubmittedReports().find((item) => item.id === input.reportId);
    return {
      actor: { id: input.adminId, surface: 'web' },
      action: 'open_case',
      caseId: report?.latestCaseId ?? `fixture-case-${input.reportId}`,
      detectionEventId: report?.latestDetectionId ?? null,
      reportId: input.reportId,
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
