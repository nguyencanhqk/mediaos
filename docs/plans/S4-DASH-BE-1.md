# S4-DASH-BE-1 — BE Dashboard resolver (`/dashboard/me` · `/types` · 4 type route) + widget registry — crown data-scope

> Zone **red**, tier **crown** (permission + data-scope). Gate **FULL**: `security-reviewer` + `plan-reviewer` PASS **trước khi code chạy**.
> Phụ thuộc: `S4-DASH-SEED-1` (mig 0484 + `dashboard-widget-catalog.const.ts`) — đã land trên `master` (608b008).
> **Lane này KHÔNG chạm migration** — thuần đọc (`dashboard_widgets`/`dashboard_widget_configs` app role đã có `SELECT`, mig 0482:104/171). Nếu trong lúc code phát hiện buộc phải ALTER schema → dừng, báo `needs_human`, bàn giao lane `db-migration`.

---

## 0. Đối chiếu WO ↔ nguồn chuẩn (ghi rõ để không ai đoán)

WO diễn đạt `GET /dashboard/:type` (route động). **SPEC-07 §17.1 / API-08 §10.1 / BACKEND-10 §11.1** đều chốt **4 route tĩnh** thật: `GET /dashboard/employee`, `/manager`, `/hr`, `/admin` — mỗi route có permission riêng seed sẵn (`view-employee|view-manager|view-hr|view-admin : dashboard`, mig 0484). Không có `resource_type` "dashboard-type" nào nhận tham số động để `@RequirePermission` kiểm tra kiểu param-hoá. Theo CLAUDE.md §1 ("khi mâu thuẫn → docs/DB + docs/spec là chuẩn, không phải diễn giải khác"), plan này hiện thực **4 route tĩnh** và coi `:type` trong WO là cách viết tắt của chúng. `done_when` #1 của WO vẫn được thoả (endpoint trả widget allowed theo permission + `dashboard_widget_configs`, không hard-code theo role).

`DASH-API-003` (`GET /dashboard/widgets` — catalog) và `DASH-API-101..122` (widget **data**) **KHÔNG** thuộc lane này — đó là `S4-DASH-BE-2` (`depends_on: ["S4-DASH-BE-1", ...]`, backlog.mjs:4532-4561). Lane này build đúng **registry** (widget nào được PHÉP thấy), BE-2 build **data** (widget thấy được gì).

---

## 1. Mục tiêu / phạm vi

1. `GET /api/v1/dashboard/me` — resolve dashboard mặc định của user hiện tại theo ưu tiên role (Admin > HR > Manager > Employee — BACKEND-10 §13.2/13.3), trả `{dashboard_type, widgets[], generated_at}`.
2. `GET /api/v1/dashboard/types` — liệt kê dashboard type user được phép xem (`{dashboard_type, label, is_default, permission}[]`).
3. `GET /api/v1/dashboard/employee` · `/manager` · `/hr` · `/admin` — trả `{dashboard_type, widgets[], generated_at}` cho ĐÚNG type đó (permission gate riêng từng route).
4. **Widget registry** (`DashboardWidgetRegistryService`): với 1 `(companyId, userId, dashboardType)` → trả danh sách widget **metadata** (KHÔNG `data` — đó là BE-2) đã lọc qua:
   - `dashboard_widget_configs` (company/role/user precedence, `is_enabled=true`, `deleted_at IS NULL`) — nguồn DUY NHẤT quyết định widget nào thuộc dashboard type nào (KHÔNG hard-code `if (role==='manager') return [...]` trong code).
   - `DASH_WIDGET_GATE_PAIR` (permission MODULE NGUỒN, `dashboard-widget-catalog.const.ts:138-154`) — per-widget.
   - Mọi query qua `db.withTenant(companyId, ...)`.
5. Widget list có `limit` (query param, validate + cap qua Zod, KHÔNG unbounded).
6. DTO Zod mới trong `packages/contracts` (dual-build), response qua envelope chuẩn (API-01 — `ResponseEnvelopeInterceptor`, KHÔNG tự bọc `{success,...}` tay).

### "Permission DASH" + "permission module nguồn" nghĩa là gì ở lane này

