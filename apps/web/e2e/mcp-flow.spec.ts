import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { projectExecution } from '@drasil/application';
import { mcpBrowserFixtures, guildA, guildB, actorId } from './mcpFixtures';
import { mcpWorkerFixtures } from '../../../scripts/mcp-acceptance-worker.js';
import { createWebAuthority } from '../lib/application/adapters/authority';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(process.env.DRASIL_MCP_E2E !== 'true', 'Requires owned database and controlled Discord');
const origin = `http://127.0.0.1:${process.env.PLAYWRIGHT_TEST_PORT || '3001'}`;
const fixtures = mcpBrowserFixtures(origin);
let worker: ReturnType<typeof mcpWorkerFixtures>;
test.beforeAll(async () => {
  await fixtures.start();
  worker = mcpWorkerFixtures(fixtures, createWebAuthority());
});
test.afterAll(async () => {
  try {
    await worker?.stop();
  } finally {
    await fixtures.stop();
  }
});
test.beforeEach(async ({ context }) => fixtures.reset(context));
const action = z
  .object({
    state: z.string(),
    confirmationId: z.string().optional(),
    executionId: z.string().optional(),
    outcome: z.unknown().optional(),
  })
  .passthrough();
async function connect(context: BrowserContext, page: Page, allEligible = false) {
  const client = await fixtures.client(context.request, 'Controlled acceptance client');
  const started = await fixtures.begin(context.request, client.client_id);
  await page.goto(started.url);
  if (allEligible)
    await page
      .getByLabel('All eligible servers, including servers you become eligible for in the future')
      .check();
  else {
    await page.getByLabel(`Fixture North ${guildA}`).check();
    await page.getByLabel(`Fixture South ${guildB}`).check();
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Allow this connection?' })).toBeVisible();
  await context.route('https://client.example/**', (route) =>
    route.fulfill({ body: 'Controlled callback' })
  );
  await page.getByRole('button', { name: 'Allow connection' }).click();
  await expect(page).toHaveURL(/callback\?code=/);
  const code = new URL(page.url()).searchParams.get('code');
  if (!code) throw new Error('Issuer did not issue authorization code');
  const tokens = await fixtures.exchange(context.request, started, code);
  const sdk = new Client(
    { name: 'drasil-controlled-acceptance', version: '1' },
    allEligible
      ? { supportedProtocolVersions: ['2025-11-25'] }
      : { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await sdk.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      authProvider: { token: async () => tokens.access_token },
    })
  );
  expect(sdk.getNegotiatedProtocolVersion()).toBe(allEligible ? '2025-11-25' : '2026-07-28');
  return { sdk, client, tokens };
}
async function call(sdk: Client, name: string, args: Record<string, unknown>) {
  const result = await sdk.callTool({ name, arguments: args });
  return action.parse(result.structuredContent);
}
async function journey(context: BrowserContext, page: Page, allEligible: boolean) {
  const { sdk, client, tokens } = await connect(context, page, allEligible);
  try {
    const grant = await fixtures.connection(client.client_id);
    expect(grant.selection).toEqual(
      allEligible ? { mode: 'all_eligible' } : { mode: 'selected', guildIds: [guildA, guildB] }
    );
    const read = await sdk.callTool({ name: 'drasil_list_guilds', arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read.structuredContent)).toContain(guildA);
    expect(JSON.stringify(read.structuredContent)).toContain(guildB);
    const refresh = await context.request.post('/api/mcp-auth/oauth2/token', {
      headers: { origin },
      form: {
        grant_type: 'refresh_token',
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: `${origin}/api/mcp`,
      },
    });
    expect(refresh.ok()).toBe(true);
    const input = { guildId: guildA, idempotencyKey: 'decline' };
    const declined = await call(sdk, 'drasil_clear_moderation_queue', input);
    expect(declined.state).toBe('confirmation_required');
    expect(
      await call(sdk, 'cancel_action', { confirmationId: declined.confirmationId })
    ).toMatchObject({ state: 'denied', code: 'cancelled' });
    expect(
      (await fixtures.pool.query('select * from moderation_action_requests')).rows
    ).toHaveLength(0);
    await fixtures.pool.query('insert into users(discord_id) values($1) on conflict do nothing', [
      actorId,
    ]);
    async function item(messageId: string) {
      return (
        await fixtures.pool.query(
          "insert into moderation_queue_items(server_id,user_id,item_type,queue_channel_id,queue_message_id) values($1,$2,'pending_screening_member',$3,$4) returning id",
          [guildA, actorId, '555555555555555555', messageId]
        )
      ).rows[0].id;
    }
    const firstItem = await item('666666666666666666');
    const prepared = await call(sdk, 'drasil_clear_moderation_queue', {
      ...input,
      idempotencyKey: 'approved',
    });
    expect(prepared.state).toBe('confirmation_required');
    const queued = await call(sdk, 'confirm_action', { confirmationId: prepared.confirmationId });
    expect(queued.state).toBe('queued');
    expect((await call(sdk, 'get_action_status', { executionId: queued.executionId })).state).toBe(
      'queued'
    );
    expect(await worker.run()).toBe(1);
    const firstReceipt = await call(sdk, 'get_action_status', { executionId: queued.executionId });
    expect(firstReceipt.state).toBe('completed');
    expect(firstReceipt.outcome).toMatchObject({ details: { removed_count: 1 } });
    expect(
      (await fixtures.pool.query('select id from moderation_queue_items where id=$1', [firstItem]))
        .rowCount
    ).toBe(0);
    expect(fixtures.effects).toEqual(['/channels/555555555555555555/messages/666666666666666666']);
    const secondItem = await item('777777777777777777');
    const second = await call(sdk, 'drasil_clear_moderation_queue', {
      ...input,
      idempotencyKey: 'revoke-before-start',
    });
    const secondQueued = await call(sdk, 'confirm_action', {
      confirmationId: second.confirmationId,
    });
    expect(secondQueued.state).toBe('queued');
    await page.goto('/mcp/connections');
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    expect(await worker.run()).toBe(1);
    // Revoked OAuth credentials cannot poll. Inspect the durable worker projection
    // through the store, then separately prove the endpoint rejects the old token.
    const secondExecution = await fixtures.store.loadExecution(
      {
        userId: actorId,
        clientId: client.client_id,
        connectionId: grant.connectionId,
        grantVersion: grant.version,
        scopes: grant.scopes,
      },
      secondQueued.executionId!
    );
    if (!secondExecution) throw new Error('Missing denied execution');
    const secondReceipt = projectExecution(secondExecution);
    expect(secondReceipt.state).toBe('denied');
    const durable = (
      await fixtures.pool.query(
        'select result from moderation_action_requests where id=(select queue_request_id from mcp_executions where id=$1)',
        [secondQueued.executionId]
      )
    ).rows[0].result;
    expect(durable.state).toBe('denied');
    expect(fixtures.effects).toEqual(['/channels/555555555555555555/messages/666666666666666666']);
    expect(
      (await fixtures.pool.query('select id from moderation_queue_items where id=$1', [secondItem]))
        .rowCount
    ).toBe(1);
    const denied = await context.request.post('/api/mcp', {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(denied.status()).toBe(401);
  } finally {
    await sdk.close();
  }
}
test('completes approved work and denies queued work after revocation', async ({ context, page }) =>
  journey(context, page, false));
test('repeats approved and revoked worker paths with all eligible selection', async ({
  context,
  page,
}) => journey(context, page, true));
test('allows role-only staff context without granting administrator operations', async ({
  context,
  page,
}) => {
  await fixtures.setRoleOnly();
  const { sdk, client } = await connect(context, page, true);
  try {
    const read = await sdk.callTool({ name: 'drasil_list_cases', arguments: { guildId: guildA } });
    expect(read.isError).not.toBe(true);
    const reporterId = '888888888888888888';
    await fixtures.pool.query('insert into users(discord_id) values($1) on conflict do nothing', [
      reporterId,
    ]);
    const submitted = (
      await fixtures.pool.query(
        "insert into report_intakes(server_id,reporter_id,status) values($1,$2,'submitted') returning id",
        [guildA, reporterId]
      )
    ).rows[0].id;
    const closed = await call(sdk, 'drasil_close_submitted_report', {
      guildId: guildA,
      reportId: submitted,
      action: 'dismiss_no_action',
      idempotencyKey: 'role-staff-close',
    });
    expect(closed.state).toBe('completed');
    expect(
      (await fixtures.pool.query('select status from report_intakes where id=$1', [submitted]))
        .rows[0].status
    ).toBe('dismissed');
    const intakeRow = (
      await fixtures.pool.query(
        'insert into report_intakes(server_id,reporter_id) values($1,$2) returning *',
        [guildA, reporterId]
      )
    ).rows[0];
    const input = { guildId: guildA, intakeId: intakeRow.id, idempotencyKey: 'role-decline' };
    const prepared = await call(sdk, 'drasil_close_report_intake', input);
    expect(prepared.state).toBe('confirmation_required');
    expect(
      await call(sdk, 'cancel_action', { confirmationId: prepared.confirmationId })
    ).toMatchObject({ state: 'denied', code: 'cancelled' });

    expect(
      (
        await call(sdk, 'drasil_clear_moderation_queue', {
          guildId: guildA,
          idempotencyKey: 'role-only',
        })
      ).state
    ).toBe('denied');
    expect(
      (await fixtures.pool.query('select * from moderation_action_requests')).rows
    ).toHaveLength(0);

    const next = await call(sdk, 'drasil_close_report_intake', {
      ...input,
      idempotencyKey: 'role-revoke',
    });
    const queued = await call(sdk, 'confirm_action', { confirmationId: next.confirmationId });
    expect(queued.state).toBe('queued');
    const grant = await fixtures.connection(client.client_id);
    await page.goto('/mcp/connections');
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    expect(await worker.run()).toBe(1);
    const saved = await fixtures.store.loadExecution(
      { ...grant, grantVersion: grant.version },
      queued.executionId!
    );
    if (!saved) throw new Error('Missing role-only denied execution');
    expect(projectExecution(saved).state).toBe('denied');
    expect(
      (await fixtures.pool.query('select * from report_intakes where id=$1', [intakeRow.id]))
        .rows[0]
    ).toEqual(intakeRow);
    expect(fixtures.effects).toEqual([]);
  } finally {
    await sdk.close();
  }
});
