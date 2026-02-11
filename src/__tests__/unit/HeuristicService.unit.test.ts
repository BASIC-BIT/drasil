import { HeuristicService } from '../../services/HeuristicService';
import { HeuristicSettings, IConfigService } from '../../config/ConfigService';

type CachedConfigService = jest.Mocked<Pick<IConfigService, 'getCachedHeuristicSettings'>>;

const defaultHeuristicSettings: HeuristicSettings = {
  messageThreshold: 5,
  timeWindowMs: 10_000,
  suspiciousKeywords: ['free discord nitro'],
};

const buildConfigService = (
  overridesByGuild: Record<string, Partial<HeuristicSettings>> = {}
): CachedConfigService => ({
  getCachedHeuristicSettings: jest.fn().mockImplementation((guildId: string) => ({
    ...defaultHeuristicSettings,
    ...overridesByGuild[guildId],
  })),
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

  it('uses per-server message threshold and timeframe when provided by config cache', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': { messageThreshold: 2, timeWindowMs: 1000 },
      })
    );

    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(true);

    jest.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(false);
  });

  it('uses per-server suspicious keyword list when provided by config cache', () => {
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': { suspiciousKeywords: ['banana'] },
      })
    );

    expect(service.containsSuspiciousKeywords('I like BANANA bread', 'guild-1')).toBe(true);
    expect(service.containsSuspiciousKeywords('free discord nitro', 'guild-1')).toBe(false);
  });

  it('does not share frequency history across servers', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService(
      buildConfigService({
        'guild-1': { messageThreshold: 2, timeWindowMs: 10_000 },
        'guild-2': { messageThreshold: 2, timeWindowMs: 10_000 },
      })
    );

    service.isFrequencyAboveThreshold('user-1', 'guild-1');
    service.isFrequencyAboveThreshold('user-1', 'guild-1');
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-1')).toBe(true);

    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(false);
    expect(service.isFrequencyAboveThreshold('user-1', 'guild-2')).toBe(true);
  });
});
