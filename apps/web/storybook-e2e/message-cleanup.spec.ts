import { expect, test, type Page } from '@playwright/test';
const url = (story = 'ready') =>
  `/iframe.html?id=workspace-message-cleanup--${story}&viewMode=story`;
async function event(page: Page, value: string) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('fixture:cleanup', { detail })),
    value
  );
}
async function review(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  await dialog.getByRole('checkbox').check();
  return dialog;
}
async function payloads(page: Page) {
  return JSON.parse(await page.getByTestId('submitted-payloads').innerText());
}
for (const [scope, label] of [
  ['source_message', 'Source message'],
  ['last_hour', 'Last hour'],
  ['last_day', 'Last 24 hours'],
  ['last_7_days', 'Last 7 days'],
])
  test(`confirms ${label} preview with bounded reason and actual dedicated action`, async ({
    page,
  }) => {
    await page.goto(url('new-preview'));
    await page.getByLabel('Scope', { exact: true }).selectOption(scope);
    const dialog = await review(page, 'Preview messages');
    await expect(dialog).toContainText(label);
    await expect(dialog.getByRole('textbox')).toHaveAttribute('maxlength', '1000');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('0');
    await dialog.getByRole('textbox').fill('Reviewed messages');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('1');
    expect((await payloads(page))[0]).toMatchObject({
      actionType: 'preview_case_message_deletion',
      fields: {
        scope,
        mode: 'delete_only',
        reason: 'Reviewed messages',
        confirmedRecordId: 'case-stale',
        confirmedTargetUserId: 'user-100',
      },
    });
  });
