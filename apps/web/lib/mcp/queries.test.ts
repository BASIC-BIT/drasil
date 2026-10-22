import { describe, it, expect, vi } from 'vitest';
import { createMcpQueries, querySchema, type QueryRepository, type QueryRow } from './queries';
import { toMcpQueryResult, MCP_RESULT_BYTES } from './results';
import { accessFixture, guildId, principal } from './queryTestFixtures';

const secret = 'cursor-secret-for-tests-at-least-32-characters';
const validListQuery = { kind: 'list_cases', guildId };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function harness(rows: QueryRow[] = []) {
  const { access, state, grant } = accessFixture();
  const read = vi.fn<QueryRepository['read']>(async (_binding, query, after) => {
    const start = after ? rows.findIndex((row) => row.key.id === after.id) + 1 : 0;
    return rows.slice(start, start + ('limit' in query ? query.limit : 1) + 1);
  });
  const messages = vi.fn(async () => []);
  const visibility = vi.fn(async () => ({ kind: 'denied', reason: 'permission_denied' }) as const);
  const service = createMcpQueries({
    access,
    repository: { read },
    cursorSecret: secret,
    authorizeDiscordContent: visibility,
    messages,
  });
  return { service, read, state, grant, messages, visibility };
}
describe('authorized queries', () => {
  it('exposes CAPTCHA comparison fields and cleanup detection binding without browser credentials', async () => {
    const h = harness([
      {
        key: { id: id(1), timestamp: null },
        value: {
          id: id(1),
          detectionEventId: id(2),
          captchaChallengeId: id(3),
          captchaGeneration: 4,
          captchaStatus: 'pending',
          captchaExpiresAt: '2026-10-22T00:00:00.000Z',
          link_token_hash: 'private-token',
          captcha_mutation_receipt: { private: 'secret' },
        },
      },
    ]);
    const result = await h.service.execute(principal, { kind: 'get_case', guildId, caseId: id(1) });
    expect(result).toMatchObject({
      kind: 'allowed',
      items: [
        {
          detectionEventId: id(2),
          captchaChallengeId: id(3),
          captchaGeneration: 4,
          captchaStatus: 'pending',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/private-token|captcha_mutation_receipt|secret/);
  });
  it('strictly validates kinds, identity, workflow context and page limits', () => {
    const queryWithoutLimit = querySchema.parse(validListQuery);
    expect('limit' in queryWithoutLimit && queryWithoutLimit.limit).toBe(25);
    expect(querySchema.safeParse({ ...validListQuery, limit: 101 }).success).toBe(false);
    for (const extra of [
      { actorId: 'fake' },
      { url: 'https://example.com' },
      { limit: 0 },
      { guildId: '../guild' },
    ])
      expect(querySchema.safeParse({ ...validListQuery, ...extra }).success).toBe(false);
    expect(
      querySchema.safeParse({
        kind: 'get_member_context',
        guildId,
        userId: principal.userId,
        purpose: 'report',
      }).success
    ).toBe(false);
  });
  it('authorizes before repository reads and refreshes every page', async () => {
    const h = harness();
    h.state.present = false;
    expect(await h.service.execute(principal, validListQuery)).toMatchObject({ kind: 'denied' });
    expect(h.read).not.toHaveBeenCalled();
    h.state.present = true;
    expect(await h.service.execute(principal, validListQuery)).toMatchObject({ kind: 'allowed' });
    h.grant.revokedAt = new Date();
    expect(await h.service.execute(principal, validListQuery)).toMatchObject({ kind: 'denied' });
    expect(h.read).toHaveBeenCalledTimes(1);
  });
  it('resumes after the last emitted row', async () => {
    const rows = Array.from({ length: 29 }, (_, n) => ({
      key: {
        id: id(n),
        timestamp: n === 28 ? null : `2026-01-01T00:00:00.${n < 2 ? '000001' : '000002'}Z`,
      },
      value: {
        id: id(n),
        notes: '😀\\"\n'.repeat(1500),
        userId: principal.userId,
        status: 'pending',
      },
    }));
    const h = harness(rows);
    const firstPage = await h.service.execute(principal, { ...validListQuery, limit: 25 });
    if (firstPage.kind !== 'allowed') throw new Error('expected page');
    expect(Buffer.byteLength(JSON.stringify(toMcpQueryResult(firstPage)))).toBeLessThanOrEqual(
      MCP_RESULT_BYTES
    );
    expect(firstPage.items.length).toBeGreaterThan(0);
    expect(firstPage.items.length).toBeLessThan(25);
    expect(firstPage.truncated).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    const firstOmittedRow = rows[firstPage.items.length].value;
    const secondPage = await h.service.execute(principal, {
      ...validListQuery,
      limit: 25,
      cursor: firstPage.nextCursor,
    });
    if (secondPage.kind !== 'allowed') throw new Error('expected page');
    expect(secondPage.items[0].id).toBe(firstOmittedRow.id);
    const seen = firstPage.items.map((row) => row.id);
    let page = secondPage;
    while (true) {
      expect(Buffer.byteLength(JSON.stringify(toMcpQueryResult(page)))).toBeLessThanOrEqual(65536);
      seen.push(...page.items.map((row) => row.id));
      if (!page.nextCursor) break;
      const next = await h.service.execute(principal, {
        ...validListQuery,
        cursor: page.nextCursor,
      });
      if (next.kind !== 'allowed') throw new Error('expected page');
      page = next;
    }
    expect(seen).toEqual(rows.map((row) => row.value.id));
  });
  it('rejects tampered, extra-segment, cross-connection, guild and filter cursors before reading', async () => {
    const h = harness(
      Array.from({ length: 3 }, (_, n) => ({
        key: { id: id(n), timestamp: null },
        value: { id: id(n) },
      }))
    );
    const first = await h.service.execute(principal, { ...validListQuery, limit: 1 });
    if (first.kind !== 'allowed' || !first.nextCursor) throw new Error('expected cursor');
    h.read.mockClear();
    for (const [actor, query] of [
      [principal, { ...validListQuery, limit: 1, cursor: `${first.nextCursor}x` }],
      [principal, { ...validListQuery, limit: 1, cursor: `${first.nextCursor}.extra` }],
      [
        { ...principal, connectionId: 'other' },
        { ...validListQuery, limit: 1, cursor: first.nextCursor },
      ],
      [
        principal,
        { ...validListQuery, guildId: '100000000000000009', limit: 1, cursor: first.nextCursor },
      ],
      [principal, { ...validListQuery, status: 'verified', limit: 1, cursor: first.nextCursor }],
    ] as const) {
      h.grant.connectionId = actor.connectionId;
      expect(await h.service.execute(actor, query)).toMatchObject({ kind: 'denied' });
    }
    expect(h.read).not.toHaveBeenCalled();
  });
  it('keeps raw content behind actor and bot visibility and does not fetch URLs', async () => {
    const h = harness();
    expect(
      await h.service.execute(principal, {
        kind: 'get_message_context',
        guildId,
        channelId: guildId,
      })
    ).toMatchObject({ kind: 'denied' });
    expect(h.messages).not.toHaveBeenCalled();
    expect(h.read).not.toHaveBeenCalled();
  });
  it.each(['list_case_history', 'list_report_evidence'] as const)(
    'paginates %s without embedding inaccessible histories in details',
    async (kind) => {
      const h = harness(
        Array.from({ length: 3 }, (_, n) => ({
          key: { id: id(n), timestamp: null },
          value: { id: id(n), content: 'evidence', reason: 'outcome' },
        }))
      );
      const q = {
        kind,
        guildId,
        ...(kind === 'list_case_history' ? { caseId: id(20) } : { reportId: id(20) }),
        limit: 1,
      };
      const first = await h.service.execute(principal, q);
      if (first.kind !== 'allowed') throw new Error('expected page');
      const second = await h.service.execute(principal, { ...q, cursor: first.nextCursor });
      expect(second).toMatchObject({ kind: 'allowed', items: [{ id: id(1) }] });
    }
  );
  it('fits a single oversized record and strips credentials and attachment URLs', async () => {
    const h = harness([
      {
        key: { id: id(1), timestamp: null },
        value: {
          id: id(1),
          reasons: Array.from({ length: 400 }, () => '\\😀'.repeat(4000)),
          metadata: { token: 'secret' },
          attachments: Array.from({ length: 30 }, () => ({
            filename: 'file',
            url: 'https://signed.example/token',
          })),
        },
      },
    ]);
    const result = await h.service.execute(principal, { kind: 'list_detections', guildId });
    expect(result).toMatchObject({ kind: 'allowed', truncated: true });
    if (result.kind !== 'allowed') throw new Error('expected page');
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('signed.example');
    expect(Buffer.byteLength(JSON.stringify(toMcpQueryResult(result)))).toBeLessThanOrEqual(65536);
  });
});

it('strips unknown settings and operational publication state', async () => {
  const h = harness([
    {
      key: { id: guildId, timestamp: null },
      value: {
        guildId,
        settings: {
          server_about: 'Allowed',
          oauth_token: 'secret',
          report_instructions_pending_publication: { channel_id: guildId, after_message_id: null },
        },
        connectionString: 'secret',
      },
    },
  ]);
  const result = await h.service.execute(principal, { kind: 'get_setup', guildId });
  expect(JSON.stringify(result)).toContain('Allowed');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('pending_publication');
});
it('delegates guild and capability discovery to fresh shared policies with signed pages', async () => {
  const h = harness();
  expect(await h.service.execute(principal, { kind: 'list_guilds' })).toMatchObject({
    kind: 'allowed',
    items: [{ guildId }],
  });
  expect(await h.service.execute(principal, { kind: 'get_capabilities', guildId })).toMatchObject({
    kind: 'allowed',
    items: [{ guildId }],
  });
  h.state.owner = false;
  h.state.permissions = String(1n << 2n);
  const changed = await h.service.execute(principal, { kind: 'get_capabilities', guildId });
  if (changed.kind !== 'allowed') throw new Error('expected capabilities');
  expect(changed.items[0].reads).not.toContain('cases');
});

it('resumes discovery after the last emitted guild and preserves empty-page directory progress', async () => {
  const guildIds = Array.from({ length: 30 }, (_, n) => String(100000000000000000n + BigInt(n)));
  const { access, state } = accessFixture(guildIds);
  const queries = createMcpQueries({
    access,
    repository: { read: async () => [] },
    cursorSecret: secret,
    guildLabel: async () => '😀\\"'.repeat(2000),
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
  const seen = [];
  let cursor: string | undefined;
  do {
    const result = await queries.execute(principal, { kind: 'list_guilds', cursor });
    if (result.kind !== 'allowed') throw new Error(JSON.stringify(result));
    expect(Buffer.byteLength(JSON.stringify(toMcpQueryResult(result)))).toBeLessThanOrEqual(65536);
    seen.push(...result.items.map((row) => row.guildId));
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual(guildIds);
  state.owner = false;
  const empty = await queries.execute(principal, { kind: 'list_guilds' });
  expect(empty).toMatchObject({ kind: 'allowed', items: [], nextCursor: expect.any(String) });
  if (empty.kind !== 'allowed') throw new Error('expected empty page');
  expect(
    await queries.execute(principal, { kind: 'list_guilds', cursor: empty.nextCursor })
  ).toMatchObject({ kind: 'allowed', items: [], nextCursor: null });
});
it('rejects mismatched member workflow purposes before target reads', async () => {
  const h = harness();
  expect(
    await h.service.execute(principal, {
      kind: 'get_member_context',
      guildId,
      userId: principal.userId,
      purpose: 'report',
      workflowId: 'ban_user',
    })
  ).toMatchObject({ kind: 'denied' });
  expect(h.read).not.toHaveBeenCalled();
});
it.each([
  { kind: 'get_case', caseId: id(1) },
  { kind: 'list_case_history', caseId: id(1) },
  { kind: 'list_detections' },
  { kind: 'get_detection', detectionId: id(1) },
  { kind: 'list_reports' },
  { kind: 'get_report', reportId: id(1) },
  { kind: 'list_report_evidence', reportId: id(1) },
  { kind: 'get_intake', intakeId: id(1) },
  { kind: 'list_attention' },
  { kind: 'get_setup' },
  { kind: 'get_diagnostics' },
])('requires fresh authority before $kind repository access', async (query) => {
  const h = harness();
  h.state.present = false;
  expect(await h.service.execute(principal, { guildId, ...query })).toMatchObject({
    kind: 'denied',
  });
  expect(h.read).not.toHaveBeenCalled();
});

it('continues discovery at the last emitted eligible guild', async () => {
  const ids = ['100000000000000001', '100000000000000002', '100000000000000003'];
  const { access, excludedGuilds } = accessFixture(ids);
  excludedGuilds.add(ids[1]);
  const service = createMcpQueries({
    access,
    repository: { read: async () => [] },
    cursorSecret: secret,
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
  const first = await service.execute(principal, { kind: 'list_guilds', limit: 2 });
  if (first.kind !== 'allowed') throw new Error('expected discovery');
  expect(first.items.map((item) => item.guildId)).toEqual([ids[0]]);
  excludedGuilds.clear();
  const second = await service.execute(principal, {
    kind: 'list_guilds',
    limit: 2,
    cursor: first.nextCursor,
  });
  if (second.kind !== 'allowed') throw new Error('expected discovery');
  expect(second.items.map((item) => item.guildId)).toEqual(ids.slice(1));
});
