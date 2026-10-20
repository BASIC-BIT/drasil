import { vi, test, expect, afterEach } from 'vitest';
import {
  queueObservedAlertActionRequest,
  queueObservedAlertUndoActionRequest,
} from './observedAlertActionQueue';
import { queueDetectionAccountingActionRequest } from './detectionAccountingActionQueue';
import {
  queueModerationActionRequest,
  queueModerationActionRequestWithReceipt,
} from './moderationActionRequestQueue';
vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('./moderationActionRequestQueue', () => ({
  queueModerationActionRequest: vi.fn(async () => 'queued'),
  queueModerationActionRequestWithReceipt: vi.fn(async () => ({ id: 'request', status: 'queued' })),
}));
const input = {
  actorId: 'actor',
  actorSurface: 'web',
  detectionEventId: 'detection',
  guildId: 'guild',
  targetUserId: 'target',
};
afterEach(() => vi.clearAllMocks());
test.each([
  'dismiss_no_action',
  'mark_false_positive',
  'kick_user',
  'ban_user',
  'open_case',
] as const)('preserves shipped observed %s keys', async (action) => {
  await queueObservedAlertActionRequest({ ...input, action });
  expect(queueModerationActionRequestWithReceipt).toHaveBeenCalledWith(
    expect.objectContaining({
      idempotencyKey: `web:observed-action:${action}:guild:detection`,
      metadata: { inbox_action: action, reason: null, requested_surface: 'web' },
    })
  );
});
test('report bound bans retain report identity and raw reasons', async () => {
  await queueObservedAlertActionRequest({
    ...input,
    action: 'ban_user',
    reportId: 'report',
    reason: null,
  });
  expect(queueModerationActionRequestWithReceipt).toHaveBeenCalledWith(
    expect.objectContaining({
      reportIntakeId: 'report',
      metadata: expect.objectContaining({ reason: null }),
    })
  );
});
test('undo preserves the safe domain action and key', async () => {
  await queueObservedAlertUndoActionRequest(input);
  expect(queueModerationActionRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      actionType: 'undo_observed_detection_action',
      idempotencyKey: 'web:observed-action:undo:guild:detection',
      metadata: { inbox_action: 'undo_observed_action', requested_surface: 'web' },
    })
  );
});
test.each(['ignore_detection', 'restore_detection'] as const)(
  'accounting %s preserves the shipped key',
  async (action) => {
    await queueDetectionAccountingActionRequest({ ...input, action });
    expect(queueModerationActionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `web:detection-accounting:${action}:guild:detection`,
        metadata: { reason: null, requested_surface: 'web', web_action: action },
      })
    );
  }
);
