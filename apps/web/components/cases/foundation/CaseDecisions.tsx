'use client';

import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import type { CaseDetail } from '@drasil/contracts';
import { ActionButton } from '@/components/inbox/foundation/Foundation';
import {
  caseDecisions,
  caseRequestLabel,
  decisionLabels,
  type CaseDecision,
  type CaseRequestState,
} from './caseReview';
import styles from './CaseWorkspace.module.css';

const effects: Record<
  CaseDecision,
  { readonly text: string; readonly tone: NonNullable<ComponentProps<typeof ActionButton>['tone']> }
> = {
  verify_user: {
    tone: 'positive',
    text: 'Remove the case role, attempt to restore eligible quarantined roles, and resolve all open cases for this member in this server as verified.',
  },
  close_no_action: {
    tone: 'neutral',
    text: 'Remove the case role, attempt to restore eligible quarantined roles, and close all open cases for this member in this server without a verification decision.',
  },
  kick_user: {
    tone: 'warning',
    text: 'Remove this member from the server and resolve their open cases here. They can rejoin with a valid invite.',
  },
  ban_user: {
    tone: 'danger',
    text: 'Ban this member from the server and resolve their open cases here. No message deletion requested.',
  },
};

export function CaseDecisions({
  detail,
  request,
  onAction,
  decisionId,
  presentation = 'section',
}: {
  readonly detail: CaseDetail;
  readonly request: CaseRequestState;
  readonly onAction: (action: CaseDecision, reason: string) => void;
  readonly decisionId: string;
  readonly presentation?: 'section' | 'bar';
}) {
  const [confirmation, setConfirmation] = useState<CaseDecision | null>(null);
  const [reason, setReason] = useState('');
  const id = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const receipt = useRef<HTMLDivElement>(null);
  const blocked =
    request.kind === 'submitting' ||
    (request.kind === 'settled' && request.result.status !== 'failed');
  const label = caseRequestLabel(request);
  useLayoutEffect(() => {
    if (confirmation) {
      heading.current?.focus({ preventScroll: true });
      form.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [confirmation]);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (
      request.kind !== 'ready' &&
      (request.kind === 'submitting' ||
        active === document.body ||
        receipt.current?.contains(active))
    ) {
      receipt.current?.focus({ preventScroll: true });
    }
  }, [request]);
  return (
    <section
      className={`${styles.decisions} ${presentation === 'bar' ? styles.decisionBar : ''}`}
      aria-label="Case decisions"
    >
      <div className={styles.sectionHeading}>
        <h2 id={decisionId} tabIndex={-1}>
          Decision
        </h2>
      </div>
      <div className={styles.actions}>
        {caseDecisions
          .filter((action) => detail.allowedActions.includes(action))
          .map((action) => (
            <ActionButton
              key={action}
              tone={effects[action].tone}
              disabled={blocked}
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setReason('');
                setConfirmation(action);
              }}
            >
              {decisionLabels[action]}
            </ActionButton>
          ))}
      </div>
      {confirmation && !blocked ? (
        <form
          ref={form}
          className={styles.confirmation}
          aria-labelledby={`${id}-heading`}
          onSubmit={(event) => {
            event.preventDefault();
            onAction(confirmation, reason.trim());
            setConfirmation(null);
          }}
        >
          <h3
            ref={heading}
            tabIndex={-1}
            id={`${id}-heading`}
            aria-describedby={`${id}-context ${id}-effect`}
          >
            {decisionLabels[confirmation]}?
          </h3>
          <p id={`${id}-context`} className={styles.confirmationContext}>
            <strong>{detail.userIdentity.displayLabel}</strong>
            <span>{detail.userId}</span>
            <span>{detail.id}</span>
          </p>
          <p id={`${id}-effect`}>{effects[confirmation].text}</p>
          {confirmation === 'kick_user' || confirmation === 'ban_user' ? (
            <label className={styles.reason}>
              Reason{' '}
              <span className={styles.muted} aria-hidden="true">
                Optional
              </span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
              />
            </label>
          ) : null}
          <div className={styles.actions}>
            <ActionButton
              onClick={() => {
                setConfirmation(null);
                trigger.current?.focus();
              }}
            >
              Cancel
            </ActionButton>
            <ActionButton type="submit" tone={effects[confirmation].tone}>
              {decisionLabels[confirmation]}
            </ActionButton>
          </div>
        </form>
      ) : null}
      {label ? (
        <div
          ref={receipt}
          tabIndex={-1}
          className={styles.request}
          role={
            request.kind === 'settled' && request.result.status === 'failed' ? 'alert' : 'status'
          }
        >
          <h3>{label}</h3>
          {request.kind === 'settled' && request.result.message ? (
            <p>{request.result.message}</p>
          ) : null}
          {request.kind === 'settled' && request.result.requestId ? (
            <p className={styles.muted}>Request {request.result.requestId}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
