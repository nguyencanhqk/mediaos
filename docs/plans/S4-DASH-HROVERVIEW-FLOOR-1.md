# S4-DASH-HROVERVIEW-FLOOR-1 — sàn scope `Department` cho widget DASH `HR_OVERVIEW` ở CẢ metadata lẫn đường số liệu; hằng sàn vào `packages/contracts` làm tín hiệu cho FE

> Vùng 🔴 red · FULL gate · MỘT PR (BE + contracts + test). Nhánh `fix/s4-dash-hroverview-floor-1`, cắt từ `6ac4ca48`. KHÔNG migration, KHÔNG sửa `apps/app`.
> Ký hiệu: **[ĐO]** = đã đọc mã/tệp ở `6ac4ca48` (file:dòng) · **[SUY RA]** = suy luận, xác nhận ở lát thi công.

## 1. Bối cảnh + quyết định owner

Widget `HR_OVERVIEW` (SPEC-07 §14.8, DASH-API-108) chỉ gác bằng cặp `read:employee`. Cả bốn vai chuẩn đều giữ cặp này, khác nhau ở scope ⇒ cặp một mình không phân biệt được HR với nhân viên. Server hiện không đặt sàn scope, nên người giữ `read:employee@Own|Team` gọi đường số liệu vẫn nhận 200 (số co về scope của họ). FE phải gác thay bằng vế `update:employee` ở `HrOverviewRailSlot.tsx` (S16-SOCIAL-FE-3C).

Quyết định owner 16/10/2026 (notes của WO — KHÔNG mở lại):

- **Q1** sàn Phòng ban ở SERVER — áp cho CẢ danh sách widget (metadata) LẪN `GET /dashboard/widgets/:slug`.
- **Q2** HR/Admin (scope Company) thấy cả công ty; người giữ scope Department chỉ thấy phòng mình (`SPEC-07 DASH.md:1198-1200`); quản lý @Team và nhân viên @Own KHÔNG nhận số liệu.
- **Q3** ô rail theo QUYỀN, không theo `dashboard_widget_configs` (trả lời SEC-03).
- **Q4** KHÔNG mở cho quản lý (ma trận quyền §7).
- **Q5** FE bỏ vế `update:employee` là WO FE nhỏ RIÊNG mở SAU — WO này chỉ BE + contracts.

## 2. Số đo

