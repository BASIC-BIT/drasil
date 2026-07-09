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

test('case history mixed story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-history--mixed-history');
  await expect(page.getByRole('heading', { name: /fixture guild case history/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-history-mixed');
});

test('case history empty story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-history--empty-history');
  await expect(page.getByRole('heading', { name: /no resolved cases/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-history-empty');
});

test('report queue mixed story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'submitted-reports-report-queue--mixed-reports');
  await expect(page.getByRole('heading', { name: /fixture guild report queue/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-report-queue-mixed');
});

test('report queue empty story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'submitted-reports-report-queue--empty-reports');
  await expect(page.getByRole('heading', { name: /no submitted reports/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-report-queue-empty');
});

test('report detail submitted story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'submitted-reports-report-detail--submitted-report');
  await expect(page.getByRole('heading', { name: /report for user user-300/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-report-detail-submitted');
});

test('report detail linked case story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'submitted-reports-report-detail--linked-case-report');
  await expect(page.getByRole('heading', { name: /report for user user-400/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-report-detail-linked');
});

test('moderation inbox mixed story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-moderation-inbox--mixed-inbox');
  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();
  await expectVisualSchemes(page, 'storybook-moderation-inbox-mixed');
});

test('moderation inbox empty story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-moderation-inbox--empty-inbox');
  await expect(page.getByRole('heading', { name: /no active inbox items/i })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-moderation-inbox-empty');
});

test('case detail stale story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--stale-restricted-case');
  await expect(page.getByRole('heading', { name: 'Prize Patrol' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-stale');
});

test('case detail left user story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--left-user-case');
  await expect(page.getByRole('heading', { name: 'Gone User' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-left');
});

test('case detail banned user story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--banned-user-case');
  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-banned');
});

test('case detail resolved reopen story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-case-detail--resolved-reopen-case');
  await expect(page.getByRole('heading', { name: 'Resolved Friend' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen Case' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-case-detail-resolved-reopen');
});

test('member profile story visual baseline @storybook-visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await gotoStory(page, 'active-triage-member-profile--banned-member-history');
  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  await expectVisualSchemes(page, 'storybook-member-profile-banned');
});
