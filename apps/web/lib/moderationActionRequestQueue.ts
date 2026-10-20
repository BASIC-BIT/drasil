import { buildEnqueueStatement } from '@drasil/application/postgres';
import type { EnqueueInput, QueuedActionReceipt } from '@drasil/application';
import type { Pool, PoolClient } from 'pg';

export type ModerationActionRequestActionType = EnqueueInput['actionType'];

export type ModerationActionRequestQueueStatus = QueuedActionReceipt['status'];

export interface ModerationActionRequestReceipt extends QueuedActionReceipt {
  readonly messageDeletionJobId?: string | null;
}

interface ActiveModerationActionRequestReceipt extends ModerationActionRequestReceipt {
  readonly idempotencyKey: string;
}

export async function insertModerationActionRequestWithReceipt(
  client: Pool | PoolClient,
  input: EnqueueInput
): Promise<ModerationActionRequestReceipt> {
  const statement = buildEnqueueStatement(input);
  const result = await client.query<{
    id: string;
    message_deletion_job_id?: string | null;
    status: ModerationActionRequestQueueStatus;
  }>(statement.text, [...statement.values]);
  const row = result.rows[0];
  if (!row) throw new Error('Failed to enqueue moderation action request.');
  return { id: row.id, messageDeletionJobId: row.message_deletion_job_id, status: row.status };
}

export async function insertSerializedSetupRequestWithReceipt(
  pool: Pool,
  input: EnqueueInput
): Promise<ModerationActionRequestReceipt> {
  const client = await pool.connect();

  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `drasil:${input.actionType}:${input.serverId}`,
    ]);

    const active = await client.query<ActiveModerationActionRequestReceipt>(
      `select
         id::text,
         message_deletion_job_id::text as "messageDeletionJobId",
         status::text as status,
         idempotency_key as "idempotencyKey"
       from moderation_action_requests
       where server_id = $1
         and action_type = $2::moderation_action_request_type
         and status in ('queued', 'processing')
       order by requested_at asc
       limit 1`,
      [input.serverId, input.actionType]
    );

    const activeReceipt = active.rows[0];
    if (activeReceipt && activeReceipt.idempotencyKey !== input.idempotencyKey) {
      throw new Error(
        'Another Drasil setup is already in progress for this server. Wait for it to finish, then review and submit your choices again.'
      );
    }
    const receipt =
      activeReceipt ?? (await insertModerationActionRequestWithReceipt(client, input));
    await client.query('commit');
    return {
      id: receipt.id,
      messageDeletionJobId: receipt.messageDeletionJobId,
      status: receipt.status,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
