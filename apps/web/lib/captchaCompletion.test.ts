import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getPostgresPool: vi.fn(),
  insertModerationActionRequestWithReceipt: vi.fn(),
}));

vi.mock('./setupDataAdapter', () => ({ getPostgresPool: mocked.getPostgresPool }));
vi.mock('./moderationActionRequestQueue', () => ({
  insertModerationActionRequestWithReceipt: mocked.insertModerationActionRequestWithReceipt,
}));

import {
  beginCaptchaAttempt,
  completeCaptchaAttempt,
  getCaptchaFormConfiguration,
  getCaptchaPublicChallenge,
  requeueCaptchaPassEffect,
  recordCaptchaIdentityMismatch,
} from './captchaCompletion';

const context = {
  guildId: 'guild-1',
  requestId: 'attempt',
  source: 'captcha',
  actor: { kind: 'user' as const, userId: 'user-1' },
};
const originalTurnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const originalCaptchaBindingSecret = process.env.DRASIL_CAPTCHA_BINDING_SECRET;

const challengeRow = {
  attempt_id: '00000000-0000-4000-8000-000000000001',
  attempt_generation: 1,
  case_revision_at_issue: 2,
  case_kind: 'standard',
  case_status: 'pending',
  expires_at: new Date(Date.now() + 60_000),
  generation: 1,
  id: '00000000-0000-4000-8000-000000000002',
  server_id: 'guild-1',
  server_settings: {
    captcha_max_submissions: 5,
    captcha_mode: 'manual',
  },
  status: 'pending',
  submission_count: 4,
  user_id: 'user-1',
  validation_state: 'started',
  verification_event_id: '00000000-0000-4000-8000-000000000003',
};

function createDatabaseHarness(options: { readonly passUpdateSucceeds?: boolean } = {}) {
  const query = vi.fn(async (statement: string, _parameters?: readonly unknown[]) => {
    if (statement.includes('from captcha_challenge_attempts a')) {
      return { rows: [challengeRow] };
    }
    if (statement.includes("set status = 'passed'")) {
      return { rows: options.passUpdateSucceeds === false ? [] : [{ id: challengeRow.id }] };
    }
    return { rows: [] };
  });
  const client = {
    query,
    release: vi.fn(),
  };
  mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });
  mocked.insertModerationActionRequestWithReceipt.mockResolvedValue({
    id: 'request-1',
    status: 'queued',
  });
  return { client, query };
}

