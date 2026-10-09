import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parse } from 'dotenv';

const scriptPath = path.resolve(__dirname, '../../../scripts/hydrate-dev-env.js');
const source = fs.readFileSync(scriptPath, 'utf8');
function hydrate(
  env: Record<string, string> = {},
  existing = ''
): { written: Record<string, string>; requests: string[]; logs: string } {
  let written = '';
  const requests: string[] = [];
  const logs: string[] = [];
  vm.runInNewContext(source, {
    __dirname: path.dirname(scriptPath),
    process: { env },
    require: (name: string) => {
      if (name === 'path') return path;
      if (name === 'dotenv') return { parse };
      if (name === 'fs')
        return {
          existsSync: () => Boolean(existing),
          readFileSync: () => existing,
          writeFileSync: (_path: string, content: string) => {
            written = content;
          },
        };
      if (name === 'child_process')
        return {
          execFileSync: (_command: string, args: string[]) => {
            const secretId = args[args.indexOf('--secret-id') + 1];
            requests.push(secretId);
            return secretId.includes('langfuse')
              ? 'synthetic-langfuse-secret'
              : 'synthetic-provider-secret';
          },
        };
      throw new Error('Unexpected module');
    },
    console: {
      log: (...values: unknown[]) => logs.push(values.join(' ')),
      warn: (...values: unknown[]) => logs.push(values.join(' ')),
    },
  });
  return { written: parse(written), requests, logs: logs.join('\n') };
}

describe('development environment hydration', () => {
  it('fetches only explicitly configured Langfuse secrets and never prints their values', () => {
    const result = hydrate({
      DRASIL_LANGFUSE_PUBLIC_KEY_SECRET: 'dev/langfuse/public',
      DRASIL_LANGFUSE_SECRET_KEY_SECRET: 'dev/langfuse/secret',
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      LANGFUSE_TRACING_ENABLED: 'true',
      LANGFUSE_TRACING_ENVIRONMENT: 'development',
    });
    expect(result.requests).toEqual(
      expect.arrayContaining(['dev/langfuse/public', 'dev/langfuse/secret'])
    );
    expect(result.written).toMatchObject({
      LANGFUSE_PUBLIC_KEY: 'synthetic-langfuse-secret',
      LANGFUSE_SECRET_KEY: 'synthetic-langfuse-secret',
      LANGFUSE_TRACING_ENABLED: 'true',
      LANGFUSE_TRACING_ENVIRONMENT: 'development',
    });
    expect(result.logs).not.toContain('synthetic-langfuse-secret');
  });
  it('preserves existing optional keys and settings while allowing process overrides', () => {
    const result = hydrate(
      { LANGFUSE_RELEASE: 'new-sha' },
      'TYPESAFE_API_KEY=existing-typesafe\nLANGFUSE_PUBLIC_KEY=existing-public\nLANGFUSE_SECRET_KEY=existing-secret\nLANGFUSE_BASE_URL=https://us.cloud.langfuse.com\nLANGFUSE_TRACING_ENABLED=true\nLANGFUSE_TRACING_ENVIRONMENT=development\nLANGFUSE_RELEASE=old-sha'
    );
    expect(result.written).toMatchObject({
      TYPESAFE_API_KEY: 'existing-typesafe',
      LANGFUSE_PUBLIC_KEY: 'existing-public',
      LANGFUSE_SECRET_KEY: 'existing-secret',
      LANGFUSE_BASE_URL: 'https://us.cloud.langfuse.com',
      LANGFUSE_TRACING_ENABLED: 'true',
      LANGFUSE_TRACING_ENVIRONMENT: 'development',
      LANGFUSE_RELEASE: 'new-sha',
    });
    expect(result.requests.filter((id) => id.includes('LANGFUSE'))).toHaveLength(0);
    expect(result.logs).not.toContain('existing-secret');
  });
  it('does not fetch unconfigured optional secrets or silently enable tracing', () => {
    const result = hydrate();
    expect(result.requests).toHaveLength(3);
    expect(result.written.LANGFUSE_SECRET_KEY).toBeUndefined();
    expect(result.written.LANGFUSE_TRACING_ENABLED).not.toBe('true');
    expect(result.requests).not.toContain('drasil/dev/LANGFUSE_SECRET_KEY');
  });
});
