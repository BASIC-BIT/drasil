import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    // The prescribed limits.test.ts suite uses persisted buckets when an owned test DB is supplied.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
