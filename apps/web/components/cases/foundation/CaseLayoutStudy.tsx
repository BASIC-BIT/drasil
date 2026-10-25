'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CaseDetail } from '@drasil/contracts';
import {
  DrasilBrand,
  Foundation,
  type FoundationTheme,
} from '@/components/inbox/foundation/Foundation';
import {
  MobileWorkspaceMenu,
  WorkspaceLinks,
} from '@/components/inbox/foundation/WorkspaceNavigation';
import { Timestamp } from '@/components/inbox/foundation/Timestamp';
import { CaseChecks } from './CaseSources';
import { SourceDesk, SourceDeskHistory } from './SourceDesk';
import { CaseActivity } from './CaseActivity';
import { CaseDecisions } from './CaseDecisions';
import { CaseChronology } from './CaseChronology';
import type { CaseRequestState } from './caseReview';
import shell from '@/components/inbox/foundation/ReportInbox.module.css';
import styles from './CaseLayoutStudy.module.css';

export type CaseStudyLayout = 'sources' | 'chronology';
interface CaseLayoutStudyProps {
  readonly detail: CaseDetail;
  readonly layout: CaseStudyLayout;
  readonly theme?: FoundationTheme;
}
const presence: Record<CaseDetail['presenceState'], string> = {
  in_server: 'In server',
  left_or_removed: 'Left or removed',
  banned: 'Banned',
  kicked: 'Kicked',
  unknown: 'Member state unknown',
};

// Isolated layout experiment. Decisions simulate queued receipts; there is no live adapter.
export function CaseLayoutStudy(props: CaseLayoutStudyProps) {
  return <Study key={`${props.detail.guildId}:${props.detail.id}:${props.layout}`} {...props} />;
}

