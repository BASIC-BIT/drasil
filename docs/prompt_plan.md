# 1. Detailed, Step-by-Step Blueprint

## 1.1 Project Initialization & Basic Setup
1. **Project Scaffolding**  
   - Create a new TypeScript project.  
   - Initialize `package.json` and install dependencies: `discord.js`, `openai`, `dotenv`, `typescript`, `ts-node`, `jest`, etc.  
   - Configure `tsconfig.json` for Node.js runtime.

2. **Discord Bot Initialization**  
   - Create a bare-bones Discord bot using `discord.js` that can log in with a token and respond to a basic command (`!ping` → `Pong!`).  
   - Add simple tests for sanity checks.

3. **Environment Configuration**  
   - Integrate `dotenv` for reading environment variables (Discord token, OpenAI key).  
   - Confirm secrets aren’t checked into version control.

4. **Testing & CI Setup**  
   - Install and configure Jest or Mocha/Chai for unit tests.  
   - Add a minimal GitHub Actions (or similar) CI pipeline to run tests on every push.

## 1.2 Core Bot Functionality (Heuristics + GPT)
1. **Heuristic Checks**  
   - Implement a simple message frequency check.  
   - Implement a basic suspicious keyword/link check.  
   - Write unit tests to ensure flags are raised under specific conditions (e.g., more than X messages in Y seconds).

2. **GPT Integration**  
   - Install and configure OpenAI Node.js SDK.  
   - Draft a minimal “spam detection” function that calls GPT with a short prompt.  
   - Use a test stub for the GPT call if you want offline testing.  
   - Write tests verifying that the function processes GPT output to yield a final classification.

3. **Combine Heuristics + GPT**  
   - Introduce a “suspicion score” system, where heuristics produce a partial score.  
   - If the heuristic result is borderline, call GPT. If GPT or heuristics strongly suggest spam, flag the user.  
   - Write integration tests (bot receives a message → detection logic → outcome).

4. **Verification & Role Management**  
   - Add logic to assign a “Restricted” role if flagged.  
   - Optionally open a verification thread or ticket.  
   - Provide commands for admins to override or finalize (verify/ban).  
   - Test: ensure role assignment is correct, that threads are created, etc.

## 1.3 Refinements & Future Enhancements
1. **Prompt Strategy & Fine Tuning**  
   - Expand the GPT prompt with few-shot examples.  
   - Write tests that mimic borderline user profiles.

2. **Cross-Server Reputation** (Optional in a later iteration)  
   - Add a shared database or a central endpoint that aggregates a user’s suspicion from multiple servers.  
   - If a user is flagged in many servers, raise suspicion automatically.

3. **Advanced Logging & Analytics**  
   - Store flagged events in a database (e.g., Supabase).  
   - Provide an admin command or minimal dashboard to review flagged history.

4. **Production Hardening**  
   - Rate-limit GPT calls.  
   - Provide fallback if GPT API fails.  
   - Ensure stable error handling and logging.

---

# 2. Breaking the Blueprint into Iterative Chunks

Here’s a high-level breakdown of development chunks:

1. **Chunk A: Project & Testing Setup**  
   - Initialize repo, TypeScript, jest testing, basic CI.

2. **Chunk B: Minimal Discord Bot**  
   - Basic `discord.js` client, connect using token, add a `ping` command.

3. **Chunk C: Heuristic Spam Detection**  
   - Rate-limit checks, suspicious keyword detection, unit tests for each.

4. **Chunk D: GPT Integration**  
   - Connect OpenAI, create a function to classify user data with GPT, unit test using mocks.

5. **Chunk E: Combined Detection Flow**  
   - If borderline heuristics → call GPT. If spammy → restrict user.  
   - Integration test with sample messages.

6. **Chunk F: Verification & Role Management**  
   - Assign restricted roles, create verification threads, admin override commands.

7. **Chunk G: Prompt Strategy & Few-Shot**  
   - Enhance GPT calls, refine prompt format, test borderline user profiles.

8. **Chunk H: Persistence & Logging**  
   - Store flagged data in Supabase, add logs/analytics as time allows.

9. **Chunk I: Cross-Server / Advanced Features**  
   - Expand logic to share data among servers, add optional advanced features.

