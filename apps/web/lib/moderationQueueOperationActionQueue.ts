import { randomUUID } from 'node:crypto';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export type ModerationQueueOperationAction =
  | 'sync_moderation_queue'
  | 'clear_moderation_queue'
  | 'close_resolved_case_threads'
  | 'audit_case_role_lockdown'
  | 'apply_case_role_lockdown'
  | 'intake_role_members';

export interface QueueModerationQueueOperationInput {
  readonly action: ModerationQueueOperationAction;
  readonly actorId: string;
  readonly days?: number | null;
  readonly execute?: boolean;
  readonly guildId: string;
  readonly limit?: number | null;
  readonly reason?: string | null;
  readonly roleId?: string | null;
  readonly unsyncAllowedChannels?: boolean | null;
}

export async function queueModerationQueueOperation(
  input: QueueModerationQueueOperationInput
): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: input.action,
    actorId: input.actorId,
    actorSurface: 'web',
    idempotencyKey: `web:operation:${input.action}:${input.guildId}:${randomUUID()}`,
    metadata: {
      days: input.days ?? undefined,
      execute: input.execute ?? undefined,
      limit: input.limit ?? undefined,
      operation_action: input.action,
      reason: input.reason ?? undefined,
      requested_surface: 'web',
      role_id: input.roleId ?? undefined,
      unsync_allowed_channels: input.unsyncAllowedChannels ?? undefined,
    },
    serverId: input.guildId,
  });
}
