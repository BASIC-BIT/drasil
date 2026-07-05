# Codex Notes

Drasil has historically kept durable agent playbooks in OpenCode skills. Codex should reuse
those playbooks through thin wrappers rather than duplicating long workflow text.

## Startup

- Read `AGENTS.md` first, and `AGENTS.local.md` when present.
- The base checkout may be a protected `main` mirror. Use `docs/dev/worktrees.md` and local
  guidance before editing.
- Keep private server, guild, customer, and production-environment names out of public prose.

## Skills

The OpenCode source skills live under `.opencode/skills/<name>/SKILL.md`.

Codex wrappers live under `.codex/skills/<name>/SKILL.md`. Each wrapper keeps Codex-valid
frontmatter and points back to the OpenCode source skill. If a Codex session does not
auto-discover repo-local skills, open the wrapper or source skill by path.

Current wrappers:

- `db-reset-local`
- `git-worktrees`
- `pr-workflow`
- `prisma-workflow`
- `testing-integration`

Keep `.opencode/skills` as the detailed source of truth. Keep `.codex/skills` as thin
compatibility shims with only `name` and `description` in frontmatter.

## Tool Mapping

- OpenCode-specific wording in source skills should be translated to the available Codex tools in
  the current session.
- For GitHub and PR review loops, prefer a GitHub connector when available; otherwise use `gh`
  and the PR workflow docs.
- For frontend verification, use the Codex Browser or Playwright MCP when available, plus the
  repo's web test commands.
- For library, SDK, CLI, and cloud-service docs, use Codex documentation tools such as Context7
  when available, or primary-source docs when required.
- For reminders, monitors, or follow-ups, use Codex automations only when the user asks for that
  behavior.

## MCPs

No project-scoped OpenCode MCP servers are committed for Drasil today: there is no repo
`opencode.json` MCP inventory to mirror into Codex.

Codex project MCP config lives at `.codex/config.toml`. Leave it without `[mcp_servers.*]`
entries until Drasil has an explicit repo-scoped MCP server to launch. Generic Codex MCPs such
as Playwright, GitHub, Context7, or Node REPL may still be available from global config or
plugins; verify the active tool surface before relying on one.

PostHog and Phoenix docs in `docs/dev/` describe Drasil runtime integrations, not MCP access.
Do not add PostHog or Phoenix MCP entries unless a Drasil-specific endpoint and authentication
path are explicitly chosen.

Run `npm run agent:check` after changing `.opencode`, `.codex`, or this document.