Migration 0484 chọn **Option B**: KHÔNG seed cặp per-widget `*:dashboard-widget`. Vậy 2 tầng gate của done_when #2 CỤ THỂ là:
- **Tầng DASH** = permission **dashboard-type** (`view-employee|view-manager|view-hr|view-admin : dashboard`) — gate được vào dashboard type đó ở tất cả (`@RequirePermission` trên 4 route + `/me`/`/types`).
- **Tầng module nguồn** = `DASH_WIDGET_GATE_PAIR[widgetCode]` — gate được thấy TỪNG widget bên trong dashboard đã vào được.

Không có "quyền DASH per-widget" nào khác tồn tại trong DB — nhầm 2 khái niệm này là bẫy đã được `S4-DASH-SEED-1` ghi chú trước (`backlog.mjs:4467`).

---

## 2. Ngoài phạm vi (lane khác / WO sau)

- `GET /dashboard/widgets`, `/dashboard/widgets/{slug}` (data thật + cache TTL + Degraded/Error) → `S4-DASH-BE-2`.
- `GET/POST/PATCH/DELETE /dashboard/configs*` (Admin sửa cấu hình widget, `DASH.CONFIG.*`) → chưa mở WO.
- `GET /dashboard/summary` (API-08 §11.8, header/mobile nhẹ) — không nằm trong `IMPLEMENTATION-07 §11.2` bảng P0/P1, hoãn.
- Query param `view`/`widget_codes`/`refresh` (API-08 §11.1) — vô nghĩa khi chưa có `data` thật (BE-2 gắn cache/refresh). Lane này CHỈ nhận `limit`.
- `dashboard_user_preferences` ("Personal default config", SPEC-07 §15.2/§11.2 bước 1) — bảng **CHƯA build** (mig 0482 chỉ có 3 bảng: `dashboard_widgets`/`_configs`/`_cache`). Resolve mặc định ở lane này bỏ qua bước "personal default", đi thẳng ưu tiên role (bước 2-6 của SPEC §11.2). Ghi rõ trong code comment + PR — KHÔNG tự ý thêm bảng mới (đổi schema ngoài phạm vi lane BE).
- Audit log: SPEC §21.1 liệt "User mở dashboard" = **Không bắt buộc**; "User xem widget nhạy cảm" = Có nhưng gắn với XEM DATA (HR overview số liệu thật) — lane này chỉ trả metadata widget (không data), nên KHÔNG cần audit call. BE-2 phải bổ sung khi trả data thật.
- `DASH-ERR-FORBIDDEN` (slug SPEC) — hệ thống hiện tại map MỌI 403 qua `ERROR_CODES.AUTH_FORBIDDEN` (`common/errors/error-codes.ts:17,37-38`), là quy ước CHUNG toàn app (không riêng DASH), lane này KHÔNG tự chế slug riêng đi ngược convention.

---

## 3. Endpoint + permission (bám API-08 §10.1, đã verify seed thật)

| Method | Path | Permission (engine pair) | `isSensitive` |
| --- | --- | --- | --- |
| GET | `/dashboard/me` | `read:dashboard` (mig 0100, blanket-grant mọi role) | false |
| GET | `/dashboard/types` | `read:dashboard` | false |
| GET | `/dashboard/employee` | `view-employee:dashboard` | false |
| GET | `/dashboard/manager` | `view-manager:dashboard` | **true** |
| GET | `/dashboard/hr` | `view-hr:dashboard` | **true** |
| GET | `/dashboard/admin` | `view-admin:dashboard` | **true** |

`read:dashboard` xác nhận grant **blanket cho MỌI role** (`0100_g14_dashboard_permissions_seed.sql:11-19`, `CROSS JOIN roles`) — kể cả role không có bất kỳ `view-*:dashboard` nào (vd `uploader`) vẫn qua được gate cơ bản, rồi mới rơi vào `DASH-ERR-DASHBOARD_NOT_RESOLVED` ở tầng service (dùng để test M10 bên dưới).

`DashboardResolverController` là controller **THỨ HAI** trên `@Controller("dashboard")`, song song `DashboardController` cũ (park G14-1: report/mv-stats/alerts/refresh/summary) — mirror `MyNotificationsController` cạnh `NotificationsController` (`my-notifications.controller.ts:46-48`). Không route nào trùng path+method.

