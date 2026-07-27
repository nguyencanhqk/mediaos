# RELEASE-06 — MODULE STABILIZATION CHECKLIST & BUG TRIAGE (Sprint 6 · WS2)

> Sinh trong `S6-STAB-1`. Khung: `IMPLEMENTATION-09` §11 (§11.2 severity · §11.3 cadence ·
> §11.4 lifecycle · §11.5 checklist 8 nhóm). Luật: **`RELEASE-05`** (freeze §2 · severity §5 · CR §4).
> Chấm ngày **2026-07-26** trên `master` `cbd94819` · migration head `0529` (197).

---

## 1. Cách đọc bảng

Mỗi ô §11.5 chỉ ✅ khi có bằng chứng thuộc một trong ba loại:

| Ký hiệu | Nghĩa |
| --- | --- |
| **T** | Test **đã chạy xanh** ở §2 — ghi `file.int-spec.ts` (+ tên `it()` khi cần phân biệt) |
| **C** | Ràng buộc tĩnh trong code — ghi `đường/dẫn.ts:dòng` |
| **L** | Chỉ chứng minh được trên môi trường sống (UI/deploy) ⇒ **KHÔNG tick ở đây**, chuyển UAT Cycle 1 / `S6-QA-FINAL-1` |
| **GAP** | Không có bằng chứng ⇒ vào §4 + sổ `RELEASE-02` |

> Nguyên tắc: "code đọc có vẻ đúng" **không phải** bằng chứng.

---

## 2. Bằng chứng chạy (nền của mọi ô ✅)

DB cô lập `LANE_DB=mediaos_s6stab1` (Postgres thật) — deny-path/IDOR/cross-tenant **thực thi thật**,
không bị `describe.skipIf` bỏ qua.

**`bash harness/check.sh --lane-db=s6stab1` (một tiến trình) → ĐỎ** vì `ERR_IPC_CHANNEL_CLOSED`
(**KI-014**, hạ tầng test — không phải lỗi sản phẩm). Chạy lại **chia 6 chunk**:

| Chunk | File | Test | Kết quả |
| --- | --- | --- | --- |
| `src-unit` (`src/**`) | 230 | 3.564 | ✅ |
| `test/foundation` | 20 | 157 | ✅ |
| `int a–e` | 52 | 645 | ✅ |
| `int f–l` | 44 | 1.022 | ❌ **2 file đỏ** → §4 → ✅ **44/44 · 1.022/1.022 sau khi sửa** |
| `int m–r` | 44 (1 skip) | 593 (3 skip · 1 todo) | ✅ |
| `int s–z` | 54 | 1.142 (12 skip) | ✅ |
| **Tổng** | **444** | **7.123** | ✅ sau sửa |

> Skip còn lại là **có chủ ý** (`pgbouncer-tenant-isolation` cần PgBouncer; gate `sessions` của
> `migration-smoke`), không phải deny-path bị bỏ qua.

Frontend + package dùng chung, cùng lần chạy:

| Gói | File | KQ |
| --- | --- | --- |
| `@mediaos/app` (chia chunk — xem §4.4) | 199 | ✅ |
| `@mediaos/console` · `@mediaos/auth` | 23 · 4 | ✅ |
| `@mediaos/contracts` · `@mediaos/web-core` · `@mediaos/ui` | 32 · 39 · 16 | ✅ |

`bash harness/check.sh --all`: **lint ✅ · typecheck ✅ · build ✅ · test ❌** — bước test đỏ **hoàn
toàn** do KI-014 (§4.4), không phải do lỗi test nào. Chạy chia chunk thì **777 file spec toàn
workspace đều xanh**.

