import { decodeQueuedAction } from './decode';
import { encodeQueuedAction } from './encode';
import {
  messageCleanupCommandSchema,
  type MessageCleanupCommand,
} from '../messageCleanup/commands';
const context = {
  guildId: 'guild',
  requestId: 'submission_token',
  source: 'web_case',
  actor: { kind: 'user', userId: 'admin' },
} as const;
const command: MessageCleanupCommand = {
  kind: 'execute_case_message_deletion',
  caseId: 'case',
  targetUserId: 'target',
  jobId: 'job',
  mode: 'delete_only',
  scope: 'last_day',
  reason: 'raw reason',
  detectionEventId: 'detection',
  previewReference: { jobId: 'job', generation: '2026-10-20T00:00:00.000Z' },
};
it('round trips frozen cleanup commands and preserves shipped idempotency keys', () => {
  const encoded = encodeQueuedAction(context, command);
  expect(encoded.idempotencyKey).toBe(
    'message-cleanup:execute_case_message_deletion:guild:case:admin:submission_token'
  );
  const decoded = decodeQueuedAction({
    id: 'request',
    server_id: encoded.serverId,
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    action_type: encoded.actionType,
    target_user_id: encoded.targetUserId,
    verification_event_id: encoded.verificationEventId,
    message_deletion_job_id: encoded.messageDeletionJobId,
    detection_event_id: encoded.detectionEventId,
    metadata: encoded.metadata,
  });
  expect(decoded.command).toEqual(command);
});
it.each(['source', 'actor', 'preview', 'report_ban_attempt_token', 'leaseToken'])(
  'rejects external %s authority or runtime state',
  (field) => {
    expect(messageCleanupCommandSchema.safeParse({ ...command, [field]: 'injected' }).success).toBe(
      false
    );
  }
);
it('keeps the raw blank reason for execution-time validation', () => {
  expect(encodeQueuedAction(context, { ...command, reason: '  ' }).metadata.reason).toBe('  ');
});
