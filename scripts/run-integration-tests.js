const { spawnSync } = require('child_process');

process.env.JEST_INTEGRATION = '1';

const prismaBin = require.resolve('prisma/build/index.js');
const prismaResult = spawnSync(process.execPath, [prismaBin, 'generate'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/drasil_test?schema=public',
  },
});

if (prismaResult.status !== 0) {
  process.exit(prismaResult.status ?? 1);
}

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  [jestBin, '--testPathPattern=src/__tests__/integration'],
  {
    stdio: 'inherit',
    env: process.env,
  }
);

process.exit(result.status ?? 1);
