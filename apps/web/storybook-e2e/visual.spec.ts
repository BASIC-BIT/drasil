import { expect, test, type Page } from '@playwright/test';

function platformSnapshotName(name: string): string {
  return `${name}-${process.platform === 'win32' ? 'win32' : 'linux'}.png`;
}

async function gotoStory(page: Page, storyId: string): Promise<void> {
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
}

test('case queue mixed story visual baseline @storybook-visual', async ({ page }) => {
  await gotoStory(page, 'active-triage-case-queue--mixed-queue');
  await expect(page.getByRole('heading', { name: /fixture guild case queue/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('storybook-case-queue-mixed'), {
    fullPage: true,
  });
});

test('case queue empty story visual baseline @storybook-visual', async ({ page }) => {
  await gotoStory(page, 'active-triage-case-queue--empty-queue');
  await expect(page.getByRole('heading', { name: /no pending cases/i })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('storybook-case-queue-empty'), {
    fullPage: true,
  });
});

test('case detail stale story visual baseline @storybook-visual', async ({ page }) => {
  await gotoStory(page, 'active-triage-case-detail--stale-restricted-case');
  await expect(page.getByRole('heading', { name: 'User user-100' })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('storybook-case-detail-stale'), {
    fullPage: true,
  });
});

test('case detail left user story visual baseline @storybook-visual', async ({ page }) => {
  await gotoStory(page, 'active-triage-case-detail--left-user-case');
  await expect(page.getByRole('heading', { name: 'User user-200' })).toBeVisible();
  await expect(page).toHaveScreenshot(platformSnapshotName('storybook-case-detail-left'), {
    fullPage: true,
  });
});
