# S2-AUTH-BE-1 — Login/logout/me micro-plan (crown-jewel 🔴)

> Reconcile-first. Most of AUTH already exists (login/refresh/2FA/logout/me, token/session/cookie services,
> PermissionService, ModuleCatalogService). This WO closes the **gaps** vs done_when + BACKEND-03 §15 / §11.6.
> Source of truth: `docs/BACKEND/BACKEND-03 §15` (`/auth/me` contract), `BACKEND-01 §11.6`, `SPEC-02`, `API-02`.

## 1. What already exists (KEEP — do not rewrite)

- `POST /auth/login` — hash verify, uniform 401 for not-found/bad-pwd/suspended (AUTH-FIX-1), security-policy,
  2FA challenge, rate-limit, audit_logs on every branch, best-effort `last_login_at`. ✅
- `POST /auth/refresh` / `POST /auth/logout` — cookie + body modes, CSRF double-submit, family revoke. ✅
- `GET /auth/me` — verifies access token ("any"), returns `{id,companyId,email,fullName,status,capabilities,mustSetupTwoFactor}`. ✅ (too small)
- `PermissionService.getCapabilities(userId,companyId)` → `Record<"action:resourceType", true>` (non-sensitive, deny-overrides). ✅
- `ModuleCatalogService.getMyApps(actor)` → `MyAppItem[]` (enabled ∩ permission-filtered). ✅ REUSE.

## 2. Gaps to close (the actual build)

### G1 — `login_logs` writes + `failed_login_count` (done_when #1)
Currently login only writes `audit_logs`, never `login_logs`, never touches `failed_login_count`.
- On **bad password / user-not-found / suspended / company-unresolved / rate-limited** → INSERT `login_logs`
  `login_status='failed'|'blocked'` + `failure_reason` (`WrongPassword|UserNotFound|Locked|Inactive|TooManyAttempts|CompanyInactive`).
  `company_id` NULLABLE (pre-auth fail has no tenant — must still log; anti-brute-force, no user enumeration).
