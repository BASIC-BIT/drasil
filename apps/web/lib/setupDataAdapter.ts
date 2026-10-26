import {
  ActionDeniedError,
  captchaImageSecretConfigured,
  materializeSetupStoredChange,
  parseSetupStoredRecord,
  setupStateMatches,
  type SetupWritePrecondition,
} from '@drasil/application';
import { applyCaptchaMethodChange } from '@drasil/application/postgres';
import { buildSetupSettingsPatch, normalizeOptionalId } from '@drasil/application/setup-settings';
import {
  guildSetupUpdateSchema,
  serverSettingsSchema,
  setupServerRecordSchema,
  type GuildSetupUpdate,
  type SetupServerRecord,
} from '@drasil/contracts';
import { Pool, type PoolConfig } from 'pg';
import { readOptionalEnv, readOptionalPositiveIntegerEnv, requireEnv } from './env';
import { captchaProviderConfigurationIssues } from './turnstile';
export { buildSetupSettingsPatch } from '@drasil/application/setup-settings';

export type SetupDataProvider = 'postgres' | 'convex';

export interface SetupDataAdapter {
  readonly provider: SetupDataProvider;
  listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>>;
  listCoreConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>>;
  getServer(guildId: string): Promise<SetupServerRecord | null>;
  updateGuildSetup(
    update: GuildSetupUpdate,
    precondition?: SetupWritePrecondition
  ): Promise<SetupServerRecord>;
}

const SETUP_SUMMARY_READ_CONCURRENCY = 8;

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function hasCoreSetupConfiguration(server: SetupServerRecord | null): boolean {
  return Boolean(
    server?.is_active &&
    server.case_role_id &&
    server.case_role_id !== server.guild_id &&
    server.admin_channel_id &&
    server.verification_channel_id
  );
}

let postgresPool: Pool | null = null;

function resolveDatabaseUrl(): string {
  return readOptionalEnv('DRASIL_WEB_DATABASE_URL') ?? requireEnv('DATABASE_URL');
}

