# API-03: HR API DESIGN

**MODULE QUẢN LÝ NHÂN SỰ - HUMAN RESOURCE API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · **API-03 HR** · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-03 HR](<../SPEC/SPEC-03 HR.md>) · [Thiết kế DB: DB-03 HR](<../DB/DB-03_HR Database Design.md>) · [Sản phẩm: PRD-00 §9.2](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-03 |
| Tên tài liệu | HR API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | HR - Quản lý nhân sự |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01, API-02 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **HR - Quản lý nhân sự** của hệ thống quản lý doanh nghiệp nội bộ.

Module HR là nguồn dữ liệu nhân sự trung tâm cho toàn bộ hệ thống, bao gồm:

1. Hồ sơ nhân viên.
2. Thông tin cá nhân.
3. Thông tin công việc.
4. Phòng ban.
5. Chức vụ.
6. Cấp bậc.
7. Quản lý trực tiếp.
8. Hợp đồng lao động.
9. Trạng thái làm việc.
10. File hồ sơ nhân viên.
11. Liên kết employee với user trong AUTH.
12. Employee Self-Service có kiểm duyệt.
13. Cấu hình sinh mã nhân viên tự động.
14. Lịch sử thay đổi hồ sơ nhân viên.
15. Dữ liệu nền cho ATT, LEAVE, TASK, DASH, NOTI và các module phase sau.

Tài liệu API-03 dùng làm cơ sở cho:

1. Backend triển khai controller, route, DTO, validation, service và repository cho HR.
2. Frontend triển khai màn hình danh sách nhân viên, hồ sơ nhân viên, phòng ban, chức vụ, hợp đồng và yêu cầu cập nhật hồ sơ cá nhân.
3. QA viết API test case, permission test, data scope test và regression test cho HR.
4. DevOps/API documentation tạo OpenAPI/Swagger cho module HR.
5. Các module khác tích hợp dữ liệu nhân sự đúng chuẩn.

---

## 3. Căn cứ thiết kế

API-03 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định tất cả API dùng prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business rule, audit log và notification event.
2. **SPEC-03** xác định HR là module quản lý nhân sự trung tâm, có Employee Self-Service cần HR/Admin duyệt trước khi áp dụng, và mã nhân viên mặc định do hệ thống sinh theo cấu hình.
3. **DB-03** xác định `employees` là bảng trung tâm; `profile_change_requests` và `profile_change_request_items` dùng cho self-service; `employee_code_configs` và `sequence_counters` dùng cho sinh mã nhân viên; dữ liệu nhạy cảm phải kiểm soát bằng field-level permission.
4. **SPEC-02/API-02 AUTH** là nền tảng xác thực, phân quyền, user-role-permission và data scope.
5. **DB-08 FOUNDATION** cung cấp audit log, file service, setting service, sequence service và public infrastructure dùng chung.
6. **SPEC-04/05/06/07/08** sử dụng dữ liệu HR để vận hành chấm công, nghỉ phép, task, dashboard và notification.

---

## 4. Phạm vi API-03

### 4.1 Bao gồm trong MVP

API-03 bao gồm các nhóm API sau:

| Nhóm API | Mô tả |
| --- | --- |
| Employee API | Danh sách, chi tiết, tạo, cập nhật, đổi trạng thái, xóa mềm nhân viên |
| My Profile API | Employee xem hồ sơ cá nhân của chính mình |
| Profile Change Request API | Employee gửi yêu cầu cập nhật hồ sơ, HR/Admin duyệt hoặc từ chối |
| Department API | Quản lý phòng ban/cây tổ chức |
| Position API | Quản lý chức vụ/vị trí |
| Job Level API | Quản lý cấp bậc nhân sự cơ bản |
| Contract Type API | Quản lý loại hợp đồng |
| Employee Contract API | Quản lý hợp đồng của nhân viên |
| Employee File API | Upload, xem, tải, xóa mềm file hồ sơ nhân viên |
| Employee User Link API | Liên kết/hủy liên kết employee với user AUTH |
| Employee Code API | Xem cấu hình, cập nhật cấu hình, preview mã nhân viên tiếp theo |
| HR Audit API | Xem lịch sử thay đổi hồ sơ nhân viên |
| Export API | Xuất danh sách nhân viên theo bộ lọc và quyền |
| Org Chart API | Lấy sơ đồ tổ chức cơ bản |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Import nhân viên Excel | Phase sau | `/api/v1/hr/imports` |
| Onboarding workflow | Phase sau | `/api/v1/hr/onboarding-flows` |
| Offboarding workflow | Phase sau | `/api/v1/hr/offboarding-flows` |
| Khen thưởng/kỷ luật | Phase sau | `/api/v1/hr/rewards`, `/api/v1/hr/disciplinary-actions` |
| Đánh giá hiệu suất | Phase sau | `/api/v1/hr/performance-reviews` |
| Bảo hiểm/thuế | Phase sau | Tách quyền nhạy cảm riêng |
| E-sign hợp đồng | Phase sau | Tích hợp signing provider |
| Sơ đồ tổ chức nâng cao | Phase sau | API tree nâng cao, drag/drop, versioning |
| Đồng bộ danh bạ | Phase sau | Google/Microsoft directory sync |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint HR dùng prefix:

```http
/api/v1/hr
```

Ví dụ:

```http
GET    /api/v1/hr/employees
POST   /api/v1/hr/employees
GET    /api/v1/hr/employees/{employee_id}
PATCH  /api/v1/hr/employees/{employee_id}
GET    /api/v1/hr/departments
POST   /api/v1/hr/profile-change-requests/{request_id}/approve
```

---

### 5.2 Authentication

Tất cả API HR yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint HR public trong MVP.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ HR thông thường.

Quy tắc:

1. Mọi query HR phải filter theo `company_id`.
2. Super Admin có scope `System` mới được truy vấn liên công ty.
3. Nếu request có `company_id` trong body mà endpoint không cho phép, backend bỏ qua hoặc trả validation error.
4. Không trả dữ liệu của công ty khác kể cả khi biết UUID.

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
permission + data_scope + target resource + business validation
```

`Allowed roles` trong tài liệu chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định.

---

### 6.2 Scope chuẩn trong HR

| Scope | Ý nghĩa trong HR |
| --- | --- |
| `Own` | Chỉ xem hoặc thao tác dữ liệu của employee liên kết với user hiện tại |
| `Team` | Xem nhân viên có `direct_manager_id` là employee của user hiện tại hoặc thuộc team quản lý |
| `Department` | Xem nhân viên thuộc phòng ban user quản lý hoặc được phân quyền |
| `Company` | Xem toàn bộ nhân viên trong công ty hiện tại |
| `System` | Xem liên công ty, chỉ dành cho Super Admin |

---

### 6.3 Quyền HR trong MVP

| Permission | Mục đích |
| --- | --- |
| `HR.EMPLOYEE.VIEW` | Xem danh sách và hồ sơ nhân viên |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | Xem dữ liệu nhạy cảm trong hồ sơ nhân viên |
| `HR.EMPLOYEE.CREATE` | Tạo hồ sơ nhân viên |
| `HR.EMPLOYEE.UPDATE` | Cập nhật hồ sơ nhân viên |
| `HR.EMPLOYEE.CHANGE_STATUS` | Đổi trạng thái nhân viên |
| `HR.EMPLOYEE.DELETE` | Xóa mềm/vô hiệu hóa nhân viên |
| `HR.EMPLOYEE.EXPORT` | Xuất danh sách nhân viên |
| `HR.EMPLOYEE.FILE_VIEW` | Xem file hồ sơ nhân viên |
| `HR.EMPLOYEE.FILE_UPLOAD` | Upload file hồ sơ nhân viên |
| `HR.EMPLOYEE.FILE_DELETE` | Xóa file hồ sơ nhân viên |
| `HR.DEPARTMENT.VIEW` | Xem phòng ban |
| `HR.DEPARTMENT.CREATE` | Tạo phòng ban |
| `HR.DEPARTMENT.UPDATE` | Cập nhật phòng ban |
| `HR.DEPARTMENT.DELETE` | Xóa mềm phòng ban |
| `HR.POSITION.VIEW` | Xem chức vụ |
| `HR.POSITION.CREATE` | Tạo chức vụ |
| `HR.POSITION.UPDATE` | Cập nhật chức vụ |
| `HR.POSITION.DELETE` | Xóa mềm chức vụ |
| `HR.CONTRACT.VIEW` | Xem hợp đồng nhân viên |
| `HR.CONTRACT.CREATE` | Tạo hợp đồng nhân viên |
| `HR.CONTRACT.UPDATE` | Cập nhật hợp đồng nhân viên |
| `HR.CONTRACT.DELETE` | Xóa mềm hợp đồng nhân viên |
| `HR.AUDIT_LOG.VIEW` | Xem lịch sử thay đổi hồ sơ |
| `HR.ORG_CHART.VIEW` | Xem sơ đồ tổ chức cơ bản |
| `HR.MASTER_DATA.MANAGE` | Quản lý dữ liệu danh mục HR |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | Employee gửi yêu cầu cập nhật hồ sơ cá nhân |
| `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | Employee xem yêu cầu của chính mình |
| `HR.PROFILE_CHANGE_REQUEST.VIEW` | HR/Admin xem danh sách yêu cầu cập nhật hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | HR/Admin duyệt yêu cầu cập nhật hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.REJECT` | HR/Admin từ chối yêu cầu cập nhật hồ sơ |
| `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` | Employee hủy yêu cầu của chính mình khi còn Pending |
| `HR.EMPLOYEE_CODE_CONFIG.VIEW` | Xem cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE_CONFIG.UPDATE` | Cập nhật cấu hình mã nhân viên |
| `HR.EMPLOYEE_CODE.PREVIEW` | Xem trước mã nhân viên tiếp theo |
| `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | Sửa mã nhân viên thủ công nếu cấu hình cho phép |

---

## 7. Dữ liệu nhạy cảm và field masking

### 7.1 Trường nhạy cảm

Các field sau được xem là nhạy cảm trong HR:

```text
date_of_birth
identity_number
identity_issue_date
identity_issue_place
tax_code
bank_account_number
bank_name
personal_email
phone
address
current_address
permanent_address
emergency_contact_name
emergency_contact_phone
contract_salary nếu phase sau bổ sung
file hồ sơ nhạy cảm
```

---

### 7.2 Nguyên tắc trả dữ liệu nhạy cảm

1. Nếu user thiếu `HR.EMPLOYEE.VIEW_SENSITIVE`, backend không trả field nhạy cảm hoặc trả masked value.
2. Danh sách nhân viên mặc định không trả dữ liệu nhạy cảm.
3. Chi tiết nhân viên chỉ trả dữ liệu nhạy cảm nếu user có permission và target nằm trong data scope.
4. Export chỉ bao gồm dữ liệu nhạy cảm nếu user có cả `HR.EMPLOYEE.EXPORT` và `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc quyền export sensitive riêng nếu bổ sung.
5. File hồ sơ nhạy cảm cần kiểm tra `HR.EMPLOYEE.FILE_VIEW` và data scope trước khi cấp download URL.
6. Có thể ghi audit log cả hành động xem/tải dữ liệu nhạy cảm nếu cấu hình bật.

---

### 7.3 Ví dụ masking

```json
{
  "identity_number": "********1234",
  "bank_account_number": "********9012",
  "phone": "******789",
  "personal_email": "n***@gmail.com"
}
```

Nếu không muốn masking, backend có thể loại bỏ field khỏi response:

```json
{
  "full_name": "Nguyễn Văn A",
  "department": {
    "id": "...",
    "name": "Phòng Kỹ thuật"
  }
}
```

---

## 8. DTO dùng chung

### 8.1 Employee summary DTO

Dùng cho list, dropdown, người quản lý trực tiếp, project member, approver.

```json
{
  "id": "8b9f1d8a-2c4e-4f9c-9a21-4f1e2b000001",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "company_email": "nguyenvana@company.com",
  "avatar": {
    "file_id": "f1d2c3b4-0000-0000-0000-000000000001",
    "download_url": "https://...signed-url"
  },
  "department": {
    "id": "dep-uuid",
    "name": "Phòng Kỹ thuật"
  },
  "position": {
    "id": "pos-uuid",
    "name": "Developer"
  },
  "employment_status": "Official"
}
```

---

### 8.2 Employee detail DTO

```json
{
  "id": "8b9f1d8a-2c4e-4f9c-9a21-4f1e2b000001",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "first_name": "A",
  "last_name": "Nguyễn Văn",
  "gender": "Male",
  "date_of_birth": "1995-01-01",
  "personal_email": "nguyenvana@gmail.com",
  "company_email": "nguyenvana@company.com",
  "phone": "0900000000",
  "address": "Hà Nội",
  "identity_number": "012345678901",
  "tax_code": "1234567890",
  "bank_account_number": "1234567890123",
  "bank_name": "VCB",
  "department": {
    "id": "dep-uuid",
    "department_code": "DEV",
    "name": "Phòng Kỹ thuật"
  },
  "position": {
    "id": "pos-uuid",
    "position_code": "DEV",
    "name": "Developer"
  },
  "job_level": {
    "id": "level-uuid",
    "level_code": "MIDDLE",
    "name": "Middle"
  },
  "direct_manager": {
    "id": "manager-uuid",
    "employee_code": "EMP0002",
    "full_name": "Trần Thị B"
  },
  "joined_date": "2026-01-01",
  "official_date": "2026-03-01",
  "probation_end_date": "2026-02-28",
  "resigned_date": null,
  "employment_status": "Official",
  "employee_type": "Full-time",
  "work_location": "Hanoi Office",
  "user": {
    "id": "user-uuid",
    "email": "nguyenvana@company.com",
    "status": "Active"
  },
  "is_employee_code_locked": true,
  "created_at": "2026-06-20T10:00:00+07:00",
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

> Lưu ý: Các field nhạy cảm trong DTO trên chỉ trả khi user có quyền phù hợp.

---

### 8.3 Department DTO

```json
{
  "id": "dep-uuid",
  "department_code": "DEV",
  "name": "Phòng Kỹ thuật",
  "description": "Phòng phát triển sản phẩm",
  "parent_id": null,
  "manager_employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0002",
    "full_name": "Trần Thị B"
  },
  "status": "Active",
  "sort_order": 1,
  "children": []
}
```

---

### 8.4 Position DTO

```json
{
  "id": "pos-uuid",
  "position_code": "DEV",
  "name": "Developer",
  "description": "Lập trình viên",
  "department": {
    "id": "dep-uuid",
    "name": "Phòng Kỹ thuật"
  },
  "job_level": {
    "id": "level-uuid",
    "name": "Middle"
  },
  "status": "Active"
}
```

---

### 8.5 Employee contract DTO

```json
{
  "id": "contract-uuid",
  "employee_id": "employee-uuid",
  "contract_type": {
    "id": "contract-type-uuid",
    "name": "Hợp đồng xác định thời hạn"
  },
  "contract_code": "HD-2026-0001",
  "title": "Hợp đồng lao động 12 tháng",
  "start_date": "2026-01-01",
  "end_date": "2026-12-31",
  "signed_date": "2025-12-25",
  "status": "Active",
  "is_primary": true,
  "file": {
    "file_id": "file-uuid",
    "file_name": "contract.pdf",
    "mime_type": "application/pdf",
    "size": 1200000
  }
}
```

---

### 8.6 Profile change request DTO

```json
{
  "id": "request-uuid",
  "request_code": "PCR-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "status": "Pending",
  "reason": "Cập nhật số điện thoại mới",
  "items": [
    {
      "field_name": "phone",
      "old_value": "0900000000",
      "new_value": "0911111111",
      "status": "Pending"
    }
  ],
  "submitted_at": "2026-06-20T10:00:00+07:00",
  "reviewed_by": null,
  "reviewed_at": null,
  "review_note": null
}
```

---

## 9. Query params chuẩn

### 9.1 Pagination

Các API list dùng:

| Param | Mặc định | Giới hạn | Mô tả |
| --- | ---: | ---: | --- |
| `page` | 1 | >= 1 | Trang hiện tại |
| `per_page` | 20 | 1 - 100 | Số bản ghi mỗi trang |

---

### 9.2 Search

```http
GET /api/v1/hr/employees?search=nguyen
```

Các field search cho employee:

```text
employee_code
full_name
company_email
phone nếu có quyền xem field này
```

---

### 9.3 Sort

Format:

```http
GET /api/v1/hr/employees?sort=created_at:desc
```

Sort whitelist cho employee:

```text
created_at
updated_at
employee_code
full_name
joined_date
employment_status
```

Mặc định:

```text
created_at:desc
```

Nếu sort field không hợp lệ, trả `VALIDATION-ERR-001`.

---

### 9.4 Filter employee

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `department_id` | UUID | Lọc theo phòng ban |
| `position_id` | UUID | Lọc theo chức vụ |
| `job_level_id` | UUID | Lọc theo cấp bậc |
| `direct_manager_id` | UUID | Lọc theo quản lý trực tiếp |
| `employment_status` | String | Probation/Official/Temporarily Suspended/Resigned/Terminated |
| `employee_type` | String | Full-time/Part-time/Intern/Contractor |
| `joined_from` | Date | Ngày vào làm từ |
| `joined_to` | Date | Ngày vào làm đến |
| `contract_type_id` | UUID | Lọc theo loại hợp đồng chính |
| `has_user` | Boolean | Có liên kết user hay chưa |
| `include_deleted` | Boolean | Chỉ role đặc biệt hoặc permission riêng mới dùng |

---

## 10. Danh sách endpoint tổng quan

### 10.1 Employee API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-001 | GET | `/api/v1/hr/employees` | Lấy danh sách nhân viên | `HR.EMPLOYEE.VIEW` |
| HR-API-002 | POST | `/api/v1/hr/employees` | Tạo nhân viên mới | `HR.EMPLOYEE.CREATE` |
| HR-API-003 | GET | `/api/v1/hr/employees/{employee_id}` | Lấy chi tiết nhân viên | `HR.EMPLOYEE.VIEW` |
| HR-API-004 | PATCH | `/api/v1/hr/employees/{employee_id}` | Cập nhật hồ sơ nhân viên | `HR.EMPLOYEE.UPDATE` |
| HR-API-005 | DELETE | `/api/v1/hr/employees/{employee_id}` | Xóa mềm nhân viên | `HR.EMPLOYEE.DELETE` |
| HR-API-006 | POST | `/api/v1/hr/employees/{employee_id}/change-status` | Đổi trạng thái nhân viên | `HR.EMPLOYEE.CHANGE_STATUS` |
| HR-API-007 | POST | `/api/v1/hr/employees/{employee_id}/link-user` | Liên kết employee với user | `HR.EMPLOYEE.UPDATE` |
| HR-API-008 | DELETE | `/api/v1/hr/employees/{employee_id}/link-user` | Hủy liên kết employee-user | `HR.EMPLOYEE.UPDATE` |
| HR-API-009 | GET | `/api/v1/hr/employees/export` | Xuất danh sách nhân viên | `HR.EMPLOYEE.EXPORT` |
| HR-API-010 | GET | `/api/v1/hr/employees/{employee_id}/audit-logs` | Lịch sử thay đổi hồ sơ | `HR.AUDIT_LOG.VIEW` |
| HR-API-011 | GET | `/api/v1/hr/employees/lookup` | Lookup nhân viên cho dropdown | `HR.EMPLOYEE.VIEW` |

---

### 10.2 My Profile API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-101 | GET | `/api/v1/hr/me/profile` | Xem hồ sơ cá nhân của tôi | `HR.EMPLOYEE.VIEW` scope Own |
| HR-API-102 | GET | `/api/v1/hr/me/profile/editable-fields` | Lấy danh sách field được phép đề xuất sửa | `HR.PROFILE_CHANGE_REQUEST.CREATE` |
| HR-API-103 | GET | `/api/v1/hr/me/profile-change-requests` | Yêu cầu cập nhật hồ sơ của tôi | `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` |
| HR-API-104 | POST | `/api/v1/hr/me/profile-change-requests` | Gửi yêu cầu cập nhật hồ sơ | `HR.PROFILE_CHANGE_REQUEST.CREATE` |
| HR-API-105 | GET | `/api/v1/hr/me/profile-change-requests/{request_id}` | Chi tiết yêu cầu của tôi | `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` |
| HR-API-106 | POST | `/api/v1/hr/me/profile-change-requests/{request_id}/cancel` | Hủy yêu cầu của tôi | `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` |

---

### 10.3 Profile Change Request Admin API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-201 | GET | `/api/v1/hr/profile-change-requests` | Danh sách yêu cầu cập nhật hồ sơ | `HR.PROFILE_CHANGE_REQUEST.VIEW` |
| HR-API-202 | GET | `/api/v1/hr/profile-change-requests/{request_id}` | Chi tiết yêu cầu cập nhật hồ sơ | `HR.PROFILE_CHANGE_REQUEST.VIEW` |
| HR-API-203 | POST | `/api/v1/hr/profile-change-requests/{request_id}/approve` | Duyệt yêu cầu cập nhật hồ sơ | `HR.PROFILE_CHANGE_REQUEST.APPROVE` |
| HR-API-204 | POST | `/api/v1/hr/profile-change-requests/{request_id}/reject` | Từ chối yêu cầu cập nhật hồ sơ | `HR.PROFILE_CHANGE_REQUEST.REJECT` |

---

### 10.4 Department API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-301 | GET | `/api/v1/hr/departments` | Lấy danh sách phòng ban | `HR.DEPARTMENT.VIEW` |
| HR-API-302 | GET | `/api/v1/hr/departments/tree` | Lấy cây phòng ban | `HR.DEPARTMENT.VIEW` |
| HR-API-303 | GET | `/api/v1/hr/departments/{department_id}` | Chi tiết phòng ban | `HR.DEPARTMENT.VIEW` |
| HR-API-304 | POST | `/api/v1/hr/departments` | Tạo phòng ban | `HR.DEPARTMENT.CREATE` |
| HR-API-305 | PATCH | `/api/v1/hr/departments/{department_id}` | Cập nhật phòng ban | `HR.DEPARTMENT.UPDATE` |
| HR-API-306 | DELETE | `/api/v1/hr/departments/{department_id}` | Xóa mềm phòng ban | `HR.DEPARTMENT.DELETE` |

---

### 10.5 Position API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-401 | GET | `/api/v1/hr/positions` | Lấy danh sách chức vụ | `HR.POSITION.VIEW` |
| HR-API-402 | GET | `/api/v1/hr/positions/{position_id}` | Chi tiết chức vụ | `HR.POSITION.VIEW` |
| HR-API-403 | POST | `/api/v1/hr/positions` | Tạo chức vụ | `HR.POSITION.CREATE` |
| HR-API-404 | PATCH | `/api/v1/hr/positions/{position_id}` | Cập nhật chức vụ | `HR.POSITION.UPDATE` |
| HR-API-405 | DELETE | `/api/v1/hr/positions/{position_id}` | Xóa mềm chức vụ | `HR.POSITION.DELETE` |

---

### 10.6 Job Level API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-501 | GET | `/api/v1/hr/job-levels` | Lấy danh sách cấp bậc | `HR.MASTER_DATA.MANAGE` hoặc `HR.EMPLOYEE.VIEW` |
| HR-API-502 | GET | `/api/v1/hr/job-levels/{job_level_id}` | Chi tiết cấp bậc | `HR.MASTER_DATA.MANAGE` |
| HR-API-503 | POST | `/api/v1/hr/job-levels` | Tạo cấp bậc | `HR.MASTER_DATA.MANAGE` |
| HR-API-504 | PATCH | `/api/v1/hr/job-levels/{job_level_id}` | Cập nhật cấp bậc | `HR.MASTER_DATA.MANAGE` |
| HR-API-505 | DELETE | `/api/v1/hr/job-levels/{job_level_id}` | Xóa mềm cấp bậc | `HR.MASTER_DATA.MANAGE` |

---

### 10.7 Contract Type API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-601 | GET | `/api/v1/hr/contract-types` | Lấy danh sách loại hợp đồng | `HR.CONTRACT.VIEW` |
| HR-API-602 | GET | `/api/v1/hr/contract-types/{contract_type_id}` | Chi tiết loại hợp đồng | `HR.CONTRACT.VIEW` |
| HR-API-603 | POST | `/api/v1/hr/contract-types` | Tạo loại hợp đồng | `HR.MASTER_DATA.MANAGE` |
| HR-API-604 | PATCH | `/api/v1/hr/contract-types/{contract_type_id}` | Cập nhật loại hợp đồng | `HR.MASTER_DATA.MANAGE` |
| HR-API-605 | DELETE | `/api/v1/hr/contract-types/{contract_type_id}` | Xóa mềm loại hợp đồng | `HR.MASTER_DATA.MANAGE` |

---

### 10.8 Employee Contract API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-701 | GET | `/api/v1/hr/employees/{employee_id}/contracts` | Danh sách hợp đồng của nhân viên | `HR.CONTRACT.VIEW` |
| HR-API-702 | GET | `/api/v1/hr/employees/{employee_id}/contracts/{contract_id}` | Chi tiết hợp đồng | `HR.CONTRACT.VIEW` |
| HR-API-703 | POST | `/api/v1/hr/employees/{employee_id}/contracts` | Tạo hợp đồng | `HR.CONTRACT.CREATE` |
| HR-API-704 | PATCH | `/api/v1/hr/employees/{employee_id}/contracts/{contract_id}` | Cập nhật hợp đồng | `HR.CONTRACT.UPDATE` |
| HR-API-705 | DELETE | `/api/v1/hr/employees/{employee_id}/contracts/{contract_id}` | Xóa mềm hợp đồng | `HR.CONTRACT.DELETE` |
| HR-API-706 | POST | `/api/v1/hr/employees/{employee_id}/contracts/{contract_id}/set-primary` | Đặt hợp đồng chính | `HR.CONTRACT.UPDATE` |

---

### 10.9 Employee File API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-801 | GET | `/api/v1/hr/employees/{employee_id}/files` | Danh sách file hồ sơ | `HR.EMPLOYEE.FILE_VIEW` |
| HR-API-802 | POST | `/api/v1/hr/employees/{employee_id}/files` | Upload/link file hồ sơ | `HR.EMPLOYEE.FILE_UPLOAD` |
| HR-API-803 | GET | `/api/v1/hr/employees/{employee_id}/files/{file_id}` | Chi tiết metadata file | `HR.EMPLOYEE.FILE_VIEW` |
| HR-API-804 | GET | `/api/v1/hr/employees/{employee_id}/files/{file_id}/download-url` | Lấy signed download URL | `HR.EMPLOYEE.FILE_VIEW` |
| HR-API-805 | DELETE | `/api/v1/hr/employees/{employee_id}/files/{file_id}` | Xóa/unlink file hồ sơ | `HR.EMPLOYEE.FILE_DELETE` |

---

### 10.10 Employee Code API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-901 | GET | `/api/v1/hr/employee-code-config` | Xem cấu hình sinh mã | `HR.EMPLOYEE_CODE_CONFIG.VIEW` |
| HR-API-902 | PATCH | `/api/v1/hr/employee-code-config` | Cập nhật cấu hình sinh mã | `HR.EMPLOYEE_CODE_CONFIG.UPDATE` |
| HR-API-903 | POST | `/api/v1/hr/employee-code/preview` | Preview mã nhân viên tiếp theo | `HR.EMPLOYEE_CODE.PREVIEW` |
| HR-API-904 | POST | `/api/v1/hr/employees/{employee_id}/unlock-employee-code` | Mở khóa sửa mã nhân viên | `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` |
| HR-API-905 | POST | `/api/v1/hr/employees/{employee_id}/lock-employee-code` | Khóa sửa mã nhân viên | `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` |

---

### 10.11 Org Chart API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-API-1001 | GET | `/api/v1/hr/org-chart` | Lấy sơ đồ tổ chức cơ bản | `HR.ORG_CHART.VIEW` |
| HR-API-1002 | GET | `/api/v1/hr/employees/{employee_id}/subordinates` | Lấy cấp dưới trực tiếp/gián tiếp | `HR.EMPLOYEE.VIEW` |

---

## 11. Chi tiết API Employee

### 11.1 HR-API-001: Lấy danh sách nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees` |
| Required permission | `HR.EMPLOYEE.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR, Manager |
| Data scope | Own, Team, Department, Company, System |
| Audit log | Không bắt buộc với list thông thường; có thể log nếu truy vấn dữ liệu nhạy cảm |
| Notification event | Không |

#### Query params

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `page` | Number | Không | Trang hiện tại |
| `per_page` | Number | Không | Số bản ghi/trang, tối đa 100 |
| `search` | String | Không | Tìm theo mã nhân viên, họ tên, email, phone nếu có quyền |
| `department_id` | UUID | Không | Lọc theo phòng ban |
| `position_id` | UUID | Không | Lọc theo chức vụ |
| `job_level_id` | UUID | Không | Lọc theo cấp bậc |
| `direct_manager_id` | UUID | Không | Lọc theo quản lý trực tiếp |
| `employment_status` | String | Không | Lọc theo trạng thái |
| `employee_type` | String | Không | Lọc theo loại nhân viên |
| `joined_from` | Date | Không | Ngày vào làm từ |
| `joined_to` | Date | Không | Ngày vào làm đến |
| `has_user` | Boolean | Không | Có liên kết tài khoản hay chưa |
| `sort` | String | Không | Ví dụ `created_at:desc` |

#### Business validation

1. User phải có permission `HR.EMPLOYEE.VIEW`.
2. Backend áp dụng data scope để giới hạn kết quả.
3. Employee role scope Own không được dùng endpoint list toàn công ty; nếu gọi, chỉ trả chính mình hoặc trả 403 tùy chính sách.
4. Manager scope Team chỉ thấy nhân viên thuộc team mình.
5. HR scope Company thấy toàn bộ nhân viên trong công ty.
6. Không trả dữ liệu nhạy cảm ở list mặc định.
7. Query luôn filter `company_id` từ auth context.
8. Không trả employee `deleted_at IS NOT NULL` trừ khi có quyền đặc biệt và `include_deleted=true` được cho phép.

#### Response mẫu

```json
{
  "success": true,
  "message": "Lấy danh sách nhân viên thành công",
  "data": [
    {
      "id": "8b9f1d8a-2c4e-4f9c-9a21-4f1e2b000001",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "company_email": "nguyenvana@company.com",
      "department": {
        "id": "dep-uuid",
        "name": "Phòng Kỹ thuật"
      },
      "position": {
        "id": "pos-uuid",
        "name": "Developer"
      },
      "direct_manager": {
        "id": "manager-uuid",
        "full_name": "Trần Thị B"
      },
      "joined_date": "2026-01-01",
      "employment_status": "Official"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000101",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.2 HR-API-002: Tạo nhân viên mới

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employees` |
| Required permission | `HR.EMPLOYEE.CREATE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_CREATED`, `AUTH_USER_CREATED` nếu tạo user |
| Idempotency | Bắt buộc khuyến nghị qua `Idempotency-Key` |

#### Header

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: 9f3f4c37-1b85-4a7a-a8cd-1f1f45d00001
```

#### Request body

```json
{
  "employee_code": null,
  "full_name": "Nguyễn Văn A",
  "gender": "Male",
  "date_of_birth": "1995-01-01",
  "personal_email": "nguyenvana@gmail.com",
  "company_email": "nguyenvana@company.com",
  "phone": "0900000000",
  "address": "Hà Nội",
  "identity_number": "012345678901",
  "tax_code": "1234567890",
  "bank_account_number": "1234567890123",
  "bank_name": "VCB",
  "department_id": "dep-uuid",
  "position_id": "pos-uuid",
  "job_level_id": "level-uuid",
  "direct_manager_id": "manager-uuid",
  "joined_date": "2026-01-01",
  "probation_end_date": "2026-02-28",
  "employment_status": "Probation",
  "employee_type": "Full-time",
  "work_location": "Hanoi Office",
  "contract": {
    "contract_type_id": "contract-type-uuid",
    "contract_code": "HD-2026-0001",
    "title": "Hợp đồng thử việc",
    "start_date": "2026-01-01",
    "end_date": "2026-02-28",
    "signed_date": "2025-12-25",
    "status": "Active",
    "is_primary": true,
    "file_id": "file-uuid"
  },
  "create_user_account": true,
  "user": {
    "login_email": "nguyenvana@company.com",
    "default_role_code": "EMPLOYEE",
    "send_activation": true
  },
  "file_ids": ["file-uuid-1", "file-uuid-2"]
}
```

#### Business validation

1. `full_name`, `department_id`, `position_id`, `joined_date`, `employment_status` là bắt buộc.
2. `department_id`, `position_id`, `job_level_id`, `direct_manager_id` phải thuộc cùng company và đang active.
3. `direct_manager_id` không được là chính nhân viên mới.
4. Nếu frontend không gửi `employee_code`, backend sinh mã theo `employee_code_configs` và `sequence_counters`.
5. Nếu frontend gửi `employee_code`, chỉ chấp nhận khi user có `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` và config `allow_manual_override = true`.
6. `employee_code` phải unique trong company.
7. `company_email` nếu có phải unique trong company.
8. Nếu tạo user, `login_email` phải unique trong AUTH.
9. Nếu tạo user thành công, backend liên kết `employees.user_id` với user vừa tạo.
10. Nếu tạo employee + user + contract + file, toàn bộ nên chạy trong transaction hoặc saga có rollback rõ ràng.
11. Không tin `company_id` từ body.
12. Ghi audit log với old_value null và new_value sau khi tạo.
13. Phát notification nếu cấu hình bật.

#### Response 201

```json
{
  "success": true,
  "message": "Tạo nhân viên thành công",
  "data": {
    "id": "8b9f1d8a-2c4e-4f9c-9a21-4f1e2b000001",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "employment_status": "Probation",
    "user": {
      "id": "user-uuid",
      "email": "nguyenvana@company.com",
      "status": "Active"
    }
  },
  "meta": {
    "request_id": "req_20260620_000102",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Lỗi có thể xảy ra

| HTTP | Error code | Trường hợp |
| ---: | --- | --- |
| 400 | `VALIDATION-ERR-001` | Thiếu field bắt buộc hoặc sai format |
| 403 | `AUTH-ERR-FORBIDDEN` | Không có quyền tạo nhân viên |
| 403 | `AUTH-ERR-SCOPE-DENIED` | Không có scope Company/System |
| 409 | `HR-ERR-EMPLOYEE-CODE-DUPLICATED` | Mã nhân viên đã tồn tại |
| 409 | `HR-ERR-COMPANY-EMAIL-DUPLICATED` | Email công ty đã tồn tại |
| 409 | `HR-ERR-USER-EMAIL-DUPLICATED` | Email đăng nhập đã tồn tại |
| 422 | `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID` | Không sinh được mã nhân viên |
| 422 | `HR-ERR-DEPARTMENT-INACTIVE` | Phòng ban không hợp lệ hoặc inactive |
| 422 | `HR-ERR-POSITION-INACTIVE` | Chức vụ không hợp lệ hoặc inactive |

---

### 11.3 HR-API-003: Lấy chi tiết nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/{employee_id}` |
| Required permission | `HR.EMPLOYEE.VIEW` |
| Allowed roles | Super Admin, Admin, HR, Manager, Employee Own |
| Data scope | Own, Team, Department, Company, System |
| Audit log | Có nếu xem dữ liệu nhạy cảm và cấu hình yêu cầu |
| Notification event | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `include` | String | `contracts,files,user,status_histories` nếu có quyền |
| `sensitive` | Boolean | Yêu cầu trả dữ liệu nhạy cảm nếu có quyền |

#### Business validation

1. User phải có `HR.EMPLOYEE.VIEW`.
2. Target employee phải nằm trong data scope.
3. Nếu `sensitive=true`, user phải có `HR.EMPLOYEE.VIEW_SENSITIVE`.
4. Nếu include file, user phải có `HR.EMPLOYEE.FILE_VIEW`.
5. Nếu include contracts, user phải có `HR.CONTRACT.VIEW`.
6. Nếu thiếu quyền nhạy cảm, backend tự mask hoặc loại field.
7. Nếu resource không nằm trong scope, trả 404 hoặc 403 theo policy bảo mật; khuyến nghị 404 để tránh lộ UUID hợp lệ.

---

### 11.4 HR-API-004: Cập nhật hồ sơ nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/hr/employees/{employee_id}` |
| Required permission | `HR.EMPLOYEE.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Team nếu được cấp, Department nếu được cấp, Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_UPDATED` nếu cấu hình bật |
| Idempotency | Khuyến nghị với request nhạy cảm |

#### Request body mẫu

```json
{
  "full_name": "Nguyễn Văn A Updated",
  "phone": "0911111111",
  "department_id": "new-dep-uuid",
  "position_id": "new-pos-uuid",
  "job_level_id": "new-level-uuid",
  "direct_manager_id": "new-manager-uuid",
  "work_location": "HCM Office",
  "note": "Điều chuyển phòng ban"
}
```

#### Business validation

1. Không cho cập nhật field không nằm trong whitelist.
2. `employee_code` chỉ được cập nhật nếu user có `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE`, mã chưa bị khóa hoặc có quyền mở khóa, và config cho phép override.
3. Department/position/job level/manager phải active và cùng company.
4. `direct_manager_id` không được là chính employee.
5. Không cho tạo vòng lặp manager chain.
6. Nếu cập nhật email công ty, email phải unique trong company.
7. Nếu cập nhật field nhạy cảm, có thể yêu cầu permission bổ sung hoặc audit log chi tiết.
8. Cập nhật trực tiếp bởi HR/Admin khác với Employee Self-Service; Employee không được dùng API này để sửa hồ sơ chính.
9. Ghi audit log old_value/new_value theo field thay đổi.
10. Có thể phát event cho DASH cache invalidation và NOTI nếu cấu hình.

---

### 11.5 HR-API-005: Xóa mềm nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `DELETE` |
| Endpoint | `/api/v1/hr/employees/{employee_id}` |
| Required permission | `HR.EMPLOYEE.DELETE` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_DELETED` nếu cấu hình bật |

#### Business validation

1. Không xóa cứng nhân viên trong MVP.
2. Không nên cho xóa mềm employee có dữ liệu chấm công/nghỉ phép/task quan trọng nếu chưa có quy trình offboarding; có thể chỉ đổi trạng thái Resigned/Terminated.
3. Nếu employee có user active, backend có thể yêu cầu xác nhận khóa user hoặc trả lỗi business rule.
4. Không cho user tự xóa chính employee của mình nếu không có admin khác hoặc nếu policy cấm.
5. Ghi `deleted_at`, `deleted_by` và audit log.

#### Response

```json
{
  "success": true,
  "message": "Xóa mềm nhân viên thành công",
  "data": null,
  "meta": {
    "request_id": "req_20260620_000105",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.6 HR-API-006: Đổi trạng thái nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/change-status` |
| Required permission | `HR.EMPLOYEE.CHANGE_STATUS` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_STATUS_CHANGED` |
| Idempotency | Bắt buộc khuyến nghị |

#### Request body

```json
{
  "new_status": "Official",
  "effective_date": "2026-03-01",
  "reason": "Hoàn thành thử việc",
  "note": "Đạt yêu cầu",
  "lock_user_if_resigned": true,
  "revoke_sessions_if_locked": true
}
```

#### Status hợp lệ

```text
Onboarding
Probation
Official
Temporarily Suspended
Resigned
Terminated
```

#### Business validation

1. `new_status` phải nằm trong enum hợp lệ.
2. `effective_date` là bắt buộc.
3. Không cho chuyển trạng thái bất hợp lý nếu policy cấu hình, ví dụ Terminated -> Probation.
4. Nếu chuyển sang `Resigned` hoặc `Terminated`, có thể gọi AUTH để khóa user/revoke sessions theo cấu hình.
5. Employee ở trạng thái Resigned/Terminated sẽ bị các module ATT/LEAVE/TASK chặn nghiệp vụ mới.
6. Mỗi lần đổi trạng thái phải tạo `employee_status_histories`.
7. Phải ghi audit log old_status/new_status.
8. Phát event để NOTI/DASH cập nhật.

---

### 11.7 HR-API-007: Liên kết employee với user

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/link-user` |
| Required permission | `HR.EMPLOYEE.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_USER_LINKED` |

#### Request body

```json
{
  "user_id": "user-uuid"
}
```

Hoặc tạo user mới và link ngay:

```json
{
  "create_user": true,
  "email": "nguyenvana@company.com",
  "default_role_code": "EMPLOYEE",
  "send_activation": true
}
```

#### Business validation

1. Employee chưa có user chính active.
2. User thuộc cùng company.
3. User chưa liên kết với employee active khác.
4. User không bị deleted.
5. Nếu tạo user mới, email không được trùng.
6. Ghi audit log và có thể phát notification.

---

### 11.8 HR-API-008: Hủy liên kết employee-user

| Trường | Nội dung |
| --- | --- |
| Method | `DELETE` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/link-user` |
| Required permission | `HR.EMPLOYEE.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_USER_UNLINKED` |

#### Query/body optional

```json
{
  "lock_user": true,
  "revoke_sessions": true,
  "reason": "Nhân viên nghỉ việc"
}
```

#### Business validation

1. Employee phải có user đang liên kết.
2. Nếu `lock_user=true`, backend gọi AUTH lock user.
3. Nếu user hiện tại tự unlink chính mình, cần chặn trừ Super Admin hoặc policy đặc biệt.
4. Ghi audit log.

---

### 11.9 HR-API-009: Xuất danh sách nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` hoặc `POST` nếu export async |
| Endpoint | `/api/v1/hr/employees/export` |
| Required permission | `HR.EMPLOYEE.EXPORT` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Team, Department, Company, System tùy quyền |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_EXPORT_COMPLETED` nếu async |

#### Query params

Dùng cùng filter với HR-API-001.

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `format` | String | `xlsx` hoặc `csv` |
| `include_sensitive` | Boolean | Chỉ hiệu lực nếu có `HR.EMPLOYEE.VIEW_SENSITIVE` |

#### Business validation

1. Bắt buộc kiểm tra `HR.EMPLOYEE.EXPORT`.
2. Data export phải nằm trong data scope.
3. Dữ liệu nhạy cảm chỉ xuất khi có quyền phù hợp.
4. Export lớn nên chạy background job, trả 202 và file_id sau khi hoàn tất.
5. Mọi export phải ghi audit log kèm filter.

#### Response sync mẫu

```json
{
  "success": true,
  "message": "Tạo file export thành công",
  "data": {
    "file_id": "file-uuid",
    "file_name": "employees_20260620.xlsx",
    "download_url": "https://...signed-url",
    "expires_at": "2026-06-20T10:15:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000109",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.10 HR-API-010: Lịch sử thay đổi hồ sơ nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/audit-logs` |
| Required permission | `HR.AUDIT_LOG.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company, System; Team/Department nếu được cấp |
| Audit log | Không bắt buộc; có thể log nếu xem dữ liệu nhạy cảm |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `page`, `per_page` | Phân trang |
| `action` | Lọc theo action |
| `from_date`, `to_date` | Lọc thời gian |
| `actor_user_id` | Lọc người thao tác |

---

### 11.11 HR-API-011: Lookup nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/lookup` |
| Required permission | `HR.EMPLOYEE.VIEW` |
| Allowed roles | HR, Admin, Manager, modules internal |
| Data scope | Team, Department, Company, System |
| Audit log | Không |
| Notification event | Không |

#### Mục đích

API nhẹ để dùng trong dropdown chọn nhân viên, chọn manager, chọn assignee trong TASK, chọn employee trong ATT/LEAVE.

#### Query params

| Param | Mô tả |
| --- | --- |
| `search` | Tên, mã nhân viên, email |
| `department_id` | Lọc phòng ban |
| `status` | Mặc định chỉ lấy `Probation`, `Official` |
| `limit` | Mặc định 20, tối đa 50 |

#### Response

```json
{
  "success": true,
  "message": "Lấy danh sách nhân viên thành công",
  "data": [
    {
      "id": "employee-uuid",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A",
      "department_name": "Phòng Kỹ thuật",
      "position_name": "Developer",
      "employment_status": "Official"
    }
  ],
  "meta": {
    "request_id": "req_20260620_000111",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 12. Chi tiết API My Profile và Employee Self-Service

### 12.1 HR-API-101: Xem hồ sơ cá nhân của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/me/profile` |
| Required permission | `HR.EMPLOYEE.VIEW` |
| Allowed roles | Mọi user có employee liên kết |
| Data scope | Own |
| Audit log | Có nếu cấu hình log xem dữ liệu nhạy cảm |
| Notification event | Không |

#### Business validation

1. User phải liên kết với một employee.
2. Chỉ trả hồ sơ của employee liên kết user hiện tại.
3. Không cho truyền `employee_id`.
4. Không trả field mà chính employee không được xem theo policy.
5. Có thể trả danh sách field được phép đề xuất cập nhật.

---

### 12.2 HR-API-102: Lấy danh sách field được phép đề xuất cập nhật

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/me/profile/editable-fields` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.CREATE` |
| Allowed roles | Employee, Manager, HR, Admin |
| Data scope | Own |
| Audit log | Không |
| Notification event | Không |

#### Response mẫu

```json
{
  "success": true,
  "message": "Lấy danh sách trường được phép cập nhật thành công",
  "data": [
    {
      "field_name": "phone",
      "label": "Số điện thoại",
      "data_type": "string",
      "required": false,
      "validation_rules": {
        "max_length": 50
      }
    },
    {
      "field_name": "current_address",
      "label": "Địa chỉ hiện tại",
      "data_type": "text",
      "required": false
    },
    {
      "field_name": "emergency_contact_phone",
      "label": "SĐT liên hệ khẩn cấp",
      "data_type": "string",
      "required": false
    }
  ],
  "meta": {
    "request_id": "req_20260620_000112",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 12.3 HR-API-103: Lấy yêu cầu cập nhật hồ sơ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/me/profile-change-requests` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR, Admin |
| Data scope | Own |
| Audit log | Không |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `status` | Pending/Approved/Rejected/Cancelled |
| `page`, `per_page` | Phân trang |

---

### 12.4 HR-API-104: Gửi yêu cầu cập nhật hồ sơ cá nhân

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/me/profile-change-requests` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.CREATE` |
| Allowed roles | Employee, Manager, HR, Admin |
| Data scope | Own |
| Audit log | Có |
| Notification event | `HR_PROFILE_CHANGE_SUBMITTED` |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "reason": "Cập nhật thông tin liên hệ mới",
  "changes": [
    {
      "field_name": "phone",
      "new_value": "0911111111"
    },
    {
      "field_name": "current_address",
      "new_value": "123 Nguyễn Trãi, Quận 1, TP.HCM"
    }
  ],
  "attachment_file_ids": ["file-uuid-1"]
}
```

> Quy ước field (cố ý, không phải lỗi): request **ghi** dùng mảng `changes[]` (chỉ `field_name` + `new_value`); response/DTO **đọc** dùng mảng `items[]` (gồm cả `old_value`, `status`, `is_sensitive`). Backend map `changes[]` (write) → `profile_change_request_items` → `items[]` (read).

#### Business validation

1. User phải liên kết employee.
2. Chỉ cho field nằm trong editable field whitelist.
3. Không cho employee tự sửa phòng ban, chức vụ, lương, hợp đồng, trạng thái, direct_manager.
4. Hệ thống so sánh old_value và new_value; nếu không thay đổi gì thì trả lỗi validation/business.
5. Nếu đã có request Pending cho cùng field, có thể chặn hoặc merge theo cấu hình.
6. Request tạo ra trạng thái `Pending`.
7. Không cập nhật trực tiếp bảng `employees`.
8. Ghi `profile_change_requests` và `profile_change_request_items`.
9. Ghi audit log.
10. Gửi notification cho HR/Admin có quyền xử lý.

#### Response 201

```json
{
  "success": true,
  "message": "Gửi yêu cầu cập nhật hồ sơ thành công",
  "data": {
    "id": "request-uuid",
    "request_code": "PCR-2026-0001",
    "status": "Pending",
    "submitted_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000114",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 12.5 HR-API-105: Xem chi tiết yêu cầu cập nhật hồ sơ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/me/profile-change-requests/{request_id}` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR, Admin |
| Data scope | Own |
| Audit log | Không |
| Notification event | Không |

#### Business validation

1. Request phải thuộc employee của user hiện tại.
2. Nếu không thuộc Own, trả 404/403.
3. Mask field nhạy cảm nếu policy yêu cầu.

---

### 12.6 HR-API-106: Hủy yêu cầu cập nhật hồ sơ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/me/profile-change-requests/{request_id}/cancel` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` |
| Allowed roles | Employee, Manager, HR, Admin |
| Data scope | Own |
| Audit log | Có |
| Notification event | `HR_PROFILE_CHANGE_CANCELLED` |

#### Request body

```json
{
  "reason": "Tôi muốn chỉnh sửa lại thông tin trước khi gửi"
}
```

#### Business validation

1. Request phải thuộc user hiện tại.
2. Chỉ hủy khi status = `Pending`.
3. Sau khi hủy, status = `Cancelled`.
4. Không thay đổi dữ liệu hồ sơ chính.
5. Ghi audit log và có thể thông báo cho HR/Admin nếu đã nhận trước đó.

---

## 13. Chi tiết API quản lý yêu cầu cập nhật hồ sơ

### 13.1 HR-API-201: Danh sách yêu cầu cập nhật hồ sơ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/profile-change-requests` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Team/Department nếu được cấp, Company, System |
| Audit log | Không |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `status` | Pending/Approved/Rejected/Cancelled |
| `employee_id` | Lọc nhân viên |
| `department_id` | Lọc phòng ban |
| `search` | Tìm theo tên/mã nhân viên/request_code |
| `submitted_from`, `submitted_to` | Lọc ngày gửi |
| `reviewed_from`, `reviewed_to` | Lọc ngày xử lý |
| `page`, `per_page`, `sort` | Phân trang/sort |

---

### 13.2 HR-API-202: Chi tiết yêu cầu cập nhật hồ sơ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/profile-change-requests/{request_id}` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Team/Department/Company/System |
| Audit log | Có nếu xem dữ liệu nhạy cảm |
| Notification event | Không |

#### Business validation

1. Request phải nằm trong scope của user.
2. Nếu item thay đổi field nhạy cảm, user cần quyền xem field nhạy cảm hoặc backend mask old/new value.
3. Nếu request không tồn tại hoặc không thuộc scope, trả 404.

---

### 13.3 HR-API-203: Duyệt yêu cầu cập nhật hồ sơ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/profile-change-requests/{request_id}/approve` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.APPROVE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System; Team/Department nếu được cấp |
| Audit log | Có |
| Notification event | `HR_PROFILE_CHANGE_APPROVED` |
| Idempotency | Bắt buộc khuyến nghị |

#### Request body

```json
{
  "review_note": "Thông tin hợp lệ"
}
```

> MVP duyệt theo nguyên tắc **all-or-nothing**: duyệt toàn bộ item của request hoặc từ chối toàn bộ. Không có `approved_item_ids` và không có trạng thái `PartiallyApproved`.

#### Business validation

1. Request phải status `Pending`.
2. Reviewer phải khác employee gửi yêu cầu (self-approval guard, reviewer ≠ submitter); chặn ngay cả khi reviewer là HR/Admin nhưng đồng thời là chủ request.
3. Request phải nằm trong data scope.
4. Các field được duyệt phải còn nằm trong whitelist cho self-service.
5. Backend cập nhật bảng `employees` trong transaction.
6. Duyệt áp dụng toàn bộ item của request; ghi status request = `Approved`.
7. MVP không hỗ trợ duyệt một phần (`PartiallyApproved` bị loại bỏ); nếu một số field không hợp lệ thì từ chối toàn bộ request.
8. Ghi audit log old_value/new_value.
9. Gửi notification cho employee.
10. Invalidate dashboard/profile cache nếu có.

---

### 13.4 HR-API-204: Từ chối yêu cầu cập nhật hồ sơ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/profile-change-requests/{request_id}/reject` |
| Required permission | `HR.PROFILE_CHANGE_REQUEST.REJECT` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company, System; Team/Department nếu được cấp |
| Audit log | Có |
| Notification event | `HR_PROFILE_CHANGE_REJECTED` |

#### Request body

```json
{
  "review_note": "Thông tin chưa có giấy tờ xác minh"
}
```

#### Business validation

1. Request phải status `Pending`.
2. `review_note` bắt buộc hoặc khuyến nghị bắt buộc theo cấu hình.
3. Không cập nhật bảng `employees`.
4. Cập nhật status request = `Rejected`.
5. Ghi audit log.
6. Gửi notification cho employee.

---

## 14. Chi tiết API Department

### 14.1 HR-API-301: Lấy danh sách phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/departments` |
| Required permission | `HR.DEPARTMENT.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR, Manager nếu được cấp |
| Data scope | Company/System hoặc theo cấu hình |
| Audit log | Không |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `search` | Tìm theo mã/tên phòng ban |
| `status` | Active/Inactive |
| `parent_id` | Lọc phòng ban con |
| `page`, `per_page` | Phân trang nếu list phẳng |

---

### 14.2 HR-API-302: Lấy cây phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/departments/tree` |
| Required permission | `HR.DEPARTMENT.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR, Manager nếu được cấp |
| Data scope | Company/System hoặc theo cấu hình |
| Audit log | Không |
| Notification event | Không |

#### Response mẫu

```json
{
  "success": true,
  "message": "Lấy cây phòng ban thành công",
  "data": [
    {
      "id": "dep-root",
      "department_code": "BOD",
      "name": "Ban Giám đốc",
      "children": [
        {
          "id": "dep-hr",
          "department_code": "HR",
          "name": "Phòng Nhân sự",
          "children": []
        }
      ]
    }
  ],
  "meta": {
    "request_id": "req_20260620_000302",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 14.3 HR-API-303: Chi tiết phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/departments/{department_id}` |
| Required permission | `HR.DEPARTMENT.VIEW` |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |

---

### 14.4 HR-API-304: Tạo phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/departments` |
| Required permission | `HR.DEPARTMENT.CREATE` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_DEPARTMENT_CREATED` nếu cấu hình bật |

#### Request body

```json
{
  "department_code": "DEV",
  "name": "Phòng Kỹ thuật",
  "description": "Phòng phát triển sản phẩm",
  "parent_id": null,
  "manager_employee_id": "employee-uuid",
  "status": "Active",
  "sort_order": 1
}
```

#### Business validation

1. `department_code` unique trong company.
2. `name` bắt buộc.
3. `parent_id` nếu có phải thuộc cùng company và active.
4. Không tạo vòng lặp cây phòng ban.
5. `manager_employee_id` nếu có phải là employee active cùng company.
6. Ghi audit log.

---

### 14.5 HR-API-305: Cập nhật phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/hr/departments/{department_id}` |
| Required permission | `HR.DEPARTMENT.UPDATE` |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_DEPARTMENT_UPDATED` nếu cấu hình bật |

#### Business validation

1. Không cho `parent_id = department_id`.
2. Không tạo vòng lặp cây phòng ban.
3. Không đổi code trùng.
4. Nếu chuyển status Inactive, kiểm tra còn employee active hay không.
5. Ghi audit log.

---

### 14.6 HR-API-306: Xóa mềm phòng ban

| Trường | Nội dung |
| --- | --- |
| Method | `DELETE` |
| Endpoint | `/api/v1/hr/departments/{department_id}` |
| Required permission | `HR.DEPARTMENT.DELETE` |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_DEPARTMENT_DELETED` nếu cấu hình bật |

#### Business validation

1. Không xóa cứng.
2. Không cho xóa phòng ban đang có employee active.
3. Không cho xóa phòng ban đang có phòng ban con active.
4. Có thể yêu cầu chuyển employee/phòng ban con trước.

---

## 15. Chi tiết API Position

### 15.1 HR-API-401: Lấy danh sách chức vụ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/positions` |
| Required permission | `HR.POSITION.VIEW` |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `search` | Mã/tên chức vụ |
| `department_id` | Lọc theo phòng ban nếu position gắn phòng ban |
| `job_level_id` | Lọc theo cấp bậc |
| `status` | Active/Inactive |
| `page`, `per_page` | Phân trang |

---

### 15.2 HR-API-402: Chi tiết chức vụ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/positions/{position_id}` |
| Required permission | `HR.POSITION.VIEW` |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |

---

### 15.3 HR-API-403: Tạo chức vụ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/positions` |
| Required permission | `HR.POSITION.CREATE` |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_POSITION_CREATED` nếu cấu hình bật |

#### Request body

```json
{
  "position_code": "DEV",
  "name": "Developer",
  "description": "Lập trình viên",
  "department_id": "dep-uuid",
  "job_level_id": "level-uuid",
  "status": "Active",
  "sort_order": 1
}
```

#### Business validation

1. `position_code` unique trong company.
2. `name` bắt buộc.
3. `department_id` nếu có phải active.
4. `job_level_id` nếu có phải active.
5. Ghi audit log.

---

### 15.4 HR-API-404: Cập nhật chức vụ

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/hr/positions/{position_id}` |
| Required permission | `HR.POSITION.UPDATE` |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_POSITION_UPDATED` nếu cấu hình bật |

---

### 15.5 HR-API-405: Xóa mềm chức vụ

| Trường | Nội dung |
| --- | --- |
| Method | `DELETE` |
| Endpoint | `/api/v1/hr/positions/{position_id}` |
| Required permission | `HR.POSITION.DELETE` |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_POSITION_DELETED` nếu cấu hình bật |

#### Business validation

1. Không xóa cứng.
2. Không xóa chức vụ đang có employee active.
3. Có thể chuyển status Inactive nếu không muốn xóa mềm.

---

## 16. Chi tiết API Job Level

### 16.1 HR-API-501: Lấy danh sách cấp bậc

```http
GET /api/v1/hr/job-levels
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.MASTER_DATA.MANAGE` hoặc `HR.EMPLOYEE.VIEW` nếu chỉ dùng dropdown |
| Data scope | Company/System |
| Audit log | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `search` | Tìm theo mã/tên cấp bậc |
| `status` | Active/Inactive |
| `page`, `per_page` | Phân trang |

---

### 16.2 HR-API-503: Tạo cấp bậc

```http
POST /api/v1/hr/job-levels
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.MASTER_DATA.MANAGE` |
| Audit log | Có |

#### Request body

```json
{
  "level_code": "MIDDLE",
  "name": "Middle",
  "rank_order": 3,
  "description": "Nhân sự cấp middle",
  "status": "Active"
}
```

#### Validation

1. `level_code` unique trong company.
2. `name` bắt buộc.
3. `rank_order` nếu có phải là số nguyên.

Các API `GET detail`, `PATCH`, `DELETE` của job level áp dụng tương tự Position, với permission `HR.MASTER_DATA.MANAGE`.

---

## 17. Chi tiết API Contract Type

### 17.1 HR-API-601: Lấy danh sách loại hợp đồng

```http
GET /api/v1/hr/contract-types
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.CONTRACT.VIEW` |
| Data scope | Company/System |
| Audit log | Không |

---

### 17.2 HR-API-603: Tạo loại hợp đồng

```http
POST /api/v1/hr/contract-types
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.MASTER_DATA.MANAGE` |
| Audit log | Có |

#### Request body

```json
{
  "contract_type_code": "FIXED_TERM",
  "name": "Hợp đồng xác định thời hạn",
  "description": "Hợp đồng có ngày kết thúc",
  "default_duration_months": 12,
  "requires_end_date": true,
  "status": "Active"
}
```

#### Validation

1. `contract_type_code` unique trong company.
2. `name` bắt buộc.
3. Nếu `requires_end_date = true`, khi tạo employee contract cần có `end_date`.

Các API `GET detail`, `PATCH`, `DELETE` của contract type áp dụng tương tự Position.

---

## 18. Chi tiết API Employee Contract

### 18.1 HR-API-701: Danh sách hợp đồng của nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/contracts` |
| Required permission | `HR.CONTRACT.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Team/Department/Company/System nếu được cấp |
| Audit log | Có nếu xem file hoặc dữ liệu nhạy cảm theo cấu hình |
| Notification event | Không |

#### Business validation

1. Employee target phải nằm trong data scope.
2. Nếu hợp đồng có dữ liệu lương ở phase sau, cần permission payroll/sensitive riêng.
3. Nếu include file, cần `HR.EMPLOYEE.FILE_VIEW` hoặc `HR.CONTRACT.VIEW` theo policy.

---

### 18.2 HR-API-703: Tạo hợp đồng nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/contracts` |
| Required permission | `HR.CONTRACT.CREATE` |
| Allowed roles | Super Admin, Admin công ty, HR |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_CONTRACT_CREATED` nếu cấu hình bật |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "contract_type_id": "contract-type-uuid",
  "contract_code": "HD-2026-0001",
  "title": "Hợp đồng lao động 12 tháng",
  "start_date": "2026-01-01",
  "end_date": "2026-12-31",
  "signed_date": "2025-12-25",
  "status": "Active",
  "is_primary": true,
  "file_id": "file-uuid",
  "note": "Hợp đồng chính thức"
}
```

#### Business validation

1. Employee phải tồn tại, chưa deleted, cùng company.
2. Contract type phải active.
3. `start_date` bắt buộc.
4. `end_date` không nhỏ hơn `start_date`.
5. Nếu contract type yêu cầu end date thì `end_date` bắt buộc.
6. Nếu `is_primary=true`, backend unset primary contract cũ hoặc trả conflict tùy policy.
7. Contract active không nên overlap nếu policy cấm; MVP có thể cảnh báo hoặc chặn theo cấu hình.
8. File contract nếu có phải thuộc file service và user có quyền link file.
9. Ghi audit log.

---

### 18.3 HR-API-704: Cập nhật hợp đồng

```http
PATCH /api/v1/hr/employees/{employee_id}/contracts/{contract_id}
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.CONTRACT.UPDATE` |
| Audit log | Có |
| Notification event | `HR_CONTRACT_UPDATED` nếu cấu hình bật |

#### Business validation

1. Contract phải thuộc employee trong path.
2. Contract và employee phải cùng company.
3. Không cho sửa contract đã Terminated/Cancelled nếu policy cấm.
4. Ghi audit log old/new.

---

### 18.4 HR-API-705: Xóa mềm hợp đồng

```http
DELETE /api/v1/hr/employees/{employee_id}/contracts/{contract_id}
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.CONTRACT.DELETE` |
| Audit log | Có |

#### Business validation

1. Không xóa cứng.
2. Không cho xóa hợp đồng primary active nếu employee không còn hợp đồng khác và policy cấm.
3. Có thể chuyển status Cancelled/Terminated thay vì delete.

---

### 18.5 HR-API-706: Đặt hợp đồng chính

```http
POST /api/v1/hr/employees/{employee_id}/contracts/{contract_id}/set-primary
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.CONTRACT.UPDATE` |
| Audit log | Có |
| Notification event | `HR_CONTRACT_PRIMARY_CHANGED` nếu cấu hình bật |

#### Business validation

1. Contract phải active hoặc theo status được cấu hình.
2. Backend unset `is_primary` của hợp đồng khác trong cùng employee.
3. Transaction bắt buộc.

---

## 19. Chi tiết API Employee File

### 19.1 HR-API-801: Danh sách file hồ sơ nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/files` |
| Required permission | `HR.EMPLOYEE.FILE_VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Team/Department/Company/System nếu được cấp |
| Audit log | Có nếu file nhạy cảm hoặc cấu hình yêu cầu |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `file_type` | CV/Identity/Contract/Certificate/Decision/Other |
| `is_sensitive` | true/false nếu có quyền |
| `page`, `per_page` | Phân trang |

---

### 19.2 HR-API-802: Upload hoặc link file hồ sơ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/files` |
| Required permission | `HR.EMPLOYEE.FILE_UPLOAD` |
| Content-Type | `multipart/form-data` hoặc JSON link file đã upload |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_FILE_UPLOADED` nếu cấu hình bật |

#### Cách 1: Upload multipart

```http
POST /api/v1/hr/employees/{employee_id}/files
Content-Type: multipart/form-data
```

Fields:

| Field | Bắt buộc | Mô tả |
| --- | --- | --- |
| `file` | Có | File upload |
| `file_type` | Có | CV/Identity/Contract/Certificate/Decision/Other |
| `description` | Không | Mô tả |
| `is_sensitive` | Không | Mặc định true với file hồ sơ |

#### Cách 2: Link file đã upload qua FOUNDATION

```json
{
  "file_id": "file-uuid",
  "file_type": "Contract",
  "description": "Hợp đồng lao động",
  "is_sensitive": true
}
```

#### Business validation

1. Employee target phải nằm trong scope.
2. File type phải nằm trong enum hoặc config.
3. File private mặc định.
4. Không trả storage path thật.
5. Ghi audit log.

---

### 19.3 HR-API-804: Lấy signed download URL

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employees/{employee_id}/files/{file_id}/download-url` |
| Required permission | `HR.EMPLOYEE.FILE_VIEW` |
| Data scope | Team/Department/Company/System nếu được cấp |
| Audit log | Có |
| Notification event | Không |

#### Response

```json
{
  "success": true,
  "message": "Tạo link tải file thành công",
  "data": {
    "file_id": "file-uuid",
    "file_name": "contract.pdf",
    "download_url": "https://storage.example.com/signed-url",
    "expires_at": "2026-06-20T10:15:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000804",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Business validation

1. File phải link với employee trong path.
2. User phải có quyền xem file và target employee nằm trong scope.
3. Nếu file sensitive, có thể yêu cầu `HR.EMPLOYEE.VIEW_SENSITIVE` hoặc policy riêng.
4. Log file access.

---

### 19.4 HR-API-805: Xóa/unlink file hồ sơ

```http
DELETE /api/v1/hr/employees/{employee_id}/files/{file_id}
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.EMPLOYEE.FILE_DELETE` |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_FILE_DELETED` nếu cấu hình bật |

#### Business validation

1. Không xóa file vật lý ngay nếu còn link với entity khác.
2. Soft delete/unlink qua `employee_files` hoặc `file_links`.
3. Không cho xóa file hợp đồng đang dùng nếu policy cấm.

---

## 20. Chi tiết API Employee Code

### 20.1 HR-API-901: Xem cấu hình sinh mã nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/employee-code-config` |
| Required permission | `HR.EMPLOYEE_CODE_CONFIG.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company/System |
| Audit log | Không |

#### Response mẫu

```json
{
  "success": true,
  "message": "Lấy cấu hình mã nhân viên thành công",
  "data": {
    "id": "config-uuid",
    "prefix": "EMP",
    "padding_length": 4,
    "start_number": 1,
    "use_department_code": false,
    "use_year": false,
    "use_month": false,
    "separator": "",
    "reset_rule": "Never",
    "allow_manual_override": false,
    "lock_after_created": true,
    "pattern": "{PREFIX}{SEQ}",
    "status": "Active"
  },
  "meta": {
    "request_id": "req_20260620_000901",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 20.2 HR-API-902: Cập nhật cấu hình sinh mã nhân viên

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/hr/employee-code-config` |
| Required permission | `HR.EMPLOYEE_CODE_CONFIG.UPDATE` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `HR_EMPLOYEE_CODE_CONFIG_UPDATED` |

#### Request body

```json
{
  "prefix": "EMP",
  "padding_length": 4,
  "start_number": 1,
  "use_department_code": false,
  "use_year": true,
  "use_month": false,
  "separator": "-",
  "reset_rule": "Yearly",
  "allow_manual_override": false,
  "lock_after_created": true,
  "pattern": "{YYYY}-{PREFIX}-{SEQ}",
  "status": "Active"
}
```

#### Business validation

1. Chỉ có một config Active chính trong company ở MVP.
2. `padding_length` phải >= 1 và <= 12.
3. `reset_rule` thuộc enum `Never`, `Yearly`, `Monthly`, `Daily` (khớp DB CHECK `employee_code_configs.reset_policy`).
4. `pattern` chỉ được dùng token whitelist: `{PREFIX}`, `{SEQ}`, `{DEPT}`, `{YYYY}`, `{YY}`, `{MM}`.
5. Không cho cập nhật cấu hình làm trùng mã với dữ liệu đã có nếu có thể kiểm tra.
6. Ghi audit log.
7. Có thể invalidate preview cache.

---

### 20.3 HR-API-903: Preview mã nhân viên tiếp theo

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/hr/employee-code/preview` |
| Required permission | `HR.EMPLOYEE_CODE.PREVIEW` |
| Allowed roles | Super Admin, Admin công ty, HR có quyền |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |

#### Request body

```json
{
  "department_id": "dep-uuid",
  "joined_date": "2026-06-20"
}
```

#### Response

```json
{
  "success": true,
  "message": "Preview mã nhân viên thành công",
  "data": {
    "preview_code": "2026-EMP-0001",
    "sequence_key": "2026",
    "is_final": false,
    "note": "Mã preview có thể thay đổi khi lưu chính thức nếu có người tạo nhân viên trước."
  },
  "meta": {
    "request_id": "req_20260620_000903",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Business validation

1. Preview không tăng sequence.
2. Mã chính thức chỉ được chốt khi tạo employee trong transaction.
3. Nếu config không hợp lệ, trả `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID`.

---

### 20.4 HR-API-904/905: Khóa/mở khóa sửa mã nhân viên

```http
POST /api/v1/hr/employees/{employee_id}/unlock-employee-code
POST /api/v1/hr/employees/{employee_id}/lock-employee-code
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` |
| Audit log | Có |

#### Business validation

1. Chỉ thực hiện nếu config cho phép manual override hoặc user là Super Admin theo policy.
2. Ghi audit log.
3. Không tự đổi mã, chỉ thay đổi trạng thái khóa.

---

## 21. Chi tiết API Org Chart

### 21.1 HR-API-1001: Lấy sơ đồ tổ chức cơ bản

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/hr/org-chart` |
| Required permission | `HR.ORG_CHART.VIEW` |
| Allowed roles | Super Admin, Admin, HR, Manager |
| Data scope | Team/Department/Company/System |
| Audit log | Không |
| Notification event | Không |

#### Query params

| Param | Mô tả |
| --- | --- |
| `root_department_id` | Lấy cây từ phòng ban gốc |
| `root_employee_id` | Lấy cây từ một manager |
| `depth` | Độ sâu cây, mặc định 3 |
| `include_inactive` | Có lấy nhân viên inactive không, mặc định false |

#### Business validation

1. Dữ liệu trả về phải nằm trong data scope.
2. Không trả dữ liệu nhạy cảm.
3. Nếu cây lớn, giới hạn depth hoặc pagination theo node.

---

### 21.2 HR-API-1002: Lấy cấp dưới của một nhân viên

```http
GET /api/v1/hr/employees/{employee_id}/subordinates?depth=1
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `HR.EMPLOYEE.VIEW` |
| Data scope | Team/Department/Company/System |

#### Business validation

1. Employee target phải nằm trong scope.
2. Manager chỉ xem được cấp dưới thuộc team nếu có scope Team.
3. Không trả field nhạy cảm.

---

## 22. Validation chung cho HR

### 22.1 Employee validation

| Field | Rule |
| --- | --- |
| `employee_code` | Unique theo company, tự sinh mặc định, manual override cần quyền và config |
| `full_name` | Bắt buộc, tối đa 255 ký tự |
| `company_email` | Email hợp lệ, unique nếu có |
| `personal_email` | Email hợp lệ nếu có |
| `phone` | Theo pattern cấu hình nếu có |
| `department_id` | Bắt buộc khi tạo employee, phải active |
| `position_id` | Bắt buộc khi tạo employee, phải active |
| `job_level_id` | Nếu có phải active |
| `direct_manager_id` | Không được là chính employee, không tạo vòng lặp |
| `joined_date` | Bắt buộc khi tạo employee |
| `probation_end_date` | Không nhỏ hơn probation_start_date nếu có |
| `official_date` | Không nhỏ hơn joined_date nếu có |
| `resigned_date` | Bắt buộc nếu status Resigned theo cấu hình |
| `employment_status` | Thuộc enum hợp lệ |
| `employee_type` | Thuộc enum hợp lệ nếu có |

---

### 22.2 Department validation

| Field | Rule |
| --- | --- |
| `department_code` | Unique theo company |
| `name` | Bắt buộc |
| `parent_id` | Không được là chính nó, không tạo vòng lặp |
| `manager_employee_id` | Employee active cùng company |
| `status` | Active/Inactive |

---

### 22.3 Position validation

| Field | Rule |
| --- | --- |
| `position_code` | Unique theo company |
| `name` | Bắt buộc |
| `department_id` | Nếu có phải active |
| `job_level_id` | Nếu có phải active |
| `status` | Active/Inactive |

---

### 22.4 Contract validation

| Field | Rule |
| --- | --- |
| `contract_type_id` | Bắt buộc, active |
| `start_date` | Bắt buộc |
| `end_date` | Không nhỏ hơn start_date |
| `status` | Draft/Active/Expired/Terminated/Cancelled |
| `is_primary` | Nếu true, đảm bảo chỉ một primary contract mỗi employee |
| `file_id` | File tồn tại, thuộc company, user có quyền link |

---

## 23. Mã lỗi HR

| Error code | HTTP | Mô tả |
| --- | ---: | --- |
| `HR-ERR-EMPLOYEE-NOT-FOUND` | 404 | Không tìm thấy nhân viên hoặc không có quyền xem |
| `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID` | 422 | Cấu hình sinh mã nhân viên không hợp lệ |
| `HR-ERR-EMPLOYEE-CODE-DUPLICATED` | 409 | Mã nhân viên đã tồn tại |
| `HR-ERR-EMPLOYEE-CODE-LOCKED` | 422 | Mã nhân viên đang bị khóa không được sửa |
| `HR-ERR-EMPLOYEE-CODE-MANUAL-NOT-ALLOWED` | 403 | Không được nhập/sửa mã thủ công |
| `HR-ERR-COMPANY-EMAIL-DUPLICATED` | 409 | Email công ty đã tồn tại |
| `HR-ERR-USER-EMAIL-DUPLICATED` | 409 | Email user đã tồn tại |
| `HR-ERR-DEPARTMENT-NOT-FOUND` | 404 | Không tìm thấy phòng ban |
| `HR-ERR-DEPARTMENT-INACTIVE` | 422 | Phòng ban inactive không thể dùng |
| `HR-ERR-DEPARTMENT-CODE-DUPLICATED` | 409 | Mã phòng ban đã tồn tại |
| `HR-ERR-DEPARTMENT-HAS-EMPLOYEES` | 422 | Không thể xóa phòng ban còn nhân viên active |
| `HR-ERR-DEPARTMENT-HAS-CHILDREN` | 422 | Không thể xóa phòng ban còn phòng ban con active |
| `HR-ERR-DEPARTMENT-CYCLE` | 422 | Cây phòng ban bị vòng lặp |
| `HR-ERR-POSITION-NOT-FOUND` | 404 | Không tìm thấy chức vụ |
| `HR-ERR-POSITION-INACTIVE` | 422 | Chức vụ inactive không thể dùng |
| `HR-ERR-POSITION-CODE-DUPLICATED` | 409 | Mã chức vụ đã tồn tại |
| `HR-ERR-POSITION-HAS-EMPLOYEES` | 422 | Không thể xóa chức vụ còn nhân viên active |
| `HR-ERR-MANAGER-INVALID` | 422 | Quản lý trực tiếp không hợp lệ |
| `HR-ERR-MANAGER-CYCLE` | 422 | Chuỗi quản lý bị vòng lặp |
| `HR-ERR-EMPLOYMENT-STATUS-INVALID` | 422 | Trạng thái nhân viên không hợp lệ |
| `HR-ERR-USER-LINKED-TO-ANOTHER-EMPLOYEE` | 409 | User đã liên kết với employee khác |
| `HR-ERR-EMPLOYEE-ALREADY-LINKED-USER` | 409 | Employee đã có user liên kết |
| `HR-ERR-PROFILE-CHANGE-NOT-FOUND` | 404 | Không tìm thấy yêu cầu cập nhật hồ sơ |
| `HR-ERR-PROFILE-CHANGE-NOT-PENDING` | 422 | Chỉ xử lý request Pending |
| `HR-ERR-PROFILE-CHANGE-FIELD-NOT-ALLOWED` | 422 | Field không được phép self-service |
| `HR-ERR-PROFILE-CHANGE-NO-DIFF` | 422 | Không có thay đổi so với dữ liệu hiện tại |
| `HR-ERR-CONTRACT-NOT-FOUND` | 404 | Không tìm thấy hợp đồng |
| `HR-ERR-CONTRACT-DATE-INVALID` | 422 | Ngày hợp đồng không hợp lệ |
| `HR-ERR-CONTRACT-PRIMARY-CONFLICT` | 409 | Xung đột hợp đồng chính |
| `HR-ERR-FILE-NOT-FOUND` | 404 | Không tìm thấy file hồ sơ |
| `HR-ERR-FILE-SENSITIVE-FORBIDDEN` | 403 | Không có quyền xem file nhạy cảm |
| `AUTH-ERR-FORBIDDEN` | 403 | Không có quyền |
| `AUTH-ERR-SCOPE-DENIED` | 403 | Dữ liệu không nằm trong scope |
| `VALIDATION-ERR-001` | 400 | Dữ liệu không hợp lệ |
| `RESOURCE-ERR-CONFLICT` | 409 | Xung đột dữ liệu |

---

## 24. Audit log

### 24.1 Các action bắt buộc ghi audit

| Action | Khi nào ghi |
| --- | --- |
| `HR_EMPLOYEE_CREATED` | Tạo nhân viên |
| `HR_EMPLOYEE_UPDATED` | Cập nhật hồ sơ |
| `HR_EMPLOYEE_STATUS_CHANGED` | Đổi trạng thái |
| `HR_EMPLOYEE_DELETED` | Xóa mềm nhân viên |
| `HR_EMPLOYEE_USER_LINKED` | Liên kết user |
| `HR_EMPLOYEE_USER_UNLINKED` | Hủy liên kết user |
| `HR_EMPLOYEE_EXPORTED` | Export danh sách |
| `HR_EMPLOYEE_SENSITIVE_VIEWED` | Xem dữ liệu nhạy cảm nếu cấu hình bật |
| `HR_EMPLOYEE_FILE_UPLOADED` | Upload file hồ sơ |
| `HR_EMPLOYEE_FILE_DOWNLOADED` | Tải file hồ sơ |
| `HR_EMPLOYEE_FILE_DELETED` | Xóa file hồ sơ |
| `HR_CONTRACT_CREATED` | Tạo hợp đồng |
| `HR_CONTRACT_UPDATED` | Cập nhật hợp đồng |
| `HR_CONTRACT_DELETED` | Xóa mềm hợp đồng |
| `HR_PROFILE_CHANGE_SUBMITTED` | Employee gửi yêu cầu cập nhật hồ sơ |
| `HR_PROFILE_CHANGE_APPROVED` | Duyệt yêu cầu |
| `HR_PROFILE_CHANGE_REJECTED` | Từ chối yêu cầu |
| `HR_PROFILE_CHANGE_CANCELLED` | Employee hủy yêu cầu |
| `HR_EMPLOYEE_CODE_CONFIG_UPDATED` | Cập nhật cấu hình mã nhân viên |
| `HR_EMPLOYEE_CODE_UNLOCKED` | Mở khóa sửa mã nhân viên |
| `HR_EMPLOYEE_CODE_LOCKED` | Khóa sửa mã nhân viên |
| `HR_DEPARTMENT_CREATED/UPDATED/DELETED` | Thay đổi phòng ban |
| `HR_POSITION_CREATED/UPDATED/DELETED` | Thay đổi chức vụ |
| `HR_MASTER_DATA_CHANGED` | Thay đổi job level/contract type |

---

### 24.2 Audit payload đề xuất

```json
{
  "module_code": "HR",
  "action": "HR_EMPLOYEE_UPDATED",
  "target_type": "Employee",
  "target_id": "employee-uuid",
  "actor_user_id": "user-uuid",
  "company_id": "company-uuid",
  "old_value": {
    "phone": "0900000000"
  },
  "new_value": {
    "phone": "0911111111"
  },
  "metadata": {
    "request_id": "req_20260620_000001",
    "ip_address": "127.0.0.1",
    "user_agent": "Mozilla/5.0"
  }
}
```

---

## 25. Notification events từ HR

| Event code | Khi phát | Người nhận đề xuất |
| --- | --- | --- |
| `HR_EMPLOYEE_CREATED` | Tạo hồ sơ nhân viên | HR/Admin hoặc employee nếu đã có user |
| `HR_EMPLOYEE_UPDATED` | Hồ sơ nhân viên được cập nhật | Employee liên quan nếu cấu hình bật |
| `HR_EMPLOYEE_STATUS_CHANGED` | Trạng thái nhân viên thay đổi | Employee, Manager, HR tùy cấu hình |
| `HR_EMPLOYEE_USER_LINKED` | Employee được liên kết user | Employee/user liên quan |
| `HR_CONTRACT_CREATED` | Tạo hợp đồng | HR, Employee nếu cấu hình bật |
| `HR_CONTRACT_EXPIRING_SOON` | Hợp đồng sắp hết hạn, thường do job | HR, Manager |
| `HR_PROFILE_CHANGE_SUBMITTED` | Employee gửi yêu cầu cập nhật hồ sơ | HR/Admin có quyền xử lý |
| `HR_PROFILE_CHANGE_APPROVED` | HR/Admin duyệt yêu cầu | Employee gửi yêu cầu |
| `HR_PROFILE_CHANGE_REJECTED` | HR/Admin từ chối yêu cầu | Employee gửi yêu cầu |
| `HR_PROFILE_CHANGE_CANCELLED` | Employee hủy yêu cầu | HR/Admin nếu cần |
| `HR_EMPLOYEE_CODE_CONFIG_UPDATED` | Cấu hình mã nhân viên thay đổi | Admin/HR nếu cần |

> Registry NOTI chuẩn (xem SPEC-08 §15) cho HR self-service gồm 3 event: `HR_PROFILE_CHANGE_SUBMITTED`, `HR_PROFILE_CHANGE_APPROVED`, `HR_PROFILE_CHANGE_REJECTED`. `HR_PROFILE_CHANGE_CANCELLED` chỉ dùng nội bộ (audit/thông báo HR), không nằm trong registry NOTI người dùng.

### Nguyên tắc payload notification

1. Không chứa dữ liệu nhạy cảm quá mức.
2. Chỉ chứa `target_module`, `target_type`, `target_id`, `display_code`, `summary`.
3. Khi user bấm notification, API module HR vẫn phải kiểm tra quyền trước khi trả chi tiết.

Payload mẫu:

```json
{
  "target_module": "HR",
  "target_type": "ProfileChangeRequest",
  "target_id": "request-uuid",
  "display_code": "PCR-2026-0001",
  "summary": "Nguyễn Văn A gửi yêu cầu cập nhật hồ sơ cá nhân"
}
```

---

## 26. Idempotency

Các API HR sau nên/bắt buộc hỗ trợ `Idempotency-Key`:

| API | Lý do |
| --- | --- |
| Tạo employee | Tránh tạo trùng nhân viên khi user bấm nhiều lần |
| Đổi trạng thái employee | Tránh ghi nhiều history trùng |
| Link user | Tránh link trùng |
| Tạo profile change request | Tránh gửi trùng request |
| Approve/reject profile change request | Tránh xử lý request nhiều lần |
| Tạo contract | Tránh tạo trùng hợp đồng |
| Upload/link file | Tránh link trùng file |
| Export async | Tránh tạo nhiều job export giống nhau |

Quy tắc:

1. `Idempotency-Key` unique theo company + user + endpoint + method.
2. Nếu request cùng key và cùng payload đã thành công, trả lại response cũ.
3. Nếu cùng key nhưng payload khác, trả `RESOURCE-ERR-CONFLICT`.
4. TTL idempotency key đề xuất 24 giờ.

---

## 27. Security checklist cho HR API

- [ ] Mọi endpoint HR yêu cầu access token.
- [ ] Mọi endpoint kiểm tra permission.
- [ ] Endpoint dữ liệu kiểm tra data scope.
- [ ] Query luôn filter `company_id` từ auth context.
- [ ] Không tin `company_id`, `user_id`, `employee_id` tự gửi nếu có thể resolve từ context.
- [ ] Không trả field nhạy cảm nếu thiếu `HR.EMPLOYEE.VIEW_SENSITIVE`.
- [ ] Không trả storage path file private.
- [ ] Download file dùng signed URL ngắn hạn hoặc stream qua backend.
- [ ] Export phải kiểm tra permission export riêng.
- [ ] Export dữ liệu nhạy cảm phải có quyền nhạy cảm.
- [ ] Ghi audit log cho tạo/sửa/xóa/trạng thái/file/export/self-service/code config.
- [ ] Chặn employee truy cập hồ sơ người khác bằng URL trực tiếp.
- [ ] Chặn manager xem ngoài scope Team/Department.
- [ ] Validate UUID path params.
- [ ] Validate enum/status.
- [ ] Rate limit các API export, upload và search nếu cần.

---

## 28. Performance checklist

- [ ] API list employee dùng pagination.
- [ ] Search employee chỉ search field whitelist.
- [ ] Sort chỉ theo field whitelist đã có index.
- [ ] Query employee luôn có `company_id` và `deleted_at IS NULL`.
- [ ] Tránh N+1 khi load department, position, manager.
- [ ] List mặc định chỉ trả field cần thiết.
- [ ] Chi tiết mới load contracts/files/status history theo `include`.
- [ ] Employee lookup giới hạn tối đa 50 bản ghi.
- [ ] Org chart giới hạn depth.
- [ ] Export lớn chạy background.
- [ ] Audit log dùng cursor pagination nếu dữ liệu lớn.
- [ ] Cache ngắn hạn danh mục department/position/job level nếu phù hợp.

---

## 29. Test case API trọng yếu

### 29.1 Employee API

| Mã test | Tình huống | Kết quả mong đợi |
| --- | --- | --- |
| HR-API-TC-001 | HR xem danh sách nhân viên | Thành công, đúng company |
| HR-API-TC-002 | Manager xem danh sách nhân viên scope Team | Chỉ thấy nhân viên thuộc team |
| HR-API-TC-003 | Employee gọi list nhân viên | Bị chặn hoặc chỉ trả Own theo policy |
| HR-API-TC-004 | HR tạo nhân viên hợp lệ | Tạo thành công, sinh employee_code |
| HR-API-TC-005 | Tạo nhân viên thiếu full_name | Validation error |
| HR-API-TC-006 | Tạo nhân viên với department inactive | Business error |
| HR-API-TC-007 | Tạo nhân viên có email trùng | Conflict |
| HR-API-TC-008 | Tạo nhân viên kèm user | Employee và user liên kết |
| HR-API-TC-009 | Tạo nhân viên khi cấu hình mã lỗi | Business error |
| HR-API-TC-010 | HR xem chi tiết nhân viên | Trả dữ liệu theo quyền |
| HR-API-TC-011 | User thiếu VIEW_SENSITIVE xem detail | Field nhạy cảm bị mask/ẩn |
| HR-API-TC-012 | User có VIEW_SENSITIVE xem detail | Trả field nhạy cảm |
| HR-API-TC-013 | Employee mở hồ sơ người khác bằng UUID | 403/404 |
| HR-API-TC-014 | HR cập nhật hồ sơ | Ghi audit log |
| HR-API-TC-015 | Cập nhật direct_manager_id thành chính mình | Bị chặn |
| HR-API-TC-016 | Đổi status sang Resigned | Tạo status history, audit log |
| HR-API-TC-017 | Xóa mềm employee | deleted_at được set, không xóa cứng |

---

### 29.2 Profile Change Request API

| Mã test | Tình huống | Kết quả mong đợi |
| --- | --- | --- |
| HR-API-TC-101 | Employee gửi request đổi phone | Request Pending được tạo |
| HR-API-TC-102 | Employee gửi field không được phép | Bị chặn |
| HR-API-TC-103 | Employee gửi không có thay đổi | Bị chặn |
| HR-API-TC-104 | HR xem danh sách request | Thành công theo scope |
| HR-API-TC-105 | HR duyệt request | Employee được cập nhật, audit log, notification |
| HR-API-TC-106 | HR từ chối request | Employee giữ nguyên, notification |
| HR-API-TC-107 | Employee hủy request Pending | Status Cancelled |
| HR-API-TC-108 | Employee hủy request Approved | Bị chặn |
| HR-API-TC-109 | HR duyệt request đã duyệt | Idempotent hoặc business error theo policy |

---

### 29.3 Department/Position/Contract/File API

| Mã test | Tình huống | Kết quả mong đợi |
| --- | --- | --- |
| HR-API-TC-201 | Tạo department code trùng | Conflict |
| HR-API-TC-202 | Tạo parent department vòng lặp | Bị chặn |
| HR-API-TC-203 | Xóa department còn employee active | Bị chặn |
| HR-API-TC-204 | Tạo position hợp lệ | Thành công |
| HR-API-TC-205 | Xóa position còn employee active | Bị chặn |
| HR-API-TC-206 | Tạo contract end_date < start_date | Validation error |
| HR-API-TC-207 | Set primary contract | Contract khác bị unset primary |
| HR-API-TC-208 | Upload file hồ sơ | File private, audit log |
| HR-API-TC-209 | User không quyền tải file | 403 |
| HR-API-TC-210 | Export employee không quyền | 403 |
| HR-API-TC-211 | Export có sensitive khi thiếu quyền | Không có field sensitive |

---

## 30. Gợi ý thứ tự triển khai backend

### 30.1 Sprint 1 - HR Core Read

1. DTO chuẩn employee summary/detail.
2. Permission guard + data scope resolver cho HR.
3. `GET /hr/employees`.
4. `GET /hr/employees/{id}`.
5. `GET /hr/me/profile`.
6. Department/Position list cho dropdown.

### 30.2 Sprint 2 - HR Core Write

1. Employee code preview + sequence service.
2. `POST /hr/employees`.
3. `PATCH /hr/employees/{id}`.
4. Change status + status history.
5. Audit log integration.
6. Link employee-user với AUTH.

### 30.3 Sprint 3 - Organization Master Data

1. Department CRUD + tree.
2. Position CRUD.
3. Job Level CRUD.
4. Contract Type CRUD.
5. Org chart cơ bản.

### 30.4 Sprint 4 - Contract/File

1. Employee Contract CRUD.
2. Employee File API.
3. Signed download URL.
4. File access audit.
5. Export employee.

### 30.5 Sprint 5 - Employee Self-Service

1. Editable fields config.
2. Employee create profile change request.
3. HR list/detail profile change request.
4. Approve/reject/cancel workflow.
5. Notification events.

---

## 31. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/hr.paths.yaml`](openapi/paths/hr.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 31.1 Security
`bearerAuth` (HTTP bearer JWT) cho mọi endpoint HR (`/api/v1/hr/*`); không có endpoint public. File upload dùng `multipart/form-data`.

### 31.2 Tags của module
- `HR - Employees` — hồ sơ nhân viên (list/detail/create/update/delete/status/export/lookup)
- `HR - My Profile` — hồ sơ cá nhân & yêu cầu sửa của tôi
- `HR - Profile Change Requests` — duyệt yêu cầu sửa hồ sơ
- `HR - Departments` — phòng ban
- `HR - Positions` — chức vụ
- `HR - Master Data` — job level, contract type
- `HR - Contracts` — hợp đồng lao động
- `HR - Employee Files` — file hồ sơ
- `HR - Employee Code` — cấu hình & sinh mã nhân viên
- `HR - Org Chart` — sơ đồ tổ chức
- `HR - Audit Logs` — audit hồ sơ

### 31.3 Vendor extensions (đồng nhất toàn hệ thống)
| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `hr`.

### 31.4 Schema & response dùng chung
Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/413/415/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`, `IfMatch`.

### 31.5 DTO đề xuất cho module
`EmployeeListItemDto`, `EmployeeDetailDto`, `CreateEmployeeRequest`, `UpdateEmployeeRequest`, `ChangeEmployeeStatusRequest`, `DepartmentDto`, `DepartmentTreeNodeDto`, `PositionDto`, `JobLevelDto`, `ContractTypeDto`, `ContractDto`, `CreateContractRequest`, `ProfileChangeRequestDto`, `CreateProfileChangeRequest`, `EmployeeFileDto`, `EmployeeCodeConfigDto`, `EmployeeCodePreviewDto`, `OrgChartNodeDto`, `EmployeeLookupDto`.

---

## 32. Kết luận

API-03 định nghĩa đầy đủ nhóm API cho module HR trong MVP Version 1.0.

Các điểm quan trọng cần giữ khi triển khai:

1. HR API phải tuân thủ chuẩn chung của API-01 về `/api/v1`, response format, error format, pagination, search/filter/sort, upload file, audit log, notification event và idempotency.
2. Backend luôn kiểm tra permission và data scope; không dựa vào frontend.
3. `employees` là dữ liệu trung tâm, liên kết với AUTH qua `employees.user_id`.
4. Dữ liệu nhạy cảm phải được kiểm soát bằng `HR.EMPLOYEE.VIEW_SENSITIVE`, file permission và export permission.
5. Employee Self-Service không cập nhật trực tiếp hồ sơ chính; phải qua `profile_change_requests` và chỉ áp dụng sau khi HR/Admin duyệt.
6. Mã nhân viên mặc định sinh tự động theo `employee_code_configs` và `sequence_counters`; manual override cần quyền và config cho phép.
7. Mọi thao tác quan trọng như tạo/cập nhật/xóa employee, đổi trạng thái, hợp đồng, file, self-service và cấu hình mã đều phải ghi audit log.
8. HR phát event cho NOTI và DASH khi có thay đổi quan trọng.
9. API list phải phân trang, có filter/sort whitelist và không trả field nhạy cảm mặc định.
10. Thiết kế API đủ mở để tích hợp ATT, LEAVE, TASK, DASH, NOTI và các module phase sau.
