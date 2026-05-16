require('dotenv/config');

const { defineConfig, env } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node scripts/prisma-seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
