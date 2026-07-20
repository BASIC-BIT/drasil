# Claude PR Review

Drasil runs Claude as an automatic pull request reviewer through
`.github/workflows/claude-review.yml` for trusted same-repository PRs. The
workflow is based on Perkcord's hardened subscription-backed reviewer.

## Setup

Generate a Claude Code subscription OAuth token locally:

```sh
claude setup-token
```

Store the generated token as a GitHub Actions repository secret named
`CLAUDE_CODE_OAUTH_TOKEN`. Secret values cannot be retrieved or copied from
another repository, so Drasil must be provisioned separately.

The workflow passes that secret to a pinned `anthropics/claude-code-action`
commit through its `claude_code_oauth_token` input. The Claude generation job
gets only read-scoped GitHub permissions and a read-scoped `github_token`; it
does not need `id-token: write` or the Claude GitHub App OIDC token exchange. If
the secret is not configured, the workflow exits successfully with a notice
instead of failing pull requests.

Treat the token like any other automation secret. It consumes the
subscription's Claude Code quota and rate limits rather than Anthropic API
token billing.

Create the repository label `skip-claude-review` so maintainers can suppress a
review when needed.

## Triggers

- Open, update, reopen, or mark ready for review on a trusted same-repository,
  non-draft pull request.
- Add the `skip-claude-review` label to cancel queued or in-flight Claude work
  through `.github/workflows/claude-review-control.yml`. Removing the label
  re-enables review on the next eligible pull request event.

Fork, cross-repository, draft, bot-authored, and bot-triggered pull requests are
skipped because the workflow uses a repository secret and the Claude action is
not configured with `allowed_bots`.

The `synchronize` trigger reviews every subsequent commit. Workflow concurrency
cancels older runs for the same pull request so only the latest head publishes.

## Security and Output

The workflow owns one top-level comment marked with
`<!-- claude-pr-review -->`. A small write-scoped preparation job creates or
finds that marker-owned comment. On follow-up runs it resets the comment to a
queued notice for the current commit before review begins, so a completed review
for an older head is never left looking current. Claude runs in a separate
read-scoped job and returns Markdown; a later trusted job publishes that output
only if the pull request head still matches the reviewed commit.

Claude is restricted to the `Read` tool and denied shell, file writes, edits,
GitHub comment tools, `.git`, `/proc`, and runner credential/config paths. The
checkout does not persist credentials. Pull-request-provided Claude hooks,
skills, plugins, MCP servers, memory, and `CLAUDE.md` customizations are disabled
by safe mode. Line-specific findings use file and line references in the sticky
comment rather than independent review threads.

The Claude CLI is capped at 100 turns. If it hits the cap or fails to produce a
review, treat the failed job and sticky-comment notice as missing review
evidence rather than code feedback.

The Claude action is pinned to a reviewed commit SHA rather than a mutable tag
because it receives a Claude OAuth token. Update the SHA deliberately after
reviewing the upstream release.

The workflow intentionally does not expose `issue_comment` or
`workflow_dispatch` review triggers. Review remains tied to pull request commits
and the marker-owned sticky comment.

## Review Calibration

`REVIEW.md` is the repo-specific review contract. Keep it short and focused on
what changes Claude's behavior: Important severity, noise suppression, evidence
quality, and Drasil moderation invariants. Do not duplicate all of `AGENTS.md`.

Treat Claude comments like other AI review feedback: validate each finding
against the code and product intent before changing anything. After every push,
reread the sticky comment because the workflow updates it in place.
