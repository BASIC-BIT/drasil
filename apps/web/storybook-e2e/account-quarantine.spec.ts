import { expect, test } from '@playwright/test';
const story = (state: string) =>
  `/iframe.html?id=moderation-workspace-account-quarantine--${state}&viewMode=story`;
async function confirm(
  page: import('@playwright/test').Page,
  name: string,
  reason = 'Account compromise confirmed'
) {
  await page.getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (reason) await dialog.getByLabel('Reason', { exact: true }).fill(reason);
  await dialog.getByLabel(`Confirm ${name}`, { exact: true }).check();
  await dialog.getByRole('button', { name: `Confirm ${name}`, exact: true }).click();
}
test('preview confirmation can cancel before queuing and produces a saved preview', async ({
  page,
}) => {
  await page.goto(story('empty'));
  await page.getByRole('button', { name: 'Preview account quarantine', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await confirm(page, 'Preview account quarantine', '');
  await expect(page.getByRole('status')).toContainText('Request queued.');
  await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Attempt account quarantine', exact: true })
  ).toBeEnabled();
  await expect(page.getByTestId('submitted-payload')).toContainText('"quarantinePhase":"preview"');
  await expect(page.getByTestId('submitted-payload')).toContainText(
    '"confirmedRecordId":"case-stale"'
  );
});
test('incomplete containment remains in review and preserves preview/case/member/action identity', async ({
  page,
}) => {
  await page.goto(story('fresh'));
  await confirm(page, 'Attempt account quarantine');
  await expect(page.getByRole('status')).toContainText('Request queued.');
  await expect(
    page.getByRole('region', { name: 'Account containment and recovery' })
  ).toContainText('Containment incomplete');
  await expect(
    page.getByRole('region', { name: 'Account containment and recovery' })
  ).toContainText('Review required');
  await expect(
    page.getByRole('region', { name: 'Account containment and recovery' })
  ).toContainText('1 role removed; 1 removal failed');
  const payload = page.getByTestId('submitted-payload');
  await expect(payload).toContainText('"action":"quarantine_compromised_account"');
  await expect(payload).toContainText('"previewRequestId":"preview-1"');
  await expect(payload).toContainText('"confirmedTargetUserId":"user-100"');
  await expect(payload).toContainText(
    '"returnTo":"/admin/guild/guild-1/inbox?item=case:case-stale"'
  );
});
test('a changed preview cannot silently retarget an open confirmation', async ({ page }) => {
  await page.goto(story('fresh'));
  await page.getByRole('button', { name: 'Attempt account quarantine', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed preview one');
  await dialog.getByLabel('Confirm Attempt account quarantine', { exact: true }).check();
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:replace-preview')));
  await expect(
    dialog.getByRole('button', { name: 'Confirm Attempt account quarantine', exact: true })
  ).toBeDisabled();
  await expect(dialog).toContainText('preview-1');
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await confirm(page, 'Attempt account quarantine');
  await expect(page.getByTestId('submitted-payload')).toContainText(
    '"previewRequestId":"preview-2"'
  );
});
test('expired preview stays visible while execution is blocked and refresh is confirmed', async ({
  page,
}) => {
  await page.goto(story('stale'));
  await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toContainText(
    'preview-1'
  );
  await expect(
    page.getByRole('button', { name: 'Attempt account quarantine', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh quarantine preview', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});
test('parked recovery shows recorded effects and eligible release without close', async ({
  page,
}) => {
  await page.goto(story('parked'));
  await expect(page.getByText('Parked by moderator-1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close case', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Verify and release', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'eligible snapshotted roles under the current role policy'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});
for (const mode of ['breach', 'reply'])
  test(`${mode} entry preserves member, case and actual source channel; acknowledgement only clears attention`, async ({
    page,
  }) => {
    await page.goto(story(mode));
    await expect(page.getByRole('link', { name: 'Open case', exact: true })).toHaveAttribute(
      'href',
      /cases\/case-parked\?returnTo=/
    );
    await expect(page.getByRole('link', { name: 'Member history', exact: true })).toHaveAttribute(
      'href',
      /members\/user-parked$/
    );
    await expect(page.getByRole('link', { name: 'Open reply in Discord' })).toHaveAttribute(
      'href',
      `https://discord.com/channels/guild-1/${mode === 'breach' ? 'breach-channel' : 'recovery-thread'}/message-1`
    );
    await page.getByRole('button', { name: 'Acknowledge reply', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('quarantine');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('0');
  });

test('preview expiration disables an already-open confirmation', async ({ page }) => {
  await page.clock.install();
  await page.goto(story('fresh'));
  await page.getByRole('button', { name: 'Attempt account quarantine', exact: true }).click();
  await page.clock.fastForward(9 * 60_000 + 1);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirm Attempt account quarantine', exact: true })
  ).toBeDisabled();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});
test('a pending execution keeps its own receipt when the saved preview is replaced', async ({
  page,
}) => {
  await page.goto(story('fresh'));
  await confirm(page, 'Attempt account quarantine');
  await expect(page.getByRole('status')).toContainText('Request queued.');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:replace-preview')));
  await expect(page.getByRole('status')).toContainText('Request completed.');
  await expect(page.getByTestId('submitted-payload')).toContainText(
    '"previewRequestId":"preview-1"'
  );
});

test('authoritative stale execution rejection keeps the saved record and requires preview refresh', async ({
  page,
}) => {
  await page.goto(story('live-state-changed'));
  await confirm(page, 'Attempt account quarantine');
  await expect(page.getByRole('status')).toContainText(
    'Saved preview no longer matches the member or server.'
  );
  await expect(
    page.getByRole('button', { name: 'Attempt account quarantine', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Refresh quarantine preview', exact: true })
  ).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toContainText(
    'preview-1'
  );
});
test('containment preview fits the narrow viewport and shared dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(story('fresh'));
  await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: '../../.superpowers/sdd/2026-10-24-moderation-workspace/task-6-evidence/mobile-dark.png',
    fullPage: true,
  });
});

test('a confirmed refreshed preview permits another incomplete-containment attempt', async ({
  page,
}) => {
  await page.goto(story('fresh'));
  await confirm(page, 'Attempt account quarantine');
  await expect(page.getByRole('status')).toContainText('Request completed.');
  await confirm(page, 'Refresh quarantine preview', '');
  await expect(page.getByRole('region', { name: 'Saved quarantine preview' })).toContainText(
    'preview-queued'
  );
  await expect(
    page.getByRole('button', { name: 'Attempt account quarantine', exact: true })
  ).toBeEnabled();
});

test('a completed read alone preserves the unchanged open intent and reason draft', async ({
  page,
}) => {
  await page.goto(story('fresh'));
  await page.getByRole('button', { name: 'Attempt account quarantine', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed unchanged preview');
  await dialog.getByLabel('Confirm Attempt account quarantine', { exact: true }).check();
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:completed-read')));
  await expect(
    dialog.getByRole('button', { name: 'Confirm Attempt account quarantine', exact: true })
  ).toBeEnabled();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue(
    'Reviewed unchanged preview'
  );
  await dialog
    .getByRole('button', { name: 'Confirm Attempt account quarantine', exact: true })
    .click();
  await expect(page.getByTestId('submitted-payload')).toContainText(
    '"previewRequestId":"preview-1"'
  );
});
