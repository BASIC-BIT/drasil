import type { CaseSummary } from '@drasil/contracts';
import { Timestamp } from '@/components/workspace/Timestamp';
import styles from './InboxWorkspace.module.css';

export function ParkedRecoveryList({
  guildId,
  cases,
  returnHref,
}: {
  readonly guildId: string;
  readonly cases: readonly CaseSummary[];
  readonly returnHref: string;
}) {
  const parked = cases.filter((item) => item.guildId === guildId);
  if (parked.length === 0) return null;
  return (
    <section aria-label="Parked recovery" className={styles.parkedRecovery}>
      <h2 className={styles.queueHeading}>Parked recovery</h2>
      <ul className={styles.queueList}>
        {parked.map((item) => (
          <li key={item.id}>
            <a
              href={`/admin/guild/${encodeURIComponent(guildId)}/cases/${encodeURIComponent(item.id)}?${new URLSearchParams({ returnTo: returnHref })}`}
            >
              <span className={styles.rowTop}>
                <strong>{item.userIdentity.displayLabel}</strong>
                <span>Parked</span>
              </span>
              <span>Account recovery</span>
              <span className={styles.rowDate}>
                <Timestamp prefix="Parked" value={item.parkedAt ?? null} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
