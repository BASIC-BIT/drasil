import type { SetupServerRecord, DetectionResponseMode } from './settings';
import type { SetupCommand } from './commands';
export interface SetupCandidate {
  readonly id: string;
  readonly name: string;
}
export type CandidateSelection =
  | { readonly kind: 'reuse'; readonly id: string; readonly name: string }
  | { readonly kind: 'create'; readonly name: string }
  | { readonly kind: 'ambiguous'; readonly ids: readonly string[] }
  | { readonly kind: 'invalid' };
export function selectSetupCandidate(input: {
  explicitId?: string | null;
  configuredId?: string | null;
  requestedName?: string | null;
  defaultName: string;
  candidates: readonly SetupCandidate[];
}): CandidateSelection {
  if (input.explicitId) {
    const candidate = input.candidates.find((c) => c.id === input.explicitId);
    return candidate
      ? { kind: 'reuse', id: candidate.id, name: candidate.name }
      : { kind: 'invalid' };
  }
  const name = input.requestedName ?? input.defaultName;
  const configured = input.candidates.find((c) => c.id === input.configuredId);
  if (configured && (!input.requestedName || configured.name === name))
    return { kind: 'reuse', id: configured.id, name: configured.name };
  const matches = input.candidates.filter((c) => c.name === name);
  return matches.length === 1
    ? { kind: 'reuse', id: matches[0].id, name: matches[0].name }
    : matches.length
      ? { kind: 'ambiguous', ids: matches.map((c) => c.id).sort() }
      : { kind: 'create', name };
}
export function setupProvisioningDetectionMode(
  state: {
    readonly case_role_id: string | null;
    readonly admin_channel_id: string | null;
    readonly verification_channel_id: string | null;
    readonly settings: {
      readonly detection_response_mode?: string;
      readonly message_detection_response_mode?: string | null;
      readonly join_detection_response_mode?: string | null;
    };
  },
  requested?: DetectionResponseMode
): DetectionResponseMode | undefined {
  if (requested) return requested;
  const incomplete =
    !state.case_role_id || !state.admin_channel_id || !state.verification_channel_id;
  return incomplete &&
    state.settings.message_detection_response_mode == null &&
    state.settings.join_detection_response_mode == null &&
    (state.settings.detection_response_mode === undefined ||
      state.settings.detection_response_mode === 'restrict')
    ? 'notify_only'
    : undefined;
}
export interface SetupSelectionResources {
  readonly roles: readonly SetupCandidate[];
  readonly channels: readonly (SetupCandidate & { readonly type: number })[];
}
export interface SetupProvisioningSelection {
  readonly role: CandidateSelection;
  readonly verification: CandidateSelection;
  readonly detectionResponseMode: DetectionResponseMode | null;
}
export function selectSetupProvisioning(
  state: SetupServerRecord,
  command: Extract<SetupCommand, { kind: 'complete_setup_verification' }>,
  resources: SetupSelectionResources
): SetupProvisioningSelection {
  return {
    role: selectSetupCandidate({
      explicitId: command.caseRoleId,
      configuredId: command.mode === 'provision' ? state.case_role_id : null,
      requestedName: command.caseRoleName,
      defaultName: 'Drasil Case',
      candidates: resources.roles,
    }),
    verification: selectSetupCandidate({
      explicitId: command.verificationChannelId,
      configuredId: command.mode === 'provision' ? state.verification_channel_id : null,
      defaultName: 'verification',
      candidates: resources.channels
        .filter((channel) => channel.type === 0)
        .map(({ id, name }) => ({ id, name })),
    }),
    detectionResponseMode:
      command.mode === 'provision'
        ? (setupProvisioningDetectionMode(state, command.detectionResponseMode) ?? null)
        : null,
  };
}
