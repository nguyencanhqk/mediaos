# S5-GOAL-FE-1 — FE trang Mục tiêu (GOAL-SCREEN-001/002/003)

> Zone: 🟡 yellow · Gate: LIGHT (typescript-reviewer + react-reviewer + quality-gate) · depends_on: S5-GOAL-BE-1 ✓ (+ BE-2 ✓ đã ship master)
> Nguồn: SPEC-10 §9 (màn) · §11 (permission) · §12 (mã lỗi) · §13.2 ("chưa đo" ≠ 0%) · §14 (trạng thái UI) · §15 (API) · GOAL-DEC-002 (module Mục tiêu RIÊNG).

## 1. Phạm vi

3 màn của SPEC-10, module GOAL đứng RIÊNG (menu "Mục tiêu" + app card):

| Màn | Nội dung |
| --- | --- |
| GOAL-SCREEN-001 | Trang Mục tiêu: cây/danh sách theo kỳ·cấp·phòng ban·trạng thái·owner; progress bar từng nút (NULL → "—" + cảnh báo, KHÔNG 0%). |
| GOAL-SCREEN-003 | Form tạo/sửa: chọn `level` → hiện đúng field neo (phòng/dự án/nhân viên); chọn `progressMode` có mô tả; RHF + Zod, map mã lỗi GOAL-ERR-001/003/011/015. |
| GOAL-SCREEN-002 | Chi tiết 4 tab: Tổng quan · Công việc gắn · Mục tiêu con · Lịch sử check-in. Goal đã chốt kỳ: badge khóa + disable MỌI nút ghi. |

**Out-of-scope (FE-2):** check-in modal, nút chốt kỳ/mở lại, gắn/tháo task (bulk), khối "Mục tiêu của tôi" trong /me. Ở FE-1 các tab con/lịch sử là **read-only** (API đã đủ: GET /goals/:id/updates + list-by-parentGoalId), nút check-in/finalize chưa render.

## 2. Hợp đồng API (BE-1/BE-2 đã ship — apps/api/src/goals + packages/contracts/src/goal.ts)

Mọi endpoint đọc trả **MẢNG TRẦN** (không `{data,meta}`) → apiFetch unwrap envelope `{success,data,error}` rồi parse `z.array(...)`; KHÔNG truyền schema envelope (memory apifetch-drops-pagination-bare-array).

- `GET /goals` (view) → `GoalCoreResponseDto[]` — filter level/department/project/employee/parentGoalId/status/periodFrom/periodTo + limit/offset.
- `GET /goals/tree` (view) → `GoalTreeNodeDto[]` — filter department/status/period, không phân trang.
- `GET /goals/:id` (view) → `GoalDetailResponseDto` (core + parent breadcrumb + childCount).
- `POST /goals` (create) · `PATCH /goals/:id` (update) · `DELETE /goals/:id` (204, delete).
- `GET /goals/:id/tasks` (view) → `TaskCoreResponseDto[]` (tab Công việc gắn, read-only ở FE-1).
- `GET /goals/:id/updates` (view) → `GoalUpdateResponseDto[]` (tab Lịch sử check-in, ledger append-only).

`progressPercent` NULL = "chưa đo" (§13.2). Cột `numeric` đã ép số ở mapper BE → FE nhận `number | null`.

## 3. Permission (SPEC-10 §11, cặp engine literal — seed mig 0506, is_sensitive=false → có trong /auth/me capabilities)

Dùng **cặp literal trực tiếp** (KHÔNG qua PERMISSION_CODE_TO_PAIR — tránh drift, mẫu access:me/view:shift):

- Menu sidebar + app card + route module-entry: `access:goal`.
- Nút "Tạo mục tiêu" / submit create: `create:goal` (PermissionGate/useCan).
- Nút "Sửa": `update:goal`. Nút "Xóa": `delete:goal`.
- Trang đọc gọi GET /goals (`view:goal`) — mọi role canonical có cả access + view (§11) nên route gate access:goal ↔ page fetch view:goal không lệch trong thực tế.

