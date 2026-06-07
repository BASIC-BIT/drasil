import {
  caseDetailSchema,
  caseSummarySchema,
  sortCaseSummariesForQueue,
  type CaseAction,
  type CaseDetail,
  type CaseDetectionHistoryItem,
  type CaseModerationOutcome,
  type CasePresenceState,
  type CaseSummary,
  type CaseSurfaceLink,
} from '@drasil/contracts';
import {
  fixtureActiveCaseDetail,
  fixtureActiveCaseSummaries,
  isWebE2eFixtureMode,
} from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface ActiveCaseDataAdapter {
  listActiveCases(guildId: string): Promise<CaseSummary[]>;
  getCaseDetail(guildId: string, caseId: string): Promise<CaseDetail | null>;
}

interface CaseSummaryRow {
  id: string;
  server_id: string;
  user_id: string;
  detection_event_id: string | null;
  thread_id: string | null;
  private_evidence_thread_id: string | null;
  notification_message_id: string | null;
  status: string;
  created_at: unknown;
  updated_at: unknown;
  notes: string | null;
  metadata: unknown;
  admin_channel_id: string | null;
  latest_detection_type: string | null;
  latest_confidence: number | null;
  latest_detection_at: unknown;
  source_channel_id: string | null;
  source_message_id: string | null;
  last_action_type: string | null;
  last_action_at: unknown;
  latest_outcome_type: string | null;
  latest_outcome_source: string | null;
}

interface DetectionHistoryRow {
  id: string;
  detection_type: string;
  confidence: number;
  detected_at: unknown;
  reasons: string[] | null;
}

interface ModerationOutcomeRow {
  id: string;
  outcome_type: string;
  source: string;
  actor_id: string | null;
  reason: string | null;
  occurred_at: unknown;
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

function toNullableIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  return toIsoString(value);
}

function metadataToRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function discordMessageUrl(guildId: string, channelId: string, messageId?: string | null): string {
  return ['https://discord.com/channels', guildId, channelId, messageId]
    .filter((part): part is string => Boolean(part))
    .join('/');
}

function pushSurface(surfaces: CaseSurfaceLink[], surface: CaseSurfaceLink | null): void {
  if (surface) {
    surfaces.push(surface);
  }
}

function buildSurfaces(row: CaseSummaryRow): CaseSurfaceLink[] {
  const metadata = metadataToRecord(row.metadata);
  const surfaces: CaseSurfaceLink[] = [];

  pushSurface(
    surfaces,
    row.admin_channel_id && row.notification_message_id
      ? {
          kind: 'admin_notification',
          label: 'Admin notification',
          url: discordMessageUrl(row.server_id, row.admin_channel_id, row.notification_message_id),
        }
      : null
  );
  pushSurface(
    surfaces,
    row.private_evidence_thread_id
      ? {
          kind: 'admin_evidence_thread',
          label: 'Admin evidence',
          url: discordMessageUrl(row.server_id, row.private_evidence_thread_id),
        }
      : null
  );
  pushSurface(
    surfaces,
    row.thread_id
      ? {
          kind: 'verification_thread',
          label: 'Verification thread',
          url: discordMessageUrl(row.server_id, row.thread_id),
        }
      : null
  );

  const reportIntakeThreadId = readString(metadata.report_intake_thread_id);
  pushSurface(
    surfaces,
    reportIntakeThreadId
      ? {
          kind: 'report_intake_thread',
          label: 'Report intake',
          url: discordMessageUrl(row.server_id, reportIntakeThreadId),
        }
      : null
  );

  const sourceChannelId = readString(metadata.source_channel_id) ?? row.source_channel_id;
  const sourceMessageId = readString(metadata.source_message_id) ?? row.source_message_id;
  pushSurface(
    surfaces,
    sourceChannelId && sourceMessageId
      ? {
          kind: 'source_message',
          label: 'Source message',
          url: discordMessageUrl(row.server_id, sourceChannelId, sourceMessageId),
        }
      : null
  );

  return surfaces;
}

function resolvePresenceState(row: CaseSummaryRow): CasePresenceState {
  const metadata = metadataToRecord(row.metadata);
  if (row.latest_outcome_type === 'banned') {
    return 'banned';
  }
  if (
    row.latest_outcome_type === 'member_left' ||
    metadata.membership_state === 'left_or_removed'
  ) {
    return 'left_or_removed';
  }
  return 'in_server';
}

function resolveAllowedActions(
  row: CaseSummaryRow,
  presenceState: CasePresenceState
): CaseAction[] {
  if (presenceState === 'banned') {
    return ['view_history', 'sync_existing_ban'];
  }
  if (presenceState === 'left_or_removed') {
    return ['view_history', 'ban_by_id', 'close_no_action'];
  }

  const actions: CaseAction[] = ['view_history', 'verify_user', 'ban_user', 'repair_thread'];
  if (!row.thread_id) {
    actions.push('create_thread');
  }
  return actions;
}

