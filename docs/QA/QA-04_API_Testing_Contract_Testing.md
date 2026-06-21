# QA-04: API TESTING & CONTRACT TESTING
# KIỂM THỬ API & KIỂM THỬ HỢP ĐỒNG API

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-04 |
| Tên tài liệu | API Testing & Contract Testing |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release Readiness - MVP Version 1.0 |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-03 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu QA-04 định nghĩa chiến lược, phạm vi, ma trận kiểm thử và quy trình tự động hóa cho **API Testing** và **Contract Testing** của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chuẩn hóa cách QA kiểm thử tất cả API public và internal trong MVP.
2. Đảm bảo API backend tuân thủ chuẩn chung đã chốt trong API-01.
3. Đảm bảo contract giữa Backend, Frontend, Mobile sau này và QA automation không bị lệch.
4. Kiểm thử đầy đủ authentication, authorization, permission, data scope và multi-tenant isolation.
5. Kiểm thử response format, error format, validation error, pagination, search, filter, sort và request metadata.
6. Kiểm thử business rule quan trọng của các module AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
7. Kiểm thử các action có tác dụng phụ như audit log, notification event, dashboard cache invalidation và đồng bộ module.
8. Định nghĩa cách tạo OpenAPI/Swagger contract, schema validation, mock server, consumer-driven contract và CI gate.
9. Làm cơ sở để Backend, Frontend và QA cùng nghiệm thu API trước khi release MVP.

---

## 3. Vị trí của QA-04 trong roadmap QA

```text
QA-01: QA Strategy & Test Plan
  -> QA-02: Test Case Matrix theo module
  -> QA-03: End-to-End Flow Testing
  -> QA-04: API Testing & Contract Testing
  -> QA-05: Permission, Role & Data Scope Testing
  -> QA-06: Security Testing
  -> QA-07: Performance & Load Testing
  -> QA-08: Bug Tracking, Regression & Release Criteria
  -> QA-09: UAT Plan & Business Acceptance
  -> QA-10: MVP Release Readiness Checklist
```

QA-04 nằm sau QA-03 vì khi đã xác định được luồng E2E quan trọng, QA cần bóc tách các API phía sau từng luồng để kiểm thử ở mức thấp hơn, nhanh hơn và dễ tự động hóa hơn.

QA-04 không thay thế E2E test. QA-04 giúp đảm bảo từng API và từng contract ổn định trước khi ghép vào E2E.

---

## 4. Căn cứ thiết kế

QA-04 bám theo các quyết định đã chốt trong bộ tài liệu dự án:

1. API public dùng prefix `/api/v1`.
2. API nội bộ dùng prefix `/internal/v1` và không được gọi trực tiếp từ frontend/mobile.
3. Backend là nguồn kiểm soát quyền cuối cùng.
4. Frontend chỉ hỗ trợ ẩn/hiện, disable, mask và route guard; không thay thế backend guard.
5. Backend phải kiểm tra authentication, permission, data scope, target resource, business rule, audit log và notification event.
6. Backend resolve `company_id`, `user_id`, `employee_id`, role, permission và data scope từ auth context hoặc database/cache nội bộ.
7. Frontend không được tự truyền `company_id` cho nghiệp vụ thông thường.
8. Tất cả response thành công phải có `success`, `message`, `data`, `meta.request_id`, `meta.timestamp`.
9. API list phải có `pagination` nếu phân trang.
10. Response lỗi phải có `success: false`, `message`, `error.code`, `error.type`, `error.details`, `meta.request_id`, `meta.timestamp`.
11. API quan trọng cần hỗ trợ `Idempotency-Key`.
12. API thay đổi dữ liệu quan trọng cần ghi audit log.
13. API nghiệp vụ quan trọng cần phát notification event hoặc dashboard cache invalidation nếu tài liệu API module có khai báo.
14. Dữ liệu nhạy cảm phải được field masking hoặc không trả nếu user thiếu quyền.
15. Contract API phải đủ để frontend sinh type, mock API, viết API client và query hook.

---

## 5. Phạm vi QA-04

### 5.1 Bao gồm

| Nhóm | Nội dung kiểm thử |
| --- | --- |
| API contract | OpenAPI/Swagger, schema request/response, error schema, pagination schema, enum, example |
| Authentication | Token hợp lệ, token thiếu, token hết hạn, refresh token, logout, revoked session |
| Authorization | Permission required, role seed tham khảo, data scope, target resource scope |
| Multi-tenant | Không lộ dữ liệu khác company, không tin `company_id` client gửi |
| Response standard | Success object/list/null, meta, request id, timestamp, pagination |
| Error standard | 400, 401, 403, 404, 409, 422, 429, 500 theo error format chuẩn |
| Validation | Body, query, path param, UUID, enum, required field, date range, sort whitelist |
| Business API | AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION |
| State transition | Leave request, attendance adjustment, remote request, task status, notification state |
| Idempotency | Tạo mới/action quan trọng không xử lý trùng khi retry |
| Concurrency | Optimistic lock, duplicate submit, approve cùng lúc, stale version |
| Side effect | Audit log, notification event, dashboard cache invalidation, sync ATT/LEAVE |
| File API | Upload, download, private file, signed URL, file permission, file link/unlink |
| Internal API | Internal auth, job endpoint, module sync, event endpoint, không expose public |
| Consumer contract | Frontend API client/query layer, mock server, type generation |
| CI automation | Contract lint, schema validation, API smoke, regression API test |

### 5.2 Không bao gồm sâu

| Nội dung | Chuyển sang |
| --- | --- |
| Kiểm thử UI chi tiết | QA-03 / Frontend QA |
| Penetration testing chuyên sâu | QA-06 Security Testing |
| Load/stress/soak test chuyên sâu | QA-07 Performance & Load Testing |
| Kiểm thử database migration sâu | Backend testing / DB migration QA |
| Kiểm thử native mobile app | Phase mobile riêng |
| Kiểm thử payroll/recruit/asset/room/chat/social | Phase sau |

---

## 6. Mục tiêu chất lượng API

| Mã mục tiêu | Mục tiêu | Điều kiện đạt |
| --- | --- | --- |
| QA04-GOAL-001 | API đúng contract | 100% endpoint MVP có OpenAPI spec, request/response schema và example |
| QA04-GOAL-002 | API bảo mật theo quyền | 100% endpoint nghiệp vụ có test 401/403/data scope |
| QA04-GOAL-003 | API nhất quán response | 100% endpoint pass schema success/error/pagination |
| QA04-GOAL-004 | API xử lý lỗi rõ ràng | Không trả stack trace, secret, storage path, token hoặc dữ liệu nhạy cảm trong lỗi |
| QA04-GOAL-005 | API có khả năng retry an toàn | 100% action quan trọng có test idempotency |
| QA04-GOAL-006 | API không lộ dữ liệu cross-tenant | 100% list/detail/action có test company isolation phù hợp |
| QA04-GOAL-007 | Contract không phá frontend | Breaking change bị CI chặn trước khi merge |
| QA04-GOAL-008 | Automation có thể chạy trên CI | API smoke và contract test chạy được không cần thao tác tay |

---

## 7. Nguyên tắc API Testing

