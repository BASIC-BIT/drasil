import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { OAUTH_STATE_MAX_AGE_SECONDS } from './cookies';
import { decryptJson, encryptJson } from './crypto';
import { getOauthEncryptionSecret } from './session';

const oauthStateSchema = z.object({
  state: z.string(),
  returnTo: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

export type OAuthState = z.infer<typeof oauthStateSchema>;

export function createOAuthState(returnTo: string): OAuthState {
  const issuedAt = Date.now();
  return {
    state: randomBytes(24).toString('base64url'),
    returnTo,
    issuedAt,
    expiresAt: issuedAt + OAUTH_STATE_MAX_AGE_SECONDS * 1000,
  };
}

export function encodeOAuthState(state: OAuthState): string {
  return encryptJson(state, getOauthEncryptionSecret());
}

export function decodeOAuthState(value: string | undefined): OAuthState | null {
  if (!value) {
    return null;
  }
  const parsed = oauthStateSchema.safeParse(decryptJson(value, getOauthEncryptionSecret()));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    return null;
  }
  return parsed.data;
}
