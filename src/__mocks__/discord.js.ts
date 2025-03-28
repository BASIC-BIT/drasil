// Mock implementations for discord.js

// Mock BitField implementations
// class MockBitField {
//   bitfield: number;

//   constructor(bits: number | number[] = 0) {
//     this.bitfield = Array.isArray(bits) ? bits.reduce((acc, bit) => acc | bit, 0) : bits;
//   }

//   add(...bits: number[]): this {
//     this.bitfield |= bits.reduce((acc, bit) => acc | bit, 0);
//     return this;
//   }

//   remove(...bits: number[]): this {
//     this.bitfield &= ~bits.reduce((acc, bit) => acc | bit, 0);
//     return this;
//   }

//   has(bit: number): boolean {
//     return (this.bitfield & bit) === bit;
//   }
// }

// class MockIntentsBitField extends MockBitField {}

// Simple Collection implementation for mocks
class MockCollection<K, V> extends Map<K, V> {
  ensure(key: K, defaultValueGenerator: () => V): V {
    if (!this.has(key)) {
      this.set(key, defaultValueGenerator());
    }
    return this.get(key) as V;
  }

  hasAll(keys: K[]): boolean {
    return keys.every((key) => this.has(key));
  }

  hasAny(keys: K[]): boolean {
    return keys.some((key) => this.has(key));
  }

  first(): V | undefined {
    return this.values().next().value;
  }
}

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

// Export mock functions that return properly structured objects
const MockMessage = (options: any = {}) => ({
  content: options.content || '',
  author: {
    bot: options.isBot || false,
    id: options.userId || 'mock-user-id',
    username: options.username || 'mock-user',
  },
  member: options.isBot
    ? null
    : {
        id: options.userId || 'mock-user-id',
        user: {
          id: options.userId || 'mock-user-id',
          username: options.username || 'mock-user',
        },
      },
  reply: jest.fn().mockResolvedValue(undefined),
});

const MockGuild = (options: any = {}) => ({
  id: options.id || 'mock-guild-id',
  name: options.name || 'Mock Guild',
  channels: {
    cache: new Map(),
    create: jest.fn().mockResolvedValue({ id: 'new-channel-id' }),
  },
  roles: {
    cache: new Map(),
    everyone: {},
  },
  members: {
    cache: new Map(),
    fetch: jest.fn(),
  },
});

const MockGuildMember = (options: any = {}) => ({
  id: options.id || 'mock-user-id',
  user: {
    id: options.id || 'mock-user-id',
    username: options.username || 'mock-user',
    discriminator: options.discriminator || '1234',
    tag: `${options.username || 'mock-user'}#${options.discriminator || '1234'}`,
    bot: options.isBot || false,
  },
  roles: {
    cache: new Map(),
    add: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  },
  nickname: options.nickname,
  joinedAt: options.joinedAt || new Date(),
});

// Mock Client
class Client {
  guilds: any;
  user: any;
  on: jest.Mock;
  login: jest.Mock;
  destroy: jest.Mock;
  options: any;

  constructor() {
    this.guilds = {
      cache: new Map(),
      fetch: jest.fn(),
    };
    this.user = null;
    this.on = jest.fn().mockReturnThis();
    this.login = jest.fn().mockResolvedValue('token');
    this.destroy = jest.fn().mockResolvedValue(undefined);
    this.options = {
      intents: [],
    };
  }
}

// Export named exports to match discord.js structure
module.exports = {
  Client,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
    GuildMembers: 4,
  },
  Collection: MockCollection,
  SlashCommandBuilder: MockSlashCommandBuilder,
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: jest.fn().mockResolvedValue({}),
  })),
  Routes: {
    applicationCommands: jest.fn().mockReturnValue('mock-route'),
  },
  PermissionFlagsBits: {
    Administrator: 8,
  },
  // Export our mock functions
  MockMessage,
  MockGuild,
  MockGuildMember,
};
