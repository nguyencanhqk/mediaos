# S5-ME-DB-1 — user_preferences + seed module ME + catalog quyền ME

> Lane: `me-preferences-db` · zone=red · crown · gate FULL. Migration 0495 (idx 175, when 1717500870000)
> nối tiếp head 0494 (idx 174). Nguồn chuẩn: DB-08 §8.16 · SPEC-09 §15.2/§15.3 · DB-10 §10.1 · ME-DEC-002.

## Mục tiêu

1. **Bảng `user_preferences`** (DB-08 §8.16): tùy chọn cá nhân theo user cho module ME — tầng User trong
   precedence setting (System → Company → User). `company_id` NOT NULL; cột override NULLABLE (NULL = kế thừa
   company/system default); `UNIQUE(company_id, user_id)`; KHÔNG `deleted_at` (upsert-config, không soft-delete).
2. **RLS+FORCE TRƯỚC mọi INSERT** (BẤT BIẾN #1) — policy `tenant_isolation` literal-GUC (mẫu 0479). App GRANT
   `SELECT,INSERT,UPDATE` (upsert — KHÔNG DELETE); worker `SELECT`.
3. **Seed module ME** (DB-10 §10.1): `module_group='Experience'`, `sort_order=80`, `is_active/is_mvp=true`,
   `is_core=false`. Idempotent `ON CONFLICT (module_code) WHERE deleted_at IS NULL DO NOTHING`.
4. **Catalog 5 pair quyền ME** (is_sensitive=false) + grant scope `Own` × 4 role canonical = 20 rows.
   KHÔNG wrap nghiệp-vụ-nguồn (ATT/LEAVE/TASK/NOTI/profile — dùng permission NGUỒN, ME-DEC-002/§11.2).

## Điểm crown cần plan-reviewer soi

- **Cross-user KHÔNG do RLS:** policy chỉ có GUC `app.current_company_id` (KHÔNG có `app.current_user_id`) ⇒
  RLS+FORCE cô lập TENANT, KHÔNG cô lập user cùng tenant. Chống IDOR cross-user ép ở **ME-BE**
  (`WHERE user_id = token-resolved`, SPEC-09 §14.4/§17.1). WO này CHỈ đảm bảo tenant-isolation + UNIQUE.
- **Mapping `ME.ACCESS → access:me`** (cổng nav, non-sensitive để `getCapabilities` lộ) — ghi vào
  `docs/permission-matrix-spec.md` §9 CÙNG PR để web-core `PERMISSION_CODE_TO_PAIR` hạ nguồn khớp (pair-drift).

```yaml
workOrder: S5-ME-DB-1
lane: me-preferences-db
zone: red
tier: crown
gate: FULL
reviewers: [database-reviewer, security-reviewer, rls-tenant-isolation-tester, silent-failure-hunter]
migration:
  file: apps/api/migrations/0495_s5_medb1_user_preferences_me_module_perms.sql
  journalIdx: 175
  when: 1717500870000
  head_after: "0495"
  head_before: "0494"
table:
  name: user_preferences
  companyId: NOT NULL
  rls: { enable: true, force: true, policy: tenant_isolation, style: literal-GUC }
  grants: { app: [SELECT, INSERT, UPDATE], worker: [SELECT] }
  softDelete: false
  unique: [company_id, user_id]
  checks: [chk_user_preferences_theme, chk_user_preferences_density, chk_user_preferences_time_format]
seed:
  module: { code: ME, group: Experience, sort_order: 80, is_active: true, is_mvp: true, is_core: false }
  pairs:
    - { action: access, resourceType: me, code: ME.ACCESS, isSensitive: false }
    - { action: view, resourceType: user-preference, code: ME.PREFERENCE.VIEW_OWN, isSensitive: false }
    - { action: update, resourceType: user-preference, code: ME.PREFERENCE.UPDATE_OWN, isSensitive: false }
    - { action: update, resourceType: avatar, code: ME.AVATAR.UPDATE_OWN, isSensitive: false }
    - { action: update, resourceType: notification-preference, code: ME.NOTIFICATION_PREFERENCE.UPDATE_OWN, isSensitive: false }
  grantScope: Own
  roles: [employee, manager, hr, company-admin]
  grantRows: 20
  failLoud: [module-ME, 5-pairs, non-sensitive, 20-grants]
acceptanceChecks:
  - migration-smoke 0000→0495 clean + idempotent rerun
  - user_preferences relrowsecurity=true AND relforcerowsecurity=true + policy tenant_isolation
  - rls-registry case user_preferences → rls-guards/tenant-isolation/rls-coverage-assert PASS
  - schema/index.ts re-export user-preferences (additive) + typecheck XANH + git diff KHÔNG DROP
  - module ME 1 row Experience/80/active + 5 pair non-sensitive + 20 grant Own per-role §13
  - KHÔNG pair ME wrapper nghiệp-vụ-nguồn (grep)
  - permission-matrix-spec.md §9 có 5 dòng mapping pair→code
testTasks:
  - cross-tenant deny (app GUC A không thấy/không UPDATE pref B) — rls-registry + int-spec
  - upsert idempotent UNIQUE(company_id,user_id) — 2 upsert → 1 row giá trị lần 2
  - CHECK theme/density chặn giá trị ngoài enum
  - cross-user CONTRACT (RLS không cô lập user) + it.todo IDOR deny → ME-BE
  - seed-assert module ME + 5 pair + 20 grant Own per-role
  - idempotent re-apply grant 3× không drift
steps:
  - "đọc journal → mint 0495 idx 175 when 1717500870000 (KHÔNG double-mint)"
  - "CREATE TABLE user_preferences + RLS+FORCE+policy TRƯỚC INSERT + GRANT no-DELETE"
  - "seed module ME + 5 pair + DO-block grant Own×4 role + DO-block verify fail-LOUD"
  - "schema user-preferences.ts (parity) + append export index.ts (KHÔNG db:generate)"
  - "rls-registry case + int-spec RED-first"
  - "docs/permission-matrix-spec.md §9 mapping + plan yaml"
  - "verify DB cô lập lane-db-setup me-preferences-db + typecheck"
dependencies:
  satisfied: [permission-engine, audit-outbox, tenant-RLS, canonical-roles-0005-0444, modules-catalog-0435]
  downstream: [S5-ME-BE (IDOR user_id filter), web-core PERMISSION_CODE_TO_PAIR]
```