export function parseCaseSummaryRow(row: CaseSummaryRow, now = new Date()): CaseSummary {
  const updatedAt = new Date(toIsoString(row.updated_at));
  const staleHours = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 3_600_000));
  const presenceState = resolvePresenceState(row);

  return caseSummarySchema.parse({
    id: row.id,
    guildId: row.server_id,
    userId: row.user_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: updatedAt.toISOString(),
    stale: staleHours >= DEFAULT_STALE_HOURS,
    staleHours,
    presenceState,
    confidence: row.latest_confidence,
    latestDetectionType: row.latest_detection_type,
    latestDetectionAt: toNullableIsoString(row.latest_detection_at),
    lastActionType: row.last_action_type,
    lastActionAt: toNullableIsoString(row.last_action_at),
    surfaces: buildSurfaces(row),
    allowedActions: resolveAllowedActions(row, presenceState),
  });
}

function parseDetectionHistoryRow(row: DetectionHistoryRow): CaseDetectionHistoryItem {
  return {
    id: row.id,
    detectionType: row.detection_type,
    confidence: row.confidence,
    detectedAt: toIsoString(row.detected_at),
    reasons: row.reasons ?? [],
  };
}

function parseModerationOutcomeRow(row: ModerationOutcomeRow): CaseModerationOutcome {
  return {
    id: row.id,
    outcomeType: row.outcome_type,
    source: row.source,
    actorId: row.actor_id,
    reason: row.reason,
    occurredAt: toNullableIsoString(row.occurred_at),
  };
}

const SUMMARY_QUERY = `
  select
    ve.id,
    ve.server_id,
    ve.user_id,
    ve.detection_event_id,
    ve.thread_id,
    ve.private_evidence_thread_id,
    ve.notification_message_id,
    ve.status,
    ve.created_at,
    ve.updated_at,
    ve.notes,
    ve.metadata,
    s.admin_channel_id,
    de.detection_type as latest_detection_type,
    de.confidence as latest_confidence,
    de.detected_at as latest_detection_at,
    de.channel_id as source_channel_id,
    de.message_id as source_message_id,
    aa.action_type as last_action_type,
    aa.action_at as last_action_at,
    mo.outcome_type as latest_outcome_type,
    mo.source as latest_outcome_source
  from verification_events ve
  join servers s on s.guild_id = ve.server_id
  left join detection_events de on de.id = ve.detection_event_id
  left join lateral (
    select action_type, action_at
    from admin_actions
    where verification_event_id = ve.id
    order by action_at desc nulls last
    limit 1
  ) aa on true
  left join lateral (
    select outcome_type, source
    from moderation_outcomes
    where verification_event_id = ve.id
    order by occurred_at desc nulls last
    limit 1
  ) mo on true
`;

export class PostgresActiveCaseDataAdapter implements ActiveCaseDataAdapter {
  public async listActiveCases(guildId: string): Promise<CaseSummary[]> {
    const result = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1 and ve.status = 'pending' and ve.user_id is not null
       order by ve.updated_at asc`,
      [guildId]
    );
    return sortCaseSummariesForQueue(result.rows.map((row) => parseCaseSummaryRow(row)));
  }

  public async getCaseDetail(guildId: string, caseId: string): Promise<CaseDetail | null> {
    const summaryResult = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1 and ve.id = $2 and ve.user_id is not null
       limit 1`,
      [guildId, caseId]
    );
    const row = summaryResult.rows[0];
    if (!row) {
      return null;
    }

    const [detectionHistoryResult, outcomesResult] = await Promise.all([
      getPostgresPool().query<DetectionHistoryRow>(
        `select id, detection_type, confidence, detected_at, reasons
         from detection_events
         where server_id = $1 and user_id = $2
         order by detected_at desc nulls last
         limit 25`,
        [guildId, row.user_id]
      ),
      getPostgresPool().query<ModerationOutcomeRow>(
        `select id, outcome_type, source, actor_id, reason, occurred_at
         from moderation_outcomes
         where server_id = $1 and user_id = $2
         order by occurred_at desc nulls last
         limit 25`,
        [guildId, row.user_id]
      ),
    ]);

    return caseDetailSchema.parse({
      ...parseCaseSummaryRow(row),
      notes: row.notes,
      detectionHistory: detectionHistoryResult.rows.map(parseDetectionHistoryRow),
      moderationOutcomes: outcomesResult.rows.map(parseModerationOutcomeRow),
    });
  }
}

export class FixtureActiveCaseDataAdapter implements ActiveCaseDataAdapter {
  public async listActiveCases(): Promise<CaseSummary[]> {
    return sortCaseSummariesForQueue(fixtureActiveCaseSummaries());
  }

  public async getCaseDetail(_guildId: string, caseId: string): Promise<CaseDetail | null> {
    return fixtureActiveCaseDetail(caseId);
  }
}

export function createActiveCaseDataAdapter(): ActiveCaseDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureActiveCaseDataAdapter();
  }

  return new PostgresActiveCaseDataAdapter();
}
