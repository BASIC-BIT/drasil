import { expect, test } from '@playwright/test';

test('landing page explains the setup dashboard', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Drasil Setup/);
  await expect(page.getByRole('heading', { name: /review scams/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /open setup dashboard/i })).toHaveAttribute(
    'href',
    '/api/auth/discord?returnTo=/admin'
  );
});

test('Discord OAuth start builds an authorize redirect', async ({ request }) => {
  const response = await request.get('/api/auth/discord?returnTo=/admin', { maxRedirects: 0 });
  const location = response.headers().location;
  const setCookie = response.headers()['set-cookie'];

  expect(response.status()).toBe(307);
  expect(location).toBeTruthy();
  expect(setCookie).toContain('drasil_discord_oauth_state=');

  const authorizeUrl = new URL(location ?? '');
  const redirectUri = new URL(authorizeUrl.searchParams.get('redirect_uri') ?? '');

  expect(authorizeUrl.origin).toBe('https://discord.com');
  expect(authorizeUrl.pathname).toBe('/oauth2/authorize');
  expect(authorizeUrl.searchParams.get('client_id')).toBe('playwright-discord-client');
  expect(authorizeUrl.searchParams.get('scope')).toBe('identify guilds');
  expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
  expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
  expect(redirectUri.pathname).toBe('/api/auth/discord/callback');
});

