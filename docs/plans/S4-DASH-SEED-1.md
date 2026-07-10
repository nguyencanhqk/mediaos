# S4-DASH-SEED-1 — Seed widget catalog 7 In-sprint + permission DASH + default config (idempotent)

> Zone **red**. Gate **FULL**: `security-reviewer` + `database-reviewer` + `santa-method` (lane `dashCatalogConst`).
> **Bản v3 (2026-07-10)** — v1 và v2 đều bị `plan-reviewer` BLOCK. Đọc §0 trước khi làm bất cứ gì.
> **Lane chạy TUẦN TỰ, KHÔNG fan-out** (§3).

---

## 0. Lịch sử sửa — đừng lặp lại

### v1 → v2 (4 lỗi)

| v1 sai | Sự thật | v2 |
|---|---|---|
| `GRANT INSERT, DELETE` trên `dashboard_widget_configs` | `dashboard_widget_cache` (`0482:231-232`) cố ý không cấp DELETE, comment `KHÔNG DELETE (BẤT BIẾN #2 soft-delete)`; configs cũng có `deleted_at`; `master-data-seeder.types.ts:15` ghi *"Seeder CHỈ làm INSERT"* | **`GRANT INSERT`** duy nhất |
| Seeder ở `foundation/seed/`, "register ở `seed.module.ts`" | INVERSION OF DEPENDENCY (`master-data-seeder.types.ts:12-14`): foundation **không** import module nghiệp vụ. ATT để seeder trong `attendance/` + `att-seed.registrar.ts` tự register; `seed.module.ts` có **0** tham chiếu attendance | seeder + registrar vào `apps/api/src/dashboard/` |
| mig `0483` / idx 163 | `S4-NOTI-BE-1` (PR #133) đã mint đúng slot đó | **`0484`** / idx **164** |
| Bỏ sót `DASH.AUDIT_LOG.VIEW` | Có ở **cả** DB-07 §10.2 lẫn permission-matrix | seed thêm `view:dashboard-audit-log` |

### v2 → v3 (4 lỗi)

| v2 sai | Sự thật | v3 |
|---|---|---|
| Seed **8 cặp**, gồm `refresh:dashboard-cache` | **Spec-drift.** `DASH.CACHE.REFRESH` chỉ có ở SPEC-07 §8.2. Nhưng chính header SPEC-07 ghi: *"**DN-7** bổ sung `DASH.CACHE.REFRESH` vào ma trận quyền (§8.2) — **seed DB-07 §10.2/API-10 cần lane khác cập nhật** … Khi mâu thuẫn, **lấy DB-07/API-08 làm chuẩn**."* DB-07 §10.2 và `permission-matrix-spec` đều **không** có nó | **7 cặp.** `refresh:dashboard-cache` **OUT** — WO riêng, sau khi DB-07 §10.2 được cập nhật |
| Test `E1` chỉ deny `employee` + `manager` | Không test nào chứng minh **`hr`** thiếu 4 cặp admin-only. DO-block lỡ grant nhầm `hr` ⇒ **toàn bộ test vẫn xanh**. `E1` còn bỏ sót `refresh:dashboard-cache` khỏi tập bị-deny | Thay `E1`+`D` bằng **grant-matrix vét cạn** cho cả 4 role (§6) |
| `PROJECT_PROGRESS → read:project HOẶC read:task` | Bỏ ngỏ trên một WO crown pair-drift là mời gọi builder đoán | **Chốt cứng `read:project`** (`0005_permissions.sql:223`) |
| `lanes[]` trông như fan-out | `dashConfigSeeder` cần widgets + `GRANT INSERT` do `dashSeedMig` tạo; `dashSeedMig` sửa hot-file `meta/_journal.json` | **4 lane TUẦN TỰ**, ghi rõ ở §3 |

`seedVersion` dùng **`"v1"`** (`att-master-data.seeder.ts:30`), không phải `"1"`.

---

## 1. Mục tiêu & phạm vi

**IN** — 7 widget In-sprint vào `dashboard_widgets` GLOBAL; **7 cặp** quyền DASH + role→grant; default `dashboard_widget_configs` per-company qua code seeder; int-spec RED→GREEN.

**OUT** — `refresh:dashboard-cache` (chờ DB-07 §10.2 cập nhật); service resolve widget/data + endpoint config-update + cache invalidate (S4-DASH-BE-1/2); FE widget grid (S4-FE-DASH-1/2); widget Catalog-only; re-seed module DASH (đã active từ `0435`).

---

## 2. Sự thật đã xác minh

### 2.1 Schema `0482`
- `dashboard_widgets` (`:40-107`): NOT NULL khi seed = `widget_code`, `module_code`, `name`, `widget_type`, `required_permission_code`, `default_data_scope`, `data_source_key`, `component_key`. `company_id` NULLABLE (NULL = global). App `GRANT SELECT` (`:104`).
  - ON CONFLICT target: `uq_dashboard_widgets_global_code_active ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL` (`:93-95`).
- `dashboard_widget_configs` (`:110-174`): `company_id` NOT NULL DEFAULT GUC; `config_scope` CHECK `Company/Role/User`; CHECK `Company ⇒ role_id/user_id NULL`; có `deleted_at`/`deleted_by` (`:133-134`). App `GRANT SELECT` (`:171`).
  - **KHÔNG có unique index** ⇒ `ON CONFLICT` **vô hiệu**, bắt buộc `WHERE NOT EXISTS`.
- `dashboard_widget_cache` (`:231-232`): `GRANT SELECT, INSERT, UPDATE` — **cố ý no-DELETE**. Mẫu để noi theo.

### 2.2 Head migration
Sau khi PR #133 merge (`64d4787`), `meta/_journal.json` head = idx **163** / `when 1717500810000` / `0483_s4_notibe1_delete_own_grant` — **đã xác minh trên nhánh base**.
⇒ file **`0484_s4_dashseed1_widget_catalog_perms.sql`**, idx **164**, `when` **1717500815000**.

> Builder vẫn phải **đọc `_journal.json` THẬT** rồi mới đánh số. Đừng tin con số trong plan này.

### 2.3 Bảy widget In-sprint (NORMATIVE)

Nguồn: IMPLEMENTATION-07 §11.3; `required_permission_code` verbatim DB-07 §8.5; `component_key` §14.2.

| widget_code | module | source_modules | required_permission_code | default_data_scope¹ | widget_type² | P | dashboard | component_key | data_source_key |
|---|---|---|---|---|---|---|---|---|---|
| `ATTENDANCE_TODAY` | ATT | ATT, LEAVE, HR | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own | Summary | P0 | Employee | `AttendanceTodayWidget` | `attendance-today` |
| `MY_TASKS` | TASK | TASK | `DASH.WIDGET.VIEW_MY_TASKS` | Own | List | P0 | Employee, Manager | `MyTasksWidget` | `my-tasks` |
| `TASK_ALERTS` | TASK | TASK | `DASH.WIDGET.VIEW_TASK_ALERTS` | Own | Alert | P0 | Employee, Manager | `TaskAlertsWidget` | `task-alerts` |
| `NOTIFICATIONS` | NOTI | NOTI | `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own | List | P0 | All | `NotificationsWidget` | `notifications` |
| `PENDING_LEAVE` | LEAVE | LEAVE | `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team | List | P1 | Manager, HR | `PendingLeaveWidget` | `pending-leave` |
| `PROJECT_PROGRESS` | TASK | TASK | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project | Chart | P1 | Manager, HR/Admin | `ProjectProgressWidget` | `project-progress` |
| `HR_OVERVIEW` | HR | HR | `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company | Summary | P2 | HR/Admin | `HrOverviewWidget` | `hr-overview` |

¹ DB-07 §8.5 ghi dải (`Own/Team`…) nhưng cột là đơn-giá-trị → **lấy cận-dưới**; BE nới theo quyền user runtime.
² Doc không gán `widget_type` per-widget → chốt theo bảng trên.
`is_system_widget = true` cho cả 7. Widget Catalog-only (`LEAVE_BALANCE, LEAVE_CALENDAR, TEAM_TASKS_TODAY, NEW_EMPLOYEES, CONTRACT_EXPIRING, ATTENDANCE_ALERTS, CONFIG_WARNINGS`) **không seed**.

### 2.4 Quyền DASH — Option B, **7 cặp mới**

`permissions` chỉ có `(action, resource_type)` — không có cột `code`. Docs cho **SPEC code**, không cho engine-tuple.

**Option B (owner chốt):** `required_permission_code` lưu **chuỗi SPEC verbatim** `DASH.WIDGET.VIEW_*` (thoả DB-07 §8.5 — nó là dữ liệu catalog). **KHÔNG seed cặp per-widget** `*:dashboard-widget`. Gate widget = **cặp của module nguồn**, ánh xạ tĩnh trong `DASH_WIDGET_GATE_PAIR`. Căn cứ: `permission-matrix-spec` §7 — *"DASH chỉ hiển thị; module nguồn ép data scope"* — và nó là doc hợp nhất phân quyền (CLAUDE.md §1).

**7 cặp mới** (giữ nguyên `read:dashboard` từ mig `0100` — **không đụng**):

| SPEC code | Engine pair | is_sensitive |
|---|---|---|
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | `view-employee:dashboard` | false |
| `DASH.DASHBOARD.VIEW_MANAGER` | `view-manager:dashboard` | true |
| `DASH.DASHBOARD.VIEW_HR` | `view-hr:dashboard` | true |
| `DASH.DASHBOARD.VIEW_ADMIN` | `view-admin:dashboard` | true |
| `DASH.CONFIG.VIEW` | `view:dashboard-config` | true |
| `DASH.CONFIG.UPDATE` | `update:dashboard-config` | true |
| `DASH.AUDIT_LOG.VIEW` | `view:dashboard-audit-log` | true |

> **`refresh:dashboard-cache` KHÔNG seed ở WO này.** `DASH.CACHE.REFRESH` chỉ xuất hiện ở SPEC-07 §8.2, và header SPEC-07 tự ghi rằng đó là drift DN-7 chưa đồng bộ xuống seed (*"seed DB-07 §10.2/API-10 cần lane khác cập nhật"*), đồng thời chỉ định *"khi mâu thuẫn, lấy DB-07/API-08 làm chuẩn"*. DB-07 §10.2 và `permission-matrix-spec` đều không có nó. Seed nó bây giờ = tạo quyền phantom không có deny-path và làm doc trôi thêm. **Ghi vào bàn giao**: cần WO cập nhật DB-07 §10.2 trước khi seed cặp này.

### 2.5 `DASH_WIDGET_GATE_PAIR` — cặp module nguồn (đã xác minh tồn tại)

| widget_code | cặp engine gate | seed ở |
|---|---|---|
| `ATTENDANCE_TODAY` | `view-own:attendance` | `0454_s3_attseed1_att_perms.sql` |
| `MY_TASKS` · `TASK_ALERTS` | `read:task` | `0005_permissions.sql` |
| `NOTIFICATIONS` | `read:notification` | `0005_permissions.sql` |
| `PENDING_LEAVE` | `view:leave` | `0455_s3_leaveseed1_leave_perms.sql` |
| `PROJECT_PROGRESS` | **`read:project`** (chốt cứng, KHÔNG `read:task`) | `0005_permissions.sql:223` |
| `HR_OVERVIEW` | `read:employee` | `0019_g5_permissions_seed.sql` |

> ⚠ **Cạm bẫy:** nhiều module có **nhiều cặp cùng tồn tại** — ATT có cả `('read','attendance')` (`0063`) lẫn `('view-own','attendance')`; LEAVE có `read:leave`, `view:leave`, `view-own:leave`. Chọn nhầm một cặp **có thật nhưng sai ngữ nghĩa** thì test `E3` **vẫn xanh** vì nó chỉ assert "cặp tồn tại".
>
> ⇒ Mỗi entry trong `DASH_WIDGET_GATE_PAIR` phải kèm comment **trỏ `migration:dòng` + lý do ngữ nghĩa** (widget hiển thị dữ liệu của ai: Own hay Team/Company). Reviewer FULL gate đối chiếu bằng mắt — `E3` không thay được. Lane này bật `santa-method`.

### 2.6 Grant matrix (NORMATIVE — 4 role canonical)

**super-admin KHÔNG enumerate** (roles `company_id IS NULL` không có row đó → `RAISE`, mirror `0481:35-36`).

| pair | employee | manager | hr | company-admin |
|---|---|---|---|---|
| `view-employee:dashboard` | Own | Own | Own | Own |
| `view-manager:dashboard` | — | Team | — | Company |
| `view-hr:dashboard` | — | — | Company | Company |
| `view-admin:dashboard` | — | — | — | Company |
| `view:dashboard-config` | — | — | — | Company |
| `update:dashboard-config` | — | — | — | Company |
| `view:dashboard-audit-log` | — | — | — | Company |

**Tập admin-only** = `{view-admin:dashboard, view:dashboard-config, update:dashboard-config, view:dashboard-audit-log}` — `employee`, `manager`, `hr` phải **vắng mặt cả 4**.
`data_scope` là PER-(permission, role); đổi scope = **DELETE per-pair + INSERT** trên `role_permissions`.

### 2.7 Default config per dashboard type (NORMATIVE)

| dashboard_type | widget default (`is_enabled=true`, `config_scope='Company'`) |
|---|---|
| Employee | ATTENDANCE_TODAY · MY_TASKS · TASK_ALERTS · NOTIFICATIONS |
| Manager | MY_TASKS · TASK_ALERTS · NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| HR | NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| Admin | NOTIFICATIONS · PROJECT_PROGRESS |

`HR_OVERVIEW` (P2): có trong catalog, **không** default config.

### 2.8 Seeder convention (code thật)
- `attendance/att-master-data.seeder.ts:29-30` → `seedKey = "att.master-data"`, `seedVersion = "v1"`.
- `attendance/att-seed.registrar.ts` → `@Injectable() implements OnModuleInit`, ctor nhận `MasterDataSeederRegistry` + seeder, `onModuleInit() { this.registry.register(this.seeder) }`.
- `apps/api/src/dashboard/dashboard.module.ts` đã tồn tại.
- Runner chạy per-company ở `OnApplicationBootstrap`, cấp tenant tx; **seeder không tự mở/đóng batch**, chỉ INSERT + `track()`.

### 2.9 Vì sao config seed bằng CODE, không bằng migration
`dashboard_widget_configs.company_id` NOT NULL, mà company mặc định chỉ tồn tại **sau BOOT** (`ensure_default_company`, `0469` header `:6-9`) — tức **sau** migrate. Seed trong migration sẽ resolve 0 company.

---

## 3. Lanes — **TUẦN TỰ, KHÔNG PARALLEL**

`lanes[]` dưới đây là **chuỗi phụ thuộc**, không phải fan-out. Chạy song song sẽ cho **GREEN giả**: seeder chạy trước migration thì thiếu widgets + thiếu `GRANT INSERT`; hai lane cùng chạm `meta/_journal.json` thì mint trùng số.

| # | lane | builder | paths |
|---|---|---|---|
| 1 | `dashCatalogConst` | backend-builder | `apps/api/src/dashboard/dashboard-widget-catalog.const.ts` |
| 2 | `dashSeedMig` | db-migration | `apps/api/migrations/0484_*.sql`, `apps/api/migrations/meta/_journal.json` |
| 3 | `dashConfigSeeder` | backend-builder | `apps/api/src/dashboard/dashboard-config.seeder.ts`, `dash-seed.registrar.ts`, `dashboard.module.ts` |
| 4 | `dashSeedVerify` | qa-test-engineer | `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` |

---

## 4. Steps

1. **`dashboard-widget-catalog.const.ts`** — export `DASH_WIDGET_CATALOG` (7 entry §2.3), `DASH_WIDGET_COUNT = 7`, `DASH_PERMISSION_PAIRS` (**7** cặp §2.4 + `is_sensitive`), `DASH_WIDGET_GATE_PAIR` (§2.5, **mỗi entry có comment `migration:dòng` + lý do**), `DASH_GRANT_MATRIX` (§2.6), `DASH_ADMIN_ONLY_PAIRS` (§2.6), `DASH_DEFAULT_CONFIG` (§2.7), `DASH_CANONICAL_ROLES`. Kiểu union khớp CHECK `0482`.
2. **Migration `0484`** (đọc `_journal.json` thật trước):
   - (1) `INSERT INTO dashboard_widgets (company_id = NULL, …)` ×7 → `ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
   - (2) `INSERT INTO permissions (action, resource_type, is_sensitive)` **7 cặp** → `ON CONFLICT (action, resource_type) DO NOTHING`. **Không** đụng `read:dashboard`. **Không** seed `refresh:dashboard-cache` (§2.4) và **không** seed `*:dashboard-widget`.
   - (3) DO-block role grants §2.6: resolve role (`company_id IS NULL AND deleted_at IS NULL`) + permission → `RAISE EXCEPTION` nếu thiếu → **DELETE per-pair** `(role_id, permission_id, 'ALLOW')` scope sai → **INSERT** scope đúng → `ON CONFLICT (role_id, permission_id, effect) DO NOTHING`.
   - (4) **`GRANT INSERT ON dashboard_widget_configs TO mediaos_app;`** — chỉ INSERT.
   - Widgets GLOBAL + permissions ghi qua **migrator owner-bypass** (`DATABASE_DIRECT_URL`); không đụng RLS/FORCE/policy `0482`.
3. **`dashboard-config.seeder.ts`** trong `apps/api/src/dashboard/` — `ModuleMasterDataSeeder`, `seedKey = "dash.default-configs"`, `seedVersion = "v1"`. Với mỗi `(dashboard_type, widget_code) ∈ DASH_DEFAULT_CONFIG`: resolve `widget_id` từ `dashboard_widgets` GLOBAL → `INSERT ... SELECT ... WHERE NOT EXISTS (...)` + `track()`.
   > **Mệnh đề `NOT EXISTS` phải khoá trên `(company_id, widget_id, dashboard_type, config_scope, role_id IS NULL, user_id IS NULL)`.** Chỉ so `(company_id, widget_id)` sẽ chặn nhầm khi một widget xuất hiện ở nhiều `dashboard_type` (MY_TASKS có ở cả Employee lẫn Manager).
4. **`dash-seed.registrar.ts`** — mirror `att-seed.registrar.ts`. `DashboardModule` thêm `SeedModule` vào `imports` + 2 provider. **Không sửa `seed.module.ts`.**
5. **Int-spec** — import const registry, gate `hasDb && Boolean(process.env.LANE_DB)`.
6. Cập nhật `harness/backlog.mjs` (WO done, head idx 164).

---

## 5. acceptanceChecks

1. `_journal.json` có entry idx 164 / when 1717500815000 / tag `0484_s4_dashseed1_widget_catalog_perms`, nối tiếp `0483`.
2. `count(dashboard_widgets WHERE company_id IS NULL AND deleted_at IS NULL)` = **7**; tập `widget_code` khớp §2.3 (missing = [], extra = []).
3. Widget Catalog-only **không** tồn tại trong GLOBAL.
4. Mỗi widget: `required_permission_code` verbatim `DASH.WIDGET.VIEW_*`; `module_code`/`widget_type`/`default_data_scope` ∈ CHECK; `data_source_key`/`component_key` NOT NULL; `is_system_widget = true`.
5. **Đúng 7 cặp mới** §2.4, `is_sensitive` đúng (chỉ `view-employee:dashboard` = false). `read:dashboard` giữ nguyên non-sensitive.
6. **Không** cặp `*:dashboard-widget`. **Không** cặp `refresh:dashboard-cache`.
7. **Grant-matrix vét cạn** (§6 test `M`): với **từng** role trong `DASH_CANONICAL_ROLES`, tập `(action, resource_type, data_scope)` DASH bằng **đúng** §2.6 — không thừa, không thiếu.
8. `employee`, `manager`, `hr` **vắng mặt cả 4** cặp admin-only.
9. Mọi giá trị `DASH_WIDGET_GATE_PAIR` tồn tại thật trong `permissions`, và mỗi entry có comment `migration:dòng` + lý do. `PROJECT_PROGRESS` = `read:project`.
10. Mig `0484` chứa `GRANT INSERT ON dashboard_widget_configs TO mediaos_app`, **không** chứa `DELETE`/`UPDATE` trên bảng đó.
11. Default configs seed qua code seeder post-boot: mỗi dashboard_type khớp §2.7; `HR_OVERVIEW` vắng.
12. Seed lại 2–3 lần: count widgets/permissions/grants/configs không đổi; `data_scope` không drift; **không phát sinh row trùng khoá nghiệp vụ** `(company_id, widget_id, dashboard_type, config_scope)`.
13. `/auth/me` admin phơi cặp DASH non-sensitive; xác minh cách `getCapabilities` lọc `is_sensitive` **trước** khi khoá assert.
14. Cross-tenant: config company A không lộ ở context company B.
15. `seed.module.ts` không bị sửa; `foundation/` không import `dashboard/`.

---

## 6. testTasks — RED trước, deny-path đi đầu

File `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts`.
Gate cứng: `const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB); describe.skipIf(!runIsolatedDb)(...)` — `.env` làm `hasDb=true` nên `skipIf(!hasDb)` là **đỏ-giả**.
Chạy: `bash scripts/lane-db-setup.sh dashseed` → `export LANE_DB=mediaos_dashseed` → `pnpm --filter @mediaos/api test`.

- **M — grant-matrix vét cạn (deny + positive, ĐẦU TIÊN).** Thay cho `E1` + `D` của v2. Với **từng** role ∈ `{employee, manager, hr, company-admin}`:
  - assert tập `(action, resource_type, data_scope)` DASH của role **bằng đúng** §2.6;
  - assert role **vắng mặt** mọi cặp trong `DASH_ADMIN_ONLY_PAIRS` mà §2.6 không cấp cho nó.
  > `hr` là role trung-quyền dễ leo thang nhất; v2 không test nó nên một DO-block grant nhầm `hr` vẫn cho toàn bộ suite màu xanh.
- **E2 (deny)** không tồn tại cặp `*:dashboard-widget` nào, và không tồn tại `refresh:dashboard-cache`.
- **E3 (chống pair-drift)** mỗi giá trị `DASH_WIDGET_GATE_PAIR` resolve ra row `(action, resource_type)` THẬT.
  > Giới hạn đã biết: `E3` chỉ chứng **tồn tại**, không bắt được cặp có-thật-sai-ngữ-nghĩa. Guard còn lại là mắt reviewer + `santa-method`.
- **A** tập `widget_code` GLOBAL == `DASH_WIDGET_CATALOG`; từng trường khớp const.
- **A2** Catalog-only widgets vắng mặt.
- **C** đúng 7 cặp mới + `is_sensitive` đúng; `read:dashboard` không đổi; không cặp phantom.
- **G** default config mỗi dashboard_type khớp §2.7; `HR_OVERVIEW` vắng.
- **F (idempotent)** chạy lại DO-block 3× → grant count + `data_scope` không drift; `DashboardConfigSeeder.seed()` 2–3× → count configs không đổi **và** không có row trùng `(company_id, widget_id, dashboard_type, config_scope)`.
- **H** `/auth/me` admin chứa cặp DASH non-sensitive.
- **I (cross-tenant)** **PLANT company thứ 2** + 1 config row thật qua `directPool`, rồi assert nó vắng mặt dưới GUC company A. Ở N=1 chỉ có default company — không plant thì test **xanh-giả**.

---

## 7. Rủi ro

1. **Pair-drift.** Option B triệt rủi ro cho widget (FE mapping không đổi). Nhưng 4 cặp `view-*:dashboard` mới **vẫn cần** FE map nếu `S4-FE-DASH-2` gate theo chúng → bàn giao. `E3` + `santa-method` là lưới cho `DASH_WIDGET_GATE_PAIR`.
2. **Mô hình quyền kép.** Widget lưu `required_permission_code` (nhãn SPEC) nhưng enforcement đi qua `DASH_WIDGET_GATE_PAIR` (cặp module nguồn). Hai khái niệm song song rất dễ trôi ở `S4-DASH-BE`. **Bàn giao phải ghi rõ**: gate widget = `DASH_WIDGET_GATE_PAIR`, **không** phải `required_permission_code`.
3. **ON CONFLICT sai target.** configs không unique index ⇒ `ON CONFLICT` ném *"no unique or exclusion constraint matching"*. Dùng `WHERE NOT EXISTS` khoá đủ cột (§4 bước 3). **Không bịa unique index.**
4. **Lane chạy song song** ⇒ GREEN giả (§3).
5. **Migration band skip trên DB chung.** Verify phải chạy `LANE_DB` cô lập.
6. **Idempotency configs** không có ràng buộc DB mức row; hiện dựa `WHERE NOT EXISTS` + `uq(company_id, seed_key, seed_version)` mức batch của runner. Nếu logic batch đổi hoặc chạy đồng thời sẽ double-insert. Ghi rõ giả định.
7. **super-admin enumerate = RAISE.** Chỉ 4 role canonical.

---

## 8. Definition of Done

- Mig `0484` land: 7 widget GLOBAL + **7 cặp** + role grants §2.6 + **`GRANT INSERT`** (không DELETE/UPDATE); idempotent; owner-bypass; idx 164 nối tiếp `0483`.
- `dashboard-widget-catalog.const.ts` khớp 1-1 mig + seeder + test; `DASH_WIDGET_GATE_PAIR` có comment `migration:dòng` + lý do; `PROJECT_PROGRESS = read:project`.
- `DashboardConfigSeeder` + `DashSeedRegistrar` trong `apps/api/src/dashboard/`; `seed.module.ts` không đổi.
- Int-spec RED→GREEN, gate `hasDb && LANE_DB`; test `M` (grant-matrix vét cạn 4 role) đi đầu; cross-tenant có plant company thứ 2.
- **FULL gate** `security-reviewer` + `database-reviewer` (+ `santa-method` cho lane const) PASS.
- **Bàn giao:**
  1. gate widget = `DASH_WIDGET_GATE_PAIR`, không phải `required_permission_code` → `S4-DASH-BE-1/2`.
  2. 4 cặp `view-*:dashboard` cần map trong `packages/web-core` `PERMISSION_CODE_TO_PAIR` nếu FE gate theo chúng → `S4-FE-DASH-2`.
  3. `refresh:dashboard-cache` còn nợ: cập nhật DB-07 §10.2 rồi mới seed → WO riêng.
