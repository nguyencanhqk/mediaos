# S16-SOCIAL-FE-3 — FE track C: Kiểm duyệt · Thống kê · Huy hiệu · dải ô liên kết nhanh · widget Nhân sự

> Trạng thái: **plan v1 (05/10/2026)** — chờ `plan-reviewer` + chữ ký owner (§0). Nhánh `feat/s16-social-fe-3`
> cắt từ `origin/master` `b637f3d6`. Zone amber, gate LIGHT. Quyền chỉ qua `useCan`/`PermissionGate`/`useCanExact`
> và `ROUTE_REGISTRY`; masking là việc của server; KHÔNG thêm dependency.
> Đo bằng 6 bản đồ đọc-hiểu (spec · backend · kiến trúc FE · quyền/registry · nhúng DASH · test/cổng) + đối chiếu
> chéo; mọi dòng §1 đã tự mở file xác minh lại trên `b637f3d6`. Chưa chạy test/build ở bước lập kế hoạch.

## 0. Phạm vi · ngoài phạm vi · chữ ký owner

**Trong phạm vi (5 phần của WO + 1 phần nợ đã ký giao):**
P1 `SOC-SCREEN-010` Kiểm duyệt (hàng đợi báo cáo 028/029 + bài đang ẩn 001/006) · P2 `SOC-SCREEN-011` Thống kê
tương tác (052 + xuất XLSX 053) · P3 `SOC-SCREEN-012` Thiết lập huy hiệu (056/049/050/051) · P4 dải ô liên kết
nhanh trên `/feed` · P5 widget DASH «Nhân sự» ở rail phải · **P1b** nút «Báo cáo» trên thẻ BÀI + hộp thoại soạn +
cảnh báo SOC-DEC-011 (027 — owner ký 23/09 giao cho WO này, M5).

**Ngoài phạm vi (ghi nợ ở §8):** nút «Báo cáo» trên BÌNH LUẬN (`CommentList.tsx` đang nằm trong 2 nhánh FE-2D) ·
thùng rác bài viết 057/058 · mọi thay đổi `apps/api/**`, migration, seed quyền, `packages/contracts` ·
`SOCIAL-WIDGET-001/002` (thuộc `S16-SOCIAL-DASH-1`) · sửa `HrOverviewWidget`/`DashboardWidgetGrid` gốc ·
sửa SPEC/UI-07 (ngoài `paths`).

> ✍️ **Ô chữ ký owner (để trống — chờ ký):**
> **O1** (D15) Ai thấy widget «Nhân sự» ở rail bảng tin?  ☐ A mọi người có `read:employee`  ☐ **B chỉ HR +
> company-admin (khuyến nghị)**  ☐ C hoãn, tách WO.  _Không trả lời ⇒ C (không nhúng, L7 không thi công)._
> **O2** (D2) Thêm 3 mục rail trái «Kiểm duyệt» · «Thống kê tương tác» · «Thiết lập huy hiệu»?  ☐ **a cả 3 mục
> (khuyến nghị)**  ☐ b chỉ 2 mục đầu, Huy hiệu vào từ nút ở `/feed/kudos`  ☐ c không mục nào (chỉ URL + link NOTI).
> _Không trả lời ⇒ a._
> **Ghi nhận (không cần trả lời, phản đối thì ghi ở đây):** sửa chữ 3 dòng `done_when` theo §8 (D1, D14, D16) ·
> tách WO thành FE-3 / FE-3B / FE-3C theo 3 PR tuần tự (D17).

## 1. Phép đo (05/10/2026 trên `b637f3d6`)

Viết tắt: `S/` = `apps/api/src/social/` · `C/` = `packages/contracts/src/` · `W/` = `packages/web-core/src/` ·
`A/` = `apps/app/src/`.

