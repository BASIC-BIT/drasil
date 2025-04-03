# Discord Anti-Spam Bot: Active Context

## Current Development Focus

The project is currently focused on implementing the core functionality of the Discord Anti-Spam Bot, with recent work on database schema consolidation and service architecture improvements.

### Things on the developers mind right now

- Our service architecture is very confusing. We should solidify on very specific approaches about how services call other services...
- Considering when, in the service layer, we should call another service vs a repository... Handling side effects and such

## Recent Milestones

### Completed

- ✅ **Database Schema Consolidation**:

  - Combined all migrations into a single initial schema file
  - Simplified database setup process
  - Proper foreign key relationships and constraints
  - Comprehensive indexing strategy
  - Row Level Security implementation
  - Clear documentation and comments

- ✅ **Service Architecture Improvements**:

  - Moved entity existence checks to SecurityActionService
  - Simplified UserReputationService to focus solely on reputation management
  - Removed entity management from DetectionOrchestrator
  - Improved error handling and logging across services
  - Clear separation of responsibilities between services

- ✅ **Repository Separation of Concerns**:

  - DetectionEventsRepository simplified to only create events
  - DetectionOrchestrator now responsible for user and server creation
  - Proper integration with UserRepository and ServerRepository
  - Clear responsibilities between services and repositories
  - Improved error propagation and logging

- ✅ **Detection Events Implementation**:

  - DetectionEventsRepository with full test coverage
  - Integration with DetectionOrchestrator
  - Proper error handling for database operations
  - Event recording and querying functionality
  - Updated Bot.ts to use DetectionEventsRepository
  - Added server ID to detection method signatures

- ✅ **Test Coverage Improvements**:

  - Fixed DetectionEventsRepository test error handling
  - Improved mock setup for Supabase operations
  - Added proper PostgrestError handling in tests
  - Updated test assertions to match actual error messages
  - Ensured consistent error handling across repositories
  - Added comprehensive test coverage for error cases

- ✅ **InversifyJS Dependency Injection**:

  - Implemented InversifyJS container configuration
  - Created interfaces for all services and repositories
  - Updated existing classes to use @injectable and @inject decorators
  - Defined symbols for all injectable dependencies
  - Refactored Bot class to use dependency injection
  - Updated index.ts to use container for dependency resolution
  - Created test utilities for InversifyJS testing
  - Added integration tests for container validation
  - Updated README with InversifyJS testing documentation

- ✅ **Project & Testing Setup**:

  - Repository initialization with TypeScript
  - Jest testing framework configuration
  - ESLint and Prettier setup
  - Basic project structure

- ✅ **Minimal Discord Bot**:

  - Discord.js client integration
  - Event handling for messages, members, and interactions
  - Slash command registration and handling
  - Basic bot lifecycle management

- ✅ **Heuristic Spam Detection**:

  - Message frequency tracking (>5 messages in 10 seconds)
  - Suspicious keyword detection
  - Efficient message history management

- ✅ **GPT Integration**:

  - OpenAI SDK integration with gpt-4o-mini model
  - User profile analysis
  - Structured prompt formatting
  - Error handling and fallback strategies

- ✅ **Combined Detection Flow**:

  - DetectionOrchestrator implementation
  - Selective GPT usage based on user newness and suspicion level
  - Confidence scoring system
  - Reason tracking for admin transparency

- ✅ **Verification & Role Management**:

  - Restricted role assignment for suspicious users
  - Slash commands for verification and moderation
  - Button interactions for admin actions
  - Verification thread creation

- ✅ **Prompt Strategy & Few-Shot**:

  - Categorized examples (clearly suspicious, borderline suspicious, etc.)
  - Structured prompt formatting
  - Account age and join date analysis
  - Message content evaluation

- ✅ **Enhanced Admin Notifications**:

  - Formatted embeds with detailed user information
  - Low/Medium/High confidence display
  - Improved timestamp formatting with relative times
  - Bullet-point reason lists
  - Action logging in notification messages
  - Dedicated verification channel setup

- ✅ **Supabase Error Handling Improvements**:

  - Fixed bug with server configuration creation
  - Proper handling of "not found" cases in repositories
  - Improved data validation before database operations
  - Documented best practices in supabase-error-handling.md

