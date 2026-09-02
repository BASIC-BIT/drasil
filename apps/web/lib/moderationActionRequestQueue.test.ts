import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('./setupDataAdapter', () => ({
  getPostgresPool: () => ({ connect: mocks.connect, query: mocks.query }),
}));

import {
  insertModerationActionRequestWithReceipt,
  queueSerializedModerationActionRequestWithReceipt,
} from './moderationActionRequestQueue';

describe('queueSerializedModerationActionRequestWithReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  });

  it('returns the same active setup submission after taking the guild transaction lock', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'active-1', idempotencyKey: 'setup-2', status: 'processing' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await queueSerializedModerationActionRequestWithReceipt({
      actionType: 'complete_setup_verification',
      actorId: 'admin-2',
      actorSurface: 'web',
      idempotencyKey: 'setup-2',
      serverId: 'guild-1',
    });

    expect(result).toEqual({ id: 'active-1', status: 'processing' });
    expect(mocks.query.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      expect.stringContaining("status in ('queued', 'processing')"),
      'commit',
    ]);
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.any(String), [
      'drasil:complete_setup_verification:guild-1',
    ]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('rejects a different setup submission while one is active', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'active-1', idempotencyKey: 'setup-1', status: 'processing' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      queueSerializedModerationActionRequestWithReceipt({
        actionType: 'complete_setup_verification',
        actorId: 'admin-2',
        actorSurface: 'web',
        idempotencyKey: 'setup-2',
        serverId: 'guild-1',
      })
    ).rejects.toThrow('Another Drasil setup is already in progress for this server.');

    expect(mocks.query).toHaveBeenLastCalledWith('rollback');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it('inserts a setup request when no request is active', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'request-2', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await queueSerializedModerationActionRequestWithReceipt({
      actionType: 'complete_setup_verification',
      actorId: 'admin-2',
      actorSurface: 'web',
      idempotencyKey: 'setup-2',
      serverId: 'guild-1',
    });

    expect(result).toEqual({ id: 'request-2', status: 'queued' });
    const insertSql = String(mocks.query.mock.calls[3]?.[0]);
    expect(insertSql).toContain('insert into moderation_action_requests');
    expect(insertSql).toContain('actor_id = excluded.actor_id');
    expect(insertSql).toContain('actor_surface = excluded.actor_surface');
    expect(insertSql).toContain("where moderation_action_requests.status = 'failed'");
    expect(mocks.query).toHaveBeenLastCalledWith('commit');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('insertModerationActionRequestWithReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves queued, processing, and completed stable-key requests untouched', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'active-1', status: 'processing' }] });

    await expect(
      insertModerationActionRequestWithReceipt({ query: mocks.query } as never, {
        actionType: 'apply_captcha_pass',
        actorId: 'drasil:captcha',
        actorSurface: 'captcha',
        idempotencyKey: 'captcha:apply:challenge-1:1',
        serverId: 'guild-1',
      })
    ).resolves.toEqual({ id: 'active-1', status: 'processing' });

    const statement = String(mocks.query.mock.calls[0]?.[0]);
    expect(statement).toContain("where moderation_action_requests.status = 'failed'");
    expect(statement).toContain('and not exists (select 1 from upserted)');
  });
});