### 7.1 Test từ contract trước, business sau

Thứ tự kiểm thử đề xuất:

```text
OpenAPI contract valid
  -> response schema valid
  -> authentication valid
  -> permission/data scope valid
  -> validation input valid
  -> business rule valid
  -> side effect valid
  -> regression valid
```

Nếu contract sai, test business có thể bị nhiễu vì client và backend chưa thống nhất định dạng.

### 7.2 Không chỉ test happy path

Mỗi endpoint MVP tối thiểu phải có:

1. Happy path.
2. Missing token hoặc invalid token.
3. Missing permission.
4. Out-of-scope target resource.
5. Invalid path param.
6. Invalid query/body.
7. Error schema validation.
8. Nếu là action quan trọng: idempotency và concurrency.

### 7.3 Data scope là test bắt buộc

Không endpoint nghiệp vụ nào được xem là pass nếu chưa có test data scope.

Các scope chuẩn:

| Scope | Ý nghĩa test |
| --- | --- |
| Own | Chỉ dữ liệu của chính user/employee hiện tại |
| Team | Dữ liệu nhân viên thuộc team/quản lý trực tiếp |
| Department | Dữ liệu thuộc phòng ban được phân quyền |
| Project | Dữ liệu thuộc project có liên quan |
| Company | Dữ liệu trong company hiện tại |
| System | Dữ liệu liên công ty, chỉ Super Admin |

### 7.4 Backend không được tin dữ liệu định danh từ client

Các test phải cố tình gửi sai hoặc giả mạo:

```text
company_id
user_id
employee_id
role
permission
data_scope
created_by
approved_by
reviewed_by
```

Kỳ vọng backend bỏ qua, resolve lại từ auth context hoặc trả validation/forbidden theo policy.

### 7.5 Dữ liệu nhạy cảm phải được test riêng

Các field nhạy cảm gồm:

```text
password_hash
refresh_token_hash
identity_number
tax_code
bank_account_number
GPS/IP/device
private file path
leave reason nhạy cảm
medical file
secret setting
```

QA cần kiểm tra các field này không xuất hiện ở list response, error response, notification payload hoặc dashboard widget khi user thiếu quyền.

---

## 8. Phân lớp API test

| Lớp test | Mục tiêu | Công cụ đề xuất | Thời điểm chạy |
| --- | --- | --- | --- |
| Contract lint | Kiểm tra OpenAPI hợp lệ, naming, schema, security, example | Spectral / openapi-cli | Mỗi PR |
| Schema test | Response thực tế khớp OpenAPI schema | Vitest/Supertest, Postman/Newman, Schemathesis | Mỗi PR / nightly |
| Smoke API | Kiểm tra API sống và happy path P0 | Postman/Newman hoặc test runner backend | Mỗi deploy dev/staging |
| Functional API | Kiểm tra nghiệp vụ từng endpoint | Vitest/Supertest / Postman | Mỗi PR backend |
| Permission API | Kiểm tra 401/403/scope/masking | Automated API tests | Mỗi PR backend |
| Integration API | Kiểm tra side effect giữa module | Automated API tests | Nightly/staging |
| Consumer contract | Đảm bảo frontend client đúng contract | Pact / OpenAPI generated client tests / MSW contract | Mỗi PR frontend/backend |
| Regression API | Chạy lại bộ API trọng yếu | CI pipeline | Trước release |

---

## 9. Chuẩn artifact contract API

### 9.1 Artifact bắt buộc

| Artifact | Chủ sở hữu | Mục đích |
| --- | --- | --- |
| `openapi.yaml` hoặc `openapi.json` | Backend/API owner | Contract chính thức của API public |
| `internal-openapi.yaml` | Backend/API owner | Contract cho internal API/job/module sync |
| `error-catalog.md` | Backend + QA | Danh mục error code/type/message |
| `permission-api-matrix.md` | Backend + QA | Mapping endpoint -> permission -> data scope |
| `api-examples/` | Backend + QA | Request/response mẫu cho test và mock |
| `mock-server` | Frontend + QA | Cho frontend test khi backend chưa sẵn sàng |
| `contract-test-report` | QA automation | Báo cáo pass/fail schema và breaking change |

### 9.2 Metadata mở rộng trong OpenAPI

Mỗi operation nên có extension để QA test tự động đọc được:

```yaml
x-module: ATT
x-permission: ATT.ATTENDANCE.CHECK_IN
x-data-scopes:
  - Own
x-auth-required: true
x-idempotency: required
x-audit-log: optional
x-notification-events:
  - ATTENDANCE_CHECKED_IN
x-internal: false
x-sensitive-fields:
  - gps_latitude
  - gps_longitude
```

### 9.3 OperationId convention

```text
<module><resource><action>
```

Ví dụ:

```text
authLogin
hrListEmployees
attendanceCheckIn
leaveApproveRequest
taskCreateComment
notificationMarkRead
dashboardGetWidgetData
```

---

## 10. Chuẩn kiểm thử request/response chung

### 10.1 Success response object

Tất cả object response phải có:

