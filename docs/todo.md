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

- [ ] **C1**: Create `HeuristicService.ts` for basic spam checks:
  - Message frequency tracking (e.g., if user sends >5 messages in 10 seconds).
  - Suspicious keyword detection (e.g., "nitro scam").
- [ ] **C2**: Write unit tests (`HeuristicService.test.ts`) verifying:
  - Normal usage does not trigger flags.
  - Rapid messages or keyword triggers a flag.
- [ ] **C3**: Integrate `HeuristicService` into the bot's message event:
  - If flagged, log "User flagged for spam" (temporary action).
- [ ] **C4**: Document threshold settings (e.g., `MAX_MESSAGES`, `TIME_FRAME`).

---

## Chunk D: GPT Integration

- [ ] **D1**: Install the OpenAI Node.js SDK: `openai`.
- [ ] **D2**: Create `GPTService.ts`:
  - Export a function `classifyUserProfile(profileData: any) => Promise<"OK" | "SUSPICIOUS">`.
  - Minimal prompt structure, e.g., "You are a Discord moderation assistant. Classify user."
- [ ] **D3**: Write tests (`GPTService.test.ts`) mocking the OpenAI API:
  - One test returning "OK".
  - Another test returning "SUSPICIOUS".
- [ ] **D4**: Add `OPENAI_API_KEY` to `.env`, confirm no secrets committed to Git.
- [ ] **D5**: (Optional) Write a real test hitting the actual API (only run locally, not in CI).

---

## Chunk E: Combined Detection Flow

- [ ] **E1**: Create `DetectionOrchestrator.ts`:
  - Calls `HeuristicService` first for a suspicion score or label.
  - If borderline or uncertain, calls `GPTService`.
  - Final output: "OK" or "SUSPICIOUS".
- [ ] **E2**: Write integration tests (`DetectionOrchestrator.test.ts`) covering:
  - Obvious spam scenario.
  - Borderline scenario → GPT check.
  - Normal usage → no flag.
- [ ] **E3**: In the bot's message handler, replace the direct `HeuristicService` call with `DetectionOrchestrator`.
- [ ] **E4**: If final label is "SUSPICIOUS," continue just logging "User flagged" for now.
- [ ] **E5**: Ensure consistent error handling and logging.

---

## Chunk F: Verification & Role Management

- [ ] **F1**: Add a "Restricted" role (manually created in your Discord server) and store its ID in `.env` or a config file.
- [ ] **F2**: When a user is flagged as "SUSPICIOUS," the bot automatically applies the restricted role to them.
- [ ] **F3**: Implement a basic admin command (e.g., `!verify @user`) that removes the restricted role.
- [ ] **F4**: Write tests to mock Discord's role assignment methods.
- [ ] **F5**: (Optional) Create a verification thread or private channel for suspicious users.
- [ ] **F6**: Document usage of the restricted role: how to create it, set ID, etc.

---

## Chunk G: Prompt Strategy & Few-Shot

- [ ] **G1**: Enhance GPT prompts in `GPTService` with few-shot examples:
  - Provide at least 2–3 reference user profiles labeled "OK" or "SUSPICIOUS."
- [ ] **G2**: Update tests with borderline user scenarios to evaluate prompt improvements.
- [ ] **G3**: Optionally add a config or separate file for these few-shot prompts so they're easy to adjust.
- [ ] **G4**: Document any changes to the GPT classification logic or thresholds.
- [ ] **G5**: Evaluate performance and cost if more tokens are used for prompts.

---

## Chunk H: Persistence & Logging (Supabase)

- [ ] **H1**: Install and configure the Supabase JS client.
- [ ] **H2**: Set up a Supabase table, e.g., `flagged_users`:
  - Columns: `id`, `userId`, `reason`, `timestamp`.
- [ ] **H3**: Create a `LoggingService.ts` or `DatabaseService.ts` that inserts a record whenever a user is flagged "SUSPICIOUS."
- [ ] **H4**: Write tests with a mocked Supabase client verifying DB insertion/retrieval.
- [ ] **H5**: Optionally add a command `!flagged` listing flagged users from the DB.
- [ ] **H6**: Document Supabase setup (DB URL, keys in `.env`).

---

## Chunk I: Cross-Server / Advanced Features (Optional)

- [ ] **I1**: Extend Supabase schema for cross-server reputation (e.g., table for `userId`, `
```
