import type { DelegatedScope } from '@drasil/application';
import { getPublicAppUrl, readOptionalEnv, requireEnv } from '../env';

export const MCP_SCOPES: readonly DelegatedScope[] = [
  'drasil:read',
  'drasil:moderate',
  'drasil:configure',
];
export const MCP_OAUTH_SCOPES = [...MCP_SCOPES, 'offline_access'];
export const MCP_ACCESS_TOKEN_SECONDS = 900;
export const MCP_REFRESH_TOKEN_SECONDS = 2_592_000;
export interface McpConfig {
  origin: string;
  issuer: string;
  resource: string;
  authSecret: string;
  cursorSecret: string;
  ipHashSecret?: string;
  authSecrets?: { version: number; value: string }[];
}
/** Lazy: disabled deployments and build-time imports require no MCP secrets. */
export function getMcpConfig(): McpConfig | null {
  if (readOptionalEnv('DRASIL_MCP_ENABLED') !== 'true') return null;
  const origin = configuredOrigin();
  const authSecret = requireEnv('DRASIL_MCP_AUTH_SECRET');
  const cursorSecret = requireEnv('DRASIL_MCP_CURSOR_SECRET');
  if (authSecret.length < 32 || cursorSecret.length < 32 || authSecret === cursorSecret) {
    throw new Error('MCP requires distinct auth and cursor secrets of at least 32 characters.');
  }
  const ipHashSecret = readOptionalEnv('DRASIL_MCP_IP_HASH_SECRET');
  const authSecrets = readAuthSecrets(authSecret);
  validateOperationalKeys(authSecret, cursorSecret, ipHashSecret, authSecrets);
  return {
    origin,
    issuer: `${origin}/api/mcp-auth`,
    resource: `${origin}/api/mcp`,
    authSecret,
    cursorSecret,
    ipHashSecret: ipHashSecret ?? undefined,
    authSecrets,
  };
}

type IssuerSecret = { version: number; value: string };
function configuredOrigin(): string {
  if (!readOptionalEnv('NEXT_PUBLIC_APP_URL') && !readOptionalEnv('DRASIL_WEB_PUBLIC_URL')) {
    throw new Error('MCP requires a configured public app origin.');
  }
  const origin = getPublicAppUrl();
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' &&
    !(
      process.env.NODE_ENV !== 'production' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  ) {
    throw new Error('MCP requires HTTPS (loopback HTTP is allowed only in development).');
  }
  return origin;
}
function validateOperationalKeys(
  authSecret: string,
  cursorSecret: string,
  ipHashSecret: string | null,
  authSecrets: IssuerSecret[]
): void {
  if (
    (ipHashSecret &&
      (ipHashSecret.length < 32 || ipHashSecret === authSecret || ipHashSecret === cursorSecret)) ||
    authSecrets.some((entry) => entry.value === cursorSecret || entry.value === ipHashSecret)
  )
    throw new Error('MCP operational keys must be distinct.');
}

/** Explicit MCP ownership prevents ambient BETTER_AUTH_SECRETS from replacing this issuer's key. */
function readAuthSecrets(legacy: string): IssuerSecret[] {
  const raw = readOptionalEnv('DRASIL_MCP_AUTH_SECRETS');
  if (!raw) return [{ version: 1, value: legacy }];
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (e: unknown) =>
        typeof e !== 'object' ||
        e === null ||
        !('version' in e) ||
        !Number.isSafeInteger(e.version) ||
        Number(e.version) < 1 ||
        !('value' in e) ||
        typeof e.value !== 'string' ||
        e.value.length < 32
    )
  )
    throw new Error('Invalid MCP issuer secret versions.');
  const entries = value as { version: number; value: string }[];
  if (new Set(entries.map((e) => e.version)).size !== entries.length)
    throw new Error('Duplicate MCP issuer secret version.');
  return entries;
}
