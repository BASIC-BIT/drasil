import { evaluateCasePolicy, readCasePolicy } from './policy';
it('shares shipped defaults between submission and execution', () => {
  expect(readCasePolicy({})).toEqual({
    adminCaseOpenRequiresReason: false,
    moderatorBanActionEnabled: true,
    moderatorBanActionRequiresReason: false,
    moderatorKickActionEnabled: true,
    moderatorKickActionRequiresReason: false,
  });
});
it.each([
  ['open_admin_case', { admin_case_open_requires_reason: true }, 'reason_required'],
  ['ban_case_user', { moderator_ban_action_enabled: false }, 'policy_disabled'],
  ['ban_case_user_by_id', { moderator_ban_action_requires_reason: true }, 'reason_required'],
  ['kick_case_user', { moderator_kick_action_enabled: false }, 'policy_disabled'],
] as const)('checks %s mutable policy before effects', (kind, settings, denial) => {
  expect(evaluateCasePolicy({ kind, reason: null }, readCasePolicy(settings))).toBe(denial);
});
it('fails closed when mutable settings are malformed', () => {
  expect(() => readCasePolicy({ moderator_ban_action_enabled: 'true' })).toThrow();
});
