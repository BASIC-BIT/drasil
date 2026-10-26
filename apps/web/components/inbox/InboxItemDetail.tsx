'use client';

import { CaseEvidenceReader } from '@/components/cases/CaseEvidenceReader';
import { recordLabel } from '@/components/cases/caseRecordLabel';
import {
  CaseWorkspaceController,
  type CaseCleanupActions,
} from '@/components/cases/CaseWorkspaceController';
import { ChannelConversation } from '@/components/cases/ChannelConversation';
import {
  ConfirmedAction,
  type ConfirmedActionDescriptor,
} from '@/components/workspace/actions/ConfirmedAction';
import { Timestamp } from '@/components/workspace/Timestamp';
import { filterCaseKindActions } from '@/lib/caseActionEligibility';
import type { ConversationSource } from '@/lib/conversationTypes';
import {
  matchesWorkspaceActionRequest,
  type WorkspaceRequestTarget,
} from '@/lib/inboxActionReceipts';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { ReplyReadState, WorkspaceItemDetail } from '@/lib/moderationWorkspaceTypes';
import type { WorkspaceActions, WorkspaceMutation } from '@/lib/workspaceActionTypes';
import {
  moderationInboxActionSchema,
  type ModerationInboxAction,
  type ReportEvidenceItem,
} from '@drasil/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { inboxKindLabels } from './InboxQueue';
import styles from './InboxWorkspace.module.css';

