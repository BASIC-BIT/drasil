import { expect, test } from '@playwright/test';
import { workspaceIds as id, workspaceFixtures } from './workspaceFixtures';
const fixtures = workspaceFixtures();
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

test('server navigation and old queue URLs adopt the inbox views', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Moderation inbox' })).toBeVisible();
  for (const [path, kind] of [
    ['cases', 'case'],
    ['reports', 'submitted_report'],
  ]) {
    await page.goto(`/admin/guild/${id.guild}/${path}`);
    await expect(page).toHaveURL(`/admin/guild/${id.guild}/inbox?kind=${kind}`);
    await expect(page.getByRole('combobox', { name: 'Inbox kind' })).toHaveValue(kind);
  }
});

test('history and member destinations still open the canonical resolved workspace', async ({
  page,
}) => {
  await fixtures.pool.query(
    "update verification_events set status='verified',resolved_at=now() where id=$1",
    [id.case]
  );
  await page.goto(`/admin/guild/${id.guild}/history`);
  await page.getByRole('link', { name: 'Case member', exact: true }).click();
  await expect(page).toHaveURL(`/admin/guild/${id.guild}/cases/${id.case}`);
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Member history', exact: true }).click();
  await expect(page).toHaveURL(`/admin/guild/${id.guild}/members/${id.member}`);
  await expect(page.getByRole('heading', { name: 'Case member', exact: true })).toBeVisible();
});
