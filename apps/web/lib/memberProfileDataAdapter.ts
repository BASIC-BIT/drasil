import {
  memberProfileSchema,
  type CasePresenceState,
  type CaseUserIdentity,
  type MemberProfile,
  type MemberProfileDetection,
  type MemberProfileDetectionAccounting,
  type MemberProfileOutcome,
  type MemberProfileReport,
  type ReportQueueStatus,
} from '@drasil/contracts';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { fixtureMemberProfile } from './memberProfileFixtures';
import { createActiveCaseDataAdapter } from './activeCaseDataAdapter';
import { getPostgresPool } from './setupDataAdapter';

export interface MemberProfileDataAdapter {
  getMemberProfile(guildId: string, userId: string): Promise<MemberProfile | null>;
}

interface MemberBaseRow {
  discord_id: string | null;
  username: string | null;
  metadata: unknown;
  join_date: unknown;
  last_message_at: unknown;
  message_count: number | null;
  verification_status: string | null;
  case_role_active: boolean | null;
  discord_member_pending: boolean | null;
}

interface MemberDetectionRow {
  id: string;
  detection_type: string;
  confidence: number;
  detected_at: unknown;
  reasons: string[] | null;
  latest_verification_event_id: string | null;
  metadata: unknown;
  admin_action: string | null;
  admin_action_at: unknown;
  admin_action_by: string | null;
  latest_accounting_action_type: string | null;
  latest_accounting_action_at: unknown;
  channel_id: string | null;
  message_id: string | null;
}

interface MemberReportRow {
  id: string;
  reporter_id: string;
  status: ReportQueueStatus;
  summary: string | null;
  created_at: unknown;
  updated_at: unknown;
  thread_id: string | null;
  latest_case_id: string | null;
}

interface MemberOutcomeRow {
  id: string;
  outcome_type: string;
  source: string;
  actor_id: string | null;
  reason: string | null;
  occurred_at: unknown;
  verification_event_id: string | null;
  detection_event_id: string | null;
}

const reviewedReportStatuses: readonly ReportQueueStatus[] = [
  'submitted',
  'actioned',
  'dismissed',
  'false_positive',
];
const accountingExcludedMetadataKey = 'excluded_from_accounting';
const accountingExclusionScopeMetadataKey = 'accounting_exclusion_scope';
const accountingExcludedByMetadataKey = 'accounting_excluded_by';
const accountingExcludedAtMetadataKey = 'accounting_excluded_at';
const accountingExclusionReasonMetadataKey = 'accounting_exclusion_reason';

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

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    const stringValue = readString(value);
    if (stringValue) {
      return stringValue;
    }
  }
  return null;
}

function identityFromBaseRow(
  userId: string,
  row: MemberBaseRow | null,
  fallback: CaseUserIdentity | null
): CaseUserIdentity {
  if (fallback) {
    return fallback;
  }

  const metadata = metadataToRecord(row?.metadata);
  const globalName = firstString(metadata.global_name, metadata.globalName);
  const displayName = firstString(metadata.display_name, metadata.displayName);
  const avatarUrl = firstString(metadata.avatar_url, metadata.avatarUrl);
  const username = firstString(row?.username, metadata.username);
  const displayLabel = firstString(displayName, globalName, username, userId) ?? userId;

  return {
    id: userId,
    username,
    globalName,
    nickname: firstString(metadata.nickname),
    displayName,
    avatarUrl,
    displayLabel,
  };
}

function resolvePresenceState(
  row: MemberBaseRow | null,
  cases: readonly { presenceState: CasePresenceState }[]
): CasePresenceState {
  const latestCasePresence = cases[0]?.presenceState;
  if (latestCasePresence) {
    return latestCasePresence;
  }
  if (row?.verification_status === 'banned') {
    return 'banned';
  }
  if (row?.verification_status === 'kicked') {
    return 'kicked';
  }
  if (row?.discord_id || row?.verification_status) {
    return 'in_server';
  }
  return 'unknown';
}

