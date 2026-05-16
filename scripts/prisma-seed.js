const fs = require('fs');
const path = require('path');

const compiledSeedPath = path.join(__dirname, '..', 'dist', 'prisma', 'seed.js');

if (process.env.NODE_ENV === 'production' && fs.existsSync(compiledSeedPath)) {
  require(compiledSeedPath);
} else {
  require('ts-node/register');
  require(path.join(__dirname, '..', 'prisma', 'seed.ts'));
}
