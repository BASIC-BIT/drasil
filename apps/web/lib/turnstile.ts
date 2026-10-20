import { setupCaptchaProviderIssues } from '@drasil/application/setup-settings';
import { z } from 'zod';
import { readOptionalEnv, requireEnv } from './env';

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
const TURNSTILE_PROVIDER_TIMEOUT_MS = 8_000;
const TURNSTILE_PROVIDER_ATTEMPTS = 2;

export const CAPTCHA_TURNSTILE_ACTION = 'drasil_case_access';

const turnstileResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  cdata: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});

const ALLOWED_ERROR_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'invalid-input-response',
  'bad-request',
  'timeout-or-duplicate',
  'internal-error',
]);

const USER_INVALID_ERROR_CODES = new Set([
  'missing-input-response',
  'invalid-input-response',
  'timeout-or-duplicate',
]);

export interface SanitizedTurnstileResult {
  readonly state: 'passed' | 'invalid' | 'provider_error';
  readonly success: boolean | null;
  readonly action: string | null;
  readonly hostname: string | null;
  readonly errorCodes: readonly string[];
}

export function captchaProviderConfigurationIssues(): string[] {
  return setupCaptchaProviderIssues({
    siteKeyConfigured: Boolean(readOptionalEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY')),
    secretKeyConfigured: Boolean(readOptionalEnv('TURNSTILE_SECRET_KEY')),
    bindingSecretConfigured: Boolean(readOptionalEnv('DRASIL_CAPTCHA_BINDING_SECRET')),
    expectedHostname: readOptionalEnv('TURNSTILE_EXPECTED_HOSTNAME') ?? undefined,
    publicUrl:
      readOptionalEnv('NEXT_PUBLIC_APP_URL') ??
      readOptionalEnv('DRASIL_WEB_PUBLIC_URL') ??
      undefined,
  });
}

export function assertCaptchaProviderConfigured(mode: string | undefined): void {
  if (!mode || mode === 'off') {
    return;
  }
  const issues = captchaProviderConfigurationIssues();
  if (issues.length > 0) {
    throw new Error(
      `Configure the browser security-check provider before enabling it: ${issues.join(', ')}.`
    );
  }
}

function sanitizeErrorCodes(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])]
    .slice(0, 12)
    .map((value) => (ALLOWED_ERROR_CODES.has(value) ? value : 'unknown-error'));
}

function providerError(errorCodes: readonly string[] = []): SanitizedTurnstileResult {
  return {
    state: 'provider_error',
    success: null,
    action: null,
    hostname: null,
    errorCodes,
  };
}

export async function validateTurnstileToken(input: {
  readonly token: string;
  readonly expectedCdata: string;
  readonly idempotencyKey: string;
}): Promise<SanitizedTurnstileResult> {
  if (!input.token || input.token.length > TURNSTILE_TOKEN_MAX_LENGTH) {
    return {
      state: 'invalid',
      success: false,
      action: null,
      hostname: null,
      errorCodes: ['invalid-input-response'],
    };
  }

  const secret = requireEnv('TURNSTILE_SECRET_KEY');
  const expectedHostname = requireEnv('TURNSTILE_EXPECTED_HOSTNAME').toLowerCase();
  let response: Response | null = null;

  for (let attempt = 1; attempt <= TURNSTILE_PROVIDER_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(TURNSTILE_SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          secret,
          response: input.token,
          idempotency_key: input.idempotencyKey,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(TURNSTILE_PROVIDER_TIMEOUT_MS),
      });
      break;
    } catch {
      if (attempt === TURNSTILE_PROVIDER_ATTEMPTS) {
        return providerError(['internal-error']);
      }
    }
  }

  if (!response?.ok) {
    return providerError(['internal-error']);
  }

  const parsed = turnstileResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return providerError(['internal-error']);
  }

  const errorCodes = sanitizeErrorCodes(parsed.data['error-codes']);
  const hostname = parsed.data.hostname?.toLowerCase() ?? null;
  const action = parsed.data.action ?? null;

  if (!parsed.data.success) {
    return {
      state:
        errorCodes.length > 0 && errorCodes.every((code) => USER_INVALID_ERROR_CODES.has(code))
          ? 'invalid'
          : 'provider_error',
      success: false,
      action,
      hostname,
      errorCodes,
    };
  }

  if (hostname !== expectedHostname) {
    return providerError(['hostname-mismatch']);
  }
  if (action !== CAPTCHA_TURNSTILE_ACTION || parsed.data.cdata !== input.expectedCdata) {
    return {
      state: 'invalid',
      success: true,
      action,
      hostname,
      errorCodes: ['binding-mismatch'],
    };
  }

  return {
    state: 'passed',
    success: true,
    action,
    hostname,
    errorCodes: [],
  };
}
