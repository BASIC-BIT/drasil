import type { ActionContext } from '../context';
import { authorizeAttention } from '../authorization';
import type { ActionDenialCode } from '../results';
import type { ActionResult } from '../results';
import type {
  QuarantineDependencies,
  QuarantineExecutionResult,
  QuarantinePreviewData,
} from './ports';
export interface QuarantineTarget {
  readonly caseId: string;
  readonly targetUserId: string;
}
export type QuarantinePreviewReference =
  | { readonly kind: 'discord_confirmation'; readonly fingerprint: string }
  | { readonly kind: 'persisted_preview'; readonly requestId: string };
export interface QuarantineExecuteInput extends QuarantineTarget {
  readonly reason: string;
  readonly previewReference: QuarantinePreviewReference;
}
export interface QuarantineActions {
  preview(
    context: ActionContext,
    input: QuarantineTarget
  ): Promise<ActionResult<QuarantinePreviewData>>;
  execute(
    context: ActionContext,
    input: QuarantineExecuteInput
  ): Promise<ActionResult<QuarantineExecutionResult>>;
}
export function createQuarantineActions(deps: QuarantineDependencies): QuarantineActions {
  async function checkTarget(
    context: ActionContext,
    input: QuarantineTarget
  ): Promise<ActionDenialCode | null> {
    const state = await deps.repository.findActive(context.guildId, input.targetUserId);
    if (!state || state.id !== input.caseId || state.status !== 'pending') return 'stale_state';
    return state.server_id === context.guildId && state.user_id === input.targetUserId
      ? null
      : 'binding_mismatch';
  }
  async function authorize(context: ActionContext): Promise<ActionDenialCode | null> {
    const denial = await authorizeAttention(context, deps.authority);
    if (denial) return denial;
    return (await deps.settings.loadFresh(context.guildId)).enabled ? null : 'policy_disabled';
  }
  return {
    async preview(context, input): ReturnType<QuarantineActions['preview']> {
      const denial = (await authorize(context)) ?? (await checkTarget(context, input));
      if (denial) return { kind: 'denied', code: denial };
      return { kind: 'outcome', outcome: await deps.workflows.preview(context, input) };
    },
    async execute(context, input): ReturnType<QuarantineActions['execute']> {
      if (!input.reason.trim()) return { kind: 'denied', code: 'reason_required' };
      // This port can return only the recorded result of this runtime's persisted request.
      // It cannot enforce again and does not infer recovery authority from source.
      const recovered = await deps.workflows.recoverCommitted(context, input);
      if (recovered) return { kind: 'outcome', outcome: recovered };
      const denial = await authorize(context);
      if (denial) return { kind: 'denied', code: denial };
      const binding = await deps.previews.resolve(context, input);
      if (!binding) return { kind: 'denied', code: 'confirmation_required' };
      if (
        context.actor.kind !== 'user' ||
        binding.guildId !== context.guildId ||
        binding.actorId !== context.actor.userId ||
        binding.caseId !== input.caseId ||
        binding.targetUserId !== input.targetUserId
      )
        return { kind: 'denied', code: 'binding_mismatch' };
      if (binding.expiresAt <= deps.now()) return { kind: 'denied', code: 'stale_state' };
      const targetDenial = await checkTarget(context, input);
      if (targetDenial) return { kind: 'denied', code: targetDenial };
      const live = await deps.workflows.preview(context, input);
      if (live.fingerprint !== binding.fingerprint) return { kind: 'denied', code: 'stale_state' };
      const repair = await deps.workflows.repair(context, input);
      if (repair.verificationEventId !== input.caseId || !repair.threadId)
        throw new Error(
          'A usable user verification thread is required before this account can be quarantined.'
        );
      if (repair.notificationReady !== true)
        throw new Error(
          'A usable persistent admin notification is required before this account can be quarantined.'
        );
      const repairedDenial = await checkTarget(context, input);
      if (repairedDenial) return { kind: 'denied', code: repairedDenial };
      const repaired = await deps.workflows.preview(context, input);
      if (repaired.fingerprint !== binding.fingerprint)
        return { kind: 'denied', code: 'stale_state' };
      // Repair may cross network boundaries; re-read authority and mutable policy before enforcing.
      const finalDenial = await authorize(context);
      if (finalDenial) return { kind: 'denied', code: finalDenial };
      return {
        kind: 'outcome',
        outcome: await deps.workflows.quarantine(context, {
          ...input,
          reason: input.reason.trim(),
        }),
      };
    },
  };
}
