const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prismaClientTypesPath = path.join(
  process.cwd(),
  'node_modules',
  '.prisma',
  'client',
  'index.d.ts'
);

function isGeneratedPrismaClient() {
  try {
    const stat = fs.statSync(prismaClientTypesPath);

    // A fully generated Prisma Client types file is typically very large.
    // The default postinstall stub is small and causes TypeScript builds to fail
    // when schema-specific types (enums/input types) are referenced.
    return stat.size > 100_000;
  } catch {
    return false;
  }
}

if (isGeneratedPrismaClient()) {
  process.exit(0);
}

let prismaBin;
try {
  prismaBin = require.resolve('prisma/build/index.js');
} catch {
  // If prisma isn't installed (e.g. production installs omitting dev deps),
  // don't hard-fail the install. The app/build may still fail later if it
  // relies on a generated client, but this keeps installs deterministic.
  console.warn('[postinstall] prisma not found; skipping prisma generate');
  process.exit(0);
}

const result = spawnSync(process.execPath, [prismaBin, 'generate'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
