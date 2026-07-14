'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import {
  initialInboxActionState,
  type InboxActionState,
  type InboxActionStatus,
} from '@/lib/inboxActionState';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';

export type InboxStateAction = (
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;

function InboxSubmitButton({
  blocked,
  buttonClassName,
  buttonLabel,
  pendingLabel,
  submitting,
}: {
  readonly blocked: boolean;
  readonly buttonClassName: string;
  readonly buttonLabel: string;
  readonly pendingLabel: string;
  readonly submitting: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={buttonClassName} disabled={blocked || pending || submitting} type="submit">
      {pending || submitting ? pendingLabel : buttonLabel}
    </button>
  );
}

function statusClass(status: InboxActionStatus): string {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'failed':
      return 'error';
    case 'processing':
      return 'info';
    case 'queued':
      return 'warning';
    case 'idle':
      return 'neutral';
  }
}

function defaultMessage(status: InboxActionStatus): string {
  switch (status) {
    case 'completed':
      return 'Action completed.';
    case 'failed':
      return 'Action failed.';
    case 'processing':
      return 'Drasil is processing this action.';
    case 'queued':
      return 'Action queued for Drasil.';
    case 'idle':
      return '';
  }
}

export function InboxActionForm({
  action,
  buttonClassName = 'button secondary compact-button',
  buttonLabel,
  children,
  durableRequest,
  formClassName,
  pendingLabel = 'Submitting...',
  requestBaseHref,
}: {
  readonly action: InboxStateAction;
  readonly buttonClassName?: string;
  readonly buttonLabel: string;
  readonly children?: ReactNode;
  readonly durableRequest?: ModerationActionRequestSummary | null;
  readonly formClassName?: string;
  readonly pendingLabel?: string;
  readonly requestBaseHref?: string;
}) {
  const [localState, formAction] = useActionState(action, initialInboxActionState);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSubmitting(false);
  }, [localState]);
  const durableApplies =
    durableRequest !== null &&
    durableRequest !== undefined &&
    (localState.status === 'idle' || durableRequest.id === localState.requestId);
  const status = durableApplies ? durableRequest.status : localState.status;
  const requestId = durableApplies ? durableRequest.id : localState.requestId;
  const message = durableApplies
    ? (durableRequest.lastError ?? durableRequest.resultSummary ?? defaultMessage(status))
    : (localState.message ?? defaultMessage(status));
  const actionInFlight = status === 'queued' || status === 'processing';
  const showReceipt = status !== 'idle';

  return (
    <form
      action={formAction}
      aria-label={`${buttonLabel} action`}
      className={formClassName}
      onSubmit={() => setSubmitting(true)}
    >
      {children}
      <InboxSubmitButton
        blocked={actionInFlight}
        buttonClassName={buttonClassName}
        buttonLabel={buttonLabel}
        pendingLabel={pendingLabel}
        submitting={submitting}
      />
      {showReceipt ? (
        <div
          aria-live="polite"
          className={`action-receipt ${status === 'failed' ? 'danger-text' : ''}`}
          role={status === 'failed' ? 'alert' : 'status'}
        >
          <span className={`status ${statusClass(status)}`}>{status}</span>
          <span>{message}</span>
          {requestId && requestBaseHref ? (
            <a href={`${requestBaseHref}#request-${requestId}`}>View request</a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
