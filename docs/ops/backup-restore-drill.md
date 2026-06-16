# Backup / Restore Drill — Runbook (G16-2)

> A backup you have never restored is not a backup. This runbook proves the MediaOS
> Postgres backup can be **restored, verified, and used** — not merely produced.
> Pairs with `scripts/backup-db.sh` (dump → encrypt → offsite) and `scripts/backup-restore-drill.sh`
> (dump → restore into a throwaway DB → verify migration chain / schema / RLS / index → smoke).

---

## 1. Scope and objectives

| Goal                                  | How this runbook proves it                              |
| ------------------------------------- | ------------------------------------------------------- |
| Backup is **restorable**              | `pg_restore` into a fresh temp DB succeeds              |
| Schema is **complete**                | core tables present; migration count == journal count   |
| Tenant isolation **survives restore** | RLS still enabled on multi-tenant tables (Invariant #1) |
| Perf indexes **survive restore**      | G16-2 hot-path indexes present (migration 0220)         |
| Restored DB is **usable**             | smoke read queries run without error                    |

## 2. RPO / RTO targets

| Metric                    | Target                                                     | Basis                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (max data loss)   | ≤ 24h                                                      | Daily `backup-db.sh` cron (02:00 Asia/Ho_Chi_Minh). Tighten to minutes with WAL archiving / PITR — see `docs/infra-zero-cost-plan.md §3.1`.                             |
| **RTO** (time to restore) | ≤ 30 min for current data volume                           | `pg_restore` of a custom-format dump on the current dataset completes in seconds; RTO is dominated by provisioning + offsite fetch + decrypt. Re-measure as data grows. |
| **Drill cadence**         | Monthly + after any migration that changes table shape/RLS | Drill is cheap (read-only on source); run it so a real recovery is never the first restore.                                                                             |

## 3. Prerequisites

- `postgresql-client` on PATH (`pg_dump`, `pg_restore`, `psql`) matching the server major version.
- `DATABASE_DIRECT_URL` — a **direct** connection (NOT through PgBouncer; restore needs session-level DDL).
- Permission to `CREATE DATABASE` / `DROP DATABASE` on the target server (the drill makes a throwaway DB).
- For an encrypted offsite artifact: `age`/`gpg` private key to decrypt before restore (see `backup-db.sh`).

## 4. Run the drill

```bash
# Against the live/primary DB (read-only dump; temp DB auto-created and dropped):
DATABASE_DIRECT_URL="postgres://USER:PASS@HOST:5432/mediaos" \
  bash scripts/backup-restore-drill.sh

# Or verify an existing dump artifact (e.g. the encrypted offsite one, decrypted to .dump first):
DUMP_FILE=/path/mediaos-YYYYMMDD-HHMMSS.dump \
DATABASE_DIRECT_URL="postgres://USER:PASS@HOST:5432/mediaos" \
  bash scripts/backup-restore-drill.sh

# Keep the temp DB for inspection on failure:
KEEP_TEMP=1 DATABASE_DIRECT_URL="..." bash scripts/backup-restore-drill.sh
```

Exit `0` = drill PASS. Any non-zero exit prints the failing step.

### Steps the script performs

1. **Dump** — `pg_dump --format=custom --no-owner --no-privileges` (or reuse `DUMP_FILE`).
2. **Restore** — `CREATE DATABASE mediaos_drill_<ts>` then `pg_restore` into it.
3. **Verify migration chain** — `count(drizzle.__drizzle_migrations)` ≥ journal entry count.
4. **Verify schema** — core tables present; RLS enabled on `tasks/notifications/payslips/users`; G16-2 hot-path indexes present.
5. **Smoke** — basic read queries (`companies`, `users`, `tasks`) execute.
6. **Cleanup** — `DROP DATABASE` the temp DB (skipped with `KEEP_TEMP=1`), remove the temp dump. Runs via `trap` even on failure.

## 5. Verification checklist (manual sign-off)

- [ ] Drill exits `0` (PASS).
- [ ] `applied` migration count == `_journal.json` entry count (no skipped/missing migration).
- [ ] All core tables present: `companies, users, tasks, notifications, attendance_records, leave_requests, cost_allocations, payslips, audit_logs`.
- [ ] `rls_off = 0` — RLS still **enabled** on every multi-tenant table after restore (Invariant #1).
- [ ] `rls_notforced = 0` — **FORCE** RLS still set (RLS applies even to table owner; `relrowsecurity` alone is insufficient).
- [ ] `pol_missing = 0` — every multi-tenant table still has at least one RLS **policy** (a `CREATE POLICY` that failed silently during restore is caught here, not by a superuser read which bypasses RLS).
- [ ] G16-2 hot-path indexes present (all 4): `tasks_company_created_active_idx`, `tasks_company_assignee_active_idx`, `tasks_company_status_active_idx`, `notifications_company_user_created_idx`.
- [ ] Smoke read queries succeed (basic + tenant-GUC path).
- [ ] Restore wall-clock time recorded and within RTO; note dataset size.

## 6. Reference transcript (dev, mediaos_c2)

```
[1/5] pg_dump mediaos_c2 (custom-format, read-only) — dump size: 460K
[2/5] CREATE DATABASE mediaos_drill_<ts> + pg_restore — restore done
[3/5] verify migration chain — applied=86  journal=86
[4/5] verify schema — core_tables=9  rls_off=0  rls_notforced=0  pol_missing=0  g16_indexes=4
[5/5] smoke read — basic + tenant-GUC queries OK
[cleanup] DROP mediaos_drill_<ts> + rm dump
DRILL PASS
```

## 7. CONCURRENTLY-for-prod note (migration 0220 hot-path indexes)

Migration `0220_g16_hot_path_indexes.sql` uses **`CREATE INDEX IF NOT EXISTS`** (not `CONCURRENTLY`)
because Drizzle wraps each migration in a single transaction, and `CREATE INDEX CONCURRENTLY`
**cannot run inside a transaction block**.

- On the current small tables the `ACCESS EXCLUSIVE` lock taken by a plain `CREATE INDEX` is
  negligible (sub-second). Safe to apply via the normal migration path.
- On a **large production `tasks` / `notifications` table**, a plain `CREATE INDEX` blocks writes
  for the duration of the build. To avoid that, build the indexes **out-of-band BEFORE deploying**
  the migration, in an autocommit `psql` session:

  ```sql
  -- Run manually, NOT inside a transaction, BEFORE the 0220 migration is deployed.
  CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_company_created_active_idx
    ON tasks (company_id, created_at DESC) WHERE deleted_at IS NULL;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_company_assignee_active_idx
    ON tasks (company_id, assignee_user_id, created_at DESC) WHERE deleted_at IS NULL;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_company_status_active_idx
    ON tasks (company_id, status, due_date) WHERE deleted_at IS NULL;
  CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_company_user_created_idx
    ON notifications (company_id, user_id, created_at DESC);
  ```

  Because the migration uses `IF NOT EXISTS`, the subsequent deploy becomes a no-op for indexes
  already built — **no blocking lock at deploy time**. If a `CONCURRENTLY` build fails it leaves an
  `INVALID` index; drop it (`DROP INDEX CONCURRENTLY <name>`) and rebuild before deploying.

## 8. Recovery (real restore, not a drill)

1. Fetch the latest encrypted dump from offsite (`rclone copy <remote>/<artifact> .`).
2. Decrypt: `age -d -i <key> -o restore.dump artifact.age` (or `gpg -d ...`).
3. Provision a clean DB; `pg_restore --no-owner --no-privileges --dbname=<target> restore.dump`.
4. Re-apply role grants for `mediaos_app` / `mediaos_worker` if restoring to a fresh cluster
   (dumps use `--no-privileges`; roles/grants come from migration `0001_roles_and_grants` and
   per-table GRANTs — re-run role setup or restore a globals dump).
5. Run the verification checklist (§5) against the restored DB before cutting traffic over.
