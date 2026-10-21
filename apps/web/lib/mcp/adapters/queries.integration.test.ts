import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createPostgresQueryRepository } from './queries';
import { createMcpQueries, type QueryResult } from '../queries';
import { accessFixture, guildId, principal } from '../queryTestFixtures';
import { workflowDefinitions } from '@drasil/application';
const otherGuild = '100000000000000009';
const otherUser = '100000000000000008';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let client: PoolClient;
let service: ReturnType<typeof createMcpQueries>;
let access: ReturnType<typeof accessFixture>;
function items(result: QueryResult) {
  if (result.kind !== 'allowed') throw new Error(JSON.stringify(result));
  return result.items;
}
beforeAll(async () => {
  client = await pool.connect();
});
afterAll(async () => {
  client.release();
  await pool.end();
});
beforeEach(async () => {
  await client.query('begin');
  await client.query('insert into servers(guild_id) values($1),($2)', [guildId, otherGuild]);
  await client.query("insert into users(discord_id,username) values($1,'Actor'),($2,'Other')", [
    principal.userId,
    otherUser,
  ]);
  access = accessFixture();
  service = createMcpQueries({
    access: access.access,
    repository: createPostgresQueryRepository({ database: client }),
    cursorSecret: 'integration-cursor-secret-at-least-32',
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
});
afterEach(async () => {
  await client.query('rollback');
});
it('isolates case/detection list and detail, null guild rows, and linked history parents', async () => {
  for (const [n, guild] of [
    [1, guildId],
    [2, otherGuild],
    [3, null],
  ] as const) {
    await client.query(
      'insert into verification_events(id,server_id,user_id,notes) values($1,$2,$3,$4)',
      [id(n), guild, principal.userId, `case-${n}`]
    );
    await client.query(
      "insert into detection_events(id,server_id,user_id,detection_type,confidence,reasons,latest_verification_event_id) values($1,$2,$3,'user_report',1,ARRAY['reason'],$4)",
      [id(n + 10), guild, principal.userId, id(1)]
    );
  }
  expect(
    items(await service.execute(principal, { kind: 'list_cases', guildId })).map((row) => row.id)
  ).toEqual([id(1)]);
  expect(
    items(await service.execute(principal, { kind: 'list_detections', guildId })).map(
      (row) => row.id
    )
  ).toEqual([id(11)]);
  for (const n of [2, 3])
    expect(
      items(await service.execute(principal, { kind: 'get_case', guildId, caseId: id(n) }))
    ).toEqual([]);
  expect(
    items(await service.execute(principal, { kind: 'get_detection', guildId, detectionId: id(12) }))
  ).toEqual([]);
  expect(
    items(
      await service.execute(principal, {
        kind: 'list_case_history',
        guildId,
        caseId: id(1),
        history: 'detections',
      })
    ).map((row) => row.id)
  ).toEqual([id(11)]);
  expect(
    items(
      await service.execute(principal, {
        kind: 'list_case_history',
        guildId,
        caseId: id(2),
        history: 'detections',
      })
    )
  ).toEqual([]);
  await client.query(
    "insert into moderation_outcomes(id,server_id,user_id,verification_event_id,outcome_type,source) values($1,$2,$3,$4,'verified','drasil')",
    [id(30), otherGuild, principal.userId, id(1)]
  );
  expect(
    items(await service.execute(principal, { kind: 'list_case_history', guildId, caseId: id(1) }))
  ).toEqual([]);
});
it('binds evidence to the parent guild and reporter and excludes staff evidence and review facts', async () => {
  for (const [n, guild, reporter] of [
    [1, guildId, principal.userId],
    [2, otherGuild, principal.userId],
    [3, guildId, otherUser],
  ] as const) {
    await client.query(
      "insert into report_intakes(id,server_id,reporter_id,status,summary,metadata) values($1,$2,$3,'submitted','staff summary','{\"staff_secret\":\"hidden\"}')",
      [id(n), guild, reporter]
    );
    await client.query(
      "insert into report_intake_evidence(id,intake_id,kind,content,metadata) values($1,$2,'reporter_text','reporter text',jsonb_build_object('author_id',$3::text))",
      [id(n + 10), id(n), reporter]
    );
  }
  await client.query(
    "insert into report_intake_evidence(id,intake_id,kind,content) values($1,$2,'admin_note','staff secret')",
    [id(20), id(1)]
  );
  access.state.owner = false;
  access.state.permissions = String(1n << 2n);
  const reporter = { guildId, audience: 'reporter' };
  expect(
    items(await service.execute(principal, { kind: 'list_reports', ...reporter })).map(
      (row) => row.id
    )
  ).toEqual([id(1)]);
  expect(
    items(await service.execute(principal, { kind: 'get_report', ...reporter, reportId: id(1) }))[0]
  ).not.toHaveProperty('summary');
  expect(
    items(
      await service.execute(principal, {
        kind: 'list_report_evidence',
        ...reporter,
        reportId: id(1),
      })
    ).map((row) => row.id)
  ).toEqual([id(11)]);
  for (const n of [2, 3]) {
    expect(
      items(await service.execute(principal, { kind: 'get_intake', ...reporter, intakeId: id(n) }))
    ).toEqual([]);
    expect(
      items(
        await service.execute(principal, {
          kind: 'list_report_evidence',
          ...reporter,
          reportId: id(n),
        })
      )
    ).toEqual([]);
  }
  expect(
    await service.execute(principal, { kind: 'get_report', guildId, reportId: id(1) })
  ).toMatchObject({ kind: 'denied' });
});
it('preserves PostgreSQL microseconds, ties and nulls through all pages', async () => {
  for (const [n, time] of [
    [1, '2026-01-01T00:00:00.000002Z'],
    [2, '2026-01-01T00:00:00.000001Z'],
    [3, '2026-01-01T00:00:00.000001Z'],
    [4, null],
    [5, null],
  ] as const)
    await client.query(
      'insert into verification_events(id,server_id,user_id,updated_at) values($1,$2,$3,$4)',
      [id(n), guildId, principal.userId, time]
    );
  const seen = [];
  let cursor: string | undefined;
  do {
    const result = await service.execute(principal, {
      kind: 'list_cases',
      guildId,
      limit: 1,
      cursor,
    });
    if (result.kind !== 'allowed') throw new Error(JSON.stringify(result));
    seen.push(...result.items.map((row) => row.id));
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual([id(1), id(3), id(2), id(5), id(4)]);
});
it('requires guild membership records for target context and hides staff facts from report submission', async () => {
  const report = workflowDefinitions.find((item) => item.commandKind === 'start_report_intake')!;
  expect(report).toBeDefined();
  const query = {
    kind: 'get_member_context',
    guildId,
    userId: otherUser,
    purpose: 'report',
    workflowId: report.id,
  };
  expect(items(await service.execute(principal, query))).toEqual([]);
  await client.query(
    "insert into server_members(server_id,user_id,case_role_active,verification_status) values($1,$2,true,'banned')",
    [guildId, otherUser]
  );
  const context = items(await service.execute(principal, query))[0];
  expect(context.userId).toBe(otherUser);
  expect(context).not.toHaveProperty('verificationStatus');
  expect(context).not.toHaveProperty('caseRoleActive');
});

it('paginates ascending evidence and scopes queue rows, report details and outcome history', async () => {
  await client.query('insert into verification_events(id,server_id,user_id) values($1,$2,$3)', [
    id(1),
    guildId,
    principal.userId,
  ]);
  await client.query(
    "insert into moderation_outcomes(id,server_id,user_id,verification_event_id,outcome_type,source) values($1,$2,$3,$4,'verified','drasil')",
    [id(2), guildId, principal.userId, id(1)]
  );
  for (const [n, guild] of [
    [3, guildId],
    [4, otherGuild],
  ] as const) {
    await client.query(
      "insert into report_intakes(id,server_id,reporter_id,status,summary) values($1,$2,$3,'submitted','review summary')",
      [id(n), guild, principal.userId]
    );
    await client.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type) values($1,$2,$3,'pending_screening_member')",
      [id(n + 10), guild, principal.userId]
    );
  }
  expect(
    items(await service.execute(principal, { kind: 'list_attention', guildId })).map(
      (row) => row.id
    )
  ).toEqual([id(13)]);
  expect(
    items(
      await service.execute(principal, { kind: 'list_case_history', guildId, caseId: id(1) })
    ).map((row) => row.id)
  ).toEqual([id(2)]);
  expect(
    items(await service.execute(principal, { kind: 'get_report', guildId, reportId: id(3) }))[0]
      .summary
  ).toBe('review summary');
  expect(
    items(await service.execute(principal, { kind: 'get_report', guildId, reportId: id(4) }))
  ).toEqual([]);
  for (const [n, time] of [
    [20, '2026-01-01T00:00:00.000001Z'],
    [21, '2026-01-01T00:00:00.000002Z'],
    [22, null],
  ] as const)
    await client.query(
      "insert into report_intake_evidence(id,intake_id,kind,content,created_at) values($1,$2,'admin_note','review evidence',$3)",
      [id(n), id(3), time]
    );
  const seen = [];
  let cursor: string | undefined;
  do {
    const result = await service.execute(principal, {
      kind: 'list_report_evidence',
      guildId,
      reportId: id(3),
      limit: 1,
      cursor,
    });
    if (result.kind !== 'allowed') throw new Error(JSON.stringify(result));
    seen.push(...result.items.map((row) => row.id));
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual([id(20), id(21), id(22)]);
});
