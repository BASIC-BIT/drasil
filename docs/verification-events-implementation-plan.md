# Discord Anti-Spam Bot: Verification Events Implementation Plan

## Overview

This document outlines the implementation plan for improving the verification system in the Discord Anti-Spam Bot. The plan includes creating dedicated tables for verification events and admin actions, implementing corresponding repositories and services, and enhancing the user interface for better administration experiences.

## Current Limitations

1. **Limited Verification Tracking**: Currently, the system stores verification status directly in the `server_members` table, without dedicated event tracking.

2. **Incomplete Action History**: When administrators verify a user, all interaction buttons are removed, including the "View Full History" button.

3. **No Resolution Details**: The history doesn't include information about who resolved a verification event or what the resolution was.

4. **Limited Recovery Options**: There's no way to "re-open" a verification case if a user was accidentally verified.

5. **Scattered Action Logging**: Admin actions are recorded in various places rather than in a centralized, queryable location.

## Implementation Goals

1. **Comprehensive Event Tracking**: Create dedicated tables for verification events and admin actions.

2. **Enhanced UI/UX**: Maintain useful buttons after verification and add new functionality (re-open).

3. **Complete Audit Trail**: Record all admin actions with attribution and timestamps.

4. **Improved Recovery**: Allow admins to reverse decisions when needed.

5. **Better Data Organization**: Separate concerns by moving verification status tracking to a dedicated table.

## Database Schema Changes

### New Tables

1. **Verification Events Table**

```sql
CREATE TABLE IF NOT EXISTS verification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  thread_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL, -- 'pending', 'verified', 'rejected', 'reopened'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_verification_events_server ON verification_events(server_id);
CREATE INDEX idx_verification_events_user ON verification_events(user_id);
CREATE INDEX idx_verification_events_detection ON verification_events(detection_event_id);
CREATE INDEX idx_verification_events_status ON verification_events(status);
```

2. **Admin Actions Table**

```sql
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL, -- Discord ID of admin who took action
  verification_event_id UUID REFERENCES verification_events(id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, -- 'verify', 'reject', 'ban', 'reopen', 'create_thread', etc.
  action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  previous_status TEXT, -- Status before this action
  new_status TEXT, -- Status after this action
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_admin_actions_server ON admin_actions(server_id);
CREATE INDEX idx_admin_actions_user ON admin_actions(user_id);
CREATE INDEX idx_admin_actions_admin ON admin_actions(admin_id);
CREATE INDEX idx_admin_actions_verification ON admin_actions(verification_event_id);
CREATE INDEX idx_admin_actions_detection ON admin_actions(detection_event_id);
```

### Schema Migration

Create a new migration file in `supabase/migrations/` with timestamp:

```sql
-- Migration: Add verification_events and admin_actions tables

-- Create verification_events table
CREATE TABLE IF NOT EXISTS verification_events (
  -- Schema as defined above
);

-- Create admin_actions table
CREATE TABLE IF NOT EXISTS admin_actions (
  -- Schema as defined above
);

-- Add reference columns to existing tables
ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS latest_verification_event_id UUID REFERENCES verification_events(id) ON DELETE SET NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_verification_events_server ON verification_events(server_id);
-- Additional indexes as defined above

-- Comment tables and columns
COMMENT ON TABLE verification_events IS 'Tracks verification events for suspicious users';
COMMENT ON TABLE admin_actions IS 'Records all admin actions for audit and accountability';
```

## Repository Implementations

### 1. VerificationEventRepository

```typescript
export interface IVerificationEventRepository extends BaseRepository<VerificationEvent> {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<VerificationEvent[]>;
  findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null>;
  findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]>;
  createFromDetection(
    detectionEventId: string,
    status: VerificationStatus
  ): Promise<VerificationEvent>;
  updateStatus(
    id: string,
    status: VerificationStatus,
    adminId?: string,
    notes?: string
  ): Promise<VerificationEvent>;
  getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]>;
}

@injectable()
export class VerificationEventRepository
  extends SupabaseRepository<VerificationEvent>
  implements IVerificationEventRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabase: SupabaseClient) {
    super(supabase, 'verification_events');
  }

  // Implementation of interface methods...
}
```

### 2. AdminActionRepository

```typescript
export interface IAdminActionRepository extends BaseRepository<AdminAction> {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]>;
  createAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionHistory(userId: string, serverId: string): Promise<AdminAction[]>;
}

@injectable()
export class AdminActionRepository
  extends SupabaseRepository<AdminAction>
  implements IAdminActionRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabase: SupabaseClient) {
    super(supabase, 'admin_actions');
  }

  // Implementation of interface methods...
}
```

## Service Implementations

### 1. VerificationService

