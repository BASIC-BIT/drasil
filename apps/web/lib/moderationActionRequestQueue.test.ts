import { buildEnqueueStatement } from '@drasil/application/postgres';
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

const sharedStatement = buildEnqueueStatement({
  actionType: 'complete_setup_verification',
  serverId: 'guild-1',
  actorId: 'admin-2',
  actorSurface: 'web',
  targetUserId: null,
  idempotencyKey: 'setup-2',
  metadata: {},
});

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
    expect(insertSql).toBe(sharedStatement.text);
    expect(mocks.query.mock.calls[3]?.[1]).toEqual(sharedStatement.values);
    expect(mocks.query).toHaveBeenLastCalledWith('commit');
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});

describe('insertModerationActionRequestWithReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves queued, processing, and completed CAPTCHA pass requests untouched', async () => {
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
    expect(statement).toBe(sharedStatement.text);
  });

  it('delegates queued resubmissions to the shared statement', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'active-1', status: 'queued' }] });

    await expect(
      insertModerationActionRequestWithReceipt({ query: mocks.query } as never, {
        actionType: 'ban_case_user',
        actorId: 'moderator-2',
        actorSurface: 'web',
        idempotencyKey: 'web:case-action:ban:guild-1:case-1',
        metadata: { reason: 'Corrected reason' },
        serverId: 'guild-1',
      })
    ).resolves.toEqual({ id: 'active-1', status: 'queued' });

    const statement = String(mocks.query.mock.calls[0]?.[0]);
    expect(statement).toBe(sharedStatement.text);
  });

  it('leaves processing non-CAPTCHA request payloads untouched', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'active-1', status: 'processing' }] });

    await expect(
      insertModerationActionRequestWithReceipt({ query: mocks.query } as never, {
        actionType: 'ban_case_user',
        actorId: 'moderator-2',
        actorSurface: 'web',
        idempotencyKey: 'web:case-action:ban:guild-1:case-1',
        metadata: { reason: 'Different reason' },
        serverId: 'guild-1',
      })
    ).resolves.toEqual({ id: 'active-1', status: 'processing' });

    const statement = String(mocks.query.mock.calls[0]?.[0]);
    expect(statement).toBe(sharedStatement.text);
  });
});

it('maps the returned job binding and rejects a missing database row', async () => {
  const input = {
    actionType: 'ban_case_user' as const,
    actorId: 'moderator',
    actorSurface: 'web',
    serverId: 'guild',
    idempotencyKey: 'key',
  };
  mocks.query.mockResolvedValueOnce({
    rows: [{ id: 'request', status: 'queued', message_deletion_job_id: 'job' }],
  });
  await expect(
    insertModerationActionRequestWithReceipt({ query: mocks.query } as never, input)
  ).resolves.toEqual({ id: 'request', status: 'queued', messageDeletionJobId: 'job' });
  mocks.query.mockResolvedValueOnce({ rows: [] });
  await expect(
    insertModerationActionRequestWithReceipt({ query: mocks.query } as never, input)
  ).rejects.toThrow('Failed to enqueue');
});
