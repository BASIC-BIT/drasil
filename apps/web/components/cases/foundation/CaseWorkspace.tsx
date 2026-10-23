'use client';

import { useId, useRef, useState } from 'react';
import type { CaseDetail, MemberProfile, ReportDetail } from '@drasil/contracts';
import {
  Foundation,
  DrasilBrand,
  type FoundationTheme,
} from '@/components/inbox/foundation/Foundation';
import {
  MobileWorkspaceMenu,
  WorkspaceLinks,
} from '@/components/inbox/foundation/WorkspaceNavigation';
import { ReportEvidence } from '@/components/inbox/foundation/ReportEvidence';
import { Timestamp } from '@/components/inbox/foundation/Timestamp';
import { CaseSources, CaseChecks } from './CaseSources';
import { CaseActivity } from './CaseActivity';
import { CaseDecisions } from './CaseDecisions';
import { type CaseDecision, type CaseDecisionHandler, type CaseRequestState } from './caseReview';
import shell from '@/components/inbox/foundation/ReportInbox.module.css';
import styles from './CaseWorkspace.module.css';

interface CaseWorkspaceProps {
  readonly detail: CaseDetail;
  readonly guildName: string;
  readonly report?: ReportDetail;
  readonly profile?: MemberProfile;
  readonly onAction: CaseDecisionHandler;
  readonly theme?: FoundationTheme;
}
const presenceLabels: Record<CaseDetail['presenceState'], string> = {
  in_server: 'In server',
  left_or_removed: 'Left or removed',
  banned: 'Banned',
  kicked: 'Kicked',
  unknown: 'Member state unknown',
};

// Reset local request/confirmation state when navigating to a different case.
export function CaseWorkspace(props: CaseWorkspaceProps) {
  return <CaseInvestigation key={`${props.detail.guildId}:${props.detail.id}`} {...props} />;
}

