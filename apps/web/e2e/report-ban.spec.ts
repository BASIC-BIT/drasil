import { expect, test } from '@playwright/test';
import { workspaceIds as id, workspaceFixtures } from './workspaceFixtures';
const fixtures = workspaceFixtures();
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

test('direct report ban confirms the server-side target and persists a receipt without opening a case', async ({
  page,
}) => {
  await page.goto(`/admin/guild/${id.guild}/reports/${id.report}`);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(id.member);
  await expect(dialog).toContainText('No message deletion requested.');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed the complete report.');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (
          await fixtures.pool.query(
            'select count(*) from moderation_action_requests where server_id=$1 and report_intake_id=$2',
            [id.guild, id.report]
          )
        ).rows[0].count
      )
    )
    .toBe(1);
  const row = (
    await fixtures.pool.query(
      'select * from moderation_action_requests where server_id=$1 and report_intake_id=$2',
      [id.guild, id.report]
    )
  ).rows[0];
  expect(row).toMatchObject({
    action_type: 'ban_observed_detection',
    target_user_id: id.member,
    report_intake_id: id.report,
    status: 'queued',
    verification_event_id: null,
  });
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
  expect(
    Number(
      (
        await fixtures.pool.query('select count(*) from verification_events where server_id=$1', [
          id.guild,
        ])
      ).rows[0].count
    )
  ).toBe(1);
});
