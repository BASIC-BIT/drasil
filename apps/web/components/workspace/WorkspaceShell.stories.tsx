import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import {
  moderationInboxItemSchema,
  type ModerationInboxAction,
  type ModerationInboxItemKind,
} from '@drasil/contracts';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { CaseEvidenceRecord } from '@/components/cases/CaseEvidenceRecord';
import { Timestamp } from './Timestamp';
import { ActionButton } from './Foundation';
import { WorkspaceShell } from './WorkspaceShell';
import styles from './WorkspaceShell.stories.module.css';

const items = [
  ...fixtureModerationInboxItems(),
  moderationInboxItemSchema.parse({
    id: 'queue:queue-report-reply-1',
    guildId: 'guild-1',
    kind: 'report_attention',
    sourceId: 'report-collecting-1',
    queueItemId: 'queue-report-reply-1',
    subject: {
      userId: 'reporter-100',
      displayLabel: 'juniper',
      secondaryLabel: 'Reporter · target not confirmed',
      avatarUrl: null,
    },
    title: 'Reporter follow-up',
    summary: 'Additional screenshot attached',
    statusLabel: 'collecting_evidence',
    signalLabel: null,
    createdAt: '2026-10-23T14:56:00Z',
    updatedAt: '2026-10-23T14:56:00Z',
    stale: false,
    staleHours: 0,
    detailHref: null,
    links: [
      { label: 'Open reply', url: 'https://discord.com/channels/guild-1/report-thread-1/reply-1' },
    ],
    allowedActions: ['acknowledge', 'open_discord'],
    sourceMetadata: {
      subtype: null,
      caseId: null,
      reportId: 'report-collecting-1',
      detectionId: null,
      sourceThreadId: 'report-thread-1',
      latestReplyMessageId: 'reply-1',
      eventAt: '2026-10-23T14:56:00Z',
      pendingSince: null,
      thresholdDays: null,
      lastCheckedAt: null,
    },
  }),
  moderationInboxItemSchema.parse({
    id: 'queue:queue-screening-1',
    guildId: 'guild-1',
    kind: 'pending_screening',
    sourceId: 'user-600',
    queueItemId: 'queue-screening-1',
    subject: { userId: 'user-600', displayLabel: 'orbit', secondaryLabel: null, avatarUrl: null },
    title: 'Pending screening',
    summary: 'Discord membership screening pending',
    statusLabel: 'pending_screening',
    signalLabel: null,
    createdAt: '2026-10-21T14:40:00Z',
    updatedAt: '2026-10-23T14:40:00Z',
    stale: false,
    staleHours: 0,
    detailHref: null,
    links: [
      {
        label: 'Open screening notice',
        url: 'https://discord.com/channels/guild-1/admin-channel-1/screening-message-1',
      },
    ],
    allowedActions: ['open_discord'],
    sourceMetadata: {
      subtype: null,
      caseId: null,
      reportId: null,
      detectionId: null,
      sourceThreadId: null,
      latestReplyMessageId: null,
      eventAt: '2026-10-23T14:40:00Z',
      pendingSince: '2026-10-21T14:40:00Z',
      thresholdDays: 2,
      lastCheckedAt: '2026-10-23T14:40:00Z',
    },
  }),
];
const labels: Record<ModerationInboxItemKind, string> = {
  case: 'Case',
  submitted_report: 'Submitted report',
  observed_alert: 'Observed alert',
  report_attention: 'Reporter follow-up',
  support_attention: 'Recovery reply',
  pending_screening: 'Pending screening',
};
const onRequestConfirmation = fn<(action: ModerationInboxAction, targetId: string) => void>();

