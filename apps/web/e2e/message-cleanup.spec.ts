import { expect, test, type Page } from '@playwright/test';

const casePath = '/admin/guild/guild-1/cases/case-stale';

function cleanupSection(page: Page) {
  return page.getByRole('region', { name: 'Message cleanup' });
}

function previewForm(page: Page) {
  return cleanupSection(page).locator('form.cleanup-preview-form');
}

test('source-message execution submits once and exposes its durable receipt', async ({ page }) => {
  await page.goto(casePath);

  const cleanup = cleanupSection(page);
  const form = cleanup.locator('form.cleanup-execute-form');
  await expect(cleanup.getByRole('heading', { name: 'Delete messages' })).toBeVisible();
  await expect(cleanup.locator('.cleanup-coverage .status')).toHaveText('partial');
  await expect(cleanup.getByText(/single source message/i)).toBeVisible();
  await form.getByLabel('Confirm delete 1 message').check();
  await form.getByRole('button', { name: 'Delete Messages' }).click();

  await expect(form.locator('.action-receipt .status')).toHaveText('queued');
  await expect(form).toContainText('Message cleanup queued.');
  await expect(form.getByRole('button', { name: 'Delete Messages' })).toBeDisabled();
  await expect(form.locator('.action-receipt')).toHaveCount(1);
});

test('failed execution rotates its request token and can be retried', async ({ page }) => {
  await page.goto(casePath);

  const form = cleanupSection(page).locator('form.cleanup-execute-form');
  const token = form.locator('input[name="idempotencyKey"]');
  await expect(token).not.toHaveValue('');
  const firstToken = await token.inputValue();
  await token.evaluate((input: HTMLInputElement) => {
    input.value = 'invalid';
  });
  await form.getByLabel('Confirm delete 1 message').check();
  await form.getByRole('button', { name: 'Delete Messages' }).click();

  await expect(form.locator('.action-receipt .status')).toHaveText('failed');
  await expect(token).not.toHaveValue(firstToken);
  await expect(token).not.toHaveValue('invalid');
  await form.getByLabel('Confirm delete 1 message').check();
  await form.getByRole('button', { name: 'Delete Messages' }).click();
  await expect(form.locator('.action-receipt .status')).toHaveText('queued');
});

for (const scope of [
  { label: 'Source message', value: 'source_message' },
  { label: 'Last hour', value: 'last_hour' },
  { label: 'Last 24 hours', value: 'last_day' },
  { label: 'Last 7 days', value: 'last_7_days' },
] as const) {
  test(`submits a valid ${scope.label.toLowerCase()} preview`, async ({ page }) => {
    await page.goto(`${casePath}?cleanupScenario=new-preview`);

    const form = previewForm(page);
    await form.getByLabel('Scope').selectOption(scope.value);
    await form.getByLabel('Reason').fill(`Review the ${scope.label.toLowerCase()} message set.`);
    await form.getByRole('button', { name: 'Preview Messages' }).click();

    await expect(form.locator('.action-receipt .status')).toHaveText('queued');
    await expect(form).toContainText('Message cleanup preview queued.');
    await expect(form.getByRole('button', { name: 'Previewing...' })).toBeDisabled();
  });
}

test('Start new preview creates a fresh stable token for each explicit intent', async ({
  page,
}) => {
  await page.goto(`${casePath}?cleanupScenario=blocked-indexing`);

  const cleanup = cleanupSection(page);
  const startNewPreview = cleanup.getByRole('button', { name: 'Start new preview' });
  await expect(startNewPreview).toBeEnabled();
  await startNewPreview.click();
  const firstForm = previewForm(page);
  const firstToken = firstForm.locator('input[name="idempotencyKey"]');
  await expect(firstToken).not.toHaveValue('');
  const firstValue = await firstToken.inputValue();
  await firstForm.getByLabel('Reason').fill('Review the frozen message set.');
  await expect(firstToken).toHaveValue(firstValue);

  await page.reload();
  const reloadedStartNewPreview = cleanupSection(page).getByRole('button', {
    name: 'Start new preview',
  });
  await expect(reloadedStartNewPreview).toBeEnabled();
  await reloadedStartNewPreview.click();
  const secondToken = previewForm(page).locator('input[name="idempotencyKey"]');
  await expect(secondToken).not.toHaveValue('');
  expect(await secondToken.inputValue()).not.toBe(firstValue);
});

