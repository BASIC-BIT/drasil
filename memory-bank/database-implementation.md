# Discord Anti-Spam Bot: Database Implementation

## Overview

This document outlines the database implementation plan for the Discord Anti-Spam Bot, transforming it from an in-memory system to a fully stateful application using Supabase as the database backend. This enables configuration storage, user tracking, analytics collection, and training data gathering for future model improvements.

## Technology Choice: Supabase

Supabase was selected as our database solution for several reasons:

1. **Postgres Backend**: Industry-standard relational database with robust feature set
2. **Built-in Row-Level Security**: Granular security controls for multi-tenant applications
3. **Realtime Capabilities**: Support for realtime subscriptions to database changes
4. **Edge Functions**: Ability to run serverless functions close to the database
5. **Simplified API**: RESTful and GraphQL interfaces reduce development time
6. **Vector Support**: Native pgvector extension for potential AI feature expansion
7. **TypeScript Integration**: Strong TypeScript support for type safety

## Goals

1. **Configuration Storage:** Move bot configuration from environment variables to database
2. **User Tracking:** Persist suspicious user data across bot restarts
3. **Analytics Collection:** Gather metrics to demonstrate bot effectiveness
4. **Training Data:** Collect and store data for future model training
5. **Cross-Server Intelligence:** Enable information sharing across multiple Discord servers

## High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   Discord Bot   │◄───┤  Service Layer  │◄───┤ Data Repository │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                      │
                                                      │
                                              ┌───────▼───────┐
                                              │               │
                                              │   Supabase    │
                                              │               │
                                              └───────────────┘
