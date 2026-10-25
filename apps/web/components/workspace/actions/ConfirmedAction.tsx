'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CaseDetail,
  MessageCleanupJobDetail,
  ModerationInboxAction,
  ReportDetail,
} from '@drasil/contracts';
import type { WorkspaceMutation, WorkspaceMutationResult } from '@/lib/workspaceActionTypes';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import {
  blocksBanResubmission,
  matchesWorkspaceActionRequest,
  type WorkspaceRequestTarget,
} from '@/lib/inboxActionReceipts';
import {
  shouldUseDurableWorkspaceActionResult,
  isStaleInboxActionFailure,
  workspaceRequestReceipt,
} from '@/lib/inboxActionState';
import { deriveWorkspaceActionPresentation } from '@/lib/workspaceActionPresentation';
import { useInboxActionRequestPolling } from '@/components/inbox/InboxActionRequestPoller';
import { ActionButton } from '../Foundation';
import { ActionConfirmation } from './ActionConfirmation';
import { ActionReceipt } from './ActionReceipt';

export interface ConfirmedActionTarget extends WorkspaceRequestTarget {
  readonly guildId: string;
  readonly label: string;
  /** Timestamp of a completed fresh read of this same guild and record. */
  readonly loadedAt: string;
  readonly returnTo?: string;
}
export interface ConfirmedActionDescriptor {
  readonly id: ModerationInboxAction;
  readonly label: string;
  readonly description: string;
  readonly tone?: ComponentProps<typeof ActionButton>['tone'];
  readonly reasonRequired?: boolean;
  readonly reasonMaxLength?: number;
  readonly disabled?: boolean;
  /** Existing preview, security generation or cleanup bindings, resolved again by the server. */
  readonly fields?: readonly { readonly name: string; readonly value: string }[];
}
export interface ConfirmedActionProps {
  readonly target: ConfirmedActionTarget;
  readonly action: ConfirmedActionDescriptor;
  readonly submit: WorkspaceMutation;
  readonly durableRequest: ModerationActionRequestSummary | null;
  readonly cleanupJob?: MessageCleanupJobDetail | null;
  readonly record?: CaseDetail | ReportDetail | null;
}
type SubmissionState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'uncertain'; readonly loadedAt: string; readonly refreshRequested: boolean };

