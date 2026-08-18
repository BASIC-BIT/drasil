import type { CaseAction, CaseSummary } from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CaseIdentity } from './CaseIdentity';
import { DiscordExternalLink } from './DiscordExternalLink';
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
  readonly parkedCases: readonly CaseSummary[];
}

function SurfaceLinks({ item }: { readonly item: CaseSummary }) {
  if (item.surfaces.length === 0) {
    return <p className="muted">No Discord surfaces recorded yet.</p>;
  }

  return (
    <div className="surface-list" aria-label="Discord surfaces">
      {item.surfaces.map((surface) => (
        <DiscordExternalLink
          className={surfaceKindClass(surface.kind)}
          desktopHref={surface.desktopUrl}
          href={surface.url}
          key={`${item.id}-${surface.kind}`}
          label={`${formatSurfaceKind(surface.kind)} for ${item.userIdentity.displayLabel}`}
        >
          {formatSurfaceKind(surface.kind)}
        </DiscordExternalLink>
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

  if (item.presenceState === 'kicked') {
    return (
      <div className="member-warning neutral-warning">
        <strong>User Already Kicked</strong>
        <span>This case has been resolved by removing the user from the server.</span>
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

function QuarantineStateNotice({ item }: { readonly item: CaseSummary }) {
  if (item.containmentStatus === 'in_progress') {
    return (
      <div className="member-warning neutral-warning">
        <strong>Account Quarantine In Progress</strong>
        <span>Drasil is running containment now; duplicate attempts will be rejected.</span>
      </div>
    );
  }

  if (item.containmentStatus === 'incomplete') {
    const effects = item.quarantineEffects;
    return (
      <div className="member-warning">
        <strong>Account Quarantine Incomplete</strong>
        <span>
          The account is not parked. Review blockers before retrying in Discord. Removed roles:{' '}
          {effects?.removedRoleCount ?? 0}; retained roles: {effects?.retainedRoleCount ?? 0};
          failed removals: {effects?.failedRoleCount ?? 0}; permission bypasses:{' '}
          {effects?.memberBypassCount ?? 0}.
        </span>
      </div>
    );
  }

  if (item.attentionState !== 'parked') {
    return null;
  }

  return (
    <div className="member-warning neutral-warning">
      <strong>Parked Account Quarantine</strong>
      <span>
        The user remains contained while their verification thread stays open for a recovery report.
        Release requires moderator verification.
      </span>
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
        <>
          <p className="muted action-caption">Available in Discord</p>
          <div className="pill-list" aria-label="Moderator paths available in Discord">
            {normalActions.map((action) => (
              <span className="pill action-pill" key={`${itemId}-${action}`}>
                {formatCaseAction(action)}
              </span>
            ))}
          </div>
        </>
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
        <CaseIdentity
          headingLevel={2}
          href={`/admin/guild/${guildId}/cases/${item.id}`}
          identity={item.userIdentity}
        />
        <span className={freshnessStatusClass(item.stale)}>
          {item.stale ? `${item.staleHours}h stale` : `Fresh, ${item.staleHours}h old`}
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
          <span className="muted">Latest detection at</span>
          <strong>{formatUtc(item.latestDetectionAt)}</strong>
        </div>
        <div>
          <span className="muted">Last queue update</span>
          <strong>{formatUtc(item.updatedAt)}</strong>
        </div>
        <div>
          <span className="muted">Last moderator action</span>
          <strong>
            {item.lastActionType ? formatDetectionType(item.lastActionType) : 'None recorded'}
          </strong>
        </div>
        <div>
          <span className="muted">Member state</span>
          <strong>{formatPresenceState(item.presenceState)}</strong>
        </div>
      </div>

      <MemberStateNotice item={item} />
      <QuarantineStateNotice item={item} />

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
  parkedCases,
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
          <a className="button secondary" href={`/admin/guild/${guildId}/inbox`}>
            Inbox
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/reports`}>
            Reports
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/history`}>
            History
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
          <h1 className="page-title">{guildName} Case Queue</h1>
          <p className="lede">
            Review pending moderation cases without moving the source of truth out of Discord. Web
            actions use the same bot-owned side effects as Discord.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Active cases</span>
            <strong>{cases.length}</strong>
          </div>
          <div>
            <span className="muted">Parked quarantines</span>
            <strong>{parkedCases.length}</strong>
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
            <strong>
              <a className="inline-link" href={`/admin/guild/${guildId}/history`}>
                {resolvedCaseCount}
              </a>
            </strong>
          </div>
        </div>
      </section>

      {cases.length === 0 ? (
        <section className="panel stack">
          <h2>No cases need review</h2>
          <p className="muted">
            {parkedCases.length > 0
              ? 'Contained account quarantines are parked below.'
              : 'Drasil has no active verification events for this server.'}{' '}
            {resolvedCaseCount} case{resolvedCaseCount === 1 ? '' : 's'} already resolved.
          </p>
        </section>
      ) : (
        <section className="stack" aria-label="Cases needing review">
          <div className="section-heading compact-heading">
            <h2>Needs Review</h2>
          </div>
          <div className="case-list">
            {cases.map((item) => (
              <CaseCard guildId={guildId} item={item} key={item.id} />
            ))}
          </div>
        </section>
      )}

      {parkedCases.length > 0 ? (
        <section className="stack" aria-label="Parked account quarantines">
          <div className="section-heading compact-heading">
            <h2>Parked Quarantines</h2>
            <p className="muted">Contained accounts waiting for the user to report recovery.</p>
          </div>
          <div className="case-list">
            {parkedCases.map((item) => (
              <CaseCard guildId={guildId} item={item} key={item.id} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
