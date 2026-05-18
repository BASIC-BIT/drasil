import { createPrismaPoolConfig } from '../../db/prisma';

describe('createPrismaPoolConfig', () => {
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

  it('does not disable CA verification for direct Supabase URLs by default', () => {
    expect(
      createPrismaPoolConfig('postgresql://user:password@db.project.supabase.com:5432/db')
    ).toEqual({
      connectionString: 'postgresql://user:password@db.project.supabase.com:5432/db',
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

  it('honors require sslmode without CA verification', () => {
    expect(
      createPrismaPoolConfig('postgresql://user:password@example.com:5432/db?sslmode=require')
    ).toEqual({
      connectionString: 'postgresql://user:password@example.com:5432/db?sslmode=require',
      max: 10,
      ssl: { rejectUnauthorized: false },
    });
  });

  it('honors verify-ca sslmode', () => {
    expect(
      createPrismaPoolConfig('postgresql://user:password@example.com:5432/db?sslmode=verify-ca')
    ).toEqual({
      connectionString: 'postgresql://user:password@example.com:5432/db?sslmode=verify-ca',
      max: 10,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('honors no-verify sslmode', () => {
    expect(
      createPrismaPoolConfig('postgresql://user:password@example.com:5432/db?sslmode=no-verify')
    ).toEqual({
      connectionString: 'postgresql://user:password@example.com:5432/db?sslmode=no-verify',
      max: 10,
      ssl: { rejectUnauthorized: false },
    });
  });
});
