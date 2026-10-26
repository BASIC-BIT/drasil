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

const resultMessages = new Map([
  ['invalid', 'CAPTCHA not accepted. Try again.'],
  ['provider_error', 'CAPTCHA unavailable. Try again.'],
  ['service', 'CAPTCHA unavailable. Try again.'],
  ['rate_limited', 'Too many attempts. Wait a minute, then try again.'],
  ['authenticate', 'Sign in with Discord again to continue.'],
  ['retry', "Couldn't submit the CAPTCHA. Try again."],
  ['stale', 'This CAPTCHA has changed. Open the latest link in Discord.'],
]);

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
          <h1>CAPTCHA unavailable</h1>
          <p>This link is invalid or no longer active. Ask a moderator for a new CAPTCHA.</p>
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
          <h1>CAPTCHA passed</h1>
          <p>Return to your case in Discord.</p>
        </section>
      </main>
    );
  }
  if (challenge.status !== 'pending') {
    return (
      <main className="public-flow-shell">
        <section className="public-flow-panel">
          <h1>CAPTCHA unavailable</h1>
          <p>This CAPTCHA is no longer active. Ask a moderator if you need another.</p>
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
      ? 'This CAPTCHA belongs to a different Discord account.'
      : query.auth === 'failed'
        ? 'Discord sign-in failed. Try again.'
        : resultMessages.get(query.result ?? '');
  const formConfiguration = identityMatches
    ? getCaptchaFormConfiguration(challenge.id, challenge.generation)
    : null;

  return (
    <main className="public-flow-shell">
      <section className="public-flow-panel">
        <h1>CAPTCHA</h1>
        <p>
          {identityMatches
            ? 'Complete the CAPTCHA below.'
            : 'Sign in with the Discord account this CAPTCHA was sent to.'}
        </p>
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
              CAPTCHA unavailable. Try again later or ask a moderator.
            </p>
            <Link className="button" href={`/captcha/${encodeURIComponent(token)}`}>
              Try again
            </Link>
          </>
        ) : (
          <Link className="button" href={`/api/captcha/auth/${encodeURIComponent(token)}`}>
            Continue with Discord
          </Link>
        )}
      </section>
    </main>
  );
}
