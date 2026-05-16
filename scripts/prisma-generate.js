const { spawnSync } = require('child_process');

const generateDatabaseUrl =
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/drasil?schema=public';

const prismaBin = require.resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaBin, 'generate'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: generateDatabaseUrl },
});

process.exit(result.status !== null ? result.status : 1);