```json
{
  "success": true,
  "message": "...",
  "data": {},
  "meta": {
    "request_id": "...",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

Test bắt buộc:

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-COM-RESP-001 | Object response có đủ field chuẩn | `success`, `message`, `data`, `meta.request_id`, `meta.timestamp` |
| QA04-COM-RESP-002 | `timestamp` đúng ISO 8601 | Parse được timezone |
| QA04-COM-RESP-003 | `request_id` không rỗng | Có thể dùng trace log |
| QA04-COM-RESP-004 | Không trả field secret | Không có password/token hash/secret/path private |

### 10.2 Success response list

List response phải có:

```json
{
  "success": true,
  "message": "...",
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  },
  "meta": {}
}
```

Test bắt buộc:

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-COM-LIST-001 | List có pagination | Có đủ `page`, `per_page`, `total`, `total_pages` |
| QA04-COM-LIST-002 | `per_page` vượt giới hạn | Trả 400 hoặc clamp theo policy |
| QA04-COM-LIST-003 | Page âm hoặc 0 | Trả validation error |
| QA04-COM-LIST-004 | Sort field không whitelist | Trả validation error |
| QA04-COM-LIST-005 | Filter out-of-scope | Không trả dữ liệu ngoài scope |

### 10.3 Error response

Error response phải có:

```json
{
  "success": false,
  "message": "...",
  "error": {
    "code": "...",
    "type": "...",
    "details": null
  },
  "meta": {
    "request_id": "...",
    "timestamp": "..."
  }
}
```

Test bắt buộc:

| Test ID | HTTP | Nội dung | Kỳ vọng |
| --- | ---: | --- | --- |
| QA04-COM-ERR-001 | 400 | Invalid UUID/path param | Error format chuẩn |
| QA04-COM-ERR-002 | 401 | Missing token | Không trả dữ liệu |
| QA04-COM-ERR-003 | 401 | Expired/invalid token | Không xử lý nghiệp vụ |
| QA04-COM-ERR-004 | 403 | Missing permission | Error format chuẩn |
| QA04-COM-ERR-005 | 404/403 | Resource khác company/scope | Không lộ tồn tại nếu policy chọn 404 |
| QA04-COM-ERR-006 | 409 | Conflict/state transition sai | Error business rõ ràng |
| QA04-COM-ERR-007 | 422/400 | Validation body | `error.details` theo field |
| QA04-COM-ERR-008 | 500 | Server error | Không trả stack trace/secret |

---

## 11. Test user, role và seed data chuẩn

### 11.1 Company seed

| Company | Mục đích |
| --- | --- |
| Company A | Company chính để test dữ liệu nghiệp vụ |
| Company B | Company khác để test tenant isolation |

### 11.2 User seed

| User code | Role seed | Scope chính | Mục đích |
| --- | --- | --- | --- |
| `super_admin` | Super Admin | System | Test cross-company và system-only API |
| `company_admin_a` | Admin công ty | Company | Test admin company A |
| `hr_a` | HR | Company/Department | Test HR API, ATT/LEAVE admin |
| `manager_a` | Manager | Team | Test duyệt đơn, task team, bảng công team |
| `employee_a1` | Employee | Own | Test self-service |
| `employee_a2` | Employee | Own | Test out-of-scope cùng company |
| `employee_b1` | Employee Company B | Own | Test cross-tenant isolation |
| `locked_user` | Employee | Own | Test user bị khóa |
| `inactive_employee_user` | Employee | Own | Test employee không hợp lệ |

### 11.3 Business seed tối thiểu

| Module | Seed bắt buộc |
| --- | --- |
| AUTH | User, role, permission, session/token test |
| HR | Employee, department, position, job level, contract, profile change request |
| ATT | Shift, attendance rule, shift assignment, attendance record, attendance log, adjustment request, remote request |
| LEAVE | Leave type, leave policy, leave balance, leave request Draft/Pending/Approved/Rejected/Cancelled/Revoked |
| TASK | Project, project member, task, assignee, watcher, comment, checklist |
| NOTI | Notification event, template, notification read/unread, delivery log |
| DASH | Widget catalog, widget config, widget cache |
| FOUNDATION | Company, module catalog, settings, audit log, file metadata, public holidays, sequence counters |

---

## 12. Ma trận test chung cho mọi endpoint

| Test ID | Nhóm | Áp dụng | Bước kiểm thử | Kỳ vọng |
| --- | --- | --- | --- | --- |
| QA04-GEN-001 | Contract | Tất cả endpoint | Gọi API và validate response theo OpenAPI schema | Pass schema |
| QA04-GEN-002 | Auth | API protected | Gọi không có token | 401, không xử lý nghiệp vụ |
| QA04-GEN-003 | Auth | API protected | Gọi bằng token hết hạn | 401, có error code chuẩn |
| QA04-GEN-004 | Auth | API protected | Gọi bằng user locked | 401/403 theo policy |
| QA04-GEN-005 | Permission | API có permission | Gọi bằng user không có permission | 403 |
| QA04-GEN-006 | Scope | API detail/action | Gọi resource ngoài scope | 403 hoặc 404 theo policy |
| QA04-GEN-007 | Tenant | API list/detail/action | Gọi resource Company B bằng user Company A | Không lộ dữ liệu |
| QA04-GEN-008 | Path param | API có UUID | Gửi UUID sai format | 400 validation |
| QA04-GEN-009 | Query | API list | Gửi page/per_page/sort/filter sai | 400 validation |
| QA04-GEN-010 | Response | Tất cả endpoint | Kiểm tra `meta.request_id` | Có request id |
| QA04-GEN-011 | Security | Tất cả endpoint | Kiểm tra response/error không có secret | Không lộ secret |
| QA04-GEN-012 | Idempotency | POST action quan trọng | Retry cùng `Idempotency-Key` | Không tạo/duyệt/xử lý trùng |
| QA04-GEN-013 | Concurrency | Action có `version` | Gửi stale version | 409 conflict |
| QA04-GEN-014 | Audit | Action quan trọng | Sau action kiểm tra audit log | Có log đúng actor/action/target |
| QA04-GEN-015 | Notification | Action phát event | Sau action kiểm tra event/notification | Event đúng code/recipient |
| QA04-GEN-016 | Cache | Dashboard-impact action | Sau action kiểm tra cache invalidation | Widget stale được invalidate |

---

## 13. API Testing theo module

### 13.1 AUTH API

### 13.1.1 Mục tiêu kiểm thử

AUTH là nền tảng xác thực, session, user, role, permission và data scope. Test AUTH phải đảm bảo mọi module khác nhận được auth context chính xác.

### 13.1.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Login/logout | `POST /api/v1/auth/login`, `POST /api/v1/auth/logout` | P0 |
| Token | `POST /api/v1/auth/refresh-token` | P0 |
| Me/profile | `GET /api/v1/auth/me` | P0 |
| Password | Forgot/reset/change password | P1 |
| User admin | User list/create/update/lock/unlock | P1 |
| Role/permission | Role, permission, role-permission matrix | P1 |
| Session/security | Session list, revoke session, login log | P2 |

### 13.1.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-AUTH-001 | Login đúng email/password | Trả access token, refresh token theo policy, user context |
| QA04-AUTH-002 | Login sai password | 401, không lộ thông tin tài khoản tồn tại |
| QA04-AUTH-003 | Login user bị khóa | 403/401, không cấp token |
| QA04-AUTH-004 | Refresh token hợp lệ | Trả access token mới |
| QA04-AUTH-005 | Refresh token revoked | 401 |
| QA04-AUTH-006 | Logout | Revoke refresh/session, access token cũ bị chặn theo policy |
| QA04-AUTH-007 | `/auth/me` trả permission/scope đúng | Frontend có dữ liệu guard |
| QA04-AUTH-008 | User thiếu permission quản trị user | 403 |
| QA04-AUTH-009 | Role permission thay đổi | Auth context/cache permission được invalidate |
| QA04-AUTH-010 | Không trả password_hash/refresh_token_hash | Không lộ secret |

---

### 13.2 HR API

### 13.2.1 Mục tiêu kiểm thử

HR là nguồn dữ liệu nhân sự trung tâm. Test HR phải đảm bảo danh sách/chi tiết nhân viên, self-service profile change, department/position/contract và employee code config hoạt động đúng quyền và data scope.

### 13.2.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Employee list/detail | `GET /api/v1/hr/employees`, `GET /api/v1/hr/employees/{employee_id}` | P0 |
| Employee create/update/status | `POST /api/v1/hr/employees`, `PATCH /api/v1/hr/employees/{employee_id}` | P0 |
| My profile | `GET /api/v1/hr/me/profile` | P0 |
| Profile change request | Create/approve/reject request | P0 |
| Department/position/job level | CRUD danh mục | P1 |
| Contract | Employee contract CRUD | P1 |
| Employee code config | Config/preview mã nhân viên | P1 |
| File/audit/export | Upload/download/audit/export | P2 |

### 13.2.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-HR-001 | HR xem danh sách employee Company A | Chỉ trả employee Company A |
| QA04-HR-002 | Manager scope Team xem employee | Chỉ trả nhân viên thuộc team |
| QA04-HR-003 | Employee xem hồ sơ người khác | 403/404 |
| QA04-HR-004 | Tạo employee không truyền employee_code | Hệ thống tự sinh theo config |
| QA04-HR-005 | Tạo employee trùng email/code | 409/validation error |
| QA04-HR-006 | Employee gửi profile change request | Tạo request Pending, chưa đổi hồ sơ chính |
| QA04-HR-007 | HR approve profile change | Hồ sơ chính được cập nhật, có audit và notification |
| QA04-HR-008 | HR reject profile change | Hồ sơ chính giữ nguyên, có notification |
| QA04-HR-009 | User thiếu quyền sensitive xem identity/bank/tax | Field bị mask hoặc không trả |
| QA04-HR-010 | Employee Company A truy cập employee Company B | 403/404, không lộ dữ liệu |

---

### 13.3 ATT API

### 13.3.1 Mục tiêu kiểm thử

ATT quản lý check-in/check-out, bảng công, ca làm, rule, điều chỉnh công và remote/công tác. Test ATT phải tập trung vào rule engine, leave blocking, data scope và audit/log.

### 13.3.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Today attendance | `GET /api/v1/attendance/today` | P0 |
| Check-in/out | `POST /api/v1/attendance/check-in`, `POST /api/v1/attendance/check-out` | P0 |
| My records | `GET /api/v1/attendance/my-records` | P0 |
| Company/team records | `GET /api/v1/attendance/records` | P0 |
| Adjustment | Create/approve/reject/cancel adjustment request | P0 |
| Manual adjustment | `POST /records/{id}/manual-adjust` | P1 |
| Remote request | Create/approve/reject/cancel remote request | P1 |
| Shift/rule | Shift, shift assignment, attendance rule APIs | P1 |
| Internal recalculate | `/internal/v1/attendance/recalculate` | P2 |

### 13.3.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-ATT-001 | Employee lấy today attendance | Trả trạng thái, shift, rule, actions đúng |
| QA04-ATT-002 | Check-in thiếu token | 401 |
| QA04-ATT-003 | Check-in hợp lệ | Tạo/cập nhật `attendance_records`, tạo `attendance_logs` |
| QA04-ATT-004 | Check-in lần 2 cùng ngày | Không tạo record trùng, xử lý theo idempotency/rule |
| QA04-ATT-005 | Check-in khi có leave full day Approved | Bị chặn, trả business error |
| QA04-ATT-006 | Check-in remote khi chưa có remote Approved | Bị chặn nếu rule yêu cầu |
| QA04-ATT-007 | Check-out trước check-in | 409/validation business |
| QA04-ATT-008 | My records có truyền `employee_id` người khác | Backend bỏ qua hoặc validation error |
| QA04-ATT-009 | Manager xem records team | Chỉ dữ liệu team |
| QA04-ATT-010 | HR xem records company | Chỉ company hiện tại, không có Company B |
| QA04-ATT-011 | Employee gửi adjustment request | Request Pending, notification gửi manager/HR |
| QA04-ATT-012 | Manager duyệt adjustment ngoài team | 403/404 |
| QA04-ATT-013 | Approve adjustment stale version | 409 conflict |
| QA04-ATT-014 | HR manual adjust record đã bị leave full day ảnh hưởng | Bị chặn nếu không có quyền override |
| QA04-ATT-015 | List records không trả GPS/IP/device nếu thiếu quyền sensitive | Field mask/null |
| QA04-ATT-016 | Export bảng công với range quá lớn | Bị giới hạn hoặc chuyển export job theo policy |

---

### 13.4 LEAVE API

### 13.4.1 Mục tiêu kiểm thử

LEAVE quản lý số dư phép, đơn nghỉ, duyệt/từ chối/hủy/thu hồi, lịch nghỉ và đồng bộ sang ATT. Test LEAVE phải kiểm tra state machine, balance transaction, approval scope và side effect.

### 13.4.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| My balance | `GET /api/v1/leave/me/balances` | P0 |
| My request | `GET /api/v1/leave/me/requests`, `POST /api/v1/leave/requests` | P0 |
| Submit/cancel own | `POST /requests/{id}/submit`, `POST /requests/{id}/cancel` | P0 |
| Approval | `POST /requests/{id}/approve`, `POST /requests/{id}/reject` | P0 |
| Leave calculation | Preview days/hours/balance/conflict | P0 |
| Calendar | `GET /api/v1/leave/calendar` | P1 |
| Leave type/policy | CRUD type/policy | P1 |
| Balance admin | Adjust balance, view transactions | P1 |
| Internal sync | LEAVE -> ATT/NOTI/DASH | P1 |

### 13.4.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-LEAVE-001 | Employee xem balance của mình | Chỉ balance Own |
| QA04-LEAVE-002 | Employee tạo draft request | Trạng thái Draft, chưa trừ balance |
| QA04-LEAVE-003 | Submit request hợp lệ | Trạng thái Pending, reserve balance nếu policy cần |
| QA04-LEAVE-004 | Submit request ngày bắt đầu sau ngày kết thúc | 400 validation |
| QA04-LEAVE-005 | Submit leave type inactive | 409 business error |
| QA04-LEAVE-006 | Submit vượt balance | 409 hoặc validation business |
| QA04-LEAVE-007 | Manager approve request trong team | Request Approved, balance transaction, sync ATT, notification |
| QA04-LEAVE-008 | Manager approve request ngoài team | 403/404 |
| QA04-LEAVE-009 | Employee tự approve đơn của mình | 403/409 nếu không có quyền đặc biệt |
| QA04-LEAVE-010 | Approve request không còn Pending | 409 state transition |
| QA04-LEAVE-011 | Approve retry cùng Idempotency-Key | Không double deduct balance |
| QA04-LEAVE-012 | Reject request | Status Rejected, release reserved balance nếu có |
| QA04-LEAVE-013 | Cancel Approved request theo policy không cho phép | 409 business error |
| QA04-LEAVE-014 | Calendar team không trả reason nhạy cảm | `display_reason` null/masked |
| QA04-LEAVE-015 | Leave Approved full day làm ATT today bị block | ATT trả `blocked_by_leave` hoặc disable action |

---

### 13.5 TASK API

### 13.5.1 Mục tiêu kiểm thử

TASK quản lý project, member, task, assignee, watcher, comment, mention, checklist, file và activity log. Test TASK phải kiểm tra project permission, task assignee/watcher scope, Kanban state và notification mention/assigned.

### 13.5.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Project | List/detail/create/update/close/archive/delete soft | P0 |
| Project member | Add/update role/remove member | P0 |
| Task | List/detail/create/update/delete soft | P0 |
| My task | Assigned/created/watching/overdue/due soon | P0 |
| Assignment | Assign/change assignee/watcher | P0 |
| Status/Kanban | Change status, drag/drop board | P1 |
| Comment/mention | Create/update/delete comment, mention users | P1 |
| Checklist | Create/update/complete checklist item | P1 |
| File/activity | Upload/download/delete file, activity log | P2 |

### 13.5.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-TASK-001 | User xem project mình là member | Trả project detail |
| QA04-TASK-002 | User không thuộc project xem project private | 403/404 |
| QA04-TASK-003 | Tạo project thiếu permission | 403 |
| QA04-TASK-004 | Thêm member ngoài company | Validation/404 |
| QA04-TASK-005 | Tạo task với assignee inactive/resigned | 409 business error |
| QA04-TASK-006 | Giao task cho người đang nghỉ Approved | Trả warning hoặc business response theo policy |
| QA04-TASK-007 | Employee cập nhật task không được giao/không có quyền | 403 |
| QA04-TASK-008 | Change status sai state hoặc thiếu quyền | 409/403 |
| QA04-TASK-009 | Comment mention user hợp lệ | Tạo comment, notification `TASK_MENTIONED` |
| QA04-TASK-010 | Delete comment của người khác thiếu quyền | 403 |
| QA04-TASK-011 | Upload file task private | File link đúng task, download kiểm tra quyền |
| QA04-TASK-012 | My tasks chỉ trả task assigned/created/watching hợp lệ | Không lộ task ngoài scope |

---

### 13.6 NOTI API

### 13.6.1 Mục tiêu kiểm thử

NOTI là module dùng chung để tạo, hiển thị, đếm, đánh dấu đọc và cấu hình thông báo. Test NOTI phải kiểm tra recipient resolution, unread count, dedupe, template render, preference và target deep link an toàn.

### 13.6.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| My notifications | List, dropdown, detail, unread count | P0 |
| Actions | Mark read, mark all read, hide/archive/delete soft | P0 |
| Target | Resolve deep link target an toàn | P0 |
| Admin notification | Xem notification theo scope | P1 |
| Event/template/channel | Cấu hình event/template/channel | P1 |
| Delivery log | Xem/retry delivery log | P2 |
| System notification | Admin gửi thông báo thủ công | P2 |
| Internal event | `/internal/v1/notifications/events` | P0/P1 |

### 13.6.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-NOTI-001 | User xem unread count | Chỉ count notification của chính mình |
| QA04-NOTI-002 | User xem notification detail của người khác | 403/404 |
| QA04-NOTI-003 | Mark read notification của mình | `read_at` được set, unread count giảm |
| QA04-NOTI-004 | Mark all read | Chỉ mark notification của user hiện tại |
| QA04-NOTI-005 | Notification target link tới resource out-of-scope | Không trả target URL hoặc trả forbidden target |
| QA04-NOTI-006 | Internal event có dedupe_key retry | Không tạo notification trùng |
| QA04-NOTI-007 | Event tới user inactive/locked | Skip theo policy |
| QA04-NOTI-008 | Template chứa HTML/script | Nội dung được sanitize |
| QA04-NOTI-009 | Notification payload không chứa file URL private/lý do nhạy cảm | Không lộ dữ liệu |
| QA04-NOTI-010 | Admin xem delivery log thiếu quyền | 403 |

---

### 13.7 DASH API

### 13.7.1 Mục tiêu kiểm thử

DASH tổng hợp dữ liệu theo role, permission và data scope, không xử lý nghiệp vụ gốc. Test DASH phải đảm bảo widget không lộ dữ liệu ngoài scope, quick action điều hướng đúng module gốc và cache/fallback hoạt động.

### 13.7.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Dashboard me | `GET /api/v1/dashboard/me` | P0 |
| Dashboard type | Employee/Manager/HR/Admin dashboard theo quyền | P0 |
| Widget catalog | Metadata widget, permission required | P1 |
| Widget data | `GET /api/v1/dashboard/widgets/{widget_slug}` | P0 |
| Config/layout | Admin config widget, order, enable/disable | P1 |
| Cache | Internal invalidate/refresh/warmup cache | P1 |
| Audit | Xem audit log cấu hình dashboard | P2 |

### 13.7.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-DASH-001 | Employee gọi dashboard me | Chỉ trả Employee dashboard/widget Own |
| QA04-DASH-002 | Manager gọi manager dashboard | Widget team chỉ có dữ liệu team |
| QA04-DASH-003 | HR dashboard | Chỉ dữ liệu Company/Department theo quyền |
| QA04-DASH-004 | User thiếu permission widget | Widget ẩn hoặc trả forbidden theo API policy |
| QA04-DASH-005 | Widget nguồn ATT lỗi | Trả degraded/fallback, không làm hỏng toàn dashboard |
| QA04-DASH-006 | Quick action check-in | Chỉ trả metadata điều hướng, không xử lý nghiệp vụ thay ATT |
| QA04-DASH-007 | Cache sau approve leave | Pending approvals/leave balance được invalidate |
| QA04-DASH-008 | Dashboard config update thiếu quyền | 403 |
| QA04-DASH-009 | Widget không trả dữ liệu nhạy cảm | Không lộ reason/file/GPS/IP nếu thiếu quyền |

---

### 13.8 FOUNDATION API

### 13.8.1 Mục tiêu kiểm thử

FOUNDATION cung cấp company, module catalog, settings, audit log, file service, sequence counter, public holiday và seed/runtime infrastructure dùng chung.

### 13.8.2 Nhóm endpoint cần kiểm thử

| Nhóm | Endpoint tham khảo | Ưu tiên |
| --- | --- | --- |
| Module/app registry | My apps, module status, feature flag | P0 |
| Settings | System/company settings | P1 |
| File | Upload, metadata, download, link/unlink, delete soft | P0/P1 |
| Audit log | List/detail/filter audit log | P1 |
| Sequence | Preview/generate sequence code | P1 |
| Public holidays | CRUD/view public holidays | P2 |
| Health | `GET /api/v1/health` | P0 |

### 13.8.3 Test case trọng yếu

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-FOUND-001 | Health check public | Trả trạng thái hệ thống, không lộ secret |
| QA04-FOUND-002 | My apps theo permission | Chỉ trả app user có quyền/được cấu hình |
| QA04-FOUND-003 | Company setting update thiếu quyền | 403 |
| QA04-FOUND-004 | Upload file private | File metadata tạo đúng, không public URL trực tiếp |
| QA04-FOUND-005 | Download file không có quyền | 403/404 |
| QA04-FOUND-006 | File link tới entity ngoài scope | 403/404 |
| QA04-FOUND-007 | Audit log list HR/ATT/LEAVE | Chỉ user có quyền xem audit |
| QA04-FOUND-008 | Sequence preview employee code | Không tăng counter thật nếu chỉ preview |
| QA04-FOUND-009 | Public holiday ảnh hưởng ATT/LEAVE calculation | ATT/LEAVE rule đọc đúng holiday |

---

## 14. Contract Testing

### 14.1 Mô hình contract testing

QA-04 áp dụng 3 lớp contract:

```text
Provider contract
  Backend phải trả đúng OpenAPI schema.

