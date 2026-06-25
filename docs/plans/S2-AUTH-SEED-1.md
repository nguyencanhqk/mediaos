```yaml
wo: S2-AUTH-SEED-1
zone: red
generated_by: human-reconcile (plan-reviewer BLOCK round 1 → §13 per-pair fix)
source_of_truth: IMPLEMENTATION-05 §13 (docs/IMPLEMENTATION/IMPLEMENTATION-05_Sprint_2_Auth_HR_Core_Execution_Plan.md:719-738)
lanes:
  - id: L1-SEED-MIG
    task: >
      Migration band idx 127 (file 0444_s2_authseed1_canonical_roles_perms.sql,
      _journal.json when=1717500620000 > head 0443=1717500610000) — ADDITIVE, KHÔNG db:generate.
      (a) INSERT catalog permission gaps §13 ON CONFLICT(action,resource_type) DO NOTHING:
      AUTH (view:me · view/create/lock:user · view:role · view:permission),
      HR (THÊM view-sensitive:employee is_sensitive=true · read:department · create:department ·
      create:profile-change-request · approve:profile-change-request; read/create/update/
      change-status/export:employee + read:position kiểm ON CONFLICT — đã có 1 phần mig 0005/0019).
      (b) INSERT 2 system role MỚI (company_id NULL, is_system=true) ON CONFLICT(name) DO NOTHING:
      manager · hr (id ổn định mới). TÁI DÙNG employee(…008)/company-admin(…001) đã có;
      KHÔNG gộp hr-manager(…009 media-era) vào hr. KHÔNG đụng role media 0005/0019/0430/0435.
      (c) Seed role_permissions THEO TỪNG CẶP (action,resource_type,role)=data_scope đúng BẢNG §13
      DƯỚI ĐÂY — KHÔNG phẳng theo role. effect=ALLOW.
      (d) Role ĐÃ tồn tại + cặp đã có ở scope SAI (vì UNIQUE(role_id,permission_id,effect) KHÔNG
      gồm data_scope ⇒ ON CONFLICT DO NOTHING KHÔNG sửa scope): DELETE đúng bộ
      (role_id,permission_id,effect) RỒI INSERT lại scope §13, BỌC 1 transaction.
      ⛔ CẤM blanket DELETE FROM role_permissions WHERE role_id=… (mất grant media/parked).
      (e) KHÔNG role-grant: reveal-secret:platform-account (break-glass ADR-0010),
      view-salary/update-salary:employee, finance/payroll (out-of-scope).
      Mọi INSERT mới ON CONFLICT(role_id,permission_id,effect) DO NOTHING (idempotent).
    builder: db-migration
    paths:
      - "apps/api/migrations/**"
      - "apps/api/src/db/schema/**"
  - id: L2-SUPERADMIN-BOOTSTRAP
    task: >
      SuperAdminBootstrapService (OnApplicationBootstrap, runtime — KHÔNG migration) theo
      env.schema §140-157: khi PLATFORM_SUPERADMIN_EMAIL set → trong withTenant(company theo
      PLATFORM_SUPERADMIN_COMPANY_SLUG, company PHẢI active+tồn tại):
      (1) tạo/sync role company-scoped tên 'super-admin' (company_id = company đó, is_system=false
      → RLS WITH CHECK cho ghi runtime, KHÔNG escape-hatch);
      (2) UPSERT user super-admin, password hash qua PasswordService.hash (argon2id — KHÔNG literal
      hash, KHÔNG log password/hash, BẤT BIẾN #3);
      (3) grant TOÀN BỘ catalog permission data_scope='System' (idempotent, tự phủ permission module
      mới mỗi boot) TRỪ reveal-secret:platform-account;
      (4) gán user_role idempotent (1 user + 1 user_role). VẮNG email → no-op.
      Wire vào PermissionModule providers (khối additive). Phát permission.changed sau grant.
    builder: backend-builder
    paths:
      - "apps/api/src/permission/**"
acceptanceChecks:
  - "Migration band idx 127 (0444_*, _journal.json when=1717500620000 > 1717500610000) THUẦN ADDITIVE — KHÔNG DROP/rewrite, KHÔNG db:generate; migrate 0000→head SẠCH trên DB cô lập; journal forward-only/no-gap/no-dup (db:check pass)."
  - "Role: employee(…008)/company-admin(…001) tái dùng; manager/hr = 2 row MỚI (company_id NULL, is_system=true, ON CONFLICT(name) DO NOTHING); KHÔNG sửa/xoá role media (project-manager/channel-manager/hr-manager …002..009)."
  - "data_scope PER-PAIR: với MỖI (action,resource_type,role) trong BẢNG §13, SELECT data_scope = đúng giá trị bảng. ĐẶC BIỆT view:me=Own VÀ create:profile-change-request=Own cho CẢ employee/manager/hr/company-admin (KHÔNG Company); read:employee manager=Team; read:department manager=Department, employee=Company; read:position employee/manager=Company. KHÔNG assert scope phẳng theo role."
  - "Catalog đủ cặp §13 gồm view-sensitive:employee (is_sensitive=true) + AUTH (view:me · view/create/lock:user · view:role · view:permission) + HR (read/create:department · create/approve:profile-change-request); cặp đã có KHÔNG nhân đôi (ON CONFLICT(action,resource_type))."
  - "Đổi scope role ĐÃ có = DELETE đúng (role_id,permission_id,effect) + INSERT lại trong 1 transaction (app role KHÔNG UPDATE — BẤT BIẾN #2). ⛔ KHÔNG blanket DELETE theo role_id. company-admin(…001): COUNT grant media/foundation parked (resource_type LIKE 'foundation-%'/channel/project/content/platform-account/workflow) BẰNG NHAU trước/sau."
  - "Idempotent ĐO BỘ BA (role_id,permission_id,data_scope): chạy migrate LẦN 2 từ DB-hiện-có → MỖI (role,pair,scope) BẤT BIẾN (KHÔNG chỉ COUNT — COUNT mù với scope drift). DB trống chạy 1 lần = cùng tập bộ-ba."
  - "VIEW_SENSITIVE (view-sensitive:employee, is_sensitive) ĐƯỢC role-grant §13 (employee=Own self/policy-gated · hr=Company · company-admin=Company; super-admin=System runtime; manager KHÔNG có). reveal-secret:platform-account + view-salary/update-salary:employee + finance/payroll KHÔNG có trong role_permissions của 4 role canonical (assert CHỈ trên role MỚI/canonical, KHÔNG quét grant media)."
  - "SuperAdminBootstrapService: PLATFORM_SUPERADMIN_EMAIL set → 1 user + 1 role company-scoped (company_id=slug, is_system=false) + grant full catalog data_scope='System' TRỪ reveal-secret:platform-account + 1 user_role; boot LẦN 2 KHÔNG nhân đôi; VẮNG email → no-op."
  - "BẤT BIẾN #3: password super-admin hash bằng PasswordService (argon2id) — grep KHÔNG literal hash; KHÔNG log password/hash; PLATFORM_SUPERADMIN_EMAIL set mà thiếu PASSWORD → env load fail-fast (env.schema superRefine)."
  - "BẤT BIẾN #1: role super-admin company-scoped ghi runtime qua RLS WITH CHECK (company_id=current); KHÔNG seed system-role company_id NULL ở migration cho super-admin; role_permissions/user_roles giữ RLS+FORCE; cross-tenant deny còn xanh (rls-tenant-isolation-tester PASS)."
  - "DoD §8: test RED-before-GREEN (deny/idempotent/scope-per-pair), build+typecheck apps/api xanh, cập nhật harness/backlog.mjs (status + plan pointer)."
testTasks:
  - "RED-before-GREEN (lane DB cô lập gated hasDb && LANE_DB): chain 0000→0443 → assert THIẾU cặp §13 (vd view:me) / scope SAI ⇒ ĐỎ; sau 0444 → GREEN. Lưu bằng chứng RED."
  - "Per-pair scope (chain 0000→0444): với MỖI hàng BẢNG §13, SELECT rp.data_scope JOIN roles JOIN permissions WHERE role.name + action+resource_type = đúng giá trị. Assert riêng view:me=Own ×4 role, create:profile-change-request=Own ×4 role, read:employee(manager=Team), read:department(manager=Department,employee=Company)."
  - "Deny/assert CHỈ role canonical: role_permissions JOIN roles WHERE name IN (employee/manager/hr/company-admin) → KHÔNG chứa reveal-secret:platform-account · view-salary:employee · update-salary:employee · finance · payslip. KHÔNG quét/đụng grant media cũ."
  - "Append-only/no-UPDATE: app role thử UPDATE role_permissions → DENIED; demo đổi scope = DELETE(role_id,permission_id,effect)+INSERT trong 1 transaction (BẤT BIẾN #2)."
  - "Idempotent bộ-ba: migrate LẦN 2 (DB-hiện-có) → snapshot (role_id,permission_id,data_scope) trước == sau (KHÔNG chỉ COUNT). company-admin media/foundation grants COUNT bằng nhau."
  - "SuperAdminBootstrap integration (LANE_DB, env PLATFORM_SUPERADMIN_* set, DB trống): boot → 1 user + 1 role company-scoped + grant full catalog trừ reveal-secret + 1 user_role; boot LẦN 2 → KHÔNG nhân đôi; super-admin can() ALLOW non-reveal, can(reveal-secret:platform-account, resourceId=null) → DENY (mirror permission.service.reveal.spec)."
  - "No-secret-log/fail-fast: grep service KHÔNG log password/hash; EMAIL set thiếu PASSWORD → env fail-fast."
  - "rls-tenant-isolation-tester PASS (role super-admin company-scoped không rò chéo tenant); coverage vùng nhạy cảm ≥80%."
steps:
  - "L1 TRƯỚC (db-migration nối tiếp): 0444_*.sql band idx 127 — DO-block/ON CONFLICT idempotent, KHÔNG db:generate; append _journal.json idx 127 (when 1717500620000). role_permissions đã ENABLE+FORCE từ mig 0005 → CHỈ INSERT/DELETE DATA, KHÔNG đụng policy/grant."
  - "L1: hiện thực BẢNG §13 DƯỚI ĐÂY THÀNH danh sách (action,resource_type,role,data_scope) tường minh trong SQL; chạy migrate 0000→0444 trên LANE DB (bash scripts/lane-db-setup.sh authseed1 → export LANE_DB=mediaos_authseed1) → verify per-pair; migrate LẦN 2 → idempotent bộ-ba."
  - "L1: RED test (scope-per-pair sai / cặp thiếu / append-only / assert CHỈ role canonical) TRƯỚC khi seed."
  - "L2 (sau L1 hội tụ data, backend-builder): SuperAdminBootstrapService + unit/integration RED-before-GREEN; tái dùng PasswordService.hash · withTenant · AuditService; wire PermissionModule additive."
  - "Gate FULL (zone=red): security-reviewer + database-reviewer + silent-failure-hunter + santa-method. Người chốt red-zone TRƯỚC merge. Build+typecheck apps/api xanh."
```

