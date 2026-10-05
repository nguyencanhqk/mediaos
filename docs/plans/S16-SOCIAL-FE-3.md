# S16-SOCIAL-FE-3 — FE track C: Kiểm duyệt · Thống kê · Huy hiệu · dải ô liên kết nhanh · widget Nhân sự

> Trạng thái: **plan v2 (05/10/2026)** — ĐÃ QUA plan-review lượt 1 ngày 05/10/2026: 3 reviewer (đối kháng · kiểm chứng
> khẳng định · đối chiếu spec) đều **PASS_WITH_FIXES**, 0 BLOCKER/HIGH. 41 finding (12 MEDIUM · 27 LOW · 2 không xác
> minh được): **nhận 39 · nhận một phần 2 · bác 0** — sổ vết §9. Owner đã ký O1 = B · O2 = a · O3 = a (§0); còn 6 ô ☐
> chờ owner tick khi duyệt merge PR-A. Nhánh `feat/s16-social-fe-3` cắt từ `origin/master` `b637f3d6`. Zone amber, gate
> LIGHT (+ `security-reviewer` riêng PR-A). Quyền chỉ qua `useCan`/`PermissionGate`/`useCanExact` và `ROUTE_REGISTRY`;
> masking là việc của server; KHÔNG thêm dependency.
> Đo bằng 6 bản đồ đọc-hiểu (spec · backend · kiến trúc FE · quyền/registry · nhúng DASH · test/cổng) + đối chiếu
> chéo; mọi dòng §1 đã tự mở file xác minh lại trên `b637f3d6`; mọi finding ở §9 đã mở code/tài liệu xác minh trước khi
> nhận. Chưa chạy test/build ở bước lập kế hoạch lẫn bước vá plan.

## 0. Phạm vi · ngoài phạm vi · chữ ký owner

**Trong phạm vi (5 phần của WO + 2 phần nợ đã ký giao):**
P1 `SOC-SCREEN-010` Kiểm duyệt (hàng đợi báo cáo 028/029 + bài đang ẩn 001/006) · P2 `SOC-SCREEN-011` Thống kê
tương tác (052 + xuất XLSX 053) · P3 `SOC-SCREEN-012` Thiết lập huy hiệu (056/049/050/051) · P4 dải ô liên kết
nhanh trên `/feed` · P5 widget DASH «Nhân sự» ở rail phải (O1 = B) · **P1b** nút «Báo cáo» trên thẻ BÀI + hộp thoại
soạn + cảnh báo SOC-DEC-011 (027 — owner ký 23/09 giao cho WO này, M5) · **P1c** nút «Báo cáo» trên BÌNH LUẬN (027,
O3 = a — ở PR-C, sau FE-2D lát B).

**Ngoài phạm vi (ghi nợ ở §8):** thùng rác bài viết 057/058 · mọi thay đổi `apps/api/**`, migration, seed quyền,
`packages/contracts` · `SOCIAL-WIDGET-001/002` (thuộc `S16-SOCIAL-DASH-1`) · sửa `HrOverviewWidget`/
`DashboardWidgetGrid` gốc · sửa SPEC/UI-07 (ngoài `paths`).

> ✍️ **Chữ ký owner — ĐÃ KÝ 05/10/2026** (owner trả lời qua hộp hỏi; ghi theo lời chuyển của phiên điều phối — người
> vá plan không trực tiếp thấy câu trả lời):
> **O1** (D15) Ai thấy widget «Nhân sự» ở rail bảng tin?  ☐ A mọi người có `read:employee`  ☑ **B chỉ HR +
> company-admin**  ☐ C hoãn. ⇒ L7 THI CÔNG. Hệ quả của B: quản lý (manager) KHÔNG thấy widget dù SPEC-07:1200 cho
> scope Department xem phòng mình — vế đó chờ BE (nợ `S4-DASH-HROVERVIEW-FLOOR-1`).
> **O2** (D2) Thêm 3 mục rail trái «Kiểm duyệt» · «Thống kê tương tác» · «Thiết lập huy hiệu»?  ☑ **a cả 3 mục**
> ☐ b chỉ 2 mục đầu  ☐ c không mục nào. ⇒ bước nối dây rail KHÔNG chờ; W1/W2 ghim số theo (a).
> **O3** (D4) Nút «Báo cáo» trên BÌNH LUẬN?  ☑ **a làm trong FE-3, ở PR-C, SAU khi FE-2D lát B merge**  ☐ b tách WO
> riêng  ☐ c làm ngay ở PR-A (xung đột 2 nhánh FE-2D). ⇒ L8 là lát thi công thật.
> **Thứ tự merge (owner đồng ý 05/10):** FE-2D lát B (`feat/s16-social-fe-2d`) được mở lại ngay — phiên điều phối
> rebase + mở PR song song. PR-A/PR-B của FE-3 KHÔNG chạm file nào của lát B; với lát A (`…-fe-2d-a`) chỉ chung
> `W/index.ts` + `i18n/…/social.ts` + `harness/backlog.mjs`, chèn ở vị trí đã chỉ định (M19 · D6 · D18). PR-C đi SAU lát B.
>
> ☐ **Chờ owner tick — owner CHƯA được hỏi; KHÔNG áp «im lặng = đồng ý».** Sáu ô dưới không chặn thi công; chúng
> được chép lên ĐẦU mô tả PR-A để owner tick khi duyệt merge (owner là người bấm merge). Chưa tick ⇒ PR ghi rõ
> «lệch chữ `done_when` ↔ SPEC / giao thiếu so với SPEC, chờ owner».
> ☐ **O4** (D11) Tab «Bài đang ẩn» KHÔNG liệt kê bài trong NHÓM (server loại bài nhóm khi vắng `groupId`, M4).
> Người dùng mất: bài nhóm đã ẩn không tìm lại được ở màn 010 để «Hiện lại» — chỉ còn tới qua link trực tiếp của bài
> hoặc «Xem trong ngữ cảnh» ở dòng báo cáo.  ☐ a giao kèm dòng giới hạn ghi rõ trên màn + nợ BE
> `S16-SOCIAL-GROUPMOD-1` (khuyến nghị)  ☐ b hoãn tab tới khi BE mở nguồn bài nhóm.
> ☐ **O5** (D10) `delete_target` từ hàng đợi xoá mềm bài/bình luận trong khi FE CHƯA có màn khôi phục (057/058).
> Người dùng mất: xoá nhầm không hoàn tác được trên giao diện (dữ liệu còn ở server; cùng giới hạn với «Xoá bài» ở
> menu ⋯ hiện có).  ☐ a giao kèm ô tick xác nhận + nợ `S16-SOCIAL-FERECYCLE-1` (khuyến nghị)  ☐ b ẩn lựa chọn
> `delete_target` tới khi có thùng rác.
> ☐ **D1** sửa chữ `done_when` #1 theo SPEC-16:236 — manager vào màn 010 CHỈ-ĐỌC (§8.1).
> ☐ **D14** sửa chữ `done_when` #2 — ô fbpost gác MỘT cặp, khớp chữ ký `S16-SOCIAL-FBPOST-1.md:56` (§8.2).
> ☐ **D16** sửa chữ `done_when` #3 — mount thẳng `HrOverviewWidget`, không `DashboardWidgetGrid` (§8.3).
> ☐ **D17** tách WO thành FE-3 / FE-3B / FE-3C theo 3 PR tuần tự (§8.6).

## 1. Phép đo (05/10/2026 trên `b637f3d6`)

Viết tắt: `S/` = `apps/api/src/social/` · `C/` = `packages/contracts/src/` · `W/` = `packages/web-core/src/` ·
`A/` = `apps/app/src/`.