function removeSslModeParam(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

function resolveSslConfig(databaseUrl: string): PoolConfig['ssl'] | undefined {
  try {
    const parsed = new URL(databaseUrl);
    const sslMode = (
      parsed.searchParams.get('sslmode') ??
      process.env.PGSSLMODE ??
      ''
    ).toLowerCase();
    if (sslMode === 'disable') {
      return false;
    }
    const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com');
    const disablesVerification =
      sslMode === 'require' || sslMode === 'no-verify' || (!sslMode && isSupabasePooler);
    const requiresSsl =
      ['require', 'verify-ca', 'verify-full'].includes(sslMode) ||
      disablesVerification ||
      isSupabasePooler;
    if (!requiresSsl) {
      return undefined;
    }
    if (sslMode === 'verify-ca') {
      return { rejectUnauthorized: true, checkServerIdentity: () => undefined };
    }
    return { rejectUnauthorized: !disablesVerification };
  } catch {
    return undefined;
  }
}

export function getPostgresPool(): Pool {
  if (postgresPool) {
    return postgresPool;
  }
  const databaseUrl = resolveDatabaseUrl();
  const ssl = resolveSslConfig(databaseUrl);
  postgresPool = new Pool({
    connectionString: ssl === undefined ? databaseUrl : removeSslModeParam(databaseUrl),
    ssl,
    max: readOptionalPositiveIntegerEnv('DRASIL_WEB_PG_POOL_MAX', 5),
  });
  return postgresPool;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function parseServerRow(row: Record<string, unknown>): SetupServerRecord {
  const settings = serverSettingsSchema.safeParse(row.settings ?? {});
  return setupServerRecordSchema.parse({
    guild_id: row.guild_id,
    case_role_id: row.case_role_id ?? null,
    admin_channel_id: row.admin_channel_id ?? null,
    verification_channel_id: row.verification_channel_id ?? null,
    admin_notification_role_id: row.admin_notification_role_id ?? null,
    heuristic_message_threshold: row.heuristic_message_threshold,
    heuristic_message_timeframe_seconds: row.heuristic_message_timeframe_seconds,
    heuristic_suspicious_keywords: row.heuristic_suspicious_keywords ?? [],
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
    settings: settings.success ? settings.data : {},
    is_active: row.is_active ?? true,
  });
}

function nextOptionalId(
  value: string | null | undefined,
  current: string | null | undefined
): string | null {
  const normalized = normalizeOptionalId(value);
  return normalized === undefined ? (current ?? null) : normalized;
}

function hasHeuristicColumnsPatch(update: GuildSetupUpdate): boolean {
  return (
    update.heuristicMessageThreshold !== undefined ||
    update.heuristicMessageTimeframeSeconds !== undefined ||
    update.heuristicSuspiciousKeywords !== undefined
  );
}

export class PostgresSetupDataAdapter implements SetupDataAdapter {
  public readonly provider = 'postgres' as const;

  public async listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    if (guildIds.length === 0) {
      return new Set();
    }
    const result = await getPostgresPool().query<{ guild_id: string }>(
      'select guild_id from servers where guild_id = any($1::text[]) and coalesce(is_active, true) = true',
      [guildIds]
    );
    return new Set(result.rows.map((row) => row.guild_id));
  }

  public async listCoreConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    if (guildIds.length === 0) {
      return new Set();
    }
    const result = await getPostgresPool().query<{ guild_id: string }>(
      `select guild_id from servers
       where guild_id = any($1::text[])
         and coalesce(is_active, true) = true
         and case_role_id is not null
         and case_role_id <> guild_id
         and admin_channel_id is not null
         and verification_channel_id is not null`,
      [guildIds]
    );
    return new Set(result.rows.map((row) => row.guild_id));
  }

  public async getServer(guildId: string): Promise<SetupServerRecord | null> {
    const result = await getPostgresPool().query(
      'select * from servers where guild_id = $1 limit 1',
      [guildId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? parseServerRow(row) : null;
  }

  public async updateGuildSetup(
    rawUpdate: GuildSetupUpdate,
    precondition?: SetupWritePrecondition
  ): Promise<SetupServerRecord> {
    const update = guildSetupUpdateSchema.parse(rawUpdate);
    const settingsPatch = buildSetupSettingsPatch(update);
    const client = await getPostgresPool().connect();
    try {
      await client.query('begin');
      if (!precondition)
        await client.query(
          'insert into servers(guild_id) values($1) on conflict(guild_id) do nothing',
          [update.guildId]
        );
      const locked = await client.query('select * from servers where guild_id=$1 for update', [
        update.guildId,
      ]);
      const row = locked.rows[0] as Record<string, unknown> | undefined;
      const current = row
        ? precondition
          ? parseSetupStoredRecord(row)
          : parseServerRow(row)
        : null;
      if (precondition && (!current || !setupStateMatches(current, precondition)))
        throw new ActionDeniedError('stale_state');
      if (!current) throw new Error('Server configuration is unavailable.');
      const materialized = materializeSetupStoredChange(current, {
        settings: settingsPatch,
        captchaReadiness: {
          turnstile: captchaProviderConfigurationIssues().length === 0,
          discord_image: captchaImageSecretConfigured(
            process.env.DRASIL_CAPTCHA_IMAGE_ANSWER_SECRET
          ),
        },
      });
      const revision = await applyCaptchaMethodChange(client, update.guildId, current.settings, {
        ...current.settings,
        ...materialized.settings,
      });
      const storedSettingsPatch = { ...materialized.settings, captcha_method_revision: revision };
      const updatedBy = update.updatedBy ?? current?.updated_by ?? null;
      let result = await client.query(
        `insert into servers (
          guild_id,
          case_role_id,
          admin_channel_id,
          verification_channel_id,
          admin_notification_role_id,
          settings,
          updated_by,
          updated_at
        ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
        on conflict (guild_id) do update set
          case_role_id = excluded.case_role_id,
          admin_channel_id = excluded.admin_channel_id,
          verification_channel_id = excluded.verification_channel_id,
          admin_notification_role_id = excluded.admin_notification_role_id,
          settings = coalesce(servers.settings, '{}'::jsonb)
            || jsonb_build_object('report_instructions_message_channel_id', coalesce(
              nullif(servers.settings->'report_instructions_message_channel_id', 'null'::jsonb),
              servers.settings->'report_instructions_channel_id',
              'null'::jsonb
            )) || excluded.settings,
          updated_by = excluded.updated_by,
          updated_at = now()
        returning *`,
        [
          update.guildId,
          nextOptionalId(update.caseRoleId, current?.case_role_id),
          nextOptionalId(update.adminChannelId, current?.admin_channel_id),
          nextOptionalId(update.verificationChannelId, current?.verification_channel_id),
          nextOptionalId(update.adminNotificationRoleId, current?.admin_notification_role_id),
          JSON.stringify(storedSettingsPatch),
          updatedBy,
        ]
      );

      if (hasHeuristicColumnsPatch(update)) {
        result = await client.query(
          `update servers set
            heuristic_message_threshold = coalesce($2::integer, heuristic_message_threshold),
            heuristic_message_timeframe_seconds = coalesce($3::integer, heuristic_message_timeframe_seconds),
            heuristic_suspicious_keywords = coalesce($4::text[], heuristic_suspicious_keywords),
            updated_by = $5,
            updated_at = now()
          where guild_id = $1
          returning *`,
          [
            update.guildId,
            update.heuristicMessageThreshold ?? null,
            update.heuristicMessageTimeframeSeconds ?? null,
            update.heuristicSuspiciousKeywords ?? null,
            updatedBy,
          ]
        );
      }
      await client.query('commit');
      return parseServerRow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class ConvexSetupDataAdapter implements SetupDataAdapter {
  public readonly provider = 'convex' as const;

  private buildUrl(path: string): URL {
    const base = requireEnv('DRASIL_CONVEX_HTTP_URL').replace(/\/+$/, '');
    return new URL(path, `${base}/`);
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-drasil-api-key': requireEnv('DRASIL_CONVEX_WEB_API_KEY'),
        ...init?.headers,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Convex setup adapter failed with status ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  public async listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    const result = await this.fetchJson<{ guildIds: string[] }>('/api/setup/guilds', {
      method: 'POST',
      body: JSON.stringify({ guildIds }),
    });
    return new Set(result.guildIds);
  }

  public async listCoreConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    const activeGuildIds = [...(await this.listConfiguredGuildIds(guildIds))];
    const servers = await mapWithConcurrency(
      activeGuildIds,
      SETUP_SUMMARY_READ_CONCURRENCY,
      async (guildId) => this.getServer(guildId)
    );
    return new Set(
      activeGuildIds.filter((_guildId, index) => hasCoreSetupConfiguration(servers[index]))
    );
  }

  public async getServer(guildId: string): Promise<SetupServerRecord | null> {
    const url = this.buildUrl('/api/setup/guild');
    url.searchParams.set('guildId', guildId);
    const response = await fetch(url, {
      headers: { 'x-drasil-api-key': requireEnv('DRASIL_CONVEX_WEB_API_KEY') },
      cache: 'no-store',
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Convex setup adapter failed with status ${response.status}.`);
    }
    return setupServerRecordSchema.parse(await response.json());
  }

  public async updateGuildSetup(
    update: GuildSetupUpdate,
    precondition?: SetupWritePrecondition
  ): Promise<SetupServerRecord> {
    if (precondition) throw new ActionDeniedError('approved_setup_executor_required');
    const result = await this.fetchJson<unknown>('/api/setup/guild', {
      method: 'POST',
      body: JSON.stringify(update),
    });
    return setupServerRecordSchema.parse(result);
  }
}

export function createSetupDataAdapter(): SetupDataAdapter {
  const provider = readOptionalEnv('DRASIL_WEB_DATA_PROVIDER') ?? 'postgres';
  if (provider === 'convex') {
    return new ConvexSetupDataAdapter();
  }
  if (provider !== 'postgres') {
    throw new Error(`Unsupported DRASIL_WEB_DATA_PROVIDER: ${provider}`);
  }
  return new PostgresSetupDataAdapter();
}
