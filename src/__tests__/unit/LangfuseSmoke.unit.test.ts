import { spawnSync } from 'node:child_process';
import path from 'node:path';

it('refuses live smoke calls when tracing is disabled and prints no credential values', () => {
  const root = path.resolve(__dirname, '../../..');
  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register', 'src/scripts/langfuseSmoke.ts'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        LANGFUSE_TRACING_ENABLED: 'false',
        LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
        LANGFUSE_TRACING_ENVIRONMENT: 'development',
        LANGFUSE_PUBLIC_KEY: 'synthetic-public-key',
        LANGFUSE_SECRET_KEY: 'synthetic-secret-key',
        OPENAI_API_KEY: '',
        TYPESAFE_API_KEY: '',
      },
    }
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"tracing_enabled":false');
  expect(result.stderr).toContain('[smoke] configuration or provider verification failed');
  expect(result.stdout + result.stderr).not.toContain('synthetic-secret-key');
  expect(result.stdout + result.stderr).not.toContain('synthetic-public-key');
}, 35000);
