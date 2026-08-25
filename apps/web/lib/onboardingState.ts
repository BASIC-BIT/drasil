import type {
  DetectionResponseMode,
  SetupReadinessStatus,
  SetupServerRecord,
} from '@drasil/contracts';
import type {
  ModerationActionRequestSummary,
  SetupRequestInputSummary,
} from './moderationActionRequestDataAdapter';

export interface OnboardingWizardValues {
  readonly adminChannelId: string;
  readonly caseRoleId: string;
  readonly caseRoleName: string;
  readonly verificationChannelId: string;
  readonly reportInstructionsChannelId: string;
  readonly detectionResponseMode: DetectionResponseMode;
}

export interface OnboardingInitialState {
  readonly submissionId: string;
  readonly values: OnboardingWizardValues;
}

export interface OnboardingResourceOptions {
  readonly channelIds: readonly string[];
  readonly roleIds: readonly string[];
}

export function resolveOnboardingInitialStep(
  readiness: SetupReadinessStatus,
  durableRequest: ModerationActionRequestSummary | null,
  finalStep: number
): number {
  return readiness === 'ready' || durableRequest ? finalStep : 0;
}

export function onboardingWizardStateKey(
  durableRequest: ModerationActionRequestSummary | null
): string {
  return durableRequest?.status === 'completed' || durableRequest?.status === 'failed'
    ? `${durableRequest.id}:${durableRequest.status}`
    : 'onboarding-active';
}

export function resolveOnboardingDurableRequest(
  latestRequest: ModerationActionRequestSummary | null,
  readiness: SetupReadinessStatus,
  trackedRequestId: string | null
): ModerationActionRequestSummary | null {
  if (!latestRequest) {
    return null;
  }
  if (latestRequest.status === 'completed' && readiness !== 'ready') {
    return null;
  }
  if (latestRequest.status === 'completed' && readiness === 'ready' && !trackedRequestId) {
    return null;
  }
  return latestRequest;
}

function valueOr<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

function persistedValues(server: SetupServerRecord | null): OnboardingWizardValues {
  if (!server) {
    return {
      adminChannelId: '',
      caseRoleId: '__create__',
      caseRoleName: 'Drasil Case',
      verificationChannelId: '__auto__',
      reportInstructionsChannelId: '__none__',
      detectionResponseMode: 'notify_only',
    };
  }

  return {
    adminChannelId: valueOr(server.admin_channel_id, ''),
    caseRoleId: valueOr(server.case_role_id, '__create__'),
    caseRoleName: 'Drasil Case',
    verificationChannelId: valueOr(server.verification_channel_id, '__auto__'),
    reportInstructionsChannelId: valueOr(
      server.settings.report_instructions_channel_id,
      '__none__'
    ),
    detectionResponseMode: valueOr(server.settings.detection_response_mode, 'notify_only'),
  };
}

function resumedValues(
  input: SetupRequestInputSummary,
  persisted: OnboardingWizardValues
): OnboardingWizardValues {
  return {
    adminChannelId: valueOr(input.adminChannelId, persisted.adminChannelId),
    caseRoleId: valueOr(input.caseRoleId, '__create__'),
    caseRoleName: valueOr(input.caseRoleName, 'Drasil Case'),
    verificationChannelId: valueOr(input.verificationChannelId, '__auto__'),
    reportInstructionsChannelId: valueOr(input.reportInstructionsChannelId, '__none__'),
    detectionResponseMode: valueOr(input.detectionResponseMode, persisted.detectionResponseMode),
  };
}

function normalizeResourceSelections(
  values: OnboardingWizardValues,
  options: OnboardingResourceOptions
): OnboardingWizardValues {
  const channelIds = new Set(options.channelIds);
  const roleIds = new Set(options.roleIds);

  return {
    ...values,
    adminChannelId: channelIds.has(values.adminChannelId) ? values.adminChannelId : '',
    caseRoleId:
      values.caseRoleId === '__create__' || roleIds.has(values.caseRoleId)
        ? values.caseRoleId
        : '__create__',
    verificationChannelId:
      values.verificationChannelId === '__auto__' || channelIds.has(values.verificationChannelId)
        ? values.verificationChannelId
        : '__auto__',
    reportInstructionsChannelId:
      values.reportInstructionsChannelId === '__none__' ||
      channelIds.has(values.reportInstructionsChannelId)
        ? values.reportInstructionsChannelId
        : '__none__',
  };
}

export function resolveOnboardingInitialState(
  server: SetupServerRecord | null,
  durableRequest: ModerationActionRequestSummary | null,
  fallbackSubmissionId: string,
  options: OnboardingResourceOptions
): OnboardingInitialState {
  const input =
    durableRequest && durableRequest.status !== 'completed' ? durableRequest.setupInput : null;
  const persisted = persistedValues(server);

  return {
    submissionId: valueOr(input?.submissionId, durableRequest?.id ?? fallbackSubmissionId),
    values: normalizeResourceSelections(
      input ? resumedValues(input, persisted) : persisted,
      options
    ),
  };
}