- ✅ **Database Repository Implementation (Supabase Client)**:
  - Implemented ServerRepository with tests (Note: Tests later found to be missing)
  - Implemented UserRepository with tests (Note: Tests later found to be missing)
  - Implemented ServerMemberRepository with tests (Note: Tests later found to be missing)
  - Comprehensive test coverage for all repositories (Note: Documentation inaccurate, tests missing)
  - Fixed method chaining issues in Supabase mocks
  - Added proper error handling for all database operations
  - Added proper cleanup in test lifecycle hooks
- ✅ **Prisma Migration**: Migrated all repositories (`ServerRepository`, `UserRepository`, `ServerMemberRepository`, `DetectionEventsRepository`, `VerificationEventRepository`, `AdminActionRepository`) to use Prisma Client instead of Supabase Client. Updated DI container.
- ✅ **Prisma Migration**: Migrated all repositories (`ServerRepository`, `UserRepository`, `ServerMemberRepository`, `DetectionEventsRepository`, `VerificationEventRepository`, `AdminActionRepository`) to use Prisma Client instead of Supabase Client. Updated DI container.
- ✅ **Notification Button Fix**: Fixed bug where "Create Thread" button was missing on initial verification notifications due to incorrect null check (`!== undefined` vs truthiness check) for `thread_id` in `NotificationManager.ts`.
- ✅ **Event-Driven Architecture Refactoring (Phase 1 & 2)**:
  - Implemented `EventBus` using Node.js `EventEmitter`.
  - Defined core events (`VerificationStarted`, `UserVerified`, `UserBanned`) with typed payloads.
  - Integrated `EventBus` into DI container.
  - Refactored `SecurityActionService` and `UserModerationService` to publish events.
  - Created subscribers (`RestrictionSubscriber`, `NotificationSubscriber`, `RoleUpdateSubscriber`, `ActionLogSubscriber`, `ServerMemberStatusSubscriber`) to handle side effects.
  - Injected subscribers into `EventHandler` for instantiation.
  - Removed direct service calls for handled side effects.

### In Progress

- 🔄 **Persistence & Logging (Supabase)**:
  - Database schema design (initial migration created)
  - Repository pattern implementation
  - Server configuration persistence
  - Server configuration command (/config)
  - Caching strategy for configurations
  - Database-based configuration (removed environment variable dependencies)
  - User service implementation with database integration

### Pending

- ⏳ **Cross-Server & Advanced Features**:
  - User tracking across servers
  - Global reputation scores
  - Advanced behavioral analytics
  - Message history analysis
  - Detection pattern learning

## Current Architecture State

The system uses InversifyJS for dependency injection and is transitioning towards an Event-Driven Architecture (EDA) for decoupling core workflows. Key components include:

1. **Dependency Injection with InversifyJS**:

   - Central container configuration in `src/di/container.ts`
   - Symbol definitions in `src/di/symbols.ts`
   - Interfaces for all services and repositories
   - `@injectable()` decorators on all service and repository classes
   - `@inject()` decorators for constructor parameters
   - Singleton scope for most services and repositories
   - Testable architecture with mock injections

2. **Bot Core (Bot.ts)**:

   - Main orchestrator class implementing IBot interface
   - Event handling for Discord interactions
   - Service initialization through dependency injection
   - Command registration and processing
   - Button interaction handling
   - Server initialization and management

3. **Detection Services**:

   - **HeuristicService**: Fast, rule-based detection
   - **GPTService**: AI-powered deep analysis
   - **DetectionOrchestrator**: Combines both approaches with smart routing

4. **User Management**:

   - **RoleManager**: Restricted role assignment and removal
   - **NotificationManager**: Admin notifications and verification threads
   - **UserService**: Handles user operations across servers
   - **VerificationService**: Manages verification lifecycle and status tracking
   - **AdminActionService**: Records and tracks admin moderation actions
   - **UserModerationService**: Coordinates user restriction and verification workflows

