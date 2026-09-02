import { describe, expect, it, vi } from 'vitest';
import { getPublicAppUrl, readOptionalPositiveIntegerEnv } from './env';

describe('environment helpers', () => {
  it('rejects invalid public app URLs', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'javascript:alert(1)');

    expect(() => getPublicAppUrl()).toThrow('NEXT_PUBLIC_APP_URL');
  });

  it.each([
    'https://drasil.example/base',
    'https://drasil.example?preview=1',
    'https://drasil.example#preview',
    'https://user:password@drasil.example',
  ])('rejects a public app URL that is not a bare origin: %s', (value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);

    expect(() => getPublicAppUrl()).toThrow('must be a valid HTTP(S) origin');
  });

  it('normalizes a public app origin with a trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example/');

    expect(getPublicAppUrl()).toBe('https://drasil.example');
  });

  it('rejects invalid positive integer values', () => {
    vi.stubEnv('DRASIL_WEB_PG_POOL_MAX', '0');

    expect(() => readOptionalPositiveIntegerEnv('DRASIL_WEB_PG_POOL_MAX', 5)).toThrow(
      'DRASIL_WEB_PG_POOL_MAX'
    );
  });
});
