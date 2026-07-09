import { AccountControl } from '@/components/AccountControl';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatUtc } from '@/lib/casePresentation';
import type { DiscordRole } from '@/lib/discordApi';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { ModerationQueueOperationAction } from '@/lib/moderationQueueOperationActionQueue';
import type {
  OperationsIntegrityFinding,
  OperationsIntegritySnapshot,
} from '@/lib/operationsIntegrityDataAdapter';

interface OperationsViewProps {
  readonly guildId: string;
  readonly guildName: string;
  readonly integritySnapshot: OperationsIntegritySnapshot;
  readonly queueChannelLabel: string | null;
  readonly queueModerationQueueOperation: QueueModerationQueueOperation;
  readonly recentRequests: readonly ModerationActionRequestSummary[];
  readonly roles: readonly DiscordRole[];
  readonly roleIntakeDefaultRoleId: string | null;
  readonly sessionUsername: string;
}

type QueueModerationQueueOperation = (
  guildId: string,
  action: ModerationQueueOperationAction,
  formData?: FormData
) => Promise<void>;

const requestActionLabels: Record<string, string> = {
  apply_case_role_lockdown: 'Apply Case-Role Lockdown',
  audit_case_role_lockdown: 'Audit Case-Role Lockdown',
  ban_case_user: 'Ban Case User',
  ban_case_user_by_id: 'Ban Case User by ID',
  ban_observed_detection: 'Ban Observed Alert',
  clear_moderation_queue: 'Clear Queue',
  complete_setup_verification: 'Complete Core Setup',
  close_resolved_case_threads: 'Close Resolved Threads',
  close_case_no_action: 'Close Case No Action',
  dismiss_observed_detection: 'Dismiss Observed Alert',
  ignore_detection_accounting: 'Ignore Detection',
  intake_role_members: 'Intake Role Members',
  kick_case_user: 'Kick Case User',
  kick_observed_detection: 'Kick Observed Alert',
  manual_flag_user: 'Flag User',
  mark_observed_detection_false_positive: 'False Positive Observed Alert',
  open_admin_case: 'Open Admin Case',
  open_case_from_observed_detection: 'Open Observed Case',
  refresh_case_notification: 'Refresh Notification',
  reopen_case: 'Reopen Case',
  repair_active_case: 'Repair Active Case',
  restore_detection_accounting: 'Restore Detection',
  sync_existing_ban: 'Sync Existing Ban',
  sync_moderation_queue: 'Sync Queue',
  undo_observed_detection_action: 'Undo Observed Alert Action',
  upsert_report_instructions: 'Repair Report Button',
  verify_case_user: 'Verify Case User',
};

const integrityFindingLabels: Record<string, string> = {
  case_role_member_resolved_status: 'Case Role on Resolved Member',
  pending_case_notification_pointer_missing: 'Notification Pointer Missing',
  pending_case_thread_missing: 'Case Thread Missing',
  queue_case_mirror_not_pending: 'Queue Case Mirror Not Pending',
  queue_item_missing_message_pointer: 'Queue Message Pointer Missing',
  queue_item_wrong_channel: 'Queue Item Wrong Channel',
  resolved_case_missing_admin_action: 'Resolved Case Missing Admin Action',
  resolved_case_missing_moderation_outcome: 'Resolved Case Missing Outcome',
};

const deploymentRuntimeItems = [
  {
    detail: 'Build image, run migrations, update ECS, and wait for service stability on main.',
    label: 'Production Deploy',
    source: '.github/workflows/deploy-prod.yml',
    status: 'workflow',
    statusClass: 'info',
  },
  {
    detail: 'Validate infrastructure and keep Terraform drift visible before rollout changes.',
    label: 'Infrastructure Check',
    source: '.github/workflows/iac.yml',
    status: 'workflow',
    statusClass: 'info',
  },
  {
    detail: 'AWS deployment and rollback source for ECS, ECR, migrations, and production rollout.',
    label: 'AWS Runbook',
    source: 'docs/deploy/aws.md',
    status: 'runbook',
    statusClass: 'neutral',
  },
  {
    detail: 'Database backup and recovery source for operator-facing runtime verification.',
    label: 'Backup Runbook',
    source: 'docs/deploy/database-backups.md',
    status: 'runbook',
    statusClass: 'neutral',
  },
  {
    detail: 'Discord deployment and permission source for bot installation/runtime checks.',
    label: 'Discord Runtime',
    source: 'docs/deploy/discord.md',
    status: 'runbook',
    statusClass: 'neutral',
  },
] as const;

