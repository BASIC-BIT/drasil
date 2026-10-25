'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getMessageCleanupExecutionEligibility,
  isMessageCleanupFinalizationRetry,
  MESSAGE_CLEANUP_REASON_MAX_LENGTH,
  type MessageCleanupJobDetail,
  type MessageCleanupJobMode,
  type MessageCleanupScope,
} from '@drasil/contracts';
import type { WorkspaceActionPolicy } from '@/lib/moderationWorkspaceTypes';
import { adaptInboxStateAction, type CleanupActionId } from '@/lib/workspaceActionTypes';
import { ConfirmedAction } from '@/components/workspace/actions/ConfirmedAction';
import { ActionButton } from '@/components/workspace/Foundation';
import { Timestamp } from '@/components/workspace/Timestamp';
import type { CaseMessageCleanupIntegration } from './caseToolBindings';
import {
  MessageCleanupItemList,
  MessageCleanupJobSummaryBlock,
  MessageCleanupOutcomes,
} from './MessageCleanupJobDetail';
import styles from './MessageCleanupPanel.module.css';

const scopes: readonly { value: MessageCleanupScope; label: string }[] = [
  { value: 'source_message', label: 'Source message' },
  { value: 'last_hour', label: 'Last hour' },
  { value: 'last_day', label: 'Last 24 hours' },
  { value: 'last_7_days', label: 'Last 7 days' },
];
const coverageCopy = {
  ready: 'Complete coverage returned for this preview.',
  partial:
    'Partial coverage. Only a single source message can execute; time windows require a new complete preview.',
  denied: 'Search permission denied. Restore channel access and request a new preview.',
  indexing: 'Discord is indexing message history. Request a new preview after indexing finishes.',
  unavailable: 'Message search unavailable. Request a new preview when search is available.',
  too_many:
    'More than the 100-message execution limit. Choose a narrower scope and request a new preview.',
};

/** Job fields, never generic request completion, establish enforcement outcomes. */
export function MessageCleanupResult({ job }: { readonly job: MessageCleanupJobDetail }) {
  return (
    <div aria-live="polite" className={styles.result}>
      <p>
        Cleanup {job.status}. {job.outcomes.deletedCount} deleted,{' '}
        {job.outcomes.alreadyMissingCount} already missing, {job.outcomes.changedSincePreviewCount}{' '}
        changed,{' '}
        {job.outcomes.evidenceFailedCount +
          job.outcomes.deleteFailedCount +
          job.outcomes.permissionDeniedCount}{' '}
        failed.
      </p>
      {job.mode === 'ban_with_cleanup' ? (
        <p aria-label="Combined action state">
          Ban {job.banStatus.split('_').join(' ')}. Case finalization{' '}
          {job.caseFinalizationStatus.split('_').join(' ')}.
        </p>
      ) : null}
      {job.mode === 'ban_with_cleanup' && job.banStatus === 'pending' ? (
        <p>Ban outcome is not yet confirmed. Review the durable job before another ban attempt.</p>
      ) : null}
      {job.lastError ? <p>{job.lastError}</p> : null}
    </div>
  );
}

