# MCP development

Drasil exposes `/api/mcp` as stateless HTTPS Streamable HTTP in the existing Next Node app. Its separate maintained OAuth issuer is `/api/mcp-auth`. Bot-only commands use the durable moderation queue; there is no bot listener or RPC. MCP defaults off. Existing website authentication and Discord commands retain their paths.

## Client setup and confirmation

After an explicitly approved rollout, configure a standard remote MCP client with `https://<public-app-host>/api/mcp`. Use OAuth discovery, authorization-code PKCE and the exact resource URL. Sign in with Discord, select eligible servers, then approve the requested scopes. Register the extra Discord callback `https://<public-app-host>/api/mcp-auth/callback/discord`; retain the existing `/api/auth/discord/callback`. Client redirect URIs belong to the maintained provider's validated registration flow. Do not turn off its redirect validation for a client.

Access tokens last 15 minutes. Refresh tokens last 30 days under the maintained provider's rotation/reuse policy; this is not an absolute connection lifetime. Connections may be revoked or their selected servers changed. Every action rechecks current authority; a prior OAuth consent does not freeze Discord permissions.

Mutations require a caller-generated 1–128-character idempotency key. Repeating an identical request returns its original intent/receipt; changing arguments requires a new key. Pending intents expire after ten minutes or the bound preview's expiry, whichever is earlier. Show the exact saved summary before approval. Native elicitation or the explicit `confirm_action` tool is the default; authenticated website and Discord approval use the same saved intent and original actor. Page loads and summary/result pagination never approve or execute an action.

A confirmation ID proves binding to a saved action, not that a person saw it. Client approval and elicitation depend on the host's user-interaction contract, including any auto-approval setting. Deployments requiring independent observation can use the website or Discord approval path. Initial host approval of a tool invocation does not approve a later generated summary.

## Budgets and retries

All application limits use rolling windows in shared Postgres, with database time and atomic, ordered multi-subject locks. A rejected combined decision charges none of its subjects. Guild charging requires fresh authorization for the operation/read; a denied or unavailable target context charges only the trusted caller connection/user attempt budgets. Accounting uses the exact authorization decision returned to the operation before private resolution or effects, once per invocation. It never substitutes for the shared definitive-denial persistence path. Rate-limited confirmations remain pending and retryable. Budgets count admitted attempts, including invalid downstream requests; they are not refunded on a provider error.

| Per minute                              | Connection | Discord user | Guild |
| --------------------------------------- | ---------: | -----------: | ----: |
| Reads/status/previews                   |        120 |          240 |   600 |
| Submissions/confirmations/cancellations |         30 |           60 |    60 |
| First durable intent insertions         |         20 |           40 |    40 |

Identical idempotent retries do not consume another new-intent allowance. Live intent capacity remains 128 per connection and 1,024 per user; elapsed intents stop consuming capacity without waiting for cleanup. Explicit site/Discord approvals and cancellations use the shared service. Read-only page navigation uses the read budget.

Public dynamic registration has combined limits of 10 per verified IP/hour and 100 globally/hour before client allocation, in addition to the provider's five/minute endpoint rule. Shared metadata transport limits cover both CIMD documents and discovery-owned JWKS: 16 concurrent messages, 120 starts/minute globally and 30/minute per origin. Native provider pacing, cache/coalescing, four concurrent requests/origin, public DNS pinning, TLS identity, redirect rejection, JSON/body limits and deadlines remain enabled.

Respect returned `Retry-After`, `retryAfterSeconds` or `retryAfterMs`. Back off; do not loop retries with new intent keys. Default list size is 25, maximum 100. Continue with the returned cursor, even when the requested row count is clipped by the result-size budget. Results have a 64 KiB budget. Request bodies use the SDK's separate maintained 4 MiB default, enforced before the handler's JSON pre-parser, including streamed byte accounting.

## Queue outcomes and audit

The worker normally polls about every five seconds; MCP waits at most five seconds within the request budget. A queued receipt is normal. Poll `get_action_status` with its execution ID. Public outcomes distinguish queued, running, completed, denied, failed, partial and uncertain. There is no exactly-once promise for external Discord effects.

The generic execution start is the admission boundary for ordinary workflows. Native ban/kick also has an atomic fence immediately before the provider send. Stale MCP processing claims cannot admit new work or revive their heartbeat after the existing 15-minute lease. Polling settles unstarted interruptions as failed and admitted interruptions conservatively as uncertain. Already-bound envelopes observe only. Completion from the actual original owner can still win after interruption; observers and late failures cannot replace a completed queue receipt. Completed ordinary domain partial results remain final; this does not create a generic retry or promotion mechanism. Protected report-ban recovery retains its specialized compare-and-set promotion, and exact committed CAPTCHA, quarantine and completed cleanup continuations remain available without replaying effects. Incomplete cleanup and a succeeded ban alone do not authorize another deletion pass.

Direct executions with a durable start but no completion immediately project uncertain on retry/status and never automatically replay. Status does not perform generic domain reconciliation. Investigate the domain's existing evidence before considering a fresh intentional request.

Operational audit logs allowlist original actor, guild, client, connection, grant version, workflow, confirmation method, execution/request IDs, outcome and queue delay. Expiry, denial and partial/uncertain outcomes retain explicit fields. Client identifiers containing URL syntax or other unsafe characters are represented by a stable hash in logs; the original remains in protected persistence. Provider logs retain severity only: provider messages/arguments can contain credentials and are deliberately omitted. Immutable intent/execution/queue provenance remains the protected source of record. Never log command bodies, raw Errors, authorization headers, refresh/access tokens, CAPTCHA credentials or private fencing tokens.

Bot polling prunes only application-owned ephemeral data, independently of enablement and with failures isolated from moderation. It deletes expired/cancelled unconsumed intents after seven days from expiry (including idle elapsed pending rows), and rate buckets one day after their expiry, with at most 500 total deletions per poll. An explicit execution-absence guard prevents foreign-key cascades. Denied/consumed intents, executions, queue/report-ban outcomes and authorization references are retained. Provider-owned row cleanup remains the provider's separate lifecycle.

## Local verification

Use only an owned disposable database and serialize database suites. Build `@drasil/application` before consumer tests and after shared changes. The task fixture uses `127.0.0.1:55433/drasil_mcp_test`; never point truncating integration fixtures at another database. Source inspection and synthetic header tests do not prove deployed ingress or real-client behavior. Full CI and the ChatGPT/Codex/Claude acceptance matrix are separate launch gates.

See [client acceptance](mcp-client-compatibility.md) for the current client matrix, reproducible controlled journeys and unresolved launch requirements.
