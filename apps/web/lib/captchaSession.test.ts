import { describe, expect, it, vi } from 'vitest';
import {
  createCaptchaIdentity,
  createCaptchaOAuthState,
  decodeCaptchaIdentity,
  decodeCaptchaOAuthState,
  encodeCaptchaIdentity,
  encodeCaptchaOAuthState,
  getCaptchaIdentityCookieName,
  getCaptchaOAuthStateCookieName,
} from './captchaSession';
import {
  CAPTCHA_IDENTITY_COOKIE,
  CAPTCHA_IDENTITY_MAX_AGE_SECONDS,
  CAPTCHA_OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from './cookies';

describe('CAPTCHA browser session cookies', () => {
  it('encrypts the opaque challenge token in OAuth state', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'test-oauth-secret');
    const state = createCaptchaOAuthState('opaque-challenge-token');

    const encoded = encodeCaptchaOAuthState(state);

    expect(state.expiresAt - state.issuedAt).toBe(OAUTH_STATE_MAX_AGE_SECONDS * 1000);
    expect(encoded).not.toContain('opaque-challenge-token');
    expect(encoded).not.toContain(state.state);
    expect(decodeCaptchaOAuthState(encoded)).toMatchObject({
      state: state.state,
      token: 'opaque-challenge-token',
    });
  });

  it('signs the short-lived identity without including an OAuth access token', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    const identity = createCaptchaIdentity({
      challengeId: '54a8589e-b63a-4ea6-86b6-78169955b3f1',
      generation: 2,
      userId: 'user-1',
    });

    const encoded = encodeCaptchaIdentity(identity);

    expect(identity.expiresAt - identity.issuedAt).toBe(CAPTCHA_IDENTITY_MAX_AGE_SECONDS * 1000);
    expect(decodeCaptchaIdentity(encoded)).toMatchObject({
      challengeId: identity.challengeId,
      generation: 2,
      userId: 'user-1',
    });
    expect(encoded).not.toContain('discord-access-token');
  });

  it('rejects expired OAuth and identity state', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'test-oauth-secret');
    const state = createCaptchaOAuthState('opaque-challenge-token');
    const identity = createCaptchaIdentity({
      challengeId: '54a8589e-b63a-4ea6-86b6-78169955b3f1',
      generation: 1,
      userId: 'user-1',
    });
    vi.spyOn(Date, 'now').mockReturnValue(Math.max(state.expiresAt, identity.expiresAt) + 1);

    expect(decodeCaptchaOAuthState(encodeCaptchaOAuthState(state))).toBeNull();
    expect(decodeCaptchaIdentity(encodeCaptchaIdentity(identity))).toBeNull();
  });

  it('isolates OAuth state and identity cookies for concurrent challenge tabs', () => {
    const firstState = 'a'.repeat(32);
    const secondState = 'b'.repeat(32);
    const challengeId = '54a8589e-b63a-4ea6-86b6-78169955b3f1';
    const firstStateCookie = getCaptchaOAuthStateCookieName(firstState);
    const secondStateCookie = getCaptchaOAuthStateCookieName(secondState);
    const firstIdentityCookie = getCaptchaIdentityCookieName(challengeId, 1);
    const secondIdentityCookie = getCaptchaIdentityCookieName(challengeId, 2);

    expect(firstStateCookie).toBe(getCaptchaOAuthStateCookieName(firstState));
    expect(firstStateCookie).not.toBe(secondStateCookie);
    expect(firstStateCookie).toMatch(new RegExp(`^${CAPTCHA_OAUTH_STATE_COOKIE}_[A-Za-z0-9_-]+$`));
    expect(firstIdentityCookie).not.toBe(secondIdentityCookie);
    expect(firstIdentityCookie).toMatch(new RegExp(`^${CAPTCHA_IDENTITY_COOKIE}_[A-Za-z0-9_-]+$`));
    expect(getCaptchaOAuthStateCookieName('invalid state')).toBeNull();
    expect(() => getCaptchaIdentityCookieName('invalid challenge', 1)).toThrow(
      'CAPTCHA challenge identity is invalid.'
    );
  });
});
