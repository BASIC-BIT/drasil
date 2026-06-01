import { describe, expect, it, vi } from 'vitest';
import { createOAuthState, decodeOAuthState, encodeOAuthState } from './oauthState';

describe('OAuth state cookies', () => {
  it('round-trips encrypted OAuth state without exposing plaintext', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'test-oauth-secret');
    const state = createOAuthState('/admin');

    const encoded = encodeOAuthState(state);

    expect(encoded).not.toContain('/admin');
    expect(encoded).not.toContain(state.state);
    expect(decodeOAuthState(encoded)).toMatchObject({ state: state.state, returnTo: '/admin' });
  });
});
