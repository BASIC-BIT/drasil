import { randomUUID } from 'node:crypto';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';
import { getPostgresPool } from './setupDataAdapter';

async function ensureReportTargetUser(input: {
  readonly actorId: string;
  readonly targetUserId: string;
}): Promise<void> {
  await getPostgresPool().query(
    `insert into users (discord_id, created_by, updated_by, metadata)
     values ($1, $2, $2, $3::jsonb)
     on conflict (discord_id) do nothing`,
    [
      input.targetUserId,
      input.actorId,
      JSON.stringify({
        source: 'web_report',
      }),
    ]
  );
}

export async function queueUserReportSubmissionRequest(input: {
  readonly actorId: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly targetLabel: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  await ensureReportTargetUser({
    actorId: input.actorId,
    targetUserId: input.targetUserId,
  });

  return queueModerationActionRequest({
    actionType: 'submit_user_report',
    actorId: input.actorId,
    actorSurface: 'web_report',
    idempotencyKey: `web:report:submit_user_report:${input.guildId}:${input.targetUserId}:${randomUUID()}`,
    metadata: {
      reason: input.reason ?? null,
      report_action: 'submit_user_report',
      requested_surface: 'web_report',
      target_label: input.targetLabel,
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}

export async function queueGuidedReportIntakeRequest(input: {
  readonly actorId: string;
  readonly channelId: string;
  readonly guildId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'start_report_intake',
    actorId: input.actorId,
    actorSurface: 'web_report',
    idempotencyKey: `web:report:start_report_intake:${input.guildId}:${input.actorId}:${randomUUID()}`,
    metadata: {
      channel_id: input.channelId,
      report_action: 'start_report_intake',
      requested_surface: 'web_report',
    },
    serverId: input.guildId,
  });
}

export async function queueReportIntakeCloseRequest(input: {
  readonly actorId: string;
  readonly guildId: string;
  readonly reportIntakeId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'close_report_intake',
    actorId: input.actorId,
    actorSurface: 'web_report',
    idempotencyKey: `web:report:close_report_intake:${input.guildId}:${input.reportIntakeId}:${randomUUID()}`,
    metadata: {
      report_action: 'close_report_intake',
      requested_surface: 'web_report',
    },
    reportIntakeId: input.reportIntakeId,
    serverId: input.guildId,
  });
}
