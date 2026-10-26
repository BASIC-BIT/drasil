import { describe, expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createCaptchaOAuthState,
  encodeCaptchaOAuthState,
  getCaptchaOAuthStateCookieName,
} from '@/lib/captchaSession';
const runtime = vi.hoisted(() => ({
  load: vi.fn(),
  mismatch: vi.fn(),
  exchange: vi.fn(),
  user: vi.fn(),
}));
vi.mock('@/lib/captchaCompletion', () => ({
  getCaptchaPublicChallenge: runtime.load,
  recordCaptchaIdentityMismatch: runtime.mismatch,
}));
vi.mock('@/lib/discordApi', () => ({
  exchangeDiscordCode: runtime.exchange,
  fetchDiscordUser: runtime.user,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
import { GET } from './route';

describe('CAPTCHA Discord OAuth callback', () => {
  it('returns a safe response when the bound state cookie is missing', async () => {
    const state = 'a'.repeat(32);
    const request = new NextRequest(
      `https://drasil.example/api/captcha/auth/callback?code=code-1&state=${state}`
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('set-cookie')).toContain(
      `${getCaptchaOAuthStateCookieName(state)}=`
    );
    await expect(response.text()).resolves.toContain('Open the CAPTCHA in Discord');
  });
  it('records mismatches using authenticated Discord identity and the bound challenge', async () => {
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'callback-test-secret');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
    const state = createCaptchaOAuthState('link');
    runtime.load.mockResolvedValue({
      id: 'challenge',
      generation: 2,
      serverId: 'guild',
      userId: 'target',
      status: 'pending',
    });
    runtime.exchange.mockResolvedValue({ access_token: 'runtime-token' });
    runtime.user.mockResolvedValue({ id: 'other' });
    const request = new NextRequest(
      `https://drasil.example/api/captcha/auth/callback?code=code&state=${state.state}`,
      {
        headers: {
          cookie: `${getCaptchaOAuthStateCookieName(state.state)}=${encodeCaptchaOAuthState(state)}`,
        },
      }
    );
    const response = await GET(request);
    expect(response.headers.get('location')).toBe(
      'https://drasil.example/captcha/link?auth=mismatch'
    );
    expect(runtime.mismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild',
        source: 'captcha',
        actor: { kind: 'user', userId: 'other' },
      }),
      expect.objectContaining({
        challengeId: 'challenge',
        generation: 2,
        discordUserId: 'other',
        token: 'link',
        idempotencyKey: expect.stringMatching(/^captcha-oauth:/),
      })
    );
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
