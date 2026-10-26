import {
  deriveWorkspaceActionPresentation,
  type WorkspaceActionPresentationInput,
} from '@/lib/workspaceActionPresentation';
import styles from './Actions.module.css';
import { Timestamp } from '../Timestamp';
import { workspaceRequestReceipt } from '@/lib/inboxActionState';

export interface ActionReceiptProps extends WorkspaceActionPresentationInput {
  readonly guildId: string;
  readonly historicalCompletion?: boolean;
}
export function ActionReceipt(input: ActionReceiptProps) {
  const presentation = deriveWorkspaceActionPresentation(input);
  if (presentation.kind === 'idle') return null;
  const request = input.durableRequest;
  const requestId = request?.id ?? workspaceRequestReceipt(input.localResult)?.id;
  const ban = request?.observedBanResult;
  const operationId = ban && 'operationId' in ban ? ban.operationId : null;
  const actor =
    request?.actorUserId ??
    (input.localResult?.kind === 'report_closure' ? input.localResult.result.actor.id : null);
  return (
    <div role="status" aria-live="polite" className={styles.receipt} data-kind={presentation.kind}>
      <p>{presentation.message}</p>
      {input.historicalCompletion ? (
        <p>
          This request already completed for this case. This historical receipt does not start
          another operation.
        </p>
      ) : null}
      {requestId ? (
        <p>
          <a
            href={`/admin/guild/${encodeURIComponent(input.guildId)}/operations?request=${encodeURIComponent(requestId)}#request-${encodeURIComponent(requestId)}`}
          >
            Request {requestId}
          </a>
        </p>
      ) : null}
      {operationId ? <p>Operation {operationId}</p> : null}
      {actor ? <p>Requested by {actor}</p> : null}
      {request ? (
        <p>
          <Timestamp prefix="Requested" value={request.requestedAt} />
          <br />
          <Timestamp
            prefix={request.completedAt ? 'Completed' : request.failedAt ? 'Failed' : 'Updated'}
            value={request.completedAt ?? request.failedAt ?? request.updatedAt}
          />
        </p>
      ) : null}
      {request?.resultSummary ? (
        <p>{request.resultSummary}</p>
      ) : ban?.status === 'ban_outcome_unknown' ? (
        <p>
          Use /review-report-ban operation:{ban.operationId} reason:&lt;review reason&gt; if no
          current ban exists.
        </p>
      ) : null}
    </div>
  );
}