| #   | Phép đo                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | [ĐO] Cặp gate `HR_OVERVIEW: { action: "read", resourceType: "employee" }` — `dashboard-widget-catalog.const.ts:371-372`; mục catalog `:132-141` (`defaultDataScope: "Company"` chỉ là NHÃN, `:322`). Cặp `read:employee` `is_sensitive=false` (`0019_g5_permissions_seed.sql:19`).                                                                                                                                                 |
| M2  | [ĐO] Grant chuẩn `0444_s2_authseed1_canonical_roles_perms.sql:99-102`: employee@Own · manager@Team · hr@Company · company-admin@Company. KHÔNG vai chuẩn nào ở Department ⇒ ca Department phải dựng bằng vai tuỳ biến.                                                                                                                                                                                                             |
| M3  | [ĐO] `DASH_WIDGET_MIN_DATA_SCOPE` (`dashboard-widget-catalog.const.ts:470-507`) có 7 mã, KHÔNG có `HR_OVERVIEW`. `meetsMinDataScope` `:528-533` (vắng sàn ⇒ `true`; scope null ⇒ `false`).                                                                                                                                                                                                                                         |
| M4  | [ĐO] Đường metadata: `DashboardWidgetRegistryService.listWidgets` → `filterByGatePair` (`dashboard-widget-registry.service.ts:68`) gom MỌI widget khai sàn vào một `resolveManyOrNull`, giữ widget theo `meetsMinDataScope` (`:220-239`). Thêm khoá vào hằng là đủ cho `/dashboard/me`, 4 route type và `GET /dashboard/widgets`.                                                                                                  |
| M5  | [ĐO] Đường số liệu: `gateHrOverview` (`dashboard-widget-handlers.service.ts:470-488`) = `gateWidgetOrThrow` (403 «thiếu quyền») rồi `resolveAndAssert('read','employee')` — KHÔNG kiểm sàn. `?include_data=true` đi qua `getWidget` → `gateAndResolve` (`dashboard-widget-data.service.ts:188-215`, `:83`), 403 ⇒ omit.                                                                                                            |
| M6  | [ĐO] Tiền lệ sàn ở handler: SOCIAL `gateWithFloor` (`dashboard-widget-social.handlers.ts:163-181`) ném `ForbiddenException("AUTH-ERR-FORBIDDEN: thiếu quyền <cặp> ở phạm vi đủ rộng")`; cùng chỗ kiểm sàn ở office `:118`, recruit `:57`, payroll `:88` (thông điệp của ba nơi này xác nhận ở L3). Helper `expectScopeFloorDenied` của kit SOCIAL (`social-qa1-kit.ts:453-459`) đòi `AUTH-ERR-SCOPE-DENIED` — KHÔNG dùng cho DASH. |
| M7  | [ĐO] Scope Department của engine = đơn vị của chính mình ∪ đơn vị mình làm trưởng, KHÔNG gộp cây con; rỗng ⇒ 0 hàng (`data-scope.service.ts:153-186`, `buildEmployeeScopeCondition` `:174`). Danh sách HR dùng đúng vị từ này (`hr-read.service.ts:93-101`).                                                                                                                                                                       |
| M8  | [ĐO] Tham số client KHÔNG chảy vào phép đếm: `fetchHrOverview` truyền truy vấn cố định `{page:1,pageSize:100,sort,order}` (`dashboard-widget-handlers.service.ts:493-498`) — không `orgUnitId`/`search` từ request. `headcount = meta.total` đã co theo scope người xem.                                                                                                                                                           |
| M9  | [ĐO] Lỗi đếm: `byStatus`/`byOrgUnit` đếm trên ≤100 hàng đầu (`:499-505`) trong khi `headcount = meta.total` (`:508`). Phép đếm phía DB có sẵn chỉ cho `byStatus` (`hr-read.repository.ts:453-485` `summaryScopedTx` — không có `byOrgUnit`). `listHrEmployees` còn chạy `canBatch` mỗi hàng và ghi audit `view-salary`/`view-identity` khi người xem giữ grant hiện (`hr-read.service.ts:123-159`).                                |
| M10 | [ĐO] Cache: Company/System ⇒ một hàng chia sẻ toàn công ty; scope hẹp hơn ⇒ hàng riêng theo người (`:480-487`). `gateAndResolve` chạy MỌI lần serve kể cả cache hit (`dashboard-widget-gate.ts`, docblock «gate ⊥ fetch») ⇒ sàn ở gate chặn cả hàng cache cũ.                                                                                                                                                                      |
| M11 | [ĐO] Tín hiệu runtime ĐÃ có cho FE: `/auth/me` trả `scopes: Record<"action:resourceType", DataScope[]>` cho cặp non-sensitive (`packages/contracts/src/auth.ts:150-154`, BE điền fail-safe `auth.service.ts:1552-1585`). web-core có `hasScope`/`satisfiesScope` (`packages/web-core/src/lib/registry.ts:55-62`, `:287-292`). Thiếu: giá trị sàn dùng chung.                                                                       |
| M12 | [ĐO] `GET /dashboard/widgets` lọc theo `dashboard_widget_configs` (`registry.listWidgets` `:59-65`) ⇒ là tín hiệu THEO CẤU HÌNH, trái Q3. Cấu hình mặc định chỉ đặt `HR_OVERVIEW` ở loại HR (`dashboard-default-config.const.ts:40`).                                                                                                                                                                                              |
| M13 | [ĐO] Ca ghim số widget khai sàn = 7 (`test/foundation/dashboard-scope-roundtrip.unit-spec.ts:98-113`) ⇒ ĐỎ THEO THIẾT KẾ khi thêm `HR_OVERVIEW`. Spec cũ dùng `HR_OVERVIEW` đều cấp `read:employee@Company` (`dashboard-widget-security.int-spec.ts:288-293`, `dashboard-widget-data.int-spec.ts:662`) ⇒ không đỏ.                                                                                                                 |
| M14 | [ĐO] `auth-seed-canonical-roles.int-spec.ts:51` đã ghim scope `read:employee` của 4 vai (mục C); mục D (`:232-262`) ghim cặp VẮNG — chưa có `update:employee` cho employee/manager. Comment `dashboard-resolver.int-spec.ts:11-14` (a) «HR_OVERVIEW không phân biệt employee/hr» sẽ cũ sau WO.                                                                                                                                     |
| M15 | [ĐO] Kích thước: `dashboard-widget-handlers.service.ts` 784 dòng · `dashboard-widget-catalog.const.ts` 739 · `hr-read.service.ts` 564 · `hr-read.repository.ts` 578.                                                                                                                                                                                                                                                               |

