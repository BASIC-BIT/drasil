import { describe, expect, it, vi } from 'vitest';
import {
  createAdminSession,
  decodeAdminSession,
  decodeDiscordTokenSession,
  encodeAdminSession,
  encodeDiscordTokenSession,
} from './session';

describe('session cookies', () => {
  it('round-trips signed admin sessions', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    const session = createAdminSession({
      userId: 'user-1',
      username: 'Admin',
      avatarUrl: null,
    });

    expect(decodeAdminSession(encodeAdminSession(session))).toMatchObject({ userId: 'user-1' });
  });

  it('does not expose Discord OAuth tokens as plaintext', () => {
    vi.stubEnv('DRASIL_SESSION_SECRET', 'test-session-secret');
    vi.stubEnv('DRASIL_OAUTH_ENCRYPTION_KEY', 'test-oauth-secret');
    const encoded = encodeDiscordTokenSession({
      accessToken: 'discord-access-token',
      expiresAt: Date.now() + 60_000,
    });

    expect(encoded).not.toContain('discord-access-token');
    expect(decodeDiscordTokenSession(encoded)?.accessToken).toBe('discord-access-token');
  });
});
