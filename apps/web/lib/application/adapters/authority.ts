import type { AuthorityFacts, AuthorityPort } from '@drasil/application';
import {
  DiscordApiError,
  fetchDiscordGuild,
  fetchDiscordGuildMember,
  fetchDiscordGuildRoles,
} from '../../discordApi';
import { computeGuildPermissions } from '../../discordPermissions';

export function createWebAuthority(): AuthorityPort {
  return {
    async loadFresh(guildId, userId): Promise<AuthorityFacts | null> {
      try {
        const [guild, member, roles] = await Promise.all([
          fetchDiscordGuild(guildId),
          fetchDiscordGuildMember(guildId, userId),
          fetchDiscordGuildRoles(guildId),
        ]);
        return {
          guildId: guild.id,
          userId,
          present: true,
          owner: guild.owner_id === userId,
          permissions: computeGuildPermissions({
            guildId,
            roles,
            memberRoleIds: member.roles,
          }).toString(),
          roleIds: member.roles,
        };
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
