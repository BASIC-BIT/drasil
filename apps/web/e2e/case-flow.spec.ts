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
  await expect(queueMeta.getByText('3', { exact: true })).toBeVisible();
  await expect(page.getByText('48h stale')).toBeVisible();
  await expect(page.getByText('Ban by ID')).toBeVisible();

  await page.getByRole('link', { name: 'Prize Patrol', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Prize Patrol' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detection History' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Case Moderation Outcomes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify User' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Close No Action' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Refresh Notification' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Repair Thread' })).toBeEnabled();
  const kickAction = page.locator('details.destructive-action').filter({ hasText: 'Kick User' });
  await kickAction.getByText('Kick User', { exact: true }).click();
  await expect(kickAction.getByLabel('Reason')).toBeVisible();
  await expect(kickAction.getByLabel('Confirm Kick User')).toBeVisible();
  await kickAction.getByText('Kick User', { exact: true }).click();
  const banAction = page.locator('details.destructive-action').filter({ hasText: 'Ban User' });
  await banAction.getByText('Ban User', { exact: true }).click();
  await expect(banAction.getByLabel('Confirm Ban User')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open Admin Notice/ })).toHaveAttribute(
    'href',
    'https://discord.com/channels/guild-1/admin-channel-1/admin-message-1'
  );

  await page.getByRole('link', { name: 'Prize Patrol', exact: true }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/members/user-100');
  await expect(page.getByRole('heading', { name: 'Prize Patrol' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detection History' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moderation Outcomes' })).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases/case-left');
  const banByIdAction = page.locator('details.destructive-action').filter({ hasText: 'Ban by ID' });
  await banByIdAction.getByText('Ban by ID', { exact: true }).click();
  await expect(banByIdAction.getByLabel('Confirm Ban by ID')).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases/case-banned');
  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync Existing Ban' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Refresh Notification' })).toBeEnabled();

  await page.goto('/admin/guild/guild-1/cases');
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/history');
  await expect(page.getByRole('heading', { name: /fixture guild case history/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolved Ban' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolved Friend' })).toBeVisible();
  await page.getByLabel('Search').fill('resolved friend');
  await expect(page.getByRole('heading', { name: 'Resolved Friend' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolved Ban' })).toHaveCount(0);
  const historyExportAction = page.locator('details.export-action');
  await historyExportAction.getByText('Export Visible', { exact: true }).click();
  await expect(historyExportAction.getByLabel('Visible history export')).toContainText(
    'case_id\tuser_id\tuser\tpresence'
  );
  await page.getByLabel('Search').fill('');
  await page.getByLabel('Outcome').selectOption('banned');
  await expect(page.getByRole('heading', { name: 'Resolved Ban' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolved Friend' })).toHaveCount(0);
  await page.getByLabel('Outcome').selectOption('all');

  await page.getByRole('link', { name: 'Resolved Friend', exact: true }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/cases/case-resolved-verified');
  await expect(page.getByRole('heading', { name: 'Resolved Friend' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen Case' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Verify User' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close No Action' })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Open Case' })).toBeEnabled();

  await page.getByRole('link', { name: 'Open Detail' }).first().click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports/report-1');
  await expect(page.getByRole('heading', { name: /report for user user-300/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Report Evidence' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Case' })).toBeEnabled();
  await expect(page.getByText(/they sent me a nitro link/i)).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases');
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();

  await page.goto('/admin/guild/guild-1/cases/case-stale');
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL('/admin/guild/guild-1/reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();
});
