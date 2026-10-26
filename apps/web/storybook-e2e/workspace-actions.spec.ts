import { expect, test } from '@playwright/test';
const story = '/iframe.html?id=workspace-actions-confirmed-action--interactive&viewMode=story';

test('confirmation focuses cancel, preserves the reason draft, and requires a reason', async ({
  page,
}) => {
  await page.goto(story);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue('Reviewed links');
  await dialog.getByLabel('Reason', { exact: true }).fill('');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
});

test('double submit queues once and completion does not steal reading focus', async ({ page }) => {
  await page.goto(story);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await page.getByLabel('Reading notes').focus();
  await expect(page.getByRole('status')).toContainText('Request completed.');
  await expect(page.getByLabel('Reading notes')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
});

test('response loss requires completed durable refresh before another attempt', async ({
  page,
}) => {
  await page.route('**/workspace-actions-response', (route) => route.abort('failed'));
  await page.goto(story.replace('interactive', 'response-loss-empty'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Response unavailable');
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Supply irrelevant request' }).click();
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh durable state' }).click();
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue('Reviewed links');
});

test('response loss reconciles matching pending request and reload retains it', async ({
  page,
}) => {
  await page.route('**/workspace-actions-response', (route) => route.abort('failed'));
  await page.goto(story.replace('interactive', 'response-loss-pending'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Request processing.');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Request processing.');
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
});

test('another moderator changing eligibility closes confirmation with explanation, focus and retained draft', async ({
  page,
}) => {
  await page.goto(story);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Reason', { exact: true }).fill('Reviewed');
  await page.getByRole('dialog').getByLabel('Confirm Ban member').check();
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:eligibility-changed')));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const explanation = page.getByRole('status');
  await expect(explanation).toContainText('Ban member is no longer available for this record');
  await expect(explanation).toBeFocused();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:eligibility-restored')));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Reason', { exact: true })).toHaveValue(
    'Reviewed'
  );
  await expect(page.getByRole('dialog').getByRole('checkbox')).not.toBeChecked();
});

test('active request polling stops when the consumer unmounts', async ({ page }) => {
  await page.addInitScript(() =>
    sessionStorage.setItem('workspace-action-story-pending', 'pending')
  );
  await page.clock.install();
  await page.goto(story.replace('interactive', 'response-loss-pending'));
  await expect(page.getByRole('status')).toContainText('Request processing.');
  await page.clock.fastForward(2_200);
  await expect(page.getByTestId('refresh-count')).not.toHaveText('0');
  await page.getByRole('button', { name: 'Leave action area' }).click();
  const count = await page.getByTestId('refresh-count').textContent();
  await page.clock.fastForward(4_200);
  await expect(page.getByTestId('refresh-count')).toHaveText(count ?? '');
});

test('case consumer reconciles completion while reading', async ({ page }) => {
  await page.goto(story.replace('interactive', 'case-intent'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  await page.getByLabel('Reading notes').focus();
  await expect(page.getByRole('status')).toContainText('Request completed.');
  await expect(page.getByLabel('Reading notes')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
});

test('explicit refresh after response loss retains its newly found matching request', async ({
  page,
}) => {
  await page.route('**/workspace-actions-response', (route) => route.abort('failed'));
  await page.goto(story.replace('interactive', 'response-loss-pending-manual'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason', { exact: true }).fill('Reviewed links');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh durable state', exact: true }).click();
  await expect(page.getByTestId('refresh-count')).toHaveText('1');
  await expect(page.getByRole('status')).toContainText('Request processing.');
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
});

test('known failed receipt stays bound to request B when another matching action request A changes', async ({
  page,
}) => {
  await page.goto(story.replace('interactive', 'failed-receipt-identity'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Request failed.');
  await page.getByRole('button', { name: 'Update other request' }).click();
  await expect(page.getByRole('status')).toContainText('Request failed.');
  await expect(
    page.getByRole('button', { name: 'Refresh durable state', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Supply returned request' }).click();
  await expect(page.getByRole('status')).toContainText('Request processing.');
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeDisabled();
});

test('local polling survives same-ID rerenders and stops on replacement under a persistent provider', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(story.replace('interactive', 'persistent-provider'));
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Confirm Ban member').check();
  await dialog.getByRole('button', { name: 'Confirm Ban member', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Request queued.');
  const countBeforeRerender = Number(await page.getByTestId('refresh-count').textContent());
  await page.getByRole('button', { name: 'Rerender same intent' }).click();
  await page.clock.fastForward(2_200);
  await expect(page.getByTestId('refresh-count')).toHaveText(String(countBeforeRerender + 1));
  await page.getByRole('button', { name: 'Rerender same intent' }).click();
  await page.clock.fastForward(2_200);
  await expect(page.getByTestId('refresh-count')).toHaveText(String(countBeforeRerender + 2));
  await page.getByRole('button', { name: 'Select next record' }).click();
  await expect(page.getByTestId('selection')).toHaveText('detection-2');
  await expect(page.getByRole('status')).toHaveCount(0);
  const countAfterReplacement = await page.getByTestId('refresh-count').textContent();
  await page.clock.runFor(4_200);
  await expect(page.getByTestId('refresh-count')).toHaveText(countAfterReplacement ?? '');
});

test('the shared confirmed action uses its supplied severity token', async ({ page }) => {
  await page.goto(story);
  const trigger = page.getByRole('button', { name: 'Ban member', exact: true });
  await expect(trigger).toHaveAttribute('data-tone', 'danger');
  const colors = await trigger.evaluate((button) => {
    const sample = document.createElement('span');
    sample.style.color = 'var(--dr-danger)';
    button.appendChild(sample);
    const expected = getComputedStyle(sample).color;
    sample.remove();
    const actual = getComputedStyle(button);
    return { color: actual.color, border: actual.borderTopColor, expected };
  });
  expect(colors.color).toBe(colors.expected);
  expect(colors.border).toBe(colors.expected);
});
