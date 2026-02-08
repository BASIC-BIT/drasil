# Discord Anti-Spam Bot: Project Brief

## Project Overview

This project is an AI-powered Discord bot designed to prevent spam and manage user verification using a combination of heuristic analysis and GPT-powered detection. The bot proactively identifies suspicious users before they can cause harm, provides streamlined moderation tools, and implements an efficient verification system to help server administrators maintain a clean and safe environment.

## Core Objectives

1. **Proactive Spam Detection**:

   - Identify suspicious accounts upon joining, before they can spam
   - Analyze user profiles for suspicious patterns
   - Evaluate account age and join timing
   - Detect subtle indicators of malicious intent

2. **Hybrid Detection Approach**:

   - Combine fast heuristic rules for immediate detection
   - Leverage GPT-powered analysis for nuanced understanding
   - Implement smart orchestration between approaches
   - Provide confidence levels and reason tracking

3. **Streamlined Moderation**:

   - Deliver clear, actionable notifications to administrators
   - Offer one-click moderation actions via interactive buttons
   - Implement dedicated verification channels and threads
   - Track moderation actions for accountability

4. **Minimal Friction**:
   - Target restrictions only to suspicious users
   - Provide clear verification paths for legitimate users
   - Implement cross-server reputation for established users
   - Balance security with user experience

## Key Features

- **User Detection Events**:

  - Immediate check upon user joining server
  - Initial full-server scan upon bot onboarding
  - Periodic scans of existing users (interval configurable)
  - Triggered scans by suspicious user behavior

- **AI-Powered Analysis**:

  - GPT-4o-mini integration for sophisticated detection
  - User profile evaluation with account age analysis
  - Message content analysis for spam patterns
  - Few-shot learning with categorized examples
  - Confidence scoring for decision transparency

- **Heuristic Checks**:

  - Message frequency monitoring (>5 messages in 10 seconds)
  - Suspicious keyword detection (nitro scam, free discord nitro, etc.)
  - Pattern matching for common spam formats
  - Efficient message history tracking

- **Verification System**:

  - Automatic restricted role assignment
  - Dedicated verification channel with proper permissions
  - Private threads for individual verification cases
  - Clear verification instructions and process

- **Admin Interface**:

  - Detailed notification embeds with user information
    - Username and avatar
    - AI suspicion confidence (Low/Medium/High)
    - Trigger source (message content or join event)
    - Bullet-pointed reasons for flagging
  - Interactive buttons for one-click moderation actions
  - Action logging directly in notification messages
  - Slash commands for additional control

- **Configuration System**:

  - Server-specific settings with database persistence
  - Caching for performance optimization
  - Default configurations with environment fallbacks
  - Global settings for application-wide controls

- **Cross-Server Intelligence** (Planned):

  - User tracking across multiple servers
  - Global reputation scoring system
  - Trust network for server verification
  - Privacy controls for data sharing

- **Dependency Injection with InversifyJS**:
  - Interface-based design for all services and repositories
  - Centralized container configuration
  - Type symbols for dependency identification
  - Simplified testing with mockable dependencies

## Target Users

- **Primary**: Discord server administrators and moderators who:

  - Manage medium to large communities (500+ members)
  - Deal with frequent spam or scam attempts
  - Have limited time for manual moderation
  - Need reliable, low-maintenance protection

- **Secondary**: Communities with specific concerns:

  - Public servers vulnerable to raid attacks
  - Servers with sensitive discussions
  - Communities with verification requirements
  - Groups with limited moderation resources

- **Tertiary**: Official and brand servers:
  - Public-facing product communities
  - Support servers for software and services
  - Event-based communities with fluctuating membership
  - Multi-server networks with shared moderation

## Success Criteria

1. **Effectiveness**:

   - Significantly reduced spam incidents in protected servers
   - Proactive prevention rather than reactive cleanup
   - Successful identification of subtle spam patterns
   - Adaptability to evolving spam techniques

2. **Accuracy**:

   - Low false-positive rate for legitimate users
   - High confidence in AI-powered detection
   - Clear explanation of detection reasons
   - Continuous improvement through feedback

3. **Usability**:

   - Positive feedback from server administrators
   - Intuitive interface with minimal learning curve
   - Efficient verification process for flagged users
   - Reduced moderation workload for administrators

4. **Performance**:

   - Scalable operation across multiple servers
   - Efficient resource utilization
   - Responsive moderation actions
   - Reliable uptime and stability

5. **Technical Quality**:
   - Well-structured, maintainable codebase
   - Comprehensive error handling
   - Thorough test coverage
   - Clear documentation

## Development Approach

The project follows a test-driven, iterative development approach with clearly defined chunks of work:

1. **Project Setup and Testing Framework**:

   - TypeScript configuration
   - Jest testing framework
   - ESLint and Prettier setup
   - Basic project structure

2. **Core Discord Integration**:

   - Discord.js client setup
   - Event handling implementation
   - Slash command registration
   - Basic bot lifecycle management

3. **Detection Mechanisms**:

   - Heuristic service implementation
   - GPT service integration
   - Detection orchestrator development
   - Combined detection workflow

