'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAPTCHA_TURNSTILE_ACTION } from '@/lib/turnstile';

interface TurnstileWidgetApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      theme: 'auto';
      size: 'flexible';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
    }
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileWidgetApi;
  }
}

export function TurnstileChallengeForm({
  token,
  siteKey,
  cdata,
  attemptId,
}: {
  readonly token: string;
  readonly siteKey: string;
  readonly cdata: string;
  readonly attemptId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [responseToken, setResponseToken] = useState('');
  const [widgetError, setWidgetError] = useState(false);

  const renderWidget = useCallback(() => {
    if (!scriptReady || !containerRef.current || !window.turnstile || widgetIdRef.current) {
      return;
    }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: CAPTCHA_TURNSTILE_ACTION,
      cData: cdata,
      theme: 'auto',
      size: 'flexible',
      callback: (value) => {
        setResponseToken(value);
        setWidgetError(false);
      },
      'error-callback': () => {
        setResponseToken('');
        setWidgetError(true);
      },
      'expired-callback': () => setResponseToken(''),
    });
  }, [cdata, scriptReady, siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  useEffect(() => {
    if (scriptReady) return;
    const timeout = window.setTimeout(() => setWidgetError(true), 15_000);
    return () => window.clearTimeout(timeout);
  }, [scriptReady]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => {
          setScriptReady(true);
          setWidgetError(false);
        }}
        onError={() => setWidgetError(true)}
      />
      <form
        className="captcha-check-form"
        method="post"
        action={`/api/captcha/complete/${encodeURIComponent(token)}`}
      >
        <input type="hidden" name="attempt-id" value={attemptId} />
        <input type="hidden" name="turnstile-response" value={responseToken} />
        <div ref={containerRef} className="captcha-turnstile" />
        <p className="captcha-check-status" aria-live="polite">
          {widgetError
            ? "CAPTCHA couldn't load. Try again or ask a moderator."
            : responseToken
              ? 'Ready to submit.'
              : scriptReady
                ? 'Complete the CAPTCHA.'
                : 'Loading CAPTCHA...'}
        </p>
        {widgetError ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        ) : null}
        <button className="button" type="submit" disabled={!responseToken}>
          Submit
        </button>
      </form>
    </>
  );
}
