```yaml
wo: S2-HR-SEED-1
zone: red
lane: git-worktree (agent db-migration) — SONG SONG với S2-AUTH-BE-1 (cây gốc)
source_of_truth:
  - IMPLEMENTATION-05 §9.2 (HR-S2-004) · §13 PERMISSION MATRIX
  - API-10 PERMISSION MATRIX §5.2 (HR catalog) + §6.2 (HR role grid)
  - DB-03 (HR Core) · 0442_s2_hrdb1_hr_core_reconcile.sql (schema THẬT)
migration:
  file: 0445_s2_hrseed1_hr_perms.sql
  journal_idx: 128
  when: 1717500630000   # > head 0444 idx 127 / 1717500620000 (forward-only, no-gap, no-dup)
  generate: false       # hand-authored SQL (mirror 0444/0441 DO-block) — KHÔNG db:generate
isolation_constraints:
  - "KHÔNG sửa file permission dùng chung (permission.service.ts/types.ts/module.ts/repository.ts/cache.ts/guards/**, require-permission.decorator.ts, *.spec.ts có sẵn)."
  - "Seed HR permission = THUẦN SQL migration (cách-ly hoàn toàn). KHÔNG động permission.service."
```

## 0. Bối cảnh & quyết định phạm vi (ĐỌC TRƯỚC)

WO yêu cầu 3 nhóm done_when. Sau khi đọc schema THẬT + pattern seed của repo, phân tách:

| Done_when | Phân loại | Quyết định |
|---|---|---|
| (1) seed `job_levels`/`contract_types`/`employee_code_config` + demo department/position idempotent | **company-scoped** (mọi bảng có `company_id NOT NULL`) | **KHÔNG seed ở migration** — xem §1 (blocker kỹ thuật + đường đúng) |
| (2) seed HR permissions + data_scope §13 | **global** (`permissions` no company_id + system role grants) | **LÀM ở migration 0445** — §2/§3 |
| (3) permission sensitive (salary/contract) KHÔNG auto-grant wildcard; verify đếm đúng | global | **LÀM + verify ở test** — §4 |

## 1. Master-data seed (done_when 1) — KHÔNG thuộc migration (blocker kỹ thuật, đường đúng)

**Sự thật kỹ thuật (không đoán — đọc từ schema + migrator):**

