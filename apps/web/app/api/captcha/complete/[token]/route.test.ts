import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCaptchaIdentity,
  encodeCaptchaIdentity,
  getCaptchaIdentityCookieName,
} from '@/lib/captchaSession';
const runtime = vi.hoisted(() => ({
  begin: vi.fn(),
  complete: vi.fn(),
  load: vi.fn(),
  requeue: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/captchaCompletion', () => ({
  beginCaptchaAttempt: runtime.begin,
  completeCaptchaAttempt: runtime.complete,
  getCaptchaPublicChallenge: runtime.load,
  requeueCaptchaPassEffect: runtime.requeue,
  buildCaptchaCdata: () => 'bound-cdata',
}));
vi.mock('@/lib/turnstile', () => ({ validateTurnstileToken: runtime.verify }));
import { POST } from './route';
const challenge = {
  id: '00000000-0000-4000-8000-000000000001',
  generation: 1,
  serverId: 'guild',
  userId: 'target',
  status: 'pending',
  verificationEventId: 'case',
  caseRevision: 2,
  expiresAt: new Date(Date.now() + 60000),
};
const validation = {
  state: 'passed',
  success: true,
  action: 'drasil_case_access',
  hostname: 'drasil.example',
  errorCodes: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DRASIL_SESSION_SECRET', 'captcha-test-secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
  runtime.load.mockResolvedValue(challenge);
  runtime.begin.mockResolvedValue({ state: 'ready', attemptId: 'attempt', challenge });
  runtime.verify.mockResolvedValue(validation);
  runtime.complete.mockResolvedValue('passed');
});
afterEach(() => vi.unstubAllEnvs());
function request(cookie: string | null, origin = 'https://drasil.example') {
  const form = new FormData();
  form.set('attempt-id', 'request');
  form.set('turnstile-response', 'provider-token');
  return new NextRequest('https://drasil.example/api/captcha/complete/link', {
    method: 'POST',
    headers: {
      origin,
      ...(cookie ? { cookie: `${getCaptchaIdentityCookieName(challenge.id, 1)}=${cookie}` } : {}),
    },
    body: form,
  });
}
it('uses authenticated target context and only a verified provider outcome for completion', async () => {
  const cookie = encodeCaptchaIdentity(
    createCaptchaIdentity({ challengeId: challenge.id, generation: 1, userId: 'target' })
  );
  const response = await POST(request(cookie), { params: Promise.resolve({ token: 'link' }) });
  expect(response.headers.get('location')).toBe(
    'https://drasil.example/captcha/link?result=completed'
  );
  expect(runtime.begin).toHaveBeenCalledWith(
    expect.objectContaining({
      guildId: 'guild',
      requestId: 'request',
      source: 'captcha',
      actor: { kind: 'user', userId: 'target' },
    }),
    expect.objectContaining({ token: 'link' })
  );
  expect(runtime.complete).toHaveBeenCalledWith(
    expect.objectContaining({ actor: { kind: 'user', userId: 'target' } }),
    { challengeId: challenge.id, generation: 1, attemptId: 'attempt', validation }
  );
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
});
it('rejects tampered identity cookies before provider verification', async () => {
  const response = await POST(request('tampered'), { params: Promise.resolve({ token: 'link' }) });
  expect(response.headers.get('location')).toContain('result=authenticate');
  expect(runtime.begin).not.toHaveBeenCalled();
  expect(runtime.verify).not.toHaveBeenCalled();
});
it('rejects cross-origin posts before loading or mutating a challenge', async () => {
  expect(
    (
      await POST(request(null, 'https://other.example'), {
        params: Promise.resolve({ token: 'link' }),
      })
    ).status
  ).toBe(403);
  expect(runtime.load).not.toHaveBeenCalled();
});
it('recovers an already passed challenge without invoking the provider', async () => {
  runtime.load.mockResolvedValue({ ...challenge, status: 'passed' });
  const response = await POST(request(null), { params: Promise.resolve({ token: 'link' }) });
  expect(response.headers.get('location')).toContain('result=completed');
  expect(runtime.requeue).toHaveBeenCalledTimes(1);
  expect(runtime.verify).not.toHaveBeenCalled();
});
