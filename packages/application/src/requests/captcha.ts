import { captchaCommandSchema, type CaptchaCommand } from '../containment/captcha';
import type { ActionContext } from '../context';
import type { QueuedRow } from './decode';
import type { EnqueueInput } from './receipt';
export function decodeCaptchaCommand(row: QueuedRow): CaptchaCommand | null {
  if (
    ![
      'request_captcha_challenge',
      'retry_captcha_challenge',
      'bypass_captcha_challenge',
      'apply_captcha_pass',
      'notify_captcha_attention',
    ].includes(row.action_type)
  )
    return null;
  const metadata = row.metadata ?? {};
  const target = {
    kind: row.action_type,
    targetUserId: row.target_user_id,
    caseId: row.verification_event_id,
  };
  const issuance =
    metadata.expected_configuration === undefined
      ? {}
      : { expectedConfiguration: metadata.expected_configuration };
  if (row.action_type === 'request_captcha_challenge')
    return captchaCommandSchema.parse({ ...target, ...issuance });
  if (
    row.action_type === 'retry_captcha_challenge' ||
    row.action_type === 'bypass_captcha_challenge'
  )
    return captchaCommandSchema.parse({
      ...target,
      ...(row.action_type === 'retry_captcha_challenge' ? issuance : {}),
      expectedChallengeId: metadata.expected_challenge_id,
      expectedGeneration: metadata.expected_generation,
      ...(row.action_type === 'bypass_captcha_challenge' ? { reason: metadata.reason } : {}),
    });
  return captchaCommandSchema.parse({
    ...target,
    challengeId: metadata.challenge_id,
    generation: metadata.generation,
    ...(row.action_type === 'apply_captcha_pass'
      ? { expectedCaseRevision: metadata.expected_case_revision }
      : { reason: metadata.reason }),
  });
}
export function encodeCaptchaAction(context: ActionContext, command: CaptchaCommand): EnqueueInput {
  const base = {
    actionType: command.kind,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: command.targetUserId,
    verificationEventId: command.caseId,
  };
  if (command.kind === 'apply_captcha_pass' || command.kind === 'notify_captcha_attention') {
    const purpose = command.kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention';
    if (context.actor.kind !== 'system' || context.actor.purpose !== purpose)
      throw new Error('CAPTCHA effects require an internal bound context.');
    const key =
      command.kind === 'apply_captcha_pass'
        ? `captcha:apply:${command.challengeId}:${command.generation}`
        : `captcha:${command.reason === 'cancelled' || command.reason === 'bypassed' ? 'presentation' : 'attention'}:${command.challengeId}:${command.generation}:${command.reason.replace(/_/g, '-')}`;
    return {
      ...base,
      actorId: 'drasil:captcha',
      idempotencyKey: key,
      metadata: {
        challenge_id: command.challengeId,
        generation: command.generation,
        ...(command.kind === 'apply_captcha_pass'
          ? { expected_case_revision: command.expectedCaseRevision }
          : { reason: command.reason }),
      },
    };
  }
  if (context.actor.kind !== 'user') throw new Error('CAPTCHA moderation requires a user actor.');
  const action =
    command.kind === 'request_captcha_challenge'
      ? 'challenge_user'
      : command.kind === 'retry_captcha_challenge'
        ? 'retry_captcha'
        : 'bypass_captcha';
  return {
    ...base,
    actorId: context.actor.userId,
    idempotencyKey: `${context.source}:case-action:${action}:${context.guildId}:${command.caseId}${command.kind === 'request_captcha_challenge' ? '' : `:${context.requestId}`}`,
    metadata: {
      ...('expectedConfiguration' in command && command.expectedConfiguration
        ? { expected_configuration: command.expectedConfiguration }
        : {}),
      case_action: action,
      requested_surface: context.source,
      ...('expectedChallengeId' in command
        ? {
            expected_challenge_id: command.expectedChallengeId,
            expected_generation: command.expectedGeneration,
          }
        : {}),
      ...(command.kind === 'bypass_captcha_challenge' ? { reason: command.reason } : {}),
    },
  };
}
