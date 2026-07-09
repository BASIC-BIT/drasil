import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export async function queueMemberManualFlagActionRequest(input: {
  readonly actorId: string;
  readonly actorSurface: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly requestId: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'manual_flag_user',
    actorId: input.actorId,
    actorSurface: input.actorSurface,
    idempotencyKey: `web:member-manual-flag:${input.guildId}:${input.targetUserId}:${input.requestId}`,
    metadata: {
      reason: input.reason ?? null,
      requested_surface: input.actorSurface,
      web_action: 'manual_flag_user',
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}
