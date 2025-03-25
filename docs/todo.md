Below is a **`todo.md`** document that serves as a comprehensive, step-by-step checklist for building your AI-powered Discord anti-spam bot. Each item references a particular stage or chunk of work, ensuring you can methodically track your progress.

```markdown
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

- [ ] **F1**: Retain or create a "Restricted" role in the server, with its ID in `.env` or a config file.
- [ ] **F2**: When `DetectionOrchestrator` returns "SUSPICIOUS", automatically apply the restricted role.
- [ ] **F3**: Provide an admin-only command `!verify @user` that removes the restricted role.
- [ ] **F4**: Write tests mocking Discord's role assignment, verifying restricted role application and removal.
- [ ] **F5**: (Optional) Open a verification thread or private channel for flagged users.

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
```
