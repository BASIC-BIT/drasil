import { Client, Role, TextChannel } from 'discord.js';
import { ConfigService } from '../../config/ConfigService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';
import { globalConfig } from '../../config/GlobalConfig';

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
    expect(config.settings.suspicious_keywords).toBeDefined();
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

  it('derives heuristic settings from cached server settings', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-1', {
      settings: {
        message_threshold: 2,
        message_timeframe: 1,
        suspicious_keywords: ['banana'],
      },
    });

    await service.getServerConfig('guild-heur-1');
    const settings = service.getCachedHeuristicSettings('guild-heur-1');

    expect(settings.messageThreshold).toBe(2);
    expect(settings.timeWindowMs).toBe(1000);
    expect(settings.suspiciousKeywords).toEqual(['banana']);
  });

  it('treats legacy default keyword list as unset and falls back to current defaults', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-2', {
      settings: {
        suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
      },
    });

    await service.getServerConfig('guild-heur-2');
    const settings = service.getCachedHeuristicSettings('guild-heur-2');

    expect(settings.suspiciousKeywords.length).toBeGreaterThan(3);
    expect(settings.suspiciousKeywords).toEqual(expect.arrayContaining(['steam gift']));
  });

  it('falls back to defaults when cached settings are invalid', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-3', {
      settings: {
        message_threshold: 0.5,
        suspicious_keywords: null,
      },
    });

    await service.getServerConfig('guild-heur-3');
    const settings = service.getCachedHeuristicSettings('guild-heur-3');

    expect(settings.messageThreshold).toBe(
      globalConfig.getSettings().defaultServerSettings.messageThreshold
    );
  });

  it('falls back to defaults when cached settings exceed safety bounds', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-heur-4', {
      settings: {
        message_threshold: 10_000,
        message_timeframe: 10_000,
        suspicious_keywords: null,
      },
    });

    await service.getServerConfig('guild-heur-4');
    const settings = service.getCachedHeuristicSettings('guild-heur-4');

    const defaults = globalConfig.getSettings();
    expect(settings.messageThreshold).toBe(defaults.defaultServerSettings.messageThreshold);
    expect(settings.timeWindowMs).toBe(defaults.defaultServerSettings.messageTimeframe * 1000);
  });

  it('fetches admin channel when configured', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const channel = { id: 'channel-1' } as TextChannel;
    const discordClient = buildClient(channel);
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-3', {
      admin_channel_id: 'channel-1',
    });

    const adminChannel = await service.getAdminChannel('guild-3');

    expect(adminChannel?.id).toBe('channel-1');
    expect(discordClient.channels.fetch).toHaveBeenCalledWith('channel-1');
  });

  it('updates settings by merging with existing values', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-4', {
      settings: {
        suspicious_keywords: ['abc'],
        message_threshold: 2,
      },
    });

    const updated = await service.updateServerSettings('guild-4', {
      message_threshold: 5,
    });

    expect(updated.settings.suspicious_keywords).toEqual(['abc']);
    expect(updated.settings.message_threshold).toBe(5);
  });

  it('returns restricted role when configured', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const role = { id: 'role-1' } as Role;
    const discordClient = buildClient(undefined, role);
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-5', {
      restricted_role_id: 'role-1',
    });

    const restrictedRole = await service.getRestrictedRole('guild-5');

    expect(restrictedRole?.id).toBe('role-1');
  });
});
