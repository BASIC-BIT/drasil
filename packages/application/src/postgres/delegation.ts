import { validateReportCaseTerminal } from '../reports/terminal';
import { nativeCompletion } from './nativeEnforcement';
import { projectHumanOutcome } from '../delegation/execution';
import { encodeQueuedAction } from '../requests/encode';
import { delegatedDeliveryBindingSchema, type QueuedRow } from '../requests/decode';
import {
  type ExecutionStore,
  type ExecutionAuthorization,
  type WorkerAdmission,
  type DelegatedQueueAdmission,
  type ActionCompletion,
  type IntentRecord,
  type IntentStore,
  type ResolvedIntent,
  type ExecutionRecord,
  type ConfirmationMethod,
  type ConnectionGrant,
  type ConnectionMutationResult,
  type CreateConnectionInput,
  type DelegatedPrincipal,
  type DelegatedScope,
  type DelegationStore,
  type GuildSelection,
} from '../delegation/types';
import { randomUUID } from 'node:crypto';
import {
  assertIntentBinding,
  canonicalDigest,
  encodeIntentDelivery,
  IntentError,
} from '../delegation/intents';
import { confirmationRequirement } from '../delegation/confirmationPolicy';
import { workflowDefinitions } from '../delegation/commands';
import { buildEnqueueStatement } from './enqueue';

export type DelegationSqlValue = string | number | boolean | Date | null | readonly string[];
export interface DelegationQueryClient {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly DelegationSqlValue[]
  ): Promise<{ rows: Row[] }>;
}
export interface DelegationDatabase extends DelegationQueryClient {
  transaction<T>(operation: (client: DelegationQueryClient) => Promise<T>): Promise<T>;
}

interface ConnectionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  client_id: string;
  selection_mode: GuildSelection['mode'];
  scopes: DelegatedScope[];
  version: number;
  created_at: Date;
  revoked_at: Date | null;
}
interface SelectedConnectionRow extends ConnectionRow {
  guild_ids: string[];
}

const readConnection = `select c.*,
  array(select g.guild_id from mcp_connection_guilds g
        where g.connection_id = c.id order by g.guild_id) as guild_ids
  from mcp_connections c where c.id = $1::uuid`;