```typescript
export interface IVerificationService {
  createVerificationEvent(
    serverId: string,
    userId: string,
    detectionEventId: string
  ): Promise<VerificationEvent>;
  getActiveVerification(serverId: string, userId: string): Promise<VerificationEvent | null>;
  verifyUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  rejectUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  reopenVerification(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  getVerificationHistory(
    serverId: string,
    userId: string
  ): Promise<Array<VerificationEventWithActions>>;
  attachThreadToVerification(
    verificationEventId: string,
    threadId: string
  ): Promise<VerificationEvent>;
}

@injectable()
export class VerificationService implements IVerificationService {
  constructor(
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.AdminActionRepository) private adminActionRepository: IAdminActionRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.RoleManager) private roleManager: IRoleManager,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}

  // Implementation of interface methods...
}
```

### 2. AdminActionService

```typescript
export interface IAdminActionService {
  recordAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionsByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  getActionsForUser(serverId: string, userId: string): Promise<AdminAction[]>;
  getActionsByType(
    serverId: string,
    actionType: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  formatActionSummary(action: AdminAction): string;
}

@injectable()
export class AdminActionService implements IAdminActionService {
  constructor(
    @inject(TYPES.AdminActionRepository) private adminActionRepository: IAdminActionRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository
  ) {}

  // Implementation of interface methods...
}
```

## UI/UX Enhancements

### 1. Updated Button Handling

Modify the NotificationManager class to:

1. Keep the "View Full History" button after verification
2. Add a "Reopen Verification" button for verified cases
3. Update button handlers in Bot.ts

```typescript
// In NotificationManager.ts
async createAdminNotification(serverId: string, userId: string, detectionResult: DetectionResult): Promise<void> {
  // ... existing code ...

  // Create buttons
  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`verify_${userId}`)
        .setLabel('Verify User')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ban_${userId}`)
        .setLabel('Ban User')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`thread_${userId}`)
        .setLabel('Create Thread')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`history_${userId}`)
        .setLabel('View Full History')
        .setStyle(ButtonStyle.Secondary)
    );

  // ... rest of the method ...
}

// In Bot.ts
// Updated to handle verified cases
async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  // ... existing code ...

  if (action === 'verify') {
    // Verify the user
    await this.verificationService.verifyUser(
      interaction.guildId!,
      targetUserId,
      interaction.user.id,
      'Verified via button interaction'
    );

    // Get message components and filter buttons
    const message = interaction.message as Message;
    const components = message.components;

    // Keep only the history and reopen buttons
    const newRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`history_${targetUserId}`)
          .setLabel('View Full History')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`reopen_${targetUserId}`)
          .setLabel('Reopen Verification')
          .setStyle(ButtonStyle.Primary)
      );

    // Update the message with new components
    await interaction.update({
      components: [newRow]
    });

    await interaction.followUp({
      content: `User <@${targetUserId}> has been verified and can now access the server.`,
      ephemeral: true
    });
  }

  // Add handler for reopen action
  if (action === 'reopen') {
    await this.verificationService.reopenVerification(
      interaction.guildId!,
      targetUserId,
      interaction.user.id,
      'Reopened via button interaction'
    );

    // Update UI to show all buttons again
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`verify_${targetUserId}`)
          .setLabel('Verify User')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`ban_${targetUserId}`)
          .setLabel('Ban User')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`thread_${targetUserId}`)
          .setLabel('Create Thread')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`history_${targetUserId}`)
          .setLabel('View Full History')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.update({
      components: [row]
    });

    await interaction.followUp({
      content: `Verification for <@${targetUserId}> has been reopened. The user has been restricted again.`,
      ephemeral: true
    });
  }

  // ... rest of the method ...
}
```

### 2. History Display Enhancement

Update the detection history display to include verification events and admin actions:

```typescript
// In HistoryFormatter.ts or similar utility
export function formatHistoryWithResolution(
  detectionEvents: DetectionEvent[],
  verificationEvents: VerificationEvent[],
  adminActions: AdminAction[]
): string {
  let output = '# User Detection and Verification History\n\n';

  // Group events by date
  const eventsByDate = groupEventsByDate(detectionEvents, verificationEvents, adminActions);

  // Format each date group
  for (const [date, events] of Object.entries(eventsByDate)) {
    output += `## ${date}\n\n`;

    // Format events chronologically
    for (const event of events) {
      output += formatEvent(event);
      output += '\n\n';
    }
  }

  return output;
}

function formatEvent(event: any): string {
  if ('detection_type' in event) {
    // Detection event formatting
    return formatDetectionEvent(event);
  } else if ('status' in event) {
    // Verification event formatting
    return formatVerificationEvent(event);
  } else if ('action_type' in event) {
    // Admin action formatting
    return formatAdminAction(event);
  }

  return '';
}

