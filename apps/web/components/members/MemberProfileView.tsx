import type {
  CaseSummary,
  MemberProfile,
  MemberProfileDetection,
  MemberProfileOutcome,
  MemberProfileReport,
} from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DiscordExternalLink } from '@/components/cases/DiscordExternalLink';
import { CaseIdentity } from '@/components/cases/CaseIdentity';
import {
  confidenceStatusClass,
  formatConfidence,
  formatDetectionType,
  formatPresenceState,
  formatUtc,
  moderationOutcomeStatusClass,
  presenceStatusClass,
} from '@/lib/casePresentation';
import type { DetectionAccountingWebAction } from '@/lib/detectionAccountingActionQueue';

interface MemberProfileViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly manualFlagRequestId?: string;
  readonly openCaseRequestId?: string;
  readonly profile: MemberProfile;
  readonly queueDetectionAccountingAction?: QueueDetectionAccountingAction;
  readonly queueMemberManualFlagAction?: QueueMemberManualFlagAction;
  readonly queueMemberOpenCaseAction?: QueueMemberOpenCaseAction;
  readonly queueObservedDetectionUndoAction?: QueueObservedDetectionUndoAction;
  readonly sessionUsername: string;
}

type QueueMemberManualFlagAction = (
  guildId: string,
  targetUserId: string,
  formData: FormData
) => Promise<void>;

type QueueMemberOpenCaseAction = (
  guildId: string,
  targetUserId: string,
  formData: FormData
) => Promise<void>;

type QueueDetectionAccountingAction = (
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: DetectionAccountingWebAction,
  formData: FormData
) => Promise<void>;

type QueueObservedDetectionUndoAction = (
  guildId: string,
  targetUserId: string,
  detectionEventId: string
) => Promise<void>;

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number | null;
}) {
  return (
    <div>
      <span className="muted">{label}</span>
      <strong>{value ?? 'Unknown'}</strong>
    </div>
  );
}

