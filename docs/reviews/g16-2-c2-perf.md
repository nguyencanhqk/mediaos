# Review trail — G16-2 (C2 perf + backup/restore drill)

**Lane:** `feat/c2-g16-perf` · **Commits:** `6060eb8` (impl) + `a2f1ee2` (gate fixes) · **Date:** 2026-06-16
**Verify DB (isolated):** `mediaos_c2` — full api **1770 pass / 5 skip / 0 fail**; chain `0000→0220` clean.
**Gate (per CLAUDE.md §6, non-crown):** `ecc:database-reviewer` + `ecc:silent-failure-hunter` on the diff `0ecd684..6060eb8`. No RLS/permission/secret/payroll/audit change → FULL gate not required.

## Scope
Index-only migration `0220_g16_hot_path_indexes.sql` (band 0220s, idx 85, when 1717500220000); N+1 batch fix in cost-allocation; backup/restore drill (`scripts/backup-restore-drill.sh` + `docs/ops/backup-restore-drill.md`). No RLS/policy/grant DDL (confirmed by grep).

## Findings & disposition (only lane-introduced; verified before applying)
| # | Sev (reviewer) | Disposition | Note |
|---|---|---|---|
| silent-failure F1 | CRITICAL `row.id as string` | **Downgraded → applied defensive guard** | All PKs are UUID (string from pg driver) → safe in practice; added a `typeof !== string` fail-loud guard anyway. Not a true CRITICAL. |
| silent-failure F2 | HIGH pg_restore swallowed | **Applied** | Capture stderr; fail on any error/warning that is not role/grant/owner — a partial restore no longer slips to verify. |
| silent-failure F3 | HIGH RLS check `relrowsecurity` only | **Applied** | Added `relforcerowsecurity = 0` check (Invariant #1: FORCE RLS). |
| silent-failure F4 | HIGH smoke superuser, no policy exercise | **Applied (improved)** | Reviewer's tenant-read fix is inert under a **superuser** connection (superuser bypasses RLS). Instead verify policy **existence** via `pg_policies` (catches dropped policies regardless of bypass) + a tenant-GUC read for query-path executability. |
| silent-failure F5/F6 | MEDIUM rm-f silent / `>=` one-directional | **Applied** | Warn on cleanup-rm failure; warn (not fail) when applied > journal (wrong-epoch dump). |
| silent-failure F7 | LOW unknown targetType | **Applied** | Fail-loud guard on missing `TARGET_TABLE[targetType]`. |
| database HIGH | missing assignee idx in CONCURRENTLY runbook | **False positive (verified)** | The §7 runbook already lists all 4 indexes (reviewer mis-cited line 76 = transcript). Real staleness was the **checklist** (3 indexes) + transcript — aligned to 4 + FORCE/policy. |
| database MEDIUM | empty `ids` → `IN ()` syntax error | **Applied** | `if (ids.length === 0) continue;` before `sql.join`. |
| database MEDIUM | `tasks_assignee_user_id_idx` subsumed | **Tracked follow-up** | Cannot DROP in-lane (shared with master); noted in migration comment + TASKS.md for a post-land DROP. |
| database LOW | overdue EXPLAIN comment overstates status scan | **Applied** | Comment corrected: `status NOT IN` can't index-scan status; uses company_id-leading partial scan. |

## Re-verify after fixes
- `pnpm --filter @mediaos/api typecheck` clean · cost-allocation tests **14/14** pass · prettier clean (.ts) · drill `bash -n` clean.
- Hardened drill SQL probed on `mediaos_c2`: `rls_notforced=0`, `pol_missing=0`, `g16_indexes=4`, tenant-GUC smoke OK.

**Verdict:** SAFE-TO-LAND (not merged — land is a separate user-gated step).
