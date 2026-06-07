import type { CaseAction, CasePresenceState, CaseSurfaceKind } from '@drasil/contracts';

const actionLabels: Record<CaseAction, string> = {
  ban_by_id: 'Ban by ID',
  ban_user: 'Ban user',
  close_no_action: 'Close no action',
  create_thread: 'Create thread',
  repair_thread: 'Repair thread',
  sync_existing_ban: 'Sync existing ban',
  verify_user: 'Verify user',
  view_history: 'View history',
};

const presenceLabels: Record<CasePresenceState, string> = {
  banned: 'Banned',
  in_server: 'In server',
  left_or_removed: 'Left or removed',
  unknown: 'Unknown',
};

const presenceStatusClasses: Record<CasePresenceState, string> = {
  banned: 'status error',
  in_server: 'status ok',
  left_or_removed: 'status warning',
  unknown: 'status warning',
};

const surfaceLabels: Record<CaseSurfaceKind, string> = {
  admin_evidence_thread: 'Admin evidence',
  admin_notification: 'Admin notification',
  report_intake_thread: 'Report intake',
  source_message: 'Source message',
  verification_thread: 'Verification thread',
};

const acronymParts = new Set(['ai', 'gpt', 'id']);

export function formatCaseAction(action: CaseAction): string {
  return actionLabels[action];
}

export function formatPresenceState(state: CasePresenceState): string {
  return presenceLabels[state];
}

export function presenceStatusClass(state: CasePresenceState): string {
  return presenceStatusClasses[state];
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
    return 'No score';
  }
  return `${Math.round(value * 100)}%`;
}