> ⚠️ **BẮT BUỘC `@UseGuards(PermissionGuard)` mức CLASS** trên `DashboardResolverController` (mirror `my-notifications.controller.ts:55`). `PermissionGuard` **KHÔNG global** (`app.module.ts:83` — APP_GUARD chỉ có JwtAuthGuard/CompanyGuard/TwoFactorEnforcementGuard); `@RequirePermission` chỉ là `SetMetadata` (`require-permission.decorator.ts:18-23`) — **thiếu guard = decorator vô hiệu**, cả 6 route chỉ còn JWT → user đăng nhập bất kỳ gọi được `/dashboard/hr`/`/dashboard/admin`. redTests M1/M2/M3/M5 (403) là backstop bắt lỗi này.

---

## 4. Thuật toán resolver (BACKEND-10 §13.2/13.3, rút gọn bỏ bước personal-default)

```
resolveDefaultDashboardType(userId, companyId):
  checks = Promise.all([
    can(view-admin:dashboard, isSensitive=true),
    can(view-hr:dashboard,    isSensitive=true),
    can(view-manager:dashboard, isSensitive=true),
    can(view-employee:dashboard, isSensitive=false),
  ])
  for type in [Admin, HR, Manager, Employee]:   // thứ tự ưu tiên CỐ ĐỊNH — KHÔNG đọc user_roles.name để đoán
    if checks[type].allow: return type
  throw NotFoundException({ code: DASH_ERR.DASHBOARD_NOT_RESOLVED })
```

`listAllowedDashboardTypes` dùng lại 4 `can()` trên, trả toàn bộ type ALLOW (không chỉ default) + gắn `is_default` = kết quả `resolveDefaultDashboardType` (tính 1 lần, không gọi 2 lượt `can()`).

**Widget registry** (`DashboardWidgetRegistryService.listWidgets(companyId, userId, dashboardType, limit)`):

```
1. roleIds = SELECT role_id FROM user_roles
             WHERE user_id=userId AND company_id=companyId AND deleted_at IS NULL
               AND (expires_at IS NULL OR expires_at > now())      -- qua withTenant
2. rows = SELECT configs.*, widgets.widget_code, widgets.name, widgets.widget_type,
                 widgets.module_code, widgets.default_data_scope
          FROM dashboard_widget_configs configs
          JOIN dashboard_widgets widgets ON widgets.id = configs.widget_id
          WHERE configs.company_id = companyId
            AND configs.dashboard_type = dashboardType
            AND configs.deleted_at IS NULL
            AND widgets.deleted_at IS NULL AND widgets.status = 'Active'
            AND ( configs.config_scope = 'Company'
               OR (configs.config_scope = 'Role' AND configs.role_id = ANY(roleIds))
               OR (configs.config_scope = 'User' AND configs.user_id = userId) )
          -- qua withTenant(companyId, ...) — BẤT BIẾN #1
3. pick 1 row / widget_id, ưu tiên User > Role > Company (DB-07 §8.2 rule 1);
   loại nếu is_enabled=false trên row được chọn.
4. với mỗi widget còn lại: pair = DASH_WIDGET_GATE_PAIR[widget_code]
   - thiếu entry trong map (không nên xảy ra với 7 widget in-sprint) → loại + log.warn (fail-closed, KHÔNG throw làm sập cả dashboard).
   - can(pair.action, pair.resourceType) không allow → loại.
     (Không truyền isSensitive ở đây là AN TOÀN: engine tự ép effectivelySensitive = input.isSensitive OR grant.isSensitive
      — permission.service.ts:112 — nên cặp nguồn is_sensitive=true vẫn bị ép exact-match, wildcard không lọt.
      PHẢI để 1 dòng comment nói rõ điều này trong code để reviewer FULL-gate không tưởng bỏ sót.)
5. sort theo sort_order asc; slice(0, limit).
6. map → WidgetSummaryDto { widget_code, widget_name, widget_type, source_modules:[module_code],
                             data_scope: data_scope_override ?? default_data_scope,
                             layout: { order: sort_order }, data: null, last_updated_at: null }
```

Bước 3 (precedence User>Role>Company) hiện KHÔNG có row Role/User nào (seeder chỉ ghi `config_scope='Company'`, `dashboard-config.seeder.ts:71`) — vẫn cài đúng thuật toán tổng quát ngay từ lane này để lane cấu hình sau (`DASH.CONFIG.UPDATE`, chưa mở WO) không phải sửa lại registry.

---

## 5. `filesToTouch`

