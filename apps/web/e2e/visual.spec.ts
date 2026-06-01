import { expect, test } from '@playwright/test';

test('landing page visual baseline @visual', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /anti-spam setup/i })).toBeVisible();
  await expect(page).toHaveScreenshot('landing-page.png', { fullPage: true });
});
