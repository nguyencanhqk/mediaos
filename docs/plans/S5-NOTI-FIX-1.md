# S5-NOTI-FIX-1 — Backfill `target_url_template` cho 39 template notification GLOBAL (QA2-CRIT-001)

WO: `harness/backlog.mjs` id `S5-NOTI-FIX-1` (module NOTI, layer BE, zone **red**). Migration lane (nối tiếp duy nhất).
Nguồn: `docs/plans/S4-QA-2.md` known-issue **QA2-CRIT-001** (bằng chứng: `SELECT count(*) FILTER (WHERE target_url_template IS NOT NULL) FROM notification_templates WHERE company_id IS NULL` → **0/39**).

## 1. Vấn đề & root cause

- Migration `0481` seed 39 template GLOBAL (36) + `0490` (3) nhưng **KHÔNG** đưa cột `target_url_template` vào danh sách INSERT ⇒ mọi template global có `target_url_template = NULL`.
- Engine render (`notification-renderer.service.ts`): `targetUrl = template.targetUrlTemplate ? interpolate(...) : null`. Template NULL ⇒ `notifications.target_url = NULL` cho MỌI notification tạo qua `NotificationEngineService` (trừ khi company tự cấu hình override).
- Hệ quả: deep-link chết toàn hệ thống (SPEC-08 §15/§18 mẫu `target_url:"/tasks/task-id"`), `NotificationTargetLink` ẩn nút.

## 2. Bẫy kỹ thuật CHẶN (đã xác minh — quyết định thiết kế xoay quanh nó)

`renderer.interpolate()` giữ **NGUYÊN** `{key}` khi payload thiếu key (non-fatal). Nhưng engine sau render gọi
`assertInternalTargetUrl(rendered.targetUrl)` với regex `^\/(?!\/)[\w\-./?=&%#]*$` — ký tự `{` `}` **KHÔNG**
nằm trong char-class ⇒ **422 NOTI-ERR-TARGET-UNAVAILABLE (loud)**, notification KHÔNG được tạo (bridge dead-letter).

⇒ **Nếu đặt placeholder mà payload thiếu key ⇒ vỡ intake (422), tệ hơn NULL.** Vì vậy chỉ dùng placeholder khi
**MỌI producer THẬT của event đó luôn có key trong payload** (đã đối chiếu từng producer). Event còn lại → **route
TĨNH (không placeholder)** — luôn hợp lệ.

### Payload key đã xác minh (producer thật → engine render):

| Placeholder | Producer xác minh | Event dùng |
| --- | --- | --- |
| `{taskId}` | `task-actions.service.ts` `commonPayload()` (assigned/status/priority/due_date/assignee) + `task-comments.service.ts` `commentPayload()` (comment/mentioned) — cả hai `taskId: task.id` | 7 TASK event |
| `{projectId}` | `projects.service.ts` addMember payload `projectId: id` | PROJECT_MEMBER_ADDED |
| `{requestId}` | `leave-request/-approval/-revoke.service.ts` (`requestId`) + `attendance-adjustment.service.ts`/`remote-work-request.service.ts` (`requestId`) | 4 LEAVE + 7 ATT event |

**KHÔNG có `taskId`** (⇒ route tĩnh): `TASK_DUE_SOON`/`TASK_OVERDUE` — producer `task-reminder.job-handler.ts`
payload chỉ `{task_title, due_at}` (entity id ở `sourceEntityId`, KHÔNG vào payload render). Detection ATT
(`ATT_MISSING_CHECKOUT`/`LATE`/`ABSENT`/`AUTO`), LEAVE balance/sync, HR, AUTH, SYSTEM: chưa có producer wire hoặc
payload không có id ⇒ **route TĨNH**.

## 3. FE route thật (apps/app/src/router.tsx) — template CHỈ trỏ route TỒN TẠI

