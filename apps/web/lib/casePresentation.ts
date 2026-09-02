import type {
  CaptchaChallengeGenerationHistory,
  CaptchaChallengeSummary,
  CaseAction,
  CasePresenceState,
  CaseSurfaceKind,
} from '@drasil/contracts';

const actionLabels: Record<CaseAction, string> = {
  ban_by_id: 'Ban by ID',
  ban_user: 'Ban User',
  close_no_action: 'Close No Action',
  create_thread: 'Create Thread',
  kick_user: 'Kick User',
  quarantine_compromised_account: 'Quarantine Compromised Account',
  repair_thread: 'Repair Thread',
  reopen_case: 'Reopen Case',
  refresh_notification: 'Refresh Notification',
  sync_existing_ban: 'Sync Existing Ban',
  verify_user: 'Verify User',
  view_history: 'View History',
  challenge_user: 'Challenge User',
  retry_captcha: 'Retry Security Check',
  bypass_captcha: 'Continue Without Browser Check',
};

const presenceLabels: Record<CasePresenceState, string> = {
  banned: 'Banned',
  in_server: 'Member On Server',
  kicked: 'Kicked',
  left_or_removed: 'Member Left Server',
  unknown: 'Member State Unknown',
};

const presenceStatusClasses: Record<CasePresenceState, string> = {
  banned: 'status error',
  in_server: 'status info',
  kicked: 'status warning',
  left_or_removed: 'status warning',
  unknown: 'status neutral',
};

const surfaceLabels: Record<CaseSurfaceKind, string> = {
  admin_evidence_thread: 'Open Evidence Thread',
  admin_notification: 'Open Admin Notice',
  report_intake_thread: 'Open Report Intake',
  source_message: 'Open Source Message',
  verification_thread: 'Open Verification Thread',
};

const acronymParts = new Set(['ai', 'gpt', 'id']);

export function formatCaseAction(action: CaseAction): string {
  return actionLabels[action];
}

export function isDebugCaseAction(action: CaseAction): boolean {
  return action === 'repair_thread' || action === 'create_thread';
}

export function formatPresenceState(state: CasePresenceState): string {
  return presenceLabels[state];
}

export function formatCaptchaStatus(status: CaptchaChallengeSummary['status']): string {
  switch (status) {
    case 'pending':
      return 'Awaiting security check';
    case 'passed':
      return 'Security check completed';
    case 'failed':
      return 'Security check failed';
    case 'expired':
      return 'Security check expired';
    case 'bypassed':
      return 'Security check bypassed';
    case 'cancelled':
      return 'Security check cancelled';
  }
}

export function formatCaptchaHistoryEntry(
  entry: CaptchaChallengeGenerationHistory,
  currentStatus?: CaptchaChallengeSummary['status']
): string {
  const source =
    entry.requestSource === 'automatic_suspicious_join'
      ? 'Automatic suspicious-join check'
      : entry.requestedBy
        ? `Moderator ${entry.requestedBy}`
        : 'Moderator';
  const outcome = (entry.outcome ?? currentStatus ?? 'no outcome recorded').replace(/_/g, ' ');
  const delivery = entry.deliveryErrorCode
    ? `delivery failed (${entry.deliveryErrorCode.replace(/_/g, ' ')})`
    : 'no delivery failure recorded';
  const presentation = entry.presentedAt
    ? `, moderator notice updated ${formatUtc(entry.presentedAt)}`
    : '';
  const bypass = entry.bypassReason ? `, bypass reason: ${entry.bypassReason}` : '';
  return `Generation ${entry.generation}: ${source}, requested ${formatUtc(entry.requestedAt)}, ${delivery}${presentation}, outcome ${outcome}${bypass}.`;
}

export function presenceStatusClass(state: CasePresenceState): string {
  return presenceStatusClasses[state];
}

export function freshnessStatusClass(stale: boolean): string {
  return stale ? 'status stale' : 'status fresh';
}

export function confidenceStatusClass(value: number | null): string {
  if (value === null) {
    return 'status neutral';
  }
  if (value >= 0.8) {
    return 'status confidence-high';
  }
  if (value >= 0.5) {
    return 'status confidence-medium';
  }
  return 'status confidence-low';
}

export function surfaceKindClass(kind: CaseSurfaceKind): string {
  switch (kind) {
    case 'admin_notification':
      return 'surface-link admin-surface';
    case 'admin_evidence_thread':
    case 'verification_thread':
    case 'report_intake_thread':
      return 'surface-link thread-surface';
    case 'source_message':
      return 'surface-link message-surface';
    default:
      return 'surface-link';
  }
}

export function moderationOutcomeStatusClass(value: string): string {
  switch (value) {
    case 'banned':
    case 'ban':
      return 'status error';
    case 'restricted':
    case 'kicked':
    case 'kick':
    case 'member_left':
      return 'status warning';
    case 'verified':
    case 'closed_no_action':
      return 'status ok';
    default:
      return 'status neutral';
  }
}

export function formatSurfaceKind(kind: CaseSurfaceKind): string {
  return surfaceLabels[kind];
}

export function formatDetectionType(value: string | null): string {
  if (!value) {
    return 'Unknown detection';
  }
  return value
    .split('_')
    .filter(Boolean)
    .map((part) =>
      acronymParts.has(part.toLowerCase())
        ? part.toUpperCase()
        : part[0]?.toUpperCase() + part.slice(1)
    )
    .join(' ');
}

export function formatUtc(value: string | null): string {
  if (!value) {
    return 'Unknown';
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return 'Unknown';
  }
  return `${new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
}

export function formatConfidence(value: number | null): string {
  if (value === null) {
    return 'No Signal';
  }
  if (value >= 0.8) {
    return 'High';
  }
  if (value >= 0.5) {
    return 'Medium';
  }
  return 'Low';
}
