import { buildEnqueueStatement } from './enqueue';
import type { EnqueueInput } from '../requests/receipt';
const input: EnqueueInput = {
  serverId: "guild'; DROP TABLE users; --",
  actionType: 'ban_observed_detection',
  actorId: 'moderator',
  actorSurface: 'web_report',
  targetUserId: 'target',
  detectionEventId: 'detection',
  reportIntakeId: 'report',
  verificationEventId: 'case',
  messageDeletionJobId: 'job',
  idempotencyKey: 'observed-ban:guild:detection',
  metadata: { reason: 'Reviewed' },
};
it('keeps all caller values in parameters, including every immutable ID binding', () => {
  const statement = buildEnqueueStatement(input);
  expect(statement.values).toEqual([
    input.serverId,
    input.actionType,
    input.actorId,
    input.actorSurface,
    input.targetUserId,
    input.detectionEventId,
    input.reportIntakeId,
    input.verificationEventId,
    input.messageDeletionJobId,
    input.idempotencyKey,
    JSON.stringify(input.metadata),
  ]);
  expect(statement.text).not.toContain(input.serverId);
  expect(statement.text).not.toContain(input.actorId);
  expect(statement.text).not.toContain(input.idempotencyKey);
  expect(statement.text).toContain('returning *');
});
it('normalizes absent storage columns without changing statement text', () => {
  const statement = buildEnqueueStatement({
    ...input,
    targetUserId: null,
    detectionEventId: undefined,
    reportIntakeId: undefined,
    verificationEventId: undefined,
    messageDeletionJobId: undefined,
  });
  expect(statement.text).toBe(buildEnqueueStatement(input).text);
  expect(statement.values.slice(4, 9)).toEqual([null, null, null, null, null]);
});
