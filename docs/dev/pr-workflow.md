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
npm run check
```

If you're touching Prisma or anything that hits the DB, also run:

```bash
npm run test:integration
```

## Repo settings (one-time)

These are configured in GitHub settings (not in git):

- Protect `main` so merges require PRs.
- Require CI to pass before merging (the GitHub Actions workflow in `.github/workflows/ci.yml`).
- If using Greptile status checks, optionally require the Greptile check before merging.
- Keep Copilot + Greptile automated reviews enabled.

## AI review + recycle loops

We want each merge to have:

- Automated CI checks passing.
- Greptile review completed.
- Copilot code review requested/completed.

Practical loop:

1. Open the PR as a Draft early.
2. Let CI + automated reviews run.
3. Treat each review cycle as a fresh context window:
   - Put the critical context in the PR description (or a pinned PR comment).
   - Use the PR template's "AI Review Packet" section.
4. For a re-review after major changes, comment `@greptileai` on the PR.
5. Apply fixes in a new commit, push, and repeat until green.

## Asking questions during reviews

If a reviewer/agent needs clarification, ask in PR comments. That keeps answers visible to
the next fresh-context review cycle.

## Merge

- Prefer squash merges.
- After merge: delete the branch and remove the local worktree.
