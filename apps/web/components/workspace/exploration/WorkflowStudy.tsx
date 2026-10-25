'use client';

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModerationInboxItemKind, ReportDetail } from '@drasil/contracts';
import {
  ActionButton,
  DrasilBrand,
  Foundation,
  type FoundationTheme,
} from '@/components/workspace/Foundation';
import { Timestamp } from '@/components/workspace/Timestamp';
import { ReportEvidence } from '@/components/inbox/foundation/ReportEvidence';
import { everydayReports } from '@/components/inbox/foundation/ReportInbox.fixtures';
import { CaseHistory } from '@/components/cases/CaseHistory';
import { CaseChecks } from '@/components/cases/CaseChecks';
import { busyCase } from '@/components/cases/foundation/CaseWorkspace.fixtures';
import { fixtureParkedCaseDetails } from '@/lib/caseFixtures';
import { CaseToolStudy } from './CaseToolStudy';
import { ChannelConversationStudy, ResultStudy } from './WorkflowStudyPanels';
import type { ResultView, StudyAction, ToolView, WorkflowViewName } from './workflowStudyState';
import styles from './WorkflowStudy.module.css';

interface InboxEntry {
  readonly id: string;
  readonly kind: ModerationInboxItemKind;
  readonly subtype?: 'quarantine_breach';
  readonly name: string;
  readonly userId: string;
  readonly label: string;
  readonly concern: string;
  readonly at: string;
}
const entries: readonly InboxEntry[] = [
  {
    id: 'breach-1',
    kind: 'support_attention',
    subtype: 'quarantine_breach',
    name: 'cedar',
    userId: 'user-700',
    label: 'Containment breach',
    concern: 'Message outside the recovery thread',
    at: '2026-10-23T15:14:00Z',
  },
  {
    id: 'case-1',
    kind: 'case',
    name: 'fieldnote',
    userId: 'user-100',
    label: 'Case',
    concern: 'Repeated reward links',
    at: '2026-10-23T15:10:00Z',
  },
  {
    id: 'report-1',
    kind: 'submitted_report',
    name: 'riverstone',
    userId: 'user-300',
    label: 'Report',
    concern: 'Unsolicited links in a public channel',
    at: '2026-10-23T15:08:00Z',
  },
  {
    id: 'alert-1',
    kind: 'observed_alert',
    name: 'northline',
    userId: 'user-500',
    label: 'Alert',
    concern: 'Repeated links · Content check',
    at: '2026-10-23T15:02:00Z',
  },
  {
    id: 'report-reply-1',
    kind: 'report_attention',
    name: 'juniper',
    userId: 'reporter-100',
    label: 'Report reply',
    concern: 'Additional screenshot attached',
    at: '2026-10-23T14:56:00Z',
  },
  {
    id: 'support-1',
    kind: 'support_attention',
    name: 'alder',
    userId: 'user-parked',
    label: 'Recovery reply',
    concern: 'Account recovery follow-up',
    at: '2026-10-23T14:48:00Z',
  },
  {
    id: 'screening-1',
    kind: 'pending_screening',
    name: 'orbit',
    userId: 'user-600',
    label: 'Screening',
    concern: 'Discord membership screening pending',
    at: '2026-10-21T14:40:00Z',
  },
];

const studyReport: ReportDetail = {
  ...everydayReports[0],
  createdAt: '2026-10-23T15:08:00Z',
  updatedAt: '2026-10-23T15:08:00Z',
  allowedActions: [
    'dismiss_no_action',
    'mark_actioned',
    'mark_false_positive',
    'open_case',
    'ban_user',
  ],
  evidence: everydayReports[0].evidence.map((item) => ({
    ...item,
    createdAt: '2026-10-23T15:06:00Z',
  })),
};