5. **Configuration**:

   - **ConfigService**: Server-specific settings with caching
   - **GlobalConfig**: Application-wide settings
   - **Server Configuration Command**:
     - `/config` command for updating server settings
     - Supports updating restricted_role_id, admin_channel_id, verification_channel_id, admin_notification_role_id
     - Requires administrator permissions
     - Persists settings in database
     - Updates services in real-time
     - Eliminates need for environment variables

6. **Data Access (Prisma)**:
   - **Repository Pattern**: Abstraction for data operations, implemented using Prisma Client.
   - **Prisma Client**: ORM managing database connections and queries to Supabase PostgreSQL.
   - **Server Configuration**: Persistent storage for settings via `ServerRepository`.
   - **User Repository**: Manages Discord users across servers.
   - **Server Member Repository**: Manages user data in specific servers.
   - **Detection/Verification/Admin Repositories**: Manage related event/action data.
7. **Eventing System**:
   - **EventBus**: Central singleton for publishing and subscribing to internal events.
   - **Events**: Strongly-typed definitions for events and payloads (`src/events/events.ts`).
   - **Subscribers**: Dedicated classes handling side effects triggered by events (`src/events/subscribers/`).


## Active Decisions & Considerations

### Current Technical Decisions

1. **Service Responsibility Separation**:

   - SecurityActionService now handles entity existence verification
   - Early entity verification ensures data consistency
   - UserReputationService focused purely on reputation management
   - DetectionOrchestrator focused purely on detection logic
   - Clear, unidirectional flow: Detection → Security Action → Reputation

2. **Dependency Injection Implementation**:

   - Using InversifyJS for IoC container management
   - Interfaces defined for all injectable components
   - Symbol-based dependency resolution
   - Singleton scope for repositories and stateful services
   - Transient scope for stateless services
   - External dependency injection (Discord client, OpenAI, Supabase)
   - Test utilities for container-based testing

3. **GPT Usage Optimization**:

   - Using gpt-4o-mini model for improved accuracy with reasonable cost
   - Selective invocation strategy:
     - Always use for new server joins
     - Use for new accounts' first messages
     - Use for borderline suspicious messages from established users
     - Skip for clearly OK or clearly suspicious messages (based on heuristics)
   - Structured few-shot examples in four categories:
     - Clearly suspicious (obvious spam/scam)
     - Borderline suspicious (subtle but should be flagged)
     - Borderline normal (unusual but should be OK)
     - Clearly normal (obviously legitimate users)
   - Low temperature (0.3) for more consistent responses
   - Limited token usage (max_tokens: 50) for efficiency

4. **Admin Notification Format**:

   - Confidence level display:
     - 🟢 Low (0-40%)
     - 🟡 Medium (41-70%)
     - 🔴 High (71-100%)
   - Enhanced timestamp displays:
     - Full timestamp (e.g., March 15, 2023 3:45 PM)
     - Relative Discord timestamp (e.g., "2 days ago")
   - Trigger information:
     - Message content with link if available
     - "Flagged upon joining server" for join events
   - Bullet-point formatting for detection reasons
   - Interactive buttons for admin actions:
     - Verify User (success style)
     - Ban User (danger style)
     - Create Thread (primary style)
   - Action logging directly in notification messages:
     - Admin attribution
     - Timestamps for accountability
     - Links to verification threads when applicable
     - Maintains complete history in original message

5. **Verification Channel Structure**:

   - Dedicated channel with specific permissions:
     - Everyone: No access (deny ViewChannel)
     - Restricted role: Can view and send messages
     - Bot: Full access for management
     - Admin roles: Full access
   - Private threads for individual verification cases
   - Initial message with verification instructions
   - Automatic thread creation for flagged new joins
   - Manual thread creation via button or command

6. **Database Error Handling**:

   - Specific handling for PostgrestError code 'PGRST116' (no rows found)
   - Treating "not found" cases as valid null returns rather than errors
   - Careful data preparation before database operations
   - Excluding non-UUID formatted IDs when creating new records
   - Consistent error propagation with context using RepositoryError

7. **Server Configuration Management**:

   - Database-stored configuration values instead of environment variables
   - Server-specific settings with `/config` command
   - Real-time service updates when configuration changes
   - Cache-first approach with database fallback
   - Type-safe configuration access