function formatRequestAction(actionType: string): string {
  return requestActionLabels[actionType] ?? actionType.split('_').join(' ');
}

function formatIntegrityFinding(code: string): string {
  return integrityFindingLabels[code] ?? code.split('_').join(' ');
}

function roleOptions(
  guildId: string,
  roles: readonly DiscordRole[],
  selectedRoleId: string | null
) {
  return roles
    .filter((role) => role.id !== guildId && !role.managed)
    .sort((left, right) => right.position - left.position || left.name.localeCompare(right.name))
    .map((role) => (
      <option key={role.id} value={role.id}>
        {role.name}
        {role.id === selectedRoleId ? ' (configured)' : ''}
      </option>
    ));
}

function statusClass(status: ModerationActionRequestSummary['status']): string {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'failed':
      return 'error';
    case 'processing':
      return 'info';
    case 'queued':
      return 'warning';
  }
}

function severityClass(severity: OperationsIntegrityFinding['severity']): string {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
  }
}

export function OperationsView({
  guildId,
  guildName,
  integritySnapshot,
  queueChannelLabel,
  queueModerationQueueOperation,
  recentRequests,
  roles,
  roleIntakeDefaultRoleId,
  sessionUsername,
}: OperationsViewProps) {
  const totalIntegrityFindings =
    integritySnapshot.findingCounts.error +
    integritySnapshot.findingCounts.warning +
    integritySnapshot.findingCounts.info;

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
          <a className="button secondary" href="/admin">
            All Servers
          </a>
          <ThemeToggle />
          <AccountControl username={sessionUsername} />
        </div>
      </nav>

      <section className="panel stack">
        <div className="section-heading">
          <h1 className="page-title">{guildName} Operations</h1>
          <p className="lede">
            Queue bot-owned maintenance jobs without moving Discord queue state into the web app.
          </p>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Live queue channel</span>
            <strong>{queueChannelLabel ?? 'Not configured'}</strong>
          </div>
          <div>
            <span className="muted">Execution</span>
            <strong>Queued bot handoff</strong>
          </div>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Deployment Runtime</h2>
          <p className="muted">
            Operator-facing deployment and runtime-health sources kept with this repo.
          </p>
        </div>
        <div className="integrity-finding-list" aria-label="Deployment runtime sources">
          {deploymentRuntimeItems.map((item) => (
            <article className="integrity-finding-row" key={item.source}>
              <span className={`status ${item.statusClass}`}>{item.status}</span>
              <div>
                <h3>{item.label}</h3>
                <p>{item.detail}</p>
                <p className="muted">
                  <code>{item.source}</code>
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Integrity Snapshot</h2>
          <p className="muted">
            Database-backed consistency checks from Drasil records. Discord-live member, ban,
            channel, and message checks remain bot-side.
          </p>
        </div>
        <div className="integrity-count-grid" aria-label="Integrity counts">
          <div>
            <span className="muted">Pending cases</span>
            <strong>{integritySnapshot.candidateCounts.pendingCases}</strong>
          </div>
          <div>
            <span className="muted">Resolved cases</span>
            <strong>{integritySnapshot.candidateCounts.recentResolvedCases}</strong>
          </div>
          <div>
            <span className="muted">Case role markers</span>
            <strong>{integritySnapshot.candidateCounts.caseRoleMembers}</strong>
          </div>
          <div>
            <span className="muted">Role quarantines</span>
            <strong>{integritySnapshot.candidateCounts.activeRoleQuarantines}</strong>
          </div>
          <div>
            <span className="muted">Queue items</span>
            <strong>{integritySnapshot.candidateCounts.queueItems}</strong>
          </div>
        </div>
        <div className="case-meta compact">
          <div>
            <span className="muted">Findings</span>
            <strong>
              {integritySnapshot.findingCounts.error} errors,{' '}
              {integritySnapshot.findingCounts.warning} warnings
            </strong>
          </div>
          <div>
            <span className="muted">Checked</span>
            <strong>{formatUtc(integritySnapshot.checkedAt)}</strong>
          </div>
        </div>
        {integritySnapshot.findings.length === 0 ? (
          <p className="muted">No database-side integrity findings in the current snapshot.</p>
        ) : (
          <div className="integrity-finding-list" aria-label="Integrity findings">
            {integritySnapshot.findings.map((finding) => (
              <article className="integrity-finding-row" key={`${finding.code}-${finding.subject}`}>
                <span className={`status ${severityClass(finding.severity)}`}>
                  {finding.severity}
                </span>
                <div>
                  <h3>{formatIntegrityFinding(finding.code)}</h3>
                  <p>{finding.detail}</p>
                  <p className="muted">
                    {finding.subject}
                    {finding.userId ? ` for ${finding.userId}` : ''}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="muted">
          {totalIntegrityFindings === 0
            ? 'No stored-record drift surfaced.'
            : `${totalIntegrityFindings} stored-record finding${
                totalIntegrityFindings === 1 ? '' : 's'
              } surfaced.`}{' '}
          Live Discord fetch audit remains available in /audit integrity.
        </p>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Moderation Queue</h2>
          <p className="muted">
            Rebuild case and observed-alert mirrors, or clear existing queue mirrors when changing
            queue channels.
          </p>
        </div>
        <div className="report-action-forms" aria-label="Moderation queue operations">
          <form action={queueModerationQueueOperation.bind(null, guildId, 'sync_moderation_queue')}>
            <button className="button secondary compact-button" type="submit">
              Sync Queue
            </button>
          </form>
          <details className="destructive-action">
            <summary className="button secondary compact-button destructive-summary">
              Clear Queue
            </summary>
            <form
              action={queueModerationQueueOperation.bind(null, guildId, 'clear_moderation_queue')}
              className="destructive-action-panel"
            >
              <label className="checkbox-field destructive-confirm">
                <input name="confirmClearQueue" type="checkbox" />
                <span>Confirm Clear Queue</span>
              </label>
              <button className="button compact-button danger-button" type="submit">
                Queue Clear Queue
              </button>
            </form>
          </details>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Resolved Threads</h2>
          <p className="muted">
            Dry-run or queue bot-side closure for resolved case and evidence threads that stayed
            open after moderation finished.
          </p>
        </div>
        <div className="report-action-forms" aria-label="Resolved thread operations">
          <form
            action={queueModerationQueueOperation.bind(
              null,
              guildId,
              'close_resolved_case_threads'
            )}
            className="operation-parameter-form"
          >
            <input name="execute" type="hidden" value="false" />
            <label className="field compact-field">
              <span>Days</span>
              <input defaultValue="30" max="365" min="1" name="days" type="number" />
            </label>
            <label className="field compact-field">
              <span>Limit</span>
              <input defaultValue="100" max="500" min="1" name="limit" type="number" />
            </label>
            <button className="button secondary compact-button" type="submit">
              Dry Run Thread Sweep
            </button>
          </form>
          <details className="destructive-action">
            <summary className="button secondary compact-button destructive-summary">
              Close Threads
            </summary>
            <form
              action={queueModerationQueueOperation.bind(
                null,
                guildId,
                'close_resolved_case_threads'
              )}
              className="destructive-action-panel operation-parameter-form"
            >
              <input name="execute" type="hidden" value="true" />
              <label className="field compact-field">
                <span>Days</span>
                <input defaultValue="30" max="365" min="1" name="days" type="number" />
              </label>
              <label className="field compact-field">
                <span>Limit</span>
                <input defaultValue="100" max="500" min="1" name="limit" type="number" />
              </label>
              <label className="checkbox-field destructive-confirm">
                <input name="confirmCloseResolvedThreads" type="checkbox" />
                <span>Confirm Close Resolved Threads</span>
              </label>
              <button className="button compact-button danger-button" type="submit">
                Queue Close Threads
              </button>
            </form>
          </details>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Case-Role Lockdown</h2>
          <p className="muted">
            Preview or apply missing case-role channel denies through the logged-in bot, using the
            allow-list saved in Setup.
          </p>
        </div>
        <div className="report-action-forms" aria-label="Case-role lockdown operations">
          <form
            action={queueModerationQueueOperation.bind(null, guildId, 'audit_case_role_lockdown')}
          >
            <button className="button secondary compact-button" type="submit">
              Audit Lockdown
            </button>
          </form>
          <details className="destructive-action">
            <summary className="button secondary compact-button destructive-summary">
              Apply Lockdown
            </summary>
            <form
              action={queueModerationQueueOperation.bind(null, guildId, 'apply_case_role_lockdown')}
              className="destructive-action-panel"
            >
              <label className="checkbox-field">
                <input name="unsyncAllowedChannels" type="checkbox" />
                <span>Unsync Allowed Channels</span>
              </label>
              <label className="checkbox-field destructive-confirm">
                <input name="confirmApplyLockdown" type="checkbox" />
                <span>Confirm Apply Lockdown</span>
              </label>
              <button className="button compact-button danger-button" type="submit">
                Queue Apply Lockdown
              </button>
            </form>
          </details>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Role Intake</h2>
          <p className="muted">
            Preview or execute bulk case opening for non-bot members with a selected role.
          </p>
        </div>
        <div className="report-action-forms" aria-label="Role intake operations">
          <form
            action={queueModerationQueueOperation.bind(null, guildId, 'intake_role_members')}
            className="operation-parameter-form"
          >
            <input name="execute" type="hidden" value="false" />
            <label className="field compact-field wide-field">
              <span>Role</span>
              <select defaultValue={roleIntakeDefaultRoleId ?? ''} name="roleId">
                <option value="">Choose role</option>
                {roleOptions(guildId, roles, roleIntakeDefaultRoleId)}
              </select>
            </label>
            <label className="field compact-field">
              <span>Limit</span>
              <input defaultValue="250" max="250" min="1" name="limit" type="number" />
            </label>
            <label className="field compact-field wide-field">
              <span>Reason</span>
              <input maxLength={500} name="reason" type="text" />
            </label>
            <button className="button secondary compact-button" type="submit">
              Dry Run Role Intake
            </button>
          </form>
          <details className="destructive-action">
            <summary className="button secondary compact-button destructive-summary">
              Execute Role Intake
            </summary>
            <form
              action={queueModerationQueueOperation.bind(null, guildId, 'intake_role_members')}
              className="destructive-action-panel operation-parameter-form"
            >
              <input name="execute" type="hidden" value="true" />
              <label className="field compact-field wide-field">
                <span>Role</span>
                <select defaultValue={roleIntakeDefaultRoleId ?? ''} name="roleId">
                  <option value="">Choose role</option>
                  {roleOptions(guildId, roles, roleIntakeDefaultRoleId)}
                </select>
              </label>
              <label className="field compact-field">
                <span>Limit</span>
                <input defaultValue="250" max="250" min="1" name="limit" type="number" />
              </label>
              <label className="field compact-field wide-field">
                <span>Reason</span>
                <input maxLength={500} name="reason" type="text" />
              </label>
              <label className="checkbox-field destructive-confirm">
                <input name="confirmRoleIntake" type="checkbox" />
                <span>Confirm Execute Role Intake</span>
              </label>
              <button className="button compact-button danger-button" type="submit">
                Queue Execute Role Intake
              </button>
            </form>
          </details>
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading compact-heading">
          <h2>Recent Web Requests</h2>
          <p className="muted">
            Bot-owned requests from web actions, newest first. Failed rows keep the latest error.
          </p>
        </div>
        {recentRequests.length === 0 ? (
          <p className="muted">No web-requested bot actions have been recorded for this server.</p>
        ) : (
          <div className="request-history" aria-label="Recent web requests">
            {recentRequests.map((request) => (
              <article className="request-row" key={request.id}>
                <div>
                  <span className={`status ${statusClass(request.status)}`}>{request.status}</span>
                  <h3>{formatRequestAction(request.actionType)}</h3>
                  <p className="muted">
                    Requested {formatUtc(request.requestedAt)}
                    {request.targetUserId ? ` for ${request.targetUserId}` : ''}
                  </p>
                  {request.lastError ? <p className="danger-text">{request.lastError}</p> : null}
                  {request.resultSummary ? (
                    <p className="muted request-result">{request.resultSummary}</p>
                  ) : null}
                </div>
                <div className="request-meta">
                  <span className="muted">Updated</span>
                  <strong>{formatUtc(request.updatedAt)}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
