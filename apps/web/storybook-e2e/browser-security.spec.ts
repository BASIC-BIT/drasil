import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
const url = '/iframe.html?id=workspace-browser-security--failed&viewMode=story';
async function event(page: Page, value: string) {
  await page.evaluate(
    (detail) => window.dispatchEvent(new CustomEvent('fixture:security', { detail })),
    value
  );
}
async function confirm(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  await dialog
    .getByRole('textbox', { name: 'Reason', exact: true })
    .fill('Reviewed directly with this member');
  await dialog.getByRole('checkbox').check();
  return dialog;
}
for (const change of ['generation', 'method', 'revision'])
  test(`open bypass retains its reason and blocks changed ${change}`, async ({ page }) => {
    await page.goto(url);
    const dialog = await confirm(page, 'Continue without security check');
    await event(page, change);
    await expect(dialog).toContainText('out of date');
    await expect(dialog.getByRole('textbox')).toHaveValue('Reviewed directly with this member');
    await expect(
      dialog.getByRole('button', { name: 'Confirm Continue without security check' })
    ).toBeDisabled();
    await expect(page.getByTestId('submission-count')).toHaveText('0');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirm(page, 'Continue without security check');
    await expect(page.getByRole('dialog')).toContainText(
      change === 'generation'
        ? 'generation 3'
        : change === 'method'
          ? 'Discord image CAPTCHA'
          : 'method revision 3'
    );
  });
