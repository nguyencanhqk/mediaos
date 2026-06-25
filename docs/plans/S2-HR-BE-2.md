# S2-HR-BE-2 — HR write core (micro-plan)

> Zone: **RED / crown-jewel** (tenant write + audit + status FSM + cross-module user-lock).
> Gate: **FULL** (security-reviewer + silent-failure-hunter + db-review). Deny-path **RED-first**.
> Branch: `feat/s2-hr-be-2`. Depends on ✅ S2-HR-BE-1, ✅ S2-HR-SEED-1.
> Source of truth: API-03 §11.2/§11.5/§11.6/§11.7/§11.8, DB-03 §4.8/§7.2, IMPLEMENTATION-05 §9.3, SPEC-03.

## Scope (done_when)
1. `POST /hr/employees` — sinh mã qua SequenceService trong tx (0-dup); validate duplicate email/code; audit **Created** trong tx withTenant.
2. `PATCH /hr/employees/{id}` — validate + audit old/new/changed_fields; `change-status` tạo `employee_status_histories` (+ optional lock user); link/unlink user enforce **1 user ↔ ≤1 employee active**.
3. deny-path RED: thiếu quyền → 403 + **0 audit**; soft-delete (KHÔNG hard-delete); 2-tenant không ghi chéo; thao tác quan trọng có audit.

## Confirmed facts (verified against code, not titles)
- **Permission seed (mig 0444, REAL):** `create:employee`, `update:employee`, `change-status:employee`, `export:employee`, `view-sensitive:employee`(sensitive) → grants to `hr` + `company-admin` (Company scope); `delete:employee` → `company-admin` only. **No `link-user` pair** → link/unlink gate on `update:employee` (matches API-03 HR-API-007/008 `HR.EMPLOYEE.UPDATE`).
- **Status values = the 4 DB CHECK values** `active|inactive|resigned|terminated` (emp_status_check). API-03's 6-value `employment_status` is NOT adopted — would need a migration (out of scope) + breaks shipped BE-1. Documented spec→DB delta. *(owner-confirmed 2026-06-25)*
- **Code-gen:** `SequenceService.nextCode(companyId, {sequenceKey: EMPLOYEE_CODE_SEQUENCE_KEY})` → `{value, code}` (FOR UPDATE, 0-dup; scopeType defaults `"Company"`). No counter is seeded by S2-HR-SEED-1 and SequenceService has no `ensureCounter` → a missing/inactive counter (`SequenceNotFoundError`/`SequenceInactiveError`) maps to **422 `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID`**. nextCode runs in its OWN tx (gaps OK, dups impossible); the partial-unique index `employee_profiles_company_code_active_uq` is the final backstop.
- **Audit:** `AuditService.record(tx, {action, objectType:'employee', objectId, actorUserId, before?, after?})`. `'employee'` already in `audit_logs` object_types CHECK → **no migration needed**. Actions are free-form strings (legacy uses `view-salary`).
- **userId nullable:** DB already nullable (mig 0442); Drizzle still `.notNull()`. `employee_profiles` has **no full_name/email column** (name/email come only from `users` join).

## Design decisions (owner-confirmed)
- **D1 — 4 DB status values** (above).
- **D2 — Full mandated rework:** relax `employeeProfiles.userId` → nullable; rework hr-read `innerJoin(users)` → `leftJoin(users)` so an unlinked (nameless) employee still lists/details; read contracts `userId`/`fullName`/`email` → nullable. **Create always resolves/creates a user** (no nameless-on-create path) — only `unlink-user` produces the NULL state.
- **D3 — New cohesive files** `hr-write.{controller,service,repository}.ts` at `@Controller("hr")` (sits alongside read-only `hr-read.controller`). Legacy media-era `/employees` controller untouched.

