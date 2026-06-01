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

export function getPublicAppUrl(requestUrl?: string): string {
  const configured =
    readOptionalEnv('NEXT_PUBLIC_APP_URL') ?? readOptionalEnv('DRASIL_WEB_PUBLIC_URL');
  if (configured) {
    return configured.replace(/\/+$/, '');
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
