import type {
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
  formatUtc,
  freshnessStatusClass,
  moderationOutcomeStatusClass,
  presenceStatusClass,
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
        <div>
          <span className={presenceStatusClass(detail.presenceState)}>
            {formatPresenceState(detail.presenceState)}
          </span>
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
          <span className="muted">Confidence</span>
          <strong>{formatConfidence(detail.confidence)}</strong>
        </div>
        <div>
          <span className="muted">Last movement</span>
          <strong>{formatUtc(detail.updatedAt)}</strong>
        </div>
      </div>

      {detail.notes ? <p>{detail.notes}</p> : <p className="muted">No moderator notes recorded.</p>}
    </section>
  );
}

function DiscordSurfaces({ detail }: { readonly detail: CaseDetail }) {
  return (
    <section className="panel stack">
      <div>
        <h2>Discord surfaces</h2>
        <p className="muted">Use these links to act in Discord while preserving thread history.</p>
      </div>
      {detail.surfaces.length === 0 ? (
        <p className="muted">No Discord surfaces recorded yet.</p>
      ) : (
        <div className="surface-list">
          {detail.surfaces.map((surface) => (
            <a
              className="surface-link"
              href={surface.url}
              key={surface.kind}
              rel="noreferrer"
              target="_blank"
            >
              {surface.label}
            </a>
          ))}
        </div>
      )}
      <div className="pill-list" aria-label="Available moderator paths">
        {detail.allowedActions.map((action) => (
          <span className="pill action-pill" key={action}>
            {formatCaseAction(action)}
          </span>
        ))}
      </div>
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
      <div>
        <h2>Detection history</h2>
        <p className="muted">Recent detections for this user in this server.</p>
      </div>
      {detections.length === 0 ? (
        <p className="muted">No detection history found.</p>
      ) : (
        <div className="timeline">
          {detections.map((detection) => (
            <article className="timeline-item" key={detection.id}>
              <span className={confidenceStatusClass(detection.confidence)}>
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
      <div>
        <h2>Moderation outcomes</h2>
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
              <span className={moderationOutcomeStatusClass(outcome.outcomeType)}>
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
            Case queue
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <p className="muted">{guildName} active case detail</p>
      <SummaryPanel detail={detail} />
      <DiscordSurfaces detail={detail} />
      <DetectionHistory detections={detail.detectionHistory} />
      <ModerationOutcomes outcomes={detail.moderationOutcomes} />
    </main>
  );
}
