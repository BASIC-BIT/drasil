import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL is required for web integration tests.');
const database = new URL(process.env.TEST_DATABASE_URL);
if (
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !database.pathname.endsWith('_test')
) {
  throw new Error('Web integration tests require a disposable loopback *_test database.');
}
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
