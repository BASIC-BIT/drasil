import { expect, test } from '@playwright/test';
const reportPath = '/admin/guild/guild-1/reports/report-1';
test('bans directly from the report with a queued receipt and no case creation', async ({
  page,
}) => {
  await page.goto(reportPath);
  await page.getByText('Ban', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Confirm Ban action' });
  await expect(form).toContainText('Reported member (user-300)');
  await form.getByLabel('Ban reason', { exact: false }).fill('Reviewed report evidence.');
  await form.getByLabel('Confirm Ban for user-300').check();
  await page.screenshot({
    path:
      process.env.REPORT_BAN_CONFIRMATION_SCREENSHOT ?? 'test-results/report-ban-confirmation.png',
    fullPage: true,
  });
  await form.getByRole('button', { name: 'Confirm Ban', exact: true }).click();
  await expect(form).toContainText('queued');
  await expect(page.getByText('Banned.', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.case-meta')).toContainText('Actioned');
  await expect(page.locator('a[href*="/cases/"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Case', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm Ban', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.locator('a[href="/admin/guild/guild-1/reports/report-1"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Select Submitted report', exact: true })
  ).toHaveCount(0);
});
for (const scenario of ['banned_updates_pending', 'ban_outcome_unknown']) {
  test(`retains ${scenario} without another ban submit`, async ({ page }) => {
    await page.goto(`${reportPath}?reportBanScenario=${scenario}`);
    await expect(
      page.getByText(
        scenario === 'banned_updates_pending'
          ? 'Banned. Report updates are still pending.'
          : 'Ban outcome needs review.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm Ban', exact: true })).toHaveCount(0);
  });
}
