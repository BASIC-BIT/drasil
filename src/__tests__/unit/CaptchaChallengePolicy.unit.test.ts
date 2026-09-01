import {
  canAutomaticallyResolveCaptchaCase,
  canRequestCaptcha,
  selectCaptchaPassEffect,
} from '../../services/CaptchaChallengePolicy';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaseKind,
  DetectionType,
  VerificationStatus,
} from '../../repositories/types';

describe('CaptchaChallengePolicy', () => {
  it('allows moderator challenges for pending standard cases in manual mode', () => {
    expect(
      canRequestCaptcha({
        mode: 'manual',
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        caseKind: CaseKind.STANDARD,
        caseStatus: VerificationStatus.PENDING,
        caseWasCreatedBySuspiciousJoin: false,
      })
    ).toBe(true);
  });

  it.each([
    ['off mode', 'off' as const, CaseKind.STANDARD, VerificationStatus.PENDING],
    [
      'compromised-account case',
      'manual' as const,
      CaseKind.COMPROMISED_ACCOUNT,
      VerificationStatus.PENDING,
    ],
    ['resolved case', 'manual' as const, CaseKind.STANDARD, VerificationStatus.VERIFIED],
  ])('rejects moderator challenges for %s', (_label, mode, caseKind, caseStatus) => {
    expect(
      canRequestCaptcha({
        mode,
        requestSource: CaptchaChallengeRequestSource.MODERATOR,
        caseKind,
        caseStatus,
        caseWasCreatedBySuspiciousJoin: false,
      })
    ).toBe(false);
  });

  it('requires automatic mode and creation by a suspicious join', () => {
    const base = {
      requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
      caseKind: CaseKind.STANDARD,
      caseStatus: VerificationStatus.PENDING,
    };

    expect(
      canRequestCaptcha({
        ...base,
        mode: 'suspicious_join',
        caseWasCreatedBySuspiciousJoin: true,
      })
    ).toBe(true);
    expect(
      canRequestCaptcha({
        ...base,
        mode: 'suspicious_join',
        caseWasCreatedBySuspiciousJoin: false,
      })
    ).toBe(false);
    expect(
      canRequestCaptcha({ ...base, mode: 'manual', caseWasCreatedBySuspiciousJoin: true })
    ).toBe(false);
  });

  it('always makes moderator-requested passes evidence only', () => {
    expect(
      selectCaptchaPassEffect(CaptchaChallengeRequestSource.MODERATOR, 'verify_join_only')
    ).toBe(CaptchaChallengePassEffect.EVIDENCE_ONLY);
  });

  it('allows automatic resolution only for an unchanged join-only case', () => {
    expect(
      canAutomaticallyResolveCaptchaCase({
        currentMode: 'suspicious_join',
        requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
        issuedPassEffect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
        currentPassAction: 'verify_join_only',
        caseKind: CaseKind.STANDARD,
        caseStatus: VerificationStatus.PENDING,
        caseRevision: 0,
        issuedCaseRevision: 0,
        linkedDetectionTypes: [DetectionType.NEW_ACCOUNT],
        otherPendingCaseCount: 0,
      })
    ).toBe(true);
  });

  it.each([
    ['manual request', { requestSource: CaptchaChallengeRequestSource.MODERATOR }],
    ['evidence-only issue', { issuedPassEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY }],
    ['disabled mode', { currentMode: 'off' as const }],
    ['policy narrowed', { currentPassAction: 'evidence_only' as const }],
    ['revision changed', { caseRevision: 2 }],
    ['message evidence', { linkedDetectionTypes: [DetectionType.SUSPICIOUS_CONTENT] }],
    ['another pending case', { otherPendingCaseCount: 1 }],
  ])('holds automatic resolution for %s', (_label, override) => {
    expect(
      canAutomaticallyResolveCaptchaCase({
        currentMode: 'suspicious_join',
        requestSource: CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN,
        issuedPassEffect: CaptchaChallengePassEffect.VERIFY_JOIN_ONLY,
        currentPassAction: 'verify_join_only',
        caseKind: CaseKind.STANDARD,
        caseStatus: VerificationStatus.PENDING,
        caseRevision: 1,
        issuedCaseRevision: 1,
        linkedDetectionTypes: [DetectionType.NEW_ACCOUNT],
        otherPendingCaseCount: 0,
        ...override,
      })
    ).toBe(false);
  });
});