// Helper functions for formatting each event type...
```

## Integration with Existing Systems

### 1. Update Bot.ts

```typescript
@injectable()
export class Bot implements IBot {
  constructor(
    // Existing dependencies...
    @inject(TYPES.VerificationService) private verificationService: IVerificationService,
    @inject(TYPES.AdminActionService) private adminActionService: IAdminActionService
  ) {
    // Initialization...
  }

  // Update methods to use the new services...
}
```

### 2. Update DetectionOrchestrator

```typescript
@injectable()
export class DetectionOrchestrator implements IDetectionOrchestrator {
  constructor(
    // Existing dependencies...
    @inject(TYPES.VerificationService) private verificationService: IVerificationService
  ) {}

  // Update methods to create verification events...

  private async storeDetectionResult(
    serverId: string,
    userId: string,
    result: DetectionResult,
    messageId?: string
  ): Promise<void> {
    // Existing code...

    const detectionEvent = await this.detectionEventsRepository.create(detectionEvent);

    // If suspicious, create a verification event
    if (isRestricted) {
      await this.verificationService.createVerificationEvent(serverId, userId, detectionEvent.id);
    }

    // Rest of existing code...
  }
}
```

### 3. Update Dependency Injection Container

```typescript
// In container.ts
function configureRepositories(container: Container): void {
  // Existing repositories...
  container
    .bind<IVerificationEventRepository>(TYPES.VerificationEventRepository)
    .to(VerificationEventRepository)
    .inSingletonScope();
  container
    .bind<IAdminActionRepository>(TYPES.AdminActionRepository)
    .to(AdminActionRepository)
    .inSingletonScope();
}

function configureServices(container: Container): void {
  // Existing services...
  container
    .bind<IVerificationService>(TYPES.VerificationService)
    .to(VerificationService)
    .inSingletonScope();
  container
    .bind<IAdminActionService>(TYPES.AdminActionService)
    .to(AdminActionService)
    .inSingletonScope();
}
```

### 4. Update Symbols

```typescript
// In symbols.ts
export const TYPES = {
  // Existing symbols...

  // New repositories
  VerificationEventRepository: Symbol.for('VerificationEventRepository'),
  AdminActionRepository: Symbol.for('AdminActionRepository'),

  // New services
  VerificationService: Symbol.for('VerificationService'),
  AdminActionService: Symbol.for('AdminActionService'),
};
```

## Testing Strategy

### 1. Repository Tests

Create comprehensive tests for the new repositories:

```typescript
describe('VerificationEventRepository', () => {
  let repository: IVerificationEventRepository;
  let supabase: SupabaseClient;

  beforeEach(() => {
    // Setup mocks and repository instance
  });

  afterEach(() => {
    // Clean up
    jest.clearAllMocks();
  });

  describe('findByUserAndServer', () => {
    it('should return verification events for a user in a specific server', async () => {
      // Test implementation
    });

    it('should handle error gracefully', async () => {
      // Test implementation
    });
  });

  // Additional test cases...
});

// Similar tests for AdminActionRepository
```

### 2. Service Tests

Create comprehensive tests for the new services:

```typescript
describe('VerificationService', () => {
  let service: IVerificationService;
  let mockVerificationEventRepository: jest.Mocked<IVerificationEventRepository>;
  let mockAdminActionRepository: jest.Mocked<IAdminActionRepository>;
  let mockRoleManager: jest.Mocked<IRoleManager>;
  // Other mocks...

  beforeEach(() => {
    // Setup mocks and service instance
  });

  afterEach(() => {
    // Clean up
    jest.clearAllMocks();
  });

  describe('verifyUser', () => {
    it('should verify a user and create an admin action', async () => {
      // Test implementation
    });

    it('should update server member status', async () => {
      // Test implementation
    });

    it('should handle errors gracefully', async () => {
      // Test implementation
    });
  });

  // Additional test cases...
});

