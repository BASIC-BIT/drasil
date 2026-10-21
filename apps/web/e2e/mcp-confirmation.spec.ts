import { expect, test } from '@playwright/test';
import { mcpBrowserFixtures, guildA, actorId } from './mcpFixtures';
import {
  createIntentService,
  createDelegatedAccess,
  createCaseIntentResolver,
} from '@drasil/application';
import { createDelegationStore, createCaseResolutionResources } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../lib/mcp/adapters/database';
import { Pool } from 'pg';
const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_TEST_PORT || '3001'}`;
const fixtures = mcpBrowserFixtures(origin);
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(process.env.DRASIL_MCP_E2E !== 'true', 'Requires owned database and Discord fixture');
test.beforeAll(() => fixtures.start());
test.afterAll(async () => {
  await fixtures.stop();
  await pool.end();
});
test('GET shows the full saved summary and only explicit POST approves', async ({
  context,
  page,
}) => {
  await fixtures.reset(context);
  await pool.query(
    "insert into users(discord_id) values ('999999999999999999') on conflict do nothing"
  );
  const store = createDelegationStore(createWebDelegationDatabase(pool));
  const grant = await store.createConnection({
    userId: actorId,
    clientId: 'fixture',
    selection: { mode: 'selected', guildIds: [guildA] },
    scopes: ['drasil:moderate'],
  });
  const principal = { ...grant, grantVersion: grant.version };
  const summary = '<script>alert(1)</script> @everyone';
  const access = createDelegatedAccess({
    store,
    authority: {
      loadFresh: async () => ({
        guildId: guildA,
        userId: actorId,
        owner: true,
        present: true,
        permissions: '8',
        roleIds: [],
      }),
    },
    staffRoles: { loadRoleIds: async () => [] },
    guilds: {
      isActive: async () => true,
      listActive: async () => ({ guildIds: [guildA], nextCursor: null }),
    },
  });
  const service = createIntentService({
    store,
    access,
    resolver: createCaseIntentResolver({
      access,
      resources: () =>
        createCaseResolutionResources(createWebDelegationDatabase(pool), guildA, async () => null),
    }),
  });
  const invocation = {
    workflowId: 'ban_user' as const,
    guildId: guildA,
    idempotencyKey: 'browser',
    input: { targetUserId: '999999999999999999', reason: summary },
  };
  const intent = await service.prepareIntent(principal, invocation);
  await page.goto(`/mcp/confirm/${intent.confirmationId}`);
  await expect(page.getByRole('heading', { name: 'Confirm action' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved action summary' })).toHaveText(
    intent.summary
  );
  expect((await store.loadIntent(principal, intent.confirmationId))?.state).toBe('pending');
  await page.screenshot({
    path: '../../.superpowers/sdd/drasil-mcp/task-14-confirmation.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Confirmation cancelled', { exact: true })).toBeVisible();
  expect((await store.loadIntent(principal, intent.confirmationId))?.state).toBe('cancelled');
  const accepted = await service.prepareIntent(principal, {
    ...invocation,
    idempotencyKey: 'browser-approved',
  });
  await page.goto(`/mcp/confirm/${accepted.confirmationId}`);
  expect((await pool.query('select * from mcp_executions')).rows).toHaveLength(0);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Action queued', { exact: true })).toBeVisible();
  const execution = (await pool.query('select * from mcp_executions')).rows;
  expect(execution).toHaveLength(1);
  expect(execution[0]).toMatchObject({
    confirmation_method: 'website',
    connection_id: principal.connectionId,
    client_id: principal.clientId,
    grant_version: principal.grantVersion,
  });
  await page.reload();
  expect((await pool.query('select * from mcp_executions')).rows).toHaveLength(1);
});

test('sign-in returns to the same confirmation without approving', async ({ context, page }) => {
  await context.clearCookies();
  const id = 'a'.repeat(43);
  const before = (await pool.query('select count(*)::int as count from mcp_executions')).rows[0]
    .count;
  await page.route('**/api/mcp-auth/sign-in/social', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `${origin}/mcp/confirm/${id}` }),
    })
  );
  await page.goto(`/mcp/confirm/${id}`);
  const request = page.waitForRequest('**/api/mcp-auth/sign-in/social');
  await page.getByRole('button', { name: 'Sign in with Discord' }).click();
  expect((await request).postDataJSON()).toEqual({
    provider: 'discord',
    callbackURL: `/mcp/confirm/${id}`,
  });
  expect(
    (await pool.query('select count(*)::int as count from mcp_executions')).rows[0].count
  ).toBe(before);
});
