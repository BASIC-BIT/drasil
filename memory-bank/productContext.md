# Discord Anti-Spam Bot: Product Context

## Core Functionality

### User Detection Events

- **Immediate check** upon user joining server
- **Initial full-server scan** upon bot onboarding
- **Periodic scans** of existing users (interval configurable)
- **Triggered scans** by suspicious user behavior (rapid message sending, excessive DMs)

### AI Detection Data Points

- Discord username and discriminator
- Nickname (analysis for pronounceability, special characters)
- Profile description, pronouns, bio
- External connections (Spotify, Steam, Xbox, etc.)
- Profile picture and banner image analysis
- Account creation date, server join date
- Mutual server information (when available)

### Detection Outcomes

- Binary classification (SUSPICIOUS or OK)
- Confidence score clearly communicated in admin summaries (Low/Medium/High)
- Detailed reasons for flagging

## Problem Statement

Discord servers face persistent challenges with spam, scams, and malicious users. Current solutions often:

1. React **after** harm has occurred, when users have already been exposed to scams
2. Rely solely on basic keyword filtering or message frequency, which spammers easily evade
3. Create excessive friction for legitimate users through heavy-handed verification
4. Require significant manual moderation effort, overwhelming server administrators

This creates an environment where:

- Users may be exposed to scams before moderators can intervene
- Server administrators spend excessive time on moderation
- Legitimate users face frustrating verification processes
- Communities struggle to maintain a safe, welcoming atmosphere

## Solution Overview

Our Discord Anti-Spam Bot addresses these challenges through:

### 1. Proactive Detection

Rather than waiting for obvious spam patterns, the bot uses GPT-powered analysis to identify suspicious accounts based on subtle patterns, even before they've broken obvious rules. This proactive approach allows us to:

1. Analyze subtle patterns or suspicious profiles
2. Make informed decisions on user authenticity
3. Intervene **before** harm occurs

The implementation includes:

- **New Join Analysis**: Every new member is automatically analyzed by GPT
- **Account Age Evaluation**: Recently created accounts receive extra scrutiny
- **Profile Characteristic Analysis**: Username patterns, discriminators, and nicknames are evaluated
- **Message Content Analysis**: First messages from new users are carefully examined
- **Early Restriction**: Suspicious users are restricted before they can spam

### 2. Hybrid Detection Approach

The bot combines:

- **Fast heuristic checks**:

  - Message frequency tracking (>5 messages in 10 seconds)
  - Suspicious keyword detection (nitro scam, free discord nitro, etc.)
  - Pattern matching for common spam formats

- **Sophisticated GPT analysis**:

  - User profile evaluation with account age and join date
  - Message content analysis for subtle spam indicators
  - Few-shot learning with categorized examples
  - Confidence scoring for decision transparency

- **Smart Orchestration**:
  - Heuristics first for efficiency
  - GPT for borderline cases or new users
  - Combined scoring system for final decisions
  - Reason tracking for admin transparency

This multi-layered approach provides both speed and accuracy.

### 3. Streamlined Verification

For flagged users, the bot implements a structured verification process:

- **Automatically assigns a restricted role** limiting server access
- **Creates dedicated verification threads** in a private channel
- **Sends verification instructions** to guide legitimate users
- **Maintains privacy** by isolating verification conversations
- **Preserves context** by keeping verification threads organized
- **Prompts users** with simple verification questions:
  - "How did you find our community?"
  - "What interests you here?"

### 4. Admin-Friendly Interface

Administrators receive:

- **Detailed notification embeds** with:

  - User profile information and avatar
  - Account creation and join timestamps (both absolute and relative)
  - Detection confidence level (Low/Medium/High)
  - Bullet-pointed reasons for flagging
  - Trigger source (message content or join event)

- **Interactive buttons** for one-click actions:

  - Verify User (removes restricted role)
  - Ban User (removes from server)
  - Create Thread (for verification conversation)

- **Action logging** directly in notification messages:
  - Records which admin took what action
  - Includes timestamps for accountability
  - Links to verification threads when created
  - Maintains complete history in original message

## User Experience Goals

### For Server Administrators

- **Reduced Workload**:

  - Automatic detection of suspicious users
  - Proactive restriction before spam occurs
  - One-click moderation actions
  - Organized verification system

- **Clear Information**:

  - Detailed notification embeds
  - Confidence levels for detection reliability
  - Reason explanations for transparency
  - Action history for accountability

- **Simple Controls**:

  - Interactive buttons for common actions
  - Slash commands for additional control
  - Verification threads for communication
  - Server-specific configuration options

