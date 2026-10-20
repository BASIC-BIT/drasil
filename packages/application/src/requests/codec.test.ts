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
