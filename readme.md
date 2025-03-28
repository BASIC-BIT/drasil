# 🌳 Drasil - Automatic Discord Scammer Protection Bot 🛡️

A Discord bot that leverages GPT-based analysis and heuristic checks to proactively detect and mitigate spammers and scammers in Discord servers.

## Overview

This bot uses:

- **Discord.js** for Discord integration
- **OpenAI GPT** for advanced spam detection
- **Heuristic checks** for quick identification of obvious spam
- **Supabase** for data persistence

## Features

- **Proactive Detection**: Flags suspicious users quickly
- **Configurable Heuristics**: Tune message frequency limits or spam keywords
- **GPT Integration**: Intelligent classification for borderline cases
- **Restricted Role**: Automate partial lockdown of flagged users
- **Verification Threads**: Quickly confirm or deny suspicious accounts

### Heuristic Spam Detection

The bot currently implements the following heuristic checks:

- **Message Frequency**: Flags users who send more than 5 messages within 10 seconds
- **Suspicious Keywords**: Detects common scam phrases like "free discord nitro", "claim your prize", etc.

## Getting Started

1. **Clone** this repository:
   ```bash
   git clone https://github.com/YourUsername/ai-discord-antispam.git
   ```
2. **Install dependencies**:
   ```bash
   cd discord-anti-spam-bot
   npm install
   ```
3. **Configure environment**:
   - Create a `.env` file and provide your `DISCORD_TOKEN`, `OPENAI_API_KEY`, etc.
4. **Run the bot**:
   ```bash
   npm start
   ```

## Usage

- Invite the bot to your server.
- Follow the setup instructions below
- Use the `/config` command to set up server-specific settings
- Update other config as needed (spam thresholds, OpenAI prompts).
- Let the bot automatically classify new users or run the `/verify` command for manual overrides.

## Setup

### Server Configuration

1. **Create a Restricted Role**:

   - Create a role in your Discord server that has limited permissions
   - Take note of the role ID (enable Developer Mode in Discord Settings -> Advanced, then right-click the role and select "Copy ID")
   - Use the `/config key:restricted_role_id value:<role-id>` command to set this value

2. **Create an Admin Channel**:

   - Create a channel that only moderators/admins have access to
   - This channel will receive notifications about suspicious users with interactive buttons
   - Use the `/config key:admin_channel_id value:<channel-id>` command to set this value

3. **Create a Verification Channel**:
   - Create a channel visible only to admins and users with the restricted role
   - Configure so restricted users can't see message history
   - This is where verification threads will be created
   - Use the `/config key:verification_channel_id value:<channel-id>` command to set this value

### Slash Commands

The bot automatically registers the following slash commands during startup:

- `/ping` - Check if the bot is online
- `/verify @user` - Remove the restricted role from a user
- `/ban @user [reason]` - Ban a user from the server with an optional reason
- `/createthread @user` - Create a verification thread for a user
- `/config key:value value:value` - Configure server-specific settings

Slash commands are automatically registered when the bot starts up. There's no need for manual registration.

### Admin Channel Notifications

When a user is flagged as suspicious, the bot will:

1. Assign the configured restricted role to limit their server access
2. Send a notification to the admin channel with:
   - User details (username, ID, join date, etc.)
   - Detection confidence level (Low, Medium, or High)
   - Trigger reason (message content or join event)
   - Bullet-pointed list of detection reasons
   - Interactive buttons:
     - **Verify User** button to remove the restricted role
     - **Ban User** button to ban the user from the server
     - **Create Thread** button to open a verification thread
3. Log all admin actions (button presses) directly in the notification message
4. Create verification threads in a dedicated verification channel that's visible only to:
   - Server administrators and moderators
   - The restricted user (only their own thread)

## Spam Detection Heuristics

- [Discord won't let bots access bios... for some reason](https://github.com/discord/discord-api-docs/issues/3095#issue-comment-box)
- We use the things we do have access to - their most recent message (if a chat message triggered the detection), account age, how long the account has been in the server, name, nickname

### Potential future heuristics

- Scrape for various past messages in the server
- Look at the user's roles, and see if those roles are privileged. That could also tie into onboarding, to see which roles are available for anybody to grab. This would absolutely require some amount of example or description to GPT for it to be useful, because less or more roles doesn't really mean much on its own
- Get banner and avatar url, run through image detection
- training data!!! We're just sending info to GPT right now, it'd be _really_ cool to instead gather evidence from known scammers to train a model. The best part is, we can use data from usage of the bot to eventually train a model. We can also implement "few-shot" learning by adding a few well-curated examples to the GPT user classification prompt.
- Tie in data from other servers - if many servers have listed that user as trusted, then it's probably good. We have to prevent gaming the system on this though. I was floating the idea of "trusted servers", where you can specify other servers you're networked with.. but that's crazy and overkill.
- Adding onto the few-shot idea, we could even potentially automate this process by allowing admins to "add case to training data", which would add it to the prompt specifically for their server. This could potentially be automated on a large scale by automating the human reinforced learning on by adding examples that resulted in false negatives or false positives to the prompt

## Future Feature Ideas

- Report command - allow users to report another user, which will run the bot detection on them (and, hilariously enough, also run the bot detection on the user that submitted the report)
- Automatic CAPTCHA on suspected members?
- Generally improve button interactions - add a confirmation prompt to the ban button, prevent creation of multiple threads, and add change how interactions are handled once it's already been handled (if we press Verify, then Ban, what happens?)

## Contributing 🤝

Feel free to open pull requests or fork the project. All contributions are welcome—bug fixes, new features, documentation improvements, or suggestions.

## License 📜

Licensed under the [MIT License](LICENSE.md).

## Questions or Feedback?

Open an issue or reach out in the discussions tab. We love hearing from the community!  
Thanks for helping keep Discord communities safe and spam-free.
