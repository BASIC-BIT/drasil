# Discord Anti-Spam Bot: System Patterns

## Project Overview

The Discord Anti-Spam Bot follows a modular, service-oriented architecture with clear separation of concerns. This document outlines the key architectural patterns and design decisions.

## Directory Structure

```
├── src/                        # Source code directory
│   ├── __tests__/             # Test files
│   │   ├── config/            # Configuration tests
│   │   ├── integration/       # Integration tests
│   │   ├── repositories/      # Repository tests
│   │   └── utils/             # Test utilities
│   ├── __mocks__/             # Mock files for testing
│   ├── config/                # Configuration files
│   │   ├── supabase.ts       # Supabase client configuration
│   │   └── gpt-config.ts     # GPT configuration
│   ├── di/                    # Dependency injection
│   │   ├── container.ts      # InversifyJS container config
│   │   └── symbols.ts        # InversifyJS symbol definitions
│   ├── events/                # Event definitions and EventBus
│   │   ├── events.ts         # Event names and payload interfaces
│   │   └── EventBus.ts       # EventBus implementation
│   │   └── subscribers/      # Event subscriber classes
│   │       ├── RestrictionSubscriber.ts
│   │       ├── NotificationSubscriber.ts
│   │       └── ... (other subscribers)
│   ├── repositories/          # Data access layer
│   │   ├── types.ts          # Database entity types
│   │   ├── BaseRepository.ts # Base repository interface
│   │   ├── SupabaseRepository.ts # Supabase implementation
│   │   └── ServerRepository.ts   # Server configuration repository
│   ├── services/             # Core services
│   ├── Bot.ts               # Main bot class
│   └── index.ts             # Application entry point
├── docs/                    # Legacy documentation (being migrated to memory-bank)
├── memory-bank/            # Project documentation and context
├── supabase/               # Supabase configuration
│   └── migrations/         # Database migrations
├── .env                    # Environment variables
└── configuration files     # Various config files (tsconfig.json, etc.)
```

## Core Components

### 1. Dependency Injection Container (di/container.ts)

The central configuration point for InversifyJS dependency injection:

- Configures the InversifyJS container with all dependencies
- Binds external dependencies (Discord client, OpenAI, PrismaClient)
- Registers repositories in singleton scope
- Registers services in singleton or transient scope as appropriate
- Returns the configured container for use in the application
- Used by index.ts to obtain service instances
- Supports testing by providing mock implementations

### 2. Bot Class (Bot.ts)

The central orchestrator that:

- Implements the IBot interface
- Receives injected dependencies via constructor
- Handles Discord events (messages, member joins, interactions)
- Registers and handles slash commands (/verify, /ban, /createthread, /ping, /setupverification)
- Coordinates verification and moderation actions
- Processes button interactions for admin actions
- Initializes server configurations on startup
- Handles new guild joins with automatic setup
- Records detection events through DetectionEventsRepository

### 3. Repository Pattern

#### Repository Interfaces (e.g., IServerRepository)

- Define the contract for data access operations specific to an entity.
- Ensure consistency and allow for dependency injection.

#### Repository Implementations (e.g., ServerRepository.ts)

- Implement the corresponding repository interface.
- Directly inject and use `PrismaClient` for database operations.
- Handle Prisma-specific errors and map them to `RepositoryError` if needed.
- Marked as `@injectable()` for dependency injection.
- Receive `PrismaClient` via `@inject(TYPES.PrismaClient)` decorator in the constructor.

#### BaseRepository.ts

- Contains the `RepositoryError` class for consistent error handling.
- (The `IBaseRepository` interface and `AbstractBaseRepository` class are no longer strictly necessary as Prisma Client provides strong typing, but interfaces like `IServerRepository` are still used for DI contracts).

### 4. Event Bus & Subscribers (src/events/)

- **EventBus (EventBus.ts)**: Simple pub/sub implementation using Node.js `EventEmitter`. Injected as a singleton.
- **Events (events.ts)**: Defines event names (constants) and strongly-typed payload interfaces (`EventMap`).
- **Subscribers (subscribers/)**: Classes that listen for specific events and trigger side effects (e.g., `RestrictionSubscriber`, `NotificationSubscriber`). Instantiated via DI container.

### 5. Service Layer

#### ConfigService (ConfigService.ts)

- Implements IConfigService interface
- Manages server configurations with a cache-first approach
- Creates default configurations when none exist
- Bridges between environment variables and database storage
- Provides methods to get, update, and manage server settings
- Handles initialization of configurations on bot startup
- Marked as @injectable() and receives dependencies via constructor

