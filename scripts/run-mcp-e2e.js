const { spawnSync } = require('node:child_process');
const { ownedTestDatabase } = require('./owned-test-database.js');
ownedTestDatabase();
const result = spawnSync(
  'npm',
  [
    'run',
    'web:e2e',
    '--',
    ...(process.argv.length > 2
      ? process.argv.slice(2)
      : ['mcp-connections.spec.ts', 'mcp-confirmation.spec.ts', 'mcp-flow.spec.ts']),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DRASIL_MCP_E2E: 'true',
      VERCEL: '1',
      DRASIL_MCP_INGRESS: 'vercel-direct',
      DRASIL_MCP_IP_HASH_SECRET: 'local-ingress-only-'.repeat(3),
      DRASIL_WEB_E2E_FIXTURE_MODE: 'false',
      DRASIL_MCP_ENABLED: 'true',
      DRASIL_MCP_AUTH_SECRET: 'task5-test-auth-secret-'.repeat(3),
      DRASIL_MCP_CURSOR_SECRET: 'task5-test-cursor-secret-'.repeat(3),
      DRASIL_WEB_BOT_TOKEN: 'playwright-bot-token',
      DISCORD_API_BASE_URL: 'http://127.0.0.1:34567',
      PLAYWRIGHT_REUSE_SERVER: 'false',
    },
  }
);
process.exitCode = result.status ?? 1;
