import { encodeQueuedAction } from '@drasil/application';
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

  return queueModerationActionRequest(
    encodeQueuedAction(
      {
        guildId: input.guildId,
        requestId: input.requestId,
        source: input.actorSurface,
        actor: { kind: 'user', userId: input.actorId },
      },
      {
        kind: 'open_admin_case',
        intent: 'dashboard_case_open',
        targetUserId: input.targetUserId,
        reason: input.reason ?? null,
        detectionEventId: input.sourceDetectionEventId ?? null,
        selectedMessage:
          input.sourceChannelId && input.sourceMessageId
            ? { channelId: input.sourceChannelId, messageId: input.sourceMessageId }
            : null,
      }
    )
  );
}
