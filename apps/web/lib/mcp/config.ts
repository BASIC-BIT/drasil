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
}
/** Lazy: disabled deployments and build-time imports require no MCP secrets. */
export function getMcpConfig(): McpConfig | null {
  if (readOptionalEnv('DRASIL_MCP_ENABLED') !== 'true') return null;
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
  const authSecret = requireEnv('DRASIL_MCP_AUTH_SECRET');
  const cursorSecret = requireEnv('DRASIL_MCP_CURSOR_SECRET');
  if (authSecret.length < 32 || cursorSecret.length < 32 || authSecret === cursorSecret) {
    throw new Error('MCP requires distinct auth and cursor secrets of at least 32 characters.');
  }
  return {
    origin,
    issuer: `${origin}/api/mcp-auth`,
    resource: `${origin}/api/mcp`,
    authSecret,
    cursorSecret,
  };
}
