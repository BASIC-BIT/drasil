import { describe, expect, it } from 'vitest';
import { resolveDurableRequestForCaseAction } from './caseActionRequestState';

describe('resolveDurableRequestForCaseAction', () => {
  it('allows a new quarantine attempt after an earlier request completed', () => {
    expect(
      resolveDurableRequestForCaseAction('quarantine_compromised_account', {
        status: 'completed',
      })
    ).toBeNull();
  });

  it('keeps in-flight quarantine requests and completed terminal actions blocked', () => {
    const processing = { status: 'processing' };
    const completedVerify = { status: 'completed' };

    expect(resolveDurableRequestForCaseAction('quarantine_compromised_account', processing)).toBe(
      processing
    );
    expect(resolveDurableRequestForCaseAction('verify_user', completedVerify)).toBe(
      completedVerify
    );
  });
});