| # | Đo | Kết quả |
| --- | --- | --- |
| M1 | FE-3 có cần API mới hơn PROD `14afbb5f`? | **Không.** `git merge-base --is-ancestor` cho BE-3A `4cf305a4` · BE-3B `29e49082` · BE-3C `86fcb72f` → `14afbb5f` = ANCESTOR ×3. Sau `14afbb5f` chỉ 4 commit chạm `apps/api/src`+contracts (#568 `f72ea8f2` · #567 `af314526` · #566 `19a7a6e4` · #560 `a5ecaf0e`) — không commit nào thêm route FE-3 gọi. #568 (ký URL avatar) CHƯA lên PROD ⇒ D8. |
| M2 | 028 `GET /social/reports` | `S/social-b.controllers.ts:177-179`. Cặp `view:feed-report`, `companyFloor:false`, `dataScope:"Department"` (`S/social-route-pairs.const.ts:207`). Query `{status?, page=1, limit=20}` `.strict()` (`C/social-api-b.ts:281-287`) — vắng `status` = mọi trạng thái. Trả `{data,page,limit,total}` (`:410-415`). DTO tập khoá đóng (`:393-407`); `reporter:null` = **che theo scope**, khác object có `employeeId:null` (`:373-391`); `targetSnapshot` có `status`/`deletedAt`, đọc xuyên cổng hiển thị (`:353-362`). |
| M3 | 029 `PATCH /social/reports/:report_id` | `S/social-b.controllers.ts:186-188`. Cặp `manage:feed-report`, tầng 1 là SÀN (`const.ts:227`). Body `{status:'resolved'\|'dismissed', resolutionNote? ≤1000, action='none'}` `.strict()` + refine «`dismissed` ⇒ `action:none`» (`C/social-api-b.ts:310-327`; `FEED_NOTE_MAX=1000` `C/social-api.ts:53`). Ma trận: post → `none·hide_post·lock_comments·delete_target`; comment → `none·lock_comments·delete_target` (`S/social-report-actions.ts:20-23`). `action≠none` đòi THÊM `manage:feed-post` (`const.ts:553-557`; `social-report-actions.ts:41-45`). Trả MỘT `feedReportSchema`. |
| M4 | Bài đang ẩn | 001 nhận `status` ∈ `published\|hidden` (`C/social-api.ts:83`); thiếu `canManagePosts` ⇒ **403** `MODERATION_FIELD_DENIED` = `SOCIAL-ERR-010` (`S/social-posts.service.ts:105-107`; `C/social-errors.ts:37`); vắng `groupId` ⇒ LOẠI bài nhóm (`:124`); keyset, không `total`. Client có sẵn `socialApi.listFeed` (`W/lib/social-api.ts:115-116`) + `moderatePost` (`:198`). 006 = `manage:feed-post` sàn (`const.ts:156`). Không có route ẩn BÌNH LUẬN. |
| M5 | 027 `POST /social/reports` | `S/social-b.controllers.ts:161-164` `@Idempotent()`, cặp `view:feed` (`const.ts:196`). Body `{targetType,targetId,reason,note?≤1000}` `.strict()` (`C/social-api-b.ts:270-277`). Trả **`{ id }`** (`S/social-reports.service.ts:94`). Trùng báo cáo đang mở ⇒ 409 `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` (`:117-118`; `C/social-errors.ts:41`). FE: nút CỐ Ý vắng, «đi cùng một lượt ở S16-SOCIAL-FE-3» (`A/routes/social/feed/components/PostCardMenu.tsx:18-20`; `docs/plans/S16-SOCIAL-FE-1.md:337` N8, owner ký 23/09). |
| M6 | 052/053 thống kê | `S/social-stats.controller.ts:45-48` (052) · `:28-30` (053). **CÙNG** cặp `view:feed-report`, cùng `companyFloor:false` (`const.ts:237,239`) ⇒ cổng TẢI = cổng XEM. Query `{from?,to?,orgUnitId?}` `.strict()`: `from`/`to` đi cùng nhau, ngày phải tồn tại, `from≤to`, sau nắn ≤ 26 tuần (`C/social-api-stats.ts:12,63-98`); vắng ⇒ 8 tuần (`:14`). `snapToIsoWeeks` export (`:47-61`). Trả `{range,units,rows,weekTotals}` (`:131-136`); `rows.orgUnitId` nullable (`:117-121`); `activeMembers` tuần là DISTINCT (`:124`). 053 đặt header XLSX ở đường THÀNH CÔNG (`controller.ts:37-40`) ⇒ lỗi vẫn là JSON. |
| M7 | Huy hiệu quản trị | 056 `GET kudos-badges/manage` (`S/social-b2b2.controllers.ts:146-148`) · 049 `POST` `@Idempotent` (`:155-158`) · 050 `PATCH` (`:165-167`) · 051 `DELETE` (`:178-180`); cả bốn `manage:feed-kudos` (`const.ts:334-340`). `code` `^[a-z0-9-]{2,32}$` (`C/social-api-kudos.ts:110-112`); tạo (`:120-128`); sửa `.strict()` KHÔNG có `code`, ≥1 trường (`:135-146`); DTO quản trị có `isActive` (`:150-160`); 056 `limit` mặc định 50 (`:164-169`). 048 công khai dùng schema KHÁC (`:73-80`). |
| M8 | Cặp nào tới được FE | 14 cặp `feed-*` đều `is_sensitive=false` (`apps/api/migrations/0578_s16socialdb1_seed_feed_perms.sql:40-54`) ⇒ `/auth/me` phát hết. `manage:feed-post`·`feed-kudos`·`feed-report` → hr + company-admin @Company (`:94-101`); `view:feed-report` → manager@**Department** + hr + company-admin (`:108-110`). |
| M9 | Hai họ cổng FE | Route/sidebar/ô app dùng `createPermissionChecker` — khớp ĐÚNG-BẰNG, không wildcard (`W/lib/registry.ts:262-271`); `requiredPermissions` = đủ hết, `requiredAnyPermissions` = một trong, áp CẢ HAI (`:302-332`). Trong màn dùng `useCan` (có wildcard) cho cặp `feed-*` (`PostCardMenu.tsx:52-55`). |
| M10 | Route SOCIAL | 11 mục `ROUTE_REGISTRY`, `order` 92..102, tất cả `MODULE_PORTAL` + `requiredPermissions:["view:feed"]` (`W/lib/registry.ts:2218-2356`) ⇒ mục mới từ **103**. Router: `getMeta` (`A/router.tsx:83`), khuôn `createRoute` + `getMeta("social.kudos")` (`:3194`), route chuyển hướng NOTI (`:3228-3237`, cây `:3644-3645`). `/social/reports` (NOTI-036) chưa có route — «chờ S16-SOCIAL-FE-3» (`A/routes/social/legacy-social-redirects.ts:7-8`). |
| M11 | Sidebar | `SOCIAL_SIDEBAR_V2` 7 mục, order 10..60, nhóm `overview`/`operation` (`A/layouts/workspace/sidebar/social.ts:34-111`), đi qua `pruneUnbuiltScreens` (`:117`). Nhóm hợp lệ: overview · operation · master-data · management · report · settings · admin (`ModuleSidebar.tsx:42-50`). Active = `pathname === path \|\| startsWith(path+"/")` (`:55-56`). `ICON_MAP` có `shield-alert` · `settings` · `award`; KHÔNG có `bar-chart-3`, `facebook` — rơi về `Circle` (`DynamicIcon.tsx:73-153`). |
| M12 | Ratchet/snapshot sẽ đổi | `A/routes/social/social-wiring.spec.ts`: `:46` (7 mục) · `:47-55` (thứ tự khoá) · `:91` (11 route) · `:117-127` (7 route `showInSidebar`) — **đỏ có chủ ý**. Giữ xanh nếu tuân: `:95-100` (mọi route CHỨA `view:feed`) · `:103-108` (`MODULE_PORTAL`) · `:111-114` + `:228` (dưới `/feed`). Snapshot: `sidebar-registry.snapshot.spec.ts:118-140` ghi 2 file `__snapshots__/sidebar-tree.{raw,by-permission}.txt` (khối `### SOCIAL` `raw.txt:120-127`; định dạng `all=[…]`/`any=[…]` `:77-79`); ca «không quyền ⇒ rỗng» `:143`. `W/lib/registry.spec.ts:1313-1322` routeKey + path duy nhất. |
| M13 | Client + khoá cache đang thiếu | `W/lib/social-api.ts:88` (027..029 cố ý chưa mirror); `W/lib/social-kudos-api.ts:28-46` chỉ `list`·`searchRecipients`·`listBadges`; `socialKeys` (`W/lib/query-keys.ts:1377-1478`) không có reports/stats/badges-admin; `kudos.badges()` KHÔNG tham số (`:1476`). |
| M14 | Báo lỗi | App không có toast; `ActionErrorBanner` tập `kind`/`reason` ĐÓNG (`A/routes/social/feed/components/ActionErrorBanner.tsx:27-49,58-73`) — file này nằm trong nhánh fe-2d-a (M19). Đọc mã: `socialErrorCode` · `isForbiddenError` · `isStaleStateError` (`A/routes/social/groups/lib/group-errors.ts:55,101,109`). Mã idempotency: `C/idempotency.ts:27-29`. |
| M15 | Mẫu tải file | `apiFetchBlob` → `{blob, filename\|null}`; `!ok` ⇒ ném `ApiError` (`W/lib/api-client.ts:587-591,612-620,630`). Nút mẫu `A/routes/attendance/ExportAttendanceButton.tsx:40-80`; `triggerBlobDownload` (`A/lib/download-blob.ts:12` — ngoài `paths`, chỉ IMPORT). API `enableCors` (`apps/api/src/main.ts:43`) không khai `exposedHeaders` (grep 0) ⇒ `filename` có thể `null` khi cross-origin ⇒ BẮT BUỘC tên dự phòng `.xlsx`. |
| M16 | Recharts | ĐÃ cài `^3.10.1` (`apps/app/package.json:37`); nơi dùng duy nhất `A/routes/payroll/components/overview/OverviewCharts.tsx`; `ChartCard` 5 trạng thái + nút chuyển bảng (`A/components/charts/ChartCard.tsx:7,20,49` — ngoài `paths`, chỉ IMPORT). `A/test/setup.ts` (4 dòng) không polyfill `ResizeObserver`; chưa spec nào render Recharts. |
| M17 | Dải ô (P4) | 7 `appKey` có đủ trong `APP_REGISTRY` (`W/lib/registry.ts`): `attendance` any 3 mã `:618` · `leave` any `:636` · `tasks` any `:654` · `goals` `access:goal` `:705` · `lms` `access:lms` `:771` · `fbpost` **MỘT cặp** `view:social-post` `:842`, `switcherOnly` `:843`, icon `facebook` `:837` · `rooms` ĐỦ `access:room`+`view:room` `:886`. `getVisibleApps` (`:958-978`) trả cả app trạng thái khác `active` dù không quyền (`:971-972`); `getHomeGridApps` LOẠI `switcherOnly` (`:987-993`). Mở cross-domain: `getCrossDomainOpener` never-throw (`A/layouts/home/cross-domain-apps.ts:26-37`), khuôn gọi `AppSwitcher.tsx:187-192`. Session portal `modules: []` (`A/layouts/portal/portal-session.ts:27-33,41-56`). Nhãn registry: «Phòng họp», «Đăng bài Facebook» (`W/i18n/locales/vi/nav.ts:26,30`). Chỗ chèn: trên `<FeedComposer>` (`A/routes/social/feed/FeedPage.tsx:152`). Owner đã ký một cặp cho fbpost (`docs/plans/S16-SOCIAL-FBPOST-1.md:56`). |
| M18 | Widget «Nhân sự» (P5) | `HrOverviewWidget` gác ngoài `<PermissionGate read:employee>`, Inner mới phát request (`A/components/dashboard/HrOverviewWidget.tsx:22-27,77-84`). Route data gác `read:dashboard` (`apps/api/src/dashboard/dashboard-widget-data.controller.ts:39-40`); widget gác `read:employee` (`dashboard-widget-catalog.const.ts:347`), KHÔNG có sàn scope (`:435`). `read:employee` non-sensitive (`migrations/0019_g5_permissions_seed.sql:17-21`) cấp CẢ 4 vai (`0444_s2_authseed1_canonical_roles_perms.sql:99-102`) ⇒ cặp này không tách được ai. `view-hr:dashboard` `isSensitive:true` (`catalog.const.ts:518-521`) và vắng allowlist ⇒ KHÔNG tới FE. Cặp non-sensitive chỉ hr + company-admin giữ: `create`/`update`/`change-status:employee` (`0444:108-115`), FE có hằng `HR_ENGINE_PAIRS.UPDATE_EMPLOYEE` (`A/routes/hr/constants.ts:70`). Chỗ cắm: sau `<MyGroupsWidget>` (`A/routes/social/feed/SocialPortalShell.tsx:205-209`); spec shell giữ web-core THẬT (`SocialPortalShell.spec.tsx:39-60`). UI-07 đặt widget CUỐI rail «(theo quyền)» (`docs/UI/UI-07_Module_Workspace_Template_Design.md:2159-2160`); SPEC-07 «chỉ HR/Admin… hoặc user có quyền HR overview» (`docs/SPEC/SPEC-07 DASH.md:1198`). |
| M19 | Chồng lấn 2 nhánh FE-2D (`git diff --name-only origin/master...`) | `feat/s16-social-fe-2d` 28 file · `feat/s16-social-fe-2d-a` 54 file. FE-3 BUỘC chạm 3 file chung: `W/index.ts` (fe-2d-a nối 9 dòng sau `:417`) · `A/i18n/locales/vi/social.ts` (fe-2d-a thêm import sau `:20`, khoá sau `:408`) · `harness/backlog.mjs`. Hai nhánh KHÔNG chạm: `router.tsx` · `registry.ts` · `query-keys.ts` · `nav.ts` · `sidebar/social.ts` · `DynamicIcon.tsx` · `SocialPortalShell.tsx`(+spec) · `FeedPage.tsx` · `PostCardMenu.tsx` · `legacy-social-redirects.ts` · `KudosBadgeIcon.tsx` · `social-wiring.spec.ts` · `social-kudos-api.ts`. |
| M20 | Cổng CI/test | `social-cov`: đo `src/routes/social/**` + `src/layouts/portal/**`, sàn 80 × 4 trục, loại `*.spec` + `feed/social-test-doubles.tsx` (`apps/app/vitest.social.config.ts:41-58`); bước CI `apps-frontend.yml:141`. Chạm `packages/**` ⇒ CI chạy cả auth + console + app (`:68-70`). `check.sh` 3 tầng `--quick` / mặc định / `--all` (`harness/check.sh:8-10`); chunk runner nhận `--packages=` `--max-forks=` `--no-build` (`harness/chunk-test.mjs:123-127`). Không có `@testing-library/user-event`, axe, ratchet khoá i18n. |
| M21 | File đã vượt trần 800 | `router.tsx` 3666 · `registry.ts` 2394 · `query-keys.ts` 1478 (nợ sẵn có — FE-3 chỉ NỐI, không cổng nào ép). `social.ts` (i18n) 487 · `W/index.ts` 417. |
| M22 | i18n | MỘT namespace `social` (`A/i18n/index.ts:38,57`); cụm lớn tách file con gắn ở `social.ts:19-20,406,408`. |

## 2. Quyết định

- **D1 — cổng màn Kiểm duyệt theo SPEC, không theo chữ `done_when` [KỸ THUẬT].** `done_when` #1 ghi «chỉ hiện với
  manage:feed-report/manage:feed-post»; SPEC-16:236 + guard 028 + seed (M2, M8) cho manager vào CHỈ-ĐỌC. Phương án:
  (a) theo SPEC · (b) theo done_when (manager mất màn mà server + NOTI-036 mở cho họ). **Chọn (a):** route
  `["view:feed","view:feed-report"]`; nút «Xử lý» `manage:feed-report`; lựa chọn hành động kèm + tab «Bài đang ẩn»
  + «Hiện lại» `manage:feed-post`. Sửa chữ done_when ở §8.
- **D2 — lối vào 3 màn quản trị [OWNER · O2].** UI-07 §34b.2 không liệt kê; SPEC-16:446 đòi «forbidden = ẩn mục khỏi
  sidebar». (a) 3 mục rail: «Kiểm duyệt» nhóm `management` order 70 icon `shield-alert` · «Thống kê tương tác» nhóm
  `report` order 80 icon `bar-chart-3` · «Thiết lập huy hiệu» nhóm `settings` order 90 icon `settings`; (b) 2 mục
  đầu + nút ở `/feed/kudos`; (c) không mục nào. **Khuyến nghị (a)** — mỗi mục gác ĐÚNG cặp của route (D3) nên nhân
  viên thường không thấy gì mới; hr/company-admin thêm 3 tab trên thanh tab <1024px. _Owner im lặng ⇒ (a)._
- **D3 — đường dẫn + cổng route [KỸ THUẬT].** `/feed/moderation` (`social.moderation`, `SOC-SCREEN-010`, order 103,
  `["view:feed","view:feed-report"]`) · `/feed/stats` (`social.stats`, `SOC-SCREEN-011`, order 104, cùng cặp) ·
  `/feed/kudos-badges` (`social.kudosBadges`, `SOC-SCREEN-012`, order 105, `["view:feed","manage:feed-kudos"]`).
  `/feed/kudos-badges` chứ không `/feed/kudos/badges` (M11: luật active làm «Vinh danh» sáng cùng lúc). Cổng route =
  cặp của LỜI GỌI ĐẦU TIÊN của màn. KHÔNG khai `requiredScopes`. Mục sidebar khai `requiredPermissions` Y HỆT route.
  Thêm chuyển hướng `/social/reports` → `/feed/moderation` (M10).
- **D4 — nút «Báo cáo» thuộc WO này, chỉ cho BÀI [KỸ THUẬT].** Owner đã ký (M5): nút + hộp thoại + cảnh báo
  SOC-DEC-011 đi cùng nhau ở FE-3; không có nó hàng đợi không có nguồn. Đặt trong `PostCardMenu` (không nhánh FE-2D
  nào chạm), state cục bộ, hộp thoại mount LƯỜI — không đổi `PostCardMenuActions`, không chạm `use-feed-actions.ts`
  / `PostCard.tsx`. Ẩn với bài của chính mình (`post.isMine`). Bình luận ⇒ nợ (§8).
- **D5 — dải lỗi riêng, KHÔNG sửa `ActionErrorBanner` [KỸ THUẬT].** File đó nằm trong fe-2d-a (M14, M19). Tạo
  `routes/social/admin/components/AdminErrorNotice.tsx` (`role="alert"`, nhận `reason` thuộc tập đóng
  `ADMIN_ERROR_REASONS`, chữ ở `social:admin.error.<reason>`) + `admin/lib/admin-errors.ts` (bảng mã → reason theo
  TỪNG lời gọi, tra `Object.hasOwn`, dùng `socialErrorCode`/`isForbiddenError` có sẵn — chỉ IMPORT).
- **D6 — web-core chạm MỘT lần ở L1 [KỸ THUẬT].** Client cả 3 cụm (báo cáo · thống kê · huy hiệu quản trị) + khoá
  cache vào PR đầu: mỗi lần chạm `packages/**` kéo cả auth + console vào CI (M20), đòi build lại dist, và là một lần
  chồng với fe-2d-a ở `index.ts` (M19). Export chèn SAU `index.ts:409`, không nối cuối file.
- **D7 — ma trận hành động chép ở FE, KHÔNG sửa contracts [KỸ THUẬT].** `apps/api/**` ngoài `paths` ⇒ đưa hằng vào
  contracts vẫn là 2 bản sao, lại kích `api.yml`. `moderation/lib/report-actions.ts` chép ma trận (M3) kèm ghi nguồn;
  server vẫn là cổng thật (422). Nợ ở §8.
- **D8 — avatar: không truyền `src` [KỸ THUẬT].** API PROD trả cột thô (M1) — tiền lệ FE-2C D15. Mọi bề mặt FE-3
  vẽ `<Avatar name>`; spec assert không có `<img>` với fixture `avatarUrl` KHÁC rỗng.
- **D9 — hình dạng danh sách [KỸ THUẬT].** Hàng đợi = danh sách THẺ (trích đoạn + ghi chú nhiều dòng, cột giữa
  hẹp) + `OffsetPager`; 011/012 = `<table>` thuần trong khung cuộn ngang (2–7 cột số). Không kéo `DataTable`.
- **D10 — mặc định hàng đợi [KỸ THUẬT].** Lọc mặc định `open` (không ghi lên URL), có «Tất cả» (= không gửi
  `status`). Ghi chú xử lý TUỲ CHỌN như server. `delete_target` buộc tick xác nhận trong hộp thoại (FE chưa có màn
  khôi phục). «Bỏ qua» ⇒ ẩn ô hành động và KHÔNG gửi khoá `action`.
- **D11 — tab «Bài đang ẩn» [KỸ THUẬT].** Nguồn 001 `{status:"hidden", sort:"latest"}`, `useInfiniteQuery`, nhánh
  khoá RIÊNG `socialKeys.moderation.hiddenPosts()`, `staleTime: 0`, `enabled` theo `manage:feed-post`. Dòng GỌN tự
  vẽ (tác giả · trích body · thời gian · «Xem bài» · «Hiện lại») — không dùng `PostCard`/`useFeedActions` (file
  FE-2D). «Hiện lại» gửi ĐÚNG `{hidden:false}`. Giới hạn ghi rõ trên màn: không gồm bài trong nhóm, không có tổng (M4).
- **D12 — màn Thống kê [KỸ THUẬT].** URL giữ `{from?,to?,orgUnitId?}`; mặc định KHÔNG gửi `from`/`to` (server 8
  tuần). Điều khiển: `<select>` số tuần 4/8/12/26 + ‹ › dịch đúng N tuần + «Về hiện tại»; mọi phép tính ngày bằng số
  học chuỗi trên `range` server trả + `snapToIsoWeeks`; › khoá khi `range.to` ≥ Chủ nhật tuần hiện tại theo
  `partsIn(now, companyTimeZone())` (`@/routes/rooms/room-time` — tiền lệ `kudos-month.ts`). Ô đơn vị dựng TRONG
  render từ `response.units`. Hiển thị: 3 `StatCard` tổng (bài · bình luận · cảm xúc = cộng `weekTotals`) + 1 thẻ
  «thành viên hoạt động tuần gần nhất» (không cộng dồn) · bảng «Theo tuần» (`weekTotals`) · bảng «Theo đơn vị»
  (gộp `rows`, KHÔNG có cột thành viên; hàng «Chưa gán đơn vị» cho `orgUnitId:null`) · 1 biểu đồ Recharts trong
  `ChartCard` tách file. `staleTime: 0`. Xuất: cùng tham số, tên dự phòng `social-tuong-tac-<from>_<to>.xlsx`.
- **D13 — màn Huy hiệu [KỸ THUẬT].** Đọc 056 (`limit:50` + `OffsetPager`). Form: `code` chỉ nhập khi TẠO (khoá khi
  sửa, không vào body PATCH) · tên · mô tả · icon = `<select>` từ `KUDOS_BADGE_ICON_NAMES` (export mới của
  `KudosBadgeIcon.tsx`) + ô emoji · thứ tự. PATCH chỉ gửi trường ĐÃ ĐỔI; không đổi gì ⇒ đóng, không gọi. Nút «Ngừng
  dùng» (051, có xác nhận) / «Bật lại» (050 `{isActive:true}`). Sau mọi lượt ghi invalidate `kudos.badgesAdminAll()`
  **và** `kudos.badges()` (ô chọn của composer). Khoá idempotency 049 suy từ nội dung.
- **D14 — dải ô liên kết nhanh [KỸ THUẬT].** Hằng `FEED_QUICK_LINK_APP_KEYS` (7 khoá, thứ tự SC-14) chỉ chứa
  `appKey`; nhãn · icon · cổng · đích lấy 100% từ `APP_REGISTRY` qua `getVisibleApps` (KHÔNG `getHomeGridApps`) + lọc
  `status === "active"`. Ô fbpost gác đúng MỘT cặp `view:social-post` của registry (M17) — chữ «3 cặp cũ» của
  done_when #2 sai, sửa ở §8. `lms`/`fbpost` mở qua `getCrossDomainOpener` (fallback `navigate(defaultRoute)`); ô
  khác `<Link>`. 0 ô ⇒ không render gì. Thêm `facebook` vào `ICON_MAP`.
- **D15 — ai thấy widget «Nhân sự» [OWNER · O1].** Cặp BE `read:employee` cả 4 vai đều có, không sàn scope; FE không
  có scope (M18). (A) mọi người có `read:dashboard`+`read:employee` — nhân viên thấy «1 nhân sự»; (B) chỉ hr +
  company-admin: thêm vế `update:employee` (`HR_ENGINE_PAIRS.UPDATE_EMPLOYEE`) làm cặp phân biệt — chặt hơn BE,
  fail-closed, loại cả manager; (C) hoãn, tách WO chờ BE có sàn scope/tín hiệu. **Khuyến nghị (B)** — khớp
  SPEC-07:1198. _Owner im lặng ⇒ (C): L7 không thi công, done_when #3 chuyển sang WO tách._
- **D16 — cách nhúng [KỸ THUẬT].** «Cùng component grid» = cùng component widget mà Grid mount, KHÔNG phải
  `DashboardWidgetGrid` (nó đòi metadata `/dashboard/me` — chính là một request DASH). Component bọc
  `HrOverviewRailSlot` gọi `useCanExact` cho TỪNG vế rồi mới mount `<HrOverviewWidget />`; không truyền
  `dashboardType`; không sửa widget gốc. AND thêm `view:feed` cho nhất quán 5 widget rail.
- **D17 — ranh giới PR/WO [KỸ THUẬT].** Ước tính ~5.000 dòng diff (L1 ~450 · L2 ~1.500 · L3 ~450 · L4 ~700 ·
  L5 ~1.300 · L6 ~300 · L7 ~150 · i18n ~300). (a) 1 PR · (b) PR xếp chồng · (c) **3 PR TUẦN TỰ, mỗi PR cắt từ
  master sau khi PR trước merge**: PR-A = L1+L2+L3 (vòng kiểm duyệt khép kín) · PR-B = L4+L5 · PR-C = L6+L7. **Chọn
  (c):** squash-merge làm gãy PR xếp chồng; sổ cái đóng dấu WO theo commit merge ⇒ tách WO `FE-3` (PR-A) / `FE-3B`
  (PR-B) / `FE-3C` (PR-C) như tiền lệ FE-2/2B/2C; chồng lấn FE-2D dồn hết vào PR-A (M19); mỗi PR dừng được.
- **D18 — i18n [KỸ THUẬT].** MỘT file gốc `i18n/locales/vi/social-admin.ts` gắn vào `social.ts` dưới khoá `admin`
  — chạm `social.ts` đúng MỘT lần (import chèn TRƯỚC `:19`, khoá chèn TRƯỚC `:406` để không kề hunk của fe-2d-a).
  PR sau chỉ sửa `social-admin.ts`; vượt 400 dòng thì tách `social-admin-*.ts`. `routeTitle.*` vào `W/…/nav.ts`.

## 3. Lát thi công

Thư mục mới: `A/routes/social/{admin,moderation,stats,badges}/`. File mới ≤ 400 dòng. Mọi `useMutation` có `onError`.

### L1 — Nền (PR-A) · không có gì người dùng thấy

- **TẠO** `W/lib/social-moderation-api.ts`: `listReports(query)` → 028 parse `feedReportPageSchema` ·
  `resolveReport(id, body)` → 029 parse `feedReportSchema` · `createReport(body)` → 027, schema cục bộ
  `feedReportCreatedSchema = z.object({ id: uuid })`, `idempotencyKey: idempotencyKeyFor("social-report", body)`.
- **TẠO** `W/lib/social-stats-api.ts`: `engagement(query)` → 052 parse `feedEngagementResponseSchema` ·
  `exportEngagement(query)` → `apiFetchBlob("/social/stats/engagement/export" + qs)`.
- **SỬA** `W/lib/social-kudos-api.ts`: `listBadgesAdmin({page,limit})` → 056 `kudosBadgeAdminPageSchema` ·
  `createBadge(body)` (khoá `idempotencyKeyFor("social-kudos-badge", body)`) · `updateBadge(id, body)` ·
  `deactivateBadge(id)` (DELETE, trả `kudosBadgeAdminSchema`).
- **SỬA** `W/lib/query-keys.ts` (nối vào `socialKeys`): `moderation.{allOf, reports.lists(), reports.list(params),
  hiddenPosts()}` · `stats.{allOf, engagement(params)}` · `kudos.badgesAdminAll()` + `kudos.badgesAdmin(params)`.
- **SỬA** `W/index.ts` (sau `:409`) · **TẠO** `A/i18n/locales/vi/social-admin.ts` + 2 dòng ở `social.ts` (D18).
- **TẠO** `admin/components/AdminErrorNotice.tsx` · `admin/lib/admin-errors.ts` · `admin/admin-test-doubles.tsx`
  (`makeReport` · `makeEngagement` · `makeBadgeAdmin` · `ADMIN_ERR` — KHÔNG sửa `feed/social-test-doubles.tsx`).

### L2 — Kiểm duyệt `SOC-SCREEN-010` (PR-A)

- **Route/nav:** `registry.ts` + mục `social.moderation` (D3) · `router.tsx` lazy `ModerationPage` + `createRoute`
  + `validateSearch` + dòng cây route + route chuyển hướng `/social/reports` · `legacy-social-redirects.ts` thêm
  nhánh union `kind:"reports"` (không tham số) · `nav.ts` `routeTitle.socialModeration` · `sidebar/social.ts` mục
  (O2) + sửa docblock `:8,114-116` · `social-wiring.spec.ts` + 2 snapshot (M12).
- **TẠO** `moderation/ModerationPage.tsx` · `components/{ReportQueue,ReportRow,ResolveReportDialog,HiddenPostsTab}.tsx`
  · `lib/{moderation-route-search,report-actions,moderation-errors}.ts`.
- **Search** `{tab?: "reports"|"hidden", status?: "open"|"resolved"|"dismissed"|"all", page?: number≥2}` — bộ lọc
  không ném, trả ĐỦ 3 khoá (kể cả `undefined`), ăn đầu ra parser thật (`?page=2` là SỐ).
- **Query:** `moderation.reports.list({status,page})` → `listReports({status?, page, limit:20})`,
  `keepPreviousData`, `staleTime:0` · `moderation.hiddenPosts()` (D11).
- **Cổng trong màn:** «Xử lý» ⇔ `report.status==="open"` && `useCan("manage","feed-report")` · ô hành động ⇔
  quyết định «Giải quyết» && `useCan("manage","feed-post")`, lựa chọn theo `targetType` (M3) · tab «Bài đang ẩn» ⇔
  `useCan("manage","feed-post")` (thiếu ⇒ KHÔNG có tab, `?tab=hidden` rơi về tab báo cáo, KHÔNG gọi 001) · «Xem trong
  ngữ cảnh» (`/feed/posts/$postId` từ `targetSnapshot.postId`) ⇔ có snapshot && `deletedAt===null` &&
  (`status!=="hidden"` \|\| có `manage:feed-post`); ngược lại hiện nhãn «[đã ẩn]»/«[đã xoá]»/«Nội dung không còn».
- **Hiển thị danh tính:** `reporter===null` ⇒ «Ẩn theo phạm vi xem của bạn»; object `employeeId===null` ⇒ tên +
  «(hồ sơ không còn)»; `note` chữ thuần `whitespace-pre-line`.
- **Trạng thái:** loading skeleton · lỗi + «Thử lại» · rỗng theo bộ lọc (4 câu khác nhau) · `page` quá trang cuối ⇒
  nút «Về trang 1» · 403 route ⇒ `ForbiddenPage` của `ProtectedRoute`.
- **Ghi:** `resolveReport` — body dựng bởi `buildResolveBody` (bỏ `action` khi `none`/«Bỏ qua», bỏ `resolutionNote`
  rỗng), qua `resolveFeedReportSchema.safeParse` trước khi gửi; thành công ⇒ invalidate `reports.lists()` (+
  `hiddenPosts()` · `feed.allOf()` · `posts.detail(postId)` khi có hành động). Hộp thoại `key={report.id}`; dải lỗi
  «kết cục» sống ở TRANG (hàng có thể biến mất sau refetch).

| Lời gọi | Mã (`ApiError.code`) | reason | Hành vi |
| --- | --- | --- | --- |
| 029 | 409 `SOCIAL-ERR-021` | `reportAlreadyDecided` | đóng hộp thoại · dải ở trang · invalidate |
| 029 | 409 `SOCIAL-ERR-REPORT-BUSY` | `reportBusy` | giữ hộp thoại, bấm lại được |
| 029 | 403 `SOCIAL-ERR-REPORT-ACTION-DENIED` | `reportActionDenied` | giữ · đưa hành động về «không» |
| 029 | 422 `SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET` | `reportActionInvalid` | giữ |
| 029 | 422 `SOCIAL-ERR-REPORT-ACTION-TARGET-UNAVAILABLE` | `reportTargetUnavailable` | giữ · về «không» · gợi ý kết thúc không kèm hành động |
| 029 | 404 `SOCIAL-ERR-001` | `reportGone` | đóng · invalidate |
| 006 | 404 `SOCIAL-ERR-001` | `postGone` | invalidate `hiddenPosts()` |
| 001/028 | 403 (mọi mã, kể cả `SOCIAL-ERR-010`) | `forbidden` | chữ của FE, KHÔNG hiện `message` server |
| mọi | 400 | `invalidRequest` | — |
| mọi | khác | `generic` | «Thử lại» |

### L3 — Báo cáo bài, 027 (PR-A)

- **TẠO** `moderation/components/ReportDialog.tsx` (5 lý do theo enum contracts · ghi chú ≤ `FEED_NOTE_MAX` · dòng
  cảnh báo LUÔN hiện: ghi chú được hiện nguyên văn cho người kiểm duyệt, kể cả quản lý đơn vị — đừng viết điều tự làm
  lộ danh tính) · `moderation/lib/report-create-errors.ts`.
- **SỬA** `feed/components/PostCardMenu.tsx`: mục `report` khi `!post.isMine`; `<ReportDialog>` chỉ mount khi mở
  (để các spec cũ không cần `QueryClientProvider` cho hook mới); sửa docblock `:18-20`.
- Body qua `createFeedReportSchema.safeParse`. Lỗi: 409 `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` → `reportDuplicate` ·
  404 `SOCIAL-ERR-001` → `reportTargetGone` · 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` → `busy` · 403 → `forbidden`
  · khác → `generic`. Thành công ⇒ câu xác nhận trong hộp thoại rồi đóng; KHÔNG invalidate gì của feed.

### L4 — Thiết lập huy hiệu `SOC-SCREEN-012` (PR-B)

- **Route/nav:** `social.kudosBadges` (D3) + `routeTitle.socialKudosBadges` + mục sidebar (O2) + wiring/snapshot.
- **TẠO** `badges/BadgeSettingsPage.tsx` · `components/{BadgeTable,BadgeFormDialog}.tsx` ·
  `lib/{badge-form,badge-errors,badge-route-search}.ts`; **SỬA** `kudos/components/KudosBadgeIcon.tsx` (export
  `KUDOS_BADGE_ICON_NAMES`).
- **Cổng:** route `manage:feed-kudos`; trong màn không cổng phụ (4 route cùng cặp, M7).
- **Trạng thái:** loading · lỗi + thử lại · rỗng («Chưa có huy hiệu nào») · hàng đã tắt có pill «Ngừng dùng».
- **Lỗi:** 409 `SOCIAL-ERR-KUDOS-BADGE-CODE-TAKEN` → `badgeCodeTaken` (cạnh ô mã, gợi ý bật lại huy hiệu cũ) · 404
  `SOCIAL-ERR-KUDOS-BADGE-NOT-FOUND` → `badgeGone` + invalidate · 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` → `busy`
  · 400 → `invalidRequest` · 403 → `forbidden` · khác → `generic`.

### L5 — Thống kê tương tác `SOC-SCREEN-011` (PR-B)

- **Route/nav:** `social.stats` (D3) + `routeTitle.socialStats` + mục sidebar (O2) + `bar-chart-3` vào `ICON_MAP`.
- **TẠO** `stats/StatsPage.tsx` · `components/{StatsFilters,WeekTotalsTable,UnitTotalsTable,EngagementTrendChart,
  ExportEngagementButton}.tsx` · `lib/{stats-route-search,stats-range,stats-aggregate,stats-errors}.ts`.
- **Search:** từng trường qua `safeParse` riêng; `from`/`to` lệch cặp, ngày không tồn tại, `from>to`, > 26 tuần ⇒ bỏ
  CẢ HAI (không ném, không gọi 052 với tham số chắc chắn 400).
- **Cổng:** route `view:feed-report`; nút Xuất KHÔNG có cổng riêng (M6) — khoá khi đang xuất hoặc chưa có dữ liệu.
- **Trạng thái:** loading · `units:[]` && `rows:[]` ⇒ «Bạn chưa có đơn vị nào trong phạm vi thống kê» (200 rỗng,
  KHÔNG phải «không có quyền») · toàn 0 ⇒ vẫn vẽ bảng số 0 · đang lỗi ⇒ ẩn bảng cũ, chỉ hiện dải lỗi.
- **Lỗi (052 và 053 chung bảng):** 403 `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE` → `statsUnitOutOfScope` («Bạn không có
  quyền xem thống kê của đơn vị này») + nút «Bỏ lọc đơn vị» · 400 → `statsRangeInvalid` + «Về mặc định» · 403 khác →
  `forbidden` · khác → `generic` + «Thử lại». Lỗi xuất: dải lỗi, KHÔNG tải tệp.

### L6 — Dải ô liên kết nhanh (PR-C)

- **TẠO** `feed/lib/quick-links.ts` (hằng + `pickQuickLinkApps`) · `feed/components/QuickLinkStrip.tsx`
  (đăng ký `useAuthStore(s => s.capabilities)` để vẽ lại khi quyền nạp xong; nhãn `t(app.nameKey, {ns:"nav"})`).
- **SỬA** `feed/FeedPage.tsx` (1 dòng trên `<FeedComposer>`) · `DynamicIcon.tsx` (+`facebook`).
- Không query, không mã lỗi. KHÔNG sửa `FeedPage.spec.tsx` (file FE-2D) — ca mới ở file spec MỚI.

### L7 — Widget «Nhân sự» (PR-C) · CHỈ khi O1 = A hoặc B

- **TẠO** `feed/components/HrOverviewRailSlot.tsx` (D16): vế `view:feed` + `DASH_READ_PAIR` +
  `DASH_WIDGET_GATE_PAIR.HR_OVERVIEW` (+ `HR_ENGINE_PAIRS.UPDATE_EMPLOYEE` nếu B) — hằng chỉ IMPORT từ
  `routes/dashboard/constants` · `routes/hr/constants`.
- **SỬA** `feed/SocialPortalShell.tsx` (con cuối của `PortalRightRail`) + `SocialPortalShell.spec.tsx` (mock
  `dashboardApi.getWidgetData`).

## 4. Test RED-trước

Mỗi ca DENY đứng cạnh một ca ALLOW dùng CÙNG khung. «Không phát request» đo trên spy của hàm API sau một nhịp
`waitFor` của ca ALLOW cùng file. Quyền đặt bằng `setCaps` TRƯỚC khi render. Body kiểm bằng CHÍNH schema contracts.

| Lát | Ca | Ghim | Đỏ hôm nay vì | Mutant giết |
| --- | --- | --- | --- | --- |
| L1 | A1 client báo cáo | `listReports({status:"open",page:2})` ⇒ `GET /social/reports?status=open&page=2`; `resolveReport` ⇒ PATCH + parse; `createReport` gửi `Idempotency-Key` suy từ body | `socialModerationApi` chưa tồn tại (import lỗi) | đổi schema parse sang `feedReportSchema` cho 028 |
| L1 | A2 client thống kê/huy hiệu | 052 đúng path + query; 053 đi `apiFetchBlob`; 056 parse mẫu CÓ `isActive`; 051 là DELETE trả DTO | hàm chưa tồn tại | 056 parse bằng `kudosBadgePageSchema` |
| L1 | A3 khoá cache | `reports.lists()` là tiền tố của `reports.list({status,page})`; `badgesAdminAll()` KHÔNG là tiền tố của `badges()` và ngược lại | khoá chưa có | gộp `badges-admin` vào `["kudos","badges",…]` |
| L1 | A4 `AdminErrorNotice` | lặp TOÀN BỘ `ADMIN_ERROR_REASONS`: chữ render ≠ khoá thô (i18n thật) | component chưa có | xoá một khoá `admin.error.*` |
| L2 | G1 cổng route 010 | DENY `{view:feed}` ⇒ `forbidden.title`, spy `listReports` 0 lần · ALLOW `{view:feed, view:feed-report}` ⇒ gọi 1 lần (qua `buildModuleRouteContent(getMeta("social.moderation"),…)`) | `getMeta("social.moderation")` ném — chưa có mục registry | bỏ `view:feed-report` khỏi `requiredPermissions` |
| L2 | G2 nút «Xử lý» | DENY caps manager ⇒ hàng hiện, 0 nút · ALLOW thêm `manage:feed-report` ⇒ có nút; báo cáo đã `resolved` ⇒ không nút | màn chưa có | gác nút bằng `view:feed-report` |
| L2 | G3 hành động kèm | DENY có `manage:feed-report`, thiếu `manage:feed-post` ⇒ không ô hành động, body gửi KHÔNG có `action` · ALLOW ⇒ ô hiện | màn chưa có | bỏ điều kiện `manage:feed-post` |
| L2 | G4 tab bài ẩn | DENY thiếu `manage:feed-post` + `?tab=hidden` ⇒ không tab, `listFeed` 0 lần · ALLOW ⇒ gọi `{status:"hidden"}` | màn chưa có | bỏ `enabled` |
| L2 | B1 body 029 | mỗi tổ hợp (resolved×4 hành động post · resolved×3 comment · dismissed) ⇒ `resolveFeedReportSchema.safeParse(body).success`; «Bỏ qua» sau khi đã chọn `hide_post` ⇒ body không `action`; báo cáo bình luận KHÔNG có lựa chọn `hide_post` | lib chưa có | gửi `action` khi `dismissed` · thêm `hide_post` cho comment |
| L2 | B2 xác nhận xoá | chọn `delete_target` chưa tick ⇒ nút gửi khoá, `resolveReport` 0 lần | — | bỏ điều kiện tick |
| L2 | E1…E7 mã lỗi 029/006 | MỖI dòng bảng lỗi L2 một ca `ApiError(status, code)`: đúng `data-reason`; `021`/`reportGone` ⇒ hộp thoại đóng + `reports.lists()` `isInvalidated`; `BUSY` ⇒ hộp thoại CÒN; `TARGET-UNAVAILABLE` ⇒ hành động về «không» | lib lỗi chưa có | gộp `REPORT-BUSY` vào nhánh `021` |
| L2 | E8 403 đọc | 028 trả 403 ⇒ `forbidden`; 001 trả 403 `SOCIAL-ERR-010` ⇒ KHÔNG hiện chuỗi «trường kiểm duyệt» | — | hiện `err.message` |
| L2 | R1 danh tính | `reporter:null` ⇒ «Ẩn theo phạm vi…»; `{employeeId:null, fullName:"X"}` ⇒ «X» + «(hồ sơ không còn)»; hai nhãn KHÁC nhau; fixture `avatarUrl` khác rỗng ⇒ không `<img>` | — | gộp hai nhánh · truyền `src` |
| L2 | R2 ngữ cảnh | snapshot `deletedAt≠null` ⇒ không link + «[đã xoá]»; `hidden` + thiếu `manage:feed-post` ⇒ không link; thường ⇒ `href="/feed/posts/<postId>"` (mock `Link` nội suy params) với `postId` ≠ `targetId` | — | dùng `targetId` làm id bài |
| L2 | R3 sau `delete_target` | `reports.lists()` + `hiddenPosts()` + `feed.allOf()` đều `isInvalidated` (seed đúng khoá thật) | — | chỉ vá một hàng trong cache |
| L2 | H1 hiện lại | bấm ⇒ `moderatePost(id, {hidden:false})` — `toEqual` đúng 1 khoá + qua `moderateFeedPostSchema` | — | gửi kèm `pinned` |
| L2 | S1 search | đầu ra parser THẬT: `?page=2` ⇒ 2; `?page=1`/`?status=1`/`?tab=x` ⇒ bỏ; khoá bỏ là `undefined` tường minh | lib chưa có | khuôn `typeof === "string"` cho `page` |
| L2 | W1 wiring | `social-wiring.spec`: 12 route · 8 mục (thứ tự viết tay) · `showInSidebar` 8 khoá · `social.moderation` `toMatchObject` path/screenCode/cặp · **cặp mục sidebar `toEqual` cặp route** · `/social/reports` có trong danh sách chuyển hướng | số cũ 11/7 | đổi cặp sidebar thành `any` nhiều cặp |
| L2 | W2 snapshot | regen `-u` CHỈ file snapshot sidebar; diff đúng +1 dòng khối `### SOCIAL` (`all=[view:feed,view:feed-report]`) + dòng ở bộ `ALL`; bộ `EMPLOYEE` KHÔNG đổi | snapshot cũ | — (đọc diff) |
| L3 | P1 mục «Báo cáo» | bài người khác ⇒ có mục; `isMine` ⇒ KHÔNG (đối chứng: «Sao chép liên kết» vẫn có) | mục chưa có | bỏ `!post.isMine` |
| L3 | P2 gửi | body qua `createFeedReportSchema`; ghi chú rỗng ⇒ không khoá `note`; dòng cảnh báo SOC-DEC-011 hiện TRƯỚC khi gõ | — | bỏ dòng cảnh báo |
| L3 | P3 lỗi 027 | 409 `REPORT-DUPLICATE-OPEN` ⇒ `reportDuplicate`; 404 `001` ⇒ `reportTargetGone`; 403 ⇒ `forbidden`; reject ⇒ hộp thoại CÒN + nội dung còn | — | coi mọi 409 là thành công |
| L4 | G5 cổng route 012 | DENY `{view:feed}` ⇒ forbidden, `listBadgesAdmin` 0 lần · ALLOW `{view:feed, manage:feed-kudos}` | chưa có mục registry | hạ cổng về `view:feed` |
| L4 | F1 form | tạo: body qua `createKudosBadgeSchema`; mã `"A b"` ⇒ lỗi tại ô, 0 lần gọi · sửa: ô mã `readOnly`, body `toEqual` CHỈ trường đổi và qua `updateKudosBadgeSchema`; không đổi gì ⇒ 0 lần gọi | — | đưa `code` vào PATCH · gửi cả form |
| L4 | F2 tắt/bật | «Ngừng dùng» ⇒ xác nhận ⇒ `deactivateBadge`; hàng tắt có «Bật lại» ⇒ `updateBadge(id,{isActive:true})`; sau MỖI lượt ghi `kudos.badges()` VÀ `kudos.badgesAdmin({…})` `isInvalidated` | — | quên `kudos.badges()` |
| L4 | F3 lỗi | 409 `CODE-TAKEN` ⇒ `badgeCodeTaken`; 404 `NOT-FOUND` ⇒ `badgeGone` + invalidate; 409 idempotency ⇒ `busy`; 403 ⇒ `forbidden` | — | gộp hai mã 409 |
| L4 | F4 icon | icon `constructor`/`__proto__` trong danh sách ⇒ không ném; emoji ⇒ vẽ chữ | — | tra map trần |
| L5 | G6 cổng route 011 | DENY `{view:feed}` ⇒ forbidden, `engagement` 0 lần · ALLOW manager ⇒ gọi 1 lần, có nút Xuất | chưa có mục registry | bỏ cặp |
| L5 | T1 khoảng tuần | mặc định ⇒ gọi KHÔNG `from`/`to`; nhãn khoảng lấy từ `range` server; ‹ ⇒ `from`/`to` lùi đúng N×7 ngày, là thứ Hai/Chủ nhật; › khoá ở tuần hiện tại — `vi.setSystemTime(new Date("2026-10-04T17:30:00Z"))` (00:30 thứ Hai 05/10 giờ VN) ⇒ tuần hiện tại kết thúc `2026-10-11` | lib chưa có | tính tuần theo UTC/giờ máy |
| L5 | T2 search | `?from=2026-09-01` thiếu `to` ⇒ bỏ cả hai; 27 tuần ⇒ bỏ; `?orgUnitId=abc` ⇒ bỏ; hợp lệ ⇒ giữ | lib chưa có | giữ `from` lẻ |
| L5 | T3 số liệu | `rows` thưa ⇒ ô vắng không sinh `NaN`; hàng `orgUnitId:null` ⇒ «Chưa gán đơn vị»; đơn vị `isDeleted` có hậu tố; thẻ thành viên = hàng `weekTotals` CUỐI, không phải tổng | — | cộng `activeMembers` |
| L5 | T4 ô đơn vị | option = `units` của response (chờ CHÍNH option xuất hiện rồi mới `change`); chọn ⇒ URL có `orgUnitId` | — | lấy đơn vị từ nguồn khác |
| L5 | T5 rỗng ≠ cấm | `units:[]`,`rows:[]` ⇒ câu «chưa có đơn vị…», KHÔNG có `data-reason="forbidden"` | — | dùng chung câu forbidden |
| L5 | T6 lỗi 052 | 403 `STATS-UNIT-OUT-OF-SCOPE` ⇒ `statsUnitOutOfScope` + «Bỏ lọc đơn vị» xoá `orgUnitId`; 400 ⇒ `statsRangeInvalid`; 403 khác ⇒ `forbidden`; khi lỗi KHÔNG còn bảng cũ | — | gộp hai loại 403 |
| L5 | X1 xuất | gọi `exportEngagement` với CÙNG tham số đang xem; `filename:null` ⇒ `social-tuong-tac-<from>_<to>.xlsx`; đang xuất ⇒ nút `disabled`, bấm 2 lần = 1 lời gọi; 403 ⇒ dải lỗi + `triggerBlobDownload` 0 lần | — | tên dự phòng thiếu `.xlsx` · bỏ `disabled` |
| L5 | C1 biểu đồ | `EngagementTrendChart` render không ném với `ResizeObserver` stub cục bộ (`vi.stubGlobal`) + `weekTotals` 0 hàng; spec trang MOCK file này | — | — (ca khói) |
| L6 | Q1 dải ô | DENY `{view:feed}` ⇒ dải KHÔNG render (không tiêu đề) · ALLOW `{view:feed, access:goal}` ⇒ đúng 1 ô «Mục tiêu» | component chưa có | bỏ lọc quyền |
| L6 | Q2 fbpost | `{create:social-post, manage:social-account}` thiếu `view:social-post` ⇒ KHÔNG ô · có `view:social-post` ⇒ có ô (dù `switcherOnly`) | — | dùng `getHomeGridApps` · gate OR 3 cặp |
| L6 | Q3 rooms + wildcard | chỉ `access:room` ⇒ không ô; đủ 2 cặp ⇒ có; chỉ `*:*` ⇒ 0 ô | — | đổi sang `useCan` |
| L6 | Q4 mở | bấm ô `lms`/`fbpost` ⇒ spy opener gọi 1 lần, `navigate` 0 lần; ô `tasks` ⇒ `href="/tasks/my-tasks"` | — | `navigate(defaultRoute)` cho cross-domain |
| L6 | Q5 hằng | mọi khoá của `FEED_QUICK_LINK_APP_KEYS` tồn tại trong `APP_REGISTRY`; thứ tự vẽ = thứ tự hằng (viết tay), không theo `order` | — | sắp theo `order` |
| L7 | H1 cổng widget | DENY-1 `{view:feed, read:dashboard, read:employee}` (thiếu cặp O1 — chỉ khi B) ⇒ không tiêu đề widget VÀ `getWidgetData` 0 lần · DENY-2 chỉ `*:*` · DENY-3 thiếu `read:dashboard` · ALLOW đủ cặp ⇒ gọi 1 lần với `HR_OVERVIEW` | slot chưa có | đổi `useCanExact` → `useCan` · bỏ một vế |
| L7 | H2 không hồi quy shell | các ca cũ của `SocialPortalShell.spec` xanh; không ca nào chạy `apiFetch` thật | — | bỏ mock `getWidgetData` |

## 5. Bẫy & giảm thiểu

| # | Bẫy | Gắn với |
| --- | --- | --- |
| B1 | Suy `manage ⇒ view`: gác màn bằng `manage:feed-report` tạo vai vào được rồi 403 ở 028 | D1, G1 |
| B2 | Mục sidebar khai cặp khác route ⇒ mục hiện, bấm 403 | W1 (`toEqual` cặp) |
| B3 | `pruneUnbuiltScreens` so `path` đúng-bằng ⇒ sai 1 ký tự là mục tự ẩn IM LẶNG | W1 (thứ tự 8 khoá sau prune) |
| B4 | `-u` trên cả suite ghi đè snapshot khác | W2 — `-u` chỉ kèm đúng file spec snapshot, đọc `git diff` |
| B5 | `ProtectedRoute` đọc store bằng `getState()` ⇒ đổi caps sau mount không vẽ lại | G1/G5/G6 — `setCaps` TRƯỚC render |
| B6 | Query không data bị invalidate ⇒ `pending` ⇒ con unmount, mất dải lỗi/nháp | L2 — dải «kết cục» ở trang; `key={report.id}` |
| B7 | Ca «không `<img>`» xanh vì fixture `avatarUrl:null` | R1 — fixture mang URL khác rỗng |
| B8 | Mock `Link` bỏ `params` ⇒ link sai id vẫn xanh | R2 — mock nội suy params |
| B9 | `<select>` nạp option bất đồng bộ ⇒ `fireEvent.change` đua | T4 — option dựng trong render, test chờ CHÍNH option |
| B10 | Biên tuần chỉ đỏ trên máy không ở giờ VN | T1 — mốc `setSystemTime` chọn sao cho UTC và VN khác TUẦN |
| B11 | `new Date("2026-09-28")` rồi format theo TZ trình duyệt | D12 — số học chuỗi; ca T1 |
| B12 | `apiFetch` cho 053 ⇒ hỏng thân nhị phân | A2 |
| B13 | Recharts trong jsdom chưa ai đo (M16) | C1 + spec trang mock file biểu đồ; không ổn định ⇒ bỏ biểu đồ, giữ bảng (ghi PR) |
| B14 | Hook mới trong `PostCardMenu` làm 3 spec của FE-2D (`PostCard.spec`·`FeedPage.spec`·`PostDetailPage.spec`) đòi provider | L3 — hộp thoại mount lười; T5 chạy 3 spec đó KHÔNG sửa |
| B15 | Thêm dải ô vào `FeedPage` làm đổi kết quả `FeedPage.spec` | L6 — 0 ô ⇒ `null`; T8 chạy spec đó không sửa |
| B16 | Gate widget bằng `enabled:false` rồi vẫn mount `WidgetCard` ⇒ thẻ rỗng | D16, H1 (assert CẢ vắng tiêu đề LẪN 0 lời gọi) |
| B17 | Ca DENY của widget dùng caps rỗng ⇒ xanh với mọi gate | H1 — caps CÓ `read:employee` |
| B18 | Khoá i18n thiếu không cổng nào bắt | A4 + mọi spec màn dùng i18n THẬT, assert chữ ≠ khoá |
| B19 | web-core `exports` trỏ `dist` ⇒ app thấy bản cũ | §6 — build web-core trước mọi lệnh của app |
| B20 | Chèn vào `index.ts`/`social.ts` kề hunk của fe-2d-a | D6, D18 — vị trí chèn đã chỉ định |
| B21 | Heredoc Bash chứa backtick chết giữa chừng; `git checkout --` xoá vá chưa commit khi hoàn tác mutant | §6 — script ghi bằng Write; mutant: sao lưu → cấy → `cp` trả lại |

## 6. Cổng & kiểm chứng

- **Gate LIGHT** (mỗi PR, chạy **TUẦN TỰ**, trên diff `origin/master...HEAD`, TRƯỚC khi mở PR): `typescript-reviewer`
  → `react-reviewer` → `quality-gate`. Commit vá finding cũng phải qua lại reviewer đã nêu finding đó.
- **Nâng lên FULL gate** — xem danh sách ở cuối mục này.
- **Lệnh** (từ gốc `C:/dev 2/MediaOS-fe3`; chạy TỪNG lệnh, không song song test/build/tsc):
  1. `pnpm --filter @mediaos/web-core build` — sau MỖI lần sửa `packages/web-core` (B19).
  2. `pnpm --filter @mediaos/web-core exec vitest run src/lib/social-moderation-api.spec.ts src/lib/social-stats-api.spec.ts src/lib/social-kudos-api.spec.ts src/lib/query-keys.spec.ts src/lib/registry.spec.ts --maxWorkers=4`
  3. `pnpm --filter @mediaos/app exec vitest run src/routes/social/<thư-mục-lát> --maxWorkers=4` — vòng RED/GREEN.
  4. `pnpm --filter @mediaos/app exec vitest run src/routes/social/social-wiring.spec.ts src/layouts/workspace/sidebar-registry.snapshot.spec.ts --maxWorkers=4`; regen: lặp lại CHỈ với file snapshot + `-u`, rồi `git diff -- apps/app/src/layouts/workspace/__snapshots__/`.
  5. `pnpm --filter @mediaos/app exec vitest run --config vitest.social.config.ts src/routes/social src/layouts/portal src/hooks --coverage --maxWorkers=4` — đọc 4 số, sàn 80.
  6. `bash harness/check.sh --quick` — lint + typecheck toàn workspace.
  7. `node harness/chunk-test.mjs --packages=@mediaos/app,@mediaos/web-core --no-build --max-forks=4` — toàn suite theo chunk (chạy một lượt cả suite app từng sập worker — FE-2C §9).
  8. `pnpm --filter @mediaos/app build`.
  9. Trước PR: `bash harness/check.sh --all` — `lane-db-guard` ĐỎ theo thiết kế khi không có `LANE_DB` (WO chỉ-FE, không đổi DB/permission): ghi nguyên văn vào PR, không «sửa» cổng.
- **Mutant tối thiểu** (mỗi cái phải đỏ ĐÚNG ca, ĐÚNG thông điệp assert — không phải lỗi biên dịch): cột cuối bảng §4
  của G1 · G2 · G3 · G4 · B1 · E1…E7 (gộp BUSY/021) · R1 · R3 · F1 · F2 · G5 · G6 · T1 · T3 · X1 · Q2 · Q4 · H1.
- **Không đo được trong kho — KHÔNG hứa:** a11y tự động (không có axe) · tương phản màu · bố cục 300px / breakpoint
  (jsdom không layout) · layout Recharts · hành vi thật trên PROD · ratchet khoá i18n.
- **Điều kiện MERGE:** API PROD ≥ `14afbb5f` (đã thoả, M1). Ghi đầu PR: avatar vẽ chữ cái đầu (D8); tab «Bài đang
  ẩn» không gồm bài nhóm (D11); `lane-db-guard`.

**Điều kiện nâng lên FULL gate** (`security-reviewer` + `silent-failure-hunter`, + `database-reviewer` nếu có DB):
diff chạm `apps/api/**` hoặc migration/seed quyền · chạm `permission.service.ts` (allowlist) · sửa
`W/stores/auth.ts`, `W/hooks/use-can.ts`, `W/components/permission-gate.tsx`, `ProtectedRoute.tsx` hoặc thân
`createPermissionChecker`/`checkRequirement` · sửa schema `packages/contracts` (kể cả additive) · sửa cổng trong
`HrOverviewWidget.tsx` gốc · O1 chọn phương án đòi BE · reviewer LIGHT nêu finding về lọt quyền / lộ danh tính
người tố giác.

## 7. Trình tự

| Bước | Việc | Ranh giới commit |
| --- | --- | --- |
| T0 | Owner ký O1/O2 (hoặc áp mặc định §0). Sửa backlog theo §8 (done_when · tách FE-3B/3C · seed nợ) | `chore(backlog)` |
| T1 | **L1** — ca A1–A4 RED → client + khoá + i18n gốc + `AdminErrorNotice` → build web-core → GREEN | `feat(social): nền client kiểm duyệt/thống kê/huy hiệu` |
| T2 | **L2 lib** — S1 · B1 RED → `moderation-route-search` · `report-actions` · `moderation-errors` → GREEN | chung T3 |
| T3 | **L2 màn** — G2–G4 · B2 · E1–E8 · R1–R3 · H1 RED → 4 component + trang → GREEN | `feat(social): SOC-SCREEN-010` |
| T4 | **L2 nối dây** — G1 · W1 RED → registry + router + chuyển hướng + nav + sidebar → W2 regen, đọc diff → GREEN | `feat(social): route + rail Kiểm duyệt` |
| T5 | **L3** — P1–P3 RED → `ReportDialog` + mục menu → GREEN; chạy 3 spec FE-2D không sửa (B14) | `feat(social): nút Báo cáo (027)` |
| T6 | **PR-A:** lệnh 5→6→7→8 · mutant · gate LIGHT tuần tự → vá (mỗi vá một ca RED đo đỏ trên code cũ) → lệnh 9 → verify lại → **mở PR-A** | vá: `fix(social): …` từng cái |
| T7 | Sau khi PR-A merge: cắt nhánh mới từ master. **L4** (G5 · F1–F4) rồi **L5** (G6 · T1–T6 · X1 · C1), mỗi lát RED → GREEN → nối dây (W1/W2 lên 13 rồi 14 route, 9 rồi 10 mục) | 2 commit `feat` |
| T8 | **PR-B:** như T6 → **mở PR-B** | — |
| T9 | Sau khi PR-B merge: **L6** (Q1–Q5; chạy `FeedPage.spec` không sửa) · **L7** nếu O1 ≠ C (H1–H2) | 1–2 commit `feat` |
| T10 | **PR-C:** như T6 → **mở PR-C**. Sau merge: cập nhật backlog/sổ vết; `docs/STATUS.md` do `gen-status.mjs` sinh | — |

KHÔNG mở PR trước gate. KHÔNG push thẳng master. Đụng file ngoài `paths` ⇒ dừng, ghi quyết định + sửa `paths`.

## 8. Sửa backlog cần làm trong WO (`harness/backlog.mjs`, mục `S16-SOCIAL-FE-3` `:18265-18305`)

1. `done_when` #1 (`:18298`): «Kiểm duyệt chỉ hiện với manage:feed-report/manage:feed-post» → «màn vào bằng
   `view:feed-report` (manager chỉ-đọc theo đơn vị, người tố giác bị che); nút xử lý gác `manage:feed-report`; hành
   động kèm + tab bài ẩn + hiện lại gác `manage:feed-post`» (D1).
2. `done_when` #2 (`:18299`): «ô fbpost dùng gate 3 cặp cũ» → «ô fbpost gác đúng MỘT cặp `view:social-post` lấy từ
   `APP_REGISTRY`» (D14); «thông điệp không có quyền đơn vị này» → «theo mã `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE`,
   tách khỏi 200 rỗng».
3. `done_when` #3 (`:18300`): «nhúng qua cùng component grid + useCanExact» → «mount thẳng `HrOverviewWidget` (không
   `DashboardWidgetGrid`, không `/dashboard/me`), cổng ngoài `useCanExact` đủ `read:dashboard` + `read:employee` +
   cặp theo O1» — hoặc chuyển nguyên dòng sang `FE-3C` nếu tách (mục 6).
