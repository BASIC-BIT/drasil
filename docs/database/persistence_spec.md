# Database Specification: Discord Anti-Spam Bot

## Introduction

This document outlines the database architecture for the Discord Anti-Spam Bot using Supabase as the backend. The system is designed to be scalable, performant, and capable of supporting cross-server intelligence and future machine learning model training.

## Technology Choice: Supabase

Supabase was selected as our database solution for several reasons:

1. **Postgres Backend**: Industry-standard relational database with robust feature set
2. **Built-in Row-Level Security**: Granular security controls for multi-tenant applications
3. **Realtime Capabilities**: Support for realtime subscriptions to database changes
4. **Edge Functions**: Ability to run serverless functions close to the database
5. **Simplified API**: RESTful and GraphQL interfaces reduce development time
6. **Vector Support**: Native pgvector extension for potential AI feature expansion
7. **TypeScript Integration**: Strong TypeScript support for type safety

## Database Schema

### Core Tables

#### `servers`

Stores Discord server (guild) configurations and settings.

```sql
CREATE TABLE servers (
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
COMMENT ON COLUMN servers.settings IS 'JSON blob for flexible configuration storage (heuristic thresholds, GPT settings, etc.)';
```

#### `users`

Stores Discord user information independent of servers.

```sql
CREATE TABLE users (
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

#### `server_members`

Maps users to servers with server-specific data.

```sql
CREATE TABLE server_members (
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
COMMENT ON COLUMN server_members.reputation_score IS 'Server-specific reputation score';
```

### Detection & Verification Data

#### `detection_events`

Records spam detection events.

```sql
CREATE TABLE detection_events (
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
COMMENT ON COLUMN detection_events.confidence IS 'Percentage confidence (0-100)';
COMMENT ON COLUMN detection_events.confidence_level IS 'Human-readable confidence level';
COMMENT ON COLUMN detection_events.reasons IS 'Array of reasons for flagging';
```

#### `messages`

Stores message content for flagged users (limited retention).

```sql
CREATE TABLE messages (
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

#### `verification_threads`

Tracks verification thread status and outcomes.

```sql
CREATE TABLE verification_threads (
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

### Analytics & Telemetry

#### `analytics`

Daily aggregated metrics per server.

```sql
CREATE TABLE analytics (
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
COMMENT ON COLUMN analytics.metrics IS 'Additional metrics as JSON';
```

#### `gpt_usage`

Tracks GPT API usage for cost analysis and optimization.

```sql
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

### Advanced Features

#### `server_relationships`

Defines trust relationships between servers.

```sql
CREATE TABLE server_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  target_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL, -- 'Trust', 'Distrust', 'Neutral'
  trust_level INTEGER DEFAULT 0, -- -100 to 100
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Discord ID of admin who created relationship
  UNIQUE(source_server_id, target_server_id)
);

CREATE INDEX idx_server_relationships_source ON server_relationships(source_server_id);
CREATE INDEX idx_server_relationships_target ON server_relationships(target_server_id);

COMMENT ON TABLE server_relationships IS 'Trust relationships between servers';
```

#### `training_data`

Collected data for future model training.

```sql
CREATE TABLE training_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT,
  context JSONB,
  label TEXT, -- 'SPAM', 'NOT_SPAM', 'UNCERTAIN'
  labeled_by TEXT, -- Discord ID of admin who labeled
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

## Migration Path

The database will be implemented in phases:

1. **Phase 1**: Core tables (servers, users, server_members)
2. **Phase 2**: Detection and verification tables (detection_events, messages, verification_threads)
3. **Phase 3**: Analytics and telemetry (analytics, gpt_usage)
4. **Phase 4**: Advanced features (server_relationships, training_data)

## Environment-Specific Considerations

### Development Environment

- Separate development database with sample data
- Relaxed retention policies
- Debug-level logging

### Production Environment

- Strict security policies
- Optimized performance configurations
- Comprehensive backup strategy
- Limited access controls

## Future Considerations

1. **Scaling Strategy**: Approach for handling increased load as the bot grows
2. **Vector Storage**: Potential use of pgvector for semantic content matching
3. **ML Integration**: Infrastructure for model training and deployment
4. **Data Export**: Tools for extracting analytics for external processing
5. **API Extensions**: Potential for exposing analytics via external API
