import { describe, expect, it } from 'vitest';
import { guildSetupUpdateSchema, setupDashboardSchema } from './setup';

describe('setup contracts', () => {
  it('accepts dashboard payloads with nullable server config', () => {
    const parsed = setupDashboardSchema.parse({
      guildId: '123',
      guildName: 'Test Guild',
      configured: false,
      dataProvider: 'postgres',
      checkedAt: new Date(0).toISOString(),
      checklist: [],
      server: null,
    });

    expect(parsed.configured).toBe(false);
  });

  it('rejects unsupported setup update modes', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      detectionResponseMode: 'ban_everyone',
    });

    expect(parsed.success).toBe(false);
  });
});