## 3. Quyết định

- **D-1 (H1) Cặp + nguồn scope.** Giữ cặp `read:employee` (không đổi cặp, KHÔNG flip `is_sensitive` — bẫy ô biến mất im lặng với HR, notes WO). Scope = `DataScopeService.resolveAndAssert` (grant mạnh nhất) ở đường số liệu — đã gọi ở `:474`; `resolveManyOrNull` ở đường metadata (M4). Không thêm truy vấn mới.
- **D-2 (H1) Giá trị sàn = `Department`**, KHÔNG `Company`: Q2 cho người giữ Department xem phòng mình. Ngữ nghĩa Department = của engine (M7: own ∪ headed, không cây con) — cùng tập với màn danh sách HR; «phòng ban tương ứng» của SPEC-07:1200 [SUY RA] = scope Department của engine. Không tự dựng luật cây con (sẽ lệch mọi module khác).
- **D-3 (H2) Hai tầng, MỘT hằng.** (a) thêm `HR_OVERVIEW: "Department"` vào `DASH_WIDGET_MIN_DATA_SCOPE` ⇒ metadata tự loại (M4); (b) `gateHrOverview`: sau `resolveAndAssert`, `if (!meetsMinDataScope("HR_OVERVIEW", scope))` ⇒ 403. Thứ tự giữ nguyên: cặp → scope → sàn → cache identity; KHÔNG chuyền scope sang `fetch`.
- **D-4 (H2) Mã lỗi** = quy ước DASH hiện có (M6): `AUTH-ERR-FORBIDDEN: thiếu quyền read:employee ở phạm vi đủ rộng`, `error.code = AUTH-ERR-FORBIDDEN`. Không dùng `AUTH-ERR-SCOPE-DENIED` (đó là `companyFloor` cấp route của SOCIAL).
- **D-5 (H2) Không kênh rò khác.** Tham số client không vào phép đếm (M8); `include_data` đi qua cùng gate (M5); hàng cache cũ bị gate chặn trước khi đọc (M10); `headcount` co theo scope. Không có route export/summary nào khác của DASH dùng nguồn này [ĐO grep `hr-overview`: chỉ handler `:165-168`].
- **D-6 (H3) Tín hiệu FE = hằng sàn trong contracts + `scopes` có sẵn của `/auth/me`.** Dời map `DASH_WIDGET_MIN_DATA_SCOPE` sang tệp mới `packages/contracts/src/dashboard-widget-floor.ts` (kèm lý do từng khoá, viết trung tính), export cộng thêm ở `packages/contracts/src/index.ts`; `dashboard-widget-catalog.const.ts` import + re-export CÙNG tên (nơi import hiện có — `dashboard-widget-registry.service.ts:11` và `dashboard-scope-roundtrip.unit-spec.ts:26` — không đổi). `meetsMinDataScope` + `DASH_SCOPE_STRENGTH` ở lại BE. WO FE sau dùng `hasScope("read:employee", DASH_WIDGET_MIN_DATA_SCOPE.HR_OVERVIEW)` thay vế `update:employee`. Loại: route mới `/…/access` (thêm route census + một request), metadata `/dashboard/widgets` (theo cấu hình — trái Q3, M12), literal `"Department"` ở FE (trôi), trường mới trong response số liệu (FE vẫn phải gọi trước).
- **D-7 (H3) Tương thích hai chiều.** Shape DTO số liệu KHÔNG đổi; contracts chỉ THÊM export. FE cũ + API mới: HR/company-admin (Company) không đổi; vai tuỳ biến có `update:employee` nhưng `read:employee` < Department ⇒ ô hiện trạng thái lỗi 403, không lộ số (chấp nhận, WO FE đóng). FE mới + API cũ: FE chặt hơn server (ẩn Own/Team); Department nhận số theo phòng như API cũ vẫn tính ⇒ không vỡ. Thứ tự an toàn: API lên trước khi WO FE merge (§8).
- **D-8 (H4) Lỗi đếm `pageSize:100` → NỢ (N1), không sửa ở WO này.** Đếm `byOrgUnit` phía DB cần (a) method mới trong `apps/api/src/employees/**` (ngoài `paths`), hoặc (b) truy vấn thô bảng HR từ `dashboard/**` — trái luật của chính module (`dashboard-widget-handlers.service.ts:71-73`) và tạo bản sao thứ hai của vị từ scope (LEFT JOIN users, `hr-read.repository.ts:447-451`). Trộn `getEmployeesSummary` (byStatus đúng) với danh sách (byOrgUnit ≤100) cho hai tổng lệch nhau — tệ hơn hiện trạng. Theo luật H4 của đợt ⇒ ghi nợ; sàn KHÔNG phụ thuộc phép đếm. Quy mô PROD theo brief = 49 hồ sơ (< 100) — chưa ai thấy số sai.
- **D-9 (H6) Không migration, không seed.** Cặp đã có (M1, M2); sàn là hằng mã. Không cần `stopReason`.
- **D-10 Kích thước tệp.** `dashboard-widget-handlers.service.ts` 784 → ≤ 795 (thêm ≤ 10 dòng). Nếu vượt 800 ⇒ tách gate+fetch `HR_OVERVIEW` sang `dashboard-widget-hr.handlers.ts` (khuôn SOCIAL/office), KHÔNG nén comment. Catalog const ngắn lại (map dời đi).
- **D-11 (H7) Gate FULL:** `security-reviewer` + `silent-failure-hunter` + `typescript-reviewer` + `santa-method` ×2 + `quality-gate`. KHÔNG `database-reviewer` (không chạm SQL/repository/migration) — nếu N1 bị kéo vào thì thêm.

