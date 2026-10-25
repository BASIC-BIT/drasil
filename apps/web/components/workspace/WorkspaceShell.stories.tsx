import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import type { ModerationInboxItemKind } from '@drasil/contracts';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { CaseEvidenceRecord } from '@/components/cases/CaseEvidenceRecord';
import { Timestamp } from './Timestamp';
import { ActionButton } from './Foundation';
import { WorkspaceShell } from './WorkspaceShell';
import styles from './WorkspaceShell.stories.module.css';

const items = fixtureModerationInboxItems();
const labels: Record<ModerationInboxItemKind, string> = {
  case: 'Case',
  submitted_report: 'Submitted report',
  observed_alert: 'Observed alert',
  report_attention: 'Reporter follow-up',
  support_attention: 'Recovery reply',
  pending_screening: 'Pending screening',
};
const onRequestConfirmation = fn();

// The queue/detail region is injected into the production shell. Selection and handlers
// are story inputs; the URL controller and kind-specific action wiring belong to Task 4.
function InboxRegion({
  initialKind = 'case',
  breach = false,
}: {
  readonly initialKind?: ModerationInboxItemKind;
  readonly breach?: boolean;
}) {
  const [kind, setKind] = useState(initialKind);
  const selected = items.find((item) => item.kind === kind);
  const report = fixtureReportDetails[0];
  return (
    <>
      <header className={styles.heading}>
        <h1>Inbox</h1>
        <p>{items.length} items need attention</p>
      </header>
      <div className={styles.filters}>
        <label>
          Search inbox
          <input type="search" placeholder="Member, concern or ID" />
        </label>
        <nav aria-label="Inbox views">
          <a href="#all">All</a>
          <a href="#reports">Reports</a>
          <a href="#alerts">Alerts</a>
          <a href="#replies">Replies</a>
          <a href="#screening">Screening</a>
        </nav>
      </div>
      <div className={styles.split}>
        <nav aria-label="Pending items" className={styles.queue}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={kind === item.kind}
              onClick={() => setKind(item.kind)}
            >
              <strong>{item.subject.displayLabel}</strong>
              <span>{labels[item.kind]}</span>
              <span>
                {item.kind === 'case'
                  ? fixtureCaseDetails[0].detectionHistory[0]?.reasons[0]
                  : item.summary}
              </span>
              <Timestamp value={item.updatedAt} />
            </button>
          ))}
        </nav>
        <section className={styles.detail} aria-label="Selected item">
          <header>
            <p>{breach ? 'Containment breach' : labels[kind]}</p>
            <h2>{selected?.subject.displayLabel ?? 'Unknown member'}</h2>
            <p>{selected?.subject.userId ?? 'Target not confirmed'}</p>
            <Timestamp value={selected?.createdAt ?? null} />
          </header>
          {kind === 'submitted_report' ? (
            <>
              <h3>Submitted evidence</h3>
              {report.evidence.map((record) => (
                <CaseEvidenceRecord
                  key={record.id}
                  record={{
                    id: record.id,
                    sourceId: record.id,
                    origin: 'report_evidence',
                    label: record.kind.replace(/_/g, ' '),
                    content: record.content,
                    createdAt: record.createdAt,
                    url: record.sourceMessageUrl,
                    attachment: record.attachment,
                  }}
                />
              ))}
              <ActionButton onClick={() => onRequestConfirmation('dismiss_no_action', report.id)}>
                Dismiss report
              </ActionButton>
              <ActionButton onClick={() => onRequestConfirmation('open_case', report.id)}>
                Open case
              </ActionButton>
            </>
          ) : null}
          {kind === 'case' ? (
            <>
              <h3>Source message</h3>
              <blockquote>
                {
                  fixtureCaseDetails[0].messageContext.find((message) => message.isSource)
                    ?.contentPreview
                }
              </blockquote>
              <a href={selected?.detailHref ?? '#case'}>Investigate</a>
              <ActionButton
                tone="positive"
                onClick={() => onRequestConfirmation('verify_user', selected?.sourceId)}
              >
                Verify member
              </ActionButton>
            </>
          ) : null}
          {kind === 'observed_alert' ? (
            <>
              <h3>Content check</h3>
              <p>{selected?.summary}</p>
              <ActionButton
                onClick={() => onRequestConfirmation('dismiss_no_action', selected?.sourceId)}
              >
                Dismiss alert
              </ActionButton>
            </>
          ) : null}
          {kind === 'pending_screening' ? (
            <>
              <h3>Discord membership screening pending</h3>
              <p>
                Pending since <Timestamp value={selected?.createdAt ?? null} />
              </p>
            </>
          ) : null}
          {kind === 'report_attention' || kind === 'support_attention' ? (
            <>
              <h3>
                {breach
                  ? 'Message outside the recovery thread'
                  : kind === 'report_attention'
                    ? 'Reporter follow-up'
                    : 'Recovery reply'}
              </h3>
              <p>{selected?.summary}</p>
              <ActionButton
                onClick={() => onRequestConfirmation('acknowledge', selected?.queueItemId)}
              >
                Mark reviewed
              </ActionButton>
            </>
          ) : null}
          {selected?.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label} in Discord
            </a>
          ))}
        </section>
      </div>
    </>
  );
}

const meta = {
  title: 'Moderation workspace/Shell and inbox regions',
  component: WorkspaceShell,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  args: {
    guildId: 'guild-1',
    guildName: 'Example server',
    sessionUsername: 'Moderator',
    currentPage: 'inbox',
    children: <InboxRegion />,
  },
} satisfies Meta<typeof WorkspaceShell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MixedInbox: Story = {};
export const SubmittedReport: Story = {
  args: { children: <InboxRegion initialKind="submitted_report" /> },
};
export const ObservedAlert: Story = {
  args: { children: <InboxRegion initialKind="observed_alert" /> },
};
export const PendingScreening: Story = {
  args: { children: <InboxRegion initialKind="pending_screening" /> },
};
export const ReporterFollowup: Story = {
  args: { children: <InboxRegion initialKind="report_attention" /> },
};
export const RecoveryReply: Story = {
  args: { children: <InboxRegion initialKind="support_attention" /> },
};
export const ContainmentBreach: Story = {
  args: { children: <InboxRegion initialKind="support_attention" breach /> },
};