| # | Đo | Kết quả |
| --- | --- | --- |
| M1 | FE-3 có cần API mới hơn PROD `14afbb5f`? | **Không.** `git merge-base --is-ancestor` cho BE-3A `4cf305a4` · BE-3B `29e49082` · BE-3C `86fcb72f` → `14afbb5f` = ANCESTOR ×3. Sau `14afbb5f` chỉ 4 commit chạm `apps/api/src`+contracts (#568 `f72ea8f2` · #567 `af314526` · #566 `19a7a6e4` · #560 `a5ecaf0e`) — không commit nào thêm route FE-3 gọi. **Hình dạng DTO (phiên điều phối đo 05/10):** `git diff --stat 14afbb5f origin/master -- packages/contracts/src/` — `social-api-b.ts` (8 dòng) · `social-api-kudos.ts` (2) · `social-api.ts` (+6) · `social-feed-blocks.ts` (4) CHỈ đổi docblock; `social-api-stats.ts` · `social-errors.ts` 0 dòng; phần còn lại là kênh WS / ngoài SOCIAL ⇒ `feedReportPageSchema` · `feedEngagementResponseSchema` · `kudosBadgeAdminPageSchema` · schema bài 001 KHÔNG đổi hình dạng so với bản PROD đang chạy. **Trạng thái PROD:** phiên điều phối đo 05/10/2026 08:47 — `GET /api/v1/health` trả commit `14afbb5f`, tức TRƯỚC #568 `f72ea8f2` (ký URL avatar) ⇒ trên PROD `avatarUrl` còn là cột THÔ ⇒ D8. |
| M2 | 028 `GET /social/reports` | `S/social-b.controllers.ts:177-179`. Cặp `view:feed-report`, `companyFloor:false`, `dataScope:"Department"` (`S/social-route-pairs.const.ts:207`). Query `{status?, page=1, limit=20}` `.strict()` (`C/social-api-b.ts:281-287`) — vắng `status` = mọi trạng thái. Trả `{data,page,limit,total}` (`:410-415`). DTO tập khoá đóng (`:393-407`); `reporter:null` = **che theo scope**, khác object có `employeeId:null` (`:373-391`); `targetSnapshot` có `status`/`deletedAt`, đọc xuyên cổng hiển thị (`:353-362`). |
| M2b | Snapshot của báo cáo BÌNH LUẬN | Với `targetType='comment'`: `postId` · `author*` · `status` · `deletedAt` là của **BÀI CHA** (JOIN `rPost` qua `rComment.postId` — `S/social-reports.repository.ts:57-61,87-93,217-228`; `S/social-reports.service.ts:606-618`); CHỈ `bodyExcerpt` là của bình luận (`repository.ts:99-102`). DTO KHÔNG có tác giả bình luận và KHÔNG có `deletedAt` của bình luận (JOIN `rComment` không lọc `deleted_at`, `:63-67`). API-19:282-284: xoá BÀI không đóng báo cáo về bình luận của bài — «FE-3 hiển thị như thường». Nghĩa hành động kèm khác nhau theo loại đích: API-19:269-272 · `C/social-api-b.ts:291-294`. |
| M3 | 029 `PATCH /social/reports/:report_id` | `S/social-b.controllers.ts:186-188`. Cặp `manage:feed-report`, tầng 1 là SÀN (`const.ts:227`). Body `{status:'resolved'\|'dismissed', resolutionNote? ≤1000, action='none'}` `.strict()` + refine «`dismissed` ⇒ `action:none`» (`C/social-api-b.ts:310-327`; `FEED_NOTE_MAX=1000` `C/social-api.ts:53`). Ma trận: post → `none·hide_post·lock_comments·delete_target`; comment → `none·lock_comments·delete_target` (`S/social-report-actions.ts:20-23`). `action≠none` đòi THÊM `manage:feed-post` (`const.ts:553-557`; `social-report-actions.ts:41-45`). Trả MỘT `feedReportSchema`. |
| M4 | Bài đang ẩn | 001 nhận `status` ∈ `published\|hidden` (`C/social-api.ts:83`); thiếu `canManagePosts` ⇒ **403** `MODERATION_FIELD_DENIED` = `SOCIAL-ERR-010` (`S/social-posts.service.ts:105-107`; `C/social-errors.ts:37`); vắng `groupId` ⇒ LOẠI bài nhóm (`:124`); keyset, không `total`. Client có sẵn `socialApi.listFeed` (`W/lib/social-api.ts:115-116`) + `moderatePost` (`:198`). 006 = `manage:feed-post` sàn (`const.ts:156`). Không có route ẩn BÌNH LUẬN. |
| M5 | 027 `POST /social/reports` | `S/social-b.controllers.ts:161-164` `@Idempotent()`, cặp `view:feed` (`const.ts:196`). Body `{targetType,targetId,reason,note?≤1000}` `.strict()` (`C/social-api-b.ts:270-277`). Trả **`{ id }`** (`S/social-reports.service.ts:94`). Trùng báo cáo đang mở ⇒ 409 `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` (`:117-118`; `C/social-errors.ts:41`). FE: nút CỐ Ý vắng, «đi cùng một lượt ở S16-SOCIAL-FE-3» (`A/routes/social/feed/components/PostCardMenu.tsx:18-20`; `docs/plans/S16-SOCIAL-FE-1.md:337` N8, owner ký 23/09). |
| M6 | 052/053 thống kê | `S/social-stats.controller.ts:45-48` (052) · `:28-30` (053). **CÙNG** cặp `view:feed-report`, cùng `companyFloor:false` (`const.ts:237,239`) ⇒ cổng TẢI = cổng XEM. Query `{from?,to?,orgUnitId?}` `.strict()`: `from`/`to` đi cùng nhau, ngày phải tồn tại, `from≤to`, sau nắn ≤ 26 tuần (`C/social-api-stats.ts:12,63-98`); vắng ⇒ 8 tuần (`:14`). `snapToIsoWeeks` export (`:47-61`). Trả `{range,units,rows,weekTotals}` (`:131-136`); `rows.orgUnitId` nullable (`:117-121`); `activeMembers` tuần là DISTINCT (`:124`). 053 đặt header XLSX ở đường THÀNH CÔNG (`controller.ts:37-40`) ⇒ lỗi vẫn là JSON. |
| M7 | Huy hiệu quản trị | 056 `GET kudos-badges/manage` (`S/social-b2b2.controllers.ts:146-148`) · 049 `POST` `@Idempotent` (`:155-158`) · 050 `PATCH` (`:165-167`) · 051 `DELETE` (`:178-180`); cả bốn `manage:feed-kudos` (`const.ts:334-340`). `code` `^[a-z0-9-]{2,32}$` (`C/social-api-kudos.ts:110-112`); tạo (`:120-128`); sửa `.strict()` KHÔNG có `code`, ≥1 trường (`:135-146`); DTO quản trị có `isActive` (`:150-160`); 056 `limit` mặc định 50 (`:164-169`). 048 công khai dùng schema KHÁC (`:73-80`). |
| M8 | Cặp nào tới được FE | 14 cặp `feed-*` đều `is_sensitive=false` (`apps/api/migrations/0578_s16socialdb1_seed_feed_perms.sql:40-54`) ⇒ `/auth/me` phát hết. `manage:feed-post`·`feed-kudos`·`feed-report` → hr + company-admin @Company (`:94-101`); `view:feed-report` → manager@**Department** + hr + company-admin (`:108-110`). |
| M9 | Hai họ cổng FE | Route/sidebar/ô app dùng `createPermissionChecker` — khớp ĐÚNG-BẰNG, không wildcard (`W/lib/registry.ts:262-271`); `requiredPermissions` = đủ hết, `requiredAnyPermissions` = một trong, áp CẢ HAI (`:302-332`). Trong màn dùng `useCan` (có wildcard) cho cặp `feed-*` (`PostCardMenu.tsx:52-55`). |
| M10 | Route SOCIAL | 11 mục `ROUTE_REGISTRY`, `order` 92..102, tất cả `MODULE_PORTAL` + `requiredPermissions:["view:feed"]` (`W/lib/registry.ts:2218-2356`) ⇒ mục mới từ **103**. Router: `getMeta` (`A/router.tsx:83`), khuôn `createRoute` + `getMeta("social.kudos")` (`:3194`), route chuyển hướng NOTI (`:3228-3237`, cây `:3644-3645`). `/social/reports` (NOTI-036) chưa có route — «chờ S16-SOCIAL-FE-3» (`A/routes/social/legacy-social-redirects.ts:7-8`). |
| M11 | Sidebar | `SOCIAL_SIDEBAR_V2` 7 mục, order 10..60, nhóm `overview`/`operation` (`A/layouts/workspace/sidebar/social.ts:34-111`), đi qua `pruneUnbuiltScreens` (`:117`). Nhóm hợp lệ: overview · operation · master-data · management · report · settings · admin (`ModuleSidebar.tsx:42-50`). Active = `pathname === path \|\| startsWith(path+"/")` (`:55-56`). `ICON_MAP` có `shield-alert` · `settings` · `award`; KHÔNG có `bar-chart-3`, `facebook` — rơi về `Circle` (`DynamicIcon.tsx:73-153`). |
| M12 | Ratchet/snapshot sẽ đổi | `A/routes/social/social-wiring.spec.ts`: `:46` (7 mục) · `:47-55` (thứ tự khoá) · `:91` (11 route) · `:117-127` (7 route `showInSidebar`) — **đỏ có chủ ý**. Giữ xanh nếu tuân: `:95-100` (mọi route CHỨA `view:feed`) · `:103-108` (`MODULE_PORTAL`) · `:111-114` + `:228` (dưới `/feed`). Snapshot: `sidebar-registry.snapshot.spec.ts:118-140` ghi 2 file `__snapshots__/sidebar-tree.{raw,by-permission}.txt` (khối `### SOCIAL` `raw.txt:120-127`; định dạng `all=[…]`/`any=[…]` `:77-79`); ca «không quyền ⇒ rỗng» `:143`; chỉ bộ `ALL` có `view:feed` — 4 bộ còn lại (`:103-114`) cho khối SOCIAL `(trống)` trước VÀ sau ⇒ không phải bằng chứng cổng. `W/lib/registry.spec.ts:1313-1322` routeKey + path duy nhất. **Ratchet thứ năm:** `A/routes/social/legacy-social-redirects.spec.ts` — `:19` mảng 2 template · `:31-35` `toEqual` · `:37-45` `it.each` đọc `entry.param` ⇒ thêm nhánh không tham số là ĐỎ + typecheck đỏ; thân `legacyRedirectBeforeLoad` đọc `params[entry.param]` TRƯỚC khi rẽ `kind` (`legacy-social-redirects.ts:64-69`); template NOTI-036 = `/social/reports` (`apps/api/migrations/0581_s16socialdb2_noti_track_b.sql:272`). Không spec nào dựng cây route thật (`legacy-social-redirects.spec.ts:4-7`); tiền lệ đọc NGUỒN `router.tsx`: `A/routes/assets/asset-wiring.spec.ts:102-112`. |
| M13 | Client + khoá cache đang thiếu | `W/lib/social-api.ts:88` (027..029 cố ý chưa mirror); `W/lib/social-kudos-api.ts:28-46` chỉ `list`·`searchRecipients`·`listBadges`; `socialKeys` (`W/lib/query-keys.ts:1377-1478`) không có reports/stats/badges-admin; `kudos.badges()` KHÔNG tham số (`:1476`). |
| M14 | Báo lỗi | App không có toast; `ActionErrorBanner` tập `kind`/`reason` ĐÓNG (`A/routes/social/feed/components/ActionErrorBanner.tsx:27-49,58-73`) — file này nằm trong nhánh fe-2d-a (M19). Đọc mã: `socialErrorCode` · `isForbiddenError` · `isStaleStateError` (`A/routes/social/groups/lib/group-errors.ts:55,101,109`). Mã idempotency: `C/idempotency.ts:27-29`. |
| M15 | Mẫu tải file | `apiFetchBlob` → `{blob, filename\|null}`; `!ok` ⇒ ném `ApiError` (`W/lib/api-client.ts:587-591,612-620,630`). Nút mẫu `A/routes/attendance/ExportAttendanceButton.tsx:40-80`; `triggerBlobDownload` (`A/lib/download-blob.ts:12` — ngoài `paths`, chỉ IMPORT). API `enableCors` (`apps/api/src/main.ts:43`) không khai `exposedHeaders` (grep 0) ⇒ `filename` có thể `null` khi cross-origin ⇒ BẮT BUỘC tên dự phòng `.xlsx`. |
| M16 | Recharts | ĐÃ cài `^3.10.1` (`apps/app/package.json:37`); nơi dùng duy nhất `A/routes/payroll/components/overview/OverviewCharts.tsx`; `ChartCard` 5 trạng thái + nút chuyển bảng (`A/components/charts/ChartCard.tsx:7,20,49` — ngoài `paths`, chỉ IMPORT). `A/test/setup.ts` (4 dòng) không polyfill `ResizeObserver`; chưa spec nào render Recharts. |
| M17 | Dải ô (P4) | 7 `appKey` có đủ trong `APP_REGISTRY` (`W/lib/registry.ts`): `attendance` any 3 mã `:618` · `leave` any `:636` · `tasks` any `:654` · `goals` `access:goal` `:705` · `lms` `access:lms` `:771` · `fbpost` **MỘT cặp** `view:social-post` `:842`, `switcherOnly` `:843`, icon `facebook` `:837` · `rooms` ĐỦ `access:room`+`view:room` `:886`. `getVisibleApps` (`:958-978`) trả cả app trạng thái khác `active` dù không quyền (`:971-972`); `getHomeGridApps` LOẠI `switcherOnly` (`:987-993`). Mở cross-domain: `getCrossDomainOpener` never-throw (`A/layouts/home/cross-domain-apps.ts:26-37`), khuôn gọi `AppSwitcher.tsx:187-192`. Session portal `modules: []` (`A/layouts/portal/portal-session.ts:27-33,41-56`). Nhãn registry: «Phòng họp», «Đăng bài Facebook» (`W/i18n/locales/vi/nav.ts:26,30`). Chỗ chèn: trên `<FeedComposer>` (`A/routes/social/feed/FeedPage.tsx:152`). Owner đã ký một cặp cho fbpost (`docs/plans/S16-SOCIAL-FBPOST-1.md:56`). |
| M18 | Widget «Nhân sự» (P5) | `HrOverviewWidget` gác ngoài `<PermissionGate read:employee>`, Inner mới phát request (`A/components/dashboard/HrOverviewWidget.tsx:22-27,77-84`). Route data gác `read:dashboard` (`apps/api/src/dashboard/dashboard-widget-data.controller.ts:39-40`); widget gác `read:employee` (`dashboard-widget-catalog.const.ts:347`), KHÔNG có sàn scope (`:435`). `read:employee` non-sensitive (`migrations/0019_g5_permissions_seed.sql:17-21`) cấp CẢ 4 vai (`0444_s2_authseed1_canonical_roles_perms.sql:99-102`) ⇒ cặp này không tách được ai. `view-hr:dashboard` `isSensitive:true` (`catalog.const.ts:518-521`) và vắng allowlist ⇒ KHÔNG tới FE. Cặp non-sensitive chỉ hr + company-admin giữ: `create`/`update`/`change-status:employee` (`0444:108-115`), FE có hằng `HR_ENGINE_PAIRS.UPDATE_EMPLOYEE` (`A/routes/hr/constants.ts:70`). Chỗ cắm: sau `<MyGroupsWidget>` (`A/routes/social/feed/SocialPortalShell.tsx:205-209`); spec shell giữ web-core THẬT (`SocialPortalShell.spec.tsx:39-60`). UI-07 đặt widget CUỐI rail «(theo quyền)» (`docs/UI/UI-07_Module_Workspace_Template_Design.md:2159-2160`); SPEC-07 «chỉ HR/Admin… hoặc user có quyền HR overview» (`docs/SPEC/SPEC-07 DASH.md:1198`). |
| M19 | Chồng lấn 2 nhánh FE-2D (`git diff --name-only origin/master...`; phiên điều phối đo lại 05/10) | `feat/s16-social-fe-2d` (lát B) 28 file · `feat/s16-social-fe-2d-a` (lát A, xếp chồng lên B) 54 file. FE-3 chạm 4 file chung: `W/index.ts` (fe-2d-a nối 9 dòng sau `:417`) · `A/i18n/locales/vi/social.ts` (fe-2d-a thêm import sau `:20`, khoá sau `:408`) · `harness/backlog.mjs` · **`A/routes/social/feed/components/CommentList.tsx`** (lát B đổi đúng 1 dòng `:78`; `CommentList.spec.tsx` +36 dòng) — chỉ L8 chạm và L8 đi SAU lát B. Lát B còn chạm `PostCard(.spec)` · `PostDetailPage(.spec)` · `FeedPage.spec` · `use-feed-actions` · `feed/social-test-doubles.tsx`; lát A thêm `ActionErrorBanner` · `CommentComposer` · `FeedComposer` · `feed/lib/feed-format.ts` (FE-3 chỉ IMPORT). Hai nhánh KHÔNG chạm: `router.tsx` · `registry.ts` · `query-keys.ts` · `nav.ts` · `sidebar/social.ts` · `DynamicIcon.tsx` · `SocialPortalShell.tsx`(+spec) · `FeedPage.tsx` · `PostCardMenu.tsx` · `legacy-social-redirects.ts` · `KudosBadgeIcon.tsx` · `social-wiring.spec.ts` · `social-kudos-api.ts`. |
| M20 | Cổng CI/test | `social-cov`: đo `src/routes/social/**` + `src/layouts/portal/**`, sàn 80 × 4 trục, loại `*.spec` + `feed/social-test-doubles.tsx` (`apps/app/vitest.social.config.ts:41-58`); bước CI `apps-frontend.yml:141`. Chạm `packages/**` ⇒ CI chạy cả auth + console + app (`:68-70`). `check.sh` 3 tầng `--quick` / mặc định / `--all` (`harness/check.sh:8-10`); chunk runner nhận `--packages=` `--max-forks=` `--no-build` (`harness/chunk-test.mjs:123-127`). Không có `@testing-library/user-event`, axe, ratchet khoá i18n. |
| M21 | File đã vượt trần 800 | `router.tsx` 3666 · `registry.ts` 2394 · `query-keys.ts` 1478 (nợ sẵn có — FE-3 chỉ NỐI, không cổng nào ép). `social.ts` (i18n) 487 · `W/index.ts` 417. |
| M22 | i18n | MỘT namespace `social` (`A/i18n/index.ts:38,57`); cụm lớn tách file con gắn ở `social.ts:19-20,406,408`. |

## 2. Quyết định

- **D1 — cổng màn Kiểm duyệt theo SPEC, không theo chữ `done_when` [KỸ THUẬT].** `done_when` #1 ghi «chỉ hiện với
  manage:feed-report/manage:feed-post»; SPEC-16:236 + guard 028 + seed (M2, M8) cho manager vào CHỈ-ĐỌC. Phương án:
  (a) theo SPEC · (b) theo done_when (manager mất màn mà server + NOTI-036 mở cho họ). **Chọn (a):** route
  `["view:feed","view:feed-report"]`; nút «Xử lý» `manage:feed-report`; lựa chọn hành động kèm, tab «Bài đang ẩn»
  và «Hiện lại» `manage:feed-post`. Sửa chữ done_when ở §8.1 — chờ owner tick ô ☐ D1 (§0).
- **D2 — lối vào 3 màn quản trị [OWNER · O2 = a, ký 05/10].** UI-07 §34b.2 không liệt kê; SPEC-16:446 đòi «forbidden
  = ẩn mục khỏi sidebar». Owner chọn 3 mục rail: «Kiểm duyệt» nhóm `management` order 70 icon `shield-alert` · «Thống
  kê tương tác» nhóm `report` order 80 icon `bar-chart-3` · «Thiết lập huy hiệu» nhóm `settings` order 90 icon
  `settings`. Mỗi mục khai `requiredPermissions` (ĐỦ-HẾT) đúng cặp của route (D3) — KHÔNG chép khuôn
  `requiredAnyPermissions` của 7 mục cũ: any-of `[view:feed, view:feed-report]` làm MỌI nhân viên thấy mục, bấm thì
  403 (W1 · W4). hr/company-admin thêm 3 tab trên thanh tab <1024px. Chạm `layouts/workspace/sidebar/social.ts` +
  `DynamicIcon.tsx` là theo tiền lệ `SOCIAL_SIDEBAR_V2` (trong `paths`) — lệch câu «không sửa `layouts/workspace/`»
  của UI-07:2223, ghi vào nợ DOC-2.
- **D3 — đường dẫn + cổng route [KỸ THUẬT].** `/feed/moderation` (`social.moderation`, `SOC-SCREEN-010`, order 103,
  `["view:feed","view:feed-report"]`) · `/feed/stats` (`social.stats`, `SOC-SCREEN-011`, order 104, cùng cặp) ·
  `/feed/kudos-badges` (`social.kudosBadges`, `SOC-SCREEN-012`, order 105, `["view:feed","manage:feed-kudos"]`).
  `/feed/kudos-badges` chứ không `/feed/kudos/badges` (M11: luật active làm «Vinh danh» sáng cùng lúc). Cổng route =
  cặp của LỜI GỌI ĐẦU TIÊN của màn. KHÔNG khai `requiredScopes`. Mục sidebar khai `requiredPermissions` Y HỆT route.
  Trong `router.tsx`, `path` và `getMeta("…")` là hai literal rời ⇒ ca W3 ghim cặp. Chuyển hướng `/social/reports` →
  `/feed/moderation` (M10): nhánh union thứ ba `kind:"reports"` KHÔNG tham số; `legacyRedirectBeforeLoad` viết lại
  thành `switch (entry.kind)` vét cạn (`default` gán `never`), rẽ nhánh TRƯỚC khi đọc `param` (M12).
- **D4 — nút «Báo cáo» thuộc WO này: BÀI ở PR-A, BÌNH LUẬN ở PR-C [OWNER · O3 = a].** Owner đã ký (M5 · N8 «ba thứ đi
  cùng một lượt, không tách»; O3 ngày 05/10): nút + hộp thoại + cảnh báo SOC-DEC-011 đi cùng nhau; không có nó hàng
  đợi không có nguồn. BÀI: đặt trong `PostCardMenu` (không nhánh FE-2D nào chạm), state cục bộ, hộp thoại mount
  LƯỜI — không đổi `PostCardMenuActions`, không chạm `use-feed-actions.ts`/`PostCard.tsx`; ẩn với bài của chính mình
  (`post.isMine`). BÌNH LUẬN (L8): nút trong `CommentRow` của `CommentList.tsx`, dùng CÙNG `ReportDialog` — nên
  `ReportDialog` nhận `targetType`/`targetId` làm prop NGAY từ L3; chỉ chạm `CommentList.tsx` sau khi lát B đã ở
  master (M19).
- **D5 — dải lỗi riêng, KHÔNG sửa `ActionErrorBanner` [KỸ THUẬT].** File đó nằm trong fe-2d-a (M14, M19). Tạo
  `routes/social/admin/components/AdminErrorNotice.tsx` (`role="alert"`, nhận `reason` thuộc tập đóng
  `ADMIN_ERROR_REASONS`, chữ ở `social:admin.error.<reason>`) + `admin/lib/admin-errors.ts` (bảng mã → reason theo
  TỪNG lời gọi, tra `Object.hasOwn`, dùng `socialErrorCode`/`isForbiddenError` có sẵn — chỉ IMPORT).
- **D6 — CLIENT + khoá cache của web-core gom MỘT lần ở L1 [KỸ THUẬT].** Client cả 3 cụm (báo cáo · thống kê · huy
  hiệu quản trị) + khoá cache vào PR đầu; export chèn SAU `index.ts:409`, không nối cuối file (chồng fe-2d-a, M19).
  **Đây KHÔNG phải lần chạm web-core duy nhất:** mỗi lát có route (L2 · L4 · L5) còn thêm mục `ROUTE_REGISTRY` +
  `routeTitle` trong `W/lib/registry.ts` · `W/i18n/locales/vi/nav.ts` ⇒ PR-A VÀ PR-B đều kéo auth + console vào CI
  (M20), đều phải build lại web-core và chạy `registry.spec` (§6 lệnh 1–2).
- **D7 — ma trận hành động chép ở FE, KHÔNG sửa contracts [KỸ THUẬT].** `apps/api/**` ngoài `paths` ⇒ đưa hằng vào
  contracts vẫn là 2 bản sao, lại kích `api.yml`. `moderation/lib/report-actions.ts` chép ma trận (M3) kèm ghi nguồn;
  server vẫn là cổng thật (422). Nợ ở §8.
- **D8 — avatar: không truyền `src` [KỸ THUẬT].** API PROD trả cột thô (M1) — tiền lệ FE-2C D15. Mọi bề mặt FE-3
  vẽ `<Avatar name>`; spec assert không có `<img>` với fixture `avatarUrl` KHÁC rỗng. Bật lại `src` khi #568 lên
  PROD = nợ §8.9.
- **D9 — hình dạng danh sách [KỸ THUẬT].** Hàng đợi = danh sách THẺ (trích đoạn + ghi chú nhiều dòng, cột giữa
  hẹp) + `OffsetPager`; 011/012 = `<table>` thuần trong khung cuộn ngang (2–7 cột số). Không kéo `DataTable`.
- **D10 — mặc định hàng đợi [KỸ THUẬT · O5 chờ tick].** Lọc mặc định `open` (không ghi lên URL), có «Tất cả» (=
  không gửi `status`); đổi bộ lọc ⇒ về trang 1. Ghi chú xử lý TUỲ CHỌN như server. `delete_target` buộc tick xác nhận
  trong hộp thoại, chữ tick nói rõ xoá CÁI GÌ và «chưa có màn khôi phục» (bảng loại đích, L2). «Bỏ qua» ⇒ ẩn ô hành
  động và KHÔNG gửi khoá `action`.
- **D11 — tab «Bài đang ẩn» [KỸ THUẬT · O4 chờ tick].** Nguồn 001 `{status:"hidden", sort:"latest"}`,
  `useInfiniteQuery`, nhánh khoá RIÊNG `socialKeys.moderation.hiddenPosts()`, `staleTime: 0`, `enabled` theo
  `manage:feed-post`. Dòng GỌN tự vẽ (tác giả · trích body · thời gian · «Xem bài» · «Hiện lại») — không dùng
  `PostCard`/`useFeedActions` (file FE-2D). «Hiện lại» gửi ĐÚNG `{hidden:false}`. Trạng thái RIÊNG của tab: skeleton
  · lỗi khác 403 + «Thử lại» · rỗng («Không có bài nào đang ẩn») · «Tải thêm» khi `nextCursor ≠ null`. Giới hạn ghi
  rõ trên màn (cả khi rỗng): không gồm bài trong nhóm, không có tổng (M4).
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
  **và** `kudos.badges()` (ô chọn của composer). Khoá idempotency 049 = nội dung + `attemptId` của lượt mở (D20).
- **D14 — dải ô liên kết nhanh [KỸ THUẬT].** Hằng `FEED_QUICK_LINK_APP_KEYS` (7 khoá, thứ tự SC-14) chỉ chứa
  `appKey`; nhãn · icon · cổng · đích lấy 100% từ `APP_REGISTRY` qua `getVisibleApps` (KHÔNG `getHomeGridApps`) + lọc
  `status === "active"`. Ô fbpost gác đúng MỘT cặp `view:social-post` của registry (M17) — chữ «3 cặp cũ» của
  done_when #2 sai, sửa ở §8.2 (ô ☐ D14). `lms`/`fbpost` mở qua `getCrossDomainOpener` (fallback
  `navigate(defaultRoute)`); ô khác `<Link>`. 0 ô ⇒ không render gì. Thêm `facebook` vào `ICON_MAP`.