- `/tasks/$taskId` · `/tasks/projects/$projectId` · `/tasks/my-tasks` · `/tasks` (list)
- `/leave/me/requests/$requestId` (detail, **own-scoped** `getMyRequest`) · `/leave/approvals` (approver inbox list) · `/leave/me/balances` · `/leave` (overview hub)
- `/attendance/adjustment-requests/$requestId` (detail **scope-aware** — trang có cả view + approve/reject) · `/attendance/remote-work-requests/$requestId` (scope-aware) · `/attendance/today`
- `/hr/employees` · `/hr/profile-change-requests` (approver list) · `/hr/me/change-request` (my) · `/hr/contracts`
- `/account/change-password` · `/account/sessions` · `/system`

Ghi chú scope: LEAVE detail `/leave/me/requests/:id` dùng `getMyRequest` **own-scoped** ⇒ chỉ requester mở được.
Vì vậy `LEAVE_REQUEST_SUBMITTED` (recipient = manager, KHÔNG có requester) → `/leave/approvals` (inbox manager mở
được). ATT detail scope-aware (manager + requester dùng chung trang) → placeholder dùng cho cả submitted/approved/rejected.

## 4. Bảng 39 template → `target_url_template`

| # | event_code | module | target_url_template | loại | ghi chú |
| --- | --- | --- | --- | --- | --- |
| 1 | AUTH_USER_CREATED | AUTH | `/account/change-password` | tĩnh | body "đổi mật khẩu lần đầu" |
| 2 | AUTH_PASSWORD_RESET_REQUESTED | AUTH | `/account/change-password` | tĩnh | |
| 3 | AUTH_USER_LOCKED | AUTH | `/account/sessions` | tĩnh | account/security |
| 4 | HR_EMPLOYEE_CREATED | HR | `/hr/employees` | tĩnh | payload không có employeeId |
| 5 | HR_PROFILE_CHANGE_SUBMITTED | HR | `/hr/profile-change-requests` | tĩnh | approver list |
| 6 | HR_PROFILE_CHANGE_APPROVED | HR | `/hr/me/change-request` | tĩnh | requester = employee |
| 7 | HR_PROFILE_CHANGE_REJECTED | HR | `/hr/me/change-request` | tĩnh | |
| 8 | HR_CONTRACT_EXPIRING | HR | `/hr/contracts` | tĩnh | |
| 9 | ATT_MISSING_CHECKOUT | ATT | `/attendance/today` | tĩnh | detection, payload work_date |
| 10 | ATT_LATE_DETECTED | ATT | `/attendance/today` | tĩnh | |
| 11 | ATT_ABSENT_DETECTED | ATT | `/attendance/today` | tĩnh | |
| 12 | ATT_ADJUSTMENT_SUBMITTED | ATT | `/attendance/adjustment-requests/{requestId}` | placeholder | ✓ requestId |
| 13 | ATT_ADJUSTMENT_APPROVED | ATT | `/attendance/adjustment-requests/{requestId}` | placeholder | ✓ P0 |
| 14 | ATT_ADJUSTMENT_REJECTED | ATT | `/attendance/adjustment-requests/{requestId}` | placeholder | ✓ |
| 15 | ATT_AUTO_ATTENDANCE_CREATED | ATT | `/attendance/today` | tĩnh | |
| 16 | ATT_REMOTE_REQUEST_SUBMITTED | ATT | `/attendance/remote-work-requests/{requestId}` | placeholder | ✓ requestId |
| 17 | ATT_REMOTE_REQUEST_APPROVED | ATT | `/attendance/remote-work-requests/{requestId}` | placeholder | |
| 18 | ATT_REMOTE_REQUEST_REJECTED | ATT | `/attendance/remote-work-requests/{requestId}` | placeholder | |
| 19 | ATT_REMOTE_REQUEST_CANCELLED | ATT | `/attendance/remote-work-requests/{requestId}` | placeholder | |
| 20 | LEAVE_REQUEST_SUBMITTED | LEAVE | `/leave/approvals` | tĩnh | recipient=manager (own-detail 403) |
| 21 | LEAVE_REQUEST_APPROVED | LEAVE | `/leave/me/requests/{requestId}` | placeholder | ✓ P0, requester |
| 22 | LEAVE_REQUEST_REJECTED | LEAVE | `/leave/me/requests/{requestId}` | placeholder | ✓ P0, requester |
| 23 | LEAVE_REQUEST_CANCELLED | LEAVE | `/leave/me/requests/{requestId}` | placeholder | requester-centric (xem §6) |
| 24 | LEAVE_REQUEST_REVOKED | LEAVE | `/leave/me/requests/{requestId}` | placeholder | requester luôn recipient |
| 25 | LEAVE_BALANCE_ADJUSTED | LEAVE | `/leave/me/balances` | tĩnh | |
| 26 | LEAVE_BALANCE_LOW | LEAVE | `/leave/me/balances` | tĩnh | |
| 27 | LEAVE_SYNC_TO_ATT_FAILED | LEAVE | `/leave` | tĩnh | admin/system, không id |
| 28 | TASK_ASSIGNED | TASK | `/tasks/{taskId}` | placeholder | ✓ P0 |
| 29 | TASK_STATUS_CHANGED | TASK | `/tasks/{taskId}` | placeholder | |
| 30 | TASK_COMMENT_CREATED | TASK | `/tasks/{taskId}` | placeholder | ✓ P0 |
| 31 | TASK_MENTIONED | TASK | `/tasks/{taskId}` | placeholder | |
| 32 | TASK_DUE_SOON | TASK | `/tasks/my-tasks` | tĩnh | payload không có taskId |
| 33 | TASK_OVERDUE | TASK | `/tasks/my-tasks` | tĩnh | payload không có taskId |
| 34 | PROJECT_MEMBER_ADDED | TASK | `/tasks/projects/{projectId}` | placeholder | ✓ projectId |
| 35 | TASK_PRIORITY_CHANGED | TASK | `/tasks/{taskId}` | placeholder | |
| 36 | TASK_DUE_DATE_CHANGED | TASK | `/tasks/{taskId}` | placeholder | |
| 37 | TASK_ASSIGNEE_CHANGED | TASK | `/tasks/{taskId}` | placeholder | |
| 38 | SYSTEM_CONFIG_WARNING | SYSTEM | `/system` | tĩnh | |
| 39 | SYSTEM_ERROR_DETECTED | SYSTEM | `/system` | tĩnh | |