8. **Repository Testing Strategy**:

   - **Current Status**: Repository unit tests are currently missing.
   - **Future Strategy**: Implement unit tests using Prisma mocking strategies (e.g., `jest-mock-extended`).
   - Test both success and error paths.
   - Use InversifyJS test utilities (once implemented/found) for dependency injection mocking.

9. **Repository Pattern Implementation (Prisma)**:
   - Repositories implement interfaces (e.g., `IServerRepository`).
   - Repositories inject and use `PrismaClient`.
   - Clear separation of concerns maintained.
   - Error handling uses `RepositoryError` wrapper around Prisma errors.
10. **Event-Driven Flow**:
   - Core actions (user restriction, notification, role updates, status changes, logging) are triggered by events like `VerificationStarted`, `UserVerified`, `UserBanned`.
   - Services publish events; dedicated subscribers handle the resulting side effects.

### Open Questions & Considerations

1. **Database Schema Design**:

   - Initial schema created with three main tables:
     - servers: Guild configuration storage (fully implemented with repository)
     - users: Cross-server user tracking (schema created but repository not implemented)
     - server_members: User-server relationship (schema created but repository not implemented)
   - Need to implement repositories for users and server_members
   - Need to design queries for cross-server reputation lookup
   - Consider indexing strategy for performance
   - Plan for data retention and pruning

2. **Performance Optimization**:

   - Server configuration caching implemented
   - Need to implement rate limiting for GPT API calls
   - Consider message queue for high-traffic servers
   - Evaluate memory usage for message history tracking
   - Plan for database connection pooling
   - Consider sharding for very large bot installations

3. **Deployment Strategy**:
   - Need to decide between VPS and serverless hosting
   - Evaluate Docker containerization benefits
   - Plan for environment variable management in production
   - Consider monitoring and alerting solutions
   - Design backup and recovery procedures
   - Plan for zero-downtime updates

## Next Steps

### Immediate Tasks

1. **Completed Detection Events Integration**:

   - ✅ Set up DetectionEventsRepository
   - ✅ Integrate with DetectionOrchestrator
   - ✅ Add proper error handling
   - ✅ Add comprehensive test coverage
   - ✅ Implement proper creation of related entities
   - ✅ Ensure consistent error propagation
   - 🔄 Implement performance testing for high volume
   - 🔄 Add historical data retrieval
   - 🔄 Implement verification thread tracking

2. **Enhance Testing Coverage**:

   - ✅ Basic unit tests for services
   - ✅ Mock implementations for external dependencies
   - ✅ Add tests for Supabase repositories
   - ✅ Add tests for error handling scenarios
   - ✅ Add integration tests for InversifyJS container
   - ✅ Implement test utilities for dependency injection
   - 🔄 Add performance tests for high-volume scenarios
   - 🔄 Improve integration tests for end-to-end flows
   - 🔄 Add tests for database operations

3. **Documentation Updates**:

   - ✅ Document Supabase error handling best practices
   - ✅ Document server configuration command
   - ✅ Document InversifyJS testing approach (Note: Needs review based on actual test setup)
   - ✅ Updated Memory Bank (`techContext.md`, `systemPatterns.md`) for Prisma migration.
   - 🔄 Update Memory Bank (`systemPatterns.md`, `techContext.md`, `activeContext.md`, `progress.md`) for EDA refactoring.
   - 🔄 Update README with setup instructions (including Prisma).
   - 🔄 Document database schema (`prisma/schema.prisma`) and migration process (`prisma migrate dev`).
   - 🔄 Create admin guide for bot configuration.
   - 🔄 Document environment variables (`DATABASE_URL`).
   - 🔄 Create developer guide for extending the bot (including Prisma and EDA usage).