## Files
**packages/contracts/src/hr/**
- `employee-write.ts` *(new)* — `createHrEmployeeSchema`, `updateHrEmployeeSchema`, `changeEmployeeStatusSchema`, `linkUserSchema`, `unlinkUserSchema` (+ inferred types). Status enums = 4 DB values.
- `employee-read.ts` *(edit)* — `userId`/`fullName`/`email` → `.nullable()` on list-item + detail.
- `index.ts` *(edit)* — `export * from "./employee-write"`.

**apps/api/src/db/schema/employees.ts** *(edit)* — `userId` drop `.notNull()` (DB already nullable). Keep unique `(company_id,user_id) WHERE deleted_at IS NULL` (NULLs distinct in PG → multiple unlinked OK; one active user→one employee enforced).

**apps/api/src/employees/**
- `hr-read.repository.ts` *(edit)* — `innerJoin(users)` → `leftJoin(users)` in list/detail/me **AND the list COUNT query** (else `meta.total` diverges from the rows once an unlinked employee exists); `HrListRow`/`HrDetailRow` `userId|fullName|email` → `string | null`.
- `hr-read.service.ts` *(edit)* — null-safe projection of `fullName`/`email`/`userId`.
- `hr-read.service.spec.ts` *(edit)* — add unlinked-employee case (null user → fullName/email null still returned).
- `hr-write.repository.ts` *(new)* — `createTx`, `updateTx`, `findForUpdateTx`, `insertStatusHistoryTx`, `linkUserTx`/`unlinkUserTx`, `findActiveByUserIdTx` (unique-link guard), `lockUserTx`, `revokeUserSessionsTx`, `createUserTx`, `assertRefsInCompanyTx` (org/position/manager same-company+active).
- `hr-write.service.ts` *(new)* — tx orchestration (below).
- `hr-write.controller.ts` *(new)* — routes (below) with `@RequirePermission`.
- `employees.module.ts` *(edit)* — register new controller/service/repository (additive).
- `hr-write.service.spec.ts` *(new)* — deny-path RED unit suite (mocked).
- `hr-write.int-spec.ts` *(new)* — integration (gated `hasDb && LANE_DB`): code-gen 0-dup + 422, audit rows, soft-delete, 2-tenant, unique active link.

## Routes (hr-write.controller, `@UseGuards(PermissionGuard)`)
| Method | Path | `@RequirePermission` | API-03 |
|---|---|---|---|
| POST | `/hr/employees` | `create,employee` | HR-API-002 |
| PATCH | `/hr/employees/:id` | `update,employee` | HR-API-004 |
| POST | `/hr/employees/:id/change-status` | `change-status,employee` | HR-API-006 |
| POST | `/hr/employees/:id/link-user` | `update,employee` | HR-API-007 |
| DELETE | `/hr/employees/:id/link-user` | `update,employee` | HR-API-008 |

PermissionGuard rejects a missing pair with **403 BEFORE the handler** → guarantees deny-path "0 audit". (Guard is opt-in per controller — confirmed.)

## Service orchestration
> **Code-gen runs in its OWN tx, called BEFORE the insert tx — never nested** (nextCode → `db.withTenant` opens a 2nd connection; nesting under the insert tx would hold 2 PgBouncer connections/request and exhaust the pool under concurrent create). Sequence: `nextCode` (tx1, commits, gaps OK) → then `withTenant` (tx2) for insert+audit. Every mutate path = its own `withTenant(companyId)`.

- **create:** resolve/create user (provided `userId`, else `email+fullName` → `createUserTx`, reuse SecurityPolicy email-domain check). Validate refs same-company+active. Resolve code: if `employeeCode` provided → require active config `allow_manual_override ≠ false` (no config → permissive), use it (unique-checked); else `nextCode(EMPLOYEE_CODE_SEQUENCE_KEY)` in tx1 → `SequenceNotFound/Inactive` → **422 `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID`**. Insert profile (tx2). Audit `create` (before:null, after: **hard allowlist snapshot**). Catch `isUniqueViolation` → 409. Sync `direct_manager` EMR (mirror legacy F5).
- **update:** load before (tx); apply allowed structural fields only; audit `update` with `changed_fields` + old/new from the **same hard allowlist**. 404 if missing.
- **change-status:** load before (tx); enforce explicit FSM (below) — reject no-op + illegal transition (409/422); UPDATE status; INSERT `employee_status_histories` (old→new, reason, changed_by) same tx; if new∈{resigned,terminated} and `lockUser` → `lockUserTx` (users.status='inactive', lockedAt, lockedReason); audit `change-status` (before:{status}, after:{status}). All-or-nothing in one tx.
- **link-user:** employee must currently have NO active user (else 409); target user same-company + not deleted + not already active-linked elsewhere (`findActiveByUserIdTx`) else 409; UPDATE user_id; audit `link-user`. Unique partial index is the DB backstop (TOCTOU-safe).
- **unlink-user:** employee must have a user; UPDATE user_id=NULL; soft-delete the employee's own active `direct_manager` EMR (where employee_user_id = old user); optional `lockUser`; block self-unlink unless elevated; audit `unlink-user`.

### CRITICAL allowlist (BẤT BIẾN #3) — audit + DTO
The audit masker (`audit-masker.service.ts`) only masks stems `password/token/secret/identitynumber/bankaccount/storagepath/signedurl` — it does **NOT** mask `base_salary`, `phone`, `personal_email`, addresses, `date_of_birth`, etc. `audit_logs`/histories are append-only → a leak is **permanent**. Therefore:
- create/update **DTOs EXCLUDE** `baseSalary` + all identity/PII fields (`identityNumber`, `bank*`, `phone`, `personalEmail`, addresses, `dateOfBirth`, …). Salary stays on the legacy `update-salary`-gated path; not a hr-write concern. This removes the salary/PII back-door entirely.
- audit `before`/`after` are built from a **hard-coded allowlist** of structural fields only: `{employeeCode, orgUnitId, positionId, jobLevelId, contractTypeId, directManagerId, workType, employmentType, salaryType, startDate, endDate, status}`. **Never** `record(tx, { after: insertedRow })`.

### Status FSM (app-enforced — no DB CHECK on transitions)
`active → {inactive, resigned, terminated}` · `inactive → {active, resigned, terminated}` · `resigned → {terminated}` · `terminated → {}` (terminal). Same→same = no-op reject. Map = explicit `TRANSITIONS` const.

### Session revoke = DEFERRED (no half-revoke)
Only **user-lock** (users.status='inactive' + lockedAt + lockedReason) is shipped — login gates on users.status. Full session/token revocation (user_sessions + refresh_tokens + JWT + Valkey perm-cache) is Auth-owned and multi-surface; reaching into auth session tables from HR would ship a false-security half-revoke. `revoke_sessions_*` flags accepted but no-op with a logged TODO → follow-up Auth WO.

## Invariants / risks
- **BẤT BIẾN #1:** every path `withTenant(caller.companyId)`; repo ANDs `eq(companyId)` (belt+suspenders over RLS). 2-tenant: cross-tenant `:id` not found in tx → 404, never cross-write.
- **BẤT BIẴN #2:** no hard-delete; `employee_status_histories` append-only (INSERT only). No delete route added.
- **BẤT BIẾN #3:** audit before/after carry **non-sensitive** fields only; never log baseSalary/identity/PII. Mutation responses mask salary by default (return masked DTO).
- **TOCTOU:** unique-link & code uniqueness enforced by DB partial-unique indexes (not just app check) → race-safe.
- **Cross-module write (users/user_sessions from HR):** established pattern (legacy `createUserTx`); same-company tx; spec-sanctioned (HR-API-006/008).

## Test plan (RED-first)
Deny-path unit (mocked): illegal status transition rejected, link to already-active-linked user → 409, link when employee already linked → 409, unlink self blocked, code-config-missing (Sequence error) → 422, audit payload contains NO salary/PII key. Integration (gated `hasDb && LANE_DB`): **the int-spec seeds a `sequence_counters` row** (copy `seedCounter()` from `apps/api/test/integration/sequence-concurrent.int-spec.ts`, `scope_type='Company'`, same `EMPLOYEE_CODE_SEQUENCE_KEY`) then asserts concurrent create → distinct codes (0-dup); exactly one `create` audit; change-status writes one history row + one audit; soft-delete preserved (no hard-delete); cross-tenant id → 404; unique active link enforced at DB (second link → 23505). Coverage ≥80%.

## Out of scope (defer / note as follow-up)
- **Employee-code counter provisioning** — BE-2 builds + tests the SequenceService mechanism; **provisioning the `EMPLOYEE_CODE` `sequence_counters` row (prefix/padding aligned with `employee_code_configs`) is a SEED-layer prerequisite** (S2-HR-SEED-1 deliberately skipped it as "wrong layer"). Until seeded, auto-gen → 422 and admins create via manual `employeeCode`. → follow-up seed WO. Also note: preview (`employee_code_configs`) and actual (`sequence_counters`) are disjoint stores → seed must keep them aligned.
- **Session/token revoke** on lock → Auth-owned follow-up (see "no half-revoke" above).
- **FE coordination** — read contracts `userId/fullName/email` become nullable; shipped FE list (S2-FE-HR-1) must null-guard `fullName` before unlink is exercised (no existing data is null today). → FE follow-up.
- contract/file_ids/notifications/Idempotency-Key/`create_user_account` role+activation; `employee-code-config` PATCH + lock/unlock-code (HR-API-901..905); export (HR-API-009); MANUAL_OVERRIDE **permission-pair** gating (pair not seeded — manual code gated by `allow_manual_override` config flag only, TODO for the pair).
