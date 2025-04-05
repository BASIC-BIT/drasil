# Discord Anti-Spam Bot: Active Context

## Current Development Focus

The project is currently focused on solidifying the internal architecture using an Event-Driven approach to decouple services and improve maintainability.

### Things on the developers mind right now

- Ensuring the event flows cover all necessary side effects.
- Planning the next steps: testing the new event flows or continuing refactoring.
- Updating documentation to accurately reflect the new architecture.

## Recent Milestones

### Completed

- ✅ **Event-Driven Architecture Refactoring (Phase 3 - Detection & Moderation)**:

  - Refactored `DetectionOrchestrator` to create `DetectionEvent` records.
  - Refactored `EventHandler` to publish `UserDetectedSuspicious` event instead of calling `SecurityActionService`.
  - Created `DetectionResultHandlerSubscriber` to listen for `UserDetectedSuspicious` and call `SecurityActionService`.
  - Defined `AdditionalSuspicionDetected` event for updates to existing verifications.
  - Defined `VerificationReopened` event.
  - Refactored `SecurityActionService` to handle `AdditionalSuspicionDetected` and `VerificationReopened` events.
  - Defined `AdminVerifyUserRequested` and `AdminBanUserRequested` events.
  - Refactored `InteractionHandler` and `CommandHandler` to publish admin request events instead of calling `UserModerationService`.
  - Refactored `UserModerationService` to subscribe to admin request events and execute core logic.
  - Created `VerificationReopenSubscriber`.
  - Updated DI container bindings for new subscribers.

- ✅ **Event-Driven Architecture Refactoring (Phase 1 & 2)**:

  - Implemented `EventBus` using Node.js `EventEmitter`.
  - Defined core events (`VerificationStarted`, `UserVerified`, `UserBanned`) with typed payloads.
  - Integrated `EventBus` into DI container.
  - Refactored `SecurityActionService` and `UserModerationService` to publish result events.
  - Created subscribers (`RestrictionSubscriber`, `NotificationSubscriber`, `RoleUpdateSubscriber`, `ActionLogSubscriber`, `ServerMemberStatusSubscriber`) to handle side effects.
  - Injected subscribers into `EventHandler` for instantiation.
  - Removed direct service calls for handled side effects.

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
- ✅ **Notification Button Fix**: Fixed bug where "Create Thread" button was missing on initial verification notifications due to incorrect null check (`!== undefined` vs truthiness check) for `thread_id` in `NotificationManager.ts`.

### In Progress

- 🔄 **Persistence & Logging (Prisma)**:
  - Database schema design (initial migration created)
  - Repository pattern implementation (Completed for core tables)
  - Server configuration persistence (Completed)
  - Server configuration command (/config) (Completed)
  - Caching strategy for configurations (Completed)
  - Database-based configuration (Completed)
  - User service implementation with database integration (Partially done via repositories)

### Pending

- ⏳ **Cross-Server & Advanced Features**:
  - User tracking across servers
  - Global reputation scores
  - Advanced behavioral analytics
  - Message history analysis
  - Detection pattern learning

## Current Architecture State

The system uses InversifyJS for dependency injection and an Event-Driven Architecture (EDA) for decoupling core workflows. Key components include:

1.  **Dependency Injection with InversifyJS**:

    - Central container configuration in `src/di/container.ts`
    - Symbol definitions in `src/di/symbols.ts`
    - Interfaces for all services and repositories
    - `@injectable()` decorators on all service and repository classes
    - `@inject()` decorators for constructor parameters
    - Singleton scope for most services, repositories, and subscribers
    - Testable architecture with mock injections

2.  **Bot Core (Bot.ts & Controllers)**:

    - `Bot.ts`: Main entry point, logs into Discord, delegates to `EventHandler`.
    - `EventHandler.ts`: Listens for Discord gateway events (`messageCreate`, `guildMemberAdd`), performs initial processing (e.g., calls `DetectionOrchestrator`), and publishes internal events (e.g., `UserDetectedSuspicious`).
    - `CommandHandler.ts`: Handles slash commands, publishes request events (e.g., `AdminBanUserRequested`).
    - `InteractionHandler.ts`: Handles button interactions, publishes request events (e.g., `AdminVerifyUserRequested`).

