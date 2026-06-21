# API-07: NOTI API DESIGN

**MODULE THÔNG BÁO HỆ THỐNG - NOTIFICATION API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · **API-07 NOTI** · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-08 NOTI](<../SPEC/SPEC-08 NOTI.md>) · [Thiết kế DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [Sản phẩm: PRD-00 §9.7](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-07 |
| Tên tài liệu | NOTI API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | NOTI - Thông báo hệ thống |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-06 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **NOTI - Thông báo hệ thống** của hệ thống quản lý doanh nghiệp nội bộ.

Module NOTI cung cấp API cho các nghiệp vụ:

1. Tạo thông báo in-app từ event nghiệp vụ của các module khác.
2. Hiển thị danh sách thông báo của user hiện tại.
3. Hiển thị dropdown/header badge thông báo.
4. Đếm số lượng thông báo chưa đọc.
5. Xem chi tiết một thông báo.
6. Đánh dấu một thông báo đã đọc.
7. Đánh dấu tất cả thông báo đã đọc.
8. Ẩn, lưu trữ hoặc xóa mềm thông báo khỏi danh sách cá nhân.
9. Điều hướng từ thông báo sang module nghiệp vụ gốc.
10. Quản lý catalog notification event.
11. Quản lý template thông báo.
12. Quản lý kênh gửi thông báo.
13. Xem delivery log và retry gửi kênh ngoài nếu có.
14. Gửi thông báo hệ thống thủ công bởi Admin/Super Admin nếu được cấp quyền.
15. Cung cấp dữ liệu thông báo cho Dashboard.
16. Chừa khả năng mở rộng cho email, mobile push, realtime WebSocket, notification digest, notification preference và automation.

Tài liệu API-07 dùng làm cơ sở cho:

1. Backend triển khai route/controller, DTO, validation, service, repository, event consumer, template renderer, delivery service và notification job.
2. Frontend triển khai notification dropdown/header badge, trang danh sách thông báo, chi tiết thông báo, trạng thái đã đọc/chưa đọc và điều hướng target.
3. Admin UI triển khai cấu hình event/template/channel và xem log gửi thông báo.
4. Dashboard tích hợp unread count và danh sách thông báo mới nhất.
5. Các module AUTH, HR, ATT, LEAVE, TASK, DASH, FOUNDATION phát event sang NOTI đúng chuẩn.
6. QA viết test case API, permission test, data scope test, idempotency test, dedupe test, retry test và regression test.
7. DevOps/API documentation tạo OpenAPI/Swagger cho module NOTI.

---

## 3. Căn cứ thiết kế

API-07 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định toàn bộ API dùng prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business validation, audit log, notification event và idempotency cho nghiệp vụ quan trọng.
2. **SPEC-08** xác định NOTI là module dùng chung để tạo thông báo khi có sự kiện quan trọng, gửi đúng người nhận, quản lý trạng thái đọc/chưa đọc, cung cấp unread count, danh sách mới nhất và cấu hình event/template/channel.
3. **DB-07** xác định các bảng chính của NOTI gồm `notification_events`, `notification_templates`, `notifications`, `notification_delivery_logs`, `notification_preferences` và các bảng liên quan DASH.
4. **SPEC-02/API-02 AUTH** là nền tảng xác thực, RBAC, permission và data scope.
5. **SPEC-03/API-03 HR** cung cấp `users`, `employees`, `departments`, `direct_manager_id`, trạng thái nhân viên và user-employee mapping để resolve người nhận.
6. **SPEC-04/API-04 ATT** phát event như `ATT_ADJUSTMENT_SUBMITTED`, `ATT_ADJUSTMENT_APPROVED`, `ATT_MISSING_CHECKOUT`.
7. **SPEC-05/API-05 LEAVE** phát event như `LEAVE_REQUEST_SUBMITTED`, `LEAVE_REQUEST_APPROVED`, `LEAVE_REQUEST_REJECTED`, `LEAVE_BALANCE_ADJUSTED`.
8. **SPEC-06/API-06 TASK** phát event như `TASK_ASSIGNED`, `TASK_STATUS_CHANGED`, `TASK_COMMENT_CREATED`, `TASK_MENTIONED`, `TASK_DUE_SOON`, `TASK_OVERDUE`.
9. **SPEC-07/API-08 DASH** đọc unread count và danh sách thông báo mới nhất từ NOTI nhưng không xử lý nghiệp vụ thông báo.
10. **DB-08 FOUNDATION** cung cấp audit log, settings, module catalog, company settings và seed data.
11. **DB-09** định hướng index/query pattern cho unread count, dropdown notification, delivery retry và danh sách notification.
12. **DB-10** định hướng seed notification events/templates, permissions và role-permission matrix.

---

## 4. Phạm vi API-07

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| My Notification API | Danh sách thông báo của tôi, chi tiết, unread count, dropdown |
| Notification Action API | Mark read, mark all read, hide, archive, delete soft |
| Notification Target API | Lấy thông tin điều hướng an toàn từ notification sang module gốc |
| Admin Notification API | Xem notification theo phạm vi company nếu được cấp quyền |
| Notification Event API | Xem và cấu hình bật/tắt event thông báo |
| Notification Template API | Xem, tạo, cập nhật, bật/tắt template thông báo |
| Notification Channel API | Xem và cập nhật cấu hình kênh gửi |
| Delivery Log API | Xem log gửi thông báo, retry log thất bại nếu được cấp quyền |
| System Notification API | Tạo/gửi thông báo hệ thống thủ công |
| Internal Event API | Internal endpoint để module khác gửi event sang NOTI |
| Internal Send API | Internal endpoint gửi notification trực tiếp hoặc bulk nếu cần |
| Reminder Job API | Internal endpoint/job tạo thông báo nhắc hạn/quá hạn |
| Dashboard Integration API | Endpoint nhẹ cho DASH/header: unread count + latest notifications |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Realtime WebSocket | Phase sau | `/internal/v1/notifications/realtime/publish` hoặc gateway riêng |
| Mobile push | Phase sau | `/api/v1/notifications/devices`, `/internal/v1/notifications/push/send` |
| Email nâng cao | Phase sau | Provider config, email template preview, retry nâng cao |
| Notification preference cá nhân | Phase sau | `/api/v1/notifications/preferences` |
| Quiet hours / DND | Phase sau | `/api/v1/notifications/preferences/quiet-hours` |
| Digest hằng ngày/tuần | Phase sau | `/internal/v1/notifications/digest-jobs/run` |
| Rule engine thông báo | Phase sau | `/api/v1/notifications/rules` |
| Notification grouping | Phase sau | Group theo entity/event để giảm spam |
| AI summary notification | Phase 5 | Tóm tắt notification quan trọng bằng AI |
| Analytics tỷ lệ đọc | Phase sau | `/api/v1/notifications/analytics` |
| Slack/Teams integration | Phase sau | `/api/v1/notifications/integration-channels` |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint NOTI public cho frontend/mobile app dùng prefix:

```http
/api/v1/notifications
```

Ví dụ:

```http
GET    /api/v1/notifications
GET    /api/v1/notifications/dropdown
GET    /api/v1/notifications/unread-count
GET    /api/v1/notifications/{notification_id}
POST   /api/v1/notifications/{notification_id}/mark-read
POST   /api/v1/notifications/mark-all-read
DELETE /api/v1/notifications/{notification_id}
```

Các API nội bộ giữa module/job dùng prefix:

```http
/internal/v1/notifications
```

Ví dụ:

```http
POST /internal/v1/notifications/events
POST /internal/v1/notifications/send
POST /internal/v1/notifications/bulk-send
POST /internal/v1/notifications/reminder-jobs/run
POST /internal/v1/notifications/delivery-jobs/retry
```

Internal API không được gọi trực tiếp từ frontend/mobile.

---

### 5.2 Authentication

Tất cả API NOTI public trong MVP yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint NOTI public không cần đăng nhập trong MVP.

Internal API phải dùng một trong các cơ chế sau:

1. Internal service token.
2. Private network + service authentication.
3. Job token có scope giới hạn.
4. Message queue/event bus, nếu triển khai event-driven qua queue thay vì HTTP internal API.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context hoặc internal event context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ thông thường.

Quy tắc:

1. Mọi query notification vận hành phải filter theo `company_id`.
2. User API chỉ đọc notification có `recipient_user_id = current_user_id`.
3. Admin API xem company notification/log phải có permission và data scope phù hợp.
4. Super Admin scope `System` mới được truy vấn liên công ty qua endpoint hoặc context đặc biệt.
5. Nếu client biết UUID notification của user khác hoặc company khác, backend trả `404 Not Found` hoặc `403 Forbidden` theo policy bảo mật.
6. `company_id` trong internal event phải được validate với module source và token nội bộ.
7. Với catalog global, `company_id = null` là cấu hình global default; cấu hình company-specific được ưu tiên khi render.

---

### 5.4 Response format

Tất cả response tuân thủ API-01.

#### Object response

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {},
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### List response

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 100,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Error response

```json
{
  "success": false,
  "message": "Bạn không có quyền thực hiện thao tác này",
  "error": {
    "code": "AUTH-ERR-FORBIDDEN",
    "type": "ForbiddenError",
    "details": null
  },
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 6. Authorization, permission và data scope

### 6.1 Nguyên tắc authorization

Backend không được hard-code theo role. Backend kiểm tra theo:

```text
permission + data_scope + recipient ownership + company scope + business validation
```

`Allowed roles` trong tài liệu chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định.

---

### 6.2 Scope chuẩn trong NOTI

| Scope | Ý nghĩa trong NOTI | Cách xác định gợi ý |
| --- | --- | --- |
| `Own` | Chỉ notification của user hiện tại | `notifications.recipient_user_id = current_user_id` |
| `Team` | Notification/log liên quan nhân viên thuộc team | Dùng HR `employees.direct_manager_id`; chủ yếu phase sau hoặc admin report |
| `Department` | Notification/log theo phòng ban | Dùng HR `employees.department_id`; phase sau |
| `Company` | Notification/log toàn công ty hiện tại | `notifications.company_id = current_company_id` |
| `System` | Notification/log toàn hệ thống | Super Admin only |

MVP áp dụng chính:

1. User cá nhân dùng scope `Own`.
2. Admin công ty dùng scope `Company` cho log/cấu hình nếu được cấp quyền.
3. Super Admin dùng scope `System` cho cấu hình global và dữ liệu liên công ty nếu có endpoint riêng.
4. Không cho user xem notification của người khác qua API cá nhân.

---

### 6.3 Danh sách permission NOTI trong MVP

| Permission | Mục đích |
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
| `NOTI.EVENT.VIEW` | Xem danh sách event notification |
| `NOTI.EVENT.CONFIG` | Cấu hình bật/tắt event notification |
| `NOTI.TEMPLATE.VIEW` | Xem template notification |
| `NOTI.TEMPLATE.CREATE` | Tạo template notification |
| `NOTI.TEMPLATE.UPDATE` | Cập nhật template notification |
| `NOTI.TEMPLATE.DELETE` | Xóa mềm template notification |
| `NOTI.CHANNEL.VIEW` | Xem cấu hình kênh gửi notification |
| `NOTI.CHANNEL.UPDATE` | Cập nhật cấu hình kênh gửi notification |
| `NOTI.LOG.VIEW` | Xem delivery log notification |
| `NOTI.LOG.RETRY` | Retry delivery log thất bại |
| `NOTI.AUDIT_LOG.VIEW` | Xem audit log module NOTI |

---

### 6.4 Role mặc định gợi ý

| Role | Quyền gợi ý trong NOTI |
| --- | --- |
| Super Admin | Toàn quyền scope System, cấu hình global, xem log toàn hệ thống |
| Admin công ty | Quản lý event/template/channel/log trong company nếu được cấp |
| HR | Nhận notification nhân sự/nghỉ phép/chấm công; có thể cấu hình template nếu được cấp |
| Manager | Nhận notification cần xử lý trong team: nghỉ phép, điều chỉnh công, task |
| Employee | Xem, đọc, ẩn, xóa notification của chính mình |
| Project Manager | Nhận notification task/project liên quan |
| Payroll Officer | Nhận notification payroll ở phase sau |
| Recruiter | Nhận notification recruitment ở phase sau |

---

## 7. Enum và quy ước trạng thái

### 7.1 Notification type

| Giá trị | Ý nghĩa |
| --- | --- |
| `System` | Thông báo hệ thống |
| `Account` | Tài khoản/xác thực |
| `HR` | Nhân sự |
| `Attendance` | Chấm công |
| `Leave` | Nghỉ phép |
| `Task` | Công việc |
| `Project` | Dự án |
| `Approval` | Phê duyệt |
| `Reminder` | Nhắc hạn |
| `Warning` | Cảnh báo |
| `Error` | Lỗi hệ thống |

---

### 7.2 Notification channel

| Giá trị | MVP | Ý nghĩa |
| --- | --- | --- |
| `IN_APP` | Có | Hiển thị trong web/mobile app |
| `EMAIL` | Tùy cấu hình cơ bản | Gửi email, có thể phase sau |
| `PUSH` | Phase sau | Mobile push |
| `REALTIME` | Phase sau | WebSocket/realtime |
| `INTEGRATION` | Phase sau | Slack/Teams/webhook |

MVP ưu tiên `IN_APP`. Các kênh khác có thể lưu cấu hình và delivery log nhưng chưa cần delivery provider đầy đủ.

---

### 7.3 Notification priority

| Giá trị | Ý nghĩa |
| --- | --- |
| `Low` | Ít quan trọng |
| `Normal` | Mặc định |
| `High` | Cần chú ý |
| `Urgent` | Cần xử lý sớm |
| `Critical` | Nghiêm trọng, bảo mật hoặc lỗi hệ thống |

---

### 7.4 Notification status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Unread` | Chưa đọc |
| `Read` | Đã đọc |
| `Hidden` | User ẩn khỏi danh sách mặc định |
| `Archived` | User lưu trữ |
| `Deleted` | Xóa mềm theo user |
| `Failed` | Chỉ dùng khi thể hiện lỗi gửi kênh ngoài nếu cần |

Khuyến nghị MVP:

1. `notifications.status` dùng `Unread`, `Read`, `Hidden`, `Archived`, `Deleted`.
2. Trạng thái gửi kênh ngoài dùng `notification_delivery_logs.delivery_status`, không trộn vào `notifications.status`.

---

### 7.5 Delivery status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Pending` | Đang chờ gửi |
| `Sent` | Đã gửi sang provider hoặc insert in-app thành công |
| `Delivered` | Provider xác nhận delivered nếu có |
| `Failed` | Gửi thất bại |
| `Skipped` | Bỏ qua do event/template/channel disabled hoặc preference |
| `Cancelled` | Hủy gửi |

---

### 7.6 Event status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Active` | Event đang bật |
| `Inactive` | Event bị tắt |
| `Deprecated` | Event cũ, không dùng cho luồng mới |

---

### 7.7 Template status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Active` | Template đang dùng |
| `Inactive` | Template tắt tạm thời |
| `Draft` | Template đang soạn, chưa dùng |
| `Deprecated` | Template cũ, chỉ giữ lịch sử |

---

## 8. DTO dùng chung

### 8.1 Notification summary DTO

```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Bạn có task mới",
  "short_content": "Bạn được giao task Thiết kế API module NOTI",
  "notification_type": "Task",
  "priority": "Normal",
  "status": "Unread",
  "is_read": false,
  "source_module": "TASK",
  "event_code": "TASK_ASSIGNED",
  "target_module": "TASK",
  "target_type": "Task",
  "target_id": "550e8400-e29b-41d4-a716-446655440001",
  "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001",
  "created_at": "2026-06-20T10:00:00+07:00",
  "read_at": null
}
```

---

### 8.2 Notification detail DTO

```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Bạn có task mới",
  "content": "Bạn được giao task Thiết kế API module NOTI trong dự án EMS MVP.",
  "short_content": "Bạn được giao task Thiết kế API module NOTI",
  "notification_type": "Task",
  "priority": "Normal",
  "status": "Unread",
  "is_read": false,
  "source_module": "TASK",
  "event_code": "TASK_ASSIGNED",
  "source_entity_type": "Task",
  "source_entity_id": "550e8400-e29b-41d4-a716-446655440001",
  "target": {
    "target_module": "TASK",
    "target_type": "Task",
    "target_id": "550e8400-e29b-41d4-a716-446655440001",
    "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001"
  },
  "payload": {
    "display_code": "TASK-000123",
    "display_title": "Thiết kế API module NOTI"
  },
  "created_at": "2026-06-20T10:00:00+07:00",
  "read_at": null,
  "expires_at": null
}
```

---

### 8.3 Unread count DTO

```json
{
  "unread_count": 12,
  "high_priority_unread_count": 2,
  "urgent_unread_count": 1,
  "last_notification_at": "2026-06-20T10:00:00+07:00"
}
```

---

### 8.4 Notification event DTO

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440010",
  "event_code": "TASK_ASSIGNED",
  "module_code": "TASK",
  "name": "Task assigned",
  "description": "Gửi thông báo khi user được giao task",
  "default_type": "Task",
  "default_priority": "Normal",
  "enabled": true,
  "dedupe_enabled": true,
  "dedupe_window_seconds": 300,
  "recipient_resolver": "TASK_ASSIGNEE",
  "company_override": false,
  "created_at": "2026-06-20T10:00:00+07:00",
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

---

### 8.5 Notification template DTO

```json
{
  "template_id": "550e8400-e29b-41d4-a716-446655440011",
  "template_code": "TASK_ASSIGNED_IN_APP_VI",
  "event_code": "TASK_ASSIGNED",
  "channel": "IN_APP",
  "locale": "vi",
  "title_template": "Bạn có task mới",
  "short_template": "Bạn được giao task {task_title}",
  "content_template": "Bạn được giao task {task_title} trong dự án {project_name}.",
  "variables_schema": {
    "required": ["task_title"],
    "optional": ["project_name", "deadline"]
  },
  "status": "Active",
  "is_default": true,
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

---

### 8.6 Delivery log DTO

```json
{
  "delivery_log_id": "550e8400-e29b-41d4-a716-446655440012",
  "notification_id": "550e8400-e29b-41d4-a716-446655440000",
  "recipient_user_id": "550e8400-e29b-41d4-a716-446655440020",
  "channel": "IN_APP",
  "provider": "internal",
  "delivery_status": "Sent",
  "attempt_no": 1,
  "max_attempts": 1,
  "error_code": null,
  "error_message": null,
  "scheduled_at": null,
  "sent_at": "2026-06-20T10:00:01+07:00",
  "next_retry_at": null,
  "created_at": "2026-06-20T10:00:00+07:00"
}
```

---

## 9. Chuẩn query list, search, filter, sort

### 9.1 Pagination

API list mặc định dùng:

```http
?page=1&per_page=20
```

Giới hạn đề xuất:

| Tham số | Mặc định | Tối đa |
| --- | ---: | ---: |
| `page` | 1 | - |
| `per_page` | 20 | 100 |

Dropdown/header badge không dùng pagination đầy đủ, chỉ dùng `limit` tối đa 20.

---

### 9.2 Search

Tham số chung:

```http
?search=keyword
```

Search áp dụng theo whitelist:

| Resource | Field search |
| --- | --- |
| Notification | `title`, `short_content`, `content` |
| Notification Event | `event_code`, `name`, `module_code` |
| Notification Template | `template_code`, `event_code`, `title_template` |
| Delivery Log | `external_message_id`, `error_code`, `recipient_user_id` |

Không search trong `payload` mặc định ở MVP để tránh query nặng và lộ dữ liệu không cần thiết.

---

### 9.3 Filter notification cá nhân

```http
GET /api/v1/notifications?status=Unread&notification_type=Task&source_module=TASK&priority=High&created_from=2026-06-01&created_to=2026-06-20
```

Filter whitelist:

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `status` | enum | Unread, Read, Hidden, Archived |
| `notification_type` | enum | System, Account, HR, Attendance, Leave, Task, Project, Approval, Reminder, Warning, Error |
| `source_module` | enum/string | AUTH, HR, ATT, LEAVE, TASK, DASH, FOUNDATION, SYSTEM |
| `event_code` | string | Event code cụ thể |
| `priority` | enum | Low, Normal, High, Urgent, Critical |
| `target_module` | string | Module đích |
| `created_from` | datetime/date | ISO 8601 |
| `created_to` | datetime/date | ISO 8601 |
| `read` | boolean | Alias: `true` -> Read, `false` -> Unread |
| `include_hidden` | boolean | Mặc định false |
| `include_archived` | boolean | Mặc định false |

---

### 9.4 Filter admin notification

```http
GET /api/v1/notifications/admin/notifications?recipient_user_id=...&source_module=LEAVE&event_code=LEAVE_REQUEST_SUBMITTED&status=Unread
```

Filter whitelist:

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `recipient_user_id` | UUID | Chỉ Admin/Company/System scope |
| `recipient_employee_id` | UUID | Nếu có snapshot employee |
| `department_id` | UUID | Nếu join HR theo employee |
| `source_module` | string | Module nguồn |
| `event_code` | string | Event code |
| `status` | enum | Trạng thái notification |
| `delivery_status` | enum | Join delivery log nếu cần |
| `created_from`, `created_to` | datetime/date | Khoảng thời gian |
| `batch_key` | string | Tìm notification cùng batch |
| `dedupe_key` | string | Tìm notification theo dedupe |

---

### 9.5 Sort

Sort dùng format:

```http
?sort=created_at:desc,priority:desc
```

Notification sort whitelist:

```text
created_at
read_at
priority
status
source_module
event_code
```

Event/template sort whitelist:

```text
module_code
event_code
updated_at
created_at
status
```

Delivery log sort whitelist:

```text
created_at
sent_at
failed_at
next_retry_at
delivery_status
channel
```

---

## 10. Tổng quan endpoint

### 10.1 My Notification endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications` | Danh sách thông báo của tôi | `NOTI.NOTIFICATION.VIEW_OWN` |
| GET | `/api/v1/notifications/dropdown` | Lấy dropdown notification mới nhất | `NOTI.NOTIFICATION.VIEW_OWN` |
| GET | `/api/v1/notifications/unread-count` | Đếm thông báo chưa đọc | `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` |
| GET | `/api/v1/notifications/{notification_id}` | Chi tiết thông báo của tôi | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| POST | `/api/v1/notifications/{notification_id}/open-target` | Lấy target info an toàn và mark read tùy config | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |

---

### 10.2 Notification action endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| POST | `/api/v1/notifications/{notification_id}/mark-read` | Đánh dấu đã đọc | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| POST | `/api/v1/notifications/{notification_id}/mark-unread` | Đánh dấu chưa đọc nếu bật cấu hình | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| POST | `/api/v1/notifications/mark-all-read` | Đánh dấu tất cả đã đọc | `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` |
| POST | `/api/v1/notifications/{notification_id}/hide` | Ẩn notification | `NOTI.NOTIFICATION.HIDE_OWN` |
| POST | `/api/v1/notifications/{notification_id}/archive` | Lưu trữ notification | `NOTI.NOTIFICATION.HIDE_OWN` |
| DELETE | `/api/v1/notifications/{notification_id}` | Xóa mềm notification của tôi | `NOTI.NOTIFICATION.DELETE_OWN` |

---

### 10.3 Admin notification endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications/admin/notifications` | Danh sách notification toàn công ty theo quyền | `NOTI.NOTIFICATION.VIEW_COMPANY` |
| GET | `/api/v1/notifications/admin/notifications/{notification_id}` | Chi tiết notification admin | `NOTI.NOTIFICATION.VIEW_COMPANY` |
| POST | `/api/v1/notifications/admin/system-notifications` | Tạo thông báo hệ thống thủ công | `NOTI.NOTIFICATION.CREATE_SYSTEM` |
| POST | `/api/v1/notifications/admin/system-notifications/{draft_id}/send` | Gửi thông báo hệ thống thủ công | `NOTI.NOTIFICATION.SEND_SYSTEM` |

---

### 10.4 Event/template/channel endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications/events` | Danh sách event notification | `NOTI.EVENT.VIEW` |
| GET | `/api/v1/notifications/events/{event_id}` | Chi tiết event | `NOTI.EVENT.VIEW` |
| PATCH | `/api/v1/notifications/events/{event_id}` | Cập nhật bật/tắt hoặc cấu hình event | `NOTI.EVENT.CONFIG` |
| GET | `/api/v1/notifications/templates` | Danh sách template | `NOTI.TEMPLATE.VIEW` |
| GET | `/api/v1/notifications/templates/{template_id}` | Chi tiết template | `NOTI.TEMPLATE.VIEW` |
| POST | `/api/v1/notifications/templates` | Tạo template | `NOTI.TEMPLATE.CREATE` hoặc `NOTI.TEMPLATE.UPDATE` |
| PATCH | `/api/v1/notifications/templates/{template_id}` | Cập nhật template | `NOTI.TEMPLATE.UPDATE` |
| DELETE | `/api/v1/notifications/templates/{template_id}` | Xóa mềm template | `NOTI.TEMPLATE.DELETE` |
| POST | `/api/v1/notifications/templates/{template_id}/preview` | Preview render template | `NOTI.TEMPLATE.VIEW` |
| GET | `/api/v1/notifications/channels` | Danh sách/cấu hình kênh gửi | `NOTI.CHANNEL.VIEW` |
| PATCH | `/api/v1/notifications/channels/{channel_code}` | Cập nhật cấu hình kênh | `NOTI.CHANNEL.UPDATE` |

---

### 10.5 Delivery log endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/notifications/delivery-logs` | Danh sách log gửi thông báo | `NOTI.LOG.VIEW` |
| GET | `/api/v1/notifications/delivery-logs/{log_id}` | Chi tiết log gửi | `NOTI.LOG.VIEW` |
| POST | `/api/v1/notifications/delivery-logs/{log_id}/retry` | Retry gửi log thất bại | `NOTI.LOG.RETRY` |

---

### 10.6 Internal endpoints

| Method | Endpoint | Mục đích | Auth |
| --- | --- | --- | --- |
| POST | `/internal/v1/notifications/events` | Nhận event nghiệp vụ từ module khác | Internal/System |
| POST | `/internal/v1/notifications/send` | Tạo/gửi notification trực tiếp | Internal/System |
| POST | `/internal/v1/notifications/bulk-send` | Tạo/gửi notification hàng loạt | Internal/System |
| POST | `/internal/v1/notifications/reminder-jobs/run` | Chạy job tạo notification nhắc hạn/quá hạn | Internal/System |
| POST | `/internal/v1/notifications/delivery-jobs/retry` | Retry các delivery log đang Pending/Failed | Internal/System |
| POST | `/internal/v1/notifications/cleanup-jobs/run` | Cleanup/expire notification theo retention | Internal/System |

---

## 11. Chi tiết API My Notification

### 11.1 NOTI-API-001: Lấy danh sách thông báo của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications` |
| Required permission | `NOTI.NOTIFICATION.VIEW_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `search` | String | Tìm theo title/content rút gọn |
| `status` | Enum | Unread/Read/Hidden/Archived |
| `notification_type` | Enum | Task/Leave/Attendance/HR/System... |
| `source_module` | String | Module nguồn |
| `event_code` | String | Event code |
| `priority` | Enum | Low/Normal/High/Urgent/Critical |
| `created_from`, `created_to` | DateTime | Khoảng thời gian |
| `include_archived` | Boolean | Mặc định false |
| `include_hidden` | Boolean | Mặc định false |
| `sort` | String | Mặc định `created_at:desc` |

#### Business validation

1. Backend resolve `current_user_id` từ access token.
2. Chỉ query `recipient_user_id = current_user_id`.
3. Chỉ query notification cùng `company_id` từ auth context.
4. Mặc định loại bỏ `status IN ('Hidden', 'Archived', 'Deleted')` trừ khi filter cho phép.
5. Không trả payload chứa dữ liệu nhạy cảm ngoài whitelist.
6. Không kiểm tra quyền target module tại list để tránh query nặng; target module phải kiểm tra lại khi user mở chi tiết.
7. Áp dụng whitelist filter/sort.
8. Giới hạn `per_page <= 100`.

#### Success response

```json
{
  "success": true,
  "message": "Lấy danh sách thông báo thành công",
  "data": [
    {
      "notification_id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Bạn có task mới",
      "short_content": "Bạn được giao task Thiết kế API module NOTI",
      "notification_type": "Task",
      "priority": "Normal",
      "status": "Unread",
      "is_read": false,
      "source_module": "TASK",
      "event_code": "TASK_ASSIGNED",
      "target_module": "TASK",
      "target_type": "Task",
      "target_id": "550e8400-e29b-41d4-a716-446655440001",
      "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001",
      "created_at": "2026-06-20T10:00:00+07:00",
      "read_at": null
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 100,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.2 NOTI-API-002: Lấy dropdown notification mới nhất

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/dropdown` |
| Required permission | `NOTI.NOTIFICATION.VIEW_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `limit` | Number | Mặc định 10, tối đa 20 |
| `unread_only` | Boolean | Chỉ lấy unread nếu true |

#### Business validation

1. Chỉ lấy notification của user hiện tại.
2. Chỉ lấy status `Unread` hoặc `Read`.
3. Không lấy Hidden/Archived/Deleted.
4. Sắp xếp `created_at DESC`.
5. Endpoint phải tối ưu cho header, tránh join nặng.
6. Có thể cache rất ngắn ở application layer theo user, ví dụ 15-30 giây nếu cần.

#### Success response

```json
{
  "success": true,
  "message": "Lấy dropdown thông báo thành công",
  "data": {
    "unread_count": 12,
    "items": [
      {
        "notification_id": "550e8400-e29b-41d4-a716-446655440000",
        "title": "Bạn có task mới",
        "short_content": "Bạn được giao task Thiết kế API module NOTI",
        "notification_type": "Task",
        "priority": "Normal",
        "status": "Unread",
        "is_read": false,
        "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001",
        "created_at": "2026-06-20T10:00:00+07:00"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.3 NOTI-API-003: Đếm thông báo chưa đọc

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/unread-count` |
| Required permission | `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Count theo `recipient_user_id = current_user_id`.
2. Count theo `company_id = current_company_id`.
3. Chỉ count `status = 'Unread'` và `deleted_at IS NULL`.
4. Không count Hidden/Archived/Deleted.
5. Query phải dùng index chuyên dụng unread count.

#### Success response

```json
{
  "success": true,
  "message": "Lấy số thông báo chưa đọc thành công",
  "data": {
    "unread_count": 12,
    "high_priority_unread_count": 2,
    "urgent_unread_count": 1,
    "last_notification_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.4 NOTI-API-004: Xem chi tiết thông báo của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/{notification_id}` |
| Required permission | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Path params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `notification_id` | UUID | ID thông báo |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `auto_mark_read` | Boolean | Nếu true, backend mark read khi xem chi tiết nếu cấu hình cho phép |

#### Business validation

1. Notification phải tồn tại, chưa deleted hard, cùng company.
2. Notification phải thuộc `recipient_user_id = current_user_id`.
3. Nếu status `Deleted`, trả 404 hoặc business error theo policy.
4. Nếu `auto_mark_read=true` và notification đang Unread, cập nhật status Read trong transaction nhẹ.
5. Không trả payload nhạy cảm ngoài whitelist.
6. Không tự gọi module target để lấy dữ liệu chi tiết; module target kiểm tra quyền khi user điều hướng.

#### Success response

```json
{
  "success": true,
  "message": "Lấy chi tiết thông báo thành công",
  "data": {
    "notification_id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Bạn có task mới",
    "content": "Bạn được giao task Thiết kế API module NOTI trong dự án EMS MVP.",
    "short_content": "Bạn được giao task Thiết kế API module NOTI",
    "notification_type": "Task",
    "priority": "Normal",
    "status": "Read",
    "is_read": true,
    "source_module": "TASK",
    "event_code": "TASK_ASSIGNED",
    "target": {
      "target_module": "TASK",
      "target_type": "Task",
      "target_id": "550e8400-e29b-41d4-a716-446655440001",
      "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001"
    },
    "payload": {
      "display_code": "TASK-000123",
      "display_title": "Thiết kế API module NOTI"
    },
    "created_at": "2026-06-20T10:00:00+07:00",
    "read_at": "2026-06-20T10:02:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000004",
    "timestamp": "2026-06-20T10:02:00+07:00"
  }
}
```

---

### 11.5 NOTI-API-005: Lấy target info và mở nghiệp vụ liên quan

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/{notification_id}/open-target` |
| Required permission | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Request body

```json
{
  "mark_read": true
}
```

#### Business validation

1. Notification phải thuộc user hiện tại.
2. Notification phải có `target_module`, `target_type`, `target_id` hoặc `target_url`.
3. Nếu `mark_read=true`, mark read nếu đang Unread.
4. API chỉ trả thông tin điều hướng; không xác nhận user có quyền xem target cuối cùng.
5. Frontend mở route target, module target phải gọi API nghiệp vụ và backend target kiểm tra permission/data scope.
6. Nếu target bị thiếu hoặc notification hết hạn, trả business error `NOTI-ERR-TARGET-UNAVAILABLE`.

#### Success response

```json
{
  "success": true,
  "message": "Lấy thông tin điều hướng thành công",
  "data": {
    "target_module": "TASK",
    "target_type": "Task",
    "target_id": "550e8400-e29b-41d4-a716-446655440001",
    "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001",
    "marked_read": true
  },
  "meta": {
    "request_id": "req_20260620_000005",
    "timestamp": "2026-06-20T10:02:00+07:00"
  }
}
```

---

## 12. Chi tiết API Notification Action

### 12.1 NOTI-API-101: Đánh dấu một thông báo là đã đọc

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/{notification_id}/mark-read` |
| Required permission | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Khuyến nghị nhưng không bắt buộc |

#### Request body

```json
{
  "read_at": null
}
```

`read_at` từ client nếu gửi chỉ dùng tham khảo. Backend dùng server time làm thời điểm chính.

#### Business validation

1. Notification phải thuộc user hiện tại.
2. Nếu notification đã Read, trả success idempotent.
3. Nếu notification Hidden/Archived vẫn có thể mark read nếu thuộc user.
4. Nếu Deleted, trả not found hoặc business error.
5. Backend cập nhật `status = 'Read'`, `read_at = now()`, `updated_by = current_user_id`.
6. Không tạo notification event mới.

#### Success response

```json
{
  "success": true,
  "message": "Đã đánh dấu thông báo là đã đọc",
  "data": {
    "notification_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "Read",
    "read_at": "2026-06-20T10:05:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000101",
    "timestamp": "2026-06-20T10:05:00+07:00"
  }
}
```

---

### 12.2 NOTI-API-102: Đánh dấu một thông báo là chưa đọc

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/{notification_id}/mark-unread` |
| Required permission | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Chỉ cho phép nếu company setting `notification.allow_mark_unread = true`.
2. Notification phải thuộc user hiện tại.
3. Nếu notification đang Unread, trả success idempotent.
4. Không cho mark unread nếu status Deleted.
5. Backend cập nhật `status = 'Unread'`, `read_at = null`.

---

### 12.3 NOTI-API-103: Đánh dấu tất cả thông báo là đã đọc

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/mark-all-read` |
| Required permission | `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "source_module": null,
  "notification_type": null,
  "created_before": null
}
```

#### Business validation

1. Chỉ update notification của user hiện tại.
2. Chỉ update notification cùng company hiện tại.
3. Chỉ update status `Unread`.
4. Nếu có filter `source_module`, `notification_type`, `created_before`, phải áp dụng whitelist.
5. Nên update bằng bulk SQL có điều kiện, không loop từng dòng.
6. Trả số lượng bản ghi đã cập nhật.

#### Success response

```json
{
  "success": true,
  "message": "Đã đánh dấu tất cả thông báo là đã đọc",
  "data": {
    "updated_count": 12,
    "unread_count": 0,
    "read_at": "2026-06-20T10:06:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000103",
    "timestamp": "2026-06-20T10:06:00+07:00"
  }
}
```

---

### 12.4 NOTI-API-104: Ẩn thông báo

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/{notification_id}/hide` |
| Required permission | `NOTI.NOTIFICATION.HIDE_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Notification phải thuộc user hiện tại.
2. Nếu đã Hidden, trả success idempotent.
3. Nếu Deleted, trả 404 hoặc business error.
4. Backend cập nhật `status = 'Hidden'`, `hidden_at = now()` nếu có cột.
5. Hidden notification không xuất hiện ở list mặc định và dropdown.

---

### 12.5 NOTI-API-105: Lưu trữ thông báo

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/{notification_id}/archive` |
| Required permission | `NOTI.NOTIFICATION.HIDE_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Notification phải thuộc user hiện tại.
2. Nếu đã Archived, trả success idempotent.
3. Archived notification không xuất hiện ở list mặc định nhưng có thể xem khi `include_archived=true`.
4. Nếu notification đang Unread, có thể mark read đồng thời theo setting `notification.archive_marks_read`.

---

### 12.6 NOTI-API-106: Xóa mềm thông báo của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `DELETE` |
| Endpoint | `/api/v1/notifications/{notification_id}` |
| Required permission | `NOTI.NOTIFICATION.DELETE_OWN` |
| Allowed roles | Tất cả user đã đăng nhập |
| Data scope | Own |
| Audit log | Không bắt buộc với user action; có thể bật nếu cần |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Notification phải thuộc user hiện tại.
2. Không xóa cứng.
3. Backend cập nhật `status = 'Deleted'`, `deleted_at = now()`, `deleted_by = current_user_id`.
4. Deleted notification không xuất hiện ở list/dropdown/count.
5. Delivery logs vẫn giữ để audit/troubleshooting.

#### Success response

```json
{
  "success": true,
  "message": "Đã xóa thông báo khỏi danh sách của bạn",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000106",
    "timestamp": "2026-06-20T10:08:00+07:00"
  }
}
```

---

## 13. Chi tiết API Admin Notification

### 13.1 NOTI-API-201: Danh sách notification toàn công ty

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/admin/notifications` |
| Required permission | `NOTI.NOTIFICATION.VIEW_COMPANY` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có nếu xem payload/log nhạy cảm theo policy |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `recipient_user_id` | UUID | Lọc user nhận |
| `recipient_employee_id` | UUID | Lọc employee nhận |
| `source_module` | String | Module nguồn |
| `event_code` | String | Event code |
| `status` | Enum | Status notification |
| `priority` | Enum | Priority |
| `batch_key` | String | Batch key |
| `dedupe_key` | String | Dedupe key |
| `created_from`, `created_to` | DateTime | Khoảng thời gian |
| `sort` | String | Sort whitelist |

#### Business validation

1. Backend kiểm tra permission `NOTI.NOTIFICATION.VIEW_COMPANY`.
2. Scope Company chỉ xem dữ liệu company hiện tại.
3. Scope System mới được xem liên công ty qua cơ chế riêng.
4. Không trả payload nhạy cảm nếu payload có field không thuộc whitelist.
5. Nếu query range quá lớn, yêu cầu export hoặc giới hạn per_page.
6. Ghi audit log nếu xem chi tiết payload/log theo cấu hình bảo mật.

---

### 13.2 NOTI-API-202: Chi tiết notification admin

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/admin/notifications/{notification_id}` |
| Required permission | `NOTI.NOTIFICATION.VIEW_COMPANY` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Notification phải nằm trong company/scope.
2. Admin xem notification của người khác phải được ghi audit log.
3. Mask payload nếu chứa key không nằm trong whitelist.
4. Có thể include delivery logs nếu query `include_delivery_logs=true` và user có `NOTI.LOG.VIEW`.

---

### 13.3 NOTI-API-203: Tạo thông báo hệ thống thủ công

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/admin/system-notifications` |
| Required permission | `NOTI.NOTIFICATION.CREATE_SYSTEM` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không, vì chính API tạo notification |
| Idempotency | Bắt buộc khuyến nghị |
| Transaction | Bắt buộc |

#### Request headers

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: 7bc90744-8d65-4237-8cad-8c8c7b000203
```

#### Request body

```json
{
  "title": "Thông báo bảo trì hệ thống",
  "content": "Hệ thống sẽ bảo trì từ 22:00 đến 23:00 ngày 20/06/2026.",
  "short_content": "Bảo trì hệ thống lúc 22:00",
  "notification_type": "System",
  "priority": "High",
  "channels": ["IN_APP"],
  "recipient_mode": "Role",
  "recipient_role_codes": ["EMPLOYEE", "MANAGER", "HR"],
  "recipient_user_ids": [],
  "recipient_employee_ids": [],
  "target_url": null,
  "send_now": false,
  "scheduled_at": null,
  "expires_at": "2026-06-21T00:00:00+07:00"
}
```

#### Recipient mode

| Giá trị | Ý nghĩa |
| --- | --- |
| `User` | Gửi đến danh sách user cụ thể |
| `Employee` | Gửi đến danh sách employee cụ thể, backend resolve user |
| `Role` | Gửi đến user có role cụ thể trong company |
| `Department` | Gửi đến nhân viên thuộc phòng ban |
| `Company` | Gửi toàn công ty |

#### Business validation

1. User phải có quyền tạo system notification.
2. `title` và `content` bắt buộc.
3. `priority` phải hợp lệ.
4. `channels` trong MVP chỉ chắc chắn hỗ trợ `IN_APP`.
5. `recipient_mode` phải hợp lệ và không vượt data scope.
6. Nếu `recipient_mode = Company`, cần quyền scope Company/System.
7. Nếu `recipient_mode = Department`, department phải thuộc company và user có scope phù hợp.
8. Backend phải resolve recipient_user_ids, loại user inactive/locked nếu policy yêu cầu.
9. Phải chống gửi trùng bằng idempotency key.
10. Nếu `send_now=false`, tạo draft/batch pending nếu hệ thống hỗ trợ; nếu MVP chưa hỗ trợ draft phức tạp, có thể trả `201 Created` với status `Draft`.
11. Ghi audit log đầy đủ recipient summary, không ghi danh sách quá dài vào audit raw diff.

#### Success response

```json
{
  "success": true,
  "message": "Tạo thông báo hệ thống thành công",
  "data": {
    "draft_id": "550e8400-e29b-41d4-a716-446655440203",
    "status": "Draft",
    "estimated_recipient_count": 120
  },
  "meta": {
    "request_id": "req_20260620_000203",
    "timestamp": "2026-06-20T10:10:00+07:00"
  }
}
```

---

### 13.4 NOTI-API-204: Gửi thông báo hệ thống thủ công

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/admin/system-notifications/{draft_id}/send` |
| Required permission | `NOTI.NOTIFICATION.SEND_SYSTEM` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Bắt buộc |
| Transaction | Bắt buộc |

#### Request body

```json
{
  "confirm": true
}
```

#### Business validation

1. Draft phải tồn tại, cùng company và nằm trong scope.
2. Draft chưa được gửi.
3. `confirm=true` bắt buộc.
4. Resolve danh sách người nhận tại thời điểm gửi hoặc dùng snapshot tùy policy.
5. Tạo một notification row cho mỗi recipient.
6. Tạo delivery log `IN_APP` cho từng notification.
7. Nếu số recipient lớn, có thể chuyển sang async job và trả job_id.
8. Ghi audit log action SEND_SYSTEM_NOTIFICATION.

---

## 14. Chi tiết API Event, Template, Channel

### 14.1 NOTI-API-301: Danh sách notification events

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/events` |
| Required permission | `NOTI.EVENT.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `module_code` | String | AUTH/HR/ATT/LEAVE/TASK/DASH/SYSTEM |
| `event_code` | String | Mã event |
| `enabled` | Boolean | Bật/tắt |
| `search` | String | Search event_code/name |
| `sort` | String | Sort whitelist |

#### Business validation

1. Lấy company-specific override trước, fallback global default.
2. Scope Company chỉ xem event của company hiện tại và global default.
3. Scope System có thể xem tất cả global/company event nếu endpoint hỗ trợ.
4. Không cho sửa event global bằng API company nếu không có scope System.

---

### 14.2 NOTI-API-302: Cập nhật cấu hình event

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/notifications/events/{event_id}` |
| Required permission | `NOTI.EVENT.CONFIG` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "enabled": true,
  "default_priority": "Normal",
  "dedupe_enabled": true,
  "dedupe_window_seconds": 300,
  "enabled_channels": ["IN_APP"],
  "description": "Gửi thông báo khi user được giao task"
}
```

#### Business validation

1. Event phải tồn tại.
2. Nếu event là global và user chỉ scope Company, backend tạo company override thay vì sửa global.
3. `default_priority` phải hợp lệ.
4. `dedupe_window_seconds` không được âm.
5. `enabled_channels` phải thuộc channel được hệ thống hỗ trợ.
6. Không cho disable event bắt buộc bảo mật nếu `is_required=true`.
7. Ghi audit log old/new config.
8. Có thể invalidate template/event cache.

---

### 14.3 NOTI-API-303: Danh sách notification templates

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/templates` |
| Required permission | `NOTI.TEMPLATE.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `event_code` | String | Lọc event |
| `module_code` | String | Lọc module |
| `channel` | Enum | IN_APP/EMAIL/PUSH/REALTIME |
| `locale` | String | vi/en |
| `status` | Enum | Active/Inactive/Draft/Deprecated |
| `company_override` | Boolean | Lọc template override |
| `search` | String | Search template_code/title |

#### Business validation

1. Scope Company xem template global và company override.
2. Nếu có template override, response cần field `effective=true/false` để frontend biết template đang được dùng.
3. Không trả nội dung nhạy cảm trong template nếu có biến private; thông thường template không chứa dữ liệu thật.

---

### 14.4 NOTI-API-304: Tạo notification template

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/templates` |
| Required permission | `NOTI.TEMPLATE.CREATE` hoặc `NOTI.TEMPLATE.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "event_code": "TASK_ASSIGNED",
  "channel": "IN_APP",
  "locale": "vi",
  "template_code": "TASK_ASSIGNED_IN_APP_VI_CUSTOM",
  "title_template": "Bạn có task mới",
  "short_template": "Bạn được giao task {task_title}",
  "content_template": "Bạn được giao task {task_title} trong dự án {project_name}.",
  "variables_schema": {
    "required": ["task_title"],
    "optional": ["project_name", "deadline"]
  },
  "status": "Active",
  "is_default": false
}
```

#### Business validation

1. Event phải tồn tại và active hoặc cho phép tạo template Draft.
2. `channel` phải hợp lệ.
3. `locale` phải hợp lệ, MVP mặc định `vi`.
4. `title_template` và `content_template` bắt buộc.
5. Các biến trong template phải nằm trong `variables_schema` hoặc event variable schema.
6. Không cho dùng biến bị cấm như password, token, salary, bank_account, identity_number.
7. Không cho trùng `company_id + event_code + channel + locale + template_code`.
8. Nếu `is_default=true`, backend unset default template cũ trong cùng event/channel/locale/company.
9. Ghi audit log.

---

### 14.5 NOTI-API-305: Cập nhật notification template

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/notifications/templates/{template_id}` |
| Required permission | `NOTI.TEMPLATE.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Business validation

1. Template phải tồn tại và nằm trong scope.
2. User scope Company không được sửa global template trực tiếp; backend tạo override hoặc trả forbidden tùy policy.
3. Validate biến như API tạo template.
4. Nếu đổi status sang Inactive và template là default duy nhất, cần cảnh báo hoặc chặn nếu event còn active.
5. Ghi audit log old/new template.
6. Invalidate template render cache.

---

### 14.6 NOTI-API-306: Preview render template

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/templates/{template_id}/preview` |
| Required permission | `NOTI.TEMPLATE.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR nếu được cấp |
| Data scope | Company, System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Request body

```json
{
  "variables": {
    "task_title": "Thiết kế API module NOTI",
    "project_name": "EMS MVP",
    "deadline": "2026-06-25"
  }
}
```

#### Success response

```json
{
  "success": true,
  "message": "Preview template thành công",
  "data": {
    "title": "Bạn có task mới",
    "short_content": "Bạn được giao task Thiết kế API module NOTI",
    "content": "Bạn được giao task Thiết kế API module NOTI trong dự án EMS MVP."
  },
  "meta": {
    "request_id": "req_20260620_000306",
    "timestamp": "2026-06-20T10:20:00+07:00"
  }
}
```

---

### 14.7 NOTI-API-307: Danh sách channel config

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/channels` |
| Required permission | `NOTI.CHANNEL.VIEW` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Success response

```json
{
  "success": true,
  "message": "Lấy cấu hình kênh thông báo thành công",
  "data": [
    {
      "channel": "IN_APP",
      "enabled": true,
      "provider": "internal",
      "is_mvp_supported": true,
      "config_status": "Ready"
    },
    {
      "channel": "EMAIL",
      "enabled": false,
      "provider": "smtp",
      "is_mvp_supported": false,
      "config_status": "NotConfigured"
    }
  ],
  "meta": {
    "request_id": "req_20260620_000307",
    "timestamp": "2026-06-20T10:20:00+07:00"
  }
}
```

---

### 14.8 NOTI-API-308: Cập nhật channel config

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/notifications/channels/{channel_code}` |
| Required permission | `NOTI.CHANNEL.UPDATE` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "enabled": true,
  "provider": "internal",
  "settings": {
    "send_immediately": true,
    "max_retry_attempts": 1
  }
}
```

#### Business validation

1. `channel_code` phải thuộc enum hỗ trợ.
2. MVP chỉ đảm bảo `IN_APP` hoạt động đầy đủ.
3. Nếu bật EMAIL/PUSH/INTEGRATION nhưng provider chưa cấu hình, trả business error hoặc chỉ lưu config ở trạng thái NotReady tùy policy.
4. Không trả secret/provider credential trong response.
5. Ghi audit log, mask sensitive settings.

---

## 15. Chi tiết API Delivery Log

### 15.1 NOTI-API-401: Danh sách delivery logs

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/delivery-logs` |
| Required permission | `NOTI.LOG.VIEW` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `notification_id` | UUID | Lọc theo notification |
| `recipient_user_id` | UUID | Lọc người nhận |
| `channel` | Enum | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `delivery_status` | Enum | Pending/Sent/Delivered/Failed/Skipped/Cancelled |
| `provider` | String | Provider |
| `created_from`, `created_to` | DateTime | Khoảng thời gian |
| `next_retry_before` | DateTime | Lọc log cần retry |

#### Business validation

1. Backend áp dụng company/data scope.
2. Không trả full request/response payload provider nếu chứa dữ liệu nhạy cảm.
3. Nếu include payload, cần permission log view và audit access theo policy.
4. Giới hạn query range để tránh scan bảng log lớn.

---

### 15.2 NOTI-API-402: Chi tiết delivery log

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/notifications/delivery-logs/{log_id}` |
| Required permission | `NOTI.LOG.VIEW` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có nếu xem payload provider |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Log phải thuộc company/scope.
2. Mask `request_payload` và `response_payload` nếu chứa secret/token/private data.
3. Có thể include notification summary nếu user có quyền xem admin notification.

---

### 15.3 NOTI-API-403: Retry delivery log thất bại

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/notifications/delivery-logs/{log_id}/retry` |
| Required permission | `NOTI.LOG.RETRY` |
| Allowed roles | Super Admin, Admin công ty nếu được cấp |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Bắt buộc khuyến nghị |
| Transaction | Bắt buộc |

#### Request body

```json
{
  "reason": "Retry sau khi cấu hình lại provider email"
}
```

#### Business validation

1. Delivery log phải thuộc scope.
2. Chỉ retry log có `delivery_status IN ('Failed', 'Pending')`.
3. Không retry nếu `attempt_no >= max_attempts`, trừ user có quyền override hoặc request set `force=true` trong phase sau.
4. Không retry `IN_APP` nếu notification record đã tạo thành công, trừ lỗi dữ liệu đặc biệt.
5. Tăng `attempt_no`, cập nhật status Pending hoặc gọi delivery service ngay tùy mode.
6. Ghi audit log reason.

---

## 16. Internal API và job

### 16.1 INTERNAL-NOTI-API-001: Nhận event nghiệp vụ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/internal/v1/notifications/events` |
| Authentication | Internal/System required |
| Caller | AUTH, HR, ATT, LEAVE, TASK, DASH, FOUNDATION, scheduler/job |
| Audit log | Có thể ghi technical log; audit tùy event |
| Idempotency | Bắt buộc theo `dedupe_key` hoặc `event_idempotency_key` |
| Transaction | Bắt buộc |

#### Request headers

```http
Authorization: Bearer <internal_service_token>
Content-Type: application/json
X-Internal-Service: task-service
Idempotency-Key: TASK_ASSIGNED:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440020
```

#### Request body

```json
{
  "event_code": "TASK_ASSIGNED",
  "company_id": "550e8400-e29b-41d4-a716-446655440100",
  "actor_user_id": "550e8400-e29b-41d4-a716-446655440101",
  "source_module": "TASK",
  "source_entity_type": "Task",
  "source_entity_id": "550e8400-e29b-41d4-a716-446655440001",
  "dedupe_key": "TASK_ASSIGNED:550e8400-e29b-41d4-a716-446655440001:550e8400-e29b-41d4-a716-446655440020",
  "recipient": {
    "mode": "UserIds",
    "user_ids": ["550e8400-e29b-41d4-a716-446655440020"],
    "employee_ids": []
  },
  "payload": {
    "target_module": "TASK",
    "target_type": "Task",
    "target_id": "550e8400-e29b-41d4-a716-446655440001",
    "target_url": "/tasks/550e8400-e29b-41d4-a716-446655440001",
    "task_code": "TASK-000123",
    "task_title": "Thiết kế API module NOTI",
    "project_name": "EMS MVP"
  },
  "priority_override": null,
  "channels_override": null,
  "occurred_at": "2026-06-20T10:00:00+07:00"
}
```

#### Recipient modes nội bộ

| Mode | Ý nghĩa |
| --- | --- |
| `UserIds` | Module nguồn truyền user_ids cụ thể |
| `EmployeeIds` | Module nguồn truyền employee_ids, NOTI resolve user active |
| `RoleCodes` | Gửi đến role trong company |
| `DepartmentIds` | Gửi đến nhân viên phòng ban |
| `ManagerOfEmployee` | Resolve quản lý trực tiếp của employee |
| `ProjectMembers` | Resolve thành viên project, cần TASK cung cấp hoặc NOTI gọi resolver |
| `CustomResolver` | Dùng resolver đã đăng ký trong event config |

#### Business validation

1. Internal token phải hợp lệ và được phép gửi event cho `source_module`.
2. `event_code` phải tồn tại và active, trừ policy cho phép auto-register trong dev.
3. `company_id` bắt buộc với event tenant-specific.
4. `source_module` phải khớp với event config.
5. Payload không được chứa key cấm: password, token, salary, bank_account, identity_number, private_file_url, raw GPS/IP chi tiết.
6. Resolve recipient theo recipient mode.
7. Loại user inactive/locked/deleted nếu policy yêu cầu.
8. Áp dụng notification preference nếu đã có.
9. Áp dụng dedupe theo `dedupe_key` và event config.
10. Render template theo company override -> global fallback.
11. Tạo một row `notifications` cho mỗi recipient.
12. Tạo `notification_delivery_logs` theo channels.
13. Với channel `IN_APP`, delivery status là Sent ngay sau khi insert notification.
14. Với channel ngoài, status Pending để job gửi sau.
15. Trả summary, không trả full list nếu quá nhiều recipients.

#### Success response

```json
{
  "success": true,
  "message": "Event notification đã được xử lý",
  "data": {
    "event_code": "TASK_ASSIGNED",
    "created_notification_count": 1,
    "skipped_count": 0,
    "deduped_count": 0,
    "batch_key": "batch_20260620_000001"
  },
  "meta": {
    "request_id": "req_20260620_internal_001",
    "timestamp": "2026-06-20T10:00:01+07:00"
  }
}
```

---

### 16.2 INTERNAL-NOTI-API-002: Gửi notification trực tiếp

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/internal/v1/notifications/send` |
| Authentication | Internal/System required |
| Idempotency | Bắt buộc |
| Transaction | Bắt buộc |

#### Mục đích

Dùng cho tình huống module/job cần tạo notification trực tiếp mà không qua template event đầy đủ. MVP vẫn khuyến nghị ưu tiên event API để thống nhất template/dedupe.

#### Request body

```json
{
  "company_id": "550e8400-e29b-41d4-a716-446655440100",
  "recipient_user_id": "550e8400-e29b-41d4-a716-446655440020",
  "title": "Thông báo hệ thống",
  "content": "Nội dung thông báo",
  "short_content": "Nội dung ngắn",
  "notification_type": "System",
  "priority": "Normal",
  "source_module": "SYSTEM",
  "event_code": "SYSTEM_MANUAL_NOTIFICATION",
  "target_module": null,
  "target_type": null,
  "target_id": null,
  "target_url": null,
  "payload": {},
  "channels": ["IN_APP"],
  "dedupe_key": "SYSTEM_MANUAL_NOTIFICATION:..."
}
```

#### Business validation

1. Chỉ internal service đáng tin cậy được gọi.
2. Payload/title/content phải được sanitize.
3. Không chứa dữ liệu nhạy cảm quá mức.
4. `recipient_user_id` phải active và thuộc company.
5. Dedupe bắt buộc nếu request có khả năng retry.

---

### 16.3 INTERNAL-NOTI-API-003: Gửi bulk notification

```http
POST /internal/v1/notifications/bulk-send
```

#### Business validation

1. Có giới hạn số recipient mỗi request, ví dụ 1.000.
2. Nếu vượt giới hạn, tạo async job.
3. Mỗi recipient tạo một `notifications` row.
4. Dùng chung `batch_key` để truy vết.
5. Dedupe theo recipient + event_code + dedupe_key.
6. Không trả full danh sách notification IDs nếu quá lớn.

---

### 16.4 INTERNAL-NOTI-API-004: Chạy reminder job

```http
POST /internal/v1/notifications/reminder-jobs/run
```

#### Request body

```json
{
  "job_type": "TASK_DUE_SOON",
  "dry_run": false,
  "limit": 500
}
```

#### Business validation

1. Chỉ scheduler/job service được gọi.
2. Job phải có lock để tránh chạy song song trùng.
3. Dedupe key bắt buộc theo entity + reminder window.
4. Nếu `dry_run=true`, chỉ trả summary, không tạo notification.
5. Ghi technical job log.

---

### 16.5 INTERNAL-NOTI-API-005: Retry delivery job

```http
POST /internal/v1/notifications/delivery-jobs/retry
```

#### Business validation

1. Chỉ retry delivery log `Pending` hoặc `Failed` có `next_retry_at <= now()`.
2. Không retry quá `max_attempts`.
3. Batch size có giới hạn.
4. Mỗi retry cập nhật attempt/status atomically.
5. Cần lock row để tránh nhiều worker gửi trùng.

---

## 17. State machine

### 17.1 Notification status state machine

```text
Unread
  -> Read
  -> Hidden
  -> Archived
  -> Deleted

Read
  -> Unread       nếu cấu hình cho phép
  -> Hidden
  -> Archived
  -> Deleted

Hidden
  -> Read         nếu user mở lại / phase sau
  -> Archived
  -> Deleted

Archived
  -> Read         nếu unarchive phase sau
  -> Deleted

Deleted
  -> terminal trong API cá nhân MVP
```

### 17.2 Delivery status state machine

```text
Pending
  -> Sent
  -> Delivered
  -> Failed
  -> Skipped
  -> Cancelled

Failed
  -> Pending      khi retry
  -> Failed       nếu retry tiếp tục lỗi

Sent
  -> Delivered    nếu provider có callback xác nhận
  -> Failed       nếu provider callback lỗi sau khi gửi
```

---

## 18. Idempotency và chống trùng notification

### 18.1 API yêu cầu idempotency

| API | Bắt buộc |
| --- | --- |
| Tạo system notification | Có |
| Gửi system notification | Có |
| Internal event API | Có |
| Internal send/bulk-send | Có |
| Retry delivery log | Có/khuyến nghị |
| Mark read | Không bắt buộc, xử lý idempotent tự nhiên |
| Mark all read | Khuyến nghị |

### 18.2 Dedupe key

NOTI dùng `dedupe_key` để tránh spam notification khi event bị publish nhiều lần.

Format gợi ý:

```text
{EVENT_CODE}:{SOURCE_ENTITY_ID}:{RECIPIENT_USER_ID}:{OPTIONAL_WINDOW}
```

Ví dụ:

```text
TASK_ASSIGNED:task_uuid:user_uuid
TASK_DUE_SOON:task_uuid:user_uuid:2026-06-20
LEAVE_REQUEST_SUBMITTED:leave_uuid:manager_user_uuid
```

### 18.3 Quy tắc dedupe

1. Nếu event config `dedupe_enabled=true`, backend kiểm tra notification trùng theo `company_id + recipient_user_id + event_code + dedupe_key`.
2. Nếu trùng trong dedupe window, bỏ qua và tăng `deduped_count`.
3. Nếu dedupe key null với event quan trọng, backend có thể tự sinh từ source entity và recipient.
4. Bulk send phải dedupe theo từng recipient.
5. Không dedupe các event security critical nếu cấu hình bắt buộc gửi mọi lần.

---

## 19. Transaction, lock và concurrency

### 19.1 Tạo notification từ event

Quy trình transaction đề xuất:

```text
1. Validate internal caller.
2. Load notification_event với company override/global fallback.
3. Lock/kiểm tra idempotency key.
4. Resolve recipients.
5. Apply preference/channel config.
6. For each recipient:
   - Check dedupe.
   - Render template.
   - Insert notifications.
   - Insert notification_delivery_logs.
7. Commit.
8. Publish realtime event hoặc enqueue external delivery sau commit nếu có.
```

### 19.2 Mark read

```text
UPDATE notifications
SET status = 'Read', read_at = now(), updated_by = :current_user_id
WHERE id = :notification_id
  AND company_id = :company_id
  AND recipient_user_id = :current_user_id
  AND status <> 'Deleted';
```

Nếu row count = 0, trả not found/forbidden.

### 19.3 Mark all read

```text
UPDATE notifications
SET status = 'Read', read_at = now(), updated_by = :current_user_id
WHERE company_id = :company_id
  AND recipient_user_id = :current_user_id
  AND status = 'Unread'
  AND deleted_at IS NULL;
```

### 19.4 Delivery retry lock

Khi nhiều worker retry delivery:

1. Query log cần retry bằng `FOR UPDATE SKIP LOCKED`.
2. Mỗi worker chỉ xử lý batch nhỏ.
3. Cập nhật attempt/status trong transaction.
4. Không gửi provider trong transaction dài nếu provider chậm; có thể mark Processing/Pending locked theo thiết kế worker.

---

## 20. Audit log

### 20.1 Action bắt buộc ghi audit

| Action | Mã action đề xuất |
| --- | --- |
| Tạo system notification | `NOTI.SYSTEM_NOTIFICATION.CREATE` |
| Gửi system notification | `NOTI.SYSTEM_NOTIFICATION.SEND` |
| Xem notification người khác qua admin API | `NOTI.NOTIFICATION.ADMIN_VIEW` |
| Cập nhật event config | `NOTI.EVENT.UPDATE` |
| Tạo template | `NOTI.TEMPLATE.CREATE` |
| Cập nhật template | `NOTI.TEMPLATE.UPDATE` |
| Xóa mềm template | `NOTI.TEMPLATE.DELETE` |
| Cập nhật channel config | `NOTI.CHANNEL.UPDATE` |
| Retry delivery log | `NOTI.DELIVERY_LOG.RETRY` |
| Xem delivery payload nhạy cảm | `NOTI.DELIVERY_LOG.VIEW_PAYLOAD` |
| Export notification/log phase sau | `NOTI.EXPORT` |

### 20.2 Audit payload đề xuất

```json
{
  "module": "NOTI",
  "action": "NOTI.TEMPLATE.UPDATE",
  "target_type": "NotificationTemplate",
  "target_id": "template_uuid",
  "old_values": {
    "title_template": "Bạn có task mới"
  },
  "new_values": {
    "title_template": "Bạn vừa được giao task mới"
  },
  "metadata": {
    "event_code": "TASK_ASSIGNED",
    "channel": "IN_APP",
    "locale": "vi"
  }
}
```

### 20.3 Nguyên tắc audit bảo mật

1. Không ghi full secret/provider credential.
2. Không ghi token, password, private file URL.
3. Mask payload nếu chứa dữ liệu nhạy cảm.
4. Với bulk system notification, audit chỉ ghi recipient summary, không ghi danh sách hàng nghìn user nếu quá lớn.
5. User action cá nhân như mark read/hide/delete không bắt buộc audit để tránh log quá lớn, trừ khi company bật cấu hình audit chi tiết.

---

## 21. Notification event liên quan đến chính module NOTI

NOTI chủ yếu là module nhận event từ module khác. Tuy nhiên NOTI có thể phát event nội bộ/technical cho audit hoặc dashboard/cache nếu cần:

| Event | Khi nào phát | Người nhận |
| --- | --- | --- |
| `SYSTEM_NOTIFICATION_SENT` | Admin gửi thông báo hệ thống thủ công | Có thể gửi log/cảnh báo cho Admin/Super Admin nếu cấu hình |
| `NOTIFICATION_DELIVERY_FAILED` | Delivery EMAIL/PUSH/INTEGRATION thất bại nhiều lần | Admin/System operator |
| `NOTIFICATION_CHANNEL_DISABLED` | Kênh gửi bị tắt hoặc lỗi cấu hình | Admin/System operator |
| `NOTIFICATION_TEMPLATE_MISSING` | Event active nhưng không có template hợp lệ | Admin/System operator |
| `NOTIFICATION_EVENT_DISABLED` | Event bị disable | Không cần gửi, chỉ audit |

Nguyên tắc:

1. Tránh vòng lặp notification: event lỗi của NOTI không được tạo thêm lỗi vô hạn.
2. Event technical nên có rate limit/dedupe mạnh.
3. Cảnh báo admin chỉ gửi nếu cấu hình bật.

---

## 22. Error code NOTI

| Mã lỗi | HTTP status | Ý nghĩa |
| --- | ---: | --- |
| `NOTI-ERR-NOTIFICATION-NOT-FOUND` | 404 | Không tìm thấy notification hoặc không thuộc user hiện tại |
| `NOTI-ERR-NOTIFICATION-DELETED` | 410 | Notification đã bị xóa mềm/không còn truy cập |
| `NOTI-ERR-TARGET-UNAVAILABLE` | 422 | Notification không có target hợp lệ hoặc target đã hết hiệu lực |
| `NOTI-ERR-EVENT-NOT-FOUND` | 404 | Không tìm thấy notification event |
| `NOTI-ERR-EVENT-DISABLED` | 422 | Event đang bị tắt |
| `NOTI-ERR-TEMPLATE-NOT-FOUND` | 404 | Không tìm thấy template |
| `NOTI-ERR-TEMPLATE-INVALID` | 400 | Template không hợp lệ |
| `NOTI-ERR-TEMPLATE-VARIABLE-INVALID` | 400 | Biến template không hợp lệ hoặc bị cấm |
| `NOTI-ERR-CHANNEL-NOT-SUPPORTED` | 422 | Kênh gửi chưa hỗ trợ |
| `NOTI-ERR-CHANNEL-DISABLED` | 422 | Kênh gửi đang bị tắt |
| `NOTI-ERR-RECIPIENT-NOT-FOUND` | 422 | Không resolve được người nhận |
| `NOTI-ERR-RECIPIENT-INACTIVE` | 422 | Người nhận inactive/locked theo policy |
| `NOTI-ERR-DEDUPE-CONFLICT` | 409 | Notification đã được tạo trước đó theo dedupe key |
| `NOTI-ERR-DELIVERY-LOG-NOT-FOUND` | 404 | Không tìm thấy delivery log |
| `NOTI-ERR-DELIVERY-NOT-RETRYABLE` | 422 | Delivery log không đủ điều kiện retry |
| `NOTI-ERR-SYSTEM-NOTIFICATION-INVALID` | 400 | Thông báo hệ thống không hợp lệ |
| `AUTH-ERR-FORBIDDEN` | 403 | Không có permission |
| `AUTH-ERR-SCOPE-DENIED` | 403 | Không nằm trong data scope |
| `VALIDATION-ERR-001` | 400 | Dữ liệu không hợp lệ |
| `RESOURCE-ERR-CONFLICT` | 409 | Xung đột dữ liệu/idempotency |
| `SYSTEM-ERR-001` | 500 | Lỗi hệ thống |

---

## 23. Bảo mật và kiểm soát dữ liệu

### 23.1 Nguyên tắc bảo mật

1. User chỉ được xem notification của chính mình qua API cá nhân.
2. API admin phải có permission và data scope rõ ràng.
3. Backend không tin `company_id`, `user_id`, `recipient_user_id`, `role`, `permission` do frontend tự gửi nếu có thể resolve từ auth context.
4. Notification payload không chứa dữ liệu nhạy cảm quá mức.
5. Target URL chỉ là route nội bộ, không phải public file URL.
6. Khi user mở target, module gốc phải kiểm tra permission/data scope lại.
7. Template không được chứa secret hoặc biến nhạy cảm bị cấm.
8. Delivery provider payload/response phải mask secret/token.
9. Internal API phải có service authentication, không expose public.
10. Cần rate limit cho API mark all read, list, admin log và internal event API.

### 23.2 Payload key bị cấm

```text
password
password_hash
access_token
refresh_token
secret
api_key
identity_number
bank_account_number
salary
private_file_url
storage_path
raw_gps
precise_ip_location
```

### 23.3 Masking response

Admin/log response có thể mask:

```json
{
  "request_payload": {
    "email": "n***@company.com",
    "secret": "***MASKED***"
  }
}
```

---

## 24. Performance và query strategy

### 24.1 Query quan trọng

| Query | Mục tiêu |
| --- | --- |
| Unread count | Header badge phải nhanh |
| Dropdown latest | Mở dropdown nhanh, limit nhỏ |
| My notification list | Filter/sort/pagination theo user |
| Admin delivery logs | Có filter thời gian, không scan toàn bảng |
| Retry delivery logs | Query theo status + next_retry_at |
| Event/template effective config | Company override -> global fallback, cache được |

### 24.2 Index đề xuất

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

### 24.3 Cache đề xuất

| Cache | TTL gợi ý | Invalidate |
| --- | ---: | --- |
| Effective event config | 5-15 phút | Khi event config update |
| Effective template | 5-15 phút | Khi template update |
| Channel config | 5-15 phút | Khi channel update |
| Unread count | 15-30 giây nếu cần | Khi tạo notification/mark read/mark all/delete |
| Dropdown latest | 15-30 giây nếu cần | Khi tạo notification/mark read/delete |

### 24.4 Anti N+1

1. List notification không join target module.
2. Resolve employee/user summary theo batch nếu cần admin view.
3. Delivery logs chỉ include notification summary khi request `include_notification=true`.
4. Template render cache theo `company_id + event_code + channel + locale`.

---

## 25. Tích hợp liên module

### 25.1 Với AUTH

1. Xác thực user đang đăng nhập.
2. Kiểm tra user active/locked trước khi nhận notification nếu policy yêu cầu.
3. Kiểm tra permission, role, data scope.
4. Resolve role recipient cho system notification.

### 25.2 Với HR

1. Resolve employee -> user.
2. Resolve direct manager.
3. Resolve department recipients.
4. Gửi thông báo hồ sơ, hợp đồng, self-service profile change.
5. Không tự đọc dữ liệu nhạy cảm HR nếu không cần.

### 25.3 Với ATT

1. Nhận event điều chỉnh công, quên check-out, bất thường chấm công.
2. Gửi notification cho Employee/Manager/HR theo event.
3. Target URL trỏ về màn hình ATT tương ứng.

### 25.4 Với LEAVE

1. Nhận event đơn nghỉ submitted/approved/rejected/cancelled.
2. Resolve manager/HR/employee recipients.
3. Gửi notification kết quả duyệt nghỉ.
4. Target URL trỏ về chi tiết leave request.

### 25.5 Với TASK

1. Nhận event assigned/comment/mentioned/status changed/due soon/overdue.
2. Gửi notification cho assignee/watcher/mentioned user/project member.
3. Dedupe mạnh cho reminder due soon/overdue.

### 25.6 Với DASH

1. DASH đọc unread count và latest notifications.
2. DASH không tự tạo/cập nhật notification.
3. Khi user click notification trên Dashboard, điều hướng qua target URL và module gốc kiểm tra quyền.

### 25.7 Với FOUNDATION

1. Audit log cho action quản trị/cấu hình.
2. Company settings cho channel, retention, notification behavior.
3. Module catalog và seed notification events/templates.
4. Retention policy cho notification/delivery logs.

---

## 26. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/noti.paths.yaml`](openapi/paths/noti.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 26.1 Security

`bearerAuth` (HTTP bearer JWT) cho `/api/v1/notifications/*`; endpoint nhận event & gửi nội bộ `/internal/v1/notifications/*` dùng `internalServiceAuth`.

### 26.2 Tags của module

- `Notifications - My` — thông báo của tôi (list/dropdown/unread-count/detail/open-target)
- `Notifications - Actions` — đánh dấu đọc/ẩn/lưu trữ/xóa
- `Notifications - Admin` — quản trị thông báo & system notification
- `Notifications - Events` — cấu hình event
- `Notifications - Templates` — template thông báo
- `Notifications - Channels` — kênh gửi
- `Notifications - Delivery Logs` — log gửi & retry
- `Notifications - Internal` — nhận event / send / bulk-send / job nội bộ

### 26.3 Vendor extensions (đồng nhất toàn hệ thống)

| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated/Internal) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `noti`.

> Lưu ý chuẩn hóa (xem [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>) AUD-010): permission hiện dùng `NOTI.LOG.*`; đề xuất đổi thành `NOTI.DELIVERY_LOG.*` cho khớp resource. Spec hiện giữ nguyên `NOTI.LOG.*` cho tới khi chốt.

### 26.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `CursorParam`, `LimitParam`, `IdempotencyKey`.

### 26.5 DTO đề xuất cho module

`NotificationSummaryDto`, `NotificationDetailDto`, `UnreadCountDto`, `NotificationEventDto`, `NotificationTemplateDto`, `NotificationChannelConfigDto`, `NotificationDeliveryLogDto`, `CreateSystemNotificationRequest`, `InternalNotificationEventRequest`.

---

## 27. Test case API

### 27.1 My Notification API

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| NOTI-TC-001 | User lấy danh sách notification của mình | Chỉ thấy notification của mình |
| NOTI-TC-002 | User biết UUID notification của user khác | 404 hoặc 403 |
| NOTI-TC-003 | Filter status Unread | Chỉ trả Unread |
| NOTI-TC-004 | Dropdown limit > 20 | Backend giới hạn hoặc validation error |
| NOTI-TC-005 | Unread count | Count đúng, không tính Deleted/Hidden/Archived |
| NOTI-TC-006 | Xem chi tiết auto_mark_read | Status chuyển Read nếu hợp lệ |

### 27.2 Action API

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| NOTI-TC-101 | Mark read notification Unread | Chuyển Read, có read_at |
| NOTI-TC-102 | Mark read notification đã Read | Success idempotent |
| NOTI-TC-103 | Mark all read | Cập nhật đúng user hiện tại |
| NOTI-TC-104 | Hide notification | Không xuất hiện list mặc định |
| NOTI-TC-105 | Delete soft | Không xóa cứng, delivery log còn |

### 27.3 Event/template/channel API

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| NOTI-TC-301 | Admin xem events | Trả global + company override |
| NOTI-TC-302 | Company admin sửa global event | Tạo override hoặc forbidden theo policy |
| NOTI-TC-303 | Tạo template với biến không có trong schema | Validation error |
| NOTI-TC-304 | Template chứa biến bị cấm | Validation error |
| NOTI-TC-305 | Preview template | Render đúng nội dung |
| NOTI-TC-306 | Bật EMAIL khi provider chưa config | Business error hoặc NotReady theo policy |

### 27.4 Internal event API

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| NOTI-TC-401 | Event TASK_ASSIGNED hợp lệ | Tạo notification cho assignee |
| NOTI-TC-402 | Event disabled | Skipped hoặc business error theo policy |
| NOTI-TC-403 | Payload chứa token/password | Validation error |
| NOTI-TC-404 | Dedupe key trùng | Không tạo trùng, tăng deduped_count |
| NOTI-TC-405 | EmployeeIds recipient inactive | Skip theo policy |
| NOTI-TC-406 | Thiếu template company | Fallback global template |
| NOTI-TC-407 | Không có template nào | Log lỗi/template missing, không crash toàn job |

### 27.5 Delivery log/retry

| Mã test | Nội dung | Kỳ vọng |
| --- | --- | --- |
| NOTI-TC-501 | Xem delivery log không có quyền | 403 |
| NOTI-TC-502 | Retry Failed log | Tạo attempt mới hoặc set Pending |
| NOTI-TC-503 | Retry log Sent | Business error |
| NOTI-TC-504 | Retry quá max_attempts | Business error trừ override phase sau |

---

## 28. Checklist triển khai backend

1. Tạo route/controller cho My Notification API.
2. Tạo route/controller cho action API mark read/hide/archive/delete.
3. Tạo route/controller admin notification/log.
4. Tạo route/controller event/template/channel config.
5. Tạo internal controller cho event/send/bulk/reminder/retry.
6. Tạo NotificationService xử lý list/count/detail/action.
7. Tạo NotificationEventService xử lý event-driven.
8. Tạo RecipientResolver cho UserIds, EmployeeIds, RoleCodes, DepartmentIds, ManagerOfEmployee.
9. Tạo TemplateRenderer có validate biến và fallback company/global.
10. Tạo DedupeService theo event_code + recipient + dedupe_key.
11. Tạo DeliveryService cho IN_APP và khung mở rộng EMAIL/PUSH.
12. Tạo DeliveryRetryJob nếu bật kênh ngoài.
13. Tạo NotificationPermissionGuard cho Own/Company/System.
14. Tạo audit log cho action quản trị.
15. Tạo index theo DB-09/DB-07.
16. Seed notification events MVP.
17. Seed notification templates MVP.
18. Seed permissions NOTI và role-permission matrix.
19. Viết test unit cho renderer, resolver, dedupe, permission guard.
20. Viết test integration cho internal event -> notification -> unread count -> mark read.
21. Tạo OpenAPI/Swagger.
22. Kiểm tra không payload nhạy cảm trong notification.
23. Kiểm tra dashboard/header gọi endpoint nhẹ, không query nặng.

---

## 29. Roadmap triển khai API-07

### 29.1 Sprint 1 - User notification core

1. `GET /api/v1/notifications`.
2. `GET /api/v1/notifications/dropdown`.
3. `GET /api/v1/notifications/unread-count`.
4. `GET /api/v1/notifications/{id}`.
5. Mark read, mark all read, hide/delete.
6. Permission Own và index unread/dropdown.

### 29.2 Sprint 2 - Internal event pipeline

1. `POST /internal/v1/notifications/events`.
2. Event catalog lookup.
3. Recipient resolver cơ bản.
4. Template render.
5. Dedupe.
6. Insert notifications + delivery logs IN_APP.
7. Tích hợp TASK/LEAVE/ATT/HR event cơ bản.

### 29.3 Sprint 3 - Admin config

1. Event list/config.
2. Template CRUD + preview.
3. Channel config IN_APP.
4. Audit log cấu hình.
5. Seed event/template MVP.

### 29.4 Sprint 4 - Admin logs & system notification

1. Delivery log list/detail.
2. Retry framework cơ bản.
3. System notification manual create/send.
4. Bulk recipient resolve theo role/department/company.
5. Rate limit và idempotency.

### 29.5 Sprint 5 - Hardening & dashboard integration

1. Optimize unread/dropdown.
2. Cache effective template/event config.
3. Security payload sanitizer.
4. Dashboard widget integration.
5. Regression tests liên module.

---

## 30. Kết luận

API-07 định nghĩa đầy đủ nhóm API cho module NOTI trong MVP Version 1.0.

Các điểm quan trọng cần giữ khi triển khai:

1. NOTI là module event-driven, nhận event từ AUTH, HR, ATT, LEAVE, TASK, DASH và FOUNDATION.
2. API cá nhân chỉ cho user xem và xử lý notification của chính mình.
3. Admin API phải kiểm tra permission + data scope, không hard-code role.
4. Một notification row tương ứng một recipient để quản lý read/unread/hide/delete riêng.
5. Notification payload chỉ chứa dữ liệu điều hướng/hiển thị an toàn, không chứa dữ liệu nhạy cảm.
6. Module target phải kiểm tra quyền lại khi user mở chi tiết nghiệp vụ từ notification.
7. Internal event API phải có idempotency và dedupe để tránh spam.
8. Template/event/channel có company override và fallback global.
9. Delivery log tách riêng để hỗ trợ nhiều kênh và retry ở phase sau.
10. Unread count và dropdown phải có index/query tối ưu vì được gọi thường xuyên.
11. Cấu hình, gửi system notification, retry delivery log và xem log người khác phải ghi audit log.
12. Thiết kế đủ mở để phát triển realtime WebSocket, mobile push, email, digest, preference, automation và AI ở các phase sau.