4. `title` (`:18269`): «Recharts nếu S15-FE-4 đã cài, không thì…» → «Recharts (đã cài)»; «theo useCan» → «theo
   `APP_REGISTRY`»; «Đặt phòng» → nhãn registry «Phòng họp». `notes` (`:18303`): bỏ câu Recharts; ghi O1/O2 + «nút
   Báo cáo (027) thuộc WO này — N8 plan FE-1».
5. `src` (`:18295`): bỏ `memory sensitive-pair-widget-needs-usecanexact` (`read:employee` KHÔNG nhạy cảm — trích lệch
   ca); thêm `SOC-DEC-011` + `API-19 028/029/052/053/056`.
6. Tách WO theo D17: `S16-SOCIAL-FE-3` còn P1 + P1b (PR-A) · seed `S16-SOCIAL-FE-3B` (amber FE — P3 + P2, PR-B,
   `depends_on` FE-3) · seed `S16-SOCIAL-FE-3C` (amber FE — P4 + P5, PR-C, `depends_on` FE-3B; P5 chờ O1). Cả ba
   `plan:` trỏ file này. `paths`: KHÔNG cần thêm; có thể BỎ `apps/app/src/routes/me/**` · `packages/ui/**` ·
   `packages/contracts/**` (không lát nào chạm).
