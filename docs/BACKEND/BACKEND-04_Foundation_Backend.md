# BACKEND-04: FOUNDATION BACKEND

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · **BACKEND-04 Foundation** · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-01 §16](<../SPEC/SPEC-01 Tổng quan.md>) · [DB: DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [API: API-09 Foundation](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Frontend: FRONTEND-13](<../FRONTEND/FRONTEND-13_System_Foundation_Frontend.md>) · [Chi tiết impl: BACKEND-11](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-04 |
| Tên tài liệu | Foundation Backend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-03 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-04 mô tả cách triển khai lớp **Foundation Backend** cho hệ thống quản lý doanh nghiệp nội bộ.

Foundation Backend không phải là module nghiệp vụ như HR, ATT, LEAVE hoặc TASK. Đây là lớp backend nền tảng cung cấp các năng lực dùng chung cho toàn bộ hệ thống:

1. Quản lý công ty / tenant.
2. Quản lý danh mục module / app registry.
3. Quản lý system settings và company settings.
4. Ghi audit log thống nhất.
5. Quản lý file metadata, upload, download, file link và file access log.
6. Sinh mã tự động bằng sequence counter an toàn transaction.
7. Quản lý ngày nghỉ lễ / ngày không làm việc.
8. Quản lý data retention policy và cleanup job.
9. Quản lý seed tracking để seed idempotent.
10. Cung cấp internal service contract cho AUTH, HR, ATT, LEAVE, TASK, NOTI và DASH.

Tài liệu này dùng để backend team triển khai module `foundation` sau khi đã hoàn thành:

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
```

---

## 3. Vị trí BACKEND-04 trong roadmap backend

Roadmap backend MVP đề xuất:

| Mã | Tên tài liệu | Mục tiêu |
| --- | --- | --- |
| BACKEND-01 | Backend Architecture & Project Setup | Chốt kiến trúc backend, project structure, config, module convention |
| BACKEND-02 | Database Migration, ORM & Seed Implementation | Tạo migration, ORM model, seed MVP, bootstrap database |
| BACKEND-03 | Auth, Session, RBAC & Permission Guard | Xác thực, session, role, permission, data scope guard |
| BACKEND-04 | Foundation Backend | Company, module catalog, settings, audit, files, sequence, holiday, seed, retention |
| BACKEND-05 | HR Backend | Nhân sự, phòng ban, chức vụ, hợp đồng, profile change request |
| BACKEND-06 | Attendance Backend | Check-in/out, bảng công, ca/rule, điều chỉnh công, remote work |
| BACKEND-07 | Leave Backend | Nghỉ phép, số dư phép, duyệt nghỉ, lịch nghỉ, sync ATT |
| BACKEND-08 | Task Backend | Project, task, assignee, comment, checklist, file, activity log |
| BACKEND-09 | Notification Backend | Event, template, notification, delivery, unread count |
| BACKEND-10 | Dashboard Backend | Dashboard role, widget registry, widget data, cache |
| BACKEND-11 | File, Audit, Settings & System Jobs | File service, audit log, settings, sequence, holiday, retention, system jobs |
| BACKEND-12 | API Integration Contract & OpenAPI/Swagger | Contract API, OpenAPI/Swagger, permission-endpoint matrix, contract test |
| BACKEND-13 | Backend Testing, Security & Performance | Unit/integration/e2e, security, performance, regression |
| BACKEND-14 | Backend Release Readiness | Release checklist, observability, rollback, readiness |

BACKEND-04 là lớp dùng chung bắt buộc trước khi triển khai sâu các module nghiệp vụ còn lại.

> Chi tiết triển khai Foundation (file, audit, settings, sequence, holiday, retention, system jobs) là bản chuẩn ở **BACKEND-11**. BACKEND-04 giữ vai trò skeleton/quy ước kiến trúc; khi có khác biệt về endpoint/permission/enum, lấy BACKEND-11 làm chuẩn.

---

## 4. Căn cứ triển khai

Foundation Backend phải bám theo các quyết định đã chốt:

1. DB-08 xác định Foundation gồm `companies`, `modules`, `system_settings`, `company_settings`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`.
2. API-01 quy định backend là lớp kiểm soát quyền cuối cùng, mọi API phải kiểm tra authentication, permission, data scope, business rule, audit log và notification event nếu có.
3. API-01 quy định Foundation dùng prefix public `/api/v1/foundation`.
4. UI-01 yêu cầu Foundation cung cấp dữ liệu cho Home Portal, App Switcher, module catalog và app registry.
5. FRONTEND-03/04 yêu cầu backend trả dữ liệu ổn định cho route guard, permission, app visibility, API client, upload/download và error handling.
6. DB-09 yêu cầu query Foundation phải tối ưu theo `company_id`, soft delete, audit log, file access log và các bảng log lớn.
7. DB-10 yêu cầu migration Foundation chạy trước AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH và seed dữ liệu MVP idempotent.

---

## 5. Nguyên tắc triển khai Foundation Backend

### 5.1 Foundation là shared infrastructure

Foundation chỉ cung cấp hạ tầng dùng chung:

```text
AuditService
FileService
SettingService
SequenceService
HolidayService
ModuleRegistryService
CompanyService
SeedService
RetentionService
```

Foundation không xử lý nghiệp vụ gốc như:

1. Ai được duyệt nghỉ.
2. Ai được chấm công.
3. Task nào quá hạn.
4. Dashboard nào hiển thị widget nào.
5. Notification nào gửi cho ai.

Những quyết định đó nằm ở module nghiệp vụ tương ứng.

### 5.2 Backend không tin dữ liệu tenant từ frontend

Các API Foundation phải lấy `company_id` từ `AuthContext`.

Không được tin các field sau nếu frontend truyền vào request body:

```text
company_id
actor_user_id
actor_employee_id
role
permission
data_scope
```

Ngoại lệ duy nhất là API quản trị hệ thống có scope `System`, ví dụ Super Admin tạo hoặc xem tenant khác.

### 5.3 Mọi query vận hành phải filter theo company

Repository Foundation phải áp dụng pattern:

```text
WHERE company_id = authContext.companyId
  AND deleted_at IS NULL
```

Với dữ liệu global nullable `company_id`, service phải tách rõ:

```text
company-specific query
system/global query
combined fallback query
```

Không dùng điều kiện `company_id = :company_id OR company_id IS NULL` bừa bãi nếu chưa kiểm soát thứ tự ưu tiên và index.

### 5.4 Public API và Internal Service phải tách nhau

Foundation có hai bề mặt sử dụng:

1. Public API cho frontend/admin UI.
2. Internal service cho module backend khác.

Ví dụ:

```text
Public API:
GET /api/v1/foundation/modules/my-apps
GET /api/v1/foundation/settings/public
POST /api/v1/foundation/files/upload

Internal service:
settingService.getCompanySetting(...)
auditService.write(...)
sequenceService.nextCode(...)
fileService.assertCanDownload(...)
holidayService.isWorkingDay(...)
```

Module nghiệp vụ nên gọi internal service trực tiếp, không tự gọi HTTP public API nội bộ nếu backend là monolith/module-based application.

### 5.5 Audit log append-only

Audit log chỉ được insert, không update sau khi ghi.

Không expose API cập nhật audit log.

Nếu cần cleanup theo retention, phải dùng job hệ thống có kiểm soát và ghi log riêng.

### 5.6 File private by default

File upload mặc định là private.

Backend không trả `storage_path` trực tiếp cho frontend.

Download/preview file phải đi qua flow:

```text
Request download
-> Auth guard
-> Permission guard
-> Resolve file
-> Resolve file link/entity
-> Module owner permission check nếu cần
-> Ghi file access log nếu file sensitive/private
-> Tạo signed URL hoặc stream file
```

### 5.7 Sequence phải an toàn race condition

Sinh mã tự động không được dùng `MAX(code) + 1`.

Bắt buộc dùng transaction và row lock:

```sql
SELECT *
FROM sequence_counters
WHERE company_id = $1
  AND sequence_key = $2
FOR UPDATE;
```

Sau đó tăng `current_value`, format code và commit.

---

## 6. Phạm vi BACKEND-04

### 6.1 Bao gồm trong MVP

| Nhóm | Thành phần backend |
| --- | --- |
| Company | Company entity, repository, service, admin API cơ bản |
| Module catalog | Module registry, my apps, recent apps, favorite apps, module open tracking |
| Settings | System settings, company settings, public setting filter, sensitive masking |
| Audit | Audit writer, audit interceptor/helper, audit list API, audit export placeholder |
| Files | Upload, metadata, link/unlink, download, preview, file access log |
| Sequence | Next number/code, sequence counter management, idempotent generation helper |
| Holidays | Public holidays CRUD, check working day service, import placeholder |
| Retention | Retention policy CRUD, cleanup job skeleton |
| Seed | Seed batch tracking, seed item tracking, idempotent seed helper |
| Permissions | Permission constants for Foundation/System APIs |
| Tests | Unit, integration, permission, scope, security tests |

### 6.2 Không bao gồm sâu trong BACKEND-04

| Nội dung | Xử lý ở tài liệu/module |
| --- | --- |
| Login, refresh token, session, RBAC guard | BACKEND-03 |
| Employee, department, contract, profile change | BACKEND-05 HR |
| Check-in/out, attendance rule, adjustment | BACKEND-06 ATT |
| Leave request, balance, approval | BACKEND-07 LEAVE |
| Project/task/comment/checklist | BACKEND-08 TASK |
| Notification delivery, template rendering | BACKEND-09 NOTI |
| Dashboard widget data aggregation | BACKEND-10 DASH |
| Object storage hạ tầng production chi tiết | DevOps/Infra riêng |
| Antivirus scan nâng cao | Phase sau |
| SaaS billing/subscription | Phase sau |

---

## 7. Folder structure đề xuất

Ví dụ theo kiến trúc TypeScript/NestJS module-based. Nếu backend dùng framework khác, vẫn giữ cùng ranh giới module/service/repository.

```text
src/
  modules/
    foundation/
      foundation.module.ts

      companies/
        company.controller.ts
        company.service.ts
        company.repository.ts
        dto/
          create-company.dto.ts
          update-company.dto.ts
          company-query.dto.ts
        mappers/
          company.mapper.ts

      modules/
        module-catalog.controller.ts
        module-catalog.service.ts
        module-catalog.repository.ts
        dto/
          module-query.dto.ts
          update-module-status.dto.ts
          favorite-module.dto.ts
        mappers/
          module-catalog.mapper.ts

      settings/
        setting.controller.ts
        setting.service.ts
        setting.repository.ts
        setting-cache.service.ts
        dto/
          update-setting.dto.ts
          setting-query.dto.ts
        validators/
          setting-value.validator.ts

      audit/
        audit.controller.ts
        audit.service.ts
        audit.repository.ts
        audit-context.builder.ts
        audit-masker.service.ts
        decorators/
          audited.decorator.ts
        dto/
          audit-log-query.dto.ts

      files/
        file.controller.ts
        file.service.ts
        file.repository.ts
        file-storage.port.ts
        local-private-storage.adapter.ts
        signed-url.service.ts
        file-permission.service.ts
        file-access-log.service.ts
        dto/
          upload-file.dto.ts
          link-file.dto.ts
          file-query.dto.ts
        validators/
          file-mime.validator.ts
          file-size.validator.ts

      sequences/
        sequence.controller.ts
        sequence.service.ts
        sequence.repository.ts
        dto/
          sequence-query.dto.ts
          update-sequence.dto.ts

      holidays/
        holiday.controller.ts
        holiday.service.ts
        holiday.repository.ts
        dto/
          create-public-holiday.dto.ts
          update-public-holiday.dto.ts
          holiday-query.dto.ts

      retention/
        retention.controller.ts
        retention.service.ts
        retention.repository.ts
        retention-cleanup.job.ts
        dto/
          upsert-retention-policy.dto.ts

      seed/
        seed-tracking.service.ts
        seed-tracking.repository.ts
        seed-runner.service.ts

      shared/
        foundation-permissions.ts
        foundation-error-codes.ts
        foundation-events.ts
        foundation.constants.ts
        foundation.types.ts
```

---

## 8. Domain model chính

### 8.1 Company

Backend entity cần map bảng `companies`.

Trách nhiệm service:

1. Lấy company hiện tại theo auth context.
2. Super Admin quản lý danh sách company nếu scope `System`.
3. Kiểm tra company status khi user đăng nhập hoặc gọi API protected.
4. Cung cấp timezone/locale/currency cho các module khác.
5. Cập nhật logo thông qua FileService.

Status chuẩn:

```text
Active
Inactive
Suspended
Deleted
```

Rule quan trọng:

1. Company bị `Suspended` thì user thuộc company không được tiếp tục thao tác nghiệp vụ.
2. Không xóa cứng company đã có dữ liệu.
3. Update company settings quan trọng phải ghi audit log.

### 8.2 Module catalog

Backend entity cần map bảng `modules`.

Module catalog dùng cho:

1. App registry Home Portal.
2. App Switcher.
3. Permission seed.
4. Audit module code.
5. Notification event source.
6. Dashboard widget source.

Module MVP active:

```text
AUTH
HR
ATT
LEAVE
TASK
DASH
NOTI
FOUNDATION/SYSTEM
```

Module phase sau seed inactive:

```text
PAYROLL
RECRUIT
ASSET
ROOM
CHAT
SOCIAL
MOBILE
AI
```

MVP nên bổ sung bảng hoặc metadata hỗ trợ app behavior:

```json
{
  "route": "/hr",
  "icon": "users",
  "color": "blue",
  "requiredAnyPermissions": ["HR.EMPLOYEE.VIEW", "HR.MY_PROFILE.VIEW"],
  "aliases": ["nhan su", "employee", "hr"],
  "homeVisible": true,
  "switcherVisible": true
}
```

Nếu không thêm bảng `user_module_preferences` ở MVP, recent/favorite có thể tạm lưu frontend local. Tuy nhiên backend nên chuẩn bị API chính thức để đồng bộ đa thiết bị.

### 8.3 Settings

Có hai loại setting foundation:

```text
system_settings
company_settings
```

Service đọc setting theo precedence:

```text
1. company_settings active theo company_id + setting_key
2. system_settings active theo setting_key
3. default hard-coded trong service nếu chưa seed
```

Không trả setting nhạy cảm qua public API.

Phân loại setting:

```text
General
Security
File
Audit
Notification
Dashboard
Module
FeatureFlag
```

Ví dụ key:

```text
system.default_timezone
system.default_locale
file.max_upload_size_mb
file.allowed_mime_types
audit.default_retention_days
security.session_timeout_minutes
module.hr.enabled
module.att.enabled
home.portal.enabled
```

### 8.4 Audit log

Audit log dùng chung cho thao tác quan trọng.

Trường bắt buộc khi ghi (theo DB-08, chi tiết schema/impl xem BACKEND-11 §12.2):

```text
company_id
actor_user_id
actor_employee_id
actor_type
module_code
action
target_entity_type
target_entity_id
request_id
ip_address
user_agent
old_values
new_values
changed_fields
sensitivity_level
result_status
metadata
created_at
```

Audit service phải hỗ trợ:

1. Ghi log từ service nghiệp vụ.
2. Mask field nhạy cảm trước khi insert.
3. Gắn request_id/correlation_id.
4. Query audit theo permission và scope.
5. Export audit ở phase sau.

Sensitive fields cần mask mặc định:

```text
password
password_hash
refresh_token
token
secret
secret_ref
authorization
phone nếu thiếu quyền nhạy cảm
identity_number nếu thiếu quyền nhạy cảm
bank_account nếu phase sau có payroll
storage_path
signed_url
```

### 8.5 Files

File service quản lý metadata và storage.

Bảng chính:

```text
files
file_links
file_access_logs
```

File status dùng hai field riêng theo DB-08 (không gộp một enum). Chi tiết impl xem BACKEND-11 §11.

`upload_status`:

```text
Pending
Uploaded
Failed
Deleted
```

`scan_status`:

```text
NotRequired
Pending
Clean
Infected
Failed
```

File visibility:

```text
Private
Internal
Public
```

MVP mặc định dùng `Private`.

Storage adapter MVP:

```text
LocalPrivateStorageAdapter
```

Nhưng interface phải đủ mở để thay bằng:

```text
S3StorageAdapter
GCSStorageAdapter
MinIOStorageAdapter
AzureBlobStorageAdapter
```

### 8.6 Sequence counter

Sequence service dùng chung để sinh mã:

```text
employee_code
leave_request_code
attendance_adjustment_code
remote_work_request_code
project_code
task_code
contract_code
```

Input:

```ts
type NextCodeInput = {
  companyId: string;
  sequenceKey: string;
  prefix?: string;
  suffix?: string;
  padding?: number;
  datePattern?: string;
  resetPolicy?: 'Never' | 'Yearly' | 'Monthly' | 'Daily';
};
```

Output:

```ts
type NextCodeResult = {
  sequenceKey: string;
  value: number;
  code: string;
};
```

### 8.7 Public holidays

Holiday service dùng cho ATT/LEAVE/DASH/PAYROLL phase sau.

Phải hỗ trợ:

1. Holiday global theo country.
2. Holiday riêng theo company.
3. Range query theo năm/tháng.
4. Check ngày làm việc.
5. Exclude holiday khi tính nghỉ phép.
6. Xác định ngày không cần chấm công.

Service contract:

```ts
type IsWorkingDayInput = {
  companyId: string;
  date: string;
  countryCode?: string;
};

type IsWorkingDayResult = {
  date: string;
  isWorkingDay: boolean;
  reason?: 'Weekend' | 'PublicHoliday' | 'CompanyHoliday';
  holidayName?: string;
};
```

### 8.8 Retention policy

Retention policy chưa cần cleanup phức tạp trong MVP nhưng phải có skeleton.

Dữ liệu áp dụng:

```text
audit_logs
file_access_logs
notification_delivery_logs
dashboard_widget_cache
login_logs
attendance_logs
files temporary
```

Job cleanup phải:

1. Chạy theo lịch cấu hình.
2. Không xóa dữ liệu vượt policy nếu chưa được bật.
3. Có dry-run mode.
4. Ghi audit/system log khi cleanup.
5. Hỗ trợ archive phase sau.

### 8.9 Seed tracking

Seed tracking giúp seed idempotent.

Service phải ghi:

```text
seed_batches
seed_items
seed_key
checksum
status
started_at
finished_at
error_message
```

Seed runner không tạo trùng dữ liệu nếu chạy lại.

> **CHỐT 2026-07-02:** Seed master-data company-scoped (settings/holiday/sequence/module app-metadata…) triển khai qua **RUNTIME seeder** `MasterDataSeedRunner` (`apps/api/src/foundation/seed/`), KHÔNG qua SQL migration. Idempotent 2 tầng: `startBatch` dedup theo `(company_id, seed_key, seed_version)` (uq) ⇒ reuse batch; `markItem` dedup theo **checksum SHA-256** của payload chuẩn-hoá (`seed-checksum.util.ts`, DB-08 §8.13) ⇒ skip item không đổi. Ghi provenance vào `seed_batches`/`seed_items` (append-only, thuộc `PROTECTED_TABLES`). Lý do chọn runtime-seeder thay migration: seed phụ thuộc `company_id` (N=1 hiện tại, mở rộng multi-company không phải rewrite migration) và cần re-run an toàn theo checksum. Chỉ permission catalog + object-type/action giữ ở migration (`ON CONFLICT DO NOTHING`).

---

## 9. API design Foundation

### 9.1 Prefix

Public API:

```http
/api/v1/foundation
```

Internal API nếu cần:

```http
/internal/v1/foundation
```

### 9.2 Company API

Endpoint/permission company chuẩn ở **BACKEND-11 §9.1**. Bản tóm tắt:

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/company/current` | Lấy company hiện tại | `FOUNDATION.COMPANY.VIEW` |
| PATCH | `/api/v1/foundation/company/current` | Cập nhật company hiện tại | `FOUNDATION.COMPANY.UPDATE` |

Quản trị danh sách company liên tenant (Super Admin, scope `System`) là phạm vi nâng cao; chi tiết xem BACKEND-11.

### 9.3 Module catalog / app registry API

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/modules` | Danh sách module hệ thống theo quyền admin | `FOUNDATION.MODULE.VIEW` |
| GET | `/api/v1/foundation/modules/my-apps` | App user được phép thấy ở Home Portal/App Switcher | Authenticated |
| GET | `/api/v1/foundation/modules/recent-apps` | App mở gần đây | Authenticated |
| POST | `/api/v1/foundation/modules/{module_code}/open` | Ghi nhận app được mở | Authenticated |
| POST | `/api/v1/foundation/modules/{module_code}/favorite` | Ghim app yêu thích | Authenticated |
| DELETE | `/api/v1/foundation/modules/{module_code}/favorite` | Bỏ ghim app yêu thích | Authenticated |
| PATCH | `/api/v1/foundation/modules/{module_code}` | Cập nhật metadata/status module | `FOUNDATION.MODULE.UPDATE` |

Response `my-apps` gợi ý:

```json
{
  "success": true,
  "message": "Lấy danh sách ứng dụng thành công",
  "data": [
    {
      "module_code": "HR",
      "name": "Nhân sự",
      "description": "Hồ sơ nhân viên, phòng ban, hợp đồng",
      "route": "/hr",
      "icon": "users",
      "group": "Core",
      "is_active": true,
      "is_favorite": false,
      "is_recent": true,
      "badges": [],
      "required_permissions": ["HR.EMPLOYEE.VIEW"],
      "allowed_actions": ["open", "favorite"]
    }
  ],
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 9.4 Settings API

Endpoint/permission settings chuẩn ở **BACKEND-11 §9.3**. Bản tóm tắt:

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/settings/public` | Lấy setting public an toàn cho frontend | Authenticated |
| GET | `/api/v1/foundation/settings` | Danh sách company setting theo quyền | `FOUNDATION.SETTING.VIEW` |
| PATCH | `/api/v1/foundation/settings/{setting_key}` | Cập nhật company setting | `FOUNDATION.SETTING.UPDATE` |
| GET | `/api/v1/foundation/system-settings` | Danh sách system setting | `FOUNDATION.SETTING.SYSTEM_MANAGE` |
| PATCH | `/api/v1/foundation/system-settings/{setting_key}` | Cập nhật system setting | `FOUNDATION.SETTING.SYSTEM_MANAGE` |
| POST | `/api/v1/foundation/settings/resolve` | Resolve nhiều setting theo key | `FOUNDATION.SETTING.VIEW` |

> **CHỐT 2026-07-02:** Triển khai thật của `GET /settings/public` gate CHẶT HƠN doc — code đòi `@RequirePermission("view","foundation-setting")` (tuple `view:foundation-setting`), KHÔNG phải chỉ "Authenticated" như bảng ghi. Đây là lệch **ĐÃ BIẾT (audit H6)**: hệ quả là màn chưa-đăng-nhập/role thiếu `view:foundation-setting` không đọc được setting public. Quyết định về gate đúng (nới về Authenticated-only cho nhánh public-nonsensitive hay giữ chặt) **HOÃN sang WO `FND-SETTINGS-PUBLIC-GATE`** — WO này CHỈ pin doc, KHÔNG đổi gate/code.

Rule:

1. API public chỉ trả `is_public = true` và `is_sensitive = false`.
2. API admin không trả secret raw; chỉ trả `secret_ref` hoặc masked value.
3. Cập nhật setting phải validate `value_type` và `validation_schema`.
4. Cập nhật setting quan trọng phải audit.

### 9.5 Audit API

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/audit-logs` | Danh sách audit log | `FOUNDATION.AUDIT_LOG.VIEW` |
| GET | `/api/v1/foundation/audit-logs/{audit_log_id}` | Chi tiết audit log | `FOUNDATION.AUDIT_LOG.VIEW` |
| GET | `/api/v1/foundation/audit-logs/export` | Export audit log | `FOUNDATION.AUDIT_LOG.EXPORT` |

Filter hỗ trợ:

```text
module_code
action
actor_user_id
target_entity_type
target_entity_id
from_date
to_date
request_id
ip_address
keyword
page
per_page
sort
```

Data scope:

| Scope | Dữ liệu xem được |
| --- | --- |
| Company | Audit trong company hiện tại |
| System | Audit toàn hệ thống |

### 9.6 File API

Endpoint/permission file chuẩn ở **BACKEND-11 §9.4**. Bản tóm tắt:

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| POST | `/api/v1/foundation/files/upload` | Upload file private | `FOUNDATION.FILE.UPLOAD` hoặc permission module gốc |
| GET | `/api/v1/foundation/files` | Danh sách file metadata | `FOUNDATION.FILE.VIEW` |
| GET | `/api/v1/foundation/files/{file_id}` | Chi tiết file metadata | `FOUNDATION.FILE.VIEW` hoặc module owner permission |
| POST | `/api/v1/foundation/files/{file_id}/links` | Link file vào entity nghiệp vụ | `FOUNDATION.FILE.LINK` hoặc module owner permission |
| DELETE | `/api/v1/foundation/files/{file_id}/links/{link_id}` | Unlink file | `FOUNDATION.FILE.UNLINK` hoặc module owner permission |
| GET | `/api/v1/foundation/files/{file_id}/download-url` | Lấy signed URL / stream token | `FOUNDATION.FILE.DOWNLOAD` hoặc module owner permission |
| GET | `/api/v1/foundation/files/{file_id}/download` | Download file qua backend stream | `FOUNDATION.FILE.DOWNLOAD` hoặc module owner permission |
| DELETE | `/api/v1/foundation/files/{file_id}` | Soft delete file | `FOUNDATION.FILE.DELETE` hoặc module owner permission |

Upload request multipart:

```text
file: binary
module_code: HR | ATT | LEAVE | TASK | ...
entity_type?: Employee | LeaveRequest | Task | ...
entity_id?: uuid
purpose?: avatar | contract | evidence | attachment | document
visibility?: Private | Internal | Public
```

### 9.7 Sequence API

Public admin API:

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/sequences` | Danh sách sequence counter | `FOUNDATION.SEQUENCE.VIEW` |
| GET | `/api/v1/foundation/sequences/{sequence_key}` | Chi tiết sequence | `FOUNDATION.SEQUENCE.VIEW` |
| PATCH | `/api/v1/foundation/sequences/{sequence_key}` | Cập nhật cấu hình sequence | `FOUNDATION.SEQUENCE.UPDATE` |
| POST | `/api/v1/foundation/sequences/{sequence_key}/preview` | Preview mã tiếp theo không tăng counter | `FOUNDATION.SEQUENCE.VIEW` |

Internal service cho module nghiệp vụ:

```ts
sequenceService.nextCode({
  companyId,
  sequenceKey: 'leave_request',
  prefix: 'LV',
  padding: 6,
});
```

Không expose API public tăng sequence cho frontend nếu không có nghiệp vụ rõ ràng.

### 9.8 Public Holiday API

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/public-holidays` | Danh sách ngày nghỉ lễ | `FOUNDATION.HOLIDAY.VIEW` |
| POST | `/api/v1/foundation/public-holidays` | Tạo ngày nghỉ lễ | `FOUNDATION.HOLIDAY.CREATE` |
| PATCH | `/api/v1/foundation/public-holidays/{holiday_id}` | Cập nhật ngày nghỉ lễ | `FOUNDATION.HOLIDAY.UPDATE` |
| DELETE | `/api/v1/foundation/public-holidays/{holiday_id}` | Xóa mềm ngày nghỉ lễ | `FOUNDATION.HOLIDAY.DELETE` |
| GET | `/api/v1/foundation/public-holidays/check-working-day` | Kiểm tra ngày làm việc | Authenticated |

Query:

```text
year
month
country_code
company_only
from_date
to_date
```

### 9.9 Retention API

| Method | Endpoint | Mô tả | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/retention-policies` | Danh sách retention policy | `FOUNDATION.RETENTION.VIEW` |
| POST | `/api/v1/foundation/retention-policies` | Tạo policy | `FOUNDATION.RETENTION.CREATE` |
| PATCH | `/api/v1/foundation/retention-policies/{policy_id}` | Cập nhật policy | `FOUNDATION.RETENTION.UPDATE` |
| POST | `/api/v1/foundation/retention-policies/{policy_id}/run-dry` | Chạy thử cleanup | `FOUNDATION.RETENTION.RUN` |

MVP chỉ cần skeleton và dry-run, chưa bắt buộc xóa thật dữ liệu nhạy cảm.

---

## 10. Permission seed cho Foundation

Catalog permission Foundation chuẩn (namespace `FOUNDATION.*`, không dùng `SYSTEM.*`) là bản chuẩn ở **BACKEND-11 §8.1**. BACKEND-04 seed đúng theo catalog đó.

### 10.1 Company permissions

```text
FOUNDATION.COMPANY.VIEW
FOUNDATION.COMPANY.UPDATE
```

### 10.2 Module permissions

```text
FOUNDATION.MODULE.VIEW
FOUNDATION.MODULE.UPDATE
```

### 10.3 Setting permissions

```text
FOUNDATION.SETTING.VIEW
FOUNDATION.SETTING.UPDATE
FOUNDATION.SETTING.SYSTEM_MANAGE
```

### 10.4 Audit permissions

```text
FOUNDATION.AUDIT_LOG.VIEW
FOUNDATION.AUDIT_LOG.EXPORT
```

### 10.5 File permissions

```text
FOUNDATION.FILE.UPLOAD
FOUNDATION.FILE.VIEW
FOUNDATION.FILE.DOWNLOAD
FOUNDATION.FILE.DELETE
FOUNDATION.FILE.LINK
FOUNDATION.FILE.UNLINK
```

### 10.6 Sequence permissions

```text
FOUNDATION.SEQUENCE.VIEW
FOUNDATION.SEQUENCE.UPDATE
```

### 10.7 Holiday permissions

```text
FOUNDATION.HOLIDAY.VIEW
FOUNDATION.HOLIDAY.MANAGE
```

### 10.8 Retention permissions

```text
FOUNDATION.RETENTION.VIEW
FOUNDATION.RETENTION.MANAGE
```

### 10.9 Job / Seed permissions

```text
FOUNDATION.JOB.VIEW
FOUNDATION.JOB.RUN
FOUNDATION.SEED.VIEW
FOUNDATION.SEED.RUN
```

---

## 11. Service contract chi tiết

### 11.1 AuditService

Interface đề xuất:

```ts
// Schema chuẩn theo DB-08; bản chuẩn impl ở BACKEND-11 §12.2.
export type WriteAuditInput = {
  companyId?: string | null;
  actorUserId?: string | null;
  actorEmployeeId?: string | null;
  actorType: 'User' | 'System' | 'Job' | 'Integration';
  moduleCode: string;
  action: string;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  sensitivityLevel: string;
  resultStatus: string;
  metadata?: Record<string, unknown>;
  requestContext?: RequestContext;
};

export interface AuditService {
  write(input: WriteAuditInput): Promise<void>;
  maskSensitivePayload(payload: unknown): unknown;
}
```

Yêu cầu triển khai:

1. Không throw làm fail nghiệp vụ chính nếu audit async bị lỗi không nghiêm trọng, nhưng phải log lỗi hệ thống.
2. Với thao tác cực kỳ nhạy cảm như đổi quyền, update settings, xóa file, nên dùng audit trong cùng transaction hoặc outbox đáng tin cậy.
3. Tự động tính `changed_fields` từ `old_values`/`new_values`.
4. Mask trước khi lưu.
5. `actor_type`, `sensitivity_level`, `result_status` là NOT NULL theo DB-08.

### 11.2 SettingService

Interface:

```ts
export interface SettingService {
  getSystemSetting<T>(key: string): Promise<T | null>;
  getCompanySetting<T>(companyId: string, key: string): Promise<T | null>;
  resolveSetting<T>(companyId: string, key: string, fallback?: T): Promise<T>;
  resolveMany(companyId: string, keys: string[]): Promise<Record<string, unknown>>;
  updateCompanySetting(input: UpdateCompanySettingInput): Promise<SettingDto>;
}
```

Cache strategy:

1. Cache setting theo key `company:{companyId}:setting:{settingKey}`.
2. TTL ngắn 5-15 phút hoặc invalidate khi update.
3. Sensitive setting không cache ở client.
4. Khi update setting, xóa cache liên quan.

### 11.3 FileService

Interface:

```ts
export interface FileService {
  upload(input: UploadFileInput): Promise<FileDto>;
  link(input: LinkFileInput): Promise<FileLinkDto>;
  unlink(input: UnlinkFileInput): Promise<void>;
  getMetadata(fileId: string, context: AuthContext): Promise<FileDto>;
  createDownloadUrl(fileId: string, context: AuthContext): Promise<FileDownloadDto>;
  softDelete(fileId: string, context: AuthContext): Promise<void>;
}
```

Validation:

1. File size theo setting `file.max_upload_size_mb`.
2. MIME type theo setting `file.allowed_mime_types`.
3. Không tin MIME type từ client, cần kiểm tra thêm theo file signature nếu có thể.
4. File name phải sanitize.
5. Không cho path traversal.
6. Không ghi public URL vĩnh viễn cho file private.

### 11.4 FilePermissionService

Foundation không thể tự biết toàn bộ rule nghiệp vụ của entity.

Do đó cần cơ chế module owner permission resolver:

```ts
export interface FileOwnerPermissionResolver {
  moduleCode: string;
  canViewFile(input: FilePermissionInput): Promise<boolean>;
  canDownloadFile(input: FilePermissionInput): Promise<boolean>;
  canLinkFile(input: FilePermissionInput): Promise<boolean>;
  canDeleteFile(input: FilePermissionInput): Promise<boolean>;
}
```

Ví dụ:

1. HR đăng ký resolver cho `Employee`, `EmployeeContract`.
2. LEAVE đăng ký resolver cho `LeaveRequest`.
3. TASK đăng ký resolver cho `Project`, `Task`, `TaskComment`.

Nếu chưa có resolver, fallback chỉ cho user có `FOUNDATION.FILE.*` permission.

### 11.5 SequenceService

Interface:

```ts
export interface SequenceService {
  nextCode(input: NextCodeInput): Promise<NextCodeResult>;
  previewNextCode(input: PreviewNextCodeInput): Promise<NextCodeResult>;
  ensureCounter(input: EnsureSequenceCounterInput): Promise<void>;
}
```

Transaction rule:

1. `nextCode` phải chạy trong transaction.
2. Row lock counter bằng `FOR UPDATE`.
3. Nếu counter chưa tồn tại, tạo theo cấu hình seed hoặc input.
4. Nếu reset policy là Yearly/Monthly/Daily thì reset theo kỳ hiện tại.
5. Ghi audit nếu admin thay đổi cấu hình sequence.

### 11.6 HolidayService

Interface:

```ts
export interface HolidayService {
  list(query: HolidayQuery, context: AuthContext): Promise<PaginatedResult<HolidayDto>>;
  isWorkingDay(input: IsWorkingDayInput): Promise<IsWorkingDayResult>;
  getHolidaysInRange(input: HolidayRangeInput): Promise<HolidayDto[]>;
}
```

Rule:

1. Ngày cuối tuần lấy từ company setting hoặc hard-code MVP theo thứ Bảy/Chủ nhật tùy doanh nghiệp.
2. Public holiday company-specific ưu tiên hơn holiday global nếu trùng ngày.
3. LEAVE/ATT gọi service này để tính ngày công/ngày nghỉ.

### 11.7 ModuleRegistryService

Interface:

```ts
export interface ModuleRegistryService {
  getMyApps(context: AuthContext): Promise<MyAppDto[]>;
  getRecentApps(context: AuthContext): Promise<MyAppDto[]>;
  markOpened(moduleCode: string, context: AuthContext): Promise<void>;
  favorite(moduleCode: string, context: AuthContext): Promise<void>;
  unfavorite(moduleCode: string, context: AuthContext): Promise<void>;
  isModuleEnabled(companyId: string, moduleCode: string): Promise<boolean>;
}
```

Visibility rule:

```text
module is active
+ company setting module enabled
+ user has at least one required permission
+ route/app is not hidden by feature flag
```

### 11.8 SeedTrackingService

Interface:

```ts
export interface SeedTrackingService {
  startBatch(seedKey: string, version: string): Promise<SeedBatch>;
  markItemSuccess(batchId: string, itemKey: string, checksum: string): Promise<void>;
  markItemSkipped(batchId: string, itemKey: string, reason: string): Promise<void>;
  markItemFailed(batchId: string, itemKey: string, error: Error): Promise<void>;
  finishBatch(batchId: string): Promise<void>;
}
```

---

## 12. Integration với các module khác

### 12.1 AUTH tích hợp Foundation

AUTH dùng Foundation để:

1. Kiểm tra company status khi login.
2. Lấy company timezone/locale.
3. Ghi audit login/security event quan trọng.
4. Lấy avatar file metadata.
5. Seed permission/role thông qua seed service.
6. Dùng setting password/session policy nếu có.

### 12.2 HR tích hợp Foundation

HR dùng Foundation để:

1. Sinh mã nhân viên bằng SequenceService.
2. Upload/link file hồ sơ và hợp đồng.
3. Ghi audit khi tạo/sửa/đổi trạng thái employee.
4. Đọc company settings liên quan HR.
5. Dùng file permission resolver cho hồ sơ nhạy cảm.

### 12.3 ATT tích hợp Foundation

ATT dùng Foundation để:

1. Đọc public holidays.
2. Upload ảnh/file bằng chứng điều chỉnh công hoặc remote.
3. Ghi audit check-in/out, adjustment, manual update.
4. Sinh mã adjustment/remote request.
5. Đọc setting timezone/company.

### 12.4 LEAVE tích hợp Foundation

LEAVE dùng Foundation để:

1. Sinh mã đơn nghỉ.
2. Dùng public holiday để tính ngày nghỉ trừ phép.
3. Upload/link file chứng minh.
4. Ghi audit khi submit/approve/reject/cancel/revoke.
5. Đọc setting liên quan số ngày làm việc nếu cần.

### 12.5 TASK tích hợp Foundation

TASK dùng Foundation để:

1. Sinh mã project/task.
2. Upload/link file project/task/comment.
3. Ghi audit/project activity cho thao tác quan trọng.
4. Dùng public holidays để cảnh báo deadline rơi vào ngày nghỉ nếu cần.

### 12.6 NOTI tích hợp Foundation

NOTI dùng Foundation để:

1. Lấy module catalog cho event source.
2. Dùng setting notification channel.
3. Ghi audit khi admin cập nhật template/event/channel.
4. Retention delivery logs.

### 12.7 DASH tích hợp Foundation

DASH dùng Foundation để:

1. Lấy module catalog/widget source.
2. Dùng company settings cho dashboard behavior.
3. Ghi audit khi cấu hình widget thay đổi.
4. Retention dashboard widget cache.

---

## 13. Error code Foundation

| Mã lỗi | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `FOUNDATION-ERR-COMPANY-NOT-FOUND` | 404 | Không tìm thấy company |
| `FOUNDATION-ERR-COMPANY-INACTIVE` | 403 | Company không active |
| `FOUNDATION-ERR-MODULE-NOT-FOUND` | 404 | Không tìm thấy module |
| `FOUNDATION-ERR-MODULE-DISABLED` | 403 | Module đang bị tắt |
| `FOUNDATION-ERR-SETTING-NOT-FOUND` | 404 | Không tìm thấy setting |
| `FOUNDATION-ERR-SETTING-SENSITIVE` | 403 | Không được xem setting nhạy cảm |
| `FOUNDATION-ERR-SETTING-INVALID-VALUE` | 400 | Giá trị setting không hợp lệ |
| `FOUNDATION-ERR-FILE-NOT-FOUND` | 404 | Không tìm thấy file |
| `FOUNDATION-ERR-FILE-TOO-LARGE` | 400 | File vượt dung lượng cho phép |
| `FOUNDATION-ERR-FILE-MIME-NOT-ALLOWED` | 400 | MIME type không được phép |
| `FOUNDATION-ERR-FILE-INFECTED` | 422 | File bị đánh dấu nhiễm virus |
| `FOUNDATION-ERR-FILE-FORBIDDEN` | 403 | Không có quyền truy cập file |
| `FOUNDATION-ERR-FILE-DELETED` | 410 | File đã bị xóa |
| `FOUNDATION-ERR-SEQUENCE-NOT-FOUND` | 404 | Không tìm thấy sequence counter |
| `FOUNDATION-ERR-SEQUENCE-CONFLICT` | 409 | Xung đột sequence |
| `FOUNDATION-ERR-HOLIDAY-CONFLICT` | 409 | Trùng ngày nghỉ lễ |
| `FOUNDATION-ERR-AUDIT-FORBIDDEN` | 403 | Không có quyền xem audit |
| `FOUNDATION-ERR-RETENTION-DISABLED` | 422 | Retention policy chưa bật |

---

## 14. Security checklist

### 14.1 Company / tenant

- [ ] Không nhận `company_id` từ body cho nghiệp vụ thường.
- [ ] Mọi query vận hành filter theo auth context.
- [ ] Super Admin scope `System` mới được query liên company.
- [ ] Company inactive/suspended bị chặn ở auth/protected API.

### 14.2 Settings

- [ ] Setting sensitive không trả raw value.
- [ ] Secret lưu bằng `secret_ref` hoặc encrypted value.
- [ ] Public settings chỉ trả `is_public = true` và `is_sensitive = false`.
- [ ] Update setting quan trọng ghi audit.
- [ ] Validate setting theo schema.

### 14.3 Audit

- [ ] Không ghi password/token/secret/signed URL vào audit.
- [ ] Mask field nhạy cảm trước khi insert.
- [ ] Audit log append-only.
- [ ] Export audit cần permission riêng.
- [ ] Query audit có filter company/scope.

### 14.4 Files

- [ ] File private mặc định.
- [ ] Không trả storage path trực tiếp.
- [ ] Validate file size.
- [ ] Validate MIME type.
- [ ] Sanitize filename.
- [ ] Chặn path traversal.
- [ ] Download/preview kiểm tra permission.
- [ ] File sensitive ghi access log.
- [ ] Soft deleted file không được download.
- [ ] Signed URL thời hạn ngắn.

### 14.5 Sequence

- [ ] Dùng transaction + row lock.
- [ ] Không dùng `MAX(code) + 1`.
- [ ] Unique constraint ở bảng nghiệp vụ vẫn phải có để chống trùng.
- [ ] Admin update sequence phải audit.

---

## 15. Performance & index guideline

### 15.1 Query pattern chính

| Query | Pattern |
| --- | --- |
| Current company | `companies.id = authContext.companyId AND status = Active` |
| My apps | module active + permission intersection + company setting |
| Settings resolve | company override -> system fallback |
| Audit list | company_id + module_code + created_at desc |
| File list | company_id + module_code + entity_type/entity_id |
| File download | file_id + company_id + status |
| Sequence next | company_id + sequence_key FOR UPDATE |
| Holiday range | company_id/country_code + holiday_date range |

### 15.2 Cache đề xuất

| Dữ liệu | Cache | Invalidate |
| --- | --- | --- |
| Company current | 5-15 phút | Khi update company |
| Module catalog | 15 phút | Khi update module/settings |
| My apps | 5 phút | Khi quyền user/module setting đổi |
| Public settings | 5-15 phút | Khi update setting |
| Holiday year | 1 giờ | Khi holiday thay đổi |
| Audit list | Không cache mặc định | Không áp dụng |
| File metadata | Ngắn 1-5 phút | Khi update/delete/link |

### 15.3 Không cache dữ liệu nhạy cảm ở frontend

Frontend có thể cache app registry/public setting, nhưng không nên cache:

1. Audit log chi tiết.
2. File signed URL lâu dài.
3. Sensitive setting.
4. File access log.

---

## 16. Job nền

### 16.1 Retention cleanup job

Lịch đề xuất:

```text
Daily at 02:00 company timezone hoặc server timezone
```

MVP triển khai skeleton:

1. Load active retention policy.
2. Dry run số bản ghi cần cleanup.
3. Ghi job log.
4. Không xóa thật nếu `policy.is_enforced = false`.

### 16.2 Temporary file cleanup job

Mục tiêu:

1. Xóa file upload tạm không link entity sau N giờ/ngày.
2. Xóa signed URL expired nếu có bảng riêng.
3. Ghi audit/system log.

### 16.3 Seed verification job / command

Command:

```bash
npm run seed:verify
```

Kiểm tra:

1. Modules MVP tồn tại.
2. Permissions Foundation tồn tại.
3. Roles có role_permissions tương ứng.
4. Default company tồn tại nếu môi trường cần.
5. Public settings/file settings/audit settings tồn tại.

---

## 17. Logging & observability

Foundation cần log kỹ các nhóm sau:

1. File upload/download/delete.
2. Setting update.
3. Company suspend/activate.
4. Module enable/disable.
5. Sequence generation failure.
6. Audit write failure.
7. Retention cleanup result.
8. Seed batch result.

Log phải có:

```text
request_id
correlation_id
company_id
actor_user_id
module_code
action
status
error_code nếu lỗi
```

Không log secret, token, signed URL, password hoặc storage path private ở mức info/debug.

---

## 18. Testing plan

### 18.1 Unit test

| Service | Test chính |
| --- | --- |
| SettingService | Resolve precedence company -> system -> fallback |
| AuditMaskerService | Mask field nhạy cảm, không làm mất cấu trúc diff |
| FileService | Validate size/MIME/name, tạo metadata đúng |
| FilePermissionService | Resolver fallback, deny by default |
| SequenceService | Format code, reset policy, row lock mock |
| HolidayService | Check working day, holiday global/company override |
| ModuleRegistryService | Filter app theo permission/module status |
| SeedTrackingService | Idempotent batch/item, checksum mismatch |

### 18.2 Integration test

1. Upload file -> tạo metadata -> link entity -> download -> ghi file access log.
2. Update company setting -> audit log -> cache invalidation.
3. Generate sequence đồng thời nhiều request -> không trùng mã.
4. Get my apps với user permission khác nhau -> trả đúng app.
5. Query audit với Company scope -> không thấy audit company khác.
6. Public setting API -> không trả sensitive setting.
7. Holiday range query -> ATT/LEAVE có thể dùng được.

### 18.3 Permission/scope test

| Scenario | Kỳ vọng |
| --- | --- |
| Employee gọi audit logs | 403 |
| HR không có FOUNDATION.FILE.DOWNLOAD tải file contract ngoài scope | 403 |
| Admin company xem company hiện tại | 200 |
| Admin company xem company khác | 403 |
| Super Admin scope System xem all companies | 200 |
| User thiếu permission vẫn gọi my-apps | 200 nhưng app bị lọc |
| User thiếu module permission mở app | 403 hoặc app không xuất hiện |

### 18.4 Security test

1. Upload file `.exe` đổi đuôi `.pdf` phải bị chặn nếu MIME/signature không hợp lệ.
2. File name có `../../` phải sanitize.
3. Sensitive setting không trả qua public endpoint.
4. Audit log không chứa token/password.
5. Storage path không xuất hiện trong response download.
6. Signed URL hết hạn đúng cấu hình.
7. API không chấp nhận spoof `company_id` từ body.

---

## 19. Implementation sequence

### Phase 1 - Foundation module skeleton

1. Tạo `FoundationModule`.
2. Tạo shared constants: permission, error code, module code.
3. Tạo repository base filter theo company.
4. Tạo DTO/mapper/response theo API-01.
5. Kết nối AuthContext từ BACKEND-03.

### Phase 2 - Company & Module catalog

1. Implement CompanyService.
2. Implement ModuleCatalogService.
3. API `/company/current`.
4. API `/modules/my-apps`.
5. API recent/favorite/open nếu đã có bảng preference; nếu chưa có, trả recent/favorite rỗng và ghi TODO rõ.
6. Audit update module/company.

### Phase 3 - Settings

1. Implement SettingRepository.
2. Implement SettingService resolve precedence.
3. Implement public settings endpoint.
4. Implement admin settings endpoint.
5. Validate value/schema.
6. Cache + invalidate.
7. Audit update setting.

### Phase 4 - Audit

1. Implement AuditService.
2. Implement AuditMaskerService.
3. Implement helper/decorator `@Audited` nếu framework hỗ trợ.
4. Implement audit list/detail API.
5. Áp permission/scope.
6. Thêm audit vào Foundation actions.

### Phase 5 - Files

1. Implement FileStoragePort.
2. Implement LocalPrivateStorageAdapter.
3. Implement FileService upload metadata.
4. Implement FileLinkService.
5. Implement download/preview flow.
6. Implement FileAccessLogService.
7. Validate file size/MIME/name.
8. Permission resolver registry.

### Phase 6 - Sequence & Holidays

1. Implement SequenceService transaction row lock.
2. Implement sequence preview.
3. Implement HolidayService CRUD/check working day.
4. Add integration test concurrent sequence.
5. Add holiday service contract for ATT/LEAVE.

### Phase 7 - Retention & Seed Tracking

1. Implement SeedTrackingService.
2. Connect seed runner from BACKEND-02.
3. Implement RetentionService CRUD.
4. Implement cleanup job skeleton dry-run.
5. Add verification command.

### Phase 8 - QA hardening

1. Run permission/scope tests.
2. Run file security tests.
3. Run sequence concurrency tests.
4. Run audit masking tests.
5. Validate OpenAPI docs.
6. Validate frontend integration for Home Portal/App Switcher/upload/settings.

---

## 20. API response examples

### 20.1 Get current company

```http
GET /api/v1/foundation/company/current
Authorization: Bearer <access_token>
```

```json
{
  "success": true,
  "message": "Lấy thông tin công ty thành công",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "company_code": "DEFAULT",
    "name": "Default Company",
    "timezone": "Asia/Ho_Chi_Minh",
    "default_locale": "vi-VN",
    "status": "Active"
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 20.2 Public settings

```http
GET /api/v1/foundation/settings/public
```

```json
{
  "success": true,
  "message": "Lấy cấu hình public thành công",
  "data": {
    "system.default_timezone": "Asia/Ho_Chi_Minh",
    "system.default_locale": "vi-VN",
    "file.max_upload_size_mb": 20,
    "file.allowed_mime_types": ["application/pdf", "image/png", "image/jpeg"]
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 20.3 File upload response

```json
{
  "success": true,
  "message": "Upload file thành công",
  "data": {
    "id": "file_uuid",
    "original_name": "contract.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 123456,
    "visibility": "Private",
    "upload_status": "Uploaded",
    "scan_status": "Pending",
    "module_code": "HR",
    "created_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 21. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| BE04-OQ-001 | Backend dùng storage local private trong MVP hay MinIO/S3 ngay từ đầu? | BE/DevOps | Cao |
| BE04-OQ-002 | Có tạo bảng `user_module_preferences` cho recent/favorite app ở MVP không? | Product/BE/FE | Trung bình |
| BE04-OQ-003 | File antivirus scan có làm mock `scan_status` `Pending/Clean` trong MVP không? | BE/Security | Trung bình |
| BE04-OQ-004 | Weekend mặc định là Chủ nhật hay Thứ bảy + Chủ nhật? | Product/HR | Cao |
| BE04-OQ-005 | Public holiday seed theo Việt Nam có cần có ngay không? | Product/HR | Trung bình |
| BE04-OQ-006 | Retention job MVP chỉ dry-run hay cho phép cleanup thật? | BE/Admin | Trung bình |
| BE04-OQ-007 | Audit log ghi synchronous hay dùng outbox/event async? | BE Lead | Cao |
| BE04-OQ-008 | Có cần field-level permission cho audit sensitive ngay MVP không? | BE/Product | Cao |

---

## 22. Definition of Done

BACKEND-04 được xem là hoàn thành khi:

1. Có `FoundationModule` chạy được cùng backend app.
2. Có CompanyService và API lấy company hiện tại.
3. Có ModuleCatalogService và API `my-apps` phục vụ Home Portal/App Switcher.
4. Có SettingService resolve system/company settings, public setting endpoint và admin update setting.
5. Có AuditService ghi log append-only, mask dữ liệu nhạy cảm và audit list API.
6. Có FileService upload metadata, storage adapter, link/unlink, download/preview, file access log.
7. Có SequenceService sinh mã bằng transaction + row lock.
8. Có HolidayService CRUD và check working day.
9. Có SeedTrackingService gắn được với seed runner.
10. Có RetentionService và cleanup job skeleton/dry-run.
11. Có permission constants và seed permissions Foundation/System.
12. Mọi public API Foundation dùng AuthGuard/PermissionGuard/DataScopeGuard phù hợp.
13. Mọi query vận hành filter theo `company_id` từ AuthContext.
14. Không response nào trả password/token/secret/storage path private/signed URL dài hạn.
15. Có unit test cho Setting, AuditMasker, File validation, Sequence, Holiday, ModuleRegistry.
16. Có integration test cho upload/link/download, sequence concurrent, setting update audit, my-apps permission filter.
17. Có OpenAPI/Swagger cho các endpoint Foundation.
18. Frontend có thể dùng API Foundation để hiển thị Home Portal/App Switcher, settings public và upload/download file cơ bản.

---

## 23. Kết luận

BACKEND-04 hoàn thiện lớp Foundation Backend cho toàn bộ hệ thống.

Tư duy triển khai chính:

```text
Foundation không xử lý nghiệp vụ gốc
-> Foundation cung cấp hạ tầng dùng chung
-> Tenant/company luôn lấy từ AuthContext
-> Settings có precedence rõ ràng
-> Audit append-only và phải mask sensitive data
-> File private mặc định, không lộ storage path
-> Sequence dùng transaction + row lock
-> Holiday dùng chung cho ATT/LEAVE
-> Seed idempotent để môi trường ổn định
-> Retention chuẩn bị từ MVP để tránh nợ kỹ thuật
```

Sau BACKEND-04, backend team có thể triển khai tiếp:

```text
BACKEND-05: HR Backend
```

BACKEND-05 sẽ tái sử dụng Foundation ở các điểm quan trọng: sinh mã nhân viên, file hồ sơ/hợp đồng, audit log, setting, company context và permission/scope guard.
