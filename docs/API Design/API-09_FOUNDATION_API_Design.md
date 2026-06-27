# API-09: FOUNDATION API DESIGN

**MODULE NỀN TẢNG DÙNG CHUNG - FOUNDATION API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · **API-09 FOUNDATION**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-01 §16 (Audit/Files/Settings)](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế DB: DB-08 Audit/Files/Settings](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [DB-01 Tổng quan](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Sản phẩm: PRD-00 §12.4](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-09 |
| Tên tài liệu | FOUNDATION API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | FOUNDATION - Audit, Files, Settings, Companies, Modules, Sequence, Holidays, Seeds |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho nhóm **FOUNDATION - lớp nền tảng dùng chung** của hệ thống quản lý doanh nghiệp nội bộ.

Foundation không phải là một module nghiệp vụ độc lập như HR, ATT, LEAVE, TASK, NOTI hoặc DASH. Foundation là lớp hạ tầng ứng dụng cung cấp các API và service dùng chung cho toàn bộ hệ thống, bao gồm:

1. Quản lý công ty / tenant.
2. Quản lý danh mục module hệ thống.
3. Quản lý system settings và company settings.
4. Ghi và tra cứu audit log.
5. Upload, lưu metadata, tải, preview và liên kết file với entity nghiệp vụ.
6. Ghi log truy cập file nhạy cảm.
7. Quản lý sequence counter để sinh mã tự động an toàn.
8. Quản lý ngày nghỉ lễ / ngày không làm việc.
9. Quản lý chính sách retention / cleanup.
10. Theo dõi seed batch và seed item.
11. Cung cấp internal API cho các module khác như AUTH, HR, ATT, LEAVE, TASK, NOTI và DASH.
12. Chuẩn bị khả năng mở rộng SaaS, object storage, antivirus scanning, legal hold, data archive, service-to-service security và automation ở phase sau.

API-09 dùng làm cơ sở cho:

1. Backend triển khai controller, route, DTO, validation, service và repository cho lớp Foundation.
2. Backend các module khác gọi Foundation service đúng chuẩn.
3. Frontend triển khai màn hình quản trị hệ thống như company profile, settings, module catalog, audit log, public holidays, file manager cơ bản.
4. QA viết API test case, permission test, data scope test, file permission test, audit test, seed test và security regression test.
5. DevOps/API documentation tạo OpenAPI/Swagger cho nhóm Foundation.
6. Đảm bảo toàn bộ module dùng chung cùng một chuẩn audit, file, setting, sequence và holiday.

---

## 3. Căn cứ thiết kế

API-09 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định toàn bộ API dùng prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business validation, audit log, notification event và idempotency cho nghiệp vụ quan trọng.
2. **DB-08** xác định Foundation gồm các bảng: `companies`, `modules`, `system_settings`, `company_settings`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`.
3. **DB-09** định hướng index, query pattern và hiệu năng cho audit log, file lookup, setting lookup, public holiday lookup, seed tracking và các bảng log lớn.
4. **DB-10** định hướng migration order, seed strategy, initial seed, bootstrap admin, role-permission matrix và kiểm thử sau migration.
5. **API-02 AUTH** là nền tảng xác thực, permission, role, data scope và service-to-service access.
6. **API-03 HR** dùng Foundation cho file hồ sơ nhân viên, audit log, sequence sinh mã nhân viên, company settings và public infrastructure.
7. **API-04 ATT** dùng Foundation cho file bằng chứng điều chỉnh công/remote, audit log, public holidays, settings và sequence nếu cần.
8. **API-05 LEAVE** dùng Foundation cho file chứng minh nghỉ phép, audit log, public holidays, sequence mã đơn nghỉ và settings.
9. **API-06 TASK** dùng Foundation cho file project/task, audit log, sequence mã project/task và module catalog.
10. **API-07 NOTI** dùng Foundation cho audit log, settings, module catalog, seed notification events/templates và internal event metadata.
11. **API-08 DASH** dùng Foundation cho audit log, module catalog, settings, file metadata nếu có custom assets, retention policy và cache cleanup.

---

## 4. Phạm vi API-09

### 4.1 Bao gồm trong MVP

API-09 bao gồm các nhóm API sau:

| Nhóm API | Mô tả |
| --- | --- |
| Company API | Xem company hiện tại, quản lý company/tenant nếu có quyền System/Admin |
| Module Catalog API | Xem danh mục module, trạng thái module, metadata module |
| System Setting API | Quản lý cấu hình global/system default |
| Company Setting API | Quản lý cấu hình riêng theo công ty và đọc effective setting |
| Audit Log API | Tra cứu audit log theo module/entity/actor/time range |
| File API | Upload, metadata, download, signed URL, soft delete file |
| File Link API | Link/unlink file với entity nghiệp vụ, lấy file theo entity |
| File Access Log API | Ghi và xem log truy cập file nhạy cảm |
| Sequence API | Cấu hình, preview, sinh mã tự động an toàn bằng sequence counter |
| Public Holiday API | Quản lý ngày nghỉ lễ/ngày không làm việc, check holiday theo ngày |
| Retention Policy API | Quản lý chính sách retention/cleanup cho log, file, cache |
| Seed Tracking API | Xem seed batch, seed item và trạng thái seed |
| Internal Foundation API | Internal API cho audit, file, settings, sequence, holiday, retention, seed |
| Foundation Health/Metadata API | Lấy metadata cơ bản về foundation service nếu cần |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| SaaS tenant nâng cao | Phase sau | `/api/v1/foundation/subscriptions`, `/api/v1/foundation/plans` |
| Branch/location | Phase sau | `/api/v1/foundation/branches`, `/api/v1/foundation/work-locations` |
| Storage provider nâng cao | Phase sau | `/api/v1/foundation/storage-providers` |
| Direct upload to object storage | Phase sau | `/api/v1/foundation/files/presigned-upload-url` |
| File versioning | Phase sau | `/api/v1/foundation/files/{file_id}/versions` |
| Antivirus scanning | Phase sau | `/internal/v1/foundation/files/scan-callback` |
| Legal hold | Phase sau | `/api/v1/foundation/legal-holds` |
| Advanced audit search | Phase sau | Tích hợp OpenSearch/Elastic, API search nâng cao |
| Config approval workflow | Phase sau | `/api/v1/foundation/setting-change-requests` |
| Data archive | Phase sau | `/internal/v1/foundation/archive-jobs/run` |
| Seed orchestration nâng cao | Phase sau | Tách CLI/job orchestration riêng |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint Foundation public cho frontend/admin app dùng prefix:

```http
/api/v1/foundation
```

Ví dụ:

```http
GET    /api/v1/foundation/company/current
GET    /api/v1/foundation/modules
POST   /api/v1/foundation/settings/resolve
POST   /api/v1/foundation/files/upload
GET    /api/v1/foundation/files/{file_id}/download-url
GET    /api/v1/foundation/files/{file_id}/download
GET    /api/v1/foundation/audit-logs
GET    /api/v1/foundation/public-holidays
```

Các endpoint nội bộ giữa module/job dùng prefix:

```http
/internal/v1/foundation
```

Ví dụ:

```http
POST /internal/v1/foundation/audit-logs
POST /internal/v1/foundation/sequences/generate
POST /internal/v1/foundation/files/link
POST /internal/v1/foundation/retention/cleanup-jobs/run
POST /internal/v1/foundation/seeds/run
```

Internal API không được gọi trực tiếp từ frontend/mobile.

---

### 5.2 Authentication

Tất cả API Foundation public trong MVP yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Ngoại lệ nếu có:

```http
GET /api/v1/health
```

`GET /api/v1/health` là API health chung của hệ thống, không nằm trong `/api/v1/foundation` và có thể không cần đăng nhập.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ Foundation thông thường.

Quy tắc:

1. Mọi query dữ liệu vận hành phải filter theo `company_id`.
2. Không tin `company_id`, `role`, `permission`, `user_id`, `employee_id` từ frontend nếu backend có thể resolve từ auth context.
3. Super Admin có scope `System` mới được truy vấn hoặc thao tác liên công ty.
4. `system_settings` và `modules` có thể là global/system data, nhưng vẫn phải kiểm tra permission khi đọc/ghi.
5. `company_settings`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items` phải lọc theo company nếu là dữ liệu company-specific.
6. Nếu user biết UUID file/audit/setting của công ty khác, backend trả `404 Not Found` hoặc `403 Forbidden` theo policy bảo mật, không được rò rỉ dữ liệu.

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
  "message": "Bạn không có quyền truy cập dữ liệu nền tảng này",
  "error": {
    "code": "FOUNDATION-ERR-FORBIDDEN",
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
permission + data_scope + target resource + business validation
```

`Allowed roles` trong tài liệu chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định.

---

### 6.2 Scope chuẩn trong Foundation

| Scope | Ý nghĩa trong Foundation |
| --- | --- |
| `Own` | Chỉ dữ liệu do chính user tạo hoặc thuộc profile cá nhân, chủ yếu dùng cho file cá nhân nếu module gốc cho phép |
| `Team` | Ít dùng trực tiếp trong Foundation; file/audit/entity access kế thừa từ module gốc |
| `Department` | Ít dùng trực tiếp trong Foundation; file/audit/entity access kế thừa từ module gốc |
| `Project` | Dùng khi file gắn với project/task và quyền được xác định bởi TASK |
| `Company` | Dữ liệu trong phạm vi công ty hiện tại: company settings, files, holidays, audit logs, sequence |
| `System` | Dữ liệu toàn hệ thống: companies, system settings, module catalog, seed/migration system-level |

Foundation có điểm đặc biệt: nhiều dữ liệu như file, audit log, entity link không tự quyết định scope, mà cần kế thừa permission từ module nghiệp vụ gốc.

Ví dụ:

```text
File gắn với EmployeeContract
-> Foundation kiểm tra user có quyền FOUNDATION.FILE.DOWNLOAD
-> Sau đó gọi HR permission policy để kiểm tra user có quyền xem file hợp đồng của employee đó không
```

---

### 6.3 Permission đề xuất cho Foundation

| Permission code | Mô tả | Scope thường dùng |
| --- | --- | --- |
| `FOUNDATION.COMPANY.VIEW` | Xem thông tin company | Company/System |
| `FOUNDATION.COMPANY.UPDATE` | Cập nhật company | Company/System |
| `FOUNDATION.MODULE.VIEW` | Xem module catalog | Company/System |
| `FOUNDATION.MODULE.UPDATE` | Bật/tắt/cập nhật module catalog | System |
| `FOUNDATION.SETTING.VIEW` | Xem setting không nhạy cảm | Company/System |
| `FOUNDATION.SETTING.UPDATE` | Cập nhật company setting | Company/System |
| `FOUNDATION.SETTING.SYSTEM_MANAGE` | Quản lý/cập nhật system setting | System |
| `FOUNDATION.AUDIT_LOG.VIEW` | Xem audit log | Company/System |
| `FOUNDATION.AUDIT_LOG.EXPORT` | Export audit log | Company/System |
| `FOUNDATION.FILE.UPLOAD` | Upload file | Company |
| `FOUNDATION.FILE.VIEW` | Xem metadata file | Company |
| `FOUNDATION.FILE.DOWNLOAD` | Tải file | Company + module policy |
| `FOUNDATION.FILE.DELETE` | Xóa mềm file | Company + module policy |
| `FOUNDATION.FILE.LINK` | Link file vào entity | Company + module policy |
| `FOUNDATION.FILE.UNLINK` | Unlink file khỏi entity | Company + module policy |
| `FOUNDATION.FILE_ACCESS_LOG.VIEW` | Xem log truy cập file | Company/System |
| `FOUNDATION.SEQUENCE.VIEW` | Xem sequence counter | Company/System |
| `FOUNDATION.SEQUENCE.UPDATE` | Cấu hình sequence counter | Company/System |
| `FOUNDATION.HOLIDAY.VIEW` | Xem ngày nghỉ lễ | Company/System |
| `FOUNDATION.HOLIDAY.MANAGE` | Quản lý ngày nghỉ lễ | Company/System |
| `FOUNDATION.RETENTION.VIEW` | Xem retention policy | Company/System |
| `FOUNDATION.RETENTION.MANAGE` | Quản lý retention policy | System |
| `FOUNDATION.JOB.VIEW` | Xem trạng thái job/run log | Company/System |
| `FOUNDATION.JOB.RUN` | Chạy job thủ công | System |
| `FOUNDATION.SEED.VIEW` | Xem seed batches/items | System |
| `FOUNDATION.SEED.RUN` | Chạy seed thủ công nếu cho phép | System |

---

### 6.4 Allowed roles mặc định

| Role | Quyền Foundation mặc định |
| --- | --- |
| Super Admin | Toàn quyền `System` |
| Company Admin | Quản lý company settings, holidays, files, audit log trong company |
| Admin | Quản lý settings, file metadata, holidays, audit log trong company nếu được cấp |
| HR | Upload/xem file HR theo module policy, xem public holidays, xem audit liên quan HR nếu được cấp |
| Manager | Xem/tải file liên quan team/project nếu module gốc cho phép |
| Employee | Upload/xem/tải file của chính mình hoặc file task/leave/attendance mà module gốc cho phép |
| System Job / Service Account | Ghi audit, sinh sequence, cleanup, seed, internal file link theo permission service-to-service |

---

### 6.5 Quy tắc kế thừa permission từ module gốc

Một số API Foundation bắt buộc kiểm tra thêm quyền ở module gốc.

| Trường hợp | Foundation permission | Module policy cần kiểm tra thêm |
| --- | --- | --- |
| Tải file hồ sơ nhân viên | `FOUNDATION.FILE.DOWNLOAD` | `HR.EMPLOYEE.FILE_VIEW` + scope |
| Tải file hợp đồng | `FOUNDATION.FILE.DOWNLOAD` | `HR.EMPLOYEE.CONTRACT_VIEW` hoặc `HR.EMPLOYEE.FILE_VIEW_SENSITIVE` |
| Link file vào đơn nghỉ | `FOUNDATION.FILE.LINK` | `LEAVE.REQUEST.UPDATE` hoặc `LEAVE.REQUEST.CREATE` |
| Tải file đơn nghỉ | `FOUNDATION.FILE.DOWNLOAD` | `LEAVE.REQUEST.VIEW` + scope |
| Link file vào adjustment công | `FOUNDATION.FILE.LINK` | `ATT.ADJUSTMENT.UPDATE` hoặc `ATT.ADJUSTMENT.CREATE` |
| Tải file project/task | `FOUNDATION.FILE.DOWNLOAD` | `TASK.PROJECT.VIEW` hoặc `TASK.TASK.VIEW` |
| Xem audit log entity HR | `FOUNDATION.AUDIT_LOG.VIEW` | `HR.EMPLOYEE.VIEW` hoặc audit admin scope |
| Xem audit log entity TASK | `FOUNDATION.AUDIT_LOG.VIEW` | `TASK.TASK.VIEW` hoặc audit admin scope |

---

## 7. Quy ước dữ liệu chung

### 7.1 ID

Tất cả ID dùng UUID.

```json
{
  "file_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Nếu ID sai format, trả:

```http
400 Bad Request
```

---

### 7.2 Module code

`module_code` dùng enum chuẩn:

```text
AUTH
HR
ATT
LEAVE
TASK
DASH
NOTI
FOUNDATION
PAYROLL
RECRUIT
ASSET
ROOM
CHAT
SOCIAL
MOBILE
AI
```

MVP active:

```text
AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION
```

---

### 7.3 Entity reference

Foundation dùng reference thống nhất cho file link, audit log và event:

```json
{
  "module_code": "HR",
  "entity_type": "Employee",
  "entity_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Quy tắc:

1. `module_code` phải tồn tại trong module catalog.
2. `entity_type` phải thuộc danh sách entity được module gốc khai báo hỗ trợ.
3. `entity_id` phải tồn tại và cùng company.
4. User phải có quyền truy cập entity gốc.
5. Không cho frontend tự link file vào entity nếu module gốc không cho phép.

---

### 7.4 File visibility

| Visibility | Ý nghĩa |
| --- | --- |
| `Private` | Mặc định, chỉ tải qua backend sau khi kiểm tra quyền |
| `Internal` | Nội bộ công ty, vẫn cần đăng nhập và scope |
| `Public` | Chỉ dùng khi thật sự cần public asset, MVP hạn chế |
| `Restricted` | File nhạy cảm, cần permission riêng và ghi file access log |

MVP khuyến nghị tất cả file nghiệp vụ mặc định là `Private` hoặc `Restricted`.

---

### 7.5 Setting value type

| Type | Mô tả |
| --- | --- |
| `String` | Chuỗi |
| `Number` | Số |
| `Boolean` | true/false |
| `JSON` | Object JSON |
| `Array` | Mảng |
| `SecretRef` | Tham chiếu secret manager, không trả secret thật |

---

### 7.6 Status chung

| Status | Dùng cho |
| --- | --- |
| `Active` | Đang hoạt động |
| `Inactive` | Tạm tắt |
| `Suspended` | Tạm khóa company/module nếu có |
| `Deleted` | Đã xóa mềm |
| `Pending` | Đang chờ xử lý |
| `Processing` | Đang xử lý |
| `Completed` | Hoàn tất |
| `Failed` | Lỗi |
| `Skipped` | Bỏ qua có chủ đích |

---

## 8. Company API

### 8.1 Lấy company hiện tại

```http
GET /api/v1/foundation/company/current
```

#### Mục đích

Trả thông tin công ty/tenant hiện tại của user đang đăng nhập.

#### Required permission

```text
FOUNDATION.COMPANY.VIEW
```

#### Allowed roles

Employee, Manager, HR, Admin, Company Admin, Super Admin.

#### Data scope

```text
Company
```

#### Query params

Không có.

#### Response data mẫu

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "company_code": "ACME",
  "name": "ACME Company",
  "legal_name": "ACME Company Limited",
  "email": "contact@acme.test",
  "phone": "+84900000000",
  "website": "https://acme.test",
  "address": "Ho Chi Minh City",
  "country_code": "VN",
  "timezone": "Asia/Ho_Chi_Minh",
  "default_locale": "vi-VN",
  "currency_code": "VND",
  "logo_file": {
    "id": "3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee",
    "download_url": "/api/v1/foundation/files/3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee/download"
  },
  "status": "Active"
}
```

#### Business validation

1. User phải thuộc company active.
2. Nếu company bị `Suspended`, chỉ Super Admin hoặc service account được truy cập theo policy.
3. Không trả dữ liệu company khác.

#### Audit log

Không bắt buộc ghi audit cho thao tác đọc thông thường.

---

### 8.2 Lấy danh sách company

```http
GET /api/v1/foundation/companies
```

#### Mục đích

Super Admin xem danh sách company/tenant trong hệ thống.

#### Required permission

```text
FOUNDATION.COMPANY.VIEW
```

#### Allowed roles

Super Admin.

#### Data scope

```text
System
```

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `keyword` | string | Tìm theo code/name/email |
| `status` | string | Active/Inactive/Suspended/Deleted |
| `country_code` | string | Lọc theo quốc gia |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |
| `sort` | string | `created_at`, `name`, `company_code` |
| `order` | string | `asc`, `desc` |

#### Business validation

1. Chỉ scope `System`.
2. Không trả company đã xóa mềm trừ khi có `include_deleted=true` và quyền phù hợp.

#### Audit log

Có thể ghi audit nếu xem danh sách company được xem là dữ liệu nhạy cảm.

---

### 8.3 Tạo company

```http
POST /api/v1/foundation/companies
```

#### Required permission

```text
FOUNDATION.COMPANY.UPDATE
```

#### Allowed roles

Super Admin.

#### Data scope

```text
System
```

#### Idempotency

Bắt buộc dùng:

```http
Idempotency-Key: <uuid>
```

#### Request body

```json
{
  "company_code": "ACME",
  "name": "ACME Company",
  "legal_name": "ACME Company Limited",
  "tax_code": "0312345678",
  "email": "contact@acme.test",
  "phone": "+84900000000",
  "website": "https://acme.test",
  "address": "Ho Chi Minh City",
  "country_code": "VN",
  "timezone": "Asia/Ho_Chi_Minh",
  "default_locale": "vi-VN",
  "currency_code": "VND"
}
```

#### Business validation

1. `company_code` bắt buộc, unique active.
2. `name` bắt buộc.
3. `timezone` bắt buộc và phải hợp lệ.
4. `default_locale` hợp lệ.
5. `email` hợp lệ nếu có.
6. Không cho tạo company nếu license/SaaS plan không cho phép ở phase sau.
7. Sau khi tạo company, có thể tạo default company settings và sequence counters theo seed policy.

#### Audit log

Bắt buộc ghi:

```text
module_code = FOUNDATION
action = COMPANY_CREATED
entity_type = Company
entity_id = company_id
```

#### Notification event

Có thể phát:

```text
FOUNDATION.COMPANY_CREATED
```

Thông báo chỉ gửi cho Super Admin nếu cấu hình bật.

---

### 8.4 Cập nhật company

```http
PATCH /api/v1/foundation/companies/{company_id}
```

#### Required permission

```text
FOUNDATION.COMPANY.UPDATE
```

#### Allowed roles

Company Admin trong phạm vi company, Super Admin với scope System.

#### Data scope

Company hoặc System.

#### Request body

```json
{
  "name": "ACME Company Updated",
  "legal_name": "ACME Company Limited",
  "email": "admin@acme.test",
  "phone": "+84900000001",
  "website": "https://www.acme.test",
  "address": "District 1, Ho Chi Minh City",
  "timezone": "Asia/Ho_Chi_Minh",
  "default_locale": "vi-VN",
  "currency_code": "VND"
}
```

#### Business validation

1. Company phải tồn tại và chưa xóa mềm.
2. Company Admin chỉ cập nhật company hiện tại.
3. Super Admin có thể cập nhật company bất kỳ.
4. Các field nhạy cảm như `company_code`, `status` nên dùng endpoint riêng nếu cần.
5. Nếu timezone thay đổi, cần cân nhắc ảnh hưởng ATT/LEAVE/DASH.

#### Audit log

Bắt buộc ghi `COMPANY_UPDATED`, lưu diff old/new đã mask dữ liệu nhạy cảm.

---

### 8.5 Suspend/Activate company

```http
POST /api/v1/foundation/companies/{company_id}/suspend
POST /api/v1/foundation/companies/{company_id}/activate
```

#### Required permission

```text
FOUNDATION.COMPANY.UPDATE
```

#### Allowed roles

Super Admin.

#### Data scope

System.

#### Request body suspend

```json
{
  "reason": "Billing overdue",
  "notify_admins": true
}
```

#### Business validation

1. Không cho suspend company system mặc định nếu đang là company duy nhất và chưa có Super Admin ngoài company.
2. Khi suspend, user thuộc company không được đăng nhập, trừ policy đặc biệt.
3. Không hard delete dữ liệu company.
4. Khi activate, kiểm tra company chưa bị `Deleted`.

#### Audit log

Bắt buộc ghi `COMPANY_SUSPENDED` hoặc `COMPANY_ACTIVATED`.

#### Notification event

```text
FOUNDATION.COMPANY_SUSPENDED
FOUNDATION.COMPANY_ACTIVATED
```

---

## 9. Module Catalog API

### 9.1 Lấy danh sách module

```http
GET /api/v1/foundation/modules
```

#### Required permission

```text
FOUNDATION.MODULE.VIEW
```

#### Allowed roles

Admin, Company Admin, Super Admin. Employee có thể được xem danh sách module public nếu frontend cần.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `is_active` | boolean | Lọc module active |
| `is_mvp` | boolean | Lọc module MVP |
| `module_group` | string | Foundation/Core/Operation/Experience/Extension |
| `keyword` | string | Tìm theo code/name |
| `include_inactive` | boolean | Có lấy module inactive không |

#### Response data mẫu

```json
[
  {
    "module_code": "AUTH",
    "name": "Tài khoản & phân quyền",
    "module_group": "Core",
    "version": "v1.0",
    "is_core": true,
    "is_mvp": true,
    "is_active": true,
    "dependencies": []
  },
  {
    "module_code": "PAYROLL",
    "name": "Tiền lương",
    "module_group": "Extension",
    "version": null,
    "is_core": false,
    "is_mvp": false,
    "is_active": false,
    "dependencies": ["HR", "ATT", "LEAVE"]
  }
]
```

#### Business validation

1. Module inactive có thể vẫn được trả cho Admin để cấu hình.
2. Employee chỉ nên thấy module active mà user có ít nhất một permission liên quan nếu frontend cần menu.
3. Không trả metadata nội bộ nhạy cảm nếu thiếu quyền.

#### Audit log

Không bắt buộc với thao tác đọc.

---

### 9.2 Lấy chi tiết module

```http
GET /api/v1/foundation/modules/{module_code}
```

#### Required permission

```text
FOUNDATION.MODULE.VIEW
```

#### Data scope

Company hoặc System.

#### Business validation

1. `module_code` phải hợp lệ.
2. Nếu module inactive, chỉ Admin/Super Admin được xem chi tiết cấu hình.

---

### 9.3 Cập nhật trạng thái module

```http
PATCH /api/v1/foundation/modules/{module_code}
```

#### Required permission

```text
FOUNDATION.MODULE.UPDATE
```

#### Allowed roles

Super Admin.

#### Data scope

System.

#### Request body

```json
{
  "is_active": true,
  "sort_order": 80,
  "metadata": {
    "phase": "Phase 2"
  }
}
```

#### Business validation

1. Không được tắt module core nếu còn module khác phụ thuộc.
2. Không được bật module phase sau nếu migration/permission/seed chưa sẵn sàng.
3. Bật/tắt module không tự động cấp quyền cho user; RBAC vẫn quyết định truy cập.
4. Module đã có dữ liệu nghiệp vụ không được hard delete.

#### Audit log

Bắt buộc ghi `MODULE_UPDATED`.

---

## 10. Setting API

## 10.1 Nguyên tắc setting

Foundation chỉ xử lý hai tầng setting:

```text
system_settings
company_settings
```

Các cấu hình nghiệp vụ chuyên sâu nằm ở module riêng:

```text
attendance_rules
leave_policies
employee_code_configs
notification_preferences
dashboard_widget_configs
```

Không dùng settings để thay thế bảng rule/policy nghiệp vụ phức tạp.

---

### 10.2 Lấy public settings

```http
GET /api/v1/foundation/settings/public
```

#### Mục đích

Frontend lấy các cấu hình public an toàn như timezone, locale, upload max size public, feature flag public.

#### Required permission

```text
FOUNDATION.SETTING.VIEW
```

Có thể cho user đăng nhập bất kỳ gọi API này.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `keys` | string | Danh sách key phân tách dấu phẩy |
| `module_code` | string | Lọc theo module |
| `category` | string | General/Security/File/Audit/Notification/Dashboard |

#### Response data mẫu

```json
{
  "system.default_timezone": "Asia/Ho_Chi_Minh",
  "system.default_locale": "vi-VN",
  "file.max_upload_size_mb": 20,
  "file.allowed_mime_types": ["image/png", "image/jpeg", "application/pdf"]
}
```

#### Business validation

1. Chỉ trả setting `is_public = true`.
2. Không trả setting `is_sensitive = true`.
3. Giá trị company setting ưu tiên hơn system setting.
4. Nếu setting không tồn tại, có thể bỏ qua hoặc trả null tùy contract.

---

### 10.3 Resolve settings theo precedence

```http
POST /api/v1/foundation/settings/resolve
```

#### Mục đích

Lấy cấu hình đã resolve theo precedence:

```text
company_settings -> system_settings
```

#### Required permission

```text
FOUNDATION.SETTING.VIEW
```

#### Query params

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `keys` | string | Không | Danh sách setting key |
| `category` | string | Không | Lọc theo category |
| `module_code` | string | Không | Lọc theo module |
| `include_metadata` | boolean | Không | Trả metadata/schema nếu có quyền |

#### Business validation

1. User thường chỉ đọc setting public.
2. Admin có thể đọc setting non-public nếu có permission.
3. Setting sensitive chỉ trả masked value hoặc không trả.
4. Không trả `secret_ref` nếu user không có quyền system-level.

#### Audit log

Không bắt buộc với setting public. Có thể ghi audit khi đọc setting sensitive.

---

### 10.4 Lấy danh sách system settings

```http
GET /api/v1/foundation/system-settings
```

#### Required permission

```text
FOUNDATION.SETTING.SYSTEM_MANAGE
```

#### Allowed roles

Super Admin.

#### Data scope

System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `keyword` | string | Tìm theo key/description |
| `category` | string | Lọc category |
| `module_code` | string | Lọc module |
| `status` | string | Active/Inactive |
| `is_public` | boolean | Lọc public |
| `is_sensitive` | boolean | Lọc sensitive |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |

#### Business validation

1. Chỉ Super Admin hoặc role system-level.
2. Sensitive value phải được mask trong list.

---

### 10.5 Cập nhật system setting

```http
PATCH /api/v1/foundation/system-settings/{setting_key}
```

#### Required permission

```text
FOUNDATION.SETTING.SYSTEM_MANAGE
```

#### Allowed roles

Super Admin.

#### Data scope

System.

#### Idempotency

Khuyến nghị dùng `Idempotency-Key` với setting quan trọng.

#### Request body

```json
{
  "setting_value": {
    "max_size_mb": 20
  },
  "value_type": "JSON",
  "description": "Default max upload size",
  "is_public": false,
  "is_sensitive": false,
  "status": "Active",
  "reason": "Increase upload limit for MVP"
}
```

#### Business validation

1. `setting_key` phải tồn tại hoặc được phép tạo mới theo policy.
2. `setting_value` phải đúng `validation_schema`.
3. Sensitive setting không được gửi plain secret nếu policy yêu cầu `SecretRef`.
4. Không cho thay đổi setting critical nếu hệ thống đang khóa cấu hình.
5. Cập nhật system setting có thể ảnh hưởng toàn bộ company, cần audit bắt buộc.

#### Audit log

Bắt buộc ghi `SYSTEM_SETTING_UPDATED`, lưu old/new value đã mask.

#### Notification event

Có thể phát:

```text
FOUNDATION.SYSTEM_SETTING_UPDATED
```

Thông báo cho Super Admin hoặc Admin nếu cấu hình bật.

---

### 10.6 Lấy danh sách company settings

```http
GET /api/v1/foundation/company-settings
```

#### Required permission

```text
FOUNDATION.SETTING.VIEW
```

#### Allowed roles

Company Admin, Admin, Super Admin.

#### Data scope

Company hoặc System.

#### Query params

Tương tự system settings.

#### Business validation

1. Company Admin chỉ xem company hiện tại.
2. Super Admin có thể truyền `company_id` qua query nếu endpoint cho phép và có scope System.
3. Sensitive value phải mask.

---

### 10.7 Cập nhật company setting

```http
PATCH /api/v1/foundation/company-settings/{setting_key}
```

#### Required permission

```text
FOUNDATION.SETTING.UPDATE
```

#### Allowed roles

Company Admin, Admin, Super Admin.

#### Data scope

Company hoặc System.

#### Request body

```json
{
  "setting_value": "Asia/Ho_Chi_Minh",
  "value_type": "String",
  "reason": "Chuẩn hóa timezone công ty"
}
```

#### Business validation

1. User chỉ cập nhật setting của company trong scope.
2. Setting key phải thuộc danh sách cho phép override ở company.
3. Giá trị phải đúng type và validation schema.
4. Không cập nhật setting nghiệp vụ chuyên sâu nếu module đã có bảng riêng.
5. Nếu setting ảnh hưởng ATT/LEAVE/DASH, có thể phát cache invalidation/internal event.

#### Audit log

Bắt buộc ghi `COMPANY_SETTING_UPDATED`.

#### Notification event

Có thể phát:

```text
FOUNDATION.COMPANY_SETTING_UPDATED
```

---

### 10.8 Reset company setting về system default

```http
POST /api/v1/foundation/company-settings/{setting_key}/reset
```

#### Required permission

```text
FOUNDATION.SETTING.UPDATE
```

#### Business validation

1. Setting phải tồn tại ở company settings.
2. Không reset setting bắt buộc nếu company không có system default.
3. Ghi audit old value và new effective value.

---

## 11. Audit Log API

## 11.1 Nguyên tắc audit log

Audit log là append-only ledger. API public chỉ cho đọc/export theo quyền, không cho sửa/xóa thủ công.

Các module nghiệp vụ ghi audit qua service nội bộ hoặc internal API:

```http
POST /internal/v1/foundation/audit-logs
```

---

### 11.2 Lấy danh sách audit log

```http
GET /api/v1/foundation/audit-logs
```

#### Required permission

```text
FOUNDATION.AUDIT_LOG.VIEW
```

#### Allowed roles

Admin, Company Admin, Super Admin, Auditor nếu có.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `module_code` | string | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/FOUNDATION |
| `entity_type` | string | Employee, LeaveRequest, Task, File, Setting... |
| `entity_id` | UUID | ID entity |
| `actor_user_id` | UUID | User thực hiện |
| `action` | string | Action code |
| `from` | datetime | Từ thời điểm |
| `to` | datetime | Đến thời điểm |
| `keyword` | string | Tìm theo message/metadata nếu có |
| `severity` | string | Info/Warning/Critical |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |
| `sort` | string | `created_at` |
| `order` | string | `desc` mặc định |

#### Response data mẫu

```json
[
  {
    "id": "9f2d3a9b-4db2-4e84-9c0b-3849c19f2a6f",
    "company_id": "550e8400-e29b-41d4-a716-446655440000",
    "module_code": "HR",
    "action": "EMPLOYEE_UPDATED",
    "entity_type": "Employee",
    "entity_id": "3f27cc06-d6ef-4307-a681-bc13d116fa21",
    "actor_user": {
      "id": "b6bd7f62-26a8-49ae-9bb7-fd20cd372ef0",
      "display_name": "Nguyễn Văn A"
    },
    "request_id": "req_20260620_000001",
    "ip_address": "127.0.0.1",
    "user_agent": "Mozilla/5.0",
    "old_values": {
      "phone": "***MASKED***"
    },
    "new_values": {
      "phone": "***MASKED***"
    },
    "created_at": "2026-06-20T10:00:00+07:00"
  }
]
```

#### Business validation

1. User scope Company chỉ xem audit log của company hiện tại.
2. Scope System mới xem liên công ty.
3. Audit log của entity nhạy cảm cần kiểm tra thêm module policy nếu user không phải audit admin.
4. Old/new values phải mask dữ liệu nhạy cảm trước khi trả response.
5. Không hỗ trợ sort tùy ý trên JSONB nếu chưa có index.
6. Per page nên giới hạn tối đa, ví dụ 100.

#### Audit log

Không bắt buộc ghi audit khi xem audit log thông thường. Nếu xem/export dữ liệu audit nhạy cảm, nên ghi `AUDIT_LOG_VIEWED` hoặc `AUDIT_LOG_EXPORTED`.

---

### 11.3 Lấy audit log theo entity

```http
GET /api/v1/foundation/audit-logs/entity
```

#### Query params

| Param | Bắt buộc | Mô tả |
| --- | --- | --- |
| `module_code` | Có | Module gốc |
| `entity_type` | Có | Loại entity |
| `entity_id` | Có | ID entity |
| `page` | Không | Trang |
| `per_page` | Không | Số bản ghi/trang |

#### Required permission

```text
FOUNDATION.AUDIT_LOG.VIEW
```

#### Business validation

1. Kiểm tra entity cùng company.
2. Kiểm tra user có quyền xem entity gốc hoặc có audit admin permission.
3. Nếu entity là file nhạy cảm, audit response phải mask metadata nhạy cảm.

---

### 11.4 Lấy chi tiết audit log

```http
GET /api/v1/foundation/audit-logs/{audit_log_id}
```

#### Required permission

```text
FOUNDATION.AUDIT_LOG.VIEW
```

#### Business validation

1. Audit log phải thuộc scope.
2. Sensitive diff phải được mask.
3. Không trả raw payload chứa token, password, storage path private hoặc secret.

---

### 11.5 Export audit log

```http
POST /api/v1/foundation/audit-logs/export
```

#### Required permission

```text
FOUNDATION.AUDIT_LOG.EXPORT
```

#### Allowed roles

Super Admin, Company Admin, Auditor.

#### Data scope

Company hoặc System.

#### Request body

```json
{
  "filters": {
    "module_code": "HR",
    "from": "2026-06-01T00:00:00+07:00",
    "to": "2026-06-30T23:59:59+07:00"
  },
  "format": "CSV",
  "include_sensitive_diff": false
}
```

#### Business validation

1. Khoảng thời gian export phải có giới hạn.
2. `include_sensitive_diff=true` chỉ cho role đặc biệt.
3. Export file tạo qua file service hoặc background job nếu dữ liệu lớn.
4. Ghi audit bắt buộc.

---

### 11.6 Internal ghi audit log

```http
POST /internal/v1/foundation/audit-logs
```

#### Mục đích

Module khác ghi audit log qua internal API nếu không gọi trực tiếp service trong cùng codebase.

#### Authentication

Service-to-service token hoặc internal API key.

#### Request body

```json
{
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "module_code": "LEAVE",
  "action": "LEAVE_REQUEST_APPROVED",
  "entity_type": "LeaveRequest",
  "entity_id": "3f27cc06-d6ef-4307-a681-bc13d116fa21",
  "actor_user_id": "b6bd7f62-26a8-49ae-9bb7-fd20cd372ef0",
  "request_id": "req_20260620_000001",
  "correlation_id": "corr_20260620_000001",
  "old_values": {
    "status": "Pending"
  },
  "new_values": {
    "status": "Approved"
  },
  "metadata": {
    "source": "leave-service"
  }
}
```

#### Business validation

1. Internal caller phải được xác thực.
2. `module_code`, `action`, `entity_type`, `entity_id` bắt buộc.
3. Mask dữ liệu nhạy cảm trước khi insert nếu caller chưa mask.
4. Audit log không được update sau khi ghi.
5. Nếu ghi thất bại, module nghiệp vụ cần retry hoặc log fallback tùy mức độ quan trọng.

---

## 12. File API

## 12.1 Nguyên tắc file

1. File binary không lưu trong database.
2. `files` chỉ lưu metadata.
3. File private là mặc định.
4. Không trả storage path trực tiếp cho frontend.
5. Download/preview phải đi qua backend hoặc signed URL ngắn hạn sau khi kiểm tra permission.
6. File nhạy cảm phải ghi `file_access_logs` khi xem/tải.
7. File link vào entity phải validate entity tồn tại, cùng company và user có quyền module gốc.

---

### 12.2 Upload file

```http
POST /api/v1/foundation/files/upload
Content-Type: multipart/form-data
```

#### Required permission

```text
FOUNDATION.FILE.UPLOAD
```

#### Allowed roles

Employee, Manager, HR, Admin, Company Admin, Super Admin tùy module gốc.

#### Data scope

Company + module policy.

#### Form-data fields

| Field | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `file` | binary | Có | File cần upload |
| `module_code` | string | Có | Module gốc |
| `entity_type` | string | Không | Entity muốn link ngay |
| `entity_id` | UUID | Không | ID entity muốn link ngay |
| `purpose` | string | Không | Avatar, Contract, Evidence, Attachment... |
| `visibility` | string | Không | Private/Internal/Public/Restricted |
| `is_sensitive` | boolean | Không | File nhạy cảm |
| `description` | string | Không | Mô tả |
| `link_immediately` | boolean | Không | Có link vào entity ngay không |

#### Response data mẫu

```json
{
  "id": "3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee",
  "original_filename": "hop-dong.pdf",
  "stored_filename": "2026/06/20/3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 245760,
  "checksum_sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
  "storage_provider": "local_private",
  "visibility": "Private",
  "upload_status": "Uploaded",
  "scan_status": "Pending",
  "is_sensitive": true,
  "download_url": "/api/v1/foundation/files/3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee/download",
  "created_at": "2026-06-20T10:00:00+07:00"
}
```

#### Business validation

1. File bắt buộc.
2. File size không vượt quá setting `file.max_upload_size_mb`.
3. MIME type phải thuộc danh sách cho phép.
4. Extension file phải phù hợp MIME type nếu kiểm tra được.
5. Không nhận file executable nguy hiểm trong MVP.
6. Nếu `link_immediately=true`, bắt buộc có `module_code`, `entity_type`, `entity_id`.
7. Nếu link ngay, backend phải gọi module policy để kiểm tra quyền link file.
8. File private không có public URL cố định.
9. Nếu file scan chưa hoàn tất ở phase sau, download bị chặn đến khi status `Clean`.

#### Audit log

Bắt buộc ghi:

```text
FILE_UPLOADED
```

Nếu link ngay vào entity, ghi thêm:

```text
FILE_LINKED
```

#### Notification event

Không mặc định phát notification. Module gốc quyết định có phát event hay không.

---

### 12.3 Lấy metadata file

```http
GET /api/v1/foundation/files/{file_id}
```

#### Required permission

```text
FOUNDATION.FILE.VIEW
```

#### Data scope

Company + module policy.

#### Business validation

1. File phải thuộc company hiện tại hoặc user có scope System.
2. Nếu file đã xóa mềm, chỉ Admin/Super Admin có quyền mới xem metadata.
3. Nếu file linked entity, kiểm tra quyền xem entity gốc.
4. Không trả `storage_path`, provider secret hoặc signed URL nếu chưa gọi endpoint download/preview.

---

### 12.4 Download file

```http
GET /api/v1/foundation/files/{file_id}/download
```

#### Required permission

```text
FOUNDATION.FILE.DOWNLOAD
```

#### Data scope

Company + module policy.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `disposition` | string | `attachment` hoặc `inline` |
| `variant` | string | `original`, `thumbnail`, `preview` nếu có |

#### Response

Binary stream hoặc redirect/signed URL tùy storage strategy.

#### Business validation

1. File tồn tại, chưa xóa mềm.
2. File upload status phải `Uploaded`.
3. File scan status không được `Infected` nếu có antivirus.
4. User có permission tải file và quyền module gốc.
5. File sensitive hoặc restricted phải ghi `file_access_logs`.
6. Không trả storage path thật cho frontend.

#### Audit/file access log

Bắt buộc ghi `file_access_logs` nếu:

1. `is_sensitive = true`.
2. `visibility = Restricted`.
3. Module gốc yêu cầu log mọi lượt tải.
4. User tải file thuộc hồ sơ nhân sự, hợp đồng, giấy tờ cá nhân.

Action:

```text
FILE_DOWNLOADED
```

---

### 12.5 Tạo preview/signed URL ngắn hạn

```http
POST /api/v1/foundation/files/{file_id}/preview-url
```

#### Required permission

```text
FOUNDATION.FILE.DOWNLOAD
```

#### Request body

```json
{
  "expires_in_seconds": 300,
  "disposition": "inline"
}
```

#### Business validation

1. Chỉ cho storage provider hỗ trợ signed URL.
2. TTL tối đa theo setting, ví dụ 5-15 phút.
3. File sensitive vẫn phải kiểm tra quyền và ghi access log.
4. Không cache signed URL lâu ở frontend.

---

### 12.6 Soft delete file

```http
DELETE /api/v1/foundation/files/{file_id}
```

#### Required permission

```text
FOUNDATION.FILE.DELETE
```

#### Data scope

Company + module policy.

#### Request body

```json
{
  "reason": "Upload nhầm file"
}
```

#### Business validation

1. File phải thuộc company.
2. Nếu file đang linked với entity nghiệp vụ active, cần kiểm tra module policy.
3. Không xóa file nếu entity gốc đang ở trạng thái khóa, ví dụ hợp đồng đã khóa hoặc kỳ công đã chốt.
4. Chỉ soft delete metadata; binary có thể cleanup theo retention job.
5. Nếu file có legal hold, không được xóa.

#### Audit log

Bắt buộc ghi `FILE_DELETED`.

---

## 13. File Link API

### 13.1 Lấy file theo entity

```http
GET /api/v1/foundation/file-links
```

#### Required permission

```text
FOUNDATION.FILE.VIEW
```

#### Query params

| Param | Bắt buộc | Mô tả |
| --- | --- | --- |
| `module_code` | Có | Module gốc |
| `entity_type` | Có | Loại entity |
| `entity_id` | Có | ID entity |
| `purpose` | Không | Lọc theo purpose |
| `include_deleted` | Không | Có lấy link đã xóa mềm không |

#### Business validation

1. Entity phải tồn tại và cùng company.
2. User phải có quyền xem entity gốc.
3. File metadata sensitive phải mask nếu thiếu quyền tải.

---

### 13.2 Link file vào entity

```http
POST /api/v1/foundation/file-links
```

#### Required permission

```text
FOUNDATION.FILE.LINK
```

#### Idempotency

Bắt buộc nếu link file từ flow quan trọng.

#### Request body

```json
{
  "file_id": "3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee",
  "module_code": "LEAVE",
  "entity_type": "LeaveRequest",
  "entity_id": "3f27cc06-d6ef-4307-a681-bc13d116fa21",
  "purpose": "Evidence",
  "link_type": "Attachment",
  "is_primary": false,
  "sort_order": 1
}
```

#### Business validation

1. File tồn tại, chưa xóa mềm, cùng company.
2. Entity tồn tại, chưa xóa mềm, cùng company.
3. User có quyền link file vào entity gốc.
4. Không link file `Infected` hoặc upload chưa completed.
5. Một số entity chỉ cho link trước khi submit/approve.
6. Nếu `is_primary=true`, có thể unset primary của file khác cùng entity/purpose trong transaction.
7. Chống link trùng bằng unique logic.

#### Audit log

Bắt buộc ghi `FILE_LINKED`.

---

### 13.3 Unlink file khỏi entity

```http
DELETE /api/v1/foundation/file-links/{file_link_id}
```

#### Required permission

```text
FOUNDATION.FILE.UNLINK
```

#### Request body

```json
{
  "reason": "Không còn dùng file này"
}
```

#### Business validation

1. Link phải thuộc company.
2. User có quyền unlink theo module gốc.
3. Không unlink nếu entity đã khóa/approved và policy không cho phép.
4. Unlink không nhất thiết xóa file metadata.
5. Nếu file không còn link nào, có thể mark orphan để cleanup sau.

#### Audit log

Bắt buộc ghi `FILE_UNLINKED`.

---

### 13.4 Internal link file

```http
POST /internal/v1/foundation/files/link
```

#### Mục đích

Module nghiệp vụ link file sau khi đã tự kiểm tra business rule.

#### Request body

Tương tự public link API nhưng có thể truyền `actor_user_id`, `company_id`, `correlation_id`.

#### Business validation

1. Internal caller phải được xác thực.
2. Vẫn validate file và entity cùng company.
3. Không bỏ qua audit log.

---

## 14. File Access Log API

### 14.1 Lấy log truy cập file

```http
GET /api/v1/foundation/file-access-logs
```

#### Required permission

```text
FOUNDATION.FILE_ACCESS_LOG.VIEW
```

#### Allowed roles

Admin, Company Admin, Super Admin, Auditor.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `file_id` | UUID | Lọc theo file |
| `actor_user_id` | UUID | Người truy cập |
| `action` | string | VIEWED/DOWNLOADED/PREVIEWED/DELETED |
| `module_code` | string | Module gốc |
| `from` | datetime | Từ thời điểm |
| `to` | datetime | Đến thời điểm |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |

#### Business validation

1. Chỉ người có quyền audit/file admin được xem.
2. Nếu log file thuộc HR sensitive, có thể cần thêm quyền HR sensitive.
3. Mask IP/user agent nếu policy riêng yêu cầu.

---

## 15. Sequence API

## 15.1 Nguyên tắc sequence

Sequence counter dùng để sinh mã tự động an toàn cho:

```text
employee_code
leave_request_code
project_code
task_code
attendance_adjustment_code
remote_work_request_code
file_code nếu cần
```

Không sinh mã bằng `SELECT MAX(code) + 1`.

Sinh mã phải dùng transaction và row lock.

---

### 15.2 Lấy danh sách sequence counters

```http
GET /api/v1/foundation/sequences
```

#### Required permission

```text
FOUNDATION.SEQUENCE.VIEW
```

#### Allowed roles

Admin, Company Admin, Super Admin.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `sequence_key` | string | Lọc theo key |
| `module_code` | string | Lọc module |
| `status` | string | Active/Inactive |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |

#### Response data mẫu

```json
[
  {
    "id": "e83f2c10-4423-4775-8dd9-3b0c60da787a",
    "sequence_key": "HR.EMPLOYEE_CODE",
    "module_code": "HR",
    "prefix": "EMP",
    "current_value": 100,
    "increment_by": 1,
    "padding_length": 4,
    "format_pattern": "{prefix}{number}",
    "reset_policy": "Never",
    "status": "Active",
    "next_preview": "EMP0101"
  }
]
```

---

### 15.3 Tạo sequence counter

```http
POST /api/v1/foundation/sequences
```

#### Required permission

```text
FOUNDATION.SEQUENCE.UPDATE
```

#### Idempotency

Khuyến nghị dùng `Idempotency-Key`.

#### Request body

```json
{
  "sequence_key": "LEAVE.REQUEST_CODE",
  "module_code": "LEAVE",
  "prefix": "LR",
  "current_value": 0,
  "increment_by": 1,
  "padding_length": 6,
  "format_pattern": "{prefix}{yyyy}{number}",
  "reset_policy": "Yearly",
  "status": "Active"
}
```

#### Business validation

1. `sequence_key` unique trong company hoặc system.
2. `increment_by` > 0.
3. `padding_length` hợp lệ.
4. `format_pattern` chỉ dùng biến được hỗ trợ.
5. Không tạo sequence trùng với module nếu module không active.
6. Nếu đã phát sinh mã, thay đổi prefix/pattern cần cảnh báo hoặc chặn tùy policy.

#### Audit log

Bắt buộc ghi `SEQUENCE_CREATED`.

---

### 15.4 Cập nhật sequence counter

```http
PATCH /api/v1/foundation/sequences/{sequence_id}
```

#### Required permission

```text
FOUNDATION.SEQUENCE.UPDATE
```

#### Business validation

1. Không giảm `current_value` nếu sequence đã dùng, trừ Super Admin có override đặc biệt.
2. Không đổi `sequence_key` sau khi tạo.
3. Thay đổi `reset_policy`, `prefix`, `format_pattern` phải ghi audit chi tiết.
4. Nếu sequence đang được module nghiệp vụ sử dụng, cần kiểm tra impact.

#### Audit log

Bắt buộc ghi `SEQUENCE_UPDATED`.

---

### 15.5 Preview mã tiếp theo

```http
POST /api/v1/foundation/sequences/{sequence_key}/preview
```

#### Required permission

```text
FOUNDATION.SEQUENCE.VIEW
```

#### Request body

```json
{
  "context": {
    "date": "2026-06-20",
    "department_code": "HR"
  }
}
```

#### Response data mẫu

```json
{
  "sequence_key": "HR.EMPLOYEE_CODE",
  "next_value": 101,
  "preview_code": "EMP0101",
  "will_increment": false
}
```

#### Business validation

1. Preview không tăng `current_value`.
2. Context phải đủ nếu pattern yêu cầu biến như `{department_code}`.
3. Nếu sequence inactive, trả business error.

---

### 15.6 Internal sinh mã

```http
POST /internal/v1/foundation/sequences/generate
```

#### Required permission

```text
FOUNDATION.SEQUENCE.UPDATE
```

#### Authentication

Service-to-service token.

#### Idempotency

Bắt buộc với nghiệp vụ tạo entity quan trọng.

#### Request body

```json
{
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "sequence_key": "HR.EMPLOYEE_CODE",
  "module_code": "HR",
  "context": {
    "date": "2026-06-20",
    "department_code": "HR"
  },
  "idempotency_key": "create-employee-550e8400"
}
```

#### Response data mẫu

```json
{
  "sequence_key": "HR.EMPLOYEE_CODE",
  "generated_code": "EMP0101",
  "value": 101,
  "generated_at": "2026-06-20T10:00:00+07:00"
}
```

#### Business validation

1. Caller phải là internal service hợp lệ.
2. Sequence tồn tại, active và thuộc company.
3. Transaction phải lock row sequence.
4. Nếu idempotency key đã dùng, trả lại code cũ, không tăng counter lần nữa.
5. Nếu lỗi sau khi generate nhưng trước khi entity tạo, module gọi cần xử lý transaction boundary hoặc chấp nhận skip code theo policy.

#### Audit log

Không bắt buộc ghi audit cho mỗi lần generate nếu quá nhiều, nhưng nên log security/audit cho thay đổi cấu hình sequence. Có thể ghi event kỹ thuật vào internal log.

---

## 16. Public Holiday API

### 16.1 Lấy danh sách ngày nghỉ lễ

```http
GET /api/v1/foundation/public-holidays
```

#### Required permission

```text
FOUNDATION.HOLIDAY.VIEW
```

#### Allowed roles

Employee, Manager, HR, Admin, Company Admin, Super Admin.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `year` | number | Năm |
| `month` | number | Tháng |
| `country_code` | string | Quốc gia |
| `from` | date | Từ ngày |
| `to` | date | Đến ngày |
| `type` | string | PublicHoliday/CompanyHoliday/WorkingDayOverride |
| `status` | string | Active/Inactive |
| `scope` | string | Global/Company |

#### Response data mẫu

```json
[
  {
    "id": "2358fd20-0c5c-4a16-9685-4f3e5a7000db",
    "holiday_date": "2026-01-01",
    "name": "Tết Dương lịch",
    "country_code": "VN",
    "type": "PublicHoliday",
    "is_paid": true,
    "is_working_day": false,
    "status": "Active",
    "source": "Company"
  }
]
```

#### Business validation

1. Employee có thể xem holiday active.
2. Admin có thể xem inactive nếu có quyền.
3. Nếu có holiday company và holiday global cùng ngày, company holiday ưu tiên.

---

### 16.2 Tạo ngày nghỉ lễ

```http
POST /api/v1/foundation/public-holidays
```

#### Required permission

```text
FOUNDATION.HOLIDAY.MANAGE
```

#### Allowed roles

HR, Admin, Company Admin, Super Admin nếu được cấp.

#### Data scope

Company hoặc System.

#### Request body

```json
{
  "holiday_date": "2026-04-30",
  "name": "Ngày Giải phóng miền Nam",
  "country_code": "VN",
  "type": "PublicHoliday",
  "is_paid": true,
  "is_working_day": false,
  "status": "Active",
  "description": "Ngày nghỉ lễ toàn quốc"
}
```

#### Business validation

1. `holiday_date` bắt buộc.
2. `name` bắt buộc.
3. Không tạo trùng ngày/type/company nếu policy không cho phép.
4. Nếu tạo ngày nghỉ ảnh hưởng kỳ công/kỳ nghỉ đã duyệt, cần cảnh báo và có thể trigger recalculation nội bộ.
5. Nếu `is_working_day=true`, đây là ngày làm bù/override, cần type phù hợp.

#### Audit log

Bắt buộc ghi `PUBLIC_HOLIDAY_CREATED`.

#### Notification/internal event

Có thể phát:

```text
FOUNDATION.PUBLIC_HOLIDAY_CHANGED
```

Cho ATT/LEAVE/DASH invalidate cache hoặc tính lại nếu cần.

---

### 16.3 Cập nhật ngày nghỉ lễ

```http
PATCH /api/v1/foundation/public-holidays/{holiday_id}
```

#### Required permission

```text
FOUNDATION.HOLIDAY.MANAGE
```

#### Business validation

1. Holiday phải thuộc scope.
2. Nếu holiday đã được ATT/LEAVE dùng trong kỳ khóa, không cho sửa hoặc yêu cầu quyền override.
3. Thay đổi ngày cần kiểm tra trùng.
4. Cập nhật có thể trigger recalculation ATT/LEAVE.

#### Audit log

Bắt buộc ghi `PUBLIC_HOLIDAY_UPDATED`.

---

### 16.4 Xóa mềm ngày nghỉ lễ

```http
DELETE /api/v1/foundation/public-holidays/{holiday_id}
```

#### Required permission

```text
FOUNDATION.HOLIDAY.MANAGE
```

#### Business validation

1. Không hard delete.
2. Nếu holiday đã được dùng trong kỳ công/đơn nghỉ đã duyệt, cần cảnh báo hoặc chặn.
3. Ghi lý do xóa nếu là holiday company-specific.

#### Audit log

Bắt buộc ghi `PUBLIC_HOLIDAY_DELETED`.

---

### 16.5 Kiểm tra một ngày có phải ngày nghỉ không

```http
GET /api/v1/foundation/public-holidays/check
```

#### Required permission

```text
FOUNDATION.HOLIDAY.VIEW
```

#### Query params

| Param | Bắt buộc | Mô tả |
| --- | --- | --- |
| `date` | Có | Ngày cần kiểm tra |
| `country_code` | Không | Quốc gia |
| `include_company_override` | Không | Có xét holiday riêng company không |

#### Response data mẫu

```json
{
  "date": "2026-04-30",
  "is_holiday": true,
  "is_working_day": false,
  "holiday": {
    "name": "Ngày Giải phóng miền Nam",
    "type": "PublicHoliday",
    "source": "Company"
  }
}
```

#### Use case

ATT và LEAVE có thể dùng internal service trực tiếp để kiểm tra ngày lễ khi tính công/tính phép.

---

### 16.6 Import public holidays

```http
POST /api/v1/foundation/public-holidays/import
```

#### Required permission

```text
FOUNDATION.HOLIDAY.MANAGE
```

#### Idempotency

Bắt buộc.

#### Request body

```json
{
  "year": 2026,
  "country_code": "VN",
  "items": [
    {
      "holiday_date": "2026-01-01",
      "name": "Tết Dương lịch",
      "type": "PublicHoliday",
      "is_paid": true,
      "is_working_day": false
    }
  ],
  "mode": "upsert"
}
```

#### Business validation

1. `mode`: `insert_only`, `upsert`, `replace_year`.
2. `replace_year` yêu cầu quyền mạnh hơn hoặc confirmation.
3. Không ghi đè holiday đã bị khóa nếu kỳ công đã chốt.
4. Import phải trả danh sách success/failed/skipped.

#### Audit log

Bắt buộc ghi `PUBLIC_HOLIDAY_IMPORTED`.

---

## 17. Retention Policy API

### 17.1 Lấy danh sách retention policy

```http
GET /api/v1/foundation/retention-policies
```

#### Required permission

```text
FOUNDATION.RETENTION.VIEW
```

#### Allowed roles

Super Admin, Company Admin nếu được cấp.

#### Data scope

Company hoặc System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `module_code` | string | SYSTEM/AUTH/NOTI/DASH... |
| `entity_type` | string | AuditLog/FileAccessLog/Notification/DashboardCache... |
| `status` | string | Active/Inactive |

#### Response data mẫu

```json
[
  {
    "id": "eae8e3f5-cbda-4b7e-917c-50ee4c67f8a0",
    "module_code": "SYSTEM",
    "entity_type": "AuditLog",
    "retention_days": 365,
    "cleanup_action": "Archive",
    "status": "Active"
  }
]
```

---

### 17.2 Tạo/cập nhật retention policy

```http
POST  /api/v1/foundation/retention-policies
PATCH /api/v1/foundation/retention-policies/{policy_id}
```

#### Required permission

```text
FOUNDATION.RETENTION.MANAGE
```

#### Allowed roles

Super Admin.

#### Request body

```json
{
  "module_code": "SYSTEM",
  "entity_type": "AuditLog",
  "retention_days": 365,
  "cleanup_action": "Archive",
  "schedule": "daily",
  "status": "Active"
}
```

#### Business validation

1. Retention days phải lớn hơn minimum policy.
2. Không cho retention quá ngắn với audit/security log nếu chưa có approval.
3. Cleanup action hợp lệ: `Delete`, `Archive`, `Anonymize`, `None`.
4. Policy thay đổi phải audit.
5. Nếu policy ảnh hưởng dữ liệu pháp lý, phase sau cần legal hold.

#### Audit log

Bắt buộc ghi `RETENTION_POLICY_CREATED` hoặc `RETENTION_POLICY_UPDATED`.

---

### 17.3 Internal chạy cleanup job

```http
POST /internal/v1/foundation/retention/cleanup-jobs/run
```

#### Authentication

Service-to-service token hoặc scheduler secret.

#### Request body

```json
{
  "module_code": "DASH",
  "entity_type": "DashboardCache",
  "dry_run": false,
  "limit": 1000
}
```

#### Business validation

1. Chỉ internal scheduler/service account.
2. Có thể chạy `dry_run=true` để xem số bản ghi tác động.
3. Job phải giới hạn batch size.
4. Cleanup audit/file/log quan trọng phải ghi log job.
5. Không cleanup dữ liệu đang legal hold.

---

## 18. Seed Tracking API

### 18.1 Lấy danh sách seed batches

```http
GET /api/v1/foundation/seed-batches
```

#### Required permission

```text
FOUNDATION.SEED.VIEW
```

#### Allowed roles

Super Admin, DevOps/Admin kỹ thuật nếu có.

#### Data scope

System.

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `batch_key` | string | Lọc theo batch |
| `status` | string | Pending/Applied/Skipped/Failed |
| `environment` | string | local/dev/staging/prod |
| `from` | datetime | Từ ngày |
| `to` | datetime | Đến ngày |
| `page` | number | Trang |
| `per_page` | number | Số bản ghi/trang |

#### Business validation

1. Chỉ scope System.
2. Không trả secret hoặc payload nhạy cảm trong seed metadata.

---

### 18.2 Lấy chi tiết seed batch

```http
GET /api/v1/foundation/seed-batches/{batch_id}
```

#### Required permission

```text
FOUNDATION.SEED.VIEW
```

#### Response data mẫu

```json
{
  "id": "b07e9d64-27db-4db7-aa80-99b6b9fbfb5e",
  "batch_key": "S00_SYSTEM_SEED",
  "seed_version": "20260620.1",
  "status": "Applied",
  "environment": "staging",
  "started_at": "2026-06-20T10:00:00+07:00",
  "finished_at": "2026-06-20T10:00:10+07:00",
  "items_summary": {
    "applied": 120,
    "skipped": 10,
    "failed": 0
  }
}
```

---

### 18.3 Lấy seed items

```http
GET /api/v1/foundation/seed-items
```

#### Required permission

```text
FOUNDATION.SEED.VIEW
```

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `batch_id` | UUID | Lọc theo batch |
| `seed_key` | string | Lọc seed key |
| `status` | string | Applied/Skipped/Failed |
| `module_code` | string | Lọc module |

---

### 18.4 Internal chạy seed

```http
POST /internal/v1/foundation/seeds/run
```

#### Required permission

```text
FOUNDATION.SEED.RUN
```

#### Authentication

Service-to-service token, CLI token hoặc DevOps-only credential.

#### Request body

```json
{
  "batch_key": "S00_SYSTEM_SEED",
  "environment": "staging",
  "dry_run": false,
  "allow_dev_only": false,
  "modules": ["FOUNDATION", "AUTH", "HR", "ATT", "LEAVE", "TASK", "NOTI", "DASH"]
}
```

#### Business validation

1. Không cho chạy dev-only seed ở production.
2. Seed phải idempotent.
3. Không hardcode secret trong seed.
4. Nếu migration chưa hoàn tất, không chạy seed.
5. Seed failed phải ghi rõ lỗi và dừng hoặc continue theo policy.
6. Chạy seed production cần approval ngoài hệ thống nếu triển khai quy trình change management.

#### Audit log

Bắt buộc ghi `SEED_RUN_STARTED`, `SEED_RUN_COMPLETED`, `SEED_RUN_FAILED`.

---

## 19. Internal Setting API

### 19.1 Internal resolve effective setting

```http
POST /internal/v1/foundation/settings/resolve
```

#### Mục đích

Module khác lấy effective setting theo company/module/category mà không cần tự query DB.

#### Request body

```json
{
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "keys": [
    "file.max_upload_size_mb",
    "system.default_timezone"
  ],
  "include_sensitive": false
}
```

#### Response data

```json
{
  "settings": {
    "file.max_upload_size_mb": 20,
    "system.default_timezone": "Asia/Ho_Chi_Minh"
  },
  "sources": {
    "file.max_upload_size_mb": "company",
    "system.default_timezone": "system"
  }
}
```

#### Business validation

1. Internal caller phải được xác thực.
2. Sensitive setting chỉ trả nếu service có quyền.
3. Có thể cache setting ngắn hạn nhưng phải invalidate khi setting update.

---

## 20. Internal Holiday API

### 20.1 Internal check holiday

```http
POST /internal/v1/foundation/public-holidays/check
```

#### Request body

```json
{
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "date": "2026-04-30",
  "country_code": "VN"
}
```

#### Response data

```json
{
  "date": "2026-04-30",
  "is_holiday": true,
  "is_working_day": false,
  "source": "company",
  "holiday_id": "2358fd20-0c5c-4a16-9685-4f3e5a7000db",
  "name": "Ngày Giải phóng miền Nam"
}
```

#### Use case

1. ATT tính ngày công.
2. LEAVE tính số ngày trừ phép.
3. DASH hiển thị cảnh báo/lịch.
4. PAYROLL phase sau tính lương ngày lễ.

---

## 21. API lỗi của Foundation

### 21.1 Nhóm lỗi chung

| Error code | HTTP status | Ý nghĩa |
| --- | ---: | --- |
| `FOUNDATION-ERR-FORBIDDEN` | 403 | Không có quyền Foundation |
| `FOUNDATION-ERR-SCOPE_DENIED` | 403 | Dữ liệu ngoài scope |
| `FOUNDATION-ERR-NOT_FOUND` | 404 | Không tìm thấy resource |
| `FOUNDATION-ERR-COMPANY_INACTIVE` | 403 | Company không active |
| `FOUNDATION-ERR-COMPANY_SUSPENDED` | 403 | Company bị suspend |
| `FOUNDATION-ERR-MODULE_NOT_FOUND` | 404 | Module không tồn tại |
| `FOUNDATION-ERR-MODULE_INACTIVE` | 400 | Module chưa active |
| `FOUNDATION-ERR-SETTING_NOT_FOUND` | 404 | Setting không tồn tại |
| `FOUNDATION-ERR-SETTING_SENSITIVE` | 403 | Không được xem setting nhạy cảm |
| `FOUNDATION-ERR-SETTING_SCHEMA_INVALID` | 422 | Setting value sai schema |
| `FOUNDATION-ERR-FILE_NOT_FOUND` | 404 | File không tồn tại |
| `FOUNDATION-ERR-FILE_TOO_LARGE` | 413 | File vượt dung lượng |
| `FOUNDATION-ERR-FILE_TYPE_NOT_ALLOWED` | 415 | MIME type không cho phép |
| `FOUNDATION-ERR-FILE_INFECTED` | 400 | File bị đánh dấu nguy hiểm |
| `FOUNDATION-ERR-FILE_NOT_READY` | 409 | File chưa upload/scan xong |
| `FOUNDATION-ERR-FILE_ACCESS_DENIED` | 403 | Không có quyền truy cập file |
| `FOUNDATION-ERR-FILE_LINK_INVALID` | 422 | Link file vào entity không hợp lệ |
| `FOUNDATION-ERR-ENTITY_POLICY_DENIED` | 403 | Module gốc không cho phép thao tác |
| `FOUNDATION-ERR-SEQUENCE_NOT_FOUND` | 404 | Sequence không tồn tại |
| `FOUNDATION-ERR-SEQUENCE_INACTIVE` | 400 | Sequence inactive |
| `FOUNDATION-ERR-SEQUENCE_CONTEXT_MISSING` | 422 | Thiếu context để format mã |
| `FOUNDATION-ERR-HOLIDAY_DUPLICATED` | 409 | Ngày nghỉ bị trùng |
| `FOUNDATION-ERR-HOLIDAY_LOCKED` | 409 | Ngày nghỉ đã dùng trong kỳ khóa |
| `FOUNDATION-ERR-RETENTION_POLICY_INVALID` | 422 | Retention policy không hợp lệ |
| `FOUNDATION-ERR-SEED_ALREADY_RUNNING` | 409 | Seed batch đang chạy |
| `FOUNDATION-ERR-SEED_FAILED` | 500 | Seed thất bại |
| `FOUNDATION-ERR-INTERNAL_ONLY` | 403 | API chỉ dùng nội bộ |

---

### 21.2 Ví dụ lỗi file access denied

```json
{
  "success": false,
  "message": "Bạn không có quyền tải file này",
  "error": {
    "code": "FOUNDATION-ERR-FILE_ACCESS_DENIED",
    "type": "ForbiddenError",
    "details": {
      "file_id": "3bf0bda7-c2ad-4c72-81ce-1ec4317b8eee",
      "required_permission": "FOUNDATION.FILE.DOWNLOAD",
      "module_policy": "HR.EMPLOYEE.FILE_VIEW"
    }
  },
  "meta": {
    "request_id": "req_20260620_000011",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 21.3 Ví dụ lỗi setting schema

```json
{
  "success": false,
  "message": "Giá trị cấu hình không hợp lệ",
  "error": {
    "code": "FOUNDATION-ERR-SETTING_SCHEMA_INVALID",
    "type": "ValidationError",
    "details": [
      {
        "field": "setting_value.max_size_mb",
        "message": "Giá trị phải lớn hơn 0 và nhỏ hơn hoặc bằng 100",
        "rule": "range"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000012",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 22. Idempotency trong Foundation

### 22.1 API bắt buộc hoặc khuyến nghị Idempotency-Key

| API | Bắt buộc | Lý do |
| --- | --- | --- |
| `POST /foundation/companies` | Có | Tránh tạo trùng company |
| `POST /foundation/files/upload` | Khuyến nghị | Tránh upload metadata trùng nếu retry |
| `POST /foundation/file-links` | Có | Tránh link trùng file/entity |
| `POST /foundation/sequences/{key}/preview` | Không | Không thay đổi dữ liệu |
| `POST /internal/v1/foundation/sequences/generate` | Có | Tránh tăng counter nhiều lần |
| `POST /foundation/public-holidays/import` | Có | Tránh import trùng |
| `POST /internal/v1/foundation/seeds/run` | Có | Tránh chạy seed trùng |
| `POST /internal/v1/foundation/retention/cleanup-jobs/run` | Khuyến nghị | Tránh chạy job trùng |

### 22.2 Quy tắc idempotency

1. Client gửi `Idempotency-Key` dạng UUID hoặc key ổn định.
2. Backend lưu kết quả xử lý lần đầu theo user/company/endpoint/key.
3. Retry cùng key trả lại kết quả cũ nếu request body không đổi.
4. Nếu body khác nhưng cùng key, trả `409 Conflict`.
5. TTL idempotency tùy API, ví dụ 24 giờ với upload/link, dài hơn với sequence generate quan trọng.

---

## 23. Audit log trigger trong Foundation

### 23.1 Thao tác bắt buộc audit

| Action | Module | Entity |
| --- | --- | --- |
| `COMPANY_CREATED` | FOUNDATION | Company |
| `COMPANY_UPDATED` | FOUNDATION | Company |
| `COMPANY_SUSPENDED` | FOUNDATION | Company |
| `COMPANY_ACTIVATED` | FOUNDATION | Company |
| `MODULE_UPDATED` | FOUNDATION | Module |
| `SYSTEM_SETTING_UPDATED` | FOUNDATION | SystemSetting |
| `COMPANY_SETTING_UPDATED` | FOUNDATION | CompanySetting |
| `FILE_UPLOADED` | FOUNDATION | File |
| `FILE_DELETED` | FOUNDATION | File |
| `FILE_LINKED` | FOUNDATION | FileLink |
| `FILE_UNLINKED` | FOUNDATION | FileLink |
| `FILE_DOWNLOADED_SENSITIVE` | FOUNDATION | File |
| `SEQUENCE_CREATED` | FOUNDATION | SequenceCounter |
| `SEQUENCE_UPDATED` | FOUNDATION | SequenceCounter |
| `PUBLIC_HOLIDAY_CREATED` | FOUNDATION | PublicHoliday |
| `PUBLIC_HOLIDAY_UPDATED` | FOUNDATION | PublicHoliday |
| `PUBLIC_HOLIDAY_DELETED` | FOUNDATION | PublicHoliday |
| `PUBLIC_HOLIDAY_IMPORTED` | FOUNDATION | PublicHoliday |
| `RETENTION_POLICY_CREATED` | FOUNDATION | RetentionPolicy |
| `RETENTION_POLICY_UPDATED` | FOUNDATION | RetentionPolicy |
| `SEED_RUN_STARTED` | FOUNDATION | SeedBatch |
| `SEED_RUN_COMPLETED` | FOUNDATION | SeedBatch |
| `SEED_RUN_FAILED` | FOUNDATION | SeedBatch |
| `AUDIT_LOG_EXPORTED` | FOUNDATION | AuditLog |

### 23.2 Dữ liệu phải mask trong audit

Không ghi plain text các dữ liệu sau:

1. Password, password hash, refresh token hash.
2. API key, access token, refresh token.
3. Secret setting value.
4. Storage private path nếu không cần.
5. Bank account, identity number, tax number nếu không cần.
6. Hồ sơ cá nhân nhạy cảm.
7. File content.
8. Signed URL.

---

## 24. Notification event từ Foundation

Foundation không phải module tạo notification nghiệp vụ chính, nhưng một số sự kiện quản trị có thể phát event cho NOTI nếu cấu hình bật.

| Event code | Khi nào phát | Người nhận đề xuất |
| --- | --- | --- |
| `FOUNDATION.COMPANY_CREATED` | Tạo company mới | Super Admin |
| `FOUNDATION.COMPANY_SUSPENDED` | Suspend company | Super Admin, Company Admin |
| `FOUNDATION.COMPANY_ACTIVATED` | Activate company | Super Admin, Company Admin |
| `FOUNDATION.SYSTEM_SETTING_UPDATED` | Cập nhật setting hệ thống quan trọng | Super Admin |
| `FOUNDATION.COMPANY_SETTING_UPDATED` | Cập nhật setting company quan trọng | Company Admin, Admin |
| `FOUNDATION.PUBLIC_HOLIDAY_CHANGED` | Tạo/sửa/xóa/import ngày nghỉ | HR/Admin hoặc toàn công ty nếu cấu hình |
| `FOUNDATION.SEED_FAILED` | Seed thất bại | Super Admin, DevOps/Admin kỹ thuật |
| `FOUNDATION.RETENTION_JOB_FAILED` | Cleanup/archive thất bại | Super Admin, DevOps/Admin kỹ thuật |

Quy tắc:

1. Không gửi notification cho mọi file upload/download để tránh spam.
2. File/task/leave/attendance notification do module gốc quyết định.
3. Foundation chỉ phát event quản trị hệ thống hoặc event cần module khác invalidate cache/recalculate.
4. Payload notification không chứa dữ liệu nhạy cảm.

---

## 25. Security checklist cho Foundation API

### 25.1 Company và tenant

- [ ] Không tin `company_id` từ frontend.
- [ ] Mọi query dữ liệu vận hành filter theo company từ auth context.
- [ ] Scope System mới được truy vấn cross-company.
- [ ] Company inactive/suspended phải được chặn đúng policy.
- [ ] Không trả dữ liệu company khác qua UUID guessing.

### 25.2 Setting

- [ ] Không trả setting sensitive qua public API.
- [ ] Secret dùng `SecretRef` hoặc secret manager.
- [ ] Mask sensitive value trong list/detail/audit.
- [ ] Validate schema trước khi lưu.
- [ ] Ghi audit khi cập nhật setting.
- [ ] Có cache invalidation khi setting thay đổi.

### 25.3 File

- [ ] Validate file size.
- [ ] Validate MIME type.
- [ ] Không trả storage path trực tiếp.
- [ ] File private là mặc định.
- [ ] Download phải kiểm tra permission + module policy.
- [ ] File sensitive phải ghi access log.
- [ ] Signed URL TTL ngắn.
- [ ] Không cho download file scan status `Infected`.
- [ ] Không link file vào entity khác company.
- [ ] Không unlink file khỏi entity đã khóa nếu module policy chặn.

### 25.4 Audit

- [ ] Audit log append-only.
- [ ] Mask dữ liệu nhạy cảm trước khi ghi.
- [ ] Có `request_id` hoặc `correlation_id`.
- [ ] Export audit có giới hạn thời gian.
- [ ] Xem/export audit nhạy cảm có thể cần ghi audit ngược.

### 25.5 Sequence

- [ ] Sinh mã bằng transaction + row lock.
- [ ] Không dùng `SELECT MAX(code) + 1`.
- [ ] Internal generate phải có idempotency.
- [ ] Không giảm current value nếu đã dùng.
- [ ] Preview không tăng counter.

### 25.6 Seed/retention

- [ ] Seed idempotent.
- [ ] Dev-only seed không chạy production.
- [ ] Không hardcode secret trong seed.
- [ ] Cleanup job có batch limit.
- [ ] Không cleanup dữ liệu legal hold.
- [ ] Cleanup/archive job ghi log.

---

## 26. Performance và cache

### 26.1 Setting cache

Setting effective có thể cache theo key:

```text
company_id + setting_key
```

TTL đề xuất:

```text
5 phút - 30 phút
```

Khi system/company setting thay đổi, backend cần invalidate cache theo key hoặc toàn bộ category/module.

---

### 26.2 File metadata

File metadata query cần index theo:

```text
company_id
file_id
uploaded_by
visibility
deleted_at
```

File by entity query cần index theo:

```text
company_id + module_code + entity_type + entity_id
```

---

### 26.3 Audit log

Audit log có thể tăng nhanh, cần:

1. Index theo `company_id`, `module_code`, `entity_type`, `entity_id`, `created_at`.
2. Giới hạn time range khi query/export.
3. Keyset pagination cho dữ liệu lớn ở phase sau.
4. Partition theo tháng/quý nếu volume lớn.
5. Archive theo retention policy.

---

### 26.4 Public holiday

Holiday check phải nhanh vì ATT/LEAVE gọi thường xuyên.

Index đề xuất logic:

```text
company_id + holiday_date
country_code + holiday_date
status
```

Có thể cache holiday theo:

```text
company_id + year
country_code + year
```

---

### 26.5 Sequence

Sequence generate không nên cache current value ở application nếu cần tính đúng tuyệt đối. Dùng database transaction/row lock.

---

## 27. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/fnd.paths.yaml`](openapi/paths/fnd.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 27.1 Security

`bearerAuth` (HTTP bearer JWT) cho `/api/v1/foundation/*`; API nội bộ `/internal/v1/foundation/*` dùng `internalServiceAuth`; `/api/v1/health` là public (`security: []`). File upload dùng `multipart/form-data`.

### 27.2 Tags của module

- `Foundation - Companies` — company/tenant
- `Foundation - Modules` — module catalog
- `Foundation - Settings` — system/company/effective settings
- `Foundation - Audit Logs` — truy vấn & xuất audit
- `Foundation - Files` — upload/download/metadata file
- `Foundation - File Links` — link/unlink file với entity
- `Foundation - File Access Logs` — log truy cập file
- `Foundation - Sequences` — sinh mã tự động
- `Foundation - Public Holidays` — ngày lễ
- `Foundation - Retention` — retention policy & cleanup
- `Foundation - Seeds` — seed tracking
- `Foundation - Internal` — API nội bộ Foundation
- `System` — health check

### 27.3 Vendor extensions (đồng nhất toàn hệ thống)

| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated/Internal) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `fnd`. (Lưu ý: tài liệu này chưa gán mã API ID — xem [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>) AUD-012.)

### 27.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/413/415/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`, `IfMatch`.

### 27.5 DTO đề xuất cho module

`CompanyDto`, `CreateCompanyRequest`, `ModuleDto`, `SystemSettingDto`, `CompanySettingDto`, `EffectiveSettingsDto`, `AuditLogDto`, `FileMetadataDto`, `FileLinkDto`, `FileAccessLogDto`, `SequenceDto`, `PublicHolidayDto`, `RetentionPolicyDto`, `SeedBatchDto`, `SeedItemDto`.

---

## 28. Test case checklist

### 28.1 Permission/scope

- [ ] User không đăng nhập gọi Foundation API bị 401.
- [ ] User thiếu permission bị 403.
- [ ] User Company scope không xem được dữ liệu company khác.
- [ ] Super Admin System scope xem được cross-company.
- [ ] Employee không tải được file HR sensitive nếu thiếu quyền module gốc.
- [ ] Manager chỉ tải được file task/project thuộc phạm vi được phép.

### 28.2 Settings

- [ ] Public setting trả đúng value.
- [ ] Company setting override system setting.
- [ ] Sensitive setting bị mask.
- [ ] Update setting sai schema bị 422.
- [ ] Update setting ghi audit log.
- [ ] Reset company setting trả về system default.

### 28.3 Files

- [ ] Upload file hợp lệ thành công.
- [ ] File quá dung lượng bị 413.
- [ ] MIME type không cho phép bị 415.
- [ ] Download file private cần quyền.
- [ ] File sensitive download ghi access log.
- [ ] Link file vào entity khác company bị chặn.
- [ ] Unlink file khỏi entity locked bị chặn.
- [ ] Không trả storage path trong response.

### 28.4 Audit

- [ ] Audit log tạo khi update setting/company/file/holiday.
- [ ] Audit old/new values được mask.
- [ ] Query audit theo entity trả đúng dữ liệu.
- [ ] Export audit cần quyền export.
- [ ] Audit log không update/delete qua public API.

### 28.5 Sequence

- [ ] Preview không tăng counter.
- [ ] Generate tăng counter đúng 1 lần.
- [ ] Retry cùng idempotency key không tăng counter lần hai.
- [ ] Generate song song không trùng mã.
- [ ] Sequence inactive bị chặn.
- [ ] Thiếu context format pattern bị 422.

### 28.6 Public holiday

- [ ] Tạo holiday thành công.
- [ ] Tạo trùng holiday bị 409.
- [ ] Company holiday override global holiday.
- [ ] Check holiday trả đúng `is_holiday`.
- [ ] Sửa/xóa holiday ghi audit.
- [ ] Import upsert không tạo trùng.

### 28.7 Seed/retention

- [ ] Seed batch hiển thị đúng status.
- [ ] Seed rerun không tạo trùng.
- [ ] Dev-only seed bị chặn ở production.
- [ ] Cleanup job dry run không xóa dữ liệu.
- [ ] Cleanup job có batch limit.
- [ ] Failed seed/cleanup ghi error message và audit.

---

## 29. Mapping Foundation với các module khác

| Module | Cách dùng Foundation |
| --- | --- |
| AUTH | Company, settings bảo mật, audit login/user/role, file avatar, seed permissions/roles |
| HR | File hồ sơ/hợp đồng, audit hồ sơ, sequence employee code, company settings |
| ATT | Public holidays, audit chấm công/điều chỉnh, file bằng chứng, settings, sequence request code |
| LEAVE | Public holidays, file chứng minh, audit đơn nghỉ, sequence leave request code |
| TASK | File project/task/comment, audit/activity, sequence project/task code |
| NOTI | Settings kênh gửi, module catalog, audit cấu hình notification, seed event/template |
| DASH | Settings dashboard, module catalog, audit config dashboard, retention/cache cleanup |
| PAYROLL phase sau | Audit bảng lương, file payslip, public holidays, retention nhạy cảm |
| MOBILE phase sau | File upload mobile, device setting, push settings |
| AI phase sau | Audit AI action, retention AI logs, file/data access control |

---

## 30. Thứ tự triển khai backend đề xuất cho API-09

### 30.1 Giai đoạn 1 - Foundation core

1. Company API cơ bản.
2. Module Catalog API read-only.
3. Setting service và API đọc effective/public settings.
4. Audit service internal.
5. File upload/download metadata cơ bản.
6. Sequence service internal generate.
7. Public holiday read/check.

### 30.2 Giai đoạn 2 - Admin APIs

1. System/company setting management.
2. Audit log query/export.
3. File link/unlink API.
4. File access log API.
5. Public holiday CRUD/import.
6. Sequence management API.
7. Module manage API nếu cần.

### 30.3 Giai đoạn 3 - Jobs và hardening

1. Retention policy API.
2. Cleanup job internal.
3. Seed tracking API.
4. Seed run internal.
5. Cache invalidation.
6. File scan integration hook.
7. Advanced audit export/background job.

---

## 31. Kết luận

API-09 hoàn thiện lớp API Foundation cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này chốt các API nền tảng dùng chung:

1. Company/tenant.
2. Module catalog.
3. System settings và company settings.
4. Audit log.
5. File metadata, upload, download, link/unlink và access log.
6. Sequence counter sinh mã tự động.
7. Public holidays.
8. Retention policy.
9. Seed tracking.
10. Internal service API.

Foundation phải giữ vai trò hạ tầng dùng chung, không xử lý nghiệp vụ gốc. Các quyết định nghiệp vụ như duyệt nghỉ, chấm công, giao task, hiển thị dashboard hoặc gửi notification cho ai vẫn thuộc module tương ứng.

Sau API-09, bộ API Design MVP đã có đủ nền tảng cho:

```text
API-01 Tổng quan
API-02 AUTH
API-03 HR
API-04 ATT
API-05 LEAVE
API-06 TASK
API-07 NOTI
API-08 DASH
API-09 FOUNDATION
```

Bước tiếp theo nên là:

1. Rà soát permission matrix API-02 -> API-09.
2. Chuẩn hóa OpenAPI/Swagger cho toàn bộ endpoint.
3. Chuyển sang UI/UX Design hoặc Backend Implementation Plan.
4. Viết test case API theo từng module.
5. Lập kế hoạch sprint triển khai MVP.
