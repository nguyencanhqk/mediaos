<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-AUTH-DB-1
zone: red
generated_by: human
reconciled_at: "migration head 0438 / idx 121"   # mốc freshness — head đổi ⇒ reconcile-refresh lại
lanes:
  - id: S0-AUTH-DB-1
    builder: db-migration
    task: "Migration 0439 (band foundation-db, idx 122): seed permission AUTH còn THIẾU vs SPEC-02/API-10 ((lock|unlock):user · (read|assign):role) ON CONFLICT DO NOTHING + grant company-admin/super-admin theo matrix (non-wildcard cho sensitive mới) + RED deny-path test grant không rò chéo tenant. KHÔNG đổi shape engine; data_scope = DEFERRED. 1 lane nối tiếp — KHÔNG parity song song."
    paths: ["apps/api/migrations/**", "apps/api/test/integration/auth-rbac-tenant-deny.int-spec.ts"]
acceptanceChecks:
  - "GIỮ engine (action,resource_type,is_sensitive)+(role_id,permission_id,effect) — KHÔNG db:generate/drop/rename/ADD COLUMN permission_code/data_scope. data_scope DB-02 = DEFERRED (ghi note migration, không churn)."
  - "Sau migrate: SELECT count(*) cho 14 cặp guard AUTH (SPEC-02/API-10) đều = 1 (đủ catalog); 4 cặp MỚI ((lock,user),(unlock,user),(read,role),(assign,role)) tồn tại đúng is_sensitive."
  - "permission sensitive MỚI ((lock,user),(unlock,user),(assign,role) = is_sensitive true) KHÔNG vào role_permissions của bất kỳ system role qua wildcard `is_sensitive=false`; chỉ grant TƯỜNG MINH non-wildcard cho company-admin/super-admin theo matrix."
  - "Ngoại lệ đã-ship GIỮ NGUYÊN (KHÔNG đụng): hr-manager view/update-salary (mig 0019), company-admin assign-role:user (mig 0140) — verify còn nguyên sau migrate."
  - "roles/role_permissions/user_roles/object_permissions GIỮ RLS ENABLE+FORCE+policy (0005); migration KHÔNG nới policy/grant. Deny-path: app role bind company A KHÔNG đọc role_permissions/user_roles của company B (0 row), KHÔNG INSERT chéo (WITH CHECK reject)."
  - "Seed idempotent: chạy lần 2 trên cùng DB → 0 hàng mới (permissions + role_permissions). Verify từ DB trống (migrate full) VÀ từ DB đã có head 0438."
testTasks:
  - "apps/api/test/integration/auth-rbac-tenant-deny.int-spec.ts (model: db-rls + tenant-isolation): appPool set_config('app.current_company_id', A) → SELECT user_roles/role_permissions của B = 0 row; INSERT user_roles company_id=B (ctx A) → rejects.toThrow(/row-level security|policy/i)."
  - "catalog-count assert (directPool): 14 cặp guard AUTH có mặt; (lock,user)+(unlock,user)+(assign,role) is_sensitive=true; (read,role) is_sensitive=false."
  - "wildcard-leak assert (directPool): 3 sensitive MỚI KHÔNG có trong role_permissions qua nhánh wildcard is_sensitive=false; chỉ có dòng ALLOW tường minh cho …0001 (+…0001 super nếu seed)."
  - "idempotent assert: re-run nội dung INSERT của 0439 (qua directPool) → rowCount=0 (ON CONFLICT DO NOTHING)."
  - "preexisting-exception assert: (view-salary,employee)/(update-salary,employee)@…0009 và (assign-role,user)@…0001 vẫn tồn tại (không bị migration xoá/đụng)."