3.  **Detection Services**:

    - **HeuristicService**: Fast, rule-based detection.
    - **GPTService**: AI-powered deep analysis.
    - **DetectionOrchestrator**: Combines both approaches, creates `DetectionEvent` record, returns `DetectionResult` with `detectionEventId`.

4.  **User Management & Moderation Services**:

    - **RoleManager**: Manages restricted role assignment/removal (called by subscribers).
    - **NotificationManager**: Formats/sends admin notifications, logs actions (called by subscribers).
    - **ThreadManager**: Manages verification threads (called by subscribers).
    - **UserService**: Handles user operations across servers (primarily via repositories).
    - **VerificationService**: (Potentially needs refactoring/removal).
    - **AdminActionService**: Records admin actions, publishes `AdminActionRecorded`.
    - **UserModerationService**: Subscribes to `Admin...Requested` events, executes core verify/ban logic, publishes `UserVerified`/`UserBanned` events. Contains `restrictUser` logic (called by `RestrictionSubscriber`).
    - **SecurityActionService**: Subscribes to `UserDetectedSuspicious`, initiates verification (`VerificationStarted` event) or updates (`AdditionalSuspicionDetected` event). Handles `VerificationReopened` event.

5.  **Configuration**:

    - **ConfigService**: Server-specific settings with caching.
    - **GlobalConfig**: Application-wide settings.
    - **Server Configuration Command**: `/config` command handled by `CommandHandler`.

6.  **Data Access (Prisma)**:

    - **Repository Pattern**: Abstraction for data operations using Prisma Client.
    - **Prisma Client**: ORM managing database connections and queries.
    - Repositories for `servers`, `users`, `server_members`, `detection_events`, `verification_events`, `admin_actions`.

7.  **Eventing System**:
    - **EventBus**: Central singleton (`EventEmitter`) for pub/sub.
    - **Events**: Strongly-typed definitions (`src/events/events.ts`). Includes detection events, verification lifecycle events, admin request events, and result events.
    - **Subscribers**: Dedicated classes handling side effects (`src/events/subscribers/`). Key flows:
      - `UserDetectedSuspicious` -> `DetectionResultHandlerSubscriber` -> `SecurityActionService` -> (`VerificationStarted` or `AdditionalSuspicionDetected`)
      - `VerificationStarted` -> `RestrictionSubscriber`, `NotificationSubscriber`
      - `AdditionalSuspicionDetected` -> `NotificationSubscriber`
      - `AdminVerifyUserRequested` -> `UserModerationService` -> `UserVerified`
      - `AdminBanUserRequested` -> `UserModerationService` -> `UserBanned`
      - `UserVerified` -> `RoleUpdateSubscriber`, `ActionLogSubscriber`, `ServerMemberStatusSubscriber`
      - `UserBanned` -> `ActionLogSubscriber`, `ServerMemberStatusSubscriber`
      - `VerificationReopened` -> `VerificationReopenSubscriber` (handles thread, restriction, logging)

## Active Decisions & Considerations

### Current Technical Decisions

1.  **Service Responsibility Separation**: Further refined through EDA. Detection is separate from action initiation, which is separate from side effect handling.
2.  **Dependency Injection Implementation**: Stable with InversifyJS.
3.  **GPT Usage Optimization**: Strategy remains the same.
4.  **Admin Notification Format**: Strategy remains the same.
5.  **Verification Channel Structure**: Strategy remains the same.
6.  **Database Error Handling**: Strategy remains the same.
7.  **Server Configuration Management**: Stable with `/config` command and database persistence.
8.  **Repository Testing Strategy**: Still pending implementation.
9.  **Repository Pattern Implementation (Prisma)**: Stable.
10. **Event-Driven Flow**: Expanded significantly.
    - Detection results trigger `UserDetectedSuspicious`.
    - Security actions initiate `VerificationStarted` or `AdditionalSuspicionDetected`.
    - Admin commands/buttons trigger `Admin...Requested` events.
    - Core service logic (verify/ban) publishes result events (`UserVerified`, `UserBanned`).
    - Side effects (role changes, notifications, logging, status updates) handled by dedicated subscribers reacting to result events.

### Open Questions & Considerations

