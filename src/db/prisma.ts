import { PrismaPg } from '@prisma/adapter-pg';
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

  const adapter = new PrismaPg({ connectionString: databaseUrl, max: resolvePoolMax() });
  return new PrismaClient({ adapter });
}

function resolvePoolMax(): number {
  const poolMax = Number.parseInt(process.env.PG_POOL_MAX || '10', 10);

  if (!Number.isInteger(poolMax) || poolMax < 1) {
    throw new Error('PG_POOL_MAX must be a positive integer.');
  }

  return poolMax;
}
