import { queueObservedAlertActionRequest as legacyQueue } from '../e2e/legacy/observedAlertActionQueue';
import { vi, test, expect, afterEach } from 'vitest';
import {
  queueObservedAlertActionRequest,
  queueObservedAlertUndoActionRequest,
} from './observedAlertActionQueue';
import { queueDetectionAccountingActionRequest } from './detectionAccountingActionQueue';
const mocks = vi.hoisted(() => ({
  fixture: false,
  query: vi.fn().mockResolvedValue({ rows: [{ id: 'request', status: 'completed' }] }),
}));
vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => mocks.fixture }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => ({ query: mocks.query }) }));
const input = {
  context: {
    actor: { kind: 'user' as const, userId: 'actor' },
    source: 'web',
    requestId: 'submission-1',
    guildId: 'guild',
  },
  detectionEventId: 'detection',
  targetUserId: 'target',
};
afterEach(() => {
  mocks.fixture = false;
  vi.clearAllMocks();
});
test.each([
  'dismiss_no_action',
  'mark_false_positive',
  'kick_user',
  'ban_user',
  'open_case',
] as const)('preserves shipped observed %s keys and receipts', async (action) => {
  expect(await queueObservedAlertActionRequest({ ...input, action })).toMatchObject({
    id: 'request',
    status: 'completed',
  });
  const values = mocks.query.mock.calls[0][1];
  expect(values.slice(0, 7)).toEqual([
    'guild',
    expect.any(String),
    'actor',
    'web',
    'target',
    'detection',
    null,
  ]);
  expect(values[9]).toBe(`web:observed-action:${action}:guild:detection`);
  expect(JSON.parse(values[10])).toEqual({
    inbox_action: action,
    reason: null,
    requested_surface: 'web',
  });
});
test('report bound bans retain report identity, source and raw reasons', async () => {
  await queueObservedAlertActionRequest({
    ...input,
    context: { ...input.context, source: 'web_report' },
    action: 'ban_user',
    reportId: 'report',
    reason: '  raw reason  ',
  });
  const values = mocks.query.mock.calls[0][1];
  expect(values[3]).toBe('web_report');
  expect(values[6]).toBe('report');
  expect(JSON.parse(values[10])).toMatchObject({
    reason: '  raw reason  ',
    requested_action: 'ban_user',
  });
});
test('undo preserves the safe domain action, key and receipt', async () => {
  expect(await queueObservedAlertUndoActionRequest(input)).toMatchObject({
    id: 'request',
    status: 'completed',
  });
  const values = mocks.query.mock.calls[0][1];
  expect(values[1]).toBe('undo_observed_detection_action');
  expect(values[9]).toBe('web:observed-action:undo:guild:detection');
  expect(JSON.parse(values[10])).toEqual({
    inbox_action: 'undo_observed_action',
    requested_surface: 'web',
  });
});
test.each(['ignore_detection', 'restore_detection'] as const)(
  'accounting %s preserves the shipped key and receipt',
  async (action) => {
    expect(await queueDetectionAccountingActionRequest({ ...input, action })).toMatchObject({
      id: 'request',
      status: 'completed',
    });
    const values = mocks.query.mock.calls[0][1];
    expect(values[9]).toBe(`web:detection-accounting:${action}:guild:detection`);
    expect(JSON.parse(values[10])).toEqual({
      reason: null,
      requested_surface: 'web',
      web_action: action,
    });
  }
);

test('keeps observed dismissal completed and other observed fixture actions queued without persistence', async () => {
  mocks.fixture = true;
  expect(await legacyQueue({ ...input, action: 'dismiss_no_action' })).toEqual({
    id: 'fixture-observed-action-dismiss_no_action-detection',
    status: 'completed',
  });
  expect(await legacyQueue({ ...input, action: 'ban_user' })).toEqual({
    id: 'fixture-observed-action-ban_user-detection',
    status: 'queued',
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