```

## Database Schema

### Current Implementation

The database schema is implemented in a single migration file (`20250327000000_initial_schema.sql`) as the project is pre-release. This consolidated approach simplifies schema management and provides a clear starting point for the database structure.

Key tables and their relationships:

1. **servers**:
   - Primary key: guild_id (TEXT) - Using Discord guild ID directly
   - Configuration fields for roles and channels
   - JSONB settings for flexible configuration
   - Timestamps for creation and updates

2. **users**:
   - Primary key: discord_id (TEXT) - Using Discord user ID directly
   - Global reputation tracking
   - Account metadata and creation date
   - Cross-server user information

3. **server_members**:
   - Composite primary key (server_id, user_id)
   - Foreign keys to servers and users
   - Server-specific reputation and status
   - Message and activity tracking

4. **detection_events**:
   - UUID primary key
   - Links to server and user
   - Detection metadata and confidence scores
   - Admin action tracking
   - Circular reference to verification_events

5. **verification_events**:
   - UUID primary key
   - Links to detection events
   - Thread and message tracking
   - Status management (pending, verified, rejected, reopened)
   - Timestamps for lifecycle tracking

6. **admin_actions**:
   - UUID primary key
   - Links to verification events and detection events
   - Admin attribution
   - Action type and status changes
   - Audit trail metadata

### Security Implementation

- Row Level Security (RLS) enabled on all tables
- Service role policies for full access
- Proper foreign key constraints with CASCADE/SET NULL rules
- UUID generation for internal IDs

### Performance Optimization

- Strategic indexes on frequently queried columns
- Composite indexes for common query patterns
- Helper functions for common operations (e.g., get_recent_message_count)
- JSONB for flexible metadata storage

### Planned Future Tables

The following tables are planned for future implementation to enhance the bot's capabilities:

1. **messages**:
   ```sql
   CREATE TABLE IF NOT EXISTS messages (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
     message_id TEXT NOT NULL,
     content TEXT,
     sent_at TIMESTAMP WITH TIME ZONE,
     channel_id TEXT,
     is_flagged BOOLEAN DEFAULT FALSE,
     metadata JSONB DEFAULT '{}'::JSONB,
     UNIQUE(server_id, message_id)
   );
   ```
   - Purpose: Store message content for flagged users
   - Limited retention policy (7 days)
   - Used for pattern analysis and training data

2. **analytics**:
   ```sql
   CREATE TABLE IF NOT EXISTS analytics (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     date DATE NOT NULL,
     detection_count INTEGER DEFAULT 0,
     verification_count INTEGER DEFAULT 0,
     ban_count INTEGER DEFAULT 0,
     verify_count INTEGER DEFAULT 0,
     false_positive_count INTEGER DEFAULT 0,
     gpt_call_count INTEGER DEFAULT 0,
     message_count INTEGER DEFAULT 0,
     join_count INTEGER DEFAULT 0,
     metrics JSONB DEFAULT '{}'::JSONB,
     UNIQUE(server_id, date)
   );
   ```
   - Purpose: Track daily metrics per server
   - Aggregated statistics for reporting
   - Performance monitoring data

3. **server_relationships**:
   ```sql
   CREATE TABLE IF NOT EXISTS server_relationships (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     source_server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     target_server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     relationship_type TEXT NOT NULL, -- 'Trust', 'Distrust', 'Neutral'
     trust_level INTEGER DEFAULT 0,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     created_by TEXT, -- Discord ID of admin who created relationship
     UNIQUE(source_server_id, target_server_id)
   );
   ```
   - Purpose: Enable cross-server trust networks
   - Share reputation data between trusted servers
   - Collaborative spam prevention

4. **training_data**:
   ```sql
   CREATE TABLE IF NOT EXISTS training_data (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     user_id TEXT REFERENCES users(discord_id),
     content TEXT,
     context JSONB,
     label TEXT, -- 'SPAM', 'NOT_SPAM', 'UNCERTAIN'
     labeled_by TEXT,
     labeled_at TIMESTAMP WITH TIME ZONE,
     collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     quality_score INTEGER, -- 1-5, higher is better training data
     metadata JSONB DEFAULT '{}'::JSONB
   );
   ```
   - Purpose: Collect data for model training
   - Store labeled examples for future AI improvements
   - Quality scoring for training data

5. **gpt_usage**:
   ```sql
   CREATE TABLE IF NOT EXISTS gpt_usage (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
     user_id TEXT REFERENCES users(discord_id),
     timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     model TEXT NOT NULL,
     prompt_tokens INTEGER NOT NULL,
     completion_tokens INTEGER NOT NULL,
     total_tokens INTEGER NOT NULL,
     purpose TEXT, -- 'UserClassification', 'MessageAnalysis', etc.
     success BOOLEAN DEFAULT TRUE,
     latency_ms INTEGER,
     metadata JSONB DEFAULT '{}'::JSONB
   );
   ```
   - Purpose: Track GPT API usage and costs
   - Monitor performance and latency
   - Optimize token usage

These planned tables will be implemented in future migrations as the bot's features expand. Each addition will follow the same security and performance optimization patterns established in the current schema.

## Implementation Plan

The database implementation is divided into several chunks, each focusing on a specific aspect of the system:

### Chunk H1: Supabase Setup & Infrastructure

- ✅ Supabase project creation
  - ✅ Configure authentication settings
  - ✅ Document API keys and endpoints
  - ✅ Add keys to environment variables
- ✅ Database schema design
  - ✅ Document relationships and constraints
  - ✅ Create SQL migration scripts
  - ✅ Test schema with sample data
- ✅ Repository layer setup
  - ✅ Create base repository interface
  - ✅ Implement SupabaseClient connection management
  - ✅ Add error handling and retries
  - ✅ Create TypeScript types for database entities
- 🔄 Testing infrastructure
  - ⏳ Set up test database in Supabase
  - ✅ Create mock repositories for testing (ServerRepository)
  - ✅ Implement integration tests for repositories (ServerRepository, UserRepository, ServerMemberRepository)
  - ⏳ Create fixtures for test data
  - ⏳ Add test isolation strategies (unique IDs, cleanup hooks)
  - ⏳ Implement transaction-based test rollbacks

### Chunk H2: Core Entity Management

- ✅ Server configuration repository
  - ✅ Create servers table
  - ✅ Implement CRUD operations
  - ✅ Add caching for frequently accessed configuration
  - ✅ Create unit tests with proper mocking strategies
  - ✅ Add server initialization on bot startup
  - ✅ Handle new guild joins with guildCreate event
  - ✅ Add behavior-based tests for configuration flow
- ✅ User repository
  - ✅ Create users table schema with Discord metadata
  - ✅ Implement user lookup and creation
  - ✅ Add methods for global reputation management
  - ✅ Add methods for user metadata handling
  - ✅ Create comprehensive unit tests with proper isolation
  - ✅ Implement proper error handling with RepositoryError
- ✅ Server member repository
  - ✅ Create server_members table with relationships
  - ✅ Implement member lookup by server and user
  - ✅ Add methods for tracking message counts
  - ✅ Add methods for managing restriction status
  - ✅ Create comprehensive unit tests with proper mocking
  - ✅ Implement proper error handling for all operations
- ✅ Configuration management service
  - ✅ Create service for managing server configurations
  - ✅ Implement fallback to defaults
  - ✅ Add validation logic
  - ✅ Create unit tests with proper abstraction levels
  - 🔄 Add integration tests for config persistence
  - 🔄 Document configuration flow and test cases
- ✅ User management service
  - ✅ Create service for user operations
  - ✅ Add methods for tracking user status
  - ✅ Implement user reputation calculation
  - ✅ Add cross-server user management
  - ✅ Create unit tests with mock implementations
  - ✅ Handle server-specific user operations
  - ✅ Implement proper error handling

### Chunk H3: Detection History & Flagging

- ✅ Detection events repository
  - ✅ Create detection_events table
  - ✅ Implement methods to record detection outcomes
  - ✅ Add proper error handling with PostgrestError
  - ✅ Add comprehensive test coverage
  - ✅ Implement proper separation of concerns
  - ✅ Clear responsibility boundaries
  - ⏳ Add performance tests for high-volume scenarios
- ❌ User flags repository (Cancelled - integrating into existing tables)
  - ❌ Create user_flags table
  - ❌ Add methods for flag management
  - ❌ Implement flag history and status tracking
  - ❌ Create unit tests with transaction rollbacks
  - ❌ Add integration tests for flag workflows
- 🆕 Extend existing tables for flag functionality
  - 🔄 Server member flag columns
    - 🔄 Add is_restricted (boolean) column
    - 🔄 Add verification_status (enum) column
    - 🔄 Add restriction_reason (text) column
    - 🔄 Add last_status_change (timestamp) column
    - 🔄 Add moderator_id (text) column
  - 🔄 User reputation columns
    - 🔄 Add global_reputation_score (integer) column
    - 🔄 Add suspicious_server_count (integer) column
    - 🔄 Add first_flagged_at (timestamp) column
  - 🔄 Repository method updates
    - 🔄 Update ServerMemberRepository with flag methods
    - 🔄 Update UserRepository with reputation methods
    - 🔄 Add tests for new functionality
  - 🔄 Create migration for new columns
- ✅ DetectionOrchestrator integration
  - ✅ Update orchestrator to use repositories
  - ✅ Store detection results
  - ✅ Create required entities (users, server members)
  - ✅ Proper error propagation and logging
  - ⏳ Retrieve historical data for context
  - ✅ Create unit tests with proper mocking
  - ✅ Add integration tests for full detection flow
- 🔄 Thread & verification tracking
  - ⏳ Create verification_threads table
  - 🔄 Track verification outcomes
  - 🔄 Store thread references
  - ⏳ Create unit tests with cleanup hooks
  - 🔄 Add integration tests for verification flow

### Chunk H4: Message & Context Storage

- ⏳ Message repository
- ⏳ Context repository
- ⏳ GPTService integration
- ⏳ HeuristicService integration

### Chunk H5: Analytics & Insights

- ⏳ Analytics repository
- ⏳ Analytics service
- ⏳ Admin commands for analytics
- ⏳ Performance metrics

### Chunk H6: Environment Transition

- 🔄 Config migration tool
  - 🔄 Create tool to migrate env vars to database
  - ⏳ Support bulk imports
  - 🔄 Add validation and logging
  - 🔄 Create unit tests with proper isolation
  - ✅ Add integration tests for migration flows
- ✅ Configuration UI
  - ✅ Add Discord commands for configuration
  - ✅ Implement configuration verification
  - ✅ Add help documentation
  - ✅ Create unit tests with proper mocking
  - ✅ Add integration tests for UI flows
- ⏳ Backup & restore
- 🔄 Environment detection
  - 🔄 Add environment awareness (dev/test/prod)
  - 🔄 Implement appropriate logging levels
  - 🔄 Configure fallbacks for each environment
  - ✅ Create unit tests with proper isolation
  - ✅ Add integration tests for environment switching

### Chunk H7: Multi-Server Intelligence

- ⏳ Cross-server schema extensions
- ⏳ Trust network service
- ⏳ Shared intelligence
- ⏳ Network admin commands

### Chunk H8: Training Data Collection

- ⏳ Training data repository
- ⏳ Admin labeling interface
- ⏳ Automated collection
- ⏳ Export & training pipeline

## Repository Pattern Implementation

The repository pattern provides a clean abstraction for data access operations:

### BaseRepository Interface

```typescript
export interface BaseRepository<T> {
  findById(id: string): Promise<T | null>;
  findMany(filters?: any): Promise<T[]>;
  create(entity: Partial<T>): Promise<T>;
  update(id: string, entity: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}
```

### SupabaseRepository Implementation

```typescript
export class SupabaseRepository<T> implements BaseRepository<T> {
  constructor(
    protected supabase: SupabaseClient,
    protected tableName: string
  ) {}