## 4. Bất biến phải giữ

1. Người giữ `read:employee` dưới Department (Own/Team) hoặc không có cặp: KHÔNG nhận widget ở metadata và nhận 403 ở đường số liệu — kể cả khi widget bị bật tay qua `dashboard_widget_configs` và kể cả cache hit.
2. Department chỉ đếm hồ sơ trong đơn vị của mình ∪ đơn vị mình làm trưởng; không có đơn vị ⇒ 0, không bao giờ «cả công ty».
3. Company/System không đổi hành vi (một hàng cache chia sẻ, không lương/PII). `company_id`/RLS/`withTenant` không đổi.
4. Metadata và đường số liệu đọc CÙNG một hằng sàn; BE và contracts là CÙNG một đối tượng.

## 6. Ca test

Spec mới `apps/api/test/integration/dashboard-hr-overview-floor.int-spec.ts` dựng bằng `bootQa1World` (`social-qa1-kit.ts:191` — `applyMainPipeline` + `listen(0)`), khuôn actor/vai tuỳ biến/đơn vị như `dashboard-social-widgets.int-spec.ts:320-337`. Thế giới A: đơn vị U1, U2 (mỗi đơn vị ≥ 2 hồ sơ, có người ở U2 ngoài phòng của `dept`); cấu hình công ty A bật tay `HR_OVERVIEW` cho loại Employee và Manager (đường rò của bất biến 1). Actor: `hr` (chuẩn) · `ca` (chuẩn) · `mgr` (manager chuẩn, U1) · `emp` (employee chuẩn, U1) · `dept` (tuỳ biến: `read:dashboard` + `view-employee:dashboard` + `read:employee@Department`, U1) · `deptNoUnit` (như `dept`, không đơn vị) · `none` (tuỳ biến, không `read:employee`). Thế giới B: `hrB` + đơn vị mốc riêng.

