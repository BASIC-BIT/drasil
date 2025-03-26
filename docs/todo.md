# TODO Checklist: AI-Powered Discord Anti-Spam Bot

---

## Chunk A: Project & Testing Setup

- [x] **A1**: Initialize Git repository and run `npm init -y`.
- [x] **A2**: Install development dependencies:
  - `typescript`, `ts-node`, `jest`, `ts-jest`, `@types/jest`
- [x] **A3**: Create and configure `tsconfig.json` (Node runtime, ES2020 or above).
- [x] **A4**: Add `jest.config.js` with TypeScript support (`ts-jest`).
- [x] **A5**: Create a minimal sample test in `src/__tests__/sanity.test.ts` (e.g., `expect(true).toBe(true)`).
- [x] **A6**: Set up a CI workflow (e.g., GitHub Actions) to run `npm test` on push.

---

## Chunk B: Minimal Discord Bot

- [x] **B1**: Install `discord.js`.
- [x] **B2**: Create `Bot.ts` (or similarly named file):
  - Exports a `startBot()` function.
  - Logs in using `process.env.DISCORD_TOKEN`.
  - Listens for the `ready` event and logs "Bot is ready!".
- [x] **B3**: Implement a simple message handler (e.g., if content is `!ping`, reply with "Pong!").
- [x] **B4**: Add a test (`startBot.test.ts`) ensuring the bot starts without errors (mock `discord.js` if needed).
- [x] **B5**: Document how to run locally (`.env` usage for `DISCORD_TOKEN`).

---

## Chunk C: Heuristic Spam Detection

- [x] **C1**: Create `HeuristicService.ts` for basic spam checks:
  - Message frequency tracking (e.g., if user sends >5 messages in 10 seconds).
  - Suspicious keyword detection (e.g., "nitro scam").
- [x] **C2**: Write unit tests (`HeuristicService.test.ts`) verifying:
  - Normal usage does not trigger flags.
  - Rapid messages or keyword triggers a flag.
- [x] **C3**: Integrate `HeuristicService` into the bot's message event:
  - If flagged, log "User flagged for spam" (temporary action).
- [x] **C4**: Document threshold settings (e.g., `MAX_MESSAGES`, `TIME_FRAME`).

---

## Chunk D: GPT Integration

- [x] **D1**: Install the OpenAI Node.js SDK: `openai`.
- [x] **D2**: Create `GPTService.ts`:
  - Export a function `classifyUserProfile(profileData: any) => Promise<"OK" | "SUSPICIOUS">`.
  - Minimal prompt structure, e.g., "You are a Discord moderation assistant. Classify user."
- [x] **D3**: Write tests (`GPTService.test.ts`) mocking the OpenAI API:
  - One test returning "OK".
  - Another test returning "SUSPICIOUS".
- [x] **D4**: Add `OPENAI_API_KEY` to `.env`, confirm no secrets committed to Git.
- [x] **D5**: (Optional) Write a real test hitting the actual API (only run locally, not in CI).

---

## Chunk E: Combined Detection Flow

- [x] **E1**: Create or revise a `DetectionOrchestrator.ts` that incorporates:
  - Heuristic checks first (message frequency, suspicious keywords).
  - Account age and server-join date checks:
    - If a user is new (recent account creation or newly joined), automatically pass their first few messages (plus profile info) to GPT for analysis.
    - If the user is established, only pass borderline or suspicious messages to GPT.
- [x] **E2**: Ensure GPT is also called automatically when a user joins the server:
  - Collect and provide account age, username, and any relevant info to GPT.
  - Classify as "OK" or "SUSPICIOUS" on join.
- [x] **E3**: Combine heuristic and GPT results into a final label ("OK" or "SUSPICIOUS").
- [x] **E4**: Write integration tests (`DetectionOrchestrator.test.ts`) covering:
  - Brand-new user join (GPT is called).
  - First few messages from a new user (GPT is called).
  - Established user spamming (heuristics → GPT if borderline).
  - Established user normal usage (heuristics alone).
