import type { CaptchaCommand } from '../containment/captcha';
import { encodeQueuedAction } from './encode';
import { decodeQueuedAction } from './decode';
import type { ActionContext } from '../context';
const context: ActionContext = {
  guildId: 'guild',
  requestId: 'attempt',
  source: 'web',
  actor: { kind: 'user', userId: 'moderator' },
};
test('CAPTCHA retries retain the shipped correlation key and generation binding', () => {
  const encoded = encodeQueuedAction(context, {
    kind: 'retry_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedChallengeId: 'challenge',
    expectedGeneration: 3,
  });
  expect(encoded.idempotencyKey).toBe('web:case-action:retry_captcha:guild:case:attempt');
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: 'guild',
      action_type: encoded.actionType,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      target_user_id: 'target',
      verification_event_id: 'case',
      metadata: encoded.metadata,
    }).command
  ).toEqual({
    kind: 'retry_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedChallengeId: 'challenge',
    expectedGeneration: 3,
  });
});
test('persisted pass rows decode without minting a system actor from source', () => {
  const decoded = decodeQueuedAction({
    id: 'request',
    server_id: 'guild',
    action_type: 'apply_captcha_pass',
    actor_id: 'drasil:captcha',
    actor_surface: 'captcha',
    target_user_id: 'target',
    verification_event_id: 'case',
    metadata: { challenge_id: 'challenge', generation: 1, expected_case_revision: 4 },
  });
  expect(decoded.context.actor).toEqual({ kind: 'user', userId: 'drasil:captcha' });
  expect(decoded.command).toEqual({
    kind: 'apply_captcha_pass',
    caseId: 'case',
    targetUserId: 'target',
    challengeId: 'challenge',
    generation: 1,
    expectedCaseRevision: 4,
  });
});

const commands: CaptchaCommand[] = [
  { kind: 'request_captcha_challenge', caseId: 'case', targetUserId: 'target' },
  {
    kind: 'retry_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedChallengeId: 'challenge',
    expectedGeneration: 3,
  },
  {
    kind: 'bypass_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedChallengeId: 'challenge',
    expectedGeneration: 3,
    reason: 'Reviewed',
  },
  {
    kind: 'apply_captcha_pass',
    caseId: 'case',
    targetUserId: 'target',
    challengeId: 'challenge',
    generation: 3,
    expectedCaseRevision: 2,
  },
  {
    kind: 'notify_captcha_attention',
    caseId: 'case',
    targetUserId: 'target',
    challengeId: 'challenge',
    generation: 3,
    reason: 'submission_limit',
  },
];
test.each(commands)('round trips the shipped $kind request', (command) => {
  const actor: ActionContext['actor'] =
    command.kind === 'apply_captcha_pass'
      ? { kind: 'system', purpose: 'captcha_pass' }
      : command.kind === 'notify_captcha_attention'
        ? { kind: 'system', purpose: 'captcha_attention' }
        : context.actor;
  const input = encodeQueuedAction(
    { ...context, source: actor.kind === 'system' ? 'captcha' : 'web', actor },
    command
  );
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: input.serverId,
      actor_id: input.actorId,
      actor_surface: input.actorSurface,
      action_type: input.actionType,
      target_user_id: input.targetUserId,
      verification_event_id: input.verificationEventId,
      metadata: input.metadata,
    }).command
  ).toEqual(command);
  expect(input.metadata).not.toHaveProperty('actor');
});

test.each([
  {
    kind: 'request_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedConfiguration: { method: 'turnstile', methodRevision: 7 },
  },
  {
    kind: 'retry_captcha_challenge',
    caseId: 'case',
    targetUserId: 'target',
    expectedChallengeId: 'challenge',
    expectedGeneration: 3,
    expectedConfiguration: { method: 'turnstile', methodRevision: 7 },
  },
] as const)('round trips captured issuance configuration on $kind', (command) => {
  const input = encodeQueuedAction(context, command);
  expect(input.metadata).toMatchObject({ expected_configuration: command.expectedConfiguration });
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: input.serverId,
      actor_id: input.actorId,
      actor_surface: input.actorSurface,
      action_type: input.actionType,
      target_user_id: input.targetUserId,
      verification_event_id: input.verificationEventId,
      metadata: input.metadata,
    }).command
  ).toEqual(command);
});
