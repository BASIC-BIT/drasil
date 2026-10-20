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