// The queue/detail region is injected into the production shell. Selection and handlers
// are story inputs; the URL controller and kind-specific action wiring belong to Task 4.
function InboxRegion({
  initialKind,
  breach = false,
  onRequestConfirmation,
}: {
  readonly initialKind?: ModerationInboxItemKind;
  readonly breach?: boolean;
  readonly onRequestConfirmation: (action: ModerationInboxAction, targetId: string) => void;
}) {
  const [selected, setSelected] = useState(
    () => items.find((item) => item.kind === (initialKind ?? 'case')) ?? items[0]
  );
  const [detailOpen, setDetailOpen] = useState(initialKind !== undefined);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const kind = selected.kind;
  const isBreach = breach && kind === 'support_attention';
  const attentionId = selected.queueItemId;
  const report = fixtureReportDetails[0];
  return (
    <div className={styles.inbox} data-detail-open={detailOpen}>
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
              ref={selected.id === item.id ? selectedRow : undefined}
              aria-pressed={selected.id === item.id}
              onClick={() => {
                setSelected(item);
                setDetailOpen(true);
                requestAnimationFrame(() => detailHeading.current?.focus());
              }}
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
          <button
            type="button"
            className={styles.back}
            onClick={() => {
              setDetailOpen(false);
              requestAnimationFrame(() => selectedRow.current?.focus());
            }}
          >
            ← Back to inbox
          </button>
          <header>
            <p>{isBreach ? 'Containment breach' : labels[kind]}</p>
            <h2 ref={detailHeading} tabIndex={-1}>
              {selected.subject.displayLabel}
            </h2>
            <p>{selected.subject.userId ?? 'Target not confirmed'}</p>
            <Timestamp value={selected.createdAt ?? null} />
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
              <a href={selected.detailHref ?? '#case'}>Investigate</a>
              <ActionButton
                tone="positive"
                onClick={() => onRequestConfirmation('verify_user', selected.sourceId)}
              >
                Verify member
              </ActionButton>
            </>
          ) : null}
          {kind === 'observed_alert' ? (
            <>
              <h3>Content check</h3>
              <p>{selected.summary}</p>
              <ActionButton
                onClick={() => onRequestConfirmation('dismiss_no_action', selected.sourceId)}
              >
                Dismiss alert
              </ActionButton>
            </>
          ) : null}
          {kind === 'pending_screening' ? (
            <>
              <h3>Discord membership screening pending</h3>
              <p>
                Pending since <Timestamp value={selected.createdAt ?? null} />
              </p>
              <p>{selected.summary}</p>
              {selected.sourceMetadata?.thresholdDays !== null ? (
                <p>Attention threshold: {selected.sourceMetadata?.thresholdDays} days</p>
              ) : null}
              <p>
                Last checked <Timestamp value={selected.sourceMetadata?.lastCheckedAt ?? null} />
              </p>
            </>
          ) : null}
          {kind === 'report_attention' || kind === 'support_attention' ? (
            <>
              <h3>
                {isBreach
                  ? 'Message outside the recovery thread'
                  : kind === 'report_attention'
                    ? 'Reporter follow-up'
                    : 'Recovery reply'}
              </h3>
              <p>{selected.summary}</p>
              {attentionId !== null && selected.allowedActions.includes('acknowledge') ? (
                <ActionButton onClick={() => onRequestConfirmation('acknowledge', attentionId)}>
                  Mark reviewed
                </ActionButton>
              ) : null}
            </>
          ) : null}
          {selected.links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              {link.label} in Discord
            </a>
          ))}
        </section>
      </div>
    </div>
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
    children: <InboxRegion onRequestConfirmation={onRequestConfirmation} />,
  },
} satisfies Meta<typeof WorkspaceShell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MixedInbox: Story = {};
export const SubmittedReport: Story = {
  args: {
    children: (
      <InboxRegion onRequestConfirmation={onRequestConfirmation} initialKind="submitted_report" />
    ),
  },
};
export const ObservedAlert: Story = {
  args: {
    children: (
      <InboxRegion onRequestConfirmation={onRequestConfirmation} initialKind="observed_alert" />
    ),
  },
};
export const PendingScreening: Story = {
  args: {
    children: (
      <InboxRegion onRequestConfirmation={onRequestConfirmation} initialKind="pending_screening" />
    ),
  },
};
export const ReporterFollowup: Story = {
  args: {
    children: (
      <InboxRegion onRequestConfirmation={onRequestConfirmation} initialKind="report_attention" />
    ),
  },
};
export const RecoveryReply: Story = {
  args: {
    children: (
      <InboxRegion onRequestConfirmation={onRequestConfirmation} initialKind="support_attention" />
    ),
  },
};
export const ContainmentBreach: Story = {
  args: {
    children: (
      <InboxRegion
        onRequestConfirmation={onRequestConfirmation}
        initialKind="support_attention"
        breach
      />
    ),
  },
};
