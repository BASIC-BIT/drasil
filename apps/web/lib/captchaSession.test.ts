import { describe, expect, it, vi } from 'vitest';
import {
  createCaptchaIdentity,
  createCaptchaOAuthState,
  decodeCaptchaIdentity,
  decodeCaptchaOAuthState,
  encodeCaptchaIdentity,
  encodeCaptchaOAuthState,
} from './captchaSession';

describe('CAPTCHA browser session cookies', () => {
  it('encrypts the opaque challenge token in OAuth state', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'test-oauth-secret');
    const state = createCaptchaOAuthState('opaque-challenge-token');

    const encoded = encodeCaptchaOAuthState(state);

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
});
