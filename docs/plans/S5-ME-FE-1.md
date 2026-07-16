# S5-ME-FE-1 — Registry + shell + Tổng quan ME (ME-SCREEN-001)

> Lane: FE, zone=yellow, gate LIGHT (react-reviewer + quality-gate). Nguồn: SPEC-09 §8/§9/§10.1/§13,
> API-11 §5/§8 (đối chiếu `apps/api/src/me/me.controller.ts` + `packages/contracts/src/me.ts`, PR #202 đã
> merge). Không đụng BE nghiệp vụ — CHỈ additive vào `apps/api/src/foundation/module-catalog/module-app-metadata.ts`
> (metadata hiển thị app, không phải permission/migration).

## Mục tiêu

1. Đăng ký module ME xuyên suốt registry FE: `ModuleCode`, `APP_REGISTRY` (card "Cá nhân" ở Home Portal),
   `ROUTE_REGISTRY` (`/me`), `SIDEBAR_REGISTRY.ME`, `MODULE_APP_METADATA.ME` (BE display metadata).
2. Trang Tổng quan `/me` (ME-SCREEN-001) đọc `GET /me/overview` thật — hiển thị identity + 5 section
   (hr/attendance/leave/task/notification), mỗi section xử lý đủ trạng thái §13: loading, ok (có dữ liệu),
   ok-rỗng (empty), error (kèm retry), forbidden, module_disabled, unlinked_employee. 1 section lỗi KHÔNG
   phá trang (mirror `WidgetCard`/dashboard degraded UI).

## Quyết định thiết kế

- **Gate**: cặp engine THẬT `access:me` (mig 0495, non-sensitive, grant `Own` cho cả 4 role canonical) —
  dùng LITERAL pair (KHÔNG qua `PERMISSION_CODE_TO_PAIR`, cùng kỹ thuật `att.shifts`/`hr.org-chart`, tránh
  pair-drift) cho `ROUTE_REGISTRY['me.overview']` + `SIDEBAR_REGISTRY.ME` + page tự gate lại bằng
  `useCan('access','me')` (mirror `DASH_READ_PAIR` pattern ở `DashboardMePage`).
- **APP_REGISTRY['me'].requiredAnyPermissions = []** (RỖNG, theo done_when WO): card "Cá nhân" ở Home Portal
  hiện với MỌI user đã đăng nhập — khớp SPEC-09 §6.1 ("Tất cả người dùng đã đăng nhập hợp lệ") + module ME
  active mặc định (mig 0495). Route/sidebar vẫn gate `access:me` thật — chỉ visibility của CARD là mở, không
  phải cổng quyền. Cập nhật test invariant `registry.spec.ts` ("mỗi app có requiredAnyPermissions") để cho
  phép ngoại lệ `me` kèm comment lý do (self-service hub, không phải nghiệp vụ nhạy cảm).
- **Sidebar**: SPEC-09 §8.1 liệt kê 6 nhóm (Tổng quan/Hồ sơ/Tài khoản & bảo mật/Công việc/Thông báo/Cài đặt).
  WO này CHỈ build màn Tổng quan (ME-SCREEN-001) — sidebar chỉ khai đúng 1 entry "Tổng quan" (mirror
  `DASH_SIDEBAR` khi DASH mới có 1 màn). 5 nhóm còn lại (profile/security/work/notification/preferences) do
  S5-ME-FE-2/FE-3 APPEND theo route thật của họ — tránh link chết (404) trỏ vào route chưa tồn tại.
- **Section UI**: component chung `MeSectionCard<T>` (generic, mirror `WidgetCard`) nhận
  `section?: {status, data}` từ response `GET /me/overview` + render-prop cho nhánh "ok có dữ liệu"; tự vẽ
  skeleton/error+retry/forbidden/module_disabled/unlinked_employee/empty theo `status` — dùng LẶP LẠI cho cả
  2 khối "Cần thực hiện" (task) và "Chờ người khác duyệt" (leave) để tránh trùng lặp UI logic.
- **Dữ liệu overview hiện có** (BE S5-ME-BE-1) CHƯA đủ vài field spec §10.1 gợi ý ("công tháng này", "phép
  còn lại đến hiện tại" phân biệt cả-năm) — BE chỉ trả chấm công HÔM NAY + tổng số dư phép hiện tại (không
  tách theo mốc thời gian). FE hiển thị ĐÚNG field BE trả (KHÔNG suy diễn/tự tính thêm) — ghi nợ ở báo cáo
  cuối nếu owner cần bổ sung field BE.
- **Quick actions** (§10.1): deep-link tới route module gốc ĐÃ build (`/hr/me`, `/account/change-password`,
  `/attendance/today`, `/leave/me/requests/new`, `/tasks/my-tasks`, `/notifications`) — route đích tự
  guard/permission lại (§12.5), ME KHÔNG bypass.

## File chính

- `packages/web-core/src/lib/registry.ts` — `ModuleCode` +="ME"; `APP_REGISTRY` +="me"; `ROUTE_REGISTRY`
  +="me.overview".
- `packages/web-core/src/lib/query-keys.ts` — `rootKeys.me` + `meKeys`.
- `packages/web-core/src/lib/me-api.ts` (mới) — `meApi.getOverview()`.
- `packages/web-core/src/index.ts` — export `meApi`, `meKeys`.
- `packages/web-core/src/i18n/locales/vi/nav.ts` — `app.me`, `appDesc.me`, `routeTitle.meOverview`.
- `apps/app/src/layouts/workspace/sidebar-registry.ts` — `ME_SIDEBAR` (1 entry) + registry map.
- `apps/app/src/layouts/workspace/DynamicIcon.tsx` — icon `user-circle` (additive).
- `apps/api/src/foundation/module-catalog/module-app-metadata.ts` — `MODULE_APP_METADATA.ME` (additive).
- `apps/app/src/i18n/locales/vi/me.ts` (mới) + `apps/app/src/i18n/index.ts` đăng ký namespace `me`.
- `apps/app/src/routes/me/constants.ts` (mới) — `ME_ACCESS_PAIR`, `ME_QUICK_ACTION_PATHS`.
- `apps/app/src/routes/me/MeOverviewPage.tsx` (mới) + `components/MeSectionCard.tsx`,
  `components/MeIdentityBanner.tsx`, `components/MeQuickActions.tsx`.
- `apps/app/src/router.tsx` — `makeModuleRoute('/me', 'me.overview', 'ME', MeOverviewPage)` + addChildren.

## Verify

`pnpm --filter @mediaos/web-core typecheck test` · `pnpm --filter @mediaos/app typecheck test build` ·
`pnpm --filter @mediaos/api typecheck` (module-catalog additive) — không cần LANE_DB (không đụng
migration/DB, chỉ TS constants + FE).
