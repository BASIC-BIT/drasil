import { createWebActionContext } from '@/lib/application/context';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { CAPTCHA_IDENTITY_MAX_AGE_SECONDS } from '@/lib/cookies';
import {
  createCaptchaIdentity,
  decodeCaptchaOAuthState,
  encodeCaptchaIdentity,
  getCaptchaIdentityCookieName,
  getCaptchaOAuthStateCookieName,
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

function clearOAuthState(response: NextResponse, cookieName: string | null): NextResponse {
  if (cookieName) {
    response.cookies.set(cookieName, '', buildSessionCookieOptions(0));
  }
  return response;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookieName = state ? getCaptchaOAuthStateCookieName(state) : null;
  const cookieState = decodeCaptchaOAuthState(
    stateCookieName ? request.cookies.get(stateCookieName)?.value : undefined
  );
  const token = cookieState?.token ?? '';

  if (!cookieState || !token) {
    return clearOAuthState(
      new NextResponse('Discord sign-in expired. Open the CAPTCHA in Discord and try again.', {
        status: 400,
      }),
      stateCookieName
    );
  }

  if (!code || !state || cookieState.state !== state) {
    return clearOAuthState(challengeRedirect(request, token, 'failed'), stateCookieName);
  }

  try {
    const challenge = await getCaptchaPublicChallenge(token);
    if (!challenge || challenge.status !== 'pending') {
      return clearOAuthState(challengeRedirect(request, token, 'stale'), stateCookieName);
    }
    const redirectUri = `${getPublicAppUrl(request.url)}/api/captcha/auth/callback`;
    const oauthToken = await exchangeDiscordCode({ code, redirectUri });
    const user = await fetchDiscordUser(oauthToken.access_token);
    if (user.id !== challenge.userId) {
      await recordCaptchaIdentityMismatch(
        {
          ...createWebActionContext({ guildId: challenge.serverId, userId: user.id }),
          source: 'captcha',
        },
        {
          challengeId: challenge.id,
          generation: challenge.generation,
          token,
          discordUserId: user.id,
          idempotencyKey: `captcha-oauth:${createHash('sha256').update(state).digest('hex')}`,
        }
      );
      return clearOAuthState(challengeRedirect(request, token, 'mismatch'), stateCookieName);
    }

    const response = challengeRedirect(request, token, 'confirmed');
    const identityCookieName = getCaptchaIdentityCookieName(challenge.id, challenge.generation);
    response.cookies.set(
      identityCookieName,
      encodeCaptchaIdentity(
        createCaptchaIdentity({
          challengeId: challenge.id,
          generation: challenge.generation,
          userId: user.id,
        })
      ),
      buildSessionCookieOptions(CAPTCHA_IDENTITY_MAX_AGE_SECONDS)
    );
    return clearOAuthState(response, stateCookieName);
  } catch (error) {
    console.error('CAPTCHA Discord account confirmation failed:', error);
    return clearOAuthState(challengeRedirect(request, token, 'failed'), stateCookieName);
  }
}