const kindActions: Record<ModerationInboxItemKind, readonly StudyAction[]> = {
  case: [
    {
      id: 'verify',
      label: 'Verify member',
      tone: 'positive',
      effect:
        'Remove the case role, restore eligible quarantined roles and resolve this member’s open cases in Community as verified.',
    },
    {
      id: 'close',
      label: 'Close case',
      effect:
        'Remove the case role, restore eligible quarantined roles and close this member’s open cases in Community without a verification decision.',
    },
    {
      id: 'kick',
      label: 'Kick member',
      tone: 'warning',
      reason: 'required',
      effect:
        'Remove this member from Community and resolve their open cases here. They can rejoin with a valid invite.',
    },
    {
      id: 'ban',
      label: 'Ban member',
      tone: 'danger',
      reason: 'required',
      effect:
        'Ban this member from Community and resolve their open cases here. No message deletion is requested.',
    },
  ],
  submitted_report: [
    {
      id: 'dismiss',
      label: 'Dismiss report',
      effect:
        'Set this report to Dismissed and remove it from the pending queue. This does not verify or remove the reported member.',
    },
    {
      id: 'handled',
      label: 'Mark handled',
      effect:
        'Set this report to Handled and remove it from the pending queue. This does not perform a moderation action.',
    },
    {
      id: 'false-positive',
      label: 'Mark false positive',
      effect: 'Set this report to False positive and remove it from the pending queue.',
    },
    {
      id: 'open',
      label: 'Open case',
      tone: 'warning',
      effect:
        'Create or reuse an open case, apply the case role and open the member’s case thread.',
    },
    {
      id: 'report-ban',
      label: 'Ban member',
      tone: 'danger',
      reason: 'required',
      effect: 'Ban the confirmed report target from Community. No message deletion is requested.',
    },
  ],
  observed_alert: [
    {
      id: 'dismiss-alert',
      label: 'Dismiss alert',
      effect:
        'Mark this detection handled without opening a case. A linked report may also be closed.',
    },
    {
      id: 'false-alert',
      label: 'Mark false positive',
      effect: 'Mark this detection as a false positive. A linked report may also be closed.',
    },
    {
      id: 'open-alert',
      label: 'Open case',
      tone: 'warning',
      effect:
        'Create or reuse a case for this member, apply the case role and open the case thread.',
    },
    {
      id: 'ban-alert',
      label: 'Ban member',
      tone: 'danger',
      reason: 'required',
      effect: 'Ban this member from Community. No message deletion is requested.',
    },
  ],
  report_attention: [
    {
      id: 'review-reply',
      label: 'Mark reviewed',
      effect:
        'Remove this reply from the attention queue. The report stays in its current intake stage.',
    },
  ],
  support_attention: [
    {
      id: 'review-support',
      label: 'Mark reviewed',
      effect:
        'Remove this reply from the attention queue. The case and account quarantine remain open.',
    },
  ],
  pending_screening: [],
};

