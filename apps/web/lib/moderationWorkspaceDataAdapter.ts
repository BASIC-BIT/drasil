import { filterCaseKindActions } from './caseActionEligibility';
import { caseConversationSources, reportConversationSources } from './conversationTypes';
import { readAttentionReply } from './conversationDataAdapter';
import { z } from 'zod';
import {
  getEffectiveCaptchaMethod,
  getCaptchaMethodRevision,
  hasAuthority,
  hasStaffAuthority,
  readCasePolicy,
  MODERATION_PERMISSIONS,
  BAN_MEMBERS,
  KICK_MEMBERS,
  ADMINISTRATOR,
  type AuthorityFacts,
} from '@drasil/application';
import {
  memberProfileDetectionSchema,
  moderationInboxItemSchema,
  type ModerationInboxItem,
  type ModerationInboxAction,
  type ReportDetail,
  type MemberProfileDetection,
} from '@drasil/contracts';
import { createActiveCaseDataAdapter } from './activeCaseDataAdapter';
import { createReportDetailDataAdapter } from './reportDetailDataAdapter';
import { createReportQueueDataAdapter } from './reportQueueDataAdapter';
import { createMemberProfileDataAdapter, parseDetectionRow } from './memberProfileDataAdapter';
import {
  createModerationActionRequestDataAdapter,
  type ModerationActionRequestSummary,
} from './moderationActionRequestDataAdapter';
import { createMessageCleanupDataAdapter } from './messageCleanupDataAdapter';
import { createModerationAttentionDataAdapter } from './moderationAttentionDataAdapter';
import {
  caseSummaryToInboxItem,
  reportQueueItemToInboxItem,
  parseModerationQueueRow,
  type ModerationQueueRow,
} from './moderationInboxDataAdapter';
import { getPostgresPool } from './setupDataAdapter';
import {
  caseWorkspaceDataSchema,
  workspaceItemDetailSchema,
  type CaseWorkspaceData,
  type WorkspaceItemDetail,
  type WorkspaceActionPolicy,
} from './moderationWorkspaceTypes';

/** Request-scoped authenticated actor facts. The factory rejects reads outside this guild. */
export type ModerationWorkspaceReadActor = AuthorityFacts;
export interface ModerationWorkspaceDataAdapter {
  getInboxItemDetail(input: {
    guildId: string;
    itemId: string;
  }): Promise<WorkspaceItemDetail | null>;
  getCaseWorkspaceData(input: {
    guildId: string;
    caseId: string;
  }): Promise<CaseWorkspaceData | null>;
}
const settingsSchema = z
  .object({
    case_responder_role_ids: z.array(z.string()).default([]),
    observed_action_kick_enabled: z.boolean().default(false),
  })
  .passthrough();
const readActions = new Set<ModerationInboxAction>([
  'view_case',
  'view_report',
  'view_history',
  'open_discord',
]);

