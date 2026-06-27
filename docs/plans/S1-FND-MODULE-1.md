# S1-FND-MODULE-1 — Micro-plan (crown-jewel / FULL gate)

> CompanyService `/foundation/company/current` (GET/PATCH + audit) +
> ModuleCatalogService `/foundation/modules/my-apps` (filter permission + active + setting).
> Zone **red** (audit CONFIG_UPDATE write + permission-filtered listing). NO migration — reuses
> already-migrated tables (`companies` 0002/0360, `modules` 0435, settings, audit 0439).

## 0. Verified data sources (no "lơ lửng")

| Thing | Source of truth | Verified value |
| --- | --- | --- |
| company status enum | `companies_status_chk` (mig 0002) | `('active','suspended')` **lowercase** |
| modules catalog | table `modules` (mig 0435, NOT `system_modules`) | active MVP: AUTH HR ATT LEAVE TASK DASH NOTI; PAYROLL+ inactive |
| module enabled flag | `SettingService.resolveMany` key `module.<code>.enabled` | precedence company→system→default, **default `true`** |
| requiredAny per module | NEW const `MODULE_APP_METADATA[code]` in service | **engine pairs** `(action,resourceType)` — verified vs real seed SQL |
| company perm pair | **mig 0435 lines 335-336** (NOT 0005 `*:company`) | `view:foundation-company` (VIEW), `update:foundation-company` (UPDATE) — non-sensitive, granted to company-admin via `resource_type LIKE 'foundation-%'`. Matches sibling Foundation controllers (`view/update:foundation-setting`). ⚠️ `read/update:company` (0005) is the WRONG pair — drift trap; happy path won't catch it because admin holds both |
| audit object_type | `AUDIT_OBJECT_TYPES` + CHECK (0003/0011/0439) | `'company'` ∈ union ✓ |
| auth/guard model | `app.module.ts:80` | PermissionGuard **NOT global** — opt-in per controller. JwtAuthGuard+CompanyGuard ARE global |
| route prefix | BACKEND-04 §9.2/§9.3 | `/api/v1/foundation/company/current`, `/api/v1/foundation/modules/my-apps` |

### Engine pairs (verified against `apps/api/migrations/*permissions_seed*.sql` — NOT FE codes)
Memory drift-bug (`leave-request` ≠ seeded `leave`): backend filters on the **engine pair**, never the FE code.

| Module | engine pair(s) (`action:resourceType`) | FE display code(s) |
| --- | --- | --- |
| AUTH (system) | `read:user`, `read:role`, `view:foundation-setting`, `view:foundation-audit-log` | AUTH.USER.VIEW, AUTH.ROLE.VIEW, FOUNDATION.SETTING.VIEW, FOUNDATION.AUDIT_LOG.VIEW |
| HR | `read:employee` | HR.EMPLOYEE.VIEW |
| ATT | `read:attendance` | ATT.ATTENDANCE.VIEW_OWN |
| LEAVE | `read:leave` | LEAVE.REQUEST.VIEW_OWN |
| TASK | `read:task`, `read:project` | TASK.TASK.VIEW, TASK.PROJECT.VIEW |
| DASH | `read:dashboard` | DASH.DASHBOARD.VIEW |
| NOTI | `read:notification` | NOTI.NOTIFICATION.VIEW_OWN |

All 7 read pairs are **non-sensitive** in seed ⇒ covered by `PermissionService.getCapabilities()` (1 call, no N+1).

## 1. Files (all inside WO paths — no hot-file touch)

`apps/api/src/foundation/company/`
- `company-status.ts` — `isCompanyActive(status) = status === 'active'` (allow-list, fail-closed; mirrors auth-path) + `assertCompanyActive()`.
- `company.repository.ts` — `findCurrentTx(tx)`, `updateTx(companyId, patch, tx)` (WHERE id=companyId AND deleted_at IS NULL; RLS also scopes).
- `company.dto.ts` — Zod `PatchCompanyDto` (editable allow-list, all optional; currency∈VND/USD, language∈vi/en; **unknown keys stripped** ⇒ body `company_id` ignored). `CompanyView` mapper.
- `company.service.ts` — `getCurrent(actor)`, `updateCompany(actor, dto)`.
- `company.controller.ts` — `@UseGuards(PermissionGuard)`; GET `@RequirePermission('view','foundation-company')`, PATCH `@RequirePermission('update','foundation-company')`.
- `company.module.ts` — self-contained (DatabaseModule, PermissionModule, EventsModule). **Not** wired to app.module (WIRE-1).
- `company.service.spec.ts`, `company.controller.spec.ts` (deny-path RED).

