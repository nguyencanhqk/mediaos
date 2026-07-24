# S5-QA-E2E-1 — Bộ test E2E xuyên module + smoke checklist P0

Nguồn: `docs/IMPLEMENTATION/IMPLEMENTATION-08_Sprint_5_Integration_QA_Hardening_UAT_Execution_Plan.md`
§11.2 (Smoke checklist P0) · §11.3 (Exit criteria smoke) · §12.1 (Flow E2E bắt buộc).

## 1. Test đã thêm

`apps/api/test/integration/qae2e1-full-journey.int-spec.ts` (Postgres THẬT, DB cô lập
`mediaos_qae2e1`, gate `hasDb && LANE_DB`).

Một actor (Employee) đi HẾT MỘT LƯỢT liền mạch, mỗi bước gọi qua API module gốc (KHÔNG seed thẳng
DB để nhảy cóc bước — direct pool chỉ dùng để PLANT actor/quyền/dữ liệu nền và ĐỌC LẠI verify
side-effect):

1. Đăng nhập (`POST /auth/login`) → `GET /foundation/modules/my-apps` (Home Portal + App Switcher,
   E2E-001) → `GET /auth/me`.
2. Mở workspace Chấm công: `GET /attendance/today` → `POST /attendance/check-in` →
   `POST /attendance/check-out` (E2E-002).
3. Tạo + submit đơn nghỉ FullDay (`POST /leave/requests`) → Manager duyệt
   (`POST /leave/requests/:id/approve`) → đồng bộ ATT QUA API nội bộ THẬT
   (`POST /internal/v1/attendance/recalculate`, `x-internal-key` + `manage:attendance`) → verify
   `attendance_records.attendance_status = 'Leave'` (E2E-005).
4. Manager tạo task (`POST /tasks`) + giao việc (`POST /tasks/:id/assign`) → Employee xem
   `GET /tasks/my` → cập nhật trạng thái (`POST /tasks/:id/change-status`) (E2E-007/E2E-008).
5. Drain outbox thật (`OutboxWorker.processBatch()` qua `drainOutboxUntilSettled`) → Employee nhận
   notification `TASK_ASSIGNED` (`GET /notifications`), xác nhận deep-link
   `target.target_url === '/tasks/:id'` (`GET /notifications/:id`) → mark-read
   (`POST /notifications/:id/mark-read`) → unread-count giảm → dashboard widget `MY_TASKS`
   (`GET /dashboard/widgets/my-tasks`) phản ánh task mới sau cache invalidate.
6. Logout (`POST /auth/logout`) — SMOKE-003.
7. Deny-path (SMOKE-018 kiểu): employee gọi `POST /leave/requests/:id/approve` (quyền của
   manager) → 403; gọi `/internal/v1/attendance/recalculate` không có `manage:attendance` → 403;
   không token → 401 trên `/foundation/modules/my-apps` và `/notifications`.

Kết quả chạy (DB cô lập `mediaos_qae2e1`, `TURBO_FORCE=1`): **7/7 pass**.

```
export LANE_DB=mediaos_qae2e1
TURBO_FORCE=1 pnpm --filter @mediaos/api exec vitest run test/integration/qae2e1-full-journey.int-spec.ts
```

### Không viết lại (đã có test riêng phủ chi tiết hơn — mirror, không trùng)

- `att-noti-e2e.int-spec.ts` — outbox ATT→NOTI chi tiết theo từng eventCode/actor-exclusion/idempotent.
- `leave-att-sync-qa2.int-spec.ts` — LEAVE→ATT sync half-day/owner-cancel-refund/cross-tenant chi tiết.
- `qa2-e2e-task-noti-dash.int-spec.ts` — TASK→NOTI→DASH chi tiết (nội dung interpolate, dashboard
  content thật, gap NOTIFICATIONS widget cache staleness).

File mới CHỈ khoá CHUỖI liền mạch 1 lượt (đăng nhập → … → logout) mà chưa có test nào đi hết.

