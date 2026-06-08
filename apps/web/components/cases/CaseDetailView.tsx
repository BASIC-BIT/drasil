import type {
  CaseAction,
  CaseDetail,
  CaseDetectionHistoryItem,
  CaseModerationOutcome,
} from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import {
  confidenceStatusClass,
  formatCaseAction,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatSurfaceKind,
  formatUtc,
  freshnessStatusClass,
  isDebugCaseAction,
  moderationOutcomeStatusClass,
  surfaceKindClass,
} from '@/lib/casePresentation';

interface CaseDetailViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly sessionUsername: string;
  readonly detail: CaseDetail;
}

function SummaryPanel({ detail }: { readonly detail: CaseDetail }) {
  return (
    <section className="panel stack">
      <div className="case-card-header">
        <div className="case-title-block">
          <h1 className="page-title">User {detail.userId}</h1>
        </div>
        <span className={freshnessStatusClass(detail.stale)}>
          {detail.stale ? `${detail.staleHours}h stale` : 'Fresh'}
        </span>
      </div>

      <div className="case-meta">
        <div>
          <span className="muted">Latest detection</span>
          <strong>{formatDetectionType(detail.latestDetectionType)}</strong>
        </div>
        <div>
          <span className="muted">Signal</span>
          <strong>{formatConfidence(detail.confidence)}</strong>
        </div>
        <div>
          <span className="muted">Last movement</span>
          <strong>{formatUtc(detail.updatedAt)}</strong>
        </div>
        <div>
          <span className="muted">Member state</span>
          <strong>{formatPresenceState(detail.presenceState)}</strong>
        </div>
      </div>

      {detail.presenceState === 'left_or_removed' ? (
        <div className="member-warning">
          <strong>User Left Before Resolution</strong>
          <span>This case still needs a formal outcome before it leaves the queue.</span>
        </div>
      ) : null}
      {detail.presenceState === 'banned' ? (
        <div className="member-warning neutral-warning">
          <strong>User Already Banned</strong>
          <span>Confirm whether to sync the ban or close the case.</span>
        </div>
      ) : null}

      {detail.notes ? <p>{detail.notes}</p> : <p className="muted">No moderator notes recorded.</p>}
    </section>
  );
}

function ActionPills({ actions }: { readonly actions: readonly CaseAction[] }) {
  const normalActions = actions.filter((action) => !isDebugCaseAction(action));
  const debugActions = actions.filter(isDebugCaseAction);

  return (
    <div className="action-stack">
      {normalActions.length > 0 ? (
        <div className="pill-list" aria-label="Available moderator paths">
          {normalActions.map((action) => (
            <span className="pill action-pill" key={action}>
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
              <span className="pill debug-pill" key={action}>
                {formatCaseAction(action)}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DiscordSurfaces({ detail }: { readonly detail: CaseDetail }) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Discord Surfaces</h2>
        <p className="muted">Open the Discord records tied to this case.</p>
      </div>
      {detail.surfaces.length === 0 ? (
        <p className="muted">No Discord surfaces recorded yet.</p>
      ) : (
        <div className="surface-list">
          {detail.surfaces.map((surface) => (
            <a
              className={surfaceKindClass(surface.kind)}
              href={surface.url}
              key={surface.kind}
              rel="noreferrer"
              target="_blank"
            >
              {formatSurfaceKind(surface.kind)}
            </a>
          ))}
        </div>
      )}
      <ActionPills actions={detail.allowedActions} />
    </section>
  );
}

function DetectionHistory({
  detections,
}: {
  readonly detections: readonly CaseDetectionHistoryItem[];
}) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Detection History</h2>
        <p className="muted">Recent detections for this user in this server.</p>
      </div>
      {detections.length === 0 ? (
        <p className="muted">No detection history found.</p>
      ) : (
        <div className="timeline">
          {detections.map((detection) => (
            <article className="timeline-item" key={detection.id}>
              <span className={`${confidenceStatusClass(detection.confidence)} signal-pill`}>
                {formatConfidence(detection.confidence)}
              </span>
              <div>
                <h3>{formatDetectionType(detection.detectionType)}</h3>
                <p className="muted">{formatUtc(detection.detectedAt)}</p>
                {detection.reasons.length > 0 ? (
                  <p>{detection.reasons.join(' ')}</p>
                ) : (
                  <p className="muted">No reasons recorded.</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ModerationOutcomes({ outcomes }: { readonly outcomes: readonly CaseModerationOutcome[] }) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Moderation Outcomes</h2>
        <p className="muted">
          Persisted labels from Drasil, native Discord events, and sync flows.
        </p>
      </div>
      {outcomes.length === 0 ? (
        <p className="muted">No persisted outcomes yet.</p>
      ) : (
        <div className="timeline">
          {outcomes.map((outcome) => (
            <article className="timeline-item" key={outcome.id}>
              <span className={`${moderationOutcomeStatusClass(outcome.outcomeType)} signal-pill`}>
                {formatDetectionType(outcome.outcomeType)}
              </span>
              <div>
                <h3>{formatDetectionType(outcome.source)}</h3>
                <p className="muted">{formatUtc(outcome.occurredAt)}</p>
                <p>{outcome.reason ?? 'No reason recorded.'}</p>
                {outcome.actorId ? <p className="muted">Actor {outcome.actorId}</p> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function CaseDetailView({
  guildId,
  guildName,
  sessionUsername,
  detail,
}: CaseDetailViewProps) {
  return (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href={`/admin/guild/${guildId}/cases`}>
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Case Queue
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <p className="muted">{guildName} Active Case Detail</p>
      <SummaryPanel detail={detail} />
      <DiscordSurfaces detail={detail} />
      <DetectionHistory detections={detail.detectionHistory} />
      <ModerationOutcomes outcomes={detail.moderationOutcomes} />
    </main>
  );
}
