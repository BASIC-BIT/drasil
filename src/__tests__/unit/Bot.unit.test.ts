import { Bot } from '../../Bot';

describe('Bot (unit)', () => {
  const originalDiscordToken = process.env.DISCORD_TOKEN;

  afterEach(() => {
    if (originalDiscordToken === undefined) {
      delete process.env.DISCORD_TOKEN;
    } else {
      process.env.DISCORD_TOKEN = originalDiscordToken;
    }
  });

  it('registers event handlers before logging in', async () => {
    process.env.DISCORD_TOKEN = 'test-token';
    const client = {
      login: jest.fn().mockResolvedValue('logged-in'),
      destroy: jest.fn().mockResolvedValue(undefined),
    } as any;
    const eventHandler = {
      setupEventHandlers: jest.fn().mockResolvedValue(undefined),
    } as any;
    const moderationActionRequestService = {
      processPendingRequests: jest.fn().mockResolvedValue(0),
      start: jest.fn(),
      stop: jest.fn(),
    };
    const bot = new Bot(client, eventHandler, moderationActionRequestService);

    await bot.startBot();

    expect(eventHandler.setupEventHandlers).toHaveBeenCalledTimes(1);
    expect(client.login).toHaveBeenCalledWith('test-token');
    expect(moderationActionRequestService.start).toHaveBeenCalledTimes(1);
    expect(eventHandler.setupEventHandlers.mock.invocationCallOrder[0]).toBeLessThan(
      client.login.mock.invocationCallOrder[0]
    );
    expect(client.login.mock.invocationCallOrder[0]).toBeLessThan(
      moderationActionRequestService.start.mock.invocationCallOrder[0]
    );
  });
});