  async findById(id: string): Promise<T | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        // Handle "not found" as a valid case
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new RepositoryError(`Error finding ${this.tableName} by ID`, error);
      }

      return data as T;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  // Other methods implementation...
}
```

### Entity-Specific Repositories

```typescript
// Server Repository
export class ServerRepository extends SupabaseRepository<ServerEntity> {
  constructor(supabase: SupabaseClient) {
    super(supabase, 'servers');
  }

  async findByGuildId(guildId: string): Promise<ServerEntity | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('guild_id', guildId)
        .single();

      if (error) {
        // Handle "not found" as a valid case
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new RepositoryError(`Error finding server by guild ID`, error);
      }

      return data as ServerEntity;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  // Other server-specific methods...
}

// User Repository
export class UserRepository extends SupabaseRepository<User> {
  constructor() {
    super('users');
  }

  async findByDiscordId(discordId: string): Promise<User | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('discord_id', discordId)
        .single();

      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }

      return (data as User) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByDiscordId');
    }
  }

  async upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User> {
    try {
      // Include the discord_id in the data
      const userData = {
        discord_id: discordId,
        ...data,
        updated_at: new Date().toISOString(),
      };

      const existing = await this.findByDiscordId(discordId);

      if (existing) {
        // Update existing user
        const { data: updated, error } = await this.supabase
          .from(this.tableName)
          .update(userData)
          .eq('discord_id', discordId)
          .select()
          .single();

        if (error) throw error;
        return updated as User;
      } else {
        // Create new user
        const { data: created, error } = await this.supabase
          .from(this.tableName)
          .insert({ ...userData, created_at: new Date().toISOString() })
          .select()
          .single();

        if (error) throw error;
        if (!created) throw new Error('Failed to create user: No data returned');

        return created as User;
      }
    } catch (error) {
      this.handleError(error as Error, 'upsertByDiscordId');
    }
  }

  // Other user-specific methods...
}

