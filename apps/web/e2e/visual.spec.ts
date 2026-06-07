import { expect, test } from '@playwright/test';

test('landing page visual baseline @visual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /anti-spam setup/i })).toBeVisible();
  const snapshotName =
    process.platform === 'win32' ? 'landing-page-win32.png' : 'landing-page-linux.png';
  await expect(page).toHaveScreenshot(snapshotName, { fullPage: true });
});

test('case queue visual baseline @visual', async ({ page }) => {
  test.skip(process.platform !== 'win32', 'Linux baseline should be captured in CI when needed.');

  await page.goto('/admin/guild/guild-1/cases');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expect(page).toHaveScreenshot('case-queue-win32.png', { fullPage: true });
});
