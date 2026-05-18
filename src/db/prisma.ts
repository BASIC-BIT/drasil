import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

export {
  Prisma,
  PrismaClient,
  admin_action_type,
  detection_type,
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
    poolConfig.ssl = ssl;
  }

  return poolConfig;
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

  const disablesCertificateVerification =
    sslMode === 'require' ||
    sslMode === 'no-verify' ||
    parsed.hostname.endsWith('.pooler.supabase.com');
  const requiresSsl =
    ['require', 'verify-ca', 'verify-full'].includes(sslMode) || disablesCertificateVerification;
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
