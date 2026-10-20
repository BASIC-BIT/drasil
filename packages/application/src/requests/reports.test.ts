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
