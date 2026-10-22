import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { ownedTestDatabase } from '../../scripts/owned-test-database.js';

ownedTestDatabase();
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
