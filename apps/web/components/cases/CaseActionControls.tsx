import type {
  CaseAction,
  MessageCleanupCaseWorkspace,
  MessageCleanupJobDetail,
} from '@drasil/contracts';
import { formatCaseAction } from '@/lib/casePresentation';
import { InboxActionForm, type InboxStateAction } from '@/components/inbox/InboxActionForm';
import type { InboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import type { AccountQuarantineActionRequests } from '@/lib/inboxActionReceipts';
import {
  CaseBanActionControl,
  CaseMessageCleanupControls,
  type MessageCleanupStateAction,
} from './CaseMessageCleanupControls';

export interface CaseMessageCleanupIntegration {
  readonly workspace: MessageCleanupCaseWorkspace;
  readonly deleteOnlyJob: MessageCleanupJobDetail | null;
  readonly combinedJob: MessageCleanupJobDetail | null;
  readonly previewAction: MessageCleanupStateAction;
  readonly executeAction: MessageCleanupStateAction;
  readonly combinedBanAction: MessageCleanupStateAction;
  readonly deleteOnlyRequest?: ModerationActionRequestSummary | null;
  readonly combinedRequest?: ModerationActionRequestSummary | null;
}

export type WebCaseAction = Extract<
  CaseAction,
  | 'verify_user'
  | 'quarantine_compromised_account'
  | 'kick_user'
  | 'ban_user'
  | 'ban_by_id'
  | 'close_no_action'
  | 'repair_thread'
  | 'create_thread'
  | 'sync_existing_ban'
  | 'refresh_notification'
  | 'reopen_case'
>;

export type QueueCaseAction = (
  guildId: string,
  caseId: string,
  action: WebCaseAction,
  formData?: FormData
) => Promise<void>;

export type QueueInboxCaseAction = (
  guildId: string,
  caseId: string,
  action: WebCaseAction,
  previousState: InboxActionState,
  formData: FormData
) => Promise<InboxActionState>;

export const executableCaseActions: readonly WebCaseAction[] = [
  'verify_user',
  'quarantine_compromised_account',
  'kick_user',
  'ban_user',
  'ban_by_id',
  'close_no_action',
  'refresh_notification',
  'repair_thread',
  'create_thread',
  'sync_existing_ban',
  'reopen_case',
];

const executableCaseActionSet = new Set<CaseAction>(executableCaseActions);
const destructiveCaseActionSet = new Set<WebCaseAction>(['kick_user', 'ban_user', 'ban_by_id']);

export function isExecutableCaseAction(action: string): action is WebCaseAction {
  return executableCaseActionSet.has(action as CaseAction);
}

const ACCOUNT_QUARANTINE_PREVIEW_MAX_AGE_MS = 10 * 60 * 1000;

function formatPreviewRole(role: {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly reason: string | null;
}): string {
  const label = role.roleName ?? role.roleId;
  return role.reason ? `${label} (${role.reason})` : label;
}

function AccountQuarantinePreviewDetails({
  request,
}: {
  readonly request: ModerationActionRequestSummary;
}) {
  const preview = request.accountQuarantinePreview;
  if (!preview) {
    return <p className="danger-text">The completed request did not return a usable preview.</p>;
  }
  const retained = preview.retainedRoles.map(formatPreviewRole);
  return (
    <div className="stack">
      <p className={preview.canContain ? 'muted' : 'danger-text'}>
        {preview.canContain
          ? 'Containment is ready.'
          : 'Containment is incomplete; execution will retain partial removals and keep the case in review.'}
      </p>
      <ul>
        <li>Roles to remove: {preview.plannedRoles.length}</li>
        <li>Privileged roles to remove: {preview.privilegedRoles.length}</li>
        <li>Roles Drasil cannot remove: {preview.retainedRoles.length}</li>
        <li>Member/channel bypasses: {preview.memberBypassCount}</li>
        <li>Unremovable privilege blockers: {preview.unremovablePrivilegeReasons.length}</li>
        <li>Lockdown changes still required: {preview.lockdownPlannedActionCount}</li>
        <li>
          Case role retained:{' '}
          {preview.caseRole ? formatPreviewRole(preview.caseRole) : 'not configured'}
          {preview.caseRoleReady ? '' : ' (lockdown repair required)'}
        </li>
        <li>
          Recovery thread retained: {preview.recoveryThreadId ?? 'not recorded'} (
          {preview.recoveryThreadReady ? 'ready' : 'repair required'})
        </li>
        <li>
          Persistent admin notification ready:{' '}
          {preview.adminNotificationReady ? 'yes' : 'repair required'}
        </li>
      </ul>
      {preview.plannedRoles.length > 0 ? (
        <p className="muted">Remove: {preview.plannedRoles.map(formatPreviewRole).join(', ')}</p>
      ) : null}
      {retained.length > 0 ? (
        <p className="danger-text">Unmanageable: {retained.join(', ')}</p>
      ) : null}
      <p className="muted">
        The user stays in the server, their verification thread remains open, and no Discord timeout
        is applied.
      </p>
    </div>
  );
}

function AccountQuarantineControl({
  canQueueCaseActions,
  caseId,
  guildId,
  queueCaseAction,
  queueInboxCaseAction,
  requests,
}: {
  readonly canQueueCaseActions: boolean;
  readonly caseId: string;
  readonly guildId: string;
  readonly queueCaseAction: QueueCaseAction;
  readonly queueInboxCaseAction?: QueueInboxCaseAction;
  readonly requests?: AccountQuarantineActionRequests;
}) {
  if (!canQueueCaseActions) {
    return (
      <button className="button secondary compact-button" disabled type="button">
        Account quarantine requires the bot-side action worker
      </button>
    );
  }

  const previewRequest = requests?.preview ?? null;
  const preview = previewRequest?.accountQuarantinePreview;
  const previewFresh = Boolean(
    previewRequest?.status === 'completed' &&
    preview?.previewedAt &&
    Date.parse(preview.previewedAt) >= Date.now() - ACCOUNT_QUARANTINE_PREVIEW_MAX_AGE_MS
  );
  const previewForm = queueInboxCaseAction ? (
    <InboxActionForm
      action={
        queueInboxCaseAction.bind(
          null,
          guildId,
          caseId,
          'quarantine_compromised_account'
        ) as InboxStateAction
      }
      buttonLabel={previewFresh ? 'Refresh live quarantine preview' : 'Preview account quarantine'}
      durableRequest={previewRequest?.status === 'completed' ? undefined : previewRequest}
      requestBaseHref={`/admin/guild/${guildId}/operations`}
    >
      <input name="quarantinePhase" type="hidden" value="preview" />
    </InboxActionForm>
  ) : (
    <form action={queueCaseAction.bind(null, guildId, caseId, 'quarantine_compromised_account')}>
      <input name="quarantinePhase" type="hidden" value="preview" />
      <button className="button secondary compact-button" type="submit">
        {previewFresh ? 'Refresh live quarantine preview' : 'Preview account quarantine'}
      </button>
    </form>
  );

  if (!previewFresh || !previewRequest) {
    return previewForm;
  }

  const executeChildren = (
    <>
      <input name="quarantinePhase" type="hidden" value="execute" />
      <input name="previewRequestId" type="hidden" value={previewRequest.id} />
      <label className="field destructive-reason">
        <span>Reason</span>
        <textarea name="reason" required rows={3} />
      </label>
      <label className="checkbox-field destructive-confirm">
        <input name="confirmAction" required type="checkbox" />
        <span>Confirm compromised-account quarantine</span>
      </label>
    </>
  );

  return (
    <details className="destructive-action" open>
      <summary className="button secondary compact-button destructive-summary">
        Account quarantine live preview
      </summary>
      <div className="destructive-action-panel stack">
        <AccountQuarantinePreviewDetails request={previewRequest} />
        {queueInboxCaseAction ? (
          <InboxActionForm
            action={
              queueInboxCaseAction.bind(
                null,
                guildId,
                caseId,
                'quarantine_compromised_account'
              ) as InboxStateAction
            }
            buttonClassName="button compact-button danger-button"
            buttonLabel="Queue account quarantine"
            durableRequest={requests?.execute}
            requestBaseHref={`/admin/guild/${guildId}/operations`}
          >
            {executeChildren}
          </InboxActionForm>
        ) : (
          <form
            action={queueCaseAction.bind(null, guildId, caseId, 'quarantine_compromised_account')}
          >
            {executeChildren}
            <button className="button compact-button danger-button" type="submit">
              Queue account quarantine
            </button>
          </form>
        )}
        {previewForm}
      </div>
    </details>
  );
}

export function CaseActionControls({
  actions,
  accountQuarantineRequests,
  actionRequestsByAction,
  canQueueCaseActions,
  caseId,
  guildId,
  messageCleanup,
  queueCaseAction,
  queueInboxCaseAction,
}: {
  readonly actions: readonly CaseAction[];
  readonly accountQuarantineRequests?: AccountQuarantineActionRequests;
  readonly actionRequestsByAction?: Partial<
    Record<WebCaseAction, ModerationActionRequestSummary | null>
  >;
  readonly canQueueCaseActions: boolean;
  readonly caseId: string;
  readonly guildId: string;
  readonly messageCleanup?: CaseMessageCleanupIntegration;
  readonly queueCaseAction: QueueCaseAction;
  readonly queueInboxCaseAction?: QueueInboxCaseAction;
}) {
  const executableActions = executableCaseActions.filter((action) => actions.includes(action));
  const hasAccountQuarantine = executableActions.includes('quarantine_compromised_account');
  const ordinaryExecutableActions = executableActions.filter(
    (action) => action !== 'quarantine_compromised_account'
  );
  if (executableActions.length === 0) {
    return null;
  }

  const standardActions = ordinaryExecutableActions.filter(
    (action) => !destructiveCaseActionSet.has(action)
  );
  const destructiveActions = ordinaryExecutableActions.filter((action) =>
    destructiveCaseActionSet.has(action)
  );

  return (
    <div className="case-action-area">
      <div className="report-action-forms" aria-label="Case actions">
        {hasAccountQuarantine ? (
          <AccountQuarantineControl
            canQueueCaseActions={canQueueCaseActions}
            caseId={caseId}
            guildId={guildId}
            queueCaseAction={queueCaseAction}
            queueInboxCaseAction={queueInboxCaseAction}
            requests={accountQuarantineRequests}
          />
        ) : null}
        {standardActions.map((action) =>
          canQueueCaseActions ? (
            queueInboxCaseAction ? (
              <InboxActionForm
                action={
                  queueInboxCaseAction.bind(null, guildId, caseId, action) as InboxStateAction
                }
                buttonLabel={formatCaseAction(action)}
                durableRequest={actionRequestsByAction?.[action]}
                key={`${caseId}-${action}`}
                requestBaseHref={`/admin/guild/${guildId}/operations`}
              />
            ) : (
              <form
                action={queueCaseAction.bind(null, guildId, caseId, action)}
                key={`${caseId}-${action}`}
              >
                <button className="button secondary compact-button" type="submit">
                  {formatCaseAction(action)}
                </button>
              </form>
            )
          ) : (
            <button
              className="button secondary compact-button"
              disabled
              key={`${caseId}-${action}`}
              title="Requires the bot-side case action worker"
              type="button"
            >
              {formatCaseAction(action)}
            </button>
          )
        )}
        {destructiveActions.map((action) =>
          canQueueCaseActions && (action === 'ban_user' || action === 'ban_by_id') ? (
            <CaseBanActionControl
              banActionLabel={formatCaseAction(action)}
              cleanup={
                messageCleanup
                  ? {
                      executeAction: messageCleanup.combinedBanAction,
                      durableRequest: messageCleanup.combinedRequest,
                      jobDetail: messageCleanup.combinedJob,
                      previewAction: messageCleanup.previewAction,
                      workspace: messageCleanup.workspace,
                    }
                  : undefined
              }
              durableRequest={actionRequestsByAction?.[action]}
              key={`${caseId}-${action}`}
              requestBaseHref={`/admin/guild/${guildId}/operations`}
              standardBanFormAction={
                queueInboxCaseAction
                  ? undefined
                  : queueCaseAction.bind(null, guildId, caseId, action)
              }
              standardBanStateAction={
                queueInboxCaseAction
                  ? (queueInboxCaseAction.bind(null, guildId, caseId, action) as InboxStateAction)
                  : undefined
              }
            />
          ) : canQueueCaseActions ? (
            <details className="destructive-action" key={`${caseId}-${action}`}>
              <summary className="button secondary compact-button destructive-summary">
                {formatCaseAction(action)}
              </summary>
              {queueInboxCaseAction ? (
                <InboxActionForm
                  action={
                    queueInboxCaseAction.bind(null, guildId, caseId, action) as InboxStateAction
                  }
                  buttonClassName="button compact-button danger-button"
                  buttonLabel={`Queue ${formatCaseAction(action)}`}
                  durableRequest={actionRequestsByAction?.[action]}
                  formClassName="destructive-action-panel"
                  requestBaseHref={`/admin/guild/${guildId}/operations`}
                >
                  <label className="field destructive-reason">
                    <span>Reason</span>
                    <textarea name="reason" rows={3} />
                  </label>
                  <label className="checkbox-field destructive-confirm">
                    <input name="confirmAction" type="checkbox" />
                    <span>Confirm {formatCaseAction(action)}</span>
                  </label>
                </InboxActionForm>
              ) : (
                <form
                  action={queueCaseAction.bind(null, guildId, caseId, action)}
                  className="destructive-action-panel"
                >
                  <label className="field destructive-reason">
                    <span>Reason</span>
                    <textarea name="reason" rows={3} />
                  </label>
                  <label className="checkbox-field destructive-confirm">
                    <input name="confirmAction" type="checkbox" />
                    <span>Confirm {formatCaseAction(action)}</span>
                  </label>
                  <button className="button compact-button danger-button" type="submit">
                    Queue {formatCaseAction(action)}
                  </button>
                </form>
              )}
            </details>
          ) : (
            <button
              className="button secondary compact-button"
              disabled
              key={`${caseId}-${action}`}
              title="Requires the bot-side case action worker"
              type="button"
            >
              {formatCaseAction(action)}
            </button>
          )
        )}
      </div>
      {messageCleanup ? (
        <section className="case-message-cleanup-block" aria-label="Message cleanup">
          <div className="section-heading compact-heading">
            <h3>Message cleanup</h3>
            <p className="muted">Preview case-linked messages before deleting them.</p>
          </div>
          <CaseMessageCleanupControls
            executeAction={messageCleanup.executeAction}
            durableRequest={messageCleanup.deleteOnlyRequest}
            jobDetail={messageCleanup.deleteOnlyJob}
            previewAction={messageCleanup.previewAction}
            workspace={messageCleanup.workspace}
          />
        </section>
      ) : null}
    </div>
  );
}