function parseAccountingStatus(row: MemberDetectionRow): MemberProfileDetectionAccounting {
  const metadata = metadataToRecord(row.metadata);

  if (row.latest_accounting_action_type === 'undo_observed_action') {
    return {
      excluded: false,
      excludedAt: null,
      excludedBy: null,
      reason: null,
      scope: null,
    };
  }

  if (row.latest_accounting_action_type === 'false_positive') {
    return {
      excluded: true,
      excludedAt:
        readString(metadata[accountingExcludedAtMetadataKey]) ??
        toNullableIsoString(row.latest_accounting_action_at),
      excludedBy: readString(metadata[accountingExcludedByMetadataKey]),
      reason: readString(metadata[accountingExclusionReasonMetadataKey]) ?? 'Marked false positive',
      scope: readString(metadata[accountingExclusionScopeMetadataKey]) ?? 'server',
    };
  }

  if (metadata[accountingExcludedMetadataKey] === true) {
    return {
      excluded: true,
      excludedAt: readString(metadata[accountingExcludedAtMetadataKey]),
      excludedBy: readString(metadata[accountingExcludedByMetadataKey]),
      reason: readString(metadata[accountingExclusionReasonMetadataKey]),
      scope: readString(metadata[accountingExclusionScopeMetadataKey]),
    };
  }

  if (metadata[accountingExcludedMetadataKey] === false) {
    return {
      excluded: false,
      excludedAt: null,
      excludedBy: null,
      reason: null,
      scope: null,
    };
  }

  if (metadata.observed_action === 'false_positive') {
    return {
      excluded: true,
      excludedAt: readString(metadata.observed_action_at),
      excludedBy: readString(metadata.observed_action_by),
      reason: 'Marked false positive',
      scope: 'server',
    };
  }

  return {
    excluded: false,
    excludedAt: null,
    excludedBy: null,
    reason: null,
    scope: null,
  };
}

function parseDetectionRow(guildId: string, row: MemberDetectionRow): MemberProfileDetection {
  const metadata = metadataToRecord(row.metadata);
  const rawObservedAction = row.admin_action ?? readString(metadata.observed_action);
  const observedAction =
    rawObservedAction === 'dismiss' || rawObservedAction === 'false_positive'
      ? rawObservedAction
      : null;
  const observedActionAt =
    toNullableIsoString(row.admin_action_at) ?? readString(metadata.observed_action_at);
  const observedActionBy = row.admin_action_by ?? readString(metadata.observed_action_by);
  return {
    id: row.id,
    detectionType: row.detection_type,
    confidence: row.confidence,
    detectedAt: toIsoString(row.detected_at),
    reasons: row.reasons ?? [],
    latestCaseId: row.latest_verification_event_id,
    accounting: parseAccountingStatus(row),
    observedAction,
    observedActionAt: observedAction ? observedActionAt : null,
    observedActionBy: observedAction ? observedActionBy : null,
    sourceChannelId: row.channel_id,
    sourceMessageId: row.message_id,
    sourceMessageUrl:
      row.channel_id && row.message_id
        ? discordMessageUrl(guildId, row.channel_id, row.message_id)
        : null,
  };
}

function parseReportRow(guildId: string, row: MemberReportRow): MemberProfileReport {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    status: row.status,
    summary: row.summary,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    reportThreadUrl: row.thread_id ? discordMessageUrl(guildId, row.thread_id) : null,
    latestCaseId: row.latest_case_id,
  };
}

function parseOutcomeRow(row: MemberOutcomeRow): MemberProfileOutcome {
  return {
    id: row.id,
    outcomeType: row.outcome_type,
    source: row.source,
    actorId: row.actor_id,
    reason: row.reason,
    occurredAt: toNullableIsoString(row.occurred_at),
    verificationEventId: row.verification_event_id,
    detectionEventId: row.detection_event_id,
  };
}

