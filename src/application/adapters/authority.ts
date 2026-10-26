import type { AuthorityFacts, AuthorityPort } from '@drasil/application';
import type { Client } from 'discord.js';

export function createBotAuthority(client: Client): AuthorityPort {
  return {
    async loadFresh(guildId, userId): Promise<AuthorityFacts | null> {
      try {
        const guild = await client.guilds.fetch({ guild: guildId, force: true });
        await guild.roles.fetch();
        const member = await guild.members.fetch({ user: userId, force: true });
        return {
          guildId: guild.id,
          userId: member.id,
          present: true,
          owner: guild.ownerId === member.id,
          permissions: member.permissions.bitfield.toString(),
          roleIds: [...member.roles.cache.keys()],
        };
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error.code === 10004 || error.code === 10007)
        )
          return null;
        throw error;
      }
    },
  };
}
