import type {
  MessageCleanupAggregateOutcome,
  MessageCleanupItem,
  MessageCleanupJobDetail as MessageCleanupJobDetailContract,
  MessageCleanupJobSummary,
} from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatUtc } from '@/lib/casePresentation';
import { MessageCleanupJobPoller } from './MessageCleanupJobPoller';

const scopeLabels: Record<MessageCleanupJobSummary['scope'], string> = {
  source_message: 'Source message',
  last_hour: 'Last hour',
  last_day: 'Last 24 hours',
  last_7_days: 'Last 7 days',
};

const modeLabels: Record<MessageCleanupJobSummary['mode'], string> = {
  delete_only: 'Delete messages',
  ban_with_cleanup: 'Ban user and delete messages',
};

const itemStatusLabels: Record<MessageCleanupItem['status'], string> = {
  pending: 'Pending',
  deleted: 'Deleted',
  already_missing: 'Already missing',
  changed_since_preview: 'Changed after preview',
  evidence_failed: 'Evidence failed',
  delete_failed: 'Delete failed',
  permission_denied: 'Permission denied',
};

export function messageCleanupStatusClass(status: string): string {
  switch (status) {
    case 'completed':
    case 'deleted':
    case 'preserved':
    case 'succeeded':
    case 'ready':
      return 'ok';
    case 'failed':
    case 'evidence_failed':
    case 'delete_failed':
    case 'permission_denied':
    case 'denied':
    case 'unavailable':
      return 'error';
    case 'queued':
    case 'discovering':
    case 'executing':
    case 'indexing':
      return 'info';
    case 'partial':
    case 'too_many':
    case 'changed_since_preview':
      return 'warning';
    default:
      return 'neutral';
  }
}

function OutcomeMetric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function MessageCleanupOutcomes({
  outcomes,
}: {
  readonly outcomes: MessageCleanupAggregateOutcome;
}) {
  return (
    <dl className="cleanup-outcome-grid" aria-label="Message cleanup outcomes">
      <OutcomeMetric label="Candidates" value={outcomes.candidateCount} />
      <OutcomeMetric label="Evidence saved" value={outcomes.preservedCount} />
      <OutcomeMetric label="Deleted" value={outcomes.deletedCount} />
      <OutcomeMetric label="Already missing" value={outcomes.alreadyMissingCount} />
      <OutcomeMetric label="Changed" value={outcomes.changedSincePreviewCount} />
      <OutcomeMetric label="Evidence failed" value={outcomes.evidenceFailedCount} />
      <OutcomeMetric label="Delete failed" value={outcomes.deleteFailedCount} />
      <OutcomeMetric label="Permission denied" value={outcomes.permissionDeniedCount} />
    </dl>
  );
}

function MessageCleanupItemRow({ item }: { readonly item: MessageCleanupItem }) {
  return (
    <li className="cleanup-message-row">
      <div className="cleanup-message-heading">
        <div className="cleanup-message-meta">
          <span className={`status ${messageCleanupStatusClass(item.status)}`}>
            {itemStatusLabels[item.status]}
          </span>
          <strong>Channel {item.channelId}</strong>
          <span className="muted">{formatUtc(item.messageCreatedAt)}</span>
        </div>
        <div className="cleanup-message-links">
          {item.sourceMessageUrl ? (
            <a
              className="link-control"
              href={item.sourceMessageUrl}
              rel="noreferrer"
              target="_blank"
            >
              Source
            </a>
          ) : null}
          {item.evidenceMessageUrl ? (
            <a
              className="link-control"
              href={item.evidenceMessageUrl}
              rel="noreferrer"
              target="_blank"
            >
              Evidence
            </a>
          ) : null}
        </div>
      </div>
      <pre className="cleanup-message-content">
        {item.contentPreview || 'No text content in the stored preview.'}
      </pre>
      <div className="cleanup-message-facts">
        <span>
          {item.attachmentCount} attachment{item.attachmentCount === 1 ? '' : 's'}
        </span>
        <span>{item.bulkDeleteEligible ? 'Bulk-delete eligible' : 'Single delete required'}</span>
        <span>Found via {item.discoverySource.split('_').join(' ')}</span>
        <span>Evidence {item.evidenceStatus}</span>
      </div>
      {item.failureReason ? (
        <p className="danger-text cleanup-item-error">{item.failureReason}</p>
      ) : null}
    </li>
  );
}

export function MessageCleanupItemList({
  items,
}: {
  readonly items: readonly MessageCleanupItem[];
}) {
  if (items.length === 0) {
    return <p className="muted">No messages were included in this preview.</p>;
  }

  return (
    <section aria-label="Message cleanup preview">
      <ul className="cleanup-message-list">
        {items.map((item) => (
          <MessageCleanupItemRow item={item} key={item.id} />
        ))}
      </ul>
    </section>
  );
}

export function MessageCleanupJobSummaryBlock({ job }: { readonly job: MessageCleanupJobSummary }) {
  return (
    <>
      <div className="cleanup-job-heading">
        <div>
          <span className={`status ${messageCleanupStatusClass(job.status)}`}>{job.status}</span>
          <h2>{modeLabels[job.mode]}</h2>
        </div>
        {job.evidenceThreadUrl ? (
          <a
            className="button secondary compact-button"
            href={job.evidenceThreadUrl}
            rel="noreferrer"
            target="_blank"
          >
            Evidence thread
          </a>
        ) : null}
      </div>
      <dl className="cleanup-job-facts">
        <div>
          <dt>Scope</dt>
          <dd>{scopeLabels[job.scope]}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{job.coverage ? job.coverage.split('_').join(' ') : 'Pending'}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{formatUtc(job.createdAt)}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{job.requestedBy}</dd>
        </div>
        <div className="cleanup-job-reason">
          <dt>Reason</dt>
          <dd>{job.reason}</dd>
        </div>
      </dl>
    </>
  );
}

export function MessageCleanupJobDetail({
  detail,
  guildName,
  sessionUsername,
}: {
  readonly detail: MessageCleanupJobDetailContract;
  readonly guildName: string;
  readonly sessionUsername: string;
}) {
  const caseHref = `/admin/guild/${detail.guildId}/cases/${detail.verificationEventId}`;
  const active = ['queued', 'discovering', 'executing'].includes(detail.status);

  return (
    <main className="shell stack">
      <MessageCleanupJobPoller active={active} />
      <nav className="topbar">
        <a className="brand" href={caseHref}>
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={caseHref}>
            Case
          </a>
          <a className="button secondary" href={`/admin/guild/${detail.guildId}/inbox`}>
            Inbox
          </a>
          <a className="button secondary" href={`/admin/guild/${detail.guildId}/operations`}>
            Operations
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <p className="muted">{guildName} Message Cleanup</p>
      <section className="panel stack">
        <MessageCleanupJobSummaryBlock job={detail} />
        <MessageCleanupOutcomes outcomes={detail.outcomes} />
        {detail.mode === 'ban_with_cleanup' ? (
          <div className="cleanup-lifecycle" aria-label="Combined action state">
            <span>
              Ban <strong>{detail.banStatus.split('_').join(' ')}</strong>
            </span>
            <span>
              Case finalization{' '}
              <strong>{detail.caseFinalizationStatus.split('_').join(' ')}</strong>
            </span>
          </div>
        ) : null}
        {detail.lastError ? <p className="danger-text">{detail.lastError}</p> : null}
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Message outcomes</h2>
          <p className="muted">Every candidate and its preserved evidence outcome.</p>
        </div>
        <MessageCleanupItemList items={detail.items} />
      </section>
    </main>
  );
}
