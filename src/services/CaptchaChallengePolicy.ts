import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
  CaseKind,
  DetectionType,
  VerificationStatus,
} from '../repositories/types';
import type { CaptchaMode, CaptchaPassAction } from '../utils/captchaSettings';

export interface CaptchaRequestPolicyInput {
  mode: CaptchaMode;
  requestSource: CaptchaChallengeRequestSource;
  caseKind: CaseKind;
  caseStatus: VerificationStatus;
  caseWasCreatedBySuspiciousJoin: boolean;
}

export interface CaptchaAutoResolutionPolicyInput {
  currentMode: CaptchaMode;
  requestSource: CaptchaChallengeRequestSource;
  issuedPassEffect: CaptchaChallengePassEffect;
  currentPassAction: CaptchaPassAction;
  caseKind: CaseKind;
  caseStatus: VerificationStatus;
  caseRevision: number;
  issuedCaseRevision: number;
  linkedDetectionTypes: readonly DetectionType[];
  otherPendingCaseCount: number;
}

export type CaptchaAutoResolutionHoldReason =
  | 'case_changed'
  | 'policy_changed'
  | 'non_join_evidence'
  | 'no_join_evidence'
  | 'other_pending_case';

export type CaptchaAutoResolutionDecision =
  | { status: 'evidence_only' }
  | { status: 'eligible' }
  | { status: 'held'; reason: CaptchaAutoResolutionHoldReason };

const SUSPICIOUS_JOIN_DETECTION_TYPES = new Set<DetectionType>([
  DetectionType.NEW_ACCOUNT,
  DetectionType.REJOIN_AFTER_KICK,
]);

export function canRequestCaptcha(input: CaptchaRequestPolicyInput): boolean {
  if (
    input.mode === 'off' ||
    input.caseKind !== CaseKind.STANDARD ||
    input.caseStatus !== VerificationStatus.PENDING
  ) {
    return false;
  }

  if (input.requestSource === CaptchaChallengeRequestSource.MODERATOR) {
    return true;
  }

  return input.mode === 'suspicious_join' && input.caseWasCreatedBySuspiciousJoin;
}

export function selectCaptchaPassEffect(
  requestSource: CaptchaChallengeRequestSource,
  passAction: CaptchaPassAction
): CaptchaChallengePassEffect {
  return requestSource === CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN &&
    passAction === 'verify_join_only'
    ? CaptchaChallengePassEffect.VERIFY_JOIN_ONLY
    : CaptchaChallengePassEffect.EVIDENCE_ONLY;
}

export function canAutomaticallyResolveCaptchaCase(
  input: CaptchaAutoResolutionPolicyInput
): boolean {
  return evaluateCaptchaAutoResolution(input).status === 'eligible';
}

export function evaluateCaptchaAutoResolution(
  input: CaptchaAutoResolutionPolicyInput
): CaptchaAutoResolutionDecision {
  if (
    input.requestSource !== CaptchaChallengeRequestSource.AUTOMATIC_SUSPICIOUS_JOIN ||
    input.issuedPassEffect !== CaptchaChallengePassEffect.VERIFY_JOIN_ONLY
  ) {
    return { status: 'evidence_only' };
  }
  if (input.currentMode !== 'suspicious_join' || input.currentPassAction !== 'verify_join_only') {
    return { status: 'held', reason: 'policy_changed' };
  }
  if (
    input.caseKind !== CaseKind.STANDARD ||
    input.caseStatus !== VerificationStatus.PENDING ||
    input.caseRevision !== input.issuedCaseRevision
  ) {
    return { status: 'held', reason: 'case_changed' };
  }
  if (input.otherPendingCaseCount > 0) {
    return { status: 'held', reason: 'other_pending_case' };
  }
  if (input.linkedDetectionTypes.length === 0) {
    return { status: 'held', reason: 'no_join_evidence' };
  }
  if (!input.linkedDetectionTypes.every((type) => SUSPICIOUS_JOIN_DETECTION_TYPES.has(type))) {
    return { status: 'held', reason: 'non_join_evidence' };
  }
  return { status: 'eligible' };
}
