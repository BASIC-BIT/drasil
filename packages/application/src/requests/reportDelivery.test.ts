import { decodeQueuedAction } from './decode';
import { encodeQueuedAction } from './encode';
import { queuedCommandSchema } from './commands';

const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'mcp',
  actor: { kind: 'user' as const, userId: 'reporter' },
};
it.each([
  {
    kind: 'submit_message_report',
    targetUserId: 'target',
    channelId: 'channel',
    messageId: 'message',
    reason: ' evidence ',
  },
  {
    kind: 'confirm_intake_candidate',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'prompt',
    targetUserId: 'target',
  },
  {
    kind: 'reject_intake_candidates',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'prompt',
    promptToken: 'private-token',
  },
  { kind: 'prepare_report_ban_review', operationId: 'operation' },
  {
    kind: 'review_uncertain_report_ban',
    operationId: 'operation',
    targetUserId: 'target',
    reviewReference: 'reference',
    reason: ' no current ban ',
  },
])('round trips delegated $kind without losing exact bindings', (input) => {
  const command = queuedCommandSchema.parse(input);
  const encoded = encodeQueuedAction(context, command);
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: encoded.serverId,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      action_type: encoded.actionType,
      target_user_id: encoded.targetUserId ?? null,
      report_intake_id: encoded.reportIntakeId,
      detection_event_id: encoded.detectionEventId,
      metadata: encoded.metadata,
    })
  ).toEqual({ context, command });
});
it('preserves MCP user-report values while keeping the shipped native trim behavior', () => {
  const command = {
    kind: 'submit_user_report' as const,
    targetUserId: 'target',
    targetLabel: 'Target',
    reason: ' evidence ',
    passUndefinedReason: true,
  };
  const encoded = encodeQueuedAction(context, command);
  const row = {
    id: 'request',
    server_id: 'guild',
    actor_id: 'reporter',
    action_type: command.kind,
    target_user_id: 'target',
    metadata: encoded.metadata,
  };
  expect(decodeQueuedAction({ ...row, actor_surface: 'mcp' }).command).toEqual(command);
  expect(decodeQueuedAction({ ...row, actor_surface: 'web_report' }).command).toEqual({
    kind: 'submit_user_report',
    targetUserId: 'target',
    targetLabel: 'Target',
    reason: 'evidence',
  });
});
