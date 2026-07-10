import type { CaseAction } from '@drasil/contracts';
import { formatCaseAction } from '@/lib/casePresentation';

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
  canQueueCaseActions,
  caseId,
  guildId,
  queueCaseAction,
}: {
  readonly actions: readonly CaseAction[];
  readonly canQueueCaseActions: boolean;
  readonly caseId: string;
  readonly guildId: string;
  readonly queueCaseAction: QueueCaseAction;
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
    <div className="report-action-forms" aria-label="Case actions">
      {standardActions.map((action) =>
        canQueueCaseActions ? (
          <form action={queueCaseAction.bind(null, guildId, caseId, action)} key={action}>
            <button className="button secondary compact-button" type="submit">
              {formatCaseAction(action)}
            </button>
          </form>
        ) : (
          <button
            className="button secondary compact-button"
            disabled
            key={action}
            title="Requires the bot-side case action worker"
            type="button"
          >
            {formatCaseAction(action)}
          </button>
        )
      )}
      {destructiveActions.map((action) =>
        canQueueCaseActions ? (
          <details className="destructive-action" key={action}>
            <summary className="button secondary compact-button destructive-summary">
              {formatCaseAction(action)}
            </summary>
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
          </details>
        ) : (
          <button
            className="button secondary compact-button"
            disabled
            key={action}
            title="Requires the bot-side case action worker"
            type="button"
          >
            {formatCaseAction(action)}
          </button>
        )
      )}
    </div>
  );
}
