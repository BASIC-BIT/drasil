import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

let resolvedDatabaseUrl: string | null = null;
let prismaClient: PrismaClient | null = null;

function resolveDatabaseUrl(): string {
  if (resolvedDatabaseUrl) {
    return resolvedDatabaseUrl;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Missing TEST_DATABASE_URL or DATABASE_URL for integration tests.');
  }

  process.env.DATABASE_URL = databaseUrl;
  resolvedDatabaseUrl = databaseUrl;
  return databaseUrl;
}

function resolveAdminDatabaseUrl(): string {
  return process.env.POSTGRES_DB_URL || resolveDatabaseUrl();
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    resolveDatabaseUrl();
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}

export async function ensureExtensions(): Promise<void> {
  const client = new Client({ connectionString: resolveAdminDatabaseUrl() });
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS extensions;');
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;');
  await client.end();
}

export function runMigrations(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: resolveDatabaseUrl() },
  });
}

export async function truncateAllTables(): Promise<void> {
  resolveDatabaseUrl();
  const prisma = getPrismaClient();
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      admin_actions,
      verification_events,
      detection_events,
      server_members,
      servers,
      users
    RESTART IDENTITY CASCADE;
  `);
}
