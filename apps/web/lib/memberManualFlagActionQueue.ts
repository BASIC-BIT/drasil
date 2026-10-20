import { encodeQueuedAction } from '@drasil/application';
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

  return queueModerationActionRequest(
    encodeQueuedAction(
      {
        guildId: input.guildId,
        requestId: input.requestId,
        source: input.actorSurface,
        actor: { kind: 'user', userId: input.actorId },
      },
      { kind: 'manual_flag_user', targetUserId: input.targetUserId, reason: input.reason ?? null }
    )
  );
}
