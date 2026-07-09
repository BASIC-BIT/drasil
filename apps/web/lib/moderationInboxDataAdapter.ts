import {
  moderationInboxItemSchema,
  sortModerationInboxItems,
  type CaseAction,
  type CaseSummary,
  type ModerationInboxAction,
  type ModerationInboxItem,
  type ModerationInboxItemKind,
  type ModerationInboxLink,
  type ReportQueueAction,
  type ReportQueueItem,
} from '@drasil/contracts';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { createActiveCaseDataAdapter } from './activeCaseDataAdapter';
import { createReportQueueDataAdapter } from './reportQueueDataAdapter';
import { getPostgresPool } from './setupDataAdapter';
import { fixtureModerationInboxItems } from './inboxFixtures';

export interface ModerationInboxDataAdapter {
  listInboxItems(guildId: string): Promise<ModerationInboxItem[]>;
}

export interface ModerationQueueRow {
  id: string;
  server_id: string;
  user_id: string;
  item_type: string;
  verification_event_id: string | null;
  detection_event_id: string | null;
  report_intake_id: string | null;
  source_thread_id: string | null;
  queue_channel_id: string | null;
  queue_message_id: string | null;
  last_source_message_id: string | null;
  last_notified_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  metadata: unknown;
  server_settings: unknown;
  detection_type: string | null;
  detection_confidence: number | null;
  detection_detected_at: unknown;
  detection_reasons: string[] | null;
  detection_metadata: unknown;
  case_status: string | null;
  report_status: string | null;
  report_summary: string | null;
  user_username: string | null;
  user_metadata: unknown;
}

const DEFAULT_STALE_HOURS = 24;

const queueKindByType: Record<string, ModerationInboxItemKind> = {
  case_mirror: 'case',
  observed_alert_mirror: 'observed_alert',
  pending_screening_member: 'pending_screening',
  report_thread_attention: 'report_attention',
  support_thread_attention: 'support_attention',
};

const caseActionMap: Record<CaseAction, ModerationInboxAction> = {
  ban_by_id: 'ban_by_id',
  ban_user: 'ban_user',
  close_no_action: 'close_no_action',
  create_thread: 'create_thread',
  kick_user: 'kick_user',
  repair_thread: 'repair_thread',
  reopen_case: 'reopen_case',
  refresh_notification: 'refresh_notification',
  sync_existing_ban: 'sync_existing_ban',
  verify_user: 'verify_user',
  view_history: 'view_history',
};

const reportActionMap: Record<ReportQueueAction, ModerationInboxAction> = {
  dismiss_no_action: 'dismiss_no_action',
  mark_actioned: 'mark_actioned',
  mark_false_positive: 'mark_false_positive',
  open_case: 'open_case',
  open_report_thread: 'open_discord',
};

const queueTitleByKind: Record<ModerationInboxItemKind, string> = {
  case: 'Pending moderation case',
  observed_alert: 'Observed alert pending review',
  pending_screening: 'Long-pending Discord screening',
  report_attention: 'Reporter follow-up needs review',
  submitted_report: 'Submitted report',
  support_attention: 'Support reply needs review',
};

const staticQueueActionsByKind: Partial<
  Record<ModerationInboxItemKind, readonly ModerationInboxAction[]>
> = {
  case: ['view_case', 'view_history', 'open_discord'],
  pending_screening: ['open_discord'],
  report_attention: ['acknowledge', 'open_discord'],
  submitted_report: ['view_report'],
  support_attention: ['acknowledge', 'open_discord'],
};

const queueStatusLabelByKind: Record<ModerationInboxItemKind, (row: ModerationQueueRow) => string> =
  {
    case: (row) => row.case_status ?? 'pending',
    observed_alert: (row) => row.detection_type ?? 'observed alert',
    pending_screening: () => 'pending screening',
    report_attention: () => 'needs attention',
    submitted_report: (row) => row.report_status ?? 'submitted',
    support_attention: () => 'needs attention',
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

function metadataToRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readUrl(value: unknown): string | null {
  const url = readString(value);
  if (!url) {
    return null;
  }

  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function staleHoursFrom(updatedAt: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(updatedAt)) / 3_600_000));
}