Tổng: AUTH 3 · HR 5 · ATT 11 · LEAVE 8 · TASK 10 · SYSTEM 2 = **39**. Placeholder 19 · tĩnh 20.

## 5. Chiến lược migration (idempotent, RLS-an-toàn, hot-file APPEND)

- Migration mới **0497** (head hiện tại = 0496 idx 176 → mint idx 177, when 1717500880000 ĐƠN ĐIỆU). KHÔNG rewrite 0481/0490.
- `UPDATE notification_templates ... FROM (VALUES 39 dòng) AS t(template_code, url)` — match theo `template_code` GLOBAL.
- WHERE: `nt.company_id IS NULL AND nt.deleted_at IS NULL AND nt.target_url_template IS NULL`:
  - `company_id IS NULL` ⇒ **KHÔNG đè company-override** (tenant tự cấu hình giữ nguyên).
  - `target_url_template IS NULL` ⇒ **KHÔNG đè giá trị đã có** + idempotent (chạy lại = 0 hàng đổi).
- Seed qua **migrator owner-bypass** (mirror 0481/0490): row global ghi qua table-owner (rolbypassrls), RLS+FORCE (0479) chỉ chặn app role. Migration KHÔNG đụng RLS/policy/permission/grant.
- **THUẦN DATA** ⇒ KHÔNG `db:generate` (drizzle không sinh gì cho UPDATE), viết tay + thêm journal entry (mirror 0481/0490).
- **Verify fail-LOUD** (DO-block cuối): đếm template global còn `target_url_template IS NULL` (không xoá mềm) → `RAISE EXCEPTION` kèm `array_agg(template_code)` nếu > 0. Bảo vệ bất biến "0/39 NULL".

