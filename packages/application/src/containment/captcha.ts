import { z } from 'zod';
import type { ActionContext } from '../context';
import type { ActionResult, ActionDenialCode } from '../results';
import type { AuthorityPort } from '../authorization';
import type { ConfirmationPort } from '../confirmation';
const id = z.string().min(1);
const target = { caseId: id, targetUserId: id };
const generation = z.number().int().positive();
const expected = { expectedChallengeId: id, expectedGeneration: generation };
export const captchaAttentionReasonSchema = z.enum([
  'delivery_failed',
  'submission_limit',
  'expired',
  'cancelled',
  'bypassed',
]);
export const captchaCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request_captcha_challenge'), ...target }).strict(),
  z.object({ kind: z.literal('retry_captcha_challenge'), ...target, ...expected }).strict(),
  z
    .object({
      kind: z.literal('bypass_captcha_challenge'),
      ...target,
      ...expected,
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('apply_captcha_pass'),
      ...target,
      challengeId: id,
      generation,
      expectedCaseRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('notify_captcha_attention'),
      ...target,
      challengeId: id,
      generation,
      reason: captchaAttentionReasonSchema,
    })
    .strict(),
]);
export type CaptchaCommand = z.infer<typeof captchaCommandSchema>;
export type CaptchaModeratorCommand = Exclude<
  CaptchaCommand,
  { kind: 'apply_captcha_pass' | 'notify_captcha_attention' }
