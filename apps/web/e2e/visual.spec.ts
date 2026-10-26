import { expect, test, type Locator, type Page } from '@playwright/test';

type VisualScheme = 'light' | 'dark';

const visualSchemes: readonly VisualScheme[] = ['light', 'dark'];
const nextDevOverlayStyle = `
nextjs-portal,
[data-nextjs-dev-overlay],
[data-nextjs-dialog-overlay],
[data-nextjs-toast],
[data-nextjs-toast-wrapper] {
  display: none !important;
}
`;

function platformSnapshotName(name: string, scheme: VisualScheme): string {
  return `${name}-${process.platform === 'win32' ? 'win32' : 'linux'}-${scheme}.png`;
}

async function expectVisualSchemes(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: nextDevOverlayStyle });
  for (const scheme of visualSchemes) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .soft(page)
      .toHaveScreenshot(platformSnapshotName(name, scheme), { fullPage: true });
  }
}

async function expectInboxLink(page: Page, expectedHref: string): Promise<void> {
  await expect(page.getByRole('link', { name: 'Inbox' }).first()).toHaveAttribute(
    'href',
    expectedHref
  );
}

async function expectOperationsLink(page: Page, expectedHref: string): Promise<void> {
  await expect(page.getByRole('link', { name: 'Operations' }).first()).toHaveAttribute(
    'href',
    expectedHref
  );
}

async function expectElementVisualSchemes(
  page: Page,
  locator: Locator,
  name: string
): Promise<void> {
  await page.addStyleTag({ content: nextDevOverlayStyle });
  for (const scheme of visualSchemes) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(locator).toHaveScreenshot(platformSnapshotName(name, scheme));
  }
}

test('landing page visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /review scams/i })).toBeVisible();
  await expectVisualSchemes(page, 'landing-page');
});

test('admin guild list visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /choose a server/i })).toBeVisible();
  const serverRow = page.locator('.server-row').first();
  await expect(page.locator('.server-row')).toHaveCount(2);
  const serverRowStatus = serverRow.locator('.server-row-status');
  await expect(serverRow).toBeVisible();
  await expect(serverRowStatus).toBeVisible();
  await expectInboxLink(page, '/admin/guild/guild-1/inbox');
  await expectOperationsLink(page, '/admin/guild/guild-1/operations');
  await expect
    .poll(async () => {
      const [rowBox, statusBox] = await Promise.all([
        serverRow.boundingBox(),
        serverRowStatus.boundingBox(),
      ]);
      return Boolean(rowBox && statusBox && statusBox.x > rowBox.x + rowBox.width * 0.65);
    })
    .toBe(true);
  await expectVisualSchemes(page, 'admin-guild-list');
});

test('admin guild list inbox entry visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin');
  const fixtureServerRow = page
    .locator('.server-row')
    .filter({ has: page.getByRole('heading', { name: 'Fixture Guild' }) });
  await expect(fixtureServerRow.getByRole('link', { name: 'Inbox' })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/inbox'
  );
  await expectElementVisualSchemes(page, fixtureServerRow, 'report-entry-admin-server-row');
});

test('report portal visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: /report a server user/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fixture Guild' })).toBeVisible();
  await expectVisualSchemes(page, 'report-portal');
});

test('guild setup visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/setup');
  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /install drasil/i })).toBeVisible();
  await expectInboxLink(page, '/admin/guild/guild-1/inbox');
  await expectOperationsLink(page, '/admin/guild/guild-1/operations');
  await expectVisualSchemes(page, 'guild-setup');
});

test('operations visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/operations');
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();
  await expectInboxLink(page, '/admin/guild/guild-1/inbox');
  await expect(page.getByText('#moderation-queue')).toBeVisible();
  await expectVisualSchemes(page, 'operations');
});

test('case history visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/history');
  await expect(page.getByRole('heading', { name: /fixture guild case history/i })).toBeVisible();
  await expectInboxLink(page, '/admin/guild/guild-1/inbox');
  await expectVisualSchemes(page, 'case-history');
});

test('member profile visual baseline @visual', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/guild/guild-1/members/user-300');
  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expectVisualSchemes(page, 'member-profile');
});
