import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CAPTCHA_IDENTITY_COOKIE,
  CAPTCHA_IDENTITY_MAX_AGE_SECONDS,
  CAPTCHA_OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
} from './cookies';
import { decodeSignedJson, decryptJson, encodeSignedJson, encryptJson } from './crypto';
import { getOauthEncryptionSecret, getSessionSecret } from './session';

const captchaOAuthStateSchema = z.object({
  state: z.string(),
  token: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

const captchaIdentitySchema = z.object({
  challengeId: z.string().uuid(),
  generation: z.number().int().positive(),
  userId: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

export type CaptchaOAuthState = z.infer<typeof captchaOAuthStateSchema>;
export type CaptchaIdentity = z.infer<typeof captchaIdentitySchema>;

function cookieBindingSuffix(value: string): string {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url').slice(0, 32);
}

export function getCaptchaOAuthStateCookieName(state: string): string {
  return `${CAPTCHA_OAUTH_STATE_COOKIE}_${cookieBindingSuffix(state)}`;
}

export function getCaptchaIdentityCookieName(challengeId: string, generation: number): string {
  return `${CAPTCHA_IDENTITY_COOKIE}_${cookieBindingSuffix(`${challengeId}:${generation}`)}`;
}

export function createCaptchaOAuthState(token: string): CaptchaOAuthState {
  const issuedAt = Date.now();
  return {
    state: randomBytes(24).toString('base64url'),
    token,
    issuedAt,
    expiresAt: issuedAt + OAUTH_STATE_MAX_AGE_SECONDS * 1000,
  };
}

export function encodeCaptchaOAuthState(state: CaptchaOAuthState): string {
  return encryptJson(state, getOauthEncryptionSecret());
}

export function decodeCaptchaOAuthState(value: string | undefined): CaptchaOAuthState | null {
  if (!value) {
    return null;
  }
  const parsed = captchaOAuthStateSchema.safeParse(decryptJson(value, getOauthEncryptionSecret()));
  return parsed.success && parsed.data.expiresAt > Date.now() ? parsed.data : null;
}

export function createCaptchaIdentity(input: {
  challengeId: string;
  generation: number;
  userId: string;
}): CaptchaIdentity {
  const issuedAt = Date.now();
  return {
    ...input,
    issuedAt,
    expiresAt: issuedAt + CAPTCHA_IDENTITY_MAX_AGE_SECONDS * 1000,
  };
}

export function encodeCaptchaIdentity(identity: CaptchaIdentity): string {
  return encodeSignedJson(identity, getSessionSecret());
}

export function decodeCaptchaIdentity(value: string | undefined): CaptchaIdentity | null {
  if (!value) {
    return null;
  }
  const parsed = captchaIdentitySchema.safeParse(decodeSignedJson(value, getSessionSecret()));
  return parsed.success && parsed.data.expiresAt > Date.now() ? parsed.data : null;
}