Consumer contract
  Frontend API client/query hook phải gọi đúng endpoint, method, header, body và xử lý đúng schema.

Cross-module internal contract
  Module nghiệp vụ phát event/sync theo đúng payload cho NOTI, DASH, ATT và job nội bộ.
```

### 14.1.1 Provider contract

Backend là provider. Mỗi endpoint phải có:

1. Method.
2. Path.
3. Security scheme.
4. Required permission.
5. Data scope.
6. Path/query params schema.
7. Request body schema.
8. Success response schema.
9. Error response schema.
10. Example hợp lệ.
11. Enum values.
12. Side effect metadata.

### 14.1.2 Consumer contract

Frontend là consumer. Mỗi API service/hook phải test:

1. Gọi đúng method/path.
2. Gửi đúng header `Authorization`, `Content-Type`, `Accept`, `X-Request-Id`, `X-Client-Type`, `X-Client-Version`.
3. Gửi `Idempotency-Key` cho mutation/action quan trọng.
4. Map query params đúng format.
5. Parse response success đúng type.
6. Map error sang UI state đúng.
7. Clear cache đúng khi logout hoặc mutation thành công.

### 14.1.3 Internal contract

Internal API/event phải test:

1. Chỉ gọi được bằng internal auth/system token.
2. Không expose qua public gateway.
3. Payload có `company_id`, `source_module`, `event_code`, `target_type`, `target_id`, `dedupe_key` nếu cần.
4. Retry không tạo trùng nếu có idempotency/dedupe.
5. Không chứa dữ liệu nhạy cảm quá mức.

---

## 15. Quy tắc backward compatibility

### 15.1 Thay đổi không breaking

| Thay đổi | Cho phép? | Điều kiện |
| --- | --- | --- |
| Thêm field optional vào response | Có | Không làm client cũ lỗi |
| Thêm endpoint mới | Có | Có docs và test |
| Thêm query param optional | Có | Có default behavior |
| Thêm enum value | Cẩn thận | Frontend phải có fallback unknown |
| Thêm error code mới | Có | Thuộc error type đã biết |

### 15.2 Breaking change

| Thay đổi | Yêu cầu |
| --- | --- |
| Xóa field response đang dùng | Tăng version hoặc migration plan |
| Đổi tên field | Tăng version hoặc hỗ trợ song song |
| Đổi type field | Tăng version hoặc compatibility adapter |
| Đổi HTTP status chính | Update contract và client đồng bộ |
| Đổi meaning của enum/status | Cần migration note |
| Đổi required permission/scope | Cần security review và regression |
| Xóa endpoint | Deprecation trước, không xóa đột ngột |

### 15.3 CI gate breaking change

CI phải fail nếu:

1. OpenAPI không valid.
2. Xóa operationId đang tồn tại mà chưa có deprecation note.
3. Xóa schema field required.
4. Đổi response type của field.
5. Thiếu error response chuẩn.
6. Endpoint protected thiếu security scheme.
7. Endpoint nghiệp vụ thiếu `x-permission` hoặc `x-data-scopes`.
8. Action quan trọng thiếu `x-idempotency`.

---

## 16. OpenAPI quality checklist

| Checklist ID | Nội dung | Bắt buộc |
| --- | --- | --- |
| QA04-OAS-001 | Có `servers` theo local/dev/staging/prod | Có |
| QA04-OAS-002 | Có security scheme Bearer token | Có |
| QA04-OAS-003 | Operation có `operationId` unique | Có |
| QA04-OAS-004 | Operation có tag theo module | Có |
| QA04-OAS-005 | Operation protected có security | Có |
| QA04-OAS-006 | Operation nghiệp vụ có `x-permission` | Có |
| QA04-OAS-007 | Operation nghiệp vụ có `x-data-scopes` | Có |
| QA04-OAS-008 | POST action quan trọng có `Idempotency-Key` | Có |
| QA04-OAS-009 | List API có pagination schema | Có |
| QA04-OAS-010 | Error response dùng schema chuẩn | Có |
| QA04-OAS-011 | Validation error có details schema | Có |
| QA04-OAS-012 | Enum được khai báo rõ | Có |
| QA04-OAS-013 | File upload dùng multipart schema | Có nếu có file |
| QA04-OAS-014 | Sensitive field có note/masking policy | Nên có |
| QA04-OAS-015 | Internal API tách file contract riêng | Có nếu có internal API |

---

## 17. Tổ chức bộ test tự động

### 17.1 Cấu trúc thư mục đề xuất

```text
tests/
  api/
    common/
      auth.helpers.ts
      data-scope.helpers.ts
      schema.helpers.ts
      idempotency.helpers.ts
      response-standard.spec.ts
      error-standard.spec.ts
    fixtures/
      companies.fixture.ts
      users.fixture.ts
      employees.fixture.ts
      attendance.fixture.ts
      leave.fixture.ts
      task.fixture.ts
      notification.fixture.ts
    modules/
      auth/
        auth-login.spec.ts
        auth-me.spec.ts
        auth-permission.spec.ts
      hr/
        hr-employees.spec.ts
        hr-profile-change.spec.ts
        hr-employee-code.spec.ts
      attendance/
        attendance-today.spec.ts
        attendance-check-in-out.spec.ts
        attendance-records-scope.spec.ts
        attendance-adjustment.spec.ts
        attendance-remote.spec.ts
      leave/
        leave-balance.spec.ts
        leave-request.spec.ts
        leave-approval.spec.ts
        leave-calendar.spec.ts
      task/
        task-project.spec.ts
        task-assignment.spec.ts
        task-comment.spec.ts
        task-kanban.spec.ts
      notification/
        notification-my.spec.ts
        notification-internal-event.spec.ts
      dashboard/
        dashboard-me.spec.ts
        dashboard-widget.spec.ts
      foundation/
        files.spec.ts
        settings.spec.ts
        audit-log.spec.ts
  contract/
    openapi-lint.spec.ts
    openapi-breaking-change.spec.ts
    provider-schema.spec.ts
    consumer-contract.spec.ts
    internal-contract.spec.ts
  reports/
    api-test-report.json
    contract-test-report.json
