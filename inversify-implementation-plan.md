# InversifyJS Implementation Plan

## Todo Checklist

- [x] 1. Install dependencies (inversify, reflect-metadata)
- [x] 2. Configure TypeScript for decorators in tsconfig.json
- [x] 3. Create DI directory structure
- [x] 4. Define DI symbols for binding
- [ ] 5. ~~Create service interfaces~~ Co-locate interfaces with implementations
  - [x] a. Update HeuristicService with IHeuristicService interface
  - [ ] b. Update GPTService with IGPTService interface
  - [ ] c. Update DetectionOrchestrator with IDetectionOrchestrator interface
  - [ ] d. Update ConfigService with IConfigService interface
  - [ ] e. Update RoleManager with IRoleManager interface
  - [ ] f. Update NotificationManager with INotificationManager interface
- [ ] 6. ~~Create repository interfaces~~ Use existing types and add interfaces to repositories
  - [x] a. Update BaseRepository with IBaseRepository interface
  - [x] b. Update SupabaseRepository with injection
  - [ ] c. Update ServerRepository with IServerRepository interface (use Server from types.ts)
  - [ ] d. Update UserRepository with IUserRepository interface (use User from types.ts)
  - [ ] e. Update ServerMemberRepository with IServerMemberRepository interface (use ServerMember from types.ts)
  - [ ] f. Update DetectionEventsRepository with IDetectionEventsRepository interface (use DetectionEvent from types.ts)
- [x] 7. Set up IoC container configuration
- [x] 8. Update entry point to use Inversify (created example)
- [ ] 9. Refactor Bot class to use dependency injection
- [ ] 10. Add @injectable to service implementations
- [ ] 11. Add @injectable to repository implementations
- [x] 12. Create test configurations with mocks (created example)
- [ ] 13. Update documentation

## Next Steps

1. Continue refactoring the remaining services to use InversifyJS:

   - GPTService
   - DetectionOrchestrator
   - ConfigService
   - RoleManager
   - NotificationManager

2. Refactor repositories to use InversifyJS:

   - ServerRepository
   - UserRepository
   - ServerMemberRepository
   - DetectionEventsRepository

3. Update the Bot class to use dependency injection

4. Update existing tests to use the test container

5. Complete the container configuration with all service bindings

## Progress Made

We've successfully:

- Set up the InversifyJS dependency injection framework
- Created the DI directory structure and symbols
- Implemented the container configuration
- Refactored HeuristicService to use DI
- Updated BaseRepository and SupabaseRepository to use DI
- Created a test container configuration for easier testing
- Created an entry point example that uses DI

## Revised Approach

We're following the co-location approach, placing interfaces directly in the implementation files for better maintainability. We're also using the existing database types from `repositories/types.ts` rather than creating duplicate definitions.

## Container Configuration

```typescript
// src/di/container.ts
import { Container } from 'inversify';
import { TYPES } from './symbols';

// Import services and repositories
import { HeuristicService, IHeuristicService } from '../services/HeuristicService';
import { GPTService, IGPTService } from '../services/GPTService';
// other imports...

export function configureContainer(): Container {
  const container = new Container();

  // Bind services
  container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();
  // other bindings...

  return container;
}
```

## Example Implementation

### Example: HeuristicService

```typescript
// src/services/HeuristicService.ts
import { injectable } from 'inversify';
import { HeuristicResult } from '../di/types';

export interface IHeuristicService {
  analyzeMessage(userId: string, content: string, serverId: string): HeuristicResult;
  cleanupMessageHistory(): void;
}

@injectable()
export class HeuristicService implements IHeuristicService {
  private messageHistory: Map<string, { timestamp: number; content: string }[]>;
  private readonly MESSAGE_HISTORY_WINDOW_MS = 10000; // 10 seconds
  private readonly MAX_MESSAGES_IN_WINDOW = 5;

  constructor() {
    this.messageHistory = new Map();
    setInterval(this.cleanupMessageHistory.bind(this), 60000);
  }

  public analyzeMessage(userId: string, content: string, serverId: string): HeuristicResult {
    // Implementation...
    return { result: 'OK', reasons: [] };
  }

  public cleanupMessageHistory(): void {
    // Implementation...
  }
}
```

### Example: ServerRepository

