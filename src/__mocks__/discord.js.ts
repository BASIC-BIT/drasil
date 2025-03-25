'use strict';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const discordJs = jest.createMockFromModule('discord.js') as any;

// Mock for discord.js
const mockOn = jest.fn();
const mockLogin = jest.fn().mockResolvedValue(undefined);
const mockDestroy = jest.fn().mockResolvedValue(undefined);

// Create client instance with methods
const mockClientInstance = {
    on: mockOn,
    login: mockLogin,
    destroy: mockDestroy
};

// Client constructor that returns the mock instance
class MockClient {
    constructor() {
        return mockClientInstance;
    }
}

discordJs.Client = MockClient;
discordJs.GatewayIntentBits = {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
};
discordJs.Message = jest.fn().mockImplementation(() => ({
    author: { bot: false },
    content: '',
    reply: jest.fn().mockResolvedValue(undefined)
}));

// Export named exports to match discord.js structure
module.exports = discordJs;