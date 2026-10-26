import { defineConfig, devices } from '@playwright/test';
const port = 3002;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  outputDir: 'workspace-test-results',
  testMatch: [
    'moderation-workspace.spec.ts',
    'case-flow.spec.ts',
    'report-ban.spec.ts',
    'message-cleanup.spec.ts',
  ],
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: `node ../../node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      DRASIL_SESSION_SECRET: 'workspace-owned-test-secret',
      DRASIL_OAUTH_ENCRYPTION_KEY: 'workspace-owned-test-secret',
      DISCORD_API_BASE_URL: 'http://127.0.0.1:34568',
      DRASIL_WEB_BOT_TOKEN: 'controlled-provider-bot-token',
      DISCORD_TOKEN: 'controlled-provider-bot-token',
      DISCORD_CLIENT_ID: 'controlled-provider-client',
      DISCORD_CLIENT_SECRET: 'controlled-provider-client-secret',
      DRASIL_LEGACY_TEST_BUILD: 'false',
      DRASIL_WEB_E2E_FIXTURE_MODE: 'false',
      DRASIL_WEB_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
    },
  },
});