```typescript
// src/repositories/ServerRepository.ts
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { SupabaseClient } from '@supabase/supabase-js';
import { Server } from './types';

export interface IServerRepository {
  findByGuildId(guildId: string): Promise<Server | null>;
  upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server>;
  // other methods...
}

@injectable()
export class ServerRepository implements IServerRepository {
  constructor(@inject(TYPES.SupabaseClient) private supabaseClient: SupabaseClient) {}

  // Implementations...
}
```

## 1. Setup Project Dependencies

```bash
npm install inversify reflect-metadata --save --legacy-peer-deps
```

## 2. Core Architecture Components

### Directory Structure Update

```
src/
├── config/
├── di/                  # New directory for DI configuration
│   ├── container.ts     # InversifyJS container setup
│   ├── interfaces/      # Service interfaces
│   ├── symbols.ts       # DI binding symbols
│   └── types.ts         # Type definitions
├── repositories/
├── services/
├── controllers/         # New directory for controllers
├── Bot.ts               # Will be refactored to use DI
└── index.ts             # Entry point with container initialization
```

## 3. Configure TypeScript for Decorators

Update `tsconfig.json` to include:

```json
{
  "compilerOptions": {
    // existing options...
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## 4. Create DI Symbols

```typescript
// src/di/symbols.ts
export const TYPES = {
  // Core classes
  Bot: Symbol.for('Bot'),

  // Services
  HeuristicService: Symbol.for('HeuristicService'),
  GPTService: Symbol.for('GPTService'),
  DetectionOrchestrator: Symbol.for('DetectionOrchestrator'),
  RoleManager: Symbol.for('RoleManager'),
  NotificationManager: Symbol.for('NotificationManager'),
  ConfigService: Symbol.for('ConfigService'),

  // Repositories
  BaseRepository: Symbol.for('BaseRepository'),
  SupabaseRepository: Symbol.for('SupabaseRepository'),
  ServerRepository: Symbol.for('ServerRepository'),
  UserRepository: Symbol.for('UserRepository'),
  ServerMemberRepository: Symbol.for('ServerMemberRepository'),
  DetectionEventsRepository: Symbol.for('DetectionEventsRepository'),

  // External dependencies
  DiscordClient: Symbol.for('DiscordClient'),
  OpenAI: Symbol.for('OpenAI'),
  SupabaseClient: Symbol.for('SupabaseClient'),

  // Configuration
  GlobalConfig: Symbol.for('GlobalConfig'),
};
```

## 5. Service Interfaces

### IHeuristicService

```typescript
// src/di/interfaces/IHeuristicService.ts
export interface IHeuristicService {
  /**
   * Analyzes a message for suspicious patterns using rule-based heuristics
   * @param userId The Discord user ID
   * @param content The message content to analyze
   * @param serverId The server ID where the message was sent
   * @returns Object with result and reasons
   */
  analyzeMessage(
    userId: string,
    content: string,
    serverId: string
  ): {
    result: 'OK' | 'SUSPICIOUS';
    reasons: string[];
  };

  /**
   * Cleans up old message history entries
   */
  cleanupMessageHistory(): void;
}
```

### IGPTService

```typescript
// src/di/interfaces/IGPTService.ts
export interface IGPTService {
  /**
   * Analyzes a user profile to determine if they are suspicious
   * @param userProfile Object containing user information
   * @returns Object with result, confidence and reasons
   */
  analyzeProfile(userProfile: {
    userId: string;
    username: string;
    accountAge?: number;
    joinedServer?: Date;
    messageHistory?: string[];
    avatarUrl?: string;
    isBot?: boolean;
  }): Promise<{
    result: 'OK' | 'SUSPICIOUS';
    confidence: number;
    reasons: string[];
  }>;
}
```

### IDetectionOrchestrator

```typescript
// src/di/interfaces/IDetectionOrchestrator.ts
export interface IDetectionOrchestrator {
  /**
   * Detects if a message is suspicious
   * @param userId The Discord user ID
   * @param content The message content
   * @param userInfo Additional user information
   * @param serverId The server ID
   * @returns Detection result with label, confidence, reasons and metadata
   */
  detectMessage(
    userId: string,
    content: string,
    userInfo: {
      username: string;
      accountAge?: number;
      joinedServer?: Date;
      avatarUrl?: string;
      isBot?: boolean;
    },
    serverId: string
  ): Promise<{
    label: 'OK' | 'SUSPICIOUS';
    confidence: number;
    confidenceLevel: 'Low' | 'Medium' | 'High';
    reasons: string[];
    usedGPT: boolean;
    triggerSource: 'message';
    triggerContent: string;
  }>;

