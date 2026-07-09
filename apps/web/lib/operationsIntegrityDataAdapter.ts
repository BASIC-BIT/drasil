import { fixtureTimestampIso, isWebE2eFixtureMode } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

const LOOKBACK_DAYS = 30;
const FINDING_LIMIT = 8;

export type OperationsIntegritySeverity = 'error' | 'warning' | 'info';

export interface OperationsIntegrityFinding {
  readonly severity: OperationsIntegritySeverity;
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly userId: string | null;
  readonly verificationEventId: string | null;
}

export interface OperationsIntegritySnapshot {
  readonly checkedAt: string;
  readonly lookbackDays: number;
  readonly candidateCounts: {
    readonly pendingCases: number;
    readonly recentResolvedCases: number;
    readonly caseRoleMembers: number;
    readonly activeRoleQuarantines: number;
    readonly queueItems: number;
  };
  readonly findingCounts: Record<OperationsIntegritySeverity, number>;
  readonly findings: readonly OperationsIntegrityFinding[];
  readonly liveDiscordChecksAvailableInDiscord: boolean;
}

export interface OperationsIntegrityDataAdapter {
  getSnapshot(guildId: string): Promise<OperationsIntegritySnapshot>;
}

interface IntegrityCountRow {
  readonly pending_cases: string | number | null;
  readonly recent_resolved_cases: string | number | null;
  readonly case_role_members: string | number | null;
  readonly active_role_quarantines: string | number | null;
  readonly queue_items: string | number | null;
}

interface IntegrityFindingRow {
  readonly severity: OperationsIntegritySeverity;
  readonly code: string;
  readonly subject: string;
  readonly detail: string;
  readonly user_id: string | null;
  readonly verification_event_id: string | null;
}

function toCount(value: string | number | null): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseInt(value, 10);
  }
  return 0;
}

function parseIntegrityFinding(row: IntegrityFindingRow): OperationsIntegrityFinding {
  return {
    severity: row.severity,
    code: row.code,
    subject: row.subject,
    detail: row.detail,
    userId: row.user_id,
    verificationEventId: row.verification_event_id,
  };
}

export function buildOperationsIntegritySnapshot(
  checkedAt: Date,
  countRow: IntegrityCountRow,
  findingRows: readonly IntegrityFindingRow[]
): OperationsIntegritySnapshot {
  const findings = findingRows.map(parseIntegrityFinding);
  return {
    checkedAt: checkedAt.toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    candidateCounts: {
      pendingCases: toCount(countRow.pending_cases),
      recentResolvedCases: toCount(countRow.recent_resolved_cases),
      caseRoleMembers: toCount(countRow.case_role_members),
      activeRoleQuarantines: toCount(countRow.active_role_quarantines),
      queueItems: toCount(countRow.queue_items),
    },
    findingCounts: {
      error: findings.filter((finding) => finding.severity === 'error').length,
      warning: findings.filter((finding) => finding.severity === 'warning').length,
      info: findings.filter((finding) => finding.severity === 'info').length,
    },
    findings,
    liveDiscordChecksAvailableInDiscord: true,
  };
}

