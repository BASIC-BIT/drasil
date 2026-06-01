export function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function requireEnv(name: string): string {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function readOptionalPositiveIntegerEnv(name: string, fallback: number): number {
  const value = readOptionalEnv(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function normalizePublicAppUrl(value: string, name: string): string {
  try {
    const url = new URL(value.replace(/\/+$/, ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol.');
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL.`);
  }
}

export function getPublicAppUrl(requestUrl?: string): string {
  const configuredName = readOptionalEnv('NEXT_PUBLIC_APP_URL')
    ? 'NEXT_PUBLIC_APP_URL'
    : readOptionalEnv('DRASIL_WEB_PUBLIC_URL')
      ? 'DRASIL_WEB_PUBLIC_URL'
      : null;
  const configured = configuredName ? readOptionalEnv(configuredName) : null;
  if (configured) {
    return normalizePublicAppUrl(configured, configuredName ?? 'public app URL');
  }

  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }

  return 'http://localhost:3000';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