#### DetectionOrchestrator (DetectionOrchestrator.ts)

- Implements IDetectionOrchestrator interface
- Orchestrates the spam detection process
- Implements two main detection flows:
  - detectMessage: Analyzes user messages with heuristics first, then GPT if needed
  - detectNewJoin: Always uses GPT for new server joins
- Calculates suspicion scores based on multiple factors
- Determines when to use GPT based on user newness and suspicion level
- Records detection events in the database
- Produces a final DetectionResult with label, confidence, reasons, and trigger source
- Marked as @injectable() and receives service and repository dependencies via constructor

#### GPTService (GPTService.ts)

- Implements IGPTService interface
- Integrates with OpenAI's API using gpt-4o-mini model
- Analyzes user profiles and messages for suspicious patterns
- Uses few-shot examples from gpt-config.ts to improve classification
- Formats prompts with structured user data and examples
- Returns "OK" or "SUSPICIOUS" classification
- Marked as @injectable() and receives OpenAI client via constructor

#### HeuristicService (HeuristicService.ts)

- Implements IHeuristicService interface
- Implements rule-based spam detection:
  - Message frequency tracking (>5 messages in 10 seconds)
  - Suspicious keyword detection (nitro scam, free discord nitro, etc.)
- Maintains a map of user message timestamps
- Provides fast, low-cost initial screening
- Marked as @injectable() for dependency injection

#### RoleManager (RoleManager.ts)

- Implements IRoleManager interface
- Manages the restricted role for flagged users
- Provides methods to assign and remove the restricted role
- Handles role lookup and caching for better performance
- Falls back to environment variables if no role ID is configured
- Marked as @injectable() and receives Discord client via constructor

#### NotificationManager (NotificationManager.ts)

- Implements INotificationManager interface
- Creates and sends notifications to admin channels
- Formats suspicious user embeds with detailed information
- Creates interactive buttons for admin actions (verify, ban, create thread)
- Manages verification threads for suspicious users
- Logs admin actions to notification messages
- Sets up verification channels with proper permissions
- Marked as @injectable() and receives Discord client via constructor

#### VerificationService (VerificationService.ts)

- Implements IVerificationService interface
- Manages the verification lifecycle for suspicious users
- Creates and updates verification events in the database
- Provides methods for verifying, rejecting, and reopening verifications
- Tracks verification history and status changes
- Coordinates with RoleManager for role assignments
- Integrates with AdminActionRepository for audit trail
- Marked as @injectable() and receives repository dependencies via constructor

#### AdminActionService (AdminActionService.ts)

- Implements IAdminActionService interface
- Records administrative actions taken on users (verify, reject, ban, reopen)
- Provides methods to retrieve action history by admin or user
- Formats action summaries for display in notifications
- Creates audit trail for moderation accountability
- Marked as @injectable() and receives repository dependencies via constructor

#### UserModerationService (UserModerationService.ts)

- Implements IUserModerationService interface
- Coordinates user restriction and verification workflows (partially refactored to events)
- Handles user banning (publishes `UserBanned` event)
- Handles user verification (publishes `UserVerified` event)
- Handles reopening verification (TODO: Refactor to events)
- Marked as @injectable() and receives service dependencies via constructor

## Key Design Patterns

### 1. Dependency Injection with InversifyJS

Services are now integrated with full dependency injection using InversifyJS. The system uses:

- Interface-based design with clear contracts
- Symbol-based dependency identification
- Constructor injection for dependencies
- Proper scoping (singleton vs transient) for services
- External dependency injection (Discord, OpenAI, PrismaClient)
- Testable architecture with mock injections

Example:

```typescript
// In container.ts
container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();

// In class implementation
@injectable()
export class DetectionOrchestrator implements IDetectionOrchestrator {
  constructor(
    @inject(TYPES.HeuristicService) private heuristicService: IHeuristicService,
    @inject(TYPES.GPTService) private gptService: IGPTService,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository
  ) {
    // Constructor implementation
  }
}

// In index.ts
const container = configureContainer();
const bot = container.get<IBot>(TYPES.Bot);
await bot.startBot();
```

### 2. Repository Pattern (with Prisma)

Data access is abstracted through repositories, providing a clean separation between business logic and data storage.

