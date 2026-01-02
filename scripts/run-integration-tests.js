const { spawnSync } = require('child_process');

process.env.JEST_INTEGRATION = '1';

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(process.execPath, [jestBin, '--testPathPattern=src/__tests__/integration'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
