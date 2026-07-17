import type {
  CaseAction,
  MessageCleanupCaseWorkspace,
  MessageCleanupJobDetail,
} from '@drasil/contracts';
import { formatCaseAction } from '@/lib/casePresentation';
import { InboxActionForm, type InboxStateAction } from '@/components/inbox/InboxActionForm';
import type { InboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
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

export function CaseActionControls({
  actions,
  actionRequestsByAction,
  canQueueCaseActions,
  caseId,
  guildId,
  messageCleanup,
  queueCaseAction,
  queueInboxCaseAction,
}: {
  readonly actions: readonly CaseAction[];
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
  if (executableActions.length === 0) {
    return null;
  }

  const standardActions = executableActions.filter(
    (action) => !destructiveCaseActionSet.has(action)
  );
  const destructiveActions = executableActions.filter((action) =>
    destructiveCaseActionSet.has(action)
  );

  return (
    <div className="case-action-area">
      <div className="report-action-forms" aria-label="Case actions">
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
