import { expect, test } from '@playwright/test';

test('landing page visual baseline @visual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /anti-spam setup/i })).toBeVisible();
  const snapshotName =
    process.platform === 'win32' ? 'landing-page-win32.png' : 'landing-page-linux.png';
  await expect(page).toHaveScreenshot(snapshotName, { fullPage: true });
});
