import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { decodeCaptchaIdentity, getCaptchaIdentityCookieName } from '@/lib/captchaSession';
import {
  getCaptchaFormConfiguration,
  getCaptchaPublicChallenge,
  requeueCaptchaPassEffect,
} from '@/lib/captchaCompletion';
import { TurnstileChallengeForm } from '@/components/captcha/TurnstileChallengeForm';

export const dynamic = 'force-dynamic';

function resultMessage(result: string | undefined): string | null {
  switch (result) {
    case 'invalid':
      return 'That browser check was not accepted. Please try again.';
    case 'provider_error':
    case 'service':
      return 'The browser check is temporarily unavailable. Please try again.';
    case 'rate_limited':
      return 'Too many attempts were submitted. Wait a minute and try again.';
    case 'authenticate':
      return 'Confirm your Discord account again before continuing.';
    case 'retry':
      return 'The browser check could not be submitted. Please try again.';
    case 'stale':
      return 'This security check changed while it was being completed. Please try again.';
    default:
      return null;
  }
}

export default async function CaptchaChallengePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ token: string }>;
  readonly searchParams: Promise<{ auth?: string; result?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const challenge = await getCaptchaPublicChallenge(token);

  if (!challenge) {
    return (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>Security check unavailable</h1>
          <p>This link is invalid or no longer available. Ask a moderator for a new check.</p>
        </section>
      </main>
    );
  }
  if (challenge.status === 'passed') {
    try {
      await requeueCaptchaPassEffect(challenge);
    } catch (error) {
      console.error('Failed to requeue completed CAPTCHA effects:', error);
    }
    return (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>Security check completed.</h1>
        </section>
      </main>
    );
  }
  if (challenge.status !== 'pending') {
    return (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>Security check unavailable</h1>
          <p>This check is no longer active. Ask a moderator if you still need access.</p>
        </section>
      </main>
    );
  }

  const cookieStore = await cookies();
  const identity = decodeCaptchaIdentity(
    cookieStore.get(getCaptchaIdentityCookieName(challenge.id, challenge.generation))?.value
  );
  const identityMatches =
    identity?.challengeId === challenge.id &&
    identity.generation === challenge.generation &&
    identity.userId === challenge.userId;
  const message =
    query.auth === 'mismatch'
      ? 'This check belongs to a different Discord account.'
      : query.auth === 'failed'
        ? 'Discord account confirmation did not complete. Please try again.'
        : resultMessage(query.result);
  const formConfiguration = identityMatches
    ? getCaptchaFormConfiguration(challenge.id, challenge.generation)
    : null;

  return (
    <main className="public-flow-shell">
      <section className="public-flow-panel">
        <h1>Discord security check</h1>
        <p>Complete this browser check to confirm access to your Discord account.</p>
        {message ? (
          <p className="status-banner" role="status">
            {message}
          </p>
        ) : null}
        {identityMatches && formConfiguration ? (
          <TurnstileChallengeForm
            token={token}
            siteKey={formConfiguration.siteKey}
            cdata={formConfiguration.cdata}
            attemptId={randomUUID()}
          />
        ) : identityMatches ? (
          <>
            <p className="status-banner" role="status">
              The browser check is temporarily unavailable. Please try again.
            </p>
            <Link className="button" href={`/captcha/${encodeURIComponent(token)}`}>
              Try again
            </Link>
          </>
        ) : (
          <Link className="button" href={`/api/captcha/auth/${encodeURIComponent(token)}`}>
            Confirm Discord account
          </Link>
        )}
      </section>
    </main>
  );
}