| Ca  | Đường                                                         | Kỳ vọng                                                                                | Trên mã cũ         |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------ |
| A1  | `hr` GET `/dashboard/widgets/hr-overview`                     | 200; `headcount` = đếm SQL hồ sơ A; Σ`byStatus` = `headcount`; `byOrgUnit` có U1 và U2 | ALLOW đứng cạnh    |
| A2  | `ca` cùng route                                               | như A1                                                                                 | ALLOW đứng cạnh    |
| A3  | `dept` (@Department, U1) cùng route                           | 200; `headcount` = đếm SQL U1 (< A1); khoá `byOrgUnit` = {U1}                          | ALLOW đứng cạnh    |
| A4  | `deptNoUnit` cùng route                                       | 200 `Empty`, `headcount` = 0 (không match-all)                                         | ALLOW đứng cạnh    |
| D1  | `mgr` (@Team) cùng route                                      | 403 `AUTH-ERR-FORBIDDEN`, thông điệp «ở phạm vi đủ rộng», thân không có `headcount`    | **RED** (200)      |
| D2  | `emp` (@Own) cùng route                                       | như D1                                                                                 | **RED** (200)      |
| D3  | `none` cùng route                                             | 403 «thiếu quyền read:employee» (KHÔNG phải thông điệp sàn)                            | ALLOW đứng cạnh    |
| D4  | `hr` làm ấm cache, rồi `emp` gọi                              | 403 như D2 — cache chia sẻ không lọt                                                   | **RED**            |
| M1  | `emp` GET `/dashboard/me` (loại Employee có cấu hình bật tay) | không có `HR_OVERVIEW`; đối chứng `dept` cùng loại + cùng cấu hình ⇒ CÓ                | **RED** / ALLOW    |
| M2  | `emp` GET `/dashboard/widgets` và `?include_data=true`        | không có `HR_OVERVIEW`                                                                 | **RED**            |
| M3  | `mgr` GET `/dashboard/manager`                                | không có `HR_OVERVIEW`                                                                 | **RED**            |
| M4  | `hr` GET `/dashboard/hr`                                      | CÓ `HR_OVERVIEW` (cấu hình mặc định)                                                   | ALLOW đứng cạnh    |
| X1  | `hrB` / `hr`                                                  | số B chỉ của B, `byOrgUnit` không chứa tên đơn vị A (và ngược lại)                     | ALLOW (cô lập)     |
| U1  | unit `meetsMinDataScope("HR_OVERVIEW", s)`                    | Own/Team/null ⇒ false · Department/Company/System ⇒ true                               | **RED** (Own→true) |
| U2  | unit: map contracts                                           | đúng 8 khoá + giá trị ghim; BE `DASH_WIDGET_MIN_DATA_SCOPE` `toBe` đối tượng contracts | **RED** (chưa có)  |
| U3  | `dashboard-scope-roundtrip.unit-spec.ts:98-113`               | 7 → 8 (sửa con số + comment, đỏ theo thiết kế)                                         | đổi có chủ đích    |
| S1  | `auth-seed-canonical-roles.int-spec.ts` mục D                 | employee + manager KHÔNG có `update:employee` (chiều VẮNG của vế FE tạm)               | xanh (ghim)        |

Bằng chứng RED: chạy spec mới + U1/U2 trên mã cũ (chỉ thêm test) TRƯỚC khi sửa `src` — kỳ vọng đúng các ca **RED** ở bảng đỏ, mọi ca ALLOW xanh.

**Mutant ★** (mỗi cái: sửa tạm → chạy → ghi số ca đỏ → hoàn tác):

- ★ M-a bỏ khoá `HR_OVERVIEW` khỏi map ⇒ D1, D2, D4, M1, M2, M3, U1, U2 đỏ.
- ★ M-b giữ map, bỏ kiểm sàn trong `gateHrOverview` ⇒ D1, D2, D4 đỏ; M1–M3 VẪN xanh (chứng minh hai tầng độc lập).
- ★ M-c sàn `Company` ⇒ A3, A4 đỏ (giấu widget khỏi người giữ Department).
- M-d sàn `Team` ⇒ D1 đỏ.
- M-e so sánh `>` thay `>=` ở `meetsMinDataScope` ⇒ A3, U1 đỏ (và ca sàn SOCIAL/ASSET hiện có).
- M-f BE giữ bản map cục bộ lệch contracts ⇒ U2 đỏ.

## 7. Lát thi công

Mọi lệnh nặng chạy qua wrapper khoá chung của đợt (`run-heavy.sh A <log> …`, ngoài repo); lọc theo tệp, ≤ 3 tệp/lượt; tiêu chí xanh = có dòng «Test Files» + exit 0.

