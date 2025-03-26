# Comprehensive Specification: Discord AI-Powered Anti-Spam Bot

## 1. Overview

This bot detects and mitigates spam, scams, and suspicious accounts within Discord servers. Leveraging OpenAI's GPT for detection, it streamlines moderation while minimizing friction for legitimate users.

## 2. Core Functionality

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
- Profile picture and banner image analysis (via GPT image description)
- Account creation date, server join date
- Mutual server information (when available)

### Detection Outcomes

- Binary classification initially (Likely Bot vs. Not Likely Bot)
- Confidence score clearly communicated in admin summaries

## 3. Admin Notifications & Actions

### Admin Summary Channel

- Optional (strongly recommended)
- Posts concise AI-generated summaries with:
  - Username
  - AI suspicion confidence (Low/Medium/High)
  - Trigger source (message content or join event)
  - Bullet-pointed reasons for flagging
- Interactive buttons:
  - ✅ Verify user
  - 🚫 Ban user
  - 🧵 Create verification thread (optional auto-creation or manual)
- Action logging directly in notification messages:
  - Records which admin took what action
  - Includes timestamps for accountability
  - Maintains complete history in original message

### Admin Notification Role

- Optional but strongly recommended role ping upon flagging

### Logging and Retention

- All actions logged directly in summary messages (action, admin name, timestamp)
- Permanent data retention by default (no deletion policy initially)

## 4. Verification Process

- Restricted role assignment upon flagging (admin-configurable)
- Verification threads created in dedicated verification channel:
  - Channel visible only to admins and users with restricted role
  - Restricted users can only see their own threads, not channel history
  - Private threads to maintain separation between verification cases
- User prompted to answer simple verification questions:
  - "How did you find our community?"
  - "What interests you here?"

## 5. Role & Channel Configuration

- Roles (restricted role, admin notification role) and channels (admin summary, verification) optionally configurable during onboarding
- Clear warnings when optional settings skipped
- Optional automatic creation of roles/channels during onboarding

## 6. Onboarding Wizard Steps (MVP)

- Introduction and benefits explanation
- Configurable restricted role
- Configurable admin notification role
- Optional admin summary channel (creation or selection)
- Initial full scan and summarized results provided

## 7. Hosting & Infrastructure

### Initial Hosting

- Centrally hosted service on VPS or AWS
- Immediately open-source, public GitHub repository
- Environment-variable secured OpenAI API integration

### Future Enhancements

- Optional self-hosting documentation
- Pricing model integration via Stripe (second pass)
- Web dashboard interface for easier bot management (third pass)

## 8. Permissions & Security

### Recommended Bot Permissions

- Read Messages
- Send & Manage Messages
- Create & Manage Threads
- Manage Roles
- Ban Members
- Kick Members (optional)
- View Audit Log
- Read Message History

(Full Admin permissions optional, not required)

### Security Best Practices

- Token protection via environment variables
- Principle of least privilege (only permissions explicitly needed)
- Standard security measures (basic logging, regular credential rotation)

## 9. Error Handling & External Services

### Initial Error Handling

- Errors logged to console/error files, no real-time Discord notifications initially

### External Service

- OpenAI GPT API integration (clearly documented and secured)

### Future Error Handling Enhancements

- Optional real-time admin notifications in Discord
- Status webpage integration for bot uptime/downtime tracking

## 10. Future Roadmap Enhancements

- Custom fine-tuned AI spam detection model
- Cross-server trusted server network
- Granular threshold-based automatic actions
- Dedicated moderation logging and aggregated analytics

## 11. Testing Plan

### Unit Testing

- Test detection logic independently
- Test role assignment/removal logic
- Test summary channel message creation and updates

### Integration Testing

- End-to-end scenarios including onboarding, flagging, verification workflow
- GPT integration reliability
- Error handling scenarios

### Load Testing (Future Enhancement)

- Test bot handling at scale (servers with thousands of members)

### Manual/Acceptance Testing

- Simulated moderation scenarios with real Discord server
- Admin usability and configuration experience validation

---

This comprehensive specification enables developers to implement the bot effectively, ensuring clarity and a strong foundation for iterative development.
