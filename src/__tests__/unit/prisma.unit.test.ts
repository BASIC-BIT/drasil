import { createPrismaPoolConfig } from '../../db/prisma';

describe('createPrismaClient', () => {
  const originalPgPoolMax = process.env.PG_POOL_MAX;
  const originalPgSslMode = process.env.PGSSLMODE;

  afterEach(() => {
    if (originalPgPoolMax === undefined) {
      delete process.env.PG_POOL_MAX;
    } else {
      process.env.PG_POOL_MAX = originalPgPoolMax;
    }
    if (originalPgSslMode === undefined) {
      delete process.env.PGSSLMODE;
    } else {
      process.env.PGSSLMODE = originalPgSslMode;
    }
  });

  it('enables TLS without CA verification for Supabase pooler URLs', () => {
    process.env.PG_POOL_MAX = '7';

    expect(
      createPrismaPoolConfig(
        'postgresql://user:password@aws-1-us-east-1.pooler.supabase.com:6543/db'
      )
    ).toEqual({
      connectionString: 'postgresql://user:password@aws-1-us-east-1.pooler.supabase.com:6543/db',
      max: 7,
      ssl: { rejectUnauthorized: false },
    });
  });

  it('does not force TLS for local database URLs', () => {
    expect(createPrismaPoolConfig('postgresql://user:password@localhost:5432/db')).toEqual({
      connectionString: 'postgresql://user:password@localhost:5432/db',
      max: 10,
    });
  });

  it('honors verify-full sslmode', () => {
    expect(
      createPrismaPoolConfig('postgresql://user:password@example.com:5432/db?sslmode=verify-full')
    ).toEqual({
      connectionString: 'postgresql://user:password@example.com:5432/db?sslmode=verify-full',
      max: 10,
      ssl: { rejectUnauthorized: true },
    });
  });
});
