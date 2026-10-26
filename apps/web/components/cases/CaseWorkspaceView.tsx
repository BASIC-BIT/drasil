'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CaseWorkspaceData } from '@/lib/moderationWorkspaceTypes';
import type { CasePresenceState } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
import { CaseEvidenceReader } from './CaseEvidenceReader';
import type { CaseEvidenceReaderProps } from './CaseEvidenceReader';
import { CaseChecks } from './CaseChecks';
import { CaseHistory } from './CaseHistory';
import { recordLabel } from './caseRecordLabel';
import { explicitInboxReturnHref } from '@/lib/inboxLocation';
import styles from './CaseWorkspaceView.module.css';

export interface CaseWorkspaceViewProps {
  readonly data: CaseWorkspaceData;
  readonly actionArea: ReactNode;
  readonly tools: ReactNode;
  readonly conversation: ReactNode;
  readonly returnHref: string;
  readonly onOpenConversation?: CaseEvidenceReaderProps['onOpenConversation'];
}
const presence: Record<CasePresenceState, string> = {
  in_server: 'In server',
  left_or_removed: 'Left or removed',
  banned: 'Banned',
  kicked: 'Kicked',
  unknown: 'Member state unknown',
};

export function CaseWorkspaceView({
  data,
  actionArea,
  tools,
  conversation,
  returnHref,
  onOpenConversation,
}: CaseWorkspaceViewProps) {
  const { detail, report, membership } = data;
  const id = useId();
  const identity = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [identityOutside, setIdentityOutside] = useState(false);
  const [returnSource, setReturnSource] = useState<string | null>(null);
  const thread = detail.surfaces.find((surface) => surface.kind === 'verification_thread');
  useEffect(() => {
    const element = identity.current;
    if (!element) return;
    // Source/context jumps can cross the headline before observer delivery. Read
    // current geometry on scroll so the sticky actions always retain their target.
    const update = (): void => setIdentityOutside(element.getBoundingClientRect().bottom <= 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [detail.id]);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const update = (): void => {
      const height =
        getComputedStyle(element).position === 'sticky'
          ? element.getBoundingClientRect().height
          : 0;
      root.current?.style.setProperty('--case-command-offset', `${height + 16}px`);
      const focused = document.activeElement;
      if (
        height &&
        focused instanceof HTMLElement &&
        focused.tabIndex === -1 &&
        root.current?.contains(focused) &&
        focused.getBoundingClientRect().top < height
      ) {
        focused.scrollIntoView({ block: 'start' });
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const checks = detail.detectionHistory.filter((item) => item.detectionType !== 'user_report');
  return (
    <article ref={root} className={styles.main}>
      <div className={styles.location}>
        <a href={explicitInboxReturnHref(detail.guildId, returnHref)}>← Back to inbox</a>
        <span>Case · {detail.id}</span>
      </div>
      <header className={styles.header}>
        <div className={styles.identity}>
          <h1 ref={identity}>{detail.userIdentity.displayLabel}</h1>
          <p>
            Opened <Timestamp value={detail.createdAt} />
          </p>
        </div>
        <div className={styles.member}>
          <span>
            Member ID <strong>{detail.userId}</strong>
          </span>
          <span>{presence[detail.presenceState]}</span>
          <span>{recordLabel(detail.status)}</span>
          <a href={`/admin/guild/${detail.guildId}/members/${detail.userId}`}>Member history</a>
          {thread ? (
            <a href={thread.url} target="_blank" rel="noreferrer">
              Case thread<span className={styles.srOnly}> in a new tab</span>
            </a>
          ) : null}
        </div>
        {detail.caseKind === 'compromised_account' ? (
          <p className={styles.containment}>
            Compromised account · {recordLabel(detail.containmentStatus ?? 'not_applicable')}
            {detail.attentionState === 'parked' ? ' · Parked for recovery' : ''}
          </p>
        ) : null}
      </header>
      <div ref={bar} className={styles.actionBar}>
        {identityOutside ? (
          <p className={styles.actionIdentity} aria-label="Member for these actions">
            <strong>{detail.userIdentity.displayLabel}</strong>
            <span>{detail.userId}</span>
          </p>
        ) : null}
        {actionArea}
      </div>
      {detail.stale ? (
        <p className={styles.stale}>
          Last queue update <Timestamp value={detail.updatedAt} />. Queue information may be out of
          date.
        </p>
      ) : null}
      <div className={styles.columns}>
        <div className={styles.document}>
          <CaseEvidenceReader
            detail={detail}
            report={report}
            onOpenConversation={onOpenConversation}
            onContextJump={setReturnSource}
            regions={[
              ...(conversation
                ? [{ id: `${id}-conversation`, label: 'Conversation', content: conversation }]
                : []),
              ...(tools
                ? [{ id: `${id}-tools`, label: 'Case tools', content: tools, afterSources: true }]
                : []),
            ]}
            contextLinks={[
              ...(checks.length
                ? [{ id: `${id}-checks`, label: 'Checks', count: checks.length }]
                : []),
              { id: `${id}-history`, label: 'History', count: detail.moderationOutcomes.length },
            ]}
          />
        </div>
        <aside className={styles.rail} aria-label="Case context">
          {returnSource ? (
            <a className={styles.backToSource} href={`#${returnSource}`}>
              Back to source
            </a>
          ) : null}
          {membership ? (
            <section className={styles.membership} aria-label="Member context">
              <h2>Member context</h2>
              <p>
                Joined <Timestamp value={membership.joinDate} />
              </p>
              <p>
                {membership.caseRoleActive === null
                  ? 'Case role state unknown'
                  : membership.caseRoleActive
                    ? 'Case role active'
                    : 'Case role absent'}
              </p>
            </section>
          ) : null}
          <CaseChecks detail={detail} headingId={`${id}-checks`} />
          <CaseHistory detail={detail} headingId={`${id}-history`} />
          {detail.notes !== null ? (
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
              <dt>Workspace loaded</dt>
              <dd>
                <Timestamp value={data.loadedAt} />
              </dd>
            </dl>
          </details>
        </aside>
      </div>
    </article>
  );
}
