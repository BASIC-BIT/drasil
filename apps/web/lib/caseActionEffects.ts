export const caseMaintenanceActions = [
  'refresh_notification',
  'repair_thread',
  'create_thread',
  'reopen_case',
  'sync_existing_ban',
] as const;

/** Effects are member-wide in UserModerationService, even from one selected case. */
export function verificationEffect(compromisedAccount: boolean): string {
  return `${compromisedAccount ? 'Confirm account recovery, release quarantine, and verify' : 'Verify'} all pending cases for this member in this server, remove applicable case-role restrictions, and restore eligible snapshotted roles under current role policy.`;
}

export const closeCaseEffect =
  'Close all pending cases for this member in this server without recording an enforcement decision, remove the active case-role restriction when applicable, and restore eligible snapshotted roles under current role policy. Close cannot release active compromised-account quarantine.';
