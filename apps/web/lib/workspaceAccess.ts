import { ReadDependencyUnavailableError, type AuthorityFacts } from '@drasil/application';
import { loadFreshGuildAuthority } from './application/adapters/authority';
import { DiscordApiError, fetchDiscordUser } from './discordApi';
import { canManageGuild } from './discordPermissions';
import { recordReadDependency } from './readDiagnostics';
import { withReadRequestContext } from './readRequestContext';
import type { AdminSession, DiscordTokenSession } from './session';

export type WorkspaceAccessResult =
  | {
      readonly kind: 'ready';
      readonly guild: { readonly id: string; readonly name: string };
      readonly actor: AuthorityFacts;
    }
  | { readonly kind: 'authentication_required' }
  | { readonly kind: 'access_denied' }
  | { readonly kind: 'unavailable'; readonly retryAfterSeconds?: number };

/** Locally valid cookies, live OAuth identity, then fresh selected-server authority. No grants are cached. */
export async function loadWorkspaceAccess(
  guildId: string,
  session: AdminSession | null,
  token: DiscordTokenSession | null
): Promise<WorkspaceAccessResult> {
  if (!session || !token || session.expiresAt <= Date.now() || token.expiresAt <= Date.now())
    return { kind: 'authentication_required' };
  return withReadRequestContext({ operation: 'selected_workspace_read' }, async () => {
    let source: 'identity' | undefined = 'identity';
    try {
      const identity = await fetchDiscordUser(token.accessToken);
      if (!identity || typeof identity.id !== 'string' || !identity.id)
        return { kind: 'unavailable' };
      if (identity.id !== session.userId) return { kind: 'access_denied' };
      source = undefined;
      const authority = await loadFreshGuildAuthority(guildId, session.userId);
      if (authority.kind === 'missing')
        return { kind: authority.source === 'member' ? 'access_denied' : 'unavailable' };
      const { guild, actor } = authority.value;
      if (
        guild.id !== guildId ||
        actor.guildId !== guildId ||
        actor.userId !== session.userId ||
        !actor.present ||
        !canManageGuild(actor.permissions, actor.owner)
      )
        return { kind: 'access_denied' };
      return {
        kind: 'ready',
        guild: { id: guild.id, name: guild.name || 'Selected server' },
        actor,
      };
    } catch (error) {
      recordReadDependency({
        dependency:
          error instanceof DiscordApiError || error instanceof ReadDependencyUnavailableError
            ? 'discord'
            : 'internal',
        category: error instanceof DiscordApiError ? 'http_client_error' : 'unknown',
        boundary: 'authority',
        source,
        status: error instanceof DiscordApiError ? error.status : null,
        latencyMs: null,
        attempt: 1,
      });
      if (error instanceof DiscordApiError)
        return {
          kind:
            source === 'identity' && error.status === 401
              ? 'authentication_required'
              : 'unavailable',
        };
      if (error instanceof ReadDependencyUnavailableError) {
        const retry = error.retryAfterSeconds;
        return {
          kind: 'unavailable',
          ...(typeof retry === 'number' && Number.isFinite(retry) && retry > 0 && retry <= 60
            ? { retryAfterSeconds: Math.ceil(retry) }
            : {}),
        };
      }
      // Unexpected failures remain exceptions, with no provider text or private identifiers.
      throw new Error('Unable to verify workspace access.');
    }
  });
}