```

### 17.2 Naming convention test case

```text
QA04-<MODULE>-<GROUP>-<NUMBER>
```

Ví dụ:

```text
QA04-ATT-CHECKIN-001
QA04-LEAVE-APPROVAL-003
QA04-TASK-COMMENT-002
QA04-NOTI-UNREAD-001
```

> **Ghi chú quy ước:** Phần `<GROUP>` là tùy chọn — nhiều test theo module dùng dạng rút gọn `QA04-<MODULE>-<NUMBER>` (vd `QA04-AUTH-001`). Các nhóm cross-cutting dùng prefix riêng (không phải module): `QA04-COM-RESP-*` (response chung), `QA04-GEN-*`, `QA04-SENS-*` (sensitive data), `QA04-FILE-*`, `QA04-SIDE-*` (side effect), `QA04-OAS-*` (OpenAPI).

---

## 18. Test case template cho API

````md
### Test ID
QA04-<MODULE>-<GROUP>-<NUMBER>

### Tên test
<API/action cần kiểm thử>

### Endpoint
<Method> <Path>

### Priority
P0/P1/P2

### Preconditions
- User/role/scope
- Seed data
- Feature flag/config

### Request
Headers:
- Authorization
- Content-Type
- Idempotency-Key nếu cần

Path params:
- ...

Query params:
- ...

Body:
```json
{}
```

### Steps
1. Gọi API.
2. Validate HTTP status.
3. Validate response schema.
4. Validate business result.
5. Validate side effect nếu có.

### Expected result
- Status code
- Response body
- Database/state change
- Audit log
- Notification event
- Cache invalidation

### Negative checks
- Missing token
- Missing permission
- Out-of-scope
- Invalid body/query

### Automation
Automated / Manual / Semi-automated
````

---

## 19. CI/CD API test pipeline

### 19.1 Pull Request pipeline

```text
1. Install dependencies
2. Run OpenAPI lint
3. Run OpenAPI breaking change check
4. Run unit/schema test helpers
5. Start backend test environment
6. Run migration + seed test data
7. Run API smoke tests P0
8. Run module API tests touched by PR
9. Generate report
10. Fail PR if critical test fails
```

### 19.2 Staging deploy pipeline

```text
1. Deploy backend to staging
2. Run health check
3. Run full provider contract tests
4. Run full API regression P0/P1
5. Run permission/data scope matrix
6. Run integration side-effect tests
7. Run frontend consumer contract against staging OpenAPI
8. Publish report
9. Block release if P0/P1 critical fail
```

### 19.3 Nightly pipeline

```text
1. Reset test database or use isolated tenant
2. Seed full data matrix
3. Run all API tests
4. Run fuzz/schema tests for selected endpoints
5. Run internal contract tests
6. Run slow integration tests
7. Export trend report
```

---

## 20. Test data reset và isolation

### 20.1 Nguyên tắc

1. API tests phải chạy độc lập, không phụ thuộc thứ tự nếu có thể.
2. Mỗi test group nên dùng seed riêng hoặc factory riêng.
3. Dữ liệu tạo trong test phải có prefix dễ dọn:

```text
QA04_<MODULE>_<DATE>_<RANDOM>
```

4. Không chạy test destructive trên dữ liệu staging thật nếu chưa có tenant test riêng.
5. Test idempotency/concurrency cần dữ liệu riêng để tránh ảnh hưởng test khác.
6. Test file upload cần cleanup file metadata và storage object sau khi chạy.

### 20.2 Cleanup checklist

| Nhóm | Cleanup |
| --- | --- |
| AUTH | Session test, reset token test |
| HR | Employee test, profile change request test |
| ATT | Attendance record/log/request test |
| LEAVE | Leave request/balance transaction test |
| TASK | Project/task/comment/file test |
| NOTI | Notification/delivery log test |
| DASH | Widget cache/config test |
| FOUNDATION | File metadata/link, audit test nếu được phép cleanup |

---

## 21. Kiểm thử idempotency

### 21.1 API bắt buộc test idempotency

| Module | Action |
| --- | --- |
| AUTH | Forgot password, reset password nếu cần chống lặp |
| HR | Tạo employee, approve profile change |
| ATT | Check-in, check-out, adjustment approve, remote approve, manual adjust |
| LEAVE | Submit request, approve/reject/cancel/revoke, adjust balance |
| TASK | Create task/project nếu có nguy cơ retry, assign task, comment nếu policy yêu cầu |
| NOTI | Internal event, bulk send, system notification |
| FOUNDATION | File upload/link nếu client retry |

### 21.2 Test pattern

```text
1. Gửi request lần 1 với Idempotency-Key = K.
2. Gửi lại request y hệt với K.
3. Gửi lại request khác body nhưng cùng K.
4. Kiểm tra kết quả:
   - Lần 2 không tạo side effect trùng.
   - Lần 3 trả conflict idempotency hoặc policy-defined error.
