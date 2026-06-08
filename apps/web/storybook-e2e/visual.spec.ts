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
    await expect(page).toHaveScreenshot(platformSnapshotName(name, scheme), { fullPage: true });
  }
}

test('case queue mixed story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-queue--mixed-queue');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-queue-mixed');
});

test('case queue empty story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-queue--empty-queue');
  await expect(page.getByRole('heading', { name: /no pending cases/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-queue-empty');
});

test('case detail stale story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--stale-restricted-case');
  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-stale');
});

test('case detail left user story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--left-user-case');
  await expect(page.getByRole('heading', { name: 'User user-200' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-left');
});
