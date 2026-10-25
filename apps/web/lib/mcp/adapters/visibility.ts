import {
  memberContextFor,
  workflowDefinitions,
  type WorkflowId,
  type AccessDecision,
  type DelegatedAccess,
  type DelegatedPrincipal,
} from '@drasil/application';
import { checkDiscordVisibility, type VisibilityApi } from '../../conversationAccess';
export type { VisibilityApi } from '../../conversationAccess';
import { createWebDelegatedAccess } from '../access';
/** No discovery cache is used: channel overwrites and private memberships are fresh each call. */
export function createDiscordContentAuthorizer(access: DelegatedAccess, api?: VisibilityApi) {
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
    return checkDiscordVisibility(principal.userId, guildId, channelId, binding, api);
  };
}
/** Internal fixed-workflow context; never grants raw history or staff case reads. */
export function createWorkflowContentAuthorizer(access: DelegatedAccess, api?: VisibilityApi) {
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
    return checkDiscordVisibility(principal.userId, guildId, channelId, binding, api);
  };
}
export async function authorizeDiscordContent(
  principal: DelegatedPrincipal,
  guildId: string,
  channelId: string
): Promise<AccessDecision> {
  return createDiscordContentAuthorizer(createWebDelegatedAccess())(principal, guildId, channelId);
}
