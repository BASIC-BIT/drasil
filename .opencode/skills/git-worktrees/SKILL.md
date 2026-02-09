---
name: git-worktrees
description: Use git worktrees for parallel feature branches and agent sessions in Drasil.
compatibility: opencode
---

Use this when you want to work on multiple branches in parallel without stashing/switching.

## Core commands

From the base repo checkout:

- List worktrees: `git worktree list`
- Create branch + worktree: `git worktree add -b feat/my-change ../drasil-wt/my-change origin/main`
- Add worktree for an existing branch: `git worktree add ../drasil-wt/my-change feat/my-change`
- Remove a worktree: `git worktree remove ../drasil-wt/my-change`
- Prune stale metadata: `git worktree prune`

## Drasil notes

- Run `npm ci` in each worktree (do not share `node_modules`).
- Copy `.env.example` to `.env` per worktree; keep secrets local.
- Integration tests may collide if multiple worktrees share the same DB/schema.
  Run them one at a time or use separate databases.

## Safety

- Do not remove a worktree if it has uncommitted changes.
- Prefer one issue/feature per worktree.
