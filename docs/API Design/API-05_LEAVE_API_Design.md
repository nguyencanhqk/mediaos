# API-05: LEAVE API DESIGN

**MODULE NGHỈ PHÉP - LEAVE API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · **API-05 LEAVE** · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-05 LEAVE](<../SPEC/SPEC-05 LEAVE.md>) · [Thiết kế DB: DB-05 LEAVE](<../DB/DB-05 LEAVE Database Design.md>) · [Sản phẩm: PRD-00 §9.4](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-05 |
| Tên tài liệu | LEAVE API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | LEAVE - Nghỉ phép |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01, API-02, API-03, API-04 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **LEAVE - Nghỉ phép** của hệ thống quản lý doanh nghiệp nội bộ.

Module LEAVE chịu trách nhiệm cung cấp API cho các nghiệp vụ:

1. Nhân viên xem số ngày phép còn lại.
2. Nhân viên tạo đơn nghỉ phép.
3. Nhân viên lưu nháp, cập nhật nháp và gửi đơn nghỉ.
4. Nhân viên xem danh sách và chi tiết đơn nghỉ của chính mình.
5. Nhân viên hủy đơn nghỉ theo rule được cấu hình.
6. Manager/HR/Admin xem danh sách đơn nghỉ theo phạm vi dữ liệu.
7. Manager/HR/Admin duyệt hoặc từ chối đơn nghỉ.
8. HR/Admin hủy hoặc thu hồi đơn nghỉ đã duyệt nếu policy cho phép.
9. HR/Admin quản lý loại nghỉ phép.
10. HR/Admin quản lý chính sách nghỉ phép.
11. HR/Admin quản lý số dư phép và lịch sử giao dịch số dư phép.
12. Người dùng xem lịch nghỉ cá nhân, team, phòng ban hoặc toàn công ty theo quyền.
13. LEAVE đồng bộ đơn nghỉ Approved/Cancelled/Revoked sang ATT.
14. LEAVE phát notification event sang NOTI.
15. LEAVE cung cấp dữ liệu cho DASH và Payroll phase sau.

Tài liệu API-05 dùng làm cơ sở cho:

1. Backend triển khai controller, route, DTO, validation, service và repository cho LEAVE.
2. Frontend triển khai màn hình nghỉ phép, lịch nghỉ, duyệt đơn, quản lý loại nghỉ, chính sách và số dư phép.
3. QA viết API test case, permission test, data scope test, state transition test, balance test và ATT sync regression test.
4. DevOps/API documentation tạo OpenAPI/Swagger cho module LEAVE.
5. Các module ATT, DASH, NOTI và Payroll phase sau tích hợp với dữ liệu nghỉ phép đúng chuẩn.

---

## 3. Căn cứ thiết kế

API-05 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định tất cả API dùng prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business validation, audit log, notification event và idempotency cho nghiệp vụ quan trọng.
2. **SPEC-05** xác định LEAVE là module lõi của MVP, chịu trách nhiệm loại nghỉ, chính sách nghỉ, số dư phép, đơn nghỉ, duyệt/từ chối/hủy, lịch nghỉ và đồng bộ sang chấm công.
3. **DB-05** xác định các bảng chính gồm `leave_types`, `leave_policies`, `leave_balances`, `leave_balance_transactions`, `leave_requests`, `leave_request_days`, `leave_request_approvals`.
4. **AUTH/API-02** là nền tảng xác thực, permission, role và data scope.
5. **HR/API-03** cung cấp employee, department, position, job level, direct manager, employment status và user-employee mapping.
6. **ATT/API-04** nhận dữ liệu nghỉ Approved/Cancelled/Revoked để cập nhật hoặc tính lại bảng công.
7. **FOUNDATION/API-09** cung cấp audit log, file service, setting service, sequence service và public holiday service.
8. **NOTI/API-07** nhận event từ LEAVE để tạo thông báo.
9. **DASH/API-08** lấy dữ liệu phép còn lại, đơn chờ duyệt và lịch nghỉ để hiển thị widget.

---

## 4. Phạm vi API-05

### 4.1 Bao gồm trong MVP

API-05 bao gồm các nhóm API sau:

| Nhóm API | Mô tả |
| --- | --- |
| My Leave Balance API | Nhân viên xem số dư phép của chính mình |
| My Leave Request API | Nhân viên tạo, lưu nháp, gửi, xem và hủy đơn nghỉ của mình |
| Leave Request Admin API | Manager/HR/Admin xem, duyệt, từ chối, hủy hoặc thu hồi đơn nghỉ theo quyền |
| Leave Calculation API | Preview số ngày/giờ nghỉ, kiểm tra balance, rule và xung đột trước khi gửi |
| Leave Calendar API | Lịch nghỉ cá nhân, team, phòng ban, công ty theo quyền |
| Leave Type API | Quản lý danh mục loại nghỉ phép |
| Leave Policy API | Quản lý chính sách nghỉ phép |
| Leave Balance Admin API | HR/Admin xem, điều chỉnh số dư phép, xem ledger giao dịch |
| Leave File API | Link/unlink file chứng minh trong đơn nghỉ thông qua file service dùng chung |
| Leave History API | Lịch sử xử lý đơn nghỉ và lịch sử thay đổi số dư |
| Leave Export API | Xuất danh sách đơn nghỉ, lịch nghỉ hoặc số dư phép theo quyền |
| Internal Sync API | Endpoint nội bộ hoặc service contract để đồng bộ LEAVE -> ATT, NOTI, DASH cache |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Multi-level approval nâng cao | Phase sau | `/api/v1/leave/approval-flows` |
| Tự động cộng phép định kỳ | Phase sau | `/internal/v1/leave/accrual-jobs` |
| Reset phép đầu năm | Phase sau | `/internal/v1/leave/yearly-reset-jobs` |
| Carry over phép tồn | Phase sau | `/api/v1/leave/carry-over-rules` |
| Nghỉ bù theo overtime | Phase sau | Liên kết với Overtime/ATT |
| Import số dư phép từ Excel | Phase sau | `/api/v1/leave/imports` |
| Đồng bộ Google/Microsoft Calendar | Phase sau | `/api/v1/leave/calendar-integrations` |
| Mobile push notification | Phase sau | NOTI/MOBILE xử lý device token |
| AI gợi ý người thay thế khi nghỉ | Phase sau | `/api/v1/leave/ai/suggestions` |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint LEAVE dùng prefix:

```http
/api/v1/leave
```

Ví dụ:

```http
GET    /api/v1/leave/me/balances
GET    /api/v1/leave/me/requests
POST   /api/v1/leave/requests
POST   /api/v1/leave/requests/{request_id}/submit
POST   /api/v1/leave/requests/{request_id}/approve
GET    /api/v1/leave/calendar
GET    /api/v1/leave/types
PATCH  /api/v1/leave/balances/{balance_id}/adjust
```

---

### 5.2 Authentication

Tất cả API LEAVE yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint LEAVE public trong MVP.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ LEAVE thông thường.

Quy tắc:

1. Mọi query LEAVE phải filter theo `company_id`.
2. Super Admin có scope `System` mới được truy vấn liên công ty.
3. Nếu request body có `company_id` mà endpoint không cho phép, backend bỏ qua hoặc trả validation error.
4. Không trả dữ liệu công ty khác kể cả khi client biết UUID.
5. `employee_id` của API self-service phải resolve từ user hiện tại, không tin giá trị do frontend gửi.

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

### 6.2 Scope chuẩn trong LEAVE

| Scope | Ý nghĩa trong LEAVE |
| --- | --- |
| `Own` | Chỉ thao tác đơn nghỉ, số dư, lịch nghỉ của employee liên kết với user hiện tại |
| `Team` | Thao tác dữ liệu nghỉ của nhân viên có `direct_manager_id` là employee của user hiện tại hoặc thuộc team quản lý |
| `Department` | Thao tác dữ liệu nghỉ thuộc phòng ban được phân quyền |
| `Company` | Thao tác dữ liệu nghỉ toàn công ty hiện tại |
| `System` | Thao tác liên công ty, chỉ dành cho Super Admin |

---

### 6.3 Quyền LEAVE trong MVP

| Permission | Mục đích |
| --- | --- |
| `LEAVE.BALANCE.VIEW_OWN` | Xem số dư phép của chính mình |
| `LEAVE.BALANCE.VIEW` | Xem số dư phép theo phạm vi được cấp |
| `LEAVE.BALANCE.ADJUST` | Điều chỉnh số dư phép |
| `LEAVE.BALANCE.TRANSACTION_VIEW` | Xem lịch sử giao dịch số dư phép |
| `LEAVE.REQUEST.CREATE` | Tạo/lưu nháp đơn nghỉ của chính mình |
| `LEAVE.REQUEST.SUBMIT` | Gửi đơn nghỉ của chính mình |
| `LEAVE.REQUEST.VIEW_OWN` | Xem đơn nghỉ của chính mình |
| `LEAVE.REQUEST.VIEW` | Xem đơn nghỉ theo phạm vi được cấp |
| `LEAVE.REQUEST.UPDATE_DRAFT` | Cập nhật đơn nháp của chính mình |
| `LEAVE.REQUEST.CANCEL_OWN` | Hủy đơn nghỉ của chính mình theo policy |
| `LEAVE.REQUEST.APPROVE` | Duyệt đơn nghỉ theo phạm vi được cấp |
| `LEAVE.REQUEST.REJECT` | Từ chối đơn nghỉ theo phạm vi được cấp |
| `LEAVE.REQUEST.CANCEL_ANY` | HR/Admin hủy đơn nghỉ theo phạm vi được cấp |
| `LEAVE.REQUEST.REVOKE` | Thu hồi đơn đã duyệt theo phạm vi được cấp |
| `LEAVE.REQUEST.EXPORT` | Xuất dữ liệu đơn nghỉ |
| `LEAVE.CALENDAR.VIEW_OWN` | Xem lịch nghỉ của chính mình |
| `LEAVE.CALENDAR.VIEW_TEAM` | Xem lịch nghỉ của team |
| `LEAVE.CALENDAR.VIEW_COMPANY` | Xem lịch nghỉ toàn công ty |
| `LEAVE.TYPE.VIEW` | Xem danh mục loại nghỉ |
| `LEAVE.TYPE.CREATE` | Tạo loại nghỉ |
| `LEAVE.TYPE.UPDATE` | Cập nhật loại nghỉ |
| `LEAVE.TYPE.DELETE` | Xóa mềm loại nghỉ |
| `LEAVE.POLICY.VIEW` | Xem chính sách nghỉ phép |
| `LEAVE.POLICY.CREATE` | Tạo chính sách nghỉ phép |
| `LEAVE.POLICY.UPDATE` | Cập nhật chính sách nghỉ phép |
| `LEAVE.POLICY.DELETE` | Xóa mềm chính sách nghỉ phép |
| `LEAVE.FILE.VIEW` | Xem file chứng minh trong đơn nghỉ |
| `LEAVE.FILE.UPLOAD` | Upload/link file chứng minh |
| `LEAVE.FILE.DELETE` | Xóa/unlink file chứng minh |
| `LEAVE.AUDIT_LOG.VIEW` | Xem lịch sử xử lý và audit liên quan đến nghỉ phép |

---

### 6.4 Mapping role mặc định tham khảo

| Role | Permission gợi ý | Scope gợi ý |
| --- | --- | --- |
| Employee | `LEAVE.BALANCE.VIEW_OWN`, `LEAVE.REQUEST.CREATE`, `LEAVE.REQUEST.SUBMIT`, `LEAVE.REQUEST.VIEW_OWN`, `LEAVE.REQUEST.UPDATE_DRAFT`, `LEAVE.REQUEST.CANCEL_OWN`, `LEAVE.CALENDAR.VIEW_OWN`, `LEAVE.FILE.UPLOAD` | Own |
| Manager | `LEAVE.REQUEST.VIEW`, `LEAVE.REQUEST.APPROVE`, `LEAVE.REQUEST.REJECT`, `LEAVE.CALENDAR.VIEW_TEAM`, `LEAVE.BALANCE.VIEW` | Team |
| HR | Toàn bộ permission nghiệp vụ LEAVE trừ quyền System | Company |
| Admin công ty | Quản trị LEAVE nếu được cấp quyền | Company |
| Super Admin | Toàn bộ permission | System |
| Payroll Officer | `LEAVE.BALANCE.VIEW`, `LEAVE.REQUEST.VIEW`, `LEAVE.REQUEST.EXPORT` | Company hoặc Department |

---

## 7. Dữ liệu nhạy cảm và field masking

### 7.1 Dữ liệu nghỉ phép có thể nhạy cảm

Các dữ liệu sau cần được xem là nhạy cảm tùy chính sách công ty:

```text
reason
handover_note
medical_certificate_file
attachment file private URL
leave_type nếu là loại nghỉ nhạy cảm
review_note nếu chứa thông tin cá nhân
```

---

### 7.2 Nguyên tắc trả dữ liệu nhạy cảm

1. Danh sách đơn nghỉ mặc định không trả đầy đủ `reason` nếu user không phải chủ đơn hoặc người có quyền xử lý.
2. Lịch nghỉ team/company mặc định có thể chỉ hiển thị nhân viên, thời gian, loại nghỉ chung và trạng thái Approved.
3. Nếu `leave_type.is_sensitive = true`, backend có thể trả nhãn chung như `Nghỉ phép` thay vì tên loại nghỉ chi tiết cho người không có quyền.
4. File đính kèm không trả storage path thật.
5. Download file phải cấp signed URL ngắn hạn sau khi kiểm tra permission và data scope.
6. Notification payload không chứa lý do nghỉ đầy đủ hoặc file URL private.
7. Export có thể loại bỏ lý do nghỉ/file nhạy cảm nếu user thiếu permission tương ứng.

---

## 8. DTO dùng chung

### 8.1 Leave type DTO

```json
{
  "id": "leave-type-uuid",
  "leave_type_code": "ANNUAL",
  "name": "Nghỉ phép năm",
  "description": "Nghỉ phép có hưởng lương",
  "unit": "Day",
  "is_paid": true,
  "is_balance_required": true,
  "is_attachment_required": false,
  "is_reason_required": true,
  "is_sensitive": false,
  "allow_half_day": true,
  "allow_hourly": false,
  "allow_negative_balance": false,
  "max_days_per_request": 5,
  "min_notice_days": 1,
  "status": "Active",
  "sort_order": 1
}
```

---

### 8.2 Leave balance DTO

```json
{
  "id": "balance-uuid",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "department": {
      "id": "department-uuid",
      "name": "Phòng Kỹ thuật"
    }
  },
  "leave_type": {
    "id": "leave-type-uuid",
    "leave_type_code": "ANNUAL",
    "name": "Nghỉ phép năm"
  },
  "period_year": 2026,
  "opening_balance": 12.0,
  "accrued_days": 0.0,
  "used_days": 2.0,
  "reserved_days": 1.0,
  "adjusted_days": 0.0,
  "remaining_days": 9.0,
  "unit": "Day",
  "last_transaction_at": "2026-06-20T10:00:00+07:00"
}
```

---

### 8.3 Leave request summary DTO

```json
{
  "id": "leave-request-uuid",
  "request_code": "LR-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "department": {
      "id": "department-uuid",
      "name": "Phòng Kỹ thuật"
    }
  },
  "leave_type": {
    "id": "leave-type-uuid",
    "leave_type_code": "ANNUAL",
    "name": "Nghỉ phép năm"
  },
  "start_date": "2026-06-25",
  "end_date": "2026-06-26",
  "duration_type": "FullDay",
  "calculated_days": 2.0,
  "calculated_hours": 16.0,
  "status": "Pending",
  "approver": {
    "id": "approver-employee-uuid",
    "employee_code": "EMP0002",
    "full_name": "Trần Thị B"
  },
  "submitted_at": "2026-06-20T10:00:00+07:00",
  "created_at": "2026-06-20T09:50:00+07:00"
}
```

---

### 8.4 Leave request detail DTO

```json
{
  "id": "leave-request-uuid",
  "request_code": "LR-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "department": {
      "id": "department-uuid",
      "name": "Phòng Kỹ thuật"
    },
    "position": {
      "id": "position-uuid",
      "name": "Developer"
    },
    "direct_manager": {
      "id": "manager-employee-uuid",
      "full_name": "Trần Thị B"
    }
  },
  "leave_type": {
    "id": "leave-type-uuid",
    "leave_type_code": "ANNUAL",
    "name": "Nghỉ phép năm"
  },
  "start_date": "2026-06-25",
  "end_date": "2026-06-26",
  "start_time": null,
  "end_time": null,
  "duration_type": "FullDay",
  "half_day_session": null,
  "calculated_days": 2.0,
  "calculated_hours": 16.0,
  "reason": "Việc gia đình",
  "handover_note": "Đã bàn giao task cho bạn C",
  "status": "Pending",
  "balance_snapshot": {
    "before_remaining_days": 11.0,
    "requested_days": 2.0,
    "after_remaining_days": 9.0
  },
  "days": [
    {
      "date": "2026-06-25",
      "duration_type": "FullDay",
      "leave_days": 1.0,
      "leave_hours": 8.0,
      "sync_status": "Pending"
    },
    {
      "date": "2026-06-26",
      "duration_type": "FullDay",
      "leave_days": 1.0,
      "leave_hours": 8.0,
      "sync_status": "Pending"
    }
  ],
  "files": [
    {
      "file_id": "file-uuid",
      "file_name": "medical.pdf",
      "mime_type": "application/pdf",
      "size": 120000
    }
  ],
  "approvals": [
    {
      "id": "approval-uuid",
      "action": "Submitted",
      "actor": {
        "id": "user-uuid",
        "full_name": "Nguyễn Văn A"
      },
      "note": null,
      "created_at": "2026-06-20T10:00:00+07:00"
    }
  ],
  "submitted_at": "2026-06-20T10:00:00+07:00",
  "approved_at": null,
  "rejected_at": null,
  "cancelled_at": null,
  "created_at": "2026-06-20T09:50:00+07:00",
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

---

### 8.5 Leave calendar item DTO

```json
{
  "id": "leave-request-day-uuid",
  "leave_request_id": "leave-request-uuid",
  "request_code": "LR-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A",
    "department": {
      "id": "department-uuid",
      "name": "Phòng Kỹ thuật"
    }
  },
  "leave_type": {
    "id": "leave-type-uuid",
    "name": "Nghỉ phép năm",
    "color": "#4F46E5"
  },
  "date": "2026-06-25",
  "duration_type": "FullDay",
  "half_day_session": null,
  "start_time": null,
  "end_time": null,
  "status": "Approved",
  "display_reason": null
}
```

---

### 8.6 Leave balance transaction DTO

```json
{
  "id": "transaction-uuid",
  "transaction_code": "LBT-2026-0001",
  "employee": {
    "id": "employee-uuid",
    "employee_code": "EMP0001",
    "full_name": "Nguyễn Văn A"
  },
  "leave_type": {
    "id": "leave-type-uuid",
    "name": "Nghỉ phép năm"
  },
  "transaction_type": "ADJUSTMENT",
  "amount_days": 1.0,
  "balance_before": 9.0,
  "balance_after": 10.0,
  "related_leave_request_id": null,
  "reason": "Điều chỉnh đầu kỳ",
  "actor": {
    "id": "user-uuid",
    "full_name": "HR User"
  },
  "created_at": "2026-06-20T10:00:00+07:00"
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
GET /api/v1/leave/requests?search=LR-2026-0001
```

Search whitelist cho LEAVE:

```text
request_code
employee_code
employee full name
leave_type_code
```

Với My Leave Request API, search có thể tìm thêm theo `reason`, nhưng backend cần cân nhắc dữ liệu nhạy cảm.

---

### 9.3 Sort

Format:

```http
GET /api/v1/leave/requests?sort=submitted_at:desc
```

Sort whitelist cho leave requests:

```text
created_at
updated_at
submitted_at
approved_at
start_date
end_date
status
request_code
calculated_days
```

Mặc định:

```text
created_at:desc
```

Nếu sort field không hợp lệ, trả `VALIDATION-ERR-001`.

---

### 9.4 Filter leave request

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `status` | String | Draft/Pending/Approved/Rejected/Cancelled/Revoked |
| `leave_type_id` | UUID | Lọc theo loại nghỉ |
| `employee_id` | UUID | Lọc theo nhân viên, chỉ API admin và phải nằm trong scope |
| `department_id` | UUID | Lọc theo phòng ban |
| `approver_employee_id` | UUID | Lọc theo người duyệt |
| `from_date` | Date | Ngày nghỉ từ |
| `to_date` | Date | Ngày nghỉ đến |
| `submitted_from` | DateTime | Ngày gửi từ |
| `submitted_to` | DateTime | Ngày gửi đến |
| `reviewed_from` | DateTime | Ngày xử lý từ |
| `reviewed_to` | DateTime | Ngày xử lý đến |
| `duration_type` | String | FullDay/HalfDay/Hourly/MultipleDays |
| `include_sensitive` | Boolean | Chỉ có tác dụng nếu user có quyền xem dữ liệu nhạy cảm |

---

### 9.5 Filter calendar

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `from_date` | Date | Có | Ngày bắt đầu |
| `to_date` | Date | Có | Ngày kết thúc |
| `view_mode` | String | Không | Month/Week/Day/List |
| `scope` | String | Không | Own/Team/Department/Company |
| `department_id` | UUID | Không | Lọc theo phòng ban nếu có quyền |
| `employee_id` | UUID | Không | Lọc theo nhân viên nếu có quyền |
| `leave_type_id` | UUID | Không | Lọc theo loại nghỉ |
| `status` | String | Không | Mặc định Approved; có thể Pending nếu có quyền |

---

## 10. Trạng thái và state machine

### 10.1 Trạng thái đơn nghỉ

| Status | Ý nghĩa |
| --- | --- |
| `Draft` | Đơn nháp, chưa gửi |
| `Pending` | Đã gửi, chờ duyệt |
| `Approved` | Đã duyệt |
| `Rejected` | Bị từ chối |
| `Cancelled` | Đã hủy |
| `Revoked` | Đã thu hồi sau khi duyệt |

---

### 10.2 Luồng trạng thái hợp lệ

```text
Draft -> Pending
Draft -> Cancelled
Pending -> Approved
Pending -> Rejected
Pending -> Cancelled
Approved -> Cancelled   nếu policy cho phép nhân viên hủy sau duyệt
Approved -> Revoked     HR/Admin thu hồi
Rejected -> terminal
Cancelled -> terminal
Revoked -> terminal
```

Backend phải kiểm tra state transition. Không được chỉ dựa vào frontend để ẩn button.

---

## 11. Quy tắc nghiệp vụ cốt lõi

### 11.1 Tạo và gửi đơn nghỉ

1. User phải liên kết với employee hợp lệ.
2. Employee phải có trạng thái cho phép xin nghỉ, ví dụ `Probation` hoặc `Official`.
3. Leave type phải active.
4. Leave type phải cho phép duration type được chọn.
5. Ngày bắt đầu không được sau ngày kết thúc.
6. Nếu nghỉ theo giờ, `start_time` và `end_time` bắt buộc.
7. Nếu nghỉ nửa ngày, `half_day_session` bắt buộc: `Morning` hoặc `Afternoon`.
8. Nếu leave type yêu cầu lý do, `reason` bắt buộc.
9. Nếu leave type yêu cầu file, phải có file hợp lệ.
10. Backend tính ngày nghỉ dựa trên ngày làm việc, ngày lễ, cuối tuần, shift và rule.
11. Nếu leave type cần trừ số dư, phải kiểm tra balance.
12. Nếu không cho phép âm phép, remaining balance không được âm sau khi trừ hoặc reserve.
13. Không cho tạo/gửi đơn trùng thời gian với đơn Pending/Approved khác, trừ khi policy cho phép.
14. Khi gửi đơn, backend xác định approver theo direct manager hoặc policy.
15. Gửi đơn cần idempotency để tránh submit trùng.

---

### 11.2 Duyệt đơn nghỉ

1. User phải có `LEAVE.REQUEST.APPROVE`.
2. Đơn phải thuộc company hiện tại.
3. Đơn phải nằm trong data scope của user.
4. Đơn phải đang ở trạng thái `Pending`.
5. Người duyệt phải hợp lệ theo approval policy.
6. Nếu leave type cần trừ số dư, phải kiểm tra lại balance tại thời điểm duyệt.
7. Nếu số dư đã thay đổi và không đủ phép, trả lỗi business rule hoặc yêu cầu HR override tùy policy.
8. Duyệt đơn phải chạy trong transaction:
   - cập nhật trạng thái đơn;
   - tạo approval log;
   - cập nhật balance;
   - tạo balance transaction;
   - cố định leave request days;
   - phát event đồng bộ ATT;
   - phát notification event;
   - invalidate dashboard cache nếu cần.
9. API duyệt bắt buộc có `Idempotency-Key`.

---

### 11.3 Từ chối đơn nghỉ

1. User phải có `LEAVE.REQUEST.REJECT`.
2. Đơn phải thuộc company hiện tại.
3. Đơn phải nằm trong data scope của user.
4. Đơn phải đang ở trạng thái `Pending`.
5. `reject_reason` bắt buộc.
6. Nếu trước đó đã reserve balance, phải release reservation.
7. Ghi approval log, audit log và phát notification event.

---

### 11.4 Hủy/thu hồi đơn nghỉ

1. Employee chỉ được hủy đơn của chính mình nếu trạng thái và policy cho phép.
2. HR/Admin có thể hủy hoặc thu hồi theo permission và scope.
3. Nếu đơn đã Approved, hủy/thu hồi phải:
   - hoàn phép nếu đã trừ;
   - tạo transaction `REFUND`;
   - cập nhật `leave_request_days.sync_status`;
   - phát event cho ATT tính lại bảng công;
   - phát notification event;
   - ghi audit log.
4. Nếu ngày nghỉ đã qua hoặc kỳ công đã khóa, có thể chặn hoặc yêu cầu quyền đặc biệt.

---

### 11.5 Đồng bộ với ATT

Khi đơn chuyển sang `Approved`, LEAVE phải phát event nội bộ để ATT cập nhật bảng công:

```text
LEAVE_REQUEST_APPROVED
```

Khi đơn `Cancelled` hoặc `Revoked` sau khi Approved, LEAVE phải phát event:

```text
LEAVE_REQUEST_CANCELLED
LEAVE_REQUEST_REVOKED
```

ATT sử dụng `leave_request_days` để:

1. Chặn check-in/check-out nếu nghỉ full day approved.
2. Giảm required working minutes nếu nghỉ half day/hourly.
3. Cập nhật attendance status là `Leave` nếu nghỉ full day.
4. Tính lại bảng công nếu đã có check-in/check-out.

---

## 12. Danh sách endpoint tổng quan

### 12.1 My Leave Balance API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-001 | GET | `/api/v1/leave/me/balances` | Xem số dư phép của tôi | `LEAVE.BALANCE.VIEW_OWN` |
| LEAVE-API-002 | GET | `/api/v1/leave/me/balances/{leave_type_id}` | Chi tiết số dư một loại phép của tôi | `LEAVE.BALANCE.VIEW_OWN` |
| LEAVE-API-003 | GET | `/api/v1/leave/me/balance-transactions` | Lịch sử giao dịch số dư phép của tôi | `LEAVE.BALANCE.VIEW_OWN` |

---

### 12.2 My Leave Request API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-101 | GET | `/api/v1/leave/me/requests` | Danh sách đơn nghỉ của tôi | `LEAVE.REQUEST.VIEW_OWN` |
| LEAVE-API-102 | GET | `/api/v1/leave/me/requests/{request_id}` | Chi tiết đơn nghỉ của tôi | `LEAVE.REQUEST.VIEW_OWN` |
| LEAVE-API-103 | POST | `/api/v1/leave/requests` | Tạo/lưu nháp đơn nghỉ | `LEAVE.REQUEST.CREATE` |
| LEAVE-API-104 | PATCH | `/api/v1/leave/requests/{request_id}` | Cập nhật đơn nháp | `LEAVE.REQUEST.UPDATE_DRAFT` |
| LEAVE-API-105 | POST | `/api/v1/leave/requests/{request_id}/submit` | Gửi đơn nghỉ | `LEAVE.REQUEST.SUBMIT` |
| LEAVE-API-106 | POST | `/api/v1/leave/requests/{request_id}/cancel` | Hủy đơn nghỉ của tôi | `LEAVE.REQUEST.CANCEL_OWN` |
| LEAVE-API-107 | DELETE | `/api/v1/leave/requests/{request_id}` | Xóa/hủy nháp | `LEAVE.REQUEST.UPDATE_DRAFT` hoặc `LEAVE.REQUEST.CANCEL_OWN` |

---

### 12.3 Leave Request Admin API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-201 | GET | `/api/v1/leave/requests` | Danh sách đơn nghỉ theo quyền | `LEAVE.REQUEST.VIEW` |
| LEAVE-API-202 | GET | `/api/v1/leave/requests/{request_id}` | Chi tiết đơn nghỉ theo quyền | `LEAVE.REQUEST.VIEW` |
| LEAVE-API-203 | GET | `/api/v1/leave/requests/pending-approvals` | Danh sách đơn chờ tôi duyệt | `LEAVE.REQUEST.APPROVE` hoặc `LEAVE.REQUEST.REJECT` |
| LEAVE-API-204 | POST | `/api/v1/leave/requests/{request_id}/approve` | Duyệt đơn nghỉ | `LEAVE.REQUEST.APPROVE` |
| LEAVE-API-205 | POST | `/api/v1/leave/requests/{request_id}/reject` | Từ chối đơn nghỉ | `LEAVE.REQUEST.REJECT` |
| LEAVE-API-206 | POST | `/api/v1/leave/requests/{request_id}/cancel-by-admin` | HR/Admin hủy đơn nghỉ | `LEAVE.REQUEST.CANCEL_ANY` |
| LEAVE-API-207 | POST | `/api/v1/leave/requests/{request_id}/revoke` | Thu hồi đơn đã duyệt | `LEAVE.REQUEST.REVOKE` |
| LEAVE-API-208 | GET | `/api/v1/leave/requests/{request_id}/approvals` | Lịch sử xử lý đơn | `LEAVE.AUDIT_LOG.VIEW` hoặc `LEAVE.REQUEST.VIEW` |

---

### 12.4 Leave Calculation API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-301 | POST | `/api/v1/leave/requests/calculate` | Preview số ngày/giờ nghỉ và balance | `LEAVE.REQUEST.CREATE` hoặc `LEAVE.REQUEST.VIEW` |
| LEAVE-API-302 | POST | `/api/v1/leave/requests/validate` | Validate rule trước khi submit | `LEAVE.REQUEST.CREATE` hoặc `LEAVE.REQUEST.SUBMIT` |

---

### 12.5 Leave Calendar API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-401 | GET | `/api/v1/leave/calendar?scope=` | Lịch nghỉ theo `scope` (Own/Team/Department/Company) | Theo `scope`: `LEAVE.CALENDAR.VIEW_OWN` / `VIEW_TEAM` / `VIEW_COMPANY` |

> Calendar gộp về **một endpoint** `GET /api/v1/leave/calendar` với query param `scope` (mặc định `Own`). Bỏ các biến thể `/calendar/me`, `/calendar/team`. Backend chọn permission cần kiểm tra theo `scope`.

---

### 12.6 Leave Type API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-501 | GET | `/api/v1/leave/types` | Lấy danh sách loại nghỉ | `LEAVE.TYPE.VIEW` hoặc permission tạo đơn |
| LEAVE-API-502 | GET | `/api/v1/leave/types/{leave_type_id}` | Chi tiết loại nghỉ | `LEAVE.TYPE.VIEW` |
| LEAVE-API-503 | POST | `/api/v1/leave/types` | Tạo loại nghỉ | `LEAVE.TYPE.CREATE` |
| LEAVE-API-504 | PATCH | `/api/v1/leave/types/{leave_type_id}` | Cập nhật loại nghỉ | `LEAVE.TYPE.UPDATE` |
| LEAVE-API-505 | DELETE | `/api/v1/leave/types/{leave_type_id}` | Xóa mềm loại nghỉ | `LEAVE.TYPE.DELETE` |

---

### 12.7 Leave Policy API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-601 | GET | `/api/v1/leave/policies` | Danh sách chính sách nghỉ | `LEAVE.POLICY.VIEW` |
| LEAVE-API-602 | GET | `/api/v1/leave/policies/{policy_id}` | Chi tiết chính sách nghỉ | `LEAVE.POLICY.VIEW` |
| LEAVE-API-603 | POST | `/api/v1/leave/policies` | Tạo chính sách nghỉ | `LEAVE.POLICY.CREATE` |
| LEAVE-API-604 | PATCH | `/api/v1/leave/policies/{policy_id}` | Cập nhật chính sách nghỉ | `LEAVE.POLICY.UPDATE` |
| LEAVE-API-605 | DELETE | `/api/v1/leave/policies/{policy_id}` | Xóa mềm chính sách nghỉ | `LEAVE.POLICY.DELETE` |
| LEAVE-API-606 | POST | `/api/v1/leave/policies/resolve` | Preview policy áp dụng cho employee | `LEAVE.POLICY.VIEW` hoặc `LEAVE.REQUEST.CREATE` |

---

### 12.8 Leave Balance Admin API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-701 | GET | `/api/v1/leave/balances` | Danh sách số dư phép nhân viên | `LEAVE.BALANCE.VIEW` |
| LEAVE-API-702 | GET | `/api/v1/leave/balances/{balance_id}` | Chi tiết số dư phép | `LEAVE.BALANCE.VIEW` |
| LEAVE-API-703 | GET | `/api/v1/leave/balances/{balance_id}/transactions` | Lịch sử giao dịch số dư | `LEAVE.BALANCE.TRANSACTION_VIEW` |
| LEAVE-API-704 | POST | `/api/v1/leave/balances/{balance_id}/adjust` | Điều chỉnh số dư phép | `LEAVE.BALANCE.ADJUST` |
| LEAVE-API-705 | POST | `/api/v1/leave/balances/initialize` | Khởi tạo số dư phép cho employee/năm | `LEAVE.BALANCE.ADJUST` |

---

### 12.9 Leave File API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-801 | GET | `/api/v1/leave/requests/{request_id}/files` | Danh sách file đơn nghỉ | `LEAVE.FILE.VIEW` hoặc owner request |
| LEAVE-API-802 | POST | `/api/v1/leave/requests/{request_id}/files` | Link file vào đơn nghỉ | `LEAVE.FILE.UPLOAD` hoặc owner request draft |
| LEAVE-API-803 | GET | `/api/v1/leave/requests/{request_id}/files/{file_id}/download-url` | Lấy signed URL file | `LEAVE.FILE.VIEW` hoặc owner request |
| LEAVE-API-804 | DELETE | `/api/v1/leave/requests/{request_id}/files/{file_id}` | Unlink file khỏi đơn nghỉ | `LEAVE.FILE.DELETE` hoặc owner request draft |

---

### 12.10 Export API

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| LEAVE-API-901 | GET | `/api/v1/leave/requests/export` | Xuất danh sách đơn nghỉ | `LEAVE.REQUEST.EXPORT` |
| LEAVE-API-902 | GET | `/api/v1/leave/calendar/export` | Xuất lịch nghỉ | `LEAVE.REQUEST.EXPORT` hoặc `LEAVE.CALENDAR.VIEW_COMPANY` |
| LEAVE-API-903 | GET | `/api/v1/leave/balances/export` | Xuất số dư phép | `LEAVE.REQUEST.EXPORT` hoặc `LEAVE.BALANCE.VIEW` |

---

## 13. Chi tiết API My Leave Balance

### 13.1 LEAVE-API-001: Xem số dư phép của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/me/balances` |
| Required permission | `LEAVE.BALANCE.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period_year` | Number | Không | Năm phép, mặc định năm hiện tại |
| `leave_type_id` | UUID | Không | Lọc theo loại nghỉ |
| `include_zero_balance` | Boolean | Không | Có hiển thị loại nghỉ chưa có số dư không |

#### Business validation

1. User phải đăng nhập và liên kết với employee.
2. Employee phải thuộc company hiện tại.
3. Backend tự resolve `employee_id` từ auth context.
4. Không cho frontend truyền `employee_id` vào API này.
5. Chỉ trả số dư của chính employee hiện tại.
6. Leave type inactive có thể ẩn hoặc hiển thị nếu đang có giao dịch lịch sử tùy cấu hình.

#### Response mẫu

```json
{
  "success": true,
  "message": "Lấy số dư phép thành công",
  "data": [
    {
      "id": "balance-uuid",
      "leave_type": {
        "id": "leave-type-uuid",
        "leave_type_code": "ANNUAL",
        "name": "Nghỉ phép năm"
      },
      "period_year": 2026,
      "opening_balance": 12.0,
      "used_days": 2.0,
      "reserved_days": 1.0,
      "adjusted_days": 0.0,
      "remaining_days": 9.0,
      "unit": "Day"
    }
  ],
  "meta": {
    "request_id": "req_20260620_050001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 13.2 LEAVE-API-003: Lịch sử giao dịch số dư phép của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/me/balance-transactions` |
| Required permission | `LEAVE.BALANCE.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `period_year` | Number | Năm phép |
| `leave_type_id` | UUID | Loại nghỉ |
| `transaction_type` | String | ACCRUAL/USE/RESERVE/RELEASE/REFUND/ADJUSTMENT |
| `page`, `per_page` | Number | Phân trang |

#### Business validation

1. Backend resolve employee từ user hiện tại.
2. Chỉ trả transaction của chính employee.
3. Nếu transaction liên quan đơn nghỉ nhạy cảm, response summary không lộ reason chi tiết.

---

## 14. Chi tiết API My Leave Request

### 14.1 LEAVE-API-101: Danh sách đơn nghỉ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/me/requests` |
| Required permission | `LEAVE.REQUEST.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR |
| Data scope | Own |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `search` | String | Tìm theo mã đơn/lý do |
| `status` | String | Draft/Pending/Approved/Rejected/Cancelled/Revoked |
| `leave_type_id` | UUID | Loại nghỉ |
| `from_date`, `to_date` | Date | Khoảng ngày nghỉ |
| `sort` | String | Ví dụ `created_at:desc` |

#### Business validation

1. Backend resolve employee từ auth context.
2. Chỉ trả đơn của chính employee hiện tại.
3. Không cần permission company/team.
4. Query luôn filter `company_id`.

---

### 14.2 LEAVE-API-102: Chi tiết đơn nghỉ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/me/requests/{request_id}` |
| Required permission | `LEAVE.REQUEST.VIEW_OWN` |
| Allowed roles | Employee, Manager, HR |
| Data scope | Own |
| Audit log | Có nếu xem file hoặc dữ liệu nhạy cảm theo cấu hình |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Request phải thuộc company hiện tại.
2. Request phải thuộc employee hiện tại.
3. Nếu include file hoặc download URL, kiểm tra thêm quyền file.
4. Nếu request không thuộc user hiện tại, trả 404 hoặc 403 theo policy bảo mật.

---

### 14.3 LEAVE-API-103: Tạo/lưu nháp đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests` |
| Required permission | `LEAVE.REQUEST.CREATE` |
| Allowed roles | Employee, Manager, HR |
| Data scope | Own |
| Audit log | Có |
| Notification event | Không nếu chỉ lưu Draft; nếu `submit_now=true` thì `LEAVE_REQUEST_SUBMITTED` |
| Idempotency | Khuyến nghị bắt buộc |

#### Header

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: 4fbb1c24-0a2f-4d6c-9de2-8f9944000001
```

#### Request body

```json
{
  "leave_type_id": "leave-type-uuid",
  "start_date": "2026-06-25",
  "end_date": "2026-06-26",
  "duration_type": "FullDay",
  "half_day_session": null,
  "start_time": null,
  "end_time": null,
  "reason": "Việc gia đình",
  "handover_note": "Đã bàn giao công việc cho bạn C",
  "file_ids": ["file-uuid-1"],
  "submit_now": false
}
```

#### Business validation

1. User phải liên kết với employee active/probation/official theo cấu hình.
2. Leave type phải active và thuộc company hiện tại.
3. `start_date`, `end_date`, `duration_type` bắt buộc.
4. `end_date` không được nhỏ hơn `start_date`.
5. `duration_type` phải thuộc whitelist: `FullDay`, `HalfDay`, `Hourly`, `MultipleDays`.
6. Nếu `HalfDay`, `half_day_session` bắt buộc.
7. Nếu `Hourly`, `start_time`, `end_time` bắt buộc và `end_time > start_time`.
8. Nếu leave type không cho half day/hourly thì trả lỗi business rule.
9. Nếu leave type yêu cầu lý do/file, phải validate đủ.
10. File ID nếu có phải thuộc company, private file hợp lệ, upload bởi user hiện tại hoặc user có quyền link.
11. Backend tự tính `calculated_days`, `calculated_hours`.
12. Kiểm tra trùng thời gian với đơn Pending/Approved khác.
13. Nếu `submit_now=false`, tạo status `Draft`.
14. Nếu `submit_now=true`, chạy validation submit và tạo status `Pending`.
15. Không tin `employee_id`, `company_id`, `approver_id` từ body.
16. Ghi audit log `LEAVE_REQUEST_CREATED`.
17. Nếu submit ngay, tạo approval log `Submitted`, reserve balance nếu policy yêu cầu, phát notification event.

#### Response 201

```json
{
  "success": true,
  "message": "Tạo đơn nghỉ thành công",
  "data": {
    "id": "leave-request-uuid",
    "request_code": "LR-2026-0001",
    "status": "Draft",
    "start_date": "2026-06-25",
    "end_date": "2026-06-26",
    "calculated_days": 2.0,
    "calculated_hours": 16.0
  },
  "meta": {
    "request_id": "req_20260620_050103",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Lỗi có thể xảy ra

| HTTP | Error code | Trường hợp |
| ---: | --- | --- |
| 400 | `VALIDATION-ERR-001` | Thiếu field hoặc sai format |
| 401 | `AUTH-ERR-UNAUTHENTICATED` | Chưa đăng nhập |
| 403 | `AUTH-ERR-FORBIDDEN` | Không có quyền tạo đơn |
| 409 | `LEAVE-ERR-REQUEST-OVERLAP` | Trùng với đơn nghỉ khác |
| 422 | `LEAVE-ERR-LEAVE-TYPE-INACTIVE` | Loại nghỉ không hợp lệ |
| 422 | `LEAVE-ERR-BALANCE-NOT-ENOUGH` | Không đủ số dư phép |
| 422 | `LEAVE-ERR-DURATION-NOT-ALLOWED` | Loại nghỉ không cho duration type này |
| 422 | `LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE` | Employee không đủ điều kiện tạo đơn |

---

### 14.4 LEAVE-API-104: Cập nhật đơn nháp

| Trường | Nội dung |
| --- | --- |
| Method | `PATCH` |
| Endpoint | `/api/v1/leave/requests/{request_id}` |
| Required permission | `LEAVE.REQUEST.UPDATE_DRAFT` |
| Allowed roles | Employee |
| Data scope | Own |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Không bắt buộc |

#### Request body

```json
{
  "leave_type_id": "leave-type-uuid",
  "start_date": "2026-06-26",
  "end_date": "2026-06-26",
  "duration_type": "HalfDay",
  "half_day_session": "Morning",
  "reason": "Việc gia đình",
  "handover_note": "Đã bàn giao",
  "file_ids": ["file-uuid-1", "file-uuid-2"]
}
```

#### Business validation

1. Request phải thuộc employee hiện tại.
2. Request phải ở trạng thái `Draft`.
3. Không cho sửa đơn `Pending`, `Approved`, `Rejected`, `Cancelled`, `Revoked` bằng API này.
4. Validate lại toàn bộ rule ngày nghỉ, duration, leave type, file.
5. Recalculate day detail preview.
6. Ghi audit log `LEAVE_REQUEST_DRAFT_UPDATED`.

---

### 14.5 LEAVE-API-105: Gửi đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/submit` |
| Required permission | `LEAVE.REQUEST.SUBMIT` |
| Allowed roles | Employee |
| Data scope | Own |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_SUBMITTED` |
| Idempotency | Bắt buộc |

#### Header

```http
Authorization: Bearer <access_token>
Idempotency-Key: 0c967611-f2e1-4da6-9d44-53d5a1000001
```

#### Request body

```json
{
  "note": "Nhờ anh/chị duyệt giúp em"
}
```

#### Business validation

1. Request phải thuộc employee hiện tại.
2. Request phải đang ở trạng thái `Draft`.
3. Validate lại dữ liệu request tại thời điểm submit.
4. Leave type vẫn phải active.
5. Employee vẫn phải hợp lệ.
6. Không trùng với đơn Pending/Approved khác.
7. Nếu leave type cần balance, kiểm tra và reserve balance nếu policy bật.
8. Xác định approver theo direct manager hoặc policy.
9. Nếu không tìm được approver, trả `LEAVE-ERR-APPROVER-NOT-FOUND` hoặc route đến HR theo cấu hình.
10. Cập nhật trạng thái `Pending`, set `submitted_at`, tạo approval log `Submitted`.
11. Ghi audit log.
12. Phát notification cho approver/HR.
13. Invalidate dashboard cache cho approver nếu có.

#### Response mẫu

```json
{
  "success": true,
  "message": "Gửi đơn nghỉ thành công",
  "data": {
    "id": "leave-request-uuid",
    "request_code": "LR-2026-0001",
    "status": "Pending",
    "submitted_at": "2026-06-20T10:00:00+07:00",
    "approver": {
      "id": "approver-employee-uuid",
      "full_name": "Trần Thị B"
    }
  },
  "meta": {
    "request_id": "req_20260620_050105",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 14.6 LEAVE-API-106: Hủy đơn nghỉ của tôi

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/cancel` |
| Required permission | `LEAVE.REQUEST.CANCEL_OWN` |
| Allowed roles | Employee |
| Data scope | Own |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_CANCELLED` |
| Idempotency | Bắt buộc |

#### Request body

```json
{
  "cancel_reason": "Không còn nhu cầu nghỉ"
}
```

#### Business validation

1. Request phải thuộc employee hiện tại.
2. Trạng thái được hủy: `Draft`, `Pending`, hoặc `Approved` nếu policy cho phép.
3. Nếu request `Approved`, kiểm tra ngày nghỉ đã qua hay chưa.
4. Nếu kỳ công đã khóa, có thể chặn hủy hoặc yêu cầu HR xử lý.
5. Nếu đã reserve balance, tạo transaction `RELEASE`.
6. Nếu đã use balance, tạo transaction `REFUND` nếu policy cho phép.
7. Nếu request đã Approved, phát event cho ATT tính lại attendance.
8. Ghi approval log `Cancelled` và audit log.
9. Gửi notification cho approver/HR nếu cần.

---

## 15. Chi tiết API Leave Request Admin

### 15.1 LEAVE-API-201: Danh sách đơn nghỉ theo quyền

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/requests` |
| Required permission | `LEAVE.REQUEST.VIEW` |
| Allowed roles | Super Admin, Admin công ty, HR, Manager, Payroll Officer |
| Data scope | Team, Department, Company, System |
| Audit log | Không bắt buộc với list thông thường; có thể log nếu xem/export dữ liệu nhạy cảm |
| Notification event | Không |
| Idempotency | Không |

#### Query params

Sử dụng filter chuẩn ở mục 9.4.

#### Business validation

1. User phải có `LEAVE.REQUEST.VIEW`.
2. Backend áp dụng data scope để giới hạn kết quả.
3. Manager scope Team chỉ thấy đơn của nhân viên thuộc team.
4. HR scope Company thấy toàn bộ đơn trong công ty.
5. Payroll Officer chỉ nên thấy dữ liệu cần cho tính lương, hạn chế reason/file nhạy cảm.
6. Không trả đơn `deleted_at IS NOT NULL`.
7. Nếu `include_sensitive=true`, kiểm tra permission nhạy cảm hoặc policy riêng.

---

### 15.2 LEAVE-API-203: Danh sách đơn chờ tôi duyệt

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/requests/pending-approvals` |
| Required permission | `LEAVE.REQUEST.APPROVE` hoặc `LEAVE.REQUEST.REJECT` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `search` | String | Tìm theo mã đơn, nhân viên |
| `department_id` | UUID | Lọc theo phòng ban |
| `leave_type_id` | UUID | Lọc theo loại nghỉ |
| `from_date`, `to_date` | Date | Khoảng ngày nghỉ |
| `sort` | String | Mặc định `submitted_at:asc` |

#### Business validation

1. Chỉ trả đơn trạng thái `Pending`.
2. Nếu user là manager, đơn phải thuộc team hoặc user phải là approver theo policy.
3. Nếu user là HR/Admin, áp dụng scope Department/Company/System.
4. Không trả reason nhạy cảm đầy đủ ở list nếu policy ẩn.

---

### 15.3 LEAVE-API-204: Duyệt đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/approve` |
| Required permission | `LEAVE.REQUEST.APPROVE` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_APPROVED` |
| Idempotency | Bắt buộc |

#### Header

```http
Authorization: Bearer <access_token>
Idempotency-Key: a7a1fb7d-bb8d-4ae7-a7be-75a0e1000001
```

#### Request body

```json
{
  "approval_note": "Đã duyệt",
  "override_balance_check": false
}
```

#### Business validation

1. Request phải tồn tại, chưa deleted, cùng company.
2. User phải có `LEAVE.REQUEST.APPROVE`.
3. Request phải nằm trong data scope của user.
4. Request phải ở trạng thái `Pending`.
5. User phải là approver hợp lệ theo policy, hoặc có quyền HR/Admin override.
6. Không cho employee tự duyệt đơn của chính mình, trừ cấu hình đặc biệt và có quyền cao hơn.
7. Leave type phải còn hợp lệ hoặc policy xử lý legacy type phải được định nghĩa.
8. Kiểm tra lại xung đột đơn nghỉ.
9. Kiểm tra balance nếu loại nghỉ cần trừ phép.
10. Nếu balance không đủ và `override_balance_check=false`, trả lỗi.
11. Nếu `override_balance_check=true`, user phải có quyền override riêng hoặc HR/Admin policy.
12. Transaction phải cập nhật request, approval log, balance, balance transaction, request days, sync status và audit log.
13. Phát internal event cho ATT.
14. Phát notification cho employee.
15. Invalidate DASH cache pending approvals/leave balance/calendar.

#### Response mẫu

```json
{
  "success": true,
  "message": "Duyệt đơn nghỉ thành công",
  "data": {
    "id": "leave-request-uuid",
    "request_code": "LR-2026-0001",
    "status": "Approved",
    "approved_at": "2026-06-20T10:00:00+07:00",
    "approved_by": {
      "id": "user-uuid",
      "full_name": "Trần Thị B"
    },
    "att_sync_status": "Pending"
  },
  "meta": {
    "request_id": "req_20260620_050204",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

#### Lỗi có thể xảy ra

| HTTP | Error code | Trường hợp |
| ---: | --- | --- |
| 403 | `AUTH-ERR-FORBIDDEN` | Không có quyền duyệt |
| 403 | `AUTH-ERR-SCOPE-DENIED` | Đơn không thuộc scope |
| 404 | `RESOURCE-ERR-NOT-FOUND` | Không tìm thấy đơn hoặc không được xem |
| 409 | `LEAVE-ERR-INVALID-STATE` | Đơn không ở trạng thái Pending |
| 409 | `LEAVE-ERR-REQUEST-OVERLAP` | Xung đột với đơn khác |
| 422 | `LEAVE-ERR-BALANCE-NOT-ENOUGH` | Không đủ phép |
| 422 | `LEAVE-ERR-APPROVER-INVALID` | Người duyệt không hợp lệ |
| 422 | `ATT-ERR-PERIOD-LOCKED` | Kỳ công đã khóa, không thể đồng bộ |

---

### 15.4 LEAVE-API-205: Từ chối đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/reject` |
| Required permission | `LEAVE.REQUEST.REJECT` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_REJECTED` |
| Idempotency | Bắt buộc |

#### Request body

```json
{
  "reject_reason": "Thời điểm này team thiếu nhân sự"
}
```

#### Business validation

1. Request phải ở trạng thái `Pending`.
2. User phải có permission reject và request nằm trong scope.
3. `reject_reason` bắt buộc.
4. Nếu request có reserved balance, tạo transaction `RELEASE`.
5. Cập nhật status `Rejected`, set `rejected_at`, `rejected_by`.
6. Tạo approval log `Rejected`.
7. Ghi audit log.
8. Gửi notification cho employee.
9. Invalidate dashboard cache pending approvals.

---

### 15.5 LEAVE-API-206: HR/Admin hủy đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/cancel-by-admin` |
| Required permission | `LEAVE.REQUEST.CANCEL_ANY` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_CANCELLED` |
| Idempotency | Bắt buộc |

#### Request body

```json
{
  "cancel_reason": "Hủy theo yêu cầu của nhân viên",
  "notify_employee": true
}
```

#### Business validation

1. Request phải thuộc scope của user.
2. Trạng thái được hủy: `Draft`, `Pending`, `Approved` nếu policy cho phép.
3. Nếu Approved, phải refund balance và sync ATT.
4. Nếu kỳ công đã khóa, cần policy xử lý hoặc quyền override.
5. Ghi approval log `CancelledByAdmin`.
6. Ghi audit log đầy đủ old/new status.

---

### 15.6 LEAVE-API-207: Thu hồi đơn đã duyệt

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/revoke` |
| Required permission | `LEAVE.REQUEST.REVOKE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Audit log | Có |
| Notification event | `LEAVE_REQUEST_REVOKED` |
| Idempotency | Bắt buộc |

#### Request body

```json
{
  "revoke_reason": "Thu hồi do nhập sai dữ liệu",
  "refund_balance": true,
  "recalculate_attendance": true,
  "notify_employee": true
}
```

#### Business validation

1. Request phải ở trạng thái `Approved`.
2. Chỉ user có permission revoke mới được thực hiện.
3. Nếu `refund_balance=true`, tạo transaction `REFUND`.
4. Nếu `recalculate_attendance=true`, phát internal event sang ATT.
5. Nếu kỳ công/payroll đã khóa, chặn hoặc yêu cầu quyền override.
6. Cập nhật trạng thái `Revoked`.
7. Ghi approval log, audit log, notification event.

---

## 16. Chi tiết API Leave Calculation

### 16.1 LEAVE-API-301: Preview số ngày/giờ nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/calculate` |
| Required permission | `LEAVE.REQUEST.CREATE` hoặc `LEAVE.REQUEST.VIEW` |
| Allowed roles | Employee, Manager, HR, Admin công ty |
| Data scope | Own, Team, Department, Company |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Request body

```json
{
  "employee_id": null,
  "leave_type_id": "leave-type-uuid",
  "start_date": "2026-06-25",
  "end_date": "2026-06-26",
  "duration_type": "FullDay",
  "half_day_session": null,
  "start_time": null,
  "end_time": null
}
```

#### Business validation

1. Nếu user là Employee dùng Own scope, backend bỏ qua `employee_id` và resolve employee hiện tại.
2. Nếu HR/Manager truyền `employee_id`, target employee phải nằm trong scope.
3. Leave type phải active.
4. Tính dựa trên shift, attendance rule, public holiday, weekend và policy.
5. Trả cả warning thay vì chỉ lỗi khi có thể tạo nhưng cần lưu ý.
6. Không tạo dữ liệu trong database, trừ log debug nếu cấu hình.

#### Response mẫu

```json
{
  "success": true,
  "message": "Tính ngày nghỉ thành công",
  "data": {
    "calculated_days": 2.0,
    "calculated_hours": 16.0,
    "is_balance_required": true,
    "balance": {
      "remaining_days": 11.0,
      "requested_days": 2.0,
      "after_remaining_days": 9.0,
      "is_enough": true
    },
    "days": [
      {
        "date": "2026-06-25",
        "is_working_day": true,
        "is_public_holiday": false,
        "leave_days": 1.0,
        "leave_hours": 8.0
      },
      {
        "date": "2026-06-26",
        "is_working_day": true,
        "is_public_holiday": false,
        "leave_days": 1.0,
        "leave_hours": 8.0
      }
    ],
    "warnings": []
  },
  "meta": {
    "request_id": "req_20260620_050301",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 17. Chi tiết API Leave Calendar

### 17.1 LEAVE-API-401: Lịch nghỉ theo scope

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/calendar?scope=` |
| Required permission | Theo `scope`: `LEAVE.CALENDAR.VIEW_OWN` (Own) / `VIEW_TEAM` (Team/Department) / `VIEW_COMPANY` (Company) |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own/Team/Department/Company/System theo `scope` |
| Audit log | Không bắt buộc; có thể log nếu xem lý do nhạy cảm |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `from_date` | Date | Có | Ngày bắt đầu |
| `to_date` | Date | Có | Ngày kết thúc |
| `scope` | String | Không | Own/Team/Department/Company, mặc định Own |
| `view_mode` | String | Không | Month/Week/Day/List |
| `department_id` | UUID | Không | Lọc theo phòng ban nếu có quyền |
| `employee_id` | UUID | Không | Lọc theo nhân viên nếu có quyền |
| `leave_type_id` | UUID | Không | Lọc theo loại nghỉ |
| `status` | String | Không | Approved/Pending/All, mặc định Approved |

#### Business validation

1. Backend chọn permission cần kiểm tra theo `scope` và áp dụng data scope tương ứng.
2. `scope=Own` chỉ trả dữ liệu của employee hiện tại; có thể trả Pending của chính mình.
3. Employee không được xem lịch nghỉ toàn công ty nếu không có quyền.
4. Mặc định chỉ hiển thị Approved.
5. Pending chỉ hiển thị với user có quyền duyệt/xem đơn.
6. Có thể ẩn reason và loại nghỉ nhạy cảm theo policy.
7. Range ngày phải được giới hạn để tránh query nặng; MVP khuyến nghị tối đa 366 ngày.

---

## 18. Chi tiết API Leave Type

### 18.1 LEAVE-API-501: Lấy danh sách loại nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/types` |
| Required permission | `LEAVE.TYPE.VIEW` hoặc permission tạo đơn |
| Allowed roles | Employee, Manager, HR, Admin công ty |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `status` | String | Active/Inactive/All |
| `is_paid` | Boolean | Lọc nghỉ có lương/không lương |
| `is_balance_required` | Boolean | Có trừ balance hay không |
| `search` | String | Tìm theo mã/tên loại nghỉ |
| `page`, `per_page` | Number | Phân trang nếu danh mục lớn |

#### Business validation

1. Employee khi tạo đơn chỉ thấy leave type active và được policy cho phép.
2. HR/Admin có thể thấy cả inactive nếu có permission quản lý.
3. Sensitive leave type có thể ẩn metadata nhạy cảm theo policy.

---

### 18.2 LEAVE-API-503: Tạo loại nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/types` |
| Required permission | `LEAVE.TYPE.CREATE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `LEAVE_TYPE_CREATED` nếu cấu hình bật |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "leave_type_code": "ANNUAL",
  "name": "Nghỉ phép năm",
  "description": "Nghỉ phép có hưởng lương",
  "unit": "Day",
  "is_paid": true,
  "is_balance_required": true,
  "is_attachment_required": false,
  "is_reason_required": true,
  "is_sensitive": false,
  "allow_half_day": true,
  "allow_hourly": false,
  "allow_negative_balance": false,
  "max_days_per_request": 5,
  "min_notice_days": 1,
  "color": "#4F46E5",
  "status": "Active",
  "sort_order": 1
}
```

#### Business validation

1. `leave_type_code` unique trong company.
2. `name` bắt buộc.
3. `unit` phải là `Day` hoặc `Hour`.
4. Nếu `allow_hourly=true`, cần rule tính giờ rõ ràng.
5. Nếu `is_balance_required=false`, không trừ balance khi approve.
6. Nếu đã có request dùng leave type, cập nhật sau này phải hạn chế thay đổi field ảnh hưởng lịch sử.
7. Ghi audit log.

---

### 18.3 LEAVE-API-504/505: Cập nhật hoặc xóa mềm loại nghỉ

```http
PATCH  /api/v1/leave/types/{leave_type_id}
DELETE /api/v1/leave/types/{leave_type_id}
```

| Thuộc tính | Giá trị |
| --- | --- |
| Required permission | `LEAVE.TYPE.UPDATE` hoặc `LEAVE.TYPE.DELETE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `LEAVE_TYPE_UPDATED`, `LEAVE_TYPE_DELETED` nếu cấu hình bật |

#### Business validation

1. Không xóa cứng.
2. Không cho xóa mềm nếu còn policy active hoặc request active cần loại nghỉ này, trừ khi chỉ set `status=Inactive`.
3. Không đổi `leave_type_code` nếu đã có dữ liệu lịch sử, trừ quyền đặc biệt.
4. Nếu chuyển inactive, employee không thể tạo đơn mới với loại này.

---

## 19. Chi tiết API Leave Policy

### 19.1 LEAVE-API-601: Danh sách chính sách nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/policies` |
| Required permission | `LEAVE.POLICY.VIEW` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `leave_type_id` | UUID | Loại nghỉ |
| `scope_type` | String | Company/Department/Employee/JobLevel/ContractType |
| `status` | String | Active/Inactive |
| `effective_date` | Date | Chính sách hiệu lực tại ngày |
| `page`, `per_page` | Number | Phân trang |

---

### 19.2 LEAVE-API-603: Tạo chính sách nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/policies` |
| Required permission | `LEAVE.POLICY.CREATE` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `LEAVE_POLICY_CREATED` nếu cấu hình bật |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "policy_code": "ANNUAL-COMPANY-2026",
  "name": "Chính sách nghỉ phép năm 2026",
  "leave_type_id": "leave-type-uuid",
  "scope_type": "Company",
  "scope_id": null,
  "period_year": 2026,
  "annual_entitlement_days": 12.0,
  "accrual_method": "Manual",
  "allow_negative_balance": false,
  "max_negative_days": 0,
  "min_notice_days": 1,
  "max_days_per_request": 5,
  "allow_half_day": true,
  "allow_hourly": false,
  "exclude_weekends": true,
  "exclude_public_holidays": true,
  "require_attachment_after_days": 3,
  "effective_from": "2026-01-01",
  "effective_to": "2026-12-31",
  "status": "Active"
}
```

#### Business validation

1. Leave type phải active.
2. `scope_type` phải hợp lệ.
3. Nếu `scope_type != Company`, `scope_id` bắt buộc và phải thuộc company.
4. Không cho policy active overlap cùng leave type + scope + period nếu policy không cho phép overlap.
5. `effective_to` không được nhỏ hơn `effective_from`.
6. Nếu policy đã áp dụng cho request/balance, cập nhật field quan trọng cần ghi audit rõ ràng.
7. Ghi audit log và có thể phát notification nếu công ty bật thông báo policy update.

---

### 19.3 LEAVE-API-606: Resolve policy áp dụng cho employee

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/policies/resolve` |
| Required permission | `LEAVE.POLICY.VIEW` hoặc `LEAVE.REQUEST.CREATE` |
| Allowed roles | Employee, Manager, HR, Admin công ty |
| Data scope | Own, Team, Department, Company |
| Audit log | Không |
| Notification event | Không |
| Idempotency | Không |

#### Request body

```json
{
  "employee_id": "employee-uuid",
  "leave_type_id": "leave-type-uuid",
  "target_date": "2026-06-25"
}
```

#### Business validation

1. Nếu user scope Own, backend resolve employee hiện tại và bỏ qua `employee_id` từ body.
2. Nếu Manager/HR truyền employee, target phải nằm trong scope.
3. Policy resolve theo thứ tự ưu tiên: Employee -> Department -> JobLevel -> ContractType -> Company -> Default.
4. Nếu không tìm thấy policy, trả warning hoặc lỗi tùy cấu hình.

---

## 20. Chi tiết API Leave Balance Admin

### 20.1 LEAVE-API-701: Danh sách số dư phép

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/balances` |
| Required permission | `LEAVE.BALANCE.VIEW` |
| Allowed roles | HR, Admin công ty, Super Admin, Manager nếu được cấp |
| Data scope | Team, Department, Company, System |
| Audit log | Không bắt buộc |
| Notification event | Không |
| Idempotency | Không |

#### Query params

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `page`, `per_page` | Number | Phân trang |
| `search` | String | Mã/tên nhân viên |
| `employee_id` | UUID | Lọc nhân viên |
| `department_id` | UUID | Lọc phòng ban |
| `leave_type_id` | UUID | Lọc loại nghỉ |
| `period_year` | Number | Năm phép |
| `low_balance` | Boolean | Lọc số dư thấp |
| `sort` | String | Ví dụ `remaining_days:asc` |

#### Business validation

1. Backend áp dụng data scope.
2. Manager scope Team chỉ xem balance nhân viên thuộc team nếu được cấp quyền.
3. HR scope Company xem balance toàn công ty.
4. Không trả dữ liệu employee ngoài scope.

---

### 20.2 LEAVE-API-704: Điều chỉnh số dư phép

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/balances/{balance_id}/adjust` |
| Required permission | `LEAVE.BALANCE.ADJUST` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System hoặc Department nếu được cấp |
| Audit log | Có |
| Notification event | `LEAVE_BALANCE_ADJUSTED` |
| Idempotency | Bắt buộc |

#### Header

```http
Authorization: Bearer <access_token>
Idempotency-Key: 9d4f4d6e-83fb-4b05-98ce-5139f8000001
```

#### Request body

```json
{
  "adjustment_type": "Increase",
  "amount_days": 1.0,
  "reason": "Điều chỉnh số dư đầu kỳ",
  "effective_date": "2026-06-20",
  "notify_employee": true
}
```

#### Business validation

1. Balance phải tồn tại, cùng company và nằm trong scope.
2. `amount_days` phải > 0.
3. `adjustment_type` là `Increase` hoặc `Decrease`.
4. Nếu decrease làm remaining âm, chỉ cho phép nếu policy allow negative hoặc user có quyền override.
5. Không update balance trực tiếp nếu không tạo transaction.
6. Transaction type là `ADJUSTMENT`.
7. Chạy trong transaction database.
8. Ghi audit log old/new balance.
9. Gửi notification cho employee nếu `notify_employee=true`.
10. Invalidate dashboard cache leave balance.

---

### 20.3 LEAVE-API-705: Khởi tạo số dư phép

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/balances/initialize` |
| Required permission | `LEAVE.BALANCE.ADJUST` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Company/System |
| Audit log | Có |
| Notification event | `LEAVE_BALANCE_INITIALIZED` nếu cấu hình bật |
| Idempotency | Bắt buộc |

#### Request body

```json
{
  "period_year": 2026,
  "leave_type_id": "leave-type-uuid",
  "employee_ids": ["employee-uuid-1", "employee-uuid-2"],
  "department_id": null,
  "opening_balance": 12.0,
  "skip_existing": true,
  "reason": "Khởi tạo số dư phép năm 2026"
}
```

#### Business validation

1. Không cho truyền cả `employee_ids` và `department_id` nếu policy không hỗ trợ.
2. Employee target phải active/probation/official tùy cấu hình.
3. Leave type phải active và is_balance_required.
4. Nếu balance đã tồn tại và `skip_existing=true`, bỏ qua employee đó.
5. Nếu balance đã tồn tại và `skip_existing=false`, trả conflict hoặc update theo policy.
6. Tạo transaction `OPENING` hoặc `ADJUSTMENT` cho từng balance.
7. Nên xử lý theo batch và trả summary.

---

## 21. Chi tiết API Leave File

### 21.1 LEAVE-API-802: Link file vào đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `POST` |
| Endpoint | `/api/v1/leave/requests/{request_id}/files` |
| Required permission | `LEAVE.FILE.UPLOAD` hoặc owner request draft |
| Allowed roles | Employee, HR, Admin công ty |
| Data scope | Own, Department, Company, System |
| Audit log | Có |
| Notification event | Không |
| Idempotency | Khuyến nghị |

#### Request body

```json
{
  "file_id": "file-uuid",
  "file_purpose": "LeaveEvidence",
  "note": "Giấy xác nhận khám bệnh"
}
```

#### Business validation

1. Request phải thuộc scope.
2. Employee owner chỉ được link file khi request còn `Draft`, hoặc `Pending` nếu policy cho phép bổ sung file.
3. File phải tồn tại trong file service, thuộc company hiện tại và chưa bị deleted.
4. File phải là private file.
5. MIME type và size phải phù hợp policy.
6. Không link trùng file vào cùng request.
7. Ghi audit log.

---

### 21.2 LEAVE-API-803: Lấy signed URL file đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/requests/{request_id}/files/{file_id}/download-url` |
| Required permission | `LEAVE.FILE.VIEW` hoặc owner request |
| Allowed roles | Employee owner, Manager approver, HR, Admin công ty, Super Admin |
| Data scope | Own, Team, Department, Company, System |
| Audit log | Có nếu file nhạy cảm hoặc cấu hình bật |
| Notification event | Không |
| Idempotency | Không |

#### Business validation

1. Request phải thuộc scope.
2. File phải gắn với request.
3. Nếu file nhạy cảm, cần permission phù hợp hoặc vai trò xử lý đơn.
4. Backend không trả storage path thật.
5. Trả signed URL có thời hạn ngắn.
6. Ghi file access log nếu cấu hình bật.

---

## 22. Export API

### 22.1 LEAVE-API-901: Xuất danh sách đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Method | `GET` |
| Endpoint | `/api/v1/leave/requests/export` |
| Required permission | `LEAVE.REQUEST.EXPORT` |
| Allowed roles | HR, Admin công ty, Super Admin, Payroll Officer nếu được cấp |
| Data scope | Department, Company, System |
| Audit log | Có |
| Notification event | Không hoặc `LEAVE_REQUEST_EXPORT_CREATED` nếu async |
| Idempotency | Khuyến nghị nếu tạo file export |

#### Query params

Sử dụng filter của danh sách đơn nghỉ:

```http
GET /api/v1/leave/requests/export?status=Approved&from_date=2026-06-01&to_date=2026-06-30&format=xlsx
```

| Param | Kiểu | Mô tả |
| --- | --- | --- |
| `format` | String | xlsx/csv, mặc định xlsx |
| `include_reason` | Boolean | Chỉ áp dụng nếu có quyền xem dữ liệu nhạy cảm |
| `include_files` | Boolean | MVP không khuyến nghị export file |

#### Business validation

1. User phải có export permission.
2. Backend áp dụng data scope.
3. Export dữ liệu lớn nên chạy async và trả job/file ID.
4. Không export reason/file nhạy cảm nếu không có quyền.
5. Ghi audit log với filter đã dùng.
6. Rate limit export theo user/module.

---

## 23. Internal API / Service Contract

### 23.1 LEAVE -> ATT sync event

Không khuyến nghị frontend gọi trực tiếp. Đây là contract nội bộ giữa LEAVE và ATT.

```http
POST /internal/v1/attendance/leave-sync
```

#### Payload event mẫu

Schema payload dùng chung khớp [BACKEND-07 §13.8](<../BACKEND/BACKEND-07_Leave_Backend.md>); cùng schema cho `LEAVE_REQUEST_APPROVED`, `LEAVE_REQUEST_CANCELLED`, `LEAVE_REQUEST_REVOKED`:

```json
{
  "event_name": "LEAVE_REQUEST_APPROVED",
  "company_id": "uuid",
  "leave_request_id": "uuid",
  "employee_id": "uuid",
  "days": [
    {
      "leave_request_day_id": "uuid",
      "attendance_date": "2026-06-25",
      "duration_type": "FullDay",
      "leave_minutes": 480,
      "half_day_session": null
    }
  ],
  "occurred_at": "ISO8601"
}
```

#### Nguyên tắc

1. Chỉ service nội bộ hoặc event bus được gọi.
2. Payload không chứa reason/file.
3. Khóa ngày = `attendance_date` (khớp cột ATT); ATT link record theo `leave_request_id` + `leave_request_day_id`.
4. `leave_minutes` (INT) thay cho `leave_hours`; `duration_type` dùng enum chuẩn (`FullDay/HalfDay/Hourly/MultipleDays`).
5. ATT phải idempotent theo `event_name + leave_request_id + leave_request_day_id`.
6. Nếu ATT sync lỗi, LEAVE lưu `attendance_sync_status=Failed` và có job retry.
7. Không rollback approve nếu ATT xử lý async, nhưng phải cảnh báo và retry.
8. Nếu muốn đồng bộ synchronous trong MVP, transaction biên phải được thiết kế rõ để tránh half-updated state.

---

### 23.2 LEAVE -> NOTI event

LEAVE phát các event sau cho NOTI:

| Event code | Khi nào phát | Người nhận gợi ý |
| --- | --- | --- |
| `LEAVE_REQUEST_SUBMITTED` | Employee gửi đơn | Direct Manager/Approver/HR fallback |
| `LEAVE_REQUEST_APPROVED` | Đơn được duyệt | Employee |
| `LEAVE_REQUEST_REJECTED` | Đơn bị từ chối | Employee |
| `LEAVE_REQUEST_CANCELLED` | Đơn bị hủy | Employee, Approver/HR tùy ngữ cảnh |
| `LEAVE_REQUEST_REVOKED` | Đơn đã duyệt bị thu hồi | Employee, HR/Manager liên quan |
| `LEAVE_BALANCE_ADJUSTED` | HR điều chỉnh số dư | Employee |
| `LEAVE_POLICY_UPDATED` | Chính sách được cập nhật | HR/Admin hoặc employee nếu bật thông báo rộng |

#### Payload an toàn

```json
{
  "event_code": "LEAVE_REQUEST_SUBMITTED",
  "recipient_user_ids": ["manager-user-uuid"],
  "source_module": "LEAVE",
  "source_entity_type": "LeaveRequest",
  "source_entity_id": "leave-request-uuid",
  "dedupe_key": "LEAVE_REQUEST_SUBMITTED:leave-request-uuid:manager-user-uuid",
  "payload": {
    "target_module": "LEAVE",
    "target_type": "LeaveRequest",
    "target_id": "leave-request-uuid",
    "display_code": "LR-2026-0001",
    "employee_name": "Nguyễn Văn A",
    "date_range": "2026-06-25 -> 2026-06-26"
  }
}
```

Không đưa lý do nghỉ đầy đủ, private file URL hoặc dữ liệu nhạy cảm vào notification payload.

---

## 24. Mã lỗi riêng của LEAVE

| Error code | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `LEAVE-ERR-REQUEST-NOT-FOUND` | 404 | Không tìm thấy đơn nghỉ hoặc không thuộc scope |
| `LEAVE-ERR-INVALID-STATE` | 409 | Trạng thái đơn không cho phép thao tác |
| `LEAVE-ERR-INVALID-TRANSITION` | 409 | Chuyển trạng thái không hợp lệ |
| `LEAVE-ERR-REQUEST-OVERLAP` | 409 | Trùng thời gian với đơn khác |
| `LEAVE-ERR-BALANCE-NOT-FOUND` | 422 | Không tìm thấy số dư phép |
| `LEAVE-ERR-BALANCE-NOT-ENOUGH` | 422 | Không đủ số dư phép |
| `LEAVE-ERR-NEGATIVE-BALANCE-NOT-ALLOWED` | 422 | Không cho phép âm phép |
| `LEAVE-ERR-LEAVE-TYPE-INACTIVE` | 422 | Loại nghỉ không active |
| `LEAVE-ERR-LEAVE-TYPE-NOT-ALLOWED` | 422 | Loại nghỉ không áp dụng cho employee |
| `LEAVE-ERR-DURATION-NOT-ALLOWED` | 422 | Duration type không được loại nghỉ/policy cho phép |
| `LEAVE-ERR-REASON-REQUIRED` | 400 | Thiếu lý do nghỉ |
| `LEAVE-ERR-ATTACHMENT-REQUIRED` | 400 | Thiếu file bắt buộc |
| `LEAVE-ERR-APPROVER-NOT-FOUND` | 422 | Không xác định được người duyệt |
| `LEAVE-ERR-APPROVER-INVALID` | 422 | Người duyệt không hợp lệ |
| `LEAVE-ERR-EMPLOYEE-NOT-ELIGIBLE` | 422 | Employee không đủ điều kiện xin nghỉ |
| `LEAVE-ERR-POLICY-NOT-FOUND` | 422 | Không tìm thấy chính sách áp dụng |
| `LEAVE-ERR-POLICY-CONFLICT` | 409 | Policy bị trùng/overlap |
| `LEAVE-ERR-PERIOD-LOCKED` | 422 | Kỳ công/kỳ phép đã khóa |
| `LEAVE-ERR-FILE-NOT-ALLOWED` | 422 | File không hợp lệ |
| `LEAVE-ERR-SYNC-ATT-FAILED` | 500/202 | Đồng bộ ATT lỗi, cần retry |

---

## 25. Audit log

### 25.1 Hành động bắt buộc ghi audit

| Action | Khi nào ghi |
| --- | --- |
| `LEAVE_REQUEST_CREATED` | Tạo đơn nghỉ |
| `LEAVE_REQUEST_DRAFT_UPDATED` | Cập nhật đơn nháp |
| `LEAVE_REQUEST_SUBMITTED` | Gửi đơn nghỉ |
| `LEAVE_REQUEST_APPROVED` | Duyệt đơn nghỉ |
| `LEAVE_REQUEST_REJECTED` | Từ chối đơn nghỉ |
| `LEAVE_REQUEST_CANCELLED` | Hủy đơn nghỉ |
| `LEAVE_REQUEST_REVOKED` | Thu hồi đơn nghỉ |
| `LEAVE_BALANCE_RESERVED` | Giữ chỗ số dư phép |
| `LEAVE_BALANCE_USED` | Trừ phép khi duyệt |
| `LEAVE_BALANCE_RELEASED` | Giải phóng phép đã reserve |
| `LEAVE_BALANCE_REFUNDED` | Hoàn phép khi hủy/thu hồi |
| `LEAVE_BALANCE_ADJUSTED` | HR/Admin điều chỉnh số dư |
| `LEAVE_TYPE_CREATED/UPDATED/DELETED` | Quản lý loại nghỉ |
| `LEAVE_POLICY_CREATED/UPDATED/DELETED` | Quản lý chính sách nghỉ |
| `LEAVE_FILE_LINKED/UNLINKED/DOWNLOADED` | Quản lý file đơn nghỉ |
| `LEAVE_REQUEST_EXPORTED` | Export dữ liệu nghỉ |

---

### 25.2 Nội dung audit tối thiểu

```json
{
  "module": "LEAVE",
  "action": "LEAVE_REQUEST_APPROVED",
  "target_type": "LeaveRequest",
  "target_id": "leave-request-uuid",
  "target_code": "LR-2026-0001",
  "actor_user_id": "user-uuid",
  "company_id": "company-uuid",
  "old_value": {
    "status": "Pending"
  },
  "new_value": {
    "status": "Approved"
  },
  "metadata": {
    "employee_id": "employee-uuid",
    "leave_type_id": "leave-type-uuid",
    "calculated_days": 2.0,
    "correlation_id": "corr-uuid"
  }
}
```

Không ghi raw reason/file private URL vào audit nếu không cần. Nếu cần audit diff nhạy cảm, phải mask hoặc mã hóa theo policy.

---

## 26. Idempotency

### 26.1 API bắt buộc có Idempotency-Key

| API | Lý do |
| --- | --- |
| `POST /api/v1/leave/requests` | Tránh tạo trùng đơn khi retry |
| `POST /api/v1/leave/requests/{id}/submit` | Tránh submit nhiều lần |
| `POST /api/v1/leave/requests/{id}/approve` | Tránh duyệt/trừ phép nhiều lần |
| `POST /api/v1/leave/requests/{id}/reject` | Tránh reject nhiều lần |
| `POST /api/v1/leave/requests/{id}/cancel` | Tránh cancel/refund nhiều lần |
| `POST /api/v1/leave/requests/{id}/cancel-by-admin` | Tránh cancel/refund nhiều lần |
| `POST /api/v1/leave/requests/{id}/revoke` | Tránh revoke/refund nhiều lần |
| `POST /api/v1/leave/balances/{id}/adjust` | Tránh điều chỉnh số dư trùng |
| `POST /api/v1/leave/balances/initialize` | Tránh khởi tạo balance trùng |
| Export async | Tránh tạo nhiều file export giống nhau |

---

### 26.2 Quy tắc idempotency

1. Key được scope theo `company_id + user_id + method + path + Idempotency-Key`.
2. Với request body khác nhưng key giống nhau, trả `409 RESOURCE-ERR-CONFLICT`.
3. Với retry hợp lệ, trả lại response của lần xử lý đầu tiên.
4. Idempotency record nên có TTL, ví dụ 24 giờ.
5. Approval/cancel/revoke phải idempotent theo cả state transition và balance transaction.

---

## 27. Transaction và locking

### 27.1 API cần transaction

| API | Dữ liệu cần transaction |
| --- | --- |
| Submit request | request + approval log + reserve balance + notification event |
| Approve request | request + request days + balance + transaction + approval log + ATT sync event + audit |
| Reject request | request + release balance + approval log + audit + notification |
| Cancel/Revoke | request + refund/release balance + request days sync status + ATT event + audit |
| Adjust balance | balance + balance transaction + audit + notification |
| Initialize balance | batch balance + transactions + audit |

---

### 27.2 Lock dữ liệu

Khi approve/cancel/revoke/adjust balance, backend cần lock các record liên quan để tránh race condition:

```text
leave_requests row
leave_balances row theo employee + leave_type + period_year
leave_balance_transactions insert idempotent key
attendance sync outbox event nếu dùng outbox pattern
```

Khuyến nghị dùng `SELECT ... FOR UPDATE` với `leave_balances` khi trừ/hoàn/điều chỉnh số dư.

---

## 28. Performance và cache

### 28.1 Query cần index tốt

Các query thường xuyên:

1. My requests theo employee + status + created_at.
2. Pending approvals theo approver/team + submitted_at.
3. Company requests theo status + date range + department.
4. Calendar theo date range + department/employee + status.
5. Balance theo employee + leave type + period year.
6. Balance transactions theo balance + created_at.

---

### 28.2 Cache

Có thể cache ngắn hạn:

| Dữ liệu | TTL gợi ý | Invalidate khi |
| --- | ---: | --- |
| Leave types active | 5-30 phút | Create/update/delete leave type |
| Leave policy resolve | 5-15 phút | Create/update/delete policy |
| My leave balance widget | 1-5 phút | Submit/approve/cancel/adjust balance |
| Pending approvals count | 1-2 phút | Submit/approve/reject/cancel |
| Calendar range | 1-5 phút | Approve/cancel/revoke request |

Dashboard cache phải invalidate qua event, không tự sửa dữ liệu nghiệp vụ.

---

## 29. Bảo mật và rate limit

### 29.1 Bảo mật

1. Tất cả API LEAVE cần authentication.
2. Backend luôn kiểm tra permission + data scope.
3. Không tin `company_id`, `employee_id`, `approver_id` do frontend gửi nếu có thể resolve từ context.
4. Reason/file chứng minh có thể nhạy cảm, cần masking hoặc hạn chế response.
5. Download file qua signed URL ngắn hạn.
6. Export phải ghi audit log và rate limit.
7. Notification payload không chứa lý do nghỉ đầy đủ, file URL, dữ liệu y tế hoặc thông tin cá nhân nhạy cảm.
8. API admin phải áp dụng data scope thật, không chỉ dựa trên filter frontend.

---

### 29.2 Rate limit gợi ý

| API | Rate limit gợi ý |
| --- | --- |
| Create/submit leave request | 30 requests/phút/user |
| Approve/reject/cancel | 60 requests/phút/user |
| Calculate preview | 120 requests/phút/user |
| Calendar | 60 requests/phút/user |
| Export | 5 requests/15 phút/user |
| File download URL | 60 requests/phút/user |

---

## 30. Test case checklist

### 30.1 Permission và scope

- [ ] Employee chỉ xem/tạo/hủy đơn của chính mình.
- [ ] Employee không xem đơn của employee khác bằng UUID.
- [ ] Manager chỉ xem/duyệt/từ chối đơn thuộc team.
- [ ] Manager không duyệt đơn ngoài team.
- [ ] HR scope Company xem và xử lý toàn công ty.
- [ ] Department scope chỉ thấy dữ liệu phòng ban được cấp.
- [ ] Super Admin scope System có thể truy vấn liên công ty nếu API cho phép.
- [ ] User thiếu permission bị 403.
- [ ] User có permission nhưng target ngoài scope bị 403 hoặc 404 theo policy.

---

### 30.2 State transition

- [ ] Draft -> Pending hợp lệ.
- [ ] Draft -> Cancelled hợp lệ.
- [ ] Pending -> Approved hợp lệ.
- [ ] Pending -> Rejected hợp lệ.
- [ ] Pending -> Cancelled hợp lệ nếu policy cho phép.
- [ ] Approved -> Cancelled hợp lệ nếu policy cho phép.
- [ ] Approved -> Revoked chỉ HR/Admin có quyền.
- [ ] Rejected/Cancelled/Revoked là terminal.
- [ ] Không approve lại đơn đã Approved.
- [ ] Không reject đơn đã Approved.

---

### 30.3 Balance

- [ ] Submit reserve balance nếu policy bật.
- [ ] Reject release reserved balance.
- [ ] Approve chuyển reserve thành use hoặc tạo use transaction.
- [ ] Cancel Approved tạo refund.
- [ ] Adjust balance luôn tạo transaction.
- [ ] Không cho âm phép nếu policy không cho phép.
- [ ] Idempotency không tạo transaction trùng.

---

### 30.4 ATT sync

- [ ] Approve full day tạo/cập nhật attendance status Leave.
- [ ] Approve half day/hourly giảm required working minutes.
- [ ] Cancel/Revoke Approved trigger ATT recalculate.
- [ ] ATT sync lỗi được lưu trạng thái Failed và retry.
- [ ] Không để balance đã trừ nhưng request không Approved do lỗi transaction.

---

### 30.5 File và dữ liệu nhạy cảm

- [ ] File private không lộ storage path.
- [ ] Employee chỉ xem file của đơn mình.
- [ ] Manager chỉ xem file của đơn trong scope.
- [ ] Lịch nghỉ team/company không lộ reason nếu policy ẩn.
- [ ] Notification không chứa reason/file URL.
- [ ] Export dữ liệu nhạy cảm cần permission phù hợp.

---

## 31. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/leave.paths.yaml`](openapi/paths/leave.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 31.1 Security

`bearerAuth` (HTTP bearer JWT) cho mọi endpoint LEAVE (`/api/v1/leave/*`); sync nội bộ LEAVE↔ATT (`/internal/v1/attendance/leave-sync`) dùng `internalServiceAuth`.

### 31.2 Tags của module

- `Leave - My Balance` — số dư phép của tôi
- `Leave - My Requests` — đơn nghỉ của tôi (tạo/sửa nháp/gửi/hủy)
- `Leave - Requests` — đơn nghỉ theo quyền
- `Leave - Approvals` — duyệt/từ chối/hủy-admin/thu hồi
- `Leave - Calculation` — preview & validate
- `Leave - Calendar` — lịch nghỉ
- `Leave - Types` — loại nghỉ
- `Leave - Policies` — chính sách nghỉ
- `Leave - Balances` — số dư phép (quản trị)
- `Leave - Files` — file đính kèm đơn nghỉ
- `Leave - Exports` — xuất dữ liệu nghỉ
- `Leave - Internal` — sync nội bộ LEAVE↔ATT

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

operationId prefix: `leave`.

### 31.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`.

### 31.5 DTO đề xuất cho module

`LeaveBalanceDto`, `LeaveBalanceTransactionDto`, `LeaveRequestDto`, `LeaveRequestListItemDto`, `CreateLeaveRequest`, `UpdateLeaveDraftRequest`, `SubmitLeaveRequest`, `ReviewLeaveRequest`, `LeaveCalculateRequest`, `LeaveCalculateResponse`, `LeaveTypeDto`, `LeavePolicyDto`, `LeaveCalendarItemDto`, `LeaveBalanceAdjustRequest`, `LeaveFileDto`.

---

## 32. Kết luận

API-05 định nghĩa toàn bộ API cho module LEAVE trong MVP, bao gồm employee self-service, manager/HR approval, leave type, leave policy, leave balance, calendar, file, export, audit log, notification event và đồng bộ ATT.

Các điểm bắt buộc khi triển khai backend:

1. Dùng prefix `/api/v1/leave`.
2. Tất cả API nghiệp vụ yêu cầu access token.
3. Backend kiểm tra permission + data scope cho từng endpoint.
4. Không tin `company_id`, `employee_id`, `approver_id` từ frontend nếu có thể resolve từ auth context.
5. Đơn nghỉ phải tuân thủ state machine.
6. Balance phải đi qua ledger transaction, không sửa trực tiếp không log.
7. Approve/cancel/revoke phải đồng bộ ATT hoặc phát event retry được.
8. Action quan trọng phải có audit log.
9. Event notification không chứa dữ liệu nhạy cảm.
10. API quan trọng phải hỗ trợ idempotency.