export function inboxDetailRequests(
  detail: WorkspaceItemDetail
): readonly ModerationActionRequestSummary[] {
  switch (detail.kind) {
    case 'case':
      return detail.data.requests;
    case 'submitted_report':
    case 'observed_alert':
      return detail.requests;
    case 'report_attention':
    case 'support_attention':
    case 'pending_screening':
      return [];
  }
}
function requestTarget(detail: WorkspaceItemDetail): WorkspaceRequestTarget {
  return {
    kind:
      detail.kind === 'report_attention' ||
      detail.kind === 'support_attention' ||
      detail.kind === 'pending_screening'
        ? 'attention'
        : detail.kind,
    recordId:
      detail.kind === 'report_attention' || detail.kind === 'support_attention'
        ? (detail.item.queueItemId ?? detail.item.sourceId)
        : detail.item.sourceId,
    targetUserId: detail.item.subject.userId,
  };
}
export function matchingInboxRequests(
  detail: WorkspaceItemDetail
): readonly ModerationActionRequestSummary[] {
  const target = requestTarget(detail);
  return inboxDetailRequests(detail).filter((request) =>
    [
      ...moderationInboxActionSchema.options,
      ...([
        'preview_case_message_deletion',
        'execute_case_message_deletion',
        'ban_case_user_with_message_cleanup',
      ] as const),
    ].some((action) => matchesWorkspaceActionRequest(request, target, action))
  );
}
const routineCaseActions: readonly ModerationInboxAction[] = [
  'verify_user',
  'close_no_action',
  'kick_user',
  'ban_user',
];
function actionTone(action: ModerationInboxAction): ConfirmedActionDescriptor['tone'] {
  switch (action) {
    case 'verify_user':
      return 'positive';
    case 'kick_user':
      return 'warning';
    case 'ban_user':
    case 'ban_by_id':
      return 'danger';
    default:
      return 'neutral';
  }
}
// Specialized preview/generation-bound controls are composed by the later case-tool controller.
function detailActions(detail: WorkspaceItemDetail): readonly ModerationInboxAction[] {
  switch (detail.kind) {
    case 'case':
      return filterCaseKindActions(detail.data.detail, [
        ...routineCaseActions,
        'ban_by_id',
        'sync_existing_ban',
        'refresh_notification',
        'repair_thread',
        'create_thread',
        'reopen_case',
      ]);
    case 'submitted_report':
      return ['open_case', 'ban_user', 'mark_actioned', 'dismiss_no_action', 'mark_false_positive'];
    case 'observed_alert':
      return ['open_case', 'kick_user', 'ban_user', 'dismiss_no_action', 'mark_false_positive'];
    case 'report_attention':
    case 'support_attention':
      return detail.item.queueItemId ? ['acknowledge'] : [];
    case 'pending_screening':
      return [];
  }
}
function actionLabel(action: ModerationInboxAction, detail: WorkspaceItemDetail): string {
  switch (action) {
    case 'verify_user':
      return detail.kind === 'case' && detail.data.detail.caseKind === 'compromised_account'
        ? 'Verify and release'
        : 'Verify member';
    case 'kick_user':
      return 'Kick member';
    case 'ban_user':
      return 'Ban member';
    case 'ban_by_id':
      return 'Ban by ID';
    case 'open_case':
      return 'Open case';
    case 'close_no_action':
      return 'Close case';
    case 'dismiss_no_action':
      return detail.kind === 'submitted_report' ? 'Dismiss report' : 'Dismiss alert';
    case 'mark_false_positive':
      return 'Mark false positive';
    case 'mark_actioned':
      return 'Mark report actioned';
    case 'acknowledge':
      return 'Acknowledge reply';
    default:
      return recordLabel(action).replace(/^./, (letter) => letter.toUpperCase());
  }
}
function actionEffect(action: ModerationInboxAction, detail: WorkspaceItemDetail): string {
  switch (action) {
    case 'ban_user':
    case 'ban_by_id':
      return 'Ban this member from the server. No message deletion requested.';
    case 'kick_user':
      return 'Remove this member from the server.';
    case 'verify_user':
      return 'Verify the member and remove the case role.';
    case 'open_case':
      return 'Open a moderation case and apply the configured case role.';
    case 'close_no_action':
      return 'Close this case without recording an enforcement decision.';
    case 'dismiss_no_action':
      return 'Close this record without taking moderation action.';
    case 'mark_false_positive':
      return 'Record this detection or report as a false positive.';
    case 'mark_actioned':
      return 'Record that this report has been actioned.';
    case 'acknowledge':
      return `Clear this reply from the attention queue. The conversation remains available in Discord.${detail.kind === 'support_attention' && detail.subtype !== 'support_reply' ? ' This does not establish account recovery or release quarantine.' : ''}`;
    case 'sync_existing_ban':
      return 'Update this case from the existing Discord ban.';
    case 'refresh_notification':
      return 'Refresh the case notification in Discord.';
    case 'repair_thread':
    case 'create_thread':
      return 'Create or repair this case thread in Discord.';
    case 'reopen_case':
      return 'Reopen this moderation case.';
    default:
      return recordLabel(action);
  }
}
function bindAction(
  detail: WorkspaceItemDetail,
  action: ModerationInboxAction,
  actions: WorkspaceActions
): WorkspaceMutation | null {
  const guildId = detail.item.guildId;
  switch (detail.kind) {
    case 'case':
      if (
        action === 'verify_user' ||
        action === 'kick_user' ||
        action === 'ban_user' ||
        action === 'ban_by_id' ||
        action === 'sync_existing_ban' ||
        action === 'refresh_notification' ||
        action === 'repair_thread' ||
        action === 'create_thread' ||
        action === 'reopen_case' ||
        action === 'close_no_action'
      )
        return (form) =>
          actions.caseAction({ guildId, caseId: detail.item.sourceId, action }, form);
      return null;
    case 'submitted_report':
      if (
        action === 'open_case' ||
        action === 'ban_user' ||
        action === 'mark_actioned' ||
        action === 'dismiss_no_action' ||
        action === 'mark_false_positive'
      )
        return (form) =>
          actions.reportAction({ guildId, reportId: detail.item.sourceId, action }, form);
      return null;
    case 'observed_alert':
      if (
        action === 'open_case' ||
        action === 'kick_user' ||
        action === 'ban_user' ||
        action === 'dismiss_no_action' ||
        action === 'mark_false_positive'
      )
        return (form) =>
          actions.observedAction({ guildId, detectionId: detail.item.sourceId, action }, form);
      return null;
    case 'report_attention':
    case 'support_attention': {
      const queueItemId = detail.item.queueItemId;
      return action === 'acknowledge' && queueItemId
        ? (form) => actions.attentionAction({ guildId, queueItemId }, form)
        : null;
    }
    case 'pending_screening':
      return null;
  }
}
function isAllowed(detail: WorkspaceItemDetail, action: ModerationInboxAction): boolean {
  if (
    !detail.policy.allowedActions.includes(action) ||
    !detail.item.allowedActions.includes(action)
  )
    return false;
  if (detail.kind === 'case')
    return (
      detail.policy.canQueueCaseActions &&
      detail.data.detail.allowedActions.some((value) => value === action)
    );
  if (detail.kind === 'submitted_report')
    return (
      (action !== 'open_case' || detail.policy.canOpenReportCases) &&
      detail.report.allowedActions.some((value) => value === action)
    );
  if (detail.kind === 'observed_alert') return detail.policy.canQueueCaseActions;
  return true;
}
function ReportEvidence({
  items,
  sources = [],
}: {
  readonly items: readonly ReportEvidenceItem[];
  readonly sources?: readonly ConversationSource[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const source = sources.find(
    (item) => `${item.recordKind}:${item.recordId}:${item.sourceKey}` === selected
  );
  function back(): void {
    setSelected(null);
    trigger.current?.focus();
    trigger.current?.scrollIntoView({ block: 'center' });
  }
  return (
    <section aria-label="Report evidence">
      <h2>Report evidence</h2>
      {selected ? (
        source ? (
          <ChannelConversation source={source} onBackToSource={back} />
        ) : (
          <section aria-label="Channel conversation">
            <p>This conversation is no longer available.</p>
            <button onClick={back}>Back to source</button>
          </section>
        )
      ) : null}
      {items.length ? (
        items.map((item) => (
          <article key={item.id} className={styles.source}>
            <h3>{recordLabel(item.kind)}</h3>
            <Timestamp value={item.createdAt} prefix="Recorded" />
            {item.content !== null ? (
              <blockquote>{item.content}</blockquote>
            ) : !item.attachment ? (
              <p>Content not recorded.</p>
            ) : null}
            {item.attachment ? (
              <p>
                {item.attachment.url ? (
                  <a href={item.attachment.url} target="_blank" rel="noreferrer">
                    {item.attachment.name ?? 'Attachment'}
                  </a>
                ) : (
                  `${item.attachment.name ?? 'Attachment'} · Link unavailable`
                )}
                {item.attachment.contentType ? ` · ${item.attachment.contentType}` : ''}
                {item.attachment.size !== null ? ` · ${item.attachment.size} bytes` : ''}
              </p>
            ) : null}
            {sources.some((candidate) => candidate.sourceKey === `evidence:${item.id}`) ? (
              <button
                onClick={(event) => {
                  const descriptor = sources.find(
                    (candidate) => candidate.sourceKey === `evidence:${item.id}`
                  );
                  if (descriptor) {
                    trigger.current = event.currentTarget;
                    setSelected(
                      `${descriptor.recordKind}:${descriptor.recordId}:${descriptor.sourceKey}`
                    );
                  }
                }}
              >
                View conversation
              </button>
            ) : null}
            {item.sourceMessageUrl ? (
              <a href={item.sourceMessageUrl} target="_blank" rel="noreferrer">
                View source in Discord
              </a>
            ) : null}
          </article>
        ))
      ) : (
        <p>No evidence attached.</p>
      )}
    </section>
  );
}
function Reply({ reply }: { readonly reply: ReplyReadState }) {
  return (
    <section aria-label="Latest reply">
      <h2>Latest reply</h2>
      {reply.kind === 'available' ? (
        <>
          <p>
            {reply.message.authorLabel} · <Timestamp value={reply.message.timestamp} />
          </p>
          <blockquote>{reply.message.content}</blockquote>
          {reply.message.attachments.map((attachment) => (
            <p key={attachment.id}>
              {attachment.url ? (
                <a href={attachment.url} target="_blank" rel="noreferrer">
                  {attachment.filename ?? 'Attachment'}
                </a>
              ) : (
                `${attachment.filename ?? 'Attachment'} · Link unavailable`
              )}
            </p>
          ))}
          <a href={reply.message.url} target="_blank" rel="noreferrer">
            Open reply in Discord
          </a>
        </>
      ) : (
        <>
          <p>Reply unavailable</p>
          {reply.sourceUrl ? (
            <a href={reply.sourceUrl} target="_blank" rel="noreferrer">
              Open reply in Discord
            </a>
          ) : null}
        </>
      )}
    </section>
  );
}
export interface InboxItemDetailProps {
  readonly detail: WorkspaceItemDetail;
  readonly loadedAt: string;
  readonly returnHref: string;
  readonly trackedRequestId: string | null;
  readonly actions: WorkspaceActions;
  readonly onTrackedRequest: (id: string) => void;
  readonly available?: boolean;
  readonly cleanupActions?: CaseCleanupActions;
}
export function InboxItemDetail(props: InboxItemDetailProps) {
  return <SelectedDetail key={`${props.detail.item.guildId}:${props.detail.item.id}`} {...props} />;
}
function SelectedDetail({
  detail,
  loadedAt,
  returnHref,
  trackedRequestId,
  actions,
  onTrackedRequest,
  available = true,
  cleanupActions,
}: InboxItemDetailProps) {
  const { item } = detail;
  const currentActions = useMemo(
    () => detailActions(detail).filter((action) => isAllowed(detail, action)),
    [detail]
  );
  const [offered, setOffered] = useState(currentActions);
  const [pendingTrack, setPendingTrack] = useState<string | null>(null);
  const retainedActions = detailActions(detail).filter(
    (action) => offered.includes(action) || currentActions.includes(action)
  );
  const primaryActions =
    detail.kind === 'case'
      ? retainedActions.filter((action) => routineCaseActions.includes(action))
      : retainedActions;
  const maintenanceActions =
    detail.kind === 'case'
      ? retainedActions.filter((action) => !routineCaseActions.includes(action))
      : [];
  const scopedRequests = useMemo(() => matchingInboxRequests(detail), [detail]);
  useEffect(() => {
    setOffered((previous) =>
      currentActions.every((id) => previous.includes(id))
        ? previous
        : [...new Set([...previous, ...currentActions])]
    );
  }, [currentActions]);
  useEffect(() => {
    if (
      pendingTrack &&
      scopedRequests.some((request) => request.id === pendingTrack) &&
      trackedRequestId !== pendingTrack
    )
      onTrackedRequest(pendingTrack);
  }, [pendingTrack, scopedRequests, trackedRequestId, onTrackedRequest]);
  const target = {
    ...requestTarget(detail),
    guildId: item.guildId,
    label: `${item.subject.displayLabel}${item.subject.userId ? ` · ${item.subject.userId}` : ''} · ${item.sourceId}`,
    loadedAt,
    returnTo: returnHref,
  };
  const record =
    detail.kind === 'case'
      ? detail.data.detail
      : detail.kind === 'submitted_report'
        ? detail.report
        : null;
  function returnLink(href: string): string {
    const prefix = `/admin/guild/${encodeURIComponent(item.guildId)}/`;
    if (
      !href.startsWith(prefix) ||
      (!href.startsWith(`${prefix}cases/`) && !href.startsWith(`${prefix}reports/`))
    )
      return href;
    const url = new URL(href, 'https://internal.invalid');
    url.searchParams.set('returnTo', returnHref);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  const prefix = `/admin/guild/${encodeURIComponent(item.guildId)}`;
  const recordHref =
    detail.kind === 'case'
      ? `${prefix}/cases/${encodeURIComponent(detail.data.detail.id)}`
      : detail.kind === 'submitted_report'
        ? `${prefix}/reports/${encodeURIComponent(detail.report.id)}`
        : detail.kind === 'report_attention'
          ? `${prefix}/reports/${encodeURIComponent(detail.intake.id)}`
          : detail.kind === 'support_attention' && (detail.caseData || item.sourceMetadata?.caseId)
            ? `${prefix}/cases/${encodeURIComponent(detail.caseData?.detail.id ?? item.sourceMetadata?.caseId ?? '')}`
            : item.detailHref;
  function renderAction(action: ModerationInboxAction) {
    const submit = bindAction(detail, action, actions);
    if (!submit) return null;
    const matching = scopedRequests.filter((request) =>
      matchesWorkspaceActionRequest(request, target, action)
    );
    const durable =
      matching.find((request) => request.id === trackedRequestId) ?? matching[0] ?? null;
    return (
      <ConfirmedAction
        key={action}
        target={target}
        action={{
          id: action,
          tone: actionTone(action),
          label: actionLabel(action, detail),
          description: `${target.label}. ${action === 'verify_user' && detail.kind === 'case' && detail.data.detail.caseKind === 'compromised_account' ? 'Confirm account recovery, release quarantine, restore eligible snapshotted roles under current role policy, and resolve this case.' : actionEffect(action, detail)}`,
          disabled: !available || !isAllowed(detail, action),
          reasonRequired:
            action === 'kick_user'
              ? detail.policy.kickReasonRequired
              : action === 'ban_user' || action === 'ban_by_id'
                ? detail.policy.banReasonRequired
                : false,
        }}
        durableRequest={durable}
        record={record}
        cleanupJob={
          detail.kind === 'case' && durable?.messageDeletionJobId
            ? (detail.data.cleanup?.jobs.find((job) => job.id === durable.messageDeletionJobId) ??
              null)
            : null
        }
        submit={async (form) => {
          const result = await submit(form);
          if (result.kind === 'request') setPendingTrack(result.receipt.id);
          return result;
        }}
      />
    );
  }
  if (detail.kind === 'case')
    return (
      <CaseWorkspaceController
        data={{ ...detail.data, loadedAt }}
        actions={actions}
        cleanupActions={cleanupActions}
        returnHref={returnHref}
        actionArea={
          <section className={styles.actions} aria-label="Case decisions">
            {primaryActions.map(renderAction)}
          </section>
        }
        maintenance={
          maintenanceActions.length ? (
            <section className={styles.actions} aria-label="Case maintenance">
              {maintenanceActions.map(renderAction)}
            </section>
          ) : null
        }
      />
    );
  return (
    <article>
      <header>
        <p className={styles.muted}>
          {inboxKindLabels[detail.kind]} · {recordLabel(item.statusLabel)}
        </p>
        <h1>{item.subject.displayLabel}</h1>
        <p>{item.title}</p>
        {detail.kind === 'report_attention' ? (
          <>
            <p>Reporter ID {detail.intake?.reporterId ?? item.subject.userId}</p>
            {detail.intake?.targetUserId ? (
              <p>Target ID {detail.intake.targetUserId}</p>
            ) : (
              <p>Target not confirmed</p>
            )}
          </>
        ) : item.subject.userId ? (
          <p>Member ID {item.subject.userId}</p>
        ) : (
          <p>Target not confirmed</p>
        )}
        <p>
          Updated <Timestamp value={item.updatedAt} />
        </p>
        {item.summary !== null ? <p>{item.summary}</p> : null}
      </header>
      <div className={styles.links}>
        {recordHref ? (
          <a href={returnLink(recordHref)}>
            {detail.kind === 'submitted_report' || detail.kind === 'report_attention'
              ? 'Open report'
              : 'Open case'}
          </a>
        ) : null}
        {item.subject.userId ? (
          <a
            href={`/admin/guild/${encodeURIComponent(item.guildId)}/members/${encodeURIComponent(item.subject.userId)}`}
          >
            Member history
          </a>
        ) : null}
        {item.links.map((link) => (
          <a
            key={`${link.label}:${link.url}`}
            href={returnLink(link.url)}
            target={link.url.startsWith('https://') ? '_blank' : undefined}
            rel={link.url.startsWith('https://') ? 'noreferrer' : undefined}
          >
            {link.label}
          </a>
        ))}
      </div>
      {primaryActions.length ? (
        <section className={styles.actions} aria-label="Moderation actions">
          {primaryActions.map(renderAction)}
        </section>
      ) : null}
      {maintenanceActions.length ? (
        <details className={styles.tools}>
          <summary>Case tools</summary>
          <div className={styles.actions}>{maintenanceActions.map(renderAction)}</div>
        </details>
      ) : null}
      {detail.kind === 'submitted_report' ? (
        <>
          <dl>
            <dt>Reporter</dt>
            <dd>{detail.report.reporterDisplayName ?? detail.report.reporterId}</dd>
            <dt>Submitted</dt>
            <dd>
              <Timestamp value={detail.report.createdAt} />
            </dd>
          </dl>
          <ReportEvidence items={detail.report.evidence} sources={detail.conversationSources} />
        </>
      ) : detail.kind === 'observed_alert' ? (
        <section>
          <h2>Detection</h2>
          <p>
            {recordLabel(detail.detection.detectionType)} ·{' '}
            {Math.round(detail.detection.confidence * 100)}% confidence
          </p>
          <p>
            Detected <Timestamp value={detail.detection.detectedAt} />
          </p>
          <ul>
            {detail.detection.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
          {detail.detection.sourceMessageUrl ? (
            <a href={detail.detection.sourceMessageUrl} target="_blank" rel="noreferrer">
              Open detection in Discord
            </a>
          ) : null}
        </section>
      ) : detail.kind === 'report_attention' ? (
        <>
          <p>
            Report {detail.intake.id} · {recordLabel(detail.intake.status)}
          </p>
          <Reply reply={detail.reply} />
          <ReportEvidence items={detail.intake.evidence} />
        </>
      ) : detail.kind === 'support_attention' ? (
        <>
          <p>
            {detail.subtype === 'quarantine_breach'
              ? 'Containment breach'
              : detail.subtype === 'recovery_reply'
                ? 'Account recovery reply'
                : 'Support reply'}
          </p>
          <Reply reply={detail.reply} />
          {detail.caseData ? (
            <CaseEvidenceReader detail={detail.caseData.detail} report={detail.caseData.report} />
          ) : null}
        </>
      ) : (
        <section>
          <h2>Discord membership screening</h2>
          <dl>
            <dt>Pending since</dt>
            <dd>
              <Timestamp value={detail.screening.pendingSince} />
            </dd>
            <dt>Attention threshold</dt>
            <dd>
              {detail.screening.thresholdDays === null
                ? 'Threshold not recorded'
                : `${detail.screening.thresholdDays} days`}
            </dd>
            <dt>Last checked</dt>
            <dd>
              <Timestamp value={detail.screening.lastCheckedAt} />
            </dd>
          </dl>
        </section>
      )}
    </article>
  );
}