---

# 3. Further Iteration into Smaller Steps

We’ll refine each chunk into smaller steps for safe, incremental building:

## 3.1 Chunk A: Project & Testing Setup
1. **A1**: Create Git repository, run `npm init -y`.  
2. **A2**: Install dev dependencies: `typescript`, `ts-node`, `jest`, `@types/jest`, `ts-jest`.  
3. **A3**: Configure `tsconfig.json` and `jest.config.js`.  
4. **A4**: Add a sample test (`src/__tests__/sanity.test.ts`).  
5. **A5**: Setup a basic GitHub Actions workflow to run `npm test`.

## 3.2 Chunk B: Minimal Discord Bot
1. **B1**: Install `discord.js`.  
2. **B2**: Create `Bot.ts` with a simple `Client`.  
3. **B3**: Listen for `ready` event and log a success message.  
4. **B4**: Implement `!ping` command, returning `Pong!`.  
5. **B5**: Write a test ensuring the bot can load without errors (mock Discord.js if needed).

## 3.3 Chunk C: Heuristic Spam Detection
1. **C1**: Create a `HeuristicService` class with minimal logic for tracking message frequency.  
2. **C2**: Hardcode thresholds (e.g. 5 messages in 10 sec).  
3. **C3**: If threshold exceeded, mark user as suspicious.  
4. **C4**: Write unit tests verifying the logic for normal vs. spammy usage.  
5. **C5**: Add a simple suspicious keyword check (e.g., “nitro scam” → suspicious). Test coverage.

## 3.4 Chunk D: GPT Integration
1. **D1**: Install `openai`.  
2. **D2**: Create a `GPTService` class that can accept user data + context → returns classification.  
3. **D3**: In test environment, mock the GPT call to return “SUSPICIOUS” or “OK” based on dummy input.  
4. **D4**: Write a real (non-mocked) test to confirm actual GPT response (may not be run often).  
5. **D5**: Ensure secrets are loaded from `.env`.

## 3.5 Chunk E: Combined Detection Flow
1. **E1**: Create a `DetectionOrchestrator` that calls `HeuristicService` first.  
2. **E2**: If borderline, pass user data to `GPTService`.  
3. **E3**: Return a final suspicion flag.  
4. **E4**: Write integration tests for normal, borderline, and obviously spammy.  
5. **E5**: Ensure the bot uses `DetectionOrchestrator` on message events.

## 3.6 Chunk F: Verification & Role Management
1. **F1**: Add a “Restricted” role to test server, store its ID in `.env` or config.  
2. **F2**: When user is flagged, apply restricted role.  
3. **F3**: Create a `!verify` or similar command for admins.  
4. **F4**: Write tests verifying that flagged user is assigned the restricted role.  
5. **F5**: Optionally open threads for suspicious users with a short prompt, test that the thread is created.

## 3.7 Chunk G: Prompt Strategy & Few-Shot
1. **G1**: Refine `GPTService` prompt to include few-shot examples.  
2. **G2**: Develop borderline user profiles as test fixtures (recent account + normal bio, or older account + suspicious bio).  
3. **G3**: Evaluate whether GPT improves classification with these examples.  
4. **G4**: Adjust logic if needed (confidence thresholds).  
5. **G5**: Update tests to include these borderline scenarios.

## 3.8 Chunk H: Persistence & Logging (Supabase)
1. **H1**: Install & configure Supabase client.  
2. **H2**: Create a table for storing flagged actions (userID, suspicion reason, timestamp).  
3. **H3**: Add logging calls in `DetectionOrchestrator`.  
4. **H4**: Test storing and retrieving flagged user data from Supabase.  
5. **H5**: Possibly add a simple admin command to list flagged users.

## 3.9 Chunk I: Cross-Server / Advanced Features
1. **I1**: Create a table for user “reputation” across multiple servers.  
2. **I2**: When a user is flagged in one server, reflect that in the shared DB.  
3. **I3**: On other servers, factor cross-server suspicion into detection logic.  
4. **I4**: Test with multiple mock servers and confirm repeated suspicious activity is recognized.  
5. **I5**: Evaluate performance, cost, final reliability.

---

