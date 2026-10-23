import type { ActionContext } from '../context';
import type { ActionResult } from '../results';
export interface CaptchaBrowserReference {
  readonly challengeId: string;
  readonly generation: number;
}
export interface CaptchaAttemptInput extends CaptchaBrowserReference {
  readonly idempotencyKey: string;
}
export interface CaptchaBoundAttemptInput extends CaptchaAttemptInput {
  readonly provider: 'turnstile' | 'discord_image';
}
export interface VerifiedCaptchaOutcome {
  readonly state: 'passed' | 'invalid' | 'provider_error';
  readonly success: boolean | null;
  readonly action: string | null;
  readonly hostname: string | null;
  readonly errorCodes: readonly string[];
}
/** Server-only proof, derived from stored native material after answer verification. */
export interface CaptchaImageIssuanceProof {
  readonly keyVersion: string;
  readonly answerDigest: string;
}
interface CaptchaCompletionFields extends CaptchaBrowserReference {
  readonly attemptId: string;
  readonly validation: VerifiedCaptchaOutcome;
}
export type CaptchaCompletionInput = CaptchaCompletionFields &
  (
    | { readonly provider: 'turnstile' }
    | { readonly provider: 'discord_image'; readonly imageIssuance: CaptchaImageIssuanceProof }
  );
export interface CaptchaPassReference extends CaptchaBrowserReference {
  readonly caseId: string;
  readonly targetUserId: string;
  readonly expectedCaseRevision: number;
}
export interface CaptchaBrowserChallenge {
  readonly id: string;
  readonly verificationEventId: string;
  readonly serverId: string;
  readonly userId: string;
  readonly status:
    | 'pending'
    | 'passed'
    | 'failed'
    | 'expired'
    | 'bypassed'
    | 'cancelled'
    | 'unavailable';
  readonly generation: number;
  readonly caseRevision: number;
  readonly expiresAt: Date;
}
export interface CaptchaAttemptStart {
  readonly state:
    | 'ready'
    | 'duplicate'
    | 'identity_mismatch'
    | 'rate_limited'
    | 'stale'
    | 'unavailable';
  readonly attemptId?: string;
  readonly previousState?:
    | 'started'
    | 'identity_mismatch'
    | 'invalid'
    | 'passed'
    | 'provider_error'
    | 'stale';
  readonly challenge?: CaptchaBrowserChallenge;
}
export type CaptchaAttemptCompletion = 'passed' | 'invalid' | 'failed' | 'provider_error' | 'stale';
// Each port owns one transaction, including fresh bindings and provider-budget locks.
export interface CaptchaBrowserDependencies {
  beginAttempt(context: ActionContext, input: CaptchaAttemptInput): Promise<CaptchaAttemptStart>;
  recordIdentityMismatch(context: ActionContext, input: CaptchaAttemptInput): Promise<void>;
  completeAttempt(
    context: ActionContext,
    input: CaptchaCompletionInput
  ): Promise<CaptchaAttemptCompletion>;
  requeuePassEffect(context: ActionContext, input: CaptchaPassReference): Promise<void>;
}
export interface CaptchaBrowserActions {
  beginAttempt(
    context: ActionContext,
    input: CaptchaAttemptInput
  ): Promise<ActionResult<CaptchaAttemptStart>>;
  recordIdentityMismatch(
    context: ActionContext,
    input: CaptchaAttemptInput
  ): Promise<ActionResult<void>>;
  completeAttempt(
    context: ActionContext,
    input: CaptchaCompletionInput
  ): Promise<ActionResult<CaptchaAttemptCompletion>>;
  requeuePassEffect(
    context: ActionContext,
    input: CaptchaPassReference
  ): Promise<ActionResult<void>>;
}
export function createCaptchaBrowserActions(
  deps: CaptchaBrowserDependencies
): CaptchaBrowserActions {
  return {
    async beginAttempt(context, input): Promise<ActionResult<CaptchaAttemptStart>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      return { kind: 'outcome', outcome: await deps.beginAttempt(context, input) };
    },
    async recordIdentityMismatch(context, input): Promise<ActionResult<void>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      return { kind: 'outcome', outcome: await deps.recordIdentityMismatch(context, input) };
    },
    async completeAttempt(context, input): Promise<ActionResult<CaptchaAttemptCompletion>> {
      if (context.actor.kind !== 'user') return { kind: 'denied', code: 'permission_denied' };
      return { kind: 'outcome', outcome: await deps.completeAttempt(context, input) };
    },
    async requeuePassEffect(context, input): Promise<ActionResult<void>> {
      if (context.actor.kind !== 'system' || context.actor.purpose !== 'captcha_pass')
        return { kind: 'denied', code: 'permission_denied' };
      return { kind: 'outcome', outcome: await deps.requeuePassEffect(context, input) };
    },
  };
}
