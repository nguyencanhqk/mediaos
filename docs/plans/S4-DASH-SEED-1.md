# S4-DASH-SEED-1 — Seed widget catalog 7 In-sprint (§11.3) + permission DASH + default config theo dashboard type (idempotent)

> Zone **red** (seed permission engine + migration nối tiếp). Gate **FULL**: `security-reviewer` + `database-reviewer` (+ `silent-failure-hunter`).
> Nguồn sự thật: IMPLEMENTATION-07 §8.4/§11.3 · DB-07 §8.1/§8.2/§8.5 · SPEC-07 §8.2/§11.2 · `docs/permission-matrix-spec.md` §7.
> **2 quyết định crown đã được OWNER CHỐT 2026-07-09** (§2.4, §5.4) — builder KHÔNG tự đổi.

## 1. Mục tiêu & phạm vi (in/out)

**IN**
- Seed **danh mục 7 widget In-sprint** (§11.3) vào `dashboard_widgets` GLOBAL (`company_id NULL`), khớp đúng tập §8.4/§11.3 — không thừa/thiếu. Widget Catalog-only KHÔNG seed.
- Seed **catalog quyền DASH** cho 3 nhóm: *view dashboard type · config · cache refresh* + **role→grant mapping** theo permission-matrix §7. **KHÔNG seed cặp per-widget** (xem §2.4 — OWNER CHỐT Option B).
- Seed **default `dashboard_widget_configs`** theo dashboard type (Employee/Manager/HR/Admin), **chỉ widget In-sprint P0/P1** (HR_OVERVIEW = P2 → loại khỏi default config).
- Idempotent: catalog `ON CONFLICT DO NOTHING`; đổi data_scope trên grant đã tồn tại → **DELETE (per-pair, wrong-scope) + INSERT** (mirror 0480/0481). Config defaults idempotent qua `WHERE NOT EXISTS`.
- Int-spec RED→GREEN (catalog match · grant positive/deny · idempotent · `/auth/me` · cross-tenant).

**OUT (chống scope-creep)**
- Service resolve widget/data, endpoint config-update, cache warmup/invalidate → **S4-DASH-BE-1/2**.
- FE widget grid / gating component → **S4-FE-DASH-1/2**.
- DASH module đã `active` trong module catalog từ mig 0435 (`0435_foundation_db5_retention_seed_modules.sql:293`) → **KHÔNG re-seed module**.

---

## 2. Sự thật đã xác minh (đường dẫn:dòng — đã kiểm chứng độc lập)

### 2.1 Bảng + cột THẬT của mig 0482 (`apps/api/migrations/0482_s4_dashdb1_dashboard_core.sql`)

**`dashboard_widgets`** (dòng 40–107) — cột NOT NULL bắt buộc khi seed:
`widget_code` · `module_code` (CHECK `IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')` :71–72) · `name` · `widget_type` (CHECK `Summary/List/Chart/Calendar/Action/Alert` :73–74) · `required_permission_code` · `default_data_scope` (CHECK `Own/Team/Department/Project/Company/System` :75–76) · `data_source_key` · `component_key`.
Default sẵn: `is_cacheable=true` (:55), `status='Active'` (:77–78), `is_system_widget=false` (:62), `sort_order=0` (:63). `company_id` **NULLABLE** (:44 — NULL = catalog global).
- **ON CONFLICT target hợp lệ (widgets)** = partial unique index `uq_dashboard_widgets_global_code_active ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL` (:93–95).
- RLS nullable-tenant policy (:84–91): `USING (company_id=GUC OR IS NULL)`, `WITH CHECK (company_id=GUC)`. App role `GRANT SELECT` only (:104) ⇒ seed GLOBAL chỉ ghi được qua **migrator owner-bypass**.

**`dashboard_widget_configs`** (dòng 110–174):
`company_id` **NOT NULL** DEFAULT GUC (:112–113) · `widget_id` FK→widgets (:115) · `dashboard_type` (CHECK `Employee/Manager/HR/Admin/System/Project` :135–136) · `role_id`/`user_id` · `config_scope` (CHECK `Company/Role/User` :137–138) · `is_enabled=true` (:120) · `sort_order` · layout_* · `data_scope_override` · `config jsonb`.
- CHECK `chk_dashboard_widget_configs_role_user_scope` (:145–150): **Company ⇒ role_id/user_id NULL**.
- ⚠️ **KHÔNG có UNIQUE INDEX** — mọi index configs (:159–168) đều non-unique (kiểm chứng: `grep UNIQUE 0482` chỉ ra 3 index, đều thuộc `dashboard_widgets` ×2 + `dashboard_widget_cache` ×1). ⇒ `ON CONFLICT` **KHÔNG có target hợp lệ** cho configs ⇒ idempotency configs phải dùng **`WHERE NOT EXISTS`**. **KHÔNG bịa constraint để ON CONFLICT.**
- App role `GRANT SELECT` only (:171) → xem §5.4.

**`dashboard_widget_cache`** (:177–241): KHÔNG chạm ở WO này.

### 2.2 Head migration thật → tên file mới

`apps/api/migrations/meta/_journal.json`: head = **idx 162, tag `0482_s4_dashdb1_dashboard_core`, when `1717500805000`**.
⇒ Migration mới: **idx 163 · when `1717500810000`** (= +5000) · file **`apps/api/migrations/0483_s4_dashseed1_widget_catalog_perms.sql`**.

### 2.3 7 widget In-sprint (§11.3) — bảng NORMATIVE cho seed

Nguồn: IMPLEMENTATION-07 §11.3 (`:739–745`) cho Dashboard/Nguồn/Ưu-tiên; DB-07 §8.5 (`:1112–1123`) cho `required_permission_code`; §14.2 (`:927–933`) cho `component_key`.

