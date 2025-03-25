# Technical Specifications: AI-Powered Discord Anti-Spam Bot

## 1. Overview

This document details technical specifications for developing an AI-powered Discord anti-spam bot using TypeScript, Discord.js, OpenAI Node.js SDK, Supabase, dotenv, and InversifyJS for dependency injection.

## 2. Technology Stack

### Programming Language

- **TypeScript:** For type safety, maintainability, and unified codebase between bot and potential frontend.

### Discord Integration

- **Discord.js (v14+):**
  - Robust Discord API support.
  - Extensive documentation and large community support.
  - Ideal for advanced Discord features like slash commands and message interactions.
  - Be mindful of memory consumption due to aggressive caching.

### AI Integration

- **OpenAI Node.js SDK:**
  - Officially supported by OpenAI.
  - TypeScript-ready, providing built-in type definitions.
  - Simplifies integration with GPT models, moderation endpoints, and future OpenAI services.
  - Cost-effective management of API calls (use GPT-3.5-turbo for faster, cheaper responses).

### Database & Persistence

- **Supabase:**
  - PostgreSQL backend with easy-to-use realtime API and built-in authentication.
  - Ideal for storing moderation actions, user history, spam scores, and server configuration.
  - Highly scalable with low management overhead.

### Environment Variables Management

- **dotenv:**
  - Secure storage for sensitive keys and credentials (Discord token, OpenAI API key, Supabase keys).

### Dependency Injection

- **InversifyJS:**
  - Modular architecture, improved testability.
  - Promotes clean separation of concerns (services, repositories, Discord client, etc.).

## 3. Spam Detection Algorithms

### Detection Strategy

Implement a hybrid spam detection model combining heuristic (rule-based) and LLM (GPT-based) analyses:

#### Heuristic/Rule-Based Layer:

- **Message Frequency Checks:**
  - Configure thresholds (e.g., 5 messages/10 sec triggers warnings, further triggers temporary mutes or bans).
- **Keyword & Link Filtering:**
  - Regex-based filters for known malicious/scam phrases, phishing URLs, Discord invites.
- **User Behavior Heuristics:**
  - Excessive mentions, repeated messages, excessive emojis or capitalization.
  - Recent account creation dates or server join dates raise suspicion.

#### GPT-based Layer:

- **Prompt Engineering:**
  - Design clear, context-rich prompts: "You are a moderation assistant. Classify this Discord message clearly as `SPAM` or `OK`."
  - Continuously refine prompt wording to reduce ambiguity.
- **Selective API Usage:**
  - Use GPT only for borderline or unclear cases.
  - Batch or cache repeated spam checks to minimize API calls.
- **Confidence Scores:**
  - Provide clear confidence outputs from GPT to admins for informed moderation decisions.

### Future Spam Detection Enhancements:

- **Custom fine-tuned GPT model:** Use Discord-specific spam data.
- **Cross-server trust network:** Trusted server verification improves detection accuracy.

## 4. System Architecture

### Bot Architecture (MVC-inspired):

- **Models:**
  - Supabase schema for users, moderation logs, server configurations.
- **Services:**
  - Spam detection logic (Heuristics + GPT).
  - Discord interaction handling (roles, moderation actions).
  - Supabase CRUD operations.
- **Controllers:**
  - Discord event handling.
  - Admin command interfaces.

### Dependency Injection Setup (InversifyJS):

- Services injected into controllers:
  - `DiscordClientService`
  - `SpamDetectionService`
  - `ModerationLoggingService`

## 5. Data Schema (Supabase)

- **Users Table:** `user_id`, `discord_id`, `username`, `created_at`, `last_flagged_at`, `spam_confidence_score`
- **Moderation Logs Table:** `log_id`, `user_id`, `action_taken`, `action_by_admin`, `reason`, `timestamp`
- **Server Configuration Table:** `server_id`, `restricted_role_id`, `admin_notification_role_id`, `admin_summary_channel_id`, `auto_create_threads`

## 6. Security & Permissions

### Discord Permissions

- Essential: Read Messages, Send Messages, Manage Messages, Create Threads, Manage Threads, Manage Roles, Ban Members.
- Optional: Kick Members, View Audit Log, Mention Everyone.

### Security Best Practices

- Environment variables secured via dotenv.
- Principle of least privilege: grant minimal necessary permissions.
- Regularly rotate Discord and OpenAI tokens.

## 7. Error Handling & Logging

- Console-based error logging and file-based logging initially.
- Handle API rate limits gracefully with exponential back-off strategies.
- Clear error messages for admin troubleshooting.

## 8. Testing & Deployment

### Testing Plan

- **Unit Tests:** Jest or Mocha/Chai for spam detection logic.
- **Integration Tests:** Full user interaction flows (joining, spamming, moderation).
- **Manual Acceptance Tests:** Simulate real-world spam scenarios on test server.

### Deployment

- Docker-based containerization for VPS deployments.
- Continuous Integration & Deployment (CI/CD) recommended via GitHub Actions.

## 9. Infrastructure & Scalability

### Initial Infrastructure:

- Hosted centrally via VPS provider.
- Docker deployment (Traefik for proxying recommended).

### Future Enhancements:

- Stripe payment integration for hosting cost recovery.
- Optional web-based dashboard for configuration and analytics.

## 10. Development Tools & Utilities

- GitHub for version control, issue tracking, and documentation.
- ESLint & Prettier for consistent coding standards.
- Swagger/OpenAPI for future API documentation (especially useful with frontend integration).
