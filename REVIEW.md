# Review Instructions

## What Important Means Here

Reserve Important findings for issues introduced by the PR that could cause
unsafe moderation, miss or amplify abuse, expose private data or credentials,
cross server boundaries, corrupt moderation state, break Discord interaction
handling, or make production startup, deployment, or recovery unsafe.

Style, naming, broad refactor preferences, missing comments, and test coverage
suggestions are Nit at most unless they hide a concrete production risk.

## Noise Controls

- Do not report formatting, lint, type errors, generated files, routine
  lockfile churn, or issues already enforced by CI. Do report lockfile changes
  that create concrete security, registry/source, integrity/hash, or runtime
  dependency risk.
- Do not recommend new abstractions unless duplicated code creates a real
  correctness, security, moderation, or operational risk.
- Do not flag pre-existing issues as PR blockers. Mark them as pre-existing in
  the summary if they are worth follow-up.
- On follow-up reviews for the same PR, suppress new nits unless the latest
  pushed code introduced them.

## Evidence Bar

Every finding should include the exact file and line, the changed behavior, why
it matters for Drasil, and the smallest safe fix. If the concern depends on
product judgment or missing runtime evidence, put it in the summary instead of
presenting it as a blocker.

## Drasil Checks

- Preserve server scoping for users, members, cases, detection events,
  notifications, roles, and admin actions.
- DMs must remain ignored, and Discord event or interaction failures must not
  silently bypass required acknowledgements or moderation state transitions.
- Observed alerts must remain no-case/no-role until an explicit escalation;
  cases must use the configured case role and user-visible case thread.
- Verify, ban, kick, role, and thread operations must remain idempotent enough
  for Discord retries and partial provider failures.
- Persistence changes must preserve Prisma nullability, enum, migration, and
  repository contracts; do not infer database state from a failed side effect.
- Do not hardcode threat-intelligence indicators, campaign/operator names, or
  private server/customer names in source, metadata, logs, or public copy.
- Model-assisted moderation must stay bounded, schema-validated, and expressed
  to users as deterministic product behavior rather than raw model output.
- Startup-critical configuration failures may terminate the service; routine
  Discord event, provider, or request failures should be logged with context
  and contained at the appropriate boundary.
