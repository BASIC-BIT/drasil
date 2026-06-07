import { expect, test } from '@playwright/test';

function platformSnapshotName(name: string): string {
  return `${name}-${process.platform === 'win32' ? 'win32' : 'linux'}.png`;
}

test('landing page visual baseline @visual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /anti-spam setup/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('landing-page'), { fullPage: true });
});

test('admin guild list visual baseline @visual', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /choose a server/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('admin-guild-list'), {
    fullPage: true,
  });
});

test('guild setup visual baseline @visual', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/setup');
  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /install drasil/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('guild-setup'), { fullPage: true });
});

test('case queue visual baseline @visual', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/cases');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('case-queue'), { fullPage: true });
});

test('case detail visual baseline @visual', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/cases/case-stale');
  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('case-detail'), { fullPage: true });
});
