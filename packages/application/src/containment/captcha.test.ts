import {
  createCaptchaActions,
  captchaCommandSchema,
  type CaptchaActions,
  type CaptchaOutcome,
  type CaptchaDependencies,
} from './captcha';
import type { ActionContext } from '../context';

const user: ActionContext = {
  guildId: 'guild',
  requestId: 'request',
  source: 'web',
  actor: { kind: 'user', userId: 'moderator' },
};
const target = { caseId: 'case', targetUserId: 'target' };
function setup(): {
  deps: CaptchaDependencies;
  actions: CaptchaActions;
  applied(): number;
  revoke(): void;
} {
  let applied = 0;
  let permission = (1n << 40n).toString();
  const deps: CaptchaDependencies = {
    authority: {
      async loadFresh() {
        return {
          guildId: 'guild',
          userId: 'moderator',
          present: true,
          owner: false,
          permissions: permission,
          roleIds: [],
        };
      },
    },
    confirmations: {
      async verify() {
        return true;
      },
    },
    state: {
      async load() {
        return {
          guildId: 'guild',
          caseId: 'case',
          targetUserId: 'target',
          status: 'pending',
          caseKind: 'standard',
          challenge: { id: 'challenge', generation: 2, caseRevision: 0, status: 'passed' },
        };
      },
    },
    settings: {
      async loadFresh() {
        return { enabled: true };
      },
    },
    workflows: {
      async recoverCommitted() {
        return null;
      },
      async request() {
        return {
          action_type: 'request_captcha_challenge',
          challenge_id: 'challenge',
          generation: 2,
          delivered: true,
          target_user_id: 'target',
          verification_event_id: 'case',
        };
      },
      async bypass() {
        return {
          action_type: 'bypass_captcha_challenge',
          challenge_id: 'challenge',
          generation: 2,
          bypassed: true,
          target_user_id: 'target',
          verification_event_id: 'case',
        };
      },
      async applyPass() {
        applied++;
        return {
          action_type: 'apply_captcha_pass',
          challenge_id: 'challenge',
          generation: 2,
          effect: 'resolved',
          resolved: true,
          held_reason: null,
          target_user_id: 'target',
          verification_event_id: 'case',
        };
      },
      async notifyAttention() {
        return {
          action_type: 'notify_captcha_attention',
          challenge_id: 'challenge',
          generation: 2,
          reason: 'expired',
          notified: true,
          target_user_id: 'target',
          verification_event_id: 'case',
        };
      },
    },
  };
  return {
    deps,
    actions: createCaptchaActions(deps),
    applied: (): number => applied,
    revoke: (): void => {
      permission = '0';
    },
  };
}

test('stale_generation_cannot_apply_pass', async () => {
  const { actions, applied } = setup();
  const result = await actions.execute(
    { ...user, actor: { kind: 'system', purpose: 'captcha_pass' } },
    {
      kind: 'apply_captcha_pass',
      ...target,
      challengeId: 'challenge',
      generation: 1,
      expectedCaseRevision: 0,
    }
  );
  expect(result).toEqual({ kind: 'denied', code: 'stale_state' });
  expect(applied()).toBe(0);
});

test('external_input_cannot_select_captcha_system_actor', () => {
  expect(
    captchaCommandSchema.safeParse({
      kind: 'apply_captcha_pass',
      ...target,
      challengeId: 'challenge',
      generation: 2,
      expectedCaseRevision: 0,
      actor: { kind: 'system', purpose: 'captcha_pass' },
    }).success
  ).toBe(false);
});

