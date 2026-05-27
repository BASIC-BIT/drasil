# Supabase RLS Exposure Audit - 2026-05-26

## Scope

- Supabase project: production Drasil Supabase project. The project reference is intentionally omitted from this committed audit note.
- Schema reviewed: `public`
- Tables reviewed: `_prisma_migrations`, `admin_actions`, `detection_events`, `server_members`, `servers`, `users`, `verification_events`
- Method: metadata-only SQL audit. Raw table contents were not exported or reviewed.

## Remediation Timeline

- `2026-03-02`: Initial Prisma schema migration created public application tables.
- `2026-05-12`: `20260512100000_enable_rls_for_public_tables` enabled RLS and revoked `anon` / `authenticated` table grants for application tables.
- `2026-05-26`: `20260526000000_enable_rls_for_prisma_migrations` enabled RLS and revoked client grants for `_prisma_migrations`.
- `2026-05-26`: `20260526001000_revoke_client_default_table_privileges` revoked migration-owner default table privileges for Supabase client roles so future Prisma-created tables do not inherit client access.

## Findings

- Current production posture is locked down: every public table has RLS enabled.
- Current production posture has no effective `anon` or `authenticated` table privileges on public tables.
- Current production posture has no public, `anon`, or `authenticated` RLS policies on public tables.
- `pg_stat_statements` was enabled and had data since `2026-05-08T09:15:57Z`.
- Since that stats reset, aggregated statements touching Drasil application tables were only observed under `postgres` and `supabase_admin`; no `anon`, `authenticated`, or `authenticator` application-table activity was observed in `pg_stat_statements`.
- Production row counts at audit time were small: `servers` 2, `users` 28, `server_members` 12, `detection_events` 32, `verification_events` 12, `admin_actions` 1.

## Residual Risk

- `pg_stat_statements` does not prove absence of access before its `2026-05-08` reset.
- Supabase API gateway / PostgREST logs were not reviewed in this repository-local audit. If longer-retention Supabase logs are available, review requests for `/rest/v1/admin_actions`, `/rest/v1/detection_events`, `/rest/v1/server_members`, `/rest/v1/servers`, `/rest/v1/users`, `/rest/v1/verification_events`, and `/rest/v1/_prisma_migrations` during the exposure window.
- Supabase-owned `supabase_admin` default table privileges for `anon` and `authenticated` were visible but cannot be changed by the migration role. The new CI guardrail fails for checked owners (`postgres`, `prisma`, and the active migration role) and warns on unmanaged platform-owned defaults.

## Follow-Up Controls

- `npm run db:check:rls` now checks public tables for RLS, effective client-role privileges, client-facing policies, and checked-owner default table privileges.
- CI runs `npm run db:check:rls` after integration tests, so migrations that create public tables without RLS or leave client access enabled fail before merge.
