# BACKEND-12: API INTEGRATION CONTRACT & OPENAPI/SWAGGER
# HỢP ĐỒNG TÍCH HỢP API & TÀI LIỆU OPENAPI/SWAGGER
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · **BACKEND-12 API Contract/OpenAPI** · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01](<../API Design/API-01 TỔNG QUAN.md>) · [Permission Matrix: API-10](<../API Design/API-10 PERMISSION MATRIX.md>) · [FE API Client: FRONTEND-04](<../FRONTEND/FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-12 |
| Tên tài liệu | API Integration Contract & OpenAPI/Swagger |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-11 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-12 mô tả cách backend chuẩn hóa **API Integration Contract** và triển khai **OpenAPI/Swagger** cho toàn bộ hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt chuẩn hợp đồng API giữa Backend, Frontend, Mobile, QA và DevOps.
2. Đảm bảo mọi API module tuân thủ API-01: base URL, versioning, auth, permission, data scope, response, error, pagination, audit, notification và idempotency.
3. Tạo OpenAPI/Swagger làm tài liệu kỹ thuật thống nhất cho toàn bộ endpoint public và internal.
4. Chuẩn hóa schema request/response, DTO, enum, error code và operationId.
5. Hỗ trợ sinh TypeScript types hoặc API client cho frontend nếu cần.
6. Hỗ trợ mock API, contract test và regression test dựa trên OpenAPI.
7. Giúp QA viết test case theo endpoint, permission, data scope, validation và business rule.
8. Giúp DevOps publish tài liệu Swagger theo từng môi trường: local, dev, staging, production.
9. Giảm rủi ro frontend/backend lệch contract khi phát triển song song.
10. Làm bước khóa hợp đồng API trước khi bước sang QA, performance và release readiness.

---

## 3. Vị trí BACKEND-12 trong roadmap backend

BACKEND-12 nằm sau khi các module backend MVP đã có controller/service/DTO cơ bản và trước giai đoạn QA tích hợp toàn hệ thống.

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

BACKEND-12 không thay thế API-01 -> API-09. Các tài liệu API là thiết kế nghiệp vụ và endpoint. BACKEND-12 biến các thiết kế đó thành **contract kỹ thuật có thể kiểm chứng**, publish và dùng trong quá trình tích hợp.

---

## 4. Căn cứ triển khai

BACKEND-12 bám theo các quyết định đã chốt:

1. API public dùng prefix `/api/v1`.
2. Internal API dùng prefix `/internal/v1` và không được gọi trực tiếp từ frontend/mobile.
3. Backend là nguồn kiểm soát quyền cuối cùng.
4. Frontend không được tự gửi `company_id`, `user_id`, `employee_id`, `role`, `permission`, `data_scope` nếu backend có thể resolve từ auth context.
5. Tất cả API nghiệp vụ mặc định yêu cầu access token.
6. Access token gửi qua `Authorization: Bearer <access_token>` hoặc cơ chế cookie auth nếu backend chốt triển khai HttpOnly cookie.
7. Response thành công thống nhất: `success`, `message`, `data`, `meta`, và `pagination` nếu là list.
8. Response lỗi thống nhất: `success`, `message`, `error`, `meta`.
9. Validation error có `details` theo từng field.
10. API list hỗ trợ pagination, search, filter, sort theo whitelist.
11. File upload dùng service chung, file private là mặc định.
12. File download phải kiểm tra permission trước khi cấp link hoặc trả file.
13. API quan trọng cần hỗ trợ `Idempotency-Key`.
14. Mỗi endpoint phải khai báo required permission, data scope, audit log và notification event nếu có.
15. Dashboard chỉ tổng hợp dữ liệu; không xử lý nghiệp vụ gốc thay module nguồn.
16. Notification deep link và dashboard quick action phải điều hướng về module gốc và module gốc kiểm tra lại permission/data scope/business rule.
17. Swagger/OpenAPI phải phản ánh đúng implementation thật, không chỉ là tài liệu tham khảo.

---

## 5. Phạm vi BACKEND-12

### 5.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| API contract | Chuẩn response, error, pagination, auth, header, query, DTO, enum |
| OpenAPI generation | Cấu trúc tài liệu OpenAPI, Swagger UI, JSON/YAML output |
| Endpoint metadata | Tag, operationId, permission, data scope, audit, event, idempotency |
| Schema convention | Request schema, response schema, list schema, error schema, enum schema |
| Module contract | AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION |
| Internal API contract | Contract cho event, job, sync, cache invalidation, service-to-service |
| Frontend integration | Type generation, API client alignment, mock API, query key mapping |
| QA integration | Contract test, permission test, validation test, error test |
| CI validation | Lint OpenAPI, detect breaking change, generate docs artifact |
| Security | Không expose secret, private field, internal endpoint, dữ liệu nhạy cảm |

### 5.2 Không bao gồm

| Nội dung | Chuyển sang |
| --- | --- |
| Thiết kế nghiệp vụ từng endpoint từ đầu | API-02 -> API-09 |
| Logic service nghiệp vụ | BACKEND-05 -> BACKEND-10 |
| Database migration/schema | BACKEND-02 và DB-01 -> DB-10 |
| UI state chi tiết | FRONTEND-04 -> FRONTEND-14 |
| E2E test toàn hệ thống | BACKEND-13 / FRONTEND-14 / QA plan |
| API gateway/cloud deploy chi tiết | DevOps/Deployment |
| SDK mobile native hoàn chỉnh | Phase Mobile |

---

## 6. Mục tiêu triển khai

### 6.1 Mục tiêu kỹ thuật

1. Một nguồn contract API rõ ràng, có version và có thể kiểm thử tự động.
2. Swagger UI có thể xem theo module/tag.
3. OpenAPI JSON/YAML có thể export để frontend/QA sử dụng.
4. Tất cả response schema dùng chung thay vì mỗi module tự định nghĩa khác nhau.
5. Tất cả endpoint có `operationId` ổn định để codegen không bị đổi tên ngẫu nhiên.
6. Endpoint nào cần quyền phải thể hiện quyền ngay trong OpenAPI.
7. Endpoint nào có data scope phải thể hiện scope ngay trong OpenAPI.
8. Endpoint nào phát notification/audit phải thể hiện metadata để QA kiểm thử.
9. Contract test có thể phát hiện endpoint lệch chuẩn.
10. CI có thể chặn merge nếu OpenAPI bị lỗi syntax hoặc breaking change không được chấp thuận.

### 6.2 Mục tiêu phối hợp team

| Team | Lợi ích từ BACKEND-12 |
| --- | --- |
| Backend | Có chuẩn viết DTO/controller/decorator/documentation thống nhất |
| Frontend | Có contract để viết API client, hook, mock, TypeScript type |
| QA | Có danh sách endpoint, permission, status code, error code để test |
| Product/BA | Có tài liệu endpoint dễ review theo module nghiệp vụ |
| DevOps | Có artifact Swagger để publish theo môi trường |
| Security | Có nơi kiểm tra endpoint public/internal, auth, dữ liệu nhạy cảm |

---

## 7. Nguyên tắc API contract tổng thể

### 7.1 OpenAPI phản ánh implementation thật

Không viết Swagger tách rời rồi để lệch với code.

Khuyến nghị triển khai theo hướng:

```text
Controller/Route + DTO + Decorator metadata
-> Generate OpenAPI JSON/YAML
-> Publish Swagger UI
-> Contract test
-> Frontend type generation nếu cần
```

Nếu dự án chọn spec-first, vẫn phải có CI test đảm bảo backend implementation đáp ứng đúng OpenAPI.

### 7.2 Contract không chỉ là URL

Mỗi endpoint phải có đủ:

1. Method.
2. Path.
3. Tag/module.
4. Summary.
5. Description.
6. OperationId.
7. Security scheme.
8. Required permission.
9. Data scope.
10. Query/path/body params.
11. Success response schema.
12. Error response schema.
13. Validation rule chính.
14. Audit log metadata.
15. Notification event metadata nếu có.
16. Idempotency requirement nếu có.
17. Rate limit nếu có.
18. Internal/public flag.

### 7.3 Không hard-code theo role trong contract

OpenAPI có thể ghi `allowed_roles` để giải thích nghiệp vụ, nhưng field bắt buộc phải là:

```text
x-required-permission
x-data-scope
```

Role chỉ là seed mặc định của hệ thống RBAC.

### 7.4 Không expose dữ liệu nhạy cảm trong schema

Swagger không được mô tả hoặc trả mẫu các field nhạy cảm sau nếu không thật sự cần:

```text
password_hash
refresh_token_hash
access_token raw trong log
private storage path
file private path
secret setting value
salary/bank/identity field nếu user thiếu quyền
old_value/new_value audit chi tiết nếu nhạy cảm
```

Nếu endpoint có thể trả field nhạy cảm theo quyền, schema phải ghi rõ field có điều kiện:

```yaml
x-sensitive: true
x-required-permission: HR.EMPLOYEE.VIEW_SENSITIVE
```

### 7.5 Public API và internal API tách rõ

| Loại API | Prefix | Swagger visibility | Security |
| --- | --- | --- | --- |
| Public frontend/mobile | `/api/v1` | Swagger public/internal docs đều thấy | User access token |
| Internal service/job | `/internal/v1` | Chỉ hiển thị ở internal Swagger | Service auth + allowlist/rate limit |
| Health check public | `/api/v1/health` hoặc `/health` | Có thể hiển thị | Không cần token hoặc token tùy môi trường |

Internal API không được xuất hiện trong Swagger public production nếu không có nhu cầu.

---

## 8. Cấu trúc OpenAPI đề xuất

### 8.1 File artifact

Backend build ra các artifact:

```text
artifacts/openapi/
  openapi.public.json
  openapi.public.yaml
  openapi.internal.json
  openapi.internal.yaml
  openapi.modules/
    auth.openapi.json
    hr.openapi.json
    attendance.openapi.json
    leave.openapi.json
    task.openapi.json
    notification.openapi.json
    dashboard.openapi.json
    foundation.openapi.json
```

### 8.2 Swagger route theo môi trường

| Môi trường | Route Swagger UI | Ghi chú |
| --- | --- | --- |
| Local | `/docs` | Bật mặc định |
| Development | `/docs` | Bật, cần auth cơ bản hoặc VPN nếu có |
| Staging | `/docs` | Bật cho team nội bộ |
| Production | `/docs` | Nên tắt hoặc bảo vệ bằng auth/admin allowlist |
| Internal docs | `/internal/docs` | Chỉ bật trong local/dev/staging hoặc private network |

### 8.3 OpenAPI root metadata

```yaml
openapi: 3.1.0
info:
  title: Enterprise Management System API
  version: 1.0.0
  description: API contract cho hệ thống quản lý doanh nghiệp nội bộ MVP.
servers:
  - url: http://localhost:3000/api/v1
    description: Local
  - url: https://dev-api.example.com/api/v1
    description: Development
  - url: https://staging-api.example.com/api/v1
    description: Staging
  - url: https://api.example.com/api/v1
    description: Production
```

### 8.4 Security schemes

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    cookieAuth:
      type: apiKey
      in: cookie
      name: access_token
    serviceAuth:
      type: apiKey
      in: header
      name: X-Service-Token
```

MVP có thể chọn `bearerAuth` là scheme chính. Nếu triển khai HttpOnly cookie, bổ sung `cookieAuth` và cập nhật frontend contract.

---

## 9. Tag convention theo module

### 9.1 Tag cấp module

| Module | Tag prefix | Ví dụ tag |
| --- | --- | --- |
| AUTH | `Auth -` | `Auth - Session`, `Auth - Users`, `Auth - Roles` |
| HR | `HR -` | `HR - Employees`, `HR - Departments`, `HR - Profile Change` |
| ATT | `Attendance -` | `Attendance - Today`, `Attendance - Records`, `Attendance - Shifts` |
| LEAVE | `Leave -` | `Leave - Requests`, `Leave - Balances`, `Leave - Calendar` |
| TASK | `Task -` | `Task - Projects`, `Task - Tasks`, `Task - Comments` |
| NOTI | `Notification -` | `Notification - My`, `Notification - Templates`, `Notification - Events` |
| DASH | `Dashboard -` | `Dashboard - Me`, `Dashboard - Widgets`, `Dashboard - Configs` |
| FOUNDATION | `Foundation -` | `Foundation - Files`, `Foundation - Settings`, `Foundation - Audit Logs` |
| INTERNAL | `Internal -` | `Internal - Events`, `Internal - Jobs`, `Internal - Sync` |

### 9.2 Quy tắc đặt tag

1. Không dùng tag quá chung như `API`, `Common`, `Controller`.
2. Tag phải giúp người dùng Swagger lọc được endpoint theo nghiệp vụ.
3. Tag action liên quan file vẫn nên nằm theo module nghiệp vụ nếu route thuộc module đó.
4. Endpoint file dùng chung ở FOUNDATION dùng tag `Foundation - Files`.
5. Endpoint internal phải có tag bắt đầu bằng `Internal -`.

---

## 10. OperationId convention

### 10.1 Format operationId

```text
<module><Resource><Action>
```

Ví dụ:

```text
authLogin
authGetMe
hrListEmployees
hrGetEmployeeDetail
attendanceGetToday
attendanceCheckIn
leaveCreateRequest
leaveApproveRequest
taskCreateProject
taskChangeStatus
notificationGetUnreadCount
dashboardGetMe
foundationUploadFile
```

### 10.2 Quy tắc operationId

1. Mỗi operationId phải unique toàn hệ thống.
2. Không đổi operationId tùy tiện vì frontend codegen có thể phụ thuộc.
3. Không dùng tên framework như `EmployeeController_findAll`.
4. Action phải ổn định: `list`, `get`, `create`, `update`, `delete`, `submit`, `approve`, `reject`, `cancel`, `export`.
5. Nếu endpoint bị deprecate, giữ operationId cũ và thêm `deprecated: true`.

---

## 11. Custom OpenAPI extensions bắt buộc

OpenAPI chuẩn không có field riêng cho permission/data scope. Backend dùng custom extension `x-*`.

### 11.1 Extension chung

| Extension | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `x-module` | string | Có | Module code: AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION |
| `x-feature-code` | string | Nên có | Mã chức năng nếu đã có trong SPEC/API |
| `x-required-permission` | string/null | Có với protected API | Permission bắt buộc |
| `x-data-scope` | string[] | Có với API dữ liệu | Scope hợp lệ |
| `x-allowed-roles` | string[] | Tùy chọn | Role seed mặc định, chỉ để mô tả |
| `x-auth-required` | boolean | Có | API có cần auth không |
| `x-idempotency-required` | boolean | Có với mutation quan trọng | Có cần Idempotency-Key không |
| `x-audit-log` | object | Có với action quan trọng | Có ghi audit không, action/entity gì |
| `x-notification-events` | string[] | Tùy chọn | Event phát ra sau action |
| `x-rate-limit` | object | Tùy chọn | Rate limit dự kiến |
| `x-internal` | boolean | Có | Có phải internal API không |
| `x-sensitive-fields` | string[] | Tùy chọn | Field nhạy cảm có thể được trả về |
| `x-source-doc` | string | Nên có | API-xx hoặc BACKEND-xx liên quan |

### 11.2 Ví dụ operation có extension

```yaml
post:
  tags:
    - Attendance - Today
  operationId: attendanceCheckIn
  summary: Nhân viên check-in
  security:
    - bearerAuth: []
  x-module: ATT
  x-required-permission: ATT.ATTENDANCE.CHECK_IN
  x-data-scope:
    - Own
  x-auth-required: true
  x-idempotency-required: true
  x-audit-log:
    enabled: true
    action: CHECK_IN
    entity: attendance_records
  x-notification-events: []
  x-internal: false
  x-source-doc: API-04
```

---

## 12. Chuẩn schema dùng chung

### 12.1 ApiMeta schema

```yaml
ApiMeta:
  type: object
  required:
    - request_id
    - timestamp
  properties:
    request_id:
      type: string
      example: req_20260620_000001
    correlation_id:
      type: string
      nullable: true
      example: corr_20260620_000001
    timestamp:
      type: string
      format: date-time
      example: "2026-06-20T10:00:00+07:00"
```

### 12.2 ApiPagination schema

```yaml
ApiPagination:
  type: object
  required:
    - page
    - per_page
    - total
    - total_pages
    - has_next
    - has_prev
  properties:
    page:
      type: integer
      minimum: 1
      example: 1
    per_page:
      type: integer
      minimum: 1
      maximum: 100
      example: 20
    total:
      type: integer
      minimum: 0
      example: 100
    total_pages:
      type: integer
      minimum: 0
      example: 5
    has_next:
      type: boolean
      example: true
    has_prev:
      type: boolean
      example: false
```

### 12.3 ApiSuccessResponse schema pattern

OpenAPI không có generic runtime như TypeScript, nên backend tạo wrapper schema theo từng DTO hoặc dùng `allOf`.

```yaml
EmployeeDetailResponse:
  allOf:
    - $ref: '#/components/schemas/ApiSuccessBase'
    - type: object
      properties:
        data:
          $ref: '#/components/schemas/EmployeeDetailDto'
```

Base:

```yaml
ApiSuccessBase:
  type: object
  required:
    - success
    - message
    - data
    - meta
  properties:
    success:
      type: boolean
      const: true
      example: true
    message:
      type: string
      example: Lấy dữ liệu thành công
    data:
      nullable: true
    meta:
      $ref: '#/components/schemas/ApiMeta'
```

### 12.4 ApiListResponse schema pattern

```yaml
EmployeeListResponse:
  allOf:
    - $ref: '#/components/schemas/ApiSuccessBase'
    - type: object
      required:
        - pagination
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/EmployeeListItemDto'
        pagination:
          $ref: '#/components/schemas/ApiPagination'
```

### 12.5 ApiErrorResponse schema

```yaml
ApiErrorResponse:
  type: object
  required:
    - success
    - message
    - error
    - meta
  properties:
    success:
      type: boolean
      const: false
      example: false
    message:
      type: string
      example: Bạn không có quyền thực hiện thao tác này
    error:
      $ref: '#/components/schemas/ApiErrorPayload'
    meta:
      $ref: '#/components/schemas/ApiMeta'

ApiErrorPayload:
  type: object
  required:
    - code
    - type
  properties:
    code:
      type: string
      example: AUTH-ERR-FORBIDDEN
    type:
      type: string
      example: ForbiddenError
    details:
      nullable: true
```

### 12.6 ValidationError schema

```yaml
ValidationErrorResponse:
  allOf:
    - $ref: '#/components/schemas/ApiErrorResponse'
    - type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
              example: VALIDATION-ERR-001
            type:
              type: string
              example: ValidationError
            details:
              type: array
              items:
                $ref: '#/components/schemas/ValidationErrorDetail'

ValidationErrorDetail:
  type: object
  required:
    - field
    - message
  properties:
    field:
      type: string
      example: email
    message:
      type: string
      example: Email không đúng định dạng
    rule:
      type: string
      nullable: true
      example: email
    value:
      nullable: true
```

---

## 13. Chuẩn HTTP status code

| Status | Khi dùng | Response schema |
| --- | --- | --- |
| 200 | Lấy/cập nhật/action thành công | ApiSuccessResponse |
| 201 | Tạo resource thành công | ApiSuccessResponse |
| 202 | Đã nhận request async/export/job | ApiSuccessResponse |
| 204 | Không khuyến nghị vì hệ thống cần `meta.request_id` | Không dùng mặc định |
| 400 | Request sai format/path/query/body | ApiErrorResponse |
| 401 | Chưa đăng nhập/token hết hạn | ApiErrorResponse |
| 403 | Không có quyền hoặc ngoài data scope | ApiErrorResponse |
| 404 | Không tìm thấy hoặc che giấu dữ liệu ngoài scope | ApiErrorResponse |
| 409 | Xung đột dữ liệu/version/idempotency | ApiErrorResponse |
| 422 | Business rule không cho phép | ApiErrorResponse |
| 429 | Rate limit | ApiErrorResponse |
| 500 | Lỗi hệ thống | ApiErrorResponse |
| 503 | Service maintenance/degraded | ApiErrorResponse |

Quy tắc:

1. Không trả stack trace trong response.
2. Không trả lỗi database raw.
3. Không trả object lỗi khác format.
4. `404` có thể dùng thay `403` nếu cần tránh lộ resource tồn tại ở company/scope khác.
5. `422` dùng cho business rule hợp lệ về mặt request nhưng không được phép theo nghiệp vụ.

> **Reconcile thực thi (S2-FND-CONTRACT-1) — chốt biên `400` vs `422` cho FOUNDATION settings:**
> - **`400`** = sai **kiểu dữ liệu** so với `value_type` khai báo (vd gửi string cho `Number`), hoặc không
>   xác định được `value_type`. Mã: `FOUNDATION-ERR-SETTING-VALUE-TYPE` / `-VALUE-TYPE-UNKNOWN`.
> - **`422`** = request đúng kiểu nhưng vi phạm **`validation_schema`** của setting (min/max/enum/pattern/length).
>   Mã **GIỮ `VALIDATION-ERR-*`** (KHÔNG đổi sang `FOUNDATION-ERR-*`) — vì `packages/web-core`
>   `mapStatusToErrorKind` prefix-match `code.startsWith('VALIDATION-ERR')` để style riêng lỗi validation.
>   Đây là tiền lệ CHỦ Ý (`setting.service.assertSchema`), pin ở đây để không bị "chuẩn hoá nhầm" về 400.
> - **Ranh giới `403`:** guard-level (PermissionGuard) trả `AUTH-ERR-FORBIDDEN`; business-rule 403 do
>   SERVICE tự ném (company Suspended, module core-lock) trả `FOUNDATION-ERR-*` (xem §21 catalog).

---

## 14. Chuẩn header contract

### 14.1 Request header chung

| Header | Bắt buộc | Mô tả |
| --- | --- | --- |
| `Authorization` | Có với API cần auth | `Bearer <access_token>` |
| `Content-Type` | Có với JSON body | `application/json` |
| `Accept` | Nên có | `application/json` |
| `X-Request-Id` | Nên có | Request ID từ client; backend tự sinh nếu thiếu |
| `X-Correlation-Id` | Tùy chọn | Gom nhiều request trong một flow |
| `X-Client-Type` | Nên có | `web`, `mobile`, `system` |
| `X-Client-Version` | Nên có | Version frontend/mobile |
| `Idempotency-Key` | Có với mutation quan trọng | Chống submit trùng |

### 14.2 Response header chung

| Header | Mô tả |
| --- | --- |
| `X-Request-Id` | Request ID cuối cùng được backend dùng |
| `X-Correlation-Id` | Correlation ID nếu có |
| `X-RateLimit-Limit` | Nếu endpoint có rate limit |
| `X-RateLimit-Remaining` | Nếu endpoint có rate limit |
| `Retry-After` | Nếu bị 429 hoặc service yêu cầu retry sau |

---

## 15. Chuẩn query params cho list endpoint

### 15.1 Pagination

```http
GET /api/v1/hr/employees?page=1&per_page=20
```

| Param | Kiểu | Mặc định | Tối đa | Ghi chú |
| --- | --- | ---: | ---: | --- |
| `page` | integer | 1 | - | Bắt đầu từ 1 |
| `per_page` | integer | 20 | 100 | Endpoint đặc biệt có thể thấp hơn |

> **Reconcile thực thi (S2-FND-CONTRACT-1) — quy ước REQUEST hiện có, chốt song song (KHÔNG đổi code):**
> `page`/`per_page` ở trên là **response envelope chuẩn** (khối `pagination`, API-01 §16.1 — `paginationSchema`
> trong `packages/contracts`). Về **tham số REQUEST**, code hiện tồn tại **hai quy ước có chủ ý**, không hợp
> nhất cơ học vì ngữ nghĩa khác nhau:
>
> 1. **Entity/file list** (`GET /foundation/files`, `/file-access-logs`, HR employees…): dùng **`page` + `limit`**
>    (page-based; `limit` = kích thước trang, coerce từ query-string, `.catch` fallback default để list KHÔNG
>    bao giờ 400 vì tham số rác). Đây là dạng "trang" quen thuộc cho bảng UI.
> 2. **Audit/log cursor** (`GET /foundation/audit`, log endpoints): dùng **`limit` + `offset`** (offset-based) vì
>    consumer log/audit cuộn theo cửa sổ tuyến tính, không cần tổng số trang.
>
> Cả hai đều hợp lệ; endpoint mới **nên** ưu tiên `page`/`per_page` (canonical). Việc gộp `limit`↔`per_page` là
> nợ kỹ thuật ở tầng đặt tên, **để lại cho đợt chuẩn hoá envelope sau** (không thuộc phạm vi WO này).

### 15.2 Search

```http
GET /api/v1/hr/employees?search=nguyen
```

Mỗi endpoint phải khai báo search whitelist trong description hoặc extension:

```yaml
x-searchable-fields:
  - employee_code
  - full_name
  - work_email
```

### 15.3 Filter

Có thể dùng dạng flat:

```http
GET /api/v1/tasks?status=Todo&priority=High
```

Hoặc nested query nếu frontend/backend đã thống nhất:

```http
GET /api/v1/tasks?filters[status]=Todo&filters[priority]=High
```

MVP khuyến nghị ưu tiên **flat filter** cho dễ đọc trong Swagger, nhưng frontend API client vẫn có thể hỗ trợ serializer nested.

### 15.4 Sort

```http
GET /api/v1/tasks?sort=created_at:desc,due_at:asc
```

Mỗi endpoint phải khai báo sort whitelist:

```yaml
x-sortable-fields:
  - created_at
  - updated_at
  - due_at
  - status
```

---

## 16. Chuẩn DTO naming

### 16.1 Request DTO

| Loại | Format | Ví dụ |
| --- | --- | --- |
| Create | `Create<Resource>Request` | `CreateEmployeeRequest` |
| Update partial | `Update<Resource>Request` | `UpdateEmployeeRequest` |
| Action | `<Action><Resource>Request` | `ApproveLeaveRequestRequest` |
| Review | `Review<Resource>Request` | `ReviewAttendanceAdjustmentRequest` |
| Export | `<Resource>ExportRequest` | `AttendanceExportRequest` |
| Query params | `<Resource>ListQuery` | `EmployeeListQuery` |

### 16.2 Response DTO

| Loại | Format | Ví dụ |
| --- | --- | --- |
| Detail | `<Resource>Dto` hoặc `<Resource>DetailDto` | `EmployeeDetailDto` |
| List item | `<Resource>ListItemDto` | `TaskListItemDto` |
| Summary | `<Resource>SummaryDto` | `EmployeeSummaryDto` |
| Action result | `<Action><Resource>ResultDto` | `CheckInResultDto` |
| Dashboard widget | `<WidgetName>WidgetDto` | `AttendanceTodayWidgetDto` |

### 16.3 Enum naming

```text
EmployeeStatus
AttendanceStatus
LeaveRequestStatus
TaskStatus
TaskPriority
NotificationChannel
DashboardType
DataScope
```

Enum value nên thống nhất giữa DB, API và frontend. Nếu DB dùng snake_case, API có thể dùng enum string dễ đọc nhưng phải mapping rõ.

---

## 17. Module contract checklist

Mỗi module phải có file contract/checklist tương ứng:

```text
contracts/
  auth.contract.md
  hr.contract.md
  attendance.contract.md
  leave.contract.md
  task.contract.md
  notification.contract.md
  dashboard.contract.md
  foundation.contract.md
```

Mỗi file module contract cần có:

1. Base prefix.
2. Danh sách tag.
3. Danh sách endpoint.
4. Required permission từng endpoint.
5. Data scope từng endpoint.
6. Request DTO.
7. Response DTO.
8. Error code module.
9. Business rule error chính.
10. Event phát ra.
11. Audit log action.
12. Idempotency action.
13. File upload/download nếu có.
14. Contract test case.
15. Swagger coverage status.

---

## 18. Contract theo module MVP

### 18.1 AUTH contract

Base prefix:

```http
/api/v1/auth
```

Nhóm endpoint cần có trong Swagger:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Session | `POST /login`, `POST /logout`, `POST /refresh-token`, `GET /me` | Public auth + protected me |
| Password | `POST /forgot-password`, `POST /reset-password`, `POST /change-password` | Không expose token trong Swagger example |
| Users | `GET /users`, `POST /users`, `PATCH /users/{id}` | Permission + scope Company/System |
| Roles | `GET /roles`, `POST /roles`, `PATCH /roles/{id}` | RBAC admin |
| Permissions | `GET /permissions` | Danh mục quyền |
| User roles | `POST /users/{id}/roles`, `DELETE /users/{id}/roles/{role_id}` | Audit bắt buộc |
| Logs | `GET /login-logs`, `GET /security-events` | Dữ liệu nhạy cảm, phân quyền kỹ |

Metadata bắt buộc:

```text
x-module: AUTH
x-required-permission: AUTH.*
x-data-scope: Own/Company/System
```

### 18.2 HR contract

Base prefix:

```http
/api/v1/hr
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Employees | `GET /employees`, `POST /employees`, `GET /employees/{id}`, `PATCH /employees/{id}` | Field nhạy cảm theo quyền |
| My profile | `GET /my-profile` | Scope Own |
| Profile change | `POST /profile-change-requests`, `POST /profile-change-requests/{id}/approve` | Event NOTI, audit |
| Departments | `GET /departments`, `POST /departments` | Tree data |
| Positions | `GET /positions`, `POST /positions` | Master data |
| Job levels | `GET /job-levels` | Master data |
| Contracts | `GET /employees/{id}/contracts`, `POST /employees/{id}/contracts` | File/private field |
| Files | `POST /employees/{id}/files` | Multipart + file service |
| Employee code | `GET /employee-code-config`, `PATCH /employee-code-config`, `POST /employee-code/preview` | Sequence contract |
| Org chart | `GET /org-chart` | Scope Department/Company |

### 18.3 ATT contract

Base prefix:

```http
/api/v1/attendance
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Today | `GET /today` | Trả action availability |
| Check-in/out | `POST /check-in`, `POST /check-out` | Idempotency bắt buộc |
| Records | `GET /my-records`, `GET /records`, `GET /records/{id}` | Scope Own/Team/Company |
| Logs | `GET /records/{id}/logs` | Audit/scope |
| Adjustment | `POST /adjustment-requests`, `POST /adjustment-requests/{id}/approve` | Workflow state |
| Manual adjust | `POST /records/{id}/manual-adjust` | HR/Admin, audit bắt buộc |
| Remote work | `POST /remote-work-requests`, `POST /remote-work-requests/{id}/approve` | Rule remote |
| Shifts | `GET /shifts`, `POST /shifts` | Config API |
| Rules | `GET /rules`, `POST /rules` | Config theo scope |
| Export | `POST /exports` | Async nếu dữ liệu lớn |

Internal:

```http
POST /internal/v1/attendance/recalculate
POST /internal/v1/attendance/missing-checkout-job
POST /internal/v1/attendance/auto-attendance-job
```

### 18.4 LEAVE contract

Base prefix:

```http
/api/v1/leave
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| My balance | `GET /my-balances` | Scope Own |
| My request | `GET /my-requests`, `POST /requests`, `POST /requests/{id}/submit` | Idempotency với create/submit |
| Approval | `GET /requests/pending-approval`, `POST /requests/{id}/approve`, `POST /requests/{id}/reject` | Scope Team/Company |
| Cancel/revoke | `POST /requests/{id}/cancel`, `POST /requests/{id}/revoke` | State transition |
| Calculation | `POST /requests/calculate` | Preview before submit |
| Calendar | `GET /calendar` | Own/Team/Department/Company |
| Types | `GET /types`, `POST /types` | HR/Admin config |
| Policies | `GET /policies`, `POST /policies` | Config scope |
| Balances admin | `GET /balances`, `POST /balances/{id}/adjust` | Ledger/audit |
| History | `GET /requests/{id}/history` | Workflow history |
| Export | `POST /exports` | Async nếu cần |

Internal:

```http
POST /internal/v1/leave/events/approved
POST /internal/v1/leave/accrual-jobs
```

### 18.5 TASK contract

Base prefix:

```http
/api/v1/tasks
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Projects | `GET /projects`, `POST /projects`, `PATCH /projects/{id}` | Project role + RBAC |
| Members | `GET /projects/{id}/members`, `POST /projects/{id}/members` | Manage member permission |
| Tasks | `GET /tasks`, `POST /tasks`, `GET /tasks/{id}`, `PATCH /tasks/{id}` | Scope Project/Own/Team |
| My tasks | `GET /my-tasks`, `GET /assigned-to-me`, `GET /watching` | Scope Own |
| Actions | `POST /tasks/{id}/assign`, `POST /tasks/{id}/change-status` | Event NOTI |
| Kanban | `GET /projects/{id}/kanban` | Board response schema |
| Comments | `POST /tasks/{id}/comments`, `PATCH /tasks/{id}/comments/{comment_id}` | Mention event |
| Checklist | `GET /tasks/{id}/checklists`, `POST /tasks/{id}/checklists` | Nested DTO |
| Files | `POST /tasks/{id}/files`, `GET /tasks/{id}/files` | Multipart/private file |
| Activity | `GET /tasks/{id}/activity-logs` | Activity vs audit |
| Report | `GET /projects/{id}/report` | Summary DTO |

### 18.6 NOTI contract

Base prefix:

```http
/api/v1/notifications
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| My notifications | `GET /`, `GET /dropdown`, `GET /unread-count`, `GET /{id}` | Recipient user only |
| Actions | `POST /{id}/mark-read`, `POST /mark-all-read`, `POST /{id}/archive` | Idempotent optional |
| Target | `POST /{id}/open-target` | Safe deep link, body `{mark_read}` |
| Admin view | `GET /admin/notifications` | Scope Company/System |
| Events | `GET /events`, `PATCH /events/{id}` | Config |
| Templates | `GET /templates`, `POST /templates`, `PATCH /templates/{id}` | Template schema |
| Channels | `GET /channels`, `PATCH /channels/{id}` | In-app MVP, email/push phase sau |
| Delivery logs | `GET /delivery-logs`, `POST /delivery-logs/{id}/retry` | Admin only |
| System notification | `POST /system-notifications` | Admin/Super Admin |

Internal:

```http
POST /internal/v1/notifications/events
POST /internal/v1/notifications/deliver
```

### 18.7 DASH contract

Base prefix:

```http
/api/v1/dashboard
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Dashboard me | `GET /me` | Trả dashboard mặc định theo user |
| Dashboard type | `GET /employee`, `GET /manager`, `GET /hr`, `GET /admin` | Role/permission/scope |
| Widgets | `GET /widgets`, `GET /widgets/{widget_slug}` | Lazy load, degraded state |
| Configs | `GET /configs`, `PATCH /configs/{id}` | Admin config |
| Layout | `PATCH /my-layout`, `POST /my-layout/reset` | Có thể phase sau |
| Cache | `POST /internal/v1/dashboard/cache/invalidate` | Internal only |

Contract DASH phải thể hiện rõ:

1. Widget nào là degraded được.
2. Widget nào cần permission nguồn.
3. Widget nào có cache TTL.
4. Quick action chỉ điều hướng, không xử lý nghiệp vụ gốc.

### 18.8 FOUNDATION contract

Base prefix:

```http
/api/v1/foundation
```

Nhóm endpoint:

| Nhóm | Ví dụ endpoint | Ghi chú contract |
| --- | --- | --- |
| Company | `GET /company/current`, `PATCH /company/current` | Admin only |
| Modules | `GET /modules`, `PATCH /modules/{id}` | App registry |
| Settings | `GET /settings`, `PATCH /settings/{key}`, `GET /system-settings`, `PATCH /system-settings/{key}` | Mask secret values |
| Files | `POST /files/upload`, `GET /files/{id}`, `GET /files/{id}/download-url`, `GET /files/{id}/download` | Private default |
| File links | `POST /file-links`, `DELETE /file-links/{id}` | Link entity |
| Audit logs | `GET /audit-logs` | Sensitive, paginated |
| Sequences | `GET /sequences/{code}/preview` | Admin/system |
| Public holidays | `GET /public-holidays`, `POST /public-holidays` | ATT/LEAVE shared |
| Health | `GET /health` | Public or restricted by env |

---

## 19. Multipart upload contract

### 19.1 File upload public pattern

```http
POST /api/v1/foundation/files/upload
Content-Type: multipart/form-data
```

Request fields:

| Field | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `file` | binary | Có | File cần upload |
| `module_code` | string | Có | Module dùng file: HR, ATT, LEAVE, TASK |
| `entity_type` | string | Tùy flow | Loại entity nghiệp vụ |
| `entity_id` | UUID | Tùy flow | Entity gắn file nếu có |
| `purpose` | string | Có | avatar, contract, evidence, attachment |
| `is_private` | boolean | Không | Mặc định true |

OpenAPI:

```yaml
requestBody:
  required: true
  content:
    multipart/form-data:
      schema:
        type: object
        required:
          - file
          - module_code
          - purpose
        properties:
          file:
            type: string
            format: binary
          module_code:
            type: string
            enum: [HR, ATT, LEAVE, TASK]
          purpose:
            type: string
          entity_type:
            type: string
          entity_id:
            type: string
            format: uuid
          is_private:
            type: boolean
            default: true
```

### 19.2 Module-specific upload pattern

Nếu module có route riêng:

```http
POST /api/v1/tasks/tasks/{task_id}/files
POST /api/v1/hr/employees/{employee_id}/files
```

Backend vẫn dùng file service chung nhưng OpenAPI phải thể hiện route nghiệp vụ để frontend dễ dùng.

---

## 20. Idempotency contract

### 20.1 Action bắt buộc có Idempotency-Key

| Module | Action | Endpoint ví dụ |
| --- | --- | --- |
| ATT | Check-in/check-out | `POST /attendance/check-in` |
| ATT | Manual adjust | `POST /attendance/records/{id}/manual-adjust` |
| LEAVE | Create/submit/approve/reject | `POST /leave/requests`, `POST /leave/requests/{id}/approve` |
| HR | Create employee | `POST /hr/employees` |
| HR | Approve profile change | `POST /hr/profile-change-requests/{id}/approve` |
| TASK | Create project/task | `POST /tasks/projects`, `POST /tasks` |
| TASK | Assign/change status | `POST /tasks/{id}/assign`, `POST /tasks/{id}/change-status` |
| FOUNDATION | Upload file | `POST /foundation/files/upload` nếu backend hỗ trợ |
| NOTI | Send system notification | `POST /notifications/system-notifications` |

### 20.2 OpenAPI header khai báo

```yaml
parameters:
  - in: header
    name: Idempotency-Key
    required: true
    schema:
      type: string
      minLength: 8
    description: Khóa chống xử lý trùng request nghiệp vụ quan trọng.
```

### 20.3 Response khi idempotency conflict

```json
{
  "success": false,
  "message": "Request đang được xử lý hoặc đã được xử lý với payload khác",
  "error": {
    "code": "IDEMPOTENCY-ERR-CONFLICT",
    "type": "IdempotencyConflictError",
    "details": {
      "idempotency_key": "check_in_..."
    }
  },
  "meta": {
    "request_id": "req_...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 21. Error code convention

### 21.1 Format error code

```text
<MODULE>-ERR-<CATEGORY>-<DETAIL>
```

Ví dụ:

```text
AUTH-ERR-UNAUTHENTICATED
AUTH-ERR-FORBIDDEN
AUTH-ERR-SCOPE-DENIED
VALIDATION-ERR-001
HR-ERR-EMPLOYEE-NOT-FOUND
ATT-ERR-LEAVE-APPROVED
LEAVE-ERR-INSUFFICIENT-BALANCE
TASK-ERR-INVALID-STATUS-TRANSITION
NOTI-ERR-TEMPLATE-DISABLED
DASH-ERR-WIDGET-NOT-FOUND
FOUNDATION-ERR-FILE-NOT-FOUND
```

### 21.2 Error type chuẩn

```text
ValidationError
AuthenticationError
TokenExpiredError
ForbiddenError
ScopeDeniedError
NotFoundError
ConflictError
BusinessRuleError
RateLimitError
SystemError
MaintenanceError
```

### 21.3 Error catalog

Backend cần duy trì file:

```text
contracts/error-catalog.md
```

Nội dung:

| Code | Type | HTTP status | Message mặc định | Module | Ghi chú |
| --- | --- | ---: | --- | --- | --- |
| AUTH-ERR-FORBIDDEN | ForbiddenError | 403 | Bạn không có quyền thực hiện thao tác này | AUTH | Guard-level (PermissionGuard) |
| LEAVE-ERR-INSUFFICIENT-BALANCE | BusinessRuleError | 422 | Số ngày phép còn lại không đủ | LEAVE | Submit leave |
| FOUNDATION-ERR-COMPANY-NOT-FOUND | NotFoundError | 404 | Không tìm thấy công ty. | FOUNDATION | company.service |
| FOUNDATION-ERR-COMPANY-SUSPENDED | ForbiddenError | 403 | Công ty đang bị tạm ngưng… | FOUNDATION | Business-rule 403 (service, KHÔNG guard) |
| FOUNDATION-ERR-SETTING-NOT-FOUND | NotFoundError | 404 | system_setting '…' không tồn tại. | FOUNDATION | setting.service |
| FOUNDATION-ERR-SETTING-VALUE-TYPE | ValidationError | 400 | value phải là … | FOUNDATION | Sai value_type (≠422 schema) |
| FOUNDATION-ERR-SETTING-VALUE-TYPE-UNKNOWN | ValidationError | 400 | Không xác định được value_type… | FOUNDATION | Thiếu value_type |
| FOUNDATION-ERR-SETTING-SECRET-STICKY | ValidationError | 400 | Không thể đổi value_type … khỏi SecretRef | FOUNDATION | Sticky secret guard |
| FOUNDATION-ERR-AUDIT-NOT-FOUND | NotFoundError | 404 | Audit log không tồn tại | FOUNDATION | audit.service (RLS-ẩn tenant khác) |
| FOUNDATION-ERR-MODULE-NOT-FOUND | NotFoundError | 404 | Module '…' không tồn tại. | FOUNDATION | module-catalog / toggle |
| FOUNDATION-ERR-MODULE-CORE-LOCKED | BusinessRuleError | 400 | Module lõi … không thể bật/tắt | FOUNDATION | 7 module MVP khoá cứng |
| FOUNDATION-ERR-HOLIDAY-NOT-FOUND | NotFoundError | 404 | Không tìm thấy ngày nghỉ. | FOUNDATION | holidays.service |
| FOUNDATION-ERR-HOLIDAY-DUPLICATE | ConflictError | 409 | Ngày nghỉ trùng (mã + ngày). | FOUNDATION | holidays.service |
| FOUNDATION-ERR-RETENTION-POLICY-NOT-FOUND | NotFoundError | 404 | Không tìm thấy chính sách lưu trữ… | FOUNDATION | retention.service |
| VALIDATION-ERR-001 | ValidationError | 422 | Dữ liệu không hợp lệ | (chung) | validation_schema setting → GIỮ prefix VALIDATION-ERR (web-core kind-match) |

> **Nguồn sự thật catalog FOUNDATION-ERR-*** = `packages/contracts/src/foundation/error-codes.ts`
> (`FOUNDATION_ERROR_CODES`, append-only). Domain file có catalog RIÊNG `FOUNDATION_FILE_ERROR_CODES`
> (`packages/contracts/src/files.ts`). apps/api import LẠI (KHÔNG khai báo bản cục bộ — chống drift).
> **CÒN NỢ (deferred, không phải bug):** `files.service.ts` (23 throw, catalog file) + `sequence.service.ts`
> (2 throw domain-error class) GIỮ mã hiện tại — ngoài phạm vi WO S2-FND-CONTRACT-1; Swagger `/docs` +
> migrate DTO cục bộ (settings/holidays/company) vào contracts = follow-up (cần thêm dep `@nestjs/swagger`
> + lockfile, ngoài paths lane).

---

## 22. Contract cho permission và data scope

### 22.1 Endpoint contract template

Mỗi endpoint trong tài liệu module và Swagger description nên có block:

```text
Required permission: LEAVE.REQUEST.APPROVE
Allowed roles: Manager, HR, Admin công ty
Data scope: Team, Department, Company
Business validation:
- Request phải ở trạng thái Submitted/Pending.
- Actor phải nằm trong approval policy hợp lệ.
- Không duyệt đơn của chính mình nếu policy cấm.
Audit log: LEAVE_REQUEST_APPROVED
Notification event: LEAVE_REQUEST_APPROVED
Idempotency: Required
```

### 22.2 Extension ví dụ

```yaml
x-required-permission: LEAVE.REQUEST.APPROVE
x-data-scope:
  - Team
  - Department
  - Company
x-allowed-roles:
  - Manager
  - HR
  - Admin
x-business-rules:
  - LEAVE_REQUEST_MUST_BE_PENDING
  - APPROVER_MUST_BE_IN_SCOPE
  - SELF_APPROVAL_POLICY_CHECK
```

### 22.3 Permission matrix export

Nên export thêm file để frontend/QA tham khảo:

```text
artifacts/contracts/permission-endpoint-matrix.csv
```

Cột đề xuất:

```text
method,path,operation_id,module,required_permission,data_scopes,allowed_roles,audit_log,notification_events,idempotency_required
```

---

## 23. Contract cho event integration

### 23.1 Event metadata trong OpenAPI

Các endpoint mutation có thể phát event phải khai báo:

```yaml
x-notification-events:
  - LEAVE_REQUEST_SUBMITTED
  - LEAVE_REQUEST_APPROVED
x-domain-events:
  - leave.request.submitted
  - leave.request.approved
```

### 23.2 Event contract file

```text
contracts/events/
  auth.events.md
  hr.events.md
  attendance.events.md
  leave.events.md
  task.events.md
  notification.events.md
  dashboard.events.md
```

Event contract cần mô tả:

1. Event name.
2. Source module.
3. Trigger endpoint/action.
4. Payload schema.
5. Sensitive data policy.
6. Consumer module.
7. Dedupe key.
8. Idempotency behavior.
9. Retry behavior.
10. Audit/system log.

### 23.3 Event payload nguyên tắc

Payload event không chứa dữ liệu nhạy cảm quá mức. Chỉ gửi ID và summary tối thiểu.

Đúng:

```json
{
  "event_name": "LEAVE_REQUEST_APPROVED",
  "company_id": "uuid",
  "actor_user_id": "uuid",
  "leave_request_id": "uuid",
  "employee_id": "uuid",
  "occurred_at": "2026-06-20T10:00:00+07:00"
}
```

Không nên:

```json
{
  "reason": "Nội dung nghỉ có thể nhạy cảm",
  "medical_file_url": "private-url",
  "employee_identity_number": "..."
}
```

---

## 24. Swagger example policy

### 24.1 Example phải an toàn

Swagger examples không được chứa:

1. Email thật của nhân viên.
2. Số điện thoại thật.
3. Số giấy tờ tùy thân thật.
4. Token thật.
5. URL file private thật.
6. Dữ liệu lương/ngân hàng.
7. Secret config.

### 24.2 Example data chuẩn

```json
{
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "work_email": "nguyenvana@example.com",
  "department": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Phòng Kỹ thuật"
  }
}
```

### 24.3 Token example

Không đưa JWT thật. Dùng:

```text
Authorization: Bearer <access_token>
```

---

## 25. Swagger UI cấu hình đề xuất

### 25.1 Swagger UI options

```text
- persistAuthorization: true ở local/dev nếu tiện test
- displayRequestDuration: true
- filter: true
- docExpansion: none
- defaultModelsExpandDepth: 1
- tryItOutEnabled: true ở local/dev/staging
- tryItOutEnabled: false hoặc tắt Swagger ở production nếu policy yêu cầu
```

### 25.2 Bảo vệ Swagger production

Production nên chọn một trong các phương án:

1. Tắt Swagger UI, chỉ publish OpenAPI artifact nội bộ.
2. Bật Swagger nhưng yêu cầu Admin auth.
3. Bật Swagger sau VPN/private network.
4. Bật Swagger read-only, không cho Try it out.
5. Chỉ publish public endpoint, không publish internal endpoint.

---

## 26. Code organization đề xuất

### 26.1 Thư mục contract backend

```text
src/
  common/
    api-contract/
      decorators/
        api-permission.decorator.ts
        api-data-scope.decorator.ts
        api-audit.decorator.ts
        api-events.decorator.ts
        api-idempotency.decorator.ts
      schemas/
        api-meta.schema.ts
        api-pagination.schema.ts
        api-error.schema.ts
      openapi/
        build-openapi.ts
        openapi-config.ts
        openapi-tags.ts
        openapi-security.ts
        openapi-extensions.ts
  modules/
    auth/
      auth.controller.ts
      dto/
      openapi/
        auth.openapi.ts
    hr/
      hr.controller.ts
      dto/
      openapi/
        hr.openapi.ts
    attendance/
      attendance.controller.ts
      dto/
      openapi/
        attendance.openapi.ts
```

### 26.2 Artifact output

```text
dist/
  openapi/
    openapi.public.json
    openapi.internal.json
contracts/
  generated/
    openapi.public.yaml
    endpoint-matrix.csv
    permission-endpoint-matrix.csv
    error-catalog.json
```

---

## 27. Decorator/annotation pattern

Nếu backend framework hỗ trợ decorator/annotation, tạo lớp metadata chung để tránh lặp.

### 27.1 Ví dụ pseudo-code

```ts
@ApiOperation({
  operationId: 'attendanceCheckIn',
  summary: 'Nhân viên check-in',
})
@ApiTags('Attendance - Today')
@ApiBearerAuth()
@ApiRequiredPermission('ATT.ATTENDANCE.CHECK_IN')
@ApiDataScopes(['Own'])
@ApiIdempotencyRequired()
@ApiAuditLog({ action: 'CHECK_IN', entity: 'attendance_records' })
@Post('/check-in')
checkIn(@Body() body: CheckInRequestDto) {
  return this.attendanceService.checkIn(body);
}
```

### 27.2 Decorator cần tự động bổ sung OpenAPI extension

```ts
@ApiRequiredPermission('ATT.ATTENDANCE.CHECK_IN')
```

Phải sinh được:

```yaml
x-required-permission: ATT.ATTENDANCE.CHECK_IN
```

Tương tự:

```text
@ApiDataScopes -> x-data-scope
@ApiAuditLog -> x-audit-log
@ApiNotificationEvents -> x-notification-events
@ApiIdempotencyRequired -> header Idempotency-Key + x-idempotency-required
```

---

## 28. Frontend type generation

### 28.1 Mục tiêu

Frontend có thể chọn sinh type từ OpenAPI để giảm lệch DTO.

Output đề xuất:

```text
frontend/src/generated/api-types.ts
frontend/src/generated/api-client.ts hoặc chỉ types
```

### 28.2 Chiến lược MVP đề xuất

MVP khuyến nghị:

```text
OpenAPI -> generate TypeScript types only
Frontend vẫn tự viết service wrapper/hook theo FRONTEND-04
```

Lý do:

1. Frontend cần custom API client để xử lý token, refresh, request id, idempotency và error mapper.
2. Codegen full client có thể khó custom theo TanStack Query.
3. Types-only vẫn giúp giảm lệch DTO.

### 28.3 Naming codegen cần ổn định

Để codegen ổn định:

1. `operationId` không đổi tùy tiện.
2. Schema name không trùng.
3. Không dùng anonymous inline schema phức tạp quá mức.
4. Shared schema đặt trong `components.schemas`.
5. Enum đặt tên rõ.

### 28.4 Frontend integration flow

```text
Backend update DTO/controller
-> Generate OpenAPI JSON
-> CI validate OpenAPI
-> Generate TypeScript types
-> Frontend update service/hook nếu contract đổi
-> Mock handler update theo schema
-> Contract test/E2E test
```

---

## 29. Mock API strategy

### 29.1 Mục tiêu

Frontend không bị chờ backend hoàn thiện 100% để build UI state.

Mock API phải bám theo OpenAPI:

1. Response success đúng wrapper.
2. Error đúng `ApiErrorResponse`.
3. Pagination đúng schema.
4. Validation error đúng `details`.
5. Permission error đúng 403.
6. Business error đúng 422.

### 29.2 Mock data source

```text
mocks/
  handlers/
    auth.handlers.ts
    hr.handlers.ts
    attendance.handlers.ts
    leave.handlers.ts
    task.handlers.ts
    notification.handlers.ts
    dashboard.handlers.ts
  fixtures/
    employees.fixture.ts
    attendance.fixture.ts
    leave.fixture.ts
```

### 29.3 Mock không được thành nguồn sự thật

Mock chỉ dùng để phát triển UI, không thay thế backend contract. Khi OpenAPI đổi, mock phải đổi theo.

---

## 30. Contract test strategy

### 30.1 Loại contract test

| Loại test | Mục tiêu |
| --- | --- |
| OpenAPI lint | File OpenAPI hợp lệ, không thiếu operationId/tag/security |
| Schema response test | Response runtime khớp schema |
| Error response test | Exception handler trả đúng format |
| Permission metadata test | Endpoint protected có permission/scope metadata |
| Idempotency test | Endpoint quan trọng yêu cầu header và xử lý trùng |
| Breaking change test | So sánh OpenAPI mới với baseline |
| Frontend generated type test | Codegen không lỗi |

### 30.2 Endpoint coverage rule

Mỗi controller endpoint public phải xuất hiện trong OpenAPI.

CI cần fail nếu:

1. Endpoint có route nhưng không có `operationId`.
2. Endpoint protected nhưng thiếu `security`.
3. Endpoint nghiệp vụ nhưng thiếu `x-required-permission`.
4. Endpoint list nhưng thiếu pagination response.
5. Endpoint mutation quan trọng nhưng thiếu idempotency metadata.
6. Endpoint upload nhưng không có multipart schema.
7. Error response không khai báo `ApiErrorResponse`.

### 30.3 Breaking change detection

Breaking change gồm:

1. Xóa endpoint.
2. Đổi method/path.
3. Đổi operationId.
4. Xóa field required khỏi request theo cách không tương thích.
5. Thêm field required vào request.
6. Đổi type field response.
7. Xóa enum value.
8. Đổi status code chính.
9. Đổi security scheme.
10. Đổi response wrapper.

Không phải breaking change:

1. Thêm endpoint mới.
2. Thêm field optional vào response.
3. Thêm filter optional.
4. Thêm enum value nếu frontend xử lý fallback được.
5. Cập nhật description/example.

---

## 31. CI/CD pipeline cho OpenAPI

### 31.1 Pipeline đề xuất

```text
1. Build backend
2. Run unit test
3. Generate OpenAPI public/internal JSON
4. Validate OpenAPI syntax
5. Lint OpenAPI convention
6. Run contract tests
7. Detect breaking changes against main/staging baseline
8. Generate TypeScript types artifact nếu cần
9. Publish Swagger/OpenAPI artifact
10. Attach endpoint matrix vào build artifact
```

### 31.2 Lệnh script đề xuất

```json
{
  "scripts": {
    "openapi:generate": "node scripts/generate-openapi.js",
    "openapi:lint": "spectral lint dist/openapi/openapi.public.json",
    "openapi:types": "openapi-typescript dist/openapi/openapi.public.json -o src/generated/api-types.ts",
    "openapi:diff": "openapi-diff baseline/openapi.public.json dist/openapi/openapi.public.json",
    "contract:test": "npm run test -- --testPathPattern=contract"
  }
}
```

Tên tool có thể thay đổi theo stack thực tế. Quan trọng là pipeline phải có đủ generate, lint, diff và test.

---

## 32. Endpoint matrix artifact

### 32.1 Mục tiêu

Tạo bảng tổng hợp để QA/Frontend kiểm tra nhanh.

File:

```text
artifacts/contracts/endpoint-matrix.csv
```

Cột:

```text
module,tag,method,path,operation_id,auth_required,required_permission,data_scopes,idempotency_required,audit_action,notification_events,internal,deprecated
```

### 32.2 Ví dụ

| module | method | path | operation_id | permission | scope | idempotency |
| --- | --- | --- | --- | --- | --- | --- |
| ATT | POST | `/api/v1/attendance/check-in` | attendanceCheckIn | ATT.ATTENDANCE.CHECK_IN | Own | true |
| LEAVE | POST | `/api/v1/leave/requests/{id}/approve` | leaveApproveRequest | LEAVE.REQUEST.APPROVE | Team,Company | true |
| TASK | POST | `/api/v1/tasks/{id}/change-status` | taskChangeStatus | TASK.TASK.UPDATE_STATUS | Own,Project,Team | true |

---

## 33. OpenAPI review checklist theo endpoint

Mỗi endpoint chỉ được xem là đạt contract khi checklist sau đạt:

| Checklist | Bắt buộc |
| --- | --- |
| Có tag đúng module | Có |
| Có operationId unique | Có |
| Có summary/description rõ | Có |
| Có security scheme nếu protected | Có |
| Có path params schema | Có nếu có path param |
| Có query params schema | Có nếu có query |
| Có request body schema | Có nếu có body |
| Có success response schema | Có |
| Có error response 400/401/403/404/422/500 phù hợp | Có |
| Có pagination schema với list endpoint | Có nếu list |
| Có validation detail schema | Có nếu có validation |
| Có `x-required-permission` | Có với protected business API |
| Có `x-data-scope` | Có với API truy cập dữ liệu |
| Có `x-idempotency-required` | Có với mutation quan trọng |
| Có audit metadata | Có với thao tác quan trọng |
| Có notification event metadata | Có nếu phát event |
| Không expose field nhạy cảm | Có |
| Example data an toàn | Có |

---

## 34. Security checklist cho OpenAPI/Swagger

1. Không publish internal Swagger ra internet public.
2. Không bật Try it out production nếu không có kiểm soát.
3. Không để Swagger chứa token thật trong example.
4. Không để Swagger chứa private file URL thật.
5. Không expose secret setting schema/value.
6. Không expose endpoint debug/admin nếu chưa có auth.
7. Không mô tả chi tiết lỗi bảo mật giúp attacker khai thác.
8. Không trả stack trace trong example response.
9. Không đưa dữ liệu cá nhân thật vào example.
10. Không để endpoint internal thiếu `x-internal: true`.
11. Không để endpoint public thiếu security do quên annotation.
12. Không để CORS/Swagger cho phép origin không kiểm soát ở production.

---

## 35. Versioning và deprecation trong OpenAPI

### 35.1 Version API

MVP dùng:

```text
/api/v1
```

OpenAPI info version dùng:

```text
1.0.0
```

### 35.2 Deprecation

Khi endpoint không còn khuyến nghị dùng:

```yaml
deprecated: true
x-deprecated-reason: "Use /api/v1/tasks/my-tasks instead"
x-removal-target-version: "v2"
```

### 35.3 Không xóa endpoint ngay

Nếu frontend/mobile đang dùng endpoint, không xóa ngay. Cần:

1. Đánh dấu deprecated.
2. Cập nhật migration guide.
3. Thông báo frontend/mobile.
4. Theo dõi usage log.
5. Chỉ xóa ở major version nếu đã thống nhất.

---

## 36. Migration guide khi contract đổi

Mỗi breaking hoặc semi-breaking change phải có file:

```text
contracts/changelog/API_CONTRACT_CHANGELOG.md
```

Format:

```markdown
## 2026-06-20 - v1.0.1

### Added
- GET /api/v1/dashboard/widgets/{widget_slug}

### Changed
- EmployeeDetailDto thêm field optional `avatar_url`.

### Deprecated
- GET /api/v1/tasks/assigned-to-me, dùng GET /api/v1/tasks/my-tasks?type=assigned.

### Breaking
- Không có.
```

Nếu có breaking change:

```markdown
### Breaking
- `LeaveRequestDto.status` đổi enum `PendingApproval` -> `Pending`.
- Frontend cần mapping lại status badge.
```

---

## 37. Definition of Done cho BACKEND-12

BACKEND-12 hoàn thành khi:

1. Có OpenAPI public JSON/YAML cho toàn bộ `/api/v1`.
2. Có OpenAPI internal JSON/YAML cho `/internal/v1` nếu internal API đã triển khai.
3. Có Swagger UI chạy được ở local/dev.
4. Tất cả endpoint có tag, operationId, summary, request/response schema.
5. Tất cả endpoint protected có security scheme.
6. Tất cả endpoint nghiệp vụ có `x-required-permission` và `x-data-scope`.
7. Tất cả response success/error/list dùng wrapper chuẩn.
8. Tất cả list endpoint có pagination schema.
9. Tất cả validation error dùng `ValidationErrorResponse`.
10. Tất cả endpoint mutation quan trọng có idempotency metadata.
11. Tất cả endpoint upload có multipart schema.
12. Có error catalog module-level.
13. Có endpoint matrix export.
14. Có permission-endpoint matrix export.
15. Có contract test tối thiểu cho response wrapper, error wrapper và permission metadata.
16. Có OpenAPI lint trong CI.
17. Có breaking change detection hoặc ít nhất checklist review thủ công trước merge.
18. Có hướng dẫn frontend generate TypeScript types hoặc đồng bộ DTO.
19. Có security review cho Swagger production.
20. Không còn endpoint public quan trọng bị thiếu trong Swagger.

---

## 38. Kế hoạch triển khai theo giai đoạn

### Giai đoạn 1: Chuẩn hóa shared schema

1. Tạo schema chuẩn cho `ApiMeta`, `ApiPagination`, `ApiSuccessBase`, `ApiErrorResponse`, `ValidationErrorResponse`.
2. Tạo convention đặt tên DTO/schema.
3. Tạo error catalog ban đầu.
4. Tạo tag registry toàn hệ thống.
5. Tạo security schemes.

### Giai đoạn 2: Gắn metadata endpoint

1. Gắn operationId cho toàn bộ controller.
2. Gắn tag theo module.
3. Gắn permission/data scope metadata.
4. Gắn audit/event/idempotency metadata.
5. Gắn request/response schema cho từng endpoint.

### Giai đoạn 3: Generate Swagger/OpenAPI

1. Generate public OpenAPI.
2. Generate internal OpenAPI.
3. Tách route Swagger UI theo môi trường.
4. Export JSON/YAML artifact.
5. Export endpoint matrix.

### Giai đoạn 4: Frontend integration

1. Chạy thử TypeScript type generation.
2. Mapping generated type với FRONTEND-04 API client.
3. Cập nhật mock handler theo OpenAPI.
4. Chốt open questions: Bearer token hay cookie auth, pagination placement, validation nested path, upload strategy.

### Giai đoạn 5: QA và CI

1. Thêm OpenAPI lint.
2. Thêm contract test response wrapper.
3. Thêm test endpoint protected thiếu permission metadata.
4. Thêm diff OpenAPI với baseline.
5. Chốt security checklist production Swagger.

---

## 39. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| BE12-OQ-001 | Backend MVP dùng Bearer token trong header hay HttpOnly cookie là cơ chế chính? | BE Lead / FE Lead | Cao |
| BE12-OQ-002 | Swagger production sẽ tắt, bật sau auth, hay chỉ publish nội bộ? | BE Lead / DevOps / Security | Cao |
| BE12-OQ-003 | OpenAPI sẽ generate từ code-first hay duy trì spec-first? | BE Lead | Cao |
| BE12-OQ-004 | Frontend có dùng codegen types-only từ OpenAPI không? | FE Lead / BE Lead | Trung bình |
| BE12-OQ-005 | API list giữ `pagination` ở root hay đưa vào `meta.pagination` trong implementation thật? | BE Lead / FE Lead | Cao |
| BE12-OQ-006 | Validation field path có chuẩn nested như `items.0.name` không? | BE/FE/QA | Trung bình |
| BE12-OQ-007 | File upload MVP dùng single-step multipart hay presigned URL? | BE/DevOps/FE | Trung bình |
| BE12-OQ-008 | Internal API Swagger có publish riêng không? | BE/DevOps | Trung bình |
| BE12-OQ-009 | Có cần OpenAPI diff tự động chặn merge ngay trong MVP không? | BE Lead | Trung bình |
| BE12-OQ-010 | Error message có cần dictionary đa ngôn ngữ từ backend hay frontend map copy? | Product/UX/BE/FE | Trung bình |

---

## 40. Kết luận

BACKEND-12 chốt lớp hợp đồng tích hợp API cho toàn bộ hệ thống.

Tư duy triển khai quan trọng nhất:

```text
API không chỉ là controller chạy được.
API phải có contract rõ, test được, generate được docs, bảo vệ được quyền, và frontend/QA có thể tích hợp mà không đoán.
```

Sau BACKEND-12, đội dự án có thể chuyển sang:

```text
BACKEND-13: Backend Testing, Security & Performance
```

Trọng tâm tiếp theo là kiểm thử tích hợp, security review, performance test và regression test (BACKEND-13); release checklist và chuẩn bị môi trường triển khai MVP nằm ở BACKEND-14 (Backend Release Readiness).
