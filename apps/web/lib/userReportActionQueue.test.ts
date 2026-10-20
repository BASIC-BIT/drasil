import { beforeEach, expect, test, vi } from 'vitest';
import type { QueuedReportCommand } from '@drasil/application';
import { submitReportRequest } from './userReportActionQueue';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => ({ query: mocks.query }) }));
const context = {
  guildId: 'guild',
  requestId: 'submission-1',
  source: 'web_report',
  actor: { kind: 'user' as const, userId: 'reporter' },
};
const command: QueuedReportCommand = {
  kind: 'submit_user_report',
  targetUserId: 'target',
  targetLabel: 'Target label',
  reason: '  raw reason  ',
};
const input = {
  context,
  command,
  access: { member: true, active: true, reasonRequired: false },
  confirmations: { verify: async () => true },
  openIntake: async () => ({ id: 'intake' }),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [{ id: 'request', status: 'queued' }] });
});
test('creates the admitted report target before enqueue and preserves trusted identity and raw reason', async () => {
  expect(await submitReportRequest(input)).toBe('queued');
  expect(mocks.query.mock.calls[0]).toEqual([
    expect.stringContaining('insert into users'),
    ['target', 'reporter', JSON.stringify({ source: 'web_report' })],
  ]);
  const values = mocks.query.mock.calls[1][1];
  expect(values.slice(0, 5)).toEqual([
    'guild',
    'submit_user_report',
    'reporter',
    'web_report',
    'target',
  ]);
  expect(values[9]).toBe('web:report:submit_user_report:guild:target:submission-1');
  expect(JSON.parse(values[10])).toMatchObject({
    reason: '  raw reason  ',
    target_label: 'Target label',
    requested_surface: 'web_report',
  });
});
test('reuses submitted report identities and separates deliberate submissions', async () => {
  await submitReportRequest(input);
  await submitReportRequest(input);
  await submitReportRequest({ ...input, context: { ...context, requestId: 'submission-2' } });
  const keys = mocks.query.mock.calls
    .filter(([sql]) => sql.startsWith('insert into moderation_action_requests'))
    .map(([, values]) => values[9]);
  expect(keys).toEqual([
    'web:report:submit_user_report:guild:target:submission-1',
    'web:report:submit_user_report:guild:target:submission-1',
    'web:report:submit_user_report:guild:target:submission-2',
  ]);
});
test.each<QueuedReportCommand>([
  { kind: 'start_report_intake', channelId: 'channel' },
  { kind: 'close_report_intake', intakeId: 'intake' },
])('does not create targets for $kind', async (command) => {
  await submitReportRequest({ ...input, command });
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][0]).toContain('insert into moderation_action_requests');
});
test.each([
  {
    name: 'actor unavailable',
    override: { access: { member: false, active: true, reasonRequired: false } },
    error: 'This report destination is not available to the signed-in Discord account.',
  },
  {
    name: 'self report',
    override: { command: { ...command, targetUserId: 'reporter' } },
    error: 'You cannot report yourself.',
  },
  {
    name: 'reason required',
    override: {
      access: { member: true, active: true, reasonRequired: true },
      command: { ...command, reason: null },
    },
    error: 'This server requires a report reason.',
  },
  {
    name: 'stale intake',
    override: { command: { kind: 'close_report_intake' as const, intakeId: 'stale' } },
    error: 'This report intake is no longer available.',
  },
  {
    name: 'missing confirmation',
    override: { confirmations: { verify: async (): Promise<boolean> => false } },
    error: 'Confirm the report before submitting it.',
  },
  {
    name: 'missing close confirmation',
    override: {
      command: { kind: 'close_report_intake' as const, intakeId: 'intake' },
      confirmations: { verify: async (): Promise<boolean> => false },
    },
    error: 'Confirm the report intake close before submitting it.',
  },
])('denies $name before any persistence', async ({ override, error }) => {
  await expect(submitReportRequest({ ...input, ...override })).rejects.toThrow(error);
  expect(mocks.query).not.toHaveBeenCalled();
});