function CaseInvestigation({
  detail,
  guildName,
  report: suppliedReport,
  profile: suppliedProfile,
  onAction,
  theme,
}: CaseWorkspaceProps) {
  const [request, setRequest] = useState<CaseRequestState>({ kind: 'ready' });
  const id = useId();
  const evidenceSection = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const profile =
    suppliedProfile?.guildId === detail.guildId && suppliedProfile.userId === detail.userId
      ? suppliedProfile
      : undefined;
  const report =
    suppliedReport?.guildId === detail.guildId &&
    suppliedReport.targetUserId === detail.userId &&
    suppliedReport.latestCaseId === detail.id
      ? suppliedReport
      : undefined;
  const inboxHref = `/admin/guild/${detail.guildId}/inbox`;
  const caseThread = detail.surfaces.find((item) => item.kind === 'verification_thread');
  const reportIdentification =
    report?.evidence.filter((item) => item.kind === 'candidate_confirmation') ?? [];
  const completed = request.kind === 'settled' && request.result.status === 'completed';
  const decide = async (action: CaseDecision, reason: string): Promise<void> => {
    if (inFlight.current || !detail.allowedActions.includes(action)) return;
    inFlight.current = true;
    setRequest({ kind: 'submitting', action });
    try {
      const result = await onAction(detail.id, action, reason);
      setRequest({ kind: 'settled', action, result });
    } catch {
      setRequest({
        kind: 'settled',
        action,
        result: {
          status: 'failed',
          requestId: null,
          message: 'Request status could not be confirmed. Check the case before trying again.',
        },
      });
    } finally {
      inFlight.current = false;
    }
  };
  return (
    <Foundation theme={theme}>
      <div className={shell.workspace}>
        <aside className={shell.sidebar}>
          <DrasilBrand href={inboxHref} />
          <p className={shell.community}>{guildName}</p>
          <WorkspaceLinks guildId={detail.guildId} currentPage="cases" />
        </aside>
        <main className={styles.main}>
          <div className={shell.mobileBrand}>
            <DrasilBrand href={inboxHref} />
            <MobileWorkspaceMenu
              guildId={detail.guildId}
              guildName={guildName}
              currentPage="cases"
            />
          </div>
          <div className={styles.locationBar}>
            <div className={styles.locationInner}>
              <a className={styles.back} href={inboxHref}>
                <span aria-hidden="true">←</span> Back to inbox
              </a>
              <span className={styles.locationRecord}>
                <span>Case</span>
                <span className={styles.caseId}>{detail.id}</span>
              </span>
            </div>
          </div>
          <div className={styles.content}>
            <header className={styles.header}>
              <h1>{detail.userIdentity.displayLabel}</h1>
              <p className={styles.muted}>
                Opened <Timestamp value={detail.createdAt} />
              </p>
            </header>
            <section className={styles.memberContext} aria-label="Member context">
              {completed ? <p className={styles.muted}>Member state from last case load</p> : null}
              <div className={styles.facts}>
                <span>
                  Member ID <strong>{detail.userId}</strong>
                </span>
                <span>{presenceLabels[detail.presenceState]}</span>
                {profile && profile.membership.caseRoleActive !== null ? (
                  <span>Case role {profile.membership.caseRoleActive ? 'active' : 'inactive'}</span>
                ) : null}
              </div>
              <div className={styles.contextLinks}>
                <a href={`/admin/guild/${detail.guildId}/members/${detail.userId}`}>
                  Member history
                </a>
                {caseThread ? (
                  <a href={caseThread.url} target="_blank" rel="noreferrer">
                    Case thread<span className={styles.srOnly}> in a new tab</span>
                  </a>
                ) : null}
              </div>
            </section>
            <nav className={styles.sectionNavigation} aria-label="Case sections">
              <a
                href={`#${id}-evidence`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  evidenceSection.current?.scrollIntoView({ block: 'start' });
                  evidenceSection.current?.querySelector('h2')?.focus({ preventScroll: true });
                }}
              >
                Evidence
              </a>
              <a href={`#${id}-decision`}>Decision</a>
            </nav>
            <div className={styles.notices}>
              {detail.stale ? (
                <p>
                  Last queue update <Timestamp value={detail.updatedAt} />. Queue information may be
                  out of date.
                </p>
              ) : null}
              {detail.presenceState === 'unknown' ? (
                <p>Check the member’s current state in Discord before deciding.</p>
              ) : null}
              {detail.containmentStatus === 'in_progress' ? (
                <p>Account quarantine in progress. Further containment requests are blocked.</p>
              ) : null}
              {detail.containmentStatus === 'incomplete' ? (
                <p>
                  Account quarantine incomplete. Retry from Discord after repairing the containment
                  blockers.
                </p>
              ) : null}
              {detail.attentionState === 'parked' ? (
                <p>
                  Account quarantine parked. Verification, kick or ban is required to release it.
                </p>
              ) : null}
            </div>
            {report?.summary ? (
              <p className={styles.concern}>
                <span>Summary</span>
                {report.summary}
              </p>
            ) : null}
            {detail.notes ? (
              <section className={styles.notes} aria-label="Case notes">
                <h2>Case notes</h2>
                <p>{detail.notes}</p>
              </section>
            ) : null}
            <CaseSources
              detail={detail}
              report={report}
              evidenceId={`${id}-evidence`}
              sectionRef={evidenceSection}
            />
            <CaseChecks detail={detail} />
            <CaseActivity detail={detail} report={report} request={request} />
            <details className={styles.recordDetails}>
              <summary>Record details</summary>
              <dl>
                <div>
                  <dt>Case ID</dt>
                  <dd>{detail.id}</dd>
                </div>
                <div>
                  <dt>Last queue update</dt>
                  <dd>
                    <Timestamp value={detail.updatedAt} />
                  </dd>
                </div>
                {report ? (
                  <div>
                    <dt>Report ID</dt>
                    <dd>{report.id}</dd>
                  </div>
                ) : null}
                {report ? (
                  <div>
                    <dt>Reporter ID</dt>
                    <dd>{report.reporterId}</dd>
                  </div>
                ) : null}
              </dl>
              {reportIdentification.length ? <ReportEvidence items={reportIdentification} /> : null}
            </details>
            <CaseDecisions
              decisionId={`${id}-decision`}
              detail={detail}
              request={request}
              onAction={(action, reason) => {
                void decide(action, reason);
              }}
            />
          </div>
        </main>
      </div>
    </Foundation>
  );
}
