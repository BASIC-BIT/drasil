import type {
  CaseAction,
  CaseDetail,
  CaseDetectionHistoryItem,
  CaseEvidenceItem,
  CaseMessageContextItem,
  CaseModerationOutcome,
} from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import type {
  CaseDiscordMessage,
  CaseDiscordSnapshot,
  CaseDiscordThreadSnapshot,
} from '@/lib/caseDiscordContent';
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
  readonly discordSnapshot?: CaseDiscordSnapshot;
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
          <span className={confidenceStatusClass(detail.confidence)}>
            {formatConfidence(detail.confidence)}
          </span>
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

function CompactExternalLink({
  href,
  label,
  children = 'Open',
}: {
  readonly href: string;
  readonly label: string;
  readonly children?: string;
}) {
  return (
    <a className="link-control" href={href} rel="noreferrer" target="_blank" title={label}>
      <span aria-hidden="true">{children}</span>
      <span className="visually-hidden">{label}</span>
    </a>
  );
}

function DiscordMessageBlock({ message }: { readonly message: CaseDiscordMessage }) {
  return (
    <article className="evidence-row">
      <div className="evidence-row-header">
        <div className="evidence-meta">
          <strong>{message.authorLabel}</strong>
          <span className="muted">{formatUtc(message.timestamp)}</span>
        </div>
        <CompactExternalLink href={message.url} label="Open this Discord message" />
      </div>
      <pre className="message-content">{message.content || 'No text content.'}</pre>
      {message.attachments.length > 0 ? (
        <div className="attachment-list">
          {message.attachments.map((attachment) => (
            <p key={attachment.id}>
              <span className="muted">Attachment</span>
              <span>{attachment.filename ?? attachment.id}</span>
              {attachment.url ? (
                <CompactExternalLink href={attachment.url} label="Open this Discord attachment">
                  Open attachment
                </CompactExternalLink>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function DiscordThreadBlock({ thread }: { readonly thread: CaseDiscordThreadSnapshot }) {
  return (
    <div className="evidence-group">
      <div className="evidence-group-header">
        <div>
          <h3>{thread.label}</h3>
        </div>
        <div className="evidence-actions">
          {thread.truncated ? <span className="status warning">Limited</span> : null}
          <CompactExternalLink href={thread.url} label={`Open ${thread.label}`}>
            Open thread
          </CompactExternalLink>
        </div>
      </div>
      {thread.error ? <p className="muted">Could not load thread messages: {thread.error}</p> : null}
      {!thread.error && thread.messages.length === 0 ? (
        <p className="muted">No Discord messages returned for this thread.</p>
      ) : null}
      {thread.messages.map((message) => (
        <DiscordMessageBlock key={message.id} message={message} />
      ))}
    </div>
  );
}

function StoredEvidenceItem({ item }: { readonly item: CaseEvidenceItem }) {
  return (
    <article className="evidence-row">
      <div className="evidence-row-header">
        <div className="evidence-meta">
          <strong>{formatDetectionType(item.kind)}</strong>
          <span className="muted">{formatUtc(item.createdAt)}</span>
        </div>
        {item.url ? (
          <CompactExternalLink href={item.url} label={`Open ${formatDetectionType(item.kind)}`} />
        ) : null}
      </div>
      <pre className="message-content">{item.content || 'No stored text content.'}</pre>
    </article>
  );
}

function StoredMessageContextItem({ item }: { readonly item: CaseMessageContextItem }) {
  return (
    <article className="evidence-row">
      <div className="evidence-row-header">
        <div className="evidence-meta">
          <strong>{item.isSource ? 'Source preview' : 'Nearby user message'}</strong>
          <span className="muted">{formatUtc(item.createdAt)}</span>
        </div>
        {item.url ? (
          <CompactExternalLink href={item.url} label="Open this stored Discord message" />
        ) : null}
      </div>
      <pre className="message-content">{item.contentPreview}</pre>
    </article>
  );
}

function SourceMessageContent({
  detail,
  discordSnapshot,
}: {
  readonly detail: CaseDetail;
  readonly discordSnapshot?: CaseDiscordSnapshot;
}) {
  const storedSourceMessages = detail.messageContext.filter((item) => item.isSource);
  const storedContextMessages = detail.messageContext.filter((item) => !item.isSource);
  const storedMessages = [...storedSourceMessages, ...storedContextMessages];
  const hasContent = Boolean(
    discordSnapshot?.sourceMessage ||
      detail.evidenceItems.length > 0 ||
      storedMessages.length > 0
  );

  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Message Evidence</h2>
        <p className="muted">
          Live Discord content first, with stored fallback context when Drasil retained it.
        </p>
      </div>

      {discordSnapshot?.errors.length ? (
        <div className="member-warning neutral-warning">
          <strong>Some Discord content could not be loaded.</strong>
          <span>{discordSnapshot.errors.join(' ')}</span>
        </div>
      ) : null}

      {discordSnapshot?.sourceMessage ? (
        <div className="evidence-group evidence-group-primary">
          <h3>Live Source Message</h3>
          <DiscordMessageBlock message={discordSnapshot.sourceMessage} />
        </div>
      ) : null}

      {detail.evidenceItems.length > 0 ? (
        <div className="evidence-group">
          <h3>Reporter Evidence</h3>
          {detail.evidenceItems.map((item) => (
            <StoredEvidenceItem item={item} key={item.id} />
          ))}
        </div>
      ) : null}

      {storedMessages.length > 0 ? (
        <div className="evidence-group">
          <h3>Stored Message Context</h3>
          <p className="muted">
            Saved Discord previews for the source message and nearby messages from the same user.
          </p>
          {storedMessages.map((item) => (
            <StoredMessageContextItem item={item} key={item.id} />
          ))}
        </div>
      ) : null}

      {!hasContent ? (
        <p className="muted">No live Discord content or stored message context was available.</p>
      ) : null}
    </section>
  );
}

function ThreadContent({
  discordSnapshot,
}: {
  readonly discordSnapshot?: CaseDiscordSnapshot;
}) {
  const threads = discordSnapshot?.threads ?? [];

  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Thread Content</h2>
        <p className="muted">
          Live messages from the verification, evidence, and report-intake threads.
        </p>
      </div>
      {threads.length === 0 ? <p className="muted">No Discord threads recorded yet.</p> : null}
      {threads.map((thread) => (
        <DiscordThreadBlock key={`${thread.kind}-${thread.channelId}`} thread={thread} />
      ))}
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
              <span
                className={`${confidenceStatusClass(detection.confidence)} signal-pill confidence-pill`}
              >
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
  discordSnapshot,
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
          <a className="button secondary" href={`/admin/guild/${guildId}/reports`}>
            Reports
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/setup`}>
            Setup
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <p className="muted">{guildName} Active Case Detail</p>
      <SummaryPanel detail={detail} />
      <DiscordSurfaces detail={detail} />
      <ModerationOutcomes outcomes={detail.moderationOutcomes} />
      <SourceMessageContent detail={detail} discordSnapshot={discordSnapshot} />
      <DetectionHistory detections={detail.detectionHistory} />
      <ThreadContent discordSnapshot={discordSnapshot} />
    </main>
  );
}