**Mới:**
- `apps/api/src/dashboard/dashboard-resolver.controller.ts` — 6 route (§3), `@UseGuards(PermissionGuard)` mức class (xem cảnh báo §3 — guard KHÔNG global).
- `apps/api/src/dashboard/dashboard-resolver.service.ts` — `resolveDefaultDashboardType` + `listAllowedDashboardTypes` + orchestrate `/me`, `/types`, 4 route.
- `apps/api/src/dashboard/dashboard-widget-registry.service.ts` — thuật toán §4 bước 1-6 (repository query riêng nếu file vượt ~250 dòng, tách `dashboard-widget-registry.repository.ts`).
- `apps/api/src/dashboard/dashboard-resolver.dto.ts` — nestjs-zod DTO (`createZodDto`) cho query `limit`.
- `apps/api/src/dashboard/dashboard-resolver.errors.ts` — `DASH_ERR = { DASHBOARD_NOT_RESOLVED: "DASH-ERR-DASHBOARD_NOT_RESOLVED" }` (mirror `my-notifications.errors.ts`).
- `packages/contracts/src/dashboard-resolver.ts` — schema `dashboardTypeEnum` (4 giá trị user-facing), `dashboardWidgetSummarySchema`, `dashboardMeResponseSchema`, `dashboardTypesResponseSchema`, `dashboardTypeResponseSchema`, `dashboardWidgetListQuerySchema` (`limit`), hằng `DASH_WIDGET_LIST_LIMIT_DEFAULT/MAX`.
- `apps/api/test/integration/dashboard-resolver.int-spec.ts` — RED-first (§7).

**Sửa (additive):**
- `apps/api/src/dashboard/dashboard.module.ts` — thêm `DashboardResolverController` vào `controllers[]`, `DashboardResolverService` + `DashboardWidgetRegistryService` vào `providers[]` (KHÔNG đụng service/controller cũ).
- `apps/api/src/dashboard/dashboard-widget-catalog.const.ts` — APPEND (không sửa dòng có sẵn): `DASH_TYPE_PERMISSION_PAIR` (map 4 type → `{action,resourceType,isSensitive}`, đọc từ `DASH_PERMISSION_PAIRS` hiện có), `DASH_TYPE_LABEL` (label tiếng Việt cho `/types`), helper `dashDashboardPair(specCode)` fail-fast (mirror `notificationPair()`, `notification-permissions.const.ts:31-39`) — TRÁNH hard-code lại `action`/`resourceType` rời rạc trong controller (bài học pair-drift lặp lại 3 lần theo memory).
- `packages/contracts/src/index.ts` — thêm 1 dòng `export * from "./dashboard-resolver";` ngay sau dòng `export * from "./dashboard";` (dòng 105), kèm comment ngắn mirror style dòng 91-93.

**KHÔNG đụng:** `apps/api/migrations/**`, `apps/api/src/db/schema/**`, `apps/api/src/dashboard/dashboard.controller.ts` / `dashboard.service.ts` / `report.service.ts` / `mv-dashboard.service.ts` / `alerts.service.ts` / `dashboard-refresh.service.ts` / `dashboard-config.seeder.ts`, `apps/api/src/app.module.ts` (DashboardModule đã import sẵn, không cần đổi).

---

## 6. Bất biến phải giữ (CLAUDE.md §2)

1. **`company_id` mọi query** — `DashboardWidgetRegistryService` bắt buộc đi qua `db.withTenant(companyId, tx => ...)` cho CẢ 2 query (`user_roles` + `dashboard_widget_configs JOIN dashboard_widgets`). KHÔNG query trần qua `db.raw`/pool trực tiếp.
2. **Permission guard đúng mã** — `@UseGuards(PermissionGuard)` mức class BẮT BUỘC (guard không global — §3); `@RequirePermission(action, resourceType, {isSensitive})` lấy TỪ `DASH_PERMISSION_PAIRS`/`DASH_WIDGET_GATE_PAIR` (const file), KHÔNG hard-code string rời trong controller/service.
3. **Không hard-code role/workflow** — widget nào thuộc dashboard type nào đọc 100% từ `dashboard_widget_configs`; danh sách "role → dashboard mặc định" là THỨ TỰ ưu tiên gọi permission (Admin>HR>Manager>Employee), KHÔNG phải `if (role.name === 'hr')`.
4. **Soft-delete** — mọi query lọc `deleted_at IS NULL` (`dashboard_widget_configs`, `dashboard_widgets`, `user_roles`).
5. **Không secret** — response widget chỉ chứa metadata catalog (widget_code/name/type/scope) — không PII, không secret.
6. **Envelope API-01** — controller trả object thường (KHÔNG tự bọc `{success,...}`) → `ResponseEnvelopeInterceptor` bọc; nếu cần `limit` list → dùng `paginated()`/`toPagination()` CHỈ khi thật sự phân trang (ở đây KHÔNG — `limit` là cap đơn giản, KHÔNG phải pagination block, tránh lạm dụng `PAGINATED` tag sai ngữ nghĩa).