| widget_code | module_code | source_modules | required_permission_code | default_data_scope¹ | widget_type | P | dashboard(s) | component_key | data_source_key |
|---|---|---|---|---|---|---|---|---|---|
| `ATTENDANCE_TODAY` | ATT | ATT, LEAVE, HR | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own | Summary | P0 | Employee | `AttendanceTodayWidget` | `attendance-today` |
| `MY_TASKS` | TASK | TASK | `DASH.WIDGET.VIEW_MY_TASKS` | Own | List | P0 | Employee, Manager | `MyTasksWidget` | `my-tasks` |
| `TASK_ALERTS` | TASK | TASK | `DASH.WIDGET.VIEW_TASK_ALERTS` | Own | Alert | P0 | Employee, Manager | `TaskAlertsWidget` | `task-alerts` |
| `NOTIFICATIONS` | NOTI | NOTI | `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own | List | P0 | All | `NotificationsWidget` | `notifications` |
| `PENDING_LEAVE` | LEAVE | LEAVE | `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team | List | P1 | Manager, HR | `PendingLeaveWidget` | `pending-leave` |
| `PROJECT_PROGRESS` | TASK | TASK | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project | Chart | P1 | Manager, HR/Admin | `ProjectProgressWidget` | `project-progress` |
| `HR_OVERVIEW` | HR | HR | `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company | Summary | P2 | HR/Admin | `HrOverviewWidget` | `hr-overview` |

¹ `default_data_scope` là cột đơn-giá-trị (CHECK). DB-07 §8.5 ghi dải (`Own/Team`, `Team/Company`, `Project/Company`) → **CHỐT: lấy cận-dưới (an toàn nhất)** — BE nới scope theo quyền user runtime (§11.4). Không cần hỏi lại.

- `widget_type` không được doc gán tường minh per-widget → **CHỐT theo bảng trên** (bản chất hiển thị); builder chỉ đổi nếu SPEC-07 §13 UI quy định khác **và ghi lý do**.
- `widget_code` UPPER_SNAKE, KHÔNG prefix `DASH_WIDGET_` (DB-07 §8.1 :1035). `is_system_widget=true` cho cả 7.
- 7 widget Catalog-only (`LEAVE_BALANCE, LEAVE_CALENDAR, TEAM_TASKS_TODAY, NEW_EMPLOYEES, CONTRACT_EXPIRING, ATTENDANCE_ALERTS, CONFIG_WARNINGS` §11.3 :746–752) **KHÔNG seed**.

### 2.4 Cặp (action, resource_type) DASH — ✅ OWNER CHỐT 2026-07-09: **Option B**

**Sự thật:** bảng `permissions` chỉ có `(action, resource_type)` — không có cột `code` (`registry.ts:105`). Docs cho **SPEC code** `DASH.RESOURCE.ACTION`, **KHÔNG** cho engine-tuple. Engine hiện chỉ có **1 cặp DASH**: `read:dashboard`, grant MỌI role (`0100_g14_dashboard_permissions_seed.sql:7,12` — đã kiểm chứng). FE `PERMISSION_CODE_TO_PAIR` chỉ map `"DASH.DASHBOARD.VIEW": "read:dashboard"` (`registry.ts:117`).

**Mâu thuẫn doc:** SPEC-07 §8.2 ngụ ý mỗi widget một quyền riêng (`DASH.WIDGET.VIEW_*`); `permission-matrix-spec.md` §7 (`:144`) nói *"DASH chỉ hiển thị; module nguồn ép data scope"*.

**QUYẾT ĐỊNH (owner):** theo **permission-matrix** — nó là *doc hợp nhất về phân quyền* (CLAUDE.md §1). Cụ thể:

- ✅ `dashboard_widgets.required_permission_code` **lưu chuỗi SPEC verbatim** `DASH.WIDGET.VIEW_*` (thoả DB-07 §8.5 — cột là dữ liệu catalog, không phải engine key).
- ❌ **KHÔNG seed 7 cặp engine per-widget.** Gate hiển thị widget = **cặp quyền của module nguồn**, BE resolve `required_permission_code` → cặp qua bảng ánh xạ TĨNH trong const registry:

| widget_code | cặp engine dùng để gate (module nguồn) |
|---|---|
| `ATTENDANCE_TODAY` | cặp read của ATT (theo seed ATT thật — builder tra, KHÔNG đoán) |
| `MY_TASKS` · `TASK_ALERTS` · `PROJECT_PROGRESS` | cặp read của TASK |
| `NOTIFICATIONS` | cặp read của NOTI (đã seed 0481 §4a/4b) |
| `PENDING_LEAVE` | cặp read của LEAVE |
| `HR_OVERVIEW` | cặp read của HR |

  > **Builder BẮT BUỘC** tra cặp thật trong migration seed của từng module (`grep "INSERT INTO permissions" apps/api/migrations/`), **KHÔNG** suy từ tên. Đây chính là chỗ pair-drift đã cắn 3 lần (S1-FND-MODULE · S3-FE · S4-TASK-RECON).
- ✅ **Hệ quả:** `packages/web-core` `PERMISSION_CODE_TO_PAIR` **KHÔNG cần đổi** cho widget ⇒ WO này KHÔNG kéo theo follow-up FE mapping. Đây là lý do chính chọn Option B.

**Cặp DASH VẪN seed** (không phải per-widget):

| SPEC code (DB-07 §8.6) | Engine pair | is_sensitive | nhóm done_when |
|---|---|---|---|
| `DASH.DASHBOARD.VIEW` | `read:dashboard` — **ĐÃ CÓ 0100, KHÔNG đụng** | false | (base) |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | `view-employee:dashboard` | false | view dashboard type |
| `DASH.DASHBOARD.VIEW_MANAGER` | `view-manager:dashboard` | true | view dashboard type |
| `DASH.DASHBOARD.VIEW_HR` | `view-hr:dashboard` | true | view dashboard type |
| `DASH.DASHBOARD.VIEW_ADMIN` | `view-admin:dashboard` | true | view dashboard type |
| `DASH.CONFIG.VIEW` | `view:dashboard-config` | true | config |
| `DASH.CONFIG.UPDATE` | `update:dashboard-config` | true | config |
| `DASH.CACHE.REFRESH` | `refresh:dashboard-cache` | true | cache refresh |

Convention hyphen-resource mirror NOTI (`0481:278–285`).

**Role → grant matrix** (permission-matrix §7 `:148–159`). Canonical roles enumerate: `employee, manager, hr, company-admin` — **super-admin KHÔNG enumerate** (nhận qua `SuperAdminBootstrap` runtime; roles `company_id IS NULL` không có row 'super-admin' → enumerate sẽ `RAISE`, mirror `0481:35–36`).

| pair | employee | manager | hr | company-admin |
|---|---|---|---|---|
| `view-employee:dashboard` | ✔ Own | ✔ Own | ✔ Own | ✔ Own |
| `view-manager:dashboard` | — | ✔ Team | — | ✔ Company |
| `view-hr:dashboard` | — | — | ✔ Company | ✔ Company |
| `view-admin:dashboard` | — | — | — | ✔ Company |
| `view:dashboard-config` | — | — | — | ✔ Company |
| `update:dashboard-config` | — | — | — | ✔ Company |
| `refresh:dashboard-cache` | — | — | — | ✔ Company |

`data_scope` là **PER-(permission, role)** (permission-matrix §13); đổi scope = **DELETE + INSERT**.

### 2.5 Default config per dashboard type (NORMATIVE — suy từ §11.3 cột Dashboard ∩ P0/P1)

| dashboard_type | widget default (is_enabled=true, config_scope='Company') |
|---|---|
| Employee | ATTENDANCE_TODAY · MY_TASKS · TASK_ALERTS · NOTIFICATIONS |
| Manager | MY_TASKS · TASK_ALERTS · NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| HR | NOTIFICATIONS · PENDING_LEAVE · PROJECT_PROGRESS |
| Admin | NOTIFICATIONS · PROJECT_PROGRESS |

`HR_OVERVIEW` (P2) **không** có default config ở sprint này (catalog có, default off).

---

## 3. Lanes (theo domain, thứ tự phụ thuộc)

| lane | task | crown | paths | builder | depends_on |
|---|---|---|---|---|---|
| **dashCatalogConst** | registry TĨNH nguồn-sự-thật (mirror `notification-event-catalog.const.ts`) — mig + seeder + int-spec khớp 1-1 | ✅ | `apps/api/src/foundation/seed/dashboard-widget-catalog.const.ts` | backend-builder | — |
| **dashSeedMig** (NỐI TIẾP) | mig 0483: seed widgets GLOBAL + permission catalog + role grants (owner-bypass, DO-block mirror 0481) + GRANT app INSERT/DELETE configs | ✅ | `apps/api/migrations/0483_s4_dashseed1_widget_catalog_perms.sql` | db-migration | dashCatalogConst |
| **dashConfigSeeder** | code seeder per-company default configs (register vào `MasterDataSeederRegistry`, `withTenant`, `WHERE NOT EXISTS`) | ✅ | `apps/api/src/foundation/seed/dashboard-config.seeder.ts` (+ đăng ký `seed.module.ts` khối additive) | backend-builder | dashSeedMig (FK widgets), dashCatalogConst |
| **dashSeedVerify** | int-spec RED→GREEN | ✅ | `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` | qa-test-engineer | 3 lane trên |

---

## 4. Steps

1. **Const registry** — `apps/api/src/foundation/seed/dashboard-widget-catalog.const.ts`: export `DASH_WIDGET_CATALOG` (7 entry §2.3), `DASH_WIDGET_COUNT=7`, `DASH_PERMISSION_PAIRS` (§2.4 tuple + is_sensitive), `DASH_WIDGET_GATE_PAIR` (map widget_code → cặp module nguồn, **tra từ migration seed thật**), `DASH_DEFAULT_CONFIG` (§2.5), `DASH_CANONICAL_ROLES=['employee','manager','hr','company-admin']`. Kiểu union khớp CHECK 0482.
2. **Migration 0483** — `apps/api/migrations/0483_s4_dashseed1_widget_catalog_perms.sql` (header BAND idx 163 / when 1717500810000, mirror header 0481):
   - (1) `INSERT INTO dashboard_widgets (company_id=NULL, …)` VALUES ×7 → `ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`.
   - (2) `INSERT INTO permissions (action, resource_type, is_sensitive)` các cặp §2.4 (**KHÔNG** `read:dashboard` — đã có) → `ON CONFLICT (action, resource_type) DO NOTHING`.
   - (3) DO-block role grants: resolve role (`company_id IS NULL`, `deleted_at IS NULL`) + permission → **RAISE EXCEPTION nếu thiếu** (fail-LOUD, mirror `0481:331/339`) → **DELETE per-pair** `(role_id, permission_id, 'ALLOW')` scope SAI → **INSERT** scope §2.4 → `ON CONFLICT (role_id, permission_id, effect) DO NOTHING`. super-admin KHÔNG enumerate.
   - (4) `GRANT INSERT, DELETE ON dashboard_widget_configs TO mediaos_app;` (§5.4 — owner chốt). KHÔNG đụng RLS/policy/GRANT khác của 0482 (additive).
3. **Config seeder** — `dashboard-config.seeder.ts` implement `ModuleMasterDataSeeder` (`seedKey='dash.default-configs'`, `seedVersion='1'`): với mỗi (dashboard_type, widget_code) ∈ `DASH_DEFAULT_CONFIG` → resolve `widget_id` từ `dashboard_widgets` GLOBAL → `INSERT INTO dashboard_widget_configs (company_id, widget_id, dashboard_type, config_scope='Company', role_id=NULL, user_id=NULL, is_enabled=true, sort_order) SELECT … WHERE NOT EXISTS (…)` + `track()`.
4. **Đăng ký seeder** — `seed.module.ts`: `MasterDataSeederRegistry.register(DashboardConfigSeeder)` lúc `onModuleInit` (khối additive, mirror ATT/LEAVE). `seedKey` duy nhất toàn hệ.
5. **Int-spec** — `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` (mirror `noti-seed-catalog-permissions.int-spec.ts`), import const registry + `../helpers/integration-db` (`directPool`, `hasDb`), gate `hasDb && Boolean(process.env.LANE_DB)`.
6. **Cập nhật `harness/backlog.mjs`** — WO `done`, ghi migration head mới (idx 163).

---

## 5. Migration: thứ tự an toàn

### 5.1 RLS/FORCE + policy — ĐÃ tạo ở 0482 TRƯỚC mọi INSERT
0482 đã bật RLS+FORCE + policy cho cả 3 bảng (:81–91, :153–158). **0483 CHỈ INSERT data + 1 GRANT** — KHÔNG đụng RLS/FORCE/policy. Không có backfill `company_id` (widgets GLOBAL = NULL tường minh; configs company_id do seeder cấp qua `withTenant`).

### 5.2 Owner-bypass cho GLOBAL widgets + permissions
Widgets `company_id NULL` + permissions/role_permissions không tenant → ghi qua **migrator owner** (`DATABASE_DIRECT_URL`, `rolbypassrls`) tại migrate-time (mirror `0481:6–11`). `WITH CHECK (company_id=GUC)` của 0482 chỉ chặn app role, KHÔNG chặn owner.

### 5.3 ON CONFLICT target CỤ THỂ (tên index/constraint thật)
- Widgets: `ON CONFLICT (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL` → khớp **`uq_dashboard_widgets_global_code_active`** (0482:93–95).
- Permissions: `ON CONFLICT (action, resource_type)` (mẫu 0481:285).
- role_permissions: `ON CONFLICT (role_id, permission_id, effect)` (KHÔNG gồm data_scope) → đổi scope = **DELETE per-pair wrong-scope + INSERT** (mirror 0480:104–115 / 0481:344–355).
- configs: **KHÔNG có unique index** ⇒ **KHÔNG dùng ON CONFLICT** → **`WHERE NOT EXISTS`** trong seeder.

### 5.4 ✅ OWNER CHỐT: `GRANT INSERT, DELETE ON dashboard_widget_configs TO mediaos_app`
0482 để app **SELECT-only** trên configs (:171, đã kiểm chứng). Config-seeder chạy `withTenant` = **role app** ⇒ INSERT sẽ `permission denied`. Mig 0483 phải:
```sql
GRANT INSERT, DELETE ON dashboard_widget_configs TO mediaos_app;
```
DELETE để hỗ trợ đổi default-set; **UPDATE để dành S4-DASH-BE**. RLS + FORCE vẫn cô lập theo tenant ⇒ mở INSERT/DELETE **không** rò chéo (BẤT BIẾN #1 nguyên vẹn). `dashboard_widget_configs` **không** thuộc danh sách append-only (CLAUDE.md §2) ⇒ DELETE không phá BẤT BIẾN #2; soft-delete `deleted_at` vẫn là đường dùng ở runtime.

### 5.5 Config seed cần company TỒN TẠI (không seed trong migration)
Trên DB fresh, company mặc định tạo ở **BOOT** (`ensure_default_company` từ `BootstrapService`), **SAU** migrate (0469 header `:6–9`). ⇒ seed configs trong migration sẽ resolve 0 company. **Bắt buộc** dùng **code seeder** (`MasterDataSeedRunner` reconcile per-company tại `OnApplicationBootstrap`, `master-data-seed-runner.service.ts:65/142`) — đây là lý do WO có path `src/foundation/seed/**`.

---

## 6. acceptanceChecks[]

1. `SELECT count(*) FROM dashboard_widgets WHERE company_id IS NULL AND deleted_at IS NULL` = **7**; tập `widget_code` == đúng 7 In-sprint §11.3.
2. Mỗi widget: `required_permission_code` == DB-07 §8.5 verbatim (`DASH.WIDGET.VIEW_*`), `module_code`/`widget_type`/`default_data_scope` ∈ CHECK, `data_source_key`/`component_key` NOT NULL.
3. Widget Catalog-only (`NEW_EMPLOYEES`, `LEAVE_CALENDAR`, …) **KHÔNG** tồn tại trong `dashboard_widgets` GLOBAL.
4. Mỗi engine pair §2.4 tồn tại trong `permissions` với `is_sensitive` đúng; `read:dashboard` GIỮ NGUYÊN non-sensitive (0100 không bị đụng).
5. **KHÔNG có cặp `*:dashboard-widget`** nào trong `permissions` (khẳng định Option B — chống drift ngược).
6. `company-admin` có `view-admin:dashboard` + `view/update:dashboard-config` + `refresh:dashboard-cache` @Company.
7. `employee` KHÔNG có `view-admin:dashboard` / `view-hr:dashboard` / `*:dashboard-config` (least-privilege).
8. `dashboard_widget_configs` company mặc định: mỗi dashboard_type đúng tập §2.5, `config_scope='Company'`, `role_id/user_id` NULL, `is_enabled=true`; HR_OVERVIEW KHÔNG có default config.
9. Chạy lại seed (mig block + seeder) 2 lần → count widgets/permissions/grants/configs KHÔNG đổi; `data_scope` grant KHÔNG drift.
10. `/auth/me` của admin phơi cặp DASH non-sensitive (`read:dashboard`, `view-employee:dashboard`) trong capabilities.
11. Cross-tenant: config company A không lộ khi query context company B.

---

## 7. testTasks[] — RED TRƯỚC, deny-path đi đầu

**File:** `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` (mirror `noti-seed-catalog-permissions.int-spec.ts`).

**Gate CỨNG** — `.env` làm `hasDb=true` nên `skipIf(!hasDb)` là **ĐỎ-GIẢ** trên DB chung:
```ts
const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB);
describe.skipIf(!runIsolatedDb)("S4-DASH-SEED-1 …", () => { ... });
```
Chạy: `bash scripts/lane-db-setup.sh dashseed` → `export LANE_DB=mediaos_dashseed` → `pnpm --filter @mediaos/api test`. Import mốc từ `dashboard-widget-catalog.const.ts` (KHÔNG hard-code chuỗi rời).
**RED:** trên DB migrate tới 0482 → thiếu widget/permission/grant/config ⇒ ĐỎ. Sau 0483 + seeder → GREEN.

- **(E1 deny, đầu tiên)** `employee`/`manager` có **0 grant** `*:dashboard-config`, KHÔNG `view-admin:dashboard`/`view-hr:dashboard` (grantScope → null).
- **(E2 deny)** KHÔNG tồn tại cặp `*:dashboard-widget` trong `permissions` (Option B invariant).
- **(A)** tập `widget_code` GLOBAL == `DASH_WIDGET_CATALOG` (missing=[], extra=[], size=7); mỗi widget khớp `required_permission_code`/scope/module/type/component_key/data_source_key.
- **(A2)** Catalog-only widgets **vắng mặt**.
- **(C)** mỗi engine pair §2.4 tồn tại + `is_sensitive` đúng; `read:dashboard` vẫn non-sensitive; KHÔNG cặp phantom.
- **(D positive)** `company-admin` đủ cặp admin/config/cache @Company; `view-employee:dashboard` cấp cho cả 4 role @Own.
- **(G default config)** company mặc định khớp §2.5; `config_scope='Company'`; HR_OVERVIEW vắng.
- **(F idempotent)** chạy lại DO-block 3× → grant KHÔNG drift (mirror noti F `:290–337`); `DashboardConfigSeeder.seed()` 2× → count configs KHÔNG đổi.
- **(H /auth/me)** admin: capabilities chứa `read:dashboard` + `view-employee:dashboard`. Xác minh `getCapabilities` lọc `is_sensitive` thế nào TRƯỚC khi khoá assert.
- **(I cross-tenant)** config company A không xuất hiện ở context company B.

---

## 8. Rủi ro & landmine

1. **Pair-drift (đã cắn 3 lần).** Option B chọn để **triệt** rủi ro này cho widget: FE mapping không đổi. NHƯNG 4 cặp `view-*:dashboard` mới VẪN cần FE map nếu `S4-FE-DASH-2` (DashboardTypeSwitcher) gate theo chúng → **ghi vào bàn giao**; const registry BE là mốc, FE phải dùng cùng tuple. `DASH_WIDGET_GATE_PAIR` phải tra cặp module nguồn từ **migration seed thật**, không đoán theo tên.
2. **ON CONFLICT sai target (configs).** Không unique index ⇒ mọi `ON CONFLICT (…)` sẽ lỗi *"no unique or exclusion constraint matching"*. Bắt buộc `WHERE NOT EXISTS`. **KHÔNG bịa unique index** (đổi DDL 0482 = rewrite, cấm).
3. **Seed thiếu company_id / permission-denied.** (a) configs `company_id NOT NULL` + chưa có company lúc migrate → phải seed qua code-runner post-boot (§5.5). (b) app role SELECT-only → quên GRANT (§5.4) = INSERT 403.
4. **Migration band bị skip trên DB dùng chung.** drizzle migrator áp đơn điệu theo `when`; DB chung (`mediaos`/dev) đã ở head cao → 0483 chỉ áp trên DB có band < 163. Verify PHẢI chạy DB cô lập `LANE_DB` (CLAUDE.md §9.5).
5. **`required_permission_code` = SPEC-string ≠ engine-tuple.** S4-DASH-BE-1/2 phải resolve qua `DASH_WIDGET_GATE_PAIR` (Option B), KHÔNG tự chọn lệch.
6. **super-admin enumerate = RAISE.** Chỉ enumerate 4 role canonical.
7. **`test/integration/**` phải nằm trong `paths` WO** — nếu thiếu, `guard-scope` cảnh báo khi tạo int-spec.

---

## 9. Definition of Done

- Mig `0483_s4_dashseed1_widget_catalog_perms.sql` land: 7 widget GLOBAL (§2.3) + engine pairs §2.4 (**không** per-widget) + role grants §2.4 + `GRANT INSERT, DELETE` configs; ON CONFLICT/DELETE+INSERT idempotent; owner-bypass; header BAND idx 163 / when 1717500810000.
- `dashboard-widget-catalog.const.ts` (mốc chống drift) khớp 1-1 mig + seeder + int-spec; `DASH_WIDGET_GATE_PAIR` tra từ migration seed thật.
- `DashboardConfigSeeder` đăng ký + reconcile per-company default configs (§2.5), idempotent `WHERE NOT EXISTS`.
- Int-spec `dash-seed-catalog-permissions.int-spec.ts` RED→GREEN, gate `hasDb && LANE_DB`, deny-path đi trước; acceptanceChecks §6 pass trên DB cô lập.
- **FULL gate**: `security-reviewer` + `database-reviewer` (+ `silent-failure-hunter`) PASS; deny-path RED chứng minh trước GREEN.
- Cập nhật `harness/backlog.mjs` (WO done, head idx 163).
- Bàn giao ghi rõ: 4 cặp `view-*:dashboard` mới → `S4-FE-DASH-2` cần map trong `PERMISSION_CODE_TO_PAIR` nếu gate theo chúng.
