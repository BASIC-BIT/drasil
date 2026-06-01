import { NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  DISCORD_OAUTH_STATE_COOKIE,
  DISCORD_TOKEN_COOKIE,
} from '@/lib/cookies';
import { buildSessionCookieOptions } from '@/lib/session';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.cookies.set(ADMIN_SESSION_COOKIE, '', buildSessionCookieOptions(0));
  response.cookies.set(DISCORD_TOKEN_COOKIE, '', buildSessionCookieOptions(0));
  response.cookies.set(DISCORD_OAUTH_STATE_COOKIE, '', buildSessionCookieOptions(0));
  return response;
}
