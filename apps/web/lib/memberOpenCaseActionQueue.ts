import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export async function queueMemberOpenCaseActionRequest(input: {
  readonly actorId: string;
  readonly actorSurface: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly requestId: string;
  readonly sourceChannelId?: string | null;
  readonly sourceDetectionEventId?: string | null;
  readonly sourceMessageId?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'open_admin_case',
    actorId: input.actorId,
    actorSurface: input.actorSurface,
    detectionEventId: input.sourceDetectionEventId ?? null,
    idempotencyKey: `web:member-open-case:${input.guildId}:${input.targetUserId}:${input.requestId}`,
    metadata: {
      reason: input.reason ?? null,
      requested_surface: input.actorSurface,
      ...(input.sourceChannelId && input.sourceMessageId
        ? {
            source: 'message_context_case',
            source_channel_id: input.sourceChannelId,
            source_message_id: input.sourceMessageId,
          }
        : {}),
      web_action: 'open_admin_case',
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}
