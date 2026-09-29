import { JevService } from '../../services/JevService';
import type { UserProfileData } from '../../services/GPTService';

describe('JevService', () => {
  const profile: UserProfileData = {
    username: 'member',
    accountCreatedAt: new Date('2026-09-01T00:00:00Z'),
    joinedServerAt: new Date('2026-09-20T00:00:00Z'),
    recentMessages: ['hello', 'claim your prize at example.test'],
  };
  const originalKey = process.env.TYPESAFE_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  it('returns a typed classification and selected reason from TypeSafe', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'jev-1.13.0',
        answers: {
          classification: {
            type: 'choice',
            choice: 'SUSPICIOUS',
            probabilities: { OK: 0.08, SUSPICIOUS: 0.92 },
          },
          primary_reason: { type: 'choice', choice: 'scam_link' },
        },
      }),
    } as Response);

    const result = await new JevService().analyzeProfile(profile);

    expect(result).toMatchObject({
      result: 'SUSPICIOUS',
      suspiciousProbability: 0.92,
      reasonCodes: ['scam_link'],
    });
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body)).state.recent_messages).toEqual(profile.recentMessages);
  });

  it('reports unavailable without a configured key', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const fetchMock = jest.spyOn(global, 'fetch');

    const result = await new JevService().analyzeProfile(profile);

    expect(result.result).toBe('UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unavailable when TypeSafe fails', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await new JevService().analyzeProfile(profile);

    expect(result.result).toBe('UNAVAILABLE');
  });
});
