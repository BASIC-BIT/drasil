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
    const bot = new Bot(client, eventHandler);

    await bot.startBot();

    expect(eventHandler.setupEventHandlers).toHaveBeenCalledTimes(1);
    expect(client.login).toHaveBeenCalledWith('test-token');
    expect(eventHandler.setupEventHandlers.mock.invocationCallOrder[0]).toBeLessThan(
      client.login.mock.invocationCallOrder[0]
    );
  });
});
