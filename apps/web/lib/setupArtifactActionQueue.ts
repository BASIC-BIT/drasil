import { randomUUID } from 'node:crypto';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export async function queueReportInstructionsRepairRequest(input: {
  readonly actorId: string;
  readonly channelId: string;
  readonly guildId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'upsert_report_instructions',
    actorId: input.actorId,
    actorSurface: 'web',
    idempotencyKey: `web:setup:upsert_report_instructions:${input.guildId}:${randomUUID()}`,
    metadata: {
      channel_id: input.channelId,
      requested_surface: 'web',
      setup_action: 'upsert_report_instructions',
    },
    serverId: input.guildId,
  });
}

export async function queueCompleteSetupVerificationRequest(input: {
  readonly actorId: string;
  readonly adminChannelId: string;
  readonly caseRoleId: string;
  readonly guildId: string;
  readonly reportInstructionsChannelId?: string | null;
  readonly verificationChannelId?: string | null;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'complete_setup_verification',
    actorId: input.actorId,
    actorSurface: 'web',
    idempotencyKey: `web:setup:complete_setup_verification:${input.guildId}:${randomUUID()}`,
    metadata: {
      admin_channel_id: input.adminChannelId,
      case_role_id: input.caseRoleId,
      report_instructions_channel_id: input.reportInstructionsChannelId ?? undefined,
      requested_surface: 'web',
      setup_action: 'complete_setup_verification',
      verification_channel_id: input.verificationChannelId ?? undefined,
    },
    serverId: input.guildId,
  });
}
