import { ActionDeniedError } from '../results';
import { randomUUID } from 'node:crypto';
import { projectHumanOutcome } from '../delegation/execution';
import { canonicalDigest } from '../delegation/intents';
import type { ExecutionRecord, ActionCompletion, PublicActionResult } from '../delegation/types';
import type { DelegationDatabase, DelegationQueryClient } from './delegation';

export interface NativeEnforcementStore {
  /** Called immediately before the provider send; only the insert winner may send. */
  start(execution: ExecutionRecord): Promise<string>;
  acknowledge(executionId: string, token: string): Promise<void>;
  reconcileNativeEnforcement(executionId: string): Promise<PublicActionResult>;
}
export async function nativeCompletion(
  client: DelegationQueryClient,
  executionId: string
): Promise<ActionCompletion | null> {
  const found = await client.query<{ acknowledged_at: Date | null }>(
    'select acknowledged_at from mcp_native_enforcements where execution_id=$1::uuid',
    [executionId]
  );
  const row = found.rows[0];
  return row
    ? row.acknowledged_at
      ? { state: 'partial', code: 'provider_acknowledged_updates_pending' }
      : { state: 'uncertain', code: 'native_outcome_unknown' }
    : null;
}
export function createNativeEnforcementStore(
  database: DelegationDatabase,
  enabled: () => boolean = () => true
): NativeEnforcementStore {
  return {
    async start(execution): Promise<string> {
      if (execution.command.kind !== 'ban_user' && execution.command.kind !== 'kick_user')
        throw new Error('Native enforcement binding mismatch.');
      return database.transaction(async (client) => {
        // Serialize expiry settlement with the send fence. Once the fence exists,
        // a late original sender may still acknowledge and finish bookkeeping.
        // Admission locks execution before queue; keep that order for the FK insert too.
        await client.query('select id from mcp_executions where id=$1::uuid for update', [
          execution.executionId,
        ]);
        await client.query(
          'select id from moderation_action_requests where id=$1::uuid for update',
          [execution.queueRequestId]
        );
        if (!enabled()) throw new ActionDeniedError('mcp_disabled');
        const token = randomUUID();
        const inserted = await client.query<{ token: string }>(
          `insert into mcp_native_enforcements (execution_id,token)
          select e.id,$2::uuid from mcp_executions e
          join moderation_action_requests q on q.id=e.queue_request_id
          where e.id=$1::uuid and e.started_at is not null and e.completed_at is null
          and e.queue_request_id=$3::uuid and e.resolved->>'commandDigest'=$4
          and q.status='processing' and q.updated_at >= clock_timestamp()-interval '15 minutes'
          on conflict (execution_id) do nothing returning token`,
          [
            execution.executionId,
            token,
            execution.queueRequestId,
            canonicalDigest(execution.command),
          ]
        );
        if (!inserted.rows[0])
          throw new Error('Native execution already fenced, expired or no longer bound.');
        return token;
      });
    },
    async acknowledge(executionId, token): Promise<void> {
      const updated = await database.query<{ execution_id: string }>(
        `update mcp_native_enforcements set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) where execution_id=$1::uuid and token=$2::uuid returning execution_id`,
        [executionId, token]
      );
      if (!updated.rows[0]) throw new Error('Native acknowledgement fence mismatch.');
    },
    async reconcileNativeEnforcement(executionId): Promise<PublicActionResult> {
      const found = await database.query<{
        resolved: Pick<ExecutionRecord, 'guildId' | 'workflowId' | 'command'>;
        queue_status: string | null;
        queue_result: unknown;
        queue_request_id: string;
        outcome: ExecutionRecord['outcome'];
      }>(
        `select e.resolved,e.queue_request_id,e.outcome,q.status as queue_status,q.result as queue_result from mcp_executions e left join moderation_action_requests q on q.id=e.queue_request_id where e.id=$1::uuid`,
        [executionId]
      );
      const row = found.rows[0];
      if (
        !row ||
        (row.resolved.command.kind !== 'ban_user' && row.resolved.command.kind !== 'kick_user')
      )
        return { state: 'denied', code: 'binding_mismatch' };
      const fence = await nativeCompletion(database, executionId);
      const saved = row.outcome?.result;
      const durable =
        row.queue_status === 'completed'
          ? projectHumanOutcome(row.resolved.command, row.queue_result)
          : (saved ??
            (row.queue_status === 'failed' && !fence
              ? { state: 'failed' as const, code: 'execution_interrupted_before_send' }
              : undefined));
      const result =
        fence?.state === 'uncertain'
          ? fence
          : durable && durable.state !== 'uncertain'
            ? durable
            : (fence ??
              durable ?? {
                state: 'uncertain' as const,
                code: 'execution_interrupted_before_send',
              });
      return {
        ...result,
        executionId,
        requestId: row.queue_request_id,
        guildId: row.resolved.guildId,
        operation: row.resolved.workflowId,
        targetUserId: row.resolved.command.targetUserId,
        ...(result.state === 'uncertain'
          ? {
              summary:
                'Historical enforcement outcome is unknown. An intentional retry requires a fresh intent and idempotency key and may repeat an effect.',
            }
          : {}),
      };
    },
  };
}
