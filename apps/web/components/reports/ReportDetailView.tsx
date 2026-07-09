import type { ReportDetail, ReportEvidenceItem, ReportQueueAction } from '@drasil/contracts';
import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatDetectionType, formatUtc } from '@/lib/casePresentation';

type ReportClosureAction = Extract<
  ReportQueueAction,
  'mark_actioned' | 'dismiss_no_action' | 'mark_false_positive'
>;

type CloseReportAction = (
  guildId: string,
  reportId: string,
  action: ReportClosureAction
) => Promise<void>;

type OpenReportCaseAction = (guildId: string, reportId: string) => Promise<void>;

interface ReportDetailViewProps {
  readonly canOpenReportCases: boolean;
  readonly closeReportAction: CloseReportAction;
  readonly detail: ReportDetail;
  readonly guildId: string;
  readonly guildName: string;
  readonly openReportCaseAction: OpenReportCaseAction;
  readonly sessionUsername: string;
}

const actionLabels: Record<ReportQueueAction, string> = {
  dismiss_no_action: 'Dismiss No Action',
  mark_actioned: 'Mark Actioned',
  mark_false_positive: 'False Positive',
  open_case: 'Open Case',
  open_report_thread: 'Open Report Thread',
};

const closureActions: readonly ReportClosureAction[] = [
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
];

const evidenceLabels: Record<ReportEvidenceItem['kind'], string> = {
  admin_note: 'Admin Note',
  candidate_confirmation: 'Target Confirmation',
  followup_answer: 'Follow-Up Answer',
  message_link: 'Message Link',
  reported_text: 'Reported Text',
  reporter_text: 'Reporter Text',
  screenshot: 'Screenshot',
};

function ReportActions({
  canOpenReportCases,
  closeReportAction,
  detail,
  guildId,
  openReportCaseAction,
}: {
  readonly canOpenReportCases: boolean;
  readonly closeReportAction: CloseReportAction;
  readonly detail: ReportDetail;
  readonly guildId: string;
  readonly openReportCaseAction: OpenReportCaseAction;
}) {
  const canClose = closureActions.some((action) => detail.allowedActions.includes(action));
  const canOpenCase = !detail.latestCaseId && detail.allowedActions.includes('open_case');

  return (
    <div className="action-stack">
      <div className="pill-list" aria-label="Report paths">
        {detail.reportThreadUrl ? (
          <a
            className="pill action-pill"
            href={detail.reportThreadUrl}
            rel="noreferrer"
            target="_blank"
          >
            {actionLabels.open_report_thread}
          </a>
        ) : null}
        {detail.latestCaseId ? (
          <a
            className="pill action-pill"
            href={`/admin/guild/${guildId}/cases/${detail.latestCaseId}`}
          >
            Open Case
          </a>
        ) : null}
        {canOpenCase && canOpenReportCases ? (
          <form action={openReportCaseAction.bind(null, guildId, detail.id)}>
            <button className="button secondary compact-button" type="submit">
              {actionLabels.open_case}
            </button>
          </form>
        ) : null}
        {canOpenCase && !canOpenReportCases ? (
          <button
            className="button secondary compact-button"
            disabled
            title="Requires the bot-side case opener"
            type="button"
          >
            {actionLabels.open_case}
          </button>
        ) : null}
      </div>

      {canClose ? (
        <div className="report-action-forms" aria-label="Report closure actions">
          {closureActions.map((action) =>
            detail.allowedActions.includes(action) ? (
              <form action={closeReportAction.bind(null, guildId, detail.id, action)} key={action}>
                <button className="button secondary compact-button" type="submit">
                  {actionLabels[action]}
                </button>
              </form>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceRow({ item }: { readonly item: ReportEvidenceItem }) {
  return (
    <article className="case-card stack">
      <div className="case-card-header">
        <div className="case-title-block">
          <h3>{evidenceLabels[item.kind]}</h3>
          <p className="muted">{formatUtc(item.createdAt)}</p>
        </div>
      </div>
      {item.content ? <p>{item.content}</p> : <p className="muted">No text content recorded.</p>}
      <div className="pill-list">
        {item.sourceMessageUrl ? (
          <a
            className="pill action-pill"
            href={item.sourceMessageUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open Source Message
          </a>
        ) : null}
        {item.attachment?.url ? (
          <a
            className="pill action-pill"
            href={item.attachment.url}
            rel="noreferrer"
            target="_blank"
          >
            {item.attachment.name ?? 'Open Attachment'}
          </a>
        ) : null}
        {item.attachment?.contentType ? (
          <span className="pill">{item.attachment.contentType}</span>
        ) : null}
      </div>
    </article>
  );
}

export function ReportDetailView({
  canOpenReportCases,
  closeReportAction,
  detail,
  guildId,
  guildName,
  openReportCaseAction,
  sessionUsername,
}: ReportDetailViewProps) {
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
          <a className="button secondary" href={`/admin/guild/${guildId}/cases`}>
            Cases
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

      <section className="panel stack">
        <div className="section-heading">
          <p className="eyebrow">{guildName} Report Review</p>
          <h1 className="page-title">
            Report for {detail.targetUserId ? `user ${detail.targetUserId}` : 'unknown target'}
          </h1>
          <p className="lede">
            {detail.summary ??
              'Review submitted evidence before deciding whether to open a case or close the report.'}
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Status</span>
            <strong>{formatDetectionType(detail.status)}</strong>
          </div>
          <div>
            <span className="muted">Reporter</span>
            <strong>{detail.reporterId}</strong>
          </div>
          <div>
            <span className="muted">Target</span>
            <strong>{detail.targetUserId ?? 'Unconfirmed'}</strong>
          </div>
          <div>
            <span className="muted">Evidence</span>
            <strong>{detail.evidence.length}</strong>
          </div>
          <div>
            <span className="muted">Submitted</span>
            <strong>{formatUtc(detail.createdAt)}</strong>
          </div>
          <div>
            <span className="muted">Last movement</span>
            <strong>{formatUtc(detail.updatedAt)}</strong>
          </div>
        </div>
        <ReportActions
          canOpenReportCases={canOpenReportCases}
          closeReportAction={closeReportAction}
          detail={detail}
          guildId={guildId}
          openReportCaseAction={openReportCaseAction}
        />
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <h2>Report Evidence</h2>
          <p className="muted">
            Discord links and retained evidence supplied during report intake.
          </p>
        </div>
        {detail.evidence.length === 0 ? (
          <p className="muted">No retained evidence is recorded for this report.</p>
        ) : (
          <div className="case-list">
            {detail.evidence.map((item) => (
              <EvidenceRow item={item} key={item.id} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
