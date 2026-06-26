# S2-INT-1 — HR create employee ↔ AUTH create/link user (consistent tx · unique active link · audit both sides)

> Zone: **RED / crown-jewel** (cross-module integration touching AUTH user creation, audit, permission).
> Gate: **FULL** (security-reviewer + silent-failure-hunter; + santa-method / completion-evaluator). Human chốt.
> Depends on: ✅ S2-HR-BE-2 · ✅ S2-AUTH-BE-3. Migration: **NONE** (constraint + perms already exist).

## Context

The HR write core (`HrWriteService.createEmployee`, S2-HR-BE-2) already provisions or links a user
**inside one `withTenant` transaction** and the DB partial-unique index
`employee_profiles_company_user_active_uq` (mig 0018, `(company_id, user_id) WHERE deleted_at IS NULL`)
already enforces "1 user ↔ ≤1 active employee". So the integration is **mostly built**. Three gaps
remain against the acceptance criteria:

1. **No `create:user` permission gate on the auto-provision arm.** When the request creates a *new*
   login account (`!userId && email`), the actor is only gated on `create:employee` — a
   create:employee-only actor can mint AUTH accounts. (acceptance #3)
2. **No AUTH-side audit when HR provisions a user.** `resolveUserId` inserts the user via
   `repo.createUserTx` but never records `user.created` — only the employee `create` audit is written.
   (acceptance #2)
3. **Link-on-create uniqueness relies solely on the DB index** (generic 409). `linkUser` has an
   explicit `findActiveByUserIdTx` pre-check; the create path does not. (acceptance #1 hardening)

Rollback consistency (acceptance #2, second half) is **already satisfied** — both writes share one tx.

## Approach (decoupled — no new cross-module DI)

`UsersModule` does not export `AuthUsersService` and uses `forwardRef(AuthModule)`; the codebase
deliberately avoids importing HR/Auth services across modules (DI-cycle risk, see S2-AUTH-BE-2). So:
- Inject `PermissionService` (already exported by `PermissionModule`, already imported by
  `EmployeesModule`) into `HrWriteService` — **zero module wiring change**.
- Reuse the pure exported function `authUserSnapshot` (from `users/auth-users.repository.ts`) for the
  `user.created` snapshot — single source of truth for the non-secret shape (BẤT BIẾN #3, no passwordHash).

### Code

**`apps/api/src/employees/hr-write.repository.ts`**
- `findActiveByUserIdTx(tx, companyId, userId, exceptId)` → make `exceptId: string | null`; apply
  the `ne(id, exceptId)` predicate only when non-null (create path passes `null`).
- `createUserTx(tx, companyId, { email, fullName, passwordHash, createdBy })` → add `createdBy`
  (set `created_by`/`updated_by`); return the **full row** (`.returning()`, typed `User`) so the
  service can audit-snapshot it.

**`apps/api/src/employees/hr-write.service.ts`**
- Constructor: append `private readonly permissions: PermissionService` (8th param).
- `createEmployee`: after `assertWriteScope`, compute `willProvisionUser = !dto.userId && !!dto.email`;
  if true call `assertCanProvisionUser(user)` — **before** code allocation / any write so a deny leaves
  zero side effects (no sequence burn, no rows, no audit).
- `assertCanProvisionUser(user)`: `permissions.can({ userId, companyId, action:"create",
  resourceType:"user" })`; deny → `ForbiddenException("AUTH-ERR-USER-PROVISION-DENIED …")`.
- `resolveUserId(tx, companyId, dto, actorUserId)` → return `{ userId, provisioned: User | null }`:
  - link-existing arm: add `findActiveByUserIdTx(tx, companyId, dto.userId, null)` → `ConflictException`
    on clash; return `{ userId, provisioned: null }`.
  - provision arm: pass `createdBy: actorUserId`; return `{ userId: created.id, provisioned: created }`.
- In the tx body: when `provisioned`, `audit.record(tx, { action:"user.created", objectType:"user",
  objectId, actorUserId, after: authUserSnapshot(provisioned) })` — same tx as the employee `create`
  audit (BẤT BIẾN #2: both commit or both roll back).

**Note:** `create:user` is required ONLY on the provision arm. Linking an existing account creates no
AUTH row → no AUTH-create permission needed (precise, not over-broad).

### Tests (RED-first)

**Unit — `apps/api/src/employees/hr-write.service.spec.ts`** (extend `makeService` with a `permissions`
mock; fix the standalone `new HrWriteService(...)` arg list; enrich `createUserTx` mock to a full row):
- provision happy → `createUserTx` called, two audits (`user.created` + employee `create`), no PII keys.
- provision deny (`can` → allow:false) → `ForbiddenException`; `nextCode`/`createTx`/`createUserTx`/
  `audit.record` **not** called (gate before any write).
- link-existing path → `permissions.can` **not** called; no `user.created` audit.
- link-on-create clash (`findActiveByUserIdTx` → row) → `ConflictException`; `createTx` not called.

**Integration — NEW `apps/api/test/integration/s2-int1-employee-user-provision.int-spec.ts`**
(gate `hasDb && LANE_DB`; real AppModule + supertest + real permission engine):
- happy provision (actor has create:employee + create:user): POST `{email,fullName}` → 201; user row
  exists with a **hashed** password (≠ plaintext); employee linked; +1 `user.created` audit (object
  user) AND +1 `create` audit (object employee).
- deny (actor has create:employee, NOT create:user): POST `{email}` → 403; **0** new users, **0**
  employees, **0** audit rows.
- link-existing without create:user (actor create:employee only): POST `{userId}` of an unlinked
  user → 201; **no** `user.created` audit.
- rollback: actor with both perms, POST `{email, orgUnitId:<inactive/bad>}` → 422; the would-be user
  is **not** persisted (tx rolled back); 0 `user.created` audit.
- 2-tenant: actor in A, POST `{userId}` of a user in B → 404 (no cross-link).
- unique: POST `{userId}` of an already active-linked user → 409.

**Update `apps/api/test/integration/hr-employee-write.int-spec.ts`**: add `["create","user"]` to
`WRITE_PAIRS` (its provision happy-paths now legitimately need create:user).

## Verification

```bash
bash scripts/lane-db-setup.sh s2int1 && export LANE_DB=mediaos_s2int1
pnpm --filter @mediaos/api typecheck
pnpm --filter @mediaos/api test            # unit (colocated *.spec.ts)
pnpm --filter @mediaos/api test:int        # integration (or vitest run test/integration)
pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/api build
```

DoD: unit + int green on isolated lane DB · deny = 403 + 0 writes (incl. 0 sequence burn) · two audit
rows on provision · rollback leaves no orphan user · 2-tenant 404 · unique 409 · FULL gate PASS · no
`@ts-ignore`/`eslint-disable`.
