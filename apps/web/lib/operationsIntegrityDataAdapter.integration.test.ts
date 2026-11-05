import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { PostgresOperationsIntegrityDataAdapter } from './operationsIntegrityDataAdapter';
import { createPostgresQueryRepository } from './mcp/adapters/queries';
import { createMcpQueries } from './mcp/queries';
import { accessFixture, guildId, principal } from './mcp/queryTestFixtures';

const otherGuild = '100000000000000009';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let client: PoolClient;
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => client }));
const adapter = new PostgresOperationsIntegrityDataAdapter();

beforeAll(async () => {
  client = await pool.connect();
});
afterAll(async () => {
  client.release();
  await pool.end();
});
beforeEach(async () => {
  await client.query('begin');
  await client.query(
    "insert into servers(guild_id,settings) values($1,'{\"report_intake_staged_enabled\":false}'),($2,'{}')",
    [guildId, otherGuild]
  );
  await client.query("insert into users(discord_id,username) values($1,'Synthetic')", [
    principal.userId,
  ]);
});
afterEach(async () => {
  await client.query('rollback');
});

it.each([
  { name: 'new evidence', status: 'collecting_evidence', open: 1, due: 1 },
  {
    name: 'reporter timeout without new evidence',
    status: 'needs_reporter_confirmation',
    revision: 1,
    open: 1,
    due: 1,
  },
  { name: 'admin follow-up evidence', status: 'needs_admin_confirmation', open: 1, due: 1 },
  { name: 'future work', status: 'collecting_evidence', time: 'future', open: 1, due: 0 },
  { name: 'unscheduled work', status: 'collecting_evidence', time: 'none', open: 1, due: 0 },
  { name: 'active lease', status: 'collecting_evidence', lease: 'future', open: 1, due: 0 },
  { name: 'expired lease', status: 'collecting_evidence', lease: 'past', open: 1, due: 1 },
  {
    name: 'lease and due boundary',
    status: 'collecting_evidence',
    lease: 'now',
    time: 'now',
    open: 1,
    due: 1,
  },
  {
    name: 'failed analysis',
    status: 'collecting_evidence',
    failure: 'invalid_metadata',
    open: 1,
    due: 0,
  },
  { name: 'no new evidence', status: 'collecting_evidence', revision: 1, open: 1, due: 0 },
  {
    name: 'admin wait without new evidence',
    status: 'needs_admin_confirmation',
    revision: 1,
    open: 1,
    due: 0,
  },
  { name: 'closed timestamp', status: 'collecting_evidence', closed: true, open: 0, due: 0 },
  { name: 'confirmed target', status: 'collecting_evidence', confirmed: true, open: 0, due: 0 },
  ...['submitted', 'closed_by_reporter', 'actioned', 'dismissed', 'false_positive', 'expired'].map(
    (status) => ({ name: status, status, open: 0, due: 0 })
  ),
])('counts $name while staged processing is off', async (row) => {
  const time = (value: string | undefined): string =>
    value === 'none'
      ? 'null'
      : value === 'future'
        ? "now()+interval '1 hour'"
        : value === 'now'
          ? 'now()'
          : "now()-interval '1 hour'";
  await client.query(
    `insert into report_intakes(server_id,reporter_id,status,created_at,analysis_due_at,analysis_lease_until,analysis_failure_code,evidence_revision,analysis_revision,closed_at,confirmed_target_user_id)
     values($1,$2,$3::report_intake_status,now()-interval '90 days',${time('time' in row ? row.time : undefined)},${'lease' in row ? time(row.lease) : 'null'},$4,1,$5,${'closed' in row ? 'now()' : 'null'},$6)`,
    [
      guildId,
      principal.userId,
      row.status,
      'failure' in row ? row.failure : null,
      'revision' in row ? row.revision : 0,
      'confirmed' in row ? principal.userId : null,
    ]
  );
  // A foreign eligible intake must never affect this guild's exposure.
  await client.query(
    'insert into report_intakes(server_id,reporter_id,analysis_due_at,evidence_revision) values($1,$2,now(),1)',
    [otherGuild, principal.userId]
  );
  const snapshot = await adapter.getSnapshot(guildId);
  expect(snapshot.candidateCounts).toMatchObject({
    openReportIntakes: row.open,
    dueReportIntakeAnalyses: row.due,
  });
});

it('returns zero for an empty guild and projects only aggregate diagnostics through MCP', async () => {
  const access = accessFixture();
  const service = createMcpQueries({
    access: access.access,
    repository: createPostgresQueryRepository({ database: client, diagnostics: adapter }),
    cursorSecret: 'integration-cursor-secret-at-least-32',
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
  const result = await service.execute(principal, { kind: 'get_diagnostics', guildId });
  expect(result).toMatchObject({
    kind: 'allowed',
    items: [{ candidateCounts: { openReportIntakes: 0, dueReportIntakeAnalyses: 0 } }],
  });
  if (result.kind !== 'allowed') throw new Error('Expected authorized diagnostics');
  expect(Object.keys(result.items[0]).sort()).toEqual([
    'candidateCounts',
    'checkedAt',
    'lookbackDays',
  ]);
  access.state.present = false;
  expect(await service.execute(principal, { kind: 'get_diagnostics', guildId })).toMatchObject({
    kind: 'denied',
  });
});
