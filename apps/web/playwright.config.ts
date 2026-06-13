import { defineConfig, devices } from '@playwright/test';

const parsedPort = Number(process.env.PLAYWRIGHT_TEST_PORT);
const port = Number.isFinite(parsedPort) ? parsedPort : 3001;
const baseURL = `http://127.0.0.1:${port}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true';
const processEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => {
    return typeof entry[1] === 'string';
  })
);

const webServerEnv: Record<string, string> = {
  ...processEnv,
  NEXT_PUBLIC_APP_URL: baseURL,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ?? 'playwright-discord-client',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET ?? 'playwright-discord-secret',
  DRASIL_SESSION_SECRET: process.env.DRASIL_SESSION_SECRET ?? 'playwright-session-secret',
  DRASIL_OAUTH_ENCRYPTION_KEY:
    process.env.DRASIL_OAUTH_ENCRYPTION_KEY ?? 'playwright-oauth-encryption-key',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/drasil_test',
  DRASIL_WEB_BOT_TOKEN: process.env.DRASIL_WEB_BOT_TOKEN ?? 'playwright-bot-token',
  DRASIL_WEB_E2E_FIXTURE_MODE: process.env.DRASIL_WEB_E2E_FIXTURE_MODE ?? 'true',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixels: 1_200,
    },
  },
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: `node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer,
    timeout: 180_000,
    env: webServerEnv,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
