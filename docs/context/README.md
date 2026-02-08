# Drasil: Project Context

This directory contains project context docs for Drasil (Discord Anti-Spam Bot). These files are reference material for architecture, product intent, and current state.

For day-to-day agent guidance, prefer the repo root rules in `AGENTS.md`. These docs are meant to be read on demand (load only what's relevant to the task).

## Core docs

These files are the best starting points when you need deeper product/context:

1. **projectbrief.md**

   - Foundation document that shapes all other files
   - Defines core requirements and goals
   - Source of truth for project scope

2. **productContext.md**

   - Why this project exists
   - Problems it solves
   - How it should work
   - User experience goals

## Current workflow and verification behavior

- Primary workflow: `docs/workflow.md`
- Manual regression + test ideas: `docs/test-cases.md`

## Usage Guidelines

- **Reading order**: Read only what you need; when in doubt, start with `projectbrief.md` then jump to the most specific doc.
- **Updates**: Update docs when:
  - Completing significant features
  - Making architectural changes
  - Shifting development focus
  - Discovering new patterns or insights
- **Consistency**: Ensure information is consistent across all files
- **Completeness**: Each file should be comprehensive within its domain

## Legacy docs

Older plans, learnings, and the migrated "memory bank" docs are archived in `docs/legacy/`. Treat those as historical reference rather than current source of truth.

- Migrated memory-bank docs: `docs/legacy/memory-bank/`

## Additional Context

As the project evolves, additional files or folders may be added under `docs/` (preferably `docs/context/` for current reference docs) to organize:

- Complex feature documentation
- Integration specifications
- API documentation
- Testing strategies
- Deployment procedures

These should be referenced from the core files to maintain the hierarchical structure.
