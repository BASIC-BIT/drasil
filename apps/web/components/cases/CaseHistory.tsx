import type { CaseDetail } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from './caseRecordLabel';
import styles from './CaseHistory.module.css';

export function CaseHistory({
  detail,
  headingId,
}: {
  readonly detail: CaseDetail;
  readonly headingId?: string;
}) {
  const outcomes = [...detail.moderationOutcomes].sort(
    (a, b) =>
      (b.occurredAt ? Date.parse(b.occurredAt) : -Infinity) -
      (a.occurredAt ? Date.parse(a.occurredAt) : -Infinity)
  );
  return (
    <section className={styles.history} aria-label="Moderation history">
      <header>
        <h2 id={headingId} tabIndex={headingId ? -1 : undefined}>
          Moderation history
        </h2>
        <span>
          {outcomes.length} {outcomes.length === 1 ? 'action' : 'actions'}
        </span>
      </header>
      {outcomes.length ? (
        <ol>
          {outcomes.map((outcome) => (
            <li key={outcome.id}>
              <h3>
                {recordLabel(outcome.outcomeType)} · {recordLabel(outcome.source)}
              </h3>
              {outcome.occurredAt ? (
                <Timestamp value={outcome.occurredAt} />
              ) : (
                <p>Time not recorded</p>
              )}
              {outcome.actorId ? <p>Actor {outcome.actorId}</p> : null}
              {outcome.reason ? <p className={styles.reason}>{outcome.reason}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p>No moderation actions recorded.</p>
      )}
    </section>
  );
}
