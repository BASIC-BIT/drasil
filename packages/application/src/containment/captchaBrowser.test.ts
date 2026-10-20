import { createCaptchaBrowserActions, type CaptchaBrowserDependencies } from './captchaBrowser';
import type { ActionContext } from '../context';
const context: ActionContext = {
  guildId: 'guild',
  requestId: 'attempt',
  source: 'captcha',
  actor: { kind: 'user', userId: 'target' },
};
const ref = { challengeId: 'challenge', generation: 1, idempotencyKey: 'attempt' };
test('provider_budget_and_identity_mismatch_keep_current_outcomes', async () => {
  let mismatchState = '';
  const ports: CaptchaBrowserDependencies = {
    async beginAttempt() {
      return { state: 'rate_limited' };
    },
    async recordIdentityMismatch() {
      mismatchState = 'identity_mismatch';
    },
    async completeAttempt() {
      return 'provider_error';
    },
    async requeuePassEffect() {},
  };
  const actions = createCaptchaBrowserActions(ports);
  expect(await actions.beginAttempt(context, ref)).toEqual({
    kind: 'outcome',
    outcome: { state: 'rate_limited' },
  });
  await actions.recordIdentityMismatch(context, ref);
  expect(mismatchState).toBe('identity_mismatch');
  expect(
    await actions.completeAttempt(context, {
      challengeId: 'challenge',
      generation: 1,
      attemptId: 'attempt',
      validation: {
        state: 'provider_error',
        success: null,
        action: null,
        hostname: null,
        errorCodes: ['internal-error'],
      },
    })
  ).toEqual({ kind: 'outcome', outcome: 'provider_error' });
});
test('browser operations reject system identities and user-selected pass recovery', async () => {
  let calls = 0;
  const actions = createCaptchaBrowserActions({
    async beginAttempt() {
      calls++;
      return { state: 'ready' };
    },
    async recordIdentityMismatch() {
      calls++;
    },
    async completeAttempt() {
      calls++;
      return 'passed';
    },
    async requeuePassEffect() {
      calls++;
    },
  });
  expect(
    await actions.beginAttempt(
      { ...context, actor: { kind: 'system', purpose: 'captcha_pass' } },
      ref
    )
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(
    await actions.requeuePassEffect(context, {
      challengeId: 'challenge',
      generation: 1,
      caseId: 'case',
      targetUserId: 'target',
      expectedCaseRevision: 2,
    })
  ).toEqual({ kind: 'denied', code: 'permission_denied' });
  expect(calls).toBe(0);
});