describe('captcha completion transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalTurnstileSiteKey === undefined) {
      delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    } else {
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
    }
    if (originalCaptchaBindingSecret === undefined) {
      delete process.env.DRASIL_CAPTCHA_BINDING_SECRET;
    } else {
      process.env.DRASIL_CAPTCHA_BINDING_SECRET = originalCaptchaBindingSecret;
    }
  });

  it('returns no form configuration instead of throwing when provider settings are missing', () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.DRASIL_CAPTCHA_BINDING_SECRET;

    expect(getCaptchaFormConfiguration(challengeRow.id, 1)).toBeNull();
  });

  it('presents a pending challenge as cancelled after the case becomes compromised', async () => {
    mocked.getPostgresPool.mockReturnValue({
      query: vi.fn(async () => ({
        rows: [{ ...challengeRow, case_kind: 'compromised_account' }],
      })),
    });

    await expect(getCaptchaPublicChallenge('a'.repeat(43))).resolves.toEqual(
      expect.objectContaining({ id: challengeRow.id, status: 'cancelled' })
    );
  });

  it('bounds attempts across all identities for one challenge generation', async () => {
    const query = vi.fn(async (statement: string, _parameters?: readonly unknown[]) => {
      if (statement.includes('from captcha_challenges c')) {
        return { rows: [challengeRow] };
      }
      if (statement.includes('where idempotency_key = $1')) {
        return { rows: [] };
      }
      if (statement.includes('generation_count')) {
        return {
          rows: [{ generation_count: '100', recent_service_count: '0', recent_user_count: '0' }],
        };
      }
      if (statement.includes("set status = 'failed'")) {
        return { rows: [{ id: challengeRow.id }] };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });

    await expect(
      beginCaptchaAttempt(context, {
        token: 'a'.repeat(43),
        identity: {
          challengeId: challengeRow.id,
          expiresAt: Date.now() + 60_000,
          generation: challengeRow.generation,
          issuedAt: Date.now(),
          userId: challengeRow.user_id,
        },
        idempotencyKey: '00000000-0000-4000-8000-000000000004',
      })
    ).resolves.toEqual({
      state: 'stale',
      challenge: expect.objectContaining({ id: challengeRow.id, status: 'failed' }),
    });
    expect(query.mock.calls.some(([statement]) => statement.includes('insert into'))).toBe(false);
    const abandonedAttemptUpdate = query.mock.calls.find(([statement]) =>
      statement.includes("validation_state = 'provider_error'")
    );
    expect(abandonedAttemptUpdate?.[0]).toContain("validation_state = 'started'");
    expect(abandonedAttemptUpdate?.[0]).toContain('created_at < $3::timestamptz');
    expect(abandonedAttemptUpdate?.[1]).toEqual([
      challengeRow.id,
      challengeRow.generation,
      expect.any(Date),
    ]);
    const limitsQuery = query.mock.calls.find(([statement]) =>
      statement.includes('generation_count')
    )?.[0];
    expect(limitsQuery).toContain(
      "validation_state <> 'provider_error'::captcha_attempt_validation_state"
    );
    expect(query).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      challengeRow.user_id,
    ]);
    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `captcha:attention:${challengeRow.id}:1:submission-limit`,
      })
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('applies the authenticated-user rate limit across all challenge rows', async () => {
    const query = vi.fn(async (statement: string, _parameters?: readonly unknown[]) => {
      if (statement.includes('from captcha_challenges c')) {
        return { rows: [challengeRow] };
      }
      if (statement.includes('where idempotency_key = $1')) {
        return { rows: [] };
      }
      if (statement.includes('generation_count')) {
        return {
          rows: [{ generation_count: '1', recent_service_count: '0', recent_user_count: '10' }],
        };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });

    await expect(
      beginCaptchaAttempt(context, {
        token: 'a'.repeat(43),
        identity: {
          challengeId: challengeRow.id,
          expiresAt: Date.now() + 60_000,
          generation: challengeRow.generation,
          issuedAt: Date.now(),
          userId: challengeRow.user_id,
        },
        idempotencyKey: '00000000-0000-4000-8000-000000000005',
      })
    ).resolves.toEqual({
      state: 'rate_limited',
      challenge: expect.objectContaining({ id: challengeRow.id }),
    });

    const lockIndex = query.mock.calls.findIndex(([statement]) =>
      statement.includes('pg_advisory_xact_lock')
    );
    const limitsIndex = query.mock.calls.findIndex(([statement]) =>
      statement.includes('generation_count')
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(limitsIndex);
    const limitsQuery = query.mock.calls[limitsIndex]?.[0] ?? '';
    expect(limitsQuery.match(/from captcha_challenge_attempts/g)).toHaveLength(3);
    expect(limitsQuery).toContain('where discord_user_id = $3');
    expect(query.mock.calls.some(([statement]) => statement.includes('insert into'))).toBe(false);
  });

  it('applies a coarse provider budget across authenticated users', async () => {
    const query = vi.fn(async (statement: string, _parameters?: readonly unknown[]) => {
      if (statement.includes('from captcha_challenges c')) {
        return { rows: [challengeRow] };
      }
      if (statement.includes('where idempotency_key = $1')) {
        return { rows: [] };
      }
      if (statement.includes('generation_count')) {
        return {
          rows: [{ generation_count: '1', recent_service_count: '100', recent_user_count: '1' }],
        };
      }
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });

    await expect(
      beginCaptchaAttempt(context, {
        token: 'a'.repeat(43),
        identity: {
          challengeId: challengeRow.id,
          expiresAt: Date.now() + 60_000,
          generation: challengeRow.generation,
          issuedAt: Date.now(),
          userId: challengeRow.user_id,
        },
        idempotencyKey: '00000000-0000-4000-8000-000000000006',
      })
    ).resolves.toEqual({
      state: 'rate_limited',
      challenge: expect.objectContaining({ id: challengeRow.id }),
    });

    expect(query).toHaveBeenCalledWith('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      'drasil:captcha:provider-budget',
    ]);
    expect(query.mock.calls.some(([statement]) => statement.includes('insert into'))).toBe(false);
  });

  it('marks the generation failed and queues moderator attention at the submission limit', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt(context, {
        challengeId: challengeRow.id,
        generation: challengeRow.generation,
        attemptId: challengeRow.attempt_id,
        validation: {
          action: null,
          errorCodes: ['invalid-input-response'],
          hostname: null,
          state: 'invalid',
          success: false,
        },
      })
    ).resolves.toBe('failed');

    const challengeUpdate = query.mock.calls.find(([statement]) =>
      statement.includes('update captcha_challenges')
    );
    expect(challengeUpdate?.[1]).toEqual([challengeRow.id, 5, true, 1]);
    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'notify_captcha_attention',
        idempotencyKey: `captcha:attention:${challengeRow.id}:1:submission-limit`,
        verificationEventId: challengeRow.verification_event_id,
      })
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('records a provider error without consuming or failing the generation', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt(context, {
        challengeId: challengeRow.id,
        generation: challengeRow.generation,
        attemptId: challengeRow.attempt_id,
        validation: {
          action: null,
          errorCodes: ['internal-error'],
          hostname: null,
          state: 'provider_error',
          success: null,
        },
      })
    ).resolves.toBe('provider_error');

    const attemptUpdate = query.mock.calls.find(([statement]) =>
      statement.includes('update captcha_challenge_attempts')
    );
    expect(attemptUpdate?.[1]?.[2]).toBe(false);
    expect(
      query.mock.calls.some(([statement]) => statement.includes('update captcha_challenges'))
    ).toBe(false);
    expect(mocked.insertModerationActionRequestWithReceipt).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('marks a pass and queues its exact-case effect before commit', async () => {
    const { query } = createDatabaseHarness();

    await expect(
      completeCaptchaAttempt(context, {
        challengeId: challengeRow.id,
        generation: challengeRow.generation,
        attemptId: challengeRow.attempt_id,
        validation: {
          action: 'drasil_case_access',
          errorCodes: [],
          hostname: 'drasil.example',
          state: 'passed',
          success: true,
        },
      })
    ).resolves.toBe('passed');

    const completionSelect = query.mock.calls.find(([statement]) =>
      statement.includes('from captcha_challenge_attempts a')
    );
    expect(completionSelect?.[0]).toContain('for update of a, c, v, s');
    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'apply_captcha_pass',
        idempotencyKey: `captcha:apply:${challengeRow.id}:1`,
        metadata: {
          challenge_id: challengeRow.id,
          expected_case_revision: challengeRow.case_revision_at_issue,
          generation: 1,
        },
        targetUserId: challengeRow.user_id,
        verificationEventId: challengeRow.verification_event_id,
      })
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('commits a stale attempt when the challenge pass update loses its guard', async () => {
    const { query } = createDatabaseHarness({ passUpdateSucceeds: false });

    await expect(
      completeCaptchaAttempt(context, {
        challengeId: challengeRow.id,
        generation: challengeRow.generation,
        attemptId: challengeRow.attempt_id,
        validation: {
          action: 'drasil_case_access',
          errorCodes: [],
          hostname: 'drasil.example',
          state: 'passed',
          success: true,
        },
      })
    ).resolves.toBe('stale');

    expect(
      query.mock.calls.some(([statement]) =>
        statement.includes("set validation_state = 'stale', validated_at = now()")
      )
    ).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });

  it('requeues a failed exact-case pass effect with its stable idempotency key', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ ...challengeRow, status: 'passed' }] })),
      release: vi.fn(),
    };
    mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => pool) });

    await requeueCaptchaPassEffect({
      id: challengeRow.id,
      verificationEventId: challengeRow.verification_event_id,
      serverId: challengeRow.server_id,
      userId: challengeRow.user_id,
      status: 'passed',
      generation: challengeRow.generation,
      caseRevision: challengeRow.case_revision_at_issue,
      expiresAt: challengeRow.expires_at,
    });

    expect(mocked.insertModerationActionRequestWithReceipt).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        actionType: 'apply_captcha_pass',
        idempotencyKey: `captcha:apply:${challengeRow.id}:1`,
        verificationEventId: challengeRow.verification_event_id,
      })
    );
  });
  it('does not requeue a pass after the persisted generation changes', async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ ...challengeRow, status: 'passed', generation: 2 }],
    }));
    const client = { query, release: vi.fn() };
    mocked.getPostgresPool.mockReturnValue({ connect: vi.fn(async () => client) });
    await requeueCaptchaPassEffect({
      id: challengeRow.id,
      verificationEventId: challengeRow.verification_event_id,
      serverId: challengeRow.server_id,
      userId: challengeRow.user_id,
      status: 'passed',
      generation: 1,
      caseRevision: 2,
      expiresAt: challengeRow.expires_at,
    });
    expect(mocked.insertModerationActionRequestWithReceipt).not.toHaveBeenCalled();
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });
  it('rejects completion for a different authenticated user before recording provider success', async () => {
    const { query } = createDatabaseHarness();
    const result = await completeCaptchaAttempt(
      { ...context, actor: { kind: 'user', userId: 'other' } },
      {
        challengeId: challengeRow.id,
        generation: 1,
        attemptId: challengeRow.attempt_id,
        validation: {
          state: 'passed',
          success: true,
          action: 'drasil_case_access',
          hostname: 'drasil.example',
          errorCodes: [],
        },
      }
    );
    expect(result).toBe('stale');
    expect(query.mock.calls.some(([sql]) => sql.includes('update captcha_'))).toBe(false);
    expect(mocked.insertModerationActionRequestWithReceipt).not.toHaveBeenCalled();
  });
  it('records an authenticated OAuth mismatch without consuming a provider submission', async () => {
    const query = vi.fn(async (sql: string, _parameters?: readonly unknown[]) => {
      if (sql.includes('from captcha_challenges c')) return { rows: [challengeRow] };
      if (sql.includes('generation_count'))
        return {
          rows: [{ generation_count: '0', recent_user_count: '0', recent_service_count: '100' }],
        };
      if (sql.includes('insert into captcha_challenge_attempts'))
        return { rows: [{ id: 'attempt', validation_state: 'identity_mismatch' }] };
      return { rows: [] };
    });
    mocked.getPostgresPool.mockReturnValue({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    });
    await recordCaptchaIdentityMismatch(
      { ...context, actor: { kind: 'user', userId: 'other' } },
      {
        token: 'a'.repeat(43),
        discordUserId: 'other',
        challengeId: challengeRow.id,
        generation: 1,
        idempotencyKey: 'captcha-oauth:authenticated-state',
      }
    );
    const insertion = query.mock.calls.find(([sql]) =>
      sql.includes('insert into captcha_challenge_attempts')
    );
    expect(insertion?.[1]).toEqual([
      challengeRow.id,
      1,
      'captcha-oauth:authenticated-state',
      'identity_mismatch',
      'other',
    ]);
    expect(insertion?.[0]).toContain('false,');
    expect(query.mock.calls.some(([sql]) => sql.includes('update captcha_challenges'))).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
  });
  it('rolls the pass transaction back when its durable effect cannot be inserted', async () => {
    const { query } = createDatabaseHarness();
    mocked.insertModerationActionRequestWithReceipt.mockRejectedValueOnce(
      new Error('queue unavailable')
    );
    await expect(
      completeCaptchaAttempt(context, {
        challengeId: challengeRow.id,
        generation: 1,
        attemptId: challengeRow.attempt_id,
        validation: {
          state: 'passed',
          success: true,
          action: 'drasil_case_access',
          hostname: 'drasil.example',
          errorCodes: [],
        },
      })
    ).rejects.toThrow('queue unavailable');
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
    expect(query.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
  });
});
