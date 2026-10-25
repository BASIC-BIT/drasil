import { expect, test, type Page } from '@playwright/test';
const casePath = '/admin/guild/guild-1/cases/case-stale';
const cleanup = (page: Page) => page.getByRole('region', { name: 'Message cleanup', exact: true });
async function confirm(page: Page, label: string) {
  await cleanup(page).getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  await dialog.getByRole('checkbox').check();
  return dialog;
}
test('source-message execution confirms frozen count and exposes durable receipt once', async ({
  page,
}) => {
  await page.goto(casePath);
  const dialog = await confirm(page, 'Delete 1 message');
  await expect(dialog).toContainText('Coverage: partial');
  await dialog.getByRole('button', { name: 'Confirm Delete 1 message' }).click();
  await expect(cleanup(page).getByText('Request queued.', { exact: true })).toBeVisible();
  await expect(
    cleanup(page).getByRole('button', { name: 'Delete 1 message', exact: true })
  ).toBeDisabled();
});
for (const [label, scope] of [
  ['Source message', 'source_message'],
  ['Last hour', 'last_hour'],
  ['Last 24 hours', 'last_day'],
  ['Last 7 days', 'last_7_days'],
])
  test(`confirmed ${label} preview respects required reason`, async ({ page }) => {
    await page.goto(`${casePath}?cleanupScenario=new-preview`);
    await cleanup(page).getByLabel('Scope', { exact: true }).selectOption(scope);
    const dialog = await confirm(page, 'Preview messages');
    await expect(dialog).toContainText(label);
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('Reviewed messages');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(cleanup(page).getByText('Request queued.', { exact: true })).toBeVisible();
  });
for (const scenario of ['blocked-indexing', 'too-many'])
  test(`${scenario} blocks execution and offers new preview`, async ({ page }) => {
    await page.goto(`${casePath}?cleanupScenario=${scenario}`);
    await expect(cleanup(page).getByRole('button', { name: /^Delete \d/ })).toHaveCount(0);
    await cleanup(page).getByRole('button', { name: 'New preview' }).click();
    await expect(
      cleanup(page).getByRole('button', { name: 'Preview messages', exact: true })
    ).toBeVisible();
  });
test('standard ban remains independent of cleanup', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');
  const ban = page.locator('details.cleanup-ban-action');
  await ban.getByText('Ban User', { exact: true }).click();
  await ban.getByLabel('Reason').fill('Confirmed moderation decision');
  await ban.getByLabel('Confirm Ban User').check();
  await ban.getByRole('button', { name: 'Queue Ban User' }).click();
  await expect(ban.locator('.action-receipt .status')).toHaveText('queued');
  await expect(ban.getByLabel('Also delete messages')).toHaveCount(0);
});
test('explicit combined cleanup confirms the frozen job', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=combined-ready`);
  await cleanup(page).getByLabel('Cleanup action').selectOption('ban_with_cleanup');
  const dialog = await confirm(page, 'Ban and delete 1 message');
  await dialog.getByRole('button', { name: 'Confirm Ban and delete 1 message' }).click();
  await expect(cleanup(page).getByText('Request queued.', { exact: true })).toBeVisible();
});
test('finalization retry confirms the original completed job', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=finalization-retry`);
  await cleanup(page).getByLabel('Cleanup action').selectOption('ban_with_cleanup');
  await expect(cleanup(page).getByLabel('Combined action state')).toContainText(
    'Ban succeeded. Case finalization failed.'
  );
  const dialog = await confirm(page, 'Retry case finalization');
  await expect(dialog).toContainText('without repeating ban or deletion');
  await dialog.getByRole('button', { name: 'Confirm Retry case finalization' }).click();
  await expect(
    cleanup(page).getByRole('button', { name: 'Retry case finalization', exact: true })
  ).toBeDisabled();
});
test('changed messages retain evidence and explicit skip outcomes', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=changed-result`);
  await expect(cleanup(page).getByText('Changed after preview', { exact: true })).toBeVisible();
  await expect(cleanup(page).getByRole('link', { name: 'Evidence', exact: true })).toHaveCount(2);
});
test('non-Administrator and resolved cases cannot use cleanup', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=non-administrator`);
  await expect(cleanup(page)).toHaveCount(0);
  await page.goto('/admin/guild/guild-1/cases/case-resolved-ban');
  await expect(cleanup(page)).toHaveCount(0);
});
test('job detail preserves both combined lifecycle and actual message outcomes', async ({
  page,
}) => {
  await page.goto(`${casePath}/message-cleanup/cleanup-job-combined`);
  await expect(page.getByLabel('Combined action state')).toContainText('Ban succeeded');
  await expect(page.locator('.cleanup-message-row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Evidence', exact: true })).toHaveCount(1);
});
test('inbox requires every frozen message before execution', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');
  await expect(cleanup(page).getByText(/review every frozen message/i)).toBeVisible();
  await expect(cleanup(page).getByRole('button', { name: /^Delete \d/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submitted report' }).click();
  await expect(cleanup(page)).toHaveCount(0);
});
