import type { CaseDetail } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
import { recordLabel } from './caseRecordLabel';
import styles from './CaseChecks.module.css';

export function CaseChecks({
  detail,
  headingId,
}: {
  readonly detail: CaseDetail;
  readonly headingId?: string;
}) {
  const checks = detail.detectionHistory
    .filter((item) => item.detectionType !== 'user_report')
    .sort(
      (a, b) =>
        (b.detectedAt ? Date.parse(b.detectedAt) : -Infinity) -
        (a.detectedAt ? Date.parse(a.detectedAt) : -Infinity)
    );
  const [latest, ...earlier] = checks;
  if (!latest) return null;
  const check = (item: CaseDetail['detectionHistory'][number]) => (
    <article key={item.id} className={styles.check}>
      <header>
        <h3>{recordLabel(item.detectionType)}</h3>
        <Timestamp value={item.detectedAt} />
      </header>
      <ul>
        {item.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      <p className={styles.muted}>Check confidence {Math.round(item.confidence * 100)}%</p>
    </article>
  );
  return (
    <section className={styles.section} aria-label="Member detection history">
      <div className={styles.sectionHeading}>
        <h2 id={headingId} tabIndex={headingId ? -1 : undefined}>
          Member detection history
        </h2>
        <span>
          {checks.length} {checks.length === 1 ? 'check' : 'checks'}
        </span>
      </div>
      {check(latest)}
      {earlier.length ? (
        <details className={styles.disclosure}>
          <summary>
            Earlier checks <span>{earlier.length}</span>
          </summary>
          {earlier.map(check)}
        </details>
      ) : null}
    </section>
  );
}
