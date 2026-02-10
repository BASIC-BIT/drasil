const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prismaSchemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
const prismaClientTypesPath = path.join(
  process.cwd(),
  'node_modules',
  '.prisma',
  'client',
  'index.d.ts'
);

function isGeneratedPrismaClient() {
  try {
    if (!fs.existsSync(prismaSchemaPath)) {
      return true;
    }

    const types = fs.readFileSync(prismaClientTypesPath, 'utf8');

    // Check for schema-specific exports we rely on in this codebase.
    // This avoids brittle size checks and aligns with our schema.
    return (
      types.includes('export type detection_type') &&
      types.includes('export type verification_status') &&
      types.includes('export type admin_action_type')
    );
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
