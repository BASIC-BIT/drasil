import OpenAI from 'openai';
import { GPTService, type UserProfileData } from '../../services/GPTService';

describe('GPTService (unit)', () => {
  function makeProfile(overrides?: Partial<UserProfileData>): UserProfileData {
    return {
      username: 'test-user',
      accountCreatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      joinedServerAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      recentMessages: [],
      ...overrides,
    };
  }

  it('returns SUSPICIOUS when OpenAI response includes SUSPICIOUS', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'SUSPICIOUS' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const service = new GPTService(openai);

    const result = await service.analyzeProfile(makeProfile());

    expect(create).toHaveBeenCalled();
    expect(result.result).toBe('SUSPICIOUS');
    expect(result.confidence).toBe(0.8);
    expect(result.reasons).toEqual(['Suspicious user profile detected']);
  });

  it('returns OK when OpenAI response does not include SUSPICIOUS', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const service = new GPTService(openai);

    const result = await service.analyzeProfile(makeProfile());

    expect(result.result).toBe('OK');
    expect(result.confidence).toBe(0.2);
    expect(result.reasons).toEqual(['User profile appears normal']);
  });

  it('defaults to OK when OpenAI returns no choices', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [] });

    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const service = new GPTService(openai);

    const result = await service.analyzeProfile(makeProfile());

    expect(result.result).toBe('OK');
  });

  it('defaults to OK when OpenAI call throws', async () => {
    const create = jest.fn().mockRejectedValue(new Error('boom'));

    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const service = new GPTService(openai);

    const result = await service.analyzeProfile(makeProfile());

    expect(result.result).toBe('OK');
    expect(result.reasons).toEqual(['User profile appears normal']);
  });
});
