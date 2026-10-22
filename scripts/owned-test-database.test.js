const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownedTestDatabase } = require('./owned-test-database.js');
const env = (url) => ({ TEST_DATABASE_URL: url, DATABASE_URL: url, POSTGRES_DB_URL: url });
for (const target of ['127.0.0.1:55433/drasil_mcp_test', 'localhost:5432/drasil_test'])
  test(`accepts owned ${target}`, () => {
    const url = `postgresql://test:password@${target}`;
    assert.equal(ownedTestDatabase(env(url)), url);
  });
for (const target of [
  'remote.example:55433/drasil_mcp_test',
  'localhost:5432/production',
  'localhost:55433/other_test',
  'localhost:5432/drasil_mcp_test',
])
  test(`rejects unowned ${target}`, () =>
    assert.throws(() => ownedTestDatabase(env(`postgresql://test:password@${target}`))));
test('rejects absent or mismatching URLs before connecting', () => {
  assert.throws(() => ownedTestDatabase({}));
  const value = env('postgresql://test:password@localhost:5432/drasil_test');
  assert.throws(() => ownedTestDatabase({ ...value, DATABASE_URL: 'postgresql://other' }));
  assert.throws(() => ownedTestDatabase({ ...value, POSTGRES_DB_URL: undefined }));
});

test('rejects connection query overrides', () => {
  for (const suffix of ['?host=remote.example', '?schema=other', '?options=unsafe'])
    assert.throws(() =>
      ownedTestDatabase(env('postgresql://test:password@localhost:5432/drasil_test' + suffix))
    );
});