export class PostgresOperationsIntegrityDataAdapter implements OperationsIntegrityDataAdapter {
  public async getSnapshot(guildId: string): Promise<OperationsIntegritySnapshot> {
    const pool = getPostgresPool();
    const [counts, findings] = await Promise.all([
      pool.query<IntegrityCountRow>(
        `with recent_resolved as (
           select id
           from verification_events
           where server_id = $1
             and status in (
               'verified'::verification_status,
               'banned'::verification_status,
               'kicked'::verification_status,
               'closed_no_action'::verification_status
             )
             and coalesce(resolved_at, updated_at, created_at) >= now() - ($2::text || ' days')::interval
         )
         select
           (select count(*) from verification_events where server_id = $1 and status = 'pending'::verification_status) as pending_cases,
           (select count(*) from recent_resolved) as recent_resolved_cases,
           (
             select count(*)
             from server_members
             where server_id = $1
               and case_role_active = true
               and verification_status <> 'banned'::verification_status
           ) as case_role_members,
           (
             select count(*)
             from role_quarantine_snapshots
             where server_id = $1
               and status = 'active'::role_quarantine_snapshot_status
           ) as active_role_quarantines,
           (
             select count(*)
             from moderation_queue_items
             where server_id = $1
               and item_type in (
                 'case_mirror'::moderation_queue_item_type,
                 'observed_alert_mirror'::moderation_queue_item_type,
                 'support_thread_attention'::moderation_queue_item_type,
                 'report_thread_attention'::moderation_queue_item_type,
                 'pending_screening_member'::moderation_queue_item_type
               )
           ) as queue_items`,
        [guildId, LOOKBACK_DAYS]
      ),
      pool.query<IntegrityFindingRow>(
        `with server_settings as (
           select settings->>'moderation_queue_channel_id' as queue_channel_id
           from servers
           where guild_id = $1
         ),
         findings as (
           select
             'warning' as severity,
             'pending_case_thread_missing' as code,
             'case ' || ve.id::text as subject,
             'Pending case does not have a stored user-facing thread ID.' as detail,
             ve.user_id,
             ve.id as verification_event_id,
             coalesce(ve.updated_at, ve.created_at) as sort_at,
             2 as severity_rank
           from verification_events ve
           where ve.server_id = $1
             and ve.status = 'pending'::verification_status
             and ve.thread_id is null
           union all
           select
             'warning' as severity,
             'pending_case_notification_pointer_missing' as code,
             'case ' || ve.id::text as subject,
             'Pending case does not have both notification channel and message IDs recorded.' as detail,
             ve.user_id,
             ve.id as verification_event_id,
             coalesce(ve.updated_at, ve.created_at) as sort_at,
             2 as severity_rank
           from verification_events ve
           where ve.server_id = $1
             and ve.status = 'pending'::verification_status
             and (ve.notification_channel_id is null or ve.notification_message_id is null)
           union all
           select
             'error' as severity,
             'resolved_case_missing_admin_action' as code,
             'case ' || ve.id::text as subject,
             'Resolved case has no matching durable admin action row.' as detail,
             ve.user_id,
             ve.id as verification_event_id,
             coalesce(ve.resolved_at, ve.updated_at, ve.created_at) as sort_at,
             1 as severity_rank
           from verification_events ve
           where ve.server_id = $1
             and ve.status in (
               'verified'::verification_status,
               'banned'::verification_status,
               'kicked'::verification_status,
               'closed_no_action'::verification_status
             )
             and coalesce(ve.resolved_at, ve.updated_at, ve.created_at) >= now() - ($2::text || ' days')::interval
             and coalesce(ve.metadata->>'moderation_outcome_source', '') not in ('native_discord', 'external_bot', 'unknown_external')
             and not exists (
               select 1
               from moderation_outcomes mo
               where mo.verification_event_id = ve.id
                 and mo.outcome_type = case ve.status
                   when 'verified'::verification_status then 'verified'::moderation_outcome_type
                   when 'banned'::verification_status then 'banned'::moderation_outcome_type
                   when 'kicked'::verification_status then 'kicked'::moderation_outcome_type
                   else 'closed_no_action'::moderation_outcome_type
                 end
                 and mo.source in (
                   'native_discord'::moderation_outcome_source,
                   'external_bot'::moderation_outcome_source,
                   'unknown_external'::moderation_outcome_source
                 )
             )
             and not exists (
               select 1
               from admin_actions aa
               where aa.verification_event_id = ve.id
                 and aa.action_type = case ve.status
                   when 'verified'::verification_status then 'verify'::admin_action_type
                   when 'banned'::verification_status then 'ban'::admin_action_type
                   when 'kicked'::verification_status then 'kick'::admin_action_type
                   else 'close_no_action'::admin_action_type
                 end
             )
           union all
           select
             'error' as severity,
             'resolved_case_missing_moderation_outcome' as code,
             'case ' || ve.id::text as subject,
             'Resolved case has no matching durable moderation outcome row.' as detail,
             ve.user_id,
             ve.id as verification_event_id,
             coalesce(ve.resolved_at, ve.updated_at, ve.created_at) as sort_at,
             1 as severity_rank
           from verification_events ve
           where ve.server_id = $1
             and ve.status in (
               'verified'::verification_status,
               'banned'::verification_status,
               'kicked'::verification_status,
               'closed_no_action'::verification_status
             )
             and coalesce(ve.resolved_at, ve.updated_at, ve.created_at) >= now() - ($2::text || ' days')::interval
             and not exists (
               select 1
               from moderation_outcomes mo
               where mo.verification_event_id = ve.id
                 and mo.outcome_type = case ve.status
                   when 'verified'::verification_status then 'verified'::moderation_outcome_type
                   when 'banned'::verification_status then 'banned'::moderation_outcome_type
                   when 'kicked'::verification_status then 'kicked'::moderation_outcome_type
                   else 'closed_no_action'::moderation_outcome_type
                 end
             )
           union all
           select
             'warning' as severity,
             'case_role_member_resolved_status' as code,
             'member ' || sm.user_id as subject,
             'Database marks this member as having the case role while verification_status is ' || coalesce(sm.verification_status::text, 'unset') || '.' as detail,
             sm.user_id,
             null::uuid as verification_event_id,
             sm.last_status_change as sort_at,
             2 as severity_rank
           from server_members sm
           where sm.server_id = $1
             and sm.case_role_active = true
             and sm.verification_status <> 'banned'::verification_status
             and sm.verification_status <> 'pending'::verification_status
           union all
           select
             'warning' as severity,
             'queue_item_wrong_channel' as code,
             'queue item ' || mqi.id::text as subject,
             'Queue item points at a channel other than the configured moderation queue channel.' as detail,
             mqi.user_id,
             mqi.verification_event_id,
             coalesce(mqi.updated_at, mqi.created_at) as sort_at,
             2 as severity_rank
           from moderation_queue_items mqi
           cross join server_settings ss
           where mqi.server_id = $1
             and ss.queue_channel_id is not null
             and mqi.queue_channel_id is not null
             and mqi.queue_channel_id <> ss.queue_channel_id
           union all
           select
             'warning' as severity,
             'queue_case_mirror_not_pending' as code,
             'queue item ' || mqi.id::text as subject,
             'Case mirror references a ' || coalesce(ve.status::text, 'missing') || ' verification event.' as detail,
             mqi.user_id,
             mqi.verification_event_id,
             coalesce(mqi.updated_at, mqi.created_at) as sort_at,
             2 as severity_rank
           from moderation_queue_items mqi
           left join verification_events ve on ve.id = mqi.verification_event_id
           where mqi.server_id = $1
             and mqi.item_type = 'case_mirror'::moderation_queue_item_type
             and coalesce(ve.status::text, 'missing') <> 'pending'
           union all
           select
             'warning' as severity,
             'queue_item_missing_message_pointer' as code,
             'queue item ' || mqi.id::text as subject,
             'Queue item does not have both queue_channel_id and queue_message_id recorded.' as detail,
             mqi.user_id,
             mqi.verification_event_id,
             coalesce(mqi.updated_at, mqi.created_at) as sort_at,
             2 as severity_rank
           from moderation_queue_items mqi
           where mqi.server_id = $1
             and (mqi.queue_channel_id is null or mqi.queue_message_id is null)
         )
         select
           severity,
           code,
           subject,
           detail,
           user_id,
           verification_event_id::text as verification_event_id
         from findings
         order by severity_rank asc, sort_at desc nulls last, code asc
         limit $3`,
        [guildId, LOOKBACK_DAYS, FINDING_LIMIT]
      ),
    ]);

    return buildOperationsIntegritySnapshot(
      new Date(),
      counts.rows[0] ?? {
        pending_cases: 0,
        recent_resolved_cases: 0,
        case_role_members: 0,
        active_role_quarantines: 0,
        queue_items: 0,
      },
      findings.rows
    );
  }
}

export class FixtureOperationsIntegrityDataAdapter implements OperationsIntegrityDataAdapter {
  public async getSnapshot(_guildId: string): Promise<OperationsIntegritySnapshot> {
    return buildOperationsIntegritySnapshot(
      new Date(fixtureTimestampIso),
      {
        pending_cases: 3,
        recent_resolved_cases: 2,
        case_role_members: 1,
        active_role_quarantines: 1,
        queue_items: 5,
      },
      [
        {
          severity: 'warning',
          code: 'pending_case_notification_pointer_missing',
          subject: 'case fixture-case-missing-notification',
          detail: 'Pending case does not have both notification channel and message IDs recorded.',
          user_id: 'user-200',
          verification_event_id: 'fixture-case-missing-notification',
        },
        {
          severity: 'warning',
          code: 'queue_case_mirror_not_pending',
          subject: 'queue item fixture-queue-resolved-case',
          detail: 'Case mirror references a verified verification event.',
          user_id: 'user-420',
          verification_event_id: 'fixture-case-resolved-verified',
        },
      ]
    );
  }
}

export function createOperationsIntegrityDataAdapter(): OperationsIntegrityDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureOperationsIntegrityDataAdapter();
  }

  return new PostgresOperationsIntegrityDataAdapter();
}
