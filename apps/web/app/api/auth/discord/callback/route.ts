import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  DISCORD_OAUTH_STATE_COOKIE,
  DISCORD_TOKEN_COOKIE,
} from '@/lib/cookies';
import { discordAvatarUrl, exchangeDiscordCode, fetchDiscordUser } from '@/lib/discordApi';
import { getPublicAppUrl } from '@/lib/env';
import { decodeOAuthState } from '@/lib/oauthState';
import { resolveSafeReturnPath } from '@/lib/safeReturn';
import {
  buildSessionCookieOptions,
  createAdminSession,
  encodeAdminSession,
  encodeDiscordTokenSession,
} from '@/lib/session';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = decodeOAuthState(request.cookies.get(DISCORD_OAUTH_STATE_COOKIE)?.value);

  if (!code || !state || !cookieState || cookieState.state !== state) {
    return NextResponse.redirect(new URL('/admin?auth=failed', request.url));
  }

  try {
    const redirectUri = `${getPublicAppUrl(request.url)}/api/auth/discord/callback`;
    const token = await exchangeDiscordCode({ code, redirectUri });
    const user = await fetchDiscordUser(token.access_token);
    const session = createAdminSession({
      userId: user.id,
      username: user.global_name ?? user.username,
      avatarUrl: discordAvatarUrl(user),
    });

    const response = NextResponse.redirect(
      new URL(resolveSafeReturnPath(cookieState.returnTo), request.url)
    );
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      encodeAdminSession(session),
      buildSessionCookieOptions(ADMIN_SESSION_MAX_AGE_SECONDS)
    );
    response.cookies.set(
      DISCORD_TOKEN_COOKIE,
      encodeDiscordTokenSession({
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      }),
      buildSessionCookieOptions(Math.min(token.expires_in, ADMIN_SESSION_MAX_AGE_SECONDS))
    );
    response.cookies.set(DISCORD_OAUTH_STATE_COOKIE, '', buildSessionCookieOptions(0));
    return response;
  } catch {
    const response = NextResponse.redirect(new URL('/admin?auth=failed', request.url));
    response.cookies.set(DISCORD_OAUTH_STATE_COOKIE, '', buildSessionCookieOptions(0));
    return response;
  }
}
