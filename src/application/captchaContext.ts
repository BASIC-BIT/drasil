import { encodeQueuedAction, type CaptchaSystemCommand } from '@drasil/application';
import {
  ModerationActionRequestType,
  type CaptchaChallenge,
  type ModerationActionRequestCreate,
} from '../repositories/types';

// The caller supplies the persisted challenge, never a transport-selected actor.
export function encodeCaptchaEffect(
  challenge: CaptchaChallenge,
  effect: 'pass' | Extract<CaptchaSystemCommand, { kind: 'notify_captcha_attention' }>['reason']
): ModerationActionRequestCreate {
  const binding = {
    caseId: challenge.verification_event_id,
    targetUserId: challenge.user_id,
    challengeId: challenge.id,
    generation: challenge.generation,
  };
  const command: CaptchaSystemCommand =
    effect === 'pass'
      ? {
          kind: 'apply_captcha_pass',
          ...binding,
          expectedCaseRevision: challenge.case_revision_at_issue,
        }
      : { kind: 'notify_captcha_attention', ...binding, reason: effect };
  const encoded = encodeQueuedAction(
    {
      guildId: challenge.server_id,
      requestId: `${challenge.id}:${challenge.generation}`,
      source: 'captcha',
      actor: { kind: 'system', purpose: effect === 'pass' ? 'captcha_pass' : 'captcha_attention' },
    },
    command
  );
  return {
    ...encoded,
    actionType:
      effect === 'pass'
        ? ModerationActionRequestType.APPLY_CAPTCHA_PASS
        : ModerationActionRequestType.NOTIFY_CAPTCHA_ATTENTION,
  };
}
