'use client';

import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import type { ReportDetail } from '@drasil/contracts';
import { ActionButton } from './Foundation';
import {
  actionLabels,
  isReportClosed,
  reportName,
  reportActionLabel,
  type ReportReviewState,
  type ReportTriageAction,
} from './reportTriage';
import styles from './ReportInbox.module.css';

const confirmations: Record<
  ReportTriageAction,
  {
    readonly heading: string;
    readonly effect: string;
    readonly tone: NonNullable<ComponentProps<typeof ActionButton>['tone']>;
  }
> = {
  open_case: {
    heading: 'Open a case?',
    effect: 'Apply the case role and open a member-visible case thread.',
    tone: 'warning',
  },
  dismiss_no_action: {
    heading: 'Dismiss this report?',
    effect: 'Close this report without taking action against the member.',
    tone: 'neutral',
  },
  mark_false_positive: {
    heading: 'Mark this report as a false positive?',
    effect: 'Mark this report as a false positive and close it.',
    tone: 'positive',
  },
  mark_actioned: {
    heading: 'Mark this report as handled?',
    effect: 'Close this report as handled based on action already taken.',
    tone: 'neutral',
  },
};

const actions: readonly ReportTriageAction[] = [
  'open_case',
  'dismiss_no_action',
  'mark_false_positive',
  'mark_actioned',
];

interface ReportActionsProps {
  readonly report: ReportDetail;
  readonly state: ReportReviewState;
  readonly onAction: (action: ReportTriageAction) => void;
  readonly onNext: () => void;
  readonly hasNext: boolean;
}

export function ReportActions({ report, state, onAction, onNext, hasNext }: ReportActionsProps) {
  const [confirmationAction, setConfirmationAction] = useState<ReportTriageAction | null>(null);
  const confirmationId = useId();
  const submitting = state.kind === 'submitting';
  const result = state.kind === 'settled' ? state.result : null;
  const closed = isReportClosed(state);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const receipt = useRef<HTMLDivElement>(null);
  const confirmationForm = useRef<HTMLFormElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (document.activeElement === document.body && state.kind !== 'ready') {
      if (closed) nextButton.current?.focus();
      else receipt.current?.focus();
    }
  }, [closed, state.kind]);
  useLayoutEffect(() => {
    if (confirmationAction) {
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationForm.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [confirmationAction]);
  const blocked =
    submitting ||
    (result !== null && ['queued', 'processing', 'completed'].includes(result.status));
  return (
    <div className={styles.actionArea}>
      {!closed ? (
        <div className={styles.actionRow} aria-label="Report actions">
          {actions
            .filter(
              (action) =>
                report.allowedActions.includes(action) &&
                !(action === 'open_case' && report.latestCaseId)
            )
            .map((action) => (
              <ActionButton
                key={action}
                disabled={blocked}
                tone={confirmations[action].tone}
                onClick={(event) => {
                  confirmationTrigger.current = event.currentTarget;
                  setConfirmationAction(action);
                }}
              >
                {actionLabels[action]}
              </ActionButton>
            ))}
        </div>
      ) : null}
      {confirmationAction && !blocked ? (
        <form
          ref={confirmationForm}
          className={styles.confirmation}
          aria-labelledby={confirmationId}
          onSubmit={(event) => {
            event.preventDefault();
            setConfirmationAction(null);
            onAction(confirmationAction);
          }}
        >
          <h3
            id={confirmationId}
            ref={confirmationHeading}
            tabIndex={-1}
            aria-describedby={`${confirmationId}-context ${confirmationId}-effect`}
          >
            {confirmationAction === 'open_case'
              ? `Open a case for ${reportName(report)}?`
              : confirmations[confirmationAction].heading}
          </h3>
          <p id={`${confirmationId}-context`} className={styles.confirmationContext}>
            <strong>{reportName(report)}</strong>
            <span>{report.id}</span>
          </p>
          <p id={`${confirmationId}-effect`}>{confirmations[confirmationAction].effect}</p>
          <div className={styles.actionRow}>
            <ActionButton
              onClick={() => {
                setConfirmationAction(null);
                confirmationTrigger.current?.focus();
              }}
            >
              Cancel
            </ActionButton>
            <ActionButton type="submit" tone={confirmations[confirmationAction].tone}>
              {actionLabels[confirmationAction]}
            </ActionButton>
          </div>
        </form>
      ) : null}
      {submitting ? (
        <p className={styles.request} role="status">
          {reportActionLabel(state)}
        </p>
      ) : result && state.kind === 'settled' ? (
        <div
          ref={receipt}
          tabIndex={-1}
          className={styles.request}
          role={result.status === 'failed' ? 'alert' : 'status'}
          data-status={result.status}
        >
          <h3>{reportActionLabel(state) ?? 'Report not updated'}</h3>
          {result.status !== 'completed' && result.message ? <p>{result.message}</p> : null}
          {closed ? (
            <ActionButton ref={nextButton} onClick={onNext}>
              {hasNext ? 'Next report' : 'Back to queue'}
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
