import { Client } from 'discord.js';
import { ConfigService } from '../../config/ConfigService';
import {
  buildProductAnalyticsPayload,
  ProductAnalyticsService,
} from '../../services/ProductAnalyticsService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';

const buildClient = (): Client => ({}) as Client;

describe('ProductAnalyticsService (unit)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'in-memory';
    delete process.env.POSTHOG_PROJECT_API_KEY;
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_PRODUCT_ANALYTICS_ENABLED;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds anonymous payloads with hashed identifiers and no raw IDs', () => {
    const payload = buildProductAnalyticsPayload({
      consentLevel: 'anonymous',
      guildId: 'guild-1',
      userId: 'user-1',
      event: 'detection flagged',
      properties: { detection_type: 'suspicious_content', confidence: 0.9 },
      identifiers: { moderatorId: 'mod-1' },
    });

    expect(payload).toMatchObject({
      distinctId: expect.stringMatching(/^drasil_user:/),
      event: 'detection flagged',
      groups: { guild: expect.stringMatching(/^drasil_guild:/) },
      properties: {
        analytics_consent_level: 'anonymous',
        detection_type: 'suspicious_content',
        confidence: 0.9,
        guild_id_hash: expect.any(String),
        user_id_hash: expect.any(String),
        moderator_id_hash: expect.any(String),
        $process_person_profile: false,
      },
    });
    expect(payload?.properties.guild_id).toBeUndefined();
    expect(payload?.properties.user_id).toBeUndefined();
    expect(payload?.properties.moderator_id).toBeUndefined();
  });

  it('builds full payloads with intentional raw Discord IDs', () => {
    const payload = buildProductAnalyticsPayload({
      consentLevel: 'full',
      guildId: 'guild-1',
      userId: 'user-1',
      event: 'observed detection action completed',
      identifiers: { moderatorId: 'mod-1', detectionEventId: 'det-1' },
    });

    expect(payload).toMatchObject({
      distinctId: 'discord_user:user-1',
      groups: { guild: 'guild-1' },
      properties: {
        analytics_consent_level: 'full',
        guild_id: 'guild-1',
        user_id: 'user-1',
        moderator_id: 'mod-1',
        detection_event_id: 'det-1',
        guild_id_hash: expect.any(String),
        user_id_hash: expect.any(String),
        $process_person_profile: false,
      },
    });
  });

  it('does not build payloads when consent is off', () => {
    expect(
      buildProductAnalyticsPayload({
        consentLevel: 'off',
        guildId: 'guild-1',
        event: 'guild installed',
      })
    ).toBeNull();
  });

  it('is inactive when no PostHog project token is configured', async () => {
    const configService = new ConfigService(new InMemoryServerRepository(), buildClient());
    await configService.getServerConfig('guild-1');
    const service = new ProductAnalyticsService(configService);

    await service.captureGuildEvent('guild-1', 'guild installed');

    expect(service.getStatus()).toMatchObject({ configured: false });
  });

  it('falls back to POSTHOG_API_KEY when POSTHOG_PROJECT_API_KEY is blank', async () => {
    process.env.POSTHOG_PROJECT_API_KEY = ' ';
    process.env.POSTHOG_API_KEY = 'ph_project_test';
    const configService = new ConfigService(new InMemoryServerRepository(), buildClient());
    const service = new ProductAnalyticsService(configService);

    try {
      expect(service.getStatus()).toMatchObject({ configured: true });
    } finally {
      await service.shutdown();
    }
  });

  it('logs a debug message when database-backed guild config is not cached', async () => {
    process.env.POSTHOG_PROJECT_API_KEY = 'ph_project_test';
    process.env.POSTHOG_DEBUG = 'true';
    const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    const configService = new ConfigService(new InMemoryServerRepository(), buildClient());
    const service = new ProductAnalyticsService(configService);

    try {
      await service.captureGuildEvent('guild-uncached', 'guild installed');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        '[posthog] skipping event; guild config not cached',
        {
          event: 'guild installed',
          guild_id_hash: expect.any(String),
        }
      );
    } finally {
      await service.shutdown();
      consoleDebugSpy.mockRestore();
    }
  });
});