function CleanupExecution({
  integration,
  job,
  selected,
  busy,
  policy,
  finalizationOnly = false,
}: {
  readonly integration: CaseMessageCleanupIntegration;
  readonly job: MessageCleanupJobDetail;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly policy: WorkspaceActionPolicy;
  readonly finalizationOnly?: boolean;
}) {
  const [token, setToken] = useState('');
  useEffect(() => {
    setToken(`execute-${crypto.randomUUID()}`);
  }, []);
  const eligibility = getMessageCleanupExecutionEligibility({
    ...job,
    candidateCount: job.outcomes.candidateCount,
  });
  const combined = job.mode === 'ban_with_cleanup';
  const retry = isMessageCleanupFinalizationRetry(job);
  const id: CleanupActionId = combined
    ? 'ban_case_user_with_message_cleanup'
    : 'execute_case_message_deletion';
  const receipt =
    integration.requests.find(
      (request) =>
        request.actionType === id &&
        request.messageDeletionJobId === job.id &&
        request.cleanupIntentToken === token
    ) ?? null;
  const count = job.outcomes.candidateCount;
  const label = finalizationOnly
    ? 'Retry case finalization'
    : `${combined ? 'Ban and delete' : 'Delete'} ${count} message${count === 1 ? '' : 's'}`;
  const visible = selected && (finalizationOnly ? retry : !retry);
  return (
    <>
      {receipt?.status === 'failed' && visible ? (
        <ActionButton onClick={() => setToken(`execute-${crypto.randomUUID()}`)}>
          Review cleanup retry
        </ActionButton>
      ) : null}
      <ConfirmedAction
        key={token}
        target={{
          kind: 'case',
          guildId: integration.workspace.guildId,
          recordId: integration.workspace.verificationEventId,
          targetUserId: integration.workspace.targetUserId,
          label: `Member ${job.targetUserId} · Case ${job.verificationEventId}`,
          loadedAt: integration.loadedAt,
          returnTo: integration.returnHref,
        }}
        action={{
          id,
          label,
          tone: 'danger',
          finalizationOnly,
          reasonMaxLength: MESSAGE_CLEANUP_REASON_MAX_LENGTH,
          frozenReason: job.reason,
          description: finalizationOnly
            ? `Ban succeeded. Retry case finalization for job ${job.id}. This continues the same job without repeating ban or deletion.`
            : `${combined ? 'Ban this member, then preserve evidence and delete' : 'Preserve evidence and delete'} ${count} frozen message${count === 1 ? '' : 's'}. Scope: ${scopes.find((scope) => scope.value === job.scope)?.label}. Coverage: ${job.coverage ?? 'unknown'}. Preview: ${job.previewedAt ?? 'unknown'}. Job: ${job.id}. Changed messages are skipped.`,
          disabled:
            !visible ||
            busy ||
            !token ||
            !policy.canManageCleanup ||
            !eligibility.canExecute ||
            job.items.length !== count ||
            (combined &&
              !finalizationOnly &&
              !policy.allowedActions.some(
                (action) => action === 'ban_user' || action === 'ban_by_id'
              )),
          fields: [
            { name: 'jobId', value: job.id },
            { name: 'mode', value: job.mode },
            { name: 'scope', value: job.scope },
            { name: 'reason', value: job.reason },
            { name: 'expectedCandidateCount', value: String(count) },
            { name: 'expectedPreviewedAt', value: job.previewedAt ?? '' },
            { name: 'idempotencyKey', value: token },
          ],
        }}
        hideTrigger={!visible || !eligibility.canExecute || receipt?.status === 'failed'}
        submit={adaptInboxStateAction(
          combined ? integration.combinedBanAction : integration.executeAction
        )}
        durableRequest={receipt}
        cleanupJob={visible || receipt ? job : null}
      />
    </>
  );
}

