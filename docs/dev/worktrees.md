# Git Worktrees (Parallel Branches)

This repo uses `git worktree` so you can run multiple branches in parallel (including multiple
OpenCode/agent sessions) without constantly switching branches.

## Recommended layout

- Keep the main repo checkout as your "base" clone.
- Put worktrees in a sibling directory so they don't share `node_modules/` and don't collide.

Example (Windows):

- Base repo: `D:\\bench\\drasil`
- Worktrees: `D:\\bench\\drasil-wt\\<name>`

Example (macOS/Linux):

- Base repo: `~/projects/drasil`
- Worktrees: `~/projects/drasil-wt/<name>`

## Create a worktree

From your base repo checkout:

```bash
git fetch origin
mkdir -p ../drasil-wt
git worktree add -b fix/issue-123-short-name ../drasil-wt/issue-123 origin/main
```

Notes:

- Prefer `origin/main` as the starting point.
- Use short, readable worktree names.

## Day-to-day commands

```bash
# list worktrees
git worktree list

# remove a worktree (run from base repo)
git worktree remove ../drasil-wt/issue-123

# prune stale metadata (after manual deletes)
git worktree prune
```

## Dependencies per worktree

Each worktree is its own working directory; install deps per worktree:

```bash
npm ci
```

Avoid sharing `node_modules/` between worktrees.

## Safe `.env` handling

`.env` is gitignored. For each worktree:

```bash
cp .env.example .env
```

Local-only shortcut (never commit secrets):

```bash
cp ../drasil/.env .env
```

Rules:

- Do NOT paste secrets into issues/PRs/logs.
- Prefer `.env.example` to document required variables.
- OpenCode denies reading `.env` by default; treat that as a feature.

## Integration tests + databases

CI runs integration tests against a Postgres service.

Locally, integration tests can collide if multiple worktrees share the same database/schema.
Keep it boring:

- Run integration tests from one worktree at a time, OR
- Give each worktree its own `TEST_DATABASE_URL` / database.

## OpenCode permissions (access worktrees without prompts)

If you start OpenCode inside the base repo (for example `D:\\bench\\drasil`), a sibling
worktree directory (for example `D:\\bench\\drasil-wt`) is considered an "external directory" by
OpenCode permissions.

Two good options:

1. Start OpenCode from the parent directory (so both base repo and worktrees are inside the
   workspace).
2. Allow worktree paths via the `external_directory` permission.

OpenCode config locations (see OpenCode docs):

- Global: `~/.config/opencode/opencode.json`
- Per project: `opencode.json` in the repo root

On Windows, `~/.config` typically resolves under your user profile (for example
`C:\\Users\\<you>\\.config\\opencode\\opencode.json`).

Example snippet (prefer the narrowest path you trust):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "D:/bench/drasil-wt/**": "allow"
    }
  }
}
```

If you truly want all of `D:\\bench` allowed:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "D:/bench/**": "allow"
    }
  }
}
```

Reference: OpenCode `external_directory` permissions: https://opencode.ai/docs/permissions/#external-directories
