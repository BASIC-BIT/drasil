import { describe, expect, it, vi } from 'vitest';
import { getPublicAppUrl, readOptionalPositiveIntegerEnv } from './env';

describe('environment helpers', () => {
  it('rejects invalid public app URLs', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'javascript:alert(1)');

    expect(() => getPublicAppUrl()).toThrow('NEXT_PUBLIC_APP_URL');
  });

  it('rejects invalid positive integer values', () => {
    vi.stubEnv('DRASIL_WEB_PG_POOL_MAX', '0');

    expect(() => readOptionalPositiveIntegerEnv('DRASIL_WEB_PG_POOL_MAX', 5)).toThrow(
      'DRASIL_WEB_PG_POOL_MAX'
    );
  });
});