// Similar tests for AdminActionService
```

### 3. Integration Tests

Create integration tests that verify the entire workflow:

```typescript
describe('Verification Flow Integration', () => {
  let container: Container;
  let bot: IBot;

  beforeEach(() => {
    // Setup test container with real implementations but mock external dependencies
    container = createServiceTestContainer(TYPES.Bot, Bot);
    bot = container.get<IBot>(TYPES.Bot);
  });

  it('should create verification event when detecting suspicious user', async () => {
    // Test implementation
  });

  it('should maintain history button when verifying user', async () => {
    // Test implementation
  });

  it('should properly reopen verification', async () => {
    // Test implementation
  });

  // Additional test cases...
});
```

## Migration Considerations

### 1. Data Migration

Create a migration script to:

1. Create verification events for existing detection events
2. Transfer existing verification statuses from server_members

```typescript
// Migration script
async function migrateExistingData(): Promise<void> {
  // Get all detection events with suspicious users
  const suspiciousDetectionEvents = await detectionEventsRepository.findMany({
    where: {
      label: 'SUSPICIOUS',
    },
  });

  // Create verification events for each detection event
  for (const detectionEvent of suspiciousDetectionEvents) {
    // Check if server member is still restricted
    const serverMember = await serverMemberRepository.findByServerAndUser(
      detectionEvent.server_id,
      detectionEvent.user_id
    );

    // Determine verification status based on current restriction
    const status = serverMember?.is_restricted
      ? VerificationStatus.PENDING
      : VerificationStatus.VERIFIED;

    // Create verification event
    await verificationEventRepository.create({
      server_id: detectionEvent.server_id,
      user_id: detectionEvent.user_id,
      detection_event_id: detectionEvent.id,
      status,
      created_at: detectionEvent.detected_at,
      updated_at: new Date(),
      resolved_at: status === VerificationStatus.VERIFIED ? new Date() : undefined,
    });

    // If there was an admin action, record it
    if (detectionEvent.admin_action && detectionEvent.admin_action_by) {
      await adminActionRepository.create({
        server_id: detectionEvent.server_id,
        user_id: detectionEvent.user_id,
        admin_id: detectionEvent.admin_action_by,
        verification_event_id: verificationEvent.id,
        detection_event_id: detectionEvent.id,
        action_type: mapActionType(detectionEvent.admin_action),
        action_at: detectionEvent.admin_action_at || new Date(),
        previous_status: VerificationStatus.PENDING,
        new_status: mapActionStatus(detectionEvent.admin_action),
      });
    }
  }
}

// Helper functions for the migration
function mapActionType(adminAction: string): string {
  // Map admin_action values to action_type values
  switch (adminAction) {
    case 'Verified':
      return 'verify';
    case 'Banned':
      return 'ban';
    default:
      return 'unknown';
  }
}

function mapActionStatus(adminAction: string): string {
  // Map admin_action values to status values
  switch (adminAction) {
    case 'Verified':
      return VerificationStatus.VERIFIED;
    case 'Banned':
      return VerificationStatus.REJECTED;
    default:
      return VerificationStatus.PENDING;
  }
}
```

### 2. Feature Flag

Use a feature flag to gradually roll out the new functionality:

```typescript
// In configService.ts or similar
interface GlobalSettings {
  // Existing settings...
  useNewVerificationFlow: boolean;
}

// Default to false initially
const defaultGlobalSettings: GlobalSettings = {
  // Existing defaults...
  useNewVerificationFlow: false,
};

// In relevant services/repositories
if (this.configService.getGlobalSettings().useNewVerificationFlow) {
  // Use new verification flow
} else {
  // Use existing flow
}
```

## Implementation Phases

### Phase 1: Database & Repository Implementation

1. Create database schema migrations for new tables
2. Implement repository classes and interfaces
3. Create entity types and validation
4. Write comprehensive tests for repositories
5. Add dependency injection bindings

### Phase 2: Service Implementation

1. Implement VerificationService and AdminActionService
2. Update existing services to use the new services
3. Create test cases for new services
4. Add dependency injection bindings

### Phase 3: UI/UX Updates

1. Update button handling in Bot.ts and NotificationManager
2. Enhance history display to include verification events and admin actions
3. Add "reopen" functionality
4. Test UI flows end-to-end

### Phase 4: Migration & Deployment

1. Create and test data migration script
2. Implement feature flag for gradual rollout
3. Deploy database changes
4. Run migration script on production
5. Enable new features incrementally

## Risks and Mitigations

### Risks

1. **Data Loss**: Existing verification statuses might be lost during migration.

   - **Mitigation**: Thorough testing of migration scripts and keeping the server_members status fields as a fallback.

2. **Service Disruption**: Changes to the verification flow could disrupt ongoing moderations.

   - **Mitigation**: Use feature flags to roll out changes gradually and carefully schedule deployment.

3. **Performance Impact**: New tables and queries might impact system performance.

   - **Mitigation**: Proper indexing, query optimization, and performance testing.

4. **UI Regression**: Changes to button handling might break existing UI flows.
   - **Mitigation**: Comprehensive end-to-end testing of UI interactions.

### Mitigations

1. **Dual-Write Approach**: Temporarily write to both old and new systems to verify consistency.
2. **Feature Flags**: Control the rollout of new features.
3. **Monitoring**: Add instrumentation to track performance and errors.
4. **Rollback Plan**: Prepare a strategy to revert changes if issues arise.

## Conclusion

This implementation plan outlines a comprehensive approach to enhancing the verification system with dedicated tables for verification events and admin actions. The plan includes schema changes, repository and service implementations, UI enhancements, testing strategies, and migration considerations.

By following this plan, we'll create a more robust, transparent, and user-friendly verification system that provides better tracking, accountability, and recovery options for administrators.