function Study({ detail, layout, theme = 'dark' }: CaseLayoutStudyProps) {
  const id = useId();
  const evidence = useRef<HTMLHeadingElement>(null);
  const identityHeader = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const actionBar = useRef<HTMLDivElement>(null);
  const [identityOutside, setIdentityOutside] = useState(false);
  const [request, setRequest] = useState<CaseRequestState>({ kind: 'ready' });
  const thread = detail.surfaces.find((surface) => surface.kind === 'verification_thread');
  const inbox = `/admin/guild/${detail.guildId}/inbox`;
  const checks = detail.detectionHistory.filter((item) => item.detectionType !== 'user_report');
  useEffect(() => {
    if (layout !== 'sources' || !identityHeader.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setIdentityOutside(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
    });
    observer.observe(identityHeader.current);
    return () => observer.disconnect();
  }, [layout]);
  useEffect(() => {
    const bar = actionBar.current;
    const root = main.current;
    if (!bar || !root) return;
    const update = (): void => {
      const height =
        window.getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().height : 0;
      root.style.setProperty('--case-command-offset', `${height + 16}px`);
      // The member label can make the mobile bar taller after an anchor jump.
      const focused = document.activeElement;
      if (
        height &&
        focused instanceof HTMLElement &&
        focused.tabIndex === -1 &&
        root.contains(focused)
      ) {
        const bounds = focused.getBoundingClientRect();
        const headingSpace =
          Number.parseFloat(focused.style.getPropertyValue('--conversation-heading-space')) || 0;
        if (bounds.top - headingSpace < height && bounds.bottom > 0)
          focused.scrollIntoView({ block: 'start' });
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [layout]);
  const decisions = (
    <CaseDecisions
      decisionId={`${id}-decision`}
      detail={detail}
      request={request}
      presentation={layout === 'sources' ? 'bar' : 'section'}
      onAction={(action) =>
        setRequest({
          kind: 'settled',
          action,
          result: {
            status: 'queued',
            requestId: `study-${action}`,
            message: 'Waiting for Drasil to execute the request.',
          },
        })
      }
    />
  );
  return (
    <Foundation theme={theme}>
      <div className={shell.workspace}>
        <aside className={shell.sidebar}>
          <DrasilBrand href={inbox} />
          <p className={shell.community}>Community</p>
          <WorkspaceLinks guildId={detail.guildId} currentPage="cases" />
        </aside>
        <main ref={main} className={styles.main} data-case-study={layout}>
          <div className={shell.mobileBrand}>
            <DrasilBrand href={inbox} />
            <MobileWorkspaceMenu
              guildId={detail.guildId}
              guildName="Community"
              currentPage="cases"
            />
          </div>
          <div className={styles.location}>
            <a href={inbox}>← Back to inbox</a>
            <span>Case · {detail.id}</span>
          </div>
          <header ref={identityHeader} className={styles.header}>
            <div className={styles.identity}>
              <h1>{detail.userIdentity.displayLabel}</h1>
              <p>
                Opened <Timestamp value={detail.createdAt} />
              </p>
            </div>
            <div className={styles.member}>
              <span>
                Member ID <strong>{detail.userId}</strong>
              </span>
              <span>{presence[detail.presenceState]}</span>
              <a href={`/admin/guild/${detail.guildId}/members/${detail.userId}`}>Member history</a>
              {thread ? (
                <a href={thread.url} target="_blank" rel="noreferrer">
                  Case thread<span className={styles.srOnly}> in a new tab</span>
                </a>
              ) : null}
            </div>
          </header>
          {layout === 'sources' ? (
            <div ref={actionBar} className={styles.actionBar}>
              {identityOutside ? (
                <p className={styles.actionIdentity} aria-label="Member for these actions">
                  <strong>{detail.userIdentity.displayLabel}</strong>
                  <span>{detail.userId}</span>
                </p>
              ) : null}
              {decisions}
            </div>
          ) : (
            <nav className={styles.sectionNav} aria-label="Case sections">
              <a
                href={`#${id}-evidence`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  evidence.current?.scrollIntoView({ block: 'start' });
                  evidence.current?.focus({ preventScroll: true });
                }}
              >
                Chronology
              </a>
              <a href={`#${id}-decision`}>Decision</a>
            </nav>
          )}
          {detail.stale ? (
            <p className={styles.stale}>
              Last queue update <Timestamp value={detail.updatedAt} />. Queue information may be out
              of date.
            </p>
          ) : null}
          <div className={styles.columns}>
            <div className={styles.document}>
              {layout === 'chronology' && detail.notes ? (
                <section className={styles.notes} aria-label="Case notes">
                  <h2>Case notes</h2>
                  <p>{detail.notes}</p>
                </section>
              ) : null}
              <section
                aria-label={layout === 'sources' ? 'Evidence workspace' : 'Chronology workspace'}
              >
                {layout === 'chronology' ? (
                  <header className={styles.documentHeading}>
                    <h2 id={`${id}-evidence`} ref={evidence} tabIndex={-1}>
                      Case chronology
                    </h2>
                    <span>
                      {detail.messageContext.length} saved messages · {checks.length} checks
                    </span>
                  </header>
                ) : null}
                {layout === 'sources' ? (
                  <SourceDesk
                    detail={detail}
                    contextLinks={[
                      ...(checks.length
                        ? [{ id: `${id}-checks`, label: 'Checks', count: checks.length }]
                        : []),
                      {
                        id: `${id}-history`,
                        label: 'History',
                        count: detail.moderationOutcomes.length,
                      },
                    ]}
                  />
                ) : (
                  <CaseChronology detail={detail} />
                )}
              </section>
            </div>
            <aside className={styles.rail} aria-label="Case context">
              {layout === 'sources' ? (
                <CaseChecks detail={detail} headingId={`${id}-checks`} />
              ) : null}
              {layout === 'chronology' ? decisions : null}
              {layout === 'sources' ? (
                <SourceDeskHistory detail={detail} headingId={`${id}-history`} />
              ) : null}
              {layout === 'sources' && detail.notes ? (
                <details className={styles.record}>
                  <summary>Case notes</summary>
                  <p>{detail.notes}</p>
                </details>
              ) : null}
              <details className={styles.record}>
                <summary>Record details</summary>
                <dl>
                  <dt>Case ID</dt>
                  <dd>{detail.id}</dd>
                  <dt>Member ID</dt>
                  <dd>{detail.userId}</dd>
                  <dt>Last queue update</dt>
                  <dd>
                    <Timestamp value={detail.updatedAt} />
                  </dd>
                </dl>
                {layout === 'sources' ? <CaseActivity detail={detail} request={request} /> : null}
              </details>
            </aside>
          </div>
        </main>
      </div>
    </Foundation>
  );
}
