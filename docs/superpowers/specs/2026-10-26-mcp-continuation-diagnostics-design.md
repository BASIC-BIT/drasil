# MCP continuation diagnostics

The hosted client prepared an action successfully, then received the SDK's generic `invalid_request_state` error on continuation. Local native direct/queued confirmation succeeds with stable and fresh handlers. The precise hosted rejection remains unknown.

Add observation at the existing bounded HTTP-body and maintained request-state codec boundaries. Record only fixed event/stage/reason enums, bounded type/size, allowlisted protocol, and request-local correlation ID. Record mint success and verify success/failure. Observe present malformed/non-string wire state before the SDK rejects it. Recognize codec rejection categories malformed, mac, expired, bind, context, and unknown without serializing errors.

Never log request-state values, MACs, bearer/refresh tokens, principal or guild identifiers, command bodies, saved summaries, or raw errors. A throwing observer must not change the returned result or thrown error. Preserve the existing SDK codec, TTL, binding, request parsing/size limit, public envelopes, permission checks, and saved-action validation. No dependency upgrades, retries, caches, action execution changes, deployment changes, or live mutation tests.

## Approaches

Use small observers at existing boundaries. Broad request/error logging would disclose credentials; replacing the maintained codec would change security behavior without diagnosing the host. The user selected narrowly scoped logging after reviewing these limits in the diagnosis.

## Acceptance

Real codec and SDK/HTTP tests cover native confirmation, fresh handlers, malformed/non-string states, bad signature, expiry, changed binding, unavailable context, unknown exceptions, and throwing sinks. Privacy sentinels must never appear. Verify the public SDK error and zero action acceptance on rejected continuation. Document correlation and category interpretation without claiming that instrumentation fixes the live failure.