export function ConfirmedAction(props: ConfirmedActionProps) {
  return (
    <ConfirmedActionIntent
      key={`${props.target.guildId}:${props.target.kind}:${props.target.recordId}:${props.target.targetUserId}:${props.action.id}`}
      {...props}
    />
  );
}
function ConfirmedActionIntent({
  target,
  action,
  submit,
  durableRequest,
  cleanupJob = null,
  record = null,
}: ConfirmedActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [localResult, setLocalResult] = useState<WorkspaceMutationResult | null>(null);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: 'ready' });
  const inSubmit = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const atSubmit = useRef<{ id: string | null; updatedAt: string | null }>({
    id: null,
    updatedAt: null,
  });
  const setLocalRequestActive = useInboxActionRequestPolling();
  const candidate =
    durableRequest && matchesWorkspaceActionRequest(durableRequest, target, action.id)
      ? durableRequest
      : null;
  const receipt = workspaceRequestReceipt(localResult);
  const freshAfterLostResponse =
    submission.kind === 'uncertain' &&
    candidate &&
    !isStaleInboxActionFailure(candidate, atSubmit.current.updatedAt) &&
    (candidate.id !== atSubmit.current.id || candidate.updatedAt !== atSubmit.current.updatedAt);
  const durable =
    candidate &&
    (submission.kind === 'uncertain' && !receipt
      ? freshAfterLostResponse
      : shouldUseDurableWorkspaceActionResult(localResult, candidate, atSubmit.current.updatedAt))
      ? candidate
      : null;
  const relevantRequestId = durable?.id ?? receipt?.id ?? null;
  const presentationInput = { localResult, durableRequest: durable, cleanupJob, record };
  const presentation = deriveWorkspaceActionPresentation(presentationInput);
  const active = presentation.kind === 'pending';
  const uncertain = submission.kind === 'uncertain' && !durable;
  const blocked = Boolean(
    action.disabled ||
    submission.kind === 'submitting' ||
    uncertain ||
    active ||
    presentation.kind === 'completed' ||
    presentation.kind === 'banned_updates_pending' ||
    presentation.kind === 'ban_outcome_unknown' ||
    presentation.kind === 'finalization_retry' ||
    blocksBanResubmission(durable)
  );
  useEffect(() => {
    if (!relevantRequestId || !active) return;
    setLocalRequestActive(relevantRequestId, true, atSubmit.current.updatedAt);
    return () => setLocalRequestActive(relevantRequestId, false);
  }, [active, relevantRequestId, setLocalRequestActive]);
  useEffect(() => {
    if (submission.kind !== 'uncertain') return;
    if (durable) {
      setLocalResult({
        kind: 'request',
        receipt: {
          id: durable.id,
          status: durable.status,
          messageDeletionJobId: durable.messageDeletionJobId,
        },
      });
      setSubmission({ kind: 'ready' });
    } else if (submission.refreshRequested && target.loadedAt !== submission.loadedAt) {
      setSubmission({ kind: 'ready' });
    }
  }, [durable, submission, target.loadedAt]);

  function cancel(): void {
    setOpen(false);
    trigger.current?.focus();
  }
  async function confirm(formData: FormData): Promise<void> {
    if (inSubmit.current || blocked) return;
    inSubmit.current = true;
    atSubmit.current = { id: candidate?.id ?? null, updatedAt: candidate?.updatedAt ?? null };
    setSubmission({ kind: 'submitting' });
    setOpen(false);
    for (const field of action.fields ?? []) formData.set(field.name, field.value);
    formData.set('confirmedRecordId', target.recordId);
    if (target.targetUserId !== null) formData.set('confirmedTargetUserId', target.targetUserId);
    if (target.returnTo) formData.set('returnTo', target.returnTo);
    let result: WorkspaceMutationResult;
    try {
      result = await submit(formData);
    } catch {
      result = {
        kind: 'failed',
        message: 'Response unavailable. Refresh durable state before another attempt.',
      };
    }
    setLocalResult(result);
    const failed =
      result.kind === 'failed' || (result.kind === 'request' && result.receipt.status === 'failed');
    setSubmission(
      failed
        ? { kind: 'uncertain', loadedAt: target.loadedAt, refreshRequested: false }
        : { kind: 'ready' }
    );
    inSubmit.current = false;
    router.refresh();
  }
  return (
    <div>
      <ActionButton
        ref={trigger}
        tone={action.tone}
        disabled={blocked}
        onClick={() => setOpen(true)}
      >
        {submission.kind === 'submitting' ? 'Submitting...' : action.label}
      </ActionButton>
      <ActionConfirmation
        open={open}
        targetLabel={target.label}
        actionLabel={action.label}
        description={action.description}
        reason={reason}
        reasonRequired={action.reasonRequired ?? false}
        reasonMaxLength={action.reasonMaxLength}
        blocked={blocked}
        onReasonChange={setReason}
        onCancel={cancel}
        onConfirm={(data) => {
          void confirm(data);
        }}
      />
      <ActionReceipt {...presentationInput} />
      {uncertain && submission.kind === 'uncertain' ? (
        <ActionButton
          disabled={submission.refreshRequested}
          onClick={() => {
            setSubmission({ kind: 'uncertain', loadedAt: target.loadedAt, refreshRequested: true });
            router.refresh();
          }}
        >
          {submission.refreshRequested ? 'Refreshing durable state...' : 'Refresh durable state'}
        </ActionButton>
      ) : null}
    </div>
  );
}