function confidenceSignal(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}% confidence`;
}

function compactReason(reasons: readonly string[] | null): string | null {
  if (!reasons || reasons.length === 0) {
    return null;
  }
  return reasons.slice(0, 2).join(' ');
}

function pushLink(links: ModerationInboxLink[], label: string, url: string | null): void {
  if (url) {
    links.push({ label, url });
  }
}

function subjectFromQueueRow(row: ModerationQueueRow): ModerationInboxItem['subject'] {
  const userMetadata = metadataToRecord(row.user_metadata);
  const displayLabel =
    readString(userMetadata.display_name) ??
    readString(userMetadata.displayName) ??
    readString(userMetadata.global_name) ??
    readString(userMetadata.globalName) ??
    readString(userMetadata.username) ??
    row.user_username ??
    row.user_id;

  return {
    userId: row.user_id,
    displayLabel,
    secondaryLabel:
      row.user_username && row.user_username !== displayLabel ? row.user_username : null,
    avatarUrl: readUrl(userMetadata.avatar_url) ?? readUrl(userMetadata.avatarUrl),
  };
}

function queueTitle(kind: ModerationInboxItemKind): string {
  return queueTitleByKind[kind];
}

function queueStatusLabel(kind: ModerationInboxItemKind, row: ModerationQueueRow): string {
  return queueStatusLabelByKind[kind](row);
}

function observedAlertActions(row: ModerationQueueRow): ModerationInboxAction[] {
  const settings = metadataToRecord(row.server_settings);
  const actions: ModerationInboxAction[] = [
    'open_case',
    'view_history',
    'dismiss_no_action',
    'mark_false_positive',
  ];
  if (settings.observed_action_kick_enabled === true) {
    actions.push('kick_user');
  }
  if (settings.moderator_ban_action_enabled !== false) {
    actions.push('ban_user');
  }
  actions.push('open_discord');
  return actions;
}

function queueAllowedActions(
  kind: ModerationInboxItemKind,
  row: ModerationQueueRow
): ModerationInboxAction[] {
  const staticActions = staticQueueActionsByKind[kind];
  return staticActions ? [...staticActions] : observedAlertActions(row);
}

export function caseSummaryToInboxItem(item: CaseSummary): ModerationInboxItem {
  const staleHours = item.staleHours;
  return moderationInboxItemSchema.parse({
    id: `case:${item.id}`,
    guildId: item.guildId,
    kind: 'case',
    sourceId: item.id,
    queueItemId: null,
    subject: {
      userId: item.userId,
      displayLabel: item.userIdentity.displayLabel,
      secondaryLabel: item.userIdentity.username,
      avatarUrl: item.userIdentity.avatarUrl,
    },
    title: 'Pending moderation case',
    summary: item.latestDetectionType
      ? `Latest detection: ${item.latestDetectionType}.`
      : 'Pending case needs moderator review.',
    statusLabel: item.presenceState,
    signalLabel: confidenceSignal(item.confidence),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stale: item.stale,
    staleHours,
    detailHref: `/admin/guild/${item.guildId}/cases/${item.id}`,
    links: item.surfaces.map((surface) => ({ label: surface.label, url: surface.url })),
    allowedActions: ['view_case', ...item.allowedActions.map((action) => caseActionMap[action])],
  });
}

export function reportQueueItemToInboxItem(item: ReportQueueItem): ModerationInboxItem {
  return moderationInboxItemSchema.parse({
    id: `report:${item.id}`,
    guildId: item.guildId,
    kind: 'submitted_report',
    sourceId: item.id,
    queueItemId: null,
    subject: {
      userId: item.targetUserId ?? item.reporterId,
      displayLabel: item.targetUserId ? `Target ${item.targetUserId}` : 'Unknown report target',
      secondaryLabel: `Reporter ${item.reporterId}`,
      avatarUrl: null,
    },
    title: 'Submitted report',
    summary: item.summary,
    statusLabel: item.status,
    signalLabel: `${item.evidenceCount} evidence item${item.evidenceCount === 1 ? '' : 's'}`,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    stale: item.stale,
    staleHours: item.staleHours,
    detailHref: `/admin/guild/${item.guildId}/reports/${item.id}`,
    links: [
      ...(item.reportThreadUrl ? [{ label: 'Report thread', url: item.reportThreadUrl }] : []),
      ...(item.latestCaseId
        ? [
            {
              label: 'Linked case',
              url: `/admin/guild/${item.guildId}/cases/${item.latestCaseId}`,
            },
          ]
        : []),
    ],
    allowedActions: [
      'view_report',
      ...item.allowedActions.map((action) => reportActionMap[action]),
    ],
  });
}

export function parseModerationQueueRow(
  row: ModerationQueueRow,
  now = new Date()
): ModerationInboxItem | null {
  const kind = queueKindByType[row.item_type];
  if (!kind) {
    return null;
  }

  const updatedAt = toIsoString(row.updated_at);
  const staleHours = staleHoursFrom(updatedAt, now);
  const metadata = metadataToRecord(row.metadata);
  const detectionMetadata = metadataToRecord(row.detection_metadata);
  const links: ModerationInboxLink[] = [];

  pushLink(
    links,
    'Queue message',
    row.queue_channel_id && row.queue_message_id
      ? discordMessageUrl(row.server_id, row.queue_channel_id, row.queue_message_id)
      : null
  );
  pushLink(
    links,
    'Source thread',
    row.source_thread_id ? discordMessageUrl(row.server_id, row.source_thread_id) : null
  );
  pushLink(links, 'Latest message', readUrl(metadata.latest_message_url));
  pushLink(
    links,
    'Observed notification',
    readString(detectionMetadata.observed_notification_channel_id) &&
      readString(detectionMetadata.observed_notification_message_id)
      ? discordMessageUrl(
          row.server_id,
          readString(detectionMetadata.observed_notification_channel_id) ?? '',
          readString(detectionMetadata.observed_notification_message_id)
        )
      : null
  );

  const sourceId =
    row.verification_event_id ??
    row.detection_event_id ??
    row.report_intake_id ??
    row.source_thread_id ??
    row.id;
  const summary =
    row.report_summary ??
    readString(metadata.latest_message_url) ??
    compactReason(row.detection_reasons) ??
    null;

  return moderationInboxItemSchema.parse({
    id: `queue:${row.id}`,
    guildId: row.server_id,
    kind,
    sourceId,
    queueItemId: row.id,
    subject: subjectFromQueueRow(row),
    title: queueTitle(kind),
    summary,
    statusLabel: queueStatusLabel(kind, row),
    signalLabel: confidenceSignal(row.detection_confidence),
    createdAt: toIsoString(row.created_at),
    updatedAt,
    stale: staleHours >= DEFAULT_STALE_HOURS,
    staleHours,
    detailHref:
      kind === 'case' && row.verification_event_id
        ? `/admin/guild/${row.server_id}/cases/${row.verification_event_id}`
        : null,
    links,
    allowedActions: queueAllowedActions(kind, row),
  });
}

function dedupeCaseMirrors(
  items: readonly ModerationInboxItem[],
  activeCaseIds: ReadonlySet<string>
): ModerationInboxItem[] {
  return items.filter(
    (item) => !(item.kind === 'case' && item.queueItemId && activeCaseIds.has(item.sourceId))
  );
}

export class PostgresModerationInboxDataAdapter implements ModerationInboxDataAdapter {
  public async listInboxItems(guildId: string): Promise<ModerationInboxItem[]> {
    const activeCaseAdapter = createActiveCaseDataAdapter();
    const reportAdapter = createReportQueueDataAdapter();
    const [cases, reports, queueResult] = await Promise.all([
      activeCaseAdapter.listActiveCases(guildId),
      reportAdapter.listSubmittedReports(guildId),
      getPostgresPool().query<ModerationQueueRow>(
        `select
           mqi.id,
           mqi.server_id,
           mqi.user_id,
           mqi.item_type,
           mqi.verification_event_id,
           mqi.detection_event_id,
           mqi.report_intake_id,
           mqi.source_thread_id,
           mqi.queue_channel_id,
           mqi.queue_message_id,
           mqi.last_source_message_id,
           mqi.last_notified_at,
           mqi.created_at,
           mqi.updated_at,
           mqi.metadata,
           s.settings as server_settings,
           de.detection_type,
           de.confidence as detection_confidence,
           de.detected_at as detection_detected_at,
           de.reasons as detection_reasons,
           de.metadata as detection_metadata,
           ve.status as case_status,
           ri.status as report_status,
           ri.summary as report_summary,
           u.username as user_username,
           u.metadata as user_metadata
         from moderation_queue_items mqi
         left join detection_events de on de.id = mqi.detection_event_id
         left join verification_events ve on ve.id = mqi.verification_event_id
         left join report_intakes ri on ri.id = mqi.report_intake_id
         left join users u on u.discord_id = mqi.user_id
         left join servers s on s.guild_id = mqi.server_id
         where mqi.server_id = $1
         order by mqi.updated_at asc nulls last`,
        [guildId]
      ),
    ]);
    const activeCaseIds = new Set(cases.map((item) => item.id));
    const queueItems = dedupeCaseMirrors(
      queueResult.rows.flatMap((row) => {
        const item = parseModerationQueueRow(row);
        return item ? [item] : [];
      }),
      activeCaseIds
    );

    return sortModerationInboxItems([
      ...cases.map(caseSummaryToInboxItem),
      ...reports.map(reportQueueItemToInboxItem),
      ...queueItems,
    ]);
  }
}

export class FixtureModerationInboxDataAdapter implements ModerationInboxDataAdapter {
  public async listInboxItems(guildId: string): Promise<ModerationInboxItem[]> {
    return fixtureModerationInboxItems(guildId);
  }
}

export function createModerationInboxDataAdapter(): ModerationInboxDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureModerationInboxDataAdapter();
  }

  return new PostgresModerationInboxDataAdapter();
}