## §13 PERMISSION MATRIX → SEED (per-pair data_scope — nguồn: IMPLEMENTATION-05 §13)

> ⚠️ **data_scope LÀ PER-`(permission, role)` PAIR — KHÔNG phẳng theo role.** Đây là lỗi plan-reviewer BLOCK vòng 1.
> Enum chuẩn (mig 0441 CHECK): `Own · Team · Department · Company · System`. Cột "-" = KHÔNG grant.

| §13 code | `(action:resource_type)` | Employee | Manager | HR | Company-Admin | Super-Admin¹ |
|---|---|---|---|---|---|---|
| AUTH.ME.VIEW | `view:me` | **Own** | **Own** | **Own** | **Own** | System |
| AUTH.USER.VIEW | `view:user` | - | - | Company² | Company | System |
| AUTH.USER.CREATE | `create:user` | - | - | - | Company | System |
| AUTH.USER.LOCK | `lock:user` | - | - | - | Company | System |
| AUTH.ROLE.VIEW | `view:role` | - | - | - | Company | System |
| AUTH.PERMISSION.VIEW | `view:permission` | - | - | - | Company | System |
| HR.EMPLOYEE.VIEW | `read:employee` | Own | **Team** | Company | Company | System |
| HR.EMPLOYEE.VIEW_SENSITIVE | `view-sensitive:employee` (is_sensitive) | Own³ | - | Company | Company | System |
| HR.EMPLOYEE.CREATE | `create:employee` | - | - | Company | Company | System |
| HR.EMPLOYEE.UPDATE | `update:employee` | - | - | Company | Company | System |
| HR.EMPLOYEE.CHANGE_STATUS | `change-status:employee` | - | - | Company | Company | System |
| HR.EMPLOYEE.DELETE | `delete:employee` | - | - | -⁴ | Company | System |
| HR.EMPLOYEE.EXPORT | `export:employee` | - | - | Company | Company | System |
| HR.DEPARTMENT.VIEW | `read:department` | **Company**⁵ | **Department**⁶ | Company | Company | System |
| HR.DEPARTMENT.CREATE | `create:department` | - | - | Company | Company | System |
| HR.POSITION.VIEW | `read:position` | **Company**⁵ | **Company**⁵ | Company | Company | System |
| HR.PROFILE_CHANGE_REQUEST.CREATE | `create:profile-change-request` | **Own** | **Own** | **Own** | **Own** | System |
| HR.PROFILE_CHANGE_REQUEST.APPROVE | `approve:profile-change-request` | - | - | Company | Company | System |

