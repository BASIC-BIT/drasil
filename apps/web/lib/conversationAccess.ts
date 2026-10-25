import { classifyReadFailure, recordReadDependency } from './readDiagnostics';
import { toUnavailableReadDenial, type AccessDecision } from '@drasil/application';
import {
  DiscordApiError,
  fetchDiscordGuild,
  fetchDiscordGuildRoles,
  fetchDiscordGuildMember,
  fetchDiscordBotUser,
  fetchDiscordChannel,
  fetchDiscordThreadMember,
} from './discordApi';
import {
  computeGuildPermissions,
  computeChannelPermissions,
  hasPermission,
  canManageGuild,
  DISCORD_PERMISSIONS as P,
} from './discordPermissions';
export interface VisibilityApi {
  guild: typeof fetchDiscordGuild;
  roles: typeof fetchDiscordGuildRoles;
  member: typeof fetchDiscordGuildMember;
  bot: typeof fetchDiscordBotUser;
  channel: typeof fetchDiscordChannel;
  threadMember: typeof fetchDiscordThreadMember;
}
const liveApi: VisibilityApi = {
  guild: fetchDiscordGuild,
  roles: fetchDiscordGuildRoles,
  member: fetchDiscordGuildMember,
  bot: fetchDiscordBotUser,
  channel: fetchDiscordChannel,
  threadMember: fetchDiscordThreadMember,
};
export async function checkDiscordVisibility<T extends { kind: 'allowed' }>(
  actorId: string,
  guildId: string,
  channelId: string,
  binding: T,
  api: VisibilityApi = liveApi,
  requireModerator = false
): Promise<T | Extract<AccessDecision, { kind: 'denied' }>> {
  const denied = { kind: 'denied', reason: 'permission_denied' } as const;
  if (![guildId, channelId, actorId].every((id) => /^\d{17,20}$/.test(id))) return denied;
  const started = performance.now();
  try {
    const [guild, roles, actor, bot, channel] = await Promise.all([
      api.guild(guildId),
      api.roles(guildId),
      api.member(guildId, actorId),
      api.bot(),
      api.channel(channelId),
    ]);
    if (
      guild.id !== guildId ||
      typeof guild.owner_id !== 'string' ||
      !guild.owner_id ||
      !Number.isInteger(channel.type) ||
      channel.id !== channelId ||
      channel.guild_id !== guildId ||
      actor.user?.id !== actorId
    )
      return denied;
    const thread = [10, 11, 12].includes(channel.type);
    if (thread && (!channel.parent_id || !/^\d{17,20}$/.test(channel.parent_id))) return denied;
    const parent = thread ? await api.channel(channel.parent_id!) : channel;
    if (
      parent.guild_id !== guildId ||
      !Number.isInteger(parent.type) ||
      (thread && (parent.id !== channel.parent_id || [10, 11, 12].includes(parent.type)))
    )
      return denied;
    const overwrites = parent.permission_overwrites;
    if (
      !Array.isArray(overwrites) ||
      !overwrites.every(
        (item) =>
          typeof item.id === 'string' &&
          [0, 1].includes(item.type) &&
          /^\d+$/.test(item.allow) &&
          /^\d+$/.test(item.deny)
      )
    )
      return denied;
    if (
      !roles.some((role) => role.id === guildId) ||
      roles.some((role) => !/^\d+$/.test(role.permissions))
    )
      return denied;
    const botMember = await api.member(guildId, bot.id);
    if (botMember.user?.id !== bot.id) return denied;
    for (const member of [actor, botMember]) {
      const userId = member.user!.id;
      if (
        !Array.isArray(member.roles) ||
        member.roles.some((id) => !roles.some((role) => role.id === id))
      )
        return denied;
      const owner = guild.owner_id === userId;
      const guildPermissions = computeGuildPermissions({
        guildId,
        roles,
        memberRoleIds: member.roles,
      });
      if (
        requireModerator &&
        userId === actorId &&
        !canManageGuild(guildPermissions.toString(), owner)
      )
        return denied;
      const permissions = computeChannelPermissions({
        guildId,
        userId,
        guildPermissions,
        memberRoleIds: member.roles,
        overwrites,
      });
      if (
        !owner &&
        (!hasPermission(permissions, P.ViewChannel) ||
          !hasPermission(permissions, P.ReadMessageHistory))
      )
        return denied;
      if (channel.type === 12 && !owner && !hasPermission(permissions, P.ManageThreads)) {
        const membership = await api.threadMember(channelId, userId);
        if (membership.id !== channelId || membership.user_id !== userId) return denied;
      }
    }
    return binding;
  } catch (error) {
    recordReadDependency({
      ...classifyReadFailure(error),
      boundary: 'visibility',
      latencyMs: performance.now() - started,
      attempt: 1,
    });
    if (error instanceof DiscordApiError && (error.status === 403 || error.status === 404))
      return denied;
    return toUnavailableReadDenial(error);
  }
}

export type ConversationUnavailableReason = 'denied' | 'missing' | 'upstream';
export class ConversationAccessError extends Error {
  constructor(public readonly reason: ConversationUnavailableReason) {
    super('Conversation unavailable.');
    this.name = 'ConversationAccessError';
  }
}
/** Signed-in moderator eligibility is independent of MCP delegation grants. */
export async function assertConversationAccess(
  { guildId, actorId, channelId }: { guildId: string; actorId: string; channelId: string },
  api: VisibilityApi = liveApi
): Promise<void> {
  const result = await checkDiscordVisibility(
    actorId,
    guildId,
    channelId,
    { kind: 'allowed' },
    api,
    true
  );
  if (result.kind === 'denied')
    throw new ConversationAccessError(result.reason === 'unavailable' ? 'upstream' : 'denied');
}