export interface MessageCleanupPanelProps {
  readonly integration: CaseMessageCleanupIntegration;
  readonly policy: WorkspaceActionPolicy;
}
export function MessageCleanupPanel({ integration, policy }: MessageCleanupPanelProps) {
  const { workspace } = integration;
  const [mode, setMode] = useState<MessageCleanupJobMode>(
    integration.deleteOnlyJob
      ? 'delete_only'
      : integration.combinedJob
        ? 'ban_with_cleanup'
        : 'delete_only'
  );
  const [scope, setScope] = useState<MessageCleanupScope>(
    () => (integration.deleteOnlyJob ?? integration.combinedJob)?.scope ?? 'source_message'
  );
  const [previewToken, setPreviewToken] = useState('');
  const [previewVersion, setPreviewVersion] = useState(0);
  const [newPreview, setNewPreview] = useState(!workspace.latestJobs.length);
  useEffect(() => {
    setPreviewToken(`preview-${crypto.randomUUID()}`);
  }, [previewVersion]);
  const job = mode === 'delete_only' ? integration.deleteOnlyJob : integration.combinedJob;
  const summary = workspace.latestJobs.find((value) => value.mode === mode);
  const lastJobs = useRef(workspace.latestJobs.map((value) => value.id).join(':'));
  useEffect(() => {
    const ids = workspace.latestJobs.map((value) => value.id).join(':');
    if (ids !== lastJobs.current) {
      setNewPreview(false);
      lastJobs.current = ids;
    }
  }, [workspace.latestJobs]);
  const matching =
    job &&
    job.id === summary?.id &&
    job.previewedAt === summary.previewedAt &&
    job.outcomes.candidateCount === summary.outcomes.candidateCount &&
    job.scope === summary.scope &&
    job.mode === summary.mode &&
    job.reason === summary.reason &&
    job.guildId === workspace.guildId &&
    job.verificationEventId === workspace.verificationEventId &&
    job.targetUserId === workspace.targetUserId
      ? job
      : null;
  const eligibility = summary
    ? getMessageCleanupExecutionEligibility({
        ...summary,
        candidateCount: summary.outcomes.candidateCount,
      })
    : null;
  const previewRequest =
    integration.requests.find(
      (request) =>
        request.actionType === 'preview_case_message_deletion' &&
        request.cleanupIntentToken === previewToken
    ) ?? null;
  const busy =
    Boolean(summary && ['queued', 'discovering', 'executing'].includes(summary.status)) ||
    integration.requests.some(
      (request) =>
        request.verificationEventId === workspace.verificationEventId &&
        ['queued', 'processing'].includes(request.status)
    );
  if (!policy.canManageCleanup) return null;
  return (
    <section className={styles.panel} aria-label="Message cleanup">
      <h2>Message cleanup</h2>
      <div className={styles.options}>
        <label>
          Action
          <select
            aria-label="Cleanup action"
            value={mode}
            onChange={(event) => {
              const nextMode = event.target.value as MessageCleanupJobMode;
              const nextJob =
                nextMode === 'delete_only' ? integration.deleteOnlyJob : integration.combinedJob;
              setMode(nextMode);
              setScope(nextJob?.scope ?? 'source_message');
              setNewPreview(!nextJob);
            }}
          >
            <option value="delete_only">Delete messages</option>
            <option value="ban_with_cleanup">Ban and delete messages</option>
          </select>
        </label>
        <label>
          Scope
          <select
            aria-label="Scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as MessageCleanupScope);
              setNewPreview(true);
            }}
          >
            {scopes.map((value) => (
              <option key={value.value} value={value.value}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {integration.requests
        .filter(
          (request) =>
            request.messageDeletionJobId === summary?.id &&
            request.verificationEventId === workspace.verificationEventId &&
            request.targetUserId === workspace.targetUserId &&
            request.status === 'failed'
        )
        .slice(0, 1)
        .map((request) => (
          <p role="status" key={request.id}>
            Request failed:{' '}
            {request.lastError ?? request.resultSummary ?? 'Review the job before retrying.'}
          </p>
        ))}
      {summary ? (
        <>
          <MessageCleanupJobSummaryBlock job={summary} />
          <p className={styles.coverage} role="status">
            Coverage: {summary.coverage ?? 'pending'}.{' '}
            {summary.coverage ? coverageCopy[summary.coverage] : ''}
          </p>
          <p>
            Previewed <Timestamp value={summary.previewedAt} />. Window:{' '}
            <Timestamp value={summary.requestedWindowStart} /> to{' '}
            <Timestamp value={summary.requestedWindowEnd} />.
          </p>
          <MessageCleanupOutcomes outcomes={summary.outcomes} />
          {matching ? (
            <>
              <MessageCleanupResult job={matching} />
              <MessageCleanupItemList
                items={matching.items}
                channelNames={integration.channelNames}
              />
            </>
          ) : (
            <p>Open the job to review every frozen message before execution.</p>
          )}
          <a
            href={`/admin/guild/${workspace.guildId}/cases/${workspace.verificationEventId}/message-cleanup/${summary.id}`}
          >
            View cleanup job
          </a>
          {eligibility && !eligibility.canExecute && summary.status === 'ready' ? (
            <p>
              Execution blocked: {eligibility.blockedReason?.split('_').join(' ')}. Request a new
              preview.
            </p>
          ) : null}
        </>
      ) : null}
      {[integration.deleteOnlyJob, integration.combinedJob]
        .filter((value): value is MessageCleanupJobDetail => value !== null)
        .map((value) => (
          <div key={value.id}>
            <CleanupExecution
              integration={integration}
              policy={policy}
              busy={busy}
              job={value}
              selected={matching?.id === value.id && scope === value.scope && !newPreview}
            />
            {value.mode === 'ban_with_cleanup' ? (
              <CleanupExecution
                integration={integration}
                policy={policy}
                busy={busy}
                job={value}
                selected={matching?.id === value.id && scope === value.scope && !newPreview}
                finalizationOnly
              />
            ) : null}
          </div>
        ))}
      {workspace.canPreview && !newPreview ? (
        <ActionButton
          disabled={busy}
          onClick={() => {
            setNewPreview(true);
            setPreviewVersion((value) => value + 1);
          }}
        >
          New preview
        </ActionButton>
      ) : null}
      {previewRequest?.status === 'failed' ? (
        <ActionButton onClick={() => setPreviewVersion((value) => value + 1)}>
          Review preview retry
        </ActionButton>
      ) : null}
      {workspace.canPreview ? (
        <ConfirmedAction
          hideTrigger={!newPreview}
          key={previewVersion}
          target={{
            kind: 'case',
            guildId: workspace.guildId,
            recordId: workspace.verificationEventId,
            targetUserId: workspace.targetUserId,
            label: `Member ${workspace.targetUserId} · Case ${workspace.verificationEventId}`,
            loadedAt: integration.loadedAt,
            returnTo: integration.returnHref,
          }}
          action={{
            id: 'preview_case_message_deletion',
            label: 'Preview messages',
            description: `Create a saved preview for ${scopes.find((value) => value.value === scope)?.label}. Action: ${mode === 'delete_only' ? 'delete messages' : 'ban and delete messages'}. Preview limit 500; execution limit 100 messages.`,
            reasonRequired: true,
            reasonMaxLength: MESSAGE_CLEANUP_REASON_MAX_LENGTH,
            disabled: !previewToken || busy || !newPreview,
            fields: [
              { name: 'mode', value: mode },
              { name: 'scope', value: scope },
              { name: 'idempotencyKey', value: previewToken },
            ],
          }}
          submit={adaptInboxStateAction(integration.previewAction)}
          durableRequest={previewRequest}
        />
      ) : null}
      {!workspace.canPreview ? (
        <p>
          New preview unavailable:{' '}
          {workspace.blockedReason?.split('_').join(' ') ?? 'case unavailable'}.
        </p>
      ) : null}
    </section>
  );
}