## 6. Điểm lệch done_when / phát hiện thêm (ghi nhận, KHÔNG tự sửa ngoài scope)

1. **Renderer fragility (bug chặn tiềm ẩn — GHI, không sửa engine):** `interpolate()` giữ literal `{key}` khi
   thiếu → `assertInternalTargetUrl` 422. Placeholder chỉ AN TOÀN vì đã xác minh mọi producer thật có key. Đề
   xuất (WO khác): renderer nên coi target_url còn placeholder chưa điền = `null` (bỏ deep-link) thay vì 422.
2. **`noti-event-intake.int-spec.ts` `body()` default payload** `{taskTitle}` thiếu `taskId` ⇒ sau backfill,
   happy-path (h)/(i)/(b) POST TASK_ASSIGNED/TASK_COMMENT_CREATED sẽ render `/tasks/{taskId}` literal → 422. **Vá
   trong scope** (file thuộc `apps/api/test/integration/**`): thêm `taskId` vào default payload (phản ánh producer
   thật). KHÔNG phải nới lỏng test — payload cũ vốn phi thực tế.
3. **LEAVE mixed-audience (CANCELLED/REVOKED):** recipient có thể gồm CẢ requester lẫn manager; route
   `/leave/me/requests/:id` own-scoped ⇒ manager-recipient có thể 403 trên FE. Chọn requester-centric (requester
   luôn là recipient chính, trừ CANCELLED-Pending manager-only). Follow-up: thêm route approver xem 1 đơn cụ thể.
4. **target_module/target_type/target_id vẫn NULL:** engine `persistRecipient` chỉ set `target_url` (từ render) +
   `source_entity_*`; KHÔNG set `target_module/type/id` (QA2-CRIT-001 phần 2). WO này CHỈ vá `target_url_template`
   (deep-link đủ dùng qua `target_url`). Các cột target_module/type/id là việc riêng của bridge (ngoài scope).
5. **QA2-CRIT-002** (placeholder câm COMMENT/MENTIONED/MEMBER_ADDED) = WO nối tiếp **S5-NOTI-FIX-2**, KHÔNG đụng ở đây.

## 7. Kiểm chứng (red zone — DB cô lập, đường thật)

- `pnpm typecheck` + `bash scripts/lane-db-setup.sh notifix1` → `export LANE_DB=mediaos_notifix1` (chain 0000→0497 sạch).
- Int-spec mới `qa2-noti-deeplink.int-spec.ts`:
  (a) sau migrate: 0 template global `target_url_template IS NULL` + tổng 39 + sample-map đúng.
  (b) render deep-link THẬT qua bridge (drainOutboxUntilSettled) cho P0: TASK_ASSIGNED, TASK_COMMENT_CREATED →
  `/tasks/{taskId}`; LEAVE_REQUEST_APPROVED/REJECTED → `/leave/me/requests/{requestId}`; ATT_ADJUSTMENT_APPROVED →
  `/attendance/adjustment-requests/{requestId}`.
  (c) tĩnh: TASK_DUE_SOON template = `/tasks/my-tasks` (chứng minh KHÔNG rò `{}` → an toàn 422).
- Cập nhật `qa2-e2e-task-noti-dash.int-spec.ts` E4: từ `target_url === null` → `=== /tasks/{taskId}` (deep-link đã sống).
- Regression THẬT: `leave-noti-e2e` · `task-noti-e2e` · `att-noti-e2e` · `noti-event-intake` · `qa2-e2e`.
- Chạy lại nguyên file 0497 lần 2 trên lane DB → **0 hàng đổi** (idempotent, mẫu HR-IMPORT).
