---
name: pr-workflow
description: Ship-safe issue -> branch/worktree -> PR workflow (with AI review loops) for Drasil.
compatibility: opencode
---

Use this when landing changes into `main`.

## Steps

1. Ensure there is a GitHub issue with acceptance criteria.
2. Create a branch (prefer a worktree) off `origin/main`.
3. Make changes; keep diffs tight; update tests/docs as needed.
4. Run the local gate:
   - `npm ci`
   - `npm run check`
5. Open a draft PR early and link issues in the PR body:
   - `Closes #123`
6. Keep the PR description (or a pinned PR comment) as the canonical context for fresh-context
   review + recycle loops.
7. Ensure automated checks are green:
   - CI (`npm run check:ci`)
   - Greptile Review status check
   - Copilot code review (if enabled)
8. Resolve PR review threads:
   - If a comment is not applicable, reply with rationale and resolve the thread.
9. If there are major changes after reviews, trigger a re-review:
   - comment `@greptileai` on the PR
10. Squash merge; delete the branch; remove the worktree.

## Notes

- Never paste secrets into PRs.
- If build fails due to missing Prisma client types, run `npm run prisma:generate`.
