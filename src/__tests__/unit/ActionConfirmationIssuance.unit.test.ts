import { mock, mockDeep } from 'jest-mock-extended';
import { encodeQueuedAction, type QueuedCommand } from '@drasil/application';
import type { BotApplication } from '../../application/createBotApplication';
import {
  ModerationActionRequestType,
  type ModerationActionRequest,
} from '../../repositories/types';
import type { IProductAnalyticsService } from '../../services/ProductAnalyticsService';
import { prepareQueuedRequest } from '../../application/requestRuntime';

it.each([
  { kind: 'sync_moderation_queue' },
  { kind: 'audit_case_role_lockdown' },
  {
    kind: 'close_resolved_case_threads',
    intent: 'administrator_operation',
    execute: false,
    days: 7,
    limit: 50,
    userId: null,
  },
  { kind: 'intake_role_members', roleId: 'role', reason: null, execute: false, limit: 50 },
  {
    kind: 'repair_active_case',
    intent: 'moderator_repair',
    mode: 'repair_thread',
    caseId: 'case',
    targetUserId: 'target',
  },
  { kind: 'refresh_case_notification', caseId: 'case', targetUserId: 'target' },
] satisfies QueuedCommand[])('does not issue unused confirmation for $kind', async (command) => {
  const app = mockDeep<BotApplication>();
  const encoded = encodeQueuedAction(
    {
      guildId: 'guild',
      requestId: 'submission',
      source: 'web',
      actor: { kind: 'user', userId: 'actor' },
    },
    command
  );
  const request = mock<ModerationActionRequest>({
    id: 'request',
    server_id: encoded.serverId,
    action_type: requestType(encoded.actionType),
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    target_user_id: encoded.targetUserId,
    detection_event_id: null,
    report_intake_id: null,
    message_deletion_job_id: null,
    verification_event_id: encoded.verificationEventId ?? null,
    metadata: encoded.metadata,
  });
  await prepareQueuedRequest({
    runtime: app,
    request,
    analytics: mock<IProductAnalyticsService>(),
  });
  expect(app.caseConfirmations.recordVerified).not.toHaveBeenCalled();
});

it('retains evidence for a destructive operation', async () => {
  const app = mockDeep<BotApplication>();
  const request = mock<ModerationActionRequest>({
    id: 'request',
    server_id: 'guild',
    action_type: ModerationActionRequestType.CLEAR_MODERATION_QUEUE,
    actor_id: 'actor',
    actor_surface: 'web',
    target_user_id: null,
    detection_event_id: null,
    report_intake_id: null,
    message_deletion_job_id: null,
    verification_event_id: null,
    metadata: {},
  });
  await prepareQueuedRequest({
    runtime: app,
    request,
    analytics: mock<IProductAnalyticsService>(),
  });
  expect(app.caseConfirmations.recordVerified).toHaveBeenCalledTimes(1);
});

function requestType(kind: string): ModerationActionRequestType {
  const value = Object.values(ModerationActionRequestType).find((type) => type === kind);
  if (!value) throw new Error(`Unknown request type: ${kind}`);
  return value;
}
