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
    intent: 'dashboard_case_open',
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
it('decodes old dashboard openings with explicit intent without changing their storage shape', () => {
  const row = {
    id: 'request-1',
    server_id: 'guild-1',
    action_type: 'open_admin_case',
    actor_id: 'moderator-1',
    actor_surface: 'web',
    target_user_id: 'user-1',
    detection_event_id: null,
    metadata: { reason: null, requested_surface: 'web', web_action: 'open_admin_case' },
  };
  const decoded = decodeQueuedAction(row);
  expect(decoded.command).toEqual({
    kind: 'open_admin_case',
    intent: 'dashboard_case_open',
    targetUserId: 'user-1',
    detectionEventId: null,
    reason: null,
    selectedMessage: null,
  });
  expect(encodeQueuedAction(decoded.context, decoded.command).metadata).toEqual(row.metadata);
  expect(() =>
    queuedCommandSchema.parse({ ...decoded.command, intent: 'native_case_open' })
  ).toThrow();
  expect(decodeQueuedAction({ ...row, actor_surface: 'discord_interaction' }).command).toEqual(
    decoded.command
  );
});

it.each([
  { kind: 'dismiss_observed_detection' },
  { kind: 'mark_observed_detection_false_positive' },
  { kind: 'undo_observed_detection_action' },
  { kind: 'kick_observed_detection', reason: null },
  { kind: 'ban_observed_detection', reason: null, subject: { kind: 'observed' } },
  {
    kind: 'ban_observed_detection',
    reason: 'provided',
    subject: { kind: 'report', reportId: 'report-1' },
  },
  { kind: 'ignore_detection_accounting', reason: null },
  { kind: 'restore_detection_accounting', reason: 'correction' },
])('round-trips detection queue variant $kind without leaking runtime tokens', (variant) => {
  const command = queuedCommandSchema.parse({
    ...variant,
    targetUserId: 'user-1',
    detectionEventId: 'det-1',
  });
  const encoded = encodeQueuedAction(context, command);
  const decoded = decodeQueuedAction({
    id: 'operation',
    server_id: encoded.serverId,
    action_type: encoded.actionType,
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    target_user_id: encoded.targetUserId,
    detection_event_id: encoded.detectionEventId,
    report_intake_id: encoded.reportIntakeId,
    metadata: { ...encoded.metadata, report_ban_attempt_token: 'private-token' },
  });
  expect(decoded.command).toEqual(command);
  expect(JSON.stringify(decoded)).not.toContain('private-token');
  expect(queuedCommandSchema.safeParse({ ...command, attemptToken: 'untrusted' }).success).toBe(
    false
  );
});
it.each(['web_report', 'discord_interaction'])(
  'preserves direct report ban source %s and shipped key',
  (source) => {
    const encoded = encodeQueuedAction(
      { ...context, source },
      {
        kind: 'ban_observed_detection',
        targetUserId: 'target',
        detectionEventId: 'detection',
        subject: { kind: 'report', reportId: 'report' },
        reason: null,
      }
    );
    expect(encoded).toMatchObject({
      actorSurface: source,
      reportIntakeId: 'report',
      idempotencyKey: 'observed-ban:guild-1:detection',
      metadata: { reason: null, requested_action: 'ban_user' },
    });
  }
);
it('decodes the shipped observed open-case wrapper without changing its intent', () => {
  expect(
    decodeQueuedAction({
      id: 'operation',
      server_id: 'guild-1',
      action_type: 'open_case_from_observed_detection',
      actor_id: 'moderator-1',
      actor_surface: 'web',
      target_user_id: 'user-1',
      detection_event_id: 'det-1',
      metadata: { inbox_action: 'open_case', reason: null, requested_surface: 'web' },
    }).command
  ).toEqual({ ...command, reportId: null, origin: { kind: 'observed_alert', reason: null } });
});

it('preserves the distinct observed-alert codec origin, key and exact metadata', () => {
  const decoded = decodeQueuedAction({
    id: 'operation',
    server_id: 'guild-1',
    action_type: 'open_case_from_observed_detection',
    actor_id: 'moderator-1',
    actor_surface: 'web',
    target_user_id: 'user-1',
    detection_event_id: 'det-1',
    metadata: { inbox_action: 'open_case', reason: null, requested_surface: 'web' },
  });
  expect(encodeQueuedAction(decoded.context, decoded.command)).toEqual({
    actionType: 'open_case_from_observed_detection',
    actorId: 'moderator-1',
    actorSurface: 'web',
    serverId: 'guild-1',
    targetUserId: 'user-1',
    detectionEventId: 'det-1',
    idempotencyKey: 'web:observed-action:open_case:guild-1:det-1',
    metadata: { inbox_action: 'open_case', reason: null, requested_surface: 'web' },
  });
});