export class PostgresMemberProfileDataAdapter implements MemberProfileDataAdapter {
  public async getMemberProfile(guildId: string, userId: string): Promise<MemberProfile | null> {
    const activeCaseAdapter = createActiveCaseDataAdapter();
    const [baseResult, cases, detectionResult, reportResult, outcomeResult] = await Promise.all([
      getPostgresPool().query<MemberBaseRow>(
        `select
           u.discord_id,
           u.username,
           u.metadata,
           sm.join_date,
           sm.last_message_at,
           sm.message_count,
           sm.verification_status,
           sm.case_role_active,
           sm.discord_member_pending
         from (select $2::text as user_id) target
         left join users u on u.discord_id = target.user_id
         left join server_members sm on sm.server_id = $1 and sm.user_id = target.user_id
         where u.discord_id is not null or sm.user_id is not null
         limit 1`,
        [guildId, userId]
      ),
      activeCaseAdapter.listCasesForMember(guildId, userId),
      getPostgresPool().query<MemberDetectionRow>(
        `select
           de.id,
           de.detection_type,
           de.confidence,
           de.detected_at,
           de.reasons,
           de.latest_verification_event_id,
           de.metadata,
           de.admin_action,
           de.admin_action_at,
           de.admin_action_by,
           accounting.action_type as latest_accounting_action_type,
           accounting.action_at as latest_accounting_action_at,
           de.channel_id,
           de.message_id
         from detection_events de
         left join lateral (
           select action_type::text, action_at
           from admin_actions
           where detection_event_id = de.id
             and action_type in ('false_positive', 'undo_observed_action')
           order by action_at desc nulls last
           limit 1
         ) accounting on true
         where de.server_id = $1 and de.user_id = $2
         order by de.detected_at desc nulls last
         limit 50`,
        [guildId, userId]
      ),
      getPostgresPool().query<MemberReportRow>(
        `select
           ri.id,
           ri.reporter_id,
           ri.status,
           ri.summary,
           ri.created_at,
           ri.updated_at,
           ri.thread_id,
           de.latest_verification_event_id as latest_case_id
         from report_intakes ri
         left join lateral (
           select latest_verification_event_id
           from detection_events
           where server_id = ri.server_id
             and metadata ->> 'reportIntakeId' = ri.id::text
           order by detected_at desc nulls last
           limit 1
         ) de on true
         where ri.server_id = $1
           and ri.confirmed_target_user_id = $2
           and ri.status = any($3::report_intake_status[])
         order by ri.updated_at desc nulls last
         limit 25`,
        [guildId, userId, reviewedReportStatuses]
      ),
      getPostgresPool().query<MemberOutcomeRow>(
        `select id, outcome_type, source, actor_id, reason, occurred_at,
                verification_event_id, detection_event_id
         from moderation_outcomes
         where server_id = $1 and user_id = $2
         order by occurred_at desc nulls last
         limit 50`,
        [guildId, userId]
      ),
    ]);

    const base = baseResult.rows[0] ?? null;
    if (
      !base &&
      cases.length === 0 &&
      detectionResult.rows.length === 0 &&
      reportResult.rows.length === 0 &&
      outcomeResult.rows.length === 0
    ) {
      return null;
    }

    return memberProfileSchema.parse({
      guildId,
      userId,
      identity: identityFromBaseRow(userId, base, cases[0]?.userIdentity ?? null),
      presenceState: resolvePresenceState(base, cases),
      membership: {
        joinDate: toNullableIsoString(base?.join_date),
        lastMessageAt: toNullableIsoString(base?.last_message_at),
        messageCount: base?.message_count ?? null,
        verificationStatus: base?.verification_status ?? null,
        caseRoleActive: base?.case_role_active ?? null,
        screeningPending: base?.discord_member_pending ?? null,
      },
      cases,
      detections: detectionResult.rows.map((row) => parseDetectionRow(guildId, row)),
      reports: reportResult.rows.map((row) => parseReportRow(guildId, row)),
      outcomes: outcomeResult.rows.map(parseOutcomeRow),
    });
  }
}

export class FixtureMemberProfileDataAdapter implements MemberProfileDataAdapter {
  public async getMemberProfile(guildId: string, userId: string): Promise<MemberProfile | null> {
    return fixtureMemberProfile(guildId, userId);
  }
}

export function createMemberProfileDataAdapter(): MemberProfileDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureMemberProfileDataAdapter();
  }

  return new PostgresMemberProfileDataAdapter();
}
