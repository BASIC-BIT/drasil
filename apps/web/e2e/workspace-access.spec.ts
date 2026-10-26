import { expect, test } from '@playwright/test';
import { workspaceIds as id, workspaceFixtures } from './workspaceFixtures';
const fixtures = workspaceFixtures();
const inbox = `/admin/guild/${id.guild}/inbox`;
const detailUrl = `/api/admin/guild/${id.guild}/inbox/case:${id.case}`;
test.beforeAll(() => fixtures.start());
test.afterAll(() => fixtures.stop());
test.beforeEach(async ({ context, baseURL }) => fixtures.reset(context, baseURL!));

test('selected pages and detail work without OAuth guild enumeration', async ({
  page,
}, testInfo) => {
  fixtures.setProviderFailure('directory', 503);
  fixtures.setSelectedAuthority(false, '32');
  await page.goto(`${inbox}?selected=case:${id.case}`);
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('selected-inbox.png'), fullPage: true });
  for (const path of [`cases/${id.case}`, `reports/${id.report}`]) {
    await page.goto(`/admin/guild/${id.guild}/${path}`);
    await expect(page.getByRole('main')).toContainText('Case member');
  }
  const response = await page.request.get(detailUrl);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(fixtures.calls.filter((call) => call.includes('/users/@me/guilds'))).toEqual([]);
});

test('permission loss removes selected evidence and confirmation and retry restores it', async ({
  page,
}, testInfo) => {
  await page.goto(`${inbox}?selected=case:${id.case}`);
  await page.getByRole('button', { name: 'Verify member', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  fixtures.setSelectedAuthority(false, '0');
  // The control remains outside the confirmation; a refresh must discard the protected subtree.
  await page
    .getByRole('button', { name: 'Refresh item', exact: true, includeHidden: true })
    .dispatchEvent('click');
  await expect(page.getByText('Server access required', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('access-denied.png'), fullPage: true });
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toHaveCount(0);
  expect((await page.request.get(detailUrl)).status()).toBe(403);
  const queued = await fixtures.pool.query(
    'select count(*)::int as count from moderation_action_requests where server_id=$1',
    [id.guild]
  );
  expect(queued.rows[0].count).toBe(0);
  fixtures.setSelectedAuthority(false, '32');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toBeVisible();
});

for (const [source, status, expectedStatus, code] of [
  ['identity', 401, 401, 'authentication_required'],
  ['identity', 503, 503, 'unavailable'],
  ['member', 404, 403, 'access_denied'],
  ['member', 503, 503, 'unavailable'],
  ['guild', 404, 503, 'unavailable'],
  ['guild', 403, 503, 'unavailable'],
  ['roles', 404, 503, 'unavailable'],
  ['roles', 503, 503, 'unavailable'],
] as const)
  test(`${source} ${status} fails closed and recovers`, async ({ page }, testInfo) => {
    fixtures.setProviderFailure(source, status);
    const response = await page.request.get(detailUrl);
    expect(response.status()).toBe(expectedStatus);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers()['cache-control']).toBe('private, no-store');
    if (source !== 'identity' || status !== 401) {
      await page.goto(inbox);
      await expect(
        page.getByText(
          code === 'access_denied' ? 'Server access required' : 'Unable to verify server access',
          { exact: true }
        )
      ).toBeVisible();
      if (source === 'roles' && status === 404)
        await page.screenshot({
          path: testInfo.outputPath('verification-unavailable.png'),
          fullPage: true,
        });
      fixtures.setProviderFailure(source);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
    } else {
      fixtures.setProviderFailure(source);
    }
    expect((await page.request.get(detailUrl)).status()).toBe(200);
  });

for (const [label, owner, permissions, allowed] of [
  ['owner', true, '0', true],
  ['administrator', false, '8', true],
  ['manage server', false, '32', true],
  ['staff role only', false, '0', false],
  ['moderate members only', false, '1099511627776', false],
] as const)
  test(`fresh ${label} website admission`, async ({ page }) => {
    await fixtures.pool.query(
      'update servers set settings=settings || $2::jsonb where guild_id=$1',
      [id.guild, JSON.stringify({ case_responder_role_ids: ['910000000000000020'] })]
    );
    fixtures.setSelectedAuthority(owner, permissions, ['910000000000000020']);
    expect((await page.request.get(detailUrl)).status()).toBe(allowed ? 200 : 403);
    await page.goto(inbox);
    if (allowed) await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
    else await expect(page.getByText('Server access required', { exact: true })).toBeVisible();
  });

test('wrong OAuth identity is denied and actual missing records remain404', async ({ page }) => {
  fixtures.setIdentity(id.bot);
  expect((await page.request.get(detailUrl)).status()).toBe(403);
  fixtures.setIdentity(id.actor);
  const response = await page.request.get(
    `/api/admin/guild/${id.guild}/inbox/case:91000000-0000-4000-8000-000000000099`
  );
  expect(response.status()).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'not_found' });
});

