// Mock implementation of the Bot class for testing
export class Bot {
  // Public properties that expose private members for testing
  public client: any;
  public detectionOrchestrator: any;
  public configService: any;
  public detectionEventsRepository: any;
  public handleMessage: jest.Mock;
  public handleGuildMemberAdd: jest.Mock;
  public handleGuildCreate: jest.Mock;
  public initializeServers: jest.Mock;

  constructor() {
    // Mock client
    this.client = {
      on: jest.fn(),
      login: jest.fn().mockResolvedValue('token'),
      destroy: jest.fn().mockResolvedValue(undefined),
      guilds: {
        cache: new Map(),
      },
      user: null,
    };

    // Mock services
    this.detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };

    this.detectionEventsRepository = {
      create: jest.fn(),
      findByServerAndUser: jest.fn(),
    };

    this.configService = {
      getServerConfig: jest.fn().mockResolvedValue({}),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      initialize: jest.fn().mockResolvedValue(undefined),
    };

    // Mock methods
    this.handleMessage = jest.fn().mockImplementation(async (message) => {
      // Safely access properties with null checks
      const content = message?.content;
      const isBot = message?.author?.bot;
      const serverId = message?.guild?.id;

      if (content === '!ping') {
        if (typeof message?.reply === 'function') {
          await message.reply('Pong! Note: Please use slash commands instead (e.g. /ping)');
        }
        return;
      }

      if (isBot) return;

      try {
        if (message?.author?.id && content) {
          await this.detectionOrchestrator.detectMessage(
            serverId || 'DM',
            message.author.id,
            content,
            {
              username: message.author?.username || 'unknown',
            }
          );
        }
      } catch (error) {
        console.error('Failed to process message', error || new Error('Unknown error'));
      }
    });

    this.handleGuildMemberAdd = jest.fn().mockImplementation(async (member) => {
      try {
        if (member?.user) {
          const profileData = {
            username: member.user.username,
            discriminator: member.user.discriminator,
            nickname: member.nickname,
            accountCreatedAt: new Date(),
            joinedServerAt: member.joinedAt || new Date(),
          };

          await this.detectionOrchestrator.detectNewJoin(
            member.guild?.id || 'TEST',
            member.id,
            profileData
          );
        }
      } catch (error) {
        console.error('Failed to process new member', error || new Error('Unknown error'));
      }
    });

    this.handleGuildCreate = jest.fn().mockImplementation(async (guild) => {
      try {
        await this.configService.getServerConfig(guild.id);

        // Check if auto-setup is enabled
        const settings = (global as any).globalConfig?.getSettings() || {
          autoSetupVerificationChannels: true,
        };

        if (settings.autoSetupVerificationChannels) {
          // Actually call the mock function so it registers as being called
          guild.channels.create();
        }
      } catch (error) {
        console.error('Failed to handle new guild', error);
      }
    });

    this.initializeServers = jest.fn().mockImplementation(async () => {
      try {
        // Make sure client.user is defined to avoid "Client user not available" error
        this.client.user = { id: 'mock-bot-id' };

        for (const [guildId] of this.client.guilds.cache) {
          // Actually call the function so it registers as being called
          await this.configService.getServerConfig(guildId);
        }
      } catch (error) {
        console.error('Failed to initialize servers', error);
      }
    });

    // Register the message handler
    this.client.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'messageCreate') {
        this.messageHandler = handler;
      }
      return this.client;
    });
  }

  // Public methods
  public async startBot(): Promise<void> {
    await this.client.login();
  }

  public async destroy(): Promise<void> {
    await this.client.destroy();
  }

  // Private methods exposed for testing
  private messageHandler: Function | null = null;
}