- **D15 — ai thấy widget «Nhân sự» [OWNER · O1 = B, ký 05/10].** Cặp BE `read:employee` cả 4 vai đều có, không sàn
  scope; FE không có scope (M18). Owner chọn (B) chỉ hr + company-admin: thêm vế `update:employee`
  (`HR_ENGINE_PAIRS.UPDATE_EMPLOYEE`) làm cặp phân biệt — chặt hơn BE, fail-closed, loại cả manager (lệch SPEC-07:1200;
  bỏ cặp thay thế khi BE có sàn scope — nợ `S4-DASH-HROVERVIEW-FLOOR-1`). Không chọn: (A) mọi người có
  `read:dashboard`+`read:employee` — nhân viên thấy «1 nhân sự»; (C) hoãn.
- **D16 — cách nhúng [KỸ THUẬT].** «Cùng component grid» = cùng component widget mà Grid mount, KHÔNG phải
  `DashboardWidgetGrid` (nó đòi metadata `/dashboard/me` — chính là một request DASH). Component bọc
  `HrOverviewRailSlot` gọi `useCanExact` cho TỪNG vế rồi mới mount `<HrOverviewWidget />`; không truyền
  `dashboardType`; không sửa widget gốc. AND thêm `view:feed` cho nhất quán 5 widget rail. Chữ `done_when` #3 sửa ở
  §8.3 (ô ☐ D16).
- **D17 — ranh giới PR/WO [KỸ THUẬT · ô ☐ D17].** Ước tính ~5.300 dòng diff (L1 ~500 · L2 ~1.700 · L3 ~450 · L4
  ~700 · L5 ~1.300 · L6 ~300 · L7 ~150 · L8 ~200). (a) 1 PR · (b) PR xếp chồng · (c) **3 PR TUẦN TỰ, mỗi PR cắt
  từ master sau khi PR trước merge**: PR-A = L1+L2+L3 (vòng kiểm duyệt khép kín) · PR-B = L4+L5 · PR-C = L6+L7+L8
  (L8 sau FE-2D lát B). **Chọn (c):** squash-merge làm gãy PR xếp chồng; sổ cái đóng dấu WO theo commit merge ⇒ tách
  WO `FE-3` (PR-A) / `FE-3B` (PR-B) / `FE-3C` (PR-C) như tiền lệ FE-2/2B/2C; PR-A/PR-B chỉ chồng fe-2d-a ở 2 file đã
  chỉ định vị trí chèn (M19); mỗi PR dừng được.
- **D18 — i18n [KỸ THUẬT].** MỘT file gốc `i18n/locales/vi/social-admin.ts` gắn vào `social.ts` dưới khoá `admin`
  — chạm `social.ts` đúng MỘT lần (import chèn TRƯỚC `:19`; khoá `admin,` kèm dòng chú thích riêng chèn TRƯỚC `:405`
  — `:405` là chú thích của `groups,` `:406`, chèn giữa hai dòng đó là tách chú thích khỏi khoá; vẫn cách hunk
  fe-2d-a ở `:408`). PR sau chỉ sửa `social-admin.ts`; vượt 400 dòng thì tách `social-admin-*.ts`. Nhãn mục «Báo cáo»
  (bài + bình luận) cũng ở `social-admin.ts` (`social:admin.report.*`), KHÔNG thêm vào `post.menu.*`/`comment.*` của
  `social.ts`. `routeTitle.*` vào `W/…/nav.ts`.
- **D19 — file test-double mới bị loại khỏi mẫu số coverage [KỸ THUẬT].** `exclude` của
  `apps/app/vitest.social.config.ts:46-56` chỉ nêu đích danh `feed/social-test-doubles.tsx` ⇒
  `admin/admin-test-doubles.tsx` sẽ bị tính vào 4 trục. (a) thêm MỘT dòng exclude + thêm file config vào `paths`
  (§8.6) · (b) đo luôn. **Chọn (a)** — đúng lý do ghi trong chính config («công cụ, không phải mã sản phẩm»). Điều
  kiện: file double chỉ chứa factory/fixture; PR-A ghi 4 số coverage trước/sau dòng exclude.
- **D20 — «đang gửi» + khoá idempotency theo lượt mở [KỸ THUẬT].** (i) Mọi nút gửi `disabled` khi mutation
  `isPending` (`ResolveReportDialog` · `ReportDialog` · `BadgeFormDialog` · «Hiện lại» · «Ngừng dùng»/«Bật lại»):
  029/006/050/051 KHÔNG `@Idempotent()` (`S/social-b.controllers.ts:186` · `S/social.controllers.ts:131` ·
  `S/social-b2b2.controllers.ts:165,178`) ⇒ bấm đúp sinh 409 `021` giả «đã có người xử lý». (ii) 027/049 có
  `@Idempotent`, TTL 900 s (`apps/api/src/common/idempotency/idempotency-store.service.ts:17`): khoá suy từ nội dung
  THUẦN sẽ phát lại trong 15 phút — báo cáo → HR bỏ qua → báo cáo lại y hệt ⇒ FE báo «đã gửi» mà không có báo cáo
  mới; huy hiệu tạo → ngừng → tạo lại ⇒ 201 phát lại thay vì 409. ⇒ `createReport(body, attemptId)` ·
  `createBadge(body, attemptId)`, khoá = `idempotencyKeyFor(scope, { attemptId, body })`; `attemptId` sinh MỘT lần
  mỗi lượt MOUNT hộp thoại (`useRef`) — thử lại trong cùng lượt mở vẫn cùng khoá (giữ luật «khoá ổn định qua các lần
  thử lại», `W/lib/api-idempotency.ts:50-66`), lượt mở mới ⇒ khoá mới.

## 3. Lát thi công

Thư mục mới: `A/routes/social/{admin,moderation,stats,badges}/`. File mới ≤ 400 dòng. Mọi `useMutation` có `onError`;
mọi nút gửi `disabled` khi `isPending` (D20).

### L1 — Nền (PR-A) · không có gì người dùng thấy

- **TẠO** `W/lib/social-moderation-api.ts` (+ `.spec.ts`): `listReports(query)` → 028 parse `feedReportPageSchema` ·
  `resolveReport(id, body)` → 029 parse `feedReportSchema` · `createReport(body, attemptId)` → 027, schema cục bộ
  `feedReportCreatedSchema = z.object({ id: uuid })`, khoá `idempotencyKeyFor("social-report", { attemptId, body })`.
- **TẠO** `W/lib/social-stats-api.ts` (+ `.spec.ts`): `engagement(query)` → 052 parse `feedEngagementResponseSchema` ·
  `exportEngagement(query)` → `apiFetchBlob("/social/stats/engagement/export" + qs)`.