# 4. Series of Code-Generation Prompts for a TDD Approach

Below is a **step-by-step set of prompts** that build on each other. Each prompt focuses on a discrete chunk. You’d feed these to your code-generation LLM (e.g., GPT-4) to produce the relevant code and tests incrementally.

> **Important:** Each prompt is enclosed in triple backticks to indicate “text” usage, as requested.

---

## 4.1 **Prompt: Chunk A – Project & Testing Setup**

```text
You are assisting with a TypeScript project for a Discord anti-spam bot. 

**Task**: Initialize the project and testing environment. 

**Requirements**:
1. Create a new Node.js project (`npm init -y`).
2. Install these dev dependencies: `typescript`, `ts-node`, `jest`, `ts-jest`, `@types/jest`.
3. Configure `tsconfig.json` for Node (ES2020 or later).
4. Create a minimal `jest.config.js` with TypeScript support.
5. Add a sample test in `src/__tests__/sanity.test.ts` that checks true === true.
6. Provide instructions to run tests via `npm test`.
7. No Discord or GPT code yet.

**Output**:
- The relevant `package.json` changes.
- The `tsconfig.json`.
- The `jest.config.js`.
- The sample test file content.

Write all code. Then summarize steps to initialize, run, and confirm everything works. 

Begin now.
```

---

## 4.2 **Prompt: Chunk B – Minimal Discord Bot**

```text
We have a working TypeScript + Jest setup. Now we want to create a basic Discord bot.

**Task**:
1. Install `discord.js`.
2. Create a `Bot.ts` that exports a `startBot()` function.
   - It should log in using a token from an environment variable, e.g. `process.env.DISCORD_TOKEN`.
   - Listen for the `ready` event and log “Bot is ready!”.
   - Listen for messages. If message content is `!ping`, reply with `Pong!`.
3. Write a test to ensure that `startBot()` doesn’t throw errors. You can mock `discord.js` if necessary.
4. Provide instructions for running the bot locally.

**Output**:
- The new/modified code files (e.g., `Bot.ts`, `startBot.test.ts`).
- Explanation of how to load environment variables (`.env`).

Begin now.
```

---

## 4.3 **Prompt: Chunk C – Heuristic Spam Detection**

```text
We now have a minimal Discord bot. Next, add heuristic spam detection.

**Task**:
1. Create a `HeuristicService.ts` that tracks message frequency:
   - If a user sends >5 messages in 10 seconds, mark them as suspicious.
2. Add a suspicious keyword check (e.g., “nitro scam”).
3. Write unit tests for `HeuristicService` to ensure it flags users appropriately.
4. Integrate `HeuristicService` into the bot’s message event:
   - If flagged, just log “User flagged for spam” for now.

**Output**:
- `HeuristicService.ts` with two main checks: frequency and suspicious keywords.
- `HeuristicService.test.ts` verifying correct flags.
- Updated `Bot.ts` or message handler to call `HeuristicService`.
- Example usage in readme or code comments.

Begin now.
```

---

## 4.4 **Prompt: Chunk D – GPT Integration**

```text
We have basic heuristics. Now we want to add GPT-based analysis.

**Task**:
1. Install `openai`.
2. Create a `GPTService.ts` with a function `classifyUserProfile(profileData: any): Promise<string>` returning either “OK” or “SUSPICIOUS”.
3. Add minimal prompt logic (e.g., “You are a Discord moderation assistant. Classify user.”).
4. Write unit tests mocking the openai client (return “OK” or “SUSPICIOUS”).
5. Add environment variable `OPENAI_API_KEY`.
6. Do not integrate with the bot flow yet—just build and test `GPTService`.

**Output**:
- `GPTService.ts`, `GPTService.test.ts`.
- Mock example in tests.
- Explanation of how to set the `OPENAI_API_KEY`.

Begin now.
```

---

## 4.5 **Prompt: Chunk E – Combined Detection Flow**

