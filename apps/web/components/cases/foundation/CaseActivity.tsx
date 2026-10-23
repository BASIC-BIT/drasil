import type { CaseDetail, ReportDetail } from '@drasil/contracts';
import { Timestamp } from '@/components/inbox/foundation/Timestamp';
import { caseRequestLabel, recordLabel, type CaseRequestState } from './caseReview';
import styles from './CaseWorkspace.module.css';

export function CaseActivity({
  detail,
  report,
  request,
}: {
  readonly detail: CaseDetail;
  readonly report?: ReportDetail;
  readonly request: CaseRequestState;
}) {
  const events = [
    {
      id: 'case-opened',
      label: 'Case opened',
      at: detail.createdAt,
      source: null,
      actor: null,
      body: null,
    },
    ...(report
      ? [
          {
            id: 'report-submitted',
            label: 'Report submitted',
            at: report.createdAt,
            source: 'Member report',
            actor: report.reporterId,
            body: null,
          },
        ]
      : []),
    ...detail.detectionHistory.map((item) => ({
      id: `detection-${item.id}`,
      label: recordLabel(item.detectionType),
      at: item.detectedAt,
      source: 'Detection',
      actor: null,
      body: null,
    })),
    ...detail.moderationOutcomes.map((item) => ({
      id: `outcome-${item.id}`,
      label: recordLabel(item.outcomeType),
      at: item.occurredAt,
      source: recordLabel(item.source),
      actor: item.actorId,
      body: item.reason,
    })),
  ].sort((a, b) => (b.at ? Date.parse(b.at) : -Infinity) - (a.at ? Date.parse(a.at) : -Infinity));
  const requestLabel = caseRequestLabel(request);
  return (
    <details className={styles.activityDisclosure}>
      <summary>Recorded activity</summary>
      <section aria-label="Case activity">
        {requestLabel ? (
          <div className={styles.requestEvent}>
            <h3>{requestLabel}</h3>
            {request.kind === 'settled' && request.result.requestId ? (
              <p className={styles.muted}>Request {request.result.requestId}</p>
            ) : null}
          </div>
        ) : null}
        <ol className={styles.timeline}>
          {events.map((event) => (
            <li key={event.id}>
              {event.at ? (
                <Timestamp value={event.at} />
              ) : (
                <span className={styles.muted}>Time not recorded</span>
              )}
              <h3>{event.label}</h3>
              {event.source || event.actor ? (
                <p className={styles.muted}>
                  {[event.source, event.actor].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {event.body ? <p>{event.body}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </details>
  );
}