steps:
  - "0439_auth_db1_permission_seed_matrix.sql (band foundation-db, idx 122, when 1717500570000): (a) INSERT 4 cặp AUTH còn thiếu vào permissions ON CONFLICT (action,resource_type) DO NOTHING — (lock,user,true),(unlock,user,true),(read,role,false),(assign,role,true); (b) grant company-admin …0001 TƯỜNG MINH (read,role)+(assign,role); super-admin tường minh sensitive AUTH nếu role …(super) tồn tại; (c) KHÔNG đụng wildcard 0005, KHÔNG đụng 0019/0140; header ghi data_scope=DEFERRED + danh sách is_sensitive mới."
  - "RED test auth-rbac-tenant-deny.int-spec.ts (cross-tenant deny + catalog-count + wildcard-leak + idempotent + preexisting-exception)."
  - "_journal.json append {idx:122, version:'7', when:1717500570000, tag:'0439_auth_db1_permission_seed_matrix', breakpoints:true}."
```

# S0-AUTH-DB-1 — Micro-plan (reconcile AUTH/RBAC schema + seed matrix vs DB-02 / SPEC-02 / API-10)

> Zone: 🔴 RED / crown (permission · RLS · sensitive-no-wildcard · seed · migration). Reconcile-first, append-only, spec-wins, **một head — một lane**.
> Migration head: idx **121** / `0438_foundation_db6_audit_db08_shape`. Next: `0439`, idx **122**, when `1717500570000`, band `foundation-db`.

## 0. Kết quả đối chiếu (đã verify line-level)

| done_when | Trạng thái | Hành động |
| --- | --- | --- |
| #1 GIỮ engine 4-tier (action,resource_type,effect) — KHÔNG đổi shape; data_scope DEFERRED | ✅ **đã đạt + ghi note** | Engine `permissions(action,resource_type,is_sensitive)` + `(action,resource_type)` UNIQUE (0005 L56–62, `schema/permissions.ts` L47–58). KHÔNG có `permission_code`/`data_scope`. KHÔNG churn — ghi DEFERRED. |
| #2 seed danh sách AUTH cụ thể + ma trận role→permission, đếm được | ⚠️ **gap 4 cặp** | Catalog AUTH **thiếu** `(lock,user)`, `(unlock,user)`, `(read,role)`, `(assign,role)` (= `PERMISSION.VIEW`/`PERMISSION.ASSIGN`). Seed 4 cặp + grant matrix. |
| #3 sensitive MỚI KHÔNG auto-grant qua wildcard; ngoại lệ 0019/0140 hợp lệ | ✅ **quy tắc thu hẹp** | Wildcard company-admin (0005 L310–313) chỉ lấy `is_sensitive=false` → 3 cặp sensitive mới KHÔNG dính. Grant tường minh non-wildcard. 0019/0140 GIỮ. |
| #4 RLS+FORCE giữ; deny-path test; 1 lane | ✅ **+ 1 test mới** | roles/role_permissions/user_roles/object_permissions đã ENABLE+FORCE+policy (0005). Thêm RED cross-tenant test. **L2 đã xoá — 1 lane nối tiếp.** |

**KHÔNG có gì để build cho (đã khớp, KHÔNG đụng):** bảng `users` (0002), `refresh_tokens`/`password_reset_tokens` (0004), `login_logs`/`user_sessions` (đã có RLS+FORCE band auth), `roles`/`permissions`/`role_permissions`/`user_roles`/`object_permissions` (0005). Mọi bảng company-scope đã RLS ENABLE+FORCE+policy `current_setting('app.current_company_id', true)`.

## 1. Engine shape đã xác minh — mismatch DB-02 = DEFERRED (KHÔNG churn)

| Khía cạnh | Engine ĐÃ SHIP (nguồn sự thật runtime) | DB-02 (spec mô tả) | Quyết định |
| --- | --- | --- | --- |
| Khóa quyền | `(action TEXT, resource_type TEXT)` UNIQUE | `permission_code VARCHAR(150)` UNIQUE + `(resource, action)` | GIỮ `(action,resource_type)`. `permission_code` = **DEFERRED** (đặc tả-ánh-xạ ở §2 dưới, KHÔNG thêm cột). |
| Sensitive flag | `is_sensitive BOOLEAN` ✅ khớp | `is_sensitive BOOLEAN` ✅ | giữ. |
| Scope dữ liệu | **KHÔNG có** `data_scope` trên `role_permissions` (chỉ `role_id,permission_id,effect`) | `role_permissions.data_scope` CHECK(Own/Team/Department/Project/Company/System) | **DEFERRED** — engine 4-tier hiện diễn Scope ở **tầng app/service** (matrix-spec §1 Tầng-2), KHÔNG ở cột DB. Thêm cột = đổi shape + vỡ writer `can()` ⇒ KHÔNG làm ở WO này. Ghi rõ ở header migration. |
| Effect | `effect IN ('ALLOW','DENY')`, cho phép ALLOW+DENY đồng tồn (deny-overrides ở app) | tương đương | giữ. |

> **Lý do KHÔNG churn:** `permission_code`/`data_scope` là biểu diễn khác của cùng thông tin; thêm chúng vào engine đang chạy (snapshot `can()`, seed 0005→0438, test deny-path) = breaking. Tiêu chí cũ "khớp số dòng SPEC-02" **không đo được** vì hai shape khác trục khóa → THAY bằng **danh sách cặp cụ thể** (§2) đếm được bằng SQL.

## 2. Danh sách permission AUTH cụ thể (cặp `(action, resource_type)` + `is_sensitive`) — ánh xạ SPEC-02/API-10 → engine

> 14 guard thực (API-10 §AUTH: bỏ 3 nhãn non-guard `LOGIN.ACCESS`/`PROFILE.VIEW`/`PROFILE.UPDATE` chỉ gate `Authenticated`; `PASSWORD.CHANGE` = self-service `Authenticated`, không seed guard). Cột "Đã có?" verify từ migrations.

| # | Mã DB-02 | engine `(action, resource_type)` | is_sensitive | Đã có? (nguồn) |
| --- | --- | --- | --- | --- |
| 1 | `AUTH.USER.VIEW` | `(read, user)` | false* | ✅ 0005 L205 |
| 2 | `AUTH.USER.CREATE` | `(create, user)` | false* | ✅ 0005 L204 |
| 3 | `AUTH.USER.UPDATE` | `(update, user)` | false* | ✅ 0005 L206 |
| 4 | `AUTH.USER.DELETE` | `(delete-user, user)` | true | ✅ 0430 L25 (soft-delete; KHÔNG hard-delete) |
| 5 | `AUTH.USER.LOCK` | `(lock, user)` | **true** | ❌ **THIẾU → seed 0439** |
| 6 | `AUTH.USER.UNLOCK` | `(unlock, user)` | **true** | ❌ **THIẾU → seed 0439** |
| 7 | `AUTH.USER.ASSIGN_ROLE` | `(assign-role, user)` | true | ✅ 0140 L71 (grant …0001 tường minh) |
| 8 | `AUTH.ROLE.VIEW` | `(read, role)` | false* | ✅ 0005 L212 |
| 9 | `AUTH.ROLE.CREATE` | `(create, role)` | false* | ✅ 0005 L211 |
| 10 | `AUTH.ROLE.UPDATE` | `(update, role)` | false* | ✅ 0005 L213 |
| 11 | `AUTH.ROLE.DELETE` | `(delete, role)` | false* | ✅ 0005 L214 |
| 12 | `AUTH.PERMISSION.VIEW` | `(read, role)` ⇒ reuse #8 **HOẶC** `(assign, role)` cho ASSIGN | — | xem #13/14 |
| 13 | `AUTH.PERMISSION.VIEW` | `(read, role)` | false | ✅ reuse #8 (xem role ⊇ xem permission-của-role) |
| 14 | `AUTH.PERMISSION.ASSIGN` | `(assign, role)` | **true** | ❌ **THIẾU → seed 0439** (gán permission cho role = leo thang) |
| — | `AUTH.AUDIT_LOG.VIEW` | `(read, audit-log)` + `(access-audit-log, audit-log)` | false/true | ✅ 0005 L292–293; `(view,audit-log,true)` 0340 L31 |

> `*false` = đã seed false ở catalog gốc 0005 (KHÔNG re-flag — đổi is_sensitive của cặp đã ship = breaking; nếu cần siết, để service-layer guard, KHÔNG sửa DB ở WO này).
> **Quyết định ánh xạ `PERMISSION.VIEW`:** "xem danh sách permission gán cho role" được bao bởi `(read, role)` (#8). Chỉ cần seed cặp MỚI `(assign, role)` cho `PERMISSION.ASSIGN` (#14).

### 2.1 Cặp MỚI seed bởi migration 0439 (đúng 4)

| `(action, resource_type)` | is_sensitive | Vì sao |
| --- | --- | --- |
| `(lock, user)` | **true** | khóa account = hành động đặc quyền (AU matrix: chỉ SA/CA) |
| `(unlock, user)` | **true** | mở khóa = đặc quyền |
| `(read, role)` | false | `ROLE.VIEW`/`PERMISSION.VIEW` — **đã có ở 0005 L212** ⇒ INSERT no-op qua ON CONFLICT (giữ trong danh sách để đếm đủ; KHÔNG sinh dòng mới) |
| `(assign, role)` | **true** | `PERMISSION.ASSIGN` — gán permission cho role = leo thang đặc quyền |

> Thực-thêm-mới vào catalog = **3 cặp** `(lock,user)`/`(unlock,user)`/`(assign,role)` (cả 3 sensitive). `(read,role)` đã tồn tại → ON CONFLICT DO NOTHING. Vẫn liệt kê 4 dòng INSERT để idempotent + đếm khớp.

## 3. Ma trận role → permission (grant TƯỜNG MINH, non-wildcard cho sensitive mới)

System role IDs (0005 L297–305 + 0019 L36): `…0001` company-admin · `…0002` project-manager · … `…0008` employee · `…0009` hr-manager. (KHÔNG có row `super-admin` riêng trong seed 0005; nếu band sau seed `super-admin`/`…0000`, grant thêm tường minh — migration dùng `WHERE EXISTS role …` an toàn nếu vắng.)

| Quyền (engine) | SA | ADM (…0001) | HR (…0009) | MGR | EMP | Cách cấp ở 0439 |
| --- | --- | --- | --- | --- | --- | --- |
| `(read, user)` / `(create,user)` / `(update,user)` (non-sens) | Có | **Có (wildcard 0005)** | Cấp | — | — | KHÔNG đụng — wildcard `is_sensitive=false` đã phủ ADM. |
| `(read, role)` (non-sens) | Có | **Có (wildcard 0005)** | — | — | — | KHÔNG cần grant lại; INSERT tường minh ON CONFLICT (no-op an toàn). |
| `(lock, user)` 🔒 | Có | **Có** | — | — | — | **Grant tường minh …0001** (sensitive ⇒ KHÔNG vào wildcard). |
| `(unlock, user)` 🔒 | Có | **Có** | — | — | — | **Grant tường minh …0001.** |
| `(assign, role)` 🔒 (PERMISSION.ASSIGN) | Có | **Có (giới hạn)** | — | — | — | **Grant tường minh …0001.** (API-10: ASSIGN = SA, CA giới hạn.) |
| `(assign-role, user)` 🔒 | Có | **Có (0140)** | — | — | — | **GIỮ NGUYÊN 0140** — KHÔNG đụng. |
| `(view-salary,employee)`/`(update-salary,employee)` 🔒 | Có | Cấp | **Có (0019)** | — | — | **GIỮ NGUYÊN 0019** (HR-domain, ngoại lệ hợp lệ). |
| `(read, audit-log)` / `(access-audit-log,audit-log)` 🔒 | Có | Cấp | — | — | — | đã quản ở band audit; KHÔNG đụng ở WO AUTH. |

**Nguyên tắc #3 (thu hẹp, đo được):** *permission sensitive MỚI do migration 0439 thêm* (`lock`/`unlock`/`assign` resource user/role) **KHÔNG** được nạp vào `role_permissions` qua bất kỳ nhánh `WHERE is_sensitive=false`. Chỉ 3 dòng `INSERT … SELECT … WHERE (action,resource_type) IN (…) ` tường minh (ALLOW) cho `…0001`. **Ngoại lệ hợp lệ đã ship (KHÔNG coi là vi phạm):** `(view-salary|update-salary, employee)`@`…0009` (mig 0019 L80–86) và `(assign-role, user)`@`…0001` (mig 0140 L77–81).

## 4. Phạm vi thay đổi (CHỈ additive — KHÔNG db:generate, KHÔNG drop/rename, KHÔNG sửa schema Drizzle)

### A. Migration `0439_auth_db1_permission_seed_matrix.sql` (band foundation-db, idx 122)
1. **Catalog (ON CONFLICT (action, resource_type) DO NOTHING):**
   ```sql
   INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
     ('lock',   'user', true),
     ('unlock', 'user', true),
     ('read',   'role', false),   -- đã có (0005) → no-op; giữ để đếm đủ
     ('assign', 'role', true)
   ON CONFLICT (action, resource_type) DO NOTHING;
   ```
2. **Grant tường minh company-admin `…0001` (sensitive ⇒ non-wildcard, ON CONFLICT DO NOTHING):**
   ```sql
   INSERT INTO role_permissions (role_id, permission_id, effect)
   SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
   FROM permissions p
   WHERE (p.action, p.resource_type) IN (('lock','user'),('unlock','user'),('assign','role'))
   ON CONFLICT DO NOTHING;
   ```
3. **(Tùy chọn) super-admin tường minh** — chỉ nếu band trước đã seed role super-admin: cùng pattern `INSERT … SELECT … WHERE role tồn tại`; an toàn no-op nếu vắng.
4. **Header migration** ghi rõ: `data_scope = DEFERRED (engine không biểu diễn — Scope ép ở service-layer)`; danh sách is_sensitive MỚI; **KHÔNG** đụng wildcard 0005 / 0019 / 0140 / RLS / policy / grant bảng.

**KHÔNG đụng:** RLS ENABLE/FORCE/policy roles·role_permissions·user_roles·object_permissions (đúng từ 0005); GRANT bảng (0005 đã set `SELECT,INSERT,DELETE` cho role_permissions/user_roles, `SELECT` permissions — append-only-style: KHÔNG UPDATE); wildcard seed company-admin (0005); ngoại lệ 0019/0140.

### B. Test RED `apps/api/test/integration/auth-rbac-tenant-deny.int-spec.ts`
Model: `db-rls.int-spec.ts` + `tenant-isolation.int-spec.ts` (`appPool(n)` + `directPool()`, `set_config('app.current_company_id', $1, true)` — tương thích PgBouncer transaction-mode):
1. **cross-tenant SELECT deny:** seed (directPool) role tenant-scoped + `user_roles`/`role_permissions` cho company B; `appPool` ctx company A → `SELECT … user_roles WHERE …` của B = **0 row**; `SELECT … role_permissions JOIN roles` của B = **0 row**.
2. **cross-tenant INSERT deny:** `appPool` ctx A → `INSERT INTO user_roles (… company_id=B …)` → `rejects.toThrow(/row-level security|policy/i)` (WITH CHECK).
3. **catalog-count:** directPool đếm 14 cặp guard AUTH có mặt; `(lock,user)`/`(unlock,user)`/`(assign,role)` `is_sensitive=true`; `(read,role)` `is_sensitive=false`.
4. **wildcard-leak:** 3 sensitive mới KHÔNG có dòng role_permissions nào ngoài ALLOW tường minh `…0001`; KHÔNG kế thừa qua wildcard.
5. **idempotent:** chạy lại nội dung INSERT 0439 qua directPool → `rowCount=0`.
6. **preexisting-exception:** `(view-salary|update-salary,employee)`@`…0009` + `(assign-role,user)`@`…0001` vẫn tồn tại.

### C. Journal `apps/api/migrations/meta/_journal.json`
Append: `{ idx:122, version:"7", when:1717500570000, tag:"0439_auth_db1_permission_seed_matrix", breakpoints:true }`.

## 5. Bất biến giữ nguyên (crown)
- **#1 tenant (RLS+FORCE):** roles (system-role readable, app KHÔNG ghi qua WITH CHECK company_id IS NULL), role_permissions (RLS qua JOIN roles), user_roles/object_permissions (company_id trực tiếp) — GIỮ. Test B chứng minh INSERT chéo FAIL.
- **#2 no hard-delete / append-only:** `permissions` SELECT-only cho app (catalog seed bằng migration). `role_permissions` KHÔNG có GRANT UPDATE (đổi effect = delete+insert) — KHÔNG nới. `AUTH.USER.DELETE` = soft-delete (set `deleted_at`/`status`).
- **#3 sensitive-no-wildcard:** quy tắc thu hẹp §3 — sensitive MỚI chỉ grant tường minh; ngoại lệ 0019/0140 hợp lệ.

## 6. Deviation giữ nguyên (KHÔNG churn — đã ship, có lý do)
- **`permission_code`/`data_scope` (DB-02) KHÔNG hiện thực** → DEFERRED; Scope ép ở service-layer (matrix-spec §1). Đổi = breaking engine đang chạy.
- **`is_sensitive=false` cho cặp `user`/`role` non-mutating đã seed ở 0005** — KHÔNG re-flag (đổi cờ = breaking can()-snapshot). Nếu siết, làm ở service-layer guard.
- **Resource cũ media/finance/content/channel/payslip** trong catalog 0005 = parked (de-media-fy) — KHÔNG xoá ở đợt này.

## 7. Verify (DB cô lập theo lane)
```
bash scripts/lane-db-setup.sh authdb1
export LANE_DB=mediaos_authdb1
pnpm --filter @mediaos/api db:migrate     # 0439 áp sạch, nối tiếp head 0438 (idx 122)
pnpm --filter @mediaos/api test -- auth-rbac-tenant-deny db-rls db-roles tenant-isolation permission-admin rls-coverage-assert rls-guards
pnpm --filter @mediaos/api typecheck
# idempotent từ DB đã có: chạy db:migrate lần 2 → 'no migrations to apply'; re-run INSERT 0439 thủ công → 0 rows
```
Đích: migrate sạch từ head 0438; catalog-count = đủ 14 guard AUTH + 3 sensitive mới đúng cờ; deny-path cross-tenant (SELECT 0 row, INSERT reject); wildcard-leak = 0; idempotent re-run = 0 row mới; 0019/0140 còn nguyên; rls-coverage/rls-guards/typecheck xanh.

## 8. Hazard đã xử lý (ghi cho plan-reviewer)
- **L1/L2 hazard:** phân rã trước có 2 lane db-migration cùng band, L2 (helper function) phụ thuộc L1 (seed) và là **NO-OP** vì seed là DML thuần (không cần function mới) → **L2 XOÁ, gộp 1 lane `S0-AUTH-DB-1` nối tiếp**. Một head, một lane — đúng bất biến migration đơn điệu.
- **Tiêu chí "khớp số dòng SPEC-02"** (không đo được do mismatch shape) → THAY bằng §2 danh sách cặp + catalog-count assert đếm bằng SQL.
- **Mâu thuẫn "sensitive KHÔNG seed cho system role"** vs 0019/0140 → thu hẹp thành "sensitive **MỚI ở migration này** không qua wildcard"; 0019/0140 = ngoại lệ hợp lệ liệt kê tường minh (§3).

## 9. Gate
**FULL** (diff chạm permission/RLS/seed/migration): `security-reviewer` + `rls-tenant-isolation-tester` (xác nhận cross-tenant deny + sensitive-no-wildcard) + `silent-failure-hunter`. **Người chốt vùng đỏ trước merge.**

## 10. Out-of-scope (KHÔNG làm ở WO này)
- AUTH service/guard (`can()` đọc `lock`/`unlock`/`assign`), endpoint lock/unlock/assign-permission → WO AUTH-API band sau.
- `data_scope`/`permission_code` hiện thực (nếu sau cần) → ADR riêng + migration đổi-shape có kế hoạch (KHÔNG ở đợt foundation).
- Seed module/settings → `S0-FND-SEED-1`. AuditService v2 + masker → `S1-FND-AUDIT-1`.