// Server Member Repository
export class ServerMemberRepository extends SupabaseRepository<ServerMember> {
  constructor() {
    super('server_members');
  }

  async findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const { data, error } = await this.supabase
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as ServerMember) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByServerAndUser');
    }
  }

  async upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember> {
    try {
      // Include the server_id and user_id in the data
      const memberData = {
        server_id: serverId,
        user_id: userId,
        ...data,
      };

      const existing = await this.findByServerAndUser(serverId, userId);

      if (existing) {
        // Update existing member
        const { data: updated, error } = await this.supabase
          .from(this.tableName)
          .update(memberData)
          .eq('server_id', serverId)
          .eq('user_id', userId)
          .select()
          .single();

        if (error) throw error;
        return updated as ServerMember;
      } else {
        // Create new member
        const { data: created, error } = await this.supabase
          .from(this.tableName)
          .insert(memberData)
          .select()
          .single();

        if (error) throw error;
        if (!created) throw new Error('Failed to create server member: No data returned');

        return created as ServerMember;
      }
    } catch (error) {
      this.handleError(error as Error, 'upsertMember');
    }
  }

  // Other server member-specific methods...
}

// Detection Events Repository
export class DetectionEventsRepository extends SupabaseRepository<DetectionEvent> {
  constructor() {
    super('detection_events');
  }