test('report portal queues a direct user report for a shared configured guild', async ({
  page,
}) => {
  await page.goto('/report');

  await expect(page.getByRole('heading', { name: /report a server user/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fixture Guild' })).toBeVisible();

  await page.getByRole('link', { name: 'Report User' }).click();
  await expect(page.getByRole('heading', { name: 'Fixture Guild' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Open Report Thread' })).toBeVisible();
  await page.getByLabel('Close this report intake').check();
  await page.getByRole('button', { name: 'Queue close report' }).click();
  await expect(page.getByText('Report intake close queued')).toBeVisible();

  await page.getByRole('button', { name: 'Start guided report' }).click();
  await expect(page.getByText('Guided report queued')).toBeVisible();

  await page.getByLabel('Discord user ID').fill('123456789012345678');
  await page.getByLabel(/report reason/i).fill('Suspicious direct message and impersonation.');
  await page.getByLabel('Submit this report for moderator review').check();
  await page.getByRole('button', { name: 'Submit report' }).click();

  await expect(page.getByText('Report queued for 123456789012345678')).toBeVisible();
});

test('theme toggle persists a selected mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  await page.getByRole('button', { name: /toggle light and dark mode/i }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark');

  await page.reload();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark');

  await page.getByRole('button', { name: /toggle light and dark mode/i }).click();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('light');
});

test('guild setup exposes moderation, report, role gate, and review policy controls', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/setup');

  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
  await expect(page.getByLabel('Message burst threshold')).toHaveValue('5');
  await expect(page.getByLabel('Message burst seconds')).toHaveValue('10');
  await expect(page.getByLabel('Heuristic watch terms')).toHaveValue(/example watch term/);
  await expect(page.getByLabel('Observed alert threshold')).toHaveValue('70');
  await expect(page.getByLabel('Observed alert window minutes')).toHaveValue('60');
  await expect(page.getByLabel('Live queue channel')).toHaveValue('queue-channel-1');
  await expect(page.getByRole('button', { name: 'Queue core setup repair' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Queue report button repair' })).toBeVisible();
  await expect(page.getByLabel('Auto-kick threshold')).toHaveValue('95');
  await expect(page.getByLabel('Exempt moderators from automatic detection')).toBeChecked();
  await expect(page.getByLabel('Enable moderator ban actions')).toBeChecked();
  await expect(page.getByLabel('Report analysis authority')).toBeVisible();
  await expect(page.getByLabel('Confirmed report intake')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Role Gate' })).toBeVisible();
  await expect(page.getByLabel('Honeypot response')).toHaveValue('restrict');
  await expect(page.getByRole('heading', { name: 'Role Quarantine' })).toBeVisible();
  await expect(page.getByLabel('Quarantine mode')).toHaveValue('off');
  await expect(page.getByRole('heading', { name: 'Manual Intake' })).toBeVisible();
  await expect(page.getByLabel('Enable manual intake')).toBeChecked();
  await expect(page.getByLabel('Manual intake trigger role')).toHaveValue('manual-intake-role');
  await expect(page.getByLabel('Grace period seconds')).toHaveValue('30');
  await expect(page.getByRole('heading', { name: 'Case Role Lockdown' })).toBeVisible();
  await expect(page.getByLabel('Allowed lockdown channels')).toHaveValues(['rules-channel-1']);
  await expect(page.getByLabel('Allowed lockdown categories')).toHaveValues(['public-category-1']);
  await expect(
    page.getByRole('heading', { name: 'Verification Prompt And Context' })
  ).toBeVisible();
  await expect(page.getByLabel('Expected topics')).toHaveValue(/reports/);
  await expect(page.getByRole('heading', { name: 'Verification Reply Analysis' })).toBeVisible();
  await page.getByRole('button', { name: 'Queue core setup repair' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
  await page.getByRole('button', { name: 'Queue report button repair' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild/i })).toBeVisible();
});

test('operations queues moderation queue maintenance through the shared action path', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/operations');

  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();
  await expect(page.getByText('#moderation-queue')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deployment Runtime' })).toBeVisible();
  await expect(page.getByText('.github/workflows/deploy-prod.yml')).toBeVisible();
  await expect(page.getByText('docs/deploy/aws.md')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Integrity Snapshot' })).toBeVisible();
  await expect(page.getByText('Notification Pointer Missing')).toBeVisible();
  await expect(page.getByText('Queue Case Mirror Not Pending')).toBeVisible();
  const recentRequests = page.getByLabel('Recent web requests');
  await expect(recentRequests.getByText('Sync Queue')).toBeVisible();
  await expect(recentRequests.getByText('Refresh Notification')).toBeVisible();
  await expect(recentRequests.getByText('Dry run found 4 closable')).toBeVisible();
  await expect(recentRequests.getByText('Audit found 0 errors')).toBeVisible();
  await expect(recentRequests.getByText('Dry run Manual Intake')).toBeVisible();

  await page.getByRole('button', { name: 'Sync Queue' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  const clearQueueAction = page.locator('details.destructive-action').filter({
    hasText: 'Clear Queue',
  });
  await clearQueueAction.getByText('Clear Queue', { exact: true }).click();
  await clearQueueAction.getByLabel('Confirm Clear Queue').check();
  await clearQueueAction.getByRole('button', { name: 'Queue Clear Queue' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  await page.getByRole('button', { name: 'Dry Run Thread Sweep' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  const closeThreadsAction = page.locator('details.destructive-action').filter({
    hasText: 'Close Threads',
  });
  await closeThreadsAction.getByText('Close Threads', { exact: true }).click();
  await closeThreadsAction.getByLabel('Confirm Close Resolved Threads').check();
  await closeThreadsAction.getByRole('button', { name: 'Queue Close Threads' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  await page.getByRole('button', { name: 'Audit Lockdown' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  const applyLockdownAction = page.locator('details.destructive-action').filter({
    hasText: 'Apply Lockdown',
  });
  await applyLockdownAction.getByText('Apply Lockdown', { exact: true }).click();
  await applyLockdownAction.getByLabel('Unsync Allowed Channels').check();
  await applyLockdownAction.getByLabel('Confirm Apply Lockdown').check();
  await applyLockdownAction.getByRole('button', { name: 'Queue Apply Lockdown' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  await page.getByRole('button', { name: 'Dry Run Role Intake' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();

  const executeRoleIntakeAction = page.locator('details.destructive-action').filter({
    hasText: 'Execute Role Intake',
  });
  await executeRoleIntakeAction.getByText('Execute Role Intake', { exact: true }).click();
  await executeRoleIntakeAction.getByLabel('Confirm Execute Role Intake').check();
  await executeRoleIntakeAction.getByRole('button', { name: 'Queue Execute Role Intake' }).click();
  await expect(page.getByRole('heading', { name: /fixture guild operations/i })).toBeVisible();
});

test('moderation inbox shows fixture triage items', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');

  const results = page.getByLabel('Moderation inbox results');
  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();
  await expect(results.getByText('Pending moderation case').first()).toBeVisible();
  await expect(results.getByText('Submitted report').first()).toBeVisible();
  await expect(results.getByText('Observed alert pending review').first()).toBeVisible();
  await expect(results.getByText('Support reply needs review').first()).toBeVisible();
});

test('moderation inbox filters and previews triage items', async ({ page }) => {
  await page.goto('/admin/guild/guild-1/inbox');

  const results = page.getByLabel('Moderation inbox results');
  const detail = page.getByLabel('Selected inbox item');

  await expect(detail.getByRole('heading', { name: /pending moderation case/i })).toBeVisible();
  await expect(detail.getByText('Refresh Notification')).toBeVisible();

  await page.getByRole('button', { name: 'Stale Cases' }).click();
  await expect(page.getByRole('button', { name: 'Stale Cases' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(results.getByText('Pending moderation case')).toBeVisible();
  await expect(results.getByText('Submitted report')).toHaveCount(0);

  await page.getByRole('button', { exact: true, name: 'Replies' }).click();
  await expect(page.getByRole('button', { exact: true, name: 'Replies' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(results.getByText('Support reply needs review')).toBeVisible();
  await expect(results.getByText('Pending moderation case')).toHaveCount(0);
  await page.getByText('Export Visible').click();
  await expect(page.getByLabel('Visible inbox export')).toHaveValue(/support_attention/);
  await page.getByRole('button', { name: 'Acknowledge Visible Replies' }).click();
  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();

  await page.getByRole('button', { name: 'All' }).click();
  await expect(results.getByText('Pending moderation case')).toBeVisible();

  await page.getByLabel('Type').selectOption('submitted_report');
  await expect(results.getByText('Submitted report')).toBeVisible();
  await expect(results.getByText('Pending moderation case')).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: /submitted report/i })).toBeVisible();

  await page.getByLabel('Search').fill('no matching item');
  await expect(results.getByRole('heading', { name: /no matching inbox items/i })).toBeVisible();
});

test('moderation inbox acknowledges attention items through the shared action path', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/inbox');

  const detail = page.getByLabel('Selected inbox item');
  await page.getByRole('button', { name: /support reply needs review/i }).click();
  await expect(detail.getByRole('heading', { name: /support reply needs review/i })).toBeVisible();

  await detail.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();
});

test('moderation inbox queues observed alert decisions through the shared action path', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/inbox');

  const detail = page.getByLabel('Selected inbox item');
  await page.getByRole('button', { name: /observed alert pending review/i }).click();
  await expect(
    detail.getByRole('heading', { name: /observed alert pending review/i })
  ).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Open Case' })).toBeVisible();
  await expect(detail.getByRole('link', { name: 'View History' })).toHaveAttribute(
    'href',
    '/admin/guild/guild-1/members/user-500'
  );
  await expect(detail.getByRole('button', { name: 'Dismiss No Action' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'False Positive' })).toBeVisible();
  const banAction = detail.locator('details.destructive-action').filter({ hasText: 'Ban User' });
  await banAction.getByText('Ban User', { exact: true }).click();
  await expect(banAction.getByLabel('Confirm Ban User')).toBeVisible();

  await banAction.getByLabel('Confirm Ban User').check();
  await banAction.getByRole('button', { name: 'Queue Ban User' }).click();
  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();
});

test('member history queues observed alert undo through the shared action path', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/members/user-500');

  await expect(page.getByRole('heading', { name: 'Observed User' })).toBeVisible();
  await expect(page.getByText('Accounting: Ignored')).toBeVisible();
  await expect(page.getByText('Observed action: False Positive')).toBeVisible();

  const openCaseAction = page.locator('details.inline-action').filter({
    has: page.locator('summary', { hasText: /^Open Case$/ }),
  });
  await openCaseAction.getByText('Open Case', { exact: true }).click();
  await openCaseAction.getByLabel('Open Case reason').fill('Manual profile review.');
  await openCaseAction.getByLabel('Confirm Open Case').check();
  await openCaseAction.getByRole('button', { name: 'Queue Open Case' }).click();
  await expect(page.getByRole('heading', { name: 'Observed User' })).toBeVisible();

  const sourceOpenCaseAction = page.locator('details.inline-action').filter({
    has: page.locator('summary', { hasText: /^Open Case from Source$/ }),
  });
  await sourceOpenCaseAction.getByText('Open Case from Source', { exact: true }).click();
  await sourceOpenCaseAction
    .getByLabel('Open Case from Source reason for det-observed-1')
    .fill('Escalated from source message.');
  await sourceOpenCaseAction.getByLabel('Confirm Open Case from Source').check();
  await sourceOpenCaseAction.getByRole('button', { name: 'Queue Open Case from Source' }).click();
  await expect(page.getByRole('heading', { name: 'Observed User' })).toBeVisible();

  const flagAction = page.locator('details.inline-action').filter({ hasText: 'Flag User' });
  await flagAction.getByText('Flag User', { exact: true }).click();
  await flagAction.getByLabel('Flag User reason').fill('Escalated from web history.');
  await flagAction.getByLabel('Confirm Flag User').check();
  await flagAction.getByRole('button', { name: 'Queue Flag User' }).click();
  await expect(page.getByRole('heading', { name: 'Observed User' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo Observed Action' }).click();
  await expect(page.getByRole('heading', { name: 'Observed User' })).toBeVisible();
});

test('member history queues detection accounting actions through the shared action path', async ({
  page,
}) => {
  await page.goto('/admin/guild/guild-1/members/user-300');

  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
  const ignoreAction = page
    .locator('details.inline-action')
    .filter({ hasText: 'Ignore Detection' });
  await ignoreAction.getByText('Ignore Detection', { exact: true }).click();
  await ignoreAction.getByLabel('Ignore Detection reason').fill('Reviewed in web history.');
  await ignoreAction.getByLabel('Confirm Ignore Detection').check();
  await ignoreAction.getByRole('button', { name: 'Queue Ignore Detection' }).click();

  await expect(page.getByRole('heading', { name: 'Banned User' })).toBeVisible();
});

test('moderation inbox fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/admin/guild/guild-1/inbox');

  await expect(
    page.getByRole('heading', { name: /fixture guild moderation inbox/i })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);
});
