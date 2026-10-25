/** Shared guard for destructive test fixtures, never application runtime. */
function ownedTestDatabase(env = process.env) {
  const raw = env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL is required for owned disposable tests.');
  const database = new URL(raw);
  const owned =
    ['localhost', '127.0.0.1'].includes(database.hostname) &&
    ((database.port === '55433' && database.pathname === '/drasil_mcp_test') ||
      (database.port === '5432' && database.pathname === '/drasil_test'));
  if (
    !owned ||
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    [...database.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')
  )
    throw new Error(
      'Tests require the owned loopback 55433/drasil_mcp_test or CI 5432/drasil_test database.'
    );
  for (const name of ['DATABASE_URL', 'POSTGRES_DB_URL']) {
    if (env[name] !== raw) throw new Error(`${name} must match TEST_DATABASE_URL exactly.`);
  }
  return raw;
}
module.exports = { ownedTestDatabase };