  /**
   * Create a new detection event
   * Note: This repository is only responsible for creating the event itself.
   * The DetectionOrchestrator is responsible for creating related entities.
   *
   * @param data The detection event data
   * @returns The created detection event
   */
  async create(data: Partial<DetectionEvent>): Promise<DetectionEvent> {
    try {
      if (!data.server_id || !data.user_id) {
        throw new Error('server_id and user_id are required to create a detection event');
      }

      // Create the detection event
      const { data: created, error } = await supabase
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      if (error) {
        console.error('Error creating detection event:', error);
        throw error;
      }

      if (!created) {
        throw new Error('Failed to create detection event: No data returned');
      }

      return created as DetectionEvent;
    } catch (error: unknown) {
      console.error('Exception in create detection event:', error);
      if (error instanceof Error || this.isPostgrestError(error)) {
        throw this.handleError(error, 'create');
      }
      throw error;
    }
  }

  // Other detection event specific methods...
}
```

## Detection Orchestrator

The DetectionOrchestrator is responsible for creating all required entities before creating a detection event:

```typescript
/**
 * Stores a detection result in the database
 * Ensures that user, server, and server_member records exist before creating the detection event
 *
 * @param serverId The Discord server ID
 * @param userId The Discord user ID
 * @param result The detection result
 * @param messageId Optional message ID for message detections
 */
