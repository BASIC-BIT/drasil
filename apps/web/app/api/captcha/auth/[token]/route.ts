import { NextResponse } from 'next/server';
import { OAUTH_STATE_MAX_AGE_SECONDS } from '@/lib/cookies';
import {
  createCaptchaOAuthState,
  encodeCaptchaOAuthState,
  getCaptchaOAuthStateCookieName,
} from '@/lib/captchaSession';
import { getCaptchaPublicChallenge } from '@/lib/captchaCompletion';
import { getPublicAppUrl, requireEnv } from '@/lib/env';
import { buildSessionCookieOptions } from '@/lib/session';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const challenge = await getCaptchaPublicChallenge(token);
  if (!challenge || challenge.status !== 'pending') {
    return NextResponse.redirect(new URL(`/captcha/${encodeURIComponent(token)}`, request.url));
  }

  const redirectUri = `${getPublicAppUrl(request.url)}/api/captcha/auth/callback`;
  const state = createCaptchaOAuthState(token);
  const stateCookieName = getCaptchaOAuthStateCookieName(state.state);
  if (!stateCookieName) {
    throw new Error('Failed to create a valid CAPTCHA OAuth state nonce.');
  }
  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.searchParams.set('client_id', requireEnv('DISCORD_CLIENT_ID'));
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'identify');
  authorizeUrl.searchParams.set('state', state.state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(
    stateCookieName,
    encodeCaptchaOAuthState(state),
    buildSessionCookieOptions(OAUTH_STATE_MAX_AGE_SECONDS)
  );
  return response;
}