test('too-many coverage blocks execution and offers a narrower preview', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=too-many`);

  const cleanup = cleanupSection(page);
  await expect(cleanup.locator('.cleanup-coverage .status')).toHaveText('too_many');
  await expect(cleanup.getByText(/100-message execution limit/i)).toBeVisible();
  await expect(cleanup.getByRole('button', { name: 'Delete Messages' })).toHaveCount(0);
  await expect(cleanup.getByRole('button', { name: 'Start new preview' })).toBeVisible();
});

test('standard ban remains independent and submits without cleanup', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');

  const ban = page.locator('details.cleanup-ban-action');
  await ban.getByText('Ban User', { exact: true }).click();
  await ban.getByLabel('Reason').fill('Confirmed moderation decision.');
  await ban.getByLabel('Confirm Ban User').check();
  await ban.getByRole('button', { name: 'Queue Ban User' }).click();

  await expect(ban.getByLabel('Also delete messages')).not.toBeChecked();
  await expect(ban.locator('.action-receipt .status')).toHaveText('queued');
});

test('combined ban and cleanup submits the frozen job with confirmation', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=combined-ready`);

  const ban = page.locator('details.cleanup-ban-action');
  await ban.getByText('Ban User', { exact: true }).click();
  await ban.getByLabel('Also delete messages').check();
  const form = ban.locator('form.cleanup-execute-form');
  await form.getByLabel('Confirm ban and delete 1 message').check();
  await form.getByRole('button', { name: 'Ban User and Delete Messages' }).click();

  await expect(form.locator('.action-receipt .status')).toHaveText('queued');
  await expect(form).toContainText('Ban and message cleanup queued.');
  await expect(form.getByRole('button', { name: 'Ban User and Delete Messages' })).toBeDisabled();
});

test('changed messages remain preserved and visibly skipped', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=changed-result`);

  const cleanup = cleanupSection(page);
  await expect(cleanup.getByLabel('Message cleanup outcomes')).toContainText('Changed1');
  await expect(cleanup.getByText('Changed after preview')).toBeVisible();
  await expect(cleanup.getByText(/was not deleted/i)).toBeVisible();
  await expect(
    cleanup.getByRole('region', { name: 'Message cleanup preview' }).getByRole('link', {
      name: 'Evidence',
    })
  ).toHaveCount(2);
});

test('cleanup controls are absent for a non-Administrator fixture viewer', async ({ page }) => {
  await page.goto(`${casePath}?cleanupScenario=non-administrator`);
  await expect(cleanupSection(page)).toHaveCount(0);
});

test('cleanup controls are absent for a resolved case', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/cases/case-resolved-ban');
  await expect(cleanupSection(page)).toHaveCount(0);
});

test('delete-only job detail omits the combined ban lifecycle', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/cases/case-stale/message-cleanup/cleanup-job-source');
  await expect(page.getByRole('heading', { name: 'Delete messages' })).toBeVisible();
  await expect(page.getByLabel('Combined action state')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Message cleanup preview' })).toBeVisible();
});

test('combined job detail exposes item outcomes and preserved evidence', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/cases/case-stale/message-cleanup/cleanup-job-combined');
  await expect(page.getByLabel('Combined action state')).toContainText('Ban succeeded');
  await expect(page.getByRole('list').locator('.cleanup-message-row')).toHaveCount(2);
  await expect(
    page.getByRole('region', { name: 'Message cleanup preview' }).getByRole('link', {
      name: 'Evidence',
    })
  ).toHaveCount(1);
});

test('inbox exposes cleanup only for the selected case item', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');
  const cleanup = cleanupSection(page);
  await expect(cleanup).toBeVisible();
  await expect(cleanup.getByText(/review every frozen message/i)).toBeVisible();
  await expect(cleanup.getByRole('button', { name: 'Delete Messages' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Submitted report' }).click();
  await expect(cleanupSection(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Observed alert pending review' }).click();
  await expect(cleanupSection(page)).toHaveCount(0);
});

test('combined cleanup panel does not create horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${casePath}?cleanupScenario=combined-ready`);

  const ban = page.locator('details.cleanup-ban-action');
  await ban.getByText('Ban User', { exact: true }).click();
  await ban.getByLabel('Also delete messages').check();
  await expect(ban.getByRole('heading', { name: 'Ban user and delete messages' })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
