import { HeuristicService } from '../../services/HeuristicService';
import { IConfigService } from '../../config/ConfigService';
import { Server, ServerSettings } from '../../repositories/types';

type CachedConfigService = jest.Mocked<Pick<IConfigService, 'getCachedServerConfig'>>;

const fixtureTimestamp = new Date('2024-01-01T00:00:00.000Z').toISOString();

const buildConfigService = (servers: Record<string, Server> = {}): CachedConfigService => ({
  getCachedServerConfig: jest.fn().mockImplementation((guildId: string) => servers[guildId]),
});

const buildServer = (guildId: string, settings: Partial<ServerSettings>): Server => ({
  guild_id: guildId,
  restricted_role_id: null,
  admin_channel_id: null,
  verification_channel_id: null,
  admin_notification_role_id: null,
  created_at: fixtureTimestamp,
  updated_at: fixtureTimestamp,
  updated_by: null,
  settings: { suspicious_keywords: null, ...settings },
  is_active: true,
});

describe('HeuristicService (unit)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flags when message frequency exceeds threshold', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(buildConfigService());
    const results: boolean[] = [];

    for (let i = 0; i < 6; i += 1) {
      results.push(service.isFrequencyAboveThreshold('user-1', 'guild-1'));
    }

    expect(results.slice(0, 5).every((value) => value === false)).toBe(true);
    expect(results[5]).toBe(true);
  });

  it('drops messages outside the time window', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(buildConfigService());

    for (let i = 0; i < 5; i += 1) {
      service.isFrequencyAboveThreshold('user-1', 'guild-1');
    }

    jest.setSystemTime(new Date('2024-01-01T00:00:11.000Z'));
    const isAboveThreshold = service.isFrequencyAboveThreshold('user-1', 'guild-1');

    expect(isAboveThreshold).toBe(false);
  });

  it('detects suspicious keywords', () => {
    const service = new HeuristicService(buildConfigService());
    const result = service.containsSuspiciousKeywords('Get FREE Discord Nitro now!', 'guild-1');
    expect(result).toBe(true);
  });

  it('returns suspicious with reasons when heuristics trigger', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(buildConfigService());

    for (let i = 0; i < 6; i += 1) {
      service.isFrequencyAboveThreshold('user-1', 'guild-1');
    }

    const analysis = service.analyzeMessage('user-1', 'free discord nitro', 'guild-1');

    expect(analysis.result).toBe('SUSPICIOUS');
    expect(analysis.reasons).toHaveLength(2);
  });

  it('uses per-server message threshold and timeframe when present in cached settings', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': buildServer('guild-1', { message_threshold: 2, message_timeframe: 1 }),
      })
    );

    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(true);

    jest.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
  });

  it('uses per-server suspicious keyword list when present in cached settings', () => {
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': buildServer('guild-1', { suspicious_keywords: ['banana'] }),
      })
    );

    expect(service.containsSuspiciousKeywords('I like BANANA bread', 'guild-1')).toBe(true);
    expect(service.containsSuspiciousKeywords('free discord nitro', 'guild-1')).toBe(false);
  });

  it('treats legacy default keyword list as "unset" and falls back to current defaults', () => {
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': buildServer('guild-1', {
          suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
        }),
      })
    );

    // "steam gift" is part of the expanded default list; this should remain detected
    // even if a server has the legacy 3-keyword list persisted.
    expect(service.containsSuspiciousKeywords('steam gift', 'guild-1')).toBe(true);
  });

  it('does not share frequency history across servers', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': buildServer('guild-1', { message_threshold: 2, message_timeframe: 10 }),
        'guild-2': buildServer('guild-2', { message_threshold: 2, message_timeframe: 10 }),
      })
    );

    service.isFrequencyAboveThreshold('user-1', 'guild-1');
    service.isFrequencyAboveThreshold('user-1', 'guild-1');
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(true);

    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(true);
  });

  it('falls back to defaults when message_threshold floors below 1', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const defaultService = new HeuristicService(buildConfigService());
    const configuredService = new HeuristicService(
      buildConfigService({
        'guild-1': buildServer('guild-1', { message_threshold: 0.5, message_timeframe: 10 }),
      })
    );

    const defaultResults: boolean[] = [];
    const configuredResults: boolean[] = [];

    for (let i = 0; i < 6; i += 1) {
      defaultResults.push(defaultService.isFrequencyAboveThreshold('user-1', 'guild-1'));
      configuredResults.push(configuredService.isFrequencyAboveThreshold('user-1', 'guild-1'));
    }

    expect(configuredResults).toEqual(defaultResults);
  });
});
