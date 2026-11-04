import { decodeQueuedAction } from './decode';
import { encodeQueuedAction } from './encode';
import type { QueuedReportCommand } from '../reports/commands';
const context = {
  guildId: 'guild',
  requestId: 'request',
  source: 'web_report',
  actor: { kind: 'user' as const, userId: 'reporter' },
};
it.each<QueuedReportCommand>([
  { kind: 'submit_user_report', targetUserId: 'target', targetLabel: 'Target', reason: 'evidence' },
  { kind: 'start_report_intake', channelId: 'channel' },
  { kind: 'close_report_intake', intakeId: 'intake' },
])('round trips shipped $kind rows without changing identity or metadata', (command) => {
  const encoded = encodeQueuedAction(context, command);
  expect(encoded.actorSurface).toBe('web_report');
  expect(encoded.idempotencyKey).toBe(
    `web:report:${command.kind}:guild:${command.kind === 'submit_user_report' ? 'target' : command.kind === 'start_report_intake' ? 'reporter' : 'intake'}:request`
  );
  const decoded = decodeQueuedAction({
    id: 'request',
    server_id: encoded.serverId,
    action_type: encoded.actionType,
    actor_id: encoded.actorId,
    actor_surface: encoded.actorSurface,
    target_user_id: encoded.targetUserId,
    report_intake_id: encoded.reportIntakeId,
    metadata: { ...encoded.metadata, actor: 'spoof', closedByStaff: true },
  });
  expect(decoded).toEqual({ context, command });
});

it.each<QueuedReportCommand>([
  {
    kind: 'confirm_intake_candidate',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'prompt',
    targetUserId: 'target',
    expectedEvidenceRevision: 4,
  },
  {
    kind: 'reject_intake_candidates',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'prompt',
    promptToken: 'token',
    expectedEvidenceRevision: 4,
  },
  {
    kind: 'close_report_intake',
    intakeId: 'intake',
    promptMessageId: 'prompt',
    closeMode: { kind: 'resolve_review', reason: 'No reliable match' },
    expectedEvidenceRevision: 4,
  },
])('retains staged $kind bindings through durable queue storage', (command) => {
  const encoded = encodeQueuedAction(context, command);
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: encoded.serverId,
      action_type: encoded.actionType,
      actor_id: encoded.actorId,
      actor_surface: encoded.actorSurface,
      target_user_id: encoded.targetUserId,
      report_intake_id: encoded.reportIntakeId,
      metadata: encoded.metadata,
    })
  ).toEqual({ context, command });
});
