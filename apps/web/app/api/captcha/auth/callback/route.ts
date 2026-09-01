import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  CAPTCHA_IDENTITY_COOKIE,
  CAPTCHA_IDENTITY_MAX_AGE_SECONDS,
  CAPTCHA_OAUTH_STATE_COOKIE,
} from '@/lib/cookies';
import {
  createCaptchaIdentity,
  decodeCaptchaOAuthState,
  encodeCaptchaIdentity,
} from '@/lib/captchaSession';
import { getCaptchaPublicChallenge, recordCaptchaIdentityMismatch } from '@/lib/captchaCompletion';
import { exchangeDiscordCode, fetchDiscordUser } from '@/lib/discordApi';
import { getPublicAppUrl } from '@/lib/env';
import { buildSessionCookieOptions } from '@/lib/session';

function challengeRedirect(request: Request, token: string, result: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/captcha/${encodeURIComponent(token)}?auth=${result}`, request.url)
  );
}

function clearOAuthState(response: NextResponse): NextResponse {
  response.cookies.set(CAPTCHA_OAUTH_STATE_COOKIE, '', buildSessionCookieOptions(0));
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = decodeCaptchaOAuthState(
    request.cookies.get(CAPTCHA_OAUTH_STATE_COOKIE)?.value
  );
  const token = cookieState?.token ?? '';

  if (!cookieState || !token) {
    return clearOAuthState(
      new NextResponse(
        'Discord account confirmation expired. Return to the security check link and try again.',
        { status: 400 }
      )
    );
  }

  if (!code || !state || cookieState.state !== state) {
    return clearOAuthState(challengeRedirect(request, token, 'failed'));
  }

  try {
    const challenge = await getCaptchaPublicChallenge(token);
    if (!challenge || challenge.status !== 'pending') {
      return clearOAuthState(challengeRedirect(request, token, 'stale'));
    }
    const redirectUri = `${getPublicAppUrl(request.url)}/api/captcha/auth/callback`;
    const oauthToken = await exchangeDiscordCode({ code, redirectUri });
    const user = await fetchDiscordUser(oauthToken.access_token);
    if (user.id !== challenge.userId) {
      await recordCaptchaIdentityMismatch({
        token,
        discordUserId: user.id,
        idempotencyKey: `captcha-oauth:${createHash('sha256').update(state).digest('hex')}`,
      });
      return clearOAuthState(challengeRedirect(request, token, 'mismatch'));
    }

    const response = challengeRedirect(request, token, 'confirmed');
    response.cookies.set(
      CAPTCHA_IDENTITY_COOKIE,
      encodeCaptchaIdentity(
        createCaptchaIdentity({
          challengeId: challenge.id,
          generation: challenge.generation,
          userId: user.id,
        })
      ),
      buildSessionCookieOptions(CAPTCHA_IDENTITY_MAX_AGE_SECONDS)
    );
    return clearOAuthState(response);
  } catch (error) {
    console.error('CAPTCHA Discord account confirmation failed:', error);
    return clearOAuthState(challengeRedirect(request, token, 'failed'));
  }
}
