import type { ReportQueueAction, ReportQueueItem } from '@drasil/contracts';
import { closeSubmittedReport } from '@/app/admin/guild/[guildId]/reports/actions';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatDetectionType, formatUtc, freshnessStatusClass } from '@/lib/casePresentation';

interface ReportQueueViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly closedReportCount: number;
  readonly sessionUsername: string;
  readonly reports: readonly ReportQueueItem[];
}

const actionLabels: Record<ReportQueueAction, string> = {
  dismiss_no_action: 'Dismiss No Action',
  mark_actioned: 'Mark Actioned',
  mark_false_positive: 'False Positive',
  open_case: 'Open Case',
  open_report_thread: 'Open Report Thread',
};

type ReportClosureAction = Extract<
  ReportQueueAction,
  'mark_actioned' | 'dismiss_no_action' | 'mark_false_positive'
>;

const closureActions: ReportClosureAction[] = [
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
];

function ReportActions({ guildId, item }: { readonly guildId: string; readonly item: ReportQueueItem }) {
  const canClose = closureActions.some((action) => item.allowedActions.includes(action));

  return (
    <div className="action-stack">
      <div className="pill-list" aria-label="Report paths">
        {item.reportThreadUrl ? (
          <a className="pill action-pill" href={item.reportThreadUrl} rel="noreferrer" target="_blank">
            {actionLabels.open_report_thread}
          </a>
        ) : null}
        {item.latestCaseId ? (
          <a className="pill action-pill" href={`/admin/guild/${guildId}/cases/${item.latestCaseId}`}>
            Open Case
          </a>
        ) : null}
        {!item.latestCaseId && item.allowedActions.includes('open_case') ? (
          <span className="pill action-pill">{actionLabels.open_case}</span>
        ) : null}
      </div>

      {canClose ? (
        <div className="report-action-forms" aria-label="Report closure actions">
          {closureActions.map((action) =>
            item.allowedActions.includes(action) ? (
              <form action={closeSubmittedReport.bind(null, guildId, item.id, action)} key={action}>
                <button className="button secondary compact-button" type="submit">
                  {actionLabels[action]}
                </button>
              </form>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReportRow({ guildId, item }: { readonly guildId: string; readonly item: ReportQueueItem }) {
  return (
    <article className="card case-card stack">
      <div className="case-card-header">
        <div className="case-title-block">
          <h2>Report for {item.targetUserId ? `user ${item.targetUserId}` : 'unknown target'}</h2>
          <p className="muted">Reporter {item.reporterId}</p>
        </div>
        <span className={freshnessStatusClass(item.stale)}>
          {item.stale ? `${item.staleHours}h stale` : 'Fresh'}
        </span>
      </div>

      <div className="case-meta">
        <div>
          <span className="muted">Status</span>
          <strong>{formatDetectionType(item.status)}</strong>
        </div>
        <div>
          <span className="muted">Evidence</span>
          <strong>{item.evidenceCount}</strong>
        </div>
        <div>
          <span className="muted">Submitted</span>
          <strong>{formatUtc(item.createdAt)}</strong>
        </div>
        <div>
          <span className="muted">Last movement</span>
          <strong>{formatUtc(item.updatedAt)}</strong>
        </div>
      </div>

      {item.summary ? <p>{item.summary}</p> : <p className="muted">No summary recorded.</p>}
      <ReportActions guildId={guildId} item={item} />
    </article>
  );
}

export function ReportQueueView({
  guildId,
  guildName,
  closedReportCount,
  sessionUsername,
  reports,
}: ReportQueueViewProps) {
  const staleCount = reports.filter((item) => item.stale).length;

  return (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Cases
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <a className="button secondary" href="/admin">
            All servers
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="page-title">{guildName} Report Queue</h1>
          <p className="lede">
            Review submitted user reports separately from active verification cases and observed
            alerts.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Submitted reports</span>
            <strong>{reports.length}</strong>
          </div>
          <div>
            <span className="muted">Stale</span>
            <strong>{staleCount}</strong>
          </div>
          <div>
            <span className="muted">Fresh</span>
            <strong>{reports.length - staleCount}</strong>
          </div>
          <div>
            <span className="muted">Closed</span>
            <strong>{closedReportCount}</strong>
          </div>
        </div>
      </section>

      {reports.length === 0 ? (
        <section className="panel stack">
          <h2>No submitted reports</h2>
          <p className="muted">
            Drasil has no submitted report intakes waiting for review. {closedReportCount} report
            {closedReportCount === 1 ? '' : 's'} already closed.
          </p>
        </section>
      ) : (
        <section className="case-list" aria-label="Submitted reports">
          {reports.map((item) => (
            <ReportRow guildId={guildId} item={item} key={item.id} />
          ))}
        </section>
      )}
    </main>
  );
}
