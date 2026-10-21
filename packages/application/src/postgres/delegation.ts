import type {
  ConnectionGrant,
  ConnectionMutationResult,
  CreateConnectionInput,
  DelegatedPrincipal,
  DelegatedScope,
  DelegationStore,
  GuildSelection,
} from '../delegation/types';

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