- **SỬA** `W/lib/social-kudos-api.ts` (+ nối ca vào `.spec.ts` có sẵn): `listBadgesAdmin({page,limit})` → 056
  `kudosBadgeAdminPageSchema` · `createBadge(body, attemptId)` (khoá `idempotencyKeyFor("social-kudos-badge",
  { attemptId, body })`) · `updateBadge(id, body)` · `deactivateBadge(id)` (DELETE, trả `kudosBadgeAdminSchema`).
- **SỬA** `W/lib/query-keys.ts` (nối vào `socialKeys`): `moderation.{allOf, reports.lists(), reports.list(params),
  hiddenPosts()}` · `stats.{allOf, engagement(params)}` · `kudos.badgesAdminAll()` + `kudos.badgesAdmin(params)`.
- **SỬA** `W/index.ts` (sau `:409`) · **TẠO** `A/i18n/locales/vi/social-admin.ts` + 2 chỗ chèn ở `social.ts` (D18) ·
  **SỬA** `apps/app/vitest.social.config.ts` (đúng MỘT dòng exclude — D19).
- **TẠO** `admin/components/AdminErrorNotice.tsx` · `admin/lib/admin-errors.ts` · `admin/admin-test-doubles.tsx`
  (`makeReport` · `makeEngagement` · `makeBadgeAdmin` · `ADMIN_ERR` — KHÔNG sửa `feed/social-test-doubles.tsx`).

### L2 — Kiểm duyệt `SOC-SCREEN-010` (PR-A)

- **Route/nav:** `registry.ts` + mục `social.moderation` (D3) · `router.tsx` lazy `ModerationPage`, `createRoute`,
  `validateSearch`, dòng cây route và route chuyển hướng `/social/reports` · `legacy-social-redirects.ts` nhánh
  union thứ ba + `switch` vét cạn (D3) + sửa docblock `:7-8` · **`legacy-social-redirects.spec.ts`** (ca N1 — ratchet
  thứ năm, M12) · `nav.ts` `routeTitle.socialModeration` · `sidebar/social.ts` mục (O2 = a) + sửa docblock
  `:8,20-26,114-116` · `social-wiring.spec.ts` (W1 · W3 · W4) + 2 snapshot (M12).
- **TẠO** `moderation/ModerationPage.tsx` · `components/{ReportQueue,ReportRow,ResolveReportDialog,HiddenPostsTab}.tsx`
  · `lib/{moderation-route-search,report-actions,moderation-errors}.ts` · `admin/admin-route-gates.spec.tsx` (G1).
- **Search** `{tab?: "reports"|"hidden", status?: "open"|"resolved"|"dismissed"|"all", page?: number≥2}` — bộ lọc
  không ném, trả ĐỦ 3 khoá (kể cả `undefined`), ăn đầu ra parser thật (`?page=2` là SỐ); đổi `status` ⇒ bỏ `page`.
- **Query:** `moderation.reports.list({status,page})` → `listReports({status?, page, limit:20})`,
  `keepPreviousData`, `staleTime:0` · `moderation.hiddenPosts()` (D11).
- **Cổng trong màn:** «Xử lý» ⇔ `report.status==="open"` && `useCan("manage","feed-report")` · ô hành động ⇔
  quyết định «Giải quyết» && `useCan("manage","feed-post")`, lựa chọn theo `targetType` (M3) · tab «Bài đang ẩn» ⇔
  `useCan("manage","feed-post")` (thiếu ⇒ KHÔNG có tab, `?tab=hidden` rơi về tab báo cáo, KHÔNG gọi 001) · «Xem trong
  ngữ cảnh» (`/feed/posts/$postId` từ `targetSnapshot.postId`) ⇔ có snapshot && `deletedAt===null` &&
  (`status!=="hidden"` \|\| có `manage:feed-post`); ngược lại hiện nhãn trạng thái (bảng dưới) / «Nội dung không còn».
- **Thẻ báo cáo (`ReportRow`) — trường hiển thị:** nhãn lý do (5 giá trị enum → `admin.report.reason.<v>`) · loại
  đích · trích đoạn `bodyExcerpt` (chữ thuần) · dòng danh tính + nhãn trạng thái THEO LOẠI ĐÍCH · `reporter` · `note`
  · `createdAt`; hàng đã kết thúc thêm pill trạng thái + `resolvedBy` + `resolvedAt` + `resolutionNote` (`null` ⇒
  KHÔNG vẽ khối — báo cáo anh em tự đóng có note `null`). Thời gian dùng `relativeTime` (`feed/lib/feed-format.ts:58`,
  đang dùng ở thẻ bài/bình luận — tương đối ⇒ không phụ thuộc múi giờ); KHÔNG tự format ngày tuyệt đối.
- **Hiển thị danh tính:** `reporter===null` ⇒ «Ẩn theo phạm vi xem của bạn»; object `employeeId===null` ⇒ tên +
  «(hồ sơ không còn)» (`resolvedBy` dùng CÙNG luật nhánh object); `note` chữ thuần `whitespace-pre-line`.

| Theo `targetType` (M2b) | `post` | `comment` |
| --- | --- | --- |
| Dòng danh tính | «Bài của ‹authorFullName›» | «Bình luận trong bài của ‹authorFullName›» — tác giả BÀI CHA; KHÔNG ghi «tác giả bình luận» (DTO không có) |
| Nhãn trạng thái | «[đã ẩn]» · «[đã xoá]» | «[bài chứa bình luận đã ẩn]» · «[bài chứa bình luận đã xoá]»; bình luận tự nó đã xoá: không có tín hiệu (nợ BE §8.9) |
| `hide_post` | «Ẩn bài» | — (không có lựa chọn) |
| `lock_comments` | «Khoá bình luận của bài» | «Khoá bình luận của BÀI chứa bình luận này» |
| `delete_target` | «Xoá bài» · tick «Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục» | «Xoá bình luận này» · tick tương ứng cho bình luận |

- **Trạng thái:** hàng đợi — loading skeleton · lỗi + «Thử lại» · rỗng theo bộ lọc (4 câu khác nhau) · `page` quá
  trang cuối ⇒ nút «Về trang 1» · 403 route ⇒ `ForbiddenPage` của `ProtectedRoute`; tab «Bài đang ẩn» — theo D11.
- **Ghi:** `resolveReport` — body dựng bởi `buildResolveBody` (bỏ `action` khi `none`/«Bỏ qua», bỏ `resolutionNote`
  rỗng), qua `resolveFeedReportSchema.safeParse` trước khi gửi; thành công ⇒ invalidate `reports.lists()` (+
  `hiddenPosts()` · `feed.allOf()` · `posts.detail(postId)` khi có hành động). Hộp thoại `key={report.id}`; dải lỗi
  «kết cục» sống ở TRANG (hàng có thể biến mất sau refetch).

| Ca | Lời gọi | Mã (`ApiError.code`) | reason | Hành vi |
| --- | --- | --- | --- | --- |
| E1 | 029 | 409 `SOCIAL-ERR-021` | `reportAlreadyDecided` | đóng hộp thoại · dải ở trang · invalidate |
| E2 | 029 | 409 `SOCIAL-ERR-REPORT-BUSY` | `reportBusy` | giữ hộp thoại, bấm lại được |
| E3 | 029 | 403 `SOCIAL-ERR-REPORT-ACTION-DENIED` | `reportActionDenied` | giữ · đưa hành động về «không» |
| E4 | 029 | 422 `SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET` | `reportActionInvalid` | giữ |
| E5 | 029 | 422 `SOCIAL-ERR-REPORT-ACTION-TARGET-UNAVAILABLE` | `reportTargetUnavailable` | giữ · về «không» · gợi ý kết thúc không kèm hành động |
| E6 | 029 | 404 `SOCIAL-ERR-001` | `reportGone` | đóng · invalidate |
| E7 | 006 | 404 `SOCIAL-ERR-001` | `postGone` | invalidate `hiddenPosts()` |
| E8 | 001/028 | 403 (mọi mã, kể cả `SOCIAL-ERR-010`) | `forbidden` | chữ của FE, KHÔNG hiện `message` server |
| E9 | 029/006 | 403 khác (`AUTH-ERR-FORBIDDEN` tầng 1/2 — API-19:599) | `forbidden` | đóng hộp thoại · dải ở trang · KHÔNG nút thử lại |
| E10 | mọi | 400 | `invalidRequest` | — |
| E11 | mọi | khác | `generic` | «Thử lại» |

### L3 — Báo cáo bài, 027 (PR-A)

- **TẠO** `moderation/components/ReportDialog.tsx` — props `targetType: "post"|"comment"` + `targetId` (L8 dùng lại,
  D4); 5 lý do theo enum contracts (nhóm có nhãn) · ghi chú ≤ `FEED_NOTE_MAX` · dòng cảnh báo LUÔN hiện: ghi chú được
  hiện nguyên văn cho người kiểm duyệt, kể cả quản lý đơn vị — đừng viết điều tự làm lộ danh tính · `attemptId` giữ
  trong `useRef` (D20) · `moderation/lib/report-create-errors.ts`.
- **SỬA** `feed/components/PostCardMenu.tsx`: mục `report` khi `!post.isMine`; `<ReportDialog>` chỉ mount khi mở
  (để các spec cũ không cần `QueryClientProvider` cho hook mới); sửa docblock `:18-20`.
- **Spec MỚI:** `feed/components/PostCardMenu.report.spec.tsx` (P1 — chưa có `PostCardMenu.spec.tsx`; KHÔNG sửa
  `PostCard.spec.tsx` của FE-2D) · `moderation/components/ReportDialog.spec.tsx` (P2 · P3 · DC2).
- Body qua `createFeedReportSchema.safeParse`. Lỗi: 409 `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` → `reportDuplicate` ·
  404 `SOCIAL-ERR-001` → `reportTargetGone` · 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` → `busy` · 403 → `forbidden`
  · khác → `generic`. Thành công ⇒ câu xác nhận trong hộp thoại rồi đóng; KHÔNG invalidate gì của feed.

### L4 — Thiết lập huy hiệu `SOC-SCREEN-012` (PR-B)

- **Route/nav:** `social.kudosBadges` (D3) + `routeTitle.socialKudosBadges` + mục sidebar (O2 = a) + W1/W3/W4 nối
  thêm + snapshot + G5 nối vào `admin-route-gates.spec.tsx`.
- **TẠO** `badges/BadgeSettingsPage.tsx` · `components/{BadgeTable,BadgeFormDialog}.tsx` ·
  `lib/{badge-form,badge-errors,badge-route-search}.ts`; **SỬA** `kudos/components/KudosBadgeIcon.tsx` (export
  `KUDOS_BADGE_ICON_NAMES` = khoá của `BADGE_ICONS`).
- **Cổng:** route `manage:feed-kudos`; trong màn không cổng phụ (4 route cùng cặp, M7).
- **Trạng thái:** loading · lỗi + thử lại · rỗng («Chưa có huy hiệu nào») · hàng đã tắt có pill «Ngừng dùng» ·
  `OffsetPager` khi `total > limit`; lỗi mã gắn với ô (`aria-invalid` + `aria-describedby`).
- **Lỗi:** 409 `SOCIAL-ERR-KUDOS-BADGE-CODE-TAKEN` → `badgeCodeTaken` (cạnh ô mã, gợi ý bật lại huy hiệu cũ) · 404
  `SOCIAL-ERR-KUDOS-BADGE-NOT-FOUND` → `badgeGone` + invalidate · 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` → `busy`
  · 400 → `invalidRequest` · 403 → `forbidden` · khác → `generic`.

### L5 — Thống kê tương tác `SOC-SCREEN-011` (PR-B)

- **Route/nav:** `social.stats` (D3) + `routeTitle.socialStats` + mục sidebar (O2 = a) + `bar-chart-3` vào
  `ICON_MAP` + W1/W3/W4 nối thêm + G6 nối vào `admin-route-gates.spec.tsx`.
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

- **TẠO** `feed/lib/quick-links.ts` (hằng + `pickQuickLinkApps(apps, session, checker)` — nhận registry làm THAM SỐ
  để Q6 đưa bản sao vào) · `feed/components/QuickLinkStrip.tsx` (đăng ký `useAuthStore(s => s.capabilities)` để vẽ
  lại khi quyền nạp xong; nhãn `t(app.nameKey, {ns:"nav"})`; ô `lms`/`fbpost` mang dấu ↗ + tên trợ năng «‹tên› (mở
  ứng dụng ngoài)» — UI-07:2225).
- **SỬA** `feed/FeedPage.tsx` (1 dòng trên `<FeedComposer>`) · `DynamicIcon.tsx` (+`facebook`).
- Không query, không mã lỗi. KHÔNG sửa `FeedPage.spec.tsx` (file FE-2D) — ca mới ở file spec MỚI.

### L7 — Widget «Nhân sự» (PR-C) · O1 = B

- **TẠO** `feed/components/HrOverviewRailSlot.tsx` (D16) — BỐN vế, mỗi vế một `useCanExact`: `view:feed` +
  `DASH_READ_PAIR` + `DASH_WIDGET_GATE_PAIR.HR_OVERVIEW` + `HR_ENGINE_PAIRS.UPDATE_EMPLOYEE`; hằng chỉ IMPORT từ
  `routes/dashboard/constants` · `routes/hr/constants`.
- **SỬA** `feed/SocialPortalShell.tsx` (con cuối của `PortalRightRail`) + `SocialPortalShell.spec.tsx` (mock
  `dashboardApi.getWidgetData` + MỘT ca ALLOW mới — HR2).

### L8 — Báo cáo BÌNH LUẬN, 027 (PR-C) · O3 = a

- **Tiền điều kiện — ĐO, không tin lời:** nội dung FE-2D lát B đã ở master và nhánh PR-C chứa nó. (1) `git log
  b637f3d6..origin/master --oneline -- apps/app/src/routes/social/feed/components/CommentList.tsx` có commit merge của
  lát B (subject nêu FE-2D lát B + số PR); (2) `git merge-base --is-ancestor <sha đó> HEAD`. Chưa thoả ⇒ KHÔNG chạm
  `CommentList.tsx`, DỪNG sau L7 và báo owner (không tự tách WO, không mở PR-C thiếu L8). Đo lại vị trí dòng của file
  SAU merge — số dòng dưới đây là của `b637f3d6`.
