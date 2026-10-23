import {
  materializeSetupStoredChange,
  parseSetupStoredRecord,
  setupStateMatches,
  type SetupStoredChange,
  type SetupWritePrecondition,
} from '../setup/persistence';
import type { SetupServerRecord } from '../setup/settings';
import type { DelegationQueryClient, DelegationSqlValue } from './delegation';

/** Caller owns the transaction. Insert-on-conflict obtains a real row lock even on first setup;
 * approved writes never create a missing server. No connection/execution locks are acquired here. */
export async function persistSetupChange(
  client: DelegationQueryClient,
  guildId: string,
  change: SetupStoredChange,
  precondition?: SetupWritePrecondition
): Promise<SetupServerRecord | null> {
  if (!precondition)
    await client.query(
      'insert into servers(guild_id) values($1) on conflict(guild_id) do nothing returning guild_id',
      [guildId]
    );
  const locked = await client.query('select * from servers where guild_id=$1 for update', [
    guildId,
  ]);
  const row = locked.rows[0];
  if (!row) return null;
  const current = parseSetupStoredRecord(row);
  if (precondition && !setupStateMatches(current, precondition)) return null;
  change = materializeSetupStoredChange(current, change);
  const values: DelegationSqlValue[] = [
    guildId,
    JSON.stringify(change.settings ?? {}),
    [...(change.resetSettings ?? [])],
  ];
  const assignments = [
    "settings = (coalesce(settings, '{}'::jsonb) || $2::jsonb) - $3::text[]",
    'updated_at=now()',
  ];
  const allowed = [
    'case_role_id',
    'admin_channel_id',
    'verification_channel_id',
    'admin_notification_role_id',
    'heuristic_message_threshold',
    'heuristic_message_timeframe_seconds',
    'heuristic_suspicious_keywords',
    'is_active',
    'updated_by',
  ] as const;
  for (const column of allowed) {
    const value = change.columns?.[column];
    if (value !== undefined) {
      values.push(value);
      assignments.push(`${column}=$${values.length}`);
    }
  }
  const result = await client.query(
    `update servers set ${assignments.join(', ')} where guild_id=$1 returning *`,
    values
  );
  if (change.settings?.captcha_mode === 'off') {
    // Completion and lifecycle writes lock server, then cases, then challenges.
    await client.query(
      `select v.id from verification_events v
       where v.id in (select verification_event_id from captcha_challenges
         where server_id=$1 and status='pending'::captcha_challenge_status)
       order by v.id for update of v`,
      [guildId]
    );
    await client.query(
      "update captcha_challenges set status='cancelled'::captcha_challenge_status, cancelled_at=now(), updated_at=now() where server_id=$1 and status='pending'::captcha_challenge_status returning id",
      [guildId]
    );
  }
  return parseSetupStoredRecord(result.rows[0]);
}
