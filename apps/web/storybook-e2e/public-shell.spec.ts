import { expect, test } from '@playwright/test';
import { inspectEntryPresentation } from '../e2e/entrypointPresentation';
import axe from 'axe-core';

test('public shell stories keep one landmark, keyboard form focus and shared brand', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
  for (const story of [
    'server-picker',
    'public-report',
    'captcha-unavailable',
    'captcha-pending',
    'read-failure',
  ]) {
    await page.goto(`/iframe.html?id=moderation-workspace-public-shell--${story}&viewMode=story`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (story === 'captcha-pending') await expect(page.getByText(/ask a moderator/)).toBeVisible();
    await inspectEntryPresentation(page, `storybook-${story}`);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
          })
        ).violations
    );
    expect(violations).toEqual([]);
    if (story === 'public-report') {
      await page.getByLabel('Discord user ID').focus();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('Reason', { exact: true })).toBeFocused();
    }
  }
});
