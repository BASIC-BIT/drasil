import type { SetupProvisioningOutcome } from './ports';

export type SetupFailureCode = Exclude<SetupProvisioningOutcome['status'], 'completed'>;
/** Only the first four variants establish that the workflow stopped before effects.
 * Later failures can include attempted permission changes and incomplete rollback. */
export const setupFailureDefinitions = {
  ambiguous_case_role: { state: 'denied', detail: 'Select one existing case role by ID.' },
  ambiguous_verification_channel: {
    state: 'denied',
    detail: 'Select one existing verification channel by ID.',
  },
  invalid_selection: {
    state: 'denied',
    detail: 'Select available, separate setup roles and channels in this server.',
  },
  candidate_validation_failed: {
    state: 'failed',
    detail: 'Correct the selected resources or required bot permissions before retrying setup.',
  },
  verification_channel_failed: {
    state: 'uncertain',
    detail:
      'Verification channel setup failed after changes may have begun. Inspect channel permissions before retrying.',
  },
  final_validation_failed: {
    state: 'uncertain',
    detail:
      'Final validation failed after setup changes may have begun. Inspect resources and permissions before retrying.',
  },
  config_save_failed: {
    state: 'uncertain',
    detail:
      'Setup configuration could not be saved. Inspect resources and permissions before retrying.',
  },
} as const satisfies Record<
  SetupFailureCode,
  { state: 'denied' | 'failed' | 'uncertain'; detail: string }
>;

/** Stable candidate error codes only; diagnostic messages may contain private resource data. */
export const setupPublicDiagnosticCodes: ReadonlySet<string> = new Set([
  'bot-member-missing',
  'guild-manage-roles',
  'case-role-missing',
  'case-role-not-found',
  'case-role-everyone',
  'case-role-managed',
  'case-role-permissions',
  'case-role-channel-overwrites',
  'case-role-hierarchy',
  'admin-channel-missing',
  'admin-channel-not-found',
  'admin-channel-view',
  'admin-channel-send',
  'admin-channel-embed-links',
  'verification-channel-missing',
  'verification-channel-not-found',
  'verification-channel-view',
  'verification-channel-send',
  'verification-channel-embed-links',
  'verification-channel-read-message-history',
  'verification-channel-create-private-threads',
  'verification-channel-send-messages-in-threads',
  'verification-channel-sync-manage-channels',
  'verification-channel-create-manage-channels',
  'report-instructions-channel-public-view',
]);
