import { expect, test } from '@playwright/test';

test('active case queue links through to case detail', async ({ page }) => {
  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: /choose a server/i })).toBeVisible();
  await page
    .locator('.server-row')
    .filter({ has: page.getByRole('heading', { name: 'Fixture Guild' }) })
    .getByRole('link', { name: 'Active Cases' })
    .click();

  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  const queueMeta = page.locator('.case-meta');
  await expect(queueMeta.getByText('Active cases')).toBeVisible();
  await expect(queueMeta.getByText('2', { exact: true })).toBeVisible();
  await expect(page.getByText('48h stale')).toBeVisible();
  await expect(page.getByText('Ban by ID')).toBeVisible();

  await page.getByRole('link', { name: 'User user-100' }).click();

  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detection History' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moderation Outcomes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Admin Notice' })).toHaveAttribute(
    'href',
    'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1'
  );
});

test('submitted report queue is reachable from admin entry points', async ({ page }) => {
  await page.goto('/admin');
  await page
    .locator('.server-row')
    .filter({ has: page.getByRole('heading', { name: 'Fixture Guild' }) })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases');
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases/case-stale');
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();
});