**Ghi chú / normalization decisions (§13 prose → enum — flag cho reviewer/người):**

1. **Super-Admin** = KHÔNG seed ở migration. Cấp runtime bởi `SuperAdminBootstrapService` (full catalog `data_scope='System'` TRỪ `reveal-secret:platform-account`). Role company-scoped, `is_system=false`.
2. §13 ghi "Company nếu được cấp" cho HR.USER.VIEW → seed `hr` = `Company` (cấp mặc định cho role hr canonical).
3. §13 ghi "Own limited nếu policy cho phép" cho employee VIEW_SENSITIVE → seed `Own` (self only, policy-gated tại `can()` Tầng-4). Nếu owner muốn KHÔNG cấp mặc định → bỏ hàng employee này.
4. §13 ghi "- hoặc Company tùy policy" cho HR.EMPLOYEE.DELETE → **mặc định KHÔNG grant hr** (chỉ company-admin). Policy nâng sau.
5. §13 ghi "Company read basic" → enum `Company` (giới hạn "basic field" là field-mask tại `can()` Tầng-4, KHÔNG phải scope enum riêng).
6. §13 ghi "Team/Department" cho manager HR.DEPARTMENT.VIEW → enum `Department` (manager quản phòng ban của mình; Department ⊇ Team theo hierarchy Own<Team<Department<Company<System).