```

### 21.3 Kỳ vọng side effect

| Side effect | Kỳ vọng khi retry |
| --- | --- |
| DB row | Không tạo row trùng |
| Balance transaction | Không trừ/cộng nhiều lần |
| Audit log | Không spam log hoặc có log idempotent theo policy |
| Notification | Không gửi nhiều notification trùng |
| Dashboard cache | Không invalidate quá mức nếu không cần |

---

## 22. Kiểm thử concurrency và optimistic lock

### 22.1 Tình huống cần test

| Module | Tình huống |
| --- | --- |
| HR | 2 HR cùng cập nhật employee/profile request |
| ATT | 2 approver cùng duyệt adjustment request |
| LEAVE | 2 approver cùng duyệt cùng một đơn nghỉ |
| LEAVE | Employee cancel trong lúc manager approve |
| TASK | 2 user cùng update task status/deadline |
| TASK | Kanban drag/drop đồng thời |
| NOTI | Mark read cùng lúc từ nhiều tab |
| DASH | Admin update widget config đồng thời |

### 22.2 Kỳ vọng

1. Chỉ một transaction thành công.
2. Transaction còn lại trả 409 Conflict hoặc stale version error.
3. Dữ liệu cuối cùng nhất quán.
4. Không double side effect.
5. Response lỗi có format chuẩn.

---

## 23. Kiểm thử permission và data scope chuyên sâu

### 23.1 Ma trận scope tối thiểu

| Endpoint type | Own | Team | Department | Company | System |
| --- | --- | --- | --- | --- | --- |
| Self-service list | Pass | Không áp dụng | Không áp dụng | Không áp dụng | Không áp dụng |
| Admin list | Theo filter | Team only | Department only | Company only | Cross-company nếu endpoint cho phép |
| Detail | Own resource | Team resource | Department resource | Company resource | System resource |
| Action approve | Không tự duyệt nếu policy cấm | Team only | Department only | Company only | System only |
| Export | Own nếu có | Team nếu có | Department nếu có | Company nếu có | System nếu có |

### 23.2 Test access pattern

Mỗi endpoint detail/action phải test:

```text
same user own resource
same company same team
same company other team
same company other department
other company
deleted/soft-deleted resource
inactive employee/user
```

---

## 24. Kiểm thử dữ liệu nhạy cảm và masking

### 24.1 Pattern kiểm thử

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-SENS-001 | User không có quyền sensitive gọi list HR employee | Không có identity/bank/tax field |
| QA04-SENS-002 | User không có quyền sensitive gọi ATT records | GPS/IP/device bị mask/null |
| QA04-SENS-003 | Manager xem leave calendar team | Không thấy lý do nghỉ nhạy cảm |
| QA04-SENS-004 | Notification payload leave | Không chứa reason/file URL private |
| QA04-SENS-005 | Error response từ API sensitive | Không có stack trace/SQL/storage path/token |
| QA04-SENS-006 | Export thiếu quyền sensitive | Export không có field nhạy cảm hoặc bị chặn |

---

## 25. Kiểm thử file API và private asset

### 25.1 Test case bắt buộc

| Test ID | Nội dung | Kỳ vọng |
| --- | --- | --- |
| QA04-FILE-001 | Upload file hợp lệ | Tạo file metadata, private mặc định |
| QA04-FILE-002 | Upload file sai mime type | 400 validation |
| QA04-FILE-003 | Upload file vượt size | 413/400 theo policy |
| QA04-FILE-004 | Download file own/scope hợp lệ | Trả signed URL/blob hợp lệ |
| QA04-FILE-005 | Download file ngoài scope | 403/404 |
| QA04-FILE-006 | Response không trả storage path thật | Không lộ path private |
| QA04-FILE-007 | Link file vào leave/task/hr entity | Link đúng entity, kiểm tra permission |
| QA04-FILE-008 | Delete/unlink file | Soft delete/unlink, không phá entity khác |
| QA04-FILE-009 | Audit file access nếu cấu hình bật | Có file access log |

---

## 26. Kiểm thử side effect giữa module

| Test ID | Trigger | Side effect cần kiểm tra |
| --- | --- | --- |
| QA04-SIDE-001 | HR tạo employee | Audit log, notification nếu cấu hình, user link nếu tạo user |
| QA04-SIDE-002 | HR approve profile change | Cập nhật employee, audit, notification |
| QA04-SIDE-003 | ATT check-in/out | Attendance log, audit optional, dashboard widget refresh |
| QA04-SIDE-004 | ATT adjustment approved | Attendance record update, log, audit, notification, dashboard invalidation |
| QA04-SIDE-005 | LEAVE approved | Balance transaction, leave days, sync ATT, notification, dashboard invalidation |
| QA04-SIDE-006 | LEAVE cancelled/revoked | Release/recalculate, sync ATT, notification, dashboard invalidation |
| QA04-SIDE-007 | TASK assigned | Task assignee, activity log, notification, dashboard task widget invalidation |
| QA04-SIDE-008 | TASK comment mention | Comment, mention row, notification recipient |
| QA04-SIDE-009 | NOTI mark read | Unread count giảm, dashboard notification widget refresh |
| QA04-SIDE-010 | Dashboard config update | Audit log, cache invalidation |

---

## 27. Báo cáo test API

### 27.1 Nội dung báo cáo

Báo cáo API test cần có:

1. Tổng số test case.
2. Số pass/fail/skipped.
3. Pass rate theo module.
4. Pass rate theo priority P0/P1/P2.
5. Danh sách lỗi contract.
6. Danh sách lỗi permission/data scope.
7. Danh sách lỗi business rule.
8. Danh sách lỗi side effect.
9. Danh sách endpoint chưa có test.
10. Danh sách endpoint chưa có OpenAPI schema/example.

### 27.2 Format report đề xuất

```json
{
  "run_id": "qa04_20260620_001",
  "environment": "staging",
  "started_at": "2026-06-20T20:00:00+07:00",
  "finished_at": "2026-06-20T20:12:00+07:00",
  "summary": {
    "total": 420,
    "passed": 410,
    "failed": 8,
    "skipped": 2,
    "pass_rate": 97.61
  },
  "by_module": {
    "AUTH": { "passed": 40, "failed": 0 },
    "HR": { "passed": 70, "failed": 1 },
    "ATT": { "passed": 80, "failed": 2 },
    "LEAVE": { "passed": 75, "failed": 1 },
    "TASK": { "passed": 60, "failed": 1 },
    "NOTI": { "passed": 45, "failed": 1 },
    "DASH": { "passed": 30, "failed": 1 },
    "FOUNDATION": { "passed": 10, "failed": 1 }
  }
}
```

---

## 28. Quy tắc phân loại lỗi API

| Severity | Điều kiện |
| --- | --- |
| Blocker | Lộ dữ liệu cross-tenant, auth bypass, permission bypass, mất dữ liệu, API P0 không chạy |
| Critical | Business rule P0 sai, double deduct balance, double approve, response contract P0 breaking |
| Major | API P1 lỗi, pagination/filter/sort sai, masking sai nhưng chưa lộ dữ liệu cực nhạy cảm |
| Minor | Message sai, metadata thiếu ở API ít dùng, docs/example lệch nhỏ |
| Trivial | Typo trong message/docs không ảnh hưởng test |

---

## 29. Entry/exit criteria

### 29.1 Entry criteria

QA-04 chỉ bắt đầu khi:

1. API route MVP đã có danh sách endpoint.
2. OpenAPI draft đã có tối thiểu endpoint P0.
3. Test environment có database và seed cơ bản.
4. Có test user/token cho các role/scope chính.
5. Backend có error handler/response transformer chuẩn.
6. QA có quyền truy cập log/report cần thiết.

### 29.2 Exit criteria

QA-04 được xem là đạt khi:

1. 100% endpoint P0 có contract test.
2. 100% endpoint P0 có functional API test happy path và negative auth/permission/scope.
3. 100% action P0 có idempotency test nếu contract yêu cầu.
4. 100% list API P0 có pagination/filter/sort validation test.
5. 100% endpoint P0 pass response schema chuẩn.
6. Không còn Blocker/Critical bug mở.
7. Major bug còn lại có workaround hoặc được Product/Tech Lead chấp nhận.
8. API contract được publish cho frontend và QA automation.
9. CI chạy được API smoke + contract test.

---

## 30. Checklist nghiệm thu QA-04

| Checklist | Có/Không | Ghi chú |
| --- | --- | --- |
| OpenAPI public đã có đủ endpoint P0/P1 |  |  |
| OpenAPI internal đã tách riêng |  |  |
| Tất cả endpoint protected có security scheme |  |  |
| Tất cả endpoint nghiệp vụ có permission/scope metadata |  |  |
| Response success/error schema thống nhất |  |  |
| Error catalog có mã lỗi chuẩn |  |  |
| Test user/seed data đủ role/scope |  |  |
| API smoke test chạy được trên CI |  |  |
| Contract lint chạy được trên CI |  |  |
| Breaking change check chạy được trên CI |  |  |
| Permission/data scope test P0 pass |  |  |
| Idempotency test P0 pass |  |  |
| Side effect test P0 pass |  |  |
| File/private asset test pass |  |  |
| Báo cáo test tự động được publish |  |  |

---

## 31. Rủi ro và biện pháp giảm thiểu

| Rủi ro | Ảnh hưởng | Biện pháp |
| --- | --- | --- |
| OpenAPI không đồng bộ code thật | Frontend/QA test sai contract | Generate OpenAPI từ code hoặc validate runtime response theo schema |
| Seed data không ổn định | Test flaky | Dùng factory, reset DB, tenant test riêng |
| Permission matrix thay đổi liên tục | Test scope fail nhiều | Tách permission seed thành fixture versioned |
| API trả dữ liệu nhạy cảm ở list | Rủi ro bảo mật | Thêm sensitive field scanner trong API tests |
| Idempotency chưa triển khai đồng đều | Retry tạo trùng dữ liệu | Bắt buộc CI gate cho action quan trọng |
| Dashboard phụ thuộc nhiều module | Test flaky khi module nguồn lỗi | Mock source hoặc có degraded-state contract |
| Internal API bị expose nhầm | Rủi ro bảo mật | Gateway route test, internal auth test |
| Contract breaking change không bị phát hiện | Frontend lỗi sau deploy | OpenAPI diff gate trên CI |

---

## 32. Kết luận

QA-04 chốt chiến lược kiểm thử API và contract cho MVP của hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này đảm bảo API không chỉ chạy đúng happy path, mà còn đúng chuẩn contract, đúng bảo mật, đúng permission/data scope, đúng business rule, đúng side effect và đủ khả năng tự động hóa trên CI.

Khi QA-04 được triển khai đầy đủ, Backend có thể tự tin publish API contract, Frontend có thể tích hợp API client/query layer ổn định, QA có thể phát hiện sớm lỗi breaking change, lỗi phân quyền, lỗi dữ liệu nhạy cảm và lỗi nghiệp vụ trước khi release.

---

## 33. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: chiến lược, phạm vi, tiêu chí |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Ma trận test case theo module/role/scope |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Flow nghiệp vụ xuyên module dùng API này |
| **QA-04 (tài liệu này)** | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope, field/route guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