test('single-source partial executes exactly the frozen count with original reason', async ({
  page,
}) => {
  await page.goto(url());
  const dialog = await review(page, 'Delete 1 message');
  await expect(dialog).toContainText('Coverage: partial');
  await expect(dialog.getByRole('textbox')).toHaveAttribute('readonly', '');
  await dialog.getByRole('button', { name: 'Confirm Delete 1 message' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  expect((await payloads(page))[0]).toMatchObject({
    actionType: 'execute_case_message_deletion',
    fields: {
      expectedCandidateCount: '1',
      expectedPreviewedAt: '2026-07-15T15:00:01.000Z',
      jobId: 'cleanup-job-source',
      scope: 'source_message',
      mode: 'delete_only',
    },
  });
  await expect(page.getByRole('button', { name: 'Delete 1 message', exact: true })).toBeDisabled();
});
for (const change of ['count', 'generation'])
  test(`open cleanup confirmation rejects changed ${change}`, async ({ page }) => {
    await page.goto(url());
    const dialog = await review(page, 'Delete 1 message');
    await event(page, change);
    await expect(dialog).toContainText('out of date');
    await expect(dialog.getByRole('button', { name: 'Confirm Delete 1 message' })).toBeDisabled();
    await expect(page.getByTestId('submission-count')).toHaveText('0');
  });
for (const story of ['denied', 'indexing', 'partial-window', 'too-many'])
  test(`${story} offers new preview without guessed execution`, async ({ page }) => {
    await page.goto(url(story));
    await expect(page.getByRole('button', { name: /^Delete \d/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'New preview' }).click();
    await expect(page.getByRole('button', { name: 'Preview messages', exact: true })).toBeEnabled();
  });
test('ordinary ban stays independent of cleanup', async ({ page }) => {
  await page.goto(url());
  const dialog = await review(page, 'Ban member');
  await dialog.getByRole('textbox').fill('Reviewed ban');
  await dialog.getByRole('button', { name: 'Confirm Ban member' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  const calls = await payloads(page);
  expect(calls[0].actionType).toBe('ban_case_user');
  expect(calls[0].fields.jobId).toBeUndefined();
});
test('combined completion retries only finalization on the same job', async ({ page }) => {
  await page.goto(url('combined'));
  let dialog = await review(page, 'Ban and delete 1 message');
  await dialog.getByRole('button', { name: 'Confirm Ban and delete 1 message' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await event(page, 'finish');
  await expect(page.getByLabel('Combined action state')).toContainText(
    'Ban succeeded. Case finalization failed.'
  );
  dialog = await review(page, 'Retry case finalization');
  await expect(dialog).toContainText('without repeating ban or deletion');
  await dialog.getByRole('button', { name: 'Confirm Retry case finalization' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('2');
  const calls = await payloads(page);
  expect(calls.map((call: { actionType: string }) => call.actionType)).toEqual([
    'ban_case_user_with_message_cleanup',
    'ban_case_user_with_message_cleanup',
  ]);
  expect(calls[1].fields.jobId).toBe(calls[0].fields.jobId);
  expect(calls[1].fields.idempotencyKey).not.toBe(calls[0].fields.idempotencyKey);
  await expect(
    page.getByRole('button', { name: 'Retry case finalization', exact: true })
  ).toBeDisabled();
  await event(page, 'finalized');
  await expect(page.getByLabel('Combined action state')).toContainText(
    'Case finalization succeeded'
  );
});
test('lost response ignores unrelated jobs and same-job foreign intent', async ({ page }) => {
  await page.goto(url('response-loss'));
  const dialog = await review(page, 'Delete 1 message');
  await dialog.getByRole('button', { name: 'Confirm Delete 1 message' }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh durable state', exact: true })
  ).toBeVisible();
  for (const change of ['unrelated', 'same-job-other-intent']) {
    await event(page, change);
    await expect(
      page.getByRole('button', { name: 'Refresh durable state', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Delete 1 message', exact: true })
    ).toBeDisabled();
  }
  await event(page, 'recover');
  await expect(
    page.getByRole('button', { name: 'Refresh durable state', exact: true })
  ).toHaveCount(0);
  await expect(page.getByText('Request queued.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
});
test('worker failure renews its intent once and unchanged reads preserve the renewed confirmation', async ({
  page,
}) => {
  await page.goto(url());
  let dialog = await review(page, 'Delete 1 message');
  await dialog.getByRole('button', { name: 'Confirm Delete 1 message' }).click();
  await event(page, 'failed');
  await page.getByRole('button', { name: 'Review cleanup retry' }).click();
  dialog = await review(page, 'Delete 1 message');
  await event(page, 'read');
  await expect(dialog).not.toContainText('out of date');
  await event(page, 'generation');
  await expect(dialog).toContainText('out of date');
  await expect(dialog.getByRole('button', { name: 'Confirm Delete 1 message' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await review(page, 'Delete 1 message');
  await dialog.getByRole('button', { name: 'Confirm Delete 1 message' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('2');
  const calls = await payloads(page);
  expect(calls[1].fields.idempotencyKey).not.toBe(calls[0].fields.idempotencyKey);
});
test('permission denial hides cleanup mutations and item failures remain explicit', async ({
  page,
}) => {
  await page.goto(url('non-admin'));
  await expect(page.getByRole('region', { name: 'Message cleanup', exact: true })).toHaveCount(0);
  await page.goto(url('outcomes'));
  for (const status of [
    'Deleted',
    'Already missing',
    'Changed after preview',
    'Evidence failed',
    'Delete failed',
    'Permission denied',
  ])
    await expect(
      page.locator('.cleanup-message-row .status').filter({ hasText: new RegExp(`^${status}$`) })
    ).toHaveCount(1);
});
test('mobile reviewed preview stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url());
  await expect(page.getByText('Channel General', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/task8-cleanup-mobile.png', fullPage: true });
});

test('scope and mode changes require a fresh reviewed preview intent', async ({ page }) => {
  await page.goto(url());
  await page.getByLabel('Scope', { exact: true }).selectOption('last_day');
  await expect(page.getByRole('button', { name: 'Delete 1 message', exact: true })).toHaveCount(0);
  await page.getByLabel('Cleanup action').selectOption('ban_with_cleanup');
  await page.getByLabel('Scope', { exact: true }).selectOption('last_hour');
  const dialog = await review(page, 'Preview messages');
  await expect(dialog).toContainText('ban and delete messages');
  await dialog.getByRole('textbox').fill('Reviewed combined cleanup scope');
  await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  expect((await payloads(page))[0]).toMatchObject({
    actionType: 'preview_case_message_deletion',
    fields: { scope: 'last_hour', mode: 'ban_with_cleanup' },
  });
});

test('an already banned case offers only continuation of the original finalization job', async ({
  page,
}) => {
  await page.goto(url('finalization'));
  await expect(page.getByRole('button', { name: 'New preview', exact: true })).toHaveCount(0);
  const dialog = await review(page, 'Retry case finalization');
  await expect(dialog).toContainText('job cleanup-job-combined');
  await dialog.getByRole('button', { name: 'Confirm Retry case finalization' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  expect((await payloads(page))[0]).toMatchObject({
    actionType: 'ban_case_user_with_message_cleanup',
    fields: { jobId: 'cleanup-job-combined', expectedCandidateCount: '2' },
  });
});

for (const change of ['scope', 'mode'] as const)
  test(`completed preview renews through ${change} selection exactly once`, async ({ page }) => {
    await page.goto(url('new-preview'));
    let dialog = await review(page, 'Preview messages');
    await dialog.getByRole('textbox').fill('First reviewed preview');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('1');
    const first = (await payloads(page))[0];
    await event(page, 'preview-complete');
    await expect(page.getByText('Request completed.', { exact: true })).toBeVisible();
    if (change === 'scope')
      await page.getByLabel('Scope', { exact: true }).selectOption('last_hour');
    else await page.getByLabel('Cleanup action').selectOption('ban_with_cleanup');
    await expect(page.getByRole('button', { name: 'Preview messages', exact: true })).toBeEnabled();
    dialog = await review(page, 'Preview messages');
    await dialog.getByRole('textbox').fill('Second reviewed preview');
    await dialog.evaluate((element) => element.setAttribute('data-renewed-intent', 'retained'));
    await page.locator('select[aria-label="Scope"]').selectOption('last_7_days', { force: true });
    await expect(dialog).toHaveAttribute('data-renewed-intent', 'retained');
    await expect(dialog.getByRole('textbox')).toHaveValue('Second reviewed preview');
    await expect(dialog).toContainText('out of date');
    await expect(dialog.getByRole('button', { name: 'Confirm Preview messages' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    dialog = await review(page, 'Preview messages');
    await expect(dialog.getByRole('textbox')).toHaveValue('Second reviewed preview');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('2');
    const second = (await payloads(page))[1];
    expect(second.fields.idempotencyKey).not.toBe(first.fields.idempotencyKey);
    expect(second.fields).toMatchObject({
      scope: 'last_7_days',
      mode: change === 'mode' ? 'ban_with_cleanup' : 'delete_only',
      reason: 'Second reviewed preview',
    });
  });
for (const status of ['pending', 'uncertain'] as const)
  test(`${status} preview keeps its token and receipt across selection changes`, async ({
    page,
  }) => {
    await page.goto(url(status === 'pending' ? 'new-preview' : 'response-loss'));
    if (status === 'uncertain')
      await page.getByRole('button', { name: 'New preview', exact: true }).click();
    const dialog = await review(page, 'Preview messages');
    await dialog.getByRole('textbox').fill('Reviewed preview');
    await dialog.getByRole('button', { name: 'Confirm Preview messages' }).click();
    await expect(page.getByTestId('submission-count')).toHaveText('1');
    await page.getByLabel('Scope', { exact: true }).selectOption('last_hour');
    await page.getByLabel('Cleanup action').selectOption('ban_with_cleanup');
    await expect(
      page.getByRole('button', { name: 'Preview messages', exact: true })
    ).toBeDisabled();
    if (status === 'uncertain') {
      await expect(
        page.getByRole('button', { name: 'Refresh durable state', exact: true })
      ).toBeVisible();
      await event(page, 'recover');
      await expect(
        page.getByRole('button', { name: 'Refresh durable state', exact: true })
      ).toHaveCount(0);
    }
    await expect(page.getByText('Request queued.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('submission-count')).toHaveText('1');
  });
