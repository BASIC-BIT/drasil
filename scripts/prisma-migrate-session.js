const { execSync } = require('child_process');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Prisma migrations.');
}

const migrationUrl = new URL(databaseUrl);

if (migrationUrl.port === '6543') {
  migrationUrl.port = '5432';
}

migrationUrl.searchParams.delete('pgbouncer');

execSync('npm run prisma:migrate:deploy', {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: migrationUrl.toString(),
  },
});
