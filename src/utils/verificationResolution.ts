import { AdminActionType, ModerationOutcomeType, VerificationStatus } from '../repositories/types';

export type ResolvedVerificationStatus =
  | VerificationStatus.VERIFIED
  | VerificationStatus.BANNED
  | VerificationStatus.KICKED
  | VerificationStatus.CLOSED_NO_ACTION;

export function isResolvedVerificationStatus(
  status: VerificationStatus
): status is ResolvedVerificationStatus {
  return (
    status === VerificationStatus.VERIFIED ||
    status === VerificationStatus.BANNED ||
    status === VerificationStatus.KICKED ||
    status === VerificationStatus.CLOSED_NO_ACTION
  );
}

export function getResolutionAdminActionType(status: ResolvedVerificationStatus): AdminActionType {
  switch (status) {
    case VerificationStatus.VERIFIED:
      return AdminActionType.VERIFY;
    case VerificationStatus.BANNED:
      return AdminActionType.BAN;
    case VerificationStatus.KICKED:
      return AdminActionType.KICK;
    case VerificationStatus.CLOSED_NO_ACTION:
      return AdminActionType.CLOSE_NO_ACTION;
  }
}

export function getResolutionModerationOutcomeType(
  status: ResolvedVerificationStatus
): ModerationOutcomeType {
  switch (status) {
    case VerificationStatus.VERIFIED:
      return ModerationOutcomeType.VERIFIED;
    case VerificationStatus.BANNED:
      return ModerationOutcomeType.BANNED;
    case VerificationStatus.KICKED:
      return ModerationOutcomeType.KICKED;
    case VerificationStatus.CLOSED_NO_ACTION:
      return ModerationOutcomeType.CLOSED_NO_ACTION;
  }
}
