import { Client, Role, TextChannel } from 'discord.js';
import { ConfigService } from '../../config/ConfigService';
import { InMemoryServerRepository } from '../fakes/inMemoryRepositories';
import { globalConfig } from '../../config/GlobalConfig';
import { Server } from '../../repositories/types';
import { getDetectionResponseSettings } from '../../utils/detectionResponseSettings';
import { getReportAiSettings } from '../../utils/reportAiSettings';
import { getVerificationThreadAnalysisSettings } from '../../utils/verificationThreadAnalysisSettings';

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
    jest.restoreAllMocks();
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
    expect(getDetectionResponseSettings(config.settings).mode).toBe('notify_only');
    expect(getDetectionResponseSettings(config.settings).moderatorBanActionEnabled).toBe(true);
    expect(getReportAiSettings(config.settings).enabled).toBe(true);
    expect(getVerificationThreadAnalysisSettings(config.settings).enabled).toBe(true);
  });

  it('retains cached configuration on a forced read when no database is configured', async () => {
    delete process.env.DATABASE_URL;
    const service = new ConfigService(new InMemoryServerRepository(), buildClient());
    await service.updateServerConfig('guild-cache-source', {
      admin_channel_id: 'admin-channel-1',
      settings: { detection_response_mode: 'record_only' },
    });

    await expect(
      service.getServerConfig('guild-cache-source', {
        failOnReadError: true,
        forceRefresh: true,
      })
    ).resolves.toMatchObject({
      admin_channel_id: 'admin-channel-1',
      settings: { detection_response_mode: 'record_only' },
    });
  });

  it('propagates repository read failures when a confirmed read is required', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(serverRepository, 'findByGuildId')
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.getServerConfig('guild-strict-read', { failOnReadError: true })
    ).rejects.toThrow('database unavailable');
  });

  it('forces a fresh repository read even when the cache is still current', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());

    await serverRepository.upsertByGuildId('guild-fresh-read', {
      admin_notification_role_id: 'old-admin-role',
    });
    await service.getServerConfig('guild-fresh-read');
    await serverRepository.upsertByGuildId('guild-fresh-read', {
      admin_notification_role_id: 'new-admin-role',
    });

    await expect(
      service.getServerConfig('guild-fresh-read', { forceRefresh: true })
    ).resolves.toMatchObject({ admin_notification_role_id: 'new-admin-role' });
  });

  it('does not fall back to cached state when a confirmed fresh read fails', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await service.getServerConfig('guild-fresh-read-failure');
    jest
      .spyOn(serverRepository, 'findByGuildId')
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      service.getServerConfig('guild-fresh-read-failure', {
        failOnReadError: true,
        forceRefresh: true,
      })
    ).rejects.toThrow('database unavailable');
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

  it('normalizes existing keywords when updating only threshold/timeframe', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await service.updateServerConfig('guild-heur-4b', {
      heuristic_suspicious_keywords: [' Banana ', 'banana', 'STEAM GIFT'],
    });

    const updated = await service.updateHeuristicSettings('guild-heur-4b', {
      messageThreshold: 7,
    });

    expect(updated.messageThreshold).toBe(7);
    expect(updated.suspiciousKeywords).toEqual(['banana', 'steam gift']);

    const persisted = await service.getServerConfig('guild-heur-4b');
    expect(persisted.heuristic_suspicious_keywords).toEqual(['banana', 'steam gift']);
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
        detection_response_mode: 'notify_only',
      },
      heuristic_message_threshold: 2,
    });

    const updated = await service.updateServerSettings('guild-4', {
      min_confidence_threshold: 80,
    });

    expect(updated.settings.detection_response_mode).toBe('notify_only');
    expect(updated.settings.min_confidence_threshold).toBe(80);
    expect(updated.heuristic_message_threshold).toBe(2);
  });

  it('atomically merges settings against repository state instead of a fresh cache entry', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());

    await serverRepository.upsertByGuildId('guild-settings-merge', {
      settings: {
        report_ai_triage_enabled: true,
        report_instructions_channel_id: 'report-channel-1',
        report_instructions_message_id: 'report-message-1',
      },
    });
    await service.getServerConfig('guild-settings-merge');
    await serverRepository.updateSettings('guild-settings-merge', {
      report_ai_triage_enabled: false,
      report_ai_max_action: 'hints',
    });

    const updated = await service.updateServerSettings('guild-settings-merge', {
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
    });

    expect(updated.settings).toMatchObject({
      report_ai_triage_enabled: false,
      report_ai_max_action: 'hints',
      report_instructions_channel_id: null,
      report_instructions_message_id: null,
    });
  });

  it('forces a confirmed read when a cached default has no database row', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());
    const originalFind = serverRepository.findByGuildId.bind(serverRepository);
    const findSpy = jest
      .spyOn(serverRepository, 'findByGuildId')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockImplementation(originalFind);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.getServerConfig('guild-recovered-write')).resolves.toMatchObject({
      guild_id: 'guild-recovered-write',
    });
    await expect(
      service.updateServerSettings('guild-recovered-write', {
        setup_nudge_last_result: 'sent',
      })
    ).resolves.toMatchObject({
      settings: { setup_nudge_last_result: 'sent' },
    });

    expect(findSpy).toHaveBeenCalledTimes(3);
    await expect(serverRepository.findByGuildId('guild-recovered-write')).resolves.toMatchObject({
      settings: { setup_nudge_last_result: 'sent' },
    });
  });

  it('refreshes stale cached server configs so web-updated settings propagate', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    await serverRepository.upsertByGuildId('guild-web-settings', {
      settings: { detection_response_mode: 'notify_only' },
    });

    const initial = await service.getServerConfig('guild-web-settings');
    expect(initial.settings.detection_response_mode).toBe('notify_only');

    await serverRepository.updateSettings('guild-web-settings', {
      detection_response_mode: 'restrict',
    });
    expect(
      (await service.getServerConfig('guild-web-settings')).settings.detection_response_mode
    ).toBe('notify_only');

    nowSpy.mockReturnValue(32_000);
    expect(
      (await service.getServerConfig('guild-web-settings')).settings.detection_response_mode
    ).toBe('restrict');
  });

  it('merges setup keys against repository state instead of stale cached settings', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const service = new ConfigService(serverRepository, buildClient());

    await serverRepository.upsertByGuildId('guild-setup', {
      settings: { report_ai_triage_enabled: true },
    });
    await service.getServerConfig('guild-setup');
    await serverRepository.updateSettings('guild-setup', {
      report_ai_triage_enabled: false,
      report_ai_max_action: 'hints',
    });
    await serverRepository.setActive('guild-setup', false);

    const updated = await service.updateSetupConfiguration('guild-setup', {
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
      verificationChannelId: 'verification-channel-1',
      settingsPatch: {
        detection_response_mode: 'notify_only',
        message_detection_response_mode: null,
        join_detection_response_mode: null,
      },
    });

    expect(updated.settings).toMatchObject({
      detection_response_mode: 'notify_only',
      report_ai_triage_enabled: false,
      report_ai_max_action: 'hints',
    });
    expect(updated.is_active).toBe(true);
  });

  it('does not persist per-event detection overrides in default server settings', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const discordClient = buildClient();
    const service = new ConfigService(serverRepository, discordClient);

    await service.getServerConfig('guild-detection-defaults');
    const updated = await service.updateServerSettings('guild-detection-defaults', {
      detection_response_mode: 'notify_only',
    });

    expect(updated.settings.message_detection_response_mode).toBeUndefined();
    expect(updated.settings.join_detection_response_mode).toBeUndefined();
    expect(getDetectionResponseSettings(updated.settings, 'message').mode).toBe('notify_only');
    expect(getDetectionResponseSettings(updated.settings, 'join').mode).toBe('notify_only');
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

  it('returns case role when configured', async () => {
    process.env.DATABASE_URL = 'in-memory';
    const serverRepository = new InMemoryServerRepository();
    const role = { id: 'role-1' } as Role;
    const discordClient = buildClient(undefined, role);
    const service = new ConfigService(serverRepository, discordClient);

    await serverRepository.upsertByGuildId('guild-7', {
      case_role_id: 'role-1',
    });

    const caseRole = await service.getCaseRole('guild-7');

    expect(caseRole?.id).toBe('role-1');
  });
});