1.  **Database Schema Design**: Still need to fully implement and utilize `users` and `server_members` for cross-server features.
2.  **Performance Optimization**: Rate limiting, potential queuing still needed.
3.  **Deployment Strategy**: Still pending.
4.  **Interaction Replies**: How should subscribers handle replying to interactions (e.g., confirming a ban request was processed)? A dedicated `InteractionReplySubscriber` might be needed.
5.  **Error Handling in Event Flows**: Need robust error handling within subscribers. What happens if a subscriber fails? Retry logic? Dead-letter queue?
6.  **`VerificationService` Role**: Review if this service is still needed or if its logic can be fully absorbed by repositories/subscribers.

## Next Steps

### Immediate Tasks

1.  **Enhance Testing Coverage**:

    - ✅ Basic unit tests for services
    - ✅ Mock implementations for external dependencies
    - ⏳ Add tests for Prisma repositories (using mocking).
    - ✅ Add tests for error handling scenarios
    - ✅ Add integration tests for InversifyJS container
    - ✅ Implement test utilities for dependency injection
    - ⏳ Add integration tests for new EDA flows (e.g., `UserDetectedSuspicious` -> `SecurityActionService` -> `VerificationStarted` -> Subscribers).
    - ⏳ Add performance tests for high-volume scenarios.

2.  **Documentation Updates**:

    - ✅ Document Supabase error handling best practices
    - ✅ Document server configuration command
    - ✅ Document InversifyJS testing approach (Note: Needs review based on actual test setup)
    - ✅ Updated Memory Bank (`techContext.md`, `systemPatterns.md`) for Prisma migration.
    - ✅ Updated Memory Bank (`eda-events.md`, `systemPatterns.md`, `activeContext.md`) for EDA refactoring (Phases 1-3).
    - 🔄 Update `progress.md` to reflect completed EDA work.
    - 🔄 Update README with setup instructions (including Prisma).
    - 🔄 Document database schema (`prisma/schema.prisma`) and migration process (`prisma migrate dev`).
    - 🔄 Create admin guide for bot configuration.
    - 🔄 Document environment variables (`DATABASE_URL`).
    - 🔄 Create developer guide for extending the bot (including Prisma and EDA usage).

3.  **Alpha Release Critical Components**:
    - 🆕 Extend Existing Tables for Flag Functionality
      - ✅ Add flag columns to `server_members` table.
      - 🔄 Add reputation columns to `users` table.
      - 🔄 Update repository methods to support flag operations.
      - 🔄 Add migration for new columns.
      - 🔄 Add tests for flag-related operations.
    - 🔄 Thread & verification tracking
      - ✅ Create `verification_events` table.
      - ✅ Implement `VerificationEventRepository`.
      - ✅ Implement `AdminActionRepository`.
      - 🔄 Track verification outcomes.
      - 🔄 Store thread references.
      - 🔄 Add integration tests for verification flow.
    - 🔄 Polish & usability improvements
      - ⏳ Implement graceful handling for button timeout.
      - ⏳ Add visual indication of button expiration.
      - ⏳ Enhance verification instructions clarity.
      - ⏳ Improve feedback for admin actions (consider `InteractionReplySubscriber`).

### Future Enhancements

1.  **Cross-Server Reputation**:

    - Implement user tracking across servers
    - Design reputation scoring algorithm
    - Create trust network for server verification
    - Implement privacy controls for shared data
    - Add admin controls for reputation management

2.  **Web Dashboard**:

    - Design admin interface for configuration
    - Implement analytics and reporting
    - Add user management features
    - Create server-specific dashboards
    - Implement authentication and authorization

3.  **Custom AI Model**:
    - Collect training data from real spam examples
    - Fine-tune custom model for Discord-specific detection
    - Implement model versioning and updates
    - Create evaluation framework for model performance
    - Design fallback strategy for model failures

## Current Challenges

1.  **Balancing Detection Accuracy**: Ongoing tuning required.
2.  **Discord API Limitations**: Button timeouts, rate limits.
3.  **Cost Management**: GPT API usage.
4.  **Database Error Handling and Entity Relationships**: Seems stable post-Prisma migration.
5.  **InversifyJS Testing Best Practices**: Need consistent application.
6.  **Performance Optimization for Alpha Release**: Rate limiting, queuing, stress testing needed.
7.  **EDA Complexity**: Ensuring all side effects are correctly handled by subscribers and managing potential error scenarios in event chains.