  /**
   * Detects if a new server join is suspicious
   * @param userId The Discord user ID
   * @param userInfo User profile information
   * @param serverId The server ID
   * @returns Detection result with label, confidence, reasons and metadata
   */
  detectNewJoin(
    userId: string,
    userInfo: {
      username: string;
      accountAge?: number;
      joinedServer?: Date;
      avatarUrl?: string;
      isBot?: boolean;
    },
    serverId: string
  ): Promise<{
    label: 'OK' | 'SUSPICIOUS';
    confidence: number;
    confidenceLevel: 'Low' | 'Medium' | 'High';
    reasons: string[];
    usedGPT: boolean;
    triggerSource: 'join';
    triggerContent: null;
  }>;
}
```

### IConfigService

```typescript
// src/di/interfaces/IConfigService.ts
export interface ServerSettings {
  restrictedRoleId?: string;
  adminChannelId?: string;
  verificationChannelId?: string;
  adminNotificationRoleId?: string;
  isActive?: boolean;
  settings?: Record<string, any>;
}

export interface IConfigService {
  /**
   * Get configuration for a specific server
   * @param guildId Discord guild/server ID
   * @returns Server configuration object
   */
  getServerConfig(guildId: string): Promise<ServerSettings>;

  /**
   * Update configuration for a specific server
   * @param guildId Discord guild/server ID
   * @param settings Settings to update
   * @returns Updated server configuration
   */
  updateServerConfig(guildId: string, settings: Partial<ServerSettings>): Promise<ServerSettings>;

  /**
   * Initialize server configuration on bot startup
   * @param guildIds Array of guild IDs to initialize
   */
  initServerConfigs(guildIds: string[]): Promise<void>;

  /**
   * Clear server configuration cache
   */
  clearCache(): void;
}
```

### IBaseRepository

```typescript
// src/di/interfaces/IBaseRepository.ts
export interface IBaseRepository<T> {
  /**
   * Find an entity by its ID
   * @param id Entity ID
   * @returns Entity or null if not found
   */
  findById(id: string): Promise<T | null>;

  /**
   * Find multiple entities with optional filters
   * @param filters Optional filters to apply
   * @returns Array of entities
   */
  findMany(filters?: Record<string, any>): Promise<T[]>;

  /**
   * Create a new entity
   * @param data Entity data
   * @returns Created entity
   */
  create(data: Partial<T>): Promise<T>;

  /**
   * Update an existing entity
   * @param id Entity ID
   * @param data Data to update
   * @returns Updated entity
   */
  update(id: string, data: Partial<T>): Promise<T>;

  /**
   * Delete an entity
   * @param id Entity ID
   * @returns Success indicator
   */
  delete(id: string): Promise<boolean>;

  /**
   * Count entities with optional filters
   * @param filters Optional filters to apply
   * @returns Count of matching entities
   */
  count(filters?: Record<string, any>): Promise<number>;
}
```

## 6. Common Type Definitions

```typescript
// src/di/types.ts
export type DetectionResult = {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  confidenceLevel: 'Low' | 'Medium' | 'High';
  reasons: string[];
  usedGPT: boolean;
  triggerSource: 'message' | 'join';
  triggerContent: string | null;
};

export type UserProfile = {
  userId: string;
  username: string;
  accountAge?: number;
  joinedServer?: Date;
  messageHistory?: string[];
  avatarUrl?: string;
  isBot?: boolean;
};

export type HeuristicResult = {
  result: 'OK' | 'SUSPICIOUS';
  reasons: string[];
};

export type GPTResult = {
  result: 'OK' | 'SUSPICIOUS';
  confidence: number;
  reasons: string[];
};
```

## 7. IoC Container Configuration

```typescript
// src/di/container.ts
import 'reflect-metadata';
import { Container } from 'inversify';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { TYPES } from './symbols';

// Interfaces
import { IHeuristicService } from './interfaces/IHeuristicService';
import { IGPTService } from './interfaces/IGPTService';
import { IDetectionOrchestrator } from './interfaces/IDetectionOrchestrator';
import { IConfigService } from './interfaces/IConfigService';
import { IBaseRepository } from './interfaces/IBaseRepository';
import { IServerRepository } from './interfaces/IServerRepository';
import { IUserRepository } from './interfaces/IUserRepository';
import { IServerMemberRepository } from './interfaces/IServerMemberRepository';
import { IDetectionEventsRepository } from './interfaces/IDetectionEventsRepository';
import { IRoleManager } from './interfaces/IRoleManager';
import { INotificationManager } from './interfaces/INotificationManager';

// Implementations (will be imported as they are refactored)
// import { HeuristicService } from '../services/HeuristicService';
// etc.

const container = new Container();

// Configure container bindings
export function configureContainer(): Container {
  // External dependencies
  configureExternalDependencies();

  // Repositories
  configureRepositories();

  // Services
  configureServices();

  return container;
}

function configureExternalDependencies(): void {
  // Discord client
  container.bind<Client>(TYPES.DiscordClient).toConstantValue(
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    })
  );

  // OpenAI client
  container.bind<OpenAI>(TYPES.OpenAI).toConstantValue(
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    })
  );

  // Supabase client
  container.bind<SupabaseClient>(TYPES.SupabaseClient).toConstantValue(
    createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '', {
      auth: {
        persistSession: false,
      },
    })
  );
}

function configureRepositories(): void {
  // Bind repositories once implemented
  // container.bind<IServerRepository>(TYPES.ServerRepository).to(ServerRepository).inSingletonScope();
  // container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();
  // etc.
}

function configureServices(): void {
  // Bind services once implemented
  // container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();
  // container.bind<IGPTService>(TYPES.GPTService).to(GPTService).inSingletonScope();
  // etc.
}

export { container };
```

## 8. Entry Point with InversifyJS

```typescript
// src/index.ts
import 'reflect-metadata';
import dotenv from 'dotenv';
import { GatewayIntentBits } from 'discord.js';
import { container, configureContainer } from './di/container';
import { TYPES } from './di/symbols';
import { Bot } from './Bot';

// Load environment variables
dotenv.config();

async function bootstrap(): Promise<void> {
  try {
    // Configure Discord client with required intents
    const discordClient = container.get(TYPES.DiscordClient);
    discordClient.options.intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ];

    // Configure container and bind all dependencies
    configureContainer();

    // Get bot instance from container
    const bot = container.get<Bot>(TYPES.Bot);

    // Start the bot
    await bot.start();

    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      await bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      await bot.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the application
bootstrap().catch((error) => {
  console.error('Unhandled error during bootstrap:', error);
  process.exit(1);
});
```

## 9. Bot Class Refactoring

```typescript
// src/Bot.ts
import { injectable, inject } from 'inversify';
import { Client, ApplicationCommandDataResolvable } from 'discord.js';
import { TYPES } from './di/symbols';
import { IDetectionOrchestrator } from './di/interfaces/IDetectionOrchestrator';
import { IConfigService } from './di/interfaces/IConfigService';
import { IRoleManager } from './di/interfaces/IRoleManager';
import { INotificationManager } from './di/interfaces/INotificationManager';

@injectable()
export class Bot {
  private client: Client;
  private commands: ApplicationCommandDataResolvable[] = [];

  constructor(
    @inject(TYPES.DiscordClient) private discordClient: Client,
    @inject(TYPES.DetectionOrchestrator) private detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.ConfigService) private configService: IConfigService,
    @inject(TYPES.RoleManager) private roleManager: IRoleManager,
    @inject(TYPES.NotificationManager) private notificationManager: INotificationManager
  ) {
    this.client = discordClient;

    // Set up event handlers
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('guildCreate', this.handleGuildCreate.bind(this));

    // Initialize commands
    this.initializeCommands();
  }

  // Rest of the Bot implementation

  public async start(): Promise<void> {
    // Implementation...
  }

  public async stop(): Promise<void> {
    // Implementation...
  }

  // Other methods...
}
```

## 10. Sample Service Implementation

```typitten
// src/services/HeuristicService.ts
import { injectable } from 'inversify';
import { IHeuristicService } from '../di/interfaces/IHeuristicService';
import { HeuristicResult } from '../di/types';

@injectable()
export class HeuristicService implements IHeuristicService {
  private messageHistory: Map<string, { timestamp: number; content: string }[]>;
  private readonly MESSAGE_HISTORY_WINDOW_MS = 10000; // 10 seconds
  private readonly MAX_MESSAGES_IN_WINDOW = 5;
  private readonly SUSPICIOUS_KEYWORDS = [
    'free discord nitro',
    'nitro for free',
    'free nitro',
    'steam gift',
    'steamgift',
    // ... other keywords
  ];

