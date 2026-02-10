import 'reflect-metadata';

import {
  ensureExtensions,
  runMigrations,
  truncateAllTables,
  disconnectPrismaClient,
} from './testDb';

const shouldUseDatabase = process.env.JEST_INTEGRATION === '1';

if (shouldUseDatabase) {
  beforeAll(async () => {
    await ensureExtensions();
    runMigrations();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });
}
