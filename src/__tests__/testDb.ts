import { createPrismaClient, PrismaClient } from '../db/prisma';
import { Client } from 'pg';
import { execSync } from 'child_process';
import { ownedTestDatabase } from '../../scripts/owned-test-database.js';
import * as dotenv from 'dotenv';

dotenv.config();
if (process.env.JEST_INTEGRATION === '1') ownedTestDatabase();

let prismaClient: PrismaClient | null = null;

function resolveDatabaseUrl(): string {
  return ownedTestDatabase();
}

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = createPrismaClient(resolveDatabaseUrl());
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
  const client = new Client({ connectionString: resolveDatabaseUrl() });
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
      mcp_rate_buckets,
      mcp_metadata_permits,
      mcp_connection_guilds,
      mcp_connections,
      admin_actions,
      verification_events,
      detection_events,
      server_members,
      servers,
      users
    RESTART IDENTITY CASCADE;
  `);
}
