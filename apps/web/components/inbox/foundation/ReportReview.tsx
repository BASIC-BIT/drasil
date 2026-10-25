'use client';

import { Timestamp } from './Timestamp';

import { useId, useRef, useState, type Ref } from 'react';
import type { MemberProfile, ReportDetail } from '@drasil/contracts';
import { ReportEvidence } from './ReportEvidence';
import { ReportActions } from './ReportActions';
import { ReportMemberContext } from './ReportMemberContext';
import {
  reportName,
  reportActionLabel,
  type ReportReviewState,
  type ReportTriageAction,
} from './reportTriage';
import styles from './ReportInbox.module.css';

type ReviewTab = 'review' | 'evidence' | 'activity';
const tabs: readonly ReviewTab[] = ['review', 'evidence', 'activity'];

interface ReportReviewProps {
  readonly report: ReportDetail;
  readonly profile?: MemberProfile;
  readonly state: ReportReviewState;
  readonly outsideSearch: boolean;
  readonly onAction: (action: ReportTriageAction) => void;
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly hasNext: boolean;
  readonly headingRef: Ref<HTMLHeadingElement>;
}

export function ReportReview({
  report,
  profile,
  state,
  outsideSearch,
  onAction,
  onNext,
  onBack,
  hasNext,
  headingRef,
}: ReportReviewProps) {
  const [tab, setTab] = useState<ReviewTab>('review');
  const tabRefs = useRef<Partial<Record<ReviewTab, HTMLButtonElement | null>>>({});
  const id = useId();
  const reviewEvidence = report.evidence.filter((item) => item.kind !== 'candidate_confirmation');
  const activityLabel = state.kind === 'settled' ? reportActionLabel(state) : null;
  const activityCount = activityLabel ? 2 : 1;
  const labels: Record<ReviewTab, string> = {
    review: 'Review',
    evidence: `Evidence ${report.evidence.length}`,
    activity: `Activity ${activityCount}`,
  };
  const chooseTab = (next: ReviewTab): void => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  return (
    <section className={styles.detail} aria-label="Selected report">
      <button className={styles.back} type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to inbox
      </button>
      <header className={styles.detailHeader}>
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            {reportName(report)}
          </h2>
          <p>
            <Timestamp value={report.createdAt} prefix="Reported" />
          </p>
        </div>
        <span className={styles.reportId}>{report.id}</span>
      </header>
      <ReportMemberContext report={report} profile={profile} />
      <div className={styles.tabs} role="tablist" aria-label="Report information">
        {tabs.map((name, index) => (
          <button
            key={name}
            ref={(element) => {
              tabRefs.current[name] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${name}`}
            aria-label={labels[name]}
            aria-selected={tab === name}
            aria-controls={`${id}-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? tabs[(index + 1) % tabs.length]
                  : event.key === 'ArrowLeft'
                    ? tabs[(index + tabs.length - 1) % tabs.length]
                    : event.key === 'Home'
                      ? 'review'
                      : event.key === 'End'
                        ? 'activity'
                        : null;
              if (next) {
                event.preventDefault();
                chooseTab(next);
              }
            }}
          >
            {name === 'review' ? (
              'Review'
            ) : name === 'evidence' ? (
              <>
                Evidence <span>{report.evidence.length}</span>
              </>
            ) : (
              <>
                Activity <span>{activityCount}</span>
              </>
            )}
          </button>
        ))}
      </div>
      {outsideSearch ? (
        <p className={styles.selectionNote}>This report is outside the current search.</p>
      ) : null}
      <div className={styles.readingArea}>
        <div
          id={`${id}-panel-review`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-review`}
          hidden={tab !== 'review'}
          tabIndex={0}
        >
          {report.summary ? (
            <>
              <p className={styles.reviewSummary}>
                <span>Summary</span>
                {report.summary}
              </p>
              <hr className={styles.reviewDivider} />
            </>
          ) : null}
          <ReportEvidence items={reviewEvidence} />
          {report.evidence.length > 0 ? (
            <button
              className={styles.textButton}
              type="button"
              onClick={() => chooseTab('evidence')}
            >
              Full evidence record <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </div>
        <div
          id={`${id}-panel-evidence`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-evidence`}
          hidden={tab !== 'evidence'}
          tabIndex={0}
        >
          <ReportEvidence items={report.evidence} />
        </div>
        <div
          id={`${id}-panel-activity`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-activity`}
          hidden={tab !== 'activity'}
          tabIndex={0}
        >
          <ol className={styles.activity}>
            <li>
              <Timestamp value={report.createdAt} />
              <h3>Report submitted</h3>
            </li>
            {activityLabel ? (
              <li>
                <h3>{activityLabel}</h3>
              </li>
            ) : null}
          </ol>
        </div>
        <details className={styles.recordDetails}>
          <summary>Record details</summary>
          <dl>
            <div>
              <dt>Reporter ID</dt>
              <dd>{report.reporterId}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>
                <Timestamp value={report.updatedAt} />
              </dd>
            </div>
          </dl>
        </details>
      </div>
      <ReportActions
        report={report}
        state={state}
        onAction={onAction}
        onNext={onNext}
        hasNext={hasNext}
      />
    </section>
  );
}
