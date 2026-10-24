import { classifyReadFailure, recordReadDependency } from '../../readDiagnostics';
import {
  memberContextFor,
  workflowDefinitions,
  toUnavailableReadDenial,
  type WorkflowId,
  type AccessDecision,
  type DelegatedAccess,
  type DelegatedPrincipal,
} from '@drasil/application';
import {
  DiscordApiError,
  fetchDiscordGuild,
  fetchDiscordGuildRoles,
  fetchDiscordGuildMember,
  fetchDiscordBotUser,
  fetchDiscordChannel,
  fetchDiscordThreadMember,
} from '../../discordApi';
import {
  computeGuildPermissions,
  computeChannelPermissions,
  hasPermission,
  DISCORD_PERMISSIONS as P,
} from '../../discordPermissions';
import { createWebDelegatedAccess } from '../access';

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
/** No discovery cache is used: channel overwrites and private memberships are fresh each call. */
export function createDiscordContentAuthorizer(
  access: DelegatedAccess,
  api: VisibilityApi = liveApi
) {
  return async (
    principal: DelegatedPrincipal,
    guildId: string,
    channelId: string
  ): Promise<AccessDecision> => {
    const denied = { kind: 'denied', reason: 'permission_denied' } as const;
    if (![guildId, channelId, principal.userId].every((id) => /^\d{17,20}$/.test(id)))
      return denied;
    const binding = await access.authorizeRead(principal, { kind: 'cases', guildId });
    if (binding.kind === 'denied') return binding;
    return checkVisibility(principal, guildId, channelId, binding, api);
  };
}
/** Internal fixed-workflow context; never grants raw history or staff case reads. */
export function createWorkflowContentAuthorizer(
  access: DelegatedAccess,
  api: VisibilityApi = liveApi
) {
  return async (
    principal: DelegatedPrincipal,
    guildId: string,
    channelId: string,
    workflowId: WorkflowId
  ): Promise<AccessDecision> => {
    const workflow = workflowDefinitions.find((entry) => entry.id === workflowId);
    const context = workflow && memberContextFor(workflow);
    if (!context || ![guildId, channelId, principal.userId].every((id) => /^\d{17,20}$/.test(id)))
      return { kind: 'denied', reason: 'permission_denied' };
    const authority = await access.authorizeWorkflowId(principal, guildId, workflowId);
    if (authority.kind === 'denied') return authority;
    const binding = await access.authorizeRead(principal, {
      kind: 'member_context',
      guildId,
      ...context,
    });
    if (binding.kind === 'denied') return binding;
    return checkVisibility(principal, guildId, channelId, binding, api);
  };
}
async function checkVisibility(
  principal: DelegatedPrincipal,
  guildId: string,
  channelId: string,
  binding: AccessDecision,
  api: VisibilityApi
): Promise<AccessDecision> {
  const denied = { kind: 'denied', reason: 'permission_denied' } as const;
  const started = performance.now();
  try {
    const [guild, roles, actor, bot, channel] = await Promise.all([
      api.guild(guildId),
      api.roles(guildId),
      api.member(guildId, principal.userId),
      api.bot(),
      api.channel(channelId),
    ]);
    if (
      guild.id !== guildId ||
      channel.id !== channelId ||
      channel.guild_id !== guildId ||
      actor.user?.id !== principal.userId
    )
      return denied;
    const thread = [10, 11, 12].includes(channel.type);
    if (thread && (!channel.parent_id || !/^\d{17,20}$/.test(channel.parent_id))) return denied;
    const parent = thread ? await api.channel(channel.parent_id!) : channel;
    if (
      parent.guild_id !== guildId ||
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
      const permissions = computeChannelPermissions({
        guildId,
        userId,
        guildPermissions: computeGuildPermissions({
          guildId,
          roles,
          memberRoleIds: member.roles,
        }),
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
export async function authorizeDiscordContent(
  principal: DelegatedPrincipal,
  guildId: string,
  channelId: string
): Promise<AccessDecision> {
  return createDiscordContentAuthorizer(createWebDelegatedAccess())(principal, guildId, channelId);
}
