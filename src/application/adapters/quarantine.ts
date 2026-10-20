import type { GuildMember } from 'discord.js';
import type { VerificationEvent, ModerationActionRequest } from '../../repositories/types';
import {
  buildAccountQuarantinePreviewFingerprint,
  createQuarantineActions,
  type ActionContext,
  type ActionResult,
  type AuthorityPort,
  type QuarantineActions,
  type QuarantinePreviewData,
  type QuarantineExecutionResult,
  type QuarantinePolicy,
  type CaseState,
  type CaseRepairResult,
  type QuarantineDependencies,
  type QuarantinePreviewBinding,
  type QuarantineTarget,
} from '@drasil/application';
import type { BotCaseDependencies } from './cases';
import type { IModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import type { IAccountQuarantineService } from '../../services/AccountQuarantineService';
import { createBotAuthority } from './attention';
import { createQuarantinePreviewStore } from '../context';
import { getAccountQuarantineSettings } from '../../utils/accountQuarantineSettings';

export interface BotQuarantineDependencies extends Pick<
  BotCaseDependencies,
  'client' | 'configService' | 'verificationEventRepository' | 'securityActionService'
> {
  readonly accountQuarantineService: IAccountQuarantineService | null;
  readonly actionRequests: IModerationActionRequestRepository;
}
export interface BotQuarantineRuntime {
  readonly actions: QuarantineActions;
  readonly previews: ReturnType<typeof createQuarantinePreviewStore>;
  forRequest(request: ModerationActionRequest): QuarantineActions;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
function persistedBinding(
  request: ModerationActionRequest | null
): QuarantinePreviewBinding | null {
  if (
    !request ||
    request.action_type !== 'preview_account_quarantine' ||
    request.status !== 'completed' ||
    !request.verification_event_id ||
    !request.target_user_id ||
    !request.completed_at
  )
    return null;
  const fingerprint = record(request.result).containment_fingerprint;
  if (typeof fingerprint !== 'string' || !fingerprint) return null;
  return {
    guildId: request.server_id,
    actorId: request.actor_id,
    caseId: request.verification_event_id,
    targetUserId: request.target_user_id,
    fingerprint,
    expiresAt: request.completed_at.getTime() + 10 * 60 * 1000,
  };
}
export function createBotQuarantineRuntime(
  deps: BotQuarantineDependencies,
  authority: AuthorityPort = createBotAuthority(deps.client)
): BotQuarantineRuntime {
  const previews = createQuarantinePreviewStore();
  const service = (): IAccountQuarantineService => {
    if (!deps.accountQuarantineService)
      throw new Error('Compromised-account quarantine is unavailable.');
    return deps.accountQuarantineService;
  };
  const member = async (context: ActionContext, input: QuarantineTarget): Promise<GuildMember> =>
    (await deps.client.guilds.fetch(context.guildId)).members.fetch({
      user: input.targetUserId,
      force: true,
    });
  const event = async (
    context: ActionContext,
    input: QuarantineTarget
  ): Promise<VerificationEvent> => {
    const state = await deps.verificationEventRepository.findById(input.caseId);
    if (
      !state ||
      state.server_id !== context.guildId ||
      state.user_id !== input.targetUserId ||
      state.status !== 'pending'
    )
      throw new Error('The previewed verification case is no longer active.');
    return state;
  };
  const ports = (request: ModerationActionRequest | null): QuarantineDependencies => ({
    authority,
    now: Date.now,
    settings: {
      async loadFresh(guildId): Promise<QuarantinePolicy> {
        const config = await deps.configService.getServerConfig(guildId, {
          forceRefresh: true,
          failOnReadError: true,
        });
        return { enabled: getAccountQuarantineSettings(config.settings).enabled };
      },
    },
    repository: {
      async findActive(guildId, userId): Promise<CaseState | null> {
        return deps.verificationEventRepository.findActiveByUserAndServer(userId, guildId);
      },
    },
    previews: {
      async resolve(context, input): Promise<QuarantinePreviewBinding | null> {
        return input.previewReference.kind === 'discord_confirmation'
          ? previews.resolve(context, input)
          : persistedBinding(await deps.actionRequests.findById(input.previewReference.requestId));
      },
    },
    workflows: {
      async preview(context, input): Promise<QuarantinePreviewData> {
        const target = await member(context, input);
        const state = await event(context, input);
        const preview = await service().preview(target, state);
        const thread = state.thread_id
          ? await deps.client.channels.fetch(state.thread_id).catch(() => null)
          : null;
        const channel = state.notification_channel_id
          ? await deps.client.channels.fetch(state.notification_channel_id).catch(() => null)
          : null;
        const message =
          channel && 'messages' in channel && state.notification_message_id
            ? await channel.messages.fetch(state.notification_message_id).catch(() => null)
            : null;
        const readiness = {
          adminNotificationReady: Boolean(message),
          recoveryThreadId: state.thread_id,
          recoveryThreadReady: Boolean(thread?.isThread() && !thread.archived && !thread.locked),
        };
        const fingerprint = buildAccountQuarantinePreviewFingerprint(preview, readiness);
        const roleNames = Object.fromEntries(
          [...target.guild.roles.cache.values()].map((role) => [role.id, role.name])
        );
        return { preview, readiness, fingerprint, roleNames };
      },
      async repair(context, input): Promise<CaseRepairResult> {
        return deps.securityActionService.repairActiveCase(await member(context, input));
      },
      async quarantine(context, input): Promise<QuarantineExecutionResult> {
        if (context.actor.kind !== 'user') throw new Error('Quarantine requires a user actor.');
        const result = await service().quarantine(
          await member(context, input),
          await event(context, input),
          await deps.client.users.fetch(context.actor.userId),
          input.reason,
          ...(request ? [{ moderationActionRequestId: request.id }] : [])
        );
        return {
          status: result.status,
          containmentStatus:
            result.verificationEvent.containment_status ??
            (result.status === 'parked' ? 'contained' : 'incomplete'),
          failedRoleRemovals: result.roleResult.failedRemovals.length,
          memberBypasses: result.memberAudit.bypasses.length,
          retainedRoles: result.roleResult.skippedRoles.length,
          lockdownChangesRequired: result.lockdown.plannedActions.length,
          recovered: false,
        };
      },
      async recoverCommitted(context, input): Promise<QuarantineExecutionResult | null> {
        if (
          !request ||
          context.actor.kind !== 'user' ||
          request.id !== context.requestId ||
          request.server_id !== context.guildId ||
          request.actor_id !== context.actor.userId ||
          request.verification_event_id !== input.caseId ||
          request.target_user_id !== input.targetUserId
        )
          return null;
        const state = await deps.verificationEventRepository.findById(input.caseId);
        if (
          !state ||
          state.server_id !== context.guildId ||
          state.user_id !== input.targetUserId ||
          state.case_kind !== 'compromised_account' ||
          state.quarantine_attempt_id !== null
        )
          return null;
        const audit = record(record(state.metadata).account_quarantine);
        if (audit.moderation_action_request_id !== request.id) return null;
        const parked =
          audit.result === 'contained' &&
          state.attention_state === 'parked' &&
          state.containment_status === 'contained';
        const incomplete =
          audit.result === 'incomplete' &&
          state.attention_state === 'review_required' &&
          state.containment_status === 'incomplete';
        if (!parked && !incomplete) return null;
        return {
          status: parked ? 'parked' : 'incomplete',
          containmentStatus: parked ? 'contained' : 'incomplete',
          failedRoleRemovals: arrayLength(audit.failed_removals),
          memberBypasses: arrayLength(audit.member_bypasses),
          retainedRoles: arrayLength(audit.retained_roles),
          lockdownChangesRequired: 0,
          recovered: true,
        };
      },
    },
  });
  const direct = createQuarantineActions(ports(null));
  const actions: QuarantineActions = {
    ...direct,
    async preview(context, input) {
      const result = await direct.preview(context, input);
      if (result.kind === 'outcome' && context.actor.kind === 'user')
        previews.record({
          ...input,
          guildId: context.guildId,
          actorId: context.actor.userId,
          fingerprint: result.outcome.fingerprint,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      return result;
    },
  };
  return { actions, previews, forRequest: (request) => createQuarantineActions(ports(request)) };
}
export function requireQuarantineOutcome<T>(result: ActionResult<T>): T {
  if (result.kind === 'outcome') return result.outcome;
  const messages = {
    permission_denied: 'Account quarantine requires current moderation permission.',
    actor_unavailable: 'Account quarantine requires current moderation permission.',
    stale_state: 'The live account-quarantine containment state changed; run a new preview.',
    confirmation_required: 'The live account-quarantine preview is missing, stale, or mismatched.',
    binding_mismatch: 'The live account-quarantine preview is missing, stale, or mismatched.',
    policy_disabled: 'Compromised-account quarantine is disabled for this server.',
    reason_required: 'Account-quarantine request requires a reason.',
  };
  throw new Error(messages[result.code]);
}
