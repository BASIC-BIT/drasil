---
name: opencode-external-directory
description: Configure OpenCode external_directory permissions for multi-repo workspaces and worktrees.
compatibility: opencode
---

Use this when OpenCode prompts for access to paths outside the repo you started it in.

## Why

OpenCode treats paths outside the current working directory as "external" and may prompt for
permission when reading/searching/editing them. This is common when using sibling `git worktree`
directories or when you keep multiple repos under a single workspace root.

## Where to configure

Prefer a global (per-machine) config:

- `~/.config/opencode/opencode.json`

Project configs (`opencode.json` in the repo root) are also supported, but avoid committing
personal path allowlists to a shared repository.

## Minimal example

Allow reads/searches across a workspace root:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/**": "allow",
      // "C:/projects/**": "allow"
    },
  },
}
```

## Safer example (deny edits outside your repo)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": {
      "~/projects/**": "allow",
    },
    "edit": {
      "~/projects/**": "deny",
    },
  },
}
```

## Local notes

If you want to record your machine's workspace root or preferred patterns, put them in a local-only
`AGENTS.local.md` file (gitignored).

Reference: https://opencode.ai/docs/permissions/#external-directories
