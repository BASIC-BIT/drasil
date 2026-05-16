const { spawnSync } = require('child_process');

process.env.JEST_INTEGRATION = '1';

const testDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  console.error('Missing TEST_DATABASE_URL or DATABASE_URL for integration tests.');
  process.exit(1);
}

const testEnv = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || testDatabaseUrl,
};

const prismaBin = require.resolve('prisma/build/index.js');
const prismaResult = spawnSync(process.execPath, [prismaBin, 'generate'], {
  stdio: 'inherit',
  env: testEnv,
});

if (prismaResult.status !== 0) {
  process.exit(prismaResult.status !== null ? prismaResult.status : 1);
}

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  [jestBin, '--testPathPattern=src/__tests__/integration'],
  {
    stdio: 'inherit',
    env: testEnv,
  }
);

process.exit(result.status !== null ? result.status : 1);
