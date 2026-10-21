import {
  createDelegatedAccess,
  type AccessBinding,
  type AccessDenial,
  type DelegatedAccess,
  type DelegatedAccessDependencies,
  type DelegatedPrincipal,
  type DelegatedReadQuery,
  type DelegatedGuildDirectory,
} from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from './adapters/database';
import { createWebAuthority } from '../application/adapters/authority';
import { createWebStaffRoles } from '../application/adapters/staffRoles';
import { getPostgresPool } from '../setupDataAdapter';

function createWebGuildDirectory(): DelegatedGuildDirectory {
  const pool = getPostgresPool();
  return {
    async isActive(guildId) {
      const result = await pool.query(
        'select guild_id from servers where guild_id = $1 and coalesce(is_active, true) = true',
        [guildId]
      );
      return result.rows.length === 1;
    },
    async listActive({ limit, cursor }) {
      const result = await pool.query<{ guild_id: string }>(
        'select guild_id from servers where coalesce(is_active, true) = true and ($1::text is null or guild_id > $1) order by guild_id asc limit $2',
        [cursor, limit + 1]
      );
      const rows = result.rows.slice(0, limit);
      return {
        guildIds: rows.map((row) => row.guild_id),
        nextCursor: result.rows.length > limit ? rows[rows.length - 1].guild_id : null,
      };
    },
  };
}
export function createWebDelegatedAccess(deps?: DelegatedAccessDependencies): DelegatedAccess {
  return createDelegatedAccess(
    deps ?? {
      store: createDelegationStore(createWebDelegationDatabase()),
      authority: createWebAuthority(),
      staffRoles: createWebStaffRoles(),
      guilds: createWebGuildDirectory(),
    }
  );
}
/** The callback must use this binding for every repository predicate, including reporter ownership. */
export async function withAuthorizedRead<T>(
  access: DelegatedAccess,
  principal: DelegatedPrincipal,
  query: DelegatedReadQuery,
  read: (binding: AccessBinding) => Promise<T>
): Promise<AccessDenial | { readonly kind: 'allowed'; readonly value: T }> {
  const binding = await access.authorizeRead(principal, query);
  if (binding.kind === 'denied') return binding;
  return { kind: 'allowed', value: await read(binding) };
}
