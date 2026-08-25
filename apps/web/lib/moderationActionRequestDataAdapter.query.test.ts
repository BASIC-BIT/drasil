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

  it('loads an exact setup request scoped to its guild and action type', async () => {
    await new PostgresModerationActionRequestDataAdapter().getSetupRequest('guild-1', 'request-1');

    const [sql, parameters] = mocks.query.mock.calls[0];
    expect(sql).toContain('where server_id = $1');
    expect(sql).toContain('and id::text = $2');
    expect(sql).toContain("and action_type = 'complete_setup_verification'");
    expect(parameters).toEqual(['guild-1', 'request-1']);
  });
});
