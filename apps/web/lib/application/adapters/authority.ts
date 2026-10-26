import {
  ReadDependencyUnavailableError,
  type AuthorityFacts,
  type AuthorityPort,
} from '@drasil/application';
import { z } from 'zod';
import {
  DiscordApiError,
  fetchDiscordGuild,
  fetchDiscordGuildMember,
  fetchDiscordGuildRoles,
} from '../../discordApi';
import { computeGuildPermissions } from '../../discordPermissions';
import { recordReadDependency } from '../../readDiagnostics';

export type GuildAuthoritySource = 'guild' | 'member' | 'roles';
export type FreshGuildAuthorityResult =
  | {
      readonly kind: 'available';
      readonly value: {
        readonly guild: { readonly id: string; readonly name?: string };
        readonly actor: AuthorityFacts;
      };
    }
  | { readonly kind: 'missing'; readonly source: GuildAuthoritySource };
const guildSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  owner_id: z.string().min(1),
});
const memberSchema = z.object({
  roles: z.array(z.string()),
  user: z.object({ id: z.string().min(1) }).optional(),
});
const rolesSchema = z.array(
  z.object({ id: z.string().min(1), permissions: z.string().regex(/^\d+$/) })
);

async function endpoint<T>(source: GuildAuthoritySource, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    recordReadDependency({
      dependency: 'discord',
      category: error instanceof DiscordApiError ? 'http_client_error' : 'unknown',
      boundary: 'authority',
      source,
      status: error instanceof DiscordApiError ? error.status : null,
      latencyMs: null,
      attempt: 1,
    });
    throw error;
  }
}

/** All three facts are fresh. A failed endpoint takes precedence over an absent member. */
export async function loadFreshGuildAuthority(
  guildId: string,
  userId: string
): Promise<FreshGuildAuthorityResult> {
  const results = await Promise.allSettled([
    endpoint('guild', () => fetchDiscordGuild(guildId)),
    endpoint('member', () => fetchDiscordGuildMember(guildId, userId)),
    endpoint('roles', () => fetchDiscordGuildRoles(guildId)),
  ]);
  for (const result of results) {
    if (
      result.status === 'rejected' &&
      !(result.reason instanceof DiscordApiError && result.reason.status === 404)
    )
      throw result.reason;
  }
  const [guildResult, memberResult, rolesResult] = results;
  // Guild/roles uncertainty takes precedence over member absence, independent of response timing.
  if (guildResult.status === 'rejected') return { kind: 'missing', source: 'guild' };
  if (rolesResult.status === 'rejected') return { kind: 'missing', source: 'roles' };
  if (memberResult.status === 'rejected') return { kind: 'missing', source: 'member' };
  const guild = guildSchema.safeParse(guildResult.value);
  const member = memberSchema.safeParse(memberResult.value);
  const roles = rolesSchema.safeParse(rolesResult.value);
  if (!guild.success || !member.success || !roles.success)
    throw new ReadDependencyUnavailableError({});
  return {
    kind: 'available',
    value: {
      guild: { id: guild.data.id, name: guild.data.name },
      actor: {
        guildId: guild.data.id,
        userId: member.data.user?.id ?? userId,
        present: true,
        owner: guild.data.owner_id === userId,
        permissions: computeGuildPermissions({
          guildId,
          roles: roles.data,
          memberRoleIds: member.data.roles,
        }).toString(),
        roleIds: member.data.roles,
      },
    },
  };
}

export function createWebAuthority(): AuthorityPort {
  return {
    async loadFresh(guildId, userId): Promise<AuthorityFacts | null> {
      const result = await loadFreshGuildAuthority(guildId, userId);
      return result.kind === 'available' ? result.value.actor : null;
    },
  };
}