- **SỬA** `feed/components/CommentList.tsx`: nút «Báo cáo» trong hàng nút của `CommentRow` (cạnh «Trả lời»/«Xoá»,
  `:96-116`), hiện khi `!comment.isMine` — cả bình luận gốc lẫn trả lời; state `reportTarget` ở `CommentList` (khuôn
  `pendingDelete` `:142`); `<ReportDialog targetType="comment" targetId={comment.id}>` mount LƯỜI (chỉ khi có
  `reportTarget`) ⇒ ca cũ của `CommentList.spec.tsx` không cần `QueryClientProvider`. KHÔNG thêm prop bắt buộc vào
  `CommentListProps` ⇒ `PostDetailPage.tsx` không đổi.
- **Cổng:** không cặp riêng — 027 gác `view:feed` (M5), route chứa danh sách đã đòi cặp đó; ẩn với bình luận của
  chính mình (sở hữu hàng từ DTO, `comment.isMine`).
- **Chữ:** nhãn nút + tiêu đề hộp thoại theo loại đích ở `social-admin.ts` (D18) — KHÔNG sửa `social.ts`.
- **Spec MỚI** `feed/components/CommentList.report.spec.tsx` (CR1 · CR2) — KHÔNG sửa `CommentList.spec.tsx` (lát B vừa
  đổi); chạy lại `CommentList.spec.tsx` + `PostDetailPage.spec.tsx` không sửa. Lỗi: dùng chung bảng của L3.

## 4. Test RED-trước

Mỗi ca DENY đứng cạnh một ca ALLOW dùng CÙNG khung. «Không phát request» đo trên spy của hàm API sau một nhịp
`waitFor` của ca ALLOW cùng file. Quyền đặt bằng `setCaps` TRƯỚC khi render. Body kiểm bằng CHÍNH schema contracts.
Ca có ghi «(role)» truy vấn phần tử bằng **role + tên trợ năng** (`getByRole(…, {name})`), không `data-testid`.

**Quy tắc RED — stub-trước.** Trước lượt RED của một lát, tạo KHUNG mọi file sản phẩm của lát, export đúng tên:
component trả `null` · hàm trả giá trị RỖNG đúng kiểu (`{}`/`[]`/`undefined`), không gọi gì, không ném · khoá cache
trả `[]` · mục registry/sidebar khai với cổng LỎNG `["view:feed"]` (khuôn chép từ `social.kudos`). Rồi mới viết + chạy
ca: mỗi ca phải đỏ ở một dòng `expect`/truy vấn RTL. Đọc kết quả ở dòng `Test Files … failed | … passed` + thông điệp
TỪNG ca (không grep lọc); thấy `Failed to resolve import` / `Cannot find module` / `is not a function` ⇒ RED CHƯA
đạt — bổ sung stub rồi chạy lại. Stub nằm cùng commit với ca RED.
Cột **RED:** `A` = assert dương đỏ trên stub · `V` = vế «vắng mặt / 0 lời gọi» xanh SẴN trên stub rỗng — luôn đi kèm
một vế `A` cùng hàng, răng của nó do mutant ★ chứng minh · `R` = ratchet, đỏ ngay trên mã hiện có · `K` = không
RED-first theo thiết kế (hồi quy / khói / đọc diff) — không tính là bằng chứng RED.
Cột **Mutant:** ★ = BẮT BUỘC chạy (§6); mọi hàng có `V` đều ★.

