import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTCHA_TURNSTILE_ACTION,
  assertCaptchaProviderConfigured,
  captchaProviderConfigurationIssues,
  validateTurnstileToken,
} from './turnstile';

const input = {
  expectedCdata: 'challenge-binding',
  idempotencyKey: '5e9a26f5-933c-4c08-8f40-75490168cbda',
  token: 'turnstile-response-token',
};

function providerResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('Turnstile server-side validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function configureProvider(): void {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'turnstile-secret');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'drasil.example');
  }

  it('reports missing or mismatched deployment configuration without exposing values', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'other.example');

    expect(captchaProviderConfigurationIssues()).toEqual([
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
      'TURNSTILE_SECRET_KEY',
      'DRASIL_CAPTCHA_BINDING_SECRET',
      'TURNSTILE_EXPECTED_HOSTNAME must match the public web URL hostname',
    ]);
  });

  it('blocks CAPTCHA enablement until provider configuration is complete', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'drasil.example');

    expect(() => assertCaptchaProviderConfigured('off')).not.toThrow();
    expect(() => assertCaptchaProviderConfigured('manual')).toThrow(
      'Configure the browser security-check provider before enabling it: NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, DRASIL_CAPTCHA_BINDING_SECRET.'
    );

    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    vi.stubEnv('DRASIL_CAPTCHA_BINDING_SECRET', 'binding-secret');
    expect(() => assertCaptchaProviderConfigured('suspicious_join')).not.toThrow();
  });

  it('accepts only an exact hostname, action, and challenge binding', async () => {
    configureProvider();
    const fetchMock = vi.fn().mockResolvedValue(
      providerResponse({
        action: CAPTCHA_TURNSTILE_ACTION,
        cdata: input.expectedCdata,
        hostname: 'drasil.example',
        success: true,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateTurnstileToken(input)).resolves.toEqual({
      action: CAPTCHA_TURNSTILE_ACTION,
      errorCodes: [],
      hostname: 'drasil.example',
      state: 'passed',
      success: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      idempotency_key: input.idempotencyKey,
      response: input.token,
      secret: 'turnstile-secret',
    });
  });

  it('classifies invalid or duplicate user responses as consuming failures', async () => {
    configureProvider();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        providerResponse({
          'error-codes': ['timeout-or-duplicate'],
          success: false,
        })
      )
    );

    await expect(validateTurnstileToken(input)).resolves.toMatchObject({
      errorCodes: ['timeout-or-duplicate'],
      state: 'invalid',
      success: false,
    });
  });

  it('does not consume a submission for provider or transport failures', async () => {
    configureProvider();
    const fetchMock = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateTurnstileToken(input)).resolves.toMatchObject({
      errorCodes: ['internal-error'],
      state: 'provider_error',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a successful response for another hostname as a provider error', async () => {
    configureProvider();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        providerResponse({
          action: CAPTCHA_TURNSTILE_ACTION,
          cdata: input.expectedCdata,
          hostname: 'other.example',
          success: true,
        })
      )
    );

    await expect(validateTurnstileToken(input)).resolves.toMatchObject({
      errorCodes: ['hostname-mismatch'],
      state: 'provider_error',
    });
  });

  it('rejects a response whose action or challenge binding does not match', async () => {
    configureProvider();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        providerResponse({
          action: CAPTCHA_TURNSTILE_ACTION,
          cdata: 'other-binding',
          hostname: 'drasil.example',
          success: true,
        })
      )
    );

    await expect(validateTurnstileToken(input)).resolves.toMatchObject({
      errorCodes: ['binding-mismatch'],
      state: 'invalid',
      success: true,
    });
  });
});