4. **User Management**:

   - Role management system
   - Verification process implementation
   - Admin notification system
   - Interactive button handling

5. **Persistence and Configuration**:

   - Supabase database integration
   - Repository pattern implementation
   - Configuration service development
   - Server-specific settings management

6. **Advanced Features** (Planned):
   - Cross-server reputation system
   - Web dashboard for configuration
   - Custom AI model development
   - Analytics and reporting

## Timeline

The project is being developed in iterative chunks, with each building on the previous:

- **Completed**: Project setup, Discord integration, detection mechanisms, user management, admin interface
- **In Progress**: Database integration, server configuration persistence
- **Upcoming**: Cross-server features, web dashboard, custom AI model

The detailed development roadmap is tracked in the progress.md file.

## Constraints

- **Technical Constraints**:

  - Must comply with Discord's Terms of Service and API limitations
  - Must work within Discord's rate limits and gateway requirements
  - Should handle button interaction timeout (15 minutes)
  - Must operate efficiently within memory and CPU constraints

- **Cost Constraints**:

  - Should optimize GPT API usage for cost efficiency
  - Must implement selective GPT invocation strategy
  - Should balance hosting costs with performance requirements
  - Must consider scaling costs for widespread adoption

- **Security Constraints**:

  - Must maintain user privacy and data security
  - Principle of least privilege (only permissions explicitly needed)
  - Must secure sensitive configuration and credentials
  - Row-level security for database access

- **User Experience Constraints**:
  - Must minimize friction for legitimate users
  - Should provide clear verification instructions
  - Must offer transparent moderation processes
  - Should balance security with usability

## Permissions & Security

### Recommended Bot Permissions

- Read Messages
- Send & Manage Messages
- Create & Manage Threads
- Manage Roles
- Ban Members
- Kick Members (optional)
- View Audit Log
- Read Message History

## Hosting & Infrastructure

### Initial Hosting

- Centrally hosted service on VPS or AWS
- Open-source, public GitHub repository
- Environment-variable secured OpenAI API integration

### Future Enhancements

- Optional self-hosting documentation
- Pricing model integration via Stripe (second pass)
- Web dashboard interface for easier bot management (third pass)

## Technology Stack

### Core Technologies

- TypeScript
- Node.js
- Discord.js
- OpenAI API
- Prisma Client (ORM for PostgreSQL)
- Supabase (PostgreSQL Database Hosting)
- **InversifyJS** for dependency injection
- Jest for testing

### Development Tools

- VS Code
- ESLint
- TypeScript compiler
- Git/GitHub

## Project Structure

### Core Components

- Bot class: Main entry point and Discord event handling
- Detection Services: Heuristic and GPT-based detection
- User Management: User profiles and reputation
- Configuration System: Server-specific settings
- Data Access: Repository layer for persistent storage

### Key Files and Directories

- `src/Bot.ts`: Main bot implementation
- `src/services/`: Service implementations
- `src/repositories/`: Data access layer
- `src/di/`: Dependency injection configuration
  - `container.ts`: InversifyJS container setup
  - `symbols.ts`: Type symbols for dependency injection
- `src/__tests__/`: Test files and utilities

## Development Approach

### Engineering Principles

- **Testability**: All components designed with testing in mind
  - InversifyJS dependency injection enables proper isolation in tests
  - Test containers simplify integration testing
- **Modularity**: Clean interfaces between components
- **Error Handling**: Graceful degradation when external services fail
- **Configuration**: Extensive configuration options without code changes

### Development Workflow

1. Feature planning and technical design
2. Implementation with TDD approach
3. Code review and refinement
4. Integration testing
5. Deployment and monitoring

## Current Status and Next Steps

### Completed Work

- Core bot architecture and Discord integration
- Basic detection services
- Database schema and repositories
- **InversifyJS implementation**
  - Interface design for all services
  - Container configuration
  - Symbol definitions
  - Test utilities for InversifyJS

### Upcoming Work

- Enhanced detection algorithms
- Improved configurability
- Cross-server reputation system
- Advanced analytics for admins

## Technical Challenges

### Solved Challenges

- Discord API integration
- OpenAI API integration for content analysis
- Database schema design for user and server tracking
- **Dependency management with InversifyJS**
  - Component coupling and circular dependency prevention
  - External service injection
  - Testing strategy

### Outstanding Challenges

- Rate limiting in Discord API
- Cost management for OpenAI API usage
- Scaling to support large numbers of servers
- Performance optimization for message processing

## Resources

### Documentation

- [Project README](../../README.md)
- [Workflow Overview](../workflow.md)
- [Test Cases](../test-cases.md)
- [Legacy Architecture Notes](../legacy/memory-bank/systemPatterns.md)
- [Testing Best Practices](../legacy/learnings/testing-best-practices.md)

### External Resources

- [Discord.js Documentation](https://discord.js.org/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [Supabase Documentation](https://supabase.io/docs)
- [InversifyJS Documentation](https://inversify.io/)

## Team and Stakeholders

### Development Team

- Lead Developer
- Backend Developer
- QA Engineer
- DevOps Specialist

### Stakeholders

- Discord Server Administrators
- End Users (Discord Server Members)
- Project Sponsors
