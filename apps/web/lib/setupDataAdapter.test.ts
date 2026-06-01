import { describe, expect, it, vi } from 'vitest';

describe('createSetupDataAdapter', () => {
  it('defaults to the postgres adapter', async () => {
    vi.stubEnv('DRASIL_WEB_DATA_PROVIDER', '');
    const { createSetupDataAdapter } = await import('./setupDataAdapter');

    expect(createSetupDataAdapter().provider).toBe('postgres');
  });

  it('can select the convex adapter boundary', async () => {
    vi.stubEnv('DRASIL_WEB_DATA_PROVIDER', 'convex');
    const { createSetupDataAdapter } = await import('./setupDataAdapter');

    expect(createSetupDataAdapter().provider).toBe('convex');
  });
});
