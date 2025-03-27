# Database Persistence Implementation Plan

## Overview

This plan outlines the step-by-step process for converting our Discord anti-spam bot to be fully stateful using Supabase as the database backend. We'll transform the current in-memory system to store configuration, track suspicious users, collect analytics, and gather training data for future model improvements.

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

## Implementation Chunks

### Chunk H1: Supabase Setup & Infrastructure

1. **H1.1: Supabase Project Creation**

   - Create Supabase project
   - Configure authentication settings
   - Document API keys and endpoints

2. **H1.2: Database Schema Design**

   - Design schema for all required tables
   - Document relationships and constraints
   - Create migration scripts

3. **H1.3: Repository Layer Setup**

   - Create base repository interfaces
   - Implement connection management
   - Add error handling and retries

4. **H1.4: Testing Infrastructure**
   - Set up test database
   - Create mock repositories for testing
   - Implement integration tests

### Chunk H2: Core Entity Management

1. **H2.1: Server Configuration Repository**

   - Create servers table
   - Implement CRUD operations
   - Add caching for frequently accessed configuration

2. **H2.2: User Repository**

   - Create users table with Discord metadata
   - Implement user lookup and creation
   - Add methods for user history

3. **H2.3: Configuration Management Service**

   - Create service for managing server configurations
   - Implement fallback to defaults
   - Add validation logic

4. **H2.4: User Management Service**
   - Create service for user operations
   - Add methods for tracking user status
   - Implement user reputation calculation

### Chunk H3: Detection History & Flagging

1. **H3.1: Detection Events Repository**

   - Create detection_events table
   - Implement methods to record detection outcomes
   - Add querying capabilities

2. **H3.2: User Flags Repository**

   - Create user_flags table
   - Add methods for flag management
   - Implement flag history and status tracking

3. **H3.3: DetectionOrchestrator Integration**

   - Update orchestrator to use repositories
   - Store detection results
   - Retrieve historical data for context

4. **H3.4: Thread & Verification Tracking**
   - Create verification_threads table
   - Track verification outcomes
   - Store thread references

### Chunk H4: Message & Context Storage

1. **H4.1: Message Repository**

   - Create messages table for flagged messages
   - Implement privacy-focused retention policies
   - Add message metadata storage

2. **H4.2: Context Repository**

   - Create context table for GPT prompts/responses
   - Store relevant conversation context
   - Implement context retrieval methods

3. **H4.3: GPTService Integration**

   - Update GPT service to store prompts and responses
   - Retrieve historical contexts
   - Track token usage

4. **H4.4: HeuristicService Integration**
   - Update heuristic service to use repositories
   - Store heuristic check results
   - Track heuristic effectiveness

### Chunk H5: Analytics & Insights

1. **H5.1: Analytics Repository**

   - Create analytics tables
   - Implement aggregation methods
   - Add time-series capabilities

2. **H5.2: Analytics Service**

   - Create service for analytics collection
   - Implement metric calculations
   - Add periodic aggregation jobs

3. **H5.3: Admin Commands for Analytics**

   - Create /stats command
   - Implement analytics visualizations
   - Add filtering capabilities

4. **H5.4: Performance Metrics**
   - Track response times
   - Monitor resource usage
   - Record API call statistics

### Chunk H6: Environment Transition

1. **H6.1: Config Migration Tool**

   - Create tool to migrate env vars to database
   - Support bulk imports
   - Add validation and logging

2. **H6.2: Configuration UI**

   - Add Discord commands for configuration
   - Implement configuration verification
   - Add help documentation

3. **H6.3: Backup & Restore**

   - Implement database backup procedures
   - Create restore functionality
   - Add scheduling for regular backups

4. **H6.4: Environment Detection**
   - Add environment awareness (dev/test/prod)
   - Implement appropriate logging levels
   - Configure fallbacks for each environment

### Chunk H7: Multi-Server Intelligence

1. **H7.1: Cross-Server Schema Extensions**

   - Add server relationship tables
   - Implement trust networks
   - Create shared intelligence tables

2. **H7.2: Trust Network Service**

   - Create service for managing server relationships
   - Implement trust calculation
   - Add verification methods

3. **H7.3: Shared Intelligence**

   - Create methods for sharing flagged users
   - Implement privacy controls
   - Add opt-in/opt-out functionality

4. **H7.4: Network Admin Commands**
   - Add network management commands
   - Implement network visualization
   - Create network statistics

### Chunk H8: Training Data Collection

1. **H8.1: Training Data Repository**

   - Create training_data table
   - Implement data collection methods
   - Add labeling capabilities

2. **H8.2: Admin Labeling Interface**

   - Add commands for labeling data
   - Implement bulk labeling
   - Create export functionality

3. **H8.3: Automated Collection**

   - Implement automatic data collection
   - Add privacy filtering
   - Create periodic cleanup jobs

4. **H8.4: Export & Training Pipeline**
   - Create data export functionality
   - Implement transformation for model training
   - Add scheduling for regular exports

## Detailed Implementation Strategy

### Phase 1: Foundation (H1 + H2)

Focus on setting up Supabase and implementing the core repositories and services needed to store basic configuration and user data.

1. **Week 1: Infrastructure Setup**

   - Set up Supabase project
   - Design initial schema
   - Create base repository layer

