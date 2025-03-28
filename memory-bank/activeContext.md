# Discord Anti-Spam Bot: Active Context

## Current Development Focus

The project is currently focused on implementing the core functionality of the Discord Anti-Spam Bot. Based on the todo.md file and the current codebase, we have completed several key chunks of work and are now working on database integration with Supabase.

## Recent Milestones

### Completed

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

### In Progress

- 🔄 **Persistence & Logging (Supabase)**:
  - Database schema design (initial migration created)
  - Repository pattern implementation
  - Server configuration persistence
  - Caching strategy for configurations
  - Fallback to environment variables

### Pending

- ⏳ **Cross-Server & Advanced Features**:
  - User tracking across servers
  - Global reputation scores
  - Advanced behavioral analytics
  - Message history analysis
  - Detection pattern learning

## Current Architecture State

The system currently implements:

1. **Bot Core (Bot.ts)**:

   - Main orchestrator class
   - Event handling for Discord interactions
   - Service initialization and coordination
   - Command registration and processing
   - Button interaction handling
   - Server initialization and management

2. **Detection Services**:

   - **HeuristicService**: Fast, rule-based detection
   - **GPTService**: AI-powered deep analysis
   - **DetectionOrchestrator**: Combines both approaches with smart routing

3. **User Management**:

   - **RoleManager**: Restricted role assignment and removal
   - **NotificationManager**: Admin notifications and verification threads

4. **Configuration**:

   - **ConfigService**: Server-specific settings with caching
   - **GlobalConfig**: Application-wide settings
   - **Environment Variables**: Sensitive configuration

5. **Data Access**:
   - **Repository Pattern**: Abstraction for data operations
   - **Supabase Integration**: PostgreSQL database access
   - **Server Configuration**: Persistent storage for settings

## Active Decisions & Considerations

### Current Technical Decisions

1. **GPT Usage Optimization**:

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

2. **Admin Notification Format**:

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
     - Timestamp of action
     - Thread links when applicable

3. **Verification Channel Structure**:
   - Dedicated channel with specific permissions:
     - Everyone: No access (deny ViewChannel)
     - Restricted role: Can view and send messages
     - Bot: Full access for management
     - Admin roles: Full access
   - Private threads for individual verification cases
   - Initial message with verification instructions
   - Automatic thread creation for flagged new joins
   - Manual thread creation via button or command

### Open Questions & Considerations

1. **Database Schema Design**:

   - Initial schema created with three main tables:
     - servers: Guild configuration storage
     - users: Cross-server user tracking (planned)
     - server_members: User-server relationship (planned)
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

1. **Implement Supabase Integration**:

   - ✅ Set up Supabase client
   - ✅ Create initial database schema
   - ✅ Implement repository pattern for servers
   - ✅ Implement server configuration persistence
   - 🔄 Implement user and server_member repositories
   - 🔄 Add logging for flagged users and moderation actions
   - 🔄 Implement cross-server reputation tracking

2. **Enhance Testing Coverage**:

   - ✅ Basic unit tests for services
   - ✅ Mock implementations for external dependencies
   - 🔄 Add tests for Supabase repositories
   - 🔄 Improve integration tests for end-to-end flows
   - 🔄 Add tests for database operations
   - 🔄 Add tests for error handling scenarios

3. **Documentation Updates**:
   - 🔄 Update README with setup instructions
   - 🔄 Document database schema and migrations
   - 🔄 Create admin guide for bot configuration
   - 🔄 Document environment variables and configuration options
   - 🔄 Create developer guide for extending the bot

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
