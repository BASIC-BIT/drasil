import { NextRequest, NextResponse } from 'next/server';
import { decodeCaptchaIdentity, getCaptchaIdentityCookieName } from '@/lib/captchaSession';
import {
  beginCaptchaAttempt,
  buildCaptchaCdata,
  completeCaptchaAttempt,
  getCaptchaPublicChallenge,
  requeueCaptchaPassEffect,
} from '@/lib/captchaCompletion';
import { getPublicAppUrl } from '@/lib/env';
import { buildSessionCookieOptions } from '@/lib/session';
import { validateTurnstileToken } from '@/lib/turnstile';

function redirectToChallenge(request: Request, token: string, result: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/captcha/${encodeURIComponent(token)}?result=${result}`, request.url),
    303
  );
}

function hasValidOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(getPublicAppUrl(request.url)).origin;
  } catch {
    return false;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!hasValidOrigin(request)) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const challenge = await getCaptchaPublicChallenge(token);
    if (challenge?.status === 'passed') {
      await requeueCaptchaPassEffect(challenge);
      return redirectToChallenge(request, token, 'completed');
    }
    if (!challenge) {
      return redirectToChallenge(request, token, 'stale');
    }
    const identityCookieName = getCaptchaIdentityCookieName(challenge.id, challenge.generation);
    if (!identityCookieName) {
      return redirectToChallenge(request, token, 'stale');
    }
    const identity = decodeCaptchaIdentity(request.cookies.get(identityCookieName)?.value);
    if (!identity) {
      return redirectToChallenge(request, token, 'authenticate');
    }
    const formData = await request.formData();
    const idempotencyKey = formData.get('attempt-id');
    const turnstileToken = formData.get('turnstile-response');
    if (typeof idempotencyKey !== 'string' || typeof turnstileToken !== 'string') {
      return redirectToChallenge(request, token, 'retry');
    }

    const started = await beginCaptchaAttempt({ token, identity, idempotencyKey });
    if (started.state === 'duplicate') {
      const result = started.previousState === 'passed' ? 'completed' : 'retry';
      return redirectToChallenge(request, token, result);
    }
    if (started.state === 'identity_mismatch') {
      return redirectToChallenge(request, token, 'authenticate');
    }
    if (started.state === 'rate_limited') {
      return redirectToChallenge(request, token, 'rate_limited');
    }
    if (started.state !== 'ready' || !started.attemptId || !started.challenge) {
      if (started.challenge?.status === 'passed') {
        await requeueCaptchaPassEffect(started.challenge);
        return redirectToChallenge(request, token, 'completed');
      }
      return redirectToChallenge(request, token, 'stale');
    }

    const validation = await validateTurnstileToken({
      token: turnstileToken,
      expectedCdata: buildCaptchaCdata(started.challenge.id, started.challenge.generation),
      idempotencyKey,
    });
    const completed = await completeCaptchaAttempt({
      attemptId: started.attemptId,
      validation,
    });
    const response = redirectToChallenge(
      request,
      token,
      completed === 'passed' ? 'completed' : completed
    );
    if (completed === 'passed') {
      response.cookies.set(identityCookieName, '', buildSessionCookieOptions(0));
    }
    return response;
  } catch (error) {
    console.error('CAPTCHA completion failed:', error);
    return redirectToChallenge(request, token, 'service');
  }
}
