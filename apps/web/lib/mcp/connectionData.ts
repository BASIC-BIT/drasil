import { loadEligibleGuildFacts, type ConnectionGrant } from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebAuthority } from '../application/adapters/authority';
import { createWebStaffRoles } from '../application/adapters/staffRoles';
import { fetchDiscordGuild } from '../discordApi';
import { getPostgresPool } from '../setupDataAdapter';
import { createWebGuildDirectory } from './access';
import { createWebDelegationDatabase } from './adapters/database';
import { getMcpIssuer } from './auth/issuer';
import { resolveDiscordActor, type IssuerSession } from './auth/flows';
import { getMcpConfig } from './config';
import { createMcpConnectionService } from './connections';

export function getMcpConnectionContext() {
  const issuer = getMcpIssuer();
  const config = getMcpConfig();
  if (!issuer || !config) return null;
  const pool = getPostgresPool();
  const store = createDelegationStore(createWebDelegationDatabase(pool));
  const eligibility = {
    authority: createWebAuthority(),
    staffRoles: createWebStaffRoles(),
    guilds: createWebGuildDirectory(),
  };
  const actor = (session: IssuerSession) => resolveDiscordActor(pool, session.user.id);
  return {
    issuer,
    config,
    pool,
    store,
    actor,
    eligibility,
    service: createMcpConnectionService({
      issuer,
      origin: config.origin,
      store,
      actor,
      eligible: async (userId, guildId) =>
        !!(await loadEligibleGuildFacts(eligibility, userId, guildId)),
    }),
  };
}
export type McpConnectionContext = NonNullable<ReturnType<typeof getMcpConnectionContext>>;
export async function eligibleServerPage(
  context: McpConnectionContext,
  session: IssuerSession,
  cursor: string | null
) {
  if (cursor !== null && !/^\d{17,20}$/.test(cursor)) throw new Error('Invalid server page.');
  const actor = await context.actor(session);
  const page = await context.eligibility.guilds.listActive({ limit: 25, cursor });
  const servers: { id: string; name: string }[] = [];
  for (let index = 0; index < page.guildIds.length; index += 4) {
    const batch = await Promise.all(
      page.guildIds.slice(index, index + 4).map(async (id) => {
        if (!(await loadEligibleGuildFacts(context.eligibility, actor, id))) return null;
        const guild = await fetchDiscordGuild(id);
        return { id, name: guild.name || id };
      })
    );
    for (const server of batch) if (server) servers.push(server);
  }
  return { servers, nextCursor: page.nextCursor };
}
export async function clientLabel(
  context: McpConnectionContext,
  clientId: string
): Promise<string> {
  const result = await context.pool.query<{ name: string | null }>(
    'select name from mcp_auth_oauth_client where "clientId"=$1',
    [clientId]
  );
  return result.rows[0]?.name || clientId;
}
export async function ownConnections(
  context: McpConnectionContext,
  session: IssuerSession,
  cursor: string | null = null
) {
  if (cursor !== null && !/^[0-9a-f-]{36}$/.test(cursor))
    throw new Error('Invalid connection page.');
  const actor = await context.actor(session);
  // Bounded own-only listing. Canonical store owns grant deserialization and mutations.
  const rows = await context.pool.query<{ id: string; completed: boolean }>(
    `select c.id, exists(select 1 from mcp_authorization_references r join mcp_auth_oauth_consent consent on consent."referenceId"=r.id::text where r.connection_id=c.id and r.frozen_grant_version=c.version) as completed from mcp_connections c where c.user_id=$1 and ($2::uuid is null or (c.created_at,c.id)<(select created_at,id from mcp_connections where id=$2::uuid and user_id=$1)) order by c.created_at desc,c.id desc limit 26`,
    [actor, cursor]
  );
  const connections: { grant: ConnectionGrant; label: string; completed: boolean }[] = [];
  for (const row of rows.rows.slice(0, 25)) {
    const grant = await context.store.findConnection(row.id);
    if (grant && grant.userId === actor)
      connections.push({
        grant,
        label: await clientLabel(context, grant.clientId),
        completed: row.completed,
      });
  }
  return { connections, nextCursor: rows.rows.length > 25 ? rows.rows[24].id : null };
}
export async function flowSelection(
  context: McpConnectionContext,
  referenceId: string,
  actorId: string
): Promise<ConnectionGrant> {
  const reference = await context.pool.query<{
    connection_id: string;
    frozen_grant_version: number;
  }>('select connection_id,frozen_grant_version from mcp_authorization_references where id=$1', [
    referenceId,
  ]);
  const grant = reference.rows[0]
    ? await context.store.findConnection(reference.rows[0].connection_id)
    : null;
  if (
    !grant ||
    grant.userId !== actorId ||
    grant.revokedAt ||
    grant.version !== reference.rows[0].frozen_grant_version
  )
    throw new Error('Connection unavailable.');
  return grant;
}