test('ordinary completed reads preserve generation and entered confirmation intent', async ({
  page,
}) => {
  await page.goto(url);
  const dialog = await confirm(page, 'Continue without security check');
  await event(page, 'read');
  await expect(dialog).not.toContainText('out of date');
  await dialog.getByRole('button', { name: 'Confirm Continue without security check' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  const payload = JSON.parse(await page.getByTestId('submitted-payload').innerText());
  expect(payload.fields).toMatchObject({
    expectedCaptchaChallengeId: '11111111-1111-4111-8111-111111111111',
    expectedCaptchaGeneration: '2',
    expectedCaptchaMethod: 'turnstile',
    expectedCaptchaMethodRevision: '2',
    reason: 'Reviewed directly with this member',
    confirmAction: 'on',
    returnTo: '/admin/guild/guild-1/inbox?item=case:case-stale',
  });
  await expect(page.getByRole('status')).toContainText('Request queued.');
  await event(page, 'complete');
  await expect(page.getByRole('status')).toContainText('Request completed.');
  await expect(page.getByRole('region', { name: 'Security check', exact: true })).toContainText(
    'Case open'
  );
});
test('retry invalidates old confirmation and sends only the reviewed generation', async ({
  page,
}) => {
  await page.goto(url);
  let dialog = await confirm(page, 'Retry security check');
  await event(page, 'generation');
  await expect(dialog.getByRole('button', { name: 'Confirm Retry security check' })).toBeDisabled();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  dialog = await confirm(page, 'Retry security check');
  await dialog.getByRole('button', { name: 'Confirm Retry security check' }).click();
  await expect(page.getByTestId('submitted-payload')).toContainText(
    '"expectedCaptchaGeneration":"3"'
  );
  await expect(page.getByRole('status')).toContainText('Request queued.');
});
test('unrelated generation cannot reconcile response loss; current receipt can', async ({
  page,
}) => {
  await page.goto(url.replace('--failed', '--response-loss'));
  const dialog = await confirm(page, 'Continue without security check');
  await dialog.getByRole('button', { name: 'Confirm Continue without security check' }).click();
  const trigger = page.getByRole('button', {
    name: 'Continue without security check',
    exact: true,
  });
  await expect(trigger).toBeDisabled();
  await event(page, 'unrelated');
  await expect(trigger).toBeDisabled();
  await expect(page.getByRole('status')).not.toContainText('Request queued.');
  await event(page, 'matching');
  await expect(page.getByRole('status')).toContainText('Request queued.');
  await event(page, 'complete');
  await expect(page.getByRole('status')).toContainText('Request completed.');
});
test('bypass requires a reason and confirmation', async ({ page }) => {
  await page.goto(url.replace('--failed', '--absent'));
  await expect(page.getByRole('button', { name: 'Retry security check', exact: true })).toHaveCount(
    0
  );
  await page.getByRole('button', { name: 'Continue without security check', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm Continue without security check' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('0');
  await expect(dialog.getByRole('textbox')).toHaveAttribute('required', '');
});
for (const story of ['passed', 'automatic'])
  test(`${story} check completion leaves pending case open`, async ({ page }) => {
    await page.goto(url.replace('--failed', `--${story}`));
    const panel = page.getByRole('region', { name: 'Security check', exact: true });
    await expect(panel).toContainText('Case open');
    await expect(panel).toContainText('Security check completed');
    await expect(
      panel.getByRole('button', { name: 'Retry security check', exact: true })
    ).toHaveCount(0);
    await expect(panel).not.toContainText('Case resolved');
  });
test('delivery failure reports the concrete error without a delivered date', async ({ page }) => {
  await page.goto(url.replace('--failed', '--delivery-failed'));
  const panel = page.getByRole('region', { name: 'Security check', exact: true });
  await expect(panel).toContainText('cannot_dm_user');
  await expect(panel).not.toContainText('link delivered');
  await expect(panel.locator('time[datetime="2026-10-25T11:01:00Z"]')).toHaveCount(0);
});
for (const width of [320, 1440])
  test(`security panel and confirmation reflow and accessibility at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page.addScriptTag({ content: axe.source });
    await confirm(page, 'Continue without security check');
    expect(
      await page.evaluate(async () => ({
        violations: (await window.axe.run(document.querySelector('[data-foundation-theme]')!))
          .violations,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }))
    ).toEqual({ violations: [], overflow: false });
    const lines = await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .evaluate((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getClientRects().length;
      });
    expect(lines).toBe(1);
    await page.screenshot({ path: `/tmp/task7-security-${width}.png`, fullPage: true });
  });

for (const { label, change, blocked } of [
  { label: 'Retry security check', change: 'generation', blocked: true },
  { label: 'Retry security check', change: 'configuration', blocked: true },
  { label: 'Continue without security check', change: 'generation', blocked: true },
  { label: 'Continue without security check', change: 'configuration', blocked: false },
])
  test(`renewed ${label} retains its dialog and reason after another ${change} change`, async ({
    page,
  }) => {
    await page.goto(url);
    const first = await confirm(page, label);
    await first.getByRole('button', { name: `Confirm ${label}`, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Request queued.');
    await event(page, 'generation');
    await event(page, 'complete');
    await expect(page.getByRole('button', { name: label, exact: true })).toBeEnabled();
    const renewed = await confirm(page, label);
    await expect(renewed).toContainText('generation 3');
    await renewed.getByRole('textbox').fill('Keep this renewed review reason');
    await renewed.evaluate((dialog) => dialog.setAttribute('data-renewed-review', 'retained'));
    await event(page, change);
    await expect(renewed).toBeVisible();
    await expect(renewed).toHaveAttribute('data-renewed-review', 'retained');
    await expect(renewed.getByRole('textbox')).toHaveValue('Keep this renewed review reason');
    const submit = renewed.getByRole('button', { name: `Confirm ${label}`, exact: true });
    if (blocked) {
      await expect(renewed).toContainText('out of date');
      await expect(submit).toBeDisabled();
      await expect(page.getByTestId('submission-count')).toHaveText('1');
      await renewed.getByRole('button', { name: 'Cancel', exact: true }).click();
      const current = await confirm(page, label);
      await expect(current).toContainText(
        change === 'generation' ? 'generation 4' : 'method revision 8'
      );
      await current.getByRole('button', { name: `Confirm ${label}`, exact: true }).click();
    } else {
      await expect(renewed).not.toContainText('out of date');
      await expect(submit).toBeEnabled();
      await submit.click();
    }
    await expect(page.getByTestId('submission-count')).toHaveText('2');
    await expect(page.getByRole('status')).toContainText('Request queued.');
    const payload = JSON.parse(await page.getByTestId('submitted-payload').innerText());
    expect(payload.fields.expectedCaptchaGeneration).toBe(change === 'generation' ? '4' : '3');
    if (label === 'Retry security check' && change === 'configuration') {
      expect(payload.fields).toMatchObject({
        expectedCaptchaConfigurationMethod: 'discord_image',
        expectedCaptchaConfigurationRevision: '8',
      });
    }
  });

for (const story of ['failed', 'not-issued'])
  test(`configured issuance method change invalidates ${story} confirmation`, async ({ page }) => {
    await page.goto(url.replace('--failed', `--${story}`));
    const label = story === 'failed' ? 'Retry security check' : 'Request security check';
    const dialog = await confirm(page, label);
    await event(page, 'configuration');
    await expect(dialog).toContainText('out of date');
    await expect(dialog.getByRole('button', { name: `Confirm ${label}` })).toBeDisabled();
    await expect(page.getByTestId('submission-count')).toHaveText('0');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const current = await confirm(page, label);
    await expect(current).toContainText('Discord image CAPTCHA, method revision 8');
    await current.getByRole('button', { name: `Confirm ${label}` }).click();
    const payload = JSON.parse(await page.getByTestId('submitted-payload').innerText());
    expect(payload.fields).toMatchObject({
      expectedCaptchaConfigurationMethod: 'discord_image',
      expectedCaptchaConfigurationRevision: '8',
    });
    if (story === 'failed') expect(payload.fields.expectedCaptchaGeneration).toBe('2');
  });
test('unknown issuance defaults disable issue/retry while bypass can still be reviewed', async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: 'Retry security check', exact: true })
  ).toBeEnabled();
  await event(page, 'unknown-configuration');
  await expect(page.getByRole('button', { name: 'Retry security check', exact: true })).toHaveCount(
    0
  );
  await expect(
    page.getByRole('button', { name: 'Continue without security check', exact: true })
  ).toBeEnabled();
});

test('bypass remains bound to the displayed generation when issuance defaults change', async ({
  page,
}) => {
  await page.goto(url);
  const dialog = await confirm(page, 'Continue without security check');
  await event(page, 'configuration');
  await expect(dialog).not.toContainText('out of date');
  await dialog.getByRole('button', { name: 'Confirm Continue without security check' }).click();
  await expect(page.getByTestId('submission-count')).toHaveText('1');
  const payload = JSON.parse(await page.getByTestId('submitted-payload').innerText());
  expect(payload.fields.expectedCaptchaGeneration).toBe('2');
  expect(payload.fields.expectedCaptchaConfigurationMethod).toBeUndefined();
});

test('a different configured issuance cannot reconcile a lost retry response', async ({ page }) => {
  await page.goto(url.replace('--failed', '--response-loss'));
  const dialog = await confirm(page, 'Retry security check');
  await dialog.getByRole('button', { name: 'Confirm Retry security check' }).click();
  await expect(page.getByRole('status')).toContainText('Response unavailable');
  await event(page, 'unrelated-configuration');
  await expect(page.getByRole('status')).not.toContainText('Request queued.');
  await event(page, 'matching-retry');
  await expect(page.getByRole('status')).toContainText('Request queued.');
});

for (const status of ['passed', 'delivered'])
  test(`a ${status} refresh removes the retry trigger while preserving an open stale review`, async ({
    page,
  }) => {
    await page.goto(url);
    const dialog = await confirm(page, 'Retry security check');
    await event(page, status);
    await expect(
      page.getByRole('button', { name: 'Retry security check', exact: true })
    ).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Confirm Retry security check' })
    ).toBeDisabled();
    await expect(dialog.getByRole('textbox')).toHaveValue('Reviewed directly with this member');
  });
