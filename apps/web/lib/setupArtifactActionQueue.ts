import { encodeQueuedAction, queuedSetupCommandSchema } from '@drasil/application';
import { randomUUID } from 'node:crypto';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  queueSerializedModerationActionRequestWithReceipt,
  type ModerationActionRequestReceipt,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export async function queueReportInstructionsRepairRequest(input: {
  readonly actorId: string;
  readonly channelId: string;
  readonly guildId: string;
  readonly repost?: boolean;
  readonly expectedMessageId?: string | null;
  readonly expectedChannelId?: string | null;
  readonly submissionId?: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  const requestId = input.submissionId ?? randomUUID();
  const context = {
    guildId: input.guildId,
    requestId,
    source: 'web',
    actor: { kind: 'user' as const, userId: input.actorId },
  };
  return queueModerationActionRequest(
    encodeQueuedAction(
      context,
      queuedSetupCommandSchema.parse({
        kind: 'upsert_report_instructions',
        channelId: input.channelId,
        repost: input.repost === true,
        ...(input.repost
          ? {
              expectedMessageId: input.expectedMessageId ?? null,
              expectedChannelId: input.expectedChannelId ?? null,
              submissionId: requestId,
            }
          : {}),
      })
    )
  );
}

export async function queueCompleteSetupVerificationRequest(input: {
  readonly actorId: string;
  readonly adminChannelId: string;
  readonly caseRoleId?: string | null;
  readonly caseRoleName?: string | null;
  readonly detectionResponseMode?: 'off' | 'record_only' | 'notify_only' | 'restrict';
  readonly guildId: string;
  readonly reportInstructionsChannelId?: string | null;
  readonly verificationChannelId?: string | null;
  readonly submissionId?: string;
  readonly onboardingWizard?: boolean;
}): Promise<ModerationActionRequestQueueStatus> {
  return (await queueCompleteSetupVerificationRequestWithReceipt(input)).status;
}

export async function queueCompleteSetupVerificationRequestWithReceipt(input: {
  readonly actorId: string;
  readonly adminChannelId: string;
  readonly caseRoleId?: string | null;
  readonly caseRoleName?: string | null;
  readonly detectionResponseMode?: 'off' | 'record_only' | 'notify_only' | 'restrict';
  readonly guildId: string;
  readonly reportInstructionsChannelId?: string | null;
  readonly verificationChannelId?: string | null;
  readonly submissionId?: string;
  readonly onboardingWizard?: boolean;
}): Promise<ModerationActionRequestReceipt> {
  if (isWebE2eFixtureMode()) {
    return { id: input.submissionId ?? 'fixture-setup-request', status: 'queued' };
  }

  const requestId = input.submissionId ?? randomUUID();
  const context = {
    guildId: input.guildId,
    requestId,
    source: 'web',
    actor: { kind: 'user' as const, userId: input.actorId },
  };
  return queueSerializedModerationActionRequestWithReceipt(
    encodeQueuedAction(
      context,
      queuedSetupCommandSchema.parse({
        kind: 'complete_setup_verification',
        mode: 'provision',
        adminChannelId: input.adminChannelId,
        caseRoleId: input.caseRoleId,
        caseRoleName: input.caseRoleName,
        detectionResponseMode: input.detectionResponseMode,
        reportInstructionsChannelId: input.reportInstructionsChannelId,
        verificationChannelId: input.verificationChannelId,
        submissionId: input.submissionId,
        onboardingWizard: input.onboardingWizard === true,
      })
    )
  );
}
