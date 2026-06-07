import { expect, test } from '@playwright/test';

test('active case queue links through to case detail', async ({ page }) => {
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: /choose a server/i })).toBeVisible();
  await page.getByRole('link', { name: 'Active cases' }).click();

  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expect(page.getByText('2 active cases')).toBeVisible();
  await expect(page.getByText('48h stale')).toBeVisible();
  await expect(page.getByText('Ban by ID')).toBeVisible();

  await page.getByRole('link', { name: 'User user-100' }).click();

  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detection history' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moderation outcomes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin notification' })).toHaveAttribute(
    'href',
    'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1'
  );
});