>;
export type CaptchaSystemCommand = Exclude<CaptchaCommand, CaptchaModeratorCommand>;
const receipt = { challenge_id: id, generation, target_user_id: id, verification_event_id: id };
export const captchaOutcomeSchema = z.discriminatedUnion('action_type', [
  z.object({
    action_type: z.literal('request_captcha_challenge'),
    ...receipt,
    delivered: z.boolean(),
    resumed: z.boolean().optional(),
  }),
  z.object({
    action_type: z.literal('retry_captcha_challenge'),
    ...receipt,
    delivered: z.boolean(),
    resumed: z.boolean().optional(),
  }),
  z.object({
    action_type: z.literal('bypass_captcha_challenge'),
    ...receipt,
    bypassed: z.boolean(),
    resumed: z.boolean().optional(),
  }),
  z.object({
    action_type: z.literal('apply_captcha_pass'),
    ...receipt,
    effect: z.string(),
    held_reason: z.string().nullable(),
    resolved: z.boolean(),
  }),
  z.object({
    action_type: z.literal('notify_captcha_attention'),
    ...receipt,
    reason: captchaAttentionReasonSchema,
    notified: z.boolean().optional(),
    presented: z.boolean().optional(),
    stale: z.boolean().optional(),
  }),
]);
export type CaptchaOutcome = z.infer<typeof captchaOutcomeSchema>;
export interface CaptchaState {
  readonly guildId: string;
  readonly caseId: string;
  readonly targetUserId: string;
  readonly status: string;
  readonly caseKind: string;
  readonly challenge: {
    readonly id: string;
    readonly generation: number;
    readonly caseRevision: number;
    readonly status: string;
  } | null;
}
export interface CaptchaDependencies {
  readonly authority: AuthorityPort;
  readonly confirmations: ConfirmationPort;
  readonly state: {
    load(context: ActionContext, command: CaptchaCommand): Promise<CaptchaState | null>;
  };
  readonly settings: { loadFresh(guildId: string): Promise<{ readonly enabled: boolean }> };
  readonly workflows: {
    recoverCommitted(
      context: ActionContext,
      command: CaptchaModeratorCommand
    ): Promise<CaptchaOutcome | null>;
    request(
      context: ActionContext,
      command: Extract<
        CaptchaCommand,
        { kind: 'request_captcha_challenge' | 'retry_captcha_challenge' }
      >
    ): Promise<CaptchaOutcome>;
    bypass(
      context: ActionContext,
      command: Extract<CaptchaCommand, { kind: 'bypass_captcha_challenge' }>
    ): Promise<CaptchaOutcome>;
    applyPass(
      context: ActionContext,
      command: Extract<CaptchaCommand, { kind: 'apply_captcha_pass' }>
    ): Promise<CaptchaOutcome>;
    notifyAttention(
      context: ActionContext,
      command: Extract<CaptchaCommand, { kind: 'notify_captcha_attention' }>
    ): Promise<CaptchaOutcome>;
  };
}
export interface CaptchaActions {
  execute(context: ActionContext, command: CaptchaCommand): Promise<ActionResult<CaptchaOutcome>>;
}
export function createCaptchaActions(deps: CaptchaDependencies): CaptchaActions {
  return {
    async execute(context, command): Promise<ActionResult<CaptchaOutcome>> {
      const system =
        command.kind === 'apply_captcha_pass' || command.kind === 'notify_captcha_attention';
      if (system) {
        const purpose =
          command.kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention';
        if (context.actor.kind !== 'system' || context.actor.purpose !== purpose)
          return { kind: 'denied', code: 'permission_denied' };
      } else {
        if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
        const recovered = await deps.workflows.recoverCommitted(context, command);
        if (recovered) return { kind: 'outcome', outcome: recovered };
        const denied = await authorizeCaptchaModerator(context, deps.authority);
        if (denied) return { kind: 'denied', code: denied };
        if (command.kind === 'bypass_captcha_challenge' && !command.reason.trim())
          return { kind: 'denied', code: 'reason_required' };
        if (!(await deps.confirmations.verify(context, command)))
          return { kind: 'denied', code: 'confirmation_required' };
      }
      if (command.kind === 'notify_captcha_attention')
        return { kind: 'outcome', outcome: await deps.workflows.notifyAttention(context, command) };
      const state = await deps.state.load(context, command);
      const denial = checkCaptchaBinding(context, command, state);
      if (denial) return { kind: 'denied', code: denial };
      if (
        !system &&
        command.kind !== 'bypass_captcha_challenge' &&
        !(await deps.settings.loadFresh(context.guildId)).enabled
      )
        return { kind: 'denied', code: 'policy_disabled' };
      switch (command.kind) {
        case 'request_captcha_challenge':
        case 'retry_captcha_challenge':
          return { kind: 'outcome', outcome: await deps.workflows.request(context, command) };
        case 'bypass_captcha_challenge':
          return { kind: 'outcome', outcome: await deps.workflows.bypass(context, command) };
        case 'apply_captcha_pass':
          return { kind: 'outcome', outcome: await deps.workflows.applyPass(context, command) };
      }
    },
  };
}
async function authorizeCaptchaModerator(
  context: ActionContext,
  authority: AuthorityPort
): Promise<ActionDenialCode | null> {
  if (context.actor.kind !== 'user') return 'permission_denied';
  const facts = await authority.loadFresh(context.guildId, context.actor.userId);
  if (!facts?.present) return 'actor_unavailable';
  if (facts.guildId !== context.guildId || facts.userId !== context.actor.userId)
    return 'binding_mismatch';
  const permissions = /^\d+$/.test(facts.permissions) ? BigInt(facts.permissions) : 0n;
  return facts.owner || (permissions & ((1n << 3n) | (1n << 5n) | (1n << 40n))) !== 0n
    ? null
    : 'permission_denied';
}
function checkCaptchaBinding(
  context: ActionContext,
  command: CaptchaCommand,
  state: CaptchaState | null
): ActionDenialCode | null {
  if (
    !state ||
    state.guildId !== context.guildId ||
    state.caseId !== command.caseId ||
    state.targetUserId !== command.targetUserId
  )
    return 'binding_mismatch';
  if (command.kind === 'notify_captcha_attention') return null; // Runtime renders the shipped stale attention receipt.
  if ('challengeId' in command) {
    if (
      !state.challenge ||
      state.challenge.id !== command.challengeId ||
      state.challenge.generation !== command.generation ||
      state.challenge.caseRevision !== command.expectedCaseRevision ||
      state.challenge.status !== 'passed'
    )
      return 'stale_state';
    return null; // The pass workflow also resumes committed resolution after the case becomes terminal.
  }
  if (state.status !== 'pending' || state.caseKind !== 'standard') return 'stale_state';
  if (
    'expectedChallengeId' in command &&
    (!state.challenge ||
      state.challenge.id !== command.expectedChallengeId ||
      state.challenge.generation !== command.expectedGeneration)
  )
    return 'stale_state';
  return null;
}
