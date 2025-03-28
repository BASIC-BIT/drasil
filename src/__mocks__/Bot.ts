export class Bot {
  private client: any;
  private detectionOrchestrator: any;
  private configService: any;
  
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
    
    this.configService = {
      getServerConfig: jest.fn().mockResolvedValue({}),
      updateServerConfig: jest.fn().mockResolvedValue({}),
      initialize: jest.fn().mockResolvedValue(undefined),
    };
    
    // Set up message handler
    this.handleMessage = jest.fn().mockImplementation(async (message) => {
      // Safely access properties with null checks
      const content = message?.content;
      const isBot = message?.author?.bot;
      
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
            message.author.id || '',
            content || '',
            { username: message.author?.username || 'unknown' }
          );
        }
      } catch (error) {
        // Make sure the error is logged
        console.error('Failed to process message', error || new Error('Unknown error'));
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
  private handleMessage: jest.Mock;
  private messageHandler: Function | null = null;
}