import { Pool, type PoolConfig } from 'pg';
import {
  guildSetupUpdateSchema,
  serverSettingsSchema,
  setupServerRecordSchema,
  type GuildSetupUpdate,
  type SetupServerRecord,
} from '@drasil/contracts';
import {
  fixtureGuildId,
  fixtureServerRecord,
  isWebE2eFixtureMode,
  updateFixtureServerRecord,
} from './e2eFixtures';
import { readOptionalEnv, readOptionalPositiveIntegerEnv, requireEnv } from './env';

export type SetupDataProvider = 'postgres' | 'convex';

export interface SetupDataAdapter {
  readonly provider: SetupDataProvider;
  listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>>;
  getServer(guildId: string): Promise<SetupServerRecord | null>;
  updateGuildSetup(update: GuildSetupUpdate): Promise<SetupServerRecord>;
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

function normalizeOptionalId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nextOptionalId(
  value: string | null | undefined,
  current: string | null | undefined
): string | null {
  const normalized = normalizeOptionalId(value);
  return normalized === undefined ? (current ?? null) : normalized;
}

function buildSettingsPatch(update: GuildSetupUpdate): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      observed_detection_notification_channel_id: normalizeOptionalId(
        update.observedNotificationChannelId
      ),
      report_instructions_channel_id: normalizeOptionalId(update.reportInstructionsChannelId),
      detection_response_mode: update.detectionResponseMode,
      message_detection_response_mode: update.messageDetectionResponseMode,
      join_detection_response_mode: update.joinDetectionResponseMode,
      user_report_reason_required: update.userReportReasonRequired,
      user_report_external_response_mode: update.userReportExternalResponseMode,
      analytics_consent_level: update.analyticsConsentLevel,
      report_ai_triage_enabled: update.reportAiTriageEnabled,
      report_ai_max_action: update.reportAiMaxAction,
      case_responder_role_ids: update.caseResponderRoleIds,
      case_responder_routing_mode: update.caseResponderRoutingMode,
    }).filter((entry) => entry[1] !== undefined)
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

  public async getServer(guildId: string): Promise<SetupServerRecord | null> {
    const result = await getPostgresPool().query(
      'select * from servers where guild_id = $1 limit 1',
      [guildId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? parseServerRow(row) : null;
  }

  public async updateGuildSetup(rawUpdate: GuildSetupUpdate): Promise<SetupServerRecord> {
    const update = guildSetupUpdateSchema.parse(rawUpdate);
    const current = await this.getServer(update.guildId);
    const settingsPatch = buildSettingsPatch(update);
    const updatedBy = update.updatedBy ?? current?.updated_by ?? null;

    const result = await getPostgresPool().query(
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
        settings = coalesce(servers.settings, '{}'::jsonb) || excluded.settings,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning *`,
      [
        update.guildId,
        nextOptionalId(update.caseRoleId, current?.case_role_id),
        nextOptionalId(update.adminChannelId, current?.admin_channel_id),
        nextOptionalId(update.verificationChannelId, current?.verification_channel_id),
        nextOptionalId(update.adminNotificationRoleId, current?.admin_notification_role_id),
        JSON.stringify(settingsPatch),
        updatedBy,
      ]
    );
    return parseServerRow(result.rows[0] as Record<string, unknown>);
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

  public async updateGuildSetup(update: GuildSetupUpdate): Promise<SetupServerRecord> {
    const result = await this.fetchJson<unknown>('/api/setup/guild', {
      method: 'POST',
      body: JSON.stringify(update),
    });
    return setupServerRecordSchema.parse(result);
  }
}

export class FixtureSetupDataAdapter implements SetupDataAdapter {
  public readonly provider = 'postgres' as const;

  public async listConfiguredGuildIds(guildIds: readonly string[]): Promise<Set<string>> {
    return new Set(guildIds.includes(fixtureGuildId) ? [fixtureGuildId] : []);
  }

  public async getServer(guildId: string): Promise<SetupServerRecord | null> {
    return guildId === fixtureGuildId ? fixtureServerRecord() : null;
  }

  public async updateGuildSetup(update: GuildSetupUpdate): Promise<SetupServerRecord> {
    return updateFixtureServerRecord(update);
  }
}

export function createSetupDataAdapter(): SetupDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureSetupDataAdapter();
  }

  const provider = readOptionalEnv('DRASIL_WEB_DATA_PROVIDER') ?? 'postgres';
  if (provider === 'convex') {
    return new ConvexSetupDataAdapter();
  }
  if (provider !== 'postgres') {
    throw new Error(`Unsupported DRASIL_WEB_DATA_PROVIDER: ${provider}`);
  }
  return new PostgresSetupDataAdapter();
}
