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
  } = {}
): { query: jest.Mock; store: ReturnType<typeof createCaptchaCompletionStore> } {
  const query = jest.fn();
  query.mockImplementation(async (statement: string) => {
    if (statement.startsWith('select server_id') || statement.includes('from captcha_challenges c'))
      return { rows: [row] };
    if (statement.includes('from captcha_challenge_attempts where id ='))
      return { rows: [attempt] };
    if (statement.includes('where idempotency_key =')) return { rows: [] };
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
});
