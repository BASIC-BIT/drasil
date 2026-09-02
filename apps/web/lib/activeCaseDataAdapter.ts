import {
  caseDetailSchema,
  caseSummarySchema,
  sortCaseSummariesForQueue,
  type CaseAction,
  type CaseDetail,
  type CaseDetectionHistoryItem,
  type CaseEvidenceItem,
  type CaseMessageContextItem,
  type CaseModerationOutcome,
  type CasePresenceState,
  type CaseSummary,
  type CaseSurfaceLink,
  type CaseUserIdentity,
} from '@drasil/contracts';
import { z } from 'zod';
import {
  fixtureActiveCaseDetail,
  fixtureActiveCaseSummaries,
  fixtureParkedActiveCaseSummaries,
  fixtureResolvedCaseCount,
  fixtureResolvedCaseSummariesForHistory,
  isWebE2eFixtureMode,
} from './e2eFixtures';
import { discordDesktopUrl, discordMessageUrl } from './discordUrls';
import { getPostgresPool } from './setupDataAdapter';
import {
  queueModerationActionRequestWithReceipt,
  type ModerationActionRequestActionType,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export type WebCaseAction = Extract<
  CaseAction,
  | 'verify_user'
  | 'quarantine_compromised_account'
  | 'kick_user'
  | 'ban_user'
  | 'ban_by_id'
  | 'close_no_action'
  | 'repair_thread'
  | 'create_thread'
  | 'sync_existing_ban'
  | 'refresh_notification'
  | 'reopen_case'
  | 'challenge_user'
  | 'retry_captcha'
  | 'bypass_captcha'
>;

export type CaseActionQueueStatus =
  | 'queued'
  | 'already_handled'
  | 'case_not_found'
  | 'not_allowed'
  | 'failed';

export interface CaseActionQueueResult {
  readonly action: WebCaseAction;
  readonly caseId: string;
  readonly requestId: string | null;
  readonly status: CaseActionQueueStatus;
}

export interface QueueCaseActionInput {
  readonly action: WebCaseAction;
  readonly adminId: string;
  readonly attemptId?: string | null;
  readonly caseId: string;
  readonly expectedCaptchaChallengeId?: string | null;
  readonly expectedCaptchaGeneration?: number | null;
  readonly guildId: string;
  readonly quarantinePhase?: 'preview' | 'execute' | null;
  readonly previewRequestId?: string | null;
  readonly reason?: string | null;
}

export interface ActiveCaseDataAdapter {
  canQueueCaseActions(): boolean;
  listActiveCases(guildId: string): Promise<CaseSummary[]>;
  listParkedCases(guildId: string): Promise<CaseSummary[]>;
  listResolvedCases(guildId: string, limit?: number): Promise<CaseSummary[]>;
  listCasesForMember(guildId: string, userId: string, limit?: number): Promise<CaseSummary[]>;
  countResolvedCases(guildId: string): Promise<number>;
  getCaseDetail(guildId: string, caseId: string): Promise<CaseDetail | null>;
  queueCaseAction(input: QueueCaseActionInput): Promise<CaseActionQueueResult>;
}

export function resolveCaseActionQueueStatus(
  status: ModerationActionRequestQueueStatus
): CaseActionQueueStatus {
  if (status === 'completed') {
    return 'already_handled';
  }
  return status === 'failed' ? 'failed' : 'queued';
}

interface CaseSummaryRow {
  id: string;
  server_id: string;
  user_id: string;
  detection_event_id: string | null;
  thread_id: string | null;
  private_evidence_thread_id: string | null;
  notification_channel_id: string | null;
  notification_message_id: string | null;
  status: string;
  case_kind?: 'standard' | 'compromised_account';
  attention_state?: 'review_required' | 'parked';
  containment_status?: 'not_applicable' | 'in_progress' | 'contained' | 'incomplete';
  parked_at?: unknown;
  parked_by?: string | null;
  created_at: unknown;
  updated_at: unknown;
  notes: string | null;
  metadata: unknown;
  admin_channel_id: string | null;
  server_settings?: unknown;
  latest_detection_type: string | null;
  latest_confidence: number | null;
  latest_detection_at: unknown;
  latest_detection_metadata: unknown;
  opening_detection_metadata?: unknown;
  source_channel_id: string | null;
  source_message_id: string | null;
  last_action_type: string | null;
  last_action_at: unknown;
  latest_outcome_type: string | null;
  latest_outcome_source: string | null;
  user_username: string | null;
  user_metadata: unknown;
  member_user_id: string | null;
  captcha_id?: string | null;
  captcha_status?: 'pending' | 'passed' | 'failed' | 'expired' | 'bypassed' | 'cancelled' | null;
  captcha_request_source?: 'moderator' | 'automatic_suspicious_join' | null;
  captcha_pass_effect?: 'evidence_only' | 'verify_join_only' | null;
  captcha_generation?: number | null;
  captcha_submission_count?: number | null;
  captcha_expires_at?: unknown;
  captcha_requested_at?: unknown;
  captcha_delivered_at?: unknown;
  captcha_delivery_error_code?: string | null;
  captcha_passed_at?: unknown;
  captcha_bypassed_at?: unknown;
  captcha_bypassed_by?: string | null;
  captcha_bypass_reason?: string | null;
  captcha_history?: unknown;
}

interface DetectionHistoryRow {
  id: string;
  detection_type: string;
  confidence: number;
  detected_at: unknown;
  reasons: string[] | null;
}

interface CaseEvidenceRow {
  id: string;
  kind: string;
  source_message_id: string | null;
  source_channel_id: string | null;
  content: string | null;
  metadata: unknown;
  created_at: unknown;
}

interface MessageContextRow {
  id: string;
  message_id: string;
  channel_id: string | null;
  content_preview: string;
  created_at: unknown;
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

type CaseSurfaceKind = CaseSurfaceLink['kind'];

interface DiscordSurfaceInput {
  readonly kind: CaseSurfaceKind;
  readonly label: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId?: string | null;
}

const ACTIONS_BY_PRESENCE_STATE: Partial<Record<CasePresenceState, CaseAction[]>> = {
  banned: ['view_history', 'sync_existing_ban'],
  kicked: ['view_history'],
  left_or_removed: ['view_history', 'ban_by_id', 'close_no_action'],
  unknown: ['view_history', 'ban_by_id', 'close_no_action'],
};

const PENDING_IN_SERVER_ACTIONS = [
  ['view_history', 'verify_user', 'kick_user', 'ban_user', 'close_no_action'],
  ['view_history', 'verify_user', 'kick_user', 'ban_user'],
] as const satisfies readonly (readonly CaseAction[])[];

const ACCOUNT_QUARANTINE_ACTIONS_BY_STATE = [
  [[], ['quarantine_compromised_account']],
  [[], []],
] as const satisfies readonly (readonly (readonly CaseAction[])[])[];

const THREAD_REPAIR_ACTIONS_BY_STATE = [
  [['create_thread'], ['repair_thread']],
  [[], []],
] as const satisfies readonly (readonly (readonly CaseAction[])[])[];

const uuidSchema = z.string().uuid();

const requestTypeByCaseAction: Record<WebCaseAction, ModerationActionRequestActionType> = {
  ban_by_id: 'ban_case_user_by_id',
  ban_user: 'ban_case_user',
  close_no_action: 'close_case_no_action',
  create_thread: 'repair_active_case',
  kick_user: 'kick_case_user',
  repair_thread: 'repair_active_case',
  refresh_notification: 'refresh_case_notification',
  reopen_case: 'reopen_case',
  sync_existing_ban: 'sync_existing_ban',
  verify_user: 'verify_case_user',
  quarantine_compromised_account: 'quarantine_compromised_account',
  challenge_user: 'request_captcha_challenge',
  retry_captcha: 'retry_captcha_challenge',
  bypass_captcha: 'bypass_captcha_challenge',
};

function resolveCaseActionRequestType(
  input: QueueCaseActionInput
): ModerationActionRequestActionType {
  if (input.action === 'quarantine_compromised_account' && input.quarantinePhase === 'preview') {
    return 'preview_account_quarantine';
  }
  return requestTypeByCaseAction[input.action];
}

export function buildCaseActionIdempotencyKey(input: QueueCaseActionInput): string {
  const base = `web:case-action:${input.action}:${input.guildId}:${input.caseId}`;
  if (input.action === 'retry_captcha' || input.action === 'bypass_captcha') {
    if (!input.attemptId) {
      throw new Error('A unique attempt ID is required for repeatable CAPTCHA actions.');
    }
    return `${base}:${input.attemptId}`;
  }
  if (input.action !== 'quarantine_compromised_account') {
    return base;
  }
  if (input.quarantinePhase === 'preview') {
    return `${base}:preview:${input.attemptId ?? 'missing-attempt'}`;
  }
  return `${base}:execute:${input.previewRequestId ?? 'missing-preview'}`;
}

function sortCaseSummariesForHistory(cases: readonly CaseSummary[]): CaseSummary[] {
  return [...cases].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

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

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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

function firstUrlString(...values: Array<unknown>): string | null {
  const value = firstString(...values);
  if (!value) {
    return null;
  }

  try {
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

function readNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return metadataToRecord(record[key]);
}

function createDiscordSurface(input: DiscordSurfaceInput): CaseSurfaceLink {
  const { kind, label, guildId, channelId, messageId = null } = input;
  const url = discordMessageUrl(guildId, channelId, messageId);
  const desktopUrl = discordDesktopUrl(guildId, channelId, messageId);

  return {
    kind,
    label,
    url,
    desktopUrl,
  };
}

function resolveUserIdentity(row: CaseSummaryRow): CaseUserIdentity {
  const metadata = metadataToRecord(row.metadata);
  const userMetadata = metadataToRecord(row.user_metadata);
  const snapshot = readNestedRecord(metadata, 'user_snapshot');
  const username = firstString(snapshot.username, userMetadata.username, row.user_username);
  const globalName = firstString(
    snapshot.global_name,
    snapshot.globalName,
    userMetadata.global_name,
    userMetadata.globalName
  );
  const nickname = firstString(snapshot.nickname, userMetadata.nickname);
  const displayName = firstString(
    snapshot.display_name,
    snapshot.displayName,
    snapshot.server_display_name,
    snapshot.serverDisplayName,
    nickname
  );
  const avatarUrl = firstUrlString(
    snapshot.avatar_url,
    snapshot.avatarUrl,
    userMetadata.avatar_url,
    userMetadata.avatarUrl
  );
  const displayLabel = firstString(
    displayName,
    nickname,
    globalName,
    username,
    snapshot.tag,
    row.user_id
  );

  return {
    id: row.user_id,
    username,
    globalName,
    nickname,
    displayName,
    avatarUrl,
    displayLabel: displayLabel ?? row.user_id,
  };
}

function createChannelSurface(
  kind: CaseSurfaceKind,
  label: string,
  guildId: string,
  channelId: string | null
): CaseSurfaceLink | null {
  return channelId ? createDiscordSurface({ kind, label, guildId, channelId }) : null;
}

function createMessageSurface(
  kind: CaseSurfaceKind,
  label: string,
  guildId: string,
  channelId: string | null,
  messageId: string | null
): CaseSurfaceLink | null {
  return channelId && messageId
    ? createDiscordSurface({ kind, label, guildId, channelId, messageId })
    : null;
}

function buildSurfaces(row: CaseSummaryRow): CaseSurfaceLink[] {
  const metadata = metadataToRecord(row.metadata);
  const notificationChannelId = row.notification_channel_id ?? row.admin_channel_id;
  const reportIntakeThreadId = readString(metadata.report_intake_thread_id);
  const sourceChannelId = readString(metadata.source_channel_id) ?? row.source_channel_id;
  const sourceMessageId = readString(metadata.source_message_id) ?? row.source_message_id;
  const surfaces = [
    createMessageSurface(
      'admin_notification',
      'Admin notification',
      row.server_id,
      notificationChannelId,
      row.notification_message_id
    ),
    createChannelSurface(
      'admin_evidence_thread',
      'Admin evidence',
      row.server_id,
      row.private_evidence_thread_id
    ),
    createChannelSurface(
      'verification_thread',
      'Verification thread',
      row.server_id,
      row.thread_id
    ),
    createChannelSurface(
      'report_intake_thread',
      'Report intake',
      row.server_id,
      reportIntakeThreadId
    ),
    createMessageSurface(
      'source_message',
      'Source message',
      row.server_id,
      sourceChannelId,
      sourceMessageId
    ),
  ];
  return surfaces.filter((surface): surface is CaseSurfaceLink => surface !== null);
}

function resolvePresenceState(row: CaseSummaryRow): CasePresenceState {
  const metadata = metadataToRecord(row.metadata);
  if (row.latest_outcome_type === 'banned') {
    return 'banned';
  }
  if (row.latest_outcome_type === 'kicked') {
    return 'kicked';
  }
  if (
    row.latest_outcome_type === 'member_left' ||
    metadata.membership_state === 'left_or_removed'
  ) {
    return 'left_or_removed';
  }
  if (!row.member_user_id) {
    return 'unknown';
  }
  return 'in_server';
}

function resolveAllowedActions(
  row: CaseSummaryRow,
  presenceState: CasePresenceState
): CaseAction[] {
  if (row.status !== 'pending') {
    const actions: CaseAction[] =
      presenceState === 'in_server' ? ['view_history', 'reopen_case'] : ['view_history'];
    return appendCaptchaActions(row, appendRefreshNotificationAction(row, actions), presenceState);
  }

  if (row.attention_state === 'parked') {
    const actions: CaseAction[] =
      presenceState === 'in_server'
        ? ['view_history', 'verify_user', 'kick_user', 'ban_user']
        : ['view_history', 'ban_by_id'];
    return appendRefreshNotificationAction(row, actions);
  }

  const presenceActions = ACTIONS_BY_PRESENCE_STATE[presenceState];
  if (presenceActions) {
    return appendCaptchaActions(
      row,
      appendRefreshNotificationAction(row, resolveCaseKindActions(row, presenceActions)),
      presenceState
    );
  }

  const parkedIndex = 0;
  const quarantineEnabledIndex = Number(
    metadataToRecord(row.server_settings).account_quarantine_enabled === true
  ) as 0 | 1;
  const actions = resolveCaseKindActions(row, [
    ...PENDING_IN_SERVER_ACTIONS[parkedIndex],
    ...ACCOUNT_QUARANTINE_ACTIONS_BY_STATE[parkedIndex][quarantineEnabledIndex],
  ]);
  const actionsWithNotification = appendRefreshNotificationAction(row, actions);
  const threadPresentIndex = Number(Boolean(row.thread_id)) as 0 | 1;
  actionsWithNotification.push(...THREAD_REPAIR_ACTIONS_BY_STATE[parkedIndex][threadPresentIndex]);
  return appendCaptchaActions(row, actionsWithNotification, presenceState);
}

function resolveCaseKindActions(row: CaseSummaryRow, actions: readonly CaseAction[]): CaseAction[] {
  return row.case_kind === 'compromised_account'
    ? actions.filter((action) => action !== 'close_no_action')
    : [...actions];
}

function appendRefreshNotificationAction(
  row: CaseSummaryRow,
  actions: readonly CaseAction[]
): CaseAction[] {
  const actionList = [...actions];
  if (row.notification_message_id && !actionList.includes('refresh_notification')) {
    actionList.push('refresh_notification');
  }
  return actionList;
}

export function parseCaseSummaryRow(row: CaseSummaryRow, now = new Date()): CaseSummary {
  const updatedAt = new Date(toIsoString(row.updated_at));
  const staleHours = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 3_600_000));
  const presenceState = resolvePresenceState(row);
  const quarantine = readNestedRecord(metadataToRecord(row.metadata), 'account_quarantine');
  const quarantineEffects =
    row.case_kind === 'compromised_account'
      ? {
          removedRoleCount: readArrayLength(quarantine.removed_role_ids),
          retainedRoleCount: readArrayLength(quarantine.retained_roles),
          failedRoleCount: readArrayLength(quarantine.failed_removals),
          memberBypassCount: readArrayLength(quarantine.member_bypasses),
        }
      : null;

  return caseSummarySchema.parse({
    id: row.id,
    guildId: row.server_id,
    userId: row.user_id,
    userIdentity: resolveUserIdentity(row),
    createdAt: toIsoString(row.created_at),
    updatedAt: updatedAt.toISOString(),
    caseKind: row.case_kind ?? 'standard',
    attentionState: row.attention_state ?? 'review_required',
    containmentStatus: row.containment_status ?? 'not_applicable',
    parkedAt: toNullableIsoString(row.parked_at),
    parkedBy: row.parked_by ?? null,
    quarantineEffects,
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
    captchaChallenge: row.captcha_status
      ? {
          id: row.captcha_id,
          status: row.captcha_status,
          requestSource: row.captcha_request_source,
          passEffect: row.captcha_pass_effect,
          generation: row.captcha_generation,
          submissionCount: row.captcha_submission_count,
          expiresAt: toIsoString(row.captcha_expires_at),
          requestedAt: toIsoString(row.captcha_requested_at),
          deliveredAt: toNullableIsoString(row.captcha_delivered_at),
          deliveryErrorCode: row.captcha_delivery_error_code,
          passedAt: toNullableIsoString(row.captcha_passed_at),
          bypassedAt: toNullableIsoString(row.captcha_bypassed_at),
          bypassedBy: row.captcha_bypassed_by,
          bypassReason: row.captcha_bypass_reason,
          history: row.captcha_history ?? [],
        }
      : null,
  });
}

function appendCaptchaActions(
  row: CaseSummaryRow,
  actions: CaseAction[],
  presenceState: CasePresenceState
): CaseAction[] {
  if (row.case_kind === 'compromised_account' || row.status !== 'pending') {
    return actions;
  }
  const mode = metadataToRecord(row.server_settings).captcha_mode;
  if (mode !== 'manual' && mode !== 'suspicious_join') {
    return actions;
  }
  if (presenceState !== 'in_server') {
    if (
      row.captcha_status === 'pending' ||
      row.captcha_status === 'failed' ||
      row.captcha_status === 'expired'
    ) {
      actions.push('bypass_captcha');
    }
    return actions;
  }
  if (!row.captcha_status) {
    actions.push('challenge_user');
    return actions;
  }
  if (row.captcha_status === 'pending') {
    if (row.captcha_delivery_error_code) {
      actions.push('retry_captcha');
    }
    actions.push('bypass_captcha');
    return actions;
  }
  if (row.captcha_status === 'failed' || row.captcha_status === 'expired') {
    actions.push('retry_captcha', 'bypass_captcha');
    return actions;
  }
  if (row.captcha_status === 'bypassed') {
    actions.push('retry_captcha');
  } else if (row.captcha_status === 'cancelled') {
    actions.push('retry_captcha');
  }
  return actions;
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

function parseEvidenceRow(row: CaseEvidenceRow, guildId: string): CaseEvidenceItem {
  const metadata = metadataToRecord(row.metadata);
  const attachmentUrl = readString(metadata.url) ?? readString(metadata.proxyUrl);
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    createdAt: toNullableIsoString(row.created_at),
    url:
      row.source_channel_id && row.source_message_id
        ? discordMessageUrl(guildId, row.source_channel_id, row.source_message_id)
        : attachmentUrl,
  };
}

function parseMessageContextRow(
  row: MessageContextRow,
  guildId: string,
  sourceMessageId: string | null
): CaseMessageContextItem {
  return {
    id: row.id,
    messageId: row.message_id,
    channelId: row.channel_id,
    contentPreview: row.content_preview,
    createdAt: toIsoString(row.created_at),
    url: row.channel_id ? discordMessageUrl(guildId, row.channel_id, row.message_id) : null,
    isSource: row.message_id === sourceMessageId,
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

export function resolveReportIntakeId(
  openingDetectionMetadata: unknown,
  latestDetectionMetadata: unknown
): string | null {
  return (
    readString(metadataToRecord(openingDetectionMetadata).reportIntakeId) ??
    readString(metadataToRecord(latestDetectionMetadata).reportIntakeId)
  );
}

const SUMMARY_QUERY = `
  select
    ve.id,
    ve.server_id,
    ve.user_id,
    ve.detection_event_id,
    ve.thread_id,
    ve.private_evidence_thread_id,
    ve.notification_channel_id,
    ve.notification_message_id,
    ve.status,
    ve.case_kind,
    ve.attention_state,
    ve.containment_status,
    ve.parked_at,
    ve.parked_by,
    ve.created_at,
    ve.updated_at,
    ve.notes,
    ve.metadata,
    s.admin_channel_id,
    s.settings as server_settings,
    de.detection_type as latest_detection_type,
    de.confidence as latest_confidence,
    de.detected_at as latest_detection_at,
    de.metadata as latest_detection_metadata,
    opening_de.metadata as opening_detection_metadata,
    de.channel_id as source_channel_id,
    de.message_id as source_message_id,
    aa.action_type as last_action_type,
    aa.action_at as last_action_at,
    mo.outcome_type as latest_outcome_type,
    mo.source as latest_outcome_source,
    u.username as user_username,
    u.metadata as user_metadata,
    sm.user_id as member_user_id,
    cc.id::text as captcha_id,
    cc.status as captcha_status,
    cc.request_source as captcha_request_source,
    cc.pass_effect as captcha_pass_effect,
    cc.generation as captcha_generation,
    cc.submission_count as captcha_submission_count,
    cc.expires_at as captcha_expires_at,
    cc.requested_at as captcha_requested_at,
    cc.delivered_at as captcha_delivered_at,
    cc.delivery_error_code as captcha_delivery_error_code,
    cc.passed_at as captcha_passed_at,
    cc.bypassed_at as captcha_bypassed_at,
    cc.bypassed_by as captcha_bypassed_by,
    cc.bypass_reason as captcha_bypass_reason,
    captcha_history.history as captcha_history
  from verification_events ve
  join servers s on s.guild_id = ve.server_id
  left join users u on u.discord_id = ve.user_id
  left join server_members sm on sm.server_id = ve.server_id and sm.user_id = ve.user_id
  left join captcha_challenges cc on cc.verification_event_id = ve.id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'generation', captcha_request.generation,
        'requestSource', captcha_request.request_source,
        'passEffect', captcha_request.pass_effect,
        'caseRevisionAtIssue', captcha_request.case_revision_at_issue,
        'requestedBy', captcha_request.requested_by,
        'requestedAt', captcha_request.requested_at,
        'presentedAt', captcha_request.presented_at,
        'outcome', captcha_request.outcome,
        'outcomeAt', captcha_request.outcome_at,
        'deliveryErrorCode', captcha_request.delivery_error_code,
        'bypassedBy', captcha_bypass.moderator_id,
        'bypassedAt', captcha_bypass.bypassed_at,
        'bypassReason', captcha_bypass.reason
      ) order by captcha_request.generation
    ) as history
    from captcha_challenge_requests captcha_request
    left join captcha_challenge_bypasses captcha_bypass
      on captcha_bypass.captcha_challenge_id = captcha_request.captcha_challenge_id
     and captcha_bypass.generation = captcha_request.generation
    where captcha_request.captcha_challenge_id = cc.id
  ) captcha_history on true
  left join detection_events opening_de on opening_de.id = ve.detection_event_id
  left join lateral (
    select detection_type, confidence, detected_at, metadata, channel_id, message_id
    from detection_events linked_de
    where linked_de.id = ve.detection_event_id
       or linked_de.latest_verification_event_id = ve.id
    order by detected_at desc nulls last
    limit 1
  ) de on true
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
  public canQueueCaseActions(): boolean {
    return true;
  }

  public async listActiveCases(guildId: string): Promise<CaseSummary[]> {
    const result = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1
         and ve.status = 'pending'
         and ve.attention_state = 'review_required'
         and ve.user_id is not null
       order by ve.updated_at asc`,
      [guildId]
    );
    return sortCaseSummariesForQueue(result.rows.map((row) => parseCaseSummaryRow(row)));
  }

  public async listParkedCases(guildId: string): Promise<CaseSummary[]> {
    const result = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1
         and ve.status = 'pending'
         and ve.attention_state = 'parked'
         and ve.user_id is not null
       order by ve.parked_at desc nulls last, ve.updated_at desc`,
      [guildId]
    );
    return result.rows.map((row) => parseCaseSummaryRow(row));
  }

  public async listResolvedCases(guildId: string, limit = 50): Promise<CaseSummary[]> {
    const result = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1 and ve.status <> 'pending' and ve.user_id is not null
       order by coalesce(ve.resolved_at, ve.updated_at, ve.created_at) desc nulls last
       limit $2`,
      [guildId, limit]
    );
    return result.rows.map((row) => parseCaseSummaryRow(row));
  }

  public async listCasesForMember(
    guildId: string,
    userId: string,
    limit = 50
  ): Promise<CaseSummary[]> {
    const result = await getPostgresPool().query<CaseSummaryRow>(
      `${SUMMARY_QUERY}
       where ve.server_id = $1 and ve.user_id = $2
       order by coalesce(ve.resolved_at, ve.updated_at, ve.created_at) desc nulls last
       limit $3`,
      [guildId, userId, limit]
    );
    return result.rows.map((row) => parseCaseSummaryRow(row));
  }

  public async countResolvedCases(guildId: string): Promise<number> {
    const result = await getPostgresPool().query<{ count: string }>(
      `select count(*)::text
       from verification_events
       where server_id = $1 and status <> 'pending' and user_id is not null`,
      [guildId]
    );
    return Number(result.rows[0]?.count ?? 0);
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

    const latestDetectionMetadata = metadataToRecord(row.latest_detection_metadata);
    const reportIntakeId = resolveReportIntakeId(
      row.opening_detection_metadata,
      row.latest_detection_metadata
    );
    const summaryMetadata = metadataToRecord(row.metadata);
    const sourceMessageId =
      readString(summaryMetadata.source_message_id) ??
      row.source_message_id ??
      readString(latestDetectionMetadata.sourceMessageId) ??
      readString(latestDetectionMetadata.messageId);

    const evidenceQuery = reportIntakeId
      ? getPostgresPool().query<CaseEvidenceRow>(
          `select id, kind, source_message_id, source_channel_id, content, metadata, created_at
           from report_intake_evidence
           where intake_id = $1
           order by created_at asc nulls last
           limit 25`,
          [reportIntakeId]
        )
      : Promise.resolve({ rows: [] as CaseEvidenceRow[] });

    const [detectionHistoryResult, outcomesResult, evidenceResult, messageContextResult] =
      await Promise.all([
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
            where server_id = $1 and verification_event_id = $2
            order by occurred_at desc nulls last
            limit 25`,
          [guildId, row.id]
        ),
        evidenceQuery,
        getPostgresPool().query<MessageContextRow>(
          `select id, message_id, channel_id, content_preview, created_at
           from message_contexts
           where server_id = $1 and user_id = $2 and expires_at > now()
           order by created_at desc, observed_at desc
           limit 10`,
          [guildId, row.user_id]
        ),
      ]);

    return caseDetailSchema.parse({
      ...parseCaseSummaryRow(row),
      notes: row.notes,
      evidenceItems: evidenceResult.rows.map((evidenceRow) =>
        parseEvidenceRow(evidenceRow, guildId)
      ),
      messageContext: messageContextResult.rows.map((contextRow) =>
        parseMessageContextRow(contextRow, guildId, sourceMessageId)
      ),
      detectionHistory: detectionHistoryResult.rows.map(parseDetectionHistoryRow),
      moderationOutcomes: outcomesResult.rows.map(parseModerationOutcomeRow),
    });
  }

  public async queueCaseAction(input: QueueCaseActionInput): Promise<CaseActionQueueResult> {
    const detail = await this.getCaseDetail(input.guildId, input.caseId);
    if (!detail) {
      return {
        action: input.action,
        caseId: input.caseId,
        requestId: null,
        status: 'case_not_found',
      };
    }
    if (!detail.allowedActions.includes(input.action)) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }

    if (
      input.action === 'quarantine_compromised_account' &&
      input.quarantinePhase !== 'preview' &&
      input.quarantinePhase !== 'execute'
    ) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    if (
      input.action === 'quarantine_compromised_account' &&
      input.quarantinePhase === 'preview' &&
      !input.attemptId
    ) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    if (
      input.action === 'quarantine_compromised_account' &&
      input.quarantinePhase === 'execute' &&
      !(await this.isValidAccountQuarantinePreview(input, detail.userId))
    ) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    if (
      (input.action === 'retry_captcha' || input.action === 'bypass_captcha') &&
      !input.attemptId
    ) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    if (
      (input.action === 'retry_captcha' || input.action === 'bypass_captcha') &&
      (!input.expectedCaptchaChallengeId ||
        input.expectedCaptchaGeneration === null ||
        input.expectedCaptchaGeneration === undefined ||
        detail.captchaChallenge?.id !== input.expectedCaptchaChallengeId ||
        detail.captchaChallenge.generation !== input.expectedCaptchaGeneration)
    ) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }

    const receipt = await queueModerationActionRequestWithReceipt({
      actionType: resolveCaseActionRequestType(input),
      actorId: input.adminId,
      actorSurface: 'web',
      idempotencyKey: buildCaseActionIdempotencyKey(input),
      metadata: {
        case_action: input.action,
        ...(input.quarantinePhase ? { quarantine_phase: input.quarantinePhase } : {}),
        ...(input.previewRequestId ? { preview_request_id: input.previewRequestId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.action === 'retry_captcha' || input.action === 'bypass_captcha'
          ? {
              expected_challenge_id: input.expectedCaptchaChallengeId,
              expected_generation: input.expectedCaptchaGeneration,
            }
          : {}),
        requested_surface: 'web',
      },
      serverId: input.guildId,
      targetUserId: detail.userId,
      verificationEventId: detail.id,
    });

    return {
      action: input.action,
      caseId: input.caseId,
      requestId: receipt.id,
      status: resolveCaseActionQueueStatus(receipt.status),
    };
  }

  private async isValidAccountQuarantinePreview(
    input: QueueCaseActionInput,
    targetUserId: string
  ): Promise<boolean> {
    if (!input.previewRequestId || !uuidSchema.safeParse(input.previewRequestId).success) {
      return false;
    }
    const result = await getPostgresPool().query<{ readonly id: string }>(
      `select id::text
       from moderation_action_requests
       where id = $1::uuid
         and server_id = $2
         and actor_id = $3
         and target_user_id = $4
         and verification_event_id = $5::uuid
         and action_type = 'preview_account_quarantine'
         and status = 'completed'
         and completed_at > now() - interval '10 minutes'
       limit 1`,
      [input.previewRequestId, input.guildId, input.adminId, targetUserId, input.caseId]
    );
    return result.rows.length === 1;
  }
}

export class FixtureActiveCaseDataAdapter implements ActiveCaseDataAdapter {
  public canQueueCaseActions(): boolean {
    return true;
  }

  public async listActiveCases(): Promise<CaseSummary[]> {
    return sortCaseSummariesForQueue(fixtureActiveCaseSummaries());
  }

  public async listParkedCases(): Promise<CaseSummary[]> {
    return fixtureParkedActiveCaseSummaries();
  }

  public async listResolvedCases(_guildId: string): Promise<CaseSummary[]> {
    return sortCaseSummariesForHistory(fixtureResolvedCaseSummariesForHistory());
  }

  public async listCasesForMember(_guildId: string, userId: string): Promise<CaseSummary[]> {
    return sortCaseSummariesForHistory(
      [...fixtureActiveCaseSummaries(), ...fixtureResolvedCaseSummariesForHistory()].filter(
        (item) => item.userId === userId
      )
    );
  }

  public async countResolvedCases(): Promise<number> {
    return fixtureResolvedCaseCount();
  }

  public async getCaseDetail(_guildId: string, caseId: string): Promise<CaseDetail | null> {
    return fixtureActiveCaseDetail(caseId);
  }

  public async queueCaseAction(input: QueueCaseActionInput): Promise<CaseActionQueueResult> {
    const detail = fixtureActiveCaseDetail(input.caseId);
    if (!detail) {
      return {
        action: input.action,
        caseId: input.caseId,
        requestId: null,
        status: 'case_not_found',
      };
    }
    if (!detail.allowedActions.includes(input.action)) {
      return { action: input.action, caseId: input.caseId, requestId: null, status: 'not_allowed' };
    }
    return {
      action: input.action,
      caseId: input.caseId,
      requestId: `fixture-case-action-${input.action}-${input.caseId}`,
      status: 'queued',
    };
  }
}

export function createActiveCaseDataAdapter(): ActiveCaseDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureActiveCaseDataAdapter();
  }

  return new PostgresActiveCaseDataAdapter();
}