```text
Combine heuristics and GPT-based analysis.

**Task**:
1. Create a `DetectionOrchestrator.ts` that:
   - Calls `HeuristicService` to get a suspicion score or label.
   - If borderline or uncertain, calls `GPTService`.
   - Produces a final label: “OK” or “SUSPICIOUS.”
2. Add integration tests that simulate:
   - Obvious spam scenario (heuristics alone).
   - Borderline scenario → GPT call.
   - Normal scenario → no flag.
3. Integrate `DetectionOrchestrator` into the bot. On message event:
   - If final label is “SUSPICIOUS,” log it for now.

**Output**:
- `DetectionOrchestrator.ts` & `.test.ts`.
- Updated bot logic that uses the orchestrator in the message listener.
- Sample test data for borderline messages.

Begin now.
```

---

## 4.6 **Prompt: Chunk F – Verification & Role Management**

```text
Add restricted role assignment, plus minimal admin override commands.

**Task**:
1. In `Bot.ts`, store a “Restricted Role” ID from `.env` or a config file.
2. When `DetectionOrchestrator` returns “SUSPICIOUS”, apply the restricted role to that user if possible.
3. Create an admin-only command “!verify @user” that removes the restricted role from a user.
4. Write tests to mock role assignment methods.
5. Document how to set the restricted role ID.

**Output**:
- Role management logic (in the message event or a separate `RoleService.ts`).
- Tests verifying role assignment and admin override.
- Updated readme: how to set restricted role ID, how to verify flagged users.

Begin now.
```

---

## 4.7 **Prompt: Chunk G – Prompt Strategy & Few-Shot**

```text
Refine the GPT classification with a few-shot approach for borderline user profiles.

**Task**:
1. Update `GPTService` to include example user profiles in the prompt (few-shot examples).
2. Provide at least 2–3 examples labeled as “OK” or “SUSPICIOUS.”
3. Add or update tests with borderline user data to see if classification improves.
4. Possibly add a small config for altering thresholds or example prompts.

**Output**:
- Updated `GPTService.ts` with new prompt logic.
- Additional tests verifying borderline improvements.
- Explanation of how to tweak few-shot data.

Begin now.
```

---

## 4.8 **Prompt: Chunk H – Persistence & Logging (Supabase)**

```text
Add persistent logging for flagged users, storing them in Supabase.

**Task**:
1. Install and configure the Supabase JS client.
2. Create a table (e.g., “flagged_users”) with columns: userId, reason, timestamp.
3. In `DetectionOrchestrator` or a “LoggingService”, insert a record when a user is flagged “SUSPICIOUS.”
4. Write a test that mocks Supabase, verifying that it receives the correct data.
5. Optionally add a command “!flagged” that lists all flagged users from the DB.

**Output**:
- `LoggingService.ts` or `DatabaseService.ts` with Supabase logic.
- Tests ensuring DB insertion and retrieval.
- Updated docs for DB setup.

Begin now.
```

---

## 4.9 **Prompt: Chunk I – Cross-Server / Advanced Features**

```text
Optional advanced features for multi-server user reputation.

**Task**:
1. Extend your Supabase schema to track user reputation across multiple servers.
2. Adjust detection logic to incorporate external reputation (if user is flagged in X servers, raise suspicion).
3. Provide tests simulating a user flagged in one server then joining another.
4. Confirm the final integration is stable and maintainable.

**Output**:
- Updated schema, queries, and logic for cross-server reputation.
- Tests verifying multi-server flow.
- Explanation of limitations or next steps.

Begin now.
```

---

## 4.10 Final Integration & Cleanup

```text
Now we tie everything together and ensure no orphan code remains.

**Task**:
1. Review each chunk’s code, ensure code references are correct and that all services are injected or imported as needed.
2. Clean up logs, finalize readme, confirm test coverage.
3. Provide a final demonstration on how to run the bot, set environment variables, and see it in action on a test Discord server.

**Output**:
- The final, fully integrated code.
- A checklist that everything is configured (env, roles, GPT).
- A summary of how to operate, test, and maintain the bot.

Begin now.
```

---

## 5. Closing Notes
- These prompts ensure **progressive and test-driven development**.  
- Each step references prior code. No leftover or orphan modules.  
- Heuristics, GPT integration, role management, and eventually advanced features are layered piece by piece.  

By following these carefully separated prompts in sequence, you (and your code-generation LLM) can incrementally build a robust, thoroughly tested spam detection and prevention bot without sudden leaps in complexity.