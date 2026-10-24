import { Timestamp } from './Timestamp';
import type { ReportDetail } from '@drasil/contracts';
import { reportActionLabel, readyReport, reportName, type ReportReviewState } from './reportTriage';
import styles from './ReportInbox.module.css';

interface ReportQueueProps {
  readonly reports: readonly ReportDetail[];
  readonly selectedId: string | null;
  readonly states: Readonly<Record<string, ReportReviewState>>;
  readonly onSelect: (reportId: string) => void;
  readonly hasSearch?: boolean;
  readonly onClearSearch: () => void;
}

export function ReportQueue({
  reports,
  selectedId,
  states,
  onSelect,
  onClearSearch,
  hasSearch = false,
}: ReportQueueProps) {
  return (
    <section className={styles.queue} aria-label="Report queue">
      {reports.length > 0 || hasSearch ? (
        <div className={styles.queueHeading}>
          <span>
            {hasSearch
              ? `${reports.length} ${reports.length === 1 ? 'match' : 'matches'}`
              : 'Reports'}
          </span>
          {reports.length > 0 ? <span>Oldest first</span> : null}
        </div>
      ) : null}
      {reports.length === 0 ? (
        <div className={styles.empty}>
          <h2>{hasSearch ? 'No matching reports' : 'Inbox clear'}</h2>
          {hasSearch ? (
            <button type="button" onClick={onClearSearch}>
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        reports.map((report) => {
          const state = states[report.id] ?? readyReport;
          return (
            <button
              key={report.id}
              id={`report-row-${report.id}`}
              type="button"
              className={styles.queueRow}
              aria-pressed={selectedId === report.id}
              onClick={() => onSelect(report.id)}
            >
              <strong>{reportName(report)}</strong>
              <span>{report.summary ?? 'Member report'}</span>
              <span className={styles.rowMeta}>
                <span>{reportActionLabel(state) ?? 'Report'}</span>
                <Timestamp value={report.createdAt} />
              </span>
            </button>
          );
        })
      )}
    </section>
  );
}