| Lát | Ca | Ghim | RED | Mutant giết |
| --- | --- | --- | --- | --- |
| L1 | A1 client báo cáo | `listReports({status:"open",page:2})` ⇒ `GET /social/reports?status=open&page=2`; `resolveReport` ⇒ PATCH + parse; `createReport(body, attemptId)`: cùng `(attemptId, body)` ⇒ cùng `Idempotency-Key`, khác `attemptId` HOẶC khác body ⇒ khác khoá | A | đổi schema parse sang `feedReportSchema` cho 028 · bỏ `attemptId` khỏi khoá |
| L1 | A2 client thống kê/huy hiệu | 052 đúng path + query; 053 đi `apiFetchBlob`; 056: assert trên ĐẦU RA parse `data[0].isActive === false` (không trên `.success` — `kudosBadgeSchema` không `.strict()`, nuốt khoá lặng lẽ); 051 là DELETE trả DTO | A | 056 parse bằng `kudosBadgePageSchema` |
| L1 | A3 khoá cache | `reports.lists()` là tiền tố của `reports.list({status,page})`; `badgesAdminAll()` KHÔNG là tiền tố của `badges()` và ngược lại | A | gộp `badges-admin` vào `["kudos","badges",…]` |
| L1 | A4 `AdminErrorNotice` | lặp TOÀN BỘ `ADMIN_ERROR_REASONS`: có `role="alert"` + chữ render ≠ khoá thô (i18n thật) | A | xoá một khoá `admin.error.*` |
| L2 | S1 search | đầu ra parser THẬT: `?page=2` ⇒ 2; `?page=1`/`?status=1`/`?tab=x` ⇒ bỏ; khoá bỏ là `undefined` tường minh | A | khuôn `typeof === "string"` cho `page` |
| L2 | B1 body + chữ 029 | mỗi tổ hợp (resolved×4 hành động post · resolved×3 comment · dismissed) ⇒ `resolveFeedReportSchema.safeParse(body).success`; «Bỏ qua» sau khi đã chọn `hide_post` ⇒ body không `action`; báo cáo bình luận KHÔNG có lựa chọn `hide_post`; CHỮ lựa chọn + chữ ô tick đúng bảng loại đích cho CẢ hai loại (role) | A+V | ★ gửi `action` khi `dismissed` · thêm `hide_post` cho comment · dùng chung nhãn `lock_comments` cho hai loại |
| L2 | B2 xác nhận xoá | chọn `delete_target` chưa tick ⇒ nút gửi khoá, `resolveReport` 0 lần; tick (role: ô tick có nhãn) ⇒ gửi được | A+V | ★ bỏ điều kiện tick |
| L2 | G2 nút «Xử lý» | DENY caps manager ⇒ hàng hiện, 0 nút · ALLOW thêm `manage:feed-report` ⇒ có nút (role); báo cáo đã `resolved` ⇒ không nút | A+V | ★ gác nút bằng `view:feed-report` |
| L2 | G3 hành động kèm | DENY có `manage:feed-report`, thiếu `manage:feed-post` ⇒ không ô hành động, body gửi KHÔNG có `action` · ALLOW ⇒ ô hiện | A+V | ★ bỏ điều kiện `manage:feed-post` |
| L2 | G4 tab bài ẩn | DENY thiếu `manage:feed-post` + `?tab=hidden` ⇒ không tab, `listFeed` 0 lần · ALLOW ⇒ gọi `{status:"hidden"}`, tab có `aria-selected` | A+V | ★ bỏ `enabled` |
| L2 | FL1 lọc trạng thái (màn) | mặc định ⇒ `listReports` nhận `status:"open"`; «Tất cả» ⇒ đối số KHÔNG có khoá `status`; đổi lọc khi đang ở trang 3 ⇒ gọi với `page:1` (role: `<select>` có nhãn) | A | ★ gửi `status:"all"` |
| L2 | ST1 trạng thái 010 | 4 câu rỗng theo bộ lọc khác nhau từng đôi; lỗi ⇒ «Thử lại» gọi lại; `page` quá trang cuối ⇒ «Về trang 1» | A | dùng chung một câu rỗng |
| L2 | E1…E7 mã lỗi 029/006 | MỖI dòng E1–E7 của bảng lỗi L2 một ca `ApiError(status, code)`: đúng `data-reason`; `021`/`reportGone` ⇒ hộp thoại đóng + khoá ĐÃ SEED không observer `reports.list({status:"resolved",page:9})` `isInvalidated` + spy `listReports` của danh sách đang mở được gọi lại; `BUSY` ⇒ hộp thoại CÒN; `TARGET-UNAVAILABLE` ⇒ hành động về «không» | A | ★ gộp `REPORT-BUSY` vào nhánh `021` |
| L2 | E8 403 đọc | 028 trả 403 ⇒ `forbidden`; 001 trả 403 `SOCIAL-ERR-010` ⇒ `forbidden`, KHÔNG hiện chuỗi `message` của server | A+V | ★ hiện `err.message` |
| L2 | E9–E11 lỗi chung | 029 trả 403 `AUTH-ERR-FORBIDDEN` ⇒ `forbidden`, hộp thoại đóng, KHÔNG nút thử lại (E9); 400 ⇒ `invalidRequest` (E10); 500 ⇒ `generic` + «Thử lại» (E11) | A+V | ★ để 403 rơi vào `generic` |
| L2 | DC1 bấm đúp 029/006 | promise treo: bấm «Xác nhận» 2 lần ⇒ `resolveReport` 1 lần, nút `disabled`; «Hiện lại» 2 lần ⇒ `moderatePost` 1 lần | A | bỏ `disabled` khi `isPending` |
| L2 | R1 danh tính | `reporter:null` ⇒ «Ẩn theo phạm vi…»; `{employeeId:null, fullName:"X"}` ⇒ «X» + «(hồ sơ không còn)»; hai nhãn KHÁC nhau; fixture `avatarUrl` khác rỗng ⇒ không `<img>` | A+V | ★ gộp hai nhánh · truyền `src` |
| L2 | R2 ngữ cảnh | snapshot `deletedAt≠null` ⇒ không link + «[đã xoá]»; `hidden` + thiếu `manage:feed-post` ⇒ không link; thường ⇒ `href="/feed/posts/<postId>"` (mock `Link` nội suy params) với `postId` ≠ `targetId` | A+V | ★ dùng `targetId` làm id bài |
| L2 | R3 sau `delete_target` | khoá ĐÃ SEED không observer dưới từng tiền tố — `reports.list({status:"resolved",page:9})` · `hiddenPosts()` · `feed.list({sort:"latest"})` — đều `isInvalidated`; đối chứng `birthdays({range:"week"})` KHÔNG (khuôn `use-feed-actions.spec.tsx:487-508`) | A+V | ★ chỉ vá một hàng trong cache |
| L2 | R4 đích bình luận | fixture `comment` + `deletedAt≠null` ⇒ chữ nói về BÀI («bài chứa bình luận đã xoá»); fixture `comment` thường ⇒ «Bình luận trong bài của X», KHÔNG có chuỗi «tác giả bình luận», không «[đã ẩn]» trần | A+V | ★ dùng nhãn của đích `post` cho `comment` |
| L2 | R5 hàng đã xử lý | hàng `resolved` + `resolutionNote:null` ⇒ có tên người xử lý + thời điểm, KHÔNG vẽ khối ghi chú; `resolvedBy.employeeId:null` ⇒ «(hồ sơ không còn)»; 5 giá trị `reason` ⇒ chữ ≠ khoá i18n | A+V | ★ luôn vẽ khối ghi chú |
| L2 | UH1 hiện lại | bấm ⇒ `moderatePost(id, {hidden:false})` — `toEqual` đúng 1 khoá + qua `moderateFeedPostSchema` | A | gửi kèm `pinned` |
| L2 | HP1–HP3 tab bài ẩn | rỗng ⇒ câu riêng + dòng giới hạn «không gồm bài trong nhóm» (HP1); có `nextCursor` ⇒ «Tải thêm» gọi lượt 2 đúng cursor, hết ⇒ không nút (HP2); lỗi khác 403 ⇒ «Thử lại» gọi lại (HP3) | A+V | ★ luôn vẽ «Tải thêm» |
| L2 | G1 cổng route 010 | `admin-route-gates.spec.tsx`: `await import("@/router")` (timeout 20 s/ca), mock passthrough `ProtectedShell` + `SocialPortalShell` (tránh 5 query của rail), i18n mock theo tiền lệ `ProtectedRoute.spec.tsx:31-41,152-168`. DENY `{view:feed}` ⇒ `forbidden.reason.NO_PERMISSION`, spy `listReports` 0 lần · ALLOW `{view:feed, view:feed-report}` ⇒ gọi 1 lần (qua `buildModuleRouteContent(getMeta("social.moderation"),…)`) | A+V (stub cổng lỏng ⇒ vế DENY đỏ) | ★ bỏ `view:feed-report` khỏi `requiredPermissions` |
| L2 | W1 wiring | `social-wiring.spec`: 12 route · 8 mục V2 (thứ tự viết tay) · `showInSidebar` 8 khoá · `social.moderation` `toMatchObject` path/screenCode/cặp · **`requiredPermissions` của mục sidebar `toEqual` của route VÀ mục KHÔNG khai `requiredAnyPermissions`** | R (số cũ 11/7) | ★ đổi cặp sidebar thành `requiredAnyPermissions` |
| L2 | W3 router nối đúng meta | đọc NGUỒN `router.tsx` (khuôn `asset-wiring.spec.ts:102-112`): khối `createRoute` có `path: "/feed/moderation"` dùng đúng `getMeta("social.moderation")`; hằng route đó + route chuyển hướng `/social/reports` có trong `rootRoute.addChildren([…])` | A | ★ đổi `getMeta("social.moderation")` → `getMeta("social.kudos")` trong `router.tsx` · bỏ route khỏi `addChildren` |
| L2 | W4 mục rail theo quyền (hành vi) | `filterSidebarItems(SOCIAL_SIDEBAR, checker, session)`: `{view:feed}` ⇒ ĐÚNG 7 khoá cũ · thêm `view:feed-report` ⇒ thêm `social.moderation` (PR-B: + `social.stats`) · thêm `manage:feed-kudos` ⇒ thêm `social.kudosBadges` (PR-B) | A+V | ★ (chung mutant của W1) |
| L2 | N1 chuyển hướng NOTI | `legacy-social-redirects.spec.ts` (SỬA): `NOTI_TEMPLATES_COVERED` 3 mục (+ `/social/reports`); `it.each` tách nhánh CÓ tham số (2) / KHÔNG tham số (1); mục reports ⇒ `to: "/feed/moderation"`, `replace`, không `params` | R (mảng 2 ≠ 3) | trỏ reports về `/feed` |
| L2 | W2 snapshot | regen `-u` CHỈ file snapshot sidebar; đọc `git diff`: `sidebar-tree.raw.txt` +1 dòng khối `### SOCIAL` (`all=[view:feed,view:feed-report]`, không `any=`) · `by-permission.txt` +1 dòng `social.moderation` dưới `## ALL`; 4 bộ còn lại không đổi nhưng KHÔNG phải bằng chứng cổng (M12) — bằng chứng là W4 | K (đọc diff) | — |
| L3 | P1 mục «Báo cáo» (bài) | `PostCardMenu.report.spec.tsx`: bài người khác ⇒ có mục (role `menuitem`); `isMine` ⇒ KHÔNG (đối chứng: «Sao chép liên kết» vẫn có) | A+V | ★ bỏ `!post.isMine` |
| L3 | P2 gửi | `ReportDialog.spec.tsx`, chạy với CẢ `targetType:"post"` và `"comment"`: body qua `createFeedReportSchema`, `targetType`/`targetId` đúng prop; ghi chú rỗng ⇒ không khoá `note`; dòng cảnh báo SOC-DEC-011 hiện TRƯỚC khi gõ; (role) `dialog` có tên, nhóm 5 lý do có nhãn nhóm | A | ★ bỏ dòng cảnh báo · hard-code `targetType:"post"` |
| L3 | P3 lỗi 027 | 409 `REPORT-DUPLICATE-OPEN` ⇒ `reportDuplicate`; 409 `REQUEST-ERR-IDEMPOTENCY-IN-PROGRESS` ⇒ `busy`; 404 `001` ⇒ `reportTargetGone`; 403 ⇒ `forbidden`; 500 ⇒ `generic`; reject ⇒ hộp thoại CÒN + nội dung còn; gửi lại trong CÙNG lượt mở ⇒ cùng `attemptId` | A | ★ coi mọi 409 là thành công |
| L3 | DC2 bấm đúp 027 | promise treo: bấm «Gửi» 2 lần ⇒ `createReport` 1 lần | A | bỏ `disabled` |
| L4 | G5 cổng route 012 | cùng file + khuôn G1: DENY `{view:feed}` ⇒ forbidden, `listBadgesAdmin` 0 lần · ALLOW `{view:feed, manage:feed-kudos}` ⇒ 1 lần | A+V | ★ hạ cổng về `view:feed` |
| L4 | F1 form | tạo: body qua `createKudosBadgeSchema`; mã `"A b"` ⇒ lỗi tại ô (`aria-invalid` + `aria-describedby` trỏ câu lỗi), 0 lần gọi · sửa: ô mã `readOnly`, body `toEqual` CHỈ trường đổi và qua `updateKudosBadgeSchema`; không đổi gì ⇒ 0 lần gọi | A+V | ★ đưa `code` vào PATCH · gửi cả form |
| L4 | F2 tắt/bật | «Ngừng dùng» ⇒ xác nhận ⇒ `deactivateBadge`; hàng tắt có «Bật lại» ⇒ `updateBadge(id,{isActive:true})`; sau MỖI lượt ghi: `kudos.badges()` (seed, không observer) VÀ `kudos.badgesAdmin({page:9,limit:50})` (seed) đều `isInvalidated` | A | ★ quên `kudos.badges()` |
| L4 | F3 lỗi | 409 `CODE-TAKEN` ⇒ `badgeCodeTaken`; 404 `NOT-FOUND` ⇒ `badgeGone` + invalidate; 409 idempotency ⇒ `busy`; 400 ⇒ `invalidRequest`; 403 ⇒ `forbidden` | A | gộp hai mã 409 |
| L4 | F4 icon | đường MỚI: option của `<select>` `toEqual` `KUDOS_BADGE_ICON_NAMES`; emoji ở ô emoji ⇒ hàng bảng vẽ chữ. Hồi quy: hàng có icon `constructor`/`__proto__` không ném (ĐÃ đúng hôm nay nhờ `Object.hasOwn`, `KudosBadgeIcon.tsx:58`) | A · K | viết tay danh sách option thiếu một tên (mutant hồi quy, nếu chạy, cấy vào file CŨ `KudosBadgeIcon.tsx`) |
| L4 | ST2 · S2 · DC3 | loading · lỗi + «Thử lại» · rỗng «Chưa có huy hiệu nào» · `OffsetPager` khi `total > limit` (ST2); `badge-route-search`: `?page=2` ⇒ 2, `?page=1`/`?page=x` ⇒ `undefined` (S2); promise treo: bấm «Lưu» / «Ngừng dùng» 2 lần ⇒ 1 lời gọi (DC3) | A | bỏ `disabled` |
| L5 | G6 cổng route 011 | cùng file + khuôn G1: DENY `{view:feed}` ⇒ forbidden, `engagement` 0 lần · ALLOW manager ⇒ gọi 1 lần, có nút Xuất | A+V | ★ bỏ cặp |
| L5 | T1 khoảng tuần | mặc định ⇒ gọi KHÔNG `from`/`to`; nhãn khoảng lấy từ `range` server; ‹ (role: nút có tên) ⇒ `from`/`to` lùi đúng N×7 ngày, là thứ Hai/Chủ nhật; › khoá ở tuần hiện tại — `vi.setSystemTime(new Date("2026-10-04T17:30:00Z"))` (00:30 thứ Hai 05/10 giờ VN) ⇒ tuần hiện tại kết thúc `2026-10-11` | A | ★ tính tuần theo UTC/giờ máy |
| L5 | T2 search | `?from=2026-09-01` thiếu `to` ⇒ bỏ cả hai; 27 tuần ⇒ bỏ; `?orgUnitId=abc` ⇒ bỏ; hợp lệ ⇒ giữ | A | giữ `from` lẻ |
| L5 | T3 số liệu | `rows` thưa ⇒ ô vắng không sinh `NaN`; hàng `orgUnitId:null` ⇒ «Chưa gán đơn vị»; đơn vị `isDeleted` có hậu tố; thẻ thành viên = hàng `weekTotals` CUỐI, không phải tổng; bảng có `columnheader` (role) | A | ★ cộng `activeMembers` |
| L5 | T4 ô đơn vị | option = `units` của response (chờ CHÍNH option xuất hiện rồi mới `change`); chọn ⇒ URL có `orgUnitId` | A | lấy đơn vị từ nguồn khác |
| L5 | T5 rỗng ≠ cấm | `units:[]`,`rows:[]` ⇒ câu «chưa có đơn vị…», KHÔNG có `data-reason="forbidden"` | A+V | ★ dùng chung câu forbidden |
| L5 | T6 lỗi 052 | 403 `STATS-UNIT-OUT-OF-SCOPE` ⇒ `statsUnitOutOfScope` + «Bỏ lọc đơn vị» xoá `orgUnitId`; 400 ⇒ `statsRangeInvalid` + «Về mặc định» xoá `from`/`to`; 403 khác ⇒ `forbidden`; 500 ⇒ `generic` + «Thử lại»; khi lỗi KHÔNG còn bảng cũ | A+V | ★ gộp hai loại 403 · giữ bảng cũ khi lỗi |
| L5 | X1 xuất | gọi `exportEngagement` với CÙNG tham số đang xem; `filename:null` ⇒ `social-tuong-tac-<from>_<to>.xlsx`; đang xuất ⇒ nút `disabled`, bấm 2 lần = 1 lời gọi; 403 ⇒ dải lỗi + `triggerBlobDownload` 0 lần | A+V | ★ tên dự phòng thiếu `.xlsx` · bỏ `disabled` |
| L5 | C1 biểu đồ | `EngagementTrendChart` render không ném với `ResizeObserver` stub cục bộ (`vi.stubGlobal`) + `weekTotals` 0 hàng; spec trang MOCK file này | K (khói) | — |
| L6 | Q1 dải ô | DENY `{view:feed}` ⇒ dải KHÔNG render (không tiêu đề) · ALLOW `{view:feed, access:goal}` ⇒ đúng 1 ô «Mục tiêu» | A+V | ★ bỏ lọc quyền |
| L6 | Q2 fbpost | `{create:social-post, manage:social-account}` thiếu `view:social-post` ⇒ KHÔNG ô · có `view:social-post` ⇒ có ô (dù `switcherOnly`) | A+V | ★ dùng `getHomeGridApps` · gate OR 3 cặp |
| L6 | Q3 rooms + wildcard | chỉ `access:room` ⇒ không ô; đủ 2 cặp ⇒ có; chỉ `*:*` ⇒ 0 ô | A+V | ★ đổi sang `useCan` |
| L6 | Q4 mở | bấm ô `lms`/`fbpost` ⇒ spy opener gọi 1 lần, `navigate` 0 lần, ô có dấu ↗ + tên trợ năng «… (mở ứng dụng ngoài)»; ô `tasks` ⇒ `href="/tasks/my-tasks"` | A+V | ★ `navigate(defaultRoute)` cho cross-domain |
| L6 | Q5 hằng | mọi khoá của `FEED_QUICK_LINK_APP_KEYS` tồn tại trong `APP_REGISTRY`; thứ tự vẽ = thứ tự hằng (viết tay), không theo `order` | A | sắp theo `order` |
| L6 | Q6 lọc `active` | `pickQuickLinkApps` với BẢN SAO registry có 1 app thuộc danh sách ở `coming_soon` + caps rỗng ⇒ 0 ô (đối chứng: cùng app `active` + đủ quyền ⇒ 1 ô) | A+V | ★ bỏ lọc `status === "active"` |
| L7 | HR1 cổng widget | `HrOverviewRailSlot.spec.tsx`: DENY-1 `{view:feed, read:dashboard, read:employee}` (thiếu `update:employee`) ⇒ không tiêu đề widget VÀ `getWidgetData` 0 lần · DENY-2 chỉ `*:*` · DENY-3 thiếu `read:dashboard` · ALLOW đủ 4 cặp ⇒ gọi 1 lần với `HR_OVERVIEW` | A+V | ★ đổi `useCanExact` → `useCan` · bỏ một vế |
| L7 | HR2 trong vỏ thật | `SocialPortalShell.spec.tsx` (SỬA): THÊM một ca ALLOW đủ 4 cặp ⇒ tiêu đề widget hiện + `dashboardApi.getWidgetData` (mock) 1 lần; các ca cũ (caps `{view:feed}`) xanh, không ca nào chạy `apiFetch` thật | A · K | bỏ mock `getWidgetData` (ca ALLOW đỏ — có nghĩa vì ALLOW nằm CHÍNH file này) |
| L8 | CR1 nút «Báo cáo» (bình luận) | `CommentList.report.spec.tsx`: bình luận người khác (gốc + trả lời) ⇒ có nút (role); `isMine` ⇒ KHÔNG (đối chứng: nút «Xoá» có) | A+V | ★ bỏ `!comment.isMine` |
| L8 | CR2 gửi + mount lười | bấm ⇒ hộp thoại mở; gửi ⇒ `createReport` nhận `{targetType:"comment", targetId: comment.id, …}`; trước khi bấm KHÔNG mount `ReportDialog` (ca render KHÔNG `QueryClientProvider` vẫn vẽ danh sách). Hồi quy: `CommentList.spec.tsx` + `PostDetailPage.spec.tsx` chạy lại không sửa | A+V · K | ★ gửi `targetType:"post"` · mount hộp thoại sẵn |

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
| B15 | Thêm dải ô vào `FeedPage` làm đổi kết quả `FeedPage.spec` | L6 — 0 ô ⇒ `null`; T9 chạy spec đó không sửa |
| B16 | Gate widget bằng `enabled:false` rồi vẫn mount `WidgetCard` ⇒ thẻ rỗng | D16, HR1 (assert CẢ vắng tiêu đề LẪN 0 lời gọi) |
| B17 | Ca DENY của widget dùng caps rỗng ⇒ xanh với mọi gate | HR1 — caps CÓ `read:employee` |
| B18 | Khoá i18n thiếu không cổng nào bắt | A4 + mọi spec màn dùng i18n THẬT, assert chữ ≠ khoá (ngoại lệ có tên: file G1/G5/G6 mock i18n theo tiền lệ) |
| B19 | web-core `exports` trỏ `dist` ⇒ app thấy bản cũ | §6 — build web-core trước mọi lệnh của app |
| B20 | Chèn vào `index.ts`/`social.ts` kề hunk của fe-2d-a | D6, D18 — vị trí chèn đã chỉ định |
| B21 | Heredoc Bash chứa backtick chết giữa chừng; `git checkout --` xoá vá chưa commit khi hoàn tác mutant | §6 — script ghi bằng Write; mutant: sao lưu → cấy → `cp` trả lại |
| B22 | Khoá idempotency suy từ nội dung thuần phát lại trong 900 s ⇒ «đã gửi» giả sau khi báo cáo cũ bị bỏ qua / huy hiệu cũ bị ngừng | D20 (ii) — `attemptId` theo lượt mở; A1 · P3 |
| B23 | Bấm đúp 029/006/050/051 (không `@Idempotent`) ⇒ 409 `021` giả | D20 (i) — `disabled` khi `isPending`; DC1–DC3 |
| B24 | `getQueryState(<tiền tố>)` luôn `undefined`; query đang có observer refetch xong thì `isInvalidated` về `false` (đua) | E1 · R3 · F2 — seed khoá CỤ THỂ không observer + khoá đối chứng |
| B25 | Chép khuôn `requiredAnyPermissions` của 7 mục rail cũ ⇒ mọi nhân viên thấy mục quản trị, bấm 403 | D2 · W1 · W4 |
| B26 | `path` và `getMeta()` trong `router.tsx` là hai literal rời; route quên `addChildren` ⇒ mục rail bấm 404 | W3 |
| B27 | Snapshot báo cáo bình luận mang tác giả/trạng thái của BÀI CHA ⇒ gán nhầm người, nhãn «[đã ẩn]» sai đối tượng | M2b · bảng loại đích L2 · R4 |
| B28 | Ca RED đỏ vì file vắng ⇒ 0 ca chạy; lọc output đọc thành xanh | §4 — quy tắc stub-trước |
| B29 | Chạm `CommentList.tsx` trước khi lát B vào master ⇒ xung đột + vá lên phiên bản sắp bị thay | L8 — tiền điều kiện đo bằng `git log` |

## 6. Cổng & kiểm chứng

