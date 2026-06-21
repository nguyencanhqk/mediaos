> 🔒 **BẤT BIẾN DB (bổ sung bắt buộc):** Mọi bảng có `company_id` PHẢI bật **RLS + FORCE**; `audit_logs` **append-only** (REVOKE UPDATE/DELETE + trigger); audit/event ghi qua **outbox** trong cùng transaction nghiệp vụ. Bộ docs gốc CHƯA mô tả 3 cơ chế này — DDL mẫu + `withTenant`/`set_config` tại [DECISIONS-02 §2–3](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# DB-07: NOTI & DASH DATABASE DESIGN

> **📚 Bộ tài liệu DB — Hệ thống Quản lý Doanh nghiệp**
> [DB-01 Tổng quan](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [DB-02 AUTH/RBAC](<DB-02 AUTH RBAC Database Design.md>) · [DB-03 HR](<DB-03_HR Database Design.md>) · [DB-04 ATT](<DB-04_ATT Database Design.md>) · [DB-05 LEAVE](<DB-05 LEAVE Database Design.md>) · [DB-06 TASK](<DB-06 TASK Database Design.md>) · **DB-07 NOTI/DASH** · [DB-08 Audit/Files/Settings](<DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-09 Index/Hiệu năng](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Migration/Seed](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>)
>
> **Nguồn & liên quan:** [PRD-00 §9.6–9.7](<../PRD/PRD-00 Enterprise Management System .md>) · SPEC tương ứng: [SPEC-07 DASH](<../SPEC/SPEC-07 DASH.md>) · [SPEC-08 NOTI](<../SPEC/SPEC-08 NOTI.md>) · [SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế API: API-07 NOTI](<../API Design/API-07_NOTI_API_Design.md>) · [API-08 DASH](<../API Design/API-08_DASH_API_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-07 |
| Tên tài liệu | NOTI & DASH Database Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Module | NOTI - Thông báo hệ thống; DASH - Dashboard |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả thiết kế database chi tiết cho hai module **NOTI - Thông báo hệ thống** và **DASH - Dashboard** trong hệ thống quản lý doanh nghiệp nội bộ.

Trong kiến trúc MVP, `NOTI` và `DASH` là hai module trải nghiệm người dùng và tổng hợp dữ liệu. Hai module này không phải là nơi xử lý nghiệp vụ gốc như HR, ATT, LEAVE hoặc TASK, nhưng chúng đóng vai trò rất quan trọng:

1. `NOTI` giúp các module nghiệp vụ phát sinh thông báo đúng người, đúng thời điểm, đúng kênh.
2. `DASH` giúp người dùng xem nhanh các dữ liệu quan trọng theo vai trò, quyền và data scope.
3. `NOTI` cung cấp số lượng thông báo chưa đọc và danh sách thông báo mới cho `DASH`.
4. `DASH` tổng hợp dữ liệu từ HR, ATT, LEAVE, TASK và NOTI nhưng không tự chỉnh sửa dữ liệu nghiệp vụ.
5. Hai module cần được thiết kế đủ nhẹ cho MVP nhưng đủ mở để phát triển realtime, mobile push, email, digest, BI dashboard, AI summary và automation ở các phase sau.

Tài liệu DB-07 là cơ sở để backend triển khai:

1. Migration database cho NOTI và DASH.
2. Entity/model/repository cho notification và dashboard widget.
3. Notification event service.
4. Notification template rendering service.
5. Notification delivery service.
6. Dashboard widget registry.
7. Dashboard config service.
8. Dashboard cache service.
9. API notification dropdown/header badge.
10. API dashboard theo vai trò.
11. Test case database và test case nghiệp vụ cho NOTI/DASH.

---

## 3. Phạm vi thiết kế

### 3.1 Bao gồm trong DB-07

DB-07 bao gồm các bảng chính sau:

| Nhóm | Bảng | Bắt buộc MVP | Vai trò |
| --- | --- | --- | --- |
| NOTI event | `notification_events` | Có | Danh mục event có thể tạo thông báo |
| NOTI template | `notification_templates` | Có | Template nội dung thông báo theo event/kênh/ngôn ngữ |
| NOTI message | `notifications` | Có | Bản ghi thông báo theo từng người nhận |
| NOTI delivery | `notification_delivery_logs` | Có | Log gửi thông báo qua từng kênh |
| NOTI preference | `notification_preferences` | Nên có / có thể phase sau | Cấu hình nhận thông báo cá nhân |
| DASH catalog | `dashboard_widgets` | Có | Danh mục widget hệ thống |
| DASH config | `dashboard_widget_configs` | Có | Cấu hình widget theo company/role/user/dashboard type |
| DASH cache | `dashboard_widget_cache` | Có | Cache dữ liệu widget nếu query nặng |
| DASH state | `dashboard_user_widget_states` | Phase sau | Trạng thái widget cá nhân: collapsed, custom layout |
| DASH event | `dashboard_cache_invalidations` | Nên có | Ghi nhận/invalidate cache dashboard theo event |

Trong MVP, tối thiểu cần triển khai 7 bảng lõi:

```text
notification_events
notification_templates
notifications
notification_delivery_logs
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
```

Các bảng `notification_preferences`, `dashboard_user_widget_states`, `dashboard_cache_invalidations` có thể tạo ngay ở mức cơ bản để giảm refactor về sau, hoặc đưa sang phase sau nếu muốn giảm phạm vi migration MVP.

---

### 3.2 Bảng dùng lại từ module khác

DB-07 không tạo lại các bảng sau, nhưng phụ thuộc trực tiếp vào chúng:

| Bảng | Module | Cách NOTI/DASH sử dụng |
| --- | --- | --- |
| `companies` | Foundation | Mỗi notification/config/cache thuộc một company/tenant |
| `users` | AUTH | Người nhận thông báo, người xem dashboard, người cấu hình widget |
| `roles` | AUTH | Cấu hình widget theo role |
| `permissions` | AUTH | Widget và API kiểm tra permission |
| `role_permissions` | AUTH | Xác định data scope khi lấy dữ liệu dashboard |
| `employees` | HR | Map user -> employee, xác định team/direct manager |
| `departments` | HR | Dashboard HR/Manager, data scope Department |
| `attendance_records` | ATT | Widget chấm công hôm nay, bất thường chấm công |
| `attendance_adjustment_requests` | ATT | Widget/yêu cầu cần duyệt và thông báo điều chỉnh công |
| `remote_work_requests` | ATT | Thông báo và dashboard remote/công tác nếu bật |
| `leave_requests` | LEAVE | Widget đơn nghỉ chờ duyệt, lịch nghỉ, thông báo nghỉ phép |
| `leave_balances` | LEAVE | Widget số ngày phép còn lại |
| `tasks` | TASK | Widget task của tôi, task quá hạn, task team |
| `projects` | TASK | Widget tiến độ dự án |
| `task_comments` / `task_comment_mentions` | TASK | Event comment/mention cho notification |
| `audit_logs` | Foundation | Ghi log cấu hình notification/dashboard |
| `modules` | Foundation | Module code source/target |
| `files` / `file_links` | Foundation | Không lưu file trong NOTI/DASH MVP, nhưng có thể dùng cho icon/custom assets phase sau |

---

### 3.3 Không đi sâu trong DB-07 nhưng cần chừa thiết kế

| Nhóm | Giai đoạn | Ghi chú thiết kế |
| --- | --- | --- |
| Realtime WebSocket | Phase sau | Có thể dùng `notifications` + pub/sub, không cần bảng riêng ở MVP |
| Mobile push | Phase sau | Cần bảng device token ở MOBILE hoặc AUTH extension |
| Email nâng cao | Phase sau | `notification_delivery_logs` đã chừa provider/status/retry |
| Digest hằng ngày/tuần | Phase sau | Có thể thêm `notification_digest_jobs` |
| Quiet hours / DND | Phase sau | Có thể mở rộng `notification_preferences` |
| Rule engine thông báo | Phase sau | Có thể thêm `notification_rules` |
| AI summary notification | Phase 5 | Có thể thêm bảng AI summary/log riêng |
| Dashboard BI nâng cao | Phase sau | Không lưu dữ liệu BI trong DASH MVP |
| Dashboard realtime | Phase sau | Cache invalidation + WebSocket event |
| Drag/drop widget cá nhân | Phase sau | Dùng `dashboard_user_widget_states` |
| Export dashboard PDF | Phase sau | Không lưu file PDF trong DASH, dùng job/export riêng |

---

## 4. Nguyên tắc thiết kế NOTI & DASH

### 4.1 PostgreSQL làm database chính

DB-07 tiếp tục dùng PostgreSQL vì hai module này cần:

1. Quan hệ chặt với user, role, permission, company và các module nghiệp vụ.
2. Index tốt cho notification unread count và danh sách mới nhất.
3. JSONB cho notification payload, template variable schema và dashboard widget data.
4. Transaction khi tạo notification theo event và ghi delivery log.
5. Khả năng cache dữ liệu dashboard có thời hạn.
6. Khả năng mở rộng multi-tenant/SaaS.

---

### 4.2 UUID làm primary key

Tất cả bảng DB-07 dùng:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
```

---

### 4.3 Multi-tenant bằng `company_id`

Các bảng dữ liệu vận hành bắt buộc có `company_id`:

```text
notifications
notification_delivery_logs
notification_preferences
dashboard_widget_configs
dashboard_widget_cache
dashboard_user_widget_states
dashboard_cache_invalidations
```

Các bảng danh mục có thể dùng `company_id` nullable để hỗ trợ global default và company override:

```text
notification_events
notification_templates
dashboard_widgets
```

Nguyên tắc:

1. `company_id = NULL` nghĩa là cấu hình global/system default.
2. `company_id NOT NULL` nghĩa là cấu hình riêng của công ty.
3. Khi truy vấn cấu hình, ưu tiên company-specific trước, sau đó fallback về global.
4. Mọi query dữ liệu vận hành phải filter theo `company_id` từ auth context.
5. Không tin `company_id` từ request body frontend.
6. Super Admin scope System mới được truy vấn nhiều công ty.

---

### 4.4 NOTI là event-driven, không xử lý nghiệp vụ gốc

Module nghiệp vụ như HR, ATT, LEAVE, TASK phát event nghiệp vụ. NOTI nhận event, xác định người nhận, render template và tạo thông báo.

Ví dụ:

```text
TASK cập nhật assignee
-> TASK phát event TASK_ASSIGNED
-> NOTI resolve recipient_user_id từ employee/user
-> NOTI render template
-> NOTI insert notifications
-> NOTI insert notification_delivery_logs nếu cần gửi qua kênh ngoài in-app
```

NOTI không được tự thay đổi task, đơn nghỉ, bảng công hoặc hồ sơ nhân viên.

---

### 4.5 Một dòng `notifications` tương ứng một người nhận

MVP đề xuất thiết kế:

```text
1 notification row = 1 recipient_user_id
```

Lý do:

1. Trạng thái đọc/chưa đọc là riêng từng user.
2. Ẩn/xóa/lưu trữ cũng là hành động riêng từng user.
3. Unread count query nhanh hơn.
4. Dễ phân quyền: user chỉ thấy notification của chính mình.
5. Dễ retry delivery theo người nhận và channel.

Nếu cần gửi thông báo hàng loạt, service sẽ tạo nhiều dòng `notifications` có chung `batch_key` hoặc `dedupe_key`.

---

### 4.6 Notification payload không chứa dữ liệu nhạy cảm quá mức

`notifications.payload` chỉ nên chứa dữ liệu phục vụ điều hướng và hiển thị ngắn gọn.

Không nên lưu trong payload:

```text
CCCD/CMND
số tài khoản ngân hàng
lương
lý do nghỉ nhạy cảm
GPS/IP chi tiết
hợp đồng đầy đủ
file private URL
```

Nên lưu:

```text
target_module
target_type
target_id
target_url
display_code
summary_fields không nhạy cảm
```

Khi user bấm notification, backend của module gốc phải kiểm tra permission trước khi trả dữ liệu chi tiết.

---

### 4.7 Cơ chế chống trùng thông báo

Một số event có thể phát lặp do retry job hoặc thao tác liên tục. DB-07 cần có `dedupe_key`.

Ví dụ:

```text
TASK_DUE_SOON:task_id:recipient_user_id:2026-06-20
LEAVE_PENDING_APPROVAL:leave_request_id:approver_user_id
ATT_MISSING_CHECKOUT:attendance_record_id:employee_user_id
```

MVP có thể enforce unique theo:

```text
company_id + recipient_user_id + event_code + dedupe_key
```

với điều kiện `dedupe_key IS NOT NULL`.

---

### 4.8 Delivery log tách khỏi notification

`notifications` là bản ghi thông báo nghiệp vụ theo user.

`notification_delivery_logs` là log gửi qua kênh:

```text
IN_APP
EMAIL
PUSH
REALTIME
INTEGRATION
```

Trong MVP, `IN_APP` là kênh chính. Email có thể chỉ ghi log nếu bật cấu hình cơ bản. Push/WebSocket/Slack/Teams để mở rộng sau.

---

### 4.9 DASH không lưu dữ liệu nghiệp vụ gốc

DASH chỉ lưu:

1. Danh mục widget.
2. Cấu hình widget theo company/role/user/dashboard type.
3. Cache dữ liệu tổng hợp ngắn hạn nếu cần.

DASH không copy bảng công, task, đơn nghỉ hoặc hồ sơ nhân viên thành dữ liệu gốc. Khi cache hết hạn hoặc invalidated, DASH gọi service module nguồn để tính lại.

---

### 4.10 Widget phải kiểm tra permission và data scope

Mỗi widget có:

1. `required_permission_code`
2. `default_data_scope`
3. `data_source_key`
4. `config`
5. `cache_scope`

Khi user mở dashboard, backend phải:

1. Xác định role và permission từ AUTH.
2. Xác định employee hiện tại từ HR.
3. Xác định data scope hợp lệ.
4. Chỉ trả widget user được xem.
5. Chỉ lấy dữ liệu trong phạm vi user được phép.
6. Không trả dữ liệu nhạy cảm nếu thiếu quyền.

---

### 4.11 Cache dashboard phải có TTL và invalidation

Dashboard có thể cache các widget query nặng như:

```text
HR_OVERVIEW
ATTENDANCE_ALERTS
PENDING_LEAVE
PROJECT_PROGRESS
NOTIFICATION_UNREAD_COUNT
```

Mỗi cache cần có:

1. `cache_key`
2. `cache_scope`
3. `scope_reference_id`
4. `generated_at`
5. `expires_at`
6. `status`
7. `data_hash`

Cache có thể bị invalidate khi có event:

```text
EMPLOYEE_CREATED
ATTENDANCE_UPDATED
LEAVE_REQUEST_APPROVED
TASK_STATUS_CHANGED
NOTIFICATION_CREATED
```

---

### 4.12 Soft delete và audit log

Không xóa cứng:

```text
notifications
notification_events
notification_templates
notification_preferences
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
```

Dùng:

```text
deleted_at
deleted_by
```

Các thao tác sau phải ghi `audit_logs`:

1. Tạo/sửa/tắt notification event.
2. Tạo/sửa template notification.
3. Tạo thông báo hệ thống thủ công.
4. Cấu hình kênh thông báo.
5. Cấu hình dashboard widget theo role/company/user.
6. Vô hiệu hóa widget.
7. Xóa mềm notification nếu là thao tác quản trị.
8. Xem/export notification log nếu có quyền cao.
9. Xóa/invalidate dashboard cache thủ công.

---

## 5. ERD cấp module NOTI & DASH

### 5.1 ERD dạng text

```text
companies
  1 --- n notifications
  1 --- n notification_delivery_logs
  1 --- n notification_preferences
  1 --- n dashboard_widget_configs
  1 --- n dashboard_widget_cache
  1 --- n dashboard_cache_invalidations

users
  1 --- n notifications                          qua recipient_user_id
  1 --- n notifications.created_by/updated_by
  1 --- n notification_delivery_logs              qua recipient_user_id
  1 --- n notification_preferences
  1 --- n dashboard_widget_configs                nếu config theo user
  1 --- n dashboard_widget_cache                  nếu cache theo user

employees
  1 --- n notifications                           qua recipient_employee_id nullable
  1 --- n dashboard_widget_cache                  qua scope_reference_id logic nếu scope = Employee/Own

roles
  1 --- n dashboard_widget_configs                nếu config theo role
  1 --- n dashboard_widget_cache                  nếu cache theo role

notification_events
  1 --- n notification_templates
  1 --- n notifications

notification_templates
  1 --- n notifications

notifications
  1 --- n notification_delivery_logs

dashboard_widgets
  1 --- n dashboard_widget_configs
  1 --- n dashboard_widget_cache

permissions
  1 --- n dashboard_widgets                       logic qua required_permission_code
```

---

### 5.2 Quan hệ chính

| Quan hệ | Loại | Ghi chú |
| --- | --- | --- |
| `companies.id` -> `notifications.company_id` | 1-n | Notification thuộc một company |
| `users.id` -> `notifications.recipient_user_id` | 1-n | User nhận nhiều notification |
| `employees.id` -> `notifications.recipient_employee_id` | 1-n nullable | Snapshot/lookup employee người nhận |
| `notification_events.id` -> `notifications.event_id` | 1-n | Notification được tạo từ event |
| `notification_templates.id` -> `notifications.template_id` | 1-n | Notification dùng template nào |
| `notifications.id` -> `notification_delivery_logs.notification_id` | 1-n | Một notification có nhiều log gửi |
| `notification_events.id` -> `notification_templates.event_id` | 1-n | Một event có nhiều template theo channel/locale |
| `dashboard_widgets.id` -> `dashboard_widget_configs.widget_id` | 1-n | Widget có nhiều cấu hình hiển thị |
| `dashboard_widgets.id` -> `dashboard_widget_cache.widget_id` | 1-n | Widget có nhiều cache theo scope/user |
| `roles.id` -> `dashboard_widget_configs.role_id` | 1-n nullable | Cấu hình theo role |
| `users.id` -> `dashboard_widget_configs.user_id` | 1-n nullable | Cấu hình riêng theo user |

---

## 6. Danh sách bảng DB-07

| STT | Bảng | Bắt buộc MVP | Mô tả |
| --- | --- | --- | --- |
| 1 | `notification_events` | Có | Danh mục event thông báo |
| 2 | `notification_templates` | Có | Template thông báo |
| 3 | `notifications` | Có | Thông báo theo từng người nhận |
| 4 | `notification_delivery_logs` | Có | Log gửi thông báo qua kênh |
| 5 | `notification_preferences` | Nên có / phase sau | Cấu hình nhận thông báo của user |
| 6 | `dashboard_widgets` | Có | Danh mục widget dashboard |
| 7 | `dashboard_widget_configs` | Có | Cấu hình widget theo role/user/company |
| 8 | `dashboard_widget_cache` | Có | Cache dữ liệu widget |
| 9 | `dashboard_user_widget_states` | Phase sau | Layout/trạng thái widget cá nhân |
| 10 | `dashboard_cache_invalidations` | Nên có | Log invalidate cache dashboard |

---

## 7. Thiết kế chi tiết bảng NOTI

### 7.1 Bảng `notification_events`

#### Mục đích

Lưu danh mục các event hệ thống có thể tạo thông báo.

Event có thể đến từ:

1. AUTH: tạo user, khóa user, reset mật khẩu.
2. HR: tạo hồ sơ, cập nhật hồ sơ, yêu cầu đổi hồ sơ, hợp đồng sắp hết hạn.
3. ATT: quên check-out, đi muộn, vắng mặt, gửi/duyệt/từ chối điều chỉnh công.
4. LEAVE: gửi/duyệt/từ chối/hủy đơn nghỉ.
5. TASK: giao task, đổi deadline, comment, mention, task quá hạn.
6. DASH/SYSTEM: cảnh báo cấu hình, lỗi hệ thống.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = global event, có giá trị = override theo company |
| `module_code` | VARCHAR(50) | Có | AUTH/HR/ATT/LEAVE/TASK/DASH/SYSTEM |
| `event_code` | VARCHAR(100) | Có | TASK_ASSIGNED, LEAVE_REQUEST_APPROVED |
| `event_name` | VARCHAR(255) | Có | Tên hiển thị |
| `description` | TEXT | Không | Mô tả event |
| `notification_type` | VARCHAR(50) | Có | System/Account/HR/Attendance/Leave/Task/Project/Approval/Reminder/Warning/Error |
| `default_priority` | VARCHAR(50) | Có | Low/Normal/High/Urgent/Critical |
| `default_channels` | JSONB | Có | Danh sách kênh mặc định, ví dụ `["IN_APP"]` |
| `recipient_rule_config` | JSONB | Không | Rule xác định người nhận |
| `dedupe_strategy` | VARCHAR(50) | Có | None/DedupeKey/TimeWindow/EntityRecipient |
| `dedupe_window_seconds` | INT | Không | Cửa sổ chống trùng nếu dùng TimeWindow |
| `throttle_config` | JSONB | Không | Giới hạn spam notification |
| `is_enabled` | BOOLEAN | Có | Event có đang bật không |
| `is_system_event` | BOOLEAN | Có | Event hệ thống không cho xóa |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE notification_events
ADD CONSTRAINT chk_notification_events_module_code
CHECK (module_code IN ('AUTH', 'HR', 'ATT', 'LEAVE', 'TASK', 'DASH', 'NOTI', 'SYSTEM'));

ALTER TABLE notification_events
ADD CONSTRAINT chk_notification_events_type
CHECK (notification_type IN ('System', 'Account', 'HR', 'Attendance', 'Leave', 'Task', 'Project', 'Approval', 'Reminder', 'Warning', 'Error'));

ALTER TABLE notification_events
ADD CONSTRAINT chk_notification_events_priority
CHECK (default_priority IN ('Low', 'Normal', 'High', 'Urgent', 'Critical'));

ALTER TABLE notification_events
ADD CONSTRAINT chk_notification_events_dedupe_strategy
CHECK (dedupe_strategy IN ('None', 'DedupeKey', 'TimeWindow', 'EntityRecipient'));

CREATE UNIQUE INDEX uq_notification_events_global_code_active
ON notification_events (event_code)
WHERE company_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notification_events_company_code_active
ON notification_events (company_id, event_code)
WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notification_events_module
ON notification_events (module_code, is_enabled)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_events_company_module
ON notification_events (company_id, module_code, is_enabled)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. `event_code` phải unique trong phạm vi global hoặc company.
2. Nếu company có event override cùng `event_code`, service ưu tiên bản company.
3. Event bị `is_enabled = false` thì không tạo notification mới.
4. Không xóa cứng event đã từng tạo notification.
5. `default_channels` trong MVP nên tối thiểu có `IN_APP`.
6. `recipient_rule_config` chỉ là cấu hình hỗ trợ; service module nguồn vẫn có thể truyền trực tiếp danh sách recipient.
7. Event hệ thống (`is_system_event = true`) không cho xóa mềm nếu không có quyền Super Admin.

#### Ví dụ `recipient_rule_config`

```json
{
  "strategy": "DIRECT_MANAGER",
  "fallback_roles": ["HR"],
  "recipient_source": "employee_id",
  "scope": "Team"
}
```

#### Ví dụ seed event

| Event code | Module | Type | Priority | Ý nghĩa |
| --- | --- | --- | --- | --- |
| `AUTH_USER_CREATED` | AUTH | Account | Normal | Tài khoản được tạo |
| `HR_PROFILE_CHANGE_SUBMITTED` | HR | HR | High | Employee gửi yêu cầu cập nhật hồ sơ |
| `ATT_MISSING_CHECKOUT` | ATT | Attendance | High | Nhân viên thiếu check-out |
| `ATT_ADJUSTMENT_SUBMITTED` | ATT | Approval | High | Có yêu cầu điều chỉnh công |
| `LEAVE_REQUEST_SUBMITTED` | LEAVE | Approval | High | Có đơn nghỉ cần duyệt |
| `LEAVE_REQUEST_APPROVED` | LEAVE | Leave | Normal | Đơn nghỉ được duyệt |
| `TASK_ASSIGNED` | TASK | Task | Normal | User được giao task |
| `TASK_MENTIONED` | TASK | Task | High | User được mention trong comment |
| `TASK_DUE_SOON` | TASK | Reminder | Normal | Task sắp đến hạn |
| `TASK_OVERDUE` | TASK | Warning | High | Task quá hạn |

---

### 7.2 Bảng `notification_templates`

#### Mục đích

Lưu template tiêu đề/nội dung thông báo theo event, channel và ngôn ngữ.

Một event có thể có nhiều template:

```text
LEAVE_REQUEST_SUBMITTED + IN_APP + vi-VN
LEAVE_REQUEST_SUBMITTED + EMAIL + vi-VN
TASK_ASSIGNED + IN_APP + vi-VN
TASK_ASSIGNED + PUSH + vi-VN
```

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = global template, có giá trị = company override |
| `event_id` | UUID | Có | FK `notification_events.id` |
| `template_code` | VARCHAR(100) | Có | Ví dụ `TASK_ASSIGNED_IN_APP_VI` |
| `channel` | VARCHAR(50) | Có | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `locale` | VARCHAR(20) | Có | `vi-VN`, `en-US` |
| `title_template` | VARCHAR(255) | Có | Template tiêu đề |
| `body_template` | TEXT | Có | Template nội dung |
| `short_body_template` | VARCHAR(500) | Không | Nội dung rút gọn cho dropdown/push |
| `action_label_template` | VARCHAR(100) | Không | Label nút hành động |
| `target_url_template` | VARCHAR(500) | Không | URL điều hướng dạng template |
| `variables_schema` | JSONB | Không | Danh sách biến cho template |
| `sample_payload` | JSONB | Không | Payload mẫu để preview |
| `version` | INT | Có | Version template |
| `status` | VARCHAR(50) | Có | Draft/Active/Inactive/Archived |
| `is_default` | BOOLEAN | Có | Template mặc định cho event/channel/locale |
| `effective_from` | TIMESTAMP | Không | Thời điểm bắt đầu hiệu lực |
| `effective_to` | TIMESTAMP | Không | Thời điểm hết hiệu lực |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE notification_templates
ADD CONSTRAINT chk_notification_templates_channel
CHECK (channel IN ('IN_APP', 'EMAIL', 'PUSH', 'REALTIME', 'INTEGRATION'));

ALTER TABLE notification_templates
ADD CONSTRAINT chk_notification_templates_status
CHECK (status IN ('Draft', 'Active', 'Inactive', 'Archived'));

ALTER TABLE notification_templates
ADD CONSTRAINT chk_notification_templates_effective_range
CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);

CREATE UNIQUE INDEX uq_notification_templates_global_code_active
ON notification_templates (template_code)
WHERE company_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notification_templates_company_code_active
ON notification_templates (company_id, template_code)
WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notification_templates_event_channel_locale
ON notification_templates (event_id, channel, locale, status)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_templates_company_event
ON notification_templates (company_id, event_id, channel, locale, status)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Mỗi event/channel/locale nên có một template `Active + is_default = true`.
2. Company template override global template nếu cùng event/channel/locale.
3. Template đang được dùng bởi notification cũ không được xóa cứng.
4. Khi sửa template active, nên tăng `version` hoặc tạo bản mới để dễ rollback.
5. Service phải validate biến trong payload có đủ theo `variables_schema`.
6. Không đưa dữ liệu nhạy cảm vào title/body nếu người nhận có thể không có quyền xem chi tiết.
7. URL điều hướng không chứa thông tin nhạy cảm, chỉ chứa ID hoặc route an toàn.

#### Ví dụ `variables_schema`

```json
{
  "required": ["employee_name", "leave_request_code", "start_date", "end_date"],
  "optional": ["reason_summary"],
  "sensitive": ["reason_summary"]
}
```

---

### 7.3 Bảng `notifications`

#### Mục đích

Lưu thông báo gửi đến từng user cụ thể.

Một dòng `notifications` là một thông báo của một người nhận. Đây là bảng chính phục vụ:

1. Notification dropdown.
2. Header unread badge.
3. Danh sách thông báo.
4. Đánh dấu đã đọc.
5. Ẩn/xóa/lưu trữ notification.
6. Dashboard widget thông báo mới.
7. Truy vết thông báo đã tạo từ event nào.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `recipient_user_id` | UUID | Có | FK `users.id` |
| `recipient_employee_id` | UUID | Không | FK `employees.id`, snapshot nếu user có employee |
| `event_id` | UUID | Không | FK `notification_events.id` |
| `template_id` | UUID | Không | FK `notification_templates.id` |
| `module_code` | VARCHAR(50) | Có | Module nguồn |
| `event_code` | VARCHAR(100) | Có | Event nguồn |
| `notification_type` | VARCHAR(50) | Có | System/Task/Leave/... |
| `priority` | VARCHAR(50) | Có | Low/Normal/High/Urgent/Critical |
| `status` | VARCHAR(50) | Có | Unread/Read/Hidden/Archived/Deleted/Failed |
| `title` | VARCHAR(255) | Có | Tiêu đề đã render |
| `body` | TEXT | Không | Nội dung đã render |
| `short_body` | VARCHAR(500) | Không | Nội dung ngắn |
| `source_entity_type` | VARCHAR(100) | Không | Task/LeaveRequest/AttendanceRecord/... |
| `source_entity_id` | UUID | Không | ID entity nguồn |
| `source_entity_code` | VARCHAR(100) | Không | Mã nghiệp vụ nếu có |
| `target_module` | VARCHAR(50) | Không | Module mở khi click |
| `target_type` | VARCHAR(100) | Không | Loại màn hình/entity target |
| `target_id` | UUID | Không | ID target |
| `target_url` | VARCHAR(500) | Không | URL nội bộ |
| `payload` | JSONB | Không | Payload điều hướng/hiển thị ngắn |
| `dedupe_key` | VARCHAR(255) | Không | Khóa chống trùng |
| `batch_key` | VARCHAR(255) | Không | Nhóm notification hàng loạt |
| `correlation_id` | VARCHAR(100) | Không | Trace id giữa modules/jobs |
| `scheduled_at` | TIMESTAMP | Không | Nếu tạo trước và hiển thị/gửi sau |
| `sent_at` | TIMESTAMP | Không | Thời điểm notification được xem là đã gửi in-app |
| `read_at` | TIMESTAMP | Không | Thời điểm user đọc |
| `hidden_at` | TIMESTAMP | Không | Thời điểm user ẩn |
| `archived_at` | TIMESTAMP | Không | Thời điểm user lưu trữ |
| `expires_at` | TIMESTAMP | Không | Hết hạn hiển thị nếu có |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id`, null nếu system/job |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE notifications
ADD CONSTRAINT chk_notifications_module_code
CHECK (module_code IN ('AUTH', 'HR', 'ATT', 'LEAVE', 'TASK', 'DASH', 'NOTI', 'SYSTEM'));

ALTER TABLE notifications
ADD CONSTRAINT chk_notifications_type
CHECK (notification_type IN ('System', 'Account', 'HR', 'Attendance', 'Leave', 'Task', 'Project', 'Approval', 'Reminder', 'Warning', 'Error'));

ALTER TABLE notifications
ADD CONSTRAINT chk_notifications_priority
CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent', 'Critical'));

ALTER TABLE notifications
ADD CONSTRAINT chk_notifications_status
CHECK (status IN ('Unread', 'Read', 'Hidden', 'Archived', 'Deleted', 'Failed'));

CREATE INDEX idx_notifications_recipient_status_created
ON notifications (company_id, recipient_user_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_recipient_read
ON notifications (company_id, recipient_user_id, read_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_recipient_created
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_module_event
ON notifications (company_id, module_code, event_code, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_source_entity
ON notifications (company_id, source_entity_type, source_entity_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_batch_key
ON notifications (company_id, batch_key)
WHERE batch_key IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notifications_dedupe_active
ON notifications (company_id, recipient_user_id, event_code, dedupe_key)
WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. User chỉ được xem notification có `recipient_user_id = current_user_id`, trừ quyền quản trị đặc biệt.
2. Đếm unread dùng `status = 'Unread'` và `deleted_at IS NULL`.
3. Khi đánh dấu đã đọc:
   - `status = 'Read'`
   - `read_at = now()`
   - `updated_by = current_user_id`
4. Khi user ẩn notification:
   - `status = 'Hidden'`
   - `hidden_at = now()`
5. Khi user xóa notification khỏi danh sách cá nhân:
   - `status = 'Deleted'`
   - `deleted_at = now()`
   - Không xóa cứng.
6. `payload` không chứa dữ liệu nhạy cảm quá mức.
7. `target_url` chỉ là route nội bộ, không phải public file URL.
8. Khi truy cập target, module gốc phải kiểm tra permission.
9. `dedupe_key` nên được service tạo nhất quán để tránh spam.
10. `expires_at` dùng cho thông báo reminder/cảnh báo hết hiệu lực.

#### Ví dụ payload an toàn

```json
{
  "target_module": "TASK",
  "target_type": "Task",
  "target_id": "uuid",
  "task_code": "TASK-000123",
  "project_code": "PRJ-0005",
  "display_title": "Thiết kế màn hình chấm công"
}
```

---

### 7.4 Bảng `notification_delivery_logs`

#### Mục đích

Lưu lịch sử gửi notification qua từng kênh.

Trong MVP, `IN_APP` có thể được xem là đã gửi khi insert notification thành công. Tuy nhiên vẫn nên ghi delivery log để:

1. Truy vết notification đã được gửi qua kênh nào.
2. Chuẩn bị cho email/push/realtime sau này.
3. Theo dõi trạng thái gửi thất bại/thành công.
4. Retry nếu kênh ngoài thất bại.
5. Phân tích lỗi gửi notification.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `notification_id` | UUID | Có | FK `notifications.id` |
| `recipient_user_id` | UUID | Có | FK `users.id` |
| `channel` | VARCHAR(50) | Có | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `provider` | VARCHAR(100) | Không | internal/smtp/fcm/apns/sendgrid/slack |
| `delivery_status` | VARCHAR(50) | Có | Pending/Sent/Delivered/Failed/Skipped/Cancelled |
| `attempt_no` | INT | Có | Số lần thử |
| `max_attempts` | INT | Có | Số lần thử tối đa |
| `request_payload` | JSONB | Không | Payload gửi provider, tránh nhạy cảm |
| `response_payload` | JSONB | Không | Response provider |
| `external_message_id` | VARCHAR(255) | Không | ID từ provider |
| `error_code` | VARCHAR(100) | Không | Mã lỗi nếu có |
| `error_message` | TEXT | Không | Nội dung lỗi |
| `scheduled_at` | TIMESTAMP | Không | Lên lịch gửi |
| `sent_at` | TIMESTAMP | Không | Đã gửi |
| `delivered_at` | TIMESTAMP | Không | Provider xác nhận delivered |
| `failed_at` | TIMESTAMP | Không | Thất bại |
| `next_retry_at` | TIMESTAMP | Không | Lần retry tiếp theo |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Constraint/index đề xuất

```sql
ALTER TABLE notification_delivery_logs
ADD CONSTRAINT chk_notification_delivery_logs_channel
CHECK (channel IN ('IN_APP', 'EMAIL', 'PUSH', 'REALTIME', 'INTEGRATION'));

ALTER TABLE notification_delivery_logs
ADD CONSTRAINT chk_notification_delivery_logs_status
CHECK (delivery_status IN ('Pending', 'Sent', 'Delivered', 'Failed', 'Skipped', 'Cancelled'));

ALTER TABLE notification_delivery_logs
ADD CONSTRAINT chk_notification_delivery_logs_attempt
CHECK (attempt_no >= 1 AND max_attempts >= attempt_no);

CREATE INDEX idx_notification_delivery_logs_notification
ON notification_delivery_logs (notification_id, channel);

CREATE INDEX idx_notification_delivery_logs_company_status_retry
ON notification_delivery_logs (company_id, delivery_status, next_retry_at);

CREATE INDEX idx_notification_delivery_logs_recipient_created
ON notification_delivery_logs (company_id, recipient_user_id, created_at DESC);

CREATE INDEX idx_notification_delivery_logs_channel_status
ON notification_delivery_logs (company_id, channel, delivery_status, created_at DESC);
```

#### Quy tắc nghiệp vụ

1. Khi tạo notification in-app, có thể tạo delivery log `channel = IN_APP`, `delivery_status = Sent`.
2. Với EMAIL/PUSH/INTEGRATION, ban đầu tạo `Pending`, job gửi sau.
3. Retry chỉ áp dụng cho kênh ngoài, không cần retry IN_APP nếu insert notification đã thành công.
4. Không lưu full email body nhạy cảm nếu không cần.
5. Không xóa cứng delivery log.
6. Nếu provider trả lỗi tạm thời, set `next_retry_at`.
7. Nếu vượt `max_attempts`, set `delivery_status = Failed`.

---

### 7.5 Bảng `notification_preferences`

#### Mục đích

Lưu cấu hình nhận thông báo theo user.

Bảng này có thể chưa cần UI đầy đủ trong MVP, nhưng nên thiết kế để mở rộng:

1. User bật/tắt một số loại thông báo.
2. User chọn kênh nhận thông báo.
3. User cấu hình quiet hours.
4. User nhận digest thay vì từng notification.
5. Company/Admin cấu hình mặc định.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `event_id` | UUID | Không | FK `notification_events.id`; null = áp dụng theo module/type |
| `module_code` | VARCHAR(50) | Không | AUTH/HR/ATT/LEAVE/TASK/DASH/SYSTEM |
| `notification_type` | VARCHAR(50) | Không | Nhóm thông báo |
| `channel` | VARCHAR(50) | Có | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `is_enabled` | BOOLEAN | Có | Có nhận kênh này không |
| `digest_frequency` | VARCHAR(50) | Không | Immediate/Daily/Weekly/Never |
| `quiet_hours_start` | TIME | Không | Bắt đầu không làm phiền |
| `quiet_hours_end` | TIME | Không | Kết thúc không làm phiền |
| `timezone` | VARCHAR(100) | Không | Timezone user |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE notification_preferences
ADD CONSTRAINT chk_notification_preferences_channel
CHECK (channel IN ('IN_APP', 'EMAIL', 'PUSH', 'REALTIME', 'INTEGRATION'));

ALTER TABLE notification_preferences
ADD CONSTRAINT chk_notification_preferences_digest
CHECK (digest_frequency IS NULL OR digest_frequency IN ('Immediate', 'Daily', 'Weekly', 'Never'));

CREATE UNIQUE INDEX uq_notification_preferences_user_event_channel
ON notification_preferences (company_id, user_id, event_id, channel)
WHERE event_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notification_preferences_user_module
ON notification_preferences (company_id, user_id, module_code, notification_type)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_preferences_event
ON notification_preferences (company_id, event_id, channel)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Trong MVP, nếu chưa có preference thì dùng default từ `notification_events.default_channels`.
2. Không nên cho user tắt các notification bắt buộc như bảo mật, tài khoản, cảnh báo critical nếu công ty không cho phép.
3. `IN_APP` nên bật mặc định cho các event nghiệp vụ quan trọng.
4. Quiet hours không áp dụng cho `Critical` nếu cấu hình bắt buộc.
5. Preference cá nhân không được vượt qua policy công ty nếu sau này có `notification_rules/company_settings`.

---

## 8. Thiết kế chi tiết bảng DASH

### 8.1 Bảng `dashboard_widgets`

#### Mục đích

Lưu danh mục widget dashboard mà hệ thống hỗ trợ.

Ví dụ widget MVP:

1. Chấm công hôm nay.
2. Task của tôi.
3. Task quá hạn/sắp đến hạn.
4. Số ngày phép còn lại.
5. Đơn nghỉ chờ duyệt.
6. Lịch nghỉ team/công ty.
7. Thông báo mới.
8. Tổng quan nhân sự.
9. Nhân sự mới.
10. Hợp đồng sắp hết hạn.
11. Bất thường chấm công.
12. Tiến độ dự án.
13. Cảnh báo cấu hình hệ thống.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Không | NULL = widget global; có giá trị = custom widget company phase sau |
| `widget_code` | VARCHAR(100) | Có | Dạng ngắn `UPPER_SNAKE`, không prefix `DASH_WIDGET_`. Ví dụ `ATTENDANCE_TODAY`, `MY_TASKS` |
| `module_code` | VARCHAR(50) | Có | Module nguồn dữ liệu: HR/ATT/LEAVE/TASK/NOTI/AUTH/SYSTEM |
| `name` | VARCHAR(255) | Có | Tên widget |
| `description` | TEXT | Không | Mô tả |
| `widget_type` | VARCHAR(50) | Có | Summary/List/Chart/Calendar/Action/Alert |
| `required_permission_code` | VARCHAR(150) | Có | Permission cần có |
| `default_data_scope` | VARCHAR(50) | Có | Own/Team/Department/Project/Company/System |
| `data_source_key` | VARCHAR(150) | Có | Key service backend lấy data |
| `component_key` | VARCHAR(150) | Có | Key component frontend render |
| `default_refresh_seconds` | INT | Không | TTL mặc định |
| `is_cacheable` | BOOLEAN | Có | Widget có được cache không |
| `default_width` | INT | Không | Width layout mặc định |
| `default_height` | INT | Không | Height layout mặc định |
| `default_config` | JSONB | Không | Config mặc định |
| `empty_state_config` | JSONB | Không | Nội dung empty state |
| `action_config` | JSONB | Không | Điều hướng/action nhanh |
| `status` | VARCHAR(50) | Có | Active/Inactive/Deprecated |
| `is_system_widget` | BOOLEAN | Có | Widget hệ thống không cho xóa |
| `sort_order` | INT | Không | Thứ tự mặc định |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE dashboard_widgets
ADD CONSTRAINT chk_dashboard_widgets_module_code
CHECK (module_code IN ('AUTH', 'HR', 'ATT', 'LEAVE', 'TASK', 'DASH', 'NOTI', 'SYSTEM'));

ALTER TABLE dashboard_widgets
ADD CONSTRAINT chk_dashboard_widgets_type
CHECK (widget_type IN ('Summary', 'List', 'Chart', 'Calendar', 'Action', 'Alert'));

ALTER TABLE dashboard_widgets
ADD CONSTRAINT chk_dashboard_widgets_scope
CHECK (default_data_scope IN ('Own', 'Team', 'Department', 'Project', 'Company', 'System'));

ALTER TABLE dashboard_widgets
ADD CONSTRAINT chk_dashboard_widgets_status
CHECK (status IN ('Active', 'Inactive', 'Deprecated'));

CREATE UNIQUE INDEX uq_dashboard_widgets_global_code_active
ON dashboard_widgets (widget_code)
WHERE company_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_dashboard_widgets_company_code_active
ON dashboard_widgets (company_id, widget_code)
WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widgets_module_status
ON dashboard_widgets (module_code, status, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widgets_permission
ON dashboard_widgets (required_permission_code)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Widget `status = Inactive` không hiển thị cho user mới.
2. Widget `Deprecated` chỉ giữ để không lỗi config cũ.
3. Backend phải kiểm tra `required_permission_code` trước khi trả widget.
4. `data_source_key` phải map với service backend được đăng ký.
5. `component_key` phải map với component frontend.
6. Widget hệ thống không được xóa mềm nếu chưa tắt toàn bộ config liên quan.
7. `default_config` không được chứa dữ liệu user cụ thể.

#### Seed widget MVP đề xuất

| Widget code | Module | Permission | Scope | Cache |
| --- | --- | --- | --- | --- |
| `ATTENDANCE_TODAY` | ATT | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Own | Không/TTL ngắn |
| `MY_TASKS` | TASK | `DASH.WIDGET.VIEW_MY_TASKS` | Own | Có |
| `TASK_ALERTS` | TASK | `DASH.WIDGET.VIEW_TASK_ALERTS` | Own/Team | Có |
| `LEAVE_BALANCE` | LEAVE | `DASH.WIDGET.VIEW_LEAVE_BALANCE` | Own | Có |
| `PENDING_LEAVE` | LEAVE | `DASH.WIDGET.VIEW_PENDING_LEAVE` | Team/Company | Có |
| `LEAVE_CALENDAR` | LEAVE | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | Team/Company | Có |
| `NOTIFICATIONS` | NOTI | `DASH.WIDGET.VIEW_NOTIFICATIONS` | Own | Có/TTL rất ngắn |
| `HR_OVERVIEW` | HR | `DASH.WIDGET.VIEW_HR_OVERVIEW` | Company | Có |
| `NEW_EMPLOYEES` | HR | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | Company | Có |
| `CONTRACT_EXPIRING` | HR | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | Company | Có |
| `ATTENDANCE_ALERTS` | ATT | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | Team/Company | Có |
| `PROJECT_PROGRESS` | TASK | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Project/Company | Có |

---

### 8.2 Bảng `dashboard_widget_configs`

#### Mục đích

Lưu cấu hình hiển thị widget theo:

1. Company.
2. Dashboard type.
3. Role.
4. User.
5. Thứ tự hiển thị.
6. Bật/tắt widget.
7. Config override theo từng đối tượng.

Cấu hình này giúp hệ thống có thể hiển thị dashboard khác nhau cho Employee, Manager, HR và Admin.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `widget_id` | UUID | Có | FK `dashboard_widgets.id` |
| `dashboard_type` | VARCHAR(50) | Có | Employee/Manager/HR/Admin/System/Project |
| `role_id` | UUID | Không | FK `roles.id`, nếu config theo role |
| `user_id` | UUID | Không | FK `users.id`, nếu config riêng user |
| `config_scope` | VARCHAR(50) | Có | Company/Role/User |
| `is_enabled` | BOOLEAN | Có | Widget có bật không |
| `sort_order` | INT | Có | Thứ tự hiển thị |
| `layout_x` | INT | Không | Vị trí layout phase sau |
| `layout_y` | INT | Không | Vị trí layout phase sau |
| `layout_width` | INT | Không | Width override |
| `layout_height` | INT | Không | Height override |
| `data_scope_override` | VARCHAR(50) | Không | Own/Team/Department/Project/Company/System |
| `refresh_seconds_override` | INT | Không | TTL override |
| `config` | JSONB | Không | Config mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `created_by` | UUID | Không | FK `users.id` |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `updated_by` | UUID | Không | FK `users.id` |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE dashboard_widget_configs
ADD CONSTRAINT chk_dashboard_widget_configs_dashboard_type
CHECK (dashboard_type IN ('Employee', 'Manager', 'HR', 'Admin', 'System', 'Project'));

ALTER TABLE dashboard_widget_configs
ADD CONSTRAINT chk_dashboard_widget_configs_scope
CHECK (config_scope IN ('Company', 'Role', 'User'));

ALTER TABLE dashboard_widget_configs
ADD CONSTRAINT chk_dashboard_widget_configs_data_scope_override
CHECK (
  data_scope_override IS NULL
  OR data_scope_override IN ('Own', 'Team', 'Department', 'Project', 'Company', 'System')
);

ALTER TABLE dashboard_widget_configs
ADD CONSTRAINT chk_dashboard_widget_configs_role_user_scope
CHECK (
  (config_scope = 'Company' AND role_id IS NULL AND user_id IS NULL)
  OR (config_scope = 'Role' AND role_id IS NOT NULL AND user_id IS NULL)
  OR (config_scope = 'User' AND user_id IS NOT NULL)
);

CREATE INDEX idx_dashboard_widget_configs_company_dashboard
ON dashboard_widget_configs (company_id, dashboard_type, is_enabled, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_configs_role
ON dashboard_widget_configs (company_id, role_id, dashboard_type, is_enabled)
WHERE role_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_configs_user
ON dashboard_widget_configs (company_id, user_id, dashboard_type, is_enabled)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_configs_widget
ON dashboard_widget_configs (company_id, widget_id)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Cấu hình ưu tiên theo thứ tự:

```text
User config
-> Role config
-> Company config
-> Default widget
```

1. Nếu user có nhiều role, service xác định dashboard type theo role ưu tiên hoặc cho user chọn dashboard.
2. `data_scope_override` không được vượt quá scope user thật sự có trong AUTH.
3. Nếu `is_enabled = false`, widget không hiển thị dù user có permission.
4. Chỉ Admin/Super Admin hoặc role có `DASH.CONFIG.UPDATE` mới được sửa config.
5. Mọi cập nhật config phải ghi audit log.
6. Config không được chứa dữ liệu nghiệp vụ cụ thể; chỉ chứa tùy chọn hiển thị/filter.

#### Ví dụ config

```json
{
  "limit": 5,
  "show_action_button": true,
  "date_range": "current_month",
  "display_mode": "compact"
}
```

---

### 8.3 Bảng `dashboard_widget_cache`

#### Mục đích

Lưu cache dữ liệu widget để tránh query nặng.

Ví dụ cache:

1. HR overview toàn công ty.
2. Số task quá hạn của team.
3. Danh sách đơn nghỉ pending của manager.
4. Lịch nghỉ team trong tháng.
5. Tiến độ dự án.
6. Bất thường chấm công toàn công ty.

#### Cấu trúc cột

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `widget_id` | UUID | Có | FK `dashboard_widgets.id` |
| `dashboard_type` | VARCHAR(50) | Có | Employee/Manager/HR/Admin/System/Project |
| `user_id` | UUID | Không | Cache riêng user nếu scope Own/User |
| `role_id` | UUID | Không | Cache theo role nếu cần |
| `cache_scope` | VARCHAR(50) | Có | Own/Team/Department/Project/Company/System |
| `scope_reference_id` | UUID | Không | employee_id/department_id/project_id/company_id tùy scope |
| `cache_key` | VARCHAR(255) | Có | Khóa cache duy nhất |
| `data` | JSONB | Có | Dữ liệu widget đã tổng hợp |
| `data_hash` | VARCHAR(255) | Không | Hash để kiểm tra thay đổi |
| `status` | VARCHAR(50) | Có | Fresh/Stale/Expired/Error |
| `generated_at` | TIMESTAMP | Có | Thời điểm tạo cache |
| `expires_at` | TIMESTAMP | Có | Thời điểm hết hạn |
| `last_accessed_at` | TIMESTAMP | Không | Lần dùng gần nhất |
| `error_message` | TEXT | Không | Nếu status Error |
| `source_version` | VARCHAR(100) | Không | Version data/query nếu cần |
| `metadata` | JSONB | Không | Dữ liệu mở rộng |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |
| `deleted_at` | TIMESTAMP | Không | Soft delete |
| `deleted_by` | UUID | Không | FK `users.id` |

#### Constraint/index đề xuất

```sql
ALTER TABLE dashboard_widget_cache
ADD CONSTRAINT chk_dashboard_widget_cache_dashboard_type
CHECK (dashboard_type IN ('Employee', 'Manager', 'HR', 'Admin', 'System', 'Project'));

ALTER TABLE dashboard_widget_cache
ADD CONSTRAINT chk_dashboard_widget_cache_scope
CHECK (cache_scope IN ('Own', 'Team', 'Department', 'Project', 'Company', 'System'));

ALTER TABLE dashboard_widget_cache
ADD CONSTRAINT chk_dashboard_widget_cache_status
CHECK (status IN ('Fresh', 'Stale', 'Expired', 'Error'));

ALTER TABLE dashboard_widget_cache
ADD CONSTRAINT chk_dashboard_widget_cache_time
CHECK (expires_at >= generated_at);

CREATE UNIQUE INDEX uq_dashboard_widget_cache_key_active
ON dashboard_widget_cache (company_id, cache_key)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_lookup
ON dashboard_widget_cache (company_id, widget_id, dashboard_type, cache_scope, scope_reference_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_user
ON dashboard_widget_cache (company_id, user_id, widget_id)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_expires
ON dashboard_widget_cache (company_id, status, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_scope_ref
ON dashboard_widget_cache (company_id, cache_scope, scope_reference_id)
WHERE deleted_at IS NULL;
```

#### Quy tắc nghiệp vụ

1. Cache chỉ dùng cho widget có `dashboard_widgets.is_cacheable = true`.
2. Cache không được bỏ qua permission. Trước khi trả cache vẫn phải kiểm tra user có quyền xem widget và scope không.
3. Cache key phải bao gồm:
   - company
   - widget
   - dashboard type
   - user/role/scope
   - filter chính
4. Cache hết hạn thì service tính lại.
5. Cache stale có thể tạm trả nếu widget không yêu cầu dữ liệu realtime.
6. Widget dữ liệu nhạy cảm không nên cache quá lâu.
7. Khi module nguồn thay đổi dữ liệu quan trọng, có thể invalidate cache liên quan.
8. Không dùng cache để lưu bản sao nghiệp vụ dài hạn.

#### Ví dụ cache key

```text
company:{company_id}:widget:PENDING_LEAVE:manager:{employee_id}:month:2026-06
company:{company_id}:widget:HR_OVERVIEW:scope:company:month:2026-06
company:{company_id}:widget:NOTIFICATIONS:user:{user_id}:limit:5
```

---

### 8.4 Bảng `dashboard_user_widget_states` - phase sau

#### Mục đích

Lưu trạng thái hiển thị cá nhân của widget theo user:

1. Thu gọn/mở rộng widget.
2. Layout kéo thả cá nhân.
3. Ẩn tạm thời widget cá nhân.
4. Filter cá nhân.
5. Tab/view cá nhân.

#### Cấu trúc cột đề xuất

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `user_id` | UUID | Có | FK `users.id` |
| `widget_id` | UUID | Có | FK `dashboard_widgets.id` |
| `dashboard_type` | VARCHAR(50) | Có | Employee/Manager/HR/Admin/System/Project |
| `is_visible` | BOOLEAN | Có | User có hiển thị không |
| `is_collapsed` | BOOLEAN | Có | Widget đang thu gọn không |
| `layout_x` | INT | Không | Vị trí cá nhân |
| `layout_y` | INT | Không | Vị trí cá nhân |
| `layout_width` | INT | Không | Width cá nhân |
| `layout_height` | INT | Không | Height cá nhân |
| `user_config` | JSONB | Không | Config cá nhân |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `updated_at` | TIMESTAMP | Có | Thời điểm cập nhật |

#### Ghi chú

Bảng này chưa bắt buộc MVP nếu hệ thống chỉ cần cấu hình widget theo role/company. Tuy nhiên, nếu muốn cho user tự sắp xếp dashboard ở phase sau, bảng này nên được thêm.

---

### 8.5 Bảng `dashboard_cache_invalidations`

#### Mục đích

Ghi nhận các lần invalidate cache dashboard theo event.

Bảng này giúp debug vì sao cache bị xóa hoặc refresh, đặc biệt khi dashboard lấy dữ liệu từ nhiều module.

#### Cấu trúc cột đề xuất

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` |
| `widget_id` | UUID | Không | FK `dashboard_widgets.id`; null = nhiều widget |
| `module_code` | VARCHAR(50) | Có | Module nguồn phát event |
| `event_code` | VARCHAR(100) | Có | Event gây invalidate |
| `source_entity_type` | VARCHAR(100) | Không | Entity nguồn |
| `source_entity_id` | UUID | Không | ID entity nguồn |
| `cache_scope` | VARCHAR(50) | Không | Own/Team/Department/Project/Company/System |
| `scope_reference_id` | UUID | Không | Scope bị ảnh hưởng |
| `cache_key_pattern` | VARCHAR(500) | Không | Pattern cache bị ảnh hưởng |
| `invalidated_count` | INT | Có | Số cache bị đổi trạng thái |
| `status` | VARCHAR(50) | Có | Pending/Done/Failed |
| `error_message` | TEXT | Không | Lỗi nếu có |
| `created_at` | TIMESTAMP | Có | Thời điểm tạo |
| `processed_at` | TIMESTAMP | Không | Thời điểm xử lý |

#### Quy tắc nghiệp vụ

1. Khi task/leave/attendance thay đổi, service có thể tạo invalidation event.
2. Worker xử lý invalidation bằng cách set `dashboard_widget_cache.status = 'Stale'` hoặc soft delete cache.
3. Không cần invalidate mọi widget nếu TTL ngắn và query nhẹ.
4. Bảng này rất hữu ích cho debug dashboard sai số liệu.

---

## 9. Luồng transaction nghiệp vụ

### 9.1 Transaction tạo notification từ event

```text
1. Module nguồn phát event:
   - module_code
   - event_code
   - source_entity_type
   - source_entity_id
   - actor_user_id
   - recipient candidates
   - payload

2. NOTI service load notification_events:
   - Ưu tiên company-specific event
   - Fallback global event
   - Kiểm tra is_enabled = true

3. Resolve recipients:
   - Nếu module nguồn truyền recipient_user_id rõ ràng, dùng trực tiếp
   - Nếu truyền employee_id, map sang employees.user_id
   - Nếu dùng recipient_rule_config, resolve theo manager/HR/role/scope

4. Loại recipient không hợp lệ:
   - user không active
   - user khác company
   - user không có quyền nhận/xem target nếu rule yêu cầu
   - recipient duplicate

5. Với từng recipient:
   - Kiểm tra notification_preferences nếu đã bật
   - Tạo dedupe_key
   - Kiểm tra notification trùng
   - Load template theo event/channel/locale
   - Render title/body/short_body
   - Insert notifications status = Unread
   - Insert notification_delivery_logs cho từng channel

6. Commit transaction.

7. Sau commit:
   - Publish realtime event nếu có
   - Queue email/push job nếu có
   - Invalidate dashboard notification widget/cache nếu cần
```

---

### 9.2 Transaction đánh dấu một notification đã đọc

```text
1. Kiểm tra user đăng nhập.
2. Tìm notification theo id + company_id + recipient_user_id.
3. Nếu không tồn tại hoặc deleted_at != null -> trả not found.
4. Nếu status đã Read -> có thể trả success idempotent.
5. Update:
   - status = Read
   - read_at = now()
   - updated_by = current_user_id
   - updated_at = now()
6. Commit.
7. Invalidate unread count cache nếu có.
```

---

### 9.3 Transaction đánh dấu tất cả notification đã đọc

```text
1. Kiểm tra permission NOTI.NOTIFICATION.MARK_ALL_READ_OWN.
2. Update tất cả notifications:
   - company_id = auth.company_id
   - recipient_user_id = current_user_id
   - status = Unread
   - deleted_at IS NULL
3. Set:
   - status = Read
   - read_at = now()
   - updated_by = current_user_id
4. Commit.
5. Invalidate unread count cache.
```

---

### 9.4 Transaction ẩn/xóa mềm notification cá nhân

```text
1. Kiểm tra notification thuộc current_user.
2. Nếu ẩn:
   - status = Hidden
   - hidden_at = now()
3. Nếu xóa:
   - status = Deleted
   - deleted_at = now()
   - deleted_by = current_user_id
4. Commit.
```

---

### 9.5 Transaction load dashboard theo role

```text
1. Xác thực user.
2. Load roles + permissions + data scope từ AUTH.
3. Load employee hiện tại từ HR nếu có.
4. Xác định dashboard_type:
   - Employee
   - Manager
   - HR
   - Admin
   - System
5. Load dashboard_widget_configs theo thứ tự ưu tiên:
   - User config
   - Role config
   - Company config
   - Default widget
6. Lọc widget:
   - is_enabled = true
   - widget status Active
   - user có required_permission_code
7. Với từng widget:
   - Xác định data_scope effective
   - Không cho data_scope vượt quyền user
   - Nếu widget cacheable, tìm cache hợp lệ
   - Nếu cache miss/expired, gọi data_source service
8. Trả danh sách widget + data + action_config.
```

---

### 9.6 Transaction cập nhật cấu hình widget

```text
1. Kiểm tra permission DASH.CONFIG.UPDATE.
2. Validate company_id từ auth context.
3. Validate widget tồn tại và Active.
4. Validate config_scope:
   - Company: role_id null, user_id null
   - Role: role_id hợp lệ cùng company
   - User: user_id hợp lệ cùng company
5. Validate data_scope_override không vượt quyền role/user mục tiêu.
6. Upsert dashboard_widget_configs.
7. Ghi audit_logs action = DASH_WIDGET_CONFIG_UPDATED.
8. Invalidate cache liên quan nếu config thay đổi data/filter.
9. Commit.
```

---

### 9.7 Transaction refresh dashboard widget cache

```text
1. Worker hoặc API nhận yêu cầu refresh widget.
2. Kiểm tra widget is_cacheable = true.
3. Build cache_key từ widget + scope + filter.
4. Lock cache row nếu đã tồn tại để tránh refresh đồng thời.
5. Gọi data_source service tương ứng.
6. Validate dữ liệu trả về không vượt scope.
7. Upsert dashboard_widget_cache:
   - data
   - data_hash
   - status = Fresh
   - generated_at = now()
   - expires_at = now() + TTL
8. Nếu lỗi:
   - status = Error
   - error_message = lỗi rút gọn
9. Commit.
```

---

## 10. Permission và data scope

### 10.1 Permission NOTI đề xuất seed

> **Chốt DN-5:** Quyền quản trị danh mục thông báo dùng **`NOTI.EVENT.*`** (`NOTI.EVENT.VIEW`/`NOTI.EVENT.CONFIG`), KHÔNG dùng `NOTI.TYPE.*`. "Loại/type thông báo" (`notification_type`) là thuộc tính cấu hình bên trong `notification_events`, không phải resource quyền riêng — `NOTI.EVENT.VIEW`/`CONFIG` bao trùm cả việc xem/cấu hình loại. Khớp API-07 §6.3 và BACKEND-09. Mọi seed/tham chiếu `NOTI.TYPE.*` còn sót (vd `permission-matrix-spec.md`) phải đổi về `NOTI.EVENT.*`.

| Permission code | Mô tả |
| --- | --- |
| `NOTI.NOTIFICATION.VIEW_OWN` | Xem danh sách thông báo của chính mình |
| `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` | Xem chi tiết thông báo của chính mình |
| `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` | Xem số lượng thông báo chưa đọc |
| `NOTI.NOTIFICATION.MARK_READ_OWN` | Đánh dấu thông báo của mình là đã đọc |
| `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` | Đánh dấu tất cả thông báo của mình là đã đọc |
| `NOTI.NOTIFICATION.HIDE_OWN` | Ẩn thông báo của mình |
| `NOTI.NOTIFICATION.DELETE_OWN` | Xóa mềm thông báo của mình |
| `NOTI.NOTIFICATION.VIEW_COMPANY` | Xem notification/log toàn công ty nếu được cấp |
| `NOTI.NOTIFICATION.CREATE_SYSTEM` | Tạo thông báo hệ thống thủ công |
| `NOTI.NOTIFICATION.SEND_SYSTEM` | Gửi thông báo hệ thống thủ công |
| `NOTI.EVENT.VIEW` | Xem event notification |
| `NOTI.EVENT.CONFIG` | Cấu hình event notification |
| `NOTI.TEMPLATE.VIEW` | Xem template notification |
| `NOTI.TEMPLATE.UPDATE` | Cập nhật template notification |
| `NOTI.CHANNEL.VIEW` | Xem cấu hình kênh |
| `NOTI.CHANNEL.UPDATE` | Cập nhật cấu hình kênh |
| `NOTI.LOG.VIEW` | Xem delivery log |
| `NOTI.AUDIT_LOG.VIEW` | Xem audit log NOTI |

---

### 10.2 Permission DASH đề xuất seed

| Permission code | Mô tả |
| --- | --- |
| `DASH.DASHBOARD.VIEW` | Truy cập dashboard |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | Xem Employee Dashboard |
| `DASH.DASHBOARD.VIEW_MANAGER` | Xem Manager Dashboard |
| `DASH.DASHBOARD.VIEW_HR` | Xem HR Dashboard |
| `DASH.DASHBOARD.VIEW_ADMIN` | Xem Admin Dashboard |
| `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Xem widget chấm công hôm nay |
| `DASH.WIDGET.VIEW_MY_TASKS` | Xem widget task của tôi |
| `DASH.WIDGET.VIEW_TASK_ALERTS` | Xem widget task quá hạn/sắp đến hạn |
| `DASH.WIDGET.VIEW_LEAVE_BALANCE` | Xem widget số ngày phép còn lại |
| `DASH.WIDGET.VIEW_PENDING_LEAVE` | Xem widget đơn nghỉ chờ duyệt |
| `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | Xem widget lịch nghỉ |
| `DASH.WIDGET.VIEW_NOTIFICATIONS` | Xem widget thông báo mới |
| `DASH.WIDGET.VIEW_HR_OVERVIEW` | Xem widget tổng quan nhân sự |
| `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | Xem widget nhân sự mới |
| `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | Xem widget hợp đồng sắp hết hạn |
| `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | Xem widget bất thường chấm công |
| `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Xem widget tiến độ dự án |
| `DASH.CONFIG.VIEW` | Xem cấu hình dashboard/widget |
| `DASH.CONFIG.UPDATE` | Cập nhật cấu hình dashboard/widget |
| `DASH.AUDIT_LOG.VIEW` | Xem audit log DASH |

---

### 10.3 Data scope trong NOTI

| Scope | Ý nghĩa |
| --- | --- |
| Own | Chỉ notification của chính user |
| Team | Notification/log liên quan nhân viên thuộc team, chỉ dùng cho quản trị nếu cần |
| Department | Notification/log trong phòng ban, phase sau |
| Company | Notification/log toàn công ty |
| System | Notification/log toàn hệ thống |

MVP nên áp dụng:

1. Employee/Manager/HR/Admin đều xem notification cá nhân với scope Own.
2. Chỉ Admin/Super Admin hoặc role được cấp riêng mới xem log notification công ty.
3. Không cho user xem notification của người khác qua API cá nhân.

---

### 10.4 Data scope trong DASH

| Scope | Ý nghĩa trong dashboard |
| --- | --- |
| Own | Dữ liệu của chính employee/user |
| Team | Dữ liệu nhân viên có `direct_manager_id` là employee hiện tại |
| Department | Dữ liệu phòng ban user được quản lý |
| Project | Dữ liệu dự án user là member/owner/manager |
| Company | Dữ liệu toàn công ty |
| System | Dữ liệu toàn hệ thống |

Nguyên tắc:

1. Widget cá nhân chỉ lấy Own.
2. Widget Manager lấy Team hoặc Project.
3. Widget HR lấy Company nếu có quyền.
4. Widget Admin lấy Company hoặc System tùy role.
5. Scope từ config không được nâng quyền vượt role_permissions.
6. Nếu user có nhiều role, dùng scope cao nhất theo từng permission hoặc theo dashboard type đang chọn.

---

## 11. Chiến lược index chi tiết

### 11.1 Index cho NOTI

Mục tiêu chính:

1. Đếm unread nhanh.
2. Lấy danh sách thông báo mới nhanh.
3. Lọc theo module/event/status.
4. Chống trùng bằng dedupe key.
5. Retry delivery log.

Index bắt buộc:

```sql
CREATE INDEX idx_notifications_unread_count
ON notifications (company_id, recipient_user_id, status)
WHERE status = 'Unread' AND deleted_at IS NULL;

CREATE INDEX idx_notifications_dropdown
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE deleted_at IS NULL AND status IN ('Unread', 'Read');

CREATE INDEX idx_notifications_filter
ON notifications (company_id, recipient_user_id, module_code, event_code, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_target
ON notifications (company_id, target_module, target_type, target_id)
WHERE target_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notifications_dedupe_active
ON notifications (company_id, recipient_user_id, event_code, dedupe_key)
WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notification_delivery_retry
ON notification_delivery_logs (company_id, delivery_status, next_retry_at)
WHERE delivery_status IN ('Pending', 'Failed');

CREATE INDEX idx_notification_delivery_notification
ON notification_delivery_logs (notification_id, channel, delivery_status);
```

---

### 11.2 Index cho DASH

Mục tiêu chính:

1. Load widget config theo company/dashboard/role/user nhanh.
2. Lookup widget theo permission/module.
3. Lookup cache theo cache_key nhanh.
4. Expire cache theo thời gian.

Index bắt buộc:

```sql
CREATE INDEX idx_dashboard_widget_configs_company_dashboard
ON dashboard_widget_configs (company_id, dashboard_type, is_enabled, sort_order)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_configs_role_dashboard
ON dashboard_widget_configs (company_id, role_id, dashboard_type, is_enabled, sort_order)
WHERE role_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_configs_user_dashboard
ON dashboard_widget_configs (company_id, user_id, dashboard_type, is_enabled, sort_order)
WHERE user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_dashboard_widgets_permission_status
ON dashboard_widgets (required_permission_code, status)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_dashboard_widget_cache_key_active
ON dashboard_widget_cache (company_id, cache_key)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_expiry
ON dashboard_widget_cache (company_id, status, expires_at)
WHERE deleted_at IS NULL;

CREATE INDEX idx_dashboard_widget_cache_widget_scope
ON dashboard_widget_cache (company_id, widget_id, cache_scope, scope_reference_id)
WHERE deleted_at IS NULL;
```

---

## 12. DDL tham khảo

> DDL dưới đây là bản tham khảo để backend chuyển thành migration chính thức. Tùy framework, có thể tách thành nhiều migration file.

```sql
CREATE TABLE notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  module_code VARCHAR(50) NOT NULL,
  event_code VARCHAR(100) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  description TEXT,
  notification_type VARCHAR(50) NOT NULL,
  default_priority VARCHAR(50) NOT NULL DEFAULT 'Normal',
  default_channels JSONB NOT NULL DEFAULT '["IN_APP"]'::jsonb,
  recipient_rule_config JSONB,
  dedupe_strategy VARCHAR(50) NOT NULL DEFAULT 'None',
  dedupe_window_seconds INT,
  throttle_config JSONB,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_system_event BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  event_id UUID NOT NULL,
  template_code VARCHAR(100) NOT NULL,
  channel VARCHAR(50) NOT NULL,
  locale VARCHAR(20) NOT NULL DEFAULT 'vi-VN',
  title_template VARCHAR(255) NOT NULL,
  body_template TEXT NOT NULL,
  short_body_template VARCHAR(500),
  action_label_template VARCHAR(100),
  target_url_template VARCHAR(500),
  variables_schema JSONB,
  sample_payload JSONB,
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(50) NOT NULL DEFAULT 'Active',
  is_default BOOLEAN NOT NULL DEFAULT true,
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  recipient_employee_id UUID,
  event_id UUID,
  template_id UUID,
  module_code VARCHAR(50) NOT NULL,
  event_code VARCHAR(100) NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  priority VARCHAR(50) NOT NULL DEFAULT 'Normal',
  status VARCHAR(50) NOT NULL DEFAULT 'Unread',
  title VARCHAR(255) NOT NULL,
  body TEXT,
  short_body VARCHAR(500),
  source_entity_type VARCHAR(100),
  source_entity_id UUID,
  source_entity_code VARCHAR(100),
  target_module VARCHAR(50),
  target_type VARCHAR(100),
  target_id UUID,
  target_url VARCHAR(500),
  payload JSONB,
  dedupe_key VARCHAR(255),
  batch_key VARCHAR(255),
  correlation_id VARCHAR(100),
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  read_at TIMESTAMP,
  hidden_at TIMESTAMP,
  archived_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  notification_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,
  channel VARCHAR(50) NOT NULL,
  provider VARCHAR(100),
  delivery_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  attempt_no INT NOT NULL DEFAULT 1,
  max_attempts INT NOT NULL DEFAULT 3,
  request_payload JSONB,
  response_payload JSONB,
  external_message_id VARCHAR(255),
  error_code VARCHAR(100),
  error_message TEXT,
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  failed_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event_id UUID,
  module_code VARCHAR(50),
  notification_type VARCHAR(50),
  channel VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  digest_frequency VARCHAR(50),
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  widget_code VARCHAR(100) NOT NULL,
  module_code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  widget_type VARCHAR(50) NOT NULL,
  required_permission_code VARCHAR(150) NOT NULL,
  default_data_scope VARCHAR(50) NOT NULL,
  data_source_key VARCHAR(150) NOT NULL,
  component_key VARCHAR(150) NOT NULL,
  default_refresh_seconds INT,
  is_cacheable BOOLEAN NOT NULL DEFAULT true,
  default_width INT,
  default_height INT,
  default_config JSONB,
  empty_state_config JSONB,
  action_config JSONB,
  status VARCHAR(50) NOT NULL DEFAULT 'Active',
  is_system_widget BOOLEAN NOT NULL DEFAULT false,
  sort_order INT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE dashboard_widget_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  widget_id UUID NOT NULL,
  dashboard_type VARCHAR(50) NOT NULL,
  role_id UUID,
  user_id UUID,
  config_scope VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  layout_x INT,
  layout_y INT,
  layout_width INT,
  layout_height INT,
  data_scope_override VARCHAR(50),
  refresh_seconds_override INT,
  config JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  created_by UUID,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE dashboard_widget_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  widget_id UUID NOT NULL,
  dashboard_type VARCHAR(50) NOT NULL,
  user_id UUID,
  role_id UUID,
  cache_scope VARCHAR(50) NOT NULL,
  scope_reference_id UUID,
  cache_key VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  data_hash VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'Fresh',
  generated_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  last_accessed_at TIMESTAMP,
  error_message TEXT,
  source_version VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE dashboard_cache_invalidations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  widget_id UUID,
  module_code VARCHAR(50) NOT NULL,
  event_code VARCHAR(100) NOT NULL,
  source_entity_type VARCHAR(100),
  source_entity_id UUID,
  cache_scope VARCHAR(50),
  scope_reference_id UUID,
  cache_key_pattern VARCHAR(500),
  invalidated_count INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  processed_at TIMESTAMP
);
```

---

## 13. Gợi ý foreign key

Tùy thứ tự migration, có thể thêm FK sau khi các bảng nền tảng đã tồn tại.

```sql
ALTER TABLE notification_events
ADD CONSTRAINT fk_notification_events_company
FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE notification_templates
ADD CONSTRAINT fk_notification_templates_event
FOREIGN KEY (event_id) REFERENCES notification_events(id);

ALTER TABLE notifications
ADD CONSTRAINT fk_notifications_company
FOREIGN KEY (company_id) REFERENCES companies(id);

ALTER TABLE notifications
ADD CONSTRAINT fk_notifications_recipient_user
FOREIGN KEY (recipient_user_id) REFERENCES users(id);

ALTER TABLE notifications
ADD CONSTRAINT fk_notifications_event
FOREIGN KEY (event_id) REFERENCES notification_events(id);

ALTER TABLE notifications
ADD CONSTRAINT fk_notifications_template
FOREIGN KEY (template_id) REFERENCES notification_templates(id);

ALTER TABLE notification_delivery_logs
ADD CONSTRAINT fk_notification_delivery_logs_notification
FOREIGN KEY (notification_id) REFERENCES notifications(id);

ALTER TABLE dashboard_widget_configs
ADD CONSTRAINT fk_dashboard_widget_configs_widget
FOREIGN KEY (widget_id) REFERENCES dashboard_widgets(id);

ALTER TABLE dashboard_widget_cache
ADD CONSTRAINT fk_dashboard_widget_cache_widget
FOREIGN KEY (widget_id) REFERENCES dashboard_widgets(id);
```

Ghi chú:

1. Các FK tới `users`, `employees`, `roles` nên thêm sau khi DB-02/DB-03 migration đã ổn định.
2. Nếu muốn giảm coupling giữa module, có thể chỉ dùng FK cho bảng chắc chắn cùng database, còn `source_entity_id` không FK vì nó có thể trỏ tới nhiều bảng khác nhau.
3. `source_entity_type + source_entity_id` là polymorphic reference, không nên ép FK cứng.

---

## 14. Seed data đề xuất

### 14.1 Seed notification events MVP

| Module | Event code | Type | Priority | Channels |
| --- | --- | --- | --- | --- |
| AUTH | `AUTH_USER_CREATED` | Account | Normal | IN_APP |
| AUTH | `AUTH_USER_LOCKED` | Account | High | IN_APP |
| AUTH | `AUTH_PASSWORD_RESET_REQUESTED` | Account | High | IN_APP/EMAIL |
| HR | `HR_EMPLOYEE_CREATED` | HR | Normal | IN_APP |
| HR | `HR_PROFILE_CHANGE_SUBMITTED` | Approval | High | IN_APP |
| HR | `HR_PROFILE_CHANGE_APPROVED` | HR | Normal | IN_APP |
| HR | `HR_PROFILE_CHANGE_REJECTED` | HR | Normal | IN_APP |
| HR | `HR_CONTRACT_EXPIRING` | Reminder | High | IN_APP |
| ATT | `ATT_MISSING_CHECKOUT` | Attendance | High | IN_APP |
| ATT | `ATT_LATE_DETECTED` | Attendance | Normal | IN_APP |
| ATT | `ATT_ABSENT_DETECTED` | Warning | High | IN_APP |
| ATT | `ATT_ADJUSTMENT_SUBMITTED` | Approval | High | IN_APP |
| ATT | `ATT_ADJUSTMENT_APPROVED` | Attendance | Normal | IN_APP |
| ATT | `ATT_ADJUSTMENT_REJECTED` | Attendance | Normal | IN_APP |
| ATT | `ATT_AUTO_ATTENDANCE_CREATED` | Attendance | Normal | IN_APP |
| ATT | `ATT_REMOTE_REQUEST_SUBMITTED` | Approval | High | IN_APP |
| ATT | `ATT_REMOTE_REQUEST_APPROVED` | Attendance | Normal | IN_APP |
| ATT | `ATT_REMOTE_REQUEST_REJECTED` | Attendance | Normal | IN_APP |
| ATT | `ATT_REMOTE_REQUEST_CANCELLED` | Attendance | Normal | IN_APP |
| LEAVE | `LEAVE_REQUEST_SUBMITTED` | Approval | High | IN_APP |
| LEAVE | `LEAVE_REQUEST_APPROVED` | Leave | Normal | IN_APP |
| LEAVE | `LEAVE_REQUEST_REJECTED` | Leave | Normal | IN_APP |
| LEAVE | `LEAVE_REQUEST_CANCELLED` | Leave | Normal | IN_APP |
| LEAVE | `LEAVE_REQUEST_REVOKED` | Leave | Normal | IN_APP |
| LEAVE | `LEAVE_BALANCE_ADJUSTED` | Leave | Normal | IN_APP |
| LEAVE | `LEAVE_BALANCE_LOW` | Warning | Normal | IN_APP |
| LEAVE | `LEAVE_SYNC_TO_ATT_FAILED` | Error | High | IN_APP |
| TASK | `TASK_ASSIGNED` | Task | Normal | IN_APP |
| TASK | `TASK_STATUS_CHANGED` | Task | Normal | IN_APP |
| TASK | `TASK_COMMENT_CREATED` | Task | Low | IN_APP |
| TASK | `TASK_MENTIONED` | Task | High | IN_APP |
| TASK | `TASK_DUE_SOON` | Reminder | Normal | IN_APP |
| TASK | `TASK_OVERDUE` | Warning | High | IN_APP |
| TASK | `PROJECT_MEMBER_ADDED` | Project | Normal | IN_APP |
| SYSTEM | `SYSTEM_CONFIG_WARNING` | Warning | High | IN_APP |
| SYSTEM | `SYSTEM_ERROR_DETECTED` | Error | Critical | IN_APP |

> **Event nội bộ cache (không seed như notification người dùng):** `NOTIFICATION_CREATED`, `NOTIFICATION_READ` do NOTI phát để DASH invalidate cache widget thông báo (xem SPEC-08 §15.6). Hai event này không tạo `notifications` row; chúng là tín hiệu cache cho `dashboard_cache_invalidations`.

---

### 14.2 Seed notification templates MVP

Ví dụ template tiếng Việt:

| Event code | Title template | Short body |
| --- | --- | --- |
| `LEAVE_REQUEST_SUBMITTED` | `Bạn có một đơn nghỉ cần duyệt` | `{employee_name} đã gửi đơn nghỉ {leave_request_code}.` |
| `LEAVE_REQUEST_APPROVED` | `Đơn nghỉ của bạn đã được duyệt` | `Đơn {leave_request_code} đã được duyệt.` |
| `LEAVE_REQUEST_REJECTED` | `Đơn nghỉ của bạn bị từ chối` | `Đơn {leave_request_code} đã bị từ chối.` |
| `ATT_ADJUSTMENT_SUBMITTED` | `Có yêu cầu điều chỉnh công cần duyệt` | `{employee_name} đã gửi yêu cầu điều chỉnh công.` |
| `TASK_ASSIGNED` | `Bạn có task mới` | `Bạn được giao task {task_code}: {task_title}.` |
| `TASK_MENTIONED` | `Bạn được nhắc đến trong comment` | `{actor_name} đã mention bạn trong task {task_code}.` |
| `TASK_DUE_SOON` | `Task sắp đến hạn` | `Task {task_code} sắp đến deadline.` |
| `TASK_OVERDUE` | `Task đã quá hạn` | `Task {task_code} đã quá deadline.` |
| `HR_CONTRACT_EXPIRING` | `Hợp đồng sắp hết hạn` | `Hợp đồng của {employee_name} sắp hết hạn.` |

---

### 14.3 Seed dashboard widgets MVP

| Dashboard | Widget | Code | Sort |
| --- | --- | --- | --- |
| Employee | Chấm công hôm nay | `ATTENDANCE_TODAY` | 10 |
| Employee | Task của tôi | `MY_TASKS` | 20 |
| Employee | Task sắp đến hạn/quá hạn | `TASK_ALERTS` | 30 |
| Employee | Số ngày phép còn lại | `LEAVE_BALANCE` | 40 |
| Employee | Thông báo mới | `NOTIFICATIONS` | 50 |
| Manager | Đơn nghỉ chờ duyệt | `PENDING_LEAVE` | 10 |
| Manager | Task team hôm nay | `TEAM_TASKS_TODAY` | 20 |
| Manager | Task team quá hạn | `TASK_ALERTS` | 30 |
| Manager | Lịch nghỉ team | `LEAVE_CALENDAR` | 40 |
| Manager | Bất thường chấm công team | `ATTENDANCE_ALERTS` | 50 |
| HR | Tổng quan nhân sự | `HR_OVERVIEW` | 10 |
| HR | Nhân sự mới | `NEW_EMPLOYEES` | 20 |
| HR | Hợp đồng sắp hết hạn | `CONTRACT_EXPIRING` | 30 |
| HR | Đơn nghỉ chờ xử lý | `PENDING_LEAVE` | 40 |
| HR | Bất thường chấm công | `ATTENDANCE_ALERTS` | 50 |
| Admin | Tổng số user | `USER_SUMMARY` | 10 |
| Admin | Tổng số nhân viên | `EMPLOYEE_SUMMARY` | 20 |
| Admin | Module đang dùng | `MODULE_STATUS` | 30 |
| Admin | Cảnh báo cấu hình | `CONFIG_WARNINGS` | 40 |
| Admin | Log quan trọng gần đây | `SYSTEM_LOGS` | 50 |

---

## 15. Query pattern quan trọng

### 15.1 Đếm notification chưa đọc

```sql
SELECT COUNT(*)
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :current_user_id
  AND status = 'Unread'
  AND deleted_at IS NULL;
```

---

### 15.2 Lấy dropdown notification mới nhất

```sql
SELECT id, title, short_body, module_code, event_code, priority, status,
       target_module, target_type, target_id, target_url, created_at, read_at
FROM notifications
WHERE company_id = :company_id
  AND recipient_user_id = :current_user_id
  AND status IN ('Unread', 'Read')
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
```

---

### 15.3 Lấy dashboard config theo role/user

```sql
SELECT c.*, w.widget_code, w.module_code, w.required_permission_code,
       w.default_data_scope, w.data_source_key, w.component_key, w.is_cacheable
FROM dashboard_widget_configs c
JOIN dashboard_widgets w ON w.id = c.widget_id
WHERE c.company_id = :company_id
  AND c.dashboard_type = :dashboard_type
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
  AND w.status = 'Active'
  AND (
    c.config_scope = 'Company'
    OR c.role_id = ANY(:role_ids)
    OR c.user_id = :current_user_id
  )
ORDER BY c.sort_order ASC;
```

Service layer cần resolve precedence user > role > company, vì SQL trên có thể trả nhiều config cho cùng widget.

---

### 15.4 Lấy dashboard cache hợp lệ

```sql
SELECT data, generated_at, expires_at, data_hash
FROM dashboard_widget_cache
WHERE company_id = :company_id
  AND cache_key = :cache_key
  AND status = 'Fresh'
  AND expires_at > now()
  AND deleted_at IS NULL
LIMIT 1;
```

---

## 16. Bảo mật dữ liệu

### 16.1 Nguyên tắc bảo mật NOTI

1. User chỉ xem notification của chính mình.
2. Notification payload không chứa thông tin nhạy cảm.
3. Target URL chỉ là URL nội bộ.
4. Khi click notification, module đích kiểm tra permission.
5. Admin muốn xem log notification toàn công ty phải có quyền riêng.
6. Không gửi lý do nghỉ phép, dữ liệu chấm công chi tiết hoặc dữ liệu HR nhạy cảm trong notification nếu không cần.
7. Không lưu provider response có token/secret trong `notification_delivery_logs.response_payload`.
8. Delivery log và audit log là dữ liệu nhạy cảm, chỉ role được cấp quyền mới xem.

---

### 16.2 Nguyên tắc bảo mật DASH

1. Dashboard phải kiểm tra permission từng widget.
2. Widget data phải áp dụng data scope.
3. Không trả widget bị tắt hoặc user không có quyền.
4. Cache không được bypass phân quyền.
5. Cache key phải phân biệt scope/user/role để tránh rò dữ liệu.
6. Không cache dữ liệu nhạy cảm quá lâu.
7. Nếu widget chứa dữ liệu nhạy cảm, response phải mask hoặc ẩn field theo permission.
8. Dashboard chỉ điều hướng hoặc gọi API module nguồn, không tự ghi nghiệp vụ gốc.

---

## 17. Test case database đề xuất

| Mã test | Tình huống | Kỳ vọng |
| --- | --- | --- |
| DB07-TC-001 | Tạo notification event trùng global event_code | Bị chặn bởi unique index |
| DB07-TC-002 | Tạo company override event trùng event_code cùng company | Bị chặn |
| DB07-TC-003 | Tạo template thiếu event_id | Bị chặn |
| DB07-TC-004 | Tạo notification thiếu recipient_user_id | Bị chặn |
| DB07-TC-005 | Tạo notification với status không hợp lệ | Bị chặn |
| DB07-TC-006 | Tạo notification trùng dedupe_key | Bị chặn nếu cùng recipient/event |
| DB07-TC-007 | User A đọc notification của User B | Bị chặn ở service/API |
| DB07-TC-008 | Đánh dấu notification đã đọc hai lần | Idempotent success |
| DB07-TC-009 | Đếm unread sau mark read | Số lượng giảm đúng |
| DB07-TC-010 | Xóa mềm notification | Không hiện trong danh sách mặc định |
| DB07-TC-011 | Delivery log retry quá max_attempts | Chuyển Failed |
| DB07-TC-012 | Widget code trùng global | Bị chặn |
| DB07-TC-013 | Config widget role có role_id null | Bị chặn bởi check constraint |
| DB07-TC-014 | Config widget user có user_id null | Bị chặn |
| DB07-TC-015 | Load dashboard Employee | Chỉ trả widget user có quyền |
| DB07-TC-016 | Widget Manager với scope Team | Chỉ trả dữ liệu team |
| DB07-TC-017 | Widget HR overview thiếu permission | Không trả widget/data |
| DB07-TC-018 | Cache key trùng | Upsert hoặc bị chặn theo strategy |
| DB07-TC-019 | Cache hết hạn | Service tính lại dữ liệu |
| DB07-TC-020 | Invalidate cache khi task đổi trạng thái | Cache task widget chuyển Stale |
| DB07-TC-021 | Notification payload chứa field nhạy cảm | Bị chặn bởi service validation |
| DB07-TC-022 | Dashboard cache trả nhầm user khác | Bị chặn bằng cache_key có user/scope |
| DB07-TC-023 | User có nhiều role | Resolve dashboard type và widget precedence đúng |
| DB07-TC-024 | Widget bị Inactive | Không hiển thị |
| DB07-TC-025 | Template inactive | Service fallback template active hoặc báo lỗi cấu hình |
| DB07-TC-026 | Event disabled | Không tạo notification mới |
| DB07-TC-027 | Delivery log provider response có secret | Service phải mask trước khi lưu |
| DB07-TC-028 | Admin cập nhật widget config | Ghi audit log |
| DB07-TC-029 | User tự mark all read | Chỉ update notification của user đó |
| DB07-TC-030 | Query notification cross-company | Không trả dữ liệu |

---

## 18. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Notification spam | Cao | Dùng dedupe_key, throttle_config, event enable/disable |
| Unread count chậm khi dữ liệu lớn | Trung bình | Index `(company_id, recipient_user_id, status)`, có thể cache count |
| Payload notification lộ dữ liệu nhạy cảm | Cao | Quy định payload an toàn, validate service, audit |
| Delivery log phình to | Trung bình | Retention policy/archive theo thời gian ở phase sau |
| Dashboard query nặng | Cao | Widget service riêng, cache ngắn hạn, index module nguồn |
| Dashboard cache rò dữ liệu | Cao | Cache key có user/scope/company, luôn kiểm tra permission trước khi trả |
| Widget config xung đột user/role/company | Trung bình | Quy định precedence rõ: User > Role > Company > Default |
| Dữ liệu dashboard không đủ mới | Trung bình | TTL ngắn cho widget quan trọng, invalidate theo event |
| Notification realtime chưa có MVP | Thấp | MVP in-app polling/dropdown; WebSocket phase sau |
| Template sai biến gây lỗi runtime | Trung bình | variables_schema + preview/test template |
| Nhiều module gọi NOTI không thống nhất | Cao | Chuẩn hóa event contract và seed event_code |
| Multi-tenant rò dữ liệu | Cao | Mọi query filter company_id từ auth context |

---

## 19. Quyết định thiết kế đã chốt

1. DB-07 gộp hai module `NOTI` và `DASH` vì hai module này đều phục vụ lớp trải nghiệm/tổng hợp của MVP.
2. NOTI dùng mô hình event-driven.
3. Một dòng `notifications` tương ứng một người nhận.
4. `notification_delivery_logs` tách khỏi `notifications` để hỗ trợ nhiều kênh và retry.
5. MVP ưu tiên kênh `IN_APP`; EMAIL/PUSH/REALTIME để mở rộng.
6. `notification_events` và `notification_templates` có `company_id` nullable để hỗ trợ global default và company override.
7. `notifications` bắt buộc có `company_id` và `recipient_user_id`.
8. `notifications.payload` chỉ chứa dữ liệu điều hướng/hiển thị an toàn, không chứa dữ liệu nhạy cảm.
9. DASH không lưu dữ liệu nghiệp vụ gốc.
10. DASH chỉ lưu widget catalog, widget config và cache tổng hợp ngắn hạn.
11. Widget phải có `required_permission_code` và `default_data_scope`.
12. Dashboard cache không được bypass permission/data scope.
13. Config widget áp dụng precedence: User > Role > Company > Default.
14. Cache dashboard cần TTL và có thể invalidate theo event từ module nguồn.
15. NOTI/DASH đều phải dùng soft delete và audit log cho thao tác cấu hình/quản trị.
16. Seed data MVP phải bao gồm notification event/template và dashboard widget cơ bản.

---

## 20. Việc cần làm tiếp theo

Sau DB-07, nên triển khai tiếp:

```text
DB-08: Audit, Files, Settings, Seeds Database Design
```

DB-08 nên đi sâu vào:

1. `audit_logs`.
2. `files`.
3. `file_links`.
4. `companies`.
5. `company_settings`.
6. `system_settings`.
7. `modules`.
8. `sequence_counters`.
9. `public_holidays`.
10. Seed permissions/roles/modules/widgets/notification events.
11. Chính sách retention log/file.
12. Quy tắc bảo mật file private.
13. Thứ tự migration tổng thể cho MVP.

---

## 21. Kết luận

DB-07 thiết kế module NOTI & DASH theo hướng:

1. `notification_events` là catalog event thông báo.
2. `notification_templates` quản lý nội dung thông báo theo event/channel/locale.
3. `notifications` lưu thông báo theo từng người nhận để xử lý unread/read/hide/delete riêng biệt.
4. `notification_delivery_logs` lưu lịch sử gửi qua từng kênh và chừa khả năng retry.
5. `notification_preferences` chuẩn bị cho cấu hình nhận thông báo cá nhân ở phase sau.
6. `dashboard_widgets` là catalog widget.
7. `dashboard_widget_configs` cấu hình widget theo company/role/user/dashboard type.
8. `dashboard_widget_cache` cache dữ liệu tổng hợp để giảm query nặng.
9. NOTI không xử lý nghiệp vụ gốc; chỉ nhận event và tạo thông báo.
10. DASH không xử lý nghiệp vụ gốc; chỉ tổng hợp, cache, hiển thị và điều hướng.
11. Backend luôn kiểm tra AUTH/RBAC, permission và data scope trước khi trả notification/dashboard data.
12. Thiết kế đủ mở để phát triển WebSocket, mobile push, email digest, dashboard BI, AI summary và automation ở các phase sau.
