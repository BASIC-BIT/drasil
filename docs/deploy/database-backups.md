# Database Backup and Restore Runbook

Drasil production persistence is Postgres, usually hosted by Supabase, accessed through Prisma. This runbook defines the public-safe backup policy and restore procedure without committing Supabase project refs, database URLs, backup locations, or provider screenshots.

## Terms

- RPO: Recovery Point Objective. Maximum acceptable data loss after a database failure or bad deploy.
- RTO: Recovery Time Objective. Maximum acceptable time to restore service after a failure.

## Initial Targets

Bare minimum production target:

- `RPO <= 24h` when relying on verified Supabase automatic daily backups or an equivalent offsite dump.
- `RTO <= 4h` until a restore drill proves a tighter value.

Preferred production target:

- `RPO <= 2m` when Supabase Point-in-Time Recovery (PITR) is enabled.
- `RTO <= 4h` until a restore drill proves a tighter value.

Supabase documents PITR WAL backups as running at two-minute intervals in the worst case. If the project does not have PITR enabled, assume daily-backup RPO until a different mechanism is verified.

## Current Verification Record

Keep the detailed verification record private. The public repo should only contain the policy and runbook.

Private record template:

| Field                           | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| Verification date               | `YYYY-MM-DD`                                       |
| Supabase project                | Private project ref or human-readable private name |
| Backup mode                     | Daily backups, PITR, manual dump, or other         |
| Retention window                | Number of days or dump retention policy            |
| Latest restorable point checked | Timestamp                                          |
| Policy RPO                      | `<= 24h` or `<= 2m`                                |
| Policy RTO                      | Current target                                     |
| Restore drill status            | Not run, scheduled, passed, or failed              |
| Evidence location               | Private note, private issue, or ops repo path      |

If this record does not exist for production, the release gate is not satisfied.

## Provider Modes

Supabase projects can be in one of these backup modes:

- Free/no automatic backup: take a manual logical dump before production-impacting database work and store it offsite/private.
- Paid automatic daily backups: verify backups are present in Dashboard > Database > Backups and record retention privately.
- PITR add-on: verify Point in Time is enabled, record retention privately, and use the PITR target as the production policy.

Do not commit Supabase project refs, access tokens, backup download URLs, database URLs, or private backup storage locations. Put sensitive verification evidence in a private operator note or a private ops repository.

## Release Gate

Before applying production-impacting database migrations or data repairs:

- Confirm the current backup mode and latest restorable point.
- Confirm the chosen RPO/RTO target is acceptable for the release.
- If PITR is disabled and daily backups are the only provider backup, decide whether a manual pre-deploy dump is required.
- If the project has no automatic backups, take a manual dump before deploying.
- Confirm at least one operator knows where the restore evidence and private backup location are recorded.

For schema-only migrations, this gate can be satisfied by verified provider backups. For migrations that rewrite or delete meaningful production data, prefer PITR or a fresh manual dump even when daily backups exist.

Minimum gate decision states:

- Green: PITR enabled and latest restorable point verified.
- Green: daily backups verified and `RPO <= 24h` accepted for this release.
- Yellow: fresh manual dump taken and restore location recorded privately, but no restore drill has been completed.
- Red: no provider backup, no PITR, and no fresh manual dump.

Do not proceed on red. Yellow needs an explicit owner waiver for production-impacting changes.

## Manual Logical Backup

Use this when the project lacks automatic backups, when you need an extra pre-deploy restore point, or before risky data rewrites.

For Supabase, do not rely on the default `supabase db dump` command by itself. The default dump is schema-focused and does not capture Drasil's production rows. Capture roles, schema, and data as separate files:

```bash
supabase db dump --db-url "$SOURCE_DATABASE_URL" --file "roles.sql" --role-only
supabase db dump --db-url "$SOURCE_DATABASE_URL" --file "schema.sql"
supabase db dump --db-url "$SOURCE_DATABASE_URL" --file "data.sql" --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Restore those files into a safe target first, never directly over production during a drill:

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "roles.sql" \
  --file "schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "data.sql" \
  --dbname "$TARGET_DATABASE_URL"
```

Raw `pg_dump` is a fallback for non-Supabase Postgres or a restore-tested Postgres target where Supabase-managed schemas and permissions are understood. Do not use raw, unfiltered `pg_dump` as the primary Supabase backup path.

```bash
pg_dump --format=custom --no-owner --no-privileges --file "drasil-prod-YYYYMMDD-HHMMSS.dump" "$SOURCE_DATABASE_URL"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" "drasil-prod-YYYYMMDD-HHMMSS.dump"
```

After creating a dump:

- Store it in a private/offsite location with restricted access.
- Record the timestamp, command shape, database host/provider, and storage location privately.
- Do not commit dumps or dump locations to this repository.
- Treat dump files as sensitive production data.

## Restore Drill

Run a restore drill before claiming any tighter RTO than the initial target.

Safe drill target options:

- A temporary Supabase clone or staging project.
- A local Postgres database with production-sensitive access controlled appropriately.
- Another isolated Postgres instance that is not connected to the production bot or web app.

Drill steps:

1. Choose a restore source: daily backup, PITR timestamp, or manual dump.
2. Restore into the safe target, not directly over production. For manual Supabase dumps, use the `psql` restore command above against `TARGET_DATABASE_URL`.
3. Set `DATABASE_URL` or `TEST_DATABASE_URL` to the restored target.
4. Run `npx prisma migrate deploy` if the target needs current migrations applied.
5. Run read-only smoke checks against key tables: `servers`, `users`, `server_members`, `detection_events`, `verification_events`, and `admin_actions`.
6. Run app-level validation against the restored target, such as `npm run build` and focused repository/integration checks when safe.
7. Record drill date, restore source type, high-level result, observed elapsed restore time, and follow-up gaps.

Public docs should only record high-level drill outcomes. Keep provider screenshots, project refs, exact backup locations, database URLs, and row-level production evidence private.

## Production Restore Procedure

Production restore is a destructive operational action and requires explicit approval from the service owner.

Before restoring production:

- Identify the failure mode and desired restore point.
- Decide whether restoring in place is safer than cloning to a new project and repointing secrets.
- Announce expected downtime if user-visible surfaces are active.
- Stop or disable writers when practical, including the ECS bot task and web admin writes.
- Confirm the selected restore point is before the destructive event and after the last acceptable good state.

After restoring:

- Re-run Prisma migrations if needed.
- Recreate or reset custom database role passwords if the backup mechanism did not preserve them.
- Verify production secrets point at the restored database.
- Restart services and confirm bot/web health.
- Check recent case/report/admin-action flows before declaring recovery complete.
- Record actual RTO and estimated data loss privately.

## Supabase Caveats

- Database backups restore Postgres data, not Supabase Storage API object bytes. Drasil does not currently rely on Supabase Storage for moderation evidence.
- Daily backup restore can require custom database role password resets.
- PITR and daily backup availability depend on project plan, compute, retention, and add-on settings.
- Restoring a project can make it inaccessible during the restore window.

## References

- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Supabase PITR usage: https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery
