# Discord Anti-Spam Bot: Technical Context

## Overview

This document details the technical implementation of the Discord Anti-Spam Bot, including the technology stack, development environment, external service integrations, and technical considerations.

## Technology Stack

### Programming Language

- **TypeScript**: Provides type safety, improved maintainability, and better developer experience

### Core Libraries

- **Discord.js**: Comprehensive Discord API wrapper that provides:

  - Client for connecting to Discord Gateway
  - Event handling for messages, members, interactions
  - Slash command registration and handling
  - Button interactions and components
  - Thread and channel management
  - Permission management

- **OpenAI Node.js SDK**: Official SDK for GPT integration:

  - Chat completions API for GPT-4o-mini model
  - Structured message formatting
  - Error handling for API responses
  - Temperature and token control

- **Supabase JS Client**: PostgreSQL database client:

  - Type-safe database operations
  - Row-level security support
  - Real-time capabilities (not currently used)
  - PostgrestError handling

- **dotenv**: Environment variable management:
  - Loads variables from .env file
  - Secure storage of sensitive credentials
  - Used for Discord token, OpenAI API key, and Supabase credentials

### Dependency Injection

- **InversifyJS**: Full-featured IoC container:
  - Decorator-based dependency injection (@injectable, @inject)
  - Interface-driven design
  - Symbol-based dependency identification
  - Flexible binding configuration
  - Singleton and transient scope support
  - Container configuration in src/di/container.ts
  - Symbol definitions in src/di/symbols.ts
  - Testable architecture with mock injections

### Testing Tools

- **Jest**: Testing framework for unit and integration tests
- **ts-jest**: TypeScript integration for Jest
- **InversifyJS Testing Utilities**:
  - createTestContainer(): Creates container with all dependencies mocked
  - createServiceTestContainer(): Creates container with real service implementation
  - createMocks(): Creates mock implementations for all services and repositories
- **Custom Mocks**:
  - `__mocks__/discord.js.ts`: Mocks Discord client and interactions
  - `__mocks__/openai.ts`: Mocks OpenAI API responses
  - `__mocks__/supabase.ts`: Mocks database operations
  - `config/__mocks__/supabase.ts`: Mocks Supabase client configuration

### Development Tools

- **ESLint**: Code linting with TypeScript integration
- **Prettier**: Code formatting
- **Babel**: JavaScript transpilation for testing
- **Jest**: Test runner and assertion library

## Development Environment

### Required Environment Variables

- `DISCORD_TOKEN`: Bot authentication token from Discord Developer Portal
- `OPENAI_API_KEY`: API key for OpenAI services
- `SUPABASE_URL`: URL for Supabase instance
- `SUPABASE_KEY`: Anonymous key for Supabase access
- `NODE_ENV`: Environment setting (development, production)

### Local Development Setup

1. Clone repository
2. Install dependencies with `npm install`
3. Create `.env` file with required environment variables
4. Run tests with `npm test`
5. Start development server with `npm run dev`

### Discord Bot Configuration

- **Required Gateway Intents**:

  - `GatewayIntentBits.Guilds`: For guild events
  - `GatewayIntentBits.GuildMessages`: For message events
  - `GatewayIntentBits.MessageContent`: For message content access
  - `GatewayIntentBits.GuildMembers`: For member join events

- **Required Permissions**:

  - Read Messages
  - Send Messages
  - Manage Messages
  - Create Threads
  - Manage Threads
  - Manage Roles
  - Ban Members

- **Slash Commands**:
  - `/verify`: Remove restricted role from a user
  - `/ban`: Ban a user from the server
  - `/createthread`: Create a verification thread for a user
  - `/ping`: Check if the bot is running
  - `/setupverification`: Set up a verification channel
  - `/config`: Configure server-specific settings (role IDs, channel IDs, etc.)

## Dependency Injection Architecture

### Container Configuration

The bot uses InversifyJS for dependency injection with a centralized container configuration:

```typescript
// src/di/container.ts
export function configureContainer(): Container {
  // Configure external dependencies
  configureExternalDependencies(container);

  // Configure repositories
  configureRepositories(container);

  // Configure services
  configureServices(container);

  return container;
}
```

### External Dependency Injection

External dependencies are injected into the application:

```typescript
function configureExternalDependencies(container: Container): void {
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
    createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    })
  );
}
```

### Repository and Service Registration

Repositories and services are registered with appropriate scopes:

```typescript
function configureRepositories(container: Container): void {
  container.bind<IServerRepository>(TYPES.ServerRepository).to(ServerRepository).inSingletonScope();
  container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();
  // Additional repositories...
}

function configureServices(container: Container): void {
  container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();
  container.bind<IGPTService>(TYPES.GPTService).to(GPTService).inSingletonScope();
  // Additional services...
}
```

### Symbol-Based Dependency Identification

Dependencies are identified using symbols:

```typescript
// src/di/symbols.ts
export const TYPES = {
  // Core classes
  Bot: Symbol.for('Bot'),

  // Services
  HeuristicService: Symbol.for('HeuristicService'),
  GPTService: Symbol.for('GPTService'),
  // Additional symbols...

  // Repositories
  BaseRepository: Symbol.for('BaseRepository'),
  SupabaseRepository: Symbol.for('SupabaseRepository'),
  // Additional symbols...

  // External dependencies
  DiscordClient: Symbol.for('DiscordClient'),
  OpenAI: Symbol.for('OpenAI'),
  SupabaseClient: Symbol.for('SupabaseClient'),
};
```

### Injectable Service with Dependencies

Services implement interfaces and use constructor injection:

```typescript
@injectable()
export class DetectionOrchestrator implements IDetectionOrchestrator {
  constructor(
    @inject(TYPES.HeuristicService) private heuristicService: IHeuristicService,
    @inject(TYPES.GPTService) private gptService: IGPTService,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}

  // Service methods...
}
```

### Application Bootstrap

The application is started by resolving the Bot from the container:

```typescript
// src/index.ts
import 'reflect-metadata';
import { container } from './di/container';
import { TYPES } from './di/symbols';
import { IBot } from './Bot';

// Get the bot instance from the container
const bot = container.get<IBot>(TYPES.Bot);

// Start the bot
bot.startBot().catch(console.error);

// Handle termination signals
process.on('SIGINT', async () => {
  await bot.destroy();
  process.exit(0);
});
```

## Spam Detection Strategies

The bot implements a hybrid spam detection approach combining multiple techniques:

### Heuristic and Rule-Based Techniques

- **Message Frequency & Flood Detection**:

  - Defined thresholds for message volumes (5 messages in 10 seconds)
  - Automatic moderation actions triggered at thresholds

- **Keyword and Pattern Filtering**:

  - Regular expressions and keyword blacklists for scam words, malicious URLs
  - Frequent updates to address evolving spam tactics

- **URL and Link Analysis**:

  - Validation against known malicious domains
  - Heuristic checks for suspicious URL patterns

- **Behavioral Heuristics**:
  - Tracking of user behaviors like excessive mentions, emoji spam
  - Higher suspicion scores for recently created accounts or new server members

### AI-Powered Analysis

- **GPT Integration**:

  - Using gpt-4o-mini model for nuanced spam detection
  - Prompt engineering with clear instructions and expected output format
  - Few-shot learning with categorized examples
  - Selective invocation to balance cost and accuracy

- **Confidence Classification**:
  - Low: 0-40% confidence
  - Medium: 41-70% confidence
  - High: 71-100% confidence
  - Internal percentage values maintained for analytics

### Hybrid Detection Approach

- **Multi-Layered Filtering**:

  - Fast heuristic checks for immediate blocking of obvious spam
  - GPT analysis reserved for borderline or unclear cases
  - New users always analyzed by GPT upon joining

- **Performance Optimization**:
  - Rate limiting and selective API usage
  - Caching strategies for frequently accessed data
  - Efficient message history tracking

## External Services Integration

### Discord API

- **Client Initialization**:

  ```typescript
  // In container.ts
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
  ```

- **Event Handling**:

  ```typescript
  // In Bot.ts
  constructor(
    @inject(TYPES.DiscordClient) private client: Client,
    // Other dependencies...
  ) {
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('guildCreate', this.handleGuildCreate.bind(this));
  }
  ```

- **Slash Command Registration**:

  ```typescript
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: this.commands });
  ```

- **Button Interactions**:
  - Format: `action_userId` (e.g., `verify_123456789`)
  - Handlers for verify, ban, and thread creation

### OpenAI GPT

- **Model**: gpt-4o-mini (specified in GPTService.ts)

- **Prompt Structure**:

  - System message defining the assistant's role
  - User message with structured profile data
  - Few-shot examples of suspicious and normal users

- **API Call Configuration**:

  ```typescript
  @injectable()
  export class GPTService implements IGPTService {
    constructor(@inject(TYPES.OpenAI) private openai: OpenAI) {}

    // ...

    response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a Discord moderation assistant...',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 50,
    });
  }
  ```

- **Error Handling**:
  - Catches and logs API errors
  - Falls back to "OK" classification on error
  - Includes detailed error information in development

### Supabase

- **Client Initialization**:

  ```typescript
  // In container.ts
  container.bind<SupabaseClient>(TYPES.SupabaseClient).toConstantValue(
    createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false, // We don't need auth features for the bot
      },
    })
  );
  ```

- **Database Schema**:

  - `servers`: Guild configuration storage
  - `users`: Cross-server user tracking (planned)
  - `server_members`: User-server relationship (planned)

- **Repository Pattern**:

  - `BaseRepository`: Interface for common operations
  - `SupabaseRepository`: Generic implementation
  - `ServerRepository`: Server-specific operations

- **Row-Level Security**:
  - Enabled on all tables
  - Service role has full access

## Testing Strategy with InversifyJS

### Test Utilities

The project includes several test utilities for working with InversifyJS:

```typescript
// src/__tests__/utils/test-container.ts

/**
 * Creates mock implementations for all services and repositories
 * @returns Object containing all mock services and repositories
 */
export function createMocks() {
  // Create mocks for all services and repositories
  // ...
}

/**
 * Create a test container with mock implementations
 * @param customMocks Optional custom mocks to override the default ones
 * @returns Configured InversifyJS container for testing
 */
export function createTestContainer(
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = new Container();
  const mocks = { ...createMocks(), ...customMocks };

  // Bind external dependencies, services, and repositories
  // ...

  return container;
}

/**
 * Creates a container with real implementations but mock dependencies
 * This is useful for testing a specific service with mocked dependencies
 */
export function createServiceTestContainer<T>(
  serviceIdentifier: symbol,
  serviceImplementation: new (...args: any[]) => T,
  customMocks?: Partial<ReturnType<typeof createMocks>>
): Container {
  const container = createTestContainer(customMocks);

  // Rebind the service to use the real implementation
  container.unbind(serviceIdentifier);
  container.bind<T>(serviceIdentifier).to(serviceImplementation);

  return container;
}
```

### Service Unit Testing

Service tests use focused containers with real service implementations:

```typescript
describe('Bot with InversifyJS', () => {
  let container: Container;
  let bot: IBot;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    // Create a container with real Bot implementation but mock dependencies
    container = createServiceTestContainer(TYPES.Bot, Bot);

    // Get the mocks for assertions
    mocks = createMocks();

    // Get the bot from the container
    bot = container.get<IBot>(TYPES.Bot);
  });

  // Test cases...
});
```

### Container Integration Testing

Integration tests verify the container configuration:

```typescript
describe('InversifyJS Container Configuration', () => {
  let container: Container;

  beforeEach(() => {
    // Set up environment variables
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_KEY = 'test-key';

    // Configure the container
    container = configureContainer();
  });

  describe('External dependencies', () => {
    it('should resolve Discord client', () => {
      const client = container.get<Client>(TYPES.DiscordClient);
      expect(client).toBeDefined();
    });

    // More tests...
  });

  // Additional test groups for repositories, services, etc.
});
```

## Technical Constraints

### Discord API Limitations

- Rate limits on API calls
- Message size limitations
- Button interaction timeout (components expire after 15 minutes)
- Gateway connection requirements
- Slash command registration delays

### OpenAI API Considerations

- Cost per token for API calls
- Rate limits on requests
- Response time variability
- Token context window limitations
- Potential for service outages

### Performance Requirements

- Low latency for message processing
- Efficient caching for frequently accessed data
- Minimal memory footprint for hosting
- Graceful handling of service disruptions
- Optimized database queries

## Database Schema

### Current Tables

- **servers**:

  ```sql
  CREATE TABLE IF NOT EXISTS servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT UNIQUE NOT NULL,
    restricted_role_id TEXT,
    admin_channel_id TEXT,
    verification_channel_id TEXT,
    admin_notification_role_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::JSONB,
    is_active BOOLEAN DEFAULT TRUE
  );
  ```

- **detection_events**:

  ```sql
  CREATE TABLE IF NOT EXISTS detection_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT,
    detection_type TEXT NOT NULL,
    confidence REAL,
    confidence_level TEXT, -- 'Low', 'Medium', 'High'
    reasons TEXT[],
    used_gpt BOOLEAN DEFAULT FALSE,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    admin_action TEXT, -- 'Verified', 'Banned', 'Ignored'
    admin_action_by TEXT, -- Discord ID of admin who took action
    admin_action_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::JSONB
  );

  CREATE INDEX idx_detection_events_server ON detection_events(server_id);
  CREATE INDEX idx_detection_events_user ON detection_events(user_id);
  CREATE INDEX idx_detection_events_date ON detection_events(detected_at);
  ```

### Planned Tables

- **users**:

  ```sql
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discord_id TEXT NOT NULL,
    username TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    global_reputation_score REAL,
    account_created_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::JSONB,
    UNIQUE(discord_id)
  );
  ```

- **server_members**:
  ```sql
  CREATE TABLE IF NOT EXISTS server_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    join_date TIMESTAMP WITH TIME ZONE,
    reputation_score REAL DEFAULT 0.0,
    is_restricted BOOLEAN DEFAULT FALSE,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    last_message_at TIMESTAMP WITH TIME ZONE,
    message_count INTEGER DEFAULT 0,
    UNIQUE(server_id, user_id)
  );
  ```

### Migrations

- Located in `supabase/migrations/`
- Current migration: `20250327133248_create_initial_schema.sql`
- Creates initial tables with indexes and comments
- Enables row-level security with appropriate policies

## Security Considerations

### Credential Management

- All sensitive keys stored in environment variables
- No hardcoded secrets in codebase
- Regular credential rotation recommended
- Partial key logging for debugging (first/last 4 chars only)

### Data Privacy

- Minimal user data storage
- Clear documentation on what data is stored
- Compliance with Discord's Terms of Service
- Row-level security in database

### Error Handling

- Comprehensive error catching to prevent crashes
- Graceful degradation when services fail
- Logging of errors without exposing sensitive information
- User-friendly error messages for interactions

## Deployment Strategy

### Initial Deployment

- Centrally hosted service on VPS or AWS
- Environment variable configuration for production
- Node.js runtime environment

### Scaling Considerations

- Horizontal scaling for multiple bot instances
- Database connection pooling
- Caching strategies for high-traffic servers
- Selective GPT usage to control costs

## Monitoring & Maintenance

### Logging

- Structured logging for error tracking
- Console-based logging in development
- Error details for debugging
- API response logging in development mode

### Updates & Maintenance

- Regular dependency updates
- Backward compatibility considerations
- Database migration strategy

## Future Technical Enhancements

- **Spam Detection Improvements**:

  - Cross-server trust networks for shared reputation data
  - Advanced behavioral analytics for pattern recognition
  - Adaptive learning from moderation actions

- Custom fine-tuned AI model for improved detection
- Web dashboard for configuration and analytics
- Cross-server trusted network implementation
- Enhanced analytics and reporting features
- Persistent storage for message history and detection logs
- User reputation tracking across servers

- Real-time admin notifications for system events
- Status webpage for uptime/downtime tracking
