'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseDetail, MessageCleanupJobDetail, ReportDetail } from '@drasil/contracts';
import type {
  WorkspaceMutation,
  WorkspaceMutationResult,
  WorkspaceConfirmedActionId,
} from '@/lib/workspaceActionTypes';
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
import { caseMaintenanceActions } from '@/lib/caseActionEffects';
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
  readonly id: WorkspaceConfirmedActionId;
  readonly frozenReason?: string;
  readonly finalizationOnly?: boolean;
  readonly label: string;
  readonly description: string;
  readonly tone?: ComponentProps<typeof ActionButton>['tone'];
  readonly reasonRequired?: boolean;
  readonly reasonMaxLength?: number;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** Existing preview, security generation or cleanup bindings, resolved again by the server. */
  readonly fields?: readonly { readonly name: string; readonly value: string }[];
}
export interface ConfirmedActionProps {
  readonly target: ConfirmedActionTarget;
  readonly action: ConfirmedActionDescriptor;
  readonly submit: WorkspaceMutation;
  readonly durableRequest: ModerationActionRequestSummary | null;
  readonly hideTrigger?: boolean;
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
  hideTrigger = false,
  cleanupJob = null,
  record = null,
}: ConfirmedActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invalidation, setInvalidation] = useState<string | null>(null);
  const invalidationNotice = useRef<HTMLParagraphElement>(null);
  const [openedIntent, setOpenedIntent] = useState<{
    readonly action: ConfirmedActionDescriptor;
    readonly target: ConfirmedActionTarget;
    readonly submit: WorkspaceMutation;
  } | null>(null);
  const intent = openedIntent ?? { action, target, submit };
  const intentChanged =
    open && JSON.stringify(intent.action.fields ?? []) !== JSON.stringify(action.fields ?? []);
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
    durableRequest &&
    matchesWorkspaceActionRequest(durableRequest, target, action.id) &&
    (![
      'preview_case_message_deletion',
      'execute_case_message_deletion',
      'ban_case_user_with_message_cleanup',
    ].includes(action.id) ||
      (durableRequest.cleanupIntentToken ===
        action.fields?.find((field) => field.name === 'idempotencyKey')?.value &&
        (!action.fields?.find((field) => field.name === 'jobId') ||
          durableRequest.messageDeletionJobId ===
            action.fields.find((field) => field.name === 'jobId')?.value)))
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
    intentChanged ||
    submission.kind === 'submitting' ||
    uncertain ||
    active ||
    presentation.kind === 'completed' ||
    receipt?.status === 'completed' ||
    durable?.status === 'completed' ||
    presentation.kind === 'banned_updates_pending' ||
    presentation.kind === 'ban_outcome_unknown' ||
    (presentation.kind === 'finalization_retry' && !action.finalizationOnly) ||
    blocksBanResubmission(durable)
  );
  useEffect(() => {
    if (!open || !blocked) return;
    const changedBinding = ['challenge_user', 'retry_captcha', 'bypass_captcha'].includes(action.id)
      ? 'The security check generation or configured method changed.'
      : action.id === 'quarantine_compromised_account'
        ? 'The reviewed quarantine preview changed.'
        : [
              'preview_case_message_deletion',
              'execute_case_message_deletion',
              'ban_case_user_with_message_cleanup',
            ].includes(action.id)
          ? 'The reviewed message cleanup scope or preview changed.'
          : 'The reviewed action details changed.';
    setInvalidation(
      intentChanged
        ? `${changedBinding} Review the current action before confirming.`
        : action.disabled
          ? (action.disabledReason ?? `${action.label} is no longer available for this record.`)
          : 'This action has a recorded request. Review its result before continuing.'
    );
    setOpen(false);
  }, [
    open,
    blocked,
    intentChanged,
    action.id,
    action.label,
    action.disabled,
    action.disabledReason,
  ]);
  useEffect(() => {
    if (!invalidation) return;
    const frame = requestAnimationFrame(() => {
      invalidationNotice.current?.focus({ preventScroll: true });
      invalidationNotice.current?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidation]);
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
    for (const field of intent.action.fields ?? []) formData.set(field.name, field.value);
    formData.set('confirmedRecordId', intent.target.recordId);
    if (intent.target.targetUserId !== null)
      formData.set('confirmedTargetUserId', intent.target.targetUserId);
    if (intent.target.returnTo) formData.set('returnTo', intent.target.returnTo);
    let result: WorkspaceMutationResult;
    try {
      result = await intent.submit(formData);
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
      {hideTrigger ? null : (
        <ActionButton
          ref={trigger}
          tone={action.tone}
          disabled={blocked}
          onClick={() => {
            setInvalidation(null);
            setOpenedIntent({ action, target, submit });
            setOpen(true);
          }}
        >
          {submission.kind === 'submitting' ? 'Submitting...' : action.label}
        </ActionButton>
      )}
      <ActionConfirmation
        open={open}
        targetLabel={intent.target.label}
        guildId={intent.target.guildId}
        actionLabel={intent.action.label}
        description={intent.action.description}
        reason={intent.action.frozenReason ?? reason}
        reasonReadOnly={intent.action.frozenReason !== undefined}
        reasonRequired={intent.action.reasonRequired ?? false}
        reasonMaxLength={intent.action.reasonMaxLength}
        blocked={blocked}
        onReasonChange={setReason}
        onCancel={cancel}
        onConfirm={(data) => {
          void confirm(data);
        }}
      />
      {invalidation ? (
        <p ref={invalidationNotice} tabIndex={-1} role="status">
          {invalidation}
        </p>
      ) : null}
      <ActionReceipt
        {...presentationInput}
        guildId={target.guildId}
        historicalCompletion={
          durable?.status === 'completed' &&
          target.kind === 'case' &&
          caseMaintenanceActions.some((id) => id === action.id)
        }
      />
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
