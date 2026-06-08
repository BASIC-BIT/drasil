import { expect, test } from '@playwright/test';

test('landing page explains the setup dashboard', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Drasil Setup/);
  await expect(page.getByRole('heading', { name: /scam reviews, organized/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /open setup dashboard/i })).toHaveAttribute(
    'href',
    '/api/auth/discord?returnTo=/admin'
  );
});

test('Discord OAuth start builds an authorize redirect', async ({ request }) => {
  const response = await request.get('/api/auth/discord?returnTo=/admin', { maxRedirects: 0 });
  const location = response.headers().location;
  const setCookie = response.headers()['set-cookie'];

  expect(response.status()).toBe(307);
  expect(location).toBeTruthy();
  expect(setCookie).toContain('drasil_discord_oauth_state=');

  const authorizeUrl = new URL(location ?? '');
  const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri') ?? '');

  expect(authorizeUrl.origin).toBe('https://discord.com');
  expect(authorizeUrl.pathname).toBe('/oauth2/authorize');
  expect(authorizeUrl.searchParams.get('client_id')).toBe('playwright-discord-client');
  expect(authorizeUrl.searchParams.get('scope')).toBe('identify guilds');
  expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
  expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
  expect(redirectUri.pathname).toBe('/api/auth/discord/callback');
});

test('theme toggle persists a selected mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await page.getByRole('button', { name: /toggle light and dark mode/i }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark');

  await page.reload();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark');

  await page.getByRole('button', { name: /toggle light and dark mode/i }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
});