Server là cổng thật (masking + data-scope). FE KHÔNG hard-code role.

## 4. Wiring (khối ADDITIVE — file dùng chung sửa off origin/master trong worktree isolate)

**packages/web-core:**
- `lib/goal-api.ts` (mới) — `goalApi` (list/tree/getOne/create/update/remove/linkedTasks/updates).
- `lib/query-keys.ts` — `rootKeys.goals` + `goalKeys` + `goalInvalidation` (list-prefix + tree-prefix + detail).
- `lib/registry.ts` — `ModuleCode` += `"GOAL"`; `APP_REGISTRY` += goals (gate access:goal); `ROUTE_REGISTRY` += `goal.list`.
- `i18n/locales/vi/nav.ts` — `app.goals`/`appDesc.goals` + `routeTitle.{goals,goalNew,goalDetail,goalEdit}`.
- `index.ts` — export `goalApi` + `goalKeys` + `goalInvalidation`.

**apps/app:**
- `routes/goals/` — constants.ts (GOAL_ENGINE_PAIRS/GOAL_PATHS), goal-format.ts (progress "—", nhãn level/mode/status/period), goal-form-schema.ts, GoalListPage.tsx, GoalFormPage.tsx, GoalDetailPage.tsx, components/ (GoalProgressBar, GoalTreeTable, tab panels).
- `i18n/locales/vi/goals.ts` (mới) + đăng ký trong `i18n/index.ts`.
- `layouts/workspace/sidebar-registry.ts` — `GOAL_SIDEBAR` + map `GOAL`.
- `router.tsx` — lazy GoalListPage/GoalFormPage/GoalDetailPage + routes `/goals` (makeModuleRoute) · `/goals/new` · `/goals/$goalId` · `/goals/$goalId/edit` (local RouteMeta, mẫu HR employees) + addChildren. Static `/goals/new` xếp hạng TRÊN `$goalId`.

`moduleCode:"GOAL"` an toàn: module GOAL seeded active (mig 0506, group Collaboration) ⇒ /auth/me trả active (mirror ME mig 0495).

## 5. Trạng thái UI bắt buộc (§14)

loading (skeleton/DataTable isLoading) · error (EmptyState + retry) · empty ("chưa có mục tiêu kỳ này" + CTA tạo nếu có quyền) · **chưa đo** ("—", KHÔNG 0%) · **đã chốt kỳ** (badge khóa + disable nút ghi) · **không quyền** (PermissionGate, KHÔNG hard-code).

Mutation nào (create/update/delete) cũng invalidate list + tree + detail qua `goalInvalidation`.

## 6. Test (LIGHT gate — "unit test component chính")

- `goal-format.spec.ts` — progress NULL→"—" (KHÔNG "0%"), nhãn level/mode/status, cảnh báo "chưa gắn việc".
- `GoalListPage.spec.tsx` — loading/error/empty/data + gate nút Tạo.
- `GoalFormPage.spec.tsx` — chọn level → đúng field neo hiện; validate GOAL-ERR (weight≤0, thiếu kỳ, target khi number).
- `GoalDetailPage.spec.tsx` — finalized → badge khóa + nút ghi disabled; chuyển tab.

## 7. Rủi ro / bẫy

- apiFetch unwrap envelope → luôn parse `z.array(itemSchema)` cho list (đừng envelope schema).
- `to:` của TanStack: route makeModuleRoute bị widen path → navigate về `/goals` cast `as "/"`; detail/new/edit (createRoute literal) dùng `to` + params bình thường.
- query-keys.ts có khối lặp cũ (hrContractsInvalidation/remoteWorkRequestInvalidation) — KHÔNG copy; theo khuôn `leaveKeys`/`leaveInvalidation` sạch.
- Chạy song song phiên khác (S5-LMS-FE-1 WIP ở MAIN tree) → làm ở worktree isolate off origin/master; PR autoMerge=false (parallel fence), merge sau review người.
