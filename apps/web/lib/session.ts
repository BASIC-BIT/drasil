import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  DISCORD_TOKEN_COOKIE,
} from './cookies';
import { decodeSignedJson, decryptJson, encodeSignedJson, encryptJson } from './crypto';
import { isProduction, readOptionalEnv, requireEnv } from './env';

const adminSessionSchema = z.object({
  userId: z.string(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

const discordTokenSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number(),
});

export type AdminSession = z.infer<typeof adminSessionSchema>;
export type DiscordTokenSession = z.infer<typeof discordTokenSchema>;

export function getSessionSecret(): string {
  return requireEnv('DRASIL_SESSION_SECRET');
}

export function getOauthEncryptionSecret(): string {
  return readOptionalEnv('DRASIL_OAUTH_ENCRYPTION_KEY') ?? getSessionSecret();
}

export function createAdminSession(input: {
  userId: string;
  username: string;
  avatarUrl: string | null;
}): AdminSession {
  const issuedAt = Date.now();
  return {
    ...input,
    issuedAt,
    expiresAt: issuedAt + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
  };
}

export function encodeAdminSession(session: AdminSession): string {
  return encodeSignedJson(session, getSessionSecret());
}

export function decodeAdminSession(token: string): AdminSession | null {
  const parsed = adminSessionSchema.safeParse(decodeSignedJson(token, getSessionSecret()));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    return null;
  }
  return parsed.data;
}

export function encodeDiscordTokenSession(session: DiscordTokenSession): string {
  return encryptJson(session, getOauthEncryptionSecret());
}

export function decodeDiscordTokenSession(token: string): DiscordTokenSession | null {
  const parsed = discordTokenSchema.safeParse(decryptJson(token, getOauthEncryptionSecret()));
  if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
    return null;
  }
  return parsed.data;
}

export async function getCurrentAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  return raw ? decodeAdminSession(raw) : null;
}

export async function getCurrentDiscordToken(): Promise<DiscordTokenSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(DISCORD_TOKEN_COOKIE)?.value;
  return raw ? decodeDiscordTokenSession(raw) : null;
}

export function buildSessionCookieOptions(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}
