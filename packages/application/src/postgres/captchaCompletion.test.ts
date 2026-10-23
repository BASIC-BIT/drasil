import { createCaptchaCompletionStore } from './captchaCompletion';
import type { DelegationDatabase } from './delegation';
import type { ActionContext, CaptchaCompletionInput } from '../index';
const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'attempt',
  source: 'captcha',
  actor: { kind: 'user', userId: 'user-1' },
};
const row = {
  id: '00000000-0000-4000-8000-000000000002',
  verification_event_id: '00000000-0000-4000-8000-000000000003',
  server_id: 'guild-1',
  user_id: 'user-1',
  status: 'pending',
  generation: 1,
  case_revision_at_issue: 2,
  expires_at: new Date(Date.now() + 60_000),
  submission_count: 0,
  case_status: 'pending',
  case_kind: 'standard',
  case_server_id: 'guild-1',
  case_user_id: 'user-1',
  provider: 'turnstile',
  method_revision: 0,
  server_settings: { captcha_mode: 'manual' },
};
const input = {
  challengeId: row.id,
  generation: 1,
  idempotencyKey: 'native:interaction-1',
  provider: 'turnstile' as const,
};
const attempt = {
  id: '00000000-0000-4000-8000-000000000004',
  captcha_challenge_id: row.id,
  generation: 1,
  discord_user_id: 'user-1',
  validation_state: 'started',
};
const completion: CaptchaCompletionInput = {
  ...input,
  attemptId: attempt.id,
  validation: {
    state: 'passed',
    success: true,
    action: 'drasil_case_access',
    hostname: 'drasil.example',
    errorCodes: [],
  },
};
function harness(
  options: {
    generation?: number;
    user?: number;
    service?: number;
    queueEmpty?: boolean;
    passUpdate?: boolean;
    challenge?: Partial<Omit<typeof row, 'server_settings'>> & { server_settings?: unknown };
    attempt?: Partial<typeof attempt>;
    imageAvailable?: boolean;
    existingAttempt?: boolean;
  } = {}
): { query: jest.Mock; store: ReturnType<typeof createCaptchaCompletionStore> } {
  const query = jest.fn();
  query.mockImplementation(async (statement: string) => {
    if (statement.startsWith('select server_id') || statement.includes('from captcha_challenges c'))
      return { rows: [{ ...row, ...options.challenge }] };
    if (statement.includes('from captcha_challenge_attempts where id ='))
      return { rows: [{ ...attempt, ...options.attempt }] };
    if (statement.includes('from captcha_challenge_images'))
      return { rows: options.imageAvailable ? [{ generation: 1 }] : [] };
    if (statement.includes('where idempotency_key ='))
      return { rows: options.existingAttempt ? [{ ...attempt, ...options.attempt }] : [] };
    if (statement.includes('generation_count'))
      return {
        rows: [
          {
            generation_count: String(options.generation ?? 0),
            recent_user_count: String(options.user ?? 0),
            recent_service_count: String(options.service ?? 0),
          },
        ],
      };
    if (statement.includes('insert into captcha_challenge_attempts')) return { rows: [attempt] };
    if (statement.includes("set status = 'passed'"))
      return { rows: options.passUpdate === false ? [] : [{ id: row.id }] };
    if (statement.includes("set status = 'failed'")) return { rows: [{ id: row.id }] };
    if (statement.includes('insert into moderation_action_requests'))
      return { rows: options.queueEmpty ? [] : [{ id: 'request', status: 'queued' }] };
    return { rows: [] };
  });
  const database: DelegationDatabase = {
    query,
    async transaction(operation) {
      return operation({ query });
    },
  };
  return { query, store: createCaptchaCompletionStore(database) };
}
describe('shared CAPTCHA completion store', () => {
  it.each([{ user: 10 }, { service: 100 }])(
    'keeps per-user and service rate limits without inserting submissions',
    async (limits) => {
      const { store, query } = harness(limits);
      expect(await store.beginAttempt(context, input)).toMatchObject({ state: 'rate_limited' });
      expect(
        query.mock.calls.some(([sql]) => sql.includes('insert into captcha_challenge_attempts'))
      ).toBe(false);
    }
  );
  it.each([99, 100])(
    'fails the generation at its bounded attempt cap %s and queues attention',
    async (generation) => {
      const { store, query } = harness({ generation });
      expect(await store.beginAttempt(context, input)).toMatchObject({
        state: 'stale',
        challenge: { status: 'failed' },
      });
      const receipt = query.mock.calls.find(([sql]) =>
        sql.includes('insert into moderation_action_requests')
      );
      expect(receipt?.[1]).toEqual(
        expect.arrayContaining([
          'notify_captcha_attention',
          `captcha:attention:${row.id}:1:submission-limit`,
        ])
      );
    }
  );
  it('uses server, case, challenge, then attempt locks before recording a pass', async () => {
    const { store, query } = harness();
    expect(await store.completeAttempt(context, completion)).toBe('passed');
    const locks = query.mock.calls
      .filter(([sql]) => sql.includes('for update'))
      .map(([sql]) => sql);
    expect(locks).toEqual([
      'select guild_id from servers where guild_id = $1 for update',
      'select id from verification_events where id = $1::uuid for update',
      'select id from captcha_challenges where id = $1::uuid for update',
      expect.stringContaining('from captcha_challenge_attempts where id = $1::uuid for update'),
    ]);
    expect(
      query.mock.calls.find(([sql]) => sql.includes('insert into moderation_action_requests'))?.[1]
    ).toEqual(expect.arrayContaining(['apply_captcha_pass', `captcha:apply:${row.id}:1`]));
  });
  it('requires the existing queue insertion to return a durable receipt', async () => {
    const { store } = harness({ queueEmpty: true });
    await expect(store.completeAttempt(context, completion)).rejects.toThrow(
      'Failed to enqueue moderation action request.'
    );
  });
  it('preserves a stale outcome when the pass compare-and-swap cannot accept', async () => {
    const { store, query } = harness({ passUpdate: false });
    expect(await store.completeAttempt(context, completion)).toBe('stale');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('insert into moderation_action_requests'))
    ).toBe(false);
  });
  it('accepts bounded server-derived native keys and rejects malformed keys', async () => {
    const { store, query } = harness();
    expect(await store.beginAttempt(context, input)).toMatchObject({
      state: 'ready',
      attemptId: attempt.id,
    });
    query.mockClear();
    expect(
      await store.beginAttempt(context, { ...input, idempotencyKey: 'x'.repeat(201) })
    ).toEqual({ state: 'unavailable' });
    expect(query).not.toHaveBeenCalled();
  });
  it('retires abandoned provider attempts after sixty seconds without charging submissions', async () => {
    const { store, query } = harness();
    await store.beginAttempt(context, input);
    const retirement = query.mock.calls.find(([sql]) =>
      sql.includes("set validation_state = 'provider_error'")
    );
    expect(retirement?.[1][2].getTime()).toBeGreaterThanOrEqual(Date.now() - 60_100);
    expect(retirement?.[1][2].getTime()).toBeLessThanOrEqual(Date.now() - 59_900);
    expect(retirement?.[0]).toContain("validation_state = 'started'");
    const limits = query.mock.calls.find(([sql]) => sql.includes('generation_count'))?.[0];
    expect(limits).toContain(
      "validation_state <> 'provider_error'::captcha_attempt_validation_state"
    );
  });
  it.each([
    { context: { ...context, guildId: 'another-guild' } },
    { context: { ...context, actor: { kind: 'user' as const, userId: 'another-user' } } },
    {
      context: {
        ...context,
        actor: { kind: 'system' as const, purpose: 'captcha_pass' as const },
      },
    },
    { attempt: { discord_user_id: 'another-user' } },
    { attempt: { captcha_challenge_id: '00000000-0000-4000-8000-000000000099' } },
    { attempt: { generation: 2 } },
    { input: { ...completion, generation: 2 } },
    { challenge: { provider: 'discord_image' } },
  ])(
    'rejects completion with a mismatched binding %# without recording validation',
    async (change) => {
      const { store, query } = harness({
        ...change,
        challenge: {
          submission_count: 2,
          server_settings: { captcha_mode: 'manual', captcha_max_submissions: 2 },
          ...change.challenge,
        },
      });
      expect(
        await store.completeAttempt(change.context ?? context, change.input ?? completion)
      ).toBe('stale');
      expect(query.mock.calls.some(([sql]) => sql.startsWith('update '))).toBe(false);
    }
  );

  it.each([
    { status: 'cancelled' },
    { case_status: 'verified' },
    { case_kind: 'observation' },
    { method_revision: 1 },
    { server_settings: { captcha_mode: 'off' } },
    { server_settings: { captcha_mode: 'manual', captcha_method: 'discord_image' } },
    { expires_at: new Date(0) },
  ])(
    'marks a no longer eligible completion stale %# without charging a submission',
    async (challenge) => {
      const { store, query } = harness({ challenge: { submission_count: 20, ...challenge } });
      expect(await store.completeAttempt(context, completion)).toBe('stale');
      const writes = query.mock.calls.filter(([sql]) => sql.startsWith('update '));
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toContain("set validation_state = 'stale'");
      expect(
        query.mock.calls.some(([sql]) => sql.includes('insert into moderation_action_requests'))
      ).toBe(false);
    }
  );

  it.each(['passed', 'invalid'] as const)(
    'locks the exact image issuance after the attempt before accepting %s',
    async (state) => {
      const { store, query } = harness({
        challenge: {
          provider: 'discord_image',
          server_settings: { captcha_mode: 'manual', captcha_method: 'discord_image' },
        },
        imageAvailable: true,
      });
      const proof = { keyVersion: 'a'.repeat(64), answerDigest: 'b'.repeat(64) };
      expect(
        await store.completeAttempt(context, {
          ...completion,
          provider: 'discord_image',
          imageIssuance: proof,
          validation: { ...completion.validation, state, success: state === 'passed' },
        })
      ).toEqual(state === 'invalid' ? { state: 'invalid', remainingAttempts: 4 } : state);
      const locks = query.mock.calls.filter(([sql]) => sql.includes('for update'));
      expect(locks[3][0]).toContain('from captcha_challenge_attempts');
      expect(locks[4][0]).toContain('from captcha_challenge_images');
      expect(locks[4][1]).toEqual([row.id, row.generation, proof.keyVersion, proof.answerDigest]);
    }
  );

  it.each([
    { keyVersion: 'a'.repeat(64), answerDigest: 'b'.repeat(64) },
    { keyVersion: 'invalid-key', answerDigest: 'b'.repeat(64) },
    { keyVersion: 'a'.repeat(64), answerDigest: 'invalid-digest' },
  ])('rejects an unbound or malformed image issuance %#', async (proof) => {
    const { store, query } = harness({
      challenge: {
        provider: 'discord_image',
        submission_count: 2,
        server_settings: {
          captcha_mode: 'manual',
          captcha_method: 'discord_image',
          captcha_max_submissions: 2,
        },
      },
    });
    expect(
      await store.completeAttempt(context, {
        ...completion,
        provider: 'discord_image',
        imageIssuance: proof,
      })
    ).toBe('stale');
    expect(query.mock.calls.some(([sql]) => sql.includes('provider_success ='))).toBe(false);
    expect(
      query.mock.calls.some(([sql]) => sql.includes('insert into moderation_action_requests'))
    ).toBe(false);
  });
  describe.each(['turnstile', 'discord_image'] as const)(
    'lowered %s submission cap',
    (provider) => {
      const cappedChallenge = {
        provider,
        submission_count: 2,
        server_settings: {
          captcha_mode: 'manual',
          captcha_method: provider,
          captcha_max_submissions: 2,
        },
      };
      const cappedCompletion: CaptchaCompletionInput = {
        ...completion,
        ...(provider === 'discord_image'
          ? {
              provider,
              imageIssuance: { keyVersion: 'a'.repeat(64), answerDigest: 'b'.repeat(64) },
            }
          : { provider }),
      };
      it('fails an exhausted pending challenge before starting more provider work', async () => {
        const { store, query } = harness({ challenge: cappedChallenge });
        expect(await store.beginAttempt(context, { ...input, provider })).toMatchObject({
          state: 'stale',
          challenge: { status: 'failed' },
        });
        expect(
          query.mock.calls.some(([sql]) => sql.includes('insert into captcha_challenge_attempts'))
        ).toBe(false);
        expect(
          query.mock.calls.find(([sql]) =>
            sql.includes('insert into moderation_action_requests')
          )?.[1]
        ).toEqual(
          expect.arrayContaining([
            'notify_captcha_attention',
            `captcha:attention:${row.id}:1:submission-limit`,
          ])
        );
      });
      it('fails a valid completion without accepting its proof or charging a submission', async () => {
        const { store, query } = harness({ challenge: cappedChallenge, imageAvailable: true });
        expect(await store.completeAttempt(context, cappedCompletion)).toBe('failed');
        expect(
          query.mock.calls.some(([sql]) => sql.includes("set validation_state = 'stale'"))
        ).toBe(true);
        expect(query.mock.calls.some(([sql]) => sql.includes('provider_success ='))).toBe(false);
        expect(query.mock.calls.some(([sql]) => sql.includes("set status = 'failed'"))).toBe(true);
        expect(
          query.mock.calls.find(([sql]) =>
            sql.includes('insert into moderation_action_requests')
          )?.[1]
        ).toEqual(
          expect.arrayContaining([
            'notify_captcha_attention',
            `captcha:attention:${row.id}:1:submission-limit`,
          ])
        );
      });
      it('preserves the stored outcome for duplicate completions', async () => {
        const { store, query } = harness({
          challenge: cappedChallenge,
          attempt: { validation_state: 'invalid' },
        });
        expect(await store.completeAttempt(context, cappedCompletion)).toEqual({
          state: 'invalid',
          remainingAttempts: null,
        });
        expect(query.mock.calls.some(([sql]) => sql.startsWith('update '))).toBe(false);
      });
      it('preserves a bound duplicate start without creating more work', async () => {
        const { store, query } = harness({ challenge: cappedChallenge, existingAttempt: true });
        expect(await store.beginAttempt(context, { ...input, provider })).toMatchObject({
          state: 'duplicate',
          attemptId: attempt.id,
        });
        expect(query.mock.calls.some(([sql]) => sql.startsWith('update '))).toBe(false);
      });
    }
  );
  it('returns the remaining invalid-answer allowance from the locked settings and count', async () => {
    const { store } = harness({
      challenge: {
        submission_count: 3,
        server_settings: { captcha_mode: 'manual', captcha_max_submissions: 10 },
      },
    });
    expect(
      await store.completeAttempt(context, {
        ...completion,
        validation: { ...completion.validation, state: 'invalid', success: false },
      })
    ).toEqual({ state: 'invalid', remainingAttempts: 6 });
  });
  it('returns the current locked allowance for a duplicate invalid completion without another charge', async () => {
    const { store, query } = harness({
      challenge: {
        submission_count: 4,
        server_settings: { captcha_mode: 'manual', captcha_max_submissions: 10 },
      },
      attempt: { validation_state: 'invalid' },
    });
    expect(await store.completeAttempt(context, completion)).toEqual({
      state: 'invalid',
      remainingAttempts: 6,
    });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('update '))).toBe(false);
  });
  it.each([
    { status: 'failed' },
    { case_status: 'verified' },
    { case_kind: 'observation' },
    { method_revision: 1 },
    { expires_at: new Date(0) },
    { submission_count: 5 },
    { server_settings: { captcha_mode: 'off' } },
  ])(
    'withholds duplicate invalid allowance when the challenge is no longer eligible %#',
    async (challenge) => {
      const { store, query } = harness({ challenge, attempt: { validation_state: 'invalid' } });
      expect(await store.completeAttempt(context, completion)).toEqual({
        state: 'invalid',
        remainingAttempts: null,
      });
      expect(query.mock.calls.some(([sql]) => sql.startsWith('update '))).toBe(false);
    }
  );
  it.each([
    { generation: 2 },
    { provider: 'discord_image' },
    { id: '00000000-0000-4000-8000-000000000099' },
  ])(
    'returns stale when the bound challenge changed before an attempt starts %#',
    async (challenge) => {
      const { store, query } = harness({ challenge });
      expect(await store.beginAttempt(context, input)).toMatchObject({ state: 'stale' });
      expect(
        query.mock.calls.some(([sql]) => sql.startsWith('update ') || sql.startsWith('insert '))
      ).toBe(false);
    }
  );
  it.each([
    { ...context, guildId: 'wrong-guild' },
    { ...context, actor: { kind: 'user' as const, userId: 'wrong-user' } },
  ])('retains identity mismatch for a different actor or guild %#', async (wrongContext) => {
    const { store, query } = harness();
    expect(await store.beginAttempt(wrongContext, input)).toMatchObject({
      state: 'identity_mismatch',
    });
    expect(
      query.mock.calls.some(([sql]) => sql.startsWith('update ') || sql.startsWith('insert '))
    ).toBe(false);
  });
});