## 2. Bảng triage bug (P0/P1/P2)

| # | Mức | Mô tả | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- |
| 1 | P2 (đã biết, KHÔNG mới) | Widget `NOTIFICATIONS` dashboard KHÔNG tự invalidate cache khi có notification mới (0 producer thật qua `NotificationEngineService` cho `NOTIFICATION_CREATED`/`READ`) → cache STALE trong TTL 10s, tự lành sau TTL. | Đã tài liệu hoá tại `dashboard-cache-invalidation.const.ts` dòng ~80-92 + phủ bởi `qa2-e2e-task-noti-dash.int-spec.ts` test E3 (QA2-HIGH-001). Flow của WO này KHÔNG động tới widget NOTIFICATIONS (chỉ MY_TASKS) nên không lặp lại phủ. | Đã biết, KHÔNG sửa trong WO này (ngoài phạm vi — chỉ ghi nhận theo chỉ thị nhiệm vụ). |
| 2 | P2 (quan sát nhỏ, KHÔNG chặn) | `POST /attendance/check-out` trả HTTP 201 (Created) thay vì 200 (OK) — route không tạo thêm resource mới (cập nhật bản ghi check-in đã có), 201 hơi lệch REST-semantics thông thường (`check-in` 201 hợp lý vì tạo record; `check-out` là update). Không ảnh hưởng hành vi/hợp đồng vì FE đọc `success`/`data`, không rẽ nhánh theo status code cụ thể ngoài 2xx. | Response thật khi chạy flow: `{"success":true,...}` với `res.status === 201` (không có `@HttpCode` override trên route `check-out` ở `attendance.controller.ts`). | Ghi nhận, KHÔNG tự sửa (không thuộc phạm vi test-only của WO này; đổi status code là đổi hợp đồng API — cần WO BE riêng + rà FE caller). |
| 3 | — | Không phát hiện bug P0/P1 mới trong chuỗi E2E-001/002/005/007/008 (login→home portal→ATT check-in/out→LEAVE→ATT sync→TASK→NOTI deep-link→DASH widget→logout→deny-path). Toàn bộ permission gate (manager-only approve/recalculate, employee 403 khi vượt scope, 401 không token) hoạt động đúng thiết kế. | 7/7 test pass trên DB cô lập, đường HTTP thật (không mock permission/outbox/engine). | Không cần hành động. |

**Tổng kết:** 0 bug P0, 0 bug P1 mới phát hiện trong lượt E2E này. 2 mục P2 — 1 đã biết từ trước
(không phải phát hiện mới của WO này), 1 quan sát nhỏ về REST status code (không chặn UAT, không
sửa ở đây vì đổi hợp đồng API nằm ngoài phạm vi "chỉ viết test" của WO).

## 3. Việc còn nợ / ngoài phạm vi WO này

- E2E-003/004 (điều chỉnh công — submit/approve request điều chỉnh) đã có
  `att-noti-e2e.int-spec.ts` phủ theo từng nhánh; chưa nối vào MỘT chuỗi liền mạch cùng file như
  WO này làm cho E2E-001/002/005/007/008 — có thể mở rộng ở lượt sau nếu cần.
- E2E-006 (HR từ chối đơn nghỉ) đã có `leave-noti-e2e.int-spec.ts`/`leave-att-sync-qa2` phủ rời;
  tương tự có thể nối chuỗi sau.
- E2E-009..012 (P1 — mention/comment deep-link, change-request hồ sơ, cảnh báo hợp đồng, đổi
  role/permission) ngoài phạm vi P0 của WO này (SPEC-01 §7, IMPLEMENTATION-08 §12.1 đánh dấu P1).
- Mục P2-#2 (status code check-out) nên có WO BE riêng nếu quyết định chuẩn hoá 200 cho mọi mutation
  không tạo resource mới — cần audit thêm các route POST khác (check-in giữ 201 hợp lý).