---

## 7. redTests — RED trước (viết & chạy FAIL trước khi code), file `apps/api/test/integration/dashboard-resolver.int-spec.ts`

Mirror `my-notifications.int-spec.ts` (supertest thật + login thật + `directPool` seed), gate `hasDb && LANE_DB`.

1. **No-role user** (user tồn tại, KHÔNG có row `user_roles` nào) → `GET /dashboard/me`, `/types`, cả 4 route type → **403** (thiếu cả `read:dashboard` blanket-nhưng-cần-role — thực ra `read:dashboard` grant theo ROLE, user không role thì 0 grant nào cả kể cả blanket).
2. **Employee-only** (`seedUserRole` role `employee`) — DASH-TC tương đương DASH-TC-015/017:
   - `GET /dashboard/manager` → 403; `GET /dashboard/hr` → 403; `GET /dashboard/admin` → 403.
   - `GET /dashboard/employee` → 200, `widgets[].widget_code` set **CHÍNH XÁC** `{ATTENDANCE_TODAY, MY_TASKS, TASK_ALERTS, NOTIFICATIONS}` (đúng 4, đúng thứ tự `sort_order` 10/20/30/50) — **KHÔNG** chứa `HR_OVERVIEW`/`PENDING_LEAVE`/`PROJECT_PROGRESS`.
   - `GET /dashboard/me` → 200, `dashboard_type = "Employee"`.
   - `GET /dashboard/types` → 200, mảng đúng 1 phần tử `{dashboard_type:"Employee", is_default:true}`.
3. **Manager-only** (`seedUserRole` role `manager`):
   - `/dashboard/hr`, `/dashboard/admin` → 403.
   - `/dashboard/manager` → 200, widget set `{PENDING_LEAVE, TASK_ALERTS, NOTIFICATIONS}` — **KHÔNG** `MY_TASKS` (DASH_DEFAULT_CONFIG không map MY_TASKS vào Manager type) — assert phủ định rõ ràng để bắt lỗi copy-paste từ Employee set.
   - `/dashboard/me` → `dashboard_type = "Manager"`.
4. **HR-only** (role `hr`) — chứng minh **thứ tự ưu tiên**, không phải "role đầu tiên tìm thấy": `hr` role CŨNG có grant `view-manager:dashboard` (DASH_GRANT_MATRIX) nhưng `/dashboard/me` PHẢI resolve `"HR"` (Admin>HR>Manager). `/dashboard/types` trả **2** phần tử (`HR` is_default=true, `Manager` is_default=false).
5. **company-admin-only** — có đủ 4 grant → `/dashboard/me` → `"Admin"`; `/dashboard/types` trả đủ 4, `is_default` chỉ đúng 1 (`Admin`).
6. **Cross-tenant (bắt buộc plant company B — N=1 không plant thì xanh-giả; mirror cấu trúc `notifications-tenant-isolation.int-spec.ts` — file có thật, KHÔNG có dashboard*-rls spec nào tồn tại sẵn):**
   - Company A + Company B, mỗi company có user employee riêng (roles global, không cần seed lại).
   - Qua `directPool`, INSERT thêm 1 row `dashboard_widget_configs` cho **company B** gán `HR_OVERVIEW` vào `dashboard_type='Employee'`, `is_enabled=true` (widget global `HR_OVERVIEW` đã tồn tại từ mig 0484, chỉ cần lấy `widget_id` qua `SELECT id FROM dashboard_widgets WHERE widget_code='HR_OVERVIEW' AND company_id IS NULL`).
   - `GET /dashboard/employee` bằng token company A → widget set VẪN đúng 4 chuẩn, **KHÔNG** rò `HR_OVERVIEW` của B (chứng minh RLS literal-GUC + `withTenant` đúng company).
