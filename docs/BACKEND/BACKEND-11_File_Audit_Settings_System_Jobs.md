# BACKEND-11: FILE, AUDIT, SETTINGS & SYSTEM JOBS
# TRIỂN KHAI BACKEND FOUNDATION CHO FILE, AUDIT, CẤU HÌNH VÀ JOB NỀN

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · **BACKEND-11 File/Audit/Settings/Jobs** · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-01 §16](<../SPEC/SPEC-01 Tổng quan.md>) · [DB: DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [API: API-09 Foundation](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Frontend: FRONTEND-13](<../FRONTEND/FRONTEND-13_System_Foundation_Frontend.md>) · [Skeleton: BACKEND-04](<BACKEND-04_Foundation_Backend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-11 |
| Tên tài liệu | File, Audit, Settings & System Jobs Backend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Nhóm module | FOUNDATION / SYSTEM / SHARED INFRASTRUCTURE |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, BACKEND-01 -> BACKEND-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch triển khai backend cho nhóm chức năng nền tảng dùng chung của hệ thống, bao gồm:

1. Quản lý file metadata, upload, download, link/unlink file với entity nghiệp vụ.
2. Kiểm soát quyền truy cập file private.
3. Ghi log truy cập file nhạy cảm.
4. Ghi audit log toàn hệ thống cho thao tác quan trọng.
5. Quản lý system settings và company settings.
6. Quản lý module catalog và app registry ở mức backend.
7. Quản lý sequence counter để sinh mã tự động an toàn.
8. Quản lý public holidays dùng chung cho Attendance và Leave.
9. Quản lý retention policy và cleanup/archive job.
10. Quản lý seed tracking, idempotent seed và bootstrap job.
11. Triển khai các system jobs định kỳ như cleanup file tạm, archive log, warmup cache, notification digest hoặc overdue detector nếu cần.

BACKEND-11 là lớp backend nền sau khi các module nghiệp vụ chính đã có backend riêng. Lớp này không xử lý nghiệp vụ gốc thay HR, ATT, LEAVE, TASK, NOTI hoặc DASH; nó cung cấp hạ tầng dùng chung để các module đó vận hành nhất quán, bảo mật và dễ truy vết.

---

## 3. Vị trí BACKEND-11 trong roadmap backend

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

BACKEND-11 có thể xem là phần hoàn thiện sâu cho Foundation Backend. Nếu BACKEND-04 đã tạo skeleton foundation, BACKEND-11 đi vào triển khai thực tế các service dùng chung, job nền, rule bảo mật và checklist vận hành.

---

## 4. Căn cứ triển khai

BACKEND-11 bám theo các quyết định đã chốt:

1. Foundation là lớp hạ tầng dữ liệu dùng chung, không phải một module nghiệp vụ độc lập.
2. Các bảng trọng tâm gồm `companies`, `modules`, `system_settings`, `company_settings`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`.
3. Mọi dữ liệu vận hành cần filter theo `company_id` từ auth context, không tin `company_id` do frontend gửi.
4. Backend là nguồn kiểm soát quyền cuối cùng.
5. File binary không lưu trong database; database chỉ lưu metadata và storage reference.
6. File private là mặc định; backend chỉ cấp link tải ngắn hạn sau khi kiểm tra permission.
7. `file_links` là polymorphic reference, backend phải validate entity gốc, company và quyền truy cập.
8. Audit log là append-only ledger, phải mask dữ liệu nhạy cảm trước khi ghi.
9. Settings có precedence: system default -> company override -> module-specific setting nếu có.
10. Sequence counter phải dùng transaction và row lock, không dùng `MAX(code) + 1`.
11. Public holiday dùng chung cho ATT, LEAVE, DASH và Payroll phase sau.
12. Retention job phải có rule rõ ràng, không xóa dữ liệu quan trọng nếu chưa đủ điều kiện.
13. Seed data phải idempotent, có batch/item tracking và checksum.
14. Job nền phải có lock, retry, idempotency, logging và monitoring.

---

## 5. Phạm vi BACKEND-11

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung triển khai |
| --- | --- |
| File Service | Upload, metadata, validate MIME/size, checksum, scan status cơ bản, download signed URL, soft delete |
| File Link Service | Link/unlink file với employee, contract, attendance adjustment, leave request, project, task, comment |
| File Access Log | Ghi log khi xem/tải/xóa file nhạy cảm hoặc file private |
| Audit Service | Ghi audit log thủ công và tự động qua interceptor/decorator |
| Audit Query API | Admin/HR/Super Admin xem audit log theo quyền và scope |
| Setting Service | Đọc setting theo precedence, update system/company settings theo quyền |
| Module Catalog Service | Trả danh sách module/app khả dụng, active/inactive, permission mapping |
| Sequence Service | Sinh mã employee, leave request, project, task, attendance adjustment nếu cần |
| Holiday Service | CRUD public holidays, kiểm tra ngày nghỉ trong khoảng thời gian |
| Retention Service | Đọc policy và chạy job cleanup/archive log/cache/file tạm |
| Seed Service | Theo dõi seed batch, seed item, idempotent seed và bootstrap data |
| System Jobs | Scheduler, distributed lock, job run log, retry, cleanup, archive, warmup |
| Security | Permission guard, data scope guard, masking, storage path protection |
| Testing | Unit test, integration test, permission test, job idempotency test |

### 5.2 Chưa bắt buộc trong MVP nhưng cần chừa thiết kế

| Nhóm | Giai đoạn | Hướng mở rộng |
| --- | --- | --- |
| Antivirus scan thật | Phase sau | Tích hợp ClamAV hoặc cloud malware scan |
| Object storage production | Phase sau | S3/GCS/Azure Blob/MinIO, signed URL, lifecycle policy |
| File versioning | Phase sau | Bảng `file_versions`, version history, restore |
| Legal hold | Phase sau | Chặn retention delete khi có legal hold |
| Advanced audit search | Phase sau | Đồng bộ audit log sang OpenSearch/Elastic |
| Config approval workflow | Phase sau | Setting quan trọng cần duyệt trước khi áp dụng |
| Background export | Phase sau | Export HR/ATT/LEAVE/TASK chạy async job |
| Job queue distributed | Phase sau | BullMQ/RabbitMQ/Kafka/SQS tùy hạ tầng |
| Admin job console | Phase sau | UI xem job run, retry, pause/resume |

---

## 6. Kiến trúc backend tổng quan

### 6.1 Module backend đề xuất

```text
src/modules/foundation
  ├── company
  ├── module-catalog
  ├── settings
  ├── audit
  ├── files
  ├── sequence
  ├── holidays
  ├── retention
  ├── seed
  └── system-jobs
```

### 6.2 Layer chuẩn

Mỗi nhóm service nên tuân theo cấu trúc:

```text
controller -> dto/validator -> service -> domain policy -> repository -> database/storage
```

Riêng file service có thêm adapter storage:

```text
FileController
  -> FileService
    -> FilePolicyService
    -> FileRepository
    -> FileLinkRepository
    -> FileAccessLogService
    -> StorageAdapter
      -> LocalPrivateStorageAdapter
      -> S3StorageAdapter / MinioStorageAdapter sau MVP
```

Riêng system jobs có thêm scheduler/lock:

```text
Scheduler
  -> JobRegistry
    -> JobLockService
    -> JobRunner
      -> RetentionCleanupJob
      -> TemporaryFileCleanupJob
      -> AuditArchiveJob
      -> DashboardCacheCleanupJob
      -> NotificationRetryJob
```

---

## 7. Cấu trúc thư mục đề xuất

```text
src/
  modules/
    foundation/
      foundation.module.ts

      company/
        company.controller.ts
        company.service.ts
        company.repository.ts
        dto/

      module-catalog/
        module-catalog.controller.ts
        module-catalog.service.ts
        module-catalog.repository.ts
        dto/

      settings/
        settings.controller.ts
        settings.service.ts
        settings.repository.ts
        settings-cache.service.ts
        settings-validation.service.ts
        dto/

      audit/
        audit.controller.ts
        audit.service.ts
        audit.repository.ts
        audit.interceptor.ts
        audit.decorator.ts
        audit-masker.service.ts
        audit-diff.service.ts
        dto/

      files/
        files.controller.ts
        files.service.ts
        file-policy.service.ts
        file-link.service.ts
        file-access-log.service.ts
        file.repository.ts
        file-link.repository.ts
        storage/
          storage-adapter.interface.ts
          local-private-storage.adapter.ts
          s3-storage.adapter.ts
        dto/

      sequence/
        sequence.service.ts
        sequence.repository.ts
        sequence-format.service.ts
        dto/

      holidays/
        holidays.controller.ts
        holidays.service.ts
        holidays.repository.ts
        dto/

      retention/
        retention.controller.ts
        retention.service.ts
        retention.repository.ts
        retention-policy.service.ts
        dto/

      seed/
        seed.service.ts
        seed-runner.service.ts
        seed.repository.ts
        seed-checksum.service.ts
        initial-seeds/

      system-jobs/
        system-jobs.module.ts
        system-jobs.controller.ts
        system-job.service.ts
        job-lock.service.ts
        job-run-log.service.ts
        jobs/
          temporary-file-cleanup.job.ts
          audit-log-retention.job.ts
          file-access-log-retention.job.ts
          dashboard-cache-cleanup.job.ts
          notification-delivery-retry.job.ts
          leave-accrual-placeholder.job.ts
          task-overdue-detector.job.ts
```

---

## 8. Permission đề xuất cho FOUNDATION

### 8.1 Nhóm permission

| Permission code | Mô tả | Scope đề xuất |
| --- | --- | --- |
| `FOUNDATION.COMPANY.VIEW` | Xem thông tin company | Company, System |
| `FOUNDATION.COMPANY.UPDATE` | Cập nhật thông tin company | Company, System |
| `FOUNDATION.MODULE.VIEW` | Xem module catalog | Company, System |
| `FOUNDATION.MODULE.UPDATE` | Bật/tắt/cập nhật module | System |
| `FOUNDATION.SETTING.VIEW` | Xem setting không nhạy cảm | Company, System |
| `FOUNDATION.SETTING.UPDATE` | Cập nhật company setting | Company, System |
| `FOUNDATION.SETTING.SYSTEM_MANAGE` | Quản lý system setting | System |
| `FOUNDATION.FILE.UPLOAD` | Upload file dùng chung | Own, Team, Department, Company |
| `FOUNDATION.FILE.VIEW` | Xem metadata file | Own, Team, Department, Company, System |
| `FOUNDATION.FILE.DOWNLOAD` | Tải file | Own, Team, Department, Company, System |
| `FOUNDATION.FILE.DELETE` | Xóa mềm file | Own, Team, Department, Company, System |
| `FOUNDATION.FILE.LINK` | Link file vào entity nghiệp vụ | Own, Team, Department, Company |
| `FOUNDATION.FILE.UNLINK` | Gỡ file khỏi entity nghiệp vụ | Own, Team, Department, Company |
| `FOUNDATION.AUDIT_LOG.VIEW` | Xem audit log cross-module | Company, System |
| `FOUNDATION.AUDIT_LOG.EXPORT` | Export audit log cross-module | Company, System |
| `FOUNDATION.SEQUENCE.VIEW` | Xem sequence counter | Company, System |
| `FOUNDATION.SEQUENCE.UPDATE` | Cập nhật/reset sequence | Company, System |
| `FOUNDATION.HOLIDAY.VIEW` | Xem public holidays | Own, Company, System |
| `FOUNDATION.HOLIDAY.MANAGE` | Quản lý public holidays | Company, System |
| `FOUNDATION.RETENTION.VIEW` | Xem retention policy | Company, System |
| `FOUNDATION.RETENTION.MANAGE` | Quản lý retention policy | System |
| `FOUNDATION.JOB.VIEW` | Xem trạng thái job/run log | Company, System |
| `FOUNDATION.JOB.RUN` | Chạy job thủ công | System |
| `FOUNDATION.SEED.VIEW` | Xem seed batch/item | System |
| `FOUNDATION.SEED.RUN` | Chạy seed thủ công | System |

> **Drift reconciliation 22/06 (theo SPEC-DRIFT-MATRIX §1, AU-2/AU-3):** mã audit của Foundation **chuẩn = `FOUNDATION.AUDIT_LOG.*`** (resource `AUDIT_LOG`, khớp [API-09](<../API Design/API-09_FOUNDATION_API_Design.md>) / [API-10 §5.8](<../API Design/API-10 PERMISSION MATRIX.md>) / [FRONTEND-13](<../FRONTEND/FRONTEND-13_System_Foundation_Frontend.md>)). Mã cũ `FOUNDATION.AUDIT.VIEW/EXPORT` (không có `_LOG`) **không còn dùng**.
> **Ranh giới với `AUTH.AUDIT_LOG.VIEW` (AU-3):** audit thuộc **AUTH-domain** (login/security/đăng nhập/đổi mật khẩu/khóa-mở user/role-permission) đọc qua `AUTH.AUDIT_LOG.VIEW` (module AUTH); audit **cross-module / toàn hệ thống** (truy vết entity bất kỳ qua `audit-logs` Foundation) đọc qua `FOUNDATION.AUDIT_LOG.VIEW/EXPORT`. Cả hai cùng đọc bảng `audit_logs` chung nhưng khác phạm vi guard.

### 8.2 Nguyên tắc không hard-code role

Backend không nên kiểm tra kiểu:

```text
if role == HR then allow
```

Backend kiểm tra:

```text
permission + data_scope + target entity + business rule
```

Role chỉ là nhóm quyền được seed mặc định.

---

## 9. API tổng quan cho BACKEND-11

Tất cả public API dùng prefix:

```http
/api/v1/foundation
```

Internal/job API dùng prefix:

```http
/internal/v1/foundation
```

### 9.1 Company API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/company/current` | `FOUNDATION.COMPANY.VIEW` | Lấy company hiện tại |
| PATCH | `/api/v1/foundation/company/current` | `FOUNDATION.COMPANY.UPDATE` | Cập nhật company hiện tại |
| POST | `/api/v1/foundation/company/current/logo` | `FOUNDATION.COMPANY.UPDATE` | Upload/cập nhật logo company |

### 9.2 Module catalog / app registry API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/modules` | `FOUNDATION.MODULE.VIEW` | Danh sách module catalog |
| GET | `/api/v1/foundation/modules/my-apps` | Authenticated | App user hiện tại được thấy |
| GET | `/api/v1/foundation/modules/recent-apps` | Authenticated | App mở gần đây |
| POST | `/api/v1/foundation/modules/{module_code}/open` | Authenticated | Ghi recent app / mở module |
| POST | `/api/v1/foundation/modules/{module_code}/favorite` | Authenticated | Đánh dấu favorite app |
| DELETE | `/api/v1/foundation/modules/{module_code}/favorite` | Authenticated | Bỏ favorite app |
| PATCH | `/api/v1/foundation/modules/{module_code}` | `FOUNDATION.MODULE.UPDATE` | Cập nhật metadata/status module |

### 9.3 Settings API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/settings/public` | Authenticated | Setting public an toàn cho frontend |
| GET | `/api/v1/foundation/settings` | `FOUNDATION.SETTING.VIEW` | Danh sách setting theo quyền |
| GET | `/api/v1/foundation/settings/{setting_key}` | `FOUNDATION.SETTING.VIEW` | Chi tiết setting |
| PATCH | `/api/v1/foundation/settings/{setting_key}` | `FOUNDATION.SETTING.UPDATE` | Cập nhật company setting |
| GET | `/api/v1/foundation/system-settings` | `FOUNDATION.SETTING.SYSTEM_MANAGE` | Danh sách system setting |
| PATCH | `/api/v1/foundation/system-settings/{setting_key}` | `FOUNDATION.SETTING.SYSTEM_MANAGE` | Cập nhật system setting |
| POST | `/api/v1/foundation/settings/resolve` | `FOUNDATION.SETTING.VIEW` | Resolve nhiều setting theo key |

### 9.4 File API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| POST | `/api/v1/foundation/files/upload` | `FOUNDATION.FILE.UPLOAD` | Upload file chung |
| GET | `/api/v1/foundation/files` | `FOUNDATION.FILE.VIEW` | Danh sách file metadata theo scope |
| GET | `/api/v1/foundation/files/{file_id}` | `FOUNDATION.FILE.VIEW` | Chi tiết metadata file |
| GET | `/api/v1/foundation/files/{file_id}/download-url` | `FOUNDATION.FILE.DOWNLOAD` | Lấy signed URL / stream token |
| GET | `/api/v1/foundation/files/{file_id}/download` | `FOUNDATION.FILE.DOWNLOAD` | Tải file qua backend stream |
| DELETE | `/api/v1/foundation/files/{file_id}` | `FOUNDATION.FILE.DELETE` | Xóa mềm file nếu được phép |
| POST | `/api/v1/foundation/files/{file_id}/links` | `FOUNDATION.FILE.LINK` | Link file với entity nghiệp vụ |
| DELETE | `/api/v1/foundation/files/{file_id}/links/{link_id}` | `FOUNDATION.FILE.UNLINK` | Gỡ link file |
| GET | `/api/v1/foundation/file-links` | `FOUNDATION.FILE.VIEW` | Lấy file theo entity |

> **CHỐT 2026-07-02:** Notation `FOUNDATION.FILE.DOWNLOAD` (dòng 389-390) map → tuple engine `(action="download", resource_type="foundation-file")` — khớp seed `0435:350 ('download','foundation-file',false)` và `@RequirePermission("download","foundation-file")` ở `files.controller.ts`. Cả hai endpoint `download-url` và `download` cùng gate tuple này; `download` KHÔNG stream binary mà `res.redirect(302, signedUrl)` (bỏ cụm "stream token"/"backend stream" ở mô tả — xem §11.9).

### 9.5 Audit API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/audit-logs` | `FOUNDATION.AUDIT_LOG.VIEW` | Danh sách audit logs |
| GET | `/api/v1/foundation/audit-logs/{audit_log_id}` | `FOUNDATION.AUDIT_LOG.VIEW` | Chi tiết audit log |
| GET | `/api/v1/foundation/audit-logs/entity/{entity_type}/{entity_id}` | `FOUNDATION.AUDIT_LOG.VIEW` | Audit theo entity |
| GET | `/api/v1/foundation/audit-logs/export` | `FOUNDATION.AUDIT_LOG.EXPORT` | Export audit log |

### 9.6 Sequence API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/sequences` | `FOUNDATION.SEQUENCE.VIEW` | Danh sách sequence counters |
| GET | `/api/v1/foundation/sequences/{sequence_key}` | `FOUNDATION.SEQUENCE.VIEW` | Chi tiết sequence |
| POST | `/api/v1/foundation/sequences/{sequence_key}/preview` | `FOUNDATION.SEQUENCE.VIEW` | Preview mã tiếp theo |
| PATCH | `/api/v1/foundation/sequences/{sequence_key}` | `FOUNDATION.SEQUENCE.UPDATE` | Cập nhật format/current/reset rule |
| POST | `/internal/v1/foundation/sequences/{sequence_key}/next` | Internal | Sinh mã nội bộ cho module khác |

### 9.7 Public Holiday API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/public-holidays` | `FOUNDATION.HOLIDAY.VIEW` | Danh sách ngày nghỉ lễ |
| POST | `/api/v1/foundation/public-holidays` | `FOUNDATION.HOLIDAY.MANAGE` | Tạo ngày nghỉ lễ |
| PATCH | `/api/v1/foundation/public-holidays/{holiday_id}` | `FOUNDATION.HOLIDAY.MANAGE` | Cập nhật ngày nghỉ lễ |
| DELETE | `/api/v1/foundation/public-holidays/{holiday_id}` | `FOUNDATION.HOLIDAY.MANAGE` | Xóa mềm ngày nghỉ lễ |
| POST | `/internal/v1/foundation/public-holidays/check` | Internal | Kiểm tra ngày nghỉ cho ATT/LEAVE |

### 9.8 Retention API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/retention-policies` | `FOUNDATION.RETENTION.VIEW` | Danh sách retention policy |
| POST | `/api/v1/foundation/retention-policies` | `FOUNDATION.RETENTION.MANAGE` | Tạo policy |
| PATCH | `/api/v1/foundation/retention-policies/{policy_id}` | `FOUNDATION.RETENTION.MANAGE` | Cập nhật policy |
| POST | `/api/v1/foundation/retention-policies/{policy_id}/simulate` | `FOUNDATION.RETENTION.VIEW` | Preview số record bị ảnh hưởng |

### 9.9 System Jobs API

| Method | Endpoint | Permission | Mục đích |
| --- | --- | --- | --- |
| GET | `/api/v1/foundation/system-jobs` | `FOUNDATION.JOB.VIEW` | Danh sách job |
| GET | `/api/v1/foundation/system-jobs/{job_code}/runs` | `FOUNDATION.JOB.VIEW` | Lịch sử chạy job |
| POST | `/api/v1/foundation/system-jobs/{job_code}/run` | `FOUNDATION.JOB.RUN` | Chạy job thủ công |
| POST | `/api/v1/foundation/system-jobs/{job_code}/pause` | `FOUNDATION.JOB.RUN` | Tạm dừng job |
| POST | `/api/v1/foundation/system-jobs/{job_code}/resume` | `FOUNDATION.JOB.RUN` | Bật lại job |

---

## 10. Chuẩn response chung

### 10.1 Object response

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 10.2 List response

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 10.3 Error response

```json
{
  "success": false,
  "message": "Bạn không có quyền tải file này",
  "error": {
    "code": "FOUNDATION-FILE-ERR-403",
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

## 11. Triển khai File Backend

### 11.1 Mục tiêu

File backend cần xử lý các trường hợp:

1. Upload file từ HR, ATT, LEAVE, TASK hoặc SYSTEM.
2. Lưu metadata vào `files`.
3. Lưu binary vào private storage.
4. Link file với entity nghiệp vụ qua `file_links`.
5. Validate file theo rule system/company/module/entity.
6. Không expose storage path/private URL.
7. Cấp download stream hoặc signed URL ngắn hạn sau khi kiểm tra quyền.
8. Ghi `file_access_logs` cho file private/nhạy cảm.
9. Cho phép cleanup file tạm hoặc file không còn link.

### 11.2 Trạng thái file

File dùng **hai field riêng** theo DB-08 CHECK, không gộp một enum. Trạng thái "Linked" thể hiện qua bảng `file_links` (không phải status); archive nằm ngoài MVP.

`upload_status`:

| Giá trị | Ý nghĩa |
| --- | --- |
| `Pending` | Đang upload, chưa hoàn tất |
| `Uploaded` | Upload thành công, metadata đã lưu |
| `Failed` | Upload thất bại |
| `Deleted` | Xóa mềm |

`scan_status`:

| Giá trị | Ý nghĩa |
| --- | --- |
| `NotRequired` | Không cần scan |
| `Pending` | Chờ scan |
| `Clean` | Scan sạch |
| `Infected` | Phát hiện nhiễm (file bị giữ lại / quarantine) |
| `Failed` | Scan thất bại |

### 11.3 Visibility file

| Visibility | Mô tả |
| --- | --- |
| `Private` | Mặc định. Cần permission mới xem/tải được |
| `Internal` | Chỉ user trong company và có quyền liên quan |
| `Public` | Rất hạn chế, chỉ dùng cho logo/icon hoặc tài nguyên công khai |

MVP mặc định mọi file upload từ module nghiệp vụ là `Private`.

### 11.4 DTO upload file

```ts
export type UploadFileRequest = {
  module_code: 'HR' | 'ATT' | 'LEAVE' | 'TASK' | 'FOUNDATION';
  entity_type?: string;
  entity_id?: string;
  link_type?: string;
  file_category?: string;
  is_sensitive?: boolean;
  metadata?: Record<string, unknown>;
};
```

File binary gửi bằng `multipart/form-data` field `file`.

### 11.5 Response upload file

```json
{
  "success": true,
  "message": "Upload file thành công",
  "data": {
    "id": "file_uuid",
    "original_name": "hop-dong-nguyen-van-a.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 245000,
    "visibility": "Private",
    "upload_status": "Uploaded",
    "scan_status": "Pending",
    "linked": true,
    "links": [
      {
        "id": "link_uuid",
        "module_code": "HR",
        "entity_type": "EmployeeContract",
        "entity_id": "contract_uuid",
        "link_type": "ContractDocument"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_110001",
    "timestamp": "2026-06-20T11:00:00+07:00"
  }
}
```

### 11.6 Validation file

File service phải validate:

1. File không rỗng.
2. File không vượt `file.max_upload_size_mb`.
3. MIME type nằm trong whitelist.
4. Extension khớp MIME type nếu có thể.
5. Tên file được normalize, chống path traversal.
6. Checksum được tính để phục vụ deduplicate và audit.
7. Không nhận executable/script nếu không được cấu hình.
8. Nếu entity được truyền, entity phải tồn tại và cùng company.
9. User phải có quyền upload/link file vào entity đó.
10. Nếu file nhạy cảm, phải đánh dấu `is_sensitive = true` hoặc module gốc truyền vào.

### 11.7 Storage adapter interface

```ts
export interface StorageAdapter {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getObject(input: GetObjectInput): Promise<NodeJS.ReadableStream>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  generateSignedUrl(input: SignedUrlInput): Promise<string>;
  objectExists(input: ObjectExistsInput): Promise<boolean>;
}
```

### 11.8 Local private storage MVP

MVP có thể dùng local private storage:

```text
/storage/private/{company_id}/{yyyy}/{mm}/{file_id}.{ext}
```

Quy tắc:

1. Thư mục storage không nằm trong public static root.
2. Backend stream file sau khi kiểm tra quyền.
3. Không trả `storage_path` cho frontend.
4. Có thể cấu hình path qua environment variable.
5. Production nên chuyển sang object storage.

### 11.9 File download flow

```text
User gọi GET /files/{file_id}/download-url hoặc /download
  -> AuthGuard kiểm tra đăng nhập
  -> PermissionGuard kiểm tra FOUNDATION.FILE.DOWNLOAD
  -> FileService lấy metadata file
  -> FilePolicyService resolve quyền theo file_links và module gốc
  -> Kiểm tra company_id, visibility, deleted_at, upload_status
  -> Ghi file_access_logs nếu file private/sensitive
  -> Trả signed URL ngắn hạn hoặc stream file
```

> **CHỐT 2026-07-02:** Triển khai thật KHÔNG stream binary qua backend — `download` = `res.redirect(302, signedUrl)` với TTL-ngắn (`files.controller.ts`; storage adapter chỉ presign, KHÔNG đọc byte). Điều này ĐẠT mục tiêu §11.1.6-7 (không lộ `storage_path`/private URL) qua presigned-redirect thay vì proxy-stream. Các cụm "backend stream"/"stream download" ở §11.1.7, §11.8.2, §20.1 (dòng ~518/641/1401) và checklist Sprint 1 (dòng ~1686) là phrasing cũ; hành vi chuẩn = presign-redirect 302. Permission-gate `download:foundation-file` + `FilePolicy.canDownload` + ghi `file_access_logs` vẫn chạy TRƯỚC khi cấp URL.

### 11.10 File policy resolver

Vì file có thể gắn với entity của nhiều module, FilePolicyService cần dispatch theo `module_code` và `entity_type`.

```text
HR EmployeeFile -> HR permission/scope resolver
HR EmployeeContract -> HR contract permission resolver
ATT AdjustmentEvidence -> ATT adjustment permission resolver
ATT RemoteWorkEvidence -> ATT remote work permission resolver
LEAVE LeaveAttachment -> LEAVE request permission resolver
TASK ProjectFile -> TASK project permission resolver
TASK TaskFile -> TASK task permission resolver
FOUNDATION CompanyLogo -> FOUNDATION company permission resolver
```

Nếu không resolve được entity/module, mặc định từ chối truy cập.

### 11.11 File access log

Ghi log khi:

1. User xem metadata file nhạy cảm.
2. User tải file private hoặc sensitive.
3. User xóa file.
4. User link/unlink file khỏi entity nhạy cảm.
5. System job archive/delete file.

Dữ liệu log tối thiểu:

```json
{
  "company_id": "company_uuid",
  "file_id": "file_uuid",
  "actor_user_id": "user_uuid",
  "action": "Download",
  "ip_address": "127.0.0.1",
  "user_agent": "Mozilla/5.0",
  "accessed_at": "2026-06-20T11:00:00+07:00",
  "request_id": "req_20260620_110001"
}
```

### 11.12 Audit event cho file

Các action file cần audit:

| Action | Audit? | Ghi chú |
| --- | --- | --- |
| Upload file | Có | Ghi metadata, không ghi binary |
| Link file | Có | Ghi entity target |
| Unlink file | Có | Ghi link id/entity |
| Download file | Không bắt buộc audit, dùng file_access_logs | File sensitive có thể audit thêm |
| Delete file | Có | Xóa mềm |
| Archive file | Có | System actor |
| Quarantine file | Có | Nếu scan fail |

---

## 12. Triển khai Audit Backend

### 12.1 Mục tiêu

Audit backend cần đảm bảo:

1. Mọi thao tác quan trọng có thể truy vết.
2. Audit log lưu actor, module, action, entity, `old_values`/`new_values`/`changed_fields`, `sensitivity_level`, `result_status`, request context.
3. Không ghi dữ liệu nhạy cảm dạng plain text.
4. Không update/xóa audit log thông thường.
5. Có query API cho Admin/HR/Super Admin theo scope.
6. Có retention/archive policy cho bảng lớn.

### 12.2 Audit log schema logic

```ts
export type AuditLogInput = {
  company_id?: string;
  module_code: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  actor_user_id?: string;
  actor_employee_id?: string;
  actor_type: 'User' | 'System' | 'Job' | 'Integration';
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  changed_fields?: string[];
  sensitivity_level: string;
  result_status: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  request_id?: string;
  correlation_id?: string;
  created_at?: Date;
};
```

### 12.3 Audit decorator/interceptor

Ví dụ decorator:

```ts
@Audit({
  module: 'HR',
  action: 'EMPLOYEE_UPDATED',
  entityType: 'Employee',
  entityIdParam: 'employee_id',
  captureOldValue: true,
  captureNewValue: true,
})
```

Interceptor xử lý:

```text
Before handler:
  -> resolve actor/context
  -> nếu cần old value, gọi audit resolver/repository

After handler success:
  -> lấy new value hoặc response entity
  -> mask sensitive fields
  -> compute diff
  -> insert audit_logs

On handler error:
  -> không ghi audit thành công
  -> có thể ghi security/error event riêng nếu cần
```

### 12.4 AuditService API nội bộ

```ts
export interface AuditService {
  record(input: AuditLogInput): Promise<void>;
  recordSystem(input: SystemAuditLogInput): Promise<void>;
  recordSecurityEvent(input: SecurityAuditInput): Promise<void>;
  query(input: AuditLogQuery): Promise<PaginatedResult<AuditLogDto>>;
}
```

### 12.5 Field masking

Các field phải mask trước khi ghi audit:

```text
password
password_hash
refresh_token
refresh_token_hash
access_token
reset_token
otp
secret
secret_ref value nếu không an toàn
id_card_number nếu không cần truy vết đầy đủ
bank_account_number
salary_amount nếu thiếu quyền payroll
personal_health_info
private_file_storage_path
```

Mask dạng:

```json
{
  "password_hash": "***MASKED***",
  "id_card_number": "******1234"
}
```

### 12.6 Action audit tối thiểu theo module

| Module | Action cần audit |
| --- | --- |
| AUTH | login fail nhiều lần, logout, refresh revoke, user create/update/lock, role/permission update |
| HR | employee create/update/status change, contract create/update, profile change approve/reject, file upload/delete |
| ATT | check-in/out, adjustment submit/approve/reject, manual adjustment, shift/rule update, remote approve/reject |
| LEAVE | request create/submit/approve/reject/cancel/revoke, balance adjust, policy update |
| TASK | project create/update/archive, task create/update/status change, member change, file upload/delete |
| NOTI | template/channel/event config update, manual system notification |
| DASH | dashboard widget config update, cache refresh manual if sensitive |
| FOUNDATION | setting update, sequence update, module update, retention policy update, job manual run |

### 12.7 Audit query filters

API danh sách audit hỗ trợ:

| Filter | Mô tả |
| --- | --- |
| `module_code` | AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/FOUNDATION |
| `action` | Mã action |
| `entity_type` | Loại entity |
| `entity_id` | UUID entity |
| `actor_user_id` | User thao tác |
| `from` / `to` | Khoảng thời gian |
| `keyword` | Tìm theo action/entity/request_id nếu cần |
| `correlation_id` | Truy vết xuyên module |

### 12.8 Không cho update audit log

Không tạo endpoint update/delete audit log thông thường.

Retention job nếu xóa/archive audit phải:

1. Chạy bằng system actor.
2. Có policy rõ ràng.
3. Ghi audit riêng dạng `AUDIT_LOG_ARCHIVED` hoặc `AUDIT_LOG_RETENTION_DELETED`.
4. Chỉ áp dụng cho log đã quá retention và không bị legal hold.

---

## 13. Triển khai Settings Backend

### 13.1 Mục tiêu

Settings backend cần:

1. Đọc `system_settings` và `company_settings` theo precedence.
2. Không trả setting sensitive cho frontend.
3. Validate value theo `value_type` và `validation_schema`.
4. Cache setting đọc nhiều.
5. Invalidate cache khi setting thay đổi.
6. Ghi audit log khi update setting quan trọng.
7. Không dùng settings để thay thế policy/rule nghiệp vụ phức tạp.

### 13.2 Setting key convention

```text
system.default_timezone
system.default_locale
file.max_upload_size_mb
file.allowed_mime_types
file.blocked_extensions
file.signed_url_ttl_seconds
audit.default_retention_days
audit.mask_sensitive_fields
security.password_min_length
security.session_timeout_minutes
notification.default_channel
dashboard.cache_ttl_seconds
job.temporary_file_cleanup.enabled
job.audit_retention.enabled
```

### 13.3 Resolve setting precedence

```text
resolveSetting(company_id, setting_key):
  1. Tìm company_settings active theo company_id + setting_key
  2. Nếu có và effective date hợp lệ -> trả company value
  3. Nếu không có -> tìm system_settings active theo setting_key
  4. Nếu setting sensitive và caller không có quyền -> trả masked/null hoặc forbidden
  5. Cache kết quả theo company_id + setting_key + visibility
```

### 13.4 Public settings

Endpoint `/settings/public` chỉ trả setting an toàn:

```json
{
  "timezone": "Asia/Ho_Chi_Minh",
  "locale": "vi-VN",
  "file": {
    "max_upload_size_mb": 20,
    "allowed_mime_types": ["application/pdf", "image/png", "image/jpeg"]
  },
  "features": {
    "home_portal_enabled": true,
    "app_switcher_enabled": true
  }
}
```

Không trả:

1. Secret/ref secret.
2. Storage path.
3. Token/key.
4. Internal job config nhạy cảm.
5. Security threshold chi tiết nếu có rủi ro bị lạm dụng.

### 13.5 Update setting flow

```text
Admin gọi PATCH /settings/{key}
  -> AuthGuard
  -> PermissionGuard FOUNDATION.SETTING.UPDATE hoặc SYSTEM_MANAGE
  -> Load setting hiện tại
  -> Validate value_type
  -> Validate validation_schema
  -> Nếu sensitive -> yêu cầu permission cao hơn
  -> Update company_settings hoặc system_settings
  -> Invalidate settings cache
  -> Ghi audit log old_values/new_values/changed_fields
  -> Trả setting đã mask phù hợp
```

### 13.6 Cache settings

Cache key:

```text
settings:{company_id}:{setting_key}
settings-public:{company_id}
settings-module:{company_id}:{module_code}
```

TTL đề xuất:

| Loại setting | TTL |
| --- | --- |
| Public settings | 5-15 phút |
| File validation settings | 1-5 phút |
| Security settings | 1-5 phút hoặc cache theo request |
| Job settings | Load đầu mỗi run hoặc TTL ngắn |

---

## 14. Triển khai Module Catalog / App Registry Backend

### 14.1 Mục tiêu

Module Catalog service cần:

1. Trả danh sách module active/inactive.
2. Trả danh sách app user hiện tại được phép thấy trên Home Portal/App Switcher.
3. Hỗ trợ favorite/recent app nếu có bảng hoặc metadata tương ứng.
4. Không làm lộ module user không được phép truy cập, trừ khi policy cho phép hiển thị locked/coming soon.
5. Hỗ trợ module phase sau ở trạng thái inactive/coming soon.

### 14.2 My Apps response

```json
{
  "success": true,
  "message": "Lấy danh sách ứng dụng thành công",
  "data": [
    {
      "module_code": "HR",
      "name": "Nhân sự",
      "description": "Quản lý hồ sơ nhân viên, phòng ban, hợp đồng",
      "icon": "users",
      "route": "/apps/hr",
      "status": "Active",
      "is_favorite": true,
      "badge_count": 0,
      "required_permissions": ["HR.EMPLOYEE.VIEW"],
      "disabled_reason": null
    }
  ],
  "meta": {
    "request_id": "req_20260620_120001",
    "timestamp": "2026-06-20T12:00:00+07:00"
  }
}
```

### 14.3 App visibility rule

```text
App visible nếu:
  - module is_active = true
  - company setting không disable module
  - user có ít nhất một permission màn hình chính của module
  - user/company không bị khóa

App locked nếu:
  - product policy cho phép show locked app
  - module active nhưng user thiếu permission

App coming soon nếu:
  - module is_mvp = false và is_active = false
  - company setting cho phép show coming soon
```

---

## 15. Triển khai Sequence Backend

### 15.1 Mục tiêu

Sequence service dùng để sinh mã tự động an toàn cho:

1. Employee code.
2. Leave request code.
3. Project code.
4. Task code.
5. Attendance adjustment request code.
6. Remote work request code.
7. File code nếu cần.

### 15.2 Sequence key convention

```text
EMPLOYEE_CODE
LEAVE_REQUEST_CODE
PROJECT_CODE
TASK_CODE
ATT_ADJUSTMENT_CODE
REMOTE_WORK_CODE
```

### 15.3 Generate next code flow

```text
begin transaction
  SELECT sequence_counters WHERE company_id = :company_id AND sequence_key = :key FOR UPDATE
  if reset_policy cần reset theo năm/tháng/ngày -> reset current_value
  next_value = current_value + increment_by
  formatted_code = apply(prefix, date token, padding, suffix)
  update current_value, last_generated_value, last_generated_at
commit transaction
return formatted_code
```

### 15.4 Pseudocode

```ts
async function nextCode(companyId: string, sequenceKey: string): Promise<string> {
  return db.transaction(async (tx) => {
    const counter = await sequenceRepository.findForUpdate(tx, companyId, sequenceKey);
    if (!counter) throw new BusinessError('SEQUENCE_NOT_CONFIGURED');

    const normalized = resetIfNeeded(counter, new Date());
    const nextValue = normalized.current_value + normalized.increment_by;
    const code = formatSequenceCode({
      prefix: normalized.prefix,
      value: nextValue,
      padding: normalized.padding_length,
      date: new Date(),
      suffix: normalized.suffix,
    });

    await sequenceRepository.updateValue(tx, counter.id, nextValue, code);
    return code;
  });
}
```

### 15.5 Rule quan trọng

Không được sinh mã bằng:

```sql
SELECT MAX(employee_code) + 1
```

Lý do: race condition khi nhiều request tạo employee/leave/task đồng thời.

---

## 16. Triển khai Public Holiday Backend

### 16.1 Mục tiêu

Holiday service phục vụ:

1. ATT xác định ngày cần chấm công hay không.
2. LEAVE xác định ngày có trừ phép hay không.
3. DASH hiển thị lịch nghỉ/ngày lễ.
4. Payroll phase sau tính công/lương ngày lễ.

### 16.2 Holiday scope

| Scope | Ý nghĩa |
| --- | --- |
| Global country | `company_id = NULL`, `country_code = VN` |
| Company-specific | `company_id` có giá trị, override/extend global |

### 16.3 Check holiday API nội bộ

Request:

```json
{
  "company_id": "company_uuid",
  "country_code": "VN",
  "date": "2026-09-02"
}
```

Response:

```json
{
  "is_holiday": true,
  "holiday": {
    "name": "Quốc khánh",
    "holiday_date": "2026-09-02",
    "is_paid_holiday": true,
    "source": "global"
  }
}
```

### 16.4 Query range

ATT/LEAVE thường cần check range, không nên gọi từng ngày N lần. Holiday service cần hỗ trợ batch:

```ts
getHolidaysInRange(companyId, fromDate, toDate): Promise<Holiday[]>;
isWorkingDay(companyId, date): Promise<boolean>;
excludeHolidays(companyId, dates): Promise<Date[]>;
```

---

## 17. Triển khai Retention Backend

### 17.1 Mục tiêu

Retention service quản lý chính sách lưu trữ/xóa/archive cho:

1. Audit logs.
2. File access logs.
3. Notification delivery logs.
4. Dashboard widget cache.
5. Temporary/unlinked files.
6. Login/security logs.
7. Job run logs.

### 17.2 Retention policy mẫu

| Data type | Retention đề xuất MVP | Hành động |
| --- | --- | --- |
| `audit_logs` | 365-1095 ngày | Archive trước, delete sau nếu policy cho phép |
| `file_access_logs` | 365 ngày | Archive/delete theo policy |
| `notification_delivery_logs` | 90-180 ngày | Delete/archive |
| `dashboard_widget_cache` | 1-7 ngày | Delete |
| `temporary_files` | 1-7 ngày | Delete binary + metadata soft delete |
| `unlinked_files` | 30 ngày | Delete nếu không có legal hold |
| `job_run_logs` | 90 ngày | Delete/archive |

### 17.3 Simulate trước khi cleanup

Trước khi chạy retention delete thật, service nên hỗ trợ simulate:

```json
{
  "policy_id": "policy_uuid",
  "data_type": "dashboard_widget_cache",
  "eligible_records": 12500,
  "estimated_storage_mb": 320,
  "action": "Delete",
  "cutoff_time": "2026-06-13T00:00:00+07:00"
}
```

### 17.4 Safety rule

1. Không xóa audit log nếu policy chưa active.
2. Không xóa file còn link active.
3. Không xóa file có `legal_hold = true` nếu phase sau bổ sung.
4. Không xóa dữ liệu company khác.
5. Mỗi job cleanup phải giới hạn batch size.
6. Job phải ghi summary log sau khi chạy.
7. Nếu lỗi giữa chừng, job có thể retry an toàn.

> **CHỐT 2026-07-02:** Triển khai thật AN TOÀN HƠN doc — `audit_logs` và `file_access_logs` nằm trong `RetentionService.PROTECTED_TABLES` (defense-in-depth trên REVOKE-DELETE ở DB, BẤT BIẾN #2 append-only) ⇒ retention job KHÔNG BAO GIỜ delete hai bảng này, bất kể policy active. Do đó hàng "Archive trước, delete sau" ở bảng §17.2 (audit_logs 365-1095 ngày, file_access_logs 365 ngày) chỉ đúng phần ARCHIVE; nhánh delete bị chặn cứng. Archive-then-purge cho append-only = FUTURE (cần lối archive riêng, ngoài MVP). Cùng tập bảo vệ: `login_logs`, `user_security_events`, `security_alerts`, `api_key_usages`, `attendance_logs`, `leave_balance_transactions`, `task_activity_logs`, `notification_delivery_logs`, `employee_status_histories`, `seed_batches`, `seed_items`.

---

## 18. Triển khai System Jobs

### 18.1 Mục tiêu

System Jobs xử lý các tác vụ nền không nên chạy trực tiếp trong request API:

1. Cleanup file tạm.
2. Cleanup dashboard cache hết hạn.
3. Archive/delete audit log theo retention.
4. Archive/delete file access log theo retention.
5. Retry notification delivery failed.
6. Detect task overdue.
7. Warmup dashboard cache nếu cần.
8. Accrual leave balance phase sau.
9. Recalculate attendance phase sau.
10. Seed/bootstrap job ở môi trường mới.

### 18.2 Job registry đề xuất

| Job code | Lịch chạy đề xuất | Mục đích | MVP |
| --- | --- | --- | --- |
| `TEMP_FILE_CLEANUP` | Mỗi ngày 02:00 | Xóa file upload tạm/quá hạn | Có |
| `DASHBOARD_CACHE_CLEANUP` | Mỗi giờ | Xóa cache dashboard hết hạn | Có |
| `AUDIT_LOG_RETENTION` | Mỗi ngày 03:00 | Archive/delete audit log theo policy | Nên có |
| `FILE_ACCESS_LOG_RETENTION` | Mỗi ngày 03:30 | Cleanup file access logs | Nên có |
| `NOTIFICATION_RETRY` | Mỗi 5-15 phút | Retry delivery failed | Có nếu có delivery log |
| `TASK_OVERDUE_DETECTOR` | Mỗi giờ hoặc mỗi ngày | Đánh dấu/gửi event task quá hạn | Có nếu TASK cần cảnh báo |
| `LEAVE_ACCRUAL` | Hằng tháng | Cộng phép tự động | Phase sau |
| `ATTENDANCE_RECALCULATION` | Theo event/batch | Tính lại bảng công | Phase sau |
| `SEED_BOOTSTRAP` | Manual | Chạy seed nền | Có trong dev/staging |

### 18.3 Job execution flow

```text
Scheduler trigger job
  -> JobRegistry resolve job_code
  -> Check job enabled setting
  -> Acquire distributed lock
  -> Create job run log: Running
  -> Execute with batch size + timeout
  -> Commit per batch hoặc transaction phù hợp
  -> Update job run log: Success/Failed/Partial
  -> Release lock
  -> Emit metric/log/alert nếu fail
```

### 18.4 Job lock

Mục tiêu: tránh nhiều instance backend chạy cùng một job đồng thời.

Có thể triển khai MVP bằng PostgreSQL advisory lock hoặc bảng lock riêng.

Ví dụ advisory lock:

```sql
SELECT pg_try_advisory_lock(hashtext(:job_code));
```

Kết thúc job:

```sql
SELECT pg_advisory_unlock(hashtext(:job_code));
```

Nếu dùng bảng lock:

```text
system_job_locks
  - job_code
  - locked_by
  - locked_until
  - acquired_at
```

### 18.5 Job run log

Nếu DB-08 chưa có bảng riêng, MVP có thể ghi vào audit/system log. Tuy nhiên nên bổ sung bảng hoặc cấu trúc logic:

```text
system_job_runs
  id
  company_id nullable
  job_code
  status: Running/Success/Failed/Partial/Skipped
  started_at
  finished_at
  duration_ms
  triggered_by: Scheduler/User/System
  triggered_by_user_id
  total_items
  success_items
  failed_items
  error_message
  metadata
```

Nếu chưa muốn thêm bảng mới, có thể lưu summary vào `audit_logs` action `SYSTEM_JOB_RUN_COMPLETED` và log kỹ thuật ở logging system.

### 18.6 Retry rule

| Loại lỗi | Retry? | Ghi chú |
| --- | --- | --- |
| Network timeout | Có | exponential backoff |
| Storage temporary unavailable | Có | retry giới hạn |
| Validation/business error | Không | cần sửa dữ liệu |
| Permission/config error | Không hoặc retry sau khi config đổi | alert admin |
| Partial batch error | Có với item fail | không chạy lại item thành công nếu idempotent |

### 18.7 Idempotency job

Job phải chạy lại an toàn:

1. Cleanup cache: xóa record expired, chạy lại không ảnh hưởng.
2. Retry notification: chỉ retry status Failed/Pending và update attempt count.
3. Retention: mỗi batch check lại điều kiện trước khi xóa.
4. Temporary file cleanup: check file không linked và quá hạn trước khi xóa.
5. Task overdue detector: chỉ emit event nếu chưa emit cho cùng task/due status.

---

## 19. Integration contract với module nghiệp vụ

### 19.1 HR dùng Foundation

| Nhu cầu HR | Foundation service |
| --- | --- |
| Upload avatar/file hồ sơ/hợp đồng | FileService + FileLinkService |
| Sinh mã nhân viên | SequenceService |
| Audit thay đổi hồ sơ | AuditService |
| Đọc cấu hình company | SettingsService |
| Employee self-service approval | AuditService + NOTI event publisher |

### 19.2 ATT dùng Foundation

| Nhu cầu ATT | Foundation service |
| --- | --- |
| Ảnh/file bằng chứng điều chỉnh công | FileService |
| Public holiday để tính công | HolidayService |
| Audit check-in/adjustment/manual edit | AuditService |
| Setting file/GPS/remote nếu nhẹ | SettingsService |
| Sinh mã adjustment/remote request | SequenceService |

### 19.3 LEAVE dùng Foundation

| Nhu cầu LEAVE | Foundation service |
| --- | --- |
| File chứng minh nghỉ phép | FileService |
| Public holiday để tính ngày nghỉ | HolidayService |
| Sinh mã đơn nghỉ | SequenceService |
| Audit submit/approve/reject/cancel | AuditService |
| Đọc setting chung | SettingsService |

### 19.4 TASK dùng Foundation

| Nhu cầu TASK | Foundation service |
| --- | --- |
| File project/task/comment | FileService |
| Sinh mã project/task | SequenceService |
| Audit project/task important actions | AuditService |
| Job task overdue detector | SystemJobs + NOTI event |

### 19.5 NOTI/DASH dùng Foundation

| Nhu cầu NOTI/DASH | Foundation service |
| --- | --- |
| Notification channel setting | SettingsService |
| Audit template/widget config | AuditService |
| Dashboard cache cleanup | SystemJobs/Retention |
| Module catalog/app badge | ModuleCatalogService |
| Seed notification events/widgets | SeedService |

---

## 20. Security checklist chi tiết

### 20.1 File security

- [ ] Không trả `storage_path` cho frontend.
- [ ] Không tạo public URL cố định cho file private.
- [ ] Signed URL có TTL ngắn.
- [ ] Stream download phải kiểm tra permission trước khi trả file.
- [ ] Validate MIME type, extension, file size.
- [ ] Normalize filename, chống path traversal.
- [ ] Không cho upload executable/script nếu không có policy đặc biệt.
- [ ] File sensitive phải có access log.
- [ ] File link phải validate entity cùng company.
- [ ] File delete phải là soft delete metadata trước, binary cleanup qua job nếu cần.

### 20.2 Audit security

- [ ] Mask password/token/secret/private storage path.
- [ ] Không update audit log sau khi ghi.
- [ ] Không xóa audit log qua API thường.
- [ ] Audit query phải filter company_id và permission.
- [ ] Audit export phải giới hạn range hoặc chạy background nếu lớn.
- [ ] Audit log không chứa file binary hoặc payload quá lớn.

### 20.3 Settings security

- [ ] Không trả setting sensitive qua public API.
- [ ] Secret thật nên nằm trong secret manager, DB chỉ lưu `secret_ref`.
- [ ] Setting update phải validate schema.
- [ ] Setting update quan trọng phải audit.
- [ ] System setting chỉ Super Admin/System scope được sửa.
- [ ] Company setting chỉ Admin/authorized role trong company được sửa.

### 20.4 Job security

- [ ] Job manual run chỉ System scope hoặc permission đặc biệt.
- [ ] Job không chạy cross-company nếu không được thiết kế rõ.
- [ ] Job có lock để tránh chạy trùng.
- [ ] Job cleanup có dry-run/simulate trước với dữ liệu nhạy cảm.
- [ ] Job log không ghi secret.
- [ ] Job lỗi nhiều lần phải có alert.

---

## 21. Error code đề xuất

### 21.1 File errors

| Code | HTTP | Message |
| --- | --- | --- |
| `FOUNDATION-FILE-ERR-001` | 400 | File không hợp lệ |
| `FOUNDATION-FILE-ERR-002` | 400 | File vượt dung lượng cho phép |
| `FOUNDATION-FILE-ERR-003` | 400 | MIME type không được hỗ trợ |
| `FOUNDATION-FILE-ERR-004` | 403 | Không có quyền upload file vào entity này |
| `FOUNDATION-FILE-ERR-005` | 404 | File không tồn tại |
| `FOUNDATION-FILE-ERR-006` | 403 | Không có quyền tải file này |
| `FOUNDATION-FILE-ERR-007` | 409 | File đang bị quarantine hoặc scan chưa đạt |
| `FOUNDATION-FILE-ERR-008` | 409 | File vẫn đang được link, không thể xóa cứng |

### 21.2 Audit errors

| Code | HTTP | Message |
| --- | --- | --- |
| `FOUNDATION-AUDIT-ERR-001` | 403 | Không có quyền xem audit log |
| `FOUNDATION-AUDIT-ERR-002` | 400 | Khoảng thời gian truy vấn audit không hợp lệ |
| `FOUNDATION-AUDIT-ERR-003` | 413 | Query/export audit quá lớn |

### 21.3 Setting errors

| Code | HTTP | Message |
| --- | --- | --- |
| `FOUNDATION-SETTING-ERR-001` | 404 | Setting không tồn tại |
| `FOUNDATION-SETTING-ERR-002` | 400 | Giá trị setting không đúng kiểu |
| `FOUNDATION-SETTING-ERR-003` | 400 | Giá trị setting không đạt validation schema |
| `FOUNDATION-SETTING-ERR-004` | 403 | Không có quyền xem setting nhạy cảm |
| `FOUNDATION-SETTING-ERR-005` | 403 | Không có quyền cập nhật system setting |

### 21.4 Sequence errors

| Code | HTTP | Message |
| --- | --- | --- |
| `FOUNDATION-SEQUENCE-ERR-001` | 404 | Sequence chưa được cấu hình |
| `FOUNDATION-SEQUENCE-ERR-002` | 409 | Không thể sinh mã do xung đột cấu hình |
| `FOUNDATION-SEQUENCE-ERR-003` | 400 | Format sequence không hợp lệ |

### 21.5 Job errors

| Code | HTTP | Message |
| --- | --- | --- |
| `FOUNDATION-JOB-ERR-001` | 404 | Job không tồn tại |
| `FOUNDATION-JOB-ERR-002` | 409 | Job đang chạy |
| `FOUNDATION-JOB-ERR-003` | 403 | Không có quyền chạy job thủ công |
| `FOUNDATION-JOB-ERR-004` | 400 | Job đang bị disable |
| `FOUNDATION-JOB-ERR-005` | 500 | Job chạy thất bại |

---

## 22. Migration bổ sung nếu cần

Nếu BACKEND-02/DB-08 đã tạo đủ bảng, BACKEND-11 chỉ cần bổ sung index hoặc bảng job run nếu chưa có.

### 22.1 Bảng system_job_runs đề xuất

```sql
CREATE TABLE system_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NULL,
  job_code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  triggered_by VARCHAR(50) NOT NULL,
  triggered_by_user_id UUID NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP NULL,
  duration_ms BIGINT NULL,
  total_items INT DEFAULT 0,
  success_items INT DEFAULT 0,
  failed_items INT DEFAULT 0,
  error_message TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_job_runs_job_time
ON system_job_runs (job_code, started_at DESC);

CREATE INDEX idx_system_job_runs_company_job_time
ON system_job_runs (company_id, job_code, started_at DESC);
```

### 22.2 Bảng system_job_locks nếu không dùng advisory lock

```sql
CREATE TABLE system_job_locks (
  job_code VARCHAR(100) PRIMARY KEY,
  locked_by VARCHAR(255) NOT NULL,
  locked_until TIMESTAMP NOT NULL,
  acquired_at TIMESTAMP NOT NULL,
  metadata JSONB NULL
);
```

---

## 23. Seed data cho BACKEND-11

### 23.1 Module seed

Seed module `FOUNDATION` hoặc `SYSTEM` nếu chưa có:

```json
{
  "module_code": "FOUNDATION",
  "name": "Hệ thống nền tảng",
  "module_group": "Foundation",
  "is_core": true,
  "is_mvp": true,
  "is_active": true
}
```

### 23.2 Setting seed tối thiểu

| Key | Value mặc định |
| --- | --- |
| `system.default_timezone` | `Asia/Ho_Chi_Minh` |
| `system.default_locale` | `vi-VN` |
| `file.max_upload_size_mb` | `20` |
| `file.allowed_mime_types` | `application/pdf,image/png,image/jpeg,text/plain` |
| `file.signed_url_ttl_seconds` | `300` |
| `audit.default_retention_days` | `1095` |
| `dashboard.cache_ttl_seconds` | `300` |
| `job.temporary_file_cleanup.enabled` | `true` |
| `job.dashboard_cache_cleanup.enabled` | `true` |

### 23.3 Sequence seed tối thiểu

| Sequence key | Format đề xuất |
| --- | --- |
| `EMPLOYEE_CODE` | `EMP{0000}` |
| `LEAVE_REQUEST_CODE` | `LV-{yyyy}-{0000}` |
| `PROJECT_CODE` | `PRJ-{yyyy}-{0000}` |
| `TASK_CODE` | `TASK-{yyyy}-{0000}` |
| `ATT_ADJUSTMENT_CODE` | `ATTADJ-{yyyy}-{0000}` |
| `REMOTE_WORK_CODE` | `RW-{yyyy}-{0000}` |

### 23.4 Permission seed

Seed toàn bộ permission ở mục 8.1, gán mặc định:

| Role | Quyền FOUNDATION mặc định |
| --- | --- |
| Super Admin | Tất cả scope System |
| Admin công ty | Company view/update, module view, setting view/update, file/audit/holiday/job view, sequence view/update theo policy |
| HR | File upload/view/download/link cho HR/Leave/Attendance liên quan, audit view giới hạn nếu được cấp |
| Manager | File view/download/link theo Team, holiday view, audit không mặc định |
| Employee | File upload/view/download theo Own khi module gốc cho phép, public settings, my apps |

---

## 24. Test plan

### 24.1 Unit test

| Nhóm | Test case |
| --- | --- |
| FileService | Validate size, MIME, checksum, storage key, upload status |
| FilePolicyService | Resolve quyền theo module/entity, deny default |
| FileLinkService | Link/unlink đúng company, chống duplicate |
| AuditService | Mask sensitive, compute diff, insert append-only |
| SettingsService | Resolve precedence, hide sensitive, cache/invalidate |
| SequenceService | Generate code đúng format, row lock, reset policy |
| HolidayService | Check holiday company/global, query range |
| RetentionService | Simulate đúng cutoff, không xóa record không đủ điều kiện |
| JobLockService | Lock/unlock, prevent duplicate run |

### 24.2 Integration test

| Mã | Test case | Kỳ vọng |
| --- | --- | --- |
| BE11-IT-001 | Upload file hợp lệ | Tạo `files`, binary lưu private storage |
| BE11-IT-002 | Upload file quá size | Trả validation error |
| BE11-IT-003 | Link file vào leave request khác company | Forbidden |
| BE11-IT-004 | Download file không có quyền | 403 và không trả storage path |
| BE11-IT-005 | Download file có quyền | Trả stream/signed URL và ghi access log |
| BE11-IT-006 | Update company setting | Ghi audit log và invalidate cache |
| BE11-IT-007 | Resolve setting có company override | Trả company value |
| BE11-IT-008 | Resolve setting không override | Fallback system setting |
| BE11-IT-009 | Generate 50 mã đồng thời | Không trùng mã |
| BE11-IT-010 | Public holiday range | Trả đúng holiday company/global |
| BE11-IT-011 | Audit query theo company | Không lộ log company khác |
| BE11-IT-012 | Temporary file cleanup job | Chỉ xóa file tạm quá hạn, không xóa file linked |
| BE11-IT-013 | Job chạy trùng | Instance thứ hai bị skip/locked |
| BE11-IT-014 | Retention simulate | Không thay đổi dữ liệu |
| BE11-IT-015 | Seed chạy lại | Không tạo duplicate, cập nhật checksum |

### 24.3 Security test

- [ ] User không có permission không tải được file private.
- [ ] User company A không xem được file/audit/setting company B.
- [ ] Storage path không xuất hiện trong response public.
- [ ] Setting sensitive bị mask hoặc forbidden.
- [ ] Audit log không chứa password/token/secret.
- [ ] Upload filename chứa `../` bị normalize/từ chối.
- [ ] MIME giả mạo bị detect nếu có magic number check.
- [ ] Manual job run thiếu quyền bị 403.

### 24.4 Performance test

- [ ] Audit query theo company + time dùng index.
- [ ] File list theo entity dùng index `file_links`.
- [ ] Setting resolve được cache.
- [ ] Sequence concurrent request không lock quá lâu.
- [ ] Cleanup job chạy theo batch size, không lock bảng lớn quá lâu.
- [ ] Download file lớn stream được, không load toàn bộ vào memory.

---

## 25. Acceptance criteria

BACKEND-11 được xem là hoàn thành khi:

1. File upload/download/link/unlink chạy end-to-end cho HR, ATT, LEAVE và TASK.
2. File private không expose storage path và luôn kiểm tra permission trước khi tải.
3. File access log được ghi cho file nhạy cảm/private theo policy.
4. Audit service hoạt động cho ít nhất các action quan trọng của AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
5. Audit log đã mask dữ liệu nhạy cảm.
6. Settings service resolve đúng system default và company override.
7. Public settings API không trả dữ liệu sensitive.
8. Module catalog API trả đúng my apps theo permission/module status.
9. Sequence service sinh mã không trùng trong test concurrent.
10. Holiday service hỗ trợ query date/range cho ATT và LEAVE.
11. Retention service có simulate và job cleanup an toàn.
12. System jobs có scheduler, lock, run log, retry hoặc skip rule rõ ràng.
13. Seed service chạy lại không tạo trùng dữ liệu.
14. Toàn bộ API tuân thủ response/error format chung.
15. Permission/data scope được kiểm tra ở backend.
16. Có unit test và integration test cho các flow P0.
17. Có log/metric cơ bản cho job thất bại và storage error.
18. Tài liệu API/OpenAPI được cập nhật cho nhóm endpoint foundation.

---

## 26. Checklist triển khai theo sprint

### Sprint 1 - File service nền

- [ ] Tạo storage adapter interface.
- [ ] Tạo local private storage adapter.
- [ ] Implement upload API.
- [ ] Implement file metadata repository.
- [ ] Implement file validation service.
- [ ] Implement file link/unlink service.
- [ ] Implement download stream/signed URL.
- [ ] Implement file access log.
- [ ] Test upload/download/link với HR/LEAVE/TASK.

### Sprint 2 - Audit + Settings

- [ ] Implement AuditService.
- [ ] Implement audit masker/diff.
- [ ] Implement audit decorator/interceptor.
- [ ] Gắn audit vào action quan trọng của các module.
- [ ] Implement settings resolve/cache/invalidate.
- [ ] Implement settings API public/admin.
- [ ] Test sensitive setting và audit masking.

### Sprint 3 - Sequence + Holiday + Module Catalog

- [ ] Implement SequenceService với transaction row lock.
- [ ] Seed sequence counters.
- [ ] Tích hợp HR/LEAVE/TASK/ATT sinh mã.
- [ ] Implement HolidayService và API.
- [ ] Tích hợp ATT/LEAVE check holiday range.
- [ ] Implement module catalog/my-apps API.
- [ ] Test permission app visibility.

### Sprint 4 - Retention + System Jobs + Seed hardening

- [ ] Implement JobRegistry.
- [ ] Implement JobLockService.
- [ ] Implement job run log.
- [ ] Implement temporary file cleanup job.
- [ ] Implement dashboard cache cleanup job.
- [ ] Implement audit/file access retention simulate.
- [ ] Implement notification retry job nếu cần.
- [ ] Hardening seed service idempotent/checksum.
- [ ] Test job lock, retry, batch và idempotency.

---

## 27. Rủi ro và phương án xử lý

| Rủi ro | Tác động | Phương án |
| --- | --- | --- |
| File private bị expose path | Rất cao | Không trả storage_path, dùng stream/signed URL sau permission check |
| Audit log ghi dữ liệu nhạy cảm | Rất cao | Masker bắt buộc, test snapshot sensitive fields |
| Sequence sinh mã trùng | Cao | Transaction + row lock, unique index business code |
| Job chạy trùng nhiều instance | Cao | Advisory lock hoặc job lock table |
| Cleanup xóa nhầm file đang dùng | Cao | Chỉ xóa file không linked, soft delete trước, batch nhỏ |
| Setting sensitive bị public | Cao | `is_public`, `is_sensitive`, permission guard và response sanitizer |
| Audit query chậm khi dữ liệu lớn | Trung bình/Cao | Index theo company/time/module/entity, partition/retention |
| Local storage không phù hợp production | Trung bình | Dùng adapter pattern để chuyển sang object storage |
| File policy resolver sai module | Cao | Deny by default, integration test theo từng module |

---

## 28. Kết luận

BACKEND-11 hoàn thiện lớp Foundation/System Backend theo hướng:

1. File service dùng chung, private-first, có permission và access log.
2. Audit service thống nhất, append-only, có masking và query theo scope.
3. Settings service có precedence rõ ràng, không làm lộ sensitive config.
4. Module catalog hỗ trợ Home Portal/App Switcher và app visibility theo permission.
5. Sequence service sinh mã an toàn bằng transaction/row lock.
6. Holiday service là nguồn ngày nghỉ dùng chung cho Attendance và Leave.
7. Retention và System Jobs giúp hệ thống vận hành bền vững khi dữ liệu tăng.
8. Seed service đảm bảo môi trường dev/staging/production có dữ liệu nền nhất quán.

Sau BACKEND-11, bước tiếp theo nên là:

```text
BACKEND-12: API Integration Contract & OpenAPI/Swagger
```

BACKEND-12 tập trung vào chuẩn hóa contract API, OpenAPI/Swagger, permission-endpoint matrix và contract test. Sau đó BACKEND-13 (Backend Testing, Security & Performance) và BACKEND-14 (Backend Release Readiness) hoàn tất khâu kiểm thử và sẵn sàng phát hành.