function MemberSummary({
  guildId,
  manualFlagRequestId,
  openCaseRequestId,
  profile,
  queueMemberManualFlagAction,
  queueMemberOpenCaseAction,
}: {
  readonly guildId: string;
  readonly manualFlagRequestId?: string;
  readonly openCaseRequestId?: string;
  readonly profile: MemberProfile;
  readonly queueMemberManualFlagAction?: QueueMemberManualFlagAction;
  readonly queueMemberOpenCaseAction?: QueueMemberOpenCaseAction;
}) {
  const canFlagUser = profile.presenceState === 'in_server' && queueMemberManualFlagAction;
  const canOpenCase = profile.presenceState === 'in_server' && queueMemberOpenCaseAction;

  return (
    <section className="panel stack">
      <div className="case-card-header">
        <CaseIdentity headingLevel={1} identity={profile.identity} />
        <span className={presenceStatusClass(profile.presenceState)}>
          {formatPresenceState(profile.presenceState)}
        </span>
      </div>
      <div className="case-meta compact">
        <Metric label="Cases" value={profile.cases.length} />
        <Metric label="Reports" value={profile.reports.length} />
        <Metric label="Detections" value={profile.detections.length} />
        <Metric label="Outcomes" value={profile.outcomes.length} />
        <Metric label="Join date" value={formatUtc(profile.membership.joinDate)} />
        <Metric label="Last message" value={formatUtc(profile.membership.lastMessageAt)} />
        <Metric label="Message count" value={profile.membership.messageCount} />
        <Metric
          label="Verification status"
          value={
            profile.membership.verificationStatus
              ? formatDetectionType(profile.membership.verificationStatus)
              : null
          }
        />
      </div>
      {canOpenCase || canFlagUser ? (
        <div className="actions">
          {canOpenCase ? (
            <details className="inline-action">
              <summary className="button secondary compact-button inline-action-summary">
                Open Case
              </summary>
              <form
                className="inline-action-panel"
                action={queueMemberOpenCaseAction.bind(null, guildId, profile.userId)}
              >
                <input
                  name="requestId"
                  type="hidden"
                  value={openCaseRequestId ?? `${profile.userId}-open-case`}
                />
                <label className="stack">
                  <span className="form-label">Reason</span>
                  <textarea
                    className="destructive-reason"
                    name="reason"
                    aria-label="Open Case reason"
                    rows={3}
                  />
                </label>
                <label className="checkbox-field">
                  <input name="confirmAction" type="checkbox" />
                  Confirm Open Case
                </label>
                <button className="button secondary compact-button" type="submit">
                  Queue Open Case
                </button>
              </form>
            </details>
          ) : null}
          {canFlagUser ? (
            <details className="inline-action">
              <summary className="button secondary compact-button inline-action-summary">
                Flag User
              </summary>
              <form
                className="inline-action-panel"
                action={queueMemberManualFlagAction.bind(null, guildId, profile.userId)}
              >
                <input
                  name="requestId"
                  type="hidden"
                  value={manualFlagRequestId ?? `${profile.userId}-manual-flag`}
                />
                <label className="stack">
                  <span className="form-label">Reason</span>
                  <textarea
                    className="destructive-reason"
                    name="reason"
                    aria-label="Flag User reason"
                    rows={3}
                  />
                </label>
                <label className="checkbox-field">
                  <input name="confirmAction" type="checkbox" />
                  Confirm Flag User
                </label>
                <button className="button danger-button compact-button" type="submit">
                  Queue Flag User
                </button>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CaseRows({
  cases,
  guildId,
}: {
  readonly cases: readonly CaseSummary[];
  readonly guildId: string;
}) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Cases</h2>
      </div>
      {cases.length === 0 ? (
        <p className="muted">No cases recorded for this member.</p>
      ) : (
        <div className="timeline">
          {cases.map((item) => (
            <article className="timeline-item" key={item.id}>
              <span className={presenceStatusClass(item.presenceState)}>
                {formatPresenceState(item.presenceState)}
              </span>
              <div>
                <h3>
                  <a className="inline-link" href={`/admin/guild/${guildId}/cases/${item.id}`}>
                    {formatDetectionType(item.latestDetectionType)}
                  </a>
                </h3>
                <p className="muted">{formatUtc(item.updatedAt)}</p>
                <p>
                  Signal{' '}
                  <span className={confidenceStatusClass(item.confidence)}>
                    {formatConfidence(item.confidence)}
                  </span>
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportRows({
  guildId,
  reports,
}: {
  readonly guildId: string;
  readonly reports: readonly MemberProfileReport[];
}) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Reports</h2>
      </div>
      {reports.length === 0 ? (
        <p className="muted">No reviewed reports target this member.</p>
      ) : (
        <div className="timeline">
          {reports.map((report) => (
            <article className="timeline-item" key={report.id}>
              <span className="status neutral">{formatDetectionType(report.status)}</span>
              <div>
                <h3>
                  <a className="inline-link" href={`/admin/guild/${guildId}/reports/${report.id}`}>
                    Report {report.id}
                  </a>
                </h3>
                <p className="muted">{formatUtc(report.updatedAt)}</p>
                <p>{report.summary ?? 'No report summary recorded.'}</p>
                {report.reportThreadUrl ? (
                  <DiscordExternalLink
                    className="link-control"
                    href={report.reportThreadUrl}
                    label={`Open report thread for ${report.id}`}
                  >
                    Open thread
                  </DiscordExternalLink>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SourceMessageOpenCaseAction({
  detection,
  guildId,
  openCaseRequestId,
  queueMemberOpenCaseAction,
  userId,
}: {
  readonly detection: MemberProfileDetection;
  readonly guildId: string;
  readonly openCaseRequestId?: string;
  readonly queueMemberOpenCaseAction: QueueMemberOpenCaseAction;
  readonly userId: string;
}) {
  if (!detection.sourceChannelId || !detection.sourceMessageId) {
    return null;
  }

  return (
    <details className="inline-action">
      <summary className="button secondary compact-button inline-action-summary">
        Open Case from Source
      </summary>
      <form
        className="inline-action-panel"
        action={queueMemberOpenCaseAction.bind(null, guildId, userId)}
      >
        <input
          name="requestId"
          type="hidden"
          value={`${openCaseRequestId ?? userId}-source-${detection.id}`}
        />
        <input name="sourceDetectionEventId" type="hidden" value={detection.id} />
        <input name="sourceChannelId" type="hidden" value={detection.sourceChannelId} />
        <input name="sourceMessageId" type="hidden" value={detection.sourceMessageId} />
        <label className="stack">
          <span className="form-label">Reason</span>
          <textarea
            className="destructive-reason"
            name="reason"
            aria-label={`Open Case from Source reason for ${detection.id}`}
            rows={3}
          />
        </label>
        <label className="checkbox-field">
          <input name="confirmAction" type="checkbox" />
          Confirm Open Case from Source
        </label>
        <button className="button secondary compact-button" type="submit">
          Queue Open Case from Source
        </button>
      </form>
    </details>
  );
}

function DetectionRows({
  canOpenCaseFromSource,
  detections,
  guildId,
  openCaseRequestId,
  queueDetectionAccountingAction,
  queueMemberOpenCaseAction,
  queueObservedDetectionUndoAction,
  userId,
}: {
  readonly canOpenCaseFromSource: boolean;
  readonly detections: readonly MemberProfileDetection[];
  readonly guildId: string;
  readonly openCaseRequestId?: string;
  readonly queueDetectionAccountingAction?: QueueDetectionAccountingAction;
  readonly queueMemberOpenCaseAction?: QueueMemberOpenCaseAction;
  readonly queueObservedDetectionUndoAction?: QueueObservedDetectionUndoAction;
  readonly userId: string;
}) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Detection History</h2>
      </div>
      {detections.length === 0 ? (
        <p className="muted">No detections recorded for this member.</p>
      ) : (
        <div className="timeline">
          {detections.map((detection) => {
            const accountingAction: DetectionAccountingWebAction = detection.accounting.excluded
              ? 'restore_detection'
              : 'ignore_detection';
            const accountingLabel = detection.accounting.excluded
              ? 'Restore Accounting'
              : 'Ignore Detection';

            return (
              <article className="timeline-item" key={detection.id}>
                <span className={`${confidenceStatusClass(detection.confidence)} signal-pill`}>
                  {formatConfidence(detection.confidence)}
                </span>
                <div>
                  <h3>{formatDetectionType(detection.detectionType)}</h3>
                  <p className="muted">{formatUtc(detection.detectedAt)}</p>
                  {detection.accounting.excluded ? (
                    <>
                      <p>
                        <span className="status warning">Accounting: Ignored</span>
                      </p>
                      <p className="muted">
                        {detection.accounting.reason ?? 'No accounting reason recorded.'}
                        {detection.accounting.excludedBy
                          ? ` by ${detection.accounting.excludedBy}`
                          : ''}
                        {detection.accounting.excludedAt
                          ? ` at ${formatUtc(detection.accounting.excludedAt)}`
                          : ''}
                      </p>
                    </>
                  ) : null}
                  {detection.observedAction ? (
                    <p>
                      <span className="status warning">
                        Observed action: {formatDetectionType(detection.observedAction)}
                      </span>
                    </p>
                  ) : null}
                  {detection.observedActionAt ? (
                    <p className="muted">
                      Actioned {formatUtc(detection.observedActionAt)}
                      {detection.observedActionBy ? ` by ${detection.observedActionBy}` : ''}
                    </p>
                  ) : null}
                  <p>
                    {detection.reasons.length > 0
                      ? detection.reasons.join(' ')
                      : 'No reasons recorded.'}
                  </p>
                  <div className="actions">
                    {detection.latestCaseId ? (
                      <a
                        className="button secondary compact-button"
                        href={`/admin/guild/${guildId}/cases/${detection.latestCaseId}`}
                      >
                        Open Case
                      </a>
                    ) : null}
                    {detection.sourceMessageUrl ? (
                      <DiscordExternalLink
                        className="link-control"
                        href={detection.sourceMessageUrl}
                        label={`Open source message for detection ${detection.id}`}
                      >
                        Open source
                      </DiscordExternalLink>
                    ) : null}
                    {canOpenCaseFromSource && queueMemberOpenCaseAction ? (
                      <SourceMessageOpenCaseAction
                        detection={detection}
                        guildId={guildId}
                        openCaseRequestId={openCaseRequestId}
                        queueMemberOpenCaseAction={queueMemberOpenCaseAction}
                        userId={userId}
                      />
                    ) : null}
                    {detection.observedAction && queueObservedDetectionUndoAction ? (
                      <form
                        action={queueObservedDetectionUndoAction.bind(
                          null,
                          guildId,
                          userId,
                          detection.id
                        )}
                      >
                        <button className="button secondary compact-button" type="submit">
                          Undo Observed Action
                        </button>
                      </form>
                    ) : null}
                    {queueDetectionAccountingAction ? (
                      <details className="inline-action">
                        <summary className="button secondary compact-button inline-action-summary">
                          {accountingLabel}
                        </summary>
                        <form
                          className="inline-action-panel"
                          action={queueDetectionAccountingAction.bind(
                            null,
                            guildId,
                            userId,
                            detection.id,
                            accountingAction
                          )}
                        >
                          <label className="stack">
                            <span className="form-label">Reason</span>
                            <textarea
                              className="destructive-reason"
                              name="reason"
                              aria-label={`${accountingLabel} reason`}
                              rows={3}
                            />
                          </label>
                          <label className="checkbox-field">
                            <input name="confirmAction" type="checkbox" />
                            Confirm {accountingLabel}
                          </label>
                          <button
                            className={
                              detection.accounting.excluded
                                ? 'button secondary compact-button'
                                : 'button danger-button compact-button'
                            }
                            type="submit"
                          >
                            Queue {accountingLabel}
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OutcomeRows({
  guildId,
  outcomes,
}: {
  readonly guildId: string;
  readonly outcomes: readonly MemberProfileOutcome[];
}) {
  return (
    <section className="panel stack">
      <div className="section-heading compact-heading">
        <h2>Moderation Outcomes</h2>
      </div>
      {outcomes.length === 0 ? (
        <p className="muted">No moderation outcomes recorded for this member.</p>
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
                <div className="actions">
                  {outcome.verificationEventId ? (
                    <a
                      className="button secondary compact-button"
                      href={`/admin/guild/${guildId}/cases/${outcome.verificationEventId}`}
                    >
                      Open Case
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function MemberProfileView({
  guildId,
  guildName,
  manualFlagRequestId,
  openCaseRequestId,
  profile,
  queueDetectionAccountingAction,
  queueMemberManualFlagAction,
  queueMemberOpenCaseAction,
  queueObservedDetectionUndoAction,
  sessionUsername,
}: MemberProfileViewProps) {
  return (
    <main className="shell stack">
      <nav className="topbar">
        <a className="brand" href={`/admin/guild/${guildId}/members/${profile.userId}`}>
          <span className="brand-mark" />
          <span>Drasil</span>
        </a>
        <div className="nav-cluster">
          <a className="button secondary" href={`/admin/guild/${guildId}/inbox`}>
            Inbox
          </a>
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Case Queue
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
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <p className="muted">{guildName} Member History</p>
      <MemberSummary
        guildId={guildId}
        manualFlagRequestId={manualFlagRequestId}
        openCaseRequestId={openCaseRequestId}
        profile={profile}
        queueMemberManualFlagAction={queueMemberManualFlagAction}
        queueMemberOpenCaseAction={queueMemberOpenCaseAction}
      />
      <CaseRows cases={profile.cases} guildId={guildId} />
      <ReportRows guildId={guildId} reports={profile.reports} />
      <DetectionRows
        canOpenCaseFromSource={
          profile.presenceState === 'in_server' && Boolean(queueMemberOpenCaseAction)
        }
        detections={profile.detections}
        guildId={guildId}
        openCaseRequestId={openCaseRequestId}
        queueDetectionAccountingAction={queueDetectionAccountingAction}
        queueMemberOpenCaseAction={queueMemberOpenCaseAction}
        queueObservedDetectionUndoAction={queueObservedDetectionUndoAction}
        userId={profile.userId}
      />
      <OutcomeRows guildId={guildId} outcomes={profile.outcomes} />
    </main>
  );
}
