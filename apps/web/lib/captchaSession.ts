import { randomBytes } from 'node:crypto';
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

const captchaChallengeIdSchema = z.string().uuid();

const captchaIdentitySchema = z.object({
  challengeId: captchaChallengeIdSchema,
  generation: z.number().int().positive(),
  userId: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

export type CaptchaOAuthState = z.infer<typeof captchaOAuthStateSchema>;
export type CaptchaIdentity = z.infer<typeof captchaIdentitySchema>;

const CAPTCHA_OAUTH_STATE_NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function getCaptchaOAuthStateCookieName(state: string): string | null {
  return CAPTCHA_OAUTH_STATE_NONCE_PATTERN.test(state)
    ? `${CAPTCHA_OAUTH_STATE_COOKIE}_${state}`
    : null;
}

export function getCaptchaIdentityCookieName(
  challengeId: string,
  generation: number
): string | null {
  return captchaChallengeIdSchema.safeParse(challengeId).success &&
    Number.isSafeInteger(generation) &&
    generation > 0
    ? `${CAPTCHA_IDENTITY_COOKIE}_${challengeId}_${generation}`
    : null;
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
