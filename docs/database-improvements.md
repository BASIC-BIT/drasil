# Database Improvements

This document outlines potential improvements to our database schema for future consideration.

## Type Safety Improvements

### Additional Enums

```sql
-- Action types for admin actions
CREATE TYPE admin_action_type AS ENUM (
  'verify',
  'reject',
  'ban',
  'reopen',
  'create_thread'
);

-- Detection types for better type safety
CREATE TYPE detection_type AS ENUM (
  'message_frequency',
  'suspicious_content',
  'gpt_analysis',
  'new_account',
  'pattern_match'
);
```

## Audit Trail Improvements

### Audit Logs Table

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  changed_by TEXT NOT NULL, -- Discord ID
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  old_values JSONB,
  new_values JSONB
);
```

### Additional Audit Fields

Add to relevant tables:

```sql
created_by TEXT NOT NULL, -- Discord ID of who created the record
updated_by TEXT, -- Discord ID of who last updated the record
deleted_at TIMESTAMP WITH TIME ZONE,
deleted_by TEXT
```

## Data Validation

### Check Constraints

```sql
-- For detection_events
ALTER TABLE detection_events
  ADD CONSTRAINT chk_confidence_range
  CHECK (confidence >= 0.0 AND confidence <= 1.0);

-- For server_members and users
ALTER TABLE server_members
  ADD CONSTRAINT chk_reputation_range
  CHECK (reputation_score >= -1.0 AND reputation_score <= 1.0);
```

## Message Tracking

### Messages Table

```sql
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  content_hash TEXT, -- Store hash of content for privacy
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by TEXT,
  metadata JSONB DEFAULT '{}'::JSONB,
  UNIQUE(server_id, message_id)
);
```

## Configuration History

### Server Config History Table

```sql
CREATE TABLE IF NOT EXISTS server_config_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  old_settings JSONB,
  new_settings JSONB
);
```

## Performance Improvements

### Additional Indexes

```sql
-- Composite indexes for common query patterns
CREATE INDEX idx_verification_events_user_server_status
  ON verification_events(user_id, server_id, status);

CREATE INDEX idx_detection_events_user_server_type
  ON detection_events(user_id, server_id, detection_type);
```

## Implementation Priority

1. **High Priority**

   - ENUMs for type safety
   - Check constraints for data validation
   - Composite indexes for performance

2. **Medium Priority**

   - Messages table for better message tracking
   - Additional audit fields
   - Server config history

3. **Low Priority**
   - Full audit logs table
   - Soft delete support
   - Additional indexes

## Considerations

- Each improvement should be evaluated based on:

  - Impact on application performance
  - Development overhead
  - Maintenance complexity
  - Storage requirements
  - Query patterns
  - Backup and recovery implications

- Changes should be implemented gradually with proper testing
- Consider feature flags for gradual rollout
- Ensure backward compatibility
- Plan for data migration where needed
