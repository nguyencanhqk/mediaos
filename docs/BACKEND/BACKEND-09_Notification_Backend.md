# BACKEND-09: NOTIFICATION BACKEND
# TRIỂN KHAI BACKEND MODULE THÔNG BÁO HỆ THỐNG
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · **BACKEND-09 Notification** · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-08 NOTI](<../SPEC/SPEC-08 NOTI.md>) · [DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [API: API-07 NOTI](<../API Design/API-07_NOTI_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Frontend: FRONTEND-12](<../FRONTEND/FRONTEND-12_Notification_Frontend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-09 |
| Tên tài liệu | Notification Backend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | NOTI - Thông báo hệ thống |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-08 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-09 mô tả cách triển khai backend cho module **NOTI - Thông báo hệ thống**.

Tài liệu này dùng để:

1. Chốt phạm vi backend module Notification trong MVP.
2. Chốt kiến trúc service xử lý thông báo theo event.
3. Chốt entity, repository, DTO, controller, service, job và guard cần triển khai.
4. Chuẩn hóa cách module khác phát event sang NOTI.
5. Chuẩn hóa cách tạo notification in-app theo từng người nhận.
6. Chuẩn hóa unread count, notification dropdown, danh sách, chi tiết, mark read, mark all read, hide/archive/delete soft.
7. Chuẩn hóa quản trị notification event, template, channel và delivery log.
8. Chuẩn hóa cơ chế dedupe, idempotency, retry, throttle và chống spam.
9. Bảo đảm backend luôn kiểm tra authentication, permission, data scope, recipient ownership và company isolation.
10. Làm cơ sở cho QA viết test case, frontend tích hợp API và DevOps cấu hình job/queue.

---

## 3. Vị trí BACKEND-09 trong roadmap backend

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
BACKEND-04: Foundation Backend
BACKEND-05: HR Backend
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
BACKEND-11: File, Audit, Settings & System Jobs
BACKEND-12: API Integration Contract & OpenAPI/Swagger
BACKEND-13: Backend Testing, Security & Performance
BACKEND-14: Backend Release Readiness
```

BACKEND-09 nằm sau các backend nghiệp vụ chính vì module NOTI cần nhận event từ AUTH, HR, ATT, LEAVE và TASK.

---

## 4. Căn cứ triển khai

BACKEND-09 bám theo các quyết định đã chốt:

1. NOTI là module dùng chung để tạo thông báo khi có sự kiện quan trọng.
2. NOTI trong MVP ưu tiên in-app notification.
3. Email có thể chừa cấu hình/log cơ bản, chưa bắt buộc delivery provider đầy đủ.
4. WebSocket, push notification, Slack/Teams và digest chuyển sang phase sau.
5. NOTI nhận event từ module nguồn, resolve người nhận, render template và tạo notification.
6. NOTI không xử lý nghiệp vụ gốc như task, đơn nghỉ, bảng công hoặc hồ sơ nhân viên.
7. Mỗi dòng `notifications` tương ứng một người nhận.
8. User API chỉ xem/sửa notification của chính user hiện tại.
9. Admin API phải kiểm tra permission và data scope trước khi xem notification/log/config trong company.
10. Mọi query dữ liệu vận hành phải filter `company_id` từ auth context hoặc internal event context.
11. Payload notification chỉ chứa dữ liệu hiển thị/điều hướng an toàn, không chứa dữ liệu nhạy cảm.
12. Khi người dùng bấm notification, module gốc vẫn phải kiểm tra quyền và business rule trước khi trả dữ liệu chi tiết.
13. Notification unread count và dropdown là query nóng, cần index và cache ngắn nếu cần.
14. Tạo/sửa event/template/channel/system notification phải ghi audit log.
15. Seed MVP phải có notification events/templates và permissions tương ứng.

---

## 5. Phạm vi BACKEND-09

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung triển khai |
| --- | --- |
| Entity/ORM | `notification_events`, `notification_templates`, `notifications`, `notification_delivery_logs`, `notification_preferences` nếu tạo sớm |
| Repository | Query notification cá nhân, admin list, unread count, dropdown, event/template config, delivery logs |
| Public API | Danh sách của tôi, dropdown, unread count, detail, mark read, mark all read, hide, archive, delete soft, target resolve |
| Admin API | Quản lý event, template, channel config, system notification, delivery log, retry |
| Internal API | Nhận event từ module khác, send direct, bulk send, reminder job, retry delivery |
| Service | Event consumer, recipient resolver, template renderer, notification creator, delivery service, action service |
| Job | Reminder due/overdue, retry delivery, cleanup/retention, optional cache warmup |
| Security | Auth guard, permission guard, recipient ownership guard, company guard, internal service token guard |
| Dedupe | Dedupe theo `dedupe_key`, event/entity/recipient hoặc time window |
| Dashboard integration | Unread count + latest notifications cho DASH/header |
| Audit | Audit cấu hình event/template/channel/system notification/retry log |
| Observability | Log structured, metric count, failed delivery, slow query, queue lag |
| Test | Unit, integration, permission, data scope, dedupe, idempotency, retry, E2E API |

### 5.2 Chưa bao gồm trong MVP

| Nội dung | Hướng phase sau |
| --- | --- |
| WebSocket realtime đầy đủ | Gateway riêng hoặc pub/sub event `NOTIFICATION_CREATED` |
| Mobile push | Bổ sung device token và push provider |
| Email nâng cao | Provider config, retry nâng cao, bounce tracking |
| Digest hằng ngày/tuần | Job gom notification theo user |
| Preference cá nhân nâng cao | Quiet hours, DND, channel preference theo event |
| Notification grouping | Group theo entity/event để giảm spam |
| Rule engine notification | Cấu hình điều kiện gửi nâng cao |
| Analytics tỷ lệ đọc | Bảng aggregate/read analytics |
| AI summary notification | Phase AI riêng |

---

## 6. Nguyên tắc kiến trúc

### 6.1 NOTI là event-driven module

Luồng chuẩn:

```text
Module nguồn thao tác nghiệp vụ thành công
-> Module nguồn commit transaction nghiệp vụ
-> Module nguồn publish notification event
-> NOTI consume event
-> NOTI validate event + company + source module
-> NOTI resolve recipients
-> NOTI lấy event config/template active
-> NOTI render title/content/target payload
-> NOTI tạo một notification cho mỗi recipient
-> NOTI ghi delivery log IN_APP
-> NOTI publish lightweight event cho badge/cache/realtime phase sau
```

### 6.2 Không xử lý nghiệp vụ gốc trong NOTI

NOTI không được:

1. Duyệt đơn nghỉ.
2. Cập nhật trạng thái task.
3. Điều chỉnh bảng công.
4. Sửa hồ sơ nhân viên.
5. Tự quyết định quyền truy cập chi tiết entity gốc.

NOTI chỉ lưu thông tin tóm tắt và target điều hướng.

### 6.3 Một notification cho một người nhận

```text
1 notification row = 1 recipient_user_id
```

Khi gửi cho nhiều người:

```text
1 event -> n recipients -> n notification rows
```

Dùng chung:

1. `event_code`
2. `source_entity_type`
3. `source_entity_id`
4. `batch_key`
5. `dedupe_key`

### 6.4 Payload an toàn

Payload chỉ nên chứa:

```json
{
  "target_module": "TASK",
  "target_type": "Task",
  "target_id": "task-uuid",
  "target_url": "/tasks/task-uuid",
  "display_code": "TASK-000123",
  "display_title": "Thiết kế API NOTI"
}
```

Payload không được chứa:

1. CCCD/CMND.
2. Số tài khoản ngân hàng.
3. Lương.
4. Lý do nghỉ nhạy cảm.
5. GPS/IP chi tiết.
6. Full contract content.
7. Private file URL hoặc storage path.
8. Token hoặc secret provider.

---

## 7. Kiến trúc module backend

### 7.1 Module boundary

```text
NotificationModule
  -> controllers
  -> internal controllers
  -> admin controllers
  -> services
  -> repositories
  -> entities
  -> dto
  -> jobs
  -> events
  -> guards
  -> policies
  -> renderers
  -> mappers
```

### 7.2 Dependency inbound

Các module có thể gọi NOTI:

| Module nguồn | Ví dụ event |
| --- | --- |
| AUTH | `AUTH_USER_CREATED`, `AUTH_USER_LOCKED`, `AUTH_PASSWORD_RESET_REQUESTED` |
| HR | `HR_PROFILE_CHANGE_SUBMITTED`, `HR_PROFILE_CHANGE_APPROVED`, `HR_CONTRACT_EXPIRING` |
| ATT | `ATT_MISSING_CHECKOUT`, `ATT_ADJUSTMENT_SUBMITTED`, `ATT_ADJUSTMENT_APPROVED` |
| LEAVE | `LEAVE_REQUEST_SUBMITTED`, `LEAVE_REQUEST_APPROVED`, `LEAVE_REQUEST_REJECTED` |
| TASK | `TASK_ASSIGNED`, `TASK_STATUS_CHANGED`, `TASK_COMMENT_CREATED`, `TASK_MENTIONED`, `TASK_DUE_SOON`, `TASK_OVERDUE` |
| DASH/SYSTEM | `SYSTEM_CONFIG_WARNING`, `DASHBOARD_ALERT_CREATED` |

### 7.3 Dependency outbound

NOTI cần đọc/ghi hoặc gọi service từ:

| Module | Mục đích |
| --- | --- |
| AUTH | Validate user active, permission, internal token, current user |
| HR | Resolve employee, direct manager, HR recipients, department scope |
| FOUNDATION | Audit log, settings, company settings, module catalog, seed, retention |
| DASH | Không gọi nghiệp vụ gốc; chỉ cung cấp unread count/latest notifications cho DASH |
| Queue/Job | Xử lý async, retry, reminder |
| Cache | Optional cache unread count hoặc event/template config |

---

## 8. Cấu trúc thư mục đề xuất

```text
src/modules/notifications/
  notifications.module.ts

  controllers/
    my-notifications.controller.ts
    notification-actions.controller.ts
    notification-target.controller.ts
    admin-notifications.controller.ts
    notification-events.controller.ts
    notification-templates.controller.ts
    notification-channels.controller.ts
    notification-delivery-logs.controller.ts
    system-notifications.controller.ts
    internal-notification-events.controller.ts
    internal-notification-send.controller.ts

  dto/
    query-my-notifications.dto.ts
    notification-summary.dto.ts
    notification-detail.dto.ts
    unread-count.dto.ts
    mark-read.dto.ts
    mark-all-read.dto.ts
    hide-notification.dto.ts
    archive-notification.dto.ts
    create-notification-event.dto.ts
    update-notification-event.dto.ts
    create-notification-template.dto.ts
    update-notification-template.dto.ts
    create-system-notification.dto.ts
    internal-notification-event.dto.ts
    internal-direct-send.dto.ts
    internal-bulk-send.dto.ts
    delivery-log-query.dto.ts

  entities/
    notification-event.entity.ts
    notification-template.entity.ts
    notification.entity.ts
    notification-delivery-log.entity.ts
    notification-preference.entity.ts

  repositories/
    notification-events.repository.ts
    notification-templates.repository.ts
    notifications.repository.ts
    notification-delivery-logs.repository.ts
    notification-preferences.repository.ts

  services/
    notification-event-consumer.service.ts
    notification-event-config.service.ts
    notification-recipient-resolver.service.ts
    notification-template-renderer.service.ts
    notification-create.service.ts
    notification-delivery.service.ts
    notification-action.service.ts
    notification-query.service.ts
    notification-target.service.ts
    notification-admin.service.ts
    notification-system-send.service.ts
    notification-dedupe.service.ts
    notification-channel.service.ts
    notification-preference.service.ts
    notification-read-model.service.ts

  jobs/
    notification-reminder.job.ts
    notification-delivery-retry.job.ts
    notification-retention-cleanup.job.ts
    notification-stale-cache-cleanup.job.ts

  events/
    notification-event-payload.interface.ts
    notification-created.event.ts
    notification-read.event.ts
    notification-delivery-failed.event.ts

  guards/
    notification-owner.guard.ts
    notification-admin-scope.guard.ts
    internal-notification-token.guard.ts

  policies/
    notification.policy.ts
    notification-admin.policy.ts
    notification-template.policy.ts

  constants/
    notification-status.enum.ts
    notification-type.enum.ts
    notification-channel.enum.ts
    notification-priority.enum.ts
    notification-permissions.ts
    notification-error-codes.ts

  mappers/
    notification.mapper.ts
    notification-event.mapper.ts
    notification-template.mapper.ts
    delivery-log.mapper.ts

  validators/
    notification-payload.validator.ts
    template-variable.validator.ts
    recipient.validator.ts
```

---

## 9. Entity cần triển khai

### 9.1 NotificationEventEntity

Map bảng `notification_events`.

Field chính:

| Field | Ghi chú |
| --- | --- |
| `id` | UUID |
| `company_id` | Nullable, null = global default |
| `module_code` | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/SYSTEM |
| `event_code` | Unique theo global/company |
| `event_name` | Tên hiển thị |
| `description` | Mô tả |
| `notification_type` | System/Account/HR/Attendance/Leave/Task/Project/Approval/Reminder/Warning/Error |
| `default_priority` | Low/Normal/High/Urgent/Critical |
| `default_channels` | JSONB, MVP tối thiểu `["IN_APP"]` |
| `recipient_rule_config` | JSONB |
| `dedupe_strategy` | None/DedupeKey/TimeWindow/EntityRecipient |
| `dedupe_window_seconds` | INT nullable |
| `throttle_config` | JSONB nullable |
| `is_enabled` | BOOLEAN |
| `is_system_event` | BOOLEAN |
| `metadata` | JSONB |
| audit fields | `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by` |

### 9.2 NotificationTemplateEntity

Map bảng `notification_templates`.

Field chính:

| Field | Ghi chú |
| --- | --- |
| `id` | UUID |
| `company_id` | Nullable |
| `event_id` | FK notification_events |
| `template_code` | Unique theo event/channel/locale |
| `channel` | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `locale` | vi-VN mặc định |
| `title_template` | Template tiêu đề |
| `short_template` | Template nội dung ngắn |
| `content_template` | Template nội dung đầy đủ |
| `variables_schema` | JSONB |
| `status` | Active/Inactive/Draft/Deprecated |
| `is_default` | BOOLEAN |
| `metadata` | JSONB |
| audit fields | đầy đủ |

### 9.3 NotificationEntity

Map bảng `notifications`.

Field chính:

| Field | Ghi chú |
| --- | --- |
| `id` | UUID |
| `company_id` | Bắt buộc |
| `recipient_user_id` | Bắt buộc |
| `recipient_employee_id` | Nullable |
| `event_id` | Nullable/FK |
| `template_id` | Nullable/FK |
| `event_code` | Snapshot để query nhanh |
| `source_module` | AUTH/HR/ATT/LEAVE/TASK/DASH/SYSTEM |
| `source_entity_type` | Task/LeaveRequest/AttendanceAdjustment/... |
| `source_entity_id` | UUID/string nullable |
| `title` | Rendered title |
| `short_content` | DTO field — ánh xạ cột DB `short_body` (xem mapping bên dưới) |
| `content` | DTO field — ánh xạ cột DB `body` (xem mapping bên dưới) |
| `notification_type` | Snapshot |
| `priority` | Snapshot |
| `status` | Unread/Read/Hidden/Archived/Deleted |
| `payload` | JSONB an toàn |
| `target_module` | Module điều hướng |
| `target_type` | Entity type điều hướng |
| `target_id` | Entity id điều hướng |
| `target_url` | Route frontend hoặc route registry key |
| `batch_key` | Dùng cho bulk/system notification |
| `dedupe_key` | Chống trùng |
| `read_at` | Nullable |
| `hidden_at` | Nullable |
| `archived_at` | Nullable |
| `deleted_at` | Soft delete theo user/admin |
| `expires_at` | Nullable |
| audit fields | `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_by` |

#### Mapping DTO ↔ cột DB (X-33)

DTO/API/FE dùng `content`/`short_content`; cột DB-07 là `body`/`short_body`. Mapper bắt buộc ánh xạ:

| DTO/API field | Cột DB (`notifications`) |
| --- | --- |
| `content` | `body` |
| `short_content` | `short_body` |

Repository select dùng alias `body AS content`, `short_body AS short_content`; khi insert, mapper ghi `content -> body`, `short_content -> short_body`. Không đổi tên cột DB và không đổi tên field DTO — chỉ ánh xạ qua mapper.

### 9.4 NotificationDeliveryLogEntity

Map bảng `notification_delivery_logs`.

Field chính:

| Field | Ghi chú |
| --- | --- |
| `id` | UUID |
| `company_id` | Bắt buộc |
| `notification_id` | FK |
| `recipient_user_id` | Bắt buộc |
| `channel` | IN_APP/EMAIL/PUSH/REALTIME/INTEGRATION |
| `provider` | internal/email_provider/etc |
| `delivery_status` | Pending/Sent/Delivered/Failed/Skipped/Cancelled |
| `attempt_no` | Số lần thử |
| `max_attempts` | Số lần tối đa |
| `external_message_id` | Nullable |
| `error_code` | Nullable |
| `error_message` | Phải mask secret |
| `provider_response` | JSONB, phải sanitize |
| `scheduled_at` | Nullable |
| `sent_at` | Nullable |
| `delivered_at` | Nullable |
| `failed_at` | Nullable |
| `next_retry_at` | Nullable |
| `created_at` | Timestamp |

### 9.5 NotificationPreferenceEntity

Có thể tạo ở mức cơ bản trong MVP để giảm refactor.

Field gợi ý:

| Field | Ghi chú |
| --- | --- |
| `id` | UUID |
| `company_id` | Bắt buộc |
| `user_id` | Bắt buộc |
| `event_code` | Nullable, null = default user preference |
| `channel` | IN_APP/EMAIL/PUSH |
| `is_enabled` | BOOLEAN |
| `quiet_hours_config` | JSONB nullable, phase sau |
| `metadata` | JSONB |
| audit fields | đầy đủ |

MVP có thể chỉ dùng company/channel setting, chưa mở UI preference cá nhân.

---

## 10. Repository cần triển khai

### 10.1 NotificationsRepository

Method đề xuất:

```ts
findMyNotifications(params)
findMyNotificationById(notificationId, currentUserId, companyId)
countUnread(currentUserId, companyId)
getDropdown(currentUserId, companyId, limit)
markRead(notificationId, currentUserId, companyId)
markAllRead(currentUserId, companyId)
hide(notificationId, currentUserId, companyId)
archive(notificationId, currentUserId, companyId)
softDeleteOwn(notificationId, currentUserId, companyId)
insertNotification(data, trx)
bulkInsertNotifications(rows, trx)
existsByDedupe(companyId, recipientUserId, eventCode, dedupeKey)
findAdminNotifications(params, scope)
```

### 10.2 NotificationEventsRepository

```ts
findActiveEventByCode(companyId, eventCode)
findGlobalEventByCode(eventCode)
findCompanyOverrideEvent(companyId, eventCode)
listEvents(params)
createEvent(data)
updateEvent(id, data)
softDeleteEvent(id)
setEnabled(id, enabled)
```

### 10.3 NotificationTemplatesRepository

```ts
findActiveTemplate(companyId, eventId, channel, locale)
findFallbackTemplate(eventId, channel, locale)
listTemplates(params)
createTemplate(data)
updateTemplate(id, data)
softDeleteTemplate(id)
setStatus(id, status)
```

### 10.4 NotificationDeliveryLogsRepository

```ts
createLog(data, trx)
markSent(logId, data)
markFailed(logId, error)
markSkipped(logId, reason)
findRetryableLogs(now, limit)
listDeliveryLogs(params, scope)
findByNotificationId(notificationId, scope)
```

### 10.5 NotificationPreferencesRepository

```ts
findUserPreference(companyId, userId, eventCode, channel)
findCompanyChannelConfig(companyId, channel)
upsertPreference(data)
```

---

## 11. DTO và response contract

### 11.1 NotificationSummaryDto

```ts
export interface NotificationSummaryDto {
  notification_id: string;
  title: string;
  short_content: string;
  notification_type: string;
  priority: string;
  status: 'Unread' | 'Read' | 'Hidden' | 'Archived' | 'Deleted';
  is_read: boolean;
  source_module: string;
  event_code: string;
  target_module?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_url?: string | null;
  created_at: string;
  read_at?: string | null;
}
```

### 11.2 NotificationDetailDto

```ts
export interface NotificationDetailDto extends NotificationSummaryDto {
  content: string;
  source_entity_type?: string | null;
  source_entity_id?: string | null;
  target: {
    target_module?: string | null;
    target_type?: string | null;
    target_id?: string | null;
    target_url?: string | null;
  };
  payload: Record<string, unknown>;
  expires_at?: string | null;
}
```

### 11.3 UnreadCountDto

```ts
export interface UnreadCountDto {
  unread_count: number;
  high_priority_unread_count: number;
  urgent_unread_count: number;
  last_notification_at: string | null;
}
```

### 11.4 InternalNotificationEventDto

```ts
export interface InternalNotificationEventDto {
  event_code: string;
  company_id: string;
  source_module: 'AUTH' | 'HR' | 'ATT' | 'LEAVE' | 'TASK' | 'DASH' | 'SYSTEM';
  source_entity_type?: string;
  source_entity_id?: string;
  actor_user_id?: string;
  actor_employee_id?: string;
  recipients?: Array<{
    user_id?: string;
    employee_id?: string;
    role_code?: string;
    resolver_key?: string;
  }>;
  variables: Record<string, unknown>;
  payload?: Record<string, unknown>;
  target?: {
    target_module: string;
    target_type: string;
    target_id: string;
    target_url?: string;
  };
  dedupe_key?: string;
  batch_key?: string;
  occurred_at: string;
  idempotency_key?: string;
}
```

### 11.5 CreateSystemNotificationDto

```ts
export interface CreateSystemNotificationDto {
  title: string;
  content: string;
  short_content?: string;
  notification_type: 'System' | 'Warning' | 'Error' | 'Reminder';
  priority: 'Low' | 'Normal' | 'High' | 'Urgent' | 'Critical';
  recipient_user_ids?: string[];
  recipient_role_codes?: string[];
  recipient_department_ids?: string[];
  target?: {
    target_module?: string;
    target_type?: string;
    target_id?: string;
    target_url?: string;
  };
  expires_at?: string;
}
```

---

## 12. Public API cần triển khai

Base prefix:

```http
/api/v1/notifications
```

### 12.1 NOTI-API-001: Lấy danh sách thông báo của tôi

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/notifications` |
| Permission | `NOTI.NOTIFICATION.VIEW_OWN` |
| Data scope | Own |
| Auth | Bắt buộc |
| Cache | Không cache hoặc cache ngắn 5-15 giây |

Query params:

```http
GET /api/v1/notifications?status=Unread&source_module=TASK&priority=High&page=1&per_page=20
```

Validation:

1. Backend resolve `current_user_id` từ token.
2. Luôn filter `recipient_user_id = current_user_id`.
3. Luôn filter `company_id = current_company_id`.
4. Không cho truyền `recipient_user_id` để xem người khác.
5. Không trả payload nhạy cảm.

### 12.2 NOTI-API-002: Lấy dropdown/header notifications

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/notifications/dropdown` |
| Permission | `NOTI.NOTIFICATION.VIEW_OWN` |
| Data scope | Own |
| Limit | Tối đa 20 |

Response data gồm:

```json
{
  "unread_count": 12,
  "items": []
}
```

### 12.3 NOTI-API-003: Đếm unread count

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/notifications/unread-count` |
| Permission | `NOTI.NOTIFICATION.COUNT_UNREAD_OWN` |
| Data scope | Own |
| Cache | Có thể cache cực ngắn theo user 5-10 giây nếu cần |

### 12.4 NOTI-API-004: Xem chi tiết notification

| Trường | Nội dung |
| --- | --- |
| Method | GET |
| Endpoint | `/api/v1/notifications/{notification_id}` |
| Permission | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Data scope | Own |

Validation:

1. Notification phải thuộc company hiện tại.
2. Notification phải có `recipient_user_id = current_user_id`.
3. Nếu status `Deleted`, trả 404 hoặc 410 theo policy.
4. Không tự động mark read nếu product chưa chốt; nếu tự mark thì phải ghi rõ behavior.

### 12.5 NOTI-API-005: Mark read một notification

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/notifications/{notification_id}/mark-read` |
| Permission | `NOTI.NOTIFICATION.MARK_READ_OWN` |
| Data scope | Own |
| Idempotency | Nên hỗ trợ |

Rule:

1. Nếu đã Read thì trả success idempotent.
2. Chỉ update notification của user hiện tại.
3. Set `status = Read`, `read_at = now()`.

### 12.6 NOTI-API-006: Mark all read

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/notifications/mark-all-read` |
| Permission | `NOTI.NOTIFICATION.MARK_ALL_READ_OWN` |
| Data scope | Own |
| Transaction | Bắt buộc |

Optional body:

```json
{
  "source_module": "TASK",
  "notification_type": "Task"
}
```

Rule:

1. Chỉ mark all notification của user hiện tại.
2. Không mark các notification `Hidden`, `Archived`, `Deleted` nếu policy không cho.
3. Có thể filter theo source/type.

### 12.7 NOTI-API-007: Hide notification

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/notifications/{notification_id}/hide` |
| Permission | `NOTI.NOTIFICATION.HIDE_OWN` |
| Data scope | Own |

### 12.8 NOTI-API-008: Archive notification

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/notifications/{notification_id}/archive` |
| Permission | `NOTI.NOTIFICATION.HIDE_OWN` |
| Data scope | Own |

> Archive dùng chung permission `NOTI.NOTIFICATION.HIDE_OWN` (đã bỏ biến thể mơ hồ `ARCHIVE_OWN`).

### 12.9 NOTI-API-009: Delete soft notification của tôi

| Trường | Nội dung |
| --- | --- |
| Method | DELETE |
| Endpoint | `/api/v1/notifications/{notification_id}` |
| Permission | `NOTI.NOTIFICATION.DELETE_OWN` |
| Data scope | Own |

Rule:

1. Đây là xóa mềm khỏi danh sách cá nhân.
2. Không xóa cứng record.
3. Set `status = Deleted`, `deleted_at`, `deleted_by`.

### 12.10 NOTI-API-010: Resolve target/deep link an toàn (open-target)

| Trường | Nội dung |
| --- | --- |
| Method | POST |
| Endpoint | `/api/v1/notifications/{notification_id}/open-target` |
| Permission | `NOTI.NOTIFICATION.VIEW_DETAIL_OWN` |
| Data scope | Own |

Request body:

```json
{ "mark_read": true }
```

Rule:

1. NOTI chỉ trả target metadata (`target_module/target_type/target_id/target_url`) cùng `can_open`/`reason`.
2. Nếu `mark_read = true` và notification đang Unread, mark read trong cùng request (idempotent).
3. Module gốc vẫn kiểm tra quyền khi frontend điều hướng.
4. Nếu target module inactive hoặc missing, trả degraded state (`can_open = false`, `reason`).

> Chuẩn endpoint theo API-07 §11.5. Thay cho biến thể cũ `GET /{id}/target` (đã bỏ).

---

## 13. Admin API cần triển khai

Base prefix:

```http
/api/v1/notifications/admin
```

Hoặc giữ chung `/api/v1/notifications` nhưng chia route bằng permission. Đề xuất dùng `/admin` để rõ boundary.

### 13.1 Xem notification toàn công ty

```http
GET /api/v1/notifications/admin/notifications
```

Permission:

```text
NOTI.NOTIFICATION.VIEW_COMPANY
```

Scope:

```text
Company/System
```

Validation:

1. Admin công ty chỉ xem `company_id` hiện tại.
2. Super Admin scope System mới xem liên công ty nếu endpoint hỗ trợ.
3. Mặc định mask payload nếu thiếu quyền chi tiết.

### 13.2 Quản lý event notification

```http
GET    /api/v1/notifications/admin/events
POST   /api/v1/notifications/admin/events
GET    /api/v1/notifications/admin/events/{event_id}
PATCH  /api/v1/notifications/admin/events/{event_id}
POST   /api/v1/notifications/admin/events/{event_id}/enable
POST   /api/v1/notifications/admin/events/{event_id}/disable
DELETE /api/v1/notifications/admin/events/{event_id}
```

Permission:

```text
NOTI.EVENT.VIEW
NOTI.EVENT.CONFIG
```

Rule:

1. System event không cho xóa nếu không có scope System.
2. Disable event chỉ chặn notification mới, không xóa notification cũ.
3. Mọi thay đổi phải ghi audit log.

### 13.3 Quản lý template notification

```http
GET    /api/v1/notifications/admin/templates
POST   /api/v1/notifications/admin/templates
GET    /api/v1/notifications/admin/templates/{template_id}
PATCH  /api/v1/notifications/admin/templates/{template_id}
POST   /api/v1/notifications/admin/templates/{template_id}/preview
POST   /api/v1/notifications/admin/templates/{template_id}/activate
POST   /api/v1/notifications/admin/templates/{template_id}/deactivate
DELETE /api/v1/notifications/admin/templates/{template_id}
```

Permission:

```text
NOTI.TEMPLATE.VIEW
NOTI.TEMPLATE.CREATE
NOTI.TEMPLATE.UPDATE
NOTI.TEMPLATE.DELETE
```

Rule:

1. Validate `variables_schema`.
2. Preview không tạo notification thật.
3. Template inactive không dùng cho notification mới.
4. Nếu không có company template active thì fallback global template active.

### 13.4 Channel config API

```http
GET   /api/v1/notifications/admin/channels
PATCH /api/v1/notifications/admin/channels/{channel}
```

Permission:

```text
NOTI.CHANNEL.VIEW
NOTI.CHANNEL.UPDATE
```

MVP:

1. IN_APP luôn enabled.
2. EMAIL có thể có setting enabled/disabled nhưng chưa bắt buộc provider đầy đủ.
3. PUSH/REALTIME/INTEGRATION để inactive hoặc coming soon.

### 13.5 Delivery log API

```http
GET  /api/v1/notifications/admin/delivery-logs
GET  /api/v1/notifications/admin/delivery-logs/{delivery_log_id}
POST /api/v1/notifications/admin/delivery-logs/{delivery_log_id}/retry
```

Permission:

```text
NOTI.LOG.VIEW
NOTI.LOG.RETRY
```

Rule:

1. Mask provider response secret.
2. Retry chỉ cho status Failed/Pending quá hạn.
3. Ghi audit log khi retry thủ công.

### 13.6 System notification API

```http
POST /api/v1/notifications/admin/system-notifications
POST /api/v1/notifications/admin/system-notifications/{batch_key}/send
```

Permission:

```text
NOTI.NOTIFICATION.CREATE_SYSTEM
NOTI.NOTIFICATION.SEND_SYSTEM
```

Rule:

1. Validate recipient list nằm trong company/scope.
2. Nếu gửi theo role/department phải resolve recipients bằng HR/AUTH.
3. Hạn chế bulk lớn hoặc chuyển qua job.
4. Ghi audit log bắt buộc.

---

## 14. Internal API và event contract

Base prefix:

```http
/internal/v1/notifications
```

Internal API không được gọi từ frontend/mobile.

### 14.1 Internal event API

```http
POST /internal/v1/notifications/events
```

Header:

```http
Authorization: Bearer <internal_service_token>
Idempotency-Key: <event-idempotency-key>
X-Source-Module: TASK
X-Request-Id: req_xxx
```

Body:

```json
{
  "event_code": "TASK_ASSIGNED",
  "company_id": "company-uuid",
  "source_module": "TASK",
  "source_entity_type": "Task",
  "source_entity_id": "task-uuid",
  "actor_user_id": "manager-user-uuid",
  "recipients": [
    { "user_id": "assignee-user-uuid" }
  ],
  "variables": {
    "task_title": "Thiết kế API module NOTI",
    "project_name": "EMS MVP"
  },
  "target": {
    "target_module": "TASK",
    "target_type": "Task",
    "target_id": "task-uuid",
    "target_url": "/tasks/task-uuid"
  },
  "dedupe_key": "TASK_ASSIGNED:task-uuid:assignee-user-uuid",
  "occurred_at": "2026-06-20T10:00:00+07:00"
}
```

Processing rule:

1. Validate service token.
2. Validate source module active.
3. Validate company active.
4. Validate event exists and enabled.
5. Validate recipient list hoặc recipient resolver config.
6. Sanitize payload.
7. Dedupe.
8. Create notification rows.
9. Create delivery logs.
10. Return created/skipped counts.

### 14.2 Internal direct send API

```http
POST /internal/v1/notifications/send
```

Dùng khi module nguồn muốn gửi nội dung đã render sẵn nhưng vẫn qua NOTI để lưu/read count/log.

Khuyến nghị hạn chế dùng, ưu tiên event + template.

### 14.3 Internal bulk send API

```http
POST /internal/v1/notifications/bulk-send
```

Dùng cho system notification hoặc batch event lớn. Với số lượng lớn, API nên enqueue job thay vì insert đồng bộ toàn bộ.

### 14.4 Internal reminder job API

```http
POST /internal/v1/notifications/reminder-jobs/run
```

Dùng cho scheduler nội bộ, ví dụ:

1. Task sắp đến hạn.
2. Task quá hạn.
3. Đơn nghỉ sắp bắt đầu.
4. Hợp đồng sắp hết hạn.
5. Quên check-out cuối ngày.

### 14.5 Internal retry delivery API

```http
POST /internal/v1/notifications/delivery-jobs/retry
```

---

## 15. Service thiết kế chi tiết

### 15.1 NotificationEventConsumerService

Vai trò:

1. Nhận event từ internal API hoặc queue.
2. Validate input.
3. Resolve event config.
4. Điều phối tạo notification.

Pseudo flow:

```ts
async consume(event: InternalNotificationEventDto, context: InternalContext) {
  await validateInternalContext(context);
  await validateCompany(event.company_id);
  const eventConfig = await eventConfigService.findEnabledEvent(event.company_id, event.event_code);
  if (!eventConfig) return skipped('EVENT_DISABLED_OR_NOT_FOUND');

  const recipients = await recipientResolver.resolve(event, eventConfig);
  const safePayload = payloadValidator.sanitize(event.payload, event.target);

  return notificationCreateService.createFromEvent({
    event,
    eventConfig,
    recipients,
    safePayload,
  });
}
```

### 15.2 NotificationRecipientResolverService

Resolver strategy:

| Strategy | Mục đích |
| --- | --- |
| `DIRECT_USERS` | Module nguồn truyền `user_id` cụ thể |
| `EMPLOYEES_TO_USERS` | Module nguồn truyền `employee_id`, service map sang user active |
| `DIRECT_MANAGER` | Lấy quản lý trực tiếp từ HR |
| `HR_ROLE` | Gửi HR trong company |
| `MANAGER_SCOPE` | Gửi manager theo team/department |
| `PROJECT_MEMBERS` | Phase sau hoặc TASK truyền trực tiếp |
| `ROLE_CODES` | Gửi theo role seed/config |
| `DEPARTMENT_USERS` | Gửi theo department |

Rule:

1. Chỉ gửi cho user active.
2. Không gửi cho user không thuộc company hiện tại.
3. Loại trùng recipient.
4. Có thể loại actor nếu event config yêu cầu `exclude_actor = true`.
5. Nếu không resolve được recipient và event bắt buộc, ghi delivery skipped/config warning.

### 15.3 NotificationTemplateRendererService

Vai trò:

1. Lấy template active theo company -> global fallback.
2. Validate biến theo `variables_schema`.
3. Render title/short/content.
4. Escape hoặc sanitize output để tránh XSS.
5. Fallback template nếu template inactive/missing.

Rule:

1. Không cho template gọi code tùy ý.
2. Chỉ dùng placeholder đơn giản `{variable_name}`.
3. Missing required variable -> fail event hoặc fallback theo policy.
4. Missing optional variable -> render rỗng hoặc default.
5. Output length phải giới hạn.

### 15.4 NotificationCreateService

Vai trò:

1. Tạo notification rows theo recipient.
2. Kiểm tra dedupe.
3. Tạo delivery logs.
4. Publish event nội bộ `NOTIFICATION_CREATED` (cho badge/cache/realtime).

Transaction:

```text
BEGIN
  insert notifications
  insert notification_delivery_logs
COMMIT
publish NOTIFICATION_CREATED after commit
```

Rule:

1. Không publish event realtime trước khi commit.
2. Dedupe phải chạy trong transaction hoặc dựa unique index.
3. Bulk insert cần chunk size, ví dụ 500 rows/lần.
4. Kết quả trả về gồm created/skipped/failed.

> **Producer cho DASH cache (X-35):** Sau commit, BE-09 **bắt buộc** phát `NOTIFICATION_CREATED`; service `NotificationActionService` (mark read/mark all read) phát `NOTIFICATION_READ`. BE-10 tiêu thụ hai event này (hoặc BE-09 gọi `POST /internal/v1/dashboard/cache/invalidate`) để invalidate cache widget `NOTIFICATIONS`/`SYSTEM_NOTIFICATIONS`. Không được để BE-10 phụ thuộc event không có producer.

### 15.5 NotificationDeliveryService

MVP:

1. IN_APP: sau khi insert notification, log `Sent`.
2. EMAIL: nếu disabled -> log `Skipped`; nếu enabled cơ bản -> enqueue email job hoặc log Pending.
3. PUSH/REALTIME/INTEGRATION: phase sau, log `Skipped` nếu chưa bật.

Rule:

1. Delivery status không trộn với notification read status.
2. Provider response phải mask secret trước khi lưu.
3. Retry chỉ áp dụng channel ngoài, IN_APP thường không retry.

### 15.6 NotificationActionService

Chịu trách nhiệm:

1. Mark read.
2. Mark all read.
3. Hide.
4. Archive.
5. Delete soft.

Rule bảo mật:

1. Mọi action cá nhân bắt buộc filter `recipient_user_id = current_user_id`.
2. Nếu không tìm thấy, trả 404 để tránh lộ existence.
3. Update idempotent nếu action đã áp dụng.
4. Sau khi mark read / mark all read thành công, phát event nội bộ `NOTIFICATION_READ` (kèm `recipient_user_id`, `company_id`) để DASH invalidate cache unread-count, hoặc gọi `POST /internal/v1/dashboard/cache/invalidate`.

### 15.7 NotificationQueryService

Chịu trách nhiệm:

1. List notification cá nhân.
2. Dropdown.
3. Unread count.
4. Detail.
5. Admin list.

Rule hiệu năng:

1. Projection rõ ràng, không select `payload` ở list nếu không cần.
2. Index theo `company_id`, `recipient_user_id`, `status`, `created_at`.
3. Dropdown chỉ lấy latest limit <= 20.
4. Unread count dùng partial index.

### 15.8 NotificationTargetService

Chịu trách nhiệm trả target metadata an toàn.

Rule:

1. NOTI không tự load detail nghiệp vụ gốc.
2. Có thể kiểm tra module target active.
3. Có thể kiểm tra user có permission route cơ bản nếu route registry có metadata.
4. Final permission vẫn do module gốc kiểm tra.

### 15.9 NotificationAdminService

Chịu trách nhiệm:

1. Admin list notification/log.
2. Event config.
3. Template config.
4. Channel config.
5. System notification.
6. Retry delivery.

Rule:

1. Mọi thay đổi config phải audit.
2. Admin scope Company không xem/sửa global config trừ khi cho phép override.
3. Super Admin scope System mới sửa global default.

---

## 16. Permission và policy

### 16.1 Permission MVP

```text
NOTI.NOTIFICATION.VIEW_OWN
NOTI.NOTIFICATION.VIEW_DETAIL_OWN
NOTI.NOTIFICATION.COUNT_UNREAD_OWN
NOTI.NOTIFICATION.MARK_READ_OWN
NOTI.NOTIFICATION.MARK_ALL_READ_OWN
NOTI.NOTIFICATION.HIDE_OWN
NOTI.NOTIFICATION.DELETE_OWN
NOTI.NOTIFICATION.VIEW_COMPANY
NOTI.NOTIFICATION.CREATE_SYSTEM
NOTI.NOTIFICATION.SEND_SYSTEM
NOTI.EVENT.VIEW
NOTI.EVENT.CONFIG
NOTI.TEMPLATE.VIEW
NOTI.TEMPLATE.CREATE
NOTI.TEMPLATE.UPDATE
NOTI.TEMPLATE.DELETE
NOTI.CHANNEL.VIEW
NOTI.CHANNEL.UPDATE
NOTI.LOG.VIEW
NOTI.LOG.RETRY
NOTI.AUDIT_LOG.VIEW
```

### 16.2 Policy cá nhân

```text
canViewOwnNotification(user, notification)
  -> notification.company_id == user.company_id
  -> notification.recipient_user_id == user.id
  -> notification.status != Deleted hoặc route cho phép xem Deleted
```

### 16.3 Policy admin

```text
canViewCompanyNotifications(user)
  -> hasPermission(NOTI.NOTIFICATION.VIEW_COMPANY)
  -> scope in Company/System
```

### 16.4 Policy config

```text
canConfigEvent(user, event)
  -> hasPermission(NOTI.EVENT.CONFIG)
  -> if event.company_id is null then scope System
  -> if event.company_id not null then same company + Company/System scope
```

---

## 17. Dedupe, idempotency và throttle

### 17.1 Dedupe key

Unique đề xuất:

```text
company_id + recipient_user_id + event_code + dedupe_key
```

Chỉ áp dụng khi `dedupe_key IS NOT NULL`.

Ví dụ:

```text
TASK_DUE_SOON:task_id:recipient_user_id:2026-06-20
LEAVE_PENDING_APPROVAL:leave_request_id:approver_user_id
ATT_MISSING_CHECKOUT:attendance_record_id:employee_user_id
```

### 17.2 Idempotency-Key

Internal API nên nhận header:

```http
Idempotency-Key: source-module:event-id
```

Lưu idempotency có thể ở Foundation hoặc bảng riêng nếu BACKEND-02 đã triển khai.

Rule:

1. Cùng key + cùng payload -> trả kết quả cũ.
2. Cùng key + payload khác -> 409 Conflict.
3. Key có TTL, ví dụ 24h hoặc 7 ngày tùy event.

### 17.3 Throttle

MVP có thể xử lý đơn giản:

1. Event config có `throttle_config`.
2. Nếu vượt giới hạn, log skipped.
3. Các event nhắc hạn/quá hạn phải có dedupe theo ngày.

Ví dụ config:

```json
{
  "max_per_recipient_per_hour": 20,
  "max_same_entity_per_day": 1
}
```

---

## 18. Job và queue

### 18.1 Queue đề xuất

Tên queue:

```text
notification-events
notification-delivery
notification-reminders
notification-cleanup
```

Job payload không chứa dữ liệu nhạy cảm quá mức. Chỉ chứa ID/context cần thiết.

### 18.2 Notification reminder job

Chạy định kỳ:

| Job | Gợi ý lịch | Nguồn dữ liệu |
| --- | --- | --- |
| Task due soon | Mỗi ngày 08:00 hoặc mỗi giờ | TASK |
| Task overdue | Mỗi ngày 08:30 hoặc mỗi giờ | TASK |
| Missing checkout | Cuối ngày theo timezone công ty | ATT |
| Leave upcoming | Mỗi ngày 08:00 | LEAVE |
| Contract expiring | Mỗi ngày 08:00 | HR |

MVP có thể để module nguồn phát event reminder, NOTI chỉ xử lý event.

### 18.3 Delivery retry job

Chỉ retry các channel ngoài IN_APP.

Rule:

1. Chọn log `delivery_status = Failed` và `next_retry_at <= now`.
2. Không vượt `max_attempts`.
3. Backoff exponential hoặc fixed.
4. Mask error trước khi lưu.

### 18.4 Cleanup/retention job

MVP chưa xóa cứng. Có thể chuẩn bị:

1. Archive notification cũ sau 12-24 tháng.
2. Cleanup delivery logs theo retention policy.
3. Xóa cache badge nếu có.

---

## 19. Database migration/index checklist

### 19.1 Migration bảng NOTI

- [ ] Tạo `notification_events`.
- [ ] Tạo `notification_templates`.
- [ ] Tạo `notifications`.
- [ ] Tạo `notification_delivery_logs`.
- [ ] Tạo `notification_preferences` nếu quyết định tạo sớm.
- [ ] Tạo enum/check constraint cho status/type/channel/priority.
- [ ] Tạo FK tới `companies`, `users`, `employees`, `notification_events`, `notification_templates`.
- [ ] Tạo soft delete fields.
- [ ] Tạo audit fields.
- [ ] Tạo migration seed events/templates.

### 19.2 Index quan trọng

```sql
CREATE INDEX idx_notifications_user_latest
ON notifications (company_id, recipient_user_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_user_status_latest
ON notifications (company_id, recipient_user_id, status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notifications_unread_count
ON notifications (company_id, recipient_user_id, priority, created_at DESC)
WHERE status = 'Unread' AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_notifications_dedupe_active
ON notifications (company_id, recipient_user_id, event_code, dedupe_key)
WHERE dedupe_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_notifications_source_entity
ON notifications (company_id, source_module, source_entity_type, source_entity_id)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_delivery_retry
ON notification_delivery_logs (delivery_status, next_retry_at, attempt_no)
WHERE delivery_status IN ('Pending', 'Failed');

CREATE INDEX idx_notification_events_company_code
ON notification_events (company_id, event_code)
WHERE deleted_at IS NULL;

CREATE INDEX idx_notification_templates_event_channel_locale
ON notification_templates (event_id, channel, locale, status)
WHERE deleted_at IS NULL;
```

### 19.3 Query performance rule

1. List cá nhân không select cột lớn không cần thiết.
2. Dropdown dùng `limit` thay vì pagination đầy đủ.
3. Unread count phải dùng partial index.
4. Admin log list bắt buộc filter thời gian nếu dữ liệu lớn.
5. Delivery log nên có retention/partition phase sau.
6. EXPLAIN ANALYZE cho các query nóng trước release.

---

## 20. Seed data cần có

### 20.1 Seed module

```text
NOTI - Notification
```

### 20.2 Seed permissions

Seed toàn bộ permission ở mục 16.1.

### 20.3 Seed events MVP

| Event code | Module | Type | Priority | Kênh |
| --- | --- | --- | --- | --- |
| `AUTH_USER_CREATED` | AUTH | Account | Normal | IN_APP |
| `AUTH_USER_LOCKED` | AUTH | Account | High | IN_APP |
| `HR_PROFILE_CHANGE_SUBMITTED` | HR | HR | High | IN_APP |
| `HR_PROFILE_CHANGE_APPROVED` | HR | HR | Normal | IN_APP |
| `HR_PROFILE_CHANGE_REJECTED` | HR | HR | Normal | IN_APP |
| `HR_CONTRACT_EXPIRING` | HR | Reminder | High | IN_APP |
| `ATT_MISSING_CHECKOUT` | ATT | Attendance | High | IN_APP |
| `ATT_LATE_DETECTED` | ATT | Attendance | Normal | IN_APP |
| `ATT_ABSENT_DETECTED` | ATT | Warning | High | IN_APP |
| `ATT_ADJUSTMENT_SUBMITTED` | ATT | Approval | High | IN_APP |
| `ATT_ADJUSTMENT_APPROVED` | ATT | Attendance | Normal | IN_APP |
| `ATT_ADJUSTMENT_REJECTED` | ATT | Attendance | Normal | IN_APP |
| `ATT_AUTO_ATTENDANCE_CREATED` | ATT | Attendance | Normal | IN_APP |
| `ATT_REMOTE_REQUEST_SUBMITTED` | ATT | Approval | High | IN_APP |
| `ATT_REMOTE_REQUEST_APPROVED` | ATT | Attendance | Normal | IN_APP |
| `ATT_REMOTE_REQUEST_REJECTED` | ATT | Attendance | Normal | IN_APP |
| `ATT_REMOTE_REQUEST_CANCELLED` | ATT | Attendance | Normal | IN_APP |
| `LEAVE_REQUEST_SUBMITTED` | LEAVE | Approval | High | IN_APP |
| `LEAVE_REQUEST_APPROVED` | LEAVE | Leave | Normal | IN_APP |
| `LEAVE_REQUEST_REJECTED` | LEAVE | Leave | Normal | IN_APP |
| `LEAVE_REQUEST_CANCELLED` | LEAVE | Leave | Normal | IN_APP |
| `LEAVE_REQUEST_REVOKED` | LEAVE | Leave | Normal | IN_APP |
| `LEAVE_BALANCE_ADJUSTED` | LEAVE | Leave | Normal | IN_APP |
| `LEAVE_BALANCE_LOW` | LEAVE | Warning | High | IN_APP |
| `LEAVE_SYNC_TO_ATT_FAILED` | LEAVE | Error | High | IN_APP |
| `TASK_ASSIGNED` | TASK | Task | Normal | IN_APP |
| `TASK_STATUS_CHANGED` | TASK | Task | Normal | IN_APP |
| `TASK_COMMENT_CREATED` | TASK | Task | Normal | IN_APP |
| `TASK_MENTIONED` | TASK | Task | High | IN_APP |
| `TASK_DUE_SOON` | TASK | Reminder | Normal | IN_APP |
| `TASK_OVERDUE` | TASK | Warning | High | IN_APP |
| `PROJECT_MEMBER_ADDED` | TASK | Project | Normal | IN_APP |
| `SYSTEM_CONFIG_WARNING` | SYSTEM | Warning | High | IN_APP |

> Event nội bộ cache `NOTIFICATION_CREATED`/`NOTIFICATION_READ` không seed như notification event người dùng; chúng là tín hiệu BE-09 phát cho BE-10 invalidate cache (xem §15.4/§15.6).

### 20.4 Seed template ví dụ

```text
TASK_ASSIGNED_IN_APP_VI
Title: Bạn có task mới
Short: Bạn được giao task {task_title}
Content: Bạn được giao task {task_title} trong dự án {project_name}.
```

```text
LEAVE_REQUEST_SUBMITTED_IN_APP_VI
Title: Bạn có đơn nghỉ cần duyệt
Short: {employee_name} đã gửi đơn nghỉ {leave_request_code}
Content: {employee_name} đã gửi đơn nghỉ từ {start_date} đến {end_date}.
```

```text
ATT_ADJUSTMENT_SUBMITTED_IN_APP_VI
Title: Có yêu cầu điều chỉnh công cần duyệt
Short: {employee_name} gửi yêu cầu điều chỉnh công ngày {work_date}
Content: {employee_name} đã gửi yêu cầu điều chỉnh công cho ngày {work_date}.
```

### 20.5 Seed role permission gợi ý

| Role | Quyền NOTI mặc định |
| --- | --- |
| Employee | VIEW_OWN, VIEW_DETAIL_OWN, COUNT_UNREAD_OWN, MARK_READ_OWN, MARK_ALL_READ_OWN, HIDE_OWN, DELETE_OWN |
| Manager | Employee permissions + nhận notification team/task/approval |
| HR | Employee permissions + VIEW_COMPANY nếu được cấp, LOG.VIEW optional |
| Admin công ty | Event/template/channel/log/system notification theo Company |
| Super Admin | Toàn quyền System |

---

## 21. Error code đề xuất

| Code | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `NOTI-ERR-NOTIFICATION_NOT_FOUND` | 404 | Không tìm thấy notification hoặc không thuộc user hiện tại |
| `NOTI-ERR-FORBIDDEN_NOTIFICATION` | 403 | Không có quyền xem/thao tác notification |
| `NOTI-ERR-EVENT_NOT_FOUND` | 404 | Event không tồn tại |
| `NOTI-ERR-EVENT_DISABLED` | 409 | Event đang bị tắt |
| `NOTI-ERR-TEMPLATE_NOT_FOUND` | 404 | Không tìm thấy template active |
| `NOTI-ERR-TEMPLATE_VARIABLE_MISSING` | 422 | Thiếu biến template bắt buộc |
| `NOTI-ERR-INVALID_PAYLOAD` | 422 | Payload chứa field không hợp lệ/nhạy cảm |
| `NOTI-ERR-INVALID_RECIPIENT` | 422 | Recipient không hợp lệ hoặc không thuộc company |
| `NOTI-ERR-DEDUPE_SKIPPED` | 200/409 | Notification bị bỏ qua do trùng |
| `NOTI-ERR-CHANNEL_DISABLED` | 409 | Channel bị tắt |
| `NOTI-ERR-DELIVERY_NOT_RETRYABLE` | 409 | Delivery log không thể retry |
| `NOTI-ERR-INTERNAL_TOKEN_INVALID` | 401 | Internal token không hợp lệ |
| `NOTI-ERR-SYSTEM_EVENT_READONLY` | 403 | Không được sửa/xóa system event |

---

## 22. Security checklist

- [ ] Public API yêu cầu access token hợp lệ.
- [ ] Internal API yêu cầu internal service token/job token.
- [ ] Không tin `company_id` từ frontend.
- [ ] User API luôn filter `recipient_user_id = current_user_id`.
- [ ] Admin API kiểm tra permission và data scope.
- [ ] Nếu truy cập notification của user khác, trả 404/403 theo policy bảo mật.
- [ ] Payload validator chặn field nhạy cảm.
- [ ] Template renderer escape output tránh XSS.
- [ ] Provider response/error log phải mask secret/token.
- [ ] Không trả storage path hoặc private file URL trong payload.
- [ ] System notification bulk phải giới hạn recipient theo scope.
- [ ] Rate limit internal event endpoint nếu dùng HTTP.
- [ ] Audit log cho mọi thao tác cấu hình/quản trị.
- [ ] Không log full payload nhạy cảm trong application log.
- [ ] Test cross-company access bắt buộc.

---

## 23. Observability và monitoring

### 23.1 Structured log

Log các event:

```text
notification.event.received
notification.event.skipped
notification.created
notification.delivery.sent
notification.delivery.failed
notification.action.mark_read
notification.action.mark_all_read
notification.admin.template_updated
notification.admin.event_disabled
```

Log context:

1. `request_id`
2. `company_id`
3. `source_module`
4. `event_code`
5. `recipient_count`
6. `created_count`
7. `skipped_count`
8. `duration_ms`
9. `error_code`

Không log full payload nếu có nguy cơ sensitive.

### 23.2 Metrics

| Metric | Ý nghĩa |
| --- | --- |
| `notification_events_received_total` | Tổng event nhận vào |
| `notifications_created_total` | Tổng notification tạo |
| `notification_dedupe_skipped_total` | Tổng notification bỏ qua do dedupe |
| `notification_delivery_failed_total` | Tổng delivery fail |
| `notification_unread_count_query_ms` | Latency unread count |
| `notification_dropdown_query_ms` | Latency dropdown |
| `notification_template_render_error_total` | Lỗi render template |
| `notification_internal_event_latency_ms` | Latency xử lý event |
| `notification_queue_lag_seconds` | Độ trễ queue nếu dùng queue |

### 23.3 Alert gợi ý

1. Delivery failed tăng đột biến.
2. Template render error nhiều.
3. Queue lag vượt ngưỡng.
4. Unread count query > 500ms liên tục.
5. Internal event error rate > 5%.
6. Notification created giảm bất thường sau deploy.

---

## 24. Test plan

### 24.1 Unit test

| Nhóm | Test |
| --- | --- |
| Renderer | Render đủ biến, thiếu biến bắt buộc, escape HTML |
| Payload validator | Chặn sensitive fields, cho target safe fields |
| Recipient resolver | Resolve user, employee, manager, role, department, loại trùng |
| Dedupe service | Dedupe key trùng, dedupe key khác, null dedupe |
| Action service | Mark read idempotent, mark all read chỉ user hiện tại |
| Policy | Own, Company, System scope |

### 24.2 Integration test

| Mã | Kịch bản |
| --- | --- |
| BE09-IT-001 | Internal TASK_ASSIGNED tạo notification cho assignee |
| BE09-IT-002 | LEAVE_REQUEST_SUBMITTED resolve direct manager |
| BE09-IT-003 | ATT_ADJUSTMENT_SUBMITTED gửi cho manager/HR |
| BE09-IT-004 | Event disabled không tạo notification |
| BE09-IT-005 | Template inactive fallback hoặc lỗi config |
| BE09-IT-006 | Dedupe key trùng không tạo bản ghi mới |
| BE09-IT-007 | Bulk send tạo n notifications |
| BE09-IT-008 | Delivery log IN_APP status Sent |
| BE09-IT-009 | Delivery retry chỉ retry log Failed |
| BE09-IT-010 | Audit log khi admin update template |

### 24.3 API test

| Mã | Kịch bản |
| --- | --- |
| BE09-API-001 | GET `/notifications` chỉ trả notification của tôi |
| BE09-API-002 | GET `/notifications/unread-count` đúng count |
| BE09-API-003 | GET `/notifications/dropdown` limit <= 20 |
| BE09-API-004 | GET detail notification của người khác trả 404/403 |
| BE09-API-005 | POST mark-read idempotent |
| BE09-API-006 | POST mark-all-read không ảnh hưởng user khác |
| BE09-API-007 | DELETE notification là soft delete |
| BE09-API-008 | Admin thiếu quyền không xem delivery log |
| BE09-API-009 | Admin Company không xem cross-company |
| BE09-API-010 | Internal API thiếu service token trả 401 |

### 24.4 Security test

| Mã | Kịch bản |
| --- | --- |
| BE09-SEC-001 | Đoán UUID notification user khác |
| BE09-SEC-002 | Payload chứa `salary` bị reject/mask |
| BE09-SEC-003 | Payload chứa private file URL bị reject |
| BE09-SEC-004 | Template chứa script không gây XSS |
| BE09-SEC-005 | Provider response chứa token bị mask |
| BE09-SEC-006 | User inactive không nhận notification mới nếu policy chặn |
| BE09-SEC-007 | Cross-company internal event bị reject |

### 24.5 Performance test

| Mã | Kịch bản |
| --- | --- |
| BE09-PERF-001 | Unread count với 100k notification/user vẫn nhanh |
| BE09-PERF-002 | Dropdown latest query dùng index |
| BE09-PERF-003 | Bulk insert 10k recipients theo chunk |
| BE09-PERF-004 | Admin list bắt buộc filter và pagination |
| BE09-PERF-005 | Delivery log retry query không full scan |

---

## 25. Luồng tích hợp với module nguồn

### 25.1 TASK_ASSIGNED

```text
TASK service assign task thành công
-> commit transaction task
-> publish TASK_ASSIGNED event
-> NOTI resolve assignee user
-> render TASK_ASSIGNED_IN_APP_VI
-> create notification Unread
-> delivery log IN_APP Sent
-> frontend dropdown/unread count cập nhật bằng polling hoặc refresh query
```

### 25.2 LEAVE_REQUEST_SUBMITTED

```text
LEAVE service tạo/gửi đơn nghỉ thành công
-> resolve direct manager hoặc HR approver
-> publish LEAVE_REQUEST_SUBMITTED
-> NOTI tạo notification cho approver
-> Manager bấm notification
-> frontend điều hướng /leave/approvals/{id}
-> LEAVE backend kiểm tra quyền duyệt lại
```

### 25.3 ATT_MISSING_CHECKOUT

```text
ATT missing checkout job phát hiện thiếu check-out
-> publish ATT_MISSING_CHECKOUT với dedupe theo attendance_record + date + user
-> NOTI tạo notification cho employee hoặc manager nếu config
-> Employee bấm notification
-> frontend điều hướng form yêu cầu điều chỉnh công
```

### 25.4 HR_PROFILE_CHANGE_SUBMITTED

```text
Employee gửi yêu cầu đổi hồ sơ
-> HR tạo request Pending
-> HR publish HR_PROFILE_CHANGE_SUBMITTED
-> NOTI gửi cho HR/Admin có quyền xử lý
-> HR duyệt/từ chối
-> HR publish result event
-> NOTI gửi kết quả cho Employee
```

---

## 26. Acceptance criteria

BACKEND-09 được xem là hoàn thành khi:

1. Có migration/entity/repository đầy đủ cho bảng NOTI MVP.
2. Có seed permission, event và template tối thiểu cho AUTH/HR/ATT/LEAVE/TASK/SYSTEM.
3. Public API cá nhân hoạt động: list, dropdown, unread count, detail, mark read, mark all read, hide/archive/delete soft.
4. Admin API hoạt động: event, template, channel, delivery log, system notification.
5. Internal API hoặc event consumer hoạt động: nhận event và tạo notification.
6. Dedupe key hoạt động, không tạo notification trùng khi retry.
7. Payload validator chặn dữ liệu nhạy cảm.
8. Template renderer render đúng và an toàn.
9. Delivery log IN_APP được tạo đúng.
10. Permission/data scope/recipient ownership được kiểm tra ở backend.
11. Không có cross-company data leak.
12. Unread count/dropdown query có index và đạt ngưỡng hiệu năng MVP.
13. Audit log cho thao tác quản trị/cấu hình.
14. Có job retry/cleanup/reminder skeleton hoặc implementation cơ bản.
15. Có unit/integration/API/security/performance test quan trọng.
16. Có OpenAPI/Swagger cho public/admin/internal endpoint.
17. Frontend Notification module có thể tích hợp theo API-07.
18. Dashboard/Header có thể lấy unread count và latest notifications.

---

## 27. Thứ tự triển khai đề xuất

### Phase 1: Database + seed

1. Migration bảng NOTI.
2. Index unread/dropdown/dedupe/delivery retry.
3. Seed permissions.
4. Seed events.
5. Seed templates.
6. Seed role-permission matrix.

### Phase 2: Core query/action API

1. List my notifications.
2. Detail.
3. Unread count.
4. Dropdown.
5. Mark read.
6. Mark all read.
7. Hide/archive/delete soft.

### Phase 3: Event creation pipeline

1. Internal event API/consumer.
2. Recipient resolver.
3. Template renderer.
4. Payload validator.
5. Create notification + delivery log.
6. Dedupe/idempotency.

### Phase 4: Admin/config API

1. Event config.
2. Template config + preview.
3. Channel config.
4. Delivery log list/retry.
5. System notification.
6. Audit log.

### Phase 5: Jobs + integration

1. Delivery retry job.
2. Reminder job hooks.
3. Retention cleanup skeleton.
4. TASK/LEAVE/ATT/HR integration events.
5. Dashboard/header integration.

### Phase 6: QA hardening

1. Permission test.
2. Data scope test.
3. Cross-company test.
4. Performance test unread/dropdown.
5. Security test payload/template.
6. Regression test event dedupe.

---

## 28. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Hướng xử lý |
| --- | --- | --- |
| Notification spam | Cao | Dedupe key, throttle, reminder theo ngày, event enable/disable |
| Unread count chậm | Trung bình | Partial index, cache ngắn, EXPLAIN ANALYZE |
| Payload lộ dữ liệu nhạy cảm | Cao | Payload whitelist, validator, không log full payload |
| Cross-company leak | Cao | Bắt buộc filter company_id, test cross-company |
| User xem notification người khác | Cao | Recipient ownership guard, 404/403 |
| Template lỗi biến | Trung bình | variables_schema, preview, fallback, test renderer |
| Delivery log phình to | Trung bình | Retention policy, archive phase sau |
| Nhiều module phát event không thống nhất | Cao | Internal event contract, SDK/helper publisher |
| Retry tạo trùng notification | Cao | Idempotency-Key + dedupe unique index |
| Realtime chưa có | Thấp | MVP polling/dropdown, chừa event publish phase sau |
| Admin gửi system notification quá rộng | Trung bình | Scope validation, rate limit, job queue |

---

## 29. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| BE09-OQ-001 | MVP dùng HTTP internal API hay queue/event bus cho notification event? | BE Lead | Cao |
| BE09-OQ-002 | Xem chi tiết notification có tự mark read không? | Product/UX | Trung bình |
| BE09-OQ-003 | Admin công ty có được override global event/template không? | Product/BE | Trung bình |
| BE09-OQ-004 | EMAIL trong MVP chỉ log hay gửi thật qua provider? | Product/BE/DevOps | Trung bình |
| BE09-OQ-005 | Notification preference cá nhân có làm trong MVP không? | Product | Thấp |
| BE09-OQ-006 | Mark all read có áp dụng cả Archived/Hidden không? | Product/UX | Thấp |
| BE09-OQ-007 | Policy khi user truy cập notification đã Deleted là 404 hay 410? | BE/QA | Thấp |
| BE09-OQ-008 | Dedupe conflict trả 200 skipped hay 409? | BE/Integrator | Trung bình |

---

## 30. Kết luận

BACKEND-09 hoàn thiện lớp backend cho module **Thông báo hệ thống** theo hướng event-driven, multi-tenant, an toàn dữ liệu và có khả năng mở rộng.

Trọng tâm triển khai là:

```text
Event từ module nguồn
-> Resolve người nhận
-> Render template
-> Validate payload an toàn
-> Dedupe/idempotency
-> Tạo notification theo từng user
-> Ghi delivery log
-> Cung cấp unread count/dropdown/list/detail/action API
```

Sau BACKEND-09, bước tiếp theo nên là:

```text
BACKEND-10: Dashboard Backend
```

BACKEND-10 sẽ tận dụng NOTI để lấy unread count, latest notifications và notification widget cho dashboard theo vai trò.