- **Confidence**:
  - AI-powered detection for subtle patterns
  - Hybrid approach for reliability
  - Transparent decision-making
  - Continuous improvement through feedback

### For Server Members

- **Safer Environment**:

  - Proactive protection from scams
  - Reduced exposure to spam messages
  - Fewer disruptive raid attacks
  - More focused community discussions

- **Minimal Friction**:

  - No verification for most legitimate users
  - Targeted restrictions only for suspicious accounts
  - Simple verification process if flagged incorrectly
  - Quick resolution through dedicated threads

- **Transparent Process**:

  - Clear verification instructions
  - Private communication channels
  - Consistent moderation standards
  - Quick response from administrators

- **Consistent Experience**:
  - Standardized moderation across servers
  - Predictable verification process
  - Fair treatment based on behavior
  - Cross-server reputation benefits for established users

## Key Differentiators

What sets our bot apart from existing solutions is our AI-first approach to spam detection:

1. **AI-First Approach**:

   - GPT-powered analysis for nuanced understanding
   - Few-shot learning with categorized examples
   - Context-aware evaluation of user profiles
   - Sophisticated message content analysis

2. **Proactive vs. Reactive**:

   - New join analysis before any messages
   - Account age and creation time evaluation
   - Early restriction of suspicious accounts
   - Prevention rather than cleanup

3. **Admin-Optimized UX**:

   - Detailed yet scannable notification embeds
   - One-click moderation actions
   - Integrated action logging
   - Dedicated verification system

4. **Balanced Protection**:

   - Selective verification only for suspicious users
   - Smart routing between heuristics and GPT
   - Confidence levels for informed decisions
   - Cross-server reputation for established users

5. **Technical Architecture**:
   - Repository pattern for data persistence
   - Service-oriented design for modularity
   - Caching strategies for performance
   - Comprehensive error handling

## Target Audience

- **Primary**: Medium to large Discord communities (500+ members):

  - Gaming communities with public invites
  - Open educational and professional groups
  - Content creator communities
  - Public interest groups

- **Secondary**: Smaller communities with specific security concerns:

  - Communities with sensitive discussions
  - Groups that have experienced raids or spam attacks
  - Servers with limited moderation resources
  - Communities with vulnerable populations

- **Tertiary**: Public-facing official Discord servers

  - Brand and product communities
  - Support servers for software and services
  - Event-based communities with fluctuating membership
  - Multi-server networks with shared moderation

## Onboarding Process

The bot provides a streamlined onboarding experience:

1. Introduction and benefits explanation
2. Configurable restricted role setup
3. Configurable admin notification role setup
4. Optional admin summary channel configuration
5. Initial full server scan and summarized results

All roles and channels are optionally configurable during onboarding, with clear warnings when optional settings are skipped and automatic creation options available.

## Success Metrics

The bot's effectiveness will be measured by:

1. **Reduction in Successful Spam Incidents**:

   - Fewer spam messages reaching general channels
   - Decreased number of users reporting scam attempts
   - Reduced need for message deletion and cleanup
   - Lower frequency of raid attacks

2. **False Positive Rate**:

   - Minimal incorrect flagging of legitimate users
   - Quick resolution of false positives through verification
   - Decreasing trend in false positive rate over time
   - Positive feedback on verification experience

3. **Admin Time Savings**:

   - Reduced time spent on manual moderation
   - Fewer required admin interventions
   - Quicker resolution of moderation issues
   - More efficient verification process

4. **User Satisfaction**:

   - Positive feedback from administrators
   - Minimal complaints from legitimate users
   - Increased server retention rates
   - Growth in server membership

5. **Technical Performance**:
   - Reliable detection with high accuracy
   - Low latency for message processing
   - Efficient resource utilization
   - Minimal downtime or errors

## Future Roadmap

### Planned Enhancements

1. **Custom fine-tuned AI model**:
   - Gather large volumes of confirmed spam and scam profiles
   - Fine-tune a GPT model specifically on these examples
   - Improve accuracy for subtle scam behavior detection

2. **Cross-server reputation system**:
   - Trusted networks for shared reputation data
   - Global suspicion raising for users flagged in multiple servers
   - Verification records from reputable servers

3. **Advanced data analysis**:
   - Image analysis for profile pictures and banners
   - Behavioral logs for messaging patterns
   - Friend request and DM pattern tracking

4. **Web dashboard**:
   - Configuration management interface
   - Analytics and reporting
   - User management features
