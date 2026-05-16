const fs = require('fs');
const path = require('path');

const compiledSeedPath = path.join(__dirname, '..', 'dist', 'prisma', 'seed.js');

if (process.env.NODE_ENV === 'production') {
  if (!fs.existsSync(compiledSeedPath)) {
    console.error(
      `[prisma-seed] Compiled seed not found at ${compiledSeedPath}. Run 'npm run build' first.`
    );
    process.exit(1);
  }

  require(compiledSeedPath);
} else {
  require('ts-node/register');
  require(path.join(__dirname, '..', 'prisma', 'seed.ts'));
}
