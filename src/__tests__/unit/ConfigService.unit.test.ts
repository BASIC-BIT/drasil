import { Client, Role, TextChannel } from 'discord.js';
import { ConfigService } from '../../config/ConfigService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';
import { globalConfig } from '../../config/GlobalConfig';
import { Server } from '../../repositories/types';

const buildClient = (channel?: TextChannel, role?: Role): Client =>
  ({
    channels: {
      fetch: jest.fn().mockResolvedValue(channel),
    },
    guilds: {
      fetch: jest.fn().mockResolvedValue({
        roles: {
          fetch: jest.fn().mockResolvedValue(role),
        },
      }),
    },
  }) as unknown as Client;

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

describe('ConfigService (unit)', () => {
  let originalDatabaseUrl: string | undefined;

  beforeEach(() => {
    originalDatabaseUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
  });

  it('caches server configs after the first fetch', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    const findSpy = jest.spyOn(serverRepository, 'findByGuildId');
    const upsertSpy = jest.spyOn(serverRepository, 'upsertByGuildId');

    await service.getServerConfig('guild-1');
    await service.getServerConfig('guild-1');

    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it('returns default config when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    const config = await service.getServerConfig('guild-2');

    expect(config.guild_id).toBe('guild-2');
    expect(config.heuristic_message_threshold).toBe(
      globalConfig.getSettings().defaultServerSettings.messageThreshold
    );
    expect(config.heuristic_suspicious_keywords.length).toBeGreaterThan(0);
  });

  it('returns default heuristic settings when guild is not cached', () => {
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    const settings = service.getCachedHeuristicSettings('guild-miss');
    const defaults = globalConfig.getSettings();

    expect(settings.messageThreshold).toBe(defaults.defaultServerSettings.messageThreshold);
    expect(settings.timeWindowMs).toBe(defaults.defaultServerSettings.messageTimeframe * 1000);
    expect(settings.suspiciousKeywords.length).toBeGreaterThan(0);
  });

  it('derives heuristic settings from cached typed heuristic columns', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-1', {
      heuristic_message_threshold: 2,
      heuristic_message_timeframe_seconds: 1,
      heuristic_suspicious_keywords: ['banana'],
    });

    await service.getServerConfig('guild-heur-1');
    const settings = service.getCachedHeuristicSettings('guild-heur-1');

    expect(settings.messageThreshold).toBe(2);
    expect(settings.timeWindowMs).toBe(1000);
    expect(settings.suspiciousKeywords).toEqual(['banana']);
  });

  it('falls back to defaults when cached heuristic columns are invalid', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-2', {
      heuristic_message_threshold: 10,
      heuristic_message_timeframe_seconds: 10,
      heuristic_suspicious_keywords: ['banana'],
    });

    await serverRepository.upsertByGuildId('guild-heur-2', {
      heuristic_message_threshold: 0,
      heuristic_message_timeframe_seconds: 999,
      heuristic_suspicious_keywords: null,
    } as unknown as Partial<Server>);

    await service.getServerConfig('guild-heur-2');
    const settings = service.getCachedHeuristicSettings('guild-heur-2');
    const defaults = globalConfig.getSettings();

    expect(settings.messageThreshold).toBe(defaults.defaultServerSettings.messageThreshold);
    expect(settings.timeWindowMs).toBe(defaults.defaultServerSettings.messageTimeframe * 1000);
  });

  it('updates heuristic settings with normalization and dedupe', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await service.getServerConfig('guild-heur-3');
    const updated = await service.updateHeuristicSettings('guild-heur-3', {
      messageThreshold: 8,
      timeframeSeconds: 20,
      suspiciousKeywords: ['  Banana  ', 'BANANA', 'steam gift'],
    });

    expect(updated.messageThreshold).toBe(8);
    expect(updated.timeWindowMs).toBe(20_000);
    expect(updated.suspiciousKeywords).toEqual(['banana', 'steam gift']);
  });

  it('rejects invalid heuristic updates', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await expect(
      service.updateHeuristicSettings('guild-heur-4', {
        messageThreshold: 0,
      })
    ).rejects.toThrow();
  });

  it('resets heuristic settings to defaults', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await service.updateHeuristicSettings('guild-heur-5', {
      messageThreshold: 8,
      timeframeSeconds: 20,
      suspiciousKeywords: ['banana'],
    });

    const reset = await service.resetHeuristicSettings('guild-heur-5');
    const defaults = globalConfig.getSettings();

    expect(reset.messageThreshold).toBe(defaults.defaultServerSettings.messageThreshold);
    expect(reset.timeWindowMs).toBe(defaults.defaultServerSettings.messageTimeframe * 1000);
    expect(reset.suspiciousKeywords).toEqual(defaults.defaultSuspiciousKeywords);
  });

  it('updates non-heuristic settings by merging with existing values', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-4', {
      settings: {
        min_confidence_threshold: 60,
        auto_restrict: true,
      },
      heuristic_message_threshold: 2,
    });

    const updated = await service.updateServerSettings('guild-4', {
      min_confidence_threshold: 80,
    });

    expect(updated.settings.auto_restrict).toBe(true);
    expect(updated.settings.min_confidence_threshold).toBe(80);
    expect(updated.heuristic_message_threshold).toBe(2);
  });

  it('fetches admin channel when configured', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const channel = { id: 'channel-1' } as TextChannel;
    const discordClient = buildClient(channel);
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-6', {
      admin_channel_id: 'channel-1',
    });

    const adminChannel = await service.getAdminChannel('guild-6');

    expect(adminChannel?.id).toBe('channel-1');
    expect(discordClient.channels.fetch).toHaveBeenCalledWith('channel-1');
  });

  it('returns restricted role when configured', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const role = { id: 'role-1' } as Role;
    const discordClient = buildClient(undefined, role);
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-7', {
      restricted_role_id: 'role-1',
    });

    const restrictedRole = await service.getRestrictedRole('guild-7');

    expect(restrictedRole?.id).toBe('role-1');
  });
});
