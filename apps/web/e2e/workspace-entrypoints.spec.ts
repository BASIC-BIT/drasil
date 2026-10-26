import { createHash } from 'node:crypto';
import { inspectEntryPresentation } from './entrypointPresentation';
import { expect, test, type Page } from '@playwright/test';
import { workspaceIds as id, workspaceFixtures } from './workspaceFixtures';
const fixtures = workspaceFixtures();
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

async function chrome(page: Page) {
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: 'Drasil', exact: true }).filter({ visible: true })
  ).toHaveCount(1);
  await expect(
    page.locator('img[src="/brand/drasil-tree.png"]').filter({ visible: true })
  ).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('entrypoints retain brand, account and active workspace destinations', async ({ page }) => {
  await page.goto('/');
  await chrome(page);
  await expect(
    page.getByRole('link', { name: 'Open moderation workspace', exact: true })
  ).toHaveAttribute('href', '/api/auth/discord?returnTo=/admin');
  await page.goto('/admin');
  await chrome(page);
  await expect(page.getByText('Test moderator', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  for (const [label, path] of [
    ['Inbox', 'inbox'],
    ['History', 'history'],
    ['Settings', 'setup'],
    ['Operations', 'operations'],
  ]) {
    await page
      .getByRole('navigation', { name: 'Workspace', exact: true })
      .getByRole('link', { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(`/admin/guild/${id.guild}/${path}`);
    await chrome(page);
    await expect(
      page
        .getByRole('navigation', { name: 'Workspace', exact: true })
        .locator('[aria-current="page"]')
    ).toHaveText(label);
    await expect(page.getByText('Test moderator', { exact: true })).toBeVisible();
    await expect(page.getByText('Moderation test server', { exact: true }).first()).toBeVisible();
  }
  await page.goto(`/admin/guild/${id.guild}/members/${id.member}`);
  await chrome(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Workspace', exact: true })
      .locator('[aria-current="page"]')
  ).toHaveText('History');
  await page.getByRole('link', { name: 'Switch server', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a Server' })).toBeVisible();
});

test('mobile menu restores keyboard focus and theme persists through public reporting', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/guild/${id.guild}/history`);
  await chrome(page);
  const menu = page.getByRole('button', { name: 'Moderation test server workspace menu' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await page.getByRole('button', { name: 'Toggle light and dark mode' }).click();
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.goto('/report');
  await chrome(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  await page.getByRole('link', { name: 'Report User', exact: true }).click();
  await chrome(page);
  await expect(page.getByRole('button', { name: 'Submit report', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Report Servers', exact: true }).click();
  await expect(page).toHaveURL('/report');
});

test('missing pages remain 404 and unexpected reads recover with a fresh GET', async ({ page }) => {
  const response = await page.goto('/missing-controlled-entry');
  expect(response?.status()).toBe(404);
  await chrome(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  fixtures.setProviderFailure('directory', 500);
  await page.goto('/admin');
  await chrome(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Unable to load this workspace' })
  ).toBeVisible();
  await expect(page.getByText('Controlled provider failure')).toHaveCount(0);
  fixtures.setProviderFailure('directory');
  const navigation = page.waitForRequest(
    (request) => request.isNavigationRequest() && new URL(request.url()).pathname === '/admin'
  );
  await page.getByRole('button', { name: 'Try again' }).click();
  expect((await navigation).method()).toBe('GET');
  await expect(page.getByRole('heading', { name: 'Choose a Server' })).toBeVisible();
});

test('entry presentation stays flat and readable in desktop/mobile light/dark', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const [name, destination] of [
    ['home', '/'],
    ['server-picker', '/admin'],
    ['history', `/admin/guild/${id.guild}/history`],
    ['settings', `/admin/guild/${id.guild}/setup`],
    ['onboarding', `/admin/guild/${id.guild}/onboarding`],
    ['operations', `/admin/guild/${id.guild}/operations`],
    ['member-history', `/admin/guild/${id.guild}/members/${id.member}`],
    ['report-servers', '/report'],
    ['report-form', `/report/guild/${id.guild}`],
    ['captcha-unavailable', '/captcha/unavailable-controlled-link'],
    ['mcp-disabled', '/mcp/connect'],
    ['not-found', '/missing-controlled-entry'],
  ]) {
    await page.goto(destination);
    await inspectEntryPresentation(page, name);
  }
  const token = 'controlled-pending-captcha-'.padEnd(43, 'x');
  await fixtures.pool.query(
    `insert into captcha_challenges
    (verification_event_id, server_id, user_id, request_source, pass_effect, case_revision_at_issue,
    method_revision, link_token_hash, expires_at)
    values ($1,$2,$3,'moderator','evidence_only',0,1,$4,now()+interval '1 hour')`,
    [id.case, id.guild, id.member, createHash('sha256').update(token).digest('hex')]
  );
  await page.goto(`/captcha/${token}`);
  await expect(page.getByRole('link', { name: 'Continue with Discord' })).toHaveAttribute(
    'href',
    `/api/captcha/auth/${token}`
  );
  await inspectEntryPresentation(page, 'captcha-pending-login');
});
