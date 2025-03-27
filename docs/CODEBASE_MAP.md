# Discord Anti-Spam Bot Codebase Map

## Project Overview

This is a Discord bot designed to prevent spam and manage user verification using a combination of heuristic analysis and GPT-powered detection. The bot provides various moderation tools and automated verification processes.

## Directory Structure

```
├── src/                        # Source code directory
│   ├── __tests__/             # Test files
│   ├── __mocks__/             # Mock files for testing
│   ├── config/                # Configuration files
│   ├── services/              # Core services
│   ├── Bot.ts                 # Main bot class
│   └── index.ts               # Application entry point
├── docs/                      # Documentation
├── .env                       # Environment variables
└── configuration files        # Various config files (tsconfig.json, etc.)
```

## Core Components

### Bot.ts

The main bot class that orchestrates all functionality. Key responsibilities:

- Initializes and manages all services
- Handles Discord events (messages, member joins, interactions)
- Manages slash commands
- Coordinates verification and moderation actions
- Implements command handlers for various moderation tasks

### Services

#### DetectionOrchestrator (DetectionOrchestrator.ts)

Coordinates spam detection efforts by combining:

- Heuristic-based detection
- GPT-powered analysis
- Makes final decisions on message legitimacy
- Manages detection thresholds and scoring

#### GPTService (GPTService.ts)

Handles AI-powered message analysis:

- Integrates with GPT models
- Analyzes message content for spam patterns
- Evaluates user behavior patterns
- Provides sophisticated spam detection

#### HeuristicService (HeuristicService.ts)

Implements basic spam detection rules:

- Message frequency checking
- Pattern matching
- Basic spam indicators
- First-line rapid detection

#### RoleManager (RoleManager.ts)

Manages Discord role assignments:

- Handles verification roles
- Manages restricted user roles
- Coordinates role-based permissions
- Implements role-based moderation actions

#### NotificationManager (NotificationManager.ts)

Handles all notifications and communications:

- Sends moderation notifications
- Manages verification messages
- Handles user warnings
- Coordinates communication channels

## Configuration Files

### Environment Files

- `.env`: Active environment variables
- `.env.example`: Template for environment setup

### TypeScript Configuration

- `tsconfig.json`: Main TypeScript configuration
- `tsconfig.test.json`: Test-specific TypeScript settings
- `tsconfig.eslint.json`: ESLint TypeScript integration

### Development Configuration

- `eslint.config.mjs`: ESLint rules
- `.prettierrc`: Code formatting rules
- `jest.config.js`: Testing configuration
- `babel.config.js`: Babel configuration

## Key Interactions

1. Message Processing Flow:

   ```
   Message Received → DetectionOrchestrator
   ├── HeuristicService (Quick Check)
   └── GPTService (Deep Analysis)
   → Final Decision → Action (via Bot.ts)
   ```

2. User Verification Flow:

   ```
   New Member → Bot.ts
   ├── RoleManager (Assign Initial Roles)
   ├── NotificationManager (Send Welcome)
   └── Verification Process
   ```

3. Moderation Actions Flow:
   ```
   Command/Trigger → Bot.ts
   ├── RoleManager (Role Updates)
   ├── NotificationManager (Notifications)
   └── Action Recording
   ```

## Development Guidelines

1. Service Integration

   - Services should be loosely coupled
   - Communication through well-defined interfaces
   - Dependency injection via constructor

2. Error Handling

   - Comprehensive error catching in Bot.ts
   - Service-specific error handling
   - Graceful degradation when services fail

3. Configuration

   - Environment variables for sensitive data
   - Configuration files for behavioral settings
   - Runtime configuration via Discord commands

4. Testing
   - Unit tests in **tests** directory
   - Mocks in **mocks** directory
   - Integration tests for critical paths

## Common Patterns

1. Command Handling

   - Slash command registration
   - Permission checking
   - Response formatting
   - Error handling

2. Event Processing

   - Event listener setup
   - Async processing
   - Service coordination
   - Response management

3. User Management
   - Role assignment
   - Permission verification
   - User data tracking
   - Verification status management

## Extension Points

1. New Commands

   - Add to commands array in Bot.ts
   - Implement handler method
   - Register in Discord application

2. New Detection Methods

   - Extend DetectionOrchestrator
   - Add new service if needed
   - Integrate with existing flow

3. Custom Notifications
   - Extend NotificationManager
   - Add new message templates
   - Implement new notification methods
