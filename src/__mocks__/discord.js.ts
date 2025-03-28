// Create mock classes
const MockCollection = jest.fn().mockImplementation(() => ({
  ensure: jest.fn(),
  hasAll: jest.fn(),
  hasAny: jest.fn(),
  first: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  has: jest.fn(),
  clear: jest.fn(),
}));

// Mock User
const MockUser = jest.fn().mockImplementation(({ bot, id, username, discriminator } = {}) => ({
  bot: bot || false,
  id: id || 'mock-user-id',
  username: username || 'mock-user',
  discriminator: discriminator || '1234',
  tag: `${username || 'mock-user'}#${discriminator || '1234'}`,
  toString: () => `<@${id || 'mock-user-id'}>`,
}));

// Mock GuildMember
const MockGuildMember = jest.fn().mockImplementation(({ id, username, discriminator } = {}) => ({
  id: id || '987654321',
  user: MockUser({ id, username, discriminator }),
  _roles: [],
  roles: {
    cache: MockCollection(),
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  },
  joinedAt: new Date(),
  nickname: null,
}));

// Mock Message
const MockMessage = jest.fn().mockImplementation(({ content, isBot, userId, username } = {}) => ({
  content: content || '',
  author: isBot === undefined ? undefined : {
    bot: isBot || false,
    id: userId || 'mock-user-id',
    username: username || 'mock-user',
  },
  member: (isBot === true) ? null : {
    id: userId || 'mock-user-id',
    user: {
      id: userId || 'mock-user-id',
      username: username || 'mock-user',
    },
  },
  reply: jest.fn().mockResolvedValue(undefined),
}));

// Mock Guild
const MockGuild = jest.fn().mockImplementation((id = '123456789', name = 'Test Guild') => ({
  id,
  name,
  channels: {
    cache: MockCollection(),
    create: jest.fn().mockResolvedValue({ id: 'new-channel-id' }),
  },
  roles: {
    cache: MockCollection(),
    everyone: {},
    highest: {},
  },
  members: {
    cache: MockCollection(),
    fetch: jest.fn(),
    add: jest.fn(),
    ban: jest.fn(),
  },
}));

// Mock Client
const MockClient = jest.fn().mockImplementation(() => ({
  guilds: {
    cache: new Map(),
    fetch: jest.fn(),
  },
  user: null,
  on: jest.fn().mockReturnThis(),
  login: jest.fn().mockResolvedValue('token'),
  destroy: jest.fn().mockResolvedValue(undefined),
  options: {
    intents: [],
  },
}));

// Mock SlashCommandBuilder
class MockSlashCommandBuilder {
  setName() { 
    return this;
  }
  setDescription() { 
    return this;
  }
  addUserOption(callback: (option: any) => any) {
    const option = {
      setName: () => option,
      setDescription: () => option,
      setRequired: () => option,
    };
    callback(option);
    return this;
  }
  addStringOption(callback: (option: any) => any) {
    const option = {
      setName: () => option,
      setDescription: () => option,
      setRequired: () => option,
    };
    callback(option);
    return this;
  }
  toJSON() { 
    return {};
  }
}

// Export all mocks
module.exports = {
  Client: MockClient,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
    GuildMembers: 4,
  },
  Message: MockMessage,
  SlashCommandBuilder: MockSlashCommandBuilder,
  Collection: MockCollection,
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: jest.fn().mockResolvedValue({}),
  })),
  Routes: {
    applicationCommands: jest.fn().mockReturnValue('/commands'),
  },
  PermissionFlagsBits: {
    Administrator: 8,
  },
  // Export mock classes for direct use in tests
  MockClient,
  MockMessage,
  MockGuild,
  MockGuildMember,
  MockCollection,
  MockUser,
};