`apps/api/src/foundation/module-catalog/`
- `module-app-metadata.ts` — `MODULE_APP_METADATA` (route/icon/group-fallback/requiredAny engine pairs/feCodes).
- `module-catalog.repository.ts` — `findActiveModules(tx)` (no-RLS catalog via `db.withTransaction`).
- `module-catalog.dto.ts` — `MyAppItem` shape (BACKEND-04 §9.3).
- `module-catalog.service.ts` — `getMyApps(actor)`.
- `module-catalog.controller.ts` — **NO** PermissionGuard (Authenticated-only per spec); reads `req.user`.
- `module-catalog.module.ts` — imports SettingsModule (SettingService), PermissionModule, DatabaseModule.
- `module-catalog.service.spec.ts` (deny-path RED).

## 2. Behaviour contracts (DoD mapping)

**getCurrent** (DoD #1): `withTenant(actor.companyId)` → `repo.findCurrentTx` → view. Tenant from AuthContext ONLY; any client `company_id` is irrelevant (never read). GET stays readable even when suspended (FE shell must render the suspended state) — suspended gate applies to writes.

**updateCompany** (DoD #2,#3): inside `withTenant(actor.companyId, tx)`:
1. load existing; **if `!existing` → ForbiddenException** (clean fail-closed, never NPE/500); then `assertCompanyActive(existing.status)` → **suspended ⇒ ForbiddenException BEFORE any write/audit** (0 audit on 403).
2. `patch = pickEditable(dto)` (allow-list; ignores id/slug/status/company_id). Empty patch ⇒ return current, **no audit** (nothing changed).
3. `repo.updateTx(actor.companyId, patch, tx)`.
4. `audit.record(tx, {action:'COMPANY_UPDATED', objectType:'company', objectId, actorUserId:actor.id, actorType:'User', moduleCode:'FOUNDATION', entityType:'company', entityCode: companyCode??slug, oldValues:oldSnap, newValues:newSnap, sensitivityLevel:'Normal', resultStatus:'Success', dataScope:'Company', permissionCode:'FOUNDATION.COMPANY.UPDATE'})` — **same tx** (BẤT BIẾN #2), masker + auto changedFields (BẤT BIẾN #3).
5. The 403 in DoD #2 (missing `update:company`) is enforced by **PermissionGuard before the controller runs** ⇒ service never executes ⇒ 0 audit (tested at guard/decorator layer).

**getMyApps** (DoD #4,#5): 
1. `modules = repo.findActiveModules()` (is_active AND deleted_at IS NULL, ORDER BY sort_order).
2. `enabled` BATCH: `settingService.resolveMany(companyId, keys=module.<code>.enabled)` → `enabled = found ? (value===true||value==='true') : true`.
3. `caps = permission.getCapabilities(userId, companyId)` (1 call).
4. keep module iff `enabled && hasAnyCapability(caps, meta.requiredAny)` where empty requiredAny ⇒ show, wildcard-aware (`a:r | *:r | a:* | *:*`). Module with **no metadata** ⇒ skip + `Logger.warn` (cannot build app card; no fabrication).
5. item: `{module_code,name,description,route,icon,group:row.moduleGroup,is_active:true,is_favorite:false,is_recent:false,badges:[],required_permissions:meta.feCodes,allowed_actions:['open','favorite']}`. `is_favorite/is_recent` hardcoded false + `// TODO user_module_preferences (Phase 2) — KHÔNG bịa`.

**Tenant isolation** (DoD #6c): every read/write through `withTenant(actor.companyId)`; `resolveMany`/repo use actor.companyId only; `getCapabilities(userId, companyId)` keyed to actor. Company A can never read/write B.

## 3. Deny-path RED tests (write FIRST — DoD #6)
- (a) `update:company` missing → PermissionGuard.canActivate (mock PermissionService deny) throws Forbidden + `@RequirePermission('update','company')` metadata asserted on the handler; service.audit never called.
- (a') suspended company → `updateCompany` throws Forbidden; repo.updateTx + audit.record **not** called (0 audit).
- (b) my-apps: user lacking ALL requiredAny pairs of a module → module filtered out; user with ≥1 → present; empty requiredAny → present; setting `module.X.enabled=false` → filtered.
- (c) 2-tenant: assert `withTenant`/`resolveMany`/`getCapabilities` invoked with `actor.companyId` (not any body id).
- (d) PATCH body with foreign `company_id` → stripped by Zod + pickEditable; audit/objectId use actor tenant.

## 4. Gate
FULL: `security-reviewer` (permission/audit/fail-closed) + `rls-tenant-isolation-tester` (withTenant scoping). No migration ⇒ no db-migration lane. Typecheck + targeted vitest must be green.

## 5. Out of scope (explicit)
`/modules` admin list, `/modules/recent-apps`, `/open`, `/favorite`, PATCH `/modules/{code}`, `user_module_preferences` table → later WO. FoundationModule gather + contracts envelope → S1-FND-WIRE-1.