test('anonymous detail requires authentication', async ({ context, page }) => {
  await context.clearCookies();
  const response = await page.request.get(detailUrl);
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: 'authentication_required' });
  expect(fixtures.calls).toEqual([]);
});

test('revoked OAuth clears selected evidence and offers sign-in', async ({ page }) => {
  await page.goto(`${inbox}?selected=case:${id.case}`);
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toBeVisible();
  fixtures.setProviderFailure('identity', 401);
  await page.getByRole('button', { name: 'Refresh item', exact: true }).click();
  await expect(page.getByText('Sign in to continue', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Sign in with Discord', exact: true })
  ).toHaveAttribute('href', /returnTo=/);
  await expect(page.getByRole('button', { name: 'Verify member', exact: true })).toHaveCount(0);
  const response = await page.request.get(inbox, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain('/api/auth/discord?returnTo=');
});

test('temporary refresh failure retains historical receipts and recovers', async ({ page }) => {
  const result = await fixtures.pool.query(
    "insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,idempotency_key,status,completed_at,result) values($1,$2,'web','refresh_case_notification',$3,$4,'read-recovery-receipt','completed','2026-10-24T12:00:00Z',$5) returning id",
    [id.guild, id.actor, id.member, id.case, { action_type: 'refresh_case_notification' }]
  );
  await page.goto(`${inbox}?selected=case:${id.case}`);
  await page.getByRole('button', { name: 'Case tools', exact: true }).click();
  const receipt = page
    .getByRole('status')
    .filter({ hasText: 'This request already completed for this case.' });
  await expect(receipt).toContainText(`Request ${result.rows[0].id}`);
  fixtures.setProviderFailure('roles', 503);
  await page.getByRole('button', { name: 'Refresh item', exact: true }).click();
  await expect(page.getByText('Unable to verify server access', { exact: true })).toBeVisible();
  await expect(receipt).toContainText(`Request ${result.rows[0].id}`);
  fixtures.setProviderFailure('roles');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('Unable to verify server access', { exact: true })).toHaveCount(0);
  await expect(receipt).toContainText(`Request ${result.rows[0].id}`);
});

test('authorized foreign and absent records remain missing', async ({ page }) => {
  const foreignCase = '91000000-0000-4000-8000-000000000098';
  await fixtures.pool.query(
    "insert into verification_events(id,server_id,user_id,status) values($1,$2,$3,'pending')",
    [foreignCase, id.foreignGuild, id.member]
  );
  const response = await page.request.get(`/api/admin/guild/${id.guild}/inbox/case:${foreignCase}`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ code: 'not_found' });
  for (const path of [`cases/${foreignCase}`, 'reports/91000000-0000-4000-8000-000000000099']) {
    await page.goto(`/admin/guild/${id.guild}/${path}`);
    await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
    await expect(page.getByText('Server access required', { exact: true })).toHaveCount(0);
  }
});

for (const source of ['identity', 'roles'] as const)
  test(`HTTP200 malformed ${source} JSON is unavailable and retry recovers`, async ({ page }) => {
    fixtures.setMalformedResponse(source, true);
    const response = await page.request.get(detailUrl);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ code: 'unavailable' });
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(response.headers()['retry-after']).toBeUndefined();
    await page.goto(inbox);
    await expect(page.getByText('Unable to verify server access', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Inbox queue' })).toHaveCount(0);
    await expect(page.getByText('Case member', { exact: true })).toHaveCount(0);
    fixtures.setMalformedResponse(source, false);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Inbox queue' })).toBeVisible();
    expect((await page.request.get(detailUrl)).status()).toBe(200);
    expect(fixtures.calls.filter((call) => call.includes('/users/@me/guilds'))).toEqual([]);
  });