test('moderator_bypass_rechecks_authority', async () => {
  const { actions, revoke } = setup();
  revoke();
  expect(
    await actions.execute(user, {
      kind: 'bypass_captcha_challenge',
      ...target,
      expectedChallengeId: 'challenge',
      expectedGeneration: 2,
      reason: 'Reviewed',
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
});

test('a source string does not authorize internal effects', async () => {
  const { actions, applied } = setup();
  expect(
    await actions.execute(
      { ...user, source: 'captcha' },
      {
        kind: 'apply_captcha_pass',
        ...target,
        challengeId: 'challenge',
        generation: 2,
        expectedCaseRevision: 0,
      }
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(applied()).toBe(0);
});

test('a verified current pass applies exactly once through the pass workflow', async () => {
  const { actions, applied } = setup();
  expect(
    await actions.execute(
      { ...user, actor: { kind: 'system', purpose: 'captcha_pass' } },
      {
        kind: 'apply_captcha_pass',
        ...target,
        challengeId: 'challenge',
        generation: 2,
        expectedCaseRevision: 0,
      }
    )
  ).toMatchObject({ kind: 'outcome', outcome: { resolved: true } });
  expect(applied()).toBe(1);
});
test('a revision mismatch cannot apply a pass', async () => {
  const { actions, applied } = setup();
  expect(
    await actions.execute(
      { ...user, actor: { kind: 'system', purpose: 'captcha_pass' } },
      {
        kind: 'apply_captcha_pass',
        ...target,
        challengeId: 'challenge',
        generation: 2,
        expectedCaseRevision: 1,
      }
    )
  ).toEqual({ kind: 'denied', code: 'stale_state' });
  expect(applied()).toBe(0);
});
test('a fresh disabled policy blocks a new request', async () => {
  const { actions, deps } = setup();
  deps.settings.loadFresh = async (): Promise<{ enabled: boolean }> => ({ enabled: false });
  expect(await actions.execute(user, { kind: 'request_captcha_challenge', ...target })).toEqual({
    kind: 'denied',
    code: 'policy_disabled',
  });
});
test('an authenticated bypass delegates final eligibility to the transactional workflow', async () => {
  const { actions, deps } = setup();
  deps.settings.loadFresh = async (): Promise<{ enabled: boolean }> => ({ enabled: false });
  deps.workflows.bypass = jest.fn(async () => {
    throw new Error('Challenge is not eligible');
  });
  await expect(
    actions.execute(user, {
      kind: 'bypass_captcha_challenge',
      ...target,
      expectedChallengeId: 'challenge',
      expectedGeneration: 2,
      reason: 'Reviewed',
    })
  ).rejects.toThrow('Challenge is not eligible');
  expect(deps.workflows.bypass).toHaveBeenCalledTimes(1);
});
test('an unconfirmed moderator command cannot mutate a challenge', async () => {
  const { actions, deps } = setup();
  deps.confirmations.verify = async (): Promise<boolean> => false;
  expect(await actions.execute(user, { kind: 'request_captcha_challenge', ...target })).toEqual({
    kind: 'denied',
    code: 'confirmation_required',
  });
});
test('retry refuses a different displayed generation', async () => {
  const { actions } = setup();
  expect(
    await actions.execute(user, {
      kind: 'retry_captcha_challenge',
      ...target,
      expectedChallengeId: 'challenge',
      expectedGeneration: 1,
    })
  ).toEqual({ kind: 'denied', code: 'stale_state' });
});
test('the two internal purposes cannot authorize one another', async () => {
  const { actions, applied } = setup();
  expect(
    await actions.execute(
      { ...user, actor: { kind: 'system', purpose: 'captcha_attention' } },
      {
        kind: 'apply_captcha_pass',
        ...target,
        challengeId: 'challenge',
        generation: 2,
        expectedCaseRevision: 0,
      }
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(applied()).toBe(0);
});
test('a recorded mutation can finish its receipt after authority changes', async () => {
  const { actions, deps, revoke } = setup();
  revoke();
  deps.workflows.recoverCommitted = async (): Promise<CaptchaOutcome> => ({
    action_type: 'bypass_captcha_challenge',
    challenge_id: 'challenge',
    generation: 2,
    bypassed: true,
    resumed: true,
    target_user_id: 'target',
    verification_event_id: 'case',
  });
  expect(
    await actions.execute(user, {
      kind: 'bypass_captcha_challenge',
      ...target,
      expectedChallengeId: 'challenge',
      expectedGeneration: 2,
      reason: 'Reviewed',
    })
  ).toMatchObject({ kind: 'outcome', outcome: { resumed: true } });
});
