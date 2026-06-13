import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

export {
  Prisma,
  PrismaClient,
  admin_action_type,
  detection_type,
  moderation_outcome_source,
  moderation_outcome_type,
  report_intake_evidence_kind,
  report_intake_status,
  verification_status,
} from '../generated/prisma/client';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create a Prisma client.');
  }

  const adapter = new PrismaPg(createPrismaPoolConfig(databaseUrl));
  return new PrismaClient({ adapter });
}

export function createPrismaPoolConfig(databaseUrl: string): PoolConfig {
  const poolConfig: PoolConfig = { connectionString: databaseUrl, max: resolvePoolMax() };
  const ssl = resolveSslConfig(databaseUrl);
  if (ssl !== undefined) {
    poolConfig.connectionString = removeSslModeParam(databaseUrl);
    poolConfig.ssl = ssl;
  }

  return poolConfig;
}

function removeSslModeParam(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return databaseUrl;
  }

  parsed.searchParams.delete('sslmode');
  return parsed.toString();
}

function resolveSslConfig(databaseUrl: string): PoolConfig['ssl'] | undefined {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return undefined;
  }

  const sslMode = (parsed.searchParams.get('sslmode') || process.env.PGSSLMODE || '').toLowerCase();
  if (sslMode === 'disable') {
    return false;
  }

  const isSupabasePooler = parsed.hostname.endsWith('.pooler.supabase.com');
  const disablesCertificateVerification =
    sslMode === 'require' || sslMode === 'no-verify' || (!sslMode && isSupabasePooler);
  const requiresSsl =
    ['require', 'verify-ca', 'verify-full'].includes(sslMode) ||
    disablesCertificateVerification ||
    isSupabasePooler;
  if (!requiresSsl) {
    return undefined;
  }

  if (sslMode === 'verify-ca') {
    return {
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }

  return {
    rejectUnauthorized: !disablesCertificateVerification,
  };
}

function resolvePoolMax(): number {
  const poolMax = Number(process.env.PG_POOL_MAX || '10');

  if (!Number.isInteger(poolMax) || poolMax < 1) {
    throw new Error('PG_POOL_MAX must be a positive integer.');
  }

  return poolMax;
}