- `job_levels`, `contract_types`, `employee_code_configs` (mig 0442), `org_units` (mig 0006, = "department" trong model này), `positions` (mig 0017) **đều có `company_id NOT NULL`** với `DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
- **KHÔNG có company nào được seed ở migration** — `companies` là dữ liệu tenant tạo lúc runtime (mig 0002 không seed row). Toàn bộ migration foundation (mig 0435) CHỈ seed bảng **global** (`modules`/`permissions`/`system_settings` — không `company_id`).
- `src/db/migrate.ts` chạy migrator qua `DATABASE_DIRECT_URL` (role owner `mediaos`, KHÔNG set `app.current_company_id`). ⇒ INSERT vào bảng company-scoped sẽ lấy `company_id = NULL` ⇒ **vi phạm NOT NULL** (hoặc nếu hard-code 1 company-id giả → vi phạm FK + bịa tenant không tồn tại).

⇒ **Seed master-data company-scoped TRONG migration là SAI TẦNG** (vi phạm bất biến #1: company_id đúng tenant; và không có tenant để gắn).

**Đường ĐÚNG (đã có hạ tầng):** seed master-data per-company chạy **RUNTIME** qua `SeedTrackingService` (`src/foundation/seed/`, FOUNDATION-BE-8) + `withTenant(companyId)` — idempotent theo `(companyId, seedKey, seedVersion)` + `(batchId, targetTable, targetKey)`. Đây là việc của **HR backend lane** (tạo HR-master seeder service, wire vào onboarding/bootstrap) — **NẰM NGOÀI cách-ly của lane này** (đụng file backend/onboarding mà BE-1 có thể chạm) và **không biểu diễn được bằng migration**.

HR-S2-004 vốn ghi *"seed … demo department/position **nếu cần**"* + acceptance *"Seed idempotent, chạy lại không trùng"* — khung "demo/nếu cần" xác nhận đây là bootstrap runtime, không phải migration.

**KẾT LUẬN:** migration 0445 KHÔNG seed master-data. Đã FLAG cho orchestrator/human: done_when (1) chuyển sang HR backend runtime-seeder (WO/lane khác). Lane này hoàn thành done_when (2)+(3) — phần load-bearing mà BE-1/BE-2/BE-3 phụ thuộc.

## 2. HR permission catalog gaps (done_when 2) — cặp THÊM ở 0445

> 0444 (S2-AUTH-SEED-1) ĐÃ seed: `read/create/update/change-status/export:employee`, `view-sensitive:employee`, `read/create:department`, `read:position`, `create/approve:profile-change-request` + data_scope §13. **0445 chỉ THÊM phần CÒN THIẾU** so với matrix API-10 §5.2/§6.2 mà WO này yêu cầu (`HR.DEPARTMENT.*` full, `HR.POSITION.*` full, `HR.MASTER_DATA.MANAGE`, `HR.EMPLOYEE_CODE.PREVIEW`).

Catalog gaps (INSERT `ON CONFLICT(action,resource_type) DO NOTHING` — hot-file UNION):

| Permission §code | (action:resource_type) | is_sensitive | Ghi chú |
|---|---|---|---|
| HR.DEPARTMENT.UPDATE | `update:department` | false | đã có (mig 0005) → ON CONFLICT skip; chỉ cần grant |
| HR.DEPARTMENT.DELETE | `delete:department` | false | đã có (mig 0005) → ON CONFLICT skip; chỉ cần grant |
| HR.POSITION.CREATE | `create:position` | false | đã có (mig 0019) → skip; chỉ cần grant |
| HR.POSITION.UPDATE | `update:position` | false | đã có (mig 0019) → skip; chỉ cần grant |
| HR.POSITION.DELETE | `delete:position` | false | đã có (mig 0019) → skip; chỉ cần grant |
| HR.MASTER_DATA.MANAGE | `manage:master-data` | false | **MỚI** — resource ghép cho job_levels/contract_types |
| HR.EMPLOYEE_CODE.PREVIEW | `preview:employee-code` | false | **MỚI** — preview mã NV tiếp theo |

> Dùng `department` (KHÔNG `org_unit`) để NHẤT QUÁN với 0444 (canonical HR matrix dùng resource `department` cho 4 role canonical). `org_unit` perms (mig 0030) là namespace guard riêng của OrgController media-era, KHÔNG đụng.

## 3. Role → permission → data_scope (done_when 2) — per-pair §13/API-10

Roles canonical (đã seed 0444/0005): `employee`(…008) · `manager`(…010) · `hr`(…011) · `company-admin`(…001). Super-Admin = runtime (System scope, KHÔNG migration). `(✓)` trong API-10 §6.2 = grant mặc định cho role hr canonical (chuẩn hóa giống §13 note 2 của 0444: "Company nếu được cấp" → seed Company).

Danh sách cặp 0445 grant (effect=ALLOW), tất cả **Company** scope (đúng API-10 "Company/System" cho write/master-data — System chỉ super-admin runtime):

| role | (action:resource_type) | data_scope | Nguồn |
|---|---|---|---|
| hr | `update:department` | Company | API-10 §6.2 DEPARTMENT.*(write) HR(✓) |
| company-admin | `update:department` | Company | API-10 §6.2 CA |
| hr | `delete:department` | Company | API-10 §6.2 |
| company-admin | `delete:department` | Company | API-10 §6.2 |
| hr | `create:position` | Company | API-10 §6.2 POSITION.*(write) HR(✓) |
| company-admin | `create:position` | Company | API-10 §6.2 CA |
| hr | `update:position` | Company | API-10 §6.2 |
| company-admin | `update:position` | Company | API-10 §6.2 |
| hr | `delete:position` | Company | API-10 §6.2 |
| company-admin | `delete:position` | Company | API-10 §6.2 |
| hr | `manage:master-data` | Company | API-10 §6.2 MASTER_DATA.MANAGE HR(✓) |
| company-admin | `manage:master-data` | Company | API-10 §6.2 CA |
| hr | `preview:employee-code` | Company | API-10 §6.2 EMPLOYEE_CODE* HR(✓) |
| company-admin | `preview:employee-code` | Company | API-10 §6.2 CA |

> `manager`/`employee` KHÔNG có write/master-data/employee-code (API-10 §6.2 trống). `read:position`/`read:department` của họ ĐÃ seed ở 0444 — 0445 KHÔNG đụng.

**Cơ chế per-pair (mirror 0444):** DO-block FOREACH cặp → resolve role_id + permission_id → DELETE đúng `(role_id, permission_id, 'ALLOW')` có `data_scope <> target` (per-pair, KHÔNG blanket) → INSERT `ON CONFLICT(role_id,permission_id,effect) DO NOTHING`. Tất cả target ở đây = `Company` ⇒ DELETE-wrong-scope thực tế no-op (cặp mới), giữ idempotent. Bọc 1 transaction (drizzle migrator bọc mỗi file).

## 4. Sensitive NOT auto-granted (done_when 3)

- `view-salary:employee`/`update-salary:employee` (is_sensitive=true, mig 0019) + `reveal-secret:platform-account` (mig 0005) **KHÔNG có** trong 4 role canonical (assert chỉ trên role canonical, KHÔNG quét grant media `hr-manager`…009).
- 7 cặp mới của 0445 đều `is_sensitive=false` (master-data/department/position/employee-code là CRUD/admin thường, KHÔNG sensitive — mirror quyết định mig 0030). Verify đếm: 14 grant mới (7 cặp grant × 2 role nhưng 5 cặp đã có catalog) thêm sạch; sensitive count trong 4 role canonical = 0.

## 5. Idempotency (đo BỘ BA)

Re-migrate từ DB-hiện-có → mỗi `(role_id, permission_id, data_scope)` BẤT BIẾN (KHÔNG chỉ COUNT). DB trống chạy 1 lần = cùng tập bộ-ba. ON CONFLICT(action,resource_type) bảo vệ catalog; ON CONFLICT(role_id,permission_id,effect) bảo vệ grant; DELETE-wrong-scope per-pair KHÔNG khớp gì lần 2.

## 6. RLS/FORCE/append-only

Seed THUẦN ADDITIVE DATA (INSERT permissions + INSERT/DELETE role_permissions theo cặp). KHÔNG DDL, KHÔNG đụng RLS/FORCE/policy/grant. `role_permissions` append-only ở tầng grant (mig 0005: SELECT/INSERT/DELETE — KHÔNG UPDATE) GIỮ NGUYÊN — đổi scope = DELETE+INSERT.

## 7. Verify (RED→GREEN, DB cô lập)

```
bash scripts/lane-db-setup.sh hrseed --reset
export LANE_DB=mediaos_hrseed
pnpm --filter @mediaos/api exec vitest run test/integration/hr-seed-permissions.int-spec.ts --reporter=verbose
```
RED: chain 0000→0444 → cặp mới (vd `manage:master-data`, hr `update:position`) THIẾU ⇒ đỏ. GREEN: sau 0445 → pass. Gate `hasDb && LANE_DB`.

## 8. Đóng lane

`git add` chỉ file của lane → commit nhánh worktree. KHÔNG push/merge. Red migration → FULL gate (security-reviewer + database-reviewer) + người chốt RIÊNG.
