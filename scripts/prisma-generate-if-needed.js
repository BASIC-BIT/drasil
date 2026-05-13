const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const prismaSchemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
const prismaClientTypesPath = path.join(process.cwd(), 'src', 'generated', 'prisma', 'client.ts');

const generateDatabaseUrl =
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/drasil?schema=public';

if (process.env.PRISMA_SKIP_POSTINSTALL_GENERATE) {
  process.exit(0);
}

if (!fs.existsSync(prismaSchemaPath)) {
  console.warn('[postinstall] prisma/schema.prisma not found; skipping prisma generate');
  process.exit(0);
}

function isGeneratedPrismaClient() {
  try {
    const types = fs.readFileSync(prismaClientTypesPath, 'utf8');

    // Check for schema-specific exports we rely on in this codebase.
    // This avoids brittle size checks and aligns with our schema.
    return (
      types.includes('detection_type') &&
      types.includes('verification_status') &&
      types.includes('admin_action_type')
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
  env: { ...process.env, DATABASE_URL: generateDatabaseUrl },
});

process.exit(result.status ?? 1);