private async storeDetectionResult(
  serverId: string,
  userId: string,
  result: DetectionResult,
  messageId?: string
): Promise<void> {
  try {
    console.log(`Storing detection result for server ${serverId}, user ${userId}`);

    // Get profile data if available from either detectMessage or detectNewJoin call
    const profileData = result.profileData;

    // Ensure server record exists
    console.log('Creating/updating server record');
    await this.serverRepository.upsertByGuildId(serverId, {});

    // Ensure user record exists with proper fields
    console.log('Creating/updating user record');
    const userData = {
      // Default values if no profile data available
      username: profileData?.username || 'Unknown User',
      account_created_at: profileData?.accountCreatedAt?.toISOString() || new Date().toISOString(),
    };

    await this.userRepository.upsertByDiscordId(userId, userData);

    // Set is_restricted to true if the result is suspicious
    const isRestricted = result.label === 'SUSPICIOUS';

    // Ensure server_member relationship exists
    console.log('Creating/updating server member record');
    await this.serverMemberRepository.upsertMember(serverId, userId, {
      join_date: profileData?.joinedServerAt?.toISOString() || new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      is_restricted: isRestricted,
      message_count: 1,
    });

    // Create the detection event
    console.log('Creating detection event');
    const detectionEvent = {
      server_id: serverId,
      user_id: userId,
      message_id: messageId,
      detection_type: result.triggerSource === 'message' ? 'MESSAGE' : 'JOIN',
      confidence: result.confidence,
      confidence_level: this.getConfidenceLevel(result.confidence),
      reasons: result.reasons,
      used_gpt: result.usedGPT,
      detected_at: new Date(),
      admin_action: undefined,
      admin_action_by: undefined,
      admin_action_at: undefined,
      metadata: {
        trigger_content: result.triggerContent,
      },
    };

    console.log('Detection event data:', JSON.stringify(detectionEvent, null, 2));

    const createdEvent = await this.detectionEventsRepository.create(detectionEvent);
    console.log('Detection event created:', createdEvent.id);

    // If suspicious, update server member record to mark as restricted
    if (isRestricted) {
      console.log('Marking user as restricted in server member record');
      await this.serverMemberRepository.updateRestrictionStatus(serverId, userId, true);
    }
  } catch (error) {
    console.error('Failed to store detection result:', error);
    // Rethrow the error so it can be handled by the caller
    throw error;
  }
}
```

## Migration Strategy

The transition from environment variables to database storage will follow these steps:

1. **Parallel Operation**:

   - Run database alongside environment variables
   - Read from database, fall back to environment variables
   - Log discrepancies

2. **Write Everywhere**:

   - Write to both database and memory
   - Validate consistency
   - Prefer database for reads

3. **Database Primary**:

   - Make database the primary source
   - Keep environment variables as fallback
   - Add migration warnings

4. **Full Migration**:
   - Remove environment variable fallbacks
   - Use database exclusively
   - Provide migration guide for users

## Testing Strategy

### Unit Testing Improvements

- ✅ Implement proper test isolation using unique IDs
- ✅ Add transaction-based rollbacks for database tests
- ✅ Create more focused, behavior-driven tests
- ✅ Improve mock implementation strategies
- ✅ Add proper cleanup hooks for all tests

### Integration Testing Enhancements

- ⏳ Set up proper test database environment
- 🔄 Implement end-to-end workflow tests
- ⏳ Add performance testing for critical paths
- ⏳ Create realistic test data scenarios
- ⏳ Add proper test isolation strategies

### CI/CD Integration

- ⏳ Set up GitHub Actions for database tests
- ⏳ Configure test environment variables
- ⏳ Add migration verification steps
- ⏳ Implement proper test reporting
- ⏳ Add performance benchmarking

**Note**: GitHub Actions for database tests have not been implemented yet. This is planned for a future iteration.

1. **Unit Tests**:

   - Mock repositories for service tests
   - Test database operations in isolation
   - Validate edge cases

2. **Integration Tests**:

   - Use test database for integration testing
   - Test full workflows with persistence
   - Validate data consistency

3. **Migration Tests**:
   - Test fallback mechanism
   - Validate configuration migration
   - Test error recovery

## Access Patterns

The database schema is optimized for the following access patterns:

1. **Server Configuration Lookup**: Fast retrieval of server settings by guild_id
2. **User Reputation Check**: Quick access to a user's reputation both globally and per-server
3. **Detection History**: Efficient retrieval of past detection events for a user
4. **Analytics Aggregation**: Optimized for time-series reporting and dashboards
5. **Cross-Server Intelligence**: Designed to enable reputation sharing across trusted servers

## Data Retention Policies

Different data types have different retention requirements:

1. **Configuration Data**: Retained indefinitely (servers, settings)
2. **User Metadata**: Retained indefinitely, with optional anonymization after long periods of inactivity
3. **Detection Events**: Retained for 90 days by default, configurable per server
4. **Message Content**: Retained for 7 days by default, then purged or anonymized
5. **Analytics Data**: Aggregated and retained indefinitely, with raw data summarized after 30 days

## Backup Strategy

1. **Daily Point-in-Time Backups**: Automated daily snapshots
2. **Continuous Incremental Backups**: Transactional logs for point-in-time recovery
3. **Disaster Recovery**: Multi-region backup strategy for critical data
4. **Backup Testing**: Monthly restoration tests to verify integrity

## Security Considerations

1. **Row-Level Security**: Implemented for multi-tenant isolation
2. **API Access Control**: Restricted API access via Supabase auth
3. **Encryption**: Data encrypted at rest and in transit
4. **Audit Logging**: All significant database operations logged for security review

## Performance Optimizations

1. **Indexes**: Strategic indexes on frequently queried columns
2. **Caching**: Application-level caching for frequent lookups
3. **JSON Storage**: Flexible JSONB columns for extensibility without schema changes
4. **Partitioning**: Time-based partitioning for large tables (analytics, detection_events)

## Deployment Milestones

- 🔄 Alpha Release (H1, H2)
  - 🔄 Basic infrastructure
  - 🔄 Core entity management
  - ✅ Initial test coverage
- 🔄 Beta Release (H3, H4, H5)
  - 🔄 Detection system
  - 🔄 Context management
  - 🔄 Basic analytics
- ⏳ Full Release (H6, H7, H8)
  - ⏳ Multi-server support
  - ⏳ Training data collection
  - ⏳ Advanced analytics
- ⏳ Post-Launch Review
  - ⏳ Performance analysis
  - ⏳ Test coverage review
  - ⏳ Documentation updates

## Future Considerations

1. **Scaling**:

   - Monitor database performance as user base grows
   - Implement additional caching as needed
   - Consider sharding for very large installations

2. **Analytics Dashboard**:

   - Create web interface for analytics
   - Add custom report generation
   - Implement visualizations

3. **Advanced Intelligence**:

   - Use collected data to train custom models
   - Implement more sophisticated detection algorithms
   - Add behavior analysis capabilities

4. **Privacy Controls**:

   - Implement granular data retention policies
   - Add user data anonymization
   - Create data export/deletion capabilities

5. **Environment-Specific Configurations**:
   - Development: Separate database with sample data, relaxed retention policies, debug-level logging
   - Production: Strict security policies, optimized performance, comprehensive backup strategy, limited access controls
