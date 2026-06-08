import type { CaseSummary } from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import {
  formatCaseAction,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatUtc,
  freshnessStatusClass,
  presenceStatusClass,
} from '@/lib/casePresentation';

interface CaseQueueViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly sessionUsername: string;
  readonly cases: readonly CaseSummary[];
}

function SurfaceLinks({ item }: { readonly item: CaseSummary }) {
  if (item.surfaces.length === 0) {
    return <p className="muted">No Discord surfaces recorded yet.</p>;
  }

  return (
    <div className="surface-list" aria-label="Discord surfaces">
      {item.surfaces.map((surface) => (
        <a
          className="surface-link"
          href={surface.url}
          key={`${item.id}-${surface.kind}`}
          rel="noreferrer"
          target="_blank"
        >
          {surface.label}
        </a>
      ))}
    </div>
  );
}

function CaseCard({ guildId, item }: { readonly guildId: string; readonly item: CaseSummary }) {
  return (
    <article className="card case-card stack">
      <div className="case-card-header">
        <div>
          <span className={presenceStatusClass(item.presenceState)}>
            {formatPresenceState(item.presenceState)}
          </span>
          <h2>
            <a href={`/admin/guild/${guildId}/cases/${item.id}`}>User {item.userId}</a>
          </h2>
        </div>
        <span className={freshnessStatusClass(item.stale)}>
          {item.stale ? `${item.staleHours}h stale` : 'Fresh'}
        </span>
      </div>

      <div className="case-meta">
        <div>
          <span className="muted">Latest detection</span>
          <strong>{formatDetectionType(item.latestDetectionType)}</strong>
        </div>
        <div>
          <span className="muted">Confidence</span>
          <strong>{formatConfidence(item.confidence)}</strong>
        </div>
        <div>
          <span className="muted">Last movement</span>
          <strong>{formatUtc(item.updatedAt)}</strong>
        </div>
      </div>

      <SurfaceLinks item={item} />

      <div className="pill-list" aria-label="Available moderator paths">
        {item.allowedActions.map((action) => (
          <span className="pill action-pill" key={`${item.id}-${action}`}>
            {formatCaseAction(action)}
          </span>
        ))}
      </div>
    </article>
  );
}

export function CaseQueueView({ guildId, guildName, sessionUsername, cases }: CaseQueueViewProps) {
  const staleCount = cases.filter((item) => item.stale).length;

  return (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href="/admin">
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <a className="button secondary" href="/admin">
            All servers
          </a>
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div>
          <span className={staleCount > 0 ? 'status warning' : 'status info'}>
            {cases.length} active cases
          </span>
          <h1 className="page-title">{guildName} case queue</h1>
          <p className="lede">
            Read-only queue for pending Discord moderation cases. Actions still happen through the
            linked Discord surfaces so evidence and moderator provenance stay intact.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Stale</span>
            <strong>{staleCount}</strong>
          </div>
          <div>
            <span className="muted">Fresh</span>
            <strong>{cases.length - staleCount}</strong>
          </div>
          <div>
            <span className="muted">Review mode</span>
            <strong>Read-only web queue</strong>
          </div>
        </div>
      </section>

      {cases.length === 0 ? (
        <section className="panel stack">
          <span className="status ok">Clear</span>
          <h2>No pending cases</h2>
          <p className="muted">Drasil has no active verification events for this server.</p>
        </section>
      ) : (
        <section className="case-list" aria-label="Active cases">
          {cases.map((item) => (
            <CaseCard guildId={guildId} item={item} key={item.id} />
          ))}
        </section>
      )}
    </main>
  );
}