- **Gate LIGHT** (mỗi PR, chạy **TUẦN TỰ** — không song song —, trên diff `origin/master...HEAD`, TRƯỚC khi mở PR),
  bằng reviewer CÓ THẬT trong phiên (agent `react-reviewer` của CLAUDE.md §6 KHÔNG tồn tại — `.claude/agents/` có 14
  file, không file nào tên đó):
  1. agent `ecc:typescript-reviewer` — brief kèm lăng kính React: luật hook · `useEffect` (phụ thuộc, dọn dẹp, đua) ·
     state dẫn xuất/`key` · a11y cơ bản (role, tên trợ năng, nhãn form).
  2. agent `ecc:code-reviewer`.
  3. **riêng PR-A:** agent `security-reviewer` (agent dự án, read-only) — phạm vi: hiển thị danh tính người tố giác +
     `note` nguyên văn (R1 · R4 · P2) · 4 cổng quyền mới (G1–G4) · không lộ `message` server (E8) · khoá cache tách
     theo cổng (`hiddenPosts()`).
  4. skill `ecc:quality-gate`.
  PR-B và PR-C: bước 1 → 2 → 4. Commit vá finding phải qua lại reviewer đã nêu finding đó.
- **Nâng lên FULL gate** — xem danh sách ở cuối mục này.
- **Lệnh** (từ gốc `C:/dev 2/MediaOS-fe3`; chạy TỪNG lệnh, không song song test/build/tsc):
  1. `pnpm --filter @mediaos/web-core build` — sau MỖI lần sửa `packages/web-core` (B19, D6). Lần đầu trong một
     worktree: build cả ba gói dùng chung như CI — `pnpm --filter @mediaos/contracts --filter @mediaos/web-core
     --filter @mediaos/ui build` (`apps-frontend.yml:100`).
  2. `pnpm --filter @mediaos/web-core exec vitest run src/lib/social-moderation-api.spec.ts src/lib/social-stats-api.spec.ts src/lib/social-kudos-api.spec.ts src/lib/query-keys.spec.ts src/lib/registry.spec.ts --maxWorkers=4`
  3. `pnpm --filter @mediaos/app exec vitest run src/routes/social/<thư-mục-lát> --maxWorkers=4` — vòng RED/GREEN.
  4. `pnpm --filter @mediaos/app exec vitest run src/routes/social/social-wiring.spec.ts src/routes/social/legacy-social-redirects.spec.ts src/routes/social/admin/admin-route-gates.spec.tsx src/layouts/workspace/sidebar-registry.snapshot.spec.ts --maxWorkers=4`; regen: lặp lại CHỈ với file snapshot + `-u`, rồi `git diff -- apps/app/src/layouts/workspace/__snapshots__/`.
  5. `pnpm --filter @mediaos/app test:social-cov` — ĐÚNG lệnh cổng CI (`apps/app/package.json:14`, `maxThreads=2`;
     `apps-frontend.yml:139-141`). Tiêu chí: exit 0, 4 số ≥ 80.
  6. `bash harness/check.sh --quick` — lint + typecheck toàn workspace. Tiêu chí: exit 0, mọi dòng KẾT QUẢ là ✅.
  7. `node harness/chunk-test.mjs --packages=@mediaos/app,@mediaos/web-core,@mediaos/auth,@mediaos/console --no-build --max-forks=4`
     — diff chạm `packages/web-core` ⇒ CI chạy cả auth + console (`apps-frontend.yml:68-70`); chạy cả suite app một
     lượt từng sập worker (FE-2C §9). Tiêu chí: exit 0; đọc dòng `Test Files` của TỪNG chunk (0 failed).
  8. `pnpm --filter @mediaos/app --filter @mediaos/auth --filter @mediaos/console build` — exit 0.
- **Kiểm chứng cuối trước khi mở PR = lệnh 5 → 6 → 7 → 8 đều exit 0**, kèm phép đo «WO chỉ-FE»:
  `git diff --name-only origin/master...HEAD -- apps/api packages/contracts` phải RỖNG. KHÔNG chạy `check.sh --all`:
  thứ nó thêm so với 6+7+8 là suite `apps/api` (diff không chạm) + `prod-tenant-check`/`db-readiness` (tự bỏ qua khi
  không có DB) + `lane-db-guard` ở chế độ strict — ĐỎ chắc chắn khi thiếu `LANE_DB` (`harness/check.sh:23,181,229-231`),
  tức một lệnh không thể xanh, mã thoát hết phân biệt được đỏ thật. Phép đo «chỉ-FE» KHÔNG rỗng ⇒ nâng FULL gate và
  chạy `bash harness/check.sh --all --lane-db` (cần Postgres); khi đó tiêu chí là exit 0, không dòng ❌ nào.
- **Mutant ★** (bảng §4: PR-A 21 · PR-B 9 · PR-C 8). Mỗi mutant: `cp` sao lưu file → cấy → chạy ĐÚNG một file spec
  của ca → phải đỏ ĐÚNG ca với ĐÚNG thông điệp assert kỳ vọng (không phải lỗi biên dịch/nạp file) → `cp` trả lại
  (KHÔNG `git checkout --`) → chạy lại xanh. Mutant không ★ là gợi ý, chạy khi reviewer nghi ngờ ca đó.
- **Không đo được trong kho — KHÔNG hứa:** a11y tự động (không có axe) · tương phản màu · bố cục 300px / breakpoint
  (jsdom không layout) · layout Recharts · hành vi thật trên PROD · ratchet khoá i18n.
- **Điều kiện MERGE:** API PROD ≥ `14afbb5f` (đã thoả — M1, đo 05/10 08:47). Ghi đầu PR-A: 6 ô ☐ của §0 · avatar vẽ
  chữ cái đầu (D8) · tab «Bài đang ẩn» không gồm bài nhóm (O4) · xoá từ hàng đợi chưa có khôi phục (O5) · kết quả
  phép đo «chỉ-FE» + lý do không chạy `check.sh --all` · 4 số coverage trước/sau dòng exclude (D19).

**Điều kiện nâng lên FULL gate** (`security-reviewer` + `silent-failure-hunter`, + `database-reviewer` nếu có DB):
diff chạm `apps/api/**` hoặc migration/seed quyền · chạm `permission.service.ts` (allowlist) · sửa
`W/stores/auth.ts`, `W/hooks/use-can.ts`, `W/components/permission-gate.tsx`, `ProtectedRoute.tsx` hoặc thân
`createPermissionChecker`/`checkRequirement` · sửa schema `packages/contracts` (kể cả additive) · sửa cổng trong
`HrOverviewWidget.tsx` gốc · sửa `apps/app/vitest.social.config.ts` ngoài đúng MỘT dòng exclude của D19 · reviewer
LIGHT nêu finding về lọt quyền / lộ danh tính người tố giác.

## 7. Trình tự

| Bước | Việc | Ranh giới commit |
| --- | --- | --- |
| T0 | Sửa backlog theo §8 (tách FE-3B/3C · chữ `done_when` mới · `paths` · seed nợ · `depends_on` của QA-1) — nằm trong diff PR-A để owner tick ô ☐ §0 khi merge. Đóng dấu TAY `node harness/ledger.mjs start S16-SOCIAL-FE-3` (§8.8) | `chore(backlog)` |
| T1 | **L1** — stub + ca A1–A4 RED → client + khoá + i18n gốc + `AdminErrorNotice` + dòng exclude D19 → build web-core → GREEN | `feat(social): nền client kiểm duyệt/thống kê/huy hiệu` |
| T2 | **L2 lib** — stub + S1 · B1 (vế body) RED → `moderation-route-search` · `report-actions` · `moderation-errors` → GREEN | chung T3 |
| T3 | **L2 màn** — stub + G2–G4 · FL1 · ST1 · B1 (vế chữ) · B2 · E1–E11 · DC1 · R1–R5 · UH1 · HP1–HP3 RED → 4 component + trang → GREEN | `feat(social): SOC-SCREEN-010` |
| T4 | **L2 nối dây** (O2 = a — không chờ) — mục registry/sidebar cổng LỎNG + G1 · W1 · W3 · W4 · N1 RED → siết cổng + router + chuyển hướng + nav + sidebar → build web-core + `registry.spec` → W2 regen, đọc diff → GREEN | `feat(social): route + rail Kiểm duyệt` |
| T5 | **L3** — stub + P1–P3 · DC2 RED → `ReportDialog` + mục menu → GREEN; chạy 3 spec FE-2D không sửa (B14) | `feat(social): nút Báo cáo bài (027)` |
| T6 | **PR-A:** mutant ★ của L1–L3 → gate `ecc:typescript-reviewer` → `ecc:code-reviewer` → `security-reviewer` → `ecc:quality-gate` (tuần tự) → vá (mỗi vá một ca RED đo đỏ trên code cũ; qua lại reviewer đã nêu) → kiểm chứng cuối (lệnh 5→6→7→8 + phép đo «chỉ-FE») → **mở PR-A** | vá: `fix(social): …` từng cái |
| T7 | Sau khi PR-A merge: cắt nhánh mới từ master; `ledger.mjs start S16-SOCIAL-FE-3B`. **L4** (G5 · F1–F4 · ST2/S2/DC3) rồi **L5** (G6 · T1–T6 · X1 · C1), mỗi lát stub → RED → GREEN → nối dây (W1/W3/W4 nối thêm; W1 lên 13 rồi 14 route, 9 rồi 10 mục; W2 +1 dòng mỗi lát). Mỗi lần thêm mục registry/`routeTitle`: build web-core + `registry.spec` (D6) | 2 commit `feat` |
| T8 | **PR-B:** như T6, gate KHÔNG có `security-reviewer` (trừ khi chạm điều kiện nâng FULL) → **mở PR-B** | — |
| T9 | Sau khi PR-B merge: nhánh mới từ master; `ledger.mjs start S16-SOCIAL-FE-3C`. **L6** (Q1–Q6; chạy `FeedPage.spec` không sửa — B15) → **L7** (HR1–HR2) → ĐO tiền điều kiện L8 → **L8** (CR1–CR2). Tiền điều kiện chưa thoả ⇒ DỪNG sau L7, báo owner | 3 commit `feat` |
| T10 | **PR-C:** như T8 → **mở PR-C**. Sau merge: cập nhật backlog/sổ vết; `docs/STATUS.md` do `gen-status.mjs` sinh | — |

KHÔNG mở PR trước gate. KHÔNG push thẳng master. Đụng file ngoài `paths` ⇒ dừng, ghi quyết định + sửa `paths`.

## 8. Sửa backlog cần làm trong WO (`harness/backlog.mjs`, mục `S16-SOCIAL-FE-3` `:18265-18305`)

1. `done_when` #1 (`:18298`) — ô ☐ D1: «Kiểm duyệt chỉ hiện với manage:feed-report/manage:feed-post» → «màn vào bằng
   `view:feed-report` (manager chỉ-đọc theo đơn vị, người tố giác bị che); nút xử lý gác `manage:feed-report`; hành
   động kèm + tab bài ẩn + hiện lại gác `manage:feed-post`».
2. `done_when` #2 (`:18299`) — ô ☐ D14: «ô fbpost dùng gate 3 cặp cũ» → «ô fbpost gác đúng MỘT cặp
   `view:social-post` lấy từ `APP_REGISTRY`»; «thông điệp không có quyền đơn vị này» → «theo mã
   `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE`, tách khỏi 200 rỗng».
3. `done_when` #3 (`:18300`) — ô ☐ D16: «nhúng qua cùng component grid + useCanExact» → «mount thẳng
   `HrOverviewWidget` (không `DashboardWidgetGrid`, không `/dashboard/me`), cổng ngoài `useCanExact` đủ `view:feed` +
   `read:dashboard` + `read:employee` + `update:employee` (O1 = B: chỉ HR + company-admin)».
4. `title` (`:18269`): «Recharts nếu S15-FE-4 đã cài, không thì…» → «Recharts (đã cài)»; «theo useCan» → «theo
   `APP_REGISTRY`»; «Đặt phòng» → nhãn registry «Phòng họp». `notes` (`:18303`): bỏ câu Recharts; ghi O1 = B · O2 = a
   · O3 = a (ký 05/10/2026) + «nút Báo cáo (027) bài + bình luận thuộc WO này — N8 plan FE-1»; sửa dòng gate thành
   «LIGHT: `ecc:typescript-reviewer` (lăng kính React) + `ecc:code-reviewer` + `ecc:quality-gate`; PR-A thêm
   `security-reviewer`».
5. `src` (`:18295`): bỏ `memory sensitive-pair-widget-needs-usecanexact` (`read:employee` KHÔNG nhạy cảm — trích lệch
   ca); thêm `SOC-DEC-011` + `API-19 027/028/029/052/053/056`.
6. Tách WO theo D17 (ô ☐ D17), mỗi WO có `done_when` RIÊNG; cả ba `plan:` trỏ file này:
   - `S16-SOCIAL-FE-3` (PR-A) = P1 + P1b. `done_when`: #1 chữ mới · THÊM «nút «Báo cáo» trên thẻ bài: ẩn với bài của
     mình · cảnh báo SOC-DEC-011 luôn hiện · báo cáo trùng đang mở có thông điệp riêng (409)» · «test FE +
     typecheck/build xanh».
   - seed `S16-SOCIAL-FE-3B` (amber FE, PR-B, `depends_on` FE-3) = P3 + P2. `done_when`: vế Thống kê của #2 chữ mới ·
     THÊM «Thiết lập huy hiệu: đọc 056 (cả huy hiệu đã tắt) · `code` khoá khi sửa · ngừng dùng/bật lại · sau mỗi
     lượt ghi ô chọn huy hiệu của composer được làm mới».
   - seed `S16-SOCIAL-FE-3C` (amber FE, PR-C, `depends_on` FE-3B + WO của FE-2D lát B) = P4 + P5 + P1c. `done_when`:
     vế dải ô của #2 chữ mới · #3 chữ mới · THÊM «nút «Báo cáo» trên bình luận: ẩn với bình luận của mình, dùng chung
     hộp thoại + cảnh báo».
   - Id WO của lát B: ĐO bằng grep trên master lúc T0, không chép từ plan — trên `b637f3d6` backlog chỉ có
     `S16-SOCIAL-FE-2D` (`:18061`); phiên điều phối gọi lát B là `S16-SOCIAL-MENTIONLINK-1` (id này CHƯA có ở đó).
   - `paths`: THÊM `apps/app/vitest.social.config.ts` (D19, chỉ FE-3); có thể BỎ `apps/app/src/routes/me/**` ·
     `packages/ui/**` · `packages/contracts/**` (không lát nào chạm).