  constructor() {
    this.messageHistory = new Map();
    // Run message history cleanup every minute
    setInterval(this.cleanupMessageHistory.bind(this), 60000);
  }

  public analyzeMessage(userId: string, content: string, serverId: string): HeuristicResult {
    // Implementation...
  }

  public cleanupMessageHistory(): void {
    // Implementation...
  }
}
```

## 11. Sample Repository Implementation

```typescript
// src/repositories/ServerRepository.ts
import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { TYPES } from '../di/symbols';
import { IServerRepository } from '../di/interfaces/IServerRepository';
import { Server } from './types';

@injectable()
export class ServerRepository implements IServerRepository {
  constructor(@inject(TYPES.SupabaseClient) private supabaseClient: SupabaseClient) {}

  // Implementation methods...
}
```

## 12. Testing Strategy with DI

### Unit Test Setup

```typescript
// src/__tests__/services/DetectionOrchestrator.test.ts
import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from '../../di/symbols';
import { IDetectionOrchestrator } from '../../di/interfaces/IDetectionOrchestrator';
import { IHeuristicService } from '../../di/interfaces/IHeuristicService';
import { IGPTService } from '../../di/interfaces/IGPTService';
import { DetectionOrchestrator } from '../../services/DetectionOrchestrator';

describe('DetectionOrchestrator', () => {
  let orchestrator: IDetectionOrchestrator;
  let mockHeuristicService: IHeuristicService;
  let mockGPTService: IGPTService;

  beforeEach(() => {
    // Set up mocks
    mockHeuristicService = {
      analyzeMessage: jest.fn(),
      cleanupMessageHistory: jest.fn(),
    };

    mockGPTService = {
      analyzeProfile: jest.fn(),
    };

    // Create container with mocks
    const container = new Container();
    container.bind<IHeuristicService>(TYPES.HeuristicService).toConstantValue(mockHeuristicService);
    container.bind<IGPTService>(TYPES.GPTService).toConstantValue(mockGPTService);
    container.bind<any>(TYPES.DetectionEventsRepository).toConstantValue({
      createDetectionEvent: jest.fn(),
    });
    container.bind<IDetectionOrchestrator>(TYPES.DetectionOrchestrator).to(DetectionOrchestrator);

    // Get the orchestrator
    orchestrator = container.get<IDetectionOrchestrator>(TYPES.DetectionOrchestrator);
  });

  // Test cases...
});
```

## 13. Migration Strategy

1. **Incremental Migration**:

   - Start with standalone services that have few dependencies
   - Create interfaces for them and update their implementation to use `@injectable()`
   - Gradually move to more complex components

2. **Dependency Order**:

   - External clients first (Discord, OpenAI, Supabase)
   - Simple utilities and helpers
   - Repositories (data access layer)
   - Application services
   - Orchestrators and coordinators
   - Finally the Bot class itself

3. **Parallel Implementation**:

   - Keep the old implementation working while developing the new DI-based version
   - Add conditional logic to choose between implementations during transition
   - Test thoroughly after each component migration

4. **Interface-First Approach**:
   - Define all interfaces first
   - Update existing implementations to match interfaces
   - Add InversifyJS annotations
   - Wire up in the container

## 14. Advanced Patterns

### Named Bindings

```typescript
// For multiple implementations of the same interface
container.bind<ISpamDetector>(TYPES.SpamDetector)
  .to(HeuristicDetector)
  .whenTargetNamed('heuristic');

container.bind<ISpamDetector>(TYPES.SpamDetector)
  .to(AIDetector)
  .whenTargetNamed('ai');

// Usage:
@inject(TYPES.SpamDetector) @named('heuristic') private detector: ISpamDetector
```

### Tag Bindings

```typescript
// For categorizing implementations
container.bind<IDetector>(TYPES.Detector)
  .to(MessageDetector)
  .whenTargetTagged('type', 'message');

// Usage:
@inject(TYPES.Detector) @tagged('type', 'message') private detector: IDetector
```

### Multi-Injection

```typescript
// Bind multiple detectors
container.bind<IDetector>(TYPES.Detectors).to(KeywordDetector);
container.bind<IDetector>(TYPES.Detectors).to(FrequencyDetector);

// Inject an array of all detectors
@injectable()
class CompositeDetector {
  constructor(@multiInject(TYPES.Detectors) private detectors: IDetector[]) {}
}
```
