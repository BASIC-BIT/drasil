# MCP Continuation Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Distinguish hosted continuation rejection causes safely.

**Architecture:** Observe the bounded body reader and wrap the maintained request-state codec. Emit strictly selected metadata under the existing request context; preserve all validation and error behavior.

**Tech Stack:** Existing TypeScript, maintained MCP SDK, Vitest.

**Spec:** docs/superpowers/specs/2026-10-26-mcp-continuation-diagnostics-design.md

## Global Constraints

- Logging only; retain codec TTL, bindings, public errors and action semantics.
- No state values, MACs, tokens, principals, guild IDs, commands, summaries or raw errors in events.
- No live actions or production changes during implementation.
- Observer failures never affect results or exceptions.
- Use existing packages and request-local correlation.

## Review Focus

- Non-string state rejected before the verify hook remains visible.
- Wire protocol and field locations follow the pinned SDK, not assumptions.
- Unknown or hostile values cannot enter logs through spread objects or error messages.
- Fresh HTTP handler instances and sibling requests remain independent.
- Logger failures preserve original throws, including object identity.

### Task 1: Instrument continuation boundaries

Files: add a focused helper/test in apps/web/lib/mcp; modify body.ts/body.test.ts and server.ts/server.test.ts; update docs/deploy/mcp.md with operational interpretation.

- [ ] Read the SDK's actual wire-state accessor, body wrapper and codec before choosing helper signatures.
- [ ] Write tests proving safe classified events, privacy, malformed wire visibility, correlation isolation, sink-failure isolation, and unchanged SDK acceptance/denial.
- [ ] Run tests red, implement minimal helpers and wire observers, then run green.
- [ ] Run web tests, web typecheck/lint, formatting and required CI; record limitations.
- [ ] Commit and perform independent scoped and final review before publishing one PR.

Deployment and another live test follow reviewed integration through the normal release process; this change alone establishes no live root cause.
