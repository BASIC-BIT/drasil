import { decodeQueuedAction, encodeQueuedAction, queuedCommandSchema } from '../index';
const context = {
  guildId: 'guild-1',
  requestId: 'request-1',
  source: 'web',
  actor: { kind: 'user' as const, userId: 'moderator-1' },
};
const command = {
  kind: 'open_case_from_observed_detection' as const,
  detectionEventId: 'det-1',
  targetUserId: 'user-1',
  reportId: 'report-1',
};
it('preserves report case queue bindings and shipped metadata', () => {
  const encoded = encodeQueuedAction(context, command);
  expect(encoded).toEqual({
    actionType: command.kind,
    actorId: 'moderator-1',
    actorSurface: 'web',
    serverId: 'guild-1',
    detectionEventId: 'det-1',
    targetUserId: 'user-1',
    reportIntakeId: 'report-1',
    metadata: { requested_surface: 'web', report_intake_id: 'report-1' },
    idempotencyKey: 'web:report-open-case:guild-1:report-1:det-1',
  });
  expect(
    decodeQueuedAction({
      id: 'persisted-1',
      server_id: encoded.serverId,
      action_type: encoded.actionType,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      detection_event_id: encoded.detectionEventId,
      target_user_id: encoded.targetUserId,
      report_intake_id: encoded.reportIntakeId,
      metadata: encoded.metadata,
    })
  ).toEqual({ context: { ...context, requestId: 'persisted-1' }, command });
});
it('rejects command authority injection and malformed persisted bindings', () => {
  expect(() => queuedCommandSchema.parse({ ...command, actor: context.actor })).toThrow();
  expect(() => decodeQueuedAction({ action_type: command.kind })).toThrow();
});

const bound = { caseId: 'case-1', targetUserId: 'user-1' };
const destructive = { ...bound, reason: 'Moderation reason', detectionEventId: null };
const caseCommands = [
  command,
  {
    kind: 'open_admin_case',
    targetUserId: 'user-1',
    reason: 'Review',
    detectionEventId: 'det-1',
    selectedMessage: { channelId: 'channel-1', messageId: 'message-1' },
  },
  { kind: 'manual_flag_user', targetUserId: 'user-1', reason: null },
  { kind: 'verify_case_user', ...bound },
  { kind: 'close_case_no_action', ...bound },
  { kind: 'kick_case_user', ...destructive },
  { kind: 'ban_case_user', ...destructive },
  { kind: 'ban_case_user_by_id', ...destructive },
  { kind: 'repair_active_case', intent: 'moderator_repair', ...bound, mode: 'create_thread' },
  { kind: 'reopen_case', ...bound },
  { kind: 'refresh_case_notification', ...bound },
  { kind: 'sync_existing_ban', ...bound },
] satisfies readonly import('./commands').QueuedCommand[];
it.each(caseCommands)('round-trips shipped $kind bindings and metadata', (caseCommand) => {
  const encoded = encodeQueuedAction(context, caseCommand);
  const decoded = decodeQueuedAction({
    id: context.requestId,
    server_id: encoded.serverId,
    action_type: encoded.actionType,
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    target_user_id: encoded.targetUserId,
    verification_event_id: encoded.verificationEventId,
    detection_event_id: encoded.detectionEventId,
    report_intake_id: encoded.reportIntakeId,
    metadata: encoded.metadata,
  });
  expect(decoded).toEqual({ context, command: caseCommand });
});
it('preserves create-thread and repair-thread queue identities independently', () => {
  const encoded = encodeQueuedAction(context, {
    kind: 'repair_active_case',
    intent: 'moderator_repair',
    ...bound,
    mode: 'create_thread',
  });
  expect(encoded.idempotencyKey).toBe('web:case-action:create_thread:guild-1:case-1');
  expect(encoded.metadata).toEqual({ case_action: 'create_thread', requested_surface: 'web' });
});
it('decodes shipped repair rows without inventing administrator intent', () => {
  const decoded = decodeQueuedAction({
    id: 'request-1',
    server_id: 'guild-1',
    action_type: 'repair_active_case',
    actor_id: 'moderator-1',
    actor_surface: 'web',
    target_user_id: 'user-1',
    verification_event_id: 'case-1',
    metadata: { case_action: 'repair_thread' },
  });
  expect(decoded.command).toEqual({
    kind: 'repair_active_case',
    ...bound,
    mode: 'repair_thread',
    intent: 'moderator_repair',
  });
  expect(() =>
    queuedCommandSchema.parse({ ...decoded.command, intent: 'administrator_repair' })
  ).toThrow();
});