7. Nợ cần seed (mỗi dòng: id đề xuất · zone · vì sao):
   - `S16-SOCIAL-FECOMMENTREPORT-1` · amber FE · nút «Báo cáo» trên BÌNH LUẬN — `CommentList.tsx` đang ở 2 nhánh
     FE-2D; làm sau khi chúng merge. Hàng đợi L2 đã vẽ được đích bình luận.
   - `S16-SOCIAL-FERECYCLE-1` · amber FE · màn thùng rác bài viết 057/058 (`restore:feed-post`) — `delete_target` từ
     hàng đợi hiện không có đường khôi phục trên FE.
   - Bổ sung vào `S16-SOCIAL-GROUPMOD-1` (`:18160`, có sẵn) · red BE · 001 `status=hidden` loại bài nhóm
     (`social-posts.service.ts:124`) ⇒ tab «Bài đang ẩn» thiếu bài nhóm.
   - `S4-DASH-HROVERVIEW-FLOOR-1` · red BE · `HR_OVERVIEW` không có sàn scope + không tín hiệu scope cho FE
     (`dashboard-widget-catalog.const.ts:435`) — lệch SPEC-07 §14.8; điều kiện để bỏ cặp thay thế ở D15-B.
   - `S16-SOCIAL-REPORTMATRIX-1` · green BE+contracts · đưa `REPORT_ACTION_MATRIX` vào contracts để FE/BE đọc chung
     (hiện FE chép tay — D7).
   - `S16-SOCIAL-DOC-2` · green docs · UI-07 §34b.2 (3 mục rail) · §34b.6 (fbpost «3 cặp») · SPEC-16 §9 (đường dẫn 3
     màn) — ngoài `paths` FE-3.
   - `S1-FND-CORS-EXPOSE-1` · green BE · `exposedHeaders: ["Content-Disposition"]` — hiện FE tự dựng tên tệp (M15).

## 9. Sổ vết

_(để trống — dành cho lượt `plan-reviewer` và thi công)_