- **L1 RED** — viết spec mới + U1/U2 (U2 tạm import đường contracts dự kiến ⇒ đỏ vì chưa có); chạy trên mã cũ; ghi số ca đỏ vào §9.3.
- **L2 contracts** — tạo `dashboard-widget-floor.ts` (8 khoá: 7 cũ y nguyên giá trị + `HR_OVERVIEW: "Department"`), export cộng thêm ở `index.ts`; build contracts.
- **L3 BE** — catalog const: import + re-export map, xoá bản cục bộ, cập nhật comment `:371` (cặp chưa đủ một mình, xem sàn); `gateHrOverview` thêm kiểm sàn theo D-3/D-4; U3 7 → 8; sửa comment cũ `dashboard-resolver.int-spec.ts:11-14` (a). Kiểm `wc -l` theo D-10.
- **L4** S1 ở `auth-seed-canonical-roles.int-spec.ts`.
- **L5 GREEN** — spec mới; `dashboard-widget-security` + `dashboard-widget-data` + `dashboard-resolver`; `dashboard-social-widgets` + `dashboard-office-widgets` + `dashboard-payroll-cost` (hồi quy sàn khác); `dashboard-scope-roundtrip` + `dashboard-widget-gate.spec.ts` + `pipeline-parity.unit-spec.ts`; `auth-seed-canonical-roles`.
- **L6** mutant ★ M-a, M-b, M-c (bắt buộc), M-d…M-f nếu còn ngân sách.
- **L7** typecheck contracts + api; eslint các tệp đổi; `prettier --write` từng tệp.
- **L8** gate FULL (D-11); vá; commit `fix(dashboard): S4-DASH-HROVERVIEW-FLOOR-1 — …`. Trước khi luồng chính mở PR: `harness/check.sh --all` (int-spec skip phải = 0 trên lane).

## 8. [OWNER]

- **O1** merge PR (tự tác giả ⇒ `--admin` theo lệ).
- **O2** deploy API (build contracts + api; KHÔNG migration). API PHẢI lên trước khi WO FE (N2) merge. FE Pages tự lên không đổi hành vi (FE chưa import hằng mới).
- **O3** đo sau deploy: `/api/v1/health` trả commit ≥ merge; tài khoản HR: ô «Tổng quan nhân sự» ở rail bảng tin và màn Dashboard HR vẫn có số; một tài khoản nhân viên: route số liệu widget trả 403 (đo qua trình duyệt/nhật ký, không cần dữ liệu PROD trong plan).
- **O4** mở WO FE N2 sau O3.

## 9. Nợ

- **N1 `S4-DASH-HROVERVIEW-COUNT-1`** (BE, paths `apps/api/src/employees/hr-read.*` + `dashboard/**`): đếm `byStatus`/`byOrgUnit`/`headcount` phía DB trong MỘT vị từ scope (method count-only mới của `HrReadService`), bỏ gọi `listHrEmployees` ⇒ hết lệch tổng khi > 100 hồ sơ và hết `canBatch` + audit `view-salary`/`view-identity` mỗi hàng khi cache miss với người xem giữ grant hiện [SUY RA từ M9 — vai chuẩn không có `view-salary` (`0445_s2_hrseed1_hr_perms.sql:28`), phải đo]. Kích hoạt: trước khi số hồ sơ chạm 100.
- **N2 WO FE** (`apps/app/src/routes/social/feed/components/HrOverviewRailSlot.tsx`): thay vế `update:employee` bằng `hasScope("read:employee", DASH_WIDGET_MIN_DATA_SCOPE.HR_OVERVIEW)` (vẫn khớp đúng-bằng, không wildcard); ba spec đỏ theo thiết kế (`HrOverviewRailSlot.spec.tsx` · `.gate.spec.tsx` · `SocialPortalShell.hr-widget.spec.tsx`) — sửa ca theo cổng mới, không nới. Điều kiện: O3 đạt.
- **N3** `EMPLOYEE_SUMMARY` + `NEW_EMPLOYEES` dùng chung `read:employee`, không sàn (`dashboard-widget-catalog.const.ts:377-387`); ma trận §7 ghi MGR/EMP «—». Giá trị sàn cần owner chốt ⇒ seed WO kèm câu hỏi.
- **N4** Payload widget (`headcount`/`byStatus`/`byOrgUnit`) lệch 6 trường của SPEC-07 §14.8 (`total_active_employees` · `probation_count` · …) — nợ tài liệu/tính năng.

### 9.3 Sổ vết

| Mốc     | Ngày       | Ai      | Nội dung                                                                                           |
| ------- | ---------- | ------- | -------------------------------------------------------------------------------------------------- |
| Plan v1 | 23/10/2026 | planner | Đo M1–M15; chốt D-1…D-11; không migration; H4 → nợ N1; tín hiệu FE = hằng sàn contracts + `scopes` |