export function createModerationWorkspaceDataAdapter(
  actor: ModerationWorkspaceReadActor
): ModerationWorkspaceDataAdapter {
  const cases = createActiveCaseDataAdapter();
  const reports = createReportDetailDataAdapter();
  const requests = createModerationActionRequestDataAdapter();
  const cleanup = createMessageCleanupDataAdapter();
  const inScope = (guildId: string): boolean =>
    actor.present && actor.guildId === guildId && actor.userId.length > 0;
  let loadedSettings: Promise<z.infer<typeof settingsSchema> | null> | undefined;
  function settings(): Promise<z.infer<typeof settingsSchema> | null> {
    loadedSettings ??= getPostgresPool()
      .query<{ settings: unknown }>('select settings from servers where guild_id = $1 limit 1', [
        actor.guildId,
      ])
      .then((result) =>
        result.rows[0] ? settingsSchema.parse(result.rows[0].settings ?? {}) : null
      );
    return loadedSettings;
  }
  async function policy(item: ModerationInboxItem): Promise<WorkspaceActionPolicy> {
    const rawSettings = (await settings()) ?? settingsSchema.parse({});
    const current = readCasePolicy(rawSettings);
    const moderate = hasAuthority(actor, MODERATION_PERMISSIONS);
    const reportReview = hasStaffAuthority(actor, rawSettings.case_responder_role_ids);
    const canQueueCaseActions = cases.canQueueCaseActions();
    const canOpenReportCases =
      moderate && createReportQueueDataAdapter().canOpenSubmittedReportCase();
    const allowedActions = item.allowedActions.filter((action) => {
      if (readActions.has(action)) return true;
      if (action === 'kick_user')
        return (
          canQueueCaseActions &&
          hasAuthority(actor, KICK_MEMBERS) &&
          (item.kind === 'observed_alert'
            ? rawSettings.observed_action_kick_enabled
            : current.moderatorKickActionEnabled)
        );
      if (action === 'ban_user' || action === 'ban_by_id' || action === 'sync_existing_ban')
        return (
          canQueueCaseActions &&
          hasAuthority(actor, BAN_MEMBERS) &&
          (action === 'sync_existing_ban' || current.moderatorBanActionEnabled)
        );
      if (action === 'open_case') return canOpenReportCases;
      if (
        item.kind === 'submitted_report' &&
        ['mark_actioned', 'dismiss_no_action', 'mark_false_positive'].includes(action)
      )
        return reportReview;
      if (action === 'acknowledge') return moderate;
      if (action === 'refresh_notification') return canQueueCaseActions && hasAuthority(actor, 0n);
      return canQueueCaseActions && moderate;
    });
    return {
      allowedActions,
      canQueueCaseActions:
        canQueueCaseActions &&
        hasAuthority(actor, MODERATION_PERMISSIONS | KICK_MEMBERS | BAN_MEMBERS),
      canOpenReportCases,
      canManageCleanup: hasAuthority(actor, ADMINISTRATOR),
      kickReasonRequired: current.moderatorKickActionRequiresReason,
      banReasonRequired: current.moderatorBanActionRequiresReason,
    };
  }
  async function selectedRequests(input: {
    guildId: string;
    userId: string | null;
    caseId?: string;
    reportId?: string;
    detectionId?: string;
    detectionIds?: readonly string[];
  }): Promise<ModerationActionRequestSummary[]> {
    const detectionIds = input.detectionIds ?? (input.detectionId ? [input.detectionId] : []);
    const result = await getPostgresPool().query<{ id: string }>(
      `select id::text from moderation_action_requests where server_id = $1 and
        (($2::text is not null and verification_event_id::text = $2) or
         ($3::text is not null and report_intake_id::text = $3) or
         (detection_event_id::text = any($4::text[]))) order by requested_at desc`,
      [input.guildId, input.caseId ?? null, input.reportId ?? null, detectionIds]
    );
    const loaded = await Promise.all(
      result.rows.map((row) => requests.getRequest(input.guildId, row.id))
    );
    return loaded.filter((request): request is ModerationActionRequestSummary =>
      Boolean(
        request &&
        request.targetUserId === input.userId &&
        (!request.verificationEventId || request.verificationEventId === input.caseId) &&
        (!request.reportIntakeId || request.reportIntakeId === input.reportId) &&
        (!request.detectionEventId || detectionIds.includes(request.detectionEventId)) &&
        ((input.caseId && request.verificationEventId === input.caseId) ||
          (input.reportId && request.reportIntakeId === input.reportId) ||
          (request.detectionEventId && detectionIds.includes(request.detectionEventId)))
      )
    );
  }
  async function getCaseWorkspaceData({
    guildId,
    caseId,
  }: {
    guildId: string;
    caseId: string;
  }): Promise<CaseWorkspaceData | null> {
    if (!inScope(guildId)) return null;
    const [detail, linkage] = await Promise.all([
      cases.getCaseDetail(guildId, caseId),
      getPostgresPool().query<{ report_id: string | null; detection_id: string | null }>(
        `select de.metadata->>'reportIntakeId' as report_id, de.id::text as detection_id
         from verification_events ve join detection_events de on de.server_id = ve.server_id and de.user_id = ve.user_id
           and (de.id = ve.detection_event_id or de.latest_verification_event_id = ve.id)
         where ve.server_id = $1 and ve.id::text = $2 order by (de.id = ve.detection_event_id) desc, de.detected_at desc nulls last`,
        [guildId, caseId]
      ),
    ]);
    if (!detail || detail.guildId !== guildId || detail.id !== caseId) return null;
    const linked = linkage.rows.find((row) => row.report_id) ?? linkage.rows[0];
    const effectivePolicy = await policy(caseSummaryToInboxItem(detail));
    const attention =
      detail.caseKind === 'compromised_account'
        ? await getPostgresPool().query<ModerationQueueRow>(
            `select mqi.*, ve.case_kind, ve.status as case_status, u.username as user_username, u.metadata as user_metadata
       from moderation_queue_items mqi
       join verification_events ve on ve.id=mqi.verification_event_id and ve.server_id=mqi.server_id and ve.user_id=mqi.user_id
       left join users u on u.discord_id=mqi.user_id
       where mqi.server_id=$1 and mqi.verification_event_id::text=$2 and mqi.user_id=$3
         and mqi.item_type in ('support_thread_attention', 'quarantine_breach_attention')
       order by mqi.updated_at desc nulls last`,
            [guildId, caseId, detail.userId]
          )
        : { rows: [] };
    const recoveryAttention = attention.rows
      .filter(
        (row) =>
          row.server_id === guildId &&
          row.verification_event_id === caseId &&
          row.user_id === detail.userId
      )
      .flatMap((row) => {
        const item = parseModerationQueueRow(row);
        return item?.kind === 'support_attention' ? [item] : [];
      });
    const [report, member, matchingRequests, workspace] = await Promise.all([
      linked?.report_id ? reports.getReportDetail(guildId, linked.report_id) : null,
      createMemberProfileDataAdapter().getMemberProfile(guildId, detail.userId),
      selectedRequests({
        guildId,
        userId: detail.userId,
        caseId,
        reportId: linked?.report_id ?? undefined,
        detectionIds: linkage.rows.flatMap((row) => (row.detection_id ? [row.detection_id] : [])),
      }),
      effectivePolicy.canManageCleanup ? cleanup.getCaseWorkspace(guildId, caseId) : null,
    ]);
    const matchingWorkspace =
      workspace &&
      workspace.guildId === guildId &&
      workspace.verificationEventId === caseId &&
      workspace.targetUserId === detail.userId
        ? workspace
        : null;
    const jobs = matchingWorkspace
      ? await Promise.all(
          matchingWorkspace.latestJobs
            .filter(
              (job) =>
                job.guildId === guildId &&
                job.verificationEventId === caseId &&
                job.targetUserId === detail.userId
            )
            .map((job) => cleanup.getJobDetail(guildId, caseId, job.id))
        )
      : [];
    const matchingReport =
      report &&
      report.guildId === guildId &&
      report.id === linked?.report_id &&
      report.targetUserId === detail.userId &&
      report.latestCaseId === caseId
        ? report
        : null;
    const configured = await settings();
    return caseWorkspaceDataSchema.parse({
      securityCheckConfiguration: configured
        ? {
            method: getEffectiveCaptchaMethod(configured),
            methodRevision: getCaptchaMethodRevision(configured),
          }
        : null,
      detail: { ...detail, allowedActions: filterCaseKindActions(detail, detail.allowedActions) },
      actorUserId: actor.userId,
      recoveryAttention,
      conversationSources: [
        ...caseConversationSources(detail),
        ...(matchingReport ? reportConversationSources(matchingReport) : []),
      ],
      policy: effectivePolicy,
      loadedAt: new Date().toISOString(),
      report: matchingReport,
      membership:
        member && member.guildId === guildId && member.userId === detail.userId
          ? member.membership
          : null,
      requests: matchingRequests,
      cleanup: matchingWorkspace
        ? {
            workspace: matchingWorkspace,
            jobs: jobs.filter(
              (job) =>
                job &&
                job.guildId === guildId &&
                job.verificationEventId === caseId &&
                job.targetUserId === detail.userId
            ),
          }
        : null,
    });
  }
  async function getInboxItemDetail({
    guildId,
    itemId,
  }: {
    guildId: string;
    itemId: string;
  }): Promise<WorkspaceItemDetail | null> {
    if (!inScope(guildId)) return null;
    const separator = itemId.indexOf(':');
    if (separator < 1 || separator === itemId.length - 1) return null;
    const kind = itemId.slice(0, separator),
      id = itemId.slice(separator + 1);
    if (kind === 'case') {
      const data = await getCaseWorkspaceData({ guildId, caseId: id });
      if (!data) return null;
      const item = {
        ...caseSummaryToInboxItem(data.detail),
        allowedActions: [...data.policy.allowedActions],
      };
      return workspaceItemDetailSchema.parse({ kind: 'case', item, policy: data.policy, data });
    }
    if (kind === 'report') {
      const report = await reports.getReportDetail(guildId, id);
      if (!report || report.guildId !== guildId || report.id !== id) return null;
      const item = reportItem(report);
      const [effectivePolicy, matchingRequests] = await Promise.all([
        policy(item),
        selectedRequests({
          guildId,
          userId: report.targetUserId,
          reportId: id,
          caseId: report.latestCaseId ?? undefined,
          detectionId: report.latestDetectionId ?? undefined,
        }),
      ]);
      return workspaceItemDetailSchema.parse({
        kind: 'submitted_report',
        conversationSources: reportConversationSources(report),
        item: { ...item, allowedActions: effectivePolicy.allowedActions },
        policy: effectivePolicy,
        report,
        requests: matchingRequests,
      });
    }
    if (kind === 'detection') {
      const result = await getPostgresPool().query<
        Parameters<typeof parseDetectionRow>[1] & { server_id: string; user_id: string }
      >(
        `select de.*, linked_case.id as latest_verification_event_id, accounting.action_type as latest_accounting_action_type, accounting.action_at as latest_accounting_action_at
         from detection_events de
         left join verification_events linked_case on linked_case.id = de.latest_verification_event_id and linked_case.server_id = de.server_id and linked_case.user_id = de.user_id
         left join lateral (select action_type::text, action_at from admin_actions where server_id = de.server_id and detection_event_id = de.id and action_type in ('false_positive', 'undo_observed_action') order by action_at desc nulls last limit 1) accounting on true
         where de.server_id = $1 and de.id::text = $2 limit 1`,
        [guildId, id]
      );
      const row = result.rows[0];
      if (!row || row.server_id !== guildId || row.id !== id) return null;
      const detection = memberProfileDetectionSchema.parse(parseDetectionRow(guildId, row));
      const reportReference = z
        .object({ reportIntakeId: z.string().optional() })
        .passthrough()
        .safeParse(row.metadata);
      const reportId = reportReference.success ? reportReference.data.reportIntakeId : undefined;
      const linkedReport = reportId ? await reports.getReportDetail(guildId, reportId) : null;
      const matchingReportId =
        linkedReport?.guildId === guildId &&
        linkedReport.targetUserId === row.user_id &&
        linkedReport.latestDetectionId === id
          ? linkedReport.id
          : undefined;
      const observedState = z
        .object({
          observed_action: z.string().nullable().optional(),
          observed_action_at: z.string().datetime().nullable().optional().catch(null),
        })
        .passthrough()
        .safeParse(row.metadata);
      const item = detectionItem(
        guildId,
        row.user_id,
        detection,
        observedState.success ? observedState.data : {}
      );
      const [effectivePolicy, matchingRequests] = await Promise.all([
        policy(item),
        selectedRequests({
          guildId,
          userId: row.user_id,
          detectionId: id,
          caseId: detection.latestCaseId ?? undefined,
          reportId: matchingReportId,
        }),
      ]);
      return workspaceItemDetailSchema.parse({
        kind: 'observed_alert',
        item: { ...item, allowedActions: effectivePolicy.allowedActions },
        policy: effectivePolicy,
        detection,
        requests: matchingRequests,
      });
    }
    if (kind !== 'queue') return null;
    const attention = await createModerationAttentionDataAdapter().getAttentionDetail({
      guildId,
      queueItemId: id,
    });
    if (!attention) return null;
    const effectivePolicy = await policy(attention.item);
    const reply =
      attention.item.kind === 'pending_screening'
        ? attention.reply
        : await readAttentionReply({
            guildId,
            actorId: actor.userId,
            channelId: attention.sourceThreadId,
            messageId: attention.latestReplyMessageId,
          });
    const common = {
      item: { ...attention.item, allowedActions: effectivePolicy.allowedActions },
      policy: effectivePolicy,
    };
    switch (attention.item.kind) {
      case 'report_attention':
        return attention.intake
          ? workspaceItemDetailSchema.parse({
              ...common,
              kind: 'report_attention',
              intake: attention.intake,
              reply,
            })
          : null;
      case 'support_attention': {
        const data = attention.caseId
          ? await getCaseWorkspaceData({ guildId, caseId: attention.caseId })
          : null;
        const caseData = data?.detail.userId === attention.item.subject.userId ? data : null;
        return workspaceItemDetailSchema.parse({
          ...common,
          kind: 'support_attention',
          subtype: attention.subtype,
          caseData,
          reply,
        });
      }
      case 'pending_screening':
        return workspaceItemDetailSchema.parse({
          ...common,
          kind: 'pending_screening',
          screening: {
            pendingSince: attention.item.sourceMetadata?.pendingSince ?? null,
            thresholdDays: attention.item.sourceMetadata?.thresholdDays ?? null,
            lastCheckedAt: attention.item.sourceMetadata?.lastCheckedAt ?? null,
          },
        });
      default:
        return null;
    }
  }
  return { getInboxItemDetail, getCaseWorkspaceData };
}
function reportItem(report: ReportDetail): ModerationInboxItem {
  const staleHours = report.updatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(report.updatedAt)) / 3_600_000))
    : 0;
  const item = reportQueueItemToInboxItem({
    ...report,
    evidenceCount: report.evidence.length,
    stale: staleHours >= 24,
    staleHours,
  });
  return {
    ...item,
    subject: {
      ...item.subject,
      displayLabel: report.targetUserId
        ? (report.targetDisplayName ?? item.subject.displayLabel)
        : 'Unknown report target',
      secondaryLabel: `Reporter ${report.reporterDisplayName ?? report.reporterId}`,
    },
  };
}
function detectionItem(
  guildId: string,
  userId: string,
  detection: MemberProfileDetection,
  observedState: { observed_action?: string | null; observed_action_at?: string | null }
): ModerationInboxItem {
  const observedAction = observedState.observed_action ?? detection.observedAction;
  const handled = observedAction !== null || detection.latestCaseId !== null;
  const updatedAt =
    observedState.observed_action_at ?? detection.observedActionAt ?? detection.detectedAt;
  const staleHours = updatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 3_600_000))
    : 0;
  return moderationInboxItemSchema.parse({
    id: `detection:${detection.id}`,
    guildId,
    kind: 'observed_alert',
    sourceId: detection.id,
    queueItemId: null,
    subject: { userId, displayLabel: userId, secondaryLabel: null, avatarUrl: null },
    title: 'Observed alert',
    summary: detection.reasons.join(' '),
    statusLabel: observedAction ?? (detection.latestCaseId ? 'case opened' : 'pending'),
    signalLabel: `${Math.round(detection.confidence * 100)}% confidence`,
    createdAt: detection.detectedAt,
    updatedAt,
    stale: staleHours >= 24,
    staleHours,
    detailHref: null,
    links: detection.sourceMessageUrl
      ? [{ label: 'Source message', url: detection.sourceMessageUrl }]
      : [],
    allowedActions: handled
      ? ['view_history', 'open_discord']
      : [
          'open_case',
          'view_history',
          'dismiss_no_action',
          'mark_false_positive',
          'kick_user',
          'ban_user',
          'open_discord',
        ],
  });
}
