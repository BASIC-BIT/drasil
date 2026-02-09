# GitHub Copilot Instructions (Drasil)

Repository context:

- This is a Discord anti-spam bot (TypeScript + Node.js) with persistence via Prisma/Postgres.
- Orchestration is direct (controllers call services; no internal EventBus).

When generating code or reviewing PRs:

- Follow `AGENTS.md` and keep diffs tight.
- Prefer boring, reliable changes over clever ones.
- Do not add secrets/credentials to git or to PR comments.
- Keep types explicit for public APIs; avoid `any`.
- Update or add tests when changing behavior.

Quality bar:

- CI runs `npm run check:ci` (format:check, lint, build, unit tests, integration tests).
- Prefer changes that keep `npm ci` working (lockfile committed).