function toGrant(row: SelectedConnectionRow): ConnectionGrant {
  return {
    connectionId: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    selection:
      row.selection_mode === 'selected'
        ? { mode: 'selected', guildIds: row.guild_ids }
        : { mode: 'all_eligible' },
    scopes: row.scopes,
    version: row.version,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

async function findConnection(
  client: DelegationQueryClient,
  id: string
): Promise<ConnectionGrant | null> {
  const result = await client.query<SelectedConnectionRow>(readConnection, [id]);
  return result.rows[0] ? toGrant(result.rows[0]) : null;
}

async function requireConnection(
  client: DelegationQueryClient,
  id: string
): Promise<ConnectionGrant> {
  const grant = await findConnection(client, id);
  if (!grant) throw new Error('Persisted MCP connection disappeared within its transaction.');
  return grant;
}

async function replaceSelection(
  client: DelegationQueryClient,
  id: string,
  selection: GuildSelection
): Promise<void> {
  await client.query('delete from mcp_connection_guilds where connection_id = $1::uuid', [id]);
  if (selection.mode === 'selected') {
    await client.query(
      `insert into mcp_connection_guilds (connection_id, guild_id)
       select $1::uuid, guild_id from unnest($2::text[]) as guild_id
       on conflict (connection_id, guild_id) do nothing`,
      [id, selection.guildIds]
    );
  }
}

export function createDelegationStore(database: DelegationDatabase): DelegationStore {
  async function mutate(
    principal: DelegatedPrincipal,
    expectedVersion: number,
    change: { kind: 'selection'; selection: GuildSelection } | { kind: 'revoke' }
  ): Promise<ConnectionMutationResult> {
    return database.transaction(async (client) => {
      // Lock the parent before touching children. This serializes selection edits and revocation.
      const locked = await client.query<ConnectionRow>(
        'select * from mcp_connections where id = $1::uuid for update',
        [principal.connectionId]
      );
      const row = locked.rows[0];
      if (!row) return { kind: 'denied', reason: 'not_found' };
      if (row.user_id !== principal.userId || row.client_id !== principal.clientId) {
        return { kind: 'denied', reason: 'identity_mismatch' };
      }
      if (row.revoked_at !== null) return { kind: 'denied', reason: 'revoked' };
      if (row.version !== expectedVersion || row.version !== principal.grantVersion) {
        return { kind: 'conflict' };
      }
      if (change.kind === 'selection') {
        await client.query(
          'update mcp_connections set version = version + 1, selection_mode = $2 where id = $1::uuid',
          [row.id, change.selection.mode]
        );
        await replaceSelection(client, row.id, change.selection);
      } else {
        await client.query(
          'update mcp_connections set version = version + 1, revoked_at = now() where id = $1::uuid',
          [row.id]
        );
      }
      return { kind: 'updated', grant: await requireConnection(client, row.id) };
    });
  }

  return {
    ...createIntentStore(database),
    ...createExecutionStore(database),
    createConnection(input: CreateConnectionInput): Promise<ConnectionGrant> {
      return database.transaction(async (client) => {
        const inserted = await client.query<{ id: string }>(
          `insert into mcp_connections (user_id, client_id, selection_mode, scopes)
           values ($1, $2, $3, $4::text[]) returning id`,
          [input.userId, input.clientId, input.selection.mode, input.scopes]
        );
        const row = inserted.rows[0];
        if (!row) throw new Error('Failed to create MCP connection.');
        await replaceSelection(client, row.id, input.selection);
        return requireConnection(client, row.id);
      });
    },
    findConnection: (id) => findConnection(database, id),
    updateSelection: (principal, selection, expectedVersion) =>
      mutate(principal, expectedVersion, { kind: 'selection', selection }),
    revokeConnection: (principal, expectedVersion) =>
      mutate(principal, expectedVersion, { kind: 'revoke' }),
  };
}

async function lockIntentConnection(
  client: DelegationQueryClient,
  principal: DelegatedPrincipal
): Promise<ConnectionGrant> {
  const locked = await client.query<ConnectionRow>(
    'select * from mcp_connections where id = $1::uuid for update',
    [principal.connectionId]
  );
  const row = locked.rows[0];
  if (
    !row ||
    row.revoked_at ||
    row.user_id !== principal.userId ||
    row.client_id !== principal.clientId ||
    row.version !== principal.grantVersion
  )
    throw new IntentError('invalid_grant');
  return requireConnection(client, principal.connectionId);
}
function checkIntentGrant(
  grant: ConnectionGrant,
  principal: DelegatedPrincipal,
  intent: Pick<
    IntentRecord,
    'userId' | 'clientId' | 'connectionId' | 'grantVersion' | 'workflowId' | 'guildId'
  >
): void {
  assertIntentBinding(principal, intent);
  const scope = workflowDefinitions.find((workflow) => workflow.id === intent.workflowId)?.scope;
  if (!scope || !grant.scopes.includes(scope) || !principal.scopes.includes(scope))
    throw new IntentError('scope_denied');
  if (grant.selection.mode === 'selected' && !grant.selection.guildIds.includes(intent.guildId))
    throw new IntentError('guild_denied');
}
interface IntentRow extends Record<string, unknown> {
  confirmation_id: string;
  connection_id: string;
  user_id: string;
  client_id: string;
  grant_version: number;
  idempotency_key: string;
  invocation_digest: string;
  input: unknown;
  resolved: ResolvedIntent;
  created_at: Date;
  expires_at: Date;
  state: IntentRecord['state'];
  confirmation_method: ConfirmationMethod | null;
  execution_id: string | null;
}
interface ExecutionRow extends Record<string, unknown> {
  id: string;
  confirmation_id: string;
  connection_id: string;
  user_id: string;
  client_id: string;
  grant_version: number;
  confirmation_method: ConfirmationMethod;
  queue_request_id: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  outcome: ExecutionRecord['outcome'];
  resolved: ResolvedIntent;
}
const intentSelect = `select i.*, e.id as execution_id from mcp_intents i left join mcp_executions e on e.confirmation_id = i.confirmation_id`;
function restoreResolved(resolved: ResolvedIntent): ResolvedIntent {
  const precondition = resolved.preconditions;
  return {
    ...resolved,
    previewExpiresAt:
      resolved.previewExpiresAt === null ? null : new Date(resolved.previewExpiresAt),
    preconditions:
      precondition.kind === 'cleanup_preview'
        ? {
            ...precondition,
            expiresAt: precondition.expiresAt === null ? null : new Date(precondition.expiresAt),
          }
        : precondition.kind === 'quarantine_preview' || precondition.kind === 'report_ban_review'
          ? { ...precondition, expiresAt: new Date(precondition.expiresAt) }
          : precondition,
  };
}
function toIntent(row: IntentRow): IntentRecord {
  return {
    ...restoreResolved(row.resolved),
    confirmationId: row.confirmation_id,
    connectionId: row.connection_id,
    userId: row.user_id,
    clientId: row.client_id,
    grantVersion: row.grant_version,
    idempotencyKey: row.idempotency_key,
    invocationDigest: row.invocation_digest,
    input: row.input,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    state: row.state,
    confirmationMethod: row.confirmation_method,
    executionId: row.execution_id,
  };
}
function toExecution(row: ExecutionRow): ExecutionRecord {
  return {
    ...restoreResolved(row.resolved),
    executionId: row.id,
    confirmationId: row.confirmation_id,
    connectionId: row.connection_id,
    userId: row.user_id,
    clientId: row.client_id,
    grantVersion: row.grant_version,
    confirmationMethod: row.confirmation_method,
    queueRequestId: row.queue_request_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    outcome: row.outcome,
  };
}
function resolvedPart(intent: IntentRecord): ResolvedIntent {
  return {
    workflowId: intent.workflowId,
    guildId: intent.guildId,
    command: intent.command,
    commandDigest: intent.commandDigest,
    authorizedDelivery: intent.authorizedDelivery,
    preconditions: intent.preconditions,
    stateFingerprint: intent.stateFingerprint,
    summary: intent.summary,
    previewExpiresAt: intent.previewExpiresAt,
  };
}
async function readIntent(
  client: DelegationQueryClient,
  principal: DelegatedPrincipal,
  field: 'confirmation_id' | 'idempotency_key',
  value: string
): Promise<IntentRecord | null> {
  // The field is an internal literal; all caller-controlled values are parameters.
  const result = await client.query<IntentRow>(
    `${intentSelect} where i.connection_id = $1::uuid and i.${field} = $2`,
    [principal.connectionId, value]
  );
  if (!result.rows[0]) return null;
  const intent = toIntent(result.rows[0]);
  assertIntentBinding(principal, intent);
  return intent;
}
function createIntentStore(database: DelegationDatabase): IntentStore {
  async function load(
    principal: DelegatedPrincipal,
    field: 'confirmation_id' | 'idempotency_key',
    value: string
  ): Promise<IntentRecord | null> {
    return database.transaction(async (client) => {
      const grant = await lockIntentConnection(client, principal);
      await client.query(
        "update mcp_intents set state = 'expired' where connection_id = $1::uuid and state = 'pending' and expires_at <= clock_timestamp()",
        [principal.connectionId]
      );
      const intent = await readIntent(client, principal, field, value);
      if (intent) checkIntentGrant(grant, principal, intent);
      return intent;
    });
  }
  async function terminal(
    principal: DelegatedPrincipal,
    confirmationId: string,
    state: 'denied' | 'cancelled'
  ): Promise<IntentRecord | null> {
    return database.transaction(async (client) => {
      await lockIntentConnection(client, principal);
      const intent = await readIntent(client, principal, 'confirmation_id', confirmationId);
      if (!intent) return null;
      await client.query(
        "update mcp_intents set state = case when expires_at <= clock_timestamp() then 'expired' else $3 end where connection_id = $1::uuid and confirmation_id = $2 and state = 'pending'",
        [principal.connectionId, confirmationId, state]
      );
      return readIntent(client, principal, 'confirmation_id', confirmationId);
    });
  }
  return {
    loadIntent: (principal, id) => load(principal, 'confirmation_id', id),
    findIntentByKey: (principal, key) => load(principal, 'idempotency_key', key),
    denyIntent: (principal, id) => terminal(principal, id, 'denied'),
    cancelIntent: (principal, id) => terminal(principal, id, 'cancelled'),
    async saveIntent(principal, intent): Promise<IntentRecord> {
      return database.transaction(async (client) => {
        const grant = await lockIntentConnection(client, principal);
        checkIntentGrant(grant, principal, intent);
        // All creators take the connection first, then this actor lock. No path locks a
        // second connection: concurrent connections cannot exceed the shared actor cap.
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))::text', [
          `drasil:mcp-intents:${principal.userId}`,
        ]);
        const existing = await readIntent(
          client,
          principal,
          'idempotency_key',
          intent.idempotencyKey
        );
        if (existing) {
          if (existing.invocationDigest !== intent.invocationDigest)
            throw new IntentError('idempotency_conflict');
          return existing;
        }
        if (
          intent.state !== 'pending' ||
          intent.executionId !== null ||
          intent.confirmationMethod !== null ||
          intent.idempotencyKey.length < 1 ||
          intent.idempotencyKey.length > 128 ||
          intent.commandDigest !== canonicalDigest(intent.command)
        )
          throw new IntentError('invalid_intent');
        const count = await client.query<{ connection_count: number; actor_count: number }>(
          `select count(*) filter (where connection_id = $1::uuid)::integer as connection_count, count(*)::integer as actor_count
          from mcp_intents where user_id = $2 and state = 'pending' and expires_at > clock_timestamp()`,
          [principal.connectionId, principal.userId]
        );
        if (count.rows[0].connection_count >= 128 || count.rows[0].actor_count >= 1024)
          throw new IntentError('capacity');
        const inserted = await client.query<{ confirmation_id: string }>(
          `insert into mcp_intents
          (confirmation_id, connection_id, user_id, client_id, grant_version, idempotency_key, invocation_digest, input, resolved, created_at, expires_at)
          select $1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11
          where $11::timestamptz > clock_timestamp() returning confirmation_id`,
          [
            intent.confirmationId,
            principal.connectionId,
            principal.userId,
            principal.clientId,
            principal.grantVersion,
            intent.idempotencyKey,
            intent.invocationDigest,
            JSON.stringify(intent.input),
            JSON.stringify(resolvedPart(intent)),
            intent.createdAt,
            intent.expiresAt,
          ]
        );
        if (!inserted.rows[0]) throw new IntentError('expired');
        return (await readIntent(client, principal, 'confirmation_id', intent.confirmationId))!;
      });
    },
    async acceptIntent(principal, confirmationId, method, delivery): Promise<ExecutionRecord> {
      return database.transaction(async (client) => {
        const grant = await lockIntentConnection(client, principal);
        const intent = await readIntent(client, principal, 'confirmation_id', confirmationId);
        if (!intent) throw new IntentError('not_found');
        checkIntentGrant(grant, principal, intent);
        if (
          !['elicitation', 'client_confirmation', 'website', 'discord', 'not_required'].includes(
            method
          ) ||
          (method === 'not_required' &&
            intent.authorizedDelivery.kind !== 'report_case_terminal' &&
            confirmationRequirement(intent.command) !== 'none')
        )
          throw new IntentError('confirmation_required');
        if (canonicalDigest(delivery) !== canonicalDigest(encodeIntentDelivery(intent)))
          throw new IntentError('delivery_mismatch');
        if (intent.state === 'consumed') {
          const existing = await client.query<ExecutionRow>(
            'select * from mcp_executions where confirmation_id = $1',
            [confirmationId]
          );
          if (!existing.rows[0]) throw new IntentError('missing_execution');
          return toExecution(existing.rows[0]);
        }
        if (intent.state !== 'pending') throw new IntentError(intent.state);
        const valid = await client.query<{ valid: boolean }>(
          'select $1::timestamptz > clock_timestamp() as valid',
          [intent.expiresAt]
        );
        if (!valid.rows[0].valid) throw new IntentError('expired');
        const executionId = randomUUID();
        let queueRequestId: string | null = null;
        if (!('kind' in delivery)) {
          if (
            intent.authorizedDelivery.kind !== 'queued' ||
            canonicalDigest(intent.authorizedDelivery.command) !==
              intent.authorizedDelivery.commandDigest
          )
            throw new IntentError('delivery_mismatch');
          if (delivery.actionType === 'complete_setup_verification') {
            await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))::text', [
              `drasil:${delivery.actionType}:${delivery.serverId}`,
            ]);
            const active = await client.query<{ id: string }>(
              "select id from moderation_action_requests where server_id = $1 and action_type = $2::moderation_action_request_type and status in ('queued', 'processing') limit 1",
              [delivery.serverId, delivery.actionType]
            );
            if (active.rows.length) throw new IntentError('queue_conflict');
          }
          const delegation = {
            executionId,
            connectionId: principal.connectionId,
            grantVersion: principal.grantVersion,
            commandDigest: intent.authorizedDelivery.commandDigest,
          };
          const statement = buildEnqueueStatement({
            ...delivery,
            metadata: { ...delivery.metadata, delegation },
          });
          const queued = await client.query<{
            id: string;
            actor_id: string;
            actor_surface: string;
            metadata: { delegation?: unknown };
          }>(statement.text, statement.values);
          const row = queued.rows[0];
          // The builder may return an existing domain receipt. A foreign receipt is never
          // adopted. Throwing rolls back even legacy conflict-update metadata changes.
          if (
            !row ||
            row.actor_id !== principal.userId ||
            row.actor_surface !== 'mcp' ||
            canonicalDigest(row.metadata?.delegation ?? null) !== canonicalDigest(delegation)
          )
            throw new IntentError('queue_conflict');
          queueRequestId = row.id;
        }
        const result = await client.query<ExecutionRow>(
          `insert into mcp_executions
          (id, confirmation_id, connection_id, user_id, client_id, grant_version, resolved, confirmation_method, queue_request_id)
          values ($1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8,$9::uuid) returning *`,
          [
            executionId,
            confirmationId,
            principal.connectionId,
            principal.userId,
            principal.clientId,
            principal.grantVersion,
            JSON.stringify(resolvedPart(intent)),
            method,
            queueRequestId,
          ]
        );
        await client.query(
          "update mcp_intents set state = 'consumed', confirmation_method = $2 where confirmation_id = $1",
          [confirmationId, method]
        );
        if (intent.authorizedDelivery.kind === 'report_case_terminal') {
          const outcome = validateReportCaseTerminal(intent, intent.authorizedDelivery.outcome);
          const terminal = await client.query<ExecutionRow>(
            'update mcp_executions set started_at=clock_timestamp(),completed_at=clock_timestamp(),outcome=$2::jsonb where id=$1::uuid returning *',
            [
              executionId,
              JSON.stringify({
                kind: 'delegated_terminal',
                result: projectHumanOutcome(intent.command, outcome),
              }),
            ]
          );
          return toExecution(terminal.rows[0]);
        }
        return toExecution(result.rows[0]);
      });
    },
  };
}