- **Interfaces (e.g., `IServerRepository`)**: Define the contract for data operations required by services.
- **Implementations (e.g., `ServerRepository.ts`)**:
  - Implement the repository interface.
  - Inject `PrismaClient` via the constructor.
  - Use `PrismaClient` methods (`findUnique`, `create`, `update`, `findMany`, etc.) to interact with the database.
  - Handle potential Prisma errors (e.g., `PrismaClientKnownRequestError`).

This pattern provides:

- Centralized data access logic.
- Simplified testing by allowing repository interfaces to be mocked.
- Type safety provided by Prisma Client.

### 3. Service Pattern

Business logic is encapsulated in focused service classes with single responsibilities. Each service has a clear domain:

- **HeuristicService**: Rule-based spam detection
- **GPTService**: AI-powered analysis
- **DetectionOrchestrator**: Coordination of detection strategies
- **RoleManager**: Role assignment and management
- **NotificationManager**: Admin notifications and verification threads
- **ConfigService**: Configuration management
- **UserService**: User and server membership management

### 4. Event-Driven Architecture (Internal)

Core workflows are being refactored to use an internal event bus (`src/events/EventBus.ts`) for decoupling services:

- **Events**: Defined with strong types (`src/events/events.ts`) (e.g., `VerificationStarted`, `UserVerified`, `UserBanned`).
- **Publishers**: Services publish events after completing their primary task (e.g., `SecurityActionService` publishes `VerificationStarted`).
- **Subscribers**: Dedicated classes (`src/events/subscribers/`) listen for events and handle specific side effects (e.g., `RestrictionSubscriber` handles role assignment, `NotificationSubscriber` handles sending notifications).
- **Decoupling**: Reduces direct service-to-service calls for secondary actions, improving maintainability.

### 5. Command Pattern

Slash commands and button interactions follow the command pattern:

- Commands are registered with Discord's API
- Each command has a dedicated handler method (handleVerifyCommand, handleBanCommand, etc.)
- Button interactions use a customId format (action_userId) to encode the action and target
- Handlers are dispatched based on command name or button ID

### 6. Caching Strategy

The ConfigService implements a cache-first approach for server configurations:

1. Check cache
2. If not in cache, fetch from database
3. Update cache with fetched data
4. Return data

This pattern is implemented in the getServerConfig method, which:

- First checks the serverCache Map
- Falls back to database lookup if not in cache
- Creates default configuration if none exists
- Always updates the cache with the latest data

## Data Flow Patterns

### 1. Suspicious User Detection & Initial Handling Flow (Event-Driven)

```mermaid
sequenceDiagram
    participant Discord
    participant EventHandler
    participant SecurityActionService
    participant VerificationEventRepo
    participant EventBus
    participant RestrictionSubscriber
    participant NotificationSubscriber
    participant UserModerationService
    participant NotificationManager

    Discord->>EventHandler: messageCreate / guildMemberAdd
    EventHandler->>SecurityActionService: handleSuspiciousMessage / handleSuspiciousJoin
    SecurityActionService->>VerificationEventRepo: createFromDetection(...)
    VerificationEventRepo-->>SecurityActionService: newVerificationEvent
    SecurityActionService->>EventBus: publish(VerificationStarted, payload)
    EventBus->>RestrictionSubscriber: handleVerificationStarted(payload)
    RestrictionSubscriber->>UserModerationService: restrictUser(member)
    EventBus->>NotificationSubscriber: handleVerificationStarted(payload)
    NotificationSubscriber->>NotificationManager: upsertSuspiciousUserNotification(...)
    NotificationSubscriber->>VerificationEventRepo: update(notification_message_id)
```

### 2. User Verification/Ban Flow (Event-Driven)

```mermaid
sequenceDiagram
    participant InteractionHandler
    participant UserModerationService
    participant VerificationEventRepo
    participant EventBus
    participant RoleUpdateSubscriber
    participant ActionLogSubscriber
    participant ServerMemberStatusSubscriber
    participant RoleManager
    participant NotificationManager
    participant ServerMemberRepo

    InteractionHandler->>UserModerationService: verifyUser / banUser
    UserModerationService->>VerificationEventRepo: update(status='verified'/'banned')
    VerificationEventRepo-->>UserModerationService: updatedEvent
    UserModerationService->>EventBus: publish(UserVerified / UserBanned, payload)

    EventBus->>RoleUpdateSubscriber: handleUserVerified(payload)
    RoleUpdateSubscriber->>RoleManager: removeRestrictedRole(member)

    EventBus->>ActionLogSubscriber: handleUserVerified / handleUserBanned
    ActionLogSubscriber->>NotificationManager: logActionToMessage(...)

    EventBus->>ServerMemberStatusSubscriber: handleUserVerified / handleUserBanned
    ServerMemberStatusSubscriber->>ServerMemberRepo: upsertMember(status='verified'/'banned')
```

