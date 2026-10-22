import { randomUUID } from 'node:crypto';
import type { LimitSubject, LimitCategory, LimitDecision } from '../delegation/operations';
import type { DelegationDatabase, DelegationQueryClient } from './delegation';
interface Budget {
  subject: string;
  category: string;
  maximum: number;
  seconds: number;
}
function budgets(subject: LimitSubject, category: LimitCategory): Budget[] {
  if ('registrationIpHash' in subject) {
    if (category !== 'registration' || !/^[a-f0-9]{64}$/.test(subject.registrationIpHash))
      throw new Error('Invalid registration subject.');
    return [
      { subject: `ip:${subject.registrationIpHash}`, category, maximum: 10, seconds: 3600 },
      { subject: 'global', category, maximum: 100, seconds: 3600 },
    ];
  }
  if (category === 'registration') throw new Error('Registration requires verified ingress.');
  const maxima = { read: [120, 240, 600], submission: [30, 60, 60], new_intent: [20, 40, 40] }[
    category
  ];
  return [
    { subject: `connection:${subject.connectionId}`, category, maximum: maxima[0], seconds: 60 },
    { subject: `user:${subject.userId}`, category, maximum: maxima[1], seconds: 60 },
    ...(subject.guildId
      ? [{ subject: `guild:${subject.guildId}`, category, maximum: maxima[2], seconds: 60 }]
      : []),
  ];
}
async function consume(client: DelegationQueryClient, entries: Budget[]): Promise<LimitDecision> {
  const ordered = [...entries].sort((a, b) =>
    `${a.category}:${a.subject}` < `${b.category}:${b.subject}` ? -1 : 1
  );
  // Lock even missing buckets. All limits acquire the complete sorted lock set before inspecting or charging.
  for (const e of ordered)
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))::text', [
      `mcp-limit:${e.category}:${e.subject}`,
    ]);
  const {
    rows: [clock],
  } = await client.query<{ now: Date }>('select clock_timestamp() as now');
  const now = clock.now;
  let retry = 0;
  for (const e of ordered) {
    const {
      rows: [row],
    } = await client.query<{ count: number; oldest: Date | null }>(
      `select count(*)::int as count,min(s) as oldest from mcp_rate_buckets b,lateral unnest(b.starts) s where b.subject=$1 and b.category=$2 and s > $3::timestamptz - ($4::int * interval '1 second')`,
      [e.subject, e.category, now, e.seconds]
    );
    if (row.count >= e.maximum && row.oldest)
      retry = Math.max(
        retry,
        Math.max(1, Math.ceil((row.oldest.getTime() + e.seconds * 1000 - now.getTime()) / 1000))
      );
  }
  if (retry) return { kind: 'limited', retryAfterSeconds: retry };
  for (const e of ordered)
    await client.query(
      `insert into mcp_rate_buckets(subject,category,starts,expires_at) values($1,$2,array[$3::timestamptz],$3::timestamptz+($4::int*interval '1 second')) on conflict(subject,category) do update set starts=array(select s from unnest(mcp_rate_buckets.starts) s where s > $3::timestamptz-($4::int*interval '1 second')) || $3::timestamptz,expires_at=excluded.expires_at`,
      [e.subject, e.category, now, e.seconds]
    );
  return { kind: 'allowed' };
}
/** Use inside the intent insertion transaction, after the idempotency lookup. */
export function consumeMcpLimit(
  client: DelegationQueryClient,
  subject: LimitSubject,
  category: LimitCategory
): Promise<LimitDecision> {
  return consume(client, budgets(subject, category));
}
export interface McpOperationalStore {
  checkMcpLimit(subject: LimitSubject, category: LimitCategory): Promise<LimitDecision>;
  acquireMetadata(origin: string): Promise<() => Promise<void>>;
  pruneExpiredMcpData(now: Date, limit: number): Promise<number>;
}
export function createMcpOperationalStore(database: DelegationDatabase): McpOperationalStore {
  return {
    checkMcpLimit: (subject: LimitSubject, category: LimitCategory): Promise<LimitDecision> =>
      database.transaction((client) => consumeMcpLimit(client, subject, category)),
    async acquireMetadata(origin: string): Promise<() => Promise<void>> {
      const id = randomUUID();
      await database.transaction(async (client) => {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended('mcp-metadata-permits',0))::text"
        );
        const {
          rows: [count],
        } = await client.query<{ count: number }>(
          'select count(*)::int as count from mcp_metadata_permits'
        );
        if (count.count >= 16) throw new Error('metadata_limited');
        const decision = await consume(client, [
          { subject: 'global', category: 'metadata', maximum: 120, seconds: 60 },
          { subject: `origin:${origin}`, category: 'metadata', maximum: 30, seconds: 60 },
        ]);
        if (decision.kind === 'limited') throw new Error('metadata_limited');
        await client.query('insert into mcp_metadata_permits(id,origin) values($1::uuid,$2)', [
          id,
          origin,
        ]);
      });
      return async () => {
        await database.query('delete from mcp_metadata_permits where id=$1::uuid', [id]);
      };
    },
    async pruneExpiredMcpData(now: Date, limit: number): Promise<number> {
      const cap = Math.max(0, Math.min(500, Math.floor(limit)));
      if (!Number.isFinite(cap) || cap === 0) return 0;
      return database.transaction(async (client) => {
        const removed = await client.query<{ confirmation_id: string }>(
          `delete from mcp_intents where confirmation_id in (select i.confirmation_id from mcp_intents i where i.state in ('pending','expired','cancelled') and i.expires_at < $1::timestamptz-interval '7 days' and not exists(select 1 from mcp_executions e where e.confirmation_id=i.confirmation_id) order by i.expires_at for update of i skip locked limit $2) returning confirmation_id`,
          [now, cap]
        );
        const buckets = await client.query<{ subject: string }>(
          `delete from mcp_rate_buckets where (subject,category) in (select subject,category from mcp_rate_buckets where expires_at < $1::timestamptz-interval '1 day' order by expires_at for update skip locked limit $2) returning subject`,
          [now, cap - removed.rows.length]
        );
        return removed.rows.length + buckets.rows.length;
      });
    },
  };
}