- On **bad password** for an existing active user → also `failed_login_count = failed_login_count + 1` (users UPDATE).
- On **success** (login + 2FA step-2) → INSERT `login_logs` `login_status='success'` AND reset `failed_login_count = 0`.
- `login_logs` is **append-only** (INSERT only). Never log password/token (BẤT BIẾN #3) — only reason code / ip / ua / email.
- New `AuthLogRepository` (small, focused) with `recordLogin(...)` — handles the nullable-tenant insert
  (pre-auth uses a no-tenant / system path; post-auth uses `withTenant`).

### G2 — `GET /auth/me` bootstrap enrichment (done_when #2) — **ADDITIVE**
WO paths exclude `apps/web/**`; FE already consumes `capabilities` + `mustSetupTwoFactor`. So **extend additively** —
keep all current fields, ADD the spec bootstrap context. Reshaping the envelope/nesting would break FE = out of scope.

Add to `meResponseSchema` (packages/contracts/src/auth.ts) — all new fields:
- `company: { id, name, status }` — from `companies` (current tenant).
- `employee: { id, employeeCode, fullName, departmentId, directManagerId, employmentStatus } | null`
  — from `employee_profiles` (active, user-linked) joined to `users.fullName`. `departmentId = org_unit_id`,
  `employmentStatus = status`. **Never** `base_salary` (sensitive). null when user has no employee profile (operator/super-admin).
- `roles: Array<{ id, name }>` — active roles (user_roles ⋈ roles, `deleted_at IS NULL`, expiry > now).
  (roles has no `code` column — `name` IS the code, e.g. `company-admin`.)
- `scopes: Record<"action:resourceType", DataScope[]>` — per ALLOW capability, the **union** of `role_permissions.data_scope`
  across the user's active roles (BACKEND-03 §15.3 rule 6: union array, not a single scope). Keyed identically to `capabilities`.
  DENY-suppressed pairs absent (mirror `getCapabilities`). `DataScope = ROLE_DATA_SCOPES` (reuse existing exported type).
- `modules: Array<{ code, name }>` — projected from `ModuleCatalogService.getMyApps(actor)` (REUSE, do not re-implement).

`session` block (spec §15.2) is **DEFERRED** — see §4. Omitted, not fabricated.

### G3 — surface `data_scope` from the resolver query
`PermissionService.getCapabilities` and `PermissionRepository.getCompanyRoleGrants` do not select `data_scope`.
- Add a **new, separate** method `PermissionService.getCapabilityScopes(userId,companyId): Promise<Record<string, DataScope[]>>`
  + repo method `getCompanyRoleGrantsWithScope(...)` that additionally selects `role_permissions.data_scope`.
  Keep `getCompanyRoleGrants` / `getCapabilities` untouched (back-compat; `can()` hot-path unchanged).
  Union scopes per ALLOW pair; apply the same deny-overrides + non-sensitive filtering as `getCapabilities`.
  Fail-safe → `{}` on infra error (UI-hint semantics, never fail-closed here — guard is the real gate, BE-2).

## 3. RED tests first (deny-path, write BEFORE impl) — colocated `*.spec.ts` (vitest only runs `src/**/*.spec.ts`)

`apps/api/src/auth/auth.me-bootstrap.spec.ts` (service-level, mocked deps):
- no token / malformed bearer → 401 uniform.
- `/auth/me` returns roles/scopes/employee/modules for a user with grants; DENY pair absent from scopes.
- employee = null for a user with no employee profile.
- never includes `password_hash` / `base_salary` / token in payload.

`apps/api/src/auth/auth.login-logs.spec.ts` (service-level):
- bad password (existing user) → `login_logs.failed`, `failure_reason='WrongPassword'`, `failed_login_count` += 1, uniform 401.
- suspended user → `login_logs.blocked`, `failure_reason='Inactive'`/`Locked`, uniform 401, count NOT incremented past block path.
- success → `login_logs.success` + `failed_login_count` reset to 0; no secret in metadata.

`apps/api/src/permission/permission.scopes.spec.ts`:
- `getCapabilityScopes` unions scopes across roles; DENY removes pair; non-sensitive only; error → `{}`.

## 4. Deliberate scope decision (red-zone — flag for owner chốt)

**`user_sessions` canonical table dual-write is DEFERRED, not done in this WO.**
- WO done_when does NOT require it: #2 "revoke session/refresh" = revoke refresh-token family (already done);
  #3 "session strategy theo OQ-001 cookie" = already implemented. The schema comment's "rồi hợp nhất" is an
  aspiration, not part of done_when.
- `refresh_tokens` (family_id) already provides session semantics + the OQ-001 HttpOnly-cookie strategy.
- Dual-writing a canonical table nothing reads yet = YAGNI + dual-write risk on a crown-jewel path with a
  2758-passing auth suite. Defer until a consumer exists (session-mgmt UI / BE-3).
- Consequence: `login_logs.session_id` stays NULL (nullable by design); `/auth/me.session` block omitted.
- **Follow-up WO** (note in backlog): "Unify refresh_tokens → user_sessions canonical + /auth/me.session + login_logs.session_id".

If owner wants the full §15.2 session block now → re-scope to also write user_sessions on login/2FA, revoke on logout,
link `accessTokenJti` for /auth/me lookup. (Larger, higher-risk.)

## 5. Files touched (within WO paths)
- `packages/contracts/src/auth.ts` — extend `meResponseSchema` additively (+ `DataScope`, `company`, `employee`, `roles`, `scopes`, `modules`).
- `apps/api/src/auth/auth.service.ts` — login_logs + failed_login_count in login/2FA; enrich `me()`.
- `apps/api/src/auth/auth-log.repository.ts` — NEW (login_logs writes, nullable-tenant).
- `apps/api/src/auth/auth.module.ts` — wire AuthLogRepository; ensure ModuleCatalogService importable (foundation module export).
- `apps/api/src/permission/permission.service.ts` + `permission.repository.ts` + `permission.types.ts` — `getCapabilityScopes` (+scope select). Additive.
- `*.spec.ts` (3 files above) — RED first.
- No migration (all tables exist: login_logs/user_sessions from DB-2, data_scope from DB-1).

## 6. Invariants / gate
- BẤT BIẾN #1 tenant: all reads via `withTenant`; pre-auth login_logs insert is the only no-tenant path (nullable company_id, RLS policy allows NULL pre-auth).
- BẤT BIẾN #2 append-only: login_logs INSERT only.
- BẤT BIẾN #3 secrets: no password/token in login_logs/audit/DTO; no `base_salary`/`password_hash` in /auth/me.
- FULL gate (crown): security-reviewer + database-reviewer (rls-tenant) + silent-failure-hunter. ≥80% on touched.
- Uniform 401 preserved (anti status-probing) — login_logs reason code lives only in DB row, never in the 401 body.

## 7. Review resolutions (plan-reviewer BLOCK → patched — authoritative)

These OVERRIDE any conflicting detail above. Verified against migration `0443` + `auth.service.ts`.

**R1 (was BLOCK#1) — `DataScope` type lives in contracts, NOT imported from apps/api.**
`packages/contracts/src/auth.ts`: define `export const DATA_SCOPES = ["Own","Team","Department","Company","System"] as const;`
`export type DataScope = (typeof DATA_SCOPES)[number];`. Add a sync test in apps/api
(`permission.scopes.spec.ts`) asserting `DATA_SCOPES` (contracts) deep-equals `ROLE_DATA_SCOPES`
(`permissions.ts:153`) so they cannot drift. Contracts MUST NOT import from `apps/api` (breaks dual build).

**R2 (was BLOCK#2) — `modules` projection is explicit.** `getMyApps()` returns `MyAppItem` with `module_code` + `name`
(`module-catalog.service.ts:67`). Project to `modules: Array<{ code: string; name: string }>` via
`{ code: item.module_code, name: item.name }`. Keys camelCase to match the rest of `meResponseSchema`.
done_when #2 explicitly mandates reusing getMyApps here, so the (minor) duplication with `/foundation/modules/my-apps`
is accepted and noted.

**R3 (was BLOCK#3) — two distinct login_logs insert contexts; failure-logging is best-effort-BUT-observed.**
- **Pre-auth (no tenant)**: rate-limited (`auth.service.ts:148`) + company-unresolved (`:156`) → insert via the
  module-level `db` handle (NO GUC) with `companyId: null`. WITH CHECK NULL-branch (`0443:120-125`) permits this only
  when `app.current_company_id` is unset — so it MUST NOT run inside `withTenant`.
- **In-tenant**: user-not-found-in-company (`:165`), bad-password (`:178`), suspended (`:196`), success (`:244`)
  → insert via the existing `withTenant(companyId, tx)` using `tx.insert(loginLogs)` with the resolved `companyId`,
  co-located with the existing `audit.record` calls (same tx, atomic). NULL-branch would be rejected here (GUC set).
- Every insert supplies `normalizedEmail: email.toLowerCase()` (`login_logs.normalized_email` is NOT NULL and NOT
  generated — `0443:99`). NEVER password/token in row (BẤT BIẾN #3); append-only INSERT (grant has no UPDATE/DELETE).
- Wrap each login_logs write so a write failure is logged (`logger.error`, no PII/secret) and **never** swallowed
  silently NOR allowed to change the uniform 401/HTTP status (failure to log must not become a status oracle).
  RED test: "login_logs insert failure does not change the uniform 401 and emits a server-side error log."

**R4 (was BLOCK#4) — account lockout is OUT of scope this WO.** `failed_login_count` is incremented on bad-password
(existing active user) and reset to 0 on success — that is the full done_when #1 counter requirement. The
threshold→`locked_at`/`locked_reason` transition + `user_security_events` `USER_LOCKED` + login allow-list rejecting
`locked_at IS NOT NULL` is a SEPARATE concern (mirrors the `user_sessions` deferral in §4). Therefore:
- In-scope `failure_reason` values: `WrongPassword | UserNotFound | Inactive | TooManyAttempts | CompanyInactive`.
  **`Locked` is removed** from in-scope reasons (no path produces it until lockout lands).
- Follow-up WO note: "Account lockout: failed_login_count threshold → locked_at + USER_LOCKED event + login reject."

**R5 (warning) — new `meResponseSchema` fields are `.optional()`/nullable.** Keeps the contract back-compatible:
existing FE fixtures (`apps/web*`, out of WO paths) keep typechecking, FE strips unknown→ignores, rollback = "fields
optional, FE ignores". `employee` is `.nullable()` (operator/super-admin has none); `company`/`roles`/`scopes`/`modules`
`.optional()` (present on success, absent-safe).

**R6 (warning) — scopes semantics:** `scopes: Record<"action:resourceType", DataScope[]>` — SAME key set as
`capabilities` (non-sensitive ALLOW only; DENY-suppressed pairs EXCLUDED entirely, not union'd — mirror
`getCapabilities` `permission.service.ts:208-241`). Union is **deduped** per pair (two roles granting `Company` →
`["Company"]`). `getCapabilities` and `getCapabilityScopes` are independent calls; partial failure (one ok, one `{}`)
is acceptable (UI hint only — BE-2 guard is the real gate); documented, not a bug.

**R7 (warning) — session_id stays NULL** on success login_logs rows this WO (user_sessions deferred, §4). Assert
intentional NULL in the success RED test.

**R8 (open-q) — wiring:** import `ModuleCatalogModule` directly into `AuthModule` (acyclic — module-catalog imports
PermissionModule/SettingsModule, never AuthModule; `module-catalog.module.ts:18`). No new `forwardRef`.

**R9 (warning) — operator/me:** add an explicit RED test for operator/super-admin session shape (`employee: null`,
roles/scopes/modules resolve in `claims.companyId`).
