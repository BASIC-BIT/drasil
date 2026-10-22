const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { ownedTestDatabase } = require('./owned-test-database.js');
async function main() {
  const connectionString = ownedTestDatabase();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions');
  } finally {
    await client.end();
  }
  const result = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    { stdio: 'inherit', env: process.env }
  );
  if (result.status !== 0) throw new Error('Disposable database migration deployment failed.');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
