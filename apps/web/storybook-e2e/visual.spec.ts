import { expect, test, type Page } from '@playwright/test';

type VisualScheme = 'light' | 'dark';

const visualSchemes: readonly VisualScheme[] = ['light', 'dark'];

function platformSnapshotName(name: string, scheme: VisualScheme): string {
  return `${name}-${process.platform === 'win32' ? 'win32' : 'linux'}-${scheme}.png`;
}

async function gotoStory(page: Page, storyId: string): Promise<void> {
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
}

async function expectVisualSchemes(page: Page, name: string): Promise<void> {
  for (const scheme of visualSchemes) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .soft(page)
      .toHaveScreenshot(platformSnapshotName(name, scheme), { fullPage: true });
  }
}

test('case history mixed story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-history--mixed-history');
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-history-mixed');
});

test('case history empty story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-history--empty-history');
  await expect(page.getByRole('heading', { name: /no resolved cases/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-history-empty');
});

test('member profile story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-member-profile--banned-member-history');
  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-member-profile-banned');
});

test('Turnstile script failure offers retry and moderator assistance @storybook-visual', async ({
  page,
}) => {
  let scriptLoads = 0;
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    scriptLoads++;
    return route.abort();
  });
  await gotoStory(page, 'security-checks-turnstile--script-failure');
  await expect(page.getByText(/ask a moderator/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await expect(page.getByText('Discord image CAPTCHA')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => scriptLoads).toBeGreaterThan(1);
  await expect(page.getByText(/ask a moderator/)).toBeVisible();
  await expectVisualSchemes(page, 'storybook-turnstile-script-failure');
});