## CƠ CHẾ BẮT BUỘC (plan-reviewer vòng 1)

- **Scope KHÔNG sửa được bằng ON CONFLICT.** `role_permissions_uq = UNIQUE(role_id,permission_id,effect)` (mig 0005:78) KHÔNG gồm `data_scope`. Mọi `INSERT … ON CONFLICT(role_id,permission_id,effect) DO NOTHING` → bỏ qua row trùng, KHÔNG ghi đè scope. Vì vậy cặp ĐÃ tồn tại nhưng scope SAI (vd `view:me`/`create:profile-change-request` của role có sẵn đang ở `Company`) phải **`DELETE` đúng bộ `(role_id,permission_id,effect)` RỒI `INSERT` lại scope §13, BỌC trong 1 transaction.** ⛔ Cấm `DELETE FROM role_permissions WHERE role_id=…` (blanket — mất grant media/parked).
- **employee(…008)** đã có grant từ mig 0005/0019 mang `data_scope` DEFAULT `'Company'` (mig 0441:27). Các cặp cần ≠Company (`view:me`=Own, `read:employee`=Own, `create:profile-change-request`=Own) phải DELETE-theo-cặp + INSERT lại.
- **company-admin(…001):** hầu hết cặp = `Company` (đúng §13, additive INSERT). **NGOẠI LỆ** `view:me` + `create:profile-change-request` = `Own` → nếu đã có ở `Company` phải DELETE-theo-cặp + INSERT `Own`.
- **Idempotent đo BỘ BA** `(role_id, permission_id, data_scope)` trước/sau, KHÔNG chỉ `COUNT` (COUNT mù với scope drift vì `data_scope` ngoài UNIQUE key).
- **manager/hr** = 2 system role MỚI: `company_id NULL`, `is_system=true`, tên duy nhất toàn cục (`roles_system_name_active_uq` mig 0005:23), `ON CONFLICT(name) DO NOTHING`.

## BẤT BIẾN

1. **#1 Tenant:** `super-admin` company-scoped (`is_system=false`, ghi runtime qua RLS WITH CHECK) — KHÔNG seed `company_id NULL` ở migration cho super-admin. `role_permissions`/`user_roles` giữ RLS+FORCE.
2. **#2 Append-only:** `role_permissions` chỉ có `GRANT SELECT,INSERT,DELETE` (mig 0005:109) — đổi scope = DELETE+INSERT (KHÔNG UPDATE). `audit_logs`/`login_logs` append-only, migration này KHÔNG nới quyền.
3. **#3 No-secret-plaintext:** password hash qua `PasswordService.hash` (argon2id). KHÔNG literal hash, KHÔNG log. `env.schema superRefine` ép PASSWORD khi có EMAIL — fail-fast.

## OUT-OF-SCOPE WO này

- `reveal-secret:platform-account` / break-glass per-object grant (ADR-0010 — giữ deny)
- `view-salary` / `finance` / `payroll` (de-media-fy / Phase 2)
- `DataScopeResolver` tiêu thụ scope (S2-AUTH-BE-2) · `GET /auth/me` bootstrap (S2-AUTH-BE-1)
- `OperatorBootstrapService` (control-plane chéo tenant)

## VERIFY

LANE DB cô lập: `bash scripts/lane-db-setup.sh authseed1` → `export LANE_DB=mediaos_authseed1` → `pnpm --filter @mediaos/api test`. Integration gate `hasDb && LANE_DB` (tránh `.env` gây đỏ-giả — memory integration-test-LANE_DB-gate).

## MIGRATION

Band idx 127, file `0444_s2_authseed1_canonical_roles_perms.sql`, `_journal.json when=1717500620000 > 1717500610000` (idx 126, head `0443`). KHÔNG `db:generate` — DO-block thủ công mirror `0441`.
