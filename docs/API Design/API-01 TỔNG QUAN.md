# API-01: API DESIGN TỔNG QUAN

**HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> **API-01 Tổng quan** · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-01 Tổng quan](<../SPEC/SPEC-01 Tổng quan.md>) · [Thiết kế DB: DB-01 Tổng quan](<../DB/DB-01 DATABASE DESIGN TỔNG QUAN.md>) · [Sản phẩm: PRD-00](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường         | Nội dung                                 |
| -------------- | ---------------------------------------- |
| Mã tài liệu    | API-01                                   |
| Tên tài liệu   | API Design Tổng quan                     |
| Tên dự án      | Hệ thống quản lý doanh nghiệp nội bộ     |
| Tên sản phẩm   | Enterprise Management System             |
| Phiên bản      | v1.0                                     |
| Trạng thái     | Draft                                    |
| Giai đoạn      | MVP Version 1.0                          |
| Tài liệu nguồn | PRD-00, SPEC-01 → SPEC-08, DB-01 → DB-10 |
| Ngày tạo       | 20/06/2026                               |
| Ngày cập nhật  | 20/06/2026                               |

---

## 2. Mục đích tài liệu

Tài liệu này định nghĩa toàn bộ quy chuẩn API dùng chung cho hệ thống quản lý doanh nghiệp nội bộ.

API-01 là tài liệu nền tảng để viết tiếp các tài liệu API chi tiết:

| Mã tài liệu | Tên tài liệu          |
| ----------- | --------------------- |
| API-01      | API Design Tổng quan  |
| API-02      | AUTH API Design       |
| API-03      | HR API Design         |
| API-04      | ATT API Design        |
| API-05      | LEAVE API Design      |
| API-06      | TASK API Design       |
| API-07      | NOTI API Design       |
| API-08      | DASH API Design       |
| API-09      | FOUNDATION API Design |

API-01 không đi sâu vào từng endpoint nghiệp vụ cụ thể. Các endpoint cụ thể sẽ được mô tả trong API-02 đến API-09. Tuy nhiên, mọi tài liệu API module bắt buộc tuân thủ các chuẩn chung trong API-01.

---

## 3. Nguyên tắc thiết kế API tổng thể

### 3.1 Backend là nguồn kiểm soát quyền cuối cùng

Frontend có thể dùng permission để ẩn hoặc hiện menu, button, tab, widget. Tuy nhiên frontend không được xem là lớp bảo mật chính.

Backend bắt buộc kiểm tra:

1. User đã đăng nhập hay chưa.
2. Access token có hợp lệ không.
3. User có trạng thái hợp lệ không.
4. Company/tenant có đang active không.
5. User có permission cần thiết không.
6. Permission có data scope phù hợp không.
7. Dữ liệu target có nằm trong scope được phép không.
8. Business rule có cho phép thao tác không.
9. Thao tác có cần ghi audit log không.
10. Thao tác có cần phát notification event không.

---

### 3.2 API phải thiết kế theo module

Mỗi module có nhóm API riêng:

```text
/api/v1/auth
/api/v1/hr
/api/v1/attendance
/api/v1/leave
/api/v1/tasks
/api/v1/notifications
/api/v1/dashboard
/api/v1/foundation
```

Trong đó:

| Module     | Prefix đề xuất                          |
| ---------- | --------------------------------------- |
| AUTH       | `/api/v1/auth`                          |
| HR         | `/api/v1/hr`                            |
| ATT        | `/api/v1/attendance`                    |
| LEAVE      | `/api/v1/leave`                         |
| TASK       | `/api/v1/tasks` hoặc `/api/v1/projects` |
| NOTI       | `/api/v1/notifications`                 |
| DASH       | `/api/v1/dashboard`                     |
| FOUNDATION | `/api/v1/foundation`                    |

---

### 3.3 API phải stateless

Mỗi request API phải tự mang đủ thông tin xác thực qua access token.

Backend không được phụ thuộc vào state frontend để xác định:

1. User hiện tại.
2. Role hiện tại.
3. Company hiện tại.
4. Permission hiện tại.
5. Data scope hiện tại.
6. Employee hiện tại.

Các thông tin này phải được backend resolve từ token/session và database/cache nội bộ.

---

### 3.4 API phải multi-tenant ready

Hệ thống MVP có thể chỉ dùng cho một công ty, nhưng API phải thiết kế sẵn cho multi-tenant/SaaS.

Nguyên tắc:

1. `company_id` được resolve từ auth context.
2. Frontend không được tự truyền `company_id` trong body cho nghiệp vụ thông thường.
3. Query backend luôn filter theo `company_id`.
4. Super Admin có scope `System` mới được truy vấn liên công ty.
5. API cross-company phải được tách riêng và kiểm soát chặt.

---

### 3.5 API phải có khả năng truy vết

Mỗi request quan trọng nên có:

1. `request_id`.
2. `correlation_id`.
3. Actor user.
4. Company.
5. Module.
6. Action.
7. Target entity.
8. IP.
9. User agent.
10. Device/client info nếu có.

Các API thay đổi dữ liệu quan trọng phải ghi audit log.

---

## 4. Base URL

### 4.1 Base URL môi trường

| Môi trường  | Base URL đề xuất                         |
| ----------- | ---------------------------------------- |
| Local       | `http://localhost:3000/api/v1`           |
| Development | `https://dev-api.example.com/api/v1`     |
| Staging     | `https://staging-api.example.com/api/v1` |
| Production  | `https://api.example.com/api/v1`         |

Tên domain thực tế sẽ được chốt khi triển khai hạ tầng.

---

### 4.2 Quy ước API prefix

Tất cả API public cho frontend/mobile app phải đi qua prefix:

```text
/api/v1
```

Ví dụ:

```http
GET /api/v1/auth/me
GET /api/v1/hr/employees
POST /api/v1/attendance/check-in
POST /api/v1/leave/requests
GET /api/v1/tasks/my-tasks
GET /api/v1/notifications
GET /api/v1/dashboard/me
```

---

### 4.3 Không expose internal API ra public

Các API nội bộ giữa service/job/module nếu có nên dùng prefix riêng:

```text
/internal/v1
```

Ví dụ:

```http
POST /internal/v1/notifications/events
POST /internal/v1/dashboard/cache/invalidate
POST /internal/v1/attendance/recalculate
```

Internal API không được gọi trực tiếp từ frontend.

---

## 5. Versioning

### 5.1 Version mặc định

MVP sử dụng version:

```text
/api/v1
```

### 5.2 Quy tắc nâng version

Chỉ tăng major API version khi có breaking change.

Ví dụ breaking change:

1. Đổi cấu trúc response chính.
2. Đổi tên field quan trọng.
3. Xóa endpoint cũ.
4. Đổi ý nghĩa status.
5. Đổi cách xác thực.
6. Đổi logic phân quyền khiến client cũ không hoạt động.

Khi đó tạo:

```text
/api/v2
```

### 5.3 Thay đổi không cần tăng version

Không cần tăng version nếu:

1. Thêm field mới vào response.
2. Thêm filter mới.
3. Thêm endpoint mới.
4. Thêm enum value mới nhưng không làm client cũ lỗi.
5. Tối ưu performance.
6. Thêm metadata không bắt buộc.

---

## 6. Authentication

### 6.1 Cơ chế xác thực

MVP sử dụng:

```text
Access Token + Refresh Token
```

Access token dùng để gọi API. Refresh token dùng để lấy access token mới khi access token hết hạn.

---

### 6.2 Header xác thực

Client gửi access token qua header:

```http
Authorization: Bearer <access_token>
```

Ví dụ:

```http
GET /api/v1/auth/me
Authorization: Bearer eyJhbGciOi...
```

---

### 6.3 Access token

Access token nên chứa tối thiểu:

| Claim        | Ý nghĩa             |
| ------------ | ------------------- |
| `sub`        | User ID             |
| `company_id` | Company hiện tại    |
| `session_id` | Session hiện tại    |
| `token_type` | `access`            |
| `iat`        | Thời điểm phát hành |
| `exp`        | Thời điểm hết hạn   |

Không nên nhét toàn bộ permission vào access token nếu permission có thể thay đổi thường xuyên. Backend có thể cache permission ngắn hạn nhưng phải có cơ chế invalidate khi role/permission thay đổi.

---

### 6.4 Refresh token

Refresh token dùng để xin access token mới.

Quy tắc:

1. Refresh token có thời hạn dài hơn access token.
2. Refresh token nên lưu hash trong database.
3. Refresh token có thể bị revoke khi logout.
4. Refresh token bị revoke khi user bị khóa.
5. Refresh token nên rotate sau mỗi lần refresh nếu triển khai bảo mật tốt.
6. Refresh token không được gửi vào response ở API không liên quan auth.

---

### 6.5 Thời hạn token đề xuất

| Token                | Thời hạn đề xuất MVP |
| -------------------- | -------------------- |
| Access token         | 15 phút đến 60 phút  |
| Refresh token        | 7 ngày đến 30 ngày   |
| Password reset token | 15 phút đến 60 phút  |

Thời hạn thực tế có thể cấu hình trong system/company settings.

---

### 6.6 API không cần đăng nhập

Các API sau có thể không cần access token:

```http
POST /api/v1/auth/login
POST /api/v1/auth/refresh-token
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password
GET  /api/v1/health
```

Tất cả API nghiệp vụ còn lại mặc định yêu cầu đăng nhập.

---

## 7. Authorization

### 7.1 Kiểm tra permission

Mỗi API phải khai báo permission bắt buộc.

Ví dụ:

```text
GET /api/v1/hr/employees
Required permission: HR.EMPLOYEE.VIEW

POST /api/v1/hr/employees
Required permission: HR.EMPLOYEE.CREATE

POST /api/v1/leave/requests/{id}/approve
Required permission: LEAVE.REQUEST.APPROVE
```

Nếu user không có permission, backend trả:

```http
403 Forbidden
```

---

### 7.2 Data scope

Data scope là phạm vi dữ liệu mà user được thao tác.

Các scope chuẩn:

| Scope        | Ý nghĩa                                   |
| ------------ | ----------------------------------------- |
| `Own`        | Chỉ dữ liệu của chính user/employee       |
| `Team`       | Dữ liệu nhân viên thuộc team mình quản lý |
| `Department` | Dữ liệu thuộc phòng ban                   |
| `Project`    | Dữ liệu thuộc project có liên quan        |
| `Company`    | Dữ liệu toàn công ty                      |
| `System`     | Dữ liệu toàn hệ thống                     |

---

### 7.3 Quy tắc áp dụng data scope

Backend không chỉ kiểm tra user có permission, mà còn phải kiểm tra target data có nằm trong scope hay không.

Ví dụ:

```text
Manager có LEAVE.REQUEST.APPROVE scope Team
→ Chỉ duyệt được đơn nghỉ của nhân viên thuộc team mình.

HR có LEAVE.REQUEST.APPROVE scope Company
→ Duyệt được đơn nghỉ toàn công ty nếu policy cho phép.

Employee có HR.EMPLOYEE.VIEW scope Own
→ Chỉ xem được hồ sơ của chính mình.
```

---

### 7.4 Permission + scope là bắt buộc cho API dữ liệu

Mỗi API trong API-02 → API-09 phải có phần:

```text
Required permission
Allowed roles
Data scope
Business validation
Audit log
Notification event nếu có
```

Không được mô tả endpoint chỉ bằng URL và request/response.

---

### 7.5 Allowed roles chỉ là mô tả nghiệp vụ

`Allowed roles` giúp người đọc hiểu vai trò nào thường được dùng API. Tuy nhiên backend không nên hard-code theo role nếu hệ thống đã có permission.

Đúng:

```text
Backend kiểm tra permission + scope.
Role chỉ là nhóm quyền được seed sẵn.
```

Không nên:

```text
Nếu role = HR thì cho phép, nếu role khác thì chặn.
```

Ngoại lệ chỉ áp dụng với một số role hệ thống đặc biệt như `Super Admin`.

---

## 8. Chuẩn HTTP method

| Method    | Mục đích                                |
| --------- | --------------------------------------- |
| `GET`     | Lấy dữ liệu, không thay đổi dữ liệu     |
| `POST`    | Tạo mới hoặc thực hiện action nghiệp vụ |
| `PUT`     | Thay thế toàn bộ resource               |
| `PATCH`   | Cập nhật một phần resource              |
| `DELETE`  | Xóa mềm hoặc hủy liên kết               |
| `OPTIONS` | Preflight/CORS nếu cần                  |

Ví dụ:

```http
GET    /api/v1/hr/employees
POST   /api/v1/hr/employees
GET    /api/v1/hr/employees/{id}
PATCH  /api/v1/hr/employees/{id}
DELETE /api/v1/hr/employees/{id}
```

Với action nghiệp vụ, dùng `POST`:

```http
POST /api/v1/leave/requests/{id}/submit
POST /api/v1/leave/requests/{id}/approve
POST /api/v1/leave/requests/{id}/reject
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
POST /api/v1/tasks/{id}/change-status
```

---

## 9. Chuẩn đặt tên endpoint

### 9.1 Dùng danh từ số nhiều cho resource

Đúng:

```http
GET /api/v1/hr/employees
GET /api/v1/leave/requests
GET /api/v1/tasks/projects
```

Không nên:

```http
GET /api/v1/hr/getEmployeeList
POST /api/v1/leave/createRequest
```

---

### 9.2 Dùng kebab-case cho path action

Ví dụ:

```http
POST /api/v1/auth/refresh-token
POST /api/v1/leave/requests/{id}/cancel
POST /api/v1/attendance/adjustment-requests/{id}/approve
GET  /api/v1/dashboard/my-widgets
```

---

### 9.3 ID resource dùng UUID

Ví dụ:

```http
GET /api/v1/hr/employees/550e8400-e29b-41d4-a716-446655440000
```

Nếu ID sai format, trả lỗi validation:

```http
400 Bad Request
```

---

## 10. Chuẩn request header

### 10.1 Header chung

| Header             |                 Bắt buộc | Mô tả                     |
| ------------------ | -----------------------: | ------------------------- |
| `Authorization`    | Có với API cần đăng nhập | Bearer access token       |
| `Content-Type`     |         Có với body JSON | `application/json`        |
| `Accept`           |                   Nên có | `application/json`        |
| `X-Request-Id`     |                   Nên có | ID request từ client      |
| `X-Client-Type`    |                   Nên có | `web`, `mobile`, `system` |
| `X-Client-Version` |                   Nên có | Version app               |
| `Idempotency-Key`  |    Có với API quan trọng | Chống xử lý trùng         |

---

### 10.2 Ví dụ header

```http
POST /api/v1/attendance/check-in
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
X-Request-Id: req_20260620_000001
X-Client-Type: web
X-Client-Version: 1.0.0
Idempotency-Key: 1a8b8e7b-8d4a-4d6c-9f8b-22f7e2d11111
```

---

## 11. Chuẩn response thành công

### 11.1 Response thành công cho object

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

---

### 11.2 Response thành công cho list

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Nguyễn Văn A"
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
    "request_id": "req_20260620_000002",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.3 Response thành công không có data

```json
{
  "success": true,
  "message": "Thao tác thành công",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.4 Quy tắc response thành công

1. Luôn có `success`.
2. Luôn có `message`.
3. Luôn có `data`, kể cả khi null.
4. Luôn có `meta.request_id`.
5. Thời gian trả về dùng ISO 8601.
6. API list phải có `pagination` nếu phân trang.
7. Không trả dữ liệu nhạy cảm nếu user thiếu quyền.
8. Không trả `password_hash`, `refresh_token_hash`, storage path file private hoặc secret setting.

---

## 12. Chuẩn response lỗi

### 12.1 Response lỗi chung

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
    "request_id": "req_20260620_000004",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 12.2 Response lỗi validation

```json
{
  "success": false,
  "message": "Dữ liệu không hợp lệ",
  "error": {
    "code": "VALIDATION-ERR-001",
    "type": "ValidationError",
    "details": [
      {
        "field": "email",
        "message": "Email không đúng định dạng",
        "rule": "email"
      },
      {
        "field": "password",
        "message": "Mật khẩu là bắt buộc",
        "rule": "required"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000005",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 12.3 Response lỗi business rule

```json
{
  "success": false,
  "message": "Không thể chấm công vì bạn đã có đơn nghỉ phép được duyệt trong ngày hôm nay",
  "error": {
    "code": "ATT-ERR-LEAVE-APPROVED",
    "type": "BusinessRuleError",
    "details": {
      "work_date": "2026-06-20",
      "leave_request_id": "550e8400-e29b-41d4-a716-446655440000"
    }
  },
  "meta": {
    "request_id": "req_20260620_000006",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 13. Quy ước mã lỗi

### 13.1 Format mã lỗi

```text
MODULE-ERR-CODE
```

Ví dụ:

```text
AUTH-ERR-001
HR-ERR-001
ATT-ERR-001
LEAVE-ERR-001
TASK-ERR-001
NOTI-ERR-001
DASH-ERR-001
FOUNDATION-ERR-001
VALIDATION-ERR-001
SYSTEM-ERR-001
```

---

### 13.2 Nhóm lỗi dùng chung

| Mã lỗi                     | HTTP status | Ý nghĩa                                |
| -------------------------- | ----------: | -------------------------------------- |
| `AUTH-ERR-UNAUTHENTICATED` |         401 | Chưa đăng nhập hoặc token không hợp lệ |
| `AUTH-ERR-TOKEN-EXPIRED`   |         401 | Access token hết hạn                   |
| `AUTH-ERR-FORBIDDEN`       |         403 | Không có quyền                         |
| `AUTH-ERR-SCOPE-DENIED`    |         403 | Không nằm trong data scope             |
| `VALIDATION-ERR-001`       |         400 | Dữ liệu không hợp lệ                   |
| `RESOURCE-ERR-NOT-FOUND`   |         404 | Không tìm thấy dữ liệu                 |
| `RESOURCE-ERR-CONFLICT`    |         409 | Xung đột dữ liệu                       |
| `BUSINESS-ERR-001`         |         422 | Vi phạm rule nghiệp vụ                 |
| `RATE-LIMIT-ERR-001`       |         429 | Gọi API quá nhiều                      |
| `SYSTEM-ERR-001`           |         500 | Lỗi hệ thống                           |
| `SYSTEM-ERR-MAINTENANCE`   |         503 | Hệ thống bảo trì                       |

---

## 14. Quy ước HTTP status code

|                      Status | Dùng khi                                          |
| --------------------------: | ------------------------------------------------- |
|                    `200 OK` | Lấy dữ liệu/cập nhật/action thành công            |
|               `201 Created` | Tạo mới resource thành công                       |
|              `202 Accepted` | Request được nhận và xử lý bất đồng bộ            |
|            `204 No Content` | Xóa mềm/hủy liên kết thành công và không cần body |
|           `400 Bad Request` | Request sai format hoặc validation lỗi            |
|          `401 Unauthorized` | Chưa xác thực/token sai/token hết hạn             |
|             `403 Forbidden` | Đã xác thực nhưng không có quyền/scope            |
|             `404 Not Found` | Resource không tồn tại hoặc user không được thấy  |
|              `409 Conflict` | Xung đột trạng thái/trùng dữ liệu                 |
|  `422 Unprocessable Entity` | Dữ liệu đúng format nhưng sai business rule       |
|     `429 Too Many Requests` | Rate limit                                        |
| `500 Internal Server Error` | Lỗi hệ thống                                      |
|   `503 Service Unavailable` | Service tạm thời không sẵn sàng                   |

---

## 15. Validation error

### 15.1 Nguyên tắc validation

Backend phải validate:

1. Required field.
2. Data type.
3. Format.
4. Enum.
5. Range.
6. Length.
7. UUID format.
8. Date range.
9. File type.
10. File size.
11. Business rule.
12. Permission/scope.

Frontend validate để tăng trải nghiệm, nhưng backend vẫn phải validate lại.

---

### 15.2 Validation field format

Mỗi lỗi field gồm:

| Field     | Ý nghĩa                    |
| --------- | -------------------------- |
| `field`   | Tên field lỗi              |
| `message` | Thông báo lỗi              |
| `rule`    | Rule bị vi phạm            |
| `value`   | Có thể bỏ qua nếu nhạy cảm |

Không trả lại password, token, file private path hoặc dữ liệu nhạy cảm trong validation details.

---

## 16. Pagination

### 16.1 Offset pagination mặc định

API list trong MVP dùng offset pagination:

```http
GET /api/v1/hr/employees?page=1&per_page=20
```

Query params:

| Param      | Mặc định |   Giới hạn |
| ---------- | -------: | ---------: |
| `page`     |        1 |       >= 1 |
| `per_page` |       20 | tối đa 100 |

Response:

```json
"pagination": {
  "page": 1,
  "per_page": 20,
  "total": 100,
  "total_pages": 5,
  "has_next": true,
  "has_prev": false
}
```

---

### 16.2 Cursor pagination cho dữ liệu lớn

Các bảng log hoặc notification có thể dùng cursor pagination:

```http
GET /api/v1/notifications?cursor=eyJjcmVhdGVkX2F0Ijoi...&limit=20
```

Dùng cho:

1. Notifications.
2. Audit logs.
3. Attendance logs.
4. File access logs.
5. Activity logs.
6. Infinite scroll.

Response:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "limit": 20,
    "next_cursor": "eyJjcmVhdGVkX2F0Ijoi...",
    "has_next": true
  }
}
```

---

## 17. Search, filter, sort

### 17.1 Search

Dùng query param:

```http
GET /api/v1/hr/employees?search=nguyen
```

Search áp dụng cho các field được module cho phép, ví dụ:

| Module | Field search                           |
| ------ | -------------------------------------- |
| HR     | employee code, full name, email, phone |
| TASK   | task code, title, description          |
| LEAVE  | request code, employee name            |
| ATT    | employee code, employee name           |
| NOTI   | title, message                         |
| AUDIT  | actor, action, entity code             |

---

### 17.2 Filter

Dùng query params rõ nghĩa:

```http
GET /api/v1/hr/employees?department_id=...&status=Official
GET /api/v1/leave/requests?status=Pending&from_date=2026-06-01&to_date=2026-06-30
GET /api/v1/tasks?status=InProgress&priority=High
```

Không dùng một chuỗi filter khó parse nếu chưa cần:

```http
filter=status:eq:Pending,priority:eq:High
```

MVP ưu tiên query params đơn giản.

---

### 17.3 Sort

Dùng:

```http
GET /api/v1/hr/employees?sort=created_at:desc
GET /api/v1/tasks?sort=due_at:asc
```

Quy tắc:

1. Chỉ cho sort theo field whitelist.
2. Mặc định sort theo `created_at:desc` hoặc logic nghiệp vụ.
3. Không cho sort tùy ý theo field không index nếu bảng lớn.
4. Nếu sort field không hợp lệ, trả validation error.

---

## 18. Upload file

### 18.1 Nguyên tắc upload file

File upload dùng chung qua FOUNDATION API hoặc endpoint module gọi file service nội bộ.

Các module dùng file:

1. HR: hồ sơ nhân viên, hợp đồng.
2. ATT: ảnh/bằng chứng điều chỉnh công, remote.
3. LEAVE: file chứng minh nghỉ phép.
4. TASK: file task, project.
5. FOUNDATION: logo công ty, file dùng chung.

---

### 18.2 File private là mặc định

Mọi file upload mặc định là private.

Frontend không được nhận storage path thật.

Backend chỉ trả:

1. `file_id`.
2. `file_name`.
3. `mime_type`.
4. `size`.
5. `download_url` ngắn hạn nếu user có quyền.
6. `expires_at` của signed URL nếu có.

---

### 18.3 Upload flow đề xuất MVP

#### Cách 1: Upload trực tiếp qua backend

```http
POST /api/v1/foundation/files
Content-Type: multipart/form-data
```

Request:

| Field         | Bắt buộc | Mô tả                 |
| ------------- | -------: | --------------------- |
| `file`        |       Có | File upload           |
| `module_code` |       Có | Module sử dụng        |
| `entity_type` |    Không | Loại entity muốn link |
| `entity_id`   |    Không | ID entity muốn link   |
| `purpose`     |    Không | Mục đích file         |

Response:

```json
{
  "success": true,
  "message": "Upload file thành công",
  "data": {
    "file_id": "550e8400-e29b-41d4-a716-446655440000",
    "file_name": "contract.pdf",
    "mime_type": "application/pdf",
    "size": 204800,
    "visibility": "Private"
  }
}
```

---

### 18.4 Kiểm tra file

Backend phải kiểm tra:

1. User đã đăng nhập.
2. User có quyền upload file vào module/entity.
3. File size không vượt giới hạn.
4. MIME type nằm trong whitelist.
5. Extension phù hợp MIME type.
6. File không rỗng.
7. File không chứa virus nếu có scanner.
8. Entity target tồn tại nếu upload kèm link.
9. Entity target cùng company.
10. User có data scope với entity target.

---

### 18.5 Download file

```http
GET /api/v1/foundation/files/{file_id}/download-url
```

Backend kiểm tra quyền với module gốc trước khi cấp link tải.

Nếu file nhạy cảm, ghi `file_access_logs`.

---

## 19. Audit log trigger

### 19.1 Khi nào bắt buộc ghi audit log

Bắt buộc ghi audit log với các thao tác:

1. Đăng nhập thất bại nhiều lần.
2. Tạo/cập nhật/khóa/mở user.
3. Gán/gỡ role.
4. Cập nhật permission.
5. Tạo/cập nhật/xóa mềm employee.
6. Xem/xuất dữ liệu nhạy cảm nếu cấu hình yêu cầu.
7. Upload/xóa/tải file nhạy cảm.
8. Check-in/check-out nếu công ty bật audit chi tiết.
9. Điều chỉnh công.
10. Duyệt/từ chối điều chỉnh công.
11. Tạo/gửi/duyệt/từ chối/hủy đơn nghỉ.
12. Điều chỉnh số dư phép.
13. Tạo/cập nhật/xóa project/task quan trọng.
14. Export dữ liệu.
15. Cập nhật system/company settings.
16. Cập nhật notification template/rule.
17. Cập nhật dashboard widget config.

---

### 19.2 Nội dung audit log tối thiểu

| Field            | Ý nghĩa                           |
| ---------------- | --------------------------------- |
| `request_id`     | ID request                        |
| `correlation_id` | ID liên kết nhiều action          |
| `company_id`     | Công ty                           |
| `module_code`    | Module                            |
| `action`         | Hành động                         |
| `entity_type`    | Loại entity                       |
| `entity_id`      | ID entity                         |
| `actor_user_id`  | User thao tác                     |
| `old_values`     | Giá trị cũ, đã mask nếu nhạy cảm  |
| `new_values`     | Giá trị mới, đã mask nếu nhạy cảm |
| `ip_address`     | IP                                |
| `user_agent`     | User agent                        |
| `created_at`     | Thời điểm ghi log                 |

---

### 19.3 Không ghi dữ liệu nhạy cảm nguyên bản

Audit log phải mask hoặc loại bỏ:

1. Password.
2. Token.
3. Refresh token.
4. Số giấy tờ tùy thân.
5. Số tài khoản ngân hàng.
6. Lương.
7. Secret setting.
8. Storage path file private.
9. URL signed đầy đủ.
10. Dữ liệu sức khỏe hoặc lý do nghỉ quá nhạy cảm nếu có.

---

## 20. Notification event trigger

### 20.1 Nguyên tắc phát event

Module nghiệp vụ phát event khi có sự kiện quan trọng. NOTI xử lý tạo thông báo.

Module nghiệp vụ không nên tự insert trực tiếp notification nếu đã có notification service/event handler.

---

### 20.2 Event payload chuẩn

```json
{
  "event_code": "LEAVE_REQUEST_SUBMITTED",
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "actor_user_id": "550e8400-e29b-41d4-a716-446655440001",
  "source_module": "LEAVE",
  "entity_type": "LeaveRequest",
  "entity_id": "550e8400-e29b-41d4-a716-446655440002",
  "dedupe_key": "LEAVE_REQUEST_SUBMITTED:550e8400-e29b-41d4-a716-446655440002",
  "payload": {
    "target_module": "LEAVE",
    "target_type": "LeaveRequest",
    "target_id": "550e8400-e29b-41d4-a716-446655440002",
    "display_code": "LR-2026-0001"
  }
}
```

---

### 20.3 Các event MVP quan trọng

| Module     | Event                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH       | `USER_CREATED`, `USER_LOCKED`, `PASSWORD_RESET_REQUESTED`                                                                                                                             |
| HR         | `EMPLOYEE_CREATED`, `HR_PROFILE_CHANGE_SUBMITTED`, `HR_PROFILE_CHANGE_APPROVED`, `HR_PROFILE_CHANGE_REJECTED`, `CONTRACT_EXPIRING_SOON`                                |
| ATT        | `ATT_ADJUSTMENT_SUBMITTED`, `ATT_ADJUSTMENT_APPROVED`, `ATT_ADJUSTMENT_REJECTED`, `ATT_MISSING_CHECKOUT` (NOTI); `attendance.checked_in`, `attendance.checked_out` (sự kiện domain/cache nội bộ, không phải NOTI notification) |
| LEAVE      | `LEAVE_REQUEST_SUBMITTED`, `LEAVE_REQUEST_APPROVED`, `LEAVE_REQUEST_REJECTED`, `LEAVE_REQUEST_CANCELLED`, `LEAVE_BALANCE_ADJUSTED`                                                    |
| TASK       | `TASK_ASSIGNED`, `TASK_STATUS_CHANGED`, `TASK_COMMENT_CREATED`, `TASK_MENTIONED`, `TASK_DUE_SOON`, `TASK_OVERDUE`                                                                     |
| DASH       | `DASHBOARD_CACHE_INVALIDATED`                                                                                                                                                         |
| FOUNDATION | `FILE_UPLOADED`, `SETTING_UPDATED`                                                                                                                                                    |

---

### 20.4 Notification payload không chứa dữ liệu nhạy cảm

Notification payload chỉ chứa dữ liệu điều hướng và tóm tắt an toàn.

Không lưu:

1. CCCD/CMND.
2. Số tài khoản ngân hàng.
3. Lương.
4. Token.
5. Private file URL.
6. Lý do nghỉ nhạy cảm đầy đủ.
7. GPS/IP chi tiết.

Khi user bấm notification, API module gốc phải kiểm tra quyền lại trước khi trả chi tiết.

---

## 21. Idempotency

### 21.1 Mục đích

Idempotency giúp tránh xử lý trùng khi user bấm nhiều lần, mạng retry hoặc mobile gửi lại request.

Bắt buộc áp dụng cho API quan trọng:

1. Login nếu cần chống tạo session trùng bất thường.
2. Refresh token.
3. Check-in.
4. Check-out.
5. Gửi yêu cầu điều chỉnh công.
6. Duyệt/từ chối điều chỉnh công.
7. Tạo đơn nghỉ.
8. Gửi đơn nghỉ.
9. Duyệt/từ chối đơn nghỉ.
10. Tạo task.
11. Giao task.
12. Upload file.
13. Export file.
14. Payment/payroll phase sau nếu có.

---

### 21.2 Header idempotency

Client gửi:

```http
Idempotency-Key: <uuid>
```

Backend lưu theo:

```text
company_id + user_id + method + path + idempotency_key
```

---

### 21.3 Quy tắc xử lý

1. Nếu request đầu tiên thành công, backend lưu response summary.
2. Nếu request trùng key và body giống nhau, trả lại kết quả cũ hoặc trạng thái đã xử lý.
3. Nếu request trùng key nhưng body khác nhau, trả `409 Conflict`.
4. Idempotency key có TTL, ví dụ 24 giờ.
5. Với action cần transaction, idempotency record phải được tạo trong transaction hoặc có lock phù hợp.

---

### 21.4 Response khi request trùng

```json
{
  "success": true,
  "message": "Request đã được xử lý trước đó",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "Processed"
  },
  "meta": {
    "request_id": "req_20260620_000007",
    "idempotent_replay": true,
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 22. Concurrency control

### 22.1 Optimistic locking

Các API cập nhật dữ liệu quan trọng nên hỗ trợ optimistic locking bằng `version` hoặc `updated_at`.

Client gửi:

```http
If-Match: "version-3"
```

Hoặc gửi trong body:

```json
{
  "version": 3
}
```

Nếu dữ liệu đã bị người khác cập nhật trước, trả:

```http
409 Conflict
```

---

### 22.2 Pessimistic locking trong transaction

Các nghiệp vụ bắt buộc lock:

1. Duyệt đơn nghỉ.
2. Cập nhật leave balance.
3. Check-in/check-out cùng ngày.
4. Điều chỉnh công.
5. Sinh mã tự động bằng sequence counter.
6. Gán role/permission nhạy cảm.
7. Cập nhật setting quan trọng.

---

## 23. Date, time, timezone

### 23.1 Chuẩn thời gian

API trả thời gian dạng ISO 8601:

```text
2026-06-20T10:00:00+07:00
```

Backend lưu database theo UTC hoặc timestamp chuẩn đã thống nhất trong DB design.

---

### 23.2 Timezone công ty

Company phải có timezone, ví dụ:

```text
Asia/Ho_Chi_Minh
```

Các nghiệp vụ ATT/LEAVE/DASH phải tính ngày làm việc theo timezone công ty hoặc timezone rule được cấu hình.

---

### 23.3 Không tin client time cho nghiệp vụ quan trọng

Check-in/check-out dùng server time làm nguồn chính.

Client time chỉ lưu để tham khảo:

1. `client_time`.
2. `client_timezone`.
3. `client_offset_minutes`.

---

## 24. Security

### 24.1 Không trả dữ liệu nhạy cảm mặc định

API không trả các field sau nếu user thiếu quyền đặc biệt:

1. Số giấy tờ tùy thân.
2. Thông tin ngân hàng.
3. Thông tin lương.
4. File hồ sơ nhạy cảm.
5. Storage path file private.
6. Token/secret.
7. Password hash.
8. Refresh token hash.
9. Audit raw diff chứa dữ liệu nhạy cảm.

---

### 24.2 Rate limit

Rate limit đề xuất:

| API                   | Rate limit gợi ý               |
| --------------------- | ------------------------------ |
| Login                 | 5 lần/phút/user hoặc IP        |
| Forgot password       | 3 lần/15 phút/email            |
| Refresh token         | 30 lần/phút/session            |
| Upload file           | Theo dung lượng và số lần/phút |
| Export file           | Giới hạn theo user/module      |
| API list thông thường | Giới hạn cao hơn, theo hạ tầng |

---

### 24.3 CORS

Chỉ allow origin chính thức:

1. Web app production.
2. Web app staging.
3. Localhost cho dev.
4. Mobile app nếu cần.

Không dùng wildcard `*` cho production nếu có credential.

---

## 25. API documentation format cho từng endpoint

Mỗi endpoint trong API-02 → API-09 phải viết theo template sau:

```text
## {METHOD} {PATH}

### Mục đích
Mô tả endpoint dùng để làm gì.

### Module
AUTH / HR / ATT / LEAVE / TASK / NOTI / DASH / FOUNDATION

### Required permission
Mã permission bắt buộc.

### Allowed roles
Super Admin / Admin công ty / HR / Manager / Employee / ...

### Data scope
Own / Team / Department / Project / Company / System

### Authentication
Required / Not required

### Request headers
Danh sách header cần thiết.

### Path params
Danh sách path params.

### Query params
Danh sách query params.

### Request body
JSON schema/body example.

### Business validation
Các rule nghiệp vụ backend phải kiểm tra.

### Success response
Response mẫu.

### Error responses
Danh sách lỗi có thể xảy ra.

### Audit log
Có/Không. Nếu có ghi action gì.

### Notification event
Có/Không. Nếu có event code gì.

### Idempotency
Required/Optional/No.

### Notes
Ghi chú triển khai nếu cần.
```

---

## 26. Ví dụ endpoint chuẩn

### 26.1 Ví dụ GET list

```text
GET /api/v1/hr/employees

Mục đích:
Lấy danh sách nhân viên theo quyền và data scope.

Required permission:
HR.EMPLOYEE.VIEW

Allowed roles:
Super Admin, Admin công ty, HR, Manager

Data scope:
Team, Department, Company, System

Authentication:
Required

Query params:
- page
- per_page
- search
- department_id
- status
- sort

Business validation:
- Backend resolve company_id từ auth context.
- Backend kiểm tra permission HR.EMPLOYEE.VIEW.
- Backend lọc dữ liệu theo data scope.
- Backend chỉ trả field sensitive nếu có HR.EMPLOYEE.VIEW_SENSITIVE.

Audit log:
Không bắt buộc với list thông thường.
Có thể ghi nếu export hoặc xem sensitive data theo cấu hình.

Notification event:
Không.
```

---

### 26.2 Ví dụ POST action

```text
POST /api/v1/leave/requests/{id}/approve

Mục đích:
Duyệt đơn nghỉ phép.

Required permission:
LEAVE.REQUEST.APPROVE

Allowed roles:
Manager, HR, Admin công ty, Super Admin

Data scope:
Team, Department, Company, System

Authentication:
Required

Idempotency:
Required

Business validation:
- User đã đăng nhập.
- User có permission LEAVE.REQUEST.APPROVE.
- Đơn nghỉ thuộc company hiện tại.
- Đơn nghỉ nằm trong data scope của user.
- Đơn nghỉ đang ở trạng thái Pending.
- Người duyệt không được duyệt sai policy nếu cấu hình hạn chế.
- Leave balance đủ nếu loại nghỉ cần trừ phép.
- Không xung đột với rule nghỉ phép.
- Transaction cập nhật request, balance, approval log và sync ATT.

Audit log:
Có. Action = LEAVE_REQUEST_APPROVED.

Notification event:
LEAVE_REQUEST_APPROVED.
```

---

## 27. Chuẩn API theo module

### 27.1 API-02 AUTH

API-02 sẽ mô tả:

1. Login.
2. Logout.
3. Refresh token.
4. Forgot password.
5. Reset password.
6. Change password.
7. Me/profile.
8. User management.
9. Role management.
10. Permission management.
11. Assign role.
12. Auth audit log.

---

### 27.2 API-03 HR

API-03 sẽ mô tả:

1. Employee list/detail/create/update.
2. Employee status change.
3. My profile.
4. Profile change request.
5. Approve/reject profile change.
6. Department APIs.
7. Position APIs.
8. Job level APIs.
9. Contract APIs.
10. Employee file APIs.
11. Employee code config APIs.

---

### 27.3 API-04 ATT

API-04 sẽ mô tả:

1. Check-in.
2. Check-out.
3. Today attendance status.
4. My timesheet.
5. Team/company timesheet.
6. Shift APIs.
7. Shift assignment APIs.
8. Attendance rule APIs.
9. Adjustment request APIs.
10. Approve/reject adjustment.
11. Direct adjustment.
12. Remote work request APIs.
13. Export attendance.

---

### 27.4 API-05 LEAVE

API-05 sẽ mô tả:

1. My leave balance.
2. Leave request create/draft/submit.
3. My leave requests.
4. Leave request detail.
5. Cancel leave request.
6. Pending approval list.
7. Approve/reject leave request.
8. Leave calendar.
9. Leave type APIs.
10. Leave policy APIs.
11. Leave balance adjustment.
12. Leave export.

---

### 27.5 API-06 TASK

API-06 sẽ mô tả:

1. Project list/create/update/close.
2. Project members.
3. Task list/create/update.
4. Assign task.
5. Change task status.
6. My tasks.
7. Kanban board.
8. Task comments.
9. Task mentions.
10. Task files.
11. Checklist.
12. Activity log.
13. Project report.

---

### 27.6 API-07 NOTI

API-07 sẽ mô tả:

1. Notification list.
2. Unread count.
3. Notification detail.
4. Mark as read.
5. Mark all as read.
6. Notification templates.
7. Notification events.
8. Delivery logs.
9. Notification preferences nếu có.

---

### 27.7 API-08 DASH

API-08 sẽ mô tả:

1. Dashboard me.
2. Employee dashboard.
3. Manager dashboard.
4. HR dashboard.
5. Admin dashboard.
6. Attendance today widget.
7. My tasks widget.
8. Pending approvals widget.
9. Leave balance widget.
10. Notification widget.
11. HR overview widget.
12. Dashboard widget config.

---

### 27.8 API-09 FOUNDATION

API-09 sẽ mô tả:

1. Company APIs.
2. Module catalog APIs.
3. System settings APIs.
4. Company settings APIs.
5. File upload/download APIs.
6. File link APIs.
7. Audit log APIs.
8. Sequence preview/generate APIs nếu cần.
9. Public holiday APIs.
10. Health check APIs.

---

## 28. Checklist bắt buộc khi thiết kế từng API

Mỗi API trong API-02 → API-09 phải trả lời được:

* [ ] API thuộc module nào?
* [ ] API dùng để làm gì?
* [ ] API có cần đăng nhập không?
* [ ] Required permission là gì?
* [ ] Allowed roles nào thường dùng API này?
* [ ] Data scope áp dụng như thế nào?
* [ ] Backend lấy `company_id` từ đâu?
* [ ] Backend resolve `employee_id` từ user như thế nào?
* [ ] API có trả dữ liệu nhạy cảm không?
* [ ] API có cần field-level permission không?
* [ ] API có business validation nào?
* [ ] API có cần transaction không?
* [ ] API có cần lock dữ liệu không?
* [ ] API có cần idempotency không?
* [ ] API có ghi audit log không?
* [ ] API có phát notification event không?
* [ ] API có upload/download file không?
* [ ] API có pagination/search/filter/sort không?
* [ ] API có thể gây query nặng không?
* [ ] API có cache được không?
* [ ] API có test case permission/scope chưa?

---

## 29. Quyết định thiết kế đã chốt

1. Base path chính thức của MVP là `/api/v1`.
2. API dùng Access Token + Refresh Token.
3. Access token gửi qua `Authorization: Bearer`.
4. Backend luôn kiểm tra permission và data scope.
5. Frontend chỉ dùng permission để hỗ trợ UI, không thay thế backend authorization.
6. Mỗi API module phải khai báo `Required permission`, `Allowed roles`, `Data scope`, `Business validation`, `Audit log`, `Notification event`.
7. Response thành công dùng format thống nhất: `success`, `message`, `data`, `meta`.
8. Response lỗi dùng format thống nhất: `success`, `message`, `error`, `meta`.
9. Validation error có `details` theo từng field.
10. API list mặc định hỗ trợ pagination.
11. API list quan trọng hỗ trợ search/filter/sort theo whitelist.
12. File upload dùng service chung, file private là mặc định.
13. File download phải kiểm tra permission trước khi cấp link.
14. Audit log bắt buộc với thao tác quan trọng.
15. Notification được kích hoạt bằng event, không chứa dữ liệu nhạy cảm quá mức.
16. API quan trọng phải hỗ trợ idempotency.
17. API phải sẵn sàng multi-tenant bằng auth context.
18. Không tin `company_id`, `user_id`, `employee_id`, `role`, `permission` do frontend tự gửi nếu các giá trị đó có thể resolve từ token/context.
19. Date/time trả về ISO 8601.
20. Check-in/check-out và nghiệp vụ thời gian quan trọng dùng server time.

---

## 30. Việc cần làm tiếp theo

Sau API-01, nên triển khai lần lượt:

```text
API-02: AUTH API Design
API-03: HR API Design
API-04: ATT API Design
API-05: LEAVE API Design
API-06: TASK API Design
API-07: NOTI API Design
API-08: DASH API Design
API-09: FOUNDATION API Design
```

Thứ tự ưu tiên đề xuất:

```text
API-02 AUTH
→ API-09 FOUNDATION
→ API-03 HR
→ API-04 ATT
→ API-05 LEAVE
→ API-06 TASK
→ API-07 NOTI
→ API-08 DASH
```

Lý do:

1. AUTH là nền tảng xác thực và phân quyền.
2. FOUNDATION cung cấp audit, file, settings, sequence.
3. HR cung cấp employee, department, manager, user mapping.
4. ATT và LEAVE phụ thuộc chặt vào HR/AUTH/FOUNDATION.
5. TASK cần HR/AUTH/FOUNDATION.
6. NOTI nhận event từ các module nghiệp vụ.
7. DASH tổng hợp dữ liệu từ các module khác.

---

## 31. Kết luận

API-01 chốt bộ quy chuẩn API tổng quan cho hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này là nền tảng để đảm bảo toàn bộ API trong MVP có cùng chuẩn:

1. Cùng base URL.
2. Cùng versioning.
3. Cùng cơ chế authentication.
4. Cùng cơ chế authorization.
5. Cùng response format.
6. Cùng error format.
7. Cùng pagination/search/filter/sort.
8. Cùng quy tắc upload file.
9. Cùng quy tắc audit log.
10. Cùng quy tắc notification event.
11. Cùng chuẩn idempotency.
12. Cùng nguyên tắc backend kiểm tra quyền và data scope.

Từ tài liệu này, đội backend có thể triển khai middleware, guard, interceptor, exception handler, response transformer, audit service, file service, notification event publisher và API documentation template trước khi viết API nghiệp vụ chi tiết.
