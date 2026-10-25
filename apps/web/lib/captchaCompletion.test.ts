import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  pool: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  mismatch: vi.fn(),
  requeue: vi.fn(),
}));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: runtime.pool }));
vi.mock('@drasil/application/postgres', async (original) => ({
  ...(await original<typeof import('@drasil/application/postgres')>()),
  createCaptchaCompletionStore: () => ({
    beginAttempt: runtime.begin,
    completeAttempt: runtime.complete,
    recordIdentityMismatch: runtime.mismatch,
    requeuePassEffect: runtime.requeue,
  }),
}));
import {
  beginCaptchaAttempt,
  completeCaptchaAttempt,
  getCaptchaFormConfiguration,
  getCaptchaPublicChallenge,
  recordCaptchaIdentityMismatch,
  requeueCaptchaPassEffect,
} from './captchaCompletion';

const context = {
  guildId: 'guild-1',
  requestId: 'attempt',
  source: 'captcha',
  actor: { kind: 'user' as const, userId: 'user-1' },
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
  provider: 'turnstile',
  method_revision: 0,
  server_settings: { captcha_mode: 'manual' },
};
const identity = {
  challengeId: row.id,
  generation: 1,
  userId: row.user_id,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};
const nonce = '00000000-0000-4000-8000-000000000004';
const completion = {
  challengeId: row.id,
  generation: 1,
  provider: 'turnstile' as const,
  attemptId: nonce,
  validation: {
    state: 'passed' as const,
    success: true,
    action: 'drasil_case_access',
    hostname: 'drasil.example',
    errorCodes: [],
  },
};
const originalSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const originalSecret = process.env.DRASIL_CAPTCHA_BINDING_SECRET;
describe('CAPTCHA web transport boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.pool.mockReturnValue({ query: vi.fn(async () => ({ rows: [row] })) });
    runtime.begin.mockResolvedValue({ state: 'ready', attemptId: nonce });
    runtime.complete.mockResolvedValue('passed');
  });
  afterEach(() => {
    if (originalSiteKey === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSiteKey;
    if (originalSecret === undefined) delete process.env.DRASIL_CAPTCHA_BINDING_SECRET;
    else process.env.DRASIL_CAPTCHA_BINDING_SECRET = originalSecret;
  });
  it('returns no form when Turnstile configuration is missing', () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.DRASIL_CAPTCHA_BINDING_SECRET;
    expect(getCaptchaFormConfiguration(row.id, 1)).toBeNull();
  });
  it.each(['bad-token', '', 'a'.repeat(44)])(
    'rejects malformed public tokens %s before lookup',
    async (token) => {
      expect(await getCaptchaPublicChallenge(token)).toBeNull();
      expect(runtime.pool).not.toHaveBeenCalled();
    }
  );
  it('looks up only the token hash and never exposes image challenges', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...row, provider: 'discord_image' }] }));
    runtime.pool.mockReturnValue({ query });
    expect(await getCaptchaPublicChallenge('a'.repeat(43))).toBeNull();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("c.provider = 'turnstile'"), [
      '66d34fba71f8f450f7e45598853e53bfc23bbd129027cbb131a2f4ffd7878cd0',
    ]);
  });
  it.each([
    { case_kind: 'compromised_account' },
    { server_settings: { captcha_mode: 'off' } },
    { server_settings: { captcha_mode: 'manual', captcha_method: 'discord_image' } },
    {
      server_settings: {
        captcha_mode: 'manual',
        captcha_method: 'turnstile',
        captcha_method_revision: 1,
      },
    },
  ])('presents ineligible pending challenges as cancelled', async (change) => {
    runtime.pool.mockReturnValue({ query: vi.fn(async () => ({ rows: [{ ...row, ...change }] })) });
    expect(await getCaptchaPublicChallenge('a'.repeat(43))).toMatchObject({ status: 'cancelled' });
  });
  it('binds browser attempt to the token, OAuth reference and Turnstile provider', async () => {
    expect(
      await beginCaptchaAttempt(context, { token: 'a'.repeat(43), identity, idempotencyKey: nonce })
    ).toMatchObject({ state: 'ready' });
    expect(runtime.begin).toHaveBeenCalledWith(context, {
      challengeId: row.id,
      generation: 1,
      idempotencyKey: nonce,
      provider: 'turnstile',
    });
  });
  it.each([
    { identity: { ...identity, generation: 2 }, idempotencyKey: nonce },
    { identity: { ...identity, challengeId: nonce }, idempotencyKey: nonce },
    { identity, idempotencyKey: 'discord-image:interaction' },
  ])('rejects token/reference mismatch and non-UUID web nonce', async (input) => {
    expect(await beginCaptchaAttempt(context, { token: 'a'.repeat(43), ...input })).toEqual({
      state: 'unavailable',
    });
    expect(runtime.begin).not.toHaveBeenCalled();
  });
  it('rejects an OAuth actor mismatch before invoking shared transactions', async () => {
    expect(
      await beginCaptchaAttempt(context, {
        token: 'a'.repeat(43),
        identity: { ...identity, userId: 'other' },
        idempotencyKey: nonce,
      })
    ).toEqual({ state: 'identity_mismatch' });
    expect(runtime.begin).not.toHaveBeenCalled();
  });
  it('records an authenticated OAuth mismatch with its server-derived namespace', async () => {
    const actor = { ...context, actor: { kind: 'user' as const, userId: 'other' } };
    await recordCaptchaIdentityMismatch(actor, {
      token: 'a'.repeat(43),
      discordUserId: 'other',
      challengeId: row.id,
      generation: 1,
      idempotencyKey: 'captcha-oauth:authenticated-state',
    });
    expect(runtime.mismatch).toHaveBeenCalledWith(actor, {
      challengeId: row.id,
      generation: 1,
      idempotencyKey: 'captcha-oauth:authenticated-state',
      provider: 'turnstile',
    });
  });
  it('passes server-verified Turnstile outcomes through the existing action boundary', async () => {
    expect(await completeCaptchaAttempt(context, completion)).toBe('passed');
    expect(runtime.complete).toHaveBeenCalledWith(context, completion);
    expect(
      await completeCaptchaAttempt(context, {
        ...completion,
        provider: 'discord_image',
        imageIssuance: { keyVersion: 'test-key', answerDigest: 'a'.repeat(64) },
      })
    ).toBe('stale');
    expect(runtime.complete).toHaveBeenCalledTimes(1);
  });
  it.each([2, null])(
    'preserves the public invalid state for locked remainder %s',
    async (remainingAttempts) => {
      runtime.complete.mockResolvedValue({ state: 'invalid', remainingAttempts });
      expect(
        await completeCaptchaAttempt(context, {
          ...completion,
          validation: { ...completion.validation, state: 'invalid', success: false },
        })
      ).toBe('invalid');
    }
  );
  it('requeues a pass through the system-only exact-case reference', async () => {
    await requeueCaptchaPassEffect({
      id: row.id,
      verificationEventId: row.verification_event_id,
      serverId: row.server_id,
      userId: row.user_id,
      status: 'passed',
      generation: 1,
      caseRevision: 2,
      expiresAt: row.expires_at,
    });
    expect(runtime.requeue).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: 'system', purpose: 'captcha_pass' } }),
      {
        challengeId: row.id,
        generation: 1,
        caseId: row.verification_event_id,
        targetUserId: row.user_id,
        expectedCaseRevision: 2,
      }
    );
  });
});
