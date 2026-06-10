import { expect, test, type Locator, type Page } from '@playwright/test';

type VisualScheme = 'light' | 'dark';

const visualSchemes: readonly VisualScheme[] = ['light', 'dark'];

function platformSnapshotName(name: string, scheme: VisualScheme): string {
  return `${name}-${process.platform === 'win32' ? 'win32' : 'linux'}-${scheme}.png`;
}

async function expectVisualSchemes(page: Page, name: string): Promise<void> {
  for (const scheme of visualSchemes) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page).toHaveScreenshot(platformSnapshotName(name, scheme), { fullPage: true });
  }
}

async function expectReportsLink(page: Page, expectedHref: string): Promise<void> {
  await expect(page.getByRole('link', { name: 'Reports' }).first()).toHaveAttribute(
    'href',
    expectedHref
  );
}

async function expectElementVisualSchemes(
  page: Page,
  locator: Locator,
  name: string
): Promise<void> {
  for (const scheme of visualSchemes) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(locator).toHaveScreenshot(platformSnapshotName(name, scheme));
  }
}

test('landing page visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /review scams/i })).toBeVisible();
  await expectVisualSchemes(page, 'landing-page');
});

test('admin guild list visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /choose a server/i })).toBeVisible();
  const serverRow = page.locator('.server-row').first();
  await expect(page.locator('.server-row')).toHaveCount(2);
  const serverRowStatus = serverRow.locator('.server-row-status');
  await expect(serverRow).toBeVisible();
  await expect(serverRowStatus).toBeVisible();
  await expectReportsLink(page, '/admin/guild/guild-1/reports');
  await expect
    .poll(async () => {
      const [rowBox, statusBox] = await Promise.all([
        serverRow.boundingBox(),
        serverRowStatus.boundingBox(),
      ]);
      return Boolean(rowBox && statusBox && statusBox.x > rowBox.x + rowBox.width * 0.65);
    })
    .toBe(true);
  await expectVisualSchemes(page, 'admin-guild-list');
});

test('admin guild list reports entry visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin');
  const fixtureServerRow = page
    .locator('.server-row')
    .filter({ has: page.getByRole('heading', { name: 'Fixture Guild' }) });
  await expect(fixtureServerRow.getByRole('link', { name: 'Reports' })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/reports'
  );
  await expectElementVisualSchemes(page, fixtureServerRow, 'report-entry-admin-server-row');
});

test('guild setup visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/setup');
  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /install drasil/i })).toBeVisible();
  await expectVisualSchemes(page, 'guild-setup');
});

test('case queue visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/cases');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expectReportsLink(page, '/admin/guild/guild-1/reports');
  await expectVisualSchemes(page, 'case-queue');
});

test('case queue reports entry visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/cases');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expectReportsLink(page, '/admin/guild/guild-1/reports');
  await expectElementVisualSchemes(page, page.locator('.topbar'), 'report-entry-case-queue-nav');
});

test('report queue visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();
  await expectVisualSchemes(page, 'report-queue');
});

test('case detail visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/cases/case-stale');
  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expectReportsLink(page, '/admin/guild/guild-1/reports');
  await expectVisualSchemes(page, 'case-detail');
});

test('case detail reports entry visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/cases/case-stale');
  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expectReportsLink(page, '/admin/guild/guild-1/reports');
  await expectElementVisualSchemes(page, page.locator('.topbar'), 'report-entry-case-detail-nav');
});
