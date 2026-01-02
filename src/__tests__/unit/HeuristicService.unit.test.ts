import { HeuristicService } from '../../services/HeuristicService';

describe('HeuristicService (unit)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flags when message frequency exceeds threshold', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService();
    const results: boolean[] = [];

    for (let i = 0; i < 6; i += 1) {
      results.push(service.isFrequencyAboveThreshold('user-1'));
    }

    expect(results.slice(0, 5).every((value) => value === false)).toBe(true);
    expect(results[5]).toBe(true);
  });

  it('drops messages outside the time window', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService();

    for (let i = 0; i < 5; i += 1) {
      service.isFrequencyAboveThreshold('user-1');
    }

    jest.setSystemTime(new Date('2024-01-01T00:00:11.000Z'));
    const isAboveThreshold = service.isFrequencyAboveThreshold('user-1');

    expect(isAboveThreshold).toBe(false);
  });

  it('detects suspicious keywords', () => {
    const service = new HeuristicService();
    const result = service.containsSuspiciousKeywords('Get FREE Discord Nitro now!');
    expect(result).toBe(true);
  });

  it('returns suspicious with reasons when heuristics trigger', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const service = new HeuristicService();

    for (let i = 0; i < 6; i += 1) {
      service.isFrequencyAboveThreshold('user-1');
    }

    const analysis = service.analyzeMessage('user-1', 'free discord nitro');

    expect(analysis.result).toBe('SUSPICIOUS');
    expect(analysis.reasons.length).toBe(2);
  });
});
