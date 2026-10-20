import type { QueueCaseActionInput } from '../../activeCaseDataAdapter';
import type { QueuedCommand } from '@drasil/application';
import {
  createCaptchaBrowserActions,
  encodeQueuedAction,
  type ActionContext,
  type ActionResult,
  type CaptchaBrowserDependencies,
  type CaptchaBrowserActions,
  type CaptchaSystemCommand,
  type EnqueueInput,
} from '@drasil/application';

export function createWebCaptchaActions(ports: CaptchaBrowserDependencies): CaptchaBrowserActions {
  return createCaptchaBrowserActions(ports);
}
export function requireCaptchaBrowserOutcome<T>(result: ActionResult<T>): T {
  if (result.kind === 'denied') throw new Error('Security-check identity is unavailable.');
  return result.outcome;
}
// Only runtime code calls this with a challenge loaded inside the transaction or from its link.
export function createCaptchaPassContext(challenge: {
  readonly serverId: string;
  readonly id: string;
  readonly generation: number;
}): ActionContext {
  return {
    guildId: challenge.serverId,
    requestId: `captcha:apply:${challenge.id}:${challenge.generation}`,
    source: 'captcha',
    actor: { kind: 'system', purpose: 'captcha_pass' },
  };
}
export function encodeWebCaptchaEffect(
  guildId: string,
  command: CaptchaSystemCommand
): EnqueueInput {
  return encodeQueuedAction(
    {
      guildId,
      requestId: `${command.challengeId}:${command.generation}`,
      source: 'captcha',
      actor: {
        kind: 'system',
        purpose: command.kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention',
      },
    },
    command
  );
}

export function buildQueuedCaptchaCommand(
  input: QueueCaseActionInput,
  userId: string
): QueuedCommand | null {
  const binding = { caseId: input.caseId, targetUserId: userId };
  switch (input.action) {
    case 'challenge_user':
      return { kind: 'request_captcha_challenge', ...binding };
    case 'retry_captcha':
    case 'bypass_captcha':
      if (!input.expectedCaptchaChallengeId || !input.expectedCaptchaGeneration) return null;
      return input.action === 'retry_captcha'
        ? {
            kind: 'retry_captcha_challenge',
            ...binding,
            expectedChallengeId: input.expectedCaptchaChallengeId,
            expectedGeneration: input.expectedCaptchaGeneration,
          }
        : {
            kind: 'bypass_captcha_challenge',
            ...binding,
            expectedChallengeId: input.expectedCaptchaChallengeId,
            expectedGeneration: input.expectedCaptchaGeneration,
            reason: input.reason ?? '',
          };
    default:
      return null;
  }
}