4. **Alpha Release Critical Components**:
   - ❌ User flags repository (Cancelled - integrating into existing tables)
     - ❌ Create user_flags table
     - ❌ Complete methods for flag management
     - ❌ Implement flag history and status tracking
     - ❌ Create unit tests with transaction rollbacks
   - 🆕 Extend Existing Tables for Flag Functionality
     - ✅ Add flag columns to server_members table (is_restricted, verification_status, etc.)
     - 🔄 Add reputation columns to users table (global_reputation_score, suspicious_server_count)
     - 🔄 Update repository methods to support flag operations
     - 🔄 Add migration for new columns
     - 🔄 Add tests for flag-related operations
   - 🔄 Thread & verification tracking
     - ✅ Create verification_events table
     - ✅ Implement VerificationEventRepository
     - ✅ Implement AdminActionRepository
     - 🔄 Track verification outcomes
     - 🔄 Store thread references
     - 🔄 Add integration tests for verification flow
   - 🔄 Polish & usability improvements
     - ⏳ Implement graceful handling for button timeout
     - ⏳ Add visual indication of button expiration
     - ⏳ Enhance verification instructions clarity
     - ⏳ Improve feedback for admin actions

### Future Enhancements

1. **Cross-Server Reputation**:

   - Implement user tracking across servers
   - Design reputation scoring algorithm
   - Create trust network for server verification
   - Implement privacy controls for shared data
   - Add admin controls for reputation management

2. **Web Dashboard**:

   - Design admin interface for configuration
   - Implement analytics and reporting
   - Add user management features
   - Create server-specific dashboards
   - Implement authentication and authorization

3. **Custom AI Model**:
   - Collect training data from real spam examples
   - Fine-tune custom model for Discord-specific detection
   - Implement model versioning and updates
   - Create evaluation framework for model performance
   - Design fallback strategy for model failures

## Current Challenges

1. **Balancing Detection Accuracy**:

   - Current approach uses a hybrid system:
     - Fast heuristics for obvious cases
     - GPT for nuanced analysis
     - Confidence scoring for transparency
   - Need to tune thresholds based on real-world usage
   - Need to collect feedback on false positives/negatives
   - Need to adapt to evolving spam techniques

2. **Discord API Limitations**:

   - Button interactions expire after 15 minutes
   - Gateway connection requirements for certain events
   - Rate limits for high-traffic operations
   - Slash command registration delays
   - Permission management complexity

3. **Cost Management**:

   - Selective GPT usage strategy implemented
   - Need to monitor and optimize token usage
   - Need to evaluate hosting options for cost-efficiency
   - Need to plan for scaling with increased adoption
   - Consider premium tier options for sustainability

4. **Database Error Handling and Entity Relationships**:

   - Improved error handling for Supabase operations
   - Proper handling of "not found" cases with PostgrestError code 'PGRST116'
   - Clear separation of concerns between repositories
   - Consistent pattern for entity creation and relationships
   - Proper debugging with detailed logging
   - Detailed error messages with context for troubleshooting

5. **InversifyJS Testing Best Practices**:

   - **Private Property Access**: Use proper type assertions with `(as any)` for accessing private properties instead of bracket notation which causes TypeScript errors.
   - **Dynamic Values**: Use `expect.any(String)` or `expect.any(Date)` for dynamically generated fields like timestamps rather than exact values.
   - **Mock Implementation**: Create proper mock implementations that match the interface, especially for complex objects with nested properties.
   - **Container Configuration**: Ensure all dependencies are properly bound in the test container, including external services like SupabaseClient.
   - **Constructor Parameters**: Ensure mock parameters match the implementation's constructor signature exactly, especially when using overloaded constructors.
   - **Avoiding Direct Property Access**: Prefer testing through public methods rather than accessing private properties directly in tests.
   - **Code Quality**: Remove unused imports and variables to avoid lint errors and improve test readability.
   - **Error Scenario Testing**: Properly set up mocks for error scenarios to ensure error propagation is tested correctly.
   - **Custom Assertions**: Use extension methods and custom matchers for cleaner test assertions.
   - **Test Isolation**: Ensure proper cleanup between tests using `afterEach` and `jest.clearAllMocks()` to prevent test interference.

6. **Performance Optimization for Alpha Release**:
   - Need to implement rate limiting for OpenAI API calls
   - Message queue system needed for high-traffic servers
   - Memory usage optimization for message history tracking
   - Database connection pooling configuration
   - Performance metrics and monitoring implementation
   - Stress testing needed to identify bottlenecks
   - Caching strategy refinement for server configurations
   - Implement graceful degradation for external service outages
