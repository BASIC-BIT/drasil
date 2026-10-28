# MCP rollout and operations

Production web and worker MCP admission are enabled following the authorized rollout. On 2026-10-28, a controlled reversible configuration change and its restoration completed through native confirmation, queue execution, and receipts; separate reads verified both values. See [disablement and recovery](#disablement-and-recovery) for the enablement controls. For future incompatible releases, apply additive migrations and deploy the compatible bot worker before the web submitter; keep admission disabled until both versions and their queue support are verified. Existing web/Discord moderation stays available.

## Configuration and ingress

Web requires a configured public HTTPS origin and distinct random secrets of at least 32 characters for `DRASIL_MCP_AUTH_SECRET` and `DRASIL_MCP_CURSOR_SECRET`. Dynamic client registration also requires a separate stable `DRASIL_MCP_IP_HASH_SECRET`, `DRASIL_MCP_INGRESS=vercel-direct` and the hosting `VERCEL=1` marker. Missing/unsupported topology or a missing, malformed or ambiguous address fails registration closed before provider client allocation. Other MCP authentication remains provider-owned. The bot needs `DRASIL_MCP_ENABLED` and its existing database/Discord configuration, not issuer or cursor secrets.

The only supported registration topology is client → default direct Vercel ingress → Next Node route. Vercel documents replacing `x-forwarded-for`; the boundary accepts exactly one valid address from that replaced header. IPv4-mapped IPv6 is normalized to IPv4, and ordinary IPv6 shares a /64 bucket. Persisted application identities are domain-separated keyed hashes; raw addresses are not application audit fields. The provider retains its own normalized-IP rate keys and stock cleanup.

Environment markers are configuration, not ingress attestation. Before enabling registration, verify the actual deployed project/revision, custom domain, every reachable deployment/branch alias, default forwarding-header replacement, and absence of unreviewed proxies or header rewrites. Test forged single addresses, comma/duplicate chains, missing/invalid headers, alternate forwarding/internal headers and equivalent IP spellings. Verify no self-hosted origin can bypass this boundary. Source configuration and synthetic tests do not establish deployed spoof resistance. Unsupported proxy chains require separate design and verification; never accept an arbitrary forwarding header as a fallback.

Add the extra Discord OAuth callback `/api/mcp-auth/callback/discord` on the configured origin while retaining `/api/auth/discord/callback`. Check preview protection/data separation separately from ingress identity. Live reads and native confirmation have been verified on the connected hosted client. The full real-client acceptance matrix, exact client product versions and deployed ingress acceptance remain unverified. See [client acceptance](../dev/mcp-client-compatibility.md).

## Disablement and recovery

`DRASIL_MCP_ENABLED=true` enables new admission. Set it false in web and worker configuration and roll/restart every process to propagate disablement. This is a fleet rollout switch, not an instantaneous kill switch. Processes with old configuration may continue until replaced. New direct/queued starts check enablement; native ban/kick checks again at its actual provider-send fence. Generic admission is the effect boundary for other workflows and does not prove a provider received a request. Already admitted/fenced work and committed bookkeeping can finish; disabling cannot undo completed Discord effects. Keep workers polling so protected report-ban reconciliation, strict committed-only containment continuation and maintenance remain available.

The production Terraform stack defaults `drasil_mcp_enabled` to `true`, matching the approved worker rollout. Remove any older `false` override from the production Terraform inputs when preserving enablement. To disable worker admission deliberately, set `drasil_mcp_enabled=false`, apply the production stack, then run the worker deploy workflow so the service adopts that task definition. Web enablement is configured separately. Normal image deploys preserve the latest task definition's environment; IaC checks validate configuration without applying it.

Stale processing is settled conservatively without generic effect replay. A transient failure reading authority or committed evidence defers work instead of proving denial/absence. Check the original execution/queue and domain records when an outcome is uncertain. A fresh intentional retry can repeat an external effect; never clear a send fence or relabel an old request to force retry. Preserve completed receipts and immutable provenance.

## Read recovery rollout status

Initial diagnostics at revision `d8fc857` identified Discord HTTP 429 during concurrent reads. After the bounded GET recovery rollout, a production acceptance sample returned fifteen allowed reads, including two observed HTTP 429 responses that recovered on their second attempt. Keep raw diagnostic evidence and private identifiers outside the repository.

Future recovery changes should record their exact deployed revision, logical tools, outcomes, timings and safe correlation IDs, then repeat the bounded concurrent sample on the actual client. Synthetic recovery results alone do not establish deployed behavior. Production mutation tests require an authorized scope and target.

For recovery defaults, public outcomes and safe correlation fields, see [temporary read failures](../dev/mcp.md#temporary-read-failures). OAuth refresh/revoke, other clients' confirmation flows, other mutation families and ingress acceptance remain separate gates.

## Continuation diagnostics

`mcp_continuation` events observe the bounded HTTP body and the maintained SDK request-state codec. `wire` records present `params.requestState` before the SDK validates its type. `mint` records codec success or failure while preparing native confirmation. `verify` records codec success or failure on continuation. A non-string state produces a `wire` event with `malformed` and no `verify` event because the SDK rejects it before the hook. A string produces a `wire` event with `none`; this reports presence, not validity. Invalid JSON, absent state, rejected oversized bodies and state in other locations produce no wire event.

| Reason      | Interpretation                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `none`      | Wire string observed, or codec operation succeeded, according to the stage/outcome.             |
| `malformed` | Wire state is non-string, or the SDK codec rejected its format.                                 |
| `mac`       | SDK signature verification failed. A changed value or a different signing key can cause this.   |
| `expired`   | SDK rejected the signed expiry.                                                                 |
| `bind`      | SDK rejected the context binding.                                                               |
| `context`   | The existing binding callback threw while obtaining or digesting its context.                   |
| `unknown`   | An exception outside the recognized SDK categories occurred. Raw exception details are omitted. |

Each HTTP request receives a fresh server-generated `correlationId`. Its wire and verify events share that ID. Mint and continuation occur on separate requests and have different IDs, including across fresh handler instances. Correlation IDs cannot link an action or principal across requests. Outside an HTTP request context the ID is the fixed value `unavailable`.

Events include only fixed event/stage/outcome/reason values, an allowlisted protocol revision or `unknown`, a state type category, and string byte length capped at four MiB. Non-string values report zero bytes. They never contain state values, signatures, tokens, principals, guild IDs, commands, summaries or raw errors. Observation is best effort; a failing sink cannot change codec results, thrown values or public SDK errors. Codec success does not prove that saved-action validation or action acceptance succeeded.

This instrumentation does not fix or establish the cause of the hosted continuation failure. Deployment and another live acceptance test require separately reviewed authorization through the normal release process. The SDK codec, ten-minute TTL, principal/method binding, permission checks and saved-action validation remain in effect.

## Metadata permits

Shared `mcp_metadata_permits` rows count outstanding maintained metadata HTTP message work, including discovery-owned JWKS. A permit survives headers until streamed EOF, proven body cancellation/error, or transport rejection. The maintained HEAD/204/205/304 null-body contract is semantic HTTP-message completion and releases a permit; this is not a bound on TCP teardown/socket lifetime. Unexpected null bodies fail closed. Both pinned consumers reject non-200/non-304 status, redirects and non-JSON media before reading; the wrapper cancels those bodies before returning the unchanged response. It retains the provider's validation/errors and transport protections.

A caller timeout is not proof an underlying DNS lookup or transport has finished. Unresolved transport work, failed cancellation and crashes retain permits. There is no TTL auto-release. At sixteen stranded permits discovery stops, an intentional availability cost of the bound. Monitor permit count/age together with safe provider error counts and process health; no secrets or metadata bodies belong in diagnostics.

Controlled recovery requires disabling new issuer traffic, draining or terminating every process that could still own the affected permits, and establishing that their outstanding work has ended. Only then may an authorized operator remove the identified stranded permit rows and restore traffic. Do not use an online cron to delete old permits or clear live budgets. If termination cannot be established, leave the permits held. Normal streamed/conditional-cache responses release automatically. Malformed upstream cleanup can outlive semantic message completion; no physical socket-cap claim is made.

## Key rotation

Treat these as separate keys and separate procedures:

- **Issuer wrapping/signature secret:** `DRASIL_MCP_AUTH_SECRET` remains the explicit legacy decryption fallback and MCP continuation-signature key. The maintained provider receives an explicit MCP-owned version ring, `DRASIL_MCP_AUTH_SECRETS`, a JSON array such as `[{"version":2,"value":"<new-random-secret>"},{"version":1,"value":"<previous-random-secret>"}]`, newest first. With no ring configured it uses version 1 with the scalar secret. The ring governs new encrypted provider records; retain every version needed to decrypt retained rows, plus the legacy scalar for older bare ciphertext. Ambient `BETTER_AUTH_SECRETS` cannot override this issuer. Coordinate the ring across all issuer instances before producing ciphertext with a new version. A scalar replacement alone cannot decrypt old encrypted JWKS. Inventory encrypted fields and backups before retiring any version; do not assume expiry means all ciphertext was rewrapped.
- **Asymmetric access-token signing keys:** persisted provider JWKS private keys are encrypted with the issuer wrapping configuration. They are distinct from that wrapping secret. This configuration does not enable automatic signing-key rotation; existing nonexpiring rows do not gain expiration by adding a rotation interval later. Plan any provider-managed signing-key rotation separately, preserving public verification keys for outstanding 15-minute tokens and verifier caches. Never blindly delete encrypted JWKS as a routine rotation step.
- **Browser and authorization signatures:** provider cookies/query signatures use the current primary secret, not the decryption ring as a universal signature fallback. A coordinated rotation may require fresh sign-in and restarting in-flight authorization. MCP continuation signatures use the scalar secret and similarly require a new flow if it changes. Keeping old encryption keys does not promise seamless cookie validity.
- **Cursor secret:** rotating `DRASIL_MCP_CURSOR_SECRET` invalidates old pagination/reference signatures. Clients must obtain fresh pages/previews. This does not rotate issuer signing keys or reauthorize connections.
- **IP-hash secret:** every web instance must share the same stable key. Rotating it splits live hourly identities. Disable registration and let the full prior hourly window elapse before coordinating a new key across the fleet; then re-enable through the reviewed rollout. Never use per-process random fallbacks.

Keep the existing website session/encryption secrets separate. No routine operational cleanup deletes provider auth rows, protected execution links or report-ban receipts. See [development behavior and budget guidance](../dev/mcp.md) for exact limits and retention.
