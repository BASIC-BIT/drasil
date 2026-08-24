import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('./setupDataAdapter', () => ({
  getPostgresPool: () => ({ query: mocks.query }),
}));

import { PostgresModerationActionRequestDataAdapter } from './moderationActionRequestDataAdapter';

describe('PostgresModerationActionRequestDataAdapter setup requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it('filters setup actions before the recent limit and includes every active setup request', async () => {
    await new PostgresModerationActionRequestDataAdapter().listSetupRequests('guild-1', 10);

    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(sql).toContain('and (not $3::boolean or action_type = any($4');
    expect(sql).toContain("and status in ('queued', 'processing')");
    expect(parameters).toEqual(['guild-1', 10, true, ['complete_setup_verification']]);
  });
});
