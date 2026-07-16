'use client';

import {
  MESSAGE_CLEANUP_REASON_MAX_LENGTH,
  type MessageCleanupCaseWorkspace,
  type MessageCleanupCoverage,
  type MessageCleanupJobDetail,
  type MessageCleanupJobMode,
  type MessageCleanupJobSummary,
  type MessageCleanupScope,
} from '@drasil/contracts';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { InboxActionForm, type InboxStateAction } from '@/components/inbox/InboxActionForm';
import {
  initialInboxActionState,
  isInboxActionInFlight,
  isInboxActionSubmitBlocked,
  type InboxActionState,
} from '@/lib/inboxActionState';
import {
  MessageCleanupItemList,
  MessageCleanupJobSummaryBlock,
  MessageCleanupOutcomes,
  messageCleanupStatusClass,
} from './MessageCleanupJobDetail';

export type MessageCleanupStateAction = (
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;

const scopeOptions: readonly { value: MessageCleanupScope; label: string }[] = [
  { value: 'source_message', label: 'Source message' },
  { value: 'last_hour', label: 'Last hour' },
  { value: 'last_day', label: 'Last 24 hours' },
  { value: 'last_7_days', label: 'Last 7 days' },
];

const coverageMessages: Record<MessageCleanupCoverage, string> = {
  ready: 'Discord returned complete coverage for this preview.',
  partial:
    'Only partial coverage was available. Execution is blocked unless this is the single source message.',
  indexing: 'Discord is still indexing message history. Preview again after indexing finishes.',
  denied: 'Drasil cannot search one or more channels required for this scope.',
  unavailable: 'Discord message search is currently unavailable for this scope.',
  too_many: 'This preview has more than the 100-message execution limit. Choose a narrower scope.',
};

const workspaceBlockedMessages: Record<
  NonNullable<MessageCleanupCaseWorkspace['blockedReason']>,
  string
> = {
  case_not_pending: 'Message cleanup is available only while the case is pending.',
  missing_target_user: 'This case does not have a target user.',
  missing_evidence_thread: 'Repair the case evidence thread before previewing messages.',
};

function isJobActive(job: MessageCleanupJobSummary | null): boolean {
  return Boolean(job && ['queued', 'discovering', 'executing'].includes(job.status));
}

function CleanupSubmitButton({
  blocked,
  label,
  pendingLabel,
}: {
  readonly blocked: boolean;
  readonly label: string;
  readonly pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button compact-button danger-button"
      disabled={blocked || pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function CleanupActionReceipt({ state }: { readonly state: InboxActionState }) {
  if (state.status === 'idle') {
    return null;
  }
  return (
    <div
      aria-live="polite"
      className={`action-receipt ${state.status === 'failed' ? 'danger-text' : ''}`}
      role={state.status === 'failed' ? 'alert' : 'status'}
    >
      <span className={`status ${messageCleanupStatusClass(state.status)}`}>{state.status}</span>
      <span>{state.message ?? 'Drasil is processing this request.'}</span>
    </div>
  );
}

function PreviewForm({
  action,
  mode,
}: {
  readonly action: MessageCleanupStateAction;
  readonly mode: MessageCleanupJobMode;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialInboxActionState);
  const [idempotencyToken, setIdempotencyToken] = useState('');

  useEffect(() => {
    setIdempotencyToken(`preview-${crypto.randomUUID()}`);
  }, []);

  useEffect(() => {
    if (!isInboxActionInFlight(state.status)) {
      return;
    }

    router.refresh();
    const interval = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [router, state.status]);

  return (
    <form action={formAction} className="cleanup-preview-form">
      <input name="idempotencyKey" type="hidden" value={idempotencyToken} />
      <input name="mode" type="hidden" value={mode} />
      <label className="field">
        <span>Scope</span>
        <select defaultValue="source_message" name="scope" required>
          {scopeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field cleanup-reason-field">
        <span>Reason</span>
        <textarea maxLength={MESSAGE_CLEANUP_REASON_MAX_LENGTH} name="reason" required rows={3} />
      </label>
      <button
        className="button secondary compact-button"
        disabled={!idempotencyToken || isInboxActionSubmitBlocked(state.status)}
        type="submit"
      >
        {isInboxActionInFlight(state.status) ? 'Previewing...' : 'Preview Messages'}
      </button>
      <CleanupActionReceipt state={state} />
    </form>
  );
}

function ExecuteForm({
  action,
  job,
}: {
  readonly action: MessageCleanupStateAction;
  readonly job: MessageCleanupJobSummary;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, initialInboxActionState);
  const count = job.outcomes.candidateCount;
  const combined = job.mode === 'ban_with_cleanup';
  const confirmationLabel = combined
    ? `Confirm ban and delete ${count} message${count === 1 ? '' : 's'}`
    : `Confirm delete ${count} message${count === 1 ? '' : 's'}`;

  useEffect(() => {
    if (!isInboxActionInFlight(state.status)) {
      return;
    }

    router.refresh();
    const interval = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [router, state.status]);

  return (
    <form action={formAction} className="cleanup-execute-form">
      <input name="idempotencyKey" type="hidden" value={`execute-${job.id}`} />
      <input name="jobId" type="hidden" value={job.id} />
      <input name="mode" type="hidden" value={job.mode} />
      <input name="reason" type="hidden" value={job.reason} />
      <input name="scope" type="hidden" value={job.scope} />
      <label className="checkbox-field destructive-confirm">
        <input name="confirmAction" required type="checkbox" />
        <span>{confirmationLabel}</span>
      </label>
      <CleanupSubmitButton
        blocked={!job.execution.canExecute || isInboxActionSubmitBlocked(state.status)}
        label={combined ? 'Ban User and Delete Messages' : 'Delete Messages'}
        pendingLabel="Queueing..."
      />
      <CleanupActionReceipt state={state} />
    </form>
  );
}

function JobReceipt({ job }: { readonly job: MessageCleanupJobSummary }) {
  return (
    <div className="cleanup-job-receipt" aria-live="polite">
      <span className={`status ${messageCleanupStatusClass(job.status)}`}>{job.status}</span>
      <span>
        {job.status === 'completed'
          ? `${job.outcomes.deletedCount} deleted, ${job.outcomes.changedSincePreviewCount} changed, ${job.outcomes.permissionDeniedCount + job.outcomes.deleteFailedCount + job.outcomes.evidenceFailedCount} failed.`
          : (job.lastError ?? 'Durable cleanup job recorded.')}
      </span>
      <a
        href={`/admin/guild/${job.guildId}/cases/${job.verificationEventId}/message-cleanup/${job.id}`}
      >
        View job
      </a>
    </div>
  );
}

export function CaseMessageCleanupControls({
  executeAction,
  jobDetail,
  mode = 'delete_only',
  previewAction,
  workspace,
}: {
  readonly executeAction: MessageCleanupStateAction;
  readonly jobDetail: MessageCleanupJobDetail | null;
  readonly mode?: MessageCleanupJobMode;
  readonly previewAction: MessageCleanupStateAction;
  readonly workspace: MessageCleanupCaseWorkspace;
}) {
  const router = useRouter();
  const latestJob = useMemo(
    () => workspace.latestJobs.find((job) => job.mode === mode) ?? null,
    [mode, workspace.latestJobs]
  );
  const detail = jobDetail?.mode === mode ? jobDetail : null;
  const [startNewPreview, setStartNewPreview] = useState(false);
  const [readyForInteraction, setReadyForInteraction] = useState(false);

  useEffect(() => {
    setReadyForInteraction(true);
  }, []);

  useEffect(() => {
    setStartNewPreview(false);
  }, [latestJob?.id]);

  useEffect(() => {
    if (!isJobActive(latestJob)) {
      return;
    }
    const interval = window.setInterval(() => router.refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [latestJob, router]);

  if (!latestJob && !workspace.canPreview) {
    return (
      <div className="cleanup-blocked" role="status">
        {workspace.blockedReason
          ? workspaceBlockedMessages[workspace.blockedReason]
          : 'Message cleanup is not available for this case.'}
      </div>
    );
  }

  if (!latestJob) {
    return <PreviewForm action={previewAction} mode={mode} />;
  }

  const coverageClass = latestJob.coverage
    ? messageCleanupStatusClass(latestJob.coverage)
    : 'neutral';

  return (
    <div className="cleanup-workspace">
      <MessageCleanupJobSummaryBlock job={latestJob} />
      <JobReceipt job={latestJob} />
      {latestJob.coverage ? (
        <div className={`cleanup-coverage ${coverageClass}`} role="status">
          <span className={`status ${coverageClass}`}>{latestJob.coverage}</span>
          <span>{coverageMessages[latestJob.coverage]}</span>
        </div>
      ) : null}
      <MessageCleanupOutcomes outcomes={latestJob.outcomes} />
      {latestJob.mode === 'ban_with_cleanup' ? (
        <div className="cleanup-lifecycle" aria-label="Combined action state">
          <span>
            Ban <strong>{latestJob.banStatus.split('_').join(' ')}</strong>
          </span>
          <span>
            Case finalization{' '}
            <strong>{latestJob.caseFinalizationStatus.split('_').join(' ')}</strong>
          </span>
        </div>
      ) : null}
      {detail ? <MessageCleanupItemList items={detail.items} /> : null}
      {startNewPreview ? (
        <div className="cleanup-new-preview-form">
          <h3>New preview</h3>
          <PreviewForm action={previewAction} mode={mode} />
        </div>
      ) : null}
      {latestJob.status === 'ready' ? (
        latestJob.execution.canExecute ? (
          <ExecuteForm action={executeAction} job={latestJob} />
        ) : (
          <p className="cleanup-blocked">
            This preview cannot execute: {latestJob.execution.blockedReason?.split('_').join(' ')}.
          </p>
        )
      ) : null}
      {!startNewPreview &&
      workspace.canPreview &&
      (latestJob.status === 'completed' ||
        latestJob.status === 'failed' ||
        (latestJob.status === 'ready' && !latestJob.execution.canExecute)) ? (
        <button
          className="button secondary compact-button cleanup-new-preview"
          disabled={!readyForInteraction}
          onClick={() => setStartNewPreview(true)}
          type="button"
        >
          Start new preview
        </button>
      ) : null}
      {!workspace.canPreview && workspace.blockedReason ? (
        <p className="cleanup-blocked">{workspaceBlockedMessages[workspace.blockedReason]}</p>
      ) : null}
    </div>
  );
}

export function CaseBanActionControl({
  cleanup,
  durableRequest,
  requestBaseHref,
  standardBanFormAction,
  standardBanStateAction,
}: {
  readonly cleanup?: {
    readonly executeAction: MessageCleanupStateAction;
    readonly jobDetail: MessageCleanupJobDetail | null;
    readonly previewAction: MessageCleanupStateAction;
    readonly workspace: MessageCleanupCaseWorkspace;
  };
  readonly durableRequest?: Parameters<typeof InboxActionForm>[0]['durableRequest'];
  readonly requestBaseHref: string;
  readonly standardBanFormAction?: (formData: FormData) => Promise<void>;
  readonly standardBanStateAction?: InboxStateAction;
}) {
  const [alsoDeleteMessages, setAlsoDeleteMessages] = useState(false);

  return (
    <details className="destructive-action cleanup-ban-action">
      <summary className="button secondary compact-button destructive-summary">Ban User</summary>
      <div className="destructive-action-panel cleanup-ban-panel">
        {cleanup ? (
          <label className="checkbox-field">
            <input
              checked={alsoDeleteMessages}
              name="alsoDeleteMessages"
              onChange={(event) => setAlsoDeleteMessages(event.target.checked)}
              type="checkbox"
            />
            <span>Also delete messages</span>
          </label>
        ) : null}
        {alsoDeleteMessages && cleanup ? (
          <CaseMessageCleanupControls
            executeAction={cleanup.executeAction}
            jobDetail={cleanup.jobDetail}
            mode="ban_with_cleanup"
            previewAction={cleanup.previewAction}
            workspace={cleanup.workspace}
          />
        ) : standardBanStateAction ? (
          <InboxActionForm
            action={standardBanStateAction}
            buttonClassName="button compact-button danger-button"
            buttonLabel="Queue Ban User"
            durableRequest={durableRequest}
            formClassName="cleanup-standard-ban-form"
            requestBaseHref={requestBaseHref}
          >
            <label className="field destructive-reason">
              <span>Reason</span>
              <textarea name="reason" rows={3} />
            </label>
            <label className="checkbox-field destructive-confirm">
              <input name="confirmAction" type="checkbox" />
              <span>Confirm Ban User</span>
            </label>
          </InboxActionForm>
        ) : standardBanFormAction ? (
          <form action={standardBanFormAction} className="cleanup-standard-ban-form">
            <label className="field destructive-reason">
              <span>Reason</span>
              <textarea name="reason" rows={3} />
            </label>
            <label className="checkbox-field destructive-confirm">
              <input name="confirmAction" type="checkbox" />
              <span>Confirm Ban User</span>
            </label>
            <button className="button compact-button danger-button" type="submit">
              Queue Ban User
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}
