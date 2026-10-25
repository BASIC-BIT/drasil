# Issue -> Branch -> PR Workflow

This is the default "ship" workflow for Drasil.

Goals:

- Track work via GitHub issues.
- Land changes via PRs (not direct pushes to `main`).
- Make it safe to run multiple agent sessions in parallel.
- Ensure every merge is reviewed (AI + humans as needed) and passes CI.

## Before coding

1. Create or pick an issue.
2. Write/confirm acceptance criteria on the issue.
3. Create a branch (ideally in a worktree) and do the work there.

## Branch + worktree

Recommended branch naming:

- `fix/<short-desc>-<issue>`
- `feat/<short-desc>-<issue>`
- `chore/<short-desc>-<issue>`

Worktree details: `docs/dev/worktrees.md`.

## PR requirements

Every PR should include:

- Linked issue(s): `Closes #123`.
- "How to test" steps (commands or manual checks).
- Scope boundaries (what you did NOT change).
- Any migration/setup notes if applicable.

Keep diffs tight. If the PR is doing two things, split it.

## Local quality gate

CI runs `npm run check:ci`.

Before pushing (when feasible):

```bash
npm ci
npm run format:check
npm run check
```

Database suites truncate their fixtures. Use a dedicated local Postgres 16 instance
on loopback port `55433` with database `drasil_mcp_test`; the development Supabase
database is a separate target. For example, provision the disposable instance once:

```bash
docker run -d --name drasil-test -p 127.0.0.1:55433:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=drasil_mcp_test postgres:16
```

After Postgres is ready, configure all three URLs identically and prepare its schema:

```bash
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/drasil_mcp_test?schema=public'
export DATABASE_URL="$TEST_DATABASE_URL"
export POSTGRES_DB_URL="$TEST_DATABASE_URL"
npm run test:db:prepare
npm run test:integration
```

The test guard accepts only this local target or CI's loopback `5432/drasil_test`,
with an absent or `public` schema parameter. Run database consumers serially,
including across worktrees. `npm run check:ci` prepares the database before web
coverage, then runs the native, web issuer/DB and MCP browser suites in order.
`npm run db:reset:local` retains its separate development-database behavior.

## Repo settings (one-time)

These are configured in GitHub settings (not in git):

- Protect `main` so merges require PRs.
- Require CI to pass before merging (the GitHub Actions workflow in `.github/workflows/ci.yml`).
- If using Greptile status checks, optionally require the Greptile check before merging.
- Keep Claude, Copilot, and Greptile automated reviews enabled. Claude setup and behavior are
  documented in `docs/dev/claude-review.md`.

## AI review + recycle loops

We want each merge to have:

- Automated CI checks passing.
- Greptile review completed.
- Copilot code review requested/completed.
- Claude's latest sticky review comment checked for every eligible trusted PR. The reviewer
  retrieves the shared credential through the repository-bound AWS OIDC role described in
  `docs/dev/claude-review.md`; Drasil has no repository copy.

Practical loop:

1. Open the PR as a Draft early.
2. Let CI + automated reviews run.
3. Treat each review cycle as a fresh context window:
   - Put the critical context in the PR description (or a pinned PR comment).
   - Use the PR template's "AI Review Packet" section.
4. For a re-review after major changes, comment `@greptileai` on the PR.
5. After each push, reread Claude's marker-owned sticky comment because it updates in place.
6. Apply fixes in a new commit, push, and repeat until green.

## Asking questions during reviews

If a reviewer/agent needs clarification, ask in PR comments. That keeps answers visible to
the next fresh-context review cycle.

## Merge readiness

Before merging, ensure:

- All required checks pass (CI + required review/status checks).
- All PR review threads are resolved.
  - If a comment is not applicable (common for AI-generated reviews), reply with a brief rationale
    and then resolve the thread so the merge state is unambiguous.

## Merge

- Prefer squash merges.
- After merge: delete the branch and remove the local worktree.
