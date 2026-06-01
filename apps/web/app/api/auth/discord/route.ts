import { NextResponse } from 'next/server';
import { DISCORD_OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from '@/lib/cookies';
import { getPublicAppUrl, requireEnv } from '@/lib/env';
import { createOAuthState, encodeOAuthState } from '@/lib/oauthState';
import { resolveSafeReturnPath } from '@/lib/safeReturn';
import { buildSessionCookieOptions } from '@/lib/session';

const DISCORD_OAUTH_SCOPES = ['identify', 'guilds'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = resolveSafeReturnPath(url.searchParams.get('returnTo'));
  const redirectUri = `${getPublicAppUrl(request.url)}/api/auth/discord/callback`;
  const state = createOAuthState(returnTo);
  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', requireEnv('DISCORD_CLIENT_ID'));
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', DISCORD_OAUTH_SCOPES.join(' '));
  authorizeUrl.searchParams.set('state', state.state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(
    DISCORD_OAUTH_STATE_COOKIE,
    encodeOAuthState(state),
    buildSessionCookieOptions(OAUTH_STATE_MAX_AGE_SECONDS)
  );
  return response;
}