2. **Week 2: Core Entity Implementation**
   - Implement server configuration storage
   - Add user tracking
   - Create basic services
   - Update bot to use stored configuration

### Phase 2: Detection System (H3 + H4)

Enhance the detection system to store and retrieve historical data for improved accuracy.

1. **Week 3: Detection Storage**

   - Implement detection event storage
   - Add flag tracking
   - Update orchestrator to use historical data

2. **Week 4: Context Enhancement**
   - Store message data
   - Add context tracking
   - Enhance GPT service with historical context
   - Update heuristic service to use stored data

### Phase 3: Analytics & Insights (H5)

Add analytics to track bot performance and provide insights to administrators.

1. **Week 5: Analytics Foundation**

   - Implement analytics tables
   - Create analytics service
   - Add basic metric collection

2. **Week 6: Visualization & Reporting**
   - Create admin stats commands
   - Implement visualization
   - Add performance tracking

### Phase 4: Advanced Features (H6 + H7 + H8)

Implement more advanced features for multi-server support and training data collection.

1. **Week 7: Environmental Transition**

   - Create migration tools
   - Implement configuration UI
   - Add backup functionality

2. **Week 8: Multi-Server Support**

   - Implement cross-server schema
   - Create trust network
   - Add shared intelligence

3. **Week 9: Training Data**
   - Implement training data collection
   - Add labeling interface
   - Create export pipeline

## Database Schema

```sql
-- Servers table (guild configuration)
CREATE TABLE servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT UNIQUE NOT NULL,
  restricted_role_id TEXT,
  admin_channel_id TEXT,
  verification_channel_id TEXT,
  admin_notification_role_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{}'::JSONB
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  discord_id TEXT NOT NULL,
  username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Server members (users in specific servers)
CREATE TABLE server_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  join_date TIMESTAMP WITH TIME ZONE,
  reputation_score REAL DEFAULT 0.0,
  is_restricted BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(server_id, user_id)
);

-- Detection events
CREATE TABLE detection_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT,
  detection_type TEXT NOT NULL,
  confidence REAL,
  reasons TEXT[],
  used_gpt BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Messages (for suspicious users)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  content TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  channel_id TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Verification threads
CREATE TABLE verification_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE,
  outcome TEXT,
  admin_id TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Analytics
CREATE TABLE analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  detection_count INTEGER DEFAULT 0,
  verification_count INTEGER DEFAULT 0,
  ban_count INTEGER DEFAULT 0,
  gpt_call_count INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  join_count INTEGER DEFAULT 0,
  metrics JSONB DEFAULT '{}'::JSONB,
  UNIQUE(server_id, date)
);

-- Server trust network
CREATE TABLE server_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  target_server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  trust_level INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(source_server_id, target_server_id)
);

-- Training data
CREATE TABLE training_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  content TEXT,
  context JSONB,
  label TEXT,
  labeled_by TEXT,
  labeled_at TIMESTAMP WITH TIME ZONE,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::JSONB
);
```

## Migration Strategy

1. **Step 1: Parallel Operation**

   - Run database alongside environment variables
   - Read from database, fall back to environment variables
   - Log discrepancies

2. **Step 2: Write Everywhere**

   - Write to both database and memory
   - Validate consistency
   - Prefer database for reads

3. **Step 3: Database Primary**

   - Make database the primary source
   - Keep environment variables as fallback
   - Add migration warnings

4. **Step 4: Full Migration**
   - Remove environment variable fallbacks
   - Use database exclusively
   - Provide migration guide for users

## Code Structure Changes

1. **Repository Layer**

   - Create `/src/repositories` directory
   - Add base repository interface
   - Implement concrete repositories for each entity

2. **Service Layer Updates**

   - Inject repositories into services
   - Update methods to use persistent storage
   - Add caching where appropriate

3. **Configuration Management**

   - Create configuration service
   - Add initialization from database
   - Implement real-time updates

4. **Command Updates**
   - Add database-aware commands
   - Update response formatting
   - Add configuration commands

## Testing Strategy

1. **Unit Tests**

   - Mock repositories for service tests
   - Test database operations in isolation
   - Validate edge cases

2. **Integration Tests**

   - Use test database for integration testing
   - Test full workflows with persistence
   - Validate data consistency

3. **Migration Tests**
   - Test fallback mechanism
   - Validate configuration migration
   - Test error recovery

## Rollout Plan

1. **Alpha Release**

   - Implement core persistence (H1, H2)
   - Test with limited users
   - Gather feedback on database performance

2. **Beta Release**

   - Add remaining critical features (H3, H4, H5)
   - Expand testing group
   - Monitor performance and make adjustments

3. **Full Release**

   - Complete all planned features
   - Migrate existing users
   - Monitor and support transition

4. **Feature Rollout**
   - Add advanced features incrementally
   - Gather user feedback for each feature
   - Adjust based on real-world usage

## Future Considerations

1. **Scaling**

   - Monitor database performance as user base grows
   - Implement additional caching as needed
   - Consider sharding for very large installations

2. **Analytics Dashboard**

   - Create web interface for analytics
   - Add custom report generation
   - Implement visualizations

3. **Advanced Intelligence**

   - Use collected data to train custom models
   - Implement more sophisticated detection algorithms
   - Add behavior analysis capabilities

4. **Privacy Controls**
   - Implement granular data retention policies
   - Add user data anonymization
   - Create data export/deletion capabilities