7. `S16-SOCIAL-QA-1.depends_on` (`:18324`): thêm `S16-SOCIAL-FE-3B` + `S16-SOCIAL-FE-3C` — nếu không, QA-1 thành
   READY ngay khi PR-A merge, trước khi 011/012/dải ô tồn tại.
8. Sổ cái: `autoStartOnTouch` chỉ đóng dấu khi file chạm khớp ĐÚNG MỘT WO todo+READY, ≥2 thì bỏ qua
   (`harness/lib/wo-state.mjs:82-92`); QA-1 và các WO FE-3x cùng glob `apps/app/src/routes/social/**` (`:18317`) ⇒ đầu
   mỗi PR đóng dấu TAY `node harness/ledger.mjs start <WO>`; sau mỗi merge đọc dòng «Tiêu điểm phiên» của STATUS, sai
   thì `node harness/ledger.mjs event <WO> reset`.
9. Nợ cần seed (mỗi dòng: id đề xuất · zone · vì sao) — WO nợ FE khai `depends_on: S16-SOCIAL-FE-3C` để không thành
   READY chen giữa ba PR:
   - `S16-SOCIAL-FERECYCLE-1` · amber FE · màn thùng rác bài viết 057/058 (`restore:feed-post`) — `delete_target` từ
     hàng đợi hiện không có đường khôi phục trên FE (O5).
   - Bổ sung vào `S16-SOCIAL-GROUPMOD-1` (`:18160`, có sẵn) · red BE · 001 `status=hidden` loại bài nhóm
     (`social-posts.service.ts:124`) ⇒ tab «Bài đang ẩn» thiếu bài nhóm (O4).
   - `S16-SOCIAL-REPORTSNAPSHOT-1` · red BE + contracts · snapshot báo cáo BÌNH LUẬN thiếu tác giả + `deletedAt` của
     chính bình luận (M2b) ⇒ FE không đánh dấu được bình luận đã xoá dưới bài còn sống (bấm hành động mới gặp 422).
   - `S4-DASH-HROVERVIEW-FLOOR-1` · red BE · `HR_OVERVIEW` không có sàn scope + không tín hiệu scope cho FE
     (`dashboard-widget-catalog.const.ts:435`) — lệch SPEC-07 §14.8; điều kiện để bỏ cặp thay thế của O1 = B và mở
     widget cho manager theo phòng (SPEC-07:1200).
   - `S16-SOCIAL-REPORTMATRIX-1` · green BE+contracts · đưa `REPORT_ACTION_MATRIX` vào contracts để FE/BE đọc chung
     (hiện FE chép tay — D7).
   - `S16-SOCIAL-FEAVATAR-1` · green FE · chờ #568 lên PROD · bật lại `src` avatar cho bề mặt FE-3 (hàng đợi · bài
     ẩn) qua `avatarSrc` có sẵn (`feed/lib/feed-format.ts:45`) — D8.
   - `S16-SOCIAL-DOC-2` · green docs · UI-07 §34b.2 (3 mục rail) · §34b.6 (`:2223` «không sửa `layouts/workspace/`» ·
     `:2225` fbpost «ba cặp») · SPEC-16 §9 (đường dẫn 3 màn) · SPEC-16:131 SC-14 «Đặt phòng» ↔ nhãn «Phòng họp» ·
     IMPLEMENTATION-02:886 STORY-218 («ba cặp», «dùng `useCan`») · `S16-SOCIAL-WAVE.md:39,55` · `docs/README.md:97,234`
     («53 route · chưa hiện thực») — ngoài `paths` FE-3.
   - `S1-FND-CORS-EXPOSE-1` · green BE · `exposedHeaders: ["Content-Disposition"]` — hiện FE tự dựng tên tệp (M15).
   - Ghi chú (không seed WO): `companyTimeZone()` của FE là hằng `DEFAULT_TIMEZONE` (`A/routes/rooms/room-time.ts:31-33`)
     còn server tính tuần theo TZ công ty (`C/social-api-stats.ts:6-8`) — N=1 chưa lệch; khi session mang
     `company.timezone` chỉ sửa MỘT hàm đó, ca T1 đã ghim biên tuần.

## 9. Sổ vết

**Plan-review lượt 1 — 05/10/2026** (plan `f3a01479`; R1 đối kháng ADV · R2 kiểm chứng khẳng định CLM · R3 đối chiếu
spec SPC). 41 finding: nhận 39 · nhận một phần 2 · bác 0. Bằng chứng là đường/dẫn:dòng trên cây `b637f3d6`.

| Finding | Xử lý | Bằng chứng |
| --- | --- | --- |
| ADV-1 | NHẬN — ca W3 + mutant ★ + B26; D3 | `A/router.tsx:3194-3201` (hai literal rời) · `legacy-social-redirects.spec.ts:4-7` · `routes/assets/asset-wiring.spec.ts:102-112` |
| ADV-2 | NHẬN — M1 thêm phép đo hình dạng DTO | phép đo phiên điều phối: diff contracts `14afbb5f`..`origin/master` chỉ docblock |
| ADV-3 | NHẬN — W4 (hành vi) + W1 ★ + bỏ «bộ EMPLOYEE không đổi» khỏi vai bằng chứng (M12, W2) + docblock `:20-26` | `sidebar-registry.snapshot.spec.ts:101-115` · `sidebar/social.ts:20-26,44,55,66,78,88,99,109` |
| ADV-4 | NHẬN — bỏ `check.sh --all`, kiểm chứng cuối = lệnh 5→8 + phép đo «chỉ-FE»; lệnh 7/8 thêm auth + console | `harness/check.sh:23,181,229-231` · `apps-frontend.yml:68-70` |
| ADV-5 | MỘT PHẦN — nhận: QA-1 `depends_on` (§8.7) + nợ seed có `depends_on` (§8.9). Bác cơ chế «đóng dấu nhầm»: ≥2 ứng viên thì KHÔNG đóng dấu ⇒ biện pháp đổi thành đóng dấu tay (§8.8) | `harness/backlog.mjs:18317,18324` · `harness/lib/wo-state.mjs:82-92` |
| ADV-6 = CLM-01 | NHẬN — M12 ratchet thứ năm · D3 `switch` vét cạn · ca N1 · L2 liệt kê file · lệnh 4 | `legacy-social-redirects.spec.ts:19,31-45` · `legacy-social-redirects.ts:61-70` · `0581_…noti_track_b.sql:272` |
| ADV-7 = CLM-09 = CLM-10 | NHẬN — lệnh 5 = `test:social-cov`; D19 loại file double + thêm config vào `paths` | `apps/app/package.json:14` · `vitest.social.config.ts:25-26,46-56` · `backlog.mjs:18272-18284` |
| ADV-8 | MỘT PHẦN — O2 không còn «im lặng ⇒ a»: owner ký a ngày 05/10 ⇒ nối dây rail không chờ. KHÔNG viết bảng số (b)/(c) vì phương án đã chốt | `sidebar/social.ts:17` (tiền lệ FE-2C: mục rail ngoài UI-07 phải có owner ký) |
| ADV-9 | NHẬN — sửa câu D6; T4/T7 ghi build web-core + `registry.spec` | plan v1 D6 ↔ L2/L4/L5 «Route/nav» |
| ADV-10 | NHẬN — `security-reviewer` riêng PR-A, chạy sau hai reviewer LIGHT (§6) | `C/social-api-b.ts:373-391` |
| ADV-11 | NHẬN — nêu tên file spec của P1–P3; nhãn mục menu ở `social-admin.ts` (D18) | Glob: không có `PostCardMenu.spec.tsx` · `PostCardMenu.tsx:112-136` |
| ADV-12 | NHẬN — D20 (ii) `attemptId` + B22 + A1/P3 | `W/lib/api-idempotency.ts:68-78` · `idempotency-store.service.ts:17` |
| ADV-13 | NHẬN — nợ `FEAVATAR-1` + ghi chú múi giờ (§8.9) | `A/routes/rooms/room-time.ts:31-33` · `C/social-api-stats.ts:6-8` · `feed/lib/feed-format.ts:45` |
| CLM-02 | NHẬN — chọn stub-trước (§4) · cột RED điền đủ 58 hàng · ★ cho mọi vế V · B28 | Glob `routes/social/{admin,moderation,stats,badges}/**` rỗng · `A/router.tsx:83-87` |
| CLM-03 | NHẬN — G1/G5/G6 chung một file, điều kiện nạp router ghi ở ca G1 | `ProtectedRoute.spec.tsx:31-41,152-168` · `A/router.tsx:141-143` · `routes/forbidden.tsx:31,38` |
| CLM-04 | NHẬN — A2 assert trên đầu ra parse | `C/social-api-kudos.ts:73-80` (không `.strict()`) |
| CLM-05 | NHẬN — E1/R3/F2 seed khoá cụ thể không observer + B24 | `W/lib/query-keys.ts:1382,1458` · `use-feed-actions.spec.tsx:487-508` |
| CLM-06 | NHẬN — E9–E11; `busy` + `generic` trong P3; `generic` trong T6 | `apps/api/src/common/idempotency/idempotency.interceptor.ts:96-98` |
| CLM-07 | NHẬN — HR2: ca ALLOW nằm trong `SocialPortalShell.spec.tsx` | `SocialPortalShell.spec.tsx:39-63` |
| CLM-08 | NHẬN — F4 đo `<select>` mới; vế `constructor` hạ thành hồi quy | `KudosBadgeIcon.tsx:32-44,58` |
| CLM-11 | NHẬN — khoá chèn «TRƯỚC `:405`» (D18); docblock sidebar thêm `:20-26` (L2) | `i18n/locales/vi/social.ts:405-408` · `sidebar/social.ts:20-26` |
| CLM-12 | NHẬN — gate dùng `ecc:typescript-reviewer` + `ecc:code-reviewer` + skill `ecc:quality-gate`, tuần tự (§6) | `.claude/agents/` 14 file, không có `react-reviewer` |
| CLM-13 | NHẬN — M1 ghi nguồn đo trạng thái PROD | phiên điều phối đo 05/10/2026 08:47: `GET /api/v1/health` = `14afbb5f` |
| SPC-1 | NHẬN — M2b · bảng loại đích L2 · R4 · nợ `REPORTSNAPSHOT-1` · B27 | `social-reports.repository.ts:57-61,87-102,217-228` · `social-reports.service.ts:606-618` · API-19:282-284 |
| SPC-2 | NHẬN — bảng nhãn theo loại đích; B1 assert CHỮ | API-19:269-272 · `C/social-api-b.ts:291-294` |
| SPC-3 | NHẬN — D20 (i) + DC1–DC3 + B23 | `social-b.controllers.ts:186` · `social-b2b2.controllers.ts:165,178` · `social.controllers.ts:131` (không `@Idempotent`) |
| SPC-4 | NHẬN — D11 trạng thái riêng của tab + HP1–HP3 | SPEC-16:236 · UI-07:2209-2218 · `C/social-api.ts:278` (`nextCursor`) |
| SPC-5 | NHẬN — O3 (owner ký a ⇒ L8) · O4 · O5 đưa lên §0; `ReportDialog` nhận `targetType` từ L3, P2 chạy cả `comment` | SPEC-16:602 · `S16-SOCIAL-FE-1.md:337` · `social-posts.service.ts:123-124` |
| SPC-6 | NHẬN — ca FL1 + mutant ★ | `C/social-api-b.ts:281-287` (`.strict()`) |
| SPC-7 | NHẬN — dòng E9 trong bảng lỗi L2 + ca | API-19:599 · `social-route-pairs.const.ts:209-227` |
| SPC-8 | NHẬN — ST1 · ST2/S2 · T6 («Về mặc định», `generic`) · `busy` ở P3 · N1 assert đích | plan v1 L2/L4/L5 «Trạng thái» ↔ §4 |
| SPC-9 | NHẬN — luật «(role)» đầu §4; F1 `aria-invalid`/`aria-describedby`; A4 `role="alert"`; G4 `aria-selected` | UI-07:2205-2207 |
| SPC-10 | NHẬN — Q6 + mutant ★; dấu ↗ + tên trợ năng (L6, Q4) | `W/lib/registry.ts:971-972` · UI-07:2225 |
| SPC-11 | NHẬN — `done_when` cho 027 + 012, phân theo từng WO (§8.6) | `harness/backlog.mjs:18297-18301` |
| SPC-12 | NHẬN — bỏ (b)/(c): owner ký O2 = a | SPEC-16:446 |
| SPC-13 | NHẬN — D1/D14/D16/D17 thành ô ☐ chờ owner tick; O1 trích SPEC-07:1200 (vế «O1 = C ⇒ tách WO» hết hiệu lực vì O1 = B) | SPEC-07:1198-1200 |
| SPC-14 | NHẬN — danh sách trường `ReportRow` + `relativeTime` + R5 | `C/social-api-b.ts:393-407` · `feed/lib/feed-format.ts:58` |
| SPC-15 | NHẬN — mở rộng nợ DOC-2 (§8.9) + câu tiền lệ ở D2 | IMPLEMENTATION-02:886 · `S16-SOCIAL-WAVE.md:39,55` · SPEC-16:131 · UI-07:2223 · `docs/README.md:97,234` |

**Cập nhật của phiên điều phối — 05/10/2026** (đến trong lúc vá plan): owner ký O1 = B · O2 = a · O3 = a và đồng ý mở
lại FE-2D lát B ⇒ L7 hết điều kiện · L8 thành lát thi công thật ở PR-C · bỏ dòng nợ `S16-SOCIAL-FECOMMENTREPORT-1` ·
M19 + B29 ghi phụ thuộc thứ tự merge. O4 · O5 · D1 · D14 · D16 · D17 owner CHƯA được hỏi ⇒ để ô ☐ ở §0.