*Note: The old diagram showing direct calls between services like `VS->RM` is now outdated for these flows.*

### 3. Configuration Flow

```
Request for Server Config → ConfigService.getServerConfig
├── Cache Check
├── If in Cache: Return Cached Config
└── If Not in Cache:
    ├── Database Lookup (ServerRepository.findByGuildId)
    ├── If Found: Update Cache and Return
    ├── If Not Found: Create Default Config
    │   ├── Save to Database
    │   └── Update Cache
    └── Return Config
```

### 4. Moderation Actions Flow

```
Slash Command or Button Interaction → Bot.ts
├── Command Parsing and Validation
├── Action Execution:
│   ├── Verify: RoleManager.removeRestrictedRole
│   ├── Ban: member.ban()
│   └── Create Thread: NotificationManager.createVerificationThread
├── User Notification (ephemeral reply)
└── Action Logging: NotificationManager.logActionToMessage
```

### 5. Dependency Resolution Flow (with InversifyJS)

```
Application Start → index.ts
├── Configure DI Container (container.ts)
│   ├── Configure External Dependencies
│   ├── Configure Repositories
│   └── Configure Services
├── Resolve Bot Instance (container.get<IBot>(TYPES.Bot))
└── Start Bot (bot.startBot())
```

## Error Handling Strategy

1. **Service-Level Error Handling**:

   - Each service handles its domain-specific errors
   - Try/catch blocks around critical operations
   - Detailed error logging with context

2. **Repository Error Handling**:

   - Custom RepositoryError class with cause tracking
   - Specific handling for PostgrestError vs general errors
   - Centralized error handling in handleError method

3. **Top-Level Error Handling**:

   - Bot.ts catches errors in event handlers and command processing
   - Interaction errors provide user feedback when possible
   - Console logging for all errors with stack traces

4. **Graceful Degradation**:
   - Default to "OK" classification if GPT service fails
   - Fall back to environment variables if database fails
   - Continue operation with reduced functionality when possible

## Testing Approach

1. **Unit Tests**:

   - Service-specific tests in **tests** directory
   - Mock dependencies with InversifyJS test utilities
   - Test both success and error paths
   - Use createServiceTestContainer for focused service testing

2. **Integration Tests**:

   - container.integration.test.ts for dependency resolution
   - Bot.integration.test.ts for end-to-end flows
   - Tests for critical paths like detection and notification

3. **InversifyJS Testing Utilities**:

   - createTestContainer(): Creates container with all dependencies mocked
   - createServiceTestContainer(): Creates container with a real service implementation
   - createMocks(): Creates mock implementations for all services and repositories
   - Custom mock implementations for external services (Discord, OpenAI, Supabase)

4. **Real API Tests**:
   - GPTService.realapi.test.ts for testing actual OpenAI integration
   - Only run locally, not in CI

## Extension Points

The architecture provides several extension points:

1. **New Commands**:

   - Add to commands array in Bot.ts constructor
   - Implement handler method in Bot class
   - Register with Discord API in registerCommands method

2. **New Detection Methods**:

   - Add new services or extend existing ones
   - Integrate into DetectionOrchestrator
   - Update detection result format if needed
   - Register in the DI container

3. **Database Schema Extensions**:

   - Add new migrations in supabase/migrations
   - Create new repository classes extending SupabaseRepository
   - Update types.ts with new entity interfaces
   - Register new repositories in the DI container

4. **Configuration Extensions**:
   - Add new settings to ServerSettings interface
   - Update GlobalConfig with new default values
   - Extend ConfigService methods as needed
   - Bind new configuration objects in the container

## Development Guidelines

### 1. Service Integration

- Services should implement interfaces
- Communication through well-defined interfaces
- Dependency injection via constructor with @inject decorators
- Register services in the container

### 2. Error Handling

- Comprehensive error catching in Bot.ts
- Service-specific error handling
- Repository error handling
- Graceful degradation when services fail

### 3. Configuration

- Environment variables for sensitive data
- Database-backed configuration
- Runtime configuration via Discord commands
- Cached configurations for performance

### 4. Testing

- Unit tests in `__tests__` directory
- Mocks in `__mocks__` directory
- Integration tests for critical paths
- Repository tests with Supabase mocking
- Use InversifyJS testing utilities for dependency injection testing
