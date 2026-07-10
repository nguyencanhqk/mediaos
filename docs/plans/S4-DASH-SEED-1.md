# S4-DASH-SEED-1 — Seed widget catalog + permission DASH + default config (idempotent)

> Zone **red**. Gate **FULL**: `security-reviewer` + `database-reviewer`.
> **Bản v4 (2026-07-10)** — v1/v2/v3 đều bị `plan-reviewer` BLOCK. v4 viết tay, **mọi con số neo vào `file:dòng` có thật**.
> 4 lane **TUẦN TỰ**, không fan-out.

---

## 0. Vì sao v1–v3 hỏng

| bản | lỗi | sự thật |
|---|---|---|
| v1 | `GRANT INSERT, DELETE` trên `dashboard_widget_configs` | `dashboard_widget_cache` (`0482:231-232`) cố ý no-DELETE, comment `KHÔNG DELETE (BẤT BIẾN #2 soft-delete)`; seeder chỉ INSERT |
| v1 | seeder ở `foundation/seed/` | `master-data-seeder.types.ts:12-14` — INVERSION OF DEPENDENCY; ATT để seeder trong `attendance/` + registrar tự đăng ký |
| v1 | mig `0483` | `S4-NOTI-BE-1` (PR #133) đã mint slot đó |
| v2 | seed 8 cặp gồm `refresh:dashboard-cache` | `API-10 PERMISSION MATRIX:313` — cặp này cấp cho **SA duy nhất**, mà ta không enumerate super-admin ⇒ **không có role nào để grant**. Thêm nữa nó *"không có endpoint"*, và `DB-07 §10.2` + `permission-matrix-spec` đều không liệt |
| v2 | test `E1` bỏ sót role `hr` | DO-block grant nhầm `hr` thì cả suite vẫn xanh |
| v3 | **ma trận grant thiếu `hr`** | `API-10:285` — `DASH.DASHBOARD.VIEW_MANAGER \| MGR, HR(✓), CA, SA`. v3 không cấp cho `hr` |
| v3 | `DASH_DEFAULT_CONFIG` tự chế | `DB-07 §14.3` (dòng 2147+) là *"Seed dashboard widgets MVP"* — nguồn chuẩn. v3 bỏ `LEAVE_BALANCE` khỏi Employee, thay sạch Manager, và seed `PROJECT_PROGRESS` vào 3 dashboard **dù §14.3 không đặt nó vào bất kỳ default nào** |
| v3 | plan trỏ `§2.3–§2.9` của chính nó | auto-loop reconcile ghi đè plan thành wrapper YAML ⇒ mọi tham chiếu trỏ vào hư không; test `M` chỉ chứng const khớp chính nó (vòng tròn) |

---

## 1. Nguồn chuẩn (đọc thứ tự này khi mâu thuẫn)

CLAUDE.md §1: `docs/DB` + `docs/spec` là chuẩn.

| dùng cho | file | dòng |
|---|---|---|
| role → grant | `docs/API Design/API-10 PERMISSION MATRIX.md` | 283–287, 310–313 |
| `required_permission_code` + scope widget | `docs/DB/DB-07 NOTI DASH Database Design.md` §8.5 | 1109–1123 |
| default dashboard | `docs/DB/DB-07 ...` §14.3 | 2147+ |
| tập widget in-sprint | `docs/IMPLEMENTATION/IMPLEMENTATION-07...` §11.3 | 739–745 |
| mô hình gate widget | `docs/permission-matrix-spec.md` §7 | 144 |

### DB-07 tự mâu thuẫn — ghi lại để không ai đoán
`§8.5` liệt **12** widget có `required_permission_code`. `§14.3` xếp vào dashboard Admin 5 widget (`USER_SUMMARY`, `EMPLOYEE_SUMMARY`, `MODULE_STATUS`, `CONFIG_WARNINGS`, `SYSTEM_LOGS`) **không có** trong `§8.5`. Chúng chỉ có permission code ở `API-10`.

---

## 2. Quyết định owner (2026-07-10)

**Trim MVP.** Seed **7 widget in-sprint** (`IMPLEMENTATION-07 §11.3`), không seed phần còn lại. Ghi DRIFT tường minh vào `DB-07 §14.3`.

### 2.1 Bảy widget (NORMATIVE)

`required_permission_code` + cột `Scope` lấy verbatim `DB-07 §8.5:1109-1123`; khi §8.5 ghi dải (`Own/Team`) → **lấy cận dưới**, vì `default_data_scope` là cột đơn-giá-trị (CHECK `0482:75-76`) và BE nới theo quyền user runtime.

| widget_code | module | required_permission_code | default_data_scope | widget_type¹ | component_key | data_source_key |
|---|---|---|---|---|---|---|
| `ATTENDANCE_TODAY` | ATT | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own | Summary | `AttendanceTodayWidget` | `attendance-today` |
| `MY_TASKS` | TASK | `DASH.WIDGET.VIEW_MY_TASKS` | Own | List | `MyTasksWidget` | `my-tasks` |
| `TASK_ALERTS` | TASK | `DASH.WIDGET.VIEW_TASK_ALERTS` | Own | Alert | `TaskAlertsWidget` | `task-alerts` |
| `NOTIFICATIONS` | NOTI | `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own | List | `NotificationsWidget` | `notifications` |
| `PENDING_LEAVE` | LEAVE | `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team | List | `PendingLeaveWidget` | `pending-leave` |
| `PROJECT_PROGRESS` | TASK | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project | Chart | `ProjectProgressWidget` | `project-progress` |
| `HR_OVERVIEW` | HR | `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company | Summary | `HrOverviewWidget` | `hr-overview` |

¹ `widget_type` không được doc nào gán per-widget → chọn theo bản chất hiển thị, khớp CHECK `0482:73-74`. Đây là chỗ **duy nhất** trong bảng không có doc chống lưng; ghi rõ để reviewer biết.

`is_system_widget = true` cho cả 7. `company_id = NULL` (catalog global).

### 2.2 Bảy cặp quyền (NORMATIVE)

Giữ nguyên `read:dashboard` (mig `0100`) — **không đụng**. Không seed cặp per-widget `*:dashboard-widget` (Option B, `permission-matrix-spec §7:144`). Không seed `refresh:dashboard-cache` (§0).

| SPEC code | engine pair | is_sensitive | API-10 |
|---|---|---|---|
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | `view-employee:dashboard` | false | `:284` |
| `DASH.DASHBOARD.VIEW_MANAGER` | `view-manager:dashboard` | true | `:285` |
| `DASH.DASHBOARD.VIEW_HR` | `view-hr:dashboard` | true | `:286` |
| `DASH.DASHBOARD.VIEW_ADMIN` | `view-admin:dashboard` | true | `:287` |
| `DASH.CONFIG.VIEW` | `view:dashboard-config` | true | `:310` |
| `DASH.CONFIG.UPDATE` | `update:dashboard-config` | true | `:311` |
| `DASH.AUDIT_LOG.VIEW` | `view:dashboard-audit-log` | true | `:312` |

> `DASH.AUDIT_LOG.VIEW` cũng **chưa có endpoint** (`API-10:312`). Khác `CACHE.REFRESH` ở chỗ nó **có** trong `DB-07 §10.2` (nguồn seed) và cấp cho `CA` — có role thật để grant. Vì vậy seed; ghi chú nó là quyền catalog cho tới khi `S4-DASH-BE-3` gắn endpoint.

### 2.3 Grant matrix (NORMATIVE — `API-10:283-312`)

`SA` không enumerate (roles `company_id IS NULL` không có row `super-admin` → `RAISE`, mirror `0481:35-36`).

| pair | employee | manager | hr | company-admin | nguồn |
|---|---|---|---|---|---|
| `view-employee:dashboard` | ✔ | ✔ | ✔ | ✔ | `API-10:284` EMP,MGR,HR,CA,SA |
| `view-manager:dashboard` | — | ✔ | **✔** | ✔ | `API-10:285` MGR,**HR(✓)**,CA,SA |
| `view-hr:dashboard` | — | — | ✔ | ✔ | `API-10:286` HR,CA(✓),SA |
| `view-admin:dashboard` | — | — | — | ✔ | `API-10:287` CA,SA |
| `view:dashboard-config` | — | — | — | ✔ | `API-10:310` CA,SA |
| `update:dashboard-config` | — | — | — | ✔ | `API-10:311` CA,SA |
| `view:dashboard-audit-log` | — | — | — | ✔ | `API-10:312` CA,SA |

**Tập admin-only** = `{view-admin:dashboard, view:dashboard-config, update:dashboard-config, view:dashboard-audit-log}` — `employee`, `manager`, `hr` phải **vắng cả 4**.

**`data_scope`.** `API-10` cột Scope ghi `per-widget` cho 4 cặp dashboard-type, `Company/System` cho config/audit. Cột `role_permissions.data_scope` bắt buộc có giá trị, nên:
- 4 cặp `view-*:dashboard` → **`Own`**. Scope ở đây **không mang ngữ nghĩa lọc** (data scope thật do cặp module nguồn ép — `permission-matrix-spec §7`). Chọn `Own` = least-privilege: nếu sau này DASH-BE lỡ dùng `data_scope` của cặp này, nó **chặn chặt hơn** chứ không nới ngầm.
- 3 cặp config/audit → **`Company`** (theo `API-10:310-312`).

### 2.4 Gate widget → cặp module nguồn (`DASH_WIDGET_GATE_PAIR`)

`required_permission_code` là **nhãn SPEC**, không phải engine key. Enforcement đi qua bảng này. Mọi cặp đã xác minh tồn tại trong `permissions`:

| widget_code | cặp gate | seed ở | vì sao cặp này |
|---|---|---|---|
| `ATTENDANCE_TODAY` | `view-own:attendance` | `0454_s3_attseed1_att_perms.sql` | widget hiển thị công **của chính mình** (§8.5 Scope=Own). ATT còn có `read:attendance` (`0063`) — cặp admin, **không** dùng |
| `MY_TASKS` | `read:task` | `0005_permissions.sql` | task của chính mình |
| `TASK_ALERTS` | `read:task` | `0005_permissions.sql` | cùng nguồn TASK |
| `NOTIFICATIONS` | `read:notification` | `0005_permissions.sql` | own-scope, seed 0481 |
| `PENDING_LEAVE` | `view:leave` | `0455_s3_leaveseed1_leave_perms.sql` | scope Team (§8.5) ⇒ **không** `view-own:leave`, **không** `read:leave` |
| `PROJECT_PROGRESS` | `read:project` | `0005_permissions.sql:223` | tiến độ **project**, không phải task |
| `HR_OVERVIEW` | `read:employee` | `0019_g5_permissions_seed.sql` | tổng quan nhân sự |

> ⚠ Test `E3` chỉ chứng **cặp tồn tại**. Nhiều module có nhiều cặp cùng tồn tại (ATT: `read:attendance` + `view-own:attendance`; LEAVE: `read:leave` + `view:leave` + `view-own:leave`). Chọn nhầm một cặp **có thật nhưng sai ngữ nghĩa** thì `E3` vẫn xanh. Vì vậy mỗi entry mang comment `migration + lý do` ở cột trên, và reviewer FULL gate đối chiếu bằng mắt.

### 2.5 Default config — QUY TẮC, không phải khẩu vị

```
DASH_DEFAULT_CONFIG = ( DB-07 §14.3 ∩ 7 widget đã seed )
                    ∪ { NOTIFICATIONS cho MỌI dashboard type }
```

Vế thứ hai neo vào `IMPLEMENTATION-07 §11.3`: cột Dashboard của `NOTIFICATIONS` ghi **"All"**.
`sort_order` lấy nguyên từ `DB-07 §14.3`.

| dashboard_type | widget | sort | nguồn |
|---|---|---|---|
| Employee | `ATTENDANCE_TODAY` | 10 | §14.3 |
| Employee | `MY_TASKS` | 20 | §14.3 |
| Employee | `TASK_ALERTS` | 30 | §14.3 |
| Employee | `NOTIFICATIONS` | 50 | §14.3 |
| Manager | `PENDING_LEAVE` | 10 | §14.3 |
| Manager | `TASK_ALERTS` | 30 | §14.3 |
| Manager | `NOTIFICATIONS` | 50 | §11.3 "All" |
| HR | `HR_OVERVIEW` | 10 | §14.3 |
| HR | `PENDING_LEAVE` | 40 | §14.3 |
| HR | `NOTIFICATIONS` | 50 | §11.3 "All" |
| Admin | `NOTIFICATIONS` | 50 | §11.3 "All" |

**`PROJECT_PROGRESS` có trong catalog nhưng KHÔNG có default config** — `§14.3` không đặt nó vào bất kỳ dashboard nào.

**DRIFT so với `DB-07 §14.3`** (đã ghi vào chính file đó): bỏ `LEAVE_BALANCE`, `TEAM_TASKS_TODAY`, `LEAVE_CALENDAR`, `ATTENDANCE_ALERTS`, `NEW_EMPLOYEES`, `CONTRACT_EXPIRING`, `USER_SUMMARY`, `EMPLOYEE_SUMMARY`, `MODULE_STATUS`, `CONFIG_WARNINGS`, `SYSTEM_LOGS` — chưa nằm trong 7 widget in-sprint. Dashboard Admin vì thế chỉ còn `NOTIFICATIONS`. WO bù: `S4-DASH-CATALOG-2` (chưa mở).

---

## 3. Sự thật schema (đã kiểm chứng)

- `dashboard_widgets` (`0482:40-107`): ON CONFLICT target **duy nhất** hợp lệ = partial unique `uq_dashboard_widgets_global_code_active ON (widget_code) WHERE company_id IS NULL AND deleted_at IS NULL` (`:93-95`). App `GRANT SELECT` (`:104`) ⇒ seed GLOBAL phải qua **migrator owner-bypass**.
- `dashboard_widget_configs` (`0482:110-174`): `company_id` NOT NULL DEFAULT GUC; CHECK `config_scope='Company' ⇒ role_id/user_id NULL` (`:145-150`); có `deleted_at` (`:133`). **KHÔNG có unique index** ⇒ `ON CONFLICT` ném *"no unique or exclusion constraint matching"* ⇒ bắt buộc `WHERE NOT EXISTS`. App `GRANT SELECT` (`:171`) ⇒ mig 0484 phải `GRANT INSERT` (chỉ INSERT).
- Head journal thật: idx **163** / `when 1717500810000` / `0483_s4_notibe1_delete_own_grant` ⇒ mig mới **`0484`**, idx **164**, `when` **1717500815000**.
- `role_permissions` unique = `(role_id, permission_id, effect)` (`0005:78`) ⇒ đổi `data_scope` = **DELETE per-pair + INSERT**.
- Company mặc định chỉ tồn tại **sau BOOT** (`0469` header) ⇒ default config **phải** seed bằng code seeder post-boot, không seed trong migration.
- Seeder convention: `att-master-data.seeder.ts:29-30` → `seedKey`, `seedVersion = "v1"`. `att-seed.registrar.ts` `OnModuleInit` → `registry.register(seeder)`. `attendance.module.ts:6` import `SeedModule`. `seed.module.ts` **không** import module nghiệp vụ.

---

## 4. Lane — TUẦN TỰ

| # | lane | file |
|---|---|---|
| 1 | const registry | `apps/api/src/dashboard/dashboard-widget-catalog.const.ts` |
| 2 | migration | `apps/api/migrations/0484_s4_dashseed1_widget_catalog_perms.sql` + `meta/_journal.json` |
| 3 | seeder + registrar | `apps/api/src/dashboard/dashboard-config.seeder.ts`, `dash-seed.registrar.ts`, `dashboard.module.ts` |
| 4 | int-spec | `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts` |

Chạy song song = GREEN giả: seeder trước migration thì thiếu widgets + thiếu `GRANT INSERT`; hai lane cùng chạm `_journal.json` thì mint trùng số.

**Seeder `WHERE NOT EXISTS` phải khoá trên `(company_id, widget_id, dashboard_type, config_scope, role_id IS NULL, user_id IS NULL)`.** Chỉ so `(company_id, widget_id)` sẽ chặn nhầm vì `TASK_ALERTS` và `NOTIFICATIONS` xuất hiện ở nhiều `dashboard_type`.

---

## 5. testTasks — RED trước, deny-path đi đầu

File `apps/api/test/integration/dash-seed-catalog-permissions.int-spec.ts`.
Gate cứng `const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB)`.
Chạy: build contracts trước → `bash scripts/lane-db-setup.sh dashseed --reset` → `LANE_DB=mediaos_dashseed npx vitest run test/integration/dash-seed-catalog-permissions.int-spec.ts`.

- **M — grant-matrix VÉT CẠN (đi đầu).** Với **từng** role ∈ `{employee, manager, hr, company-admin}`: tập `(action, resource_type, data_scope)` DASH **bằng đúng** §2.3, và role **vắng mặt** mọi cặp admin-only không được cấp. `hr` là role dễ leo thang nhất — v2/v3 không test nó.
- **E2 (deny).** Không tồn tại cặp `*:dashboard-widget`; không tồn tại `refresh:dashboard-cache`.
- **E3.** Mỗi giá trị `DASH_WIDGET_GATE_PAIR` resolve ra row `(action, resource_type)` THẬT.
- **A.** Tập `widget_code` GLOBAL == đúng 7; từng trường khớp const.
- **A2.** Widget ngoài 7 (vd `LEAVE_BALANCE`, `TEAM_TASKS_TODAY`) vắng mặt.
- **C.** Đúng 7 cặp mới + `is_sensitive` đúng; `read:dashboard` không đổi.
- **G.** Default config khớp §2.5; `PROJECT_PROGRESS` **không** có default nào.
- **F (idempotent).** DO-block chạy lại 3× → grant count + `data_scope` không drift. Seeder chạy 2× → count configs không đổi **và** không sinh row trùng `(company_id, widget_id, dashboard_type, config_scope)`.
- **I (cross-tenant).** **Plant company thứ 2** + 1 config row thật qua `directPool`, assert vắng mặt dưới GUC company A. Ở N=1 không plant thì test **xanh-giả**.

---

## 6. Definition of Done

- Mig `0484` land: 7 widget GLOBAL + 7 cặp + grants §2.3 + `GRANT INSERT` (không DELETE/UPDATE); idempotent; owner-bypass; idx 164 nối tiếp `0483`.
- Const registry khớp 1-1 mig + seeder + test; `DASH_WIDGET_GATE_PAIR` có lý do từng entry.
- `DashboardConfigSeeder` + `DashSeedRegistrar` trong `apps/api/src/dashboard/`; `seed.module.ts` **không** đổi.
- Int-spec RED→GREEN trên `LANE_DB`; test `M` đi đầu; cross-tenant plant company thứ 2.
- DRIFT ghi vào `DB-07 §14.3`.
- **Bàn giao:** (1) gate widget = `DASH_WIDGET_GATE_PAIR`, **không** phải `required_permission_code` → `S4-DASH-BE-1/2`. (2) 4 cặp `view-*:dashboard` cần map trong `packages/web-core` `PERMISSION_CODE_TO_PAIR` nếu `S4-FE-DASH-2` gate theo chúng. (3) `refresh:dashboard-cache` còn nợ (SA-only, chưa có endpoint). (4) Dashboard Admin chỉ có 1 widget cho tới khi seed nốt catalog.
