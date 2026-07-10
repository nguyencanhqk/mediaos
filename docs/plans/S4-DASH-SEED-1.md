# S4-DASH-SEED-1 — Seed widget catalog 7 In-sprint + permission DASH + default config (idempotent)

> Zone **red**. Gate **FULL**: `security-reviewer` + `database-reviewer`.
> **Bản v2 (2026-07-09)** — v1 bị `plan-reviewer` BLOCK. Ba lỗi đã sửa, ghi ở §0. Đọc §0 trước.

---

## 0. Sửa gì so với v1 (đừng lặp lại)

| v1 sai | Sự thật | v2 làm |
|---|---|---|
| `GRANT INSERT, DELETE ON dashboard_widget_configs` | `dashboard_widget_cache` ở `0482:231-232` ghi rõ `-- KHÔNG DELETE (BẤT BIẾN #2 soft-delete)`; configs cũng có `deleted_at`. `master-data-seeder.types.ts:15-18`: *"Seeder CHỈ làm INSERT"*, *"KHÔNG hard-delete (#2)"*. Seeder chỉ `INSERT ... WHERE NOT EXISTS` → DELETE không bao giờ dùng | **`GRANT INSERT` duy nhất.** Rút config default sau này = soft-delete `UPDATE deleted_at`, thuộc S4-DASH-BE |
| Seeder đặt ở `foundation/seed/`, "register ở `seed.module.ts` mirror ATT/LEAVE" | Sai cả hai. `master-data-seeder.types.ts:12-14` **INVERSION OF DEPENDENCY**: *"foundation/runner KHÔNG import ATT/LEAVE"*. ATT để seeder trong module mình (`attendance/att-master-data.seeder.ts` + `att-seed.registrar.ts` tự `registry.register()` ở `onModuleInit`). `seed.module.ts` có **0** tham chiếu attendance | Seeder + registrar đặt trong **`apps/api/src/dashboard/`** (module đã tồn tại). **KHÔNG sửa `seed.module.ts`** |
| Migration `0483` / idx 163 / when 1717500810000 | `S4-NOTI-BE-1` đã mint đúng slot đó (`0483_s4_notibe1_delete_own_grant.sql`, PR #133) | **`0484`** / idx **164** / when **1717500815000**, xây trên `0483` |
| Bỏ sót `DASH.AUDIT_LOG.VIEW` | Có mặt ở **cả** DB-07 §10.2 (`:1653`) lẫn SPEC-07 | Seed thêm cặp `view:dashboard-audit-log` → tổng **8 cặp mới** |

`seedVersion` dùng **`"v1"`** (đúng convention `att-master-data.seeder.ts:30`), không phải `"1"`.

---

## 1. Mục tiêu & phạm vi

**IN** — seed 7 widget In-sprint vào `dashboard_widgets` GLOBAL; seed 8 cặp quyền DASH + role→grant; seed default `dashboard_widget_configs` per-company qua code seeder; int-spec RED→GREEN.

**OUT** — service resolve widget/data + endpoint config-update + cache invalidate (S4-DASH-BE-1/2); FE widget grid (S4-FE-DASH-1/2); widget Catalog-only. DASH module đã `active` từ mig 0435 → **không re-seed module**.

---

## 2. Sự thật đã xác minh

### 2.1 Schema `0482` (đã kiểm chứng độc lập)
- `dashboard_widgets` (`:40-107`): NOT NULL cần seed = `widget_code`, `module_code` (CHECK), `name`, `widget_type` (CHECK `Summary/List/Chart/Calendar/Action/Alert`), `required_permission_code`, `default_data_scope` (CHECK `Own/Team/Department/Project/Company/System`), `data_source_key`, `component_key`. `company_id` NULLABLE (NULL = catalog global). App role `GRANT SELECT` (`:104`).
  - ON CONFLICT target hợp lệ: `uq_dashboard_widgets_global_code_active ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL` (`:93-95`).
- `dashboard_widget_configs` (`:110-174`): `company_id` NOT NULL DEFAULT GUC; `config_scope` CHECK `Company/Role/User`; CHECK `Company ⇒ role_id/user_id NULL`; có `deleted_at`/`deleted_by` (`:133-134`). App role `GRANT SELECT` (`:171`).
  - **KHÔNG có unique index** — `grep UNIQUE 0482` chỉ trả 3 index: widgets ×2 + cache ×1. ⇒ `ON CONFLICT` **vô hiệu**, bắt buộc `WHERE NOT EXISTS`.
- `dashboard_widget_cache` (`:231-232`): `GRANT SELECT, INSERT, UPDATE` — **cố ý không DELETE**, comment `KHÔNG DELETE (BẤT BIẾN #2 soft-delete)`. Đây là mẫu để noi theo.

### 2.2 Head migration
`meta/_journal.json` trên `feat/s4-noti-dash-wave` sau khi PR #133 merge: head = idx **163** / `when 1717500810000` / `0483_s4_notibe1_delete_own_grant`.
⇒ file **`0484_s4_dashseed1_widget_catalog_perms.sql`**, idx **164**, when **1717500815000**.

> **Cổng thứ tự:** WO này **không được bắt đầu** khi PR #133 chưa merge vào base — nếu không sẽ lại mint trùng `0483`. Builder phải đọc `_journal.json` THẬT rồi mới đánh số, không tin con số trong plan này.

### 2.3 Bảy widget In-sprint (NORMATIVE)

Nguồn: IMPLEMENTATION-07 §11.3 (`:739-745`); `required_permission_code` verbatim DB-07 §8.5 (`:1112-1123`); `component_key` §14.2.

| widget_code | module | source_modules | required_permission_code | default_data_scope¹ | widget_type² | P | dashboard | component_key | data_source_key |
|---|---|---|---|---|---|---|---|---|---|
| `ATTENDANCE_TODAY` | ATT | ATT, LEAVE, HR | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own | Summary | P0 | Employee | `AttendanceTodayWidget` | `attendance-today` |
| `MY_TASKS` | TASK | TASK | `DASH.WIDGET.VIEW_MY_TASKS` | Own | List | P0 | Employee, Manager | `MyTasksWidget` | `my-tasks` |
| `TASK_ALERTS` | TASK | TASK | `DASH.WIDGET.VIEW_TASK_ALERTS` | Own | Alert | P0 | Employee, Manager | `TaskAlertsWidget` | `task-alerts` |
| `NOTIFICATIONS` | NOTI | NOTI | `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own | List | P0 | All | `NotificationsWidget` | `notifications` |
| `PENDING_LEAVE` | LEAVE | LEAVE | `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team | List | P1 | Manager, HR | `PendingLeaveWidget` | `pending-leave` |
| `PROJECT_PROGRESS` | TASK | TASK | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project | Chart | P1 | Manager, HR/Admin | `ProjectProgressWidget` | `project-progress` |
| `HR_OVERVIEW` | HR | HR | `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company | Summary | P2 | HR/Admin | `HrOverviewWidget` | `hr-overview` |

¹ DB-07 §8.5 ghi dải (`Own/Team`…) nhưng cột là đơn-giá-trị → **lấy cận-dưới** (an toàn nhất); BE nới theo quyền user runtime.
² Doc không gán `widget_type` per-widget → chốt theo bảng trên; đổi thì phải ghi lý do.
`is_system_widget = true` cho cả 7. Widget Catalog-only (`LEAVE_BALANCE, LEAVE_CALENDAR, TEAM_TASKS_TODAY, NEW_EMPLOYEES, CONTRACT_EXPIRING, ATTENDANCE_ALERTS, CONFIG_WARNINGS`) **không seed**.

### 2.4 Quyền DASH — OWNER CHỐT: **Option B**, **8 cặp mới**

`permissions` chỉ có `(action, resource_type)` — không có cột `code`. Docs cho **SPEC code**, không cho engine-tuple.

**Mâu thuẫn doc:** SPEC-07 §8.2 ngụ ý mỗi widget một quyền; `permission-matrix-spec.md` §7 (`:144`) nói *"DASH chỉ hiển thị; module nguồn ép data scope"*. → theo **permission-matrix** (doc hợp nhất phân quyền, CLAUDE.md §1).

- `dashboard_widgets.required_permission_code` **lưu chuỗi SPEC verbatim** `DASH.WIDGET.VIEW_*` (thoả DB-07 §8.5 — nó là dữ liệu catalog, không phải engine key).
- **KHÔNG seed cặp per-widget** `*:dashboard-widget`. Gate widget = **cặp read của module nguồn**, ánh xạ tĩnh trong `DASH_WIDGET_GATE_PAIR`.

> **Builder BẮT BUỘC** tra cặp thật bằng `grep -rn "INSERT INTO permissions" apps/api/migrations/` cho từng module (ATT/TASK/NOTI/LEAVE/HR). **KHÔNG suy từ tên.** Đây là chỗ pair-drift đã cắn 3 lần.
>
> ⚠ **Cạm bẫy nặng hơn "tên sai":** một module có thể có **nhiều cặp cùng tồn tại**. Đã xác minh: ATT có **cả** `('read','attendance')` (`0063_g11_permissions_seed.sql`) **lẫn** `('view-own','attendance')`; LEAVE có `read:leave`, `view:leave`, `view-own:leave`. Chọn nhầm một cặp **có thật nhưng sai ngữ nghĩa** thì test E3 (§6) **vẫn xanh** vì nó chỉ assert "cặp tồn tại".
>
> ⇒ Chọn cặp theo `docs/permission-matrix-spec.md` (widget hiển thị dữ liệu ai: Own hay Team/Company), rồi **ghi lý do chọn ngay trong `DASH_WIDGET_GATE_PAIR`** dưới dạng comment trỏ tới migration + dòng. Người review FULL gate phải đối chiếu chỗ này bằng mắt — E3 không thay được.

**8 cặp mới** (giữ nguyên `read:dashboard` từ mig 0100 — **không đụng**):

| SPEC code | Engine pair | is_sensitive |
|---|---|---|
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | `view-employee:dashboard` | false |
| `DASH.DASHBOARD.VIEW_MANAGER` | `view-manager:dashboard` | true |
| `DASH.DASHBOARD.VIEW_HR` | `view-hr:dashboard` | true |
| `DASH.DASHBOARD.VIEW_ADMIN` | `view-admin:dashboard` | true |
| `DASH.CONFIG.VIEW` | `view:dashboard-config` | true |
| `DASH.CONFIG.UPDATE` | `update:dashboard-config` | true |
| `DASH.CACHE.REFRESH` | `refresh:dashboard-cache` | true |
| `DASH.AUDIT_LOG.VIEW` | `view:dashboard-audit-log` | true |

> `DASH.CACHE.REFRESH` có trong SPEC-07 (không phải bịa). `DASH.AUDIT_LOG.VIEW` có ở **cả** DB-07 §10.2 (`:1653`) lẫn SPEC-07 — v1 bỏ sót, v2 seed.

**Role → grant.** Chỉ enumerate 4 role canonical `employee/manager/hr/company-admin`. **super-admin KHÔNG enumerate** (roles `company_id IS NULL` không có row → `RAISE`, mirror `0481:35-36`).

| pair | employee | manager | hr | company-admin |
|---|---|---|---|---|
| `view-employee:dashboard` | ✔ Own | ✔ Own | ✔ Own | ✔ Own |
| `view-manager:dashboard` | — | ✔ Team | — | ✔ Company |
| `view-hr:dashboard` | — | — | ✔ Company | ✔ Company |
| `view-admin:dashboard` | — | — | — | ✔ Company |
| `view:dashboard-config` · `update:dashboard-config` | — | — | — | ✔ Company |
| `refresh:dashboard-cache` | — | — | — | ✔ Company |
| `view:dashboard-audit-log` | — | — | — | ✔ Company |

`data_scope` là PER-(permission, role); đổi scope = **DELETE per-pair + INSERT** (trên `role_permissions`, không phải trên configs).

### 2.5 Default config per dashboard type (NORMATIVE)

| dashboard_type | widget default (`is_enabled=true`, `config_scope='Company'`) |
|---|---|
| Employee | ATTENDANCE_TODAY · MY_TASKS · TASK_ALERTS · NOTIFICATIONS |
| Manager | MY_TASKS · TASK_ALERTS · NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| HR | NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| Admin | NOTIFICATIONS · PROJECT_PROGRESS |

`HR_OVERVIEW` (P2): có trong catalog, **không** default config.

### 2.6 Seeder convention (đã đọc code thật)
- `apps/api/src/attendance/att-master-data.seeder.ts:29-30` → `seedKey = "att.master-data"`, `seedVersion = "v1"`.
- `apps/api/src/attendance/att-seed.registrar.ts` → `@Injectable() implements OnModuleInit`, ctor nhận `MasterDataSeederRegistry` + seeder, `onModuleInit() { this.registry.register(this.seeder) }`.
- `apps/api/src/dashboard/dashboard.module.ts` đã tồn tại (imports `PermissionModule`).
- Runner chạy per-company ở `OnApplicationBootstrap`, cấp tenant tx (`withTenant`), sở hữu vòng đời batch — **seeder không tự mở/đóng batch**.

### 2.7 Vì sao config seed bằng CODE, không bằng migration
`dashboard_widget_configs.company_id` NOT NULL, mà company mặc định chỉ tồn tại **sau BOOT** (`ensure_default_company`, mig 0469 header `:6-9`) — tức **sau** migrate. Seed trong migration sẽ resolve 0 company.

---

## 3. Lanes

| lane | task | builder | paths | depends_on |
|---|---|---|---|---|
| `dashCatalogConst` | const registry tĩnh (mốc chống drift dùng chung mig + seeder + test) | backend-builder | `apps/api/src/dashboard/dashboard-widget-catalog.const.ts` | — |
| `dashSeedMig` (NỐI TIẾP) | mig `0484`: widgets + 8 cặp + role grants + `GRANT INSERT` configs | db-migration | `apps/api/migrations/0484_*.sql`, `apps/api/migrations/meta/_journal.json` | PR #133 merged; dashCatalogConst |
| `dashConfigSeeder` | seeder + registrar trong module DASH | backend-builder | `apps/api/src/dashboard/dashboard-config.seeder.ts`, `dash-seed.registrar.ts`, `dashboard.module.ts` | dashSeedMig, dashCatalogConst |
| `dashSeedVerify` | int-spec RED→GREEN | qa-test-engineer | `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` | 3 lane trên |

---

## 4. Steps

1. **`dashboard-widget-catalog.const.ts`** — export `DASH_WIDGET_CATALOG` (7 entry §2.3), `DASH_WIDGET_COUNT = 7`, `DASH_PERMISSION_PAIRS` (8 cặp §2.4 + `is_sensitive`), `DASH_WIDGET_GATE_PAIR` (widget_code → cặp module nguồn, **tra từ migration seed thật**), `DASH_DEFAULT_CONFIG` (§2.5), `DASH_CANONICAL_ROLES`. Kiểu union khớp CHECK 0482.
2. **Migration `0484`** (đọc `_journal.json` thật trước để xác nhận head = 0483):
   - (1) `INSERT INTO dashboard_widgets (company_id = NULL, …)` ×7 → `ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
   - (2) `INSERT INTO permissions (action, resource_type, is_sensitive)` 8 cặp → `ON CONFLICT (action, resource_type) DO NOTHING`. **Không** đụng `read:dashboard`.
   - (3) DO-block role grants: resolve role (`company_id IS NULL AND deleted_at IS NULL`) + permission → `RAISE EXCEPTION` nếu thiếu → **DELETE per-pair** `(role_id, permission_id, 'ALLOW')` scope sai → **INSERT** scope §2.4 → `ON CONFLICT (role_id, permission_id, effect) DO NOTHING`.
   - (4) **`GRANT INSERT ON dashboard_widget_configs TO mediaos_app;`** — chỉ INSERT. Không DELETE, không UPDATE (UPDATE để dành S4-DASH-BE cho soft-delete).
   - Widgets GLOBAL + permissions ghi qua **migrator owner-bypass** (`DATABASE_DIRECT_URL`); không đụng RLS/FORCE/policy của 0482.
3. **`dashboard-config.seeder.ts`** trong `apps/api/src/dashboard/` — implement `ModuleMasterDataSeeder`, `seedKey = "dash.default-configs"`, `seedVersion = "v1"`. Với mỗi `(dashboard_type, widget_code) ∈ DASH_DEFAULT_CONFIG`: resolve `widget_id` từ `dashboard_widgets` GLOBAL → `INSERT INTO dashboard_widget_configs (...) SELECT ... WHERE NOT EXISTS (...)` + `track()`. Chỉ INSERT, trong tenant tx do runner cấp.
4. **`dash-seed.registrar.ts`** — mirror `att-seed.registrar.ts`. `DashboardModule` thêm `SeedModule` vào `imports` + 2 provider. **Không sửa `seed.module.ts`.**
5. **Int-spec** `dash-seed-catalog-permissions.int-spec.ts` — import const registry, gate `hasDb && Boolean(process.env.LANE_DB)`.
6. Cập nhật `harness/backlog.mjs` (WO done, head idx 164).

---

## 5. acceptanceChecks

1. `_journal.json` có entry idx 164 / when 1717500815000 / tag `0484_s4_dashseed1_widget_catalog_perms`, nối tiếp `0483`.
2. `SELECT count(*) FROM dashboard_widgets WHERE company_id IS NULL AND deleted_at IS NULL` = **7**; tập `widget_code` khớp đúng §2.3 (missing = [], extra = []).
3. Widget Catalog-only **không** tồn tại trong GLOBAL.
4. Mỗi widget: `required_permission_code` verbatim `DASH.WIDGET.VIEW_*`; `module_code`/`widget_type`/`default_data_scope` ∈ CHECK; `data_source_key`/`component_key` NOT NULL; `is_system_widget = true`.
5. **Đúng 8 cặp mới** §2.4 tồn tại với `is_sensitive` đúng (chỉ `view-employee:dashboard` = false). `read:dashboard` (0100) giữ nguyên non-sensitive.
6. **Không** cặp `*:dashboard-widget` nào trong `permissions` (invariant Option B).
7. **Mọi giá trị trong `DASH_WIDGET_GATE_PAIR` tồn tại thật** trong bảng `permissions` — chống silent-403 ở S4-DASH-BE.
8. `company-admin` có `view-admin:dashboard` + `view/update:dashboard-config` + `refresh:dashboard-cache` + `view:dashboard-audit-log` @Company. `employee` **không** có bất kỳ cái nào.
9. Mig `0484` chứa `GRANT INSERT ON dashboard_widget_configs TO mediaos_app` và **không** chứa `DELETE`/`UPDATE` trên bảng đó.
10. Default configs seed qua code seeder post-boot: mỗi dashboard_type khớp §2.5, `config_scope='Company'`, `role_id`/`user_id` NULL; `HR_OVERVIEW` vắng.
11. Seed lại (mig block + seeder) 2–3 lần: count widgets/permissions/grants/configs không đổi; `data_scope` không drift.
12. `/auth/me` của admin phơi cặp DASH non-sensitive; xác minh cách `getCapabilities` lọc `is_sensitive` **trước** khi khoá assert.
13. Cross-tenant: config company A không lộ ở context company B.
14. `seed.module.ts` **không** bị sửa; `foundation/` **không** import `dashboard/`.

---

## 6. testTasks — RED trước, deny-path đi đầu

File `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts`.
Gate cứng: `const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB); describe.skipIf(!runIsolatedDb)(...)` — `.env` làm `hasDb=true`, nên `skipIf(!hasDb)` là **đỏ-giả**.
Chạy: `bash scripts/lane-db-setup.sh dashseed` → `export LANE_DB=mediaos_dashseed` → `pnpm --filter @mediaos/api test`.

- **E1 (deny, đầu tiên)** `employee` + `manager` có 0 grant `*:dashboard-config`, không `view-admin:dashboard`, không `view-hr:dashboard`, không `view:dashboard-audit-log`.
- **E2 (deny)** không tồn tại cặp `*:dashboard-widget` nào.
- **E3 (chống pair-drift)** mỗi giá trị `DASH_WIDGET_GATE_PAIR` phải resolve ra một row `(action, resource_type)` THẬT trong `permissions`. Sai tên → RED **tại đây**, không âm thầm 403 ở DASH-BE.
- **A** tập `widget_code` GLOBAL == `DASH_WIDGET_CATALOG`; từng trường khớp const.
- **A2** Catalog-only widgets vắng mặt.
- **C** đúng 8 cặp mới + `is_sensitive` đúng; `read:dashboard` không đổi; không cặp phantom.
- **D (positive)** `company-admin` đủ 8 cặp @scope §2.4; `view-employee:dashboard` cấp cho cả 4 role @Own.
- **G** default config mỗi dashboard_type khớp §2.5; `HR_OVERVIEW` vắng.
- **F (idempotent)** chạy lại DO-block 3× → grant count + `data_scope` không drift; `DashboardConfigSeeder.seed()` 2× → count configs không đổi.
- **H** `/auth/me` admin chứa cặp DASH non-sensitive.
- **I (cross-tenant)** **PLANT company thứ 2** + 1 config row thật qua `directPool`, rồi assert nó vắng mặt dưới GUC company A. Ở N=1 chỉ có default company — không plant thì test **xanh-giả**, không chứng minh được RLS.

---

## 7. Rủi ro

1. **Pair-drift.** Option B triệt rủi ro cho widget (FE mapping không đổi). Nhưng 4 cặp `view-*:dashboard` mới **vẫn cần** FE map nếu `S4-FE-DASH-2` (DashboardTypeSwitcher) gate theo chúng → ghi vào bàn giao. E3 là lưới an toàn cho `DASH_WIDGET_GATE_PAIR`.
2. **ON CONFLICT sai target.** configs không unique index ⇒ `ON CONFLICT` ném *"no unique or exclusion constraint matching"*. Dùng `WHERE NOT EXISTS`. **Không bịa unique index** (sửa DDL 0482 = rewrite, cấm).
3. **Số migration.** Không bắt đầu khi PR #133 chưa merge; luôn đọc `_journal.json` thật.
4. **Migration band skip trên DB chung.** Verify phải chạy `LANE_DB` cô lập.
5. **Idempotency configs** dựa `WHERE NOT EXISTS` + `uq(company_id, seed_key, seed_version)` mức batch của runner. Không có ràng buộc DB chống trùng ở mức row — nếu logic batch đổi hoặc chạy đồng thời sẽ double-insert. Ghi rõ giả định; giữ `track()` + `seedVersion` đúng convention.
6. **super-admin enumerate = RAISE.** Chỉ 4 role canonical.

---

## 8. Definition of Done

- Mig `0484` land: 7 widget GLOBAL + 8 cặp + role grants + **`GRANT INSERT`** (không DELETE) configs; idempotent; owner-bypass; idx 164 nối tiếp 0483.
- `dashboard-widget-catalog.const.ts` khớp 1-1 mig + seeder + int-spec; `DASH_WIDGET_GATE_PAIR` tra từ migration seed thật và **được E3 khoá**.
- `DashboardConfigSeeder` + `DashSeedRegistrar` trong `apps/api/src/dashboard/`; `seed.module.ts` không đổi.
- Int-spec RED→GREEN, gate `hasDb && LANE_DB`, deny-path trước, cross-tenant có plant company thứ 2.
- **FULL gate** `security-reviewer` + `database-reviewer` PASS.
- Bàn giao: 4 cặp `view-*:dashboard` → `S4-FE-DASH-2` cần map trong `PERMISSION_CODE_TO_PAIR` nếu gate theo chúng.
