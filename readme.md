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
- Follow the setup wizard (`/wizard`)
- Update config as needed (spam thresholds, OpenAI prompts).
- Let the bot automatically classify new users or run the `/verify` command for manual overrides.

## Contributing 🤝

Feel free to open pull requests or fork the project. All contributions are welcome—bug fixes, new features, documentation improvements, or suggestions.

## License 📜

Licensed under the [MIT License](LICENSE.md).

## Questions or Feedback?

Open an issue or reach out in the discussions tab. We love hearing from the community!  
Thanks for helping keep Discord communities safe and spam-free.
