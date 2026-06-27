# Micro-plan — S2-AUTH-DB-1 (🔴 RED / crown)

> Mở rộng RBAC engine: thêm cột `data_scope` (Own/Team/Department/Company/System) vào `role_permissions`.
> Gỡ nợ **DEFERRED** của S0-AUTH-DB-1. Nguồn: IMPLEMENTATION-05 §12.1/§13 · BACKEND-03 · DB-02.

## 1. Bối cảnh (reconcile-first)

Engine hiện tại (`apps/api/src/db/schema/permissions.ts`, mig 0005):
- `role_permissions(role_id, permission_id, effect)` — `effect ∈ {ALLOW,DENY}`, deny-overrides ở app layer.
- UNIQUE `(role_id, permission_id, effect)` · RLS ENABLE+FORCE · policy `role_permissions_tenant_isolation` (JOIN→roles) · GRANT `SELECT,INSERT,DELETE` cho `mediaos_app` (KHÔNG UPDATE → đổi grant = delete+insert).
- **KHÔNG có khái niệm scope.** Permission matrix S2 §13 (canonical, áp dụng cho TOÀN MVP gồm ATT/LEAVE...) bắt buộc data_scope Own/Team/Department/Company/System — biểu diễn qua **cột `role_permissions.data_scope`**, KHÔNG mã hoá vào tên permission (BACKEND-03).

Phân tách trách nhiệm:
- **WO này (DB)** = thêm CỘT + CHECK + giữ RLS, backfill an toàn. KHÔNG seed scope từng role, KHÔNG viết resolver.
- Seed scope đúng từng role = **S2-AUTH-SEED-1**. Resolver tiêu thụ scope = **S2-AUTH-BE-2** (crown).

## 2. Thay đổi (thuần additive — HOT-FILE §9.3, KHÔNG rewrite)

1. **Migration `0441_s2_authdb1_role_perm_data_scope.sql`** (idx 124, when 1717500590000, nối head 0440):
   - `ALTER TABLE role_permissions ADD COLUMN data_scope text NOT NULL DEFAULT 'Company'` (idempotent qua information_schema guard).
   - `ADD CONSTRAINT role_permissions_data_scope_chk CHECK (data_scope IN ('Own','Team','Department','Company','System'))`.
   - **KHÔNG đụng** RLS/FORCE/policy/grant (mig 0005 giữ nguyên) → **BẤT BIẾN #1 không thay đổi**.
2. **Drizzle schema** `permissions.ts`: thêm `dataScope` vào `rolePermissions` + export `ROLE_DATA_SCOPES` const + type `RoleDataScope` (tên RBAC-riêng, tránh nhầm với `audit_logs.data_scope` = visibility Company/System).
3. **RED test** `role-permission-data-scope.int-spec.ts` (gate `hasDb && LANE_DB`).

## 3. Quyết định backfill (an toàn — KHÔNG nới scope)

`DEFAULT 'Company'` ⇒ mọi row cũ (mig 0005 media-era grants) backfill = `'Company'`.
- **KHÔNG dùng `'System'`** (rộng nhất) ⇒ không có system-role nào bị nới scope qua default (done_when #3).
- `'Company'` ≤ scope của company-admin hiện hữu (đúng); employee/manager media-era sẽ được **SEED lại scope hẹp đúng** ở S2-AUTH-SEED-1 ngay sau. WO done_when chốt rõ `DEFAULT 'Company'`.
- App role KHÔNG có UPDATE trên role_permissions ⇒ đổi scope = delete+insert (đồng nhất pattern effect hiện có); seed chạy bằng owner (migration) nên set scope tự do.

## 4. Đích hội tụ (done_when → cách verify)

| done_when | Verify |
| --- | --- |
| cột data_scope NOT NULL DEFAULT 'Company' + CHECK 5 giá trị; giữ effect (additive) | int test: information_schema column + insert invalid scope → fail · valid → ok · default áp khi không truyền |
| schema drizzle đồng bộ; RLS+FORCE GIỮ NGUYÊN | int test: `pg_class.relrowsecurity AND relforcerowsecurity` = true cho role_permissions; typecheck xanh |
| backfill KHÔNG nới scope system-role; cross-tenant deny còn xanh | int test: mọi row backfill = 'Company' (≠ System); rls-tenant-isolation-tester PASS (gate) |
| 1 lane db-migration; migrate 0000→head sạch | `lane-db-setup.sh` chain 0000→0441 + full api suite xanh |

## 5. RED → GREEN

Test viết TRƯỚC; chạy trên DB CHƯA áp 0441 ⇒ ĐỎ (cột chưa tồn tại / CHECK chưa có). Áp 0441 ⇒ XANH.
Bằng chứng RED+GREEN lưu khi verify.

## 6. Gate (FULL — crown)

`security-reviewer` (3 bất biến, additive-not-weakened) + `database-reviewer` (migration shape/idempotent/journal) +
`rls-tenant-isolation-tester` (role_permissions còn cô lập chéo tenant). Red zone → **người chốt trước merge** (KHÔNG auto-merge).
