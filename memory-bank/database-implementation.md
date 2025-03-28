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

### Current Tables

The following tables are currently implemented in the schema:

```sql
-- Servers table (guild configuration)
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

COMMENT ON TABLE servers IS 'Discord servers where the bot is installed';
```

### Planned Tables

The following tables are defined in the schema but not yet fully utilized:

```sql
-- Users table
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

COMMENT ON TABLE users IS 'Discord users across all servers';
COMMENT ON COLUMN users.global_reputation_score IS 'Cross-server reputation score (higher is more trusted)';
```

```sql
-- Server members (users in specific servers)
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

CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);

COMMENT ON TABLE server_members IS 'Mapping table for users in specific Discord servers';
```

The following tables are planned for future implementation:

```sql
-- Detection events
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

COMMENT ON TABLE detection_events IS 'Records of spam detection incidents';
```

```sql
-- Messages (for suspicious users)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  content TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  channel_id TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::JSONB,
  UNIQUE(server_id, message_id)
);

CREATE INDEX idx_messages_server ON messages(server_id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_date ON messages(sent_at);

COMMENT ON TABLE messages IS 'Message content for flagged users (limited retention)';
```

```sql
-- Verification threads
CREATE TABLE IF NOT EXISTS verification_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  outcome TEXT, -- 'Verified', 'Banned', 'Timeout', 'Abandoned'
  admin_id TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  UNIQUE(server_id, thread_id)
);

CREATE INDEX idx_verification_threads_server ON verification_threads(server_id);
CREATE INDEX idx_verification_threads_user ON verification_threads(user_id);

COMMENT ON TABLE verification_threads IS 'Verification threads for suspicious users';
```

```sql
-- Analytics
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
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

CREATE INDEX idx_analytics_server ON analytics(server_id);
CREATE INDEX idx_analytics_date ON analytics(date);

COMMENT ON TABLE analytics IS 'Daily aggregated metrics per server';
```

```sql
-- Server trust network
CREATE TABLE IF NOT EXISTS server_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  target_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- 'Trust', 'Distrust', 'Neutral'
  trust_level INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Discord ID of admin who created relationship
  UNIQUE(source_server_id, target_server_id)
);

CREATE INDEX idx_server_relationships_source ON server_relationships(source_server_id);
CREATE INDEX idx_server_relationships_target ON server_relationships(target_server_id);

COMMENT ON TABLE server_relationships IS 'Trust relationships between servers';
```

```sql
-- Training data
CREATE TABLE IF NOT EXISTS training_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT,
  context JSONB,
  label TEXT, -- 'SPAM', 'NOT_SPAM', 'UNCERTAIN'
  labeled_by TEXT,
  labeled_at TIMESTAMP WITH TIME ZONE,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  quality_score INTEGER, -- 1-5, higher is better training data
  metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_training_data_server ON training_data(server_id);
CREATE INDEX idx_training_data_label ON training_data(label);
CREATE INDEX idx_training_data_quality ON training_data(quality_score);

COMMENT ON TABLE training_data IS 'Collected data for future model training';
```

```sql
-- GPT usage tracking
CREATE TABLE gpt_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
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

CREATE INDEX idx_gpt_usage_server ON gpt_usage(server_id);
CREATE INDEX idx_gpt_usage_date ON gpt_usage(timestamp);

COMMENT ON TABLE gpt_usage IS 'Tracks GPT API usage for cost analysis';
```

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
  - 🔄 Implement integration tests for repositories (basic tests only)
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
- 🔄 User repository
  - ✅ Create users table schema with Discord metadata
  - 🔄 Implement user lookup and creation
  - 🔄 Add methods for user history
  - ⏳ Create unit tests with proper isolation
  - ⏳ Add integration tests for user workflows
- ✅ Configuration management service
  - ✅ Create service for managing server configurations
  - ✅ Implement fallback to defaults
  - ✅ Add validation logic
  - ✅ Create unit tests with proper abstraction levels
  - 🔄 Add integration tests for config persistence
  - 🔄 Document configuration flow and test cases
- 🔄 User management service
  - 🔄 Create service for user operations
  - 🔄 Add methods for tracking user status
  - 🔄 Implement user reputation calculation
  - 🔄 Create unit tests with mock implementations
  - 🔄 Add integration tests for user workflows

### Chunk H3: Detection History & Flagging

- 🔄 Detection events repository
  - ⏳ Create detection_events table
  - 🔄 Implement methods to record detection outcomes
  - 🔄 Add querying capabilities
  - ⏳ Create unit tests with proper isolation
  - ⏳ Add performance tests for high-volume scenarios
- 🔄 User flags repository
  - ⏳ Create user_flags table
  - 🔄 Add methods for flag management
  - 🔄 Implement flag history and status tracking
  - ⏳ Create unit tests with transaction rollbacks
  - ⏳ Add integration tests for flag workflows
- 🔄 DetectionOrchestrator integration
  - 🔄 Update orchestrator to use repositories
  - 🔄 Store detection results
  - ⏳ Retrieve historical data for context
  - 🔄 Create unit tests with proper mocking
  - 🔄 Add integration tests for full detection flow
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