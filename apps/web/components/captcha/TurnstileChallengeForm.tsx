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

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
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
            ? 'The browser check could not load. Check your connection or content-blocking settings and try again.'
            : responseToken
              ? 'Browser check ready.'
              : 'Waiting for the browser check.'}
        </p>
        <button className="button" type="submit" disabled={!responseToken}>
          Complete security check
        </button>
      </form>
    </>
  );
}
