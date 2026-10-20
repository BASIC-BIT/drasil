import {
  createBotReportActions,
  type BotReportDependencies,
} from '../../application/adapters/reports';
import { PermissionFlagsBits, type GuildMember } from 'discord.js';

// These controller fixtures use interaction objects as their Discord object cache.
// Actual fresh gateway reads and identity mismatches are covered in ReportActions.unit.test.
export function prepareReportClient(client: any, interaction: any): void {
  interaction.id ??= 'interaction-1';
  interaction.guildId ??= interaction.guild?.id;
  const oldGuildFetch = client.guilds?.fetch;
  if (interaction.guild) {
    client.guilds ??= {};
    client.guilds.fetch = jest.fn().mockResolvedValue(interaction.guild);
  } else if (!oldGuildFetch) {
    client.guilds = { fetch: jest.fn() };
  }
  const oldUserFetch = client.users?.fetch;
  client.users ??= {};
  client.users.fetch = jest.fn(async (id: string) =>
    id === interaction.user.id
      ? interaction.user
      : oldUserFetch
        ? oldUserFetch(id)
        : { id, username: 'unknown' }
  );
  const oldChannelFetch = client.channels?.fetch;
  client.channels ??= {};
  client.channels.fetch = jest.fn(async (id: string) => {
    const selected =
      interaction.commandName === 'setupreportbutton'
        ? interaction.options.getChannel('channel')
        : null;
    const channel =
      interaction.channel?.id === id
        ? interaction.channel
        : selected?.id === id
          ? selected
          : await oldChannelFetch?.(id);
    if (channel) {
      channel.guildId ??= interaction.guildId;
    }
    return channel ?? null;
  });
}
export function buildReportActions(deps: BotReportDependencies) {
  return createBotReportActions(deps, {
    async loadFresh(guildId, userId) {
      if (userId.startsWith('reporter'))
        return { guildId, userId, present: true, owner: false, permissions: '0', roleIds: [] };
      const guild = await deps.client.guilds.fetch(guildId);
      const member = (await guild.members.fetch(userId)) as Partial<GuildMember> | undefined;
      const permissions = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ModerateMembers,
      ]
        .filter((flag) => member?.permissions?.has(flag))
        .reduce((sum, flag) => sum | flag, 0n);
      return {
        guildId,
        userId,
        present: !!member,
        owner: false,
        permissions: permissions.toString(),
        roleIds: [...(member?.roles?.cache.keys() ?? [])],
      };
    },
  });
}