> **Cập nhật 2026-07-27 (`S6-QA-CHUNK-1` — KI-014 đã đóng, §4.4.1):** dòng "test ❌" ở trên là ảnh
> chụp ngày **2026-07-26** và **không còn đúng**. `check.sh` nay tự chia chunk trên Windows:
> `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **cả 4 bước XANH**. Số file spec cũng đã
> trôi (777 → **761** đo bằng `vitest list`, api 448 · app 199 · console 23 · web-core 39 ·
> contracts 32 · ui 16 · auth 4) — từ nay runner sinh số này mỗi lần chạy nên không trôi âm thầm nữa.

---

## 3. Checklist §11.5 — 8 nhóm

### 3.1 AUTH / RBAC

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Login/logout hoạt động ổn định | ✅ | **T** `auth.int-spec` · `auth-logout.int-spec` |
| 2 | Refresh token / session hết hạn xử lý đúng | ✅ | **T** `auth-session.int-spec` — reuse-detection thu hồi **cả họ**; refresh thiếu/sai CSRF → 403; logout thu hồi family |
| 3 | Account locked/inactive không đăng nhập được | ✅ | **T** `auth-blocked-status.int-spec` — `suspended`/`invited` + mật khẩu ĐÚNG → 401 **đồng nhất**, không cấp token (allow-list, không deny-list). Khoá/suspend còn **thu hồi mọi phiên ngay trong cùng tx**: `auth-users-admin.int-spec` §revoke-on-lock · `admin-users-deny.int-spec` §revoke-on-suspend |
| 4 | User nhiều role resolve permission đúng | ✅ | **T** `auth-roles-permissions.int-spec` · `role-members.int-spec` · `permission-rule-apply.int-spec` |
| 5 | Data scope Own/Team/Department/Company/System đúng | ✅ | **T** `data-scope-resolver.int-spec` — đủ 5 scope + **fail-closed**: Department không resolve được org_unit → 0 row; scope null → 0 row; cross-tenant → 0 row |
| 6 | Backend chặn API trái quyền | ✅ | **T** deny-path phủ rộng: `admin-users-deny` · `noti-qa-permission` · `task-qa1-permission-matrix` (64 test) · `dashboard-agg-routes-deny` · `settings-permission-leak` · `employees-rbac-scope` |
| 7 | Frontend route/menu/action không hard-code theo role | ✅ | **C** 212 file dùng `PermissionGate`/`useCan()`. Quét toàn bộ `apps/{app,console,auth}/src` + `packages/*`: **0** so sánh với role hệ thống. Hai hit duy nhất là `myProjectRole` **do server trả** ([constants.ts:59-67](apps/app/src/routes/tasks/constants.ts#L59-L67)) — affordance ẩn/hiện, BE `ProjectAccessService` quyết cuối (**T** `task-project-role.int-spec`, 42 test) |
| 8 | Audit log cho thao tác quan trọng | ✅ | **T** `audit-write-shape.int-spec` · `audit-logs-appendonly.int-spec` (app role không UPDATE/DELETE được) · audit ghi **trong cùng tx**: `employee-code-config.int-spec` "audit-in-tx (BẤT BIẾN #2)" |

### 3.2 HR

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Employee list/detail/form hoạt động | ✅ | **T** `hr-core-reconcile.int-spec` · `hr-employee-write.int-spec` |
| 2 | Mã nhân viên tự sinh theo cấu hình | ✅ | **T** `employee-code-config.int-spec` — PATCH config → GET phản ánh; POST preview **không** đụng counter; `sequence-concurrent.int-spec` + `sequence-ensure-race.int-spec` (đua cấp mã) |
| 3 | Self-service tạo request, **không** sửa thẳng hồ sơ chính | ✅ | **T** `profile-change-request.int-spec` |
| 4 | HR/Admin approve/reject profile change đúng | ✅ | **T** `profile-change-request.int-spec` |
| 5 | Employee-user link đúng | ✅ | **T** `s2-int1-employee-user-provision.int-spec` · `foundation-db2-link-conflict.int-spec` |
| 6 | Sensitive fields mask/chặn theo quyền | ✅ | **T** `employees-salary-sensitive.int-spec` · `salary-profile-tenant-isolation.int-spec` · **C** audit masker `src/events/audit-masker.service.ts` (payload không mang PII: `hr-write.service.spec` "audit payload has NO PII key/value") |
| 7 | Hợp đồng, phòng ban, chức vụ, job level ổn định | ✅ | **T** `hr-contract.int-spec` · `hr-department-master-data.int-spec` · `hr-org-chart-scope.int-spec` |

### 3.3 ATT

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Attendance today trả đúng trạng thái | ✅ | **T** `attendance-be1.service.spec` · `attendance-be2.int.spec` |
| 2 | Check-in/out dùng **server time** | ✅ | **T** `attendance-be1.service.spec` — *"server time is authoritative: a bogus clientTime never feeds lateness calc"* |
| 3 | Chặn check-in khi có leave full-day Approved | ✅ | **T** `attendance-leave-sync.int.spec` — *"approve full-day leave → …, check-in blocked"* |
| 4 | Remote/công tác Approved áp rule đúng | ✅ | **T** `remote-work-request.int.spec` — approve → `attendance_records` upsert (Remote Work) |
| 5 | Records list phân trang/lọc đúng | ✅ | **T** `attendance-qa1-records-filters.int.spec` (my-records + records, meta đúng qua 2 trang) · `attendance-be2.int.spec` (pageSize>100 bị từ chối, mặc định 20) |
| 6 | Adjustment request submit/approve/reject đúng scope | ✅ | **T** `attendance-adjustment-allocate-guard.int-spec` · `attendance-permission.int-spec` · **cấm tự duyệt** phủ ở `att-core-tenant-deny.int-spec` |
| 7 | Manual adjustment có audit log | ✅ | **T** `attendance-logs-appendonly.int-spec` · `att-noti-e2e.int-spec` |
| 8 | Missing-checkout job không spam notification | ⚠️ **GAP** | Job **không tồn tại** ⇒ không thể spam, nhưng cũng không bao giờ gửi. Xem **STAB-F01** §4.1. Cờ dữ liệu vẫn đúng: `is_missing_check_out` đặt **đồng bộ** khi check-in/out ([attendance.builders.ts:63,104](apps/api/src/attendance/attendance.builders.ts#L63)) — **không** phụ thuộc job |

### 3.4 LEAVE

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Leave balance hiển thị đúng | ✅ | **T** `leave-qa2-api.int-spec` — sổ RESERVE/RELEASE/USE `balance_before/after` **liên tục**, đuôi khớp `leave_balances` |
| 2 | Create draft/submit/cancel đúng | ✅ | **T** `leave-qa2-api.int-spec` · `leave-requests-rls-positive.int-spec` |
| 3 | Preview calculation đúng full/half/hourly | ✅ | **T** `leave-request.logic.spec` (422 `LEAVE-ERR-DURATION-NOT-ALLOWED` khi cờ tắt) · `leave-att-sync-qa2.int-spec` (half-day → `required_working_minutes` 480/2) |
| 4 | Approve/reject đúng scope Manager/HR | ✅ | **T** `leave-qa2-api.int-spec` — *"manager approve non-report → 403 + 0 audit + 0 APPROVE row + 0 USE tx"* |
| 5 | Approved leave sync sang ATT | ✅ | **T** `leave-att-sync-qa2.int-spec` — full-day → `Leave`/required=0, day `Synced`, audit trong tx |
| 6 | Cancel/revoke leave tính lại ATT | ✅ | **T** `leave-att-sync-qa2.int-spec` — huỷ Approved+Synced → ATT recalc, **REFUND đúng số**, retry → 409 (**không hoàn kép**) |
| 7 | Balance ledger không sai / không âm ngoài policy | ✅ | **T** `leave-ledger-appendonly.int-spec` (app role UPDATE/DELETE bị DENY) · `leave-qa2-api.int-spec` (HR adjust ×2, chuỗi liên tục) |
| 8 | Notification leave gửi đúng người | ✅ | **T** `leave-noti-e2e.int-spec` — actor-exclusion **thật**: owner tự huỷ đơn Approved → chỉ manager nhận, employee bị loại |

### 3.5 TASK

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Project/task CRUD ổn định | ✅ | **T** `task-core.int-spec` · `task-projects.int-spec` |
| 2 | Project member role **không** thay thế RBAC hệ thống | ✅ | **T** `task-project-role.int-spec` (42 test) · `task-qa1-permission-matrix.int-spec` (64 test) — fail-closed 404 |
| 3 | My tasks đúng assignee/watcher/creator | ✅ | **T** `tasks-board.int-spec` · `task-actions.int-spec` |
| 4 | Kanban status update đúng | ✅ | **T** `task-kanban-move-activity.int-spec` · `task-move-state.int-spec` · `project-states.int-spec` |
| 5 | Comment/mention gửi notification đúng | ✅ | **T** `task-noti-e2e.int-spec` · `noti-event-intake.int-spec` |
| 6 | Checklist update không mất dữ liệu | ✅ | **T** `task-comments-checklists.int-spec` · `task-subtask-counting.int-spec` · `task-subtask-tree.int-spec` |
| 7 | File attachment kiểm tra quyền tải/xem/xoá | ✅ | **T** `task-files-access.int-spec` · `task-attachments.int-spec` · `legacy-attachments-lock.int-spec` |
| 8 | Cảnh báo assignee nghỉ phép nếu có dữ liệu LEAVE | ✅ | **T** `task-qa1-fsm-collab.int-spec` — *"assignee có Approved leave trùm due_at → 200 + warning ON-LEAVE, task VẪN được gán (KHÔNG chặn)"* |

### 3.6 NOTI

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Dropdown/latest ổn định | ✅ | **T** `my-notifications.int-spec` · FE `NotificationDropdown.spec.tsx` |
| 2 | Unread count chính xác | ✅ | **T** `my-notifications.int-spec` — `unread=2, high_priority=1, urgent=0` trước mark-read; giảm còn 1 sau |
| 3 | Mark read / mark all read đúng | ✅ | **T** `my-notifications.int-spec` — mark-read **idempotent** lần 2; `mark-all-read` → `updated_count=1`, `unread_count=0` |
| 4 | Deep link sang module gốc **và module gốc kiểm tra quyền lại** | ✅ | **T** `noti-deeplink-perm-lost.int-spec` — thu hồi `read:task` → `GET /tasks/:id` **403** trong khi notification vẫn list/detail được (không mất dữ liệu của chính mình) · `s5-noti-fix1-deeplink.int-spec` (0 template thiếu `target_url_template`) |
| 5 | Không chứa dữ liệu nhạy cảm trong URL/payload | ✅ | **T** `noti-deeplink-perm-lost.int-spec` *"không rò secret/PII"* · `reset-token-envelope.int-spec` (token reset **chỉ** dạng envelope, không plaintext) |
| 6 | Dedupe event hoạt động với event trùng | ✅ | **T** `noti-event-intake.int-spec` — trùng → `created=1, deduped=1`; **đua DB thật** (row trùng chưa commit) → block trên Lock → 23505 → rollback savepoint, không 500 · `lms-noti-service-intake.int-spec` (thiếu `dedupeKey` → **400**, không tắt dedupe im lặng) |
| 7 | Delivery log ghi nhận đúng | ✅ | **T** `notification-delivery-append-only.int-spec` |

### 3.7 DASH

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Dashboard default theo permission đúng | ✅ | **T** `dashboard-resolver.int-spec` · `dashboard-config-crud.int-spec` |
| 2 | Widget chỉ hiển thị theo permission/data scope | ✅ | **T** `dashboard-widget-security.int-spec` (sweep chéo tenant đủ 7 widget slug) · `dashboard-widget-catalog2-security.int-spec` · `dash-xmodule-2tenant.int-spec` |
| 3 | **Widget lỗi không làm sập toàn dashboard** | ✅ | **T** `dashboard-widget-data.int-spec` — nguồn hỏng → `status=Degraded` + `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` (**không 500**); `include_data=true` → widget khác vẫn có mặt. Quan trọng: **403 KHÔNG bị nuốt thành Degraded** (gate chạy TRƯỚC fetch) |
| 4 | Quick action điều hướng / gọi module gốc đúng | ⚠️ **L** | Điều hướng thật cần UI ⇒ UAT Cycle 1 (`UAT-EMP-06`, `UAT-MGR-01`). Phần BE (gate + deep-link) đã phủ ở ô 2 |
| 5 | Cache / last updated hiển thị rõ | ✅ | **C** widget trả `last_updated_at` và FE render ([AttendanceTodayWidget](apps/app/src/components/dashboard/AttendanceTodayWidget.tsx#L47), HrOverview, MyTasks, Notifications, GoalProgress) · **T** `dashboard-cache-invalidate.int-spec` · `dashboard-config-cache-rls.int-spec` |
| 6 | Refresh không blank toàn bộ nếu chỉ reload 1 widget | ✅ | **C/T** cùng cơ chế suy giảm cục bộ ở ô 3 (mỗi widget có `status` riêng) |
| 7 | Dashboard không tự xử lý nghiệp vụ gốc | ✅ | **T** `dashboard-agg-routes-deny.int-spec` — route tổng hợp chỉ đọc, deny khi thiếu cặp quyền module nguồn |

### 3.8 FOUNDATION / SYSTEM

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Company settings hoạt động | ✅ | **T** `system-settings.int-spec` · `system-settings-permission-deny.int-spec` · `settings-public-gate.int-spec` (giá trị nhạy cảm không lọt route public) |
| 2 | Module catalog đúng active/inactive | ✅ | **T** `module-toggle-permission-deny.int-spec` · `module-toggle-tenant-isolation.int-spec` · `module-registry.deny.int-spec` |
| 3 | File service private by default | ✅ | **T** `file-security.int-spec` · `files-rls-isolation.int-spec` · `file-access-logs-appendonly.int-spec` |
| 4 | Audit log append-only cho thao tác quan trọng | ✅ | **T** `audit-logs-appendonly.int-spec` · `holiday-audit.int-spec` (UPDATE/DELETE bị DENY; tx throw → rollback, 0 orphan) |
| 5 | Sequence counters sinh mã ổn định | ✅ | **T** `sequence-concurrent.int-spec` · `sequence-ensure-race.int-spec` |
| 6 | Public holidays ảnh hưởng ATT/LEAVE đúng nếu đã bật | ✅ | **T** `holidays.logic.spec` (ngày lễ Active affecting-attendance → không phải ngày làm) · `attendance-leave-sync.logic.spec` (*"Non Working Day / Public Holiday → NOT syncable"*) · `foundation-tables-tenant-deny.int-spec` (không giả mạo được ngày lễ global) |

### 3.9 Tổng kết checklist

| Nhóm | ✅ | ⚠️ GAP | ⚠️ L (cần môi trường sống) |
| --- | --- | --- | --- |
| AUTH/RBAC | 8 | 0 | 0 |
| HR | 7 | 0 | 0 |
| ATT | 7 | **1** | 0 |
| LEAVE | 8 | 0 | 0 |
| TASK | 8 | 0 | 0 |
| NOTI | 7 | 0 | 0 |
| DASH | 6 | 0 | **1** |
| FOUNDATION | 6 | 0 | 0 |
| **Tổng** | **57 / 60** | **1** | **2** |

---

## 4. Phát hiện & triage (`IMPLEMENTATION-09` §11.4)

Phân mức theo thang chuẩn `RELEASE-05` §5 (`S0…S4`).

### 4.1 STAB-F01 — 3 sự kiện NOTI của ATT bật trong danh mục nhưng **không có producer**

| | |
| --- | --- |
| **Mức** | **S2** (Medium) · Priority **P2** |
| **Module** | ATT × NOTI |
| **Bằng chứng** | `ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED` seed `isEnabled: true` ([notification-event-catalog.const.ts:82-84](apps/api/src/foundation/seed/notification-event-catalog.const.ts#L82-L84)) nhưng **không nơi nào phát**. Xác nhận độc lập trong chính code: [dashboard-cache-invalidation.const.ts:43](apps/api/src/dashboard/dashboard-cache-invalidation.const.ts#L43) — *"KHÔNG có producer nào"*. Toàn hệ chỉ có **3** `@SystemJobHandler`: `TempFileCleanup`, `RetentionCleanup`, `SystemJobRunsRetention` — **không có job ATT cuối ngày** |
| **Tác động** | Người dùng thấy 3 loại thông báo trong tuỳ chọn nhận và admin thấy trong danh mục sự kiện, nhưng **không bao giờ nhận được**. SPEC-04 §3352 + SPEC-08 §1273 có khai các mã này |
| **KHÔNG phải** | Không sai dữ liệu: cờ `is_missing_check_out` đặt **đồng bộ** lúc check-in/check-out, không chờ job |
| **Workaround** | Đơn điều chỉnh công (`MISSING_CHECK_OUT`) đã có và chạy được — người dùng vẫn tự sửa được công |
| **Quyết định** | **DEFER**. Không chặn RC (không chạm CF-P0/P1 nào ở `RELEASE-05` §3). Làm job mới = **tính năng**, bị `RELEASE-05` §4.2 từ chối sau freeze. Vào sổ **KI-021** |
| **Đề xuất sau MVP** | Hoặc build job ATT cuối ngày, hoặc **tắt** 3 mã trong catalog để UI không hứa cái không có (`ATT_CHECKIN_REMINDER`/`ATT_CHECKOUT_REMINDER` đã để `isEnabled: false` — đúng mẫu nên theo) |

### 4.2 STAB-F02 — `outboxOf` không lọc `company_id` ⇒ **ĐỎ-GIẢ ngẫu nhiên**

| | |
| --- | --- |
| **Mức** | **S1** (High — chặn khả năng verify release) · Priority **P0** |
| **Loại CR** | **Operational fix** (`RELEASE-05` §4.1) |
| **Triệu chứng** | Chunk `int f–l`: `goal-be2-link.int-spec` đỏ. Lần 1: `assigner_name` = `'Hệ thống'` thay vì `'Trưởng phòng A'`. Lần 2 (chạy lại): **test KHÁC** đỏ — `expected 4 to be 3`. Chạy **một mình**: 10/10 xanh |
| **Root cause** | `SELECT payload FROM outbox_events WHERE event_type = $1` — **thiếu `company_id`**. Vitest chạy spec file **song song** trên cùng lane DB, nên spec khác cũng tạo goal (`goal-tpl1-decompose`) chèn thêm `goal.assigned` giữa hai lần đo ⇒ `before + 1` sai và `.at(-1)` bắt nhầm payload **của tenant khác** |
| **Vì sao đáng sửa ngay** | Đỏ **di chuyển** giữa các lần chạy và biến mất khi chạy đơn lẻ — đúng dạng làm người ta "chạy lại cho xanh" rồi merge. Mọi kết luận xanh của `S6-QA-FINAL-1`/`S6-SEC-1`/`S6-PERF-DB-1` sau này đều dựa trên suite này |
| **Phạm vi** | Đây là **chỗ duy nhất sót** — đã quét toàn bộ truy vấn `outbox_events` trong `test/`: mọi spec khác (`auth`, `auth-hr-noti-e2e`, `auth-reset-deny-path`, `hr-task-code`, `leave-noti-e2e`, `permission-admin`) đều đã lọc `company_id=$1` |
| **Fix** | `apps/api/test/integration/goal-be2-link.int-spec.ts` — thêm `company_id = $1` |
| **Verify** | Chạy lại **nguyên chunk `f–l`** (tái tạo đúng điều kiện tranh chấp): **44/44 file · 1.022/1.022 test xanh** |
| **Trạng thái** | ✅ **Closed** |

### 4.3 STAB-F03 — đua teardown `audit_logs → companies` ⇒ **ĐỎ-GIẢ ngẫu nhiên**

| | |
| --- | --- |
| **Mức** | **S1** (High — chặn khả năng verify release) · Priority **P0** |
| **Loại CR** | **Operational fix** (`RELEASE-05` §4.1) |
| **Triệu chứng** | `goal-tpl1-decompose.int-spec` đỏ ở **teardown**: `update or delete on table "companies" violates foreign key constraint "audit_logs_company_id_fkey"` (`test/helpers/seed.ts:614`) |
| **Root cause** | `cleanupTenants` đã biết lớp lỗi này và có sẵn một lần quét lại `audit_logs` — nhưng lần quét đó chỉ che `DELETE users` (FK `actor_user_id`, đỏ CI 2026-07-15). Giữa nó và `DELETE companies` **vẫn còn cửa sổ** để outbox worker/consumer còn sống ghi thêm `audit_logs` → vỡ FK `company_id` |
| **Fix** | `apps/api/test/helpers/seed.ts` — quét lại `audit_logs` **rồi thử lại `DELETE companies`**, lặp có trần khi vẫn 23503. Dùng **đúng idiom đã có** trong file cho cặp `processed_events → outbox_events` (không phát minh cơ chế mới) |
| **Verify** | Cùng lần chạy chunk `f–l` ở §4.2 — xanh |
| **Trạng thái** | ✅ **Closed** |

### 4.4 STAB-F04 — KI-014 rộng hơn mô tả cũ: chạm **cả `@mediaos/app`**, và **chỉ ở máy Windows**

| | |
| --- | --- |
| **Mức** | **S2** (giữ nguyên mức KI-014) · Priority **P2** |
| **Loại** | Hạ tầng test (local) |
| **Trạng thái** | ✔ **ĐÃ ĐÓNG 2026-07-27** bởi `S6-QA-CHUNK-1` — xem §4.4.1 |

Sau khi đóng F02/F03, `bash harness/check.sh --all` **vẫn ĐỎ** ở bước test. Truy tiếp thì ra **hai
đính chính** so với mô tả cũ của KI-014:

**(a) Không chỉ `@mediaos/api` — `@mediaos/app` cũng chết.** Lần chạy `--all` này đỏ ở
`@mediaos/app#test` (`ERR_IPC_CHANNEL_CLOSED`; chạy trực tiếp qua pnpm còn thấy exit
`3221225477` = `0xC0000005` ACCESS_VIOLATION). Không phải lỗi sản phẩm và **không phải** do sửa của WO
này (diff chỉ chạm `apps/api/test/**`). Chia nhỏ thì **199/199 file spec của `apps/app` xanh**:

| Chunk | File | KQ |
| --- | --- | --- |
| `layouts` + `components` | 24 | ✅ |
| `routes/tasks` · `routes/hr` · `routes/goals` | 29 · 27 · 8 | ✅ |
| `routes/leave` + `routes/attendance` + `routes/me` | 55 | ✅ |
| `routes/system` · `routes/notifications` · `routes/dashboard` | 34 · 6 · 2 | ✅ |
| còn lại | 14 | ✅ |

Crash phụ thuộc **kích thước chunk**, không gắn với file cụ thể: gộp `tasks+hr+goals` (64 file) chết,
tách ra từng cái thì xanh.

**(b) CI KHÔNG dính — đây là chuyện của máy local Windows.** CI chạy `ubuntu-latest`, `ci.yml:140`
gọi `pnpm test` **toàn workspace một lần** và `apps-frontend.yml:95` chạy từng app; cả ba workflow
`CI` · `API — CI` · `Apps — Frontend CI` đều **success** trên `dcf85eb0`. `api.yml` cũng đã set
`LANE_DB: mediaos` ở bước Test (từ 2026-07-10) nên deny-path/IDOR **có chạy** trong CI.

> **Hệ quả thật (đính chính so với bản nháp đầu WO):** `IMP09-RC-003` **không** bị KI-014 chặn — CI
> vẫn chạy đủ. Cái bị chặn là **cổng local**: `harness/check.sh` ở **mọi tier** không thể xanh trên
> máy Windows này, nên mọi WO Sprint 6 sau phải verify bằng **chạy chia chunk** (§2) và ghi rõ số
> đo, thay vì trích một dòng "check.sh xanh".

### 4.4.1 ĐÓNG 2026-07-27 (`S6-QA-CHUNK-1`) — gốc đã truy ra, cổng local mở lại

Số đo đầy đủ: **`docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md`**.

**Gốc:** bug ngược dòng `tinypool@1.1.1` — `ProcessWorker.send()` chỉ chặn `if (!this.isTerminating)`,
**không** kiểm tra kênh IPC đã đóng. Worker fork thoát ngoài dự kiến ⇒ message birpc còn trong hàng
đợi MessagePort vẫn bị đẩy vào `process.send()` của tiến trình đã chết ⇒ `ERR_IPC_CHANNEL_CLOSED` nổ ở
**tiến trình chính** ⇒ vitest tính Unhandled Rejection ⇒ cả run ĐỎ dù **0 test sai**.

**Ba kết luận của §4.4 bị số đo bác bỏ:**

| §4.4 nói | Số đo 2026-07-27 |
| --- | --- |
| Bất ổn native ngẫu nhiên của máy | **Tái hiện 100%** — `pnpm test` đỏ **5/5 lần** |
| "Crash phụ thuộc **kích thước chunk**" | Sai — **package nạn nhân đổi ngẫu nhiên mỗi lần**: `console` (23 file) · `api` · `app` · `web-core` (39 file). Suite 23 file cũng chết |
| (ngầm định) CI xanh nhờ ubuntu/Node 22 | Chạy lại bằng **đúng Node 22.23.1 của CI → vẫn crash**. CI xanh vì runner chỉ **2–4 nhân** ⇒ vitest sinh 1–3 worker; máy dev **32 nhân** ⇒ **31 worker/package** ⇒ trúng đua liên tục |

Cũng bác bỏ *"chia chunk là workaround duy nhất"*: hạ trần `maxForks` cứu được `@mediaos/app` (3/3
xanh ở 16) nhưng **không** cứu `@mediaos/api` ở bất kỳ trần nào (31/16/8/4); `--pool=threads` **tệ
hơn** (SIGSEGV 139); `--no-isolate` sinh test đỏ thật.

**Vì sao không vá tận gốc:** tinypool 1.1.1 là bản **cuối** nhánh 1.x, `vitest@3.2.6` ghim `^1.1.1`,
tinypool 2.x là major khác API ⇒ chỉ nâng được bằng cách nâng vitest lên 4.x (di trú toàn workspace,
ngoài `paths` WO và không nên làm ngay trước RC). `dangerouslyIgnoreUnhandledErrors` bị **từ chối** —
nó nuốt luôn unhandled rejection THẬT của code sản phẩm.

**Vá đã ship:** `harness/chunk-test.mjs` — chia chunk (≤40 file/tiến trình) + hạ trần worker (8) +
**chạy lại chỉ chunk chết vì hạ tầng**. Luật chạy-lại an toàn vì đo được **27/27 lần crash đều có 0
test đỏ**; có test đỏ ⇒ **cấm** chạy lại. Runner đối chiếu số file với `vitest list` (thiếu ⇒ ĐỎ) và
**công bố** 6 file `exclude` của `apps/api/vitest.config.ts`. `check.sh` gọi runner **chỉ trên
Windows** (`CHUNK_RUNNER=1|0` ép tay); CI ubuntu giữ nguyên `pnpm test` một lần.

**Verify:** `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **XANH** (lint ✅ typecheck ✅
test ✅ build ✅, 4m32s). Phủ **761/761 file spec** toàn workspace. `lane-db-guard` vẫn bắt được thiếu
`LANE_DB` qua runner mới (**184** file skip → `red` ở tier `--all`); `harness/lane-db-guard.test.mjs`
**14/14**.

> ⇒ **Câu "mọi WO Sprint 6 sau phải verify bằng chạy chia chunk chép tay" nay HẾT hiệu lực.** Tiêu
> chí verify quay lại bình thường: `bash harness/check.sh --all` với `LANE_DB` — nó tự chia chunk.

---

## 5. Áp dụng nhịp triage §11.3 cho dự án 1 người

| Nhịp gốc | Áp thật |
| --- | --- |
| Đầu ngày — duyệt S0/S1 mới | `bash harness/init.sh` → đọc `STATUS.md` + `RELEASE-02` |
| Giữa ngày — check blocker | Chỉ khi có S0/S1 đang mở |
| Cuối ngày — verify + cập nhật known issue | **Bắt buộc**: phiên nào phát hiện bug thì cập nhật `RELEASE-02` trước khi đóng |
| Trước RC — bug scrub S0/S1/S2 | `S6-REL-1` |

Điều kiện đóng bug (§11.4) áp cho F02/F03: link commit ✅ · môi trường verify ✅ (`LANE_DB=mediaos_s6stab1`,
Postgres thật) · kết quả QA ✅ (44/44 · 1.022/1.022) · ghi chú regression ✅ (chỉ chạm `test/**`,
**không** đổi code sản phẩm ⇒ không có regression module khác).

---

## 6. Kết luận WS2

| Câu hỏi | Trả lời |
| --- | --- |
| Checklist §11.5 chạy đủ 8 nhóm? | ✅ 60/60 ô được chấm — **57 ✅** · 1 GAP (S2, defer) · 2 cần môi trường sống |
| Bug P0/P1 (S0/S1) fix + retest + regression? | ✅ 2 lỗi **S1** tìm được và **đã đóng**, verify bằng cách chạy lại nguyên chunk gây đỏ |
| Có mở scope mới không? | ❌ Không. GAP duy nhất bị **defer** đúng luật `RELEASE-05` §4.2 |
| Severity matrix + cadence áp dụng? | ✅ §4 + §5 |
| Còn S0/S1 mở sau WO? | **0** |
| `check.sh` xanh sau mỗi fix? | ⚠️ **Không đạt theo nghĩa đen** — `--all` đỏ ở bước test vì KI-014 (§4.4), không phải vì lỗi test. Bằng chứng thay thế: **777 file spec toàn workspace xanh** khi chạy chia chunk; `lint`/`typecheck`/`build` ✅; CI trên `ubuntu-latest` chạy đủ một lần và **success** |

> **Không có S0/S1 nào mở.** Nhưng WS2 xanh **không** mở đường tới RC: 4 chặn RC ở `RELEASE-05` §8.4
> (Security workflow đỏ · chưa diễn tập restore · UAT Cycle 1 chưa chạy · staging dùng chung `dist`)
> **vẫn nguyên**.
>
> **Nói thẳng một điều khó chịu:** `done_when` của WO này ghi *"check.sh xanh sau mỗi fix"* — điều
> kiện đó **không đạt được trên máy này** vì KI-014, và sẽ không đạt được cho tới khi
> `S6-QA-CHUNK-1` đóng. Ghi lại đây thay vì trích một dòng "xanh" từ tier nhẹ hơn để trông cho đẹp.
> Tiêu chí verify thực dụng cho các WO Sprint 6 còn lại: **lint + typecheck + build xanh, cộng số đo
> chạy chia chunk**, kèm CI xanh trên PR.
