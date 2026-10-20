import type { ActionContext, QueuedCommand, QueuedSetupCommand } from '@drasil/application';
import { buildEnqueueStatement } from '@drasil/application/postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../setupDataAdapter', () => ({
  getPostgresPool: () => ({ connect: mocks.connect, query: mocks.poolQuery }),
}));

import { submitQueuedAction, submitSerializedSetupAction } from './queuedSubmission';

const context: ActionContext = {
  guildId: 'guild',
  requestId: 'attempt-2',
  source: 'web',
  actor: { kind: 'user', userId: 'moderator' },
};
const command: QueuedCommand = {
  kind: 'ban_case_user',
  caseId: 'case',
  targetUserId: 'target',
  detectionEventId: 'detection',
  reason: 'Reviewed evidence',
};
const setupCommand: Extract<QueuedSetupCommand, { kind: 'complete_setup_verification' }> = {
  kind: 'complete_setup_verification',
  mode: 'provision',
  adminChannelId: 'admin-channel',
  onboardingWizard: false,
  submissionId: 'setup-2',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
});

describe('submitQueuedAction', () => {
  it.each(['queued', 'processing', 'completed', 'failed'] as const)(
    'encodes a case ban and returns its %s receipt and cleanup job binding',
    async (status) => {
      mocks.poolQuery.mockResolvedValueOnce({
        rows: [{ id: 'request', status, message_deletion_job_id: 'job' }],
      });

      await expect(submitQueuedAction({ context, command })).resolves.toEqual({
        id: 'request',
        status,
        messageDeletionJobId: 'job',
      });

      expect(mocks.poolQuery).toHaveBeenCalledExactlyOnceWith(
        buildEnqueueStatement({
          actionType: 'ban_case_user',
          actorId: 'moderator',
          actorSurface: 'web',
          serverId: 'guild',
          targetUserId: 'target',
          detectionEventId: 'detection',
          verificationEventId: 'case',
          idempotencyKey: 'web:case-action:ban_user:guild:case',
          metadata: {
            case_action: 'ban_user',
            reason: 'Reviewed evidence',
            requested_surface: 'web',
          },
        }).text,
        [
          'guild',
          'ban_case_user',
          'moderator',
          'web',
          'target',
          'detection',
          null,
          'case',
          null,
          'web:case-action:ban_user:guild:case',
          JSON.stringify({
            case_action: 'ban_user',
            reason: 'Reviewed evidence',
            requested_surface: 'web',
          }),
        ]
      );
      expect(mocks.connect).not.toHaveBeenCalled();
    }
  );

  it('rejects an injected command actor before querying Postgres', async () => {
    const injected = { ...command, actor: { kind: 'user', userId: 'attacker' } };
    await expect(submitQueuedAction({ context, command: injected })).rejects.toThrow();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('submitSerializedSetupAction', () => {
  it('reuses the same active submission after taking the guild transaction lock', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'active',
            status: 'processing',
            idempotencyKey: 'web:setup:complete_setup_verification:guild:setup-2',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(submitSerializedSetupAction({ context, command: setupCommand })).resolves.toEqual({
      id: 'active',
      status: 'processing',
    });
    expect(mocks.clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'begin',
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      expect.stringContaining("status in ('queued', 'processing')"),
      'commit',
    ]);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(2, expect.any(String), [
      'drasil:complete_setup_verification:guild',
    ]);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, expect.any(String), [
      'guild',
      'complete_setup_verification',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects a different active submission with the existing conflict message', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'active', status: 'processing', idempotencyKey: 'another-key' }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(submitSerializedSetupAction({ context, command: setupCommand })).rejects.toThrow(
      'Another Drasil setup is already in progress for this server. Wait for it to finish, then review and submit your choices again.'
    );
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('inserts the canonical setup encoding on the transaction client when none is active', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'request', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(submitSerializedSetupAction({ context, command: setupCommand })).resolves.toEqual({
      id: 'request',
      status: 'queued',
    });
    expect(mocks.clientQuery.mock.calls[3]?.[1]).toEqual([
      'guild',
      'complete_setup_verification',
      'moderator',
      'web',
      null,
      null,
      null,
      null,
      null,
      'web:setup:complete_setup_verification:guild:setup-2',
      JSON.stringify({
        admin_channel_id: 'admin-channel',
        report_instructions_channel_id: null,
        requested_surface: 'web',
        onboarding_wizard: false,
        setup_action: 'complete_setup_verification',
        submission_id: 'setup-2',
        verification_channel_id: null,
      }),
    ]);
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('commit');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the transaction client if insertion fails', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('insert failed'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(submitSerializedSetupAction({ context, command: setupCommand })).rejects.toThrow(
      'insert failed'
    );
    expect(mocks.clientQuery).toHaveBeenLastCalledWith('rollback');
    expect(mocks.clientQuery.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
