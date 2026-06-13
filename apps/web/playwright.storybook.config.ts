import { defineConfig, devices } from '@playwright/test';

const parsedPort = Number(process.env.PLAYWRIGHT_STORYBOOK_PORT);
const port = Number.isFinite(parsedPort) ? parsedPort : 6006;
const baseURL = `http://127.0.0.1:${port}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_STORYBOOK_SERVER === 'true';

export default defineConfig({
  testDir: './storybook-e2e',
  fullyParallel: true,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'storybook-playwright-report' }]],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      maxDiffPixels: 500,
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
    command: `npm run storybook -- --host 127.0.0.1 --port ${port} --ci --no-open`,
    url: baseURL,
    reuseExistingServer,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
