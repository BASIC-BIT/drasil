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

  it('includes moderator-provided server context in the GPT prompt', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          server_about: 'A retro FPS speedrunning server.',
          verification_context: 'Real members usually mention Doom, Quake, or routing runs.',
          expected_topics: ['doom', 'quakeworld'],
        },
      }),
    } as any;
    const service = new GPTService(openai, configService);

    await service.analyzeProfile(
      makeProfile({
        serverId: 'guild-1',
        recentMessages: ['I like optimizing strafe routes'],
      })
    );

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(create).toHaveBeenCalled();

    const call = create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('treat it as ground truth');
    expect(call.messages[1].content).toContain('Moderator-provided server context:');
    expect(call.messages[1].content).toContain('A retro FPS speedrunning server.');
    expect(call.messages[1].content).toContain(
      'Real members usually mention Doom, Quake, or routing runs.'
    );
    expect(call.messages[1].content).toContain('doom, quakeworld');
  });
});