function ConfirmedActions({
  actions,
  name,
  userId,
  recordId,
  children,
}: {
  readonly actions: readonly StudyAction[];
  readonly name: string;
  readonly userId: string;
  readonly recordId: string;
  readonly children?: (onAction: (action: StudyAction) => void, blocked: boolean) => ReactNode;
}) {
  const [confirmation, setConfirmation] = useState<StudyAction | null>(null);
  const [queued, setQueued] = useState<StudyAction | null>(null);
  const [reason, setReason] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const receipt = useRef<HTMLDivElement>(null);
  const id = useId();
  const requestAction = (action: StudyAction): void => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation(action);
  };
  useLayoutEffect(() => {
    if (confirmation) {
      heading.current?.focus();
      heading.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [confirmation]);
  useLayoutEffect(() => {
    if (queued) receipt.current?.focus();
  }, [queued]);
  return (
    <>
      <div className={styles.actionBar} data-expanded={Boolean(confirmation || queued)}>
        <div className={styles.actionButtons} role="group" aria-label="Review actions">
          {actions.map((action) => (
            <ActionButton
              key={action.id}
              tone={action.tone}
              disabled={Boolean(queued)}
              onClick={() => requestAction(action)}
            >
              {action.label}
            </ActionButton>
          ))}
        </div>
        {confirmation ? (
          <form
            className={styles.confirmation}
            aria-labelledby={`${id}-confirm`}
            onSubmit={(event) => {
              event.preventDefault();
              setQueued(confirmation);
              setConfirmation(null);
            }}
          >
            <h3 ref={heading} tabIndex={-1} id={`${id}-confirm`}>
              {confirmation.label}?
            </h3>
            <p className={styles.facts}>
              <strong>{name}</strong>
              <span>{userId}</span>
              <span>Community</span>
              <span>{recordId}</span>
            </p>
            <p>{confirmation.effect}</p>
            {confirmation.reason ? (
              <label className={styles.reason}>
                Reason{confirmation.reason === 'optional' ? ' · Optional' : ''}
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required={confirmation.reason === 'required'}
                  maxLength={
                    confirmation.id.startsWith('cleanup-') ||
                    confirmation.id.startsWith('quarantine-')
                      ? 1000
                      : 500
                  }
                  rows={3}
                />
              </label>
            ) : null}
            <div className={styles.actionButtons}>
              <ActionButton
                onClick={() => {
                  setConfirmation(null);
                  trigger.current?.focus();
                }}
              >
                Cancel
              </ActionButton>
              <ActionButton type="submit" tone={confirmation.tone}>
                {confirmation.label}
              </ActionButton>
            </div>
          </form>
        ) : null}
        {queued ? (
          <div ref={receipt} tabIndex={-1} className={styles.receipt} role="status">
            <h3>{queued.label} request queued</h3>
            <p>Waiting for Drasil to process the request.</p>
          </div>
        ) : null}
      </div>
      {children?.((action) => {
        if (!queued) requestAction(action);
      }, Boolean(queued))}
    </>
  );
}

function ItemReading({
  entry,
  onInvestigate,
}: {
  readonly entry: InboxEntry;
  readonly onInvestigate: () => void;
}) {
  switch (entry.kind) {
    case 'case':
      return (
        <>
          <div className={styles.statusLine}>
            <span className={styles.warning}>Case open</span>
            <span>In server · Case role applied</span>
          </div>
          <section className={styles.section}>
            <h3>Source message</h3>
            <p className={styles.metadata}>
              #general · <Timestamp value={entry.at} />
            </p>
            <blockquote>“Claim a reward here before it expires.”</blockquote>
            <a
              href="https://discord.com/channels/guild-1/source-channel-1/source-message-1"
              target="_blank"
              rel="noreferrer"
            >
              View in Discord
            </a>
          </section>
          <section className={styles.section}>
            <h3>Content check</h3>
            <p>Repeated reward links across recent messages.</p>
            <p className={styles.metadata}>Check confidence 91%</p>
          </section>
          <ActionButton onClick={onInvestigate}>Investigate case →</ActionButton>
        </>
      );
    case 'submitted_report':
      return (
        <>
          <p className={styles.metadata}>Reported by juniper · reporter-100</p>
          <section className={styles.section}>
            <ReportEvidence
              items={studyReport.evidence.filter((item) => item.kind !== 'candidate_confirmation')}
            />
            <p className={styles.metadata}>Report report-1 · Target confirmed as riverstone</p>
            <a href="/admin/guild/guild-1/reports/report-1">Open full report →</a>
          </section>
        </>
      );
    case 'observed_alert':
      return (
        <>
          <div className={styles.statusLine}>
            <span>Observed alert</span>
            <span>No case open</span>
          </div>
          <section className={styles.section}>
            <h3>Content check</h3>
            <p>Repeated links in recent messages.</p>
            <p className={styles.metadata}>
              Check confidence 82% · Detected <Timestamp value={entry.at} />
            </p>
          </section>
          <section className={styles.section}>
            <h3>Recent member messages</h3>
            <p>3 saved excerpts in #general</p>
            <blockquote>“The reward link is in my previous message.”</blockquote>
            <a
              href="https://discord.com/channels/guild-1/source-channel-1/observed-message-1"
              target="_blank"
              rel="noreferrer"
            >
              View source in Discord
            </a>
          </section>
        </>
      );
    case 'report_attention':
      return (
        <>
          <div className={styles.statusLine}>
            <span>Reporter follow-up</span>
            <span>Collecting evidence</span>
          </div>
          <p className={styles.metadata}>Reporter juniper · Target not confirmed</p>
          <section className={styles.section}>
            <h3>Latest reply</h3>
            <p className={styles.metadata}>
              <Timestamp value={entry.at} prefix="Sent" />
            </p>
            <blockquote>
              “Here’s the second screenshot. I’m not sure which account sent the original message.”
            </blockquote>
            <p className={styles.metadata}>report-collecting-1</p>
            <a
              href="https://discord.com/channels/guild-1/report-thread-1/reply-1"
              target="_blank"
              rel="noreferrer"
            >
              Open reply in Discord
            </a>
          </section>
          <section className={styles.section}>
            <h3>Report intake</h3>
            <p>Waiting for the reporter to identify the account.</p>
          </section>
        </>
      );
    case 'support_attention':
      if (entry.subtype === 'quarantine_breach')
        return (
          <>
            <div className={styles.statusLine}>
              <span className={styles.warning}>Containment breach</span>
              <span>Needs review</span>
            </div>
            <section className={styles.section}>
              <h3>Activity outside recovery thread</h3>
              <p>A message was sent in #general while account quarantine was active.</p>
              <p className={styles.metadata}>
                Recorded <Timestamp value={entry.at} />
              </p>
              <a
                href="https://discord.com/channels/guild-1/source-channel-1/breach-message-1"
                target="_blank"
                rel="noreferrer"
              >
                Open message in Discord
              </a>
            </section>
            <section className={styles.section}>
              <h3>Containment</h3>
              <p>Review channel permissions and the member’s current roles.</p>
            </section>
            <a href="/admin/guild/guild-1/cases/case-700">Open case →</a>
          </>
        );
      return (
        <>
          <div className={styles.statusLine}>
            <span className={styles.warning}>Account quarantine</span>
            <span>Parked · Contained</span>
          </div>
          <section className={styles.section}>
            <h3>Recovery reply</h3>
            <p className={styles.metadata}>
              alder · <Timestamp value={entry.at} />
            </p>
            <blockquote>
              “I’ve changed my password and signed out the other sessions. What do you need me to
              check next?”
            </blockquote>
            <a
              href="https://discord.com/channels/guild-1/recovery-thread-1/reply-1"
              target="_blank"
              rel="noreferrer"
            >
              Open recovery thread
            </a>
          </section>
          <section className={styles.section}>
            <h3>Case state</h3>
            <p>3 roles removed · No failed removals</p>
            <p className={styles.metadata}>Case case-parked remains open</p>
          </section>
          <ActionButton onClick={onInvestigate}>Open case →</ActionButton>
        </>
      );
    case 'pending_screening':
      return (
        <>
          <div className={styles.statusLine}>
            <span>Discord membership screening</span>
            <span>Pending</span>
          </div>
          <section className={styles.section}>
            <h3>Screening</h3>
            <dl className={styles.factList}>
              <dt>Pending since</dt>
              <dd>
                <Timestamp value={entry.at} />
              </dd>
              <dt>Attention threshold</dt>
              <dd>2 days</dd>
              <dt>Last checked</dt>
              <dd>
                <Timestamp value="2026-10-23T14:40:00Z" />
              </dd>
            </dl>
          </section>
          <a
            href="https://discord.com/channels/guild-1/admin-channel-1/screening-message-1"
            target="_blank"
            rel="noreferrer"
          >
            Open screening notice in Discord
          </a>
        </>
      );
  }
}

function InboxStudy({
  initialSelection = 'case-1',
  onInvestigate,
}: {
  readonly initialSelection?: string;
  readonly onInvestigate: (recovery: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialSelection);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [mobileDetail, setMobileDetail] = useState(initialSelection !== 'case-1');
  const heading = useRef<HTMLHeadingElement>(null);
  const visible = entries.filter(
    (item) =>
      (filter === 'All' ||
        item.label === filter ||
        (filter === 'Replies' && item.kind.endsWith('attention'))) &&
      `${item.name} ${item.concern}`.toLowerCase().includes(query.toLowerCase())
  );
  const selected = entries.find((item) => item.id === selectedId) ?? entries[0];
  return (
    <main className={styles.inbox} data-detail={mobileDetail}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Inbox</h1>
          <p>7 items need attention</p>
        </div>
        <span>Community</span>
      </header>
      <div className={styles.toolbar}>
        <nav aria-label="Inbox views">
          {['All', 'Case', 'Report', 'Alert', 'Replies', 'Screening'].map((label) => (
            <button
              key={label}
              type="button"
              aria-pressed={filter === label}
              onClick={() => setFilter(label)}
            >
              {label === 'Case'
                ? 'Cases'
                : label === 'Report'
                  ? 'Reports'
                  : label === 'Alert'
                    ? 'Alerts'
                    : label}
            </button>
          ))}
        </nav>
        <label>
          Search inbox
          <input
            type="search"
            value={query}
            placeholder="Member or concern"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.workbench}>
        <section className={styles.queue} aria-label="Review queue">
          <p className={styles.queueCount}>
            {visible.length} {visible.length === 1 ? 'item' : 'items'}
          </p>
          {visible.map((entry) => (
            <button
              id={`workflow-row-${entry.id}`}
              className={styles.queueRow}
              type="button"
              key={entry.id}
              aria-current={entry.id === selectedId ? 'true' : undefined}
              onClick={() => {
                setSelectedId(entry.id);
                setMobileDetail(true);
                requestAnimationFrame(() => heading.current?.focus());
              }}
            >
              <span className={styles.rowTop}>
                <strong>{entry.name}</strong>
                <span>{entry.label}</span>
              </span>
              <span>{entry.concern}</span>
              <span className={styles.metadata}>
                <Timestamp value={entry.at} />
              </span>
            </button>
          ))}
          {!visible.length ? <p className={styles.section}>No matching items.</p> : null}
        </section>
        <section className={styles.detail} key={selected.id} aria-label="Selected item">
          <button
            className={styles.mobileBack}
            type="button"
            onClick={() => {
              setMobileDetail(false);
              requestAnimationFrame(() =>
                document.getElementById(`workflow-row-${selected.id}`)?.focus()
              );
            }}
          >
            ← Back to inbox
          </button>
          <header className={styles.detailHeader}>
            <p className={styles.eyebrow}>{selected.label}</p>
            <h2 ref={heading} tabIndex={-1}>
              {selected.name}
            </h2>
            <p className={styles.metadata}>
              {selected.userId} · <Timestamp value={selected.at} />
            </p>
          </header>
          <ConfirmedActions
            actions={
              selected.subtype === 'quarantine_breach'
                ? [
                    {
                      id: 'review-breach',
                      label: 'Mark reviewed',
                      effect:
                        'Remove this containment-breach alert from the attention queue. Keep the case and account quarantine open.',
                    },
                  ]
                : kindActions[selected.kind]
            }
            name={selected.name}
            userId={selected.userId}
            recordId={selected.id}
          />
          <div className={styles.detailReading}>
            <ItemReading
              entry={selected}
              onInvestigate={() => onInvestigate(selected.kind === 'support_attention')}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function toolFor(view: WorkflowViewName): ToolView | null {
  switch (view) {
    case 'quarantine':
      return { kind: 'quarantine', state: 'preview' };
    case 'incomplete':
      return { kind: 'quarantine', state: 'incomplete' };
    case 'recovery':
      return { kind: 'quarantine', state: 'parked' };
    case 'security':
      return { kind: 'security', state: 'pending' };
    case 'passed':
      return { kind: 'security', state: 'passed' };
    case 'expired':
      return { kind: 'security', state: 'expired' };
    case 'delivery':
      return { kind: 'security', state: 'delivery_failed' };
    case 'bypassed':
      return { kind: 'security', state: 'bypassed' };
    case 'cleanup':
      return { kind: 'cleanup', state: 'scope' };
    case 'preview':
      return { kind: 'cleanup', state: 'preview' };
    case 'blocked':
      return { kind: 'cleanup', state: 'blocked' };
    case 'cleanupResults':
      return { kind: 'cleanup', state: 'results' };
    case 'finalization':
      return { kind: 'cleanup', state: 'finalization' };
    default:
      return null;
  }
}
function resultFor(view: WorkflowViewName): ResultView | null {
  switch (view) {
    case 'queued':
      return 'queued';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'updates':
      return 'updates_pending';
    case 'unknown':
      return 'unknown';
    case 'resolved':
      return 'resolved_elsewhere';
    default:
      return null;
  }
}
const selections: Partial<Record<WorkflowViewName, string>> = {
  inbox: 'case-1',
  report: 'report-1',
  alert: 'alert-1',
  screening: 'screening-1',
  reporter: 'report-reply-1',
  support: 'support-1',
  breach: 'breach-1',
};

export function WorkflowStudy({
  view = 'inbox',
  theme = 'dark',
}: {
  readonly view?: WorkflowViewName;
  readonly theme?: FoundationTheme;
}) {
  return <Study key={`${view}:${theme}`} initialView={view} theme={theme} />;
}
function Study({
  initialView,
  theme,
}: {
  readonly initialView: WorkflowViewName;
  readonly theme: FoundationTheme;
}) {
  const [view, setView] = useState(initialView);
  const tool = toolFor(view);
  const result = resultFor(view);
  const inbox = selections[view] !== undefined;
  const recovery = tool?.kind === 'quarantine';
  const name = recovery ? 'alder' : 'fieldnote';
  const userId = recovery ? 'user-parked' : 'user-100';
  const finishedCleanup =
    tool?.kind === 'cleanup' && (tool.state === 'results' || tool.state === 'finalization');
  const contextDetail = recovery
    ? { ...fixtureParkedCaseDetails[0], detectionHistory: [], moderationOutcomes: [] }
    : busyCase;
  const reportResult = view === 'updates' || view === 'unknown';
  const membershipLabel =
    finishedCleanup || view === 'updates'
      ? 'Banned'
      : view === 'unknown' || view === 'failed'
        ? 'Member state unavailable'
        : 'Last loaded: In server';
  const routineActions = kindActions.case
    .map((action) =>
      recovery && action.id === 'verify'
        ? {
            ...action,
            label: 'Verify and release',
            effect:
              'End account quarantine, restore eligible snapshotted roles, remove the case role and resolve this member’s open cases in Community as verified.',
          }
        : action
    )
    .filter((action) => !(recovery && action.id === 'close'));
  return (
    <Foundation theme={theme}>
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <DrasilBrand href="/admin/guild/guild-1/inbox" />
          <p className={styles.community}>Community</p>
          <nav aria-label="Workspace">
            <button type="button" aria-current="page" onClick={() => setView('inbox')}>
              Inbox <span>7</span>
            </button>
            <a href="/admin/guild/guild-1/history">History</a>
            <hr />
            <a href="/admin/guild/guild-1/setup">Settings</a>
            <a href="/admin/guild/guild-1/operations">Operations</a>
          </nav>
        </aside>
        {inbox ? (
          <InboxStudy
            initialSelection={selections[view]}
            onInvestigate={(isRecovery) => setView(isRecovery ? 'recovery' : 'conversation')}
          />
        ) : (
          <main className={styles.caseMain}>
            <div className={styles.location}>
              <button type="button" onClick={() => setView('inbox')}>
                ← Back to inbox
              </button>
              <span>
                {reportResult ? 'Report' : 'Case'} ·{' '}
                {reportResult ? 'report-fieldnote-1' : recovery ? 'case-parked' : 'case-stale'}
              </span>
            </div>
            <header className={styles.caseHeader}>
              <p className={styles.eyebrow}>
                {recovery ? 'Compromised account' : reportResult ? 'Report review' : 'Case review'}
              </p>
              <h1>{name}</h1>
              <p className={styles.facts}>
                <span>{userId}</span>
                <span>Community</span>
                <span>{membershipLabel}</span>
                <span>
                  {reportResult ? 'Reported' : 'Opened'}{' '}
                  <Timestamp
                    value={
                      recovery
                        ? '2026-10-23T14:20:00Z'
                        : reportResult
                          ? '2026-10-23T15:07:00Z'
                          : busyCase.createdAt
                    }
                  />
                </span>
                <a
                  href={`https://discord.com/channels/guild-1/${recovery ? 'recovery-thread-1' : reportResult ? 'report-thread-fieldnote-1' : 'case-thread-1'}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {reportResult ? 'Report thread' : 'Case thread'} ↗
                </a>
              </p>
              {tool?.kind === 'quarantine' ? (
                <p className={styles.containmentState}>
                  {tool.state === 'parked'
                    ? 'Contained · Parked for recovery'
                    : tool.state === 'incomplete'
                      ? 'Containment incomplete · Needs review'
                      : 'Containment not started'}
                </p>
              ) : null}
            </header>
            <ConfirmedActions
              actions={result || finishedCleanup ? [] : routineActions}
              name={name}
              userId={userId}
              recordId={recovery ? 'case-parked' : 'case-stale'}
            >
              {(onAction, blocked) => (
                <>
                  {result ? (
                    <div className={styles.resultArea}>
                      <ResultStudy view={result} onAction={onAction} />
                    </div>
                  ) : null}
                  <div className={styles.caseColumns}>
                    <nav className={styles.sourceIndex} aria-label="Case sources">
                      <p>Sources</p>
                      <a href="#workflow-reading" aria-current="location">
                        {tool?.kind === 'quarantine'
                          ? 'Account quarantine'
                          : tool?.kind === 'security'
                            ? 'Security check'
                            : tool?.kind === 'cleanup'
                              ? 'Message cleanup'
                              : 'Conversation'}
                      </a>
                      {contextDetail.detectionHistory.some(
                        (item) => item.detectionType !== 'user_report'
                      ) ? (
                        <a href="#workflow-checks">
                          Checks{' '}
                          <span>
                            {
                              contextDetail.detectionHistory.filter(
                                (item) => item.detectionType !== 'user_report'
                              ).length
                            }
                          </span>
                        </a>
                      ) : null}
                      <a href="#workflow-history">
                        History <span>{contextDetail.moderationOutcomes.length}</span>
                      </a>
                    </nav>
                    <section
                      className={styles.document}
                      id="workflow-reading"
                      tabIndex={-1}
                      aria-label="Case reading area"
                    >
                      {tool ? (
                        <fieldset className={styles.toolFieldset} disabled={blocked}>
                          <CaseToolStudy view={tool} onAction={onAction} />
                        </fieldset>
                      ) : (
                        <ChannelConversationStudy unavailable={view === 'unavailable'} />
                      )}
                    </section>
                    <aside className={styles.rail} aria-label="Case context">
                      <div id="workflow-checks" tabIndex={-1}>
                        <CaseChecks detail={contextDetail} />
                      </div>
                      <div id="workflow-history" tabIndex={-1}>
                        <CaseHistory detail={contextDetail} />
                      </div>
                      <details className={styles.section}>
                        <summary>Record details</summary>
                        <p className={styles.metadata}>Member {userId}</p>
                        <p className={styles.metadata}>
                          Last queue update <Timestamp value="2026-10-23T15:10:00Z" />
                        </p>
                      </details>
                    </aside>
                  </div>
                </>
              )}
            </ConfirmedActions>
          </main>
        )}
      </div>
    </Foundation>
  );
}
