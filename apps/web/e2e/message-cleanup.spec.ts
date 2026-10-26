import { expect, test } from '@playwright/test';
import { workspaceIds as id, workspaceFixtures } from './workspaceFixtures';
const fixtures = workspaceFixtures();
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

for (const scope of ['source_message', 'last_hour', 'last_day', 'last_7_days'])
  test(`cleanup ${scope} preview confirms scope, member and reason before persistence`, async ({
    page,
  }) => {
    await fixtures.pool.query(
      'update verification_events set private_evidence_thread_id=$2 where id=$1',
      [id.case, id.thread]
    );
    await page.goto(`/admin/guild/${id.guild}/cases/${id.case}`);
    await page.getByRole('button', { name: 'Case tools', exact: true }).click();
    await page.getByRole('combobox', { name: 'Scope', exact: true }).selectOption(scope);
    await page.getByRole('button', { name: 'Preview messages', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(id.member);
    await expect(dialog).toContainText('Preview limit 500; execution limit 100 messages.');
    await dialog.getByLabel('Reason', { exact: true }).fill('Review messages for this case.');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Confirm Preview messages', exact: true }).click();
    await expect
      .poll(async () =>
        Number(
          (
            await fixtures.pool.query(
              'select count(*) from message_deletion_jobs where verification_event_id=$1',
              [id.case]
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    const row = (
      await fixtures.pool.query(
        'select scope,reason,mode,status from message_deletion_jobs where verification_event_id=$1',
        [id.case]
      )
    ).rows[0];
    expect(row).toMatchObject({
      scope,
      reason: 'Review messages for this case.',
      mode: 'delete_only',
      status: 'queued',
    });
  });