7. **`DASH-ERR-DASHBOARD_NOT_RESOLVED` (404):** seed user với role KHÔNG nằm trong 4 role canonical DASH (vd role hệ cũ `uploader`, `roles.name='uploader'`, không có bất kỳ `view-*:dashboard` nào nhưng CÓ `read:dashboard` blanket) → `GET /dashboard/me` → 404 `{error.code: "DASH-ERR-DASHBOARD_NOT_RESOLVED"}`; `GET /dashboard/types` → 404 cùng mã (mảng rỗng coi là not-resolved, theo API-08 §11.2 business validation).
8. **`limit`:** Employee user, `GET /dashboard/employee?limit=2` → đúng 2 phần tử, **đúng 2 đầu theo `sort_order`** (`ATTENDANCE_TODAY`, `MY_TASKS`) — chứng minh limit áp SAU khi sort, không áp trước. `?limit=0` hoặc số âm/chữ → lỗi validate (400, `ERROR_CODES.VALIDATION`) — KHÔNG 500, KHÔNG trả toàn bộ ngầm định.
9. **Company grants isolation (nhẹ, không phải RLS):** widget `PROJECT_PROGRESS` (không có default config nào — `DASH_DEFAULT_CONFIG` không map nó) không xuất hiện ở BẤT KỲ dashboard type nào cho bất kỳ role nào (đúng theo seed hiện tại — assert phủ định để bắt regression nếu ai đó lỡ thêm nhầm default config).
10. **Gate tầng-2 CÙNG-TENANT (deny-path CHO CHÍNH thuộc tính crown của done_when #2 — thiếu test này thì gỡ hẳn bước 4 §4 mọi test vẫn xanh):**
   - Company A: qua `directPool` (owner-bypass RLS) INSERT 1 row `dashboard_widget_configs` gán widget nhạy cảm `HR_OVERVIEW` vào `dashboard_type='Employee'` cho **CHÍNH company A**, `config_scope='Company'`, `is_enabled=true`, `sort_order=99` (lấy `widget_id` từ `dashboard_widgets WHERE widget_code='HR_OVERVIEW' AND company_id IS NULL`).
   - User `employee` company A (có `view-employee:dashboard` → vào được `/dashboard/employee`; **THIẾU** permission module nguồn của `HR_OVERVIEW` theo `DASH_WIDGET_GATE_PAIR`) → `GET /dashboard/employee` → 200 nhưng widget set **VẪN KHÔNG chứa `HR_OVERVIEW`** (bị loại ở bước 4 §4, không phải ở config query).
   - Đối chứng dương (plan-reviewer đã verify): user `hr` company A **CÓ CẢ** `view-employee:dashboard` (mig 0484:93 / `DASH_GRANT_MATRIX` const:249 — cả 4 role canonical đều có view-employee) **VÀ** `read:employee` (quyền module nguồn của `HR_OVERVIEW`, const:153) → cùng config đã plant, `GET /dashboard/employee` bằng token `hr` → widget set **PHẢI chứa `HR_OVERVIEW`**. M10 nhờ đó chứng minh gate tầng-2 HAI CHIỀU: loại khi thiếu quyền (employee) + nhận khi đủ quyền (hr).
   - Test PHẢI RED khi chưa có bước 4 (chạy thử bằng cách comment bước 4 khi tự-verify RED — hoặc đơn giản: test viết TRƯỚC khi service tồn tại nên RED tự nhiên; giữ assert phủ định HR_OVERVIEW làm regression vĩnh viễn).

---

## 8. Các bước implement (sau khi §7 chạy RED)

1. `packages/contracts/src/dashboard-resolver.ts` + export ở `index.ts` → `pnpm --filter @mediaos/contracts build` (dual ESM/CJS) — làm TRƯỚC để BE import type được ngay.
2. Append `dashboard-widget-catalog.const.ts`: `DASH_TYPE_PERMISSION_PAIR`, `DASH_TYPE_LABEL`, `dashDashboardPair()`.
3. `dashboard-resolver.errors.ts` (DASH_ERR).
4. `dashboard-widget-registry.service.ts` (+ repository nếu tách) — thuật toán §4, đơn vị test trước bằng service-level spec nếu cần (không bắt buộc, int-spec đã phủ HTTP).
5. `dashboard-resolver.service.ts` — dùng `PermissionService.can()` trực tiếp (KHÔNG qua guard) để resolve default type + liệt kê allowed types, gọi registry service để lấy widget theo type.
6. `dashboard-resolver.controller.ts` — 6 route, `@UseGuards(PermissionGuard)` mức class + decorator theo bảng §3.
7. `dashboard.module.ts` — thêm controller + 2 provider (additive).
8. Chạy `dashboard-resolver.int-spec.ts` → GREEN.
9. Chạy `pnpm --filter @mediaos/api typecheck` + `pnpm --filter @mediaos/api lint` (không `@ts-ignore`/`eslint-disable`).

---

## 9. Verify

```bash
TURBO_FORCE=1 pnpm --filter @mediaos/contracts build
bash scripts/lane-db-setup.sh dashbe1 --reset
LANE_DB=mediaos_dashbe1 npx vitest run apps/api/test/integration/dashboard-resolver.int-spec.ts
pnpm --filter @mediaos/api typecheck
```

(Chạy từ `C:/dev 2/mediaos-dashbe1` — worktree riêng của lane này.)

---

## 10. Rủi ro / bàn giao

- **Hot-file:** `dashboard.module.ts` chỉ APPEND vào `controllers[]`/`providers[]`; `dashboard-widget-catalog.const.ts` chỉ APPEND (không sửa `DASH_WIDGET_CATALOG`/`DASH_WIDGET_GATE_PAIR`/`DASH_GRANT_MATRIX` hiện có — chúng là hợp đồng với mig 0484 đã land); `app.module.ts` KHÔNG đổi (DashboardModule đã import).
- **Tuple permission lệch ký tự:** `view-manager`/`view-hr`/`view-admin` PHẢI lấy nguyên từ `DASH_PERMISSION_PAIRS` (đã có `isSensitive` đúng) — gõ tay lại action/resourceType là nguồn lỗi 403-giả kinh điển (memory `wo-paths-drive-gate-and-scheduler`, `s1-fnd-module-metadata-seed-drift`).
- **Widget nhạy cảm module nguồn:** nếu tương lai thêm widget mới vào `DASH_WIDGET_CATALOG` mà quên thêm entry `DASH_WIDGET_GATE_PAIR` → registry phải LOẠI widget đó (fail-closed, bước 4 §4), KHÔNG throw 500 làm sập cả `/dashboard/me`.
- **Cache/TTL/Degraded/quick-action/`data` thật:** ngoài phạm vi — đó là `S4-DASH-BE-2`. Response widget của lane này CHỦ Ý `data: null` — FE (`S4-FE-DASH-1`, phụ thuộc `S4-DASH-BE-2`) sẽ lazy-load qua endpoint BE-2, KHÔNG parse `data` của endpoint này.
- **`SENSITIVE_CAPABILITY_ALLOWLIST` (permission.service.ts:43-93):** 3 cặp `view-manager|view-hr|view-admin:dashboard` là `is_sensitive=true` nhưng **CHƯA** có trong allowlist → `/auth/me` `capabilities` sẽ KHÔNG surface chúng cho FE (FE không tự ẩn/hiện nav theo `useCan()` được, dù backend enforcement ở lane này vẫn ĐÚNG vì `PermissionGuard`/`can()` không phụ thuộc allowlist). **CHỈ GHI NHẬN** — sửa allowlist ngoài phạm vi WO này (không phải lỗi của lane BE, là việc của lane FE khi `S4-FE-DASH-1`/`2` cần gate nav theo các cặp này; bài học lặp lại từ CAP-2/USEROPS-1/EXPORT-1/TASK-SEED-1 theo memory).
- **`dashboard_user_preferences` chưa build:** nếu owner sau này muốn "personal default dashboard" thật (SPEC §11.2 bước 1), cần WO DB riêng để thêm bảng — lane này KHÔNG tự thêm bảng.
- **Nợ lại:** `GET /dashboard/widgets(/…)` (BE-2), `DASH.CONFIG.*` CRUD (WO chưa mở), `/dashboard/summary` (chưa lên lịch), FE `PERMISSION_CODE_TO_PAIR` cho 4 cặp `view-*:dashboard` (nếu FE cần gate theo đúng các cặp mới, không phải theo `read:dashboard` cũ).
