import type { CaseAction, CaseSummary } from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  formatCaseAction,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatSurfaceKind,
  formatUtc,
  confidenceStatusClass,
  freshnessStatusClass,
  isDebugCaseAction,
  surfaceKindClass,
} from '@/lib/casePresentation';

interface CaseQueueViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly resolvedCaseCount: number;
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
          className={surfaceKindClass(surface.kind)}
          href={surface.url}
          key={`${item.id}-${surface.kind}`}
          rel="noreferrer"
          target="_blank"
        >
          {formatSurfaceKind(surface.kind)}
        </a>
      ))}
    </div>
  );
}

function MemberStateNotice({ item }: { readonly item: CaseSummary }) {
  if (item.presenceState === 'in_server') {
    return null;
  }

  if (item.presenceState === 'left_or_removed') {
    return (
      <div className="member-warning">
        <strong>User Left Before Resolution</strong>
        <span>This case still needs a formal outcome before it leaves the queue.</span>
      </div>
    );
  }

  if (item.presenceState === 'banned') {
    return (
      <div className="member-warning neutral-warning">
        <strong>User Already Banned</strong>
        <span>Confirm whether to sync the ban or close the case.</span>
      </div>
    );
  }

  return (
    <div className="member-warning neutral-warning">
      <strong>Member State Unknown</strong>
      <span>Check Discord before taking moderator action.</span>
    </div>
  );
}

function ActionPills({
  actions,
  itemId,
}: {
  readonly actions: readonly CaseAction[];
  readonly itemId: string;
}) {
  const normalActions = actions.filter((action) => !isDebugCaseAction(action));
  const debugActions = actions.filter(isDebugCaseAction);

  return (
    <div className="action-stack">
      {normalActions.length > 0 ? (
        <div className="pill-list" aria-label="Available moderator paths">
          {normalActions.map((action) => (
            <span className="pill action-pill" key={`${itemId}-${action}`}>
              {formatCaseAction(action)}
            </span>
          ))}
        </div>
      ) : null}
      {debugActions.length > 0 ? (
        <details className="debug-actions">
          <summary>Debug Paths</summary>
          <div className="pill-list">
            {debugActions.map((action) => (
              <span className="pill debug-pill" key={`${itemId}-${action}`}>
                {formatCaseAction(action)}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CaseCard({ guildId, item }: { readonly guildId: string; readonly item: CaseSummary }) {
  return (
    <article className="card case-card stack">
      <div className="case-card-header">
        <div className="case-title-block">
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
          <span className="muted">Signal</span>
          <span className={confidenceStatusClass(item.confidence)}>
            {formatConfidence(item.confidence)}
          </span>
        </div>
        <div>
          <span className="muted">Last movement</span>
          <strong>{formatUtc(item.updatedAt)}</strong>
        </div>
        <div>
          <span className="muted">Member state</span>
          <strong>{formatPresenceState(item.presenceState)}</strong>
        </div>
      </div>

      <MemberStateNotice item={item} />

      <SurfaceLinks item={item} />
      <ActionPills actions={item.allowedActions} itemId={item.id} />
    </article>
  );
}

export function CaseQueueView({
  guildId,
  guildName,
  resolvedCaseCount,
  sessionUsername,
  cases,
}: CaseQueueViewProps) {
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
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="page-title">{guildName} Case Queue</h1>
          <p className="lede">
            Review pending moderation cases without moving the source of truth out of Discord.
            Actions still happen through the linked threads and messages.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Active cases</span>
            <strong>{cases.length}</strong>
          </div>
          <div>
            <span className="muted">Stale</span>
            <strong>{staleCount}</strong>
          </div>
          <div>
            <span className="muted">Fresh</span>
            <strong>{cases.length - staleCount}</strong>
          </div>
          <div>
            <span className="muted">Resolved</span>
            <strong>{resolvedCaseCount}</strong>
          </div>
        </div>
      </section>

      {cases.length === 0 ? (
        <section className="panel stack">
          <h2>No pending cases</h2>
          <p className="muted">
            Drasil has no active verification events for this server. {resolvedCaseCount} case
            {resolvedCaseCount === 1 ? '' : 's'} already resolved.
          </p>
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
