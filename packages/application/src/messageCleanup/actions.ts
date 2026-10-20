import type { ActionContext } from '../context';
import type { ActionResult, ActionDenialCode } from '../results';
import type { AuthorityPort } from '../authorization';
import type { MessageCleanupCommand } from './commands';
import type {
  MessageCleanupDependencies,
  MessageCleanupJob,
  MessageCleanupCase,
  MessageCleanupCounts,
} from './ports';

export type MessageCleanupOutcome =
  | { readonly kind: 'preview_case_message_deletion'; readonly job: MessageCleanupJob }
  | (MessageCleanupCounts & {
      readonly kind: 'execute_case_message_deletion' | 'ban_case_user_with_message_cleanup';
      readonly job: MessageCleanupJob;
      readonly banned: boolean;
      readonly caseFinalized: boolean;
    });
export interface MessageCleanupActions {
  execute(
    context: ActionContext,
    command: MessageCleanupCommand
  ): Promise<ActionResult<MessageCleanupOutcome>>;
}
export async function authorizeMessageCleanup(
  context: ActionContext,
  authority: AuthorityPort
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const facts = await authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts?.present) return 'actor_unavailable';
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
    return 'binding_mismatch';
  const permissions = /^\d+$/.test(facts.permissions) ? BigInt(facts.permissions) : 0n;
  return facts.owner || (permissions & 8n) !== 0n ? null : 'permission_denied';
}
export function checkMessageCleanupBinding(
  context: ActionContext,
  command: MessageCleanupCommand,
  job: MessageCleanupJob,
  state: MessageCleanupCase
): ActionDenialCode | null {
  if (
    job.id !== command.jobId ||
    command.previewReference.jobId !== job.id ||
    job.guildId !== context.guildId ||
    job.caseId !== command.caseId ||
    job.targetUserId !== command.targetUserId ||
    job.source !== context.source
  )
    return 'binding_mismatch';
  if (
    state.id !== command.caseId ||
    state.guildId !== context.guildId ||
    state.targetUserId !== command.targetUserId ||
    state.evidenceThreadId !== job.evidenceThreadId
  )
    return 'binding_mismatch';
  if (
    job.mode !== command.mode ||
    job.scope !== command.scope ||
    job.reason !== command.reason ||
    (command.kind !== 'preview_case_message_deletion' &&
      job.generation !== command.previewReference.generation)
  )
    return 'stale_state';
  if (
    command.kind === 'preview_case_message_deletion' &&
    (context.actor.kind !== 'user' || job.requestedBy !== context.actor.userId)
  )
    return 'binding_mismatch';
  return null;
}
export function createMessageCleanupActions(
  deps: MessageCleanupDependencies
): MessageCleanupActions {
  async function authorize(
    context: ActionContext,
    command: MessageCleanupCommand
  ): Promise<ActionDenialCode | null> {
    const denied = await authorizeMessageCleanup(context, deps.authority);
    if (denied) return denied;
    if (!command.reason.trim()) return 'reason_required';
    if (
      command.kind === 'ban_case_user_with_message_cleanup' &&
      !(await deps.settings.loadFresh(context.guildId)).moderatorBanActionEnabled
    )
      return 'policy_disabled';
    if (
      command.kind !== 'preview_case_message_deletion' &&
      !(await deps.confirmations.verify(context, command))
    )
      return 'confirmation_required';
    return null;
  }
  async function ban(
    context: ActionContext,
    command: MessageCleanupCommand,
    job: MessageCleanupJob
  ): Promise<void> {
    await deps.jobs.setBanStatus(job.id, 'pending');
    try {
      await deps.workflows.ban(context, command);
    } catch (error) {
      await Promise.all([
        deps.jobs.setBanStatus(job.id, 'failed'),
        deps.workflows.clearMarker(job.caseId, job.id),
      ]);
      throw error;
    }
    await deps.jobs.setBanStatus(job.id, 'succeeded');
  }
  async function finalize(
    context: ActionContext,
    command: MessageCleanupCommand,
    job: MessageCleanupJob
  ): Promise<void> {
    if (job.caseFinalizationStatus === 'succeeded') return;
    await deps.jobs.setFinalizationStatus(job.id, 'pending');
    try {
      await deps.workflows.finalize(context, command);
      await deps.jobs.setFinalizationStatus(job.id, 'succeeded');
    } catch (error) {
      await deps.jobs.setFinalizationStatus(job.id, 'failed');
      await deps.workflows.clearMarker(job.caseId, job.id);
      throw error;
    }
  }
  async function combined(
    context: ActionContext,
    command: MessageCleanupCommand,
    job: MessageCleanupJob
  ): Promise<MessageCleanupCounts> {
    await deps.workflows.markPending(job.caseId, job.id);
    if (job.banStatus !== 'succeeded') await ban(context, command, job);
    let result: MessageCleanupCounts;
    try {
      result = await deps.workflows.cleanup(job.id);
    } catch (error) {
      await deps.workflows.clearMarker(job.caseId, job.id);
      throw error;
    }
    await finalize(context, command, job);
    return result;
  }
  return {
    async execute(context, command): Promise<ActionResult<MessageCleanupOutcome>> {
      if (!command.reason.trim()) return { kind: 'denied', code: 'reason_required' };
      const job = await deps.jobs.find(command.jobId);
      const state = await deps.cases.find(command.caseId);
      if (!job || !state) return { kind: 'denied', code: 'stale_state' };
      const binding = checkMessageCleanupBinding(context, command, job, state);
      if (binding) return { kind: 'denied', code: binding };
      const committed =
        command.kind === 'ban_case_user_with_message_cleanup' && job.banStatus === 'succeeded';
      const operation = committed ? await deps.recovery.resolveCommitted(context, command) : null;
      if (committed && !operation) return { kind: 'denied', code: 'binding_mismatch' };
      const owned =
        operation?.kind === 'recorded_operation' &&
        operation.context.requestId === context.requestId &&
        operation.context.actor.kind === 'user' &&
        context.actor.kind === 'user' &&
        operation.context.actor.userId === context.actor.userId &&
        operation.context.source === context.source;
      if (!owned) {
        const denial = await authorize(context, command);
        if (denial) {
          if (command.kind === 'preview_case_message_deletion')
            await deps.jobs.fail(
              job.id,
              'Message cleanup requires current Administrator permission.'
            );
          return { kind: 'denied', code: denial };
        }
        if (!committed && state.status !== 'pending')
          return { kind: 'denied', code: 'stale_state' };
      }
      if (command.kind === 'preview_case_message_deletion')
        return {
          kind: 'outcome',
          outcome: { kind: command.kind, job: await deps.workflows.preview(job.id) },
        };
      await deps.workflows.assertBotPermissions(context.guildId, {
        ban: command.kind === 'ban_case_user_with_message_cleanup' && !committed,
        deleteMessages: job.status !== 'completed',
      });
      const isCombined = command.kind === 'ban_case_user_with_message_cleanup';
      const result = isCombined
        ? await combined(operation?.context ?? context, command, job)
        : await deps.workflows.cleanup(job.id);
      return {
        kind: 'outcome',
        outcome: {
          kind: command.kind,
          job: {
            ...job,
            status: 'completed',
            ...(isCombined
              ? ({ banStatus: 'succeeded', caseFinalizationStatus: 'succeeded' } as const)
              : {}),
          },
          ...result,
          banned: isCombined,
          caseFinalized: isCombined,
        },
      };
    },
  };
}
