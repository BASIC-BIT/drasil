// Explicit legacy test-build boundary. Never imported by the release build.
import { ADMIN_SESSION_COOKIE, DISCORD_TOKEN_COOKIE } from '@/lib/cookies';
import { fixtureAdminSession, fixtureDiscordToken, isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { cookies } from 'next/headers';
import {
  type AdminSession,
  type DiscordTokenSession,
  decodeAdminSession,
  decodeDiscordTokenSession,
} from '../../lib/session';
export * from '../../lib/session';

export async function getCurrentAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!raw && isWebE2eFixtureMode()) {
    return fixtureAdminSession();
  }
  return raw ? decodeAdminSession(raw) : null;
}

export async function getCurrentDiscordToken(): Promise<DiscordTokenSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(DISCORD_TOKEN_COOKIE)?.value;
  if (!raw && isWebE2eFixtureMode()) {
    return fixtureDiscordToken();
  }
  return raw ? decodeDiscordTokenSession(raw) : null;
}
