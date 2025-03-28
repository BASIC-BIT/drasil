# InversifyJS Implementation Plan

This document outlines our plan for implementing Inversify dependency injection into the project.

## Why Dependency Injection?

- Better testability: Dependencies can be easily mocked during testing
- Loose coupling: Components depend on abstractions, not concrete implementations
- Better maintainability: Constructor injection makes dependencies explicit

## Implementation Checklist

### Setup

- [x] Install dependencies (`inversify`, `reflect-metadata`)
- [x] Configure TypeScript for decorators (update `tsconfig.json`)
- [x] Create DI directory structure (`src/di`)
- [x] Define DI symbols (`src/di/symbols.ts`)
- [x] Setup container (`src/di/container.ts`)
- [x] Update index.ts - Initialize container and get Bot instance
- [x] Add decorators to existing classes - Add `@injectable()` decorator to all classes
- [x] Update tsconfig.json - Configure emitDecoratorMetadata and experimentalDecorators

### Core Infrastructure

- [x] Set up BaseRepository with DI
- [x] Update SupabaseRepository to use DI
- [x] Create ConfigService interface and implementation
- [x] Create example entry point (src/index.ts.example)
- [x] Setup test container configuration (for unit tests)
- [x] Update `SupabaseRepository.ts` - Make client injectable

### Service Interfaces

- [x] Update HeuristicService to use DI
- [x] Update GPTService interface and implementation
- [x] Update DetectionOrchestrator to use DI
- [x] Update NotificationManager
- [x] Update RoleManager
- [x] Define and implement `IHeuristicService`
- [x] Define and implement `IGPTService`
- [x] Define and implement `IDetectionOrchestrator`
- [x] Define and implement `IRoleManager`
- [x] Define and implement `INotificationManager`
- [x] Define and implement `IConfigService`
- [x] Define and implement `IUserService`
- [ ] Define and implement `ICommandHandler`
- [ ] Define and implement `IEventHandler`

### Repository Interfaces

- [x] ServerRepository
- [x] UserRepository
- [x] ServerMemberRepository
- [x] DetectionEventsRepository
- [x] Define and implement `IBaseRepository`
- [x] Define and implement `ISupabaseRepository`
- [x] Define and implement `IServerRepository`
- [x] Define and implement `IUserRepository`
- [x] Define and implement `IServerMemberRepository`
- [x] Define and implement `IDetectionEventsRepository`

### Discord Integration

- [x] Refactor Bot class to use DI
- [ ] Add CommandHandler using DI
- [ ] Add EventHandler using DI
- [x] Define and implement `IBot`
- [ ] Update `ClientProvider` to be injectable (or remove it)

### Documentation

- [ ] Update README with DI instructions
- [ ] Add documentation for testing with DI
- [ ] Update README.md with architectural overview
- [ ] Add examples of dependency injection usage

## Implementation Notes

- We've decided to co-locate interfaces with their implementations rather than having a separate interfaces directory
- We'll use the existing database types from `repositories/types.ts` rather than duplicating them
- Removed the separate interfaces directory in favor of co-locating interfaces with their implementations

## Next Steps

1. Add CommandHandler and EventHandler implementations
2. Complete final container configuration
3. Update tests to use the test container
4. Create documentation for DI usage

## Progress Made

We've successfully set up the InversifyJS framework and started refactoring our services and repositories to use dependency injection. Key achievements:

1. **Core Infrastructure**: We've set up the DI container, symbols, and BaseRepository with the necessary decorators

2. **Service Refactoring**: We've updated all services including HeuristicService, GPTService, RoleManager, NotificationManager, DetectionOrchestrator and the Bot class to use interfaces and dependency injection

3. **Repository Refactoring**: We've updated all repository implementations to use constructor injection for dependencies

4. **Architectural Improvements**:

   - Co-located interfaces with their implementations for better organization
   - Used existing types from repositories/types.ts to avoid duplication
   - Created a test container configuration for easy unit testing

5. **Example Files**:
   - Created a sample index.ts showing how to use the container
   - Created a test container setup example for writing tests

The refactoring has enhanced:

- **Testability**: All dependencies can now be mocked easily
- **Maintainability**: Constructor injection makes dependencies explicit
- **Decoupling**: Services depend on abstractions rather than concrete implementations

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
import { RoleManager, IRoleManager } from '../services/RoleManager';
import { NotificationManager, INotificationManager } from '../services/NotificationManager';
import { ServerRepository, IServerRepository } from '../repositories/ServerRepository';
import { UserRepository, IUserRepository } from '../repositories/UserRepository';
import {
  ServerMemberRepository,
  IServerMemberRepository,
} from '../repositories/ServerMemberRepository';
import {
  DetectionEventsRepository,
  IDetectionEventsRepository,
} from '../repositories/DetectionEventsRepository';
// other imports...

export function configureContainer(): Container {
  const container = new Container();

  // Bind services
  container.bind<IHeuristicService>(TYPES.HeuristicService).to(HeuristicService).inSingletonScope();
  container.bind<IGPTService>(TYPES.GPTService).to(GPTService).inSingletonScope();
  container.bind<IRoleManager>(TYPES.RoleManager).to(RoleManager).inSingletonScope();
  container
    .bind<INotificationManager>(TYPES.NotificationManager)
    .to(NotificationManager)
    .inSingletonScope();

  // Bind repositories
  container.bind<IServerRepository>(TYPES.ServerRepository).to(ServerRepository).inSingletonScope();
  container.bind<IUserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();
  container
    .bind<IServerMemberRepository>(TYPES.ServerMemberRepository)
    .to(ServerMemberRepository)
    .inSingletonScope();
  container
    .bind<IDetectionEventsRepository>(TYPES.DetectionEventsRepository)
    .to(DetectionEventsRepository)
    .inSingletonScope();
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