- [x] **E5**: Update the bot's event handlers:
  - On `guildMemberAdd`: automatically call GPT classification.
  - On each message: use heuristics first, then GPT if user is new or borderline.
  - Log "User flagged" if final label is "SUSPICIOUS."

---

## Chunk F: Verification & Role Management

- [x] **F1**: Provide slash commands (e.g., /verify, /ban) rather than exclamation commands.
- [x] **F2**: Create (or reuse) a "Restricted" role (ID in `.env` or config).
- [x] **F3**: When `DetectionOrchestrator` flags a user, post an embed or message to an admin/summary channel with interactive buttons:
  - "Verify" button → removes the Restricted role
  - "Ban" button → bans the user
  - "Create Thread" button → opens a dedicated thread for further discussion
- [x] **F4**: Write tests mocking Discord's slash commands and role assignment flow, verifying the user can be restricted, verified, or banned properly.
- [x] **F5**: (Optional) Provide a fallback manual command or extra slash commands if moderators prefer typed interactions.

---

## Chunk G: Prompt Strategy & Few-Shot

- [ ] **G1**: Refine `GPTService` with few-shot examples:
  - Provide sample profiles for brand-new accounts, borderline users, and older accounts.
- [ ] **G2**: Write or update tests for borderline user scenarios, confirming effectiveness of example references.
- [ ] **G3**: Keep prompting logic in a config or separate file for easy updates.
- [ ] **G4**: Adjust thresholds (e.g., number of messages before GPT stops auto-checking a new user).
- [ ] **G5**: Monitor performance and costs if larger prompts are used.

---

## Chunk H: Persistence & Logging (Supabase)

- [ ] **H1**: Install and set up the Supabase JS client.
- [ ] **H2**: Create or update a table (e.g. `flagged_users`) with columns for user ID, reason, timestamp, and whether the user is new/established.
- [ ] **H3**: Ensure flagged "SUSPICIOUS" events (especially for new joins) are logged in the DB.
- [ ] **H4**: Write tests using mocked Supabase that verify flagged joins/messages are inserted correctly.
- [ ] **H5**: (Optional) Provide a `!flagged` command to display suspicious users from the DB.

---

## Chunk I: Cross-Server & Advanced Features (Optional)

- [ ] **I1**: Extend the Supabase schema for cross-server reputation tracking.
- [ ] **I2**: Incorporate user reputation (if flagged in multiple servers, raise suspicion).
- [ ] **I3**: Write tests simulating multi-server joins, verifying suspicion raises appropriately.
- [ ] **I4**: Tune thresholds for automatically restricting known offenders.
- [ ] **I5**: Ensure final stability, handle performance concerns at scale.

---

## Chunk J: Enhanced Admin Notifications & Verification System

- [x] **J1**: Implement action logging for interaction buttons:

  - Log which admin pressed the button and what action they took
  - Update original message with action logs (or send follow-up message)
  - Ensure clear attribution and timestamp

- [x] **J2**: Replace detection confidence percentage with Low/Medium/High system:

  - 0-40%: Low confidence
  - 41-70%: Medium confidence
  - 71-100%: High confidence
  - Remove "Used GPT" field from embeds
  - Keep internal percentage values for analytics

- [x] **J3**: Enhance timestamp displays:

  - Format account creation and join dates to include both:
    - Full timestamp (e.g., March 15, 2023 3:45 PM)
    - Relative Discord timestamp (<t:timestamp:R>)

- [x] **J4**: Add trigger reason to admin notifications:

  - Include message content if message-triggered
  - State "Flagged upon joining server" if join-triggered
  - Provide context for moderator decision-making

- [x] **J5**: Format reason lists as bullet points:

  - Convert reasons to string array internally
  - Use Discord markdown for bullet point formatting in embeds

- [x] **J6**: Set up dedicated verification channel and thread system:
  - Create channel visible only to admins and restricted users
  - Configure so restricted users can't see message history
  - Update thread creation logic to use verification channel
  - Set appropriate permissions for private threads