function createExecutionStore(database: DelegationDatabase): ExecutionStore {
  async function read(client: DelegationQueryClient, id: string): Promise<ExecutionRecord | null> {
    const result = await client.query<ExecutionRow>(
      'select * from mcp_executions where id=$1::uuid',
      [id]
    );
    return result.rows[0] ? toExecution(result.rows[0]) : null;
  }
  async function finish(
    client: DelegationQueryClient,
    id: string,
    result: ActionCompletion
  ): Promise<void> {
    await client.query(
      `update mcp_executions set completed_at=clock_timestamp(),outcome=$2::jsonb where id=$1::uuid and (outcome is null or outcome->'result'->>'state' in ('uncertain','partial'))`,
      [id, JSON.stringify({ kind: 'delegated_terminal', result })]
    );
  }
  async function admit(
    executionId: string,
    authorize: ExecutionAuthorization,
    queue?: DelegatedQueueAdmission
  ): Promise<WorkerAdmission> {
    return database.transaction(async (client) => {
      const first = await read(client, executionId);
      if (!first) return { kind: 'denied', code: 'binding_mismatch' };
      // Revocation and selection edits use this same first lock.
      await client.query('select id from mcp_connections where id=$1::uuid for update', [
        first.connectionId,
      ]);
      await client.query('select id from mcp_executions where id=$1::uuid for update', [
        executionId,
      ]);
      const execution = (await read(client, executionId))!;
      const intent = await client.query<IntentRow>(
        `select * from mcp_intents where confirmation_id=$1 and state='consumed'`,
        [execution.confirmationId]
      );
      const saved = intent.rows[0];
      if (
        !saved ||
        saved.user_id !== execution.userId ||
        saved.client_id !== execution.clientId ||
        saved.connection_id !== execution.connectionId ||
        saved.grant_version !== execution.grantVersion ||
        canonicalDigest(saved.resolved) !== canonicalDigest(executionResolved(execution)) ||
        execution.commandDigest !== canonicalDigest(execution.command)
      )
        return { kind: 'denied', code: 'binding_mismatch' };
      if (queue) {
        if (
          execution.authorizedDelivery.kind !== 'queued' ||
          execution.queueRequestId !== queue.request.id
        )
          return { kind: 'denied', code: 'binding_mismatch' };
        const rows = await client.query<QueuedRow & Record<string, unknown>>(
          'select * from moderation_action_requests where id=$1::uuid for update',
          [queue.request.id]
        );
        const persisted = rows.rows[0];
        if (
          !persisted ||
          !matchesQueue(execution, persisted) ||
          !matchesQueue(execution, queue.request) ||
          canonicalDigest(queue.action.command) !== execution.authorizedDelivery.commandDigest ||
          queue.action.context.requestId !== queue.request.id ||
          queue.action.context.guildId !== execution.guildId ||
          queue.action.context.source !== 'mcp' ||
          queue.action.context.actor.kind !== 'user' ||
          queue.action.context.actor.userId !== execution.userId
        )
          return { kind: 'denied', code: 'binding_mismatch' };
        // A stale native owner cannot admit new work after its queue lease expires.
        // Already-admitted executions remain read-only observations, including after revocation.
        if (
          (execution.command.kind === 'ban_user' || execution.command.kind === 'kick_user') &&
          !execution.startedAt &&
          !execution.completedAt
        ) {
          // Check the clock after acquiring the lock, including time spent waiting for it.
          const claim = await client.query<{ live: boolean }>(
            `select status='processing' and updated_at >= clock_timestamp()-interval '15 minutes' as live
             from moderation_action_requests where id=$1::uuid`,
            [queue.request.id]
          );
          if (!claim.rows[0]?.live)
            return { kind: 'denied', code: 'execution_interrupted_before_send' };
        }
        if (queue.recovery) {
          const metadata = persisted.metadata ?? {};
          const protectedPhase = [
            'preparing',
            'enforcement_started',
            'discord_confirmed',
            'reconciliation_required',
          ].includes(String(metadata.report_ban_phase));
          const attempt = metadata.report_ban_attempt_token;
          if (
            execution.startedAt &&
            execution.authorizedDelivery.command.kind === 'ban_observed_detection' &&
            protectedPhase &&
            typeof attempt === 'string' &&
            attempt.length > 0 &&
            queue.request.metadata?.report_ban_attempt_token === attempt
          )
            return { kind: 'committed_reconciliation', execution };
          return { kind: 'denied', code: 'reconciliation_denied' };
        }
      } else if (
        execution.authorizedDelivery.kind !== 'direct' ||
        execution.queueRequestId !== null
      )
        return { kind: 'denied', code: 'binding_mismatch' };
      if (execution.startedAt || execution.completedAt) return { kind: 'already_bound', execution };
      const grant = await findConnection(client, execution.connectionId);
      if (!grant) return { kind: 'denied', code: 'invalid_grant' };
      // This principal is constructed solely by trusted runtime from the linked persisted identity.
      const principal: DelegatedPrincipal = {
        userId: execution.userId,
        clientId: execution.clientId,
        connectionId: execution.connectionId,
        grantVersion: execution.grantVersion,
        scopes: grant.scopes,
      };
      let denial: string | null = null;
      try {
        await lockIntentConnection(client, principal);
        checkIntentGrant(grant, principal, execution);
      } catch (error) {
        if (!(error instanceof IntentError)) throw error;
        denial = error.code;
      }
      if (!denial) {
        const decision = await authorize(principal, execution);
        if (decision.kind === 'denied') denial = decision.reason;
      }
      if (denial) {
        await finish(client, executionId, { state: 'denied', code: denial });
        return { kind: 'denied', code: denial };
      }
      await client.query(
        'update mcp_executions set started_at=clock_timestamp() where id=$1::uuid',
        [executionId]
      );
      return { kind: 'new_execution', execution: (await read(client, executionId))! };
    });
  }
  return {
    async loadExecution(principal, id): Promise<ExecutionRecord | null> {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return null;
      const execution = await read(database, id);
      if (
        !execution ||
        execution.userId !== principal.userId ||
        execution.clientId !== principal.clientId ||
        execution.connectionId !== principal.connectionId
      )
        return null;
      const native =
        execution.command.kind === 'ban_user' || execution.command.kind === 'kick_user'
          ? await nativeCompletion(database, execution.executionId)
          : null;
      if (native?.state === 'uncertain')
        return { ...execution, outcome: { kind: 'delegated_terminal', result: native } };
      if (execution.queueRequestId) {
        const result = await database.query<{ status: string; result: unknown }>(
          'select status,result from moderation_action_requests where id=$1::uuid',
          [execution.queueRequestId]
        );
        const queue = result.rows[0];
        if (queue?.status === 'completed')
          return {
            ...execution,
            outcome: {
              kind: 'delegated_terminal',
              result: projectHumanOutcome(execution.command, queue.result),
            },
          };
        if (queue?.status === 'failed' && !execution.outcome) {
          // The earlier absent fence may predate a send. After failed is observed,
          // the queue gate prevents a new fence, so this fresh read can establish no send.
          const failedNative =
            execution.command.kind === 'ban_user' || execution.command.kind === 'kick_user'
              ? await nativeCompletion(database, execution.executionId)
              : null;
          return {
            ...execution,
            outcome: {
              kind: 'delegated_terminal',
              result:
                failedNative ??
                (execution.command.kind === 'ban_user' || execution.command.kind === 'kick_user'
                  ? { state: 'failed', code: 'execution_interrupted_before_send' }
                  : { state: execution.startedAt ? 'uncertain' : 'failed' }),
            },
          };
        }
      }
      return native && (!execution.outcome || execution.outcome.result.state === 'uncertain')
        ? { ...execution, outcome: { kind: 'delegated_terminal', result: native } }
        : execution;
    },
    startDirectExecution: (id, authorize) => admit(id, authorize),
    async admitQueuedExecution(input, authorize): Promise<WorkerAdmission> {
      const found = await database.query<{ id: string }>(
        'select id from mcp_executions where queue_request_id=$1::uuid',
        [input.request.id]
      );
      if (!found.rows[0])
        return input.request.actor_surface === 'mcp' ||
          input.request.metadata?.delegation !== undefined
          ? { kind: 'denied', code: 'binding_mismatch' }
          : { kind: 'ordinary' };
      return admit(found.rows[0].id, authorize, input);
    },
    completeExecution: (id, result) => finish(database, id, result),
  };
}
function executionResolved(execution: ExecutionRecord): ResolvedIntent {
  return {
    workflowId: execution.workflowId,
    guildId: execution.guildId,
    command: execution.command,
    commandDigest: execution.commandDigest,
    authorizedDelivery: execution.authorizedDelivery,
    preconditions: execution.preconditions,
    stateFingerprint: execution.stateFingerprint,
    summary: execution.summary,
    previewExpiresAt: execution.previewExpiresAt,
  };
}
function matchesQueue(execution: ExecutionRecord, row: QueuedRow): boolean {
  if (execution.authorizedDelivery.kind !== 'queued') return false;
  const binding = delegatedDeliveryBindingSchema.safeParse(row.metadata?.delegation);
  const expected = {
    executionId: execution.executionId,
    connectionId: execution.connectionId,
    grantVersion: execution.grantVersion,
    commandDigest: execution.authorizedDelivery.commandDigest,
  };
  if (
    !binding.success ||
    canonicalDigest(binding.data) !== canonicalDigest(expected) ||
    canonicalDigest(execution.authorizedDelivery.command) !== expected.commandDigest
  )
    return false;
  const encoded = encodeQueuedAction(
    {
      guildId: execution.guildId,
      requestId: execution.confirmationId,
      source: 'mcp',
      actor: { kind: 'user', userId: execution.userId },
    },
    execution.authorizedDelivery.command
  );
  if (
    row.actor_id !== encoded.actorId ||
    row.actor_surface !== encoded.actorSurface ||
    row.server_id !== encoded.serverId ||
    row.action_type !== encoded.actionType ||
    row.target_user_id !== encoded.targetUserId ||
    (row.detection_event_id ?? null) !== (encoded.detectionEventId ?? null) ||
    (row.verification_event_id ?? null) !== (encoded.verificationEventId ?? null) ||
    (row.report_intake_id ?? null) !== (encoded.reportIntakeId ?? null) ||
    (row.message_deletion_job_id ?? null) !== (encoded.messageDeletionJobId ?? null)
  )
    return false;
  return Object.entries(encoded.metadata).every(
    ([key, value]) => canonicalDigest(row.metadata?.[key] ?? null) === canonicalDigest(value)
  );
}
