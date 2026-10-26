import { expect, it } from 'vitest';
import { filterCaseKindActions } from './caseActionEligibility';
it('excludes close without action from compromised cases, including parked recovery', () => {
  expect(
    filterCaseKindActions({ caseKind: 'compromised_account' }, [
      'verify_user',
      'close_no_action',
      'ban_user',
    ])
  ).toEqual(['verify_user', 'ban_user']);
  expect(
    filterCaseKindActions({ caseKind: 'standard' }, ['verify_user', 'close_no_action'])
  ).toEqual(['verify_user', 'close_no_action']);
});
