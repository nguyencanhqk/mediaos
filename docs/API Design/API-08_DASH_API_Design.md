# API-08: DASH API DESIGN

**MODULE DASHBOARD - DASH API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · **API-08 DASH** · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-07 DASH](<../SPEC/SPEC-07 DASH.md>) · [Thiết kế DB: DB-07 NOTI/DASH](<../DB/DB-07 NOTI DASH Database Design.md>) · [Sản phẩm: PRD-00 §9.6](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-08 |
| Tên tài liệu | DASH API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | DASH - Dashboard |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-07 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **DASH - Dashboard** của hệ thống quản lý doanh nghiệp nội bộ.

Module DASH chịu trách nhiệm cung cấp API để tổng hợp, chuẩn hóa và trả dữ liệu dashboard theo vai trò, permission và data scope của người dùng. DASH không xử lý nghiệp vụ gốc như chấm công, nghỉ phép, task hay nhân sự; DASH chỉ đọc dữ liệu từ các module nguồn, áp dụng phân quyền, format thành widget và điều hướng người dùng sang module gốc khi cần thao tác.

Các nghiệp vụ API-08 cần hỗ trợ:

1. Lấy dashboard mặc định của user hiện tại sau đăng nhập.
2. Lấy danh sách dashboard type mà user được phép xem: Employee, Manager, HR, Admin.
3. Lấy cấu hình widget theo company, role, user và dashboard type.
4. Lấy dữ liệu dashboard tổng hợp theo vai trò.
5. Lấy dữ liệu từng widget riêng lẻ để frontend lazy load hoặc refresh.
6. Hiển thị quick action nhưng không xử lý nghiệp vụ gốc trong DASH.
7. Quản lý cấu hình dashboard/widget dành cho Admin hoặc người có quyền.
8. Cấu hình thứ tự, trạng thái bật/tắt, kích thước và điều kiện hiển thị widget.
9. Tích hợp cache dashboard để giảm tải query từ HR, ATT, LEAVE, TASK, NOTI.
10. Invalidate/refresh cache khi module nguồn phát sinh event quan trọng.
11. Ghi audit log khi cấu hình dashboard/widget thay đổi hoặc khi xem widget nhạy cảm.
12. Chuẩn bị mở rộng cho dashboard realtime, mobile dashboard, dashboard cá nhân hóa, BI/report và AI summary ở phase sau.

Tài liệu API-08 dùng làm cơ sở cho backend triển khai route/controller, DTO, validation, service, repository/query service, widget registry, dashboard permission guard, cache service, cache invalidation service và OpenAPI/Swagger cho module DASH.

---

## 3. Căn cứ thiết kế

API-08 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business validation, audit log và notification event.
2. **SPEC-07** xác định DASH là module tổng hợp dữ liệu theo vai trò, gồm Employee Dashboard, Manager Dashboard, HR Dashboard, Admin Dashboard và hệ thống widget.
3. **DB-07** xác định các bảng DASH chính gồm `dashboard_widgets`, `dashboard_widget_configs`, `dashboard_widget_cache`, `dashboard_user_widget_states`, `dashboard_cache_invalidations`.
4. **SPEC-02/API-02 AUTH** là nền tảng xác thực, permission, role, data scope và xác định dashboard/widget được phép hiển thị.
5. **SPEC-03/API-03 HR** cung cấp dữ liệu employee, department, position, direct manager, employment status, hợp đồng và nhân sự mới.
6. **SPEC-04/API-04 ATT** cung cấp trạng thái chấm công hôm nay, bảng công tóm tắt và bất thường chấm công.
7. **SPEC-05/API-05 LEAVE** cung cấp số ngày phép còn lại, đơn nghỉ chờ duyệt, lịch nghỉ và đơn nghỉ gần nhất.
8. **SPEC-06/API-06 TASK** cung cấp task của tôi, task team, task quá hạn/sắp đến hạn và tiến độ dự án.
9. **SPEC-08/API-07 NOTI** cung cấp unread count, danh sách thông báo mới và thông báo hệ thống.
10. **DB-08 FOUNDATION** cung cấp audit log, module catalog, setting, sequence, file metadata và public infrastructure.
11. **DB-09** định hướng index/query pattern, dashboard cache, notification unread count và tối ưu truy vấn dashboard.
12. **DB-10** định hướng seed dashboard widgets, widget config mặc định, notification events/templates và role-permission matrix.

---

## 4. Phạm vi API-08

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| Dashboard Me API | Lấy dashboard mặc định, danh sách dashboard type và summary dashboard cho user hiện tại. |
| Dashboard Type API | Lấy Employee/Manager/HR/Admin dashboard theo quyền. |
| Widget Catalog API | Lấy danh sách widget khả dụng, metadata widget, permission yêu cầu và điều kiện hiển thị. |
| Widget Data API | Lấy dữ liệu từng widget riêng lẻ, hỗ trợ lazy load, refresh và fallback khi module nguồn lỗi. |
| Dashboard Config API | Admin cấu hình widget theo company/role/user/dashboard type. |
| Widget Layout API | Cập nhật thứ tự, kích thước, bật/tắt widget và reset về mặc định. |
| Dashboard Cache API | Nội bộ invalidate/refresh/warmup cache dashboard theo event. |
| Dashboard Audit API | Ghi và xem audit log cấu hình dashboard nếu có quyền. |
| Mobile Dashboard API | Dùng chung endpoint nhưng response có thể tối ưu bằng query `view=compact`. |

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Dashboard cá nhân hóa kéo thả nâng cao | Phase sau | `/api/v1/dashboard/my-layout`, `dashboard_user_widget_states` |
| Realtime dashboard | Phase sau | WebSocket/SSE kết hợp cache invalidation event |
| Dashboard BI nâng cao | Phase sau | Tách reporting/BI service hoặc materialized view |
| Export dashboard PDF/Excel | Phase sau | `/api/v1/dashboard/export` và background job |
| Dashboard theo chi nhánh/location | Phase sau | Bổ sung filter branch/location từ Foundation/HR |
| Dashboard payroll/recruit/asset/room | Phase 2+ | Bổ sung widget theo module mới và permission riêng |
| AI summary dashboard | Phase 5 | `/api/v1/dashboard/ai-summary` dùng dữ liệu đã kiểm quyền |
| Dashboard public TV mode | Phase sau | Token riêng, read-only, không hiển thị dữ liệu nhạy cảm |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint DASH public cho frontend/mobile app dùng prefix:

```http
/api/v1/dashboard
```

Ví dụ:

```http
GET /api/v1/dashboard/me
GET /api/v1/dashboard/employee
GET /api/v1/dashboard/widgets/attendance-today
GET /api/v1/dashboard/configs
PATCH /api/v1/dashboard/configs/{config_id}
```

Các endpoint nội bộ giữa module/job dùng prefix:

```http
/internal/v1/dashboard
```

Internal API không được gọi trực tiếp từ frontend/mobile.

### 5.2 Authentication

Tất cả API DASH public trong MVP yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint DASH public không cần đăng nhập trong MVP.

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ DASH thông thường.

Quy tắc:

1. Mọi query dashboard/config/cache phải filter theo `company_id`.
2. Không tin `company_id`, `role`, `permission`, `employee_id`, `department_id` do frontend gửi nếu backend có thể resolve từ auth context.
3. Super Admin có scope `System` mới được truy vấn liên công ty qua endpoint hoặc mode riêng.
4. Widget data phải áp dụng data scope trước khi phân trang, limit hoặc aggregate.
5. Config global có `company_id = NULL`, config company-specific ưu tiên hơn global.
6. Nếu user biết UUID config/cache của công ty khác, backend vẫn trả `404 Not Found` hoặc `403 Forbidden` theo policy bảo mật.

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
  "message": "Bạn không có quyền xem dashboard này",
  "error": {
    "code": "DASH-ERR-FORBIDDEN_DASHBOARD",
    "type": "ForbiddenError",
    "details": null
  },
  "meta": {
    "request_id": "req_20260620_000003",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

### 5.5 Nguyên tắc DASH không xử lý nghiệp vụ gốc

DASH có thể hiển thị quick action như `check_in`, `create_leave_request`, `approve_leave`, `open_task`, nhưng nghiệp vụ thực tế phải gọi API module gốc: ATT, LEAVE, TASK, HR, NOTI hoặc AUTH. DASH chỉ trả metadata điều hướng và trạng thái cho phép hiển thị action.

---

## 6. Authorization, permission và data scope

### 6.1 Nguyên tắc authorization

Backend không được hard-code theo role. Backend kiểm tra theo:

```text
permission + data_scope + dashboard_type + widget_code + source_module_permission + target resource
```

`Allowed roles` trong tài liệu này chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định. Khi triển khai, service authorization phải lấy permission thật từ AUTH/RBAC.

### 6.2 Scope chuẩn trong DASH

| Scope | Ý nghĩa trong DASH |
| --- | --- |
| `Own` | Chỉ dữ liệu của user/employee hiện tại: chấm công hôm nay, task của tôi, số phép của tôi, notification của tôi. |
| `Team` | Dữ liệu nhân viên thuộc team/quản lý trực tiếp của user hiện tại. |
| `Department` | Dữ liệu thuộc phòng ban user quản lý hoặc được phân quyền. |
| `Project` | Dữ liệu dự án/task mà user là member/owner hoặc được cấp quyền. |
| `Company` | Dữ liệu toàn công ty hiện tại, thường dành cho HR/Admin. |
| `System` | Dữ liệu liên công ty/hệ thống, chỉ dành cho Super Admin hoặc service nội bộ đặc biệt. |

### 6.3 Quyền DASH trong MVP

| Permission | Mục đích |
| --- | --- |
| `DASH.DASHBOARD.VIEW` | Truy cập dashboard chung |
| `DASH.DASHBOARD.VIEW_EMPLOYEE` | Xem Employee Dashboard |
| `DASH.DASHBOARD.VIEW_MANAGER` | Xem Manager Dashboard |
| `DASH.DASHBOARD.VIEW_HR` | Xem HR Dashboard |
| `DASH.DASHBOARD.VIEW_ADMIN` | Xem Admin Dashboard |
| `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | Xem widget chấm công hôm nay |
| `DASH.WIDGET.VIEW_MY_TASKS` | Xem widget task của tôi |
| `DASH.WIDGET.VIEW_TASK_ALERTS` | Xem widget task quá hạn/sắp đến hạn |
| `DASH.WIDGET.VIEW_LEAVE_BALANCE` | Xem số ngày phép còn lại |
| `DASH.WIDGET.VIEW_PENDING_LEAVE` | Xem đơn nghỉ chờ duyệt |
| `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | Xem lịch nghỉ |
| `DASH.WIDGET.VIEW_NOTIFICATIONS` | Xem thông báo mới |
| `DASH.WIDGET.VIEW_HR_OVERVIEW` | Xem tổng quan nhân sự |
| `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | Xem nhân sự mới |
| `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | Xem hợp đồng sắp hết hạn |
| `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | Xem bất thường chấm công |
| `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | Xem tiến độ dự án |
| `DASH.WIDGET.VIEW_USER_SUMMARY` | Xem tổng số user |
| `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` | Xem tổng số nhân viên |
| `DASH.WIDGET.VIEW_MODULE_STATUS` | Xem module đang dùng |
| `DASH.WIDGET.VIEW_CONFIG_WARNINGS` | Xem cảnh báo cấu hình |
| `DASH.WIDGET.VIEW_NEW_USERS` | Xem tài khoản mới |
| `DASH.WIDGET.VIEW_SYSTEM_LOGS` | Xem log quan trọng |
| `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` | Xem thông báo hệ thống |
| `DASH.WIDGET.VIEW_LATEST_LEAVE` | Xem đơn nghỉ gần nhất |
| `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` | Xem task team hôm nay |
| `DASH.WIDGET.VIEW_PROBATION_ENDING` | Xem nhân sự sắp hết thử việc |
| `DASH.CONFIG.VIEW` | Xem cấu hình dashboard/widget |
| `DASH.CONFIG.UPDATE` | Cập nhật cấu hình dashboard/widget |
| `DASH.AUDIT_LOG.VIEW` | Xem audit log liên quan dashboard |
| `DASH.CACHE.REFRESH` | Làm mới cache widget/dashboard |

### 6.4 Role mặc định gợi ý

| Role | Dashboard mặc định | Scope thường dùng | Ghi chú |
| --- | --- | --- | --- |
| Employee | Employee | Own | Xem dữ liệu cá nhân, task, phép, notification. |
| Manager | Manager | Team + Own | Xem dữ liệu team, duyệt đơn nghỉ/điều chỉnh công qua module gốc. |
| HR | HR | Company hoặc Department | Xem nhân sự, chấm công, nghỉ phép toàn công ty hoặc phòng ban. |
| Admin công ty | Admin | Company | Xem user/module/config/system warning trong công ty. |
| Super Admin | Admin/System | System | Có thể xem liên công ty nếu endpoint hỗ trợ và được cấp scope System. |

### 6.5 Kiểm tra permission module nguồn

Ngoài permission `DASH.*`, một số widget nhạy cảm có thể yêu cầu permission module nguồn tương ứng.

| Widget | Permission DASH | Permission nguồn khuyến nghị |
| --- | --- | --- |
| HR overview | `DASH.WIDGET.VIEW_HR_OVERVIEW` | `HR.EMPLOYEE.VIEW` |
| Contract expiring | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | `HR.CONTRACT.VIEW` |
| Attendance alerts | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | `ATT.ATTENDANCE.VIEW hoặc ATT.ATTENDANCE.VIEW_TEAM` |
| Pending leave | `DASH.WIDGET.VIEW_PENDING_LEAVE` | `LEAVE.REQUEST.VIEW + LEAVE.REQUEST.APPROVE nếu hiển thị action duyệt` |
| Project progress | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | `TASK.PROJECT.VIEW` |
| System logs | `DASH.WIDGET.VIEW_SYSTEM_LOGS` | `FOUNDATION.AUDIT_LOG.VIEW` |

---

## 7. Dashboard type, widget catalog và quy ước trạng thái

### 7.1 Dashboard type

| Dashboard type | Mục đích | Permission |
| --- | --- | --- |
| `Employee` | Dashboard cá nhân sau đăng nhập | `DASH.DASHBOARD.VIEW_EMPLOYEE` |
| `Manager` | Dashboard quản lý team | `DASH.DASHBOARD.VIEW_MANAGER` |
| `HR` | Dashboard nhân sự/chấm công/nghỉ phép | `DASH.DASHBOARD.VIEW_HR` |
| `Admin` | Dashboard quản trị hệ thống/công ty | `DASH.DASHBOARD.VIEW_ADMIN` |

### 7.2 Quy tắc chọn dashboard mặc định

Thứ tự ưu tiên đề xuất khi user có nhiều role:

```text
1. Nếu user có cấu hình dashboard mặc định cá nhân -> dùng cấu hình cá nhân nếu còn hợp lệ.
2. Nếu user có role Admin/Super Admin và có DASH.DASHBOARD.VIEW_ADMIN -> Admin Dashboard.
3. Nếu user có role HR và có DASH.DASHBOARD.VIEW_HR -> HR Dashboard.
4. Nếu user có role Manager và có DASH.DASHBOARD.VIEW_MANAGER -> Manager Dashboard.
5. Nếu user có DASH.DASHBOARD.VIEW_EMPLOYEE -> Employee Dashboard.
6. Nếu không xác định được -> trả DASH-ERR-DASHBOARD_NOT_RESOLVED.
```

### 7.3 Widget status

| Status | Ý nghĩa |
| --- | --- |
| `Active` | Widget đang bật và có thể hiển thị |
| `Inactive` | Widget bị tắt bởi cấu hình |
| `Hidden` | Widget bị ẩn do thiếu quyền hoặc không phù hợp dashboard type |
| `Error` | Widget lỗi khi load dữ liệu |
| `Empty` | Widget load thành công nhưng không có dữ liệu |
| `Degraded` | Module nguồn lỗi một phần, widget trả fallback/empty state |

### 7.4 Widget catalog MVP

| Widget code | Tên widget | API slug | Permission | Module nguồn |
| --- | --- | --- | --- | --- |
| `ATTENDANCE_TODAY` | Chấm công hôm nay | `attendance-today` | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` | ATT, HR, LEAVE |
| `MY_TASKS` | Task của tôi hôm nay | `my-tasks` | `DASH.WIDGET.VIEW_MY_TASKS` | TASK, HR |
| `TASK_ALERTS` | Task quá hạn/sắp đến hạn | `task-alerts` | `DASH.WIDGET.VIEW_TASK_ALERTS` | TASK, HR |
| `LEAVE_BALANCE` | Số ngày phép còn lại | `leave-balance` | `DASH.WIDGET.VIEW_LEAVE_BALANCE` | LEAVE, HR |
| `PENDING_LEAVE` | Đơn nghỉ chờ duyệt | `pending-leave` | `DASH.WIDGET.VIEW_PENDING_LEAVE` | LEAVE, HR |
| `LEAVE_CALENDAR` | Lịch nghỉ team/công ty | `leave-calendar` | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` | LEAVE, HR |
| `NOTIFICATIONS` | Thông báo mới | `notifications` | `DASH.WIDGET.VIEW_NOTIFICATIONS` | NOTI |
| `HR_OVERVIEW` | Tổng quan nhân sự | `hr-overview` | `DASH.WIDGET.VIEW_HR_OVERVIEW` | HR |
| `NEW_EMPLOYEES` | Nhân sự mới | `new-employees` | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` | HR |
| `CONTRACT_EXPIRING` | Hợp đồng sắp hết hạn | `contract-expiring` | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` | HR |
| `ATTENDANCE_ALERTS` | Bất thường chấm công | `attendance-alerts` | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` | ATT, HR |
| `PROJECT_PROGRESS` | Tiến độ dự án | `project-progress` | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` | TASK, HR |
| `USER_SUMMARY` | Tổng số user | `user-summary` | `DASH.WIDGET.VIEW_USER_SUMMARY` | AUTH |
| `EMPLOYEE_SUMMARY` | Tổng số nhân viên | `employee-summary` | `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` | HR |
| `MODULE_STATUS` | Module đang dùng | `module-status` | `DASH.WIDGET.VIEW_MODULE_STATUS` | FOUNDATION |
| `CONFIG_WARNINGS` | Cảnh báo cấu hình | `config-warnings` | `DASH.WIDGET.VIEW_CONFIG_WARNINGS` | FOUNDATION, AUTH, HR, ATT, LEAVE, NOTI |
| `NEW_USERS` | Tài khoản mới | `new-users` | `DASH.WIDGET.VIEW_NEW_USERS` | AUTH, HR |
| `SYSTEM_LOGS` | Log quan trọng gần đây | `system-logs` | `DASH.WIDGET.VIEW_SYSTEM_LOGS` | FOUNDATION/AUDIT |
| `SYSTEM_NOTIFICATIONS` | Thông báo hệ thống | `system-notifications` | `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` | NOTI, FOUNDATION |
| `LATEST_LEAVE` | Đơn nghỉ gần nhất | `latest-leave` | `DASH.WIDGET.VIEW_LATEST_LEAVE` | LEAVE |
| `TEAM_TASKS_TODAY` | Task team hôm nay | `team-tasks-today` | `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` | TASK, HR |
| `PROBATION_ENDING` | Sắp hết thử việc | `probation-ending` | `DASH.WIDGET.VIEW_PROBATION_ENDING` | HR |

---

## 8. DTO dùng chung

### 8.1 User summary DTO

```json
{
  "id": "5c64b96a-8e55-4c3d-9f51-000000000001",
  "display_name": "Nguyễn Văn A",
  "email": "nguyenvana@company.com",
  "avatar_url": null,
  "roles": ["Employee", "Manager"]
}
```

### 8.2 Employee summary DTO

```json
{
  "id": "8fe7db24-4a35-46d9-9f36-000000000002",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "department": {
    "id": "dept-id",
    "name": "Phòng Kỹ thuật"
  },
  "position": {
    "id": "position-id",
    "name": "Developer"
  },
  "employment_status": "Official"
}
```

### 8.3 Dashboard widget DTO

```json
{
  "widget_code": "MY_TASKS",
  "widget_name": "Task của tôi hôm nay",
  "widget_type": "List",
  "status": "Active",
  "permission": "DASH.WIDGET.VIEW_MY_TASKS",
  "data_scope": "Own",
  "source_modules": ["TASK"],
  "layout": {
    "order": 2,
    "size": "medium",
    "column": 1,
    "row": 1
  },
  "data": {},
  "empty_state": null,
  "error_state": null,
  "last_updated_at": "2026-06-20T10:00:00+07:00",
  "cache": {
    "hit": true,
    "ttl_seconds": 60,
    "expires_at": "2026-06-20T10:01:00+07:00"
  }
}
```

### 8.4 Quick action DTO

```json
{
  "action_code": "OPEN_TASK_DETAIL",
  "label": "Xem task",
  "target_module": "TASK",
  "method": "NAVIGATE",
  "target_url": "/tasks/8fe7db24-4a35-46d9-9f36-000000000003",
  "api_endpoint": null,
  "enabled": true,
  "disabled_reason": null
}
```

### 8.5 Widget error DTO

```json
{
  "widget_code": "ATTENDANCE_ALERTS",
  "status": "Degraded",
  "data": null,
  "error_state": {
    "code": "DASH-ERR-SOURCE_MODULE_UNAVAILABLE",
    "message": "Không thể tải dữ liệu chấm công lúc này",
    "source_module": "ATT",
    "retryable": true
  },
  "last_success_at": "2026-06-20T09:55:00+07:00"
}
```

---

## 9. Chuẩn query list, filter, sort và cache

### 9.1 Query params chung

| Param | Kiểu | Mặc định | Mô tả |
| --- | --- | --- | --- |
| `dashboard_type` | string | auto | Employee/Manager/HR/Admin; nếu không truyền thì backend tự resolve. |
| `widget_codes` | string[] | all allowed | Danh sách widget_code cần lấy, dùng để lazy load dashboard. |
| `view` | string | full | `full` hoặc `compact` cho mobile/header. |
| `from_date` | date | tùy widget | Ngày bắt đầu filter. |
| `to_date` | date | tùy widget | Ngày kết thúc filter. |
| `period` | string | current_month | today/current_week/current_month/custom. |
| `refresh` | boolean | false | Nếu true và user có quyền, bỏ qua cache hợp lệ để query lại. |
| `include_config` | boolean | true | Có trả layout/config widget không. |
| `include_empty_widgets` | boolean | true | Có trả widget empty/hidden không. |
| `limit` | integer | tùy widget | Số item tối đa trong widget list. |

### 9.2 Cache policy

| Nhóm widget | TTL đề xuất | Invalidation event |
| --- | --- | --- |
| Chấm công hôm nay | 10-30 giây | attendance.checked_in, attendance.checked_out, leave.request.approved |
| Task cá nhân/team | 30-60 giây | TASK_CREATED, TASK_UPDATED, TASK_STATUS_CHANGED, TASK_ASSIGNED |
| Nghỉ phép | 30-120 giây | LEAVE_REQUEST_SUBMITTED, leave.request.approved, LEAVE_REJECTED, LEAVE_BALANCE_ADJUSTED |

> Các tín hiệu invalidation `attendance.checked_in`, `attendance.checked_out`, `leave.request.approved` là **sự kiện domain/cache nội bộ, không phải NOTI notification** (dạng dotted-lowercase khớp BACKEND-12 §23.1 `x-domain-events`). Self check-in/out **không có** event NOTI người dùng.
| Notification | Không cache hoặc 5-10 giây | NOTIFICATION_CREATED, NOTIFICATION_READ |
| HR overview | 5-15 phút | EMPLOYEE_CREATED, EMPLOYEE_UPDATED, CONTRACT_UPDATED |
| Admin/system | 1-10 phút | USER_CREATED, ROLE_UPDATED, MODULE_CONFIG_UPDATED |

### 9.3 Nguyên tắc filter theo thời gian

Backend phải dùng timezone công ty để xác định `today`, `current_week`, `current_month`. Client có thể truyền timezone để hiển thị, nhưng không được dùng client timezone làm nguồn nghiệp vụ chính.

---

## 10. Tổng quan endpoint

### 10.1 Dashboard endpoints

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| DASH-API-001 | GET | `/api/v1/dashboard/me` | Lấy dashboard mặc định của user hiện tại | `DASH.DASHBOARD.VIEW` |
| DASH-API-002 | GET | `/api/v1/dashboard/types` | Lấy danh sách dashboard user được phép xem | `DASH.DASHBOARD.VIEW` |
| DASH-API-003 | GET | `/api/v1/dashboard/widgets` | Lấy danh sách widget khả dụng theo quyền | `DASH.DASHBOARD.VIEW` |
| DASH-API-004 | GET | `/api/v1/dashboard/employee` | Lấy Employee Dashboard | `DASH.DASHBOARD.VIEW_EMPLOYEE` |
| DASH-API-005 | GET | `/api/v1/dashboard/manager` | Lấy Manager Dashboard | `DASH.DASHBOARD.VIEW_MANAGER` |
| DASH-API-006 | GET | `/api/v1/dashboard/hr` | Lấy HR Dashboard | `DASH.DASHBOARD.VIEW_HR` |
| DASH-API-007 | GET | `/api/v1/dashboard/admin` | Lấy Admin Dashboard | `DASH.DASHBOARD.VIEW_ADMIN` |
| DASH-API-008 | GET | `/api/v1/dashboard/summary` | Lấy summary dashboard nhẹ cho header/mobile | `DASH.DASHBOARD.VIEW` |

### 10.2 Widget data endpoints

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| DASH-API-101 | GET | `/api/v1/dashboard/widgets/attendance-today` | Widget Chấm công hôm nay | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` |
| DASH-API-102 | GET | `/api/v1/dashboard/widgets/my-tasks` | Widget Task của tôi hôm nay | `DASH.WIDGET.VIEW_MY_TASKS` |
| DASH-API-103 | GET | `/api/v1/dashboard/widgets/task-alerts` | Widget Task quá hạn/sắp đến hạn | `DASH.WIDGET.VIEW_TASK_ALERTS` |
| DASH-API-104 | GET | `/api/v1/dashboard/widgets/leave-balance` | Widget Số ngày phép còn lại | `DASH.WIDGET.VIEW_LEAVE_BALANCE` |
| DASH-API-105 | GET | `/api/v1/dashboard/widgets/pending-leave` | Widget Đơn nghỉ chờ duyệt | `DASH.WIDGET.VIEW_PENDING_LEAVE` |
| DASH-API-106 | GET | `/api/v1/dashboard/widgets/leave-calendar` | Widget Lịch nghỉ team/công ty | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` |
| DASH-API-107 | GET | `/api/v1/dashboard/widgets/notifications` | Widget Thông báo mới | `DASH.WIDGET.VIEW_NOTIFICATIONS` |
| DASH-API-108 | GET | `/api/v1/dashboard/widgets/hr-overview` | Widget Tổng quan nhân sự | `DASH.WIDGET.VIEW_HR_OVERVIEW` |
| DASH-API-109 | GET | `/api/v1/dashboard/widgets/new-employees` | Widget Nhân sự mới | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` |
| DASH-API-110 | GET | `/api/v1/dashboard/widgets/contract-expiring` | Widget Hợp đồng sắp hết hạn | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` |
| DASH-API-111 | GET | `/api/v1/dashboard/widgets/attendance-alerts` | Widget Bất thường chấm công | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` |
| DASH-API-112 | GET | `/api/v1/dashboard/widgets/project-progress` | Widget Tiến độ dự án | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` |
| DASH-API-113 | GET | `/api/v1/dashboard/widgets/user-summary` | Widget Tổng số user | `DASH.WIDGET.VIEW_USER_SUMMARY` |
| DASH-API-114 | GET | `/api/v1/dashboard/widgets/employee-summary` | Widget Tổng số nhân viên | `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` |
| DASH-API-115 | GET | `/api/v1/dashboard/widgets/module-status` | Widget Module đang dùng | `DASH.WIDGET.VIEW_MODULE_STATUS` |
| DASH-API-116 | GET | `/api/v1/dashboard/widgets/config-warnings` | Widget Cảnh báo cấu hình | `DASH.WIDGET.VIEW_CONFIG_WARNINGS` |
| DASH-API-117 | GET | `/api/v1/dashboard/widgets/new-users` | Widget Tài khoản mới | `DASH.WIDGET.VIEW_NEW_USERS` |
| DASH-API-118 | GET | `/api/v1/dashboard/widgets/system-logs` | Widget Log quan trọng gần đây | `DASH.WIDGET.VIEW_SYSTEM_LOGS` |
| DASH-API-119 | GET | `/api/v1/dashboard/widgets/system-notifications` | Widget Thông báo hệ thống | `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` |
| DASH-API-120 | GET | `/api/v1/dashboard/widgets/latest-leave` | Widget Đơn nghỉ gần nhất | `DASH.WIDGET.VIEW_LATEST_LEAVE` |
| DASH-API-121 | GET | `/api/v1/dashboard/widgets/team-tasks-today` | Widget Task team hôm nay | `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` |
| DASH-API-122 | GET | `/api/v1/dashboard/widgets/probation-ending` | Widget Sắp hết thử việc | `DASH.WIDGET.VIEW_PROBATION_ENDING` |

### 10.3 Config endpoints

| Mã API | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| DASH-API-201 | GET | `/api/v1/dashboard/configs` | Lấy danh sách cấu hình widget | `DASH.CONFIG.VIEW` |
| DASH-API-202 | POST | `/api/v1/dashboard/configs` | Tạo cấu hình widget | `DASH.CONFIG.UPDATE` |
| DASH-API-203 | GET | `/api/v1/dashboard/configs/{config_id}` | Xem chi tiết cấu hình widget | `DASH.CONFIG.VIEW` |
| DASH-API-204 | PATCH | `/api/v1/dashboard/configs/{config_id}` | Cập nhật cấu hình widget | `DASH.CONFIG.UPDATE` |
| DASH-API-205 | DELETE | `/api/v1/dashboard/configs/{config_id}` | Xóa mềm/vô hiệu hóa cấu hình widget | `DASH.CONFIG.UPDATE` |
| DASH-API-206 | POST | `/api/v1/dashboard/configs/reset-default` | Khôi phục cấu hình dashboard mặc định | `DASH.CONFIG.UPDATE` |
| DASH-API-207 | POST | `/api/v1/dashboard/configs/reorder` | Cập nhật thứ tự widget | `DASH.CONFIG.UPDATE` |
| DASH-API-208 | POST | `/api/v1/dashboard/configs/bulk-update` | Cập nhật nhiều cấu hình widget | `DASH.CONFIG.UPDATE` |

### 10.4 Internal/cache endpoints

| Mã API | Method | Endpoint | Mục đích | Authentication |
| --- | --- | --- | --- | --- |
| DASH-INT-001 | POST | `/internal/v1/dashboard/cache/invalidate` | Invalidate cache theo event/module/entity | Internal service token |
| DASH-INT-002 | POST | `/internal/v1/dashboard/cache/refresh` | Refresh cache widget/dashboard | Internal service token |
| DASH-INT-003 | POST | `/internal/v1/dashboard/events/module-updated` | Nhận event module source thay đổi | Internal service token |
| DASH-INT-004 | POST | `/internal/v1/dashboard/jobs/warmup-cache` | Job warm up cache dashboard | Internal service token |

---

## 11. Dashboard API chi tiết

### 11.1 GET `/api/v1/dashboard/me` - Lấy dashboard mặc định của user hiện tại

**Mục đích**

Endpoint chính sau đăng nhập. Backend xác định dashboard mặc định dựa trên user, role, permission, cấu hình cá nhân và company config.

**Required permission**

`DASH.DASHBOARD.VIEW`

**Allowed roles**

Employee, Manager, HR, Admin công ty, Super Admin

**Data scope**

Theo dashboard type được resolve; mỗi widget tự áp dụng scope riêng.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `view` | string | Không | `full` hoặc `compact`. |
| `widget_codes` | string[] | Không | Chỉ load một số widget cụ thể. |
| `refresh` | boolean | Không | Bỏ qua cache nếu có quyền. |

**Business validation**

- User phải active và thuộc company active.
- User phải có ít nhất một role hợp lệ.
- Backend chỉ trả widget mà user có permission.
- Widget lỗi không được làm toàn bộ dashboard lỗi; trả widget status `Error` hoặc `Degraded`.

**Success response**

```json
{
  "success": true,
  "message": "Lấy dashboard thành công",
  "data": {
    "dashboard_type": "Manager",
    "resolved_from": "role_priority",
    "user": {
      "id": "user-id",
      "display_name": "Nguyễn Văn A",
      "roles": ["Employee", "Manager"]
    },
    "employee": {
      "id": "employee-id",
      "employee_code": "EMP0001",
      "full_name": "Nguyễn Văn A"
    },
    "widgets": [
      {
        "widget_code": "ATTENDANCE_TODAY",
        "widget_name": "Chấm công hôm nay",
        "status": "Active",
        "data": {
          "work_date": "2026-06-20",
          "attendance_status": "NotCheckedIn"
        },
        "last_updated_at": "2026-06-20T08:00:00+07:00"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000010",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.2 GET `/api/v1/dashboard/types` - Lấy danh sách dashboard user được phép xem

**Mục đích**

Endpoint phục vụ dropdown/chuyển dashboard khi user có nhiều role.

**Required permission**

`DASH.DASHBOARD.VIEW`

**Allowed roles**

Employee, Manager, HR, Admin công ty, Super Admin

**Data scope**

N/A - chỉ trả dashboard type được phép theo permission.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Business validation**

- Chỉ trả type nếu user có permission tương ứng.
- Nếu user không có dashboard type nào, trả lỗi DASH-ERR-DASHBOARD_NOT_RESOLVED.

**Success response**

```json
{
  "success": true,
  "message": "Lấy danh sách dashboard thành công",
  "data": [
    {
      "dashboard_type": "Employee",
      "label": "Dashboard cá nhân",
      "is_default": false,
      "permission": "DASH.DASHBOARD.VIEW_EMPLOYEE"
    },
    {
      "dashboard_type": "Manager",
      "label": "Dashboard quản lý",
      "is_default": true,
      "permission": "DASH.DASHBOARD.VIEW_MANAGER"
    }
  ]
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.3 GET `/api/v1/dashboard/widgets` - Lấy danh sách widget khả dụng

**Mục đích**

Trả metadata widget và cấu hình hiển thị, không bắt buộc trả dữ liệu widget.

**Required permission**

`DASH.DASHBOARD.VIEW`

**Allowed roles**

Employee, Manager, HR, Admin công ty, Super Admin

**Data scope**

Theo permission widget và dashboard type.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `dashboard_type` | string | Không | Employee/Manager/HR/Admin. |
| `include_hidden` | boolean | Không | Có trả widget bị ẩn do thiếu quyền không. |
| `include_data` | boolean | Không | Nếu true, load cả dữ liệu widget. |

**Business validation**

- Widget phải active trong catalog.
- Nếu include_data=true, mỗi widget vẫn kiểm tra permission riêng.
- Không trả config của role/user khác nếu không có quyền DASH.CONFIG.VIEW.

**Success response**

```json
{
  "success": true,
  "message": "Lấy danh sách widget thành công",
  "data": [
    {
      "widget_code": "MY_TASKS",
      "widget_name": "Task của tôi hôm nay",
      "permission": "DASH.WIDGET.VIEW_MY_TASKS",
      "source_modules": ["TASK"],
      "enabled": true,
      "layout": { "order": 2, "size": "medium" }
    }
  ]
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.4 GET `/api/v1/dashboard/employee` - Lấy Employee Dashboard

**Mục đích**

Lấy Employee Dashboard theo quyền. Thường gồm chấm công hôm nay, task của tôi, số ngày phép còn lại, thông báo mới, đơn nghỉ gần nhất.

**Required permission**

`DASH.DASHBOARD.VIEW_EMPLOYEE`

**Allowed roles**

Employee, Manager, HR, Admin công ty, Super Admin

**Data scope**

Theo scope cao nhất phù hợp với từng widget trong dashboard.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `view` | string | Không | `full` hoặc `compact`. |
| `widget_codes` | string[] | Không | Chỉ load các widget chỉ định. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- User phải có permission dashboard type tương ứng.
- Từng widget trong dashboard phải kiểm tra permission riêng.
- Không có dữ liệu của widget này không được làm lỗi toàn bộ dashboard.

**Success response**

```json
{
  "success": true,
  "message": "Lấy dashboard thành công",
  "data": {
    "dashboard_type": "Employee",
    "widgets": [],
    "generated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.5 GET `/api/v1/dashboard/manager` - Lấy Manager Dashboard

**Mục đích**

Lấy Manager Dashboard. Thường gồm đơn nghỉ chờ duyệt, task team hôm nay, task team quá hạn, lịch nghỉ team, bất thường chấm công team.

**Required permission**

`DASH.DASHBOARD.VIEW_MANAGER`

**Allowed roles**

Manager, HR nếu được cấp, Admin công ty, Super Admin

**Data scope**

Theo scope cao nhất phù hợp với từng widget trong dashboard.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `view` | string | Không | `full` hoặc `compact`. |
| `widget_codes` | string[] | Không | Chỉ load các widget chỉ định. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- User phải có permission dashboard type tương ứng.
- Từng widget trong dashboard phải kiểm tra permission riêng.
- Không có dữ liệu của widget này không được làm lỗi toàn bộ dashboard.

**Success response**

```json
{
  "success": true,
  "message": "Lấy dashboard thành công",
  "data": {
    "dashboard_type": "Employee",
    "widgets": [],
    "generated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.6 GET `/api/v1/dashboard/hr` - Lấy Hr Dashboard

**Mục đích**

Lấy HR Dashboard. Thường gồm tổng quan nhân sự, nhân sự mới, hợp đồng sắp hết hạn, sắp hết thử việc, đơn nghỉ chờ duyệt, bất thường chấm công.

**Required permission**

`DASH.DASHBOARD.VIEW_HR`

**Allowed roles**

HR, Admin công ty nếu được cấp, Super Admin

**Data scope**

Theo scope cao nhất phù hợp với từng widget trong dashboard.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `view` | string | Không | `full` hoặc `compact`. |
| `widget_codes` | string[] | Không | Chỉ load các widget chỉ định. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- User phải có permission dashboard type tương ứng.
- Từng widget trong dashboard phải kiểm tra permission riêng.
- Không có dữ liệu của widget này không được làm lỗi toàn bộ dashboard.

**Success response**

```json
{
  "success": true,
  "message": "Lấy dashboard thành công",
  "data": {
    "dashboard_type": "Employee",
    "widgets": [],
    "generated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.7 GET `/api/v1/dashboard/admin` - Lấy Admin Dashboard

**Mục đích**

Lấy Admin Dashboard. Thường gồm tổng số user, module đang dùng, cảnh báo cấu hình, tài khoản mới, log quan trọng, thông báo hệ thống.

**Required permission**

`DASH.DASHBOARD.VIEW_ADMIN`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Theo scope cao nhất phù hợp với từng widget trong dashboard.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `view` | string | Không | `full` hoặc `compact`. |
| `widget_codes` | string[] | Không | Chỉ load các widget chỉ định. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- User phải có permission dashboard type tương ứng.
- Từng widget trong dashboard phải kiểm tra permission riêng.
- Không có dữ liệu của widget này không được làm lỗi toàn bộ dashboard.

**Success response**

```json
{
  "success": true,
  "message": "Lấy dashboard thành công",
  "data": {
    "dashboard_type": "Employee",
    "widgets": [],
    "generated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 11.8 GET `/api/v1/dashboard/summary` - Lấy summary dashboard nhẹ

**Mục đích**

Endpoint nhẹ cho header/mobile: unread notification, pending approval count, task alert count, attendance today status.

**Required permission**

`DASH.DASHBOARD.VIEW`

**Allowed roles**

Employee, Manager, HR, Admin công ty, Super Admin

**Data scope**

Theo từng summary item.

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `items` | string[] | Không | Danh sách summary item cần lấy. |

**Business validation**

- Chỉ trả item mà user có quyền xem.
- Không trả danh sách chi tiết, chỉ trả số lượng/trạng thái ngắn gọn.

**Success response**

```json
{
  "success": true,
  "message": "Lấy summary thành công",
  "data": {
    "unread_notifications": 5,
    "pending_leave_requests": 2,
    "my_overdue_tasks": 1,
    "attendance_today_status": "CheckedIn"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

## 12. Widget API chi tiết

Các endpoint widget dùng chung pattern sau:

```http
GET /api/v1/dashboard/widgets/{widget_slug}?period=current_month&limit=10&refresh=false
```

Nguyên tắc chung:

- Mỗi widget endpoint chỉ trả dữ liệu cho widget đó.
- Backend kiểm tra permission widget tương ứng.
- Widget phải áp dụng data scope trước khi aggregate hoặc limit.
- Nếu module nguồn lỗi, trả widget status `Degraded` thay vì làm client crash.
- Dữ liệu nhạy cảm phải được ẩn hoặc chỉ trả khi có permission nguồn tương ứng.

### 12.1 GET `/api/v1/dashboard/widgets/attendance-today` - Chấm công hôm nay

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `ATTENDANCE_TODAY` |
| Required permission | `DASH.WIDGET.VIEW_ATTENDANCE_TODAY` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own mặc định; Manager/HR/Admin chỉ xem dữ liệu cá nhân khi ở widget cá nhân |
| Module nguồn | ATT, HR, LEAVE |

**Mục đích**

Hiển thị trạng thái check-in/check-out trong ngày, ca làm, rule áp dụng và quick action chấm công.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- User phải liên kết với employee active/probation nếu dashboard cá nhân cần dữ liệu chấm công.
- Nếu có đơn nghỉ cả ngày Approved, widget phải hiển thị trạng thái nghỉ và không trả quick action check-in/check-out.
- Nút action chỉ là điều hướng/gọi API ATT, DASH không tự ghi attendance record.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "ATTENDANCE_TODAY",
    "widget_name": "Chấm công hôm nay",
    "status": "Active",
    "source_modules": ["ATT", "HR", "LEAVE"],
    "summary": {},
    "items": [],
    "data_fields": "today_status, work_date, shift, check_in_at, check_out_at, attendance_status, allowed_actions, blocking_reason, warnings",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.2 GET `/api/v1/dashboard/widgets/my-tasks` - Task của tôi hôm nay

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `MY_TASKS` |
| Required permission | `DASH.WIDGET.VIEW_MY_TASKS` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Module nguồn | TASK, HR |

**Mục đích**

Hiển thị task được giao cho employee hiện tại cần xử lý trong ngày.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ lấy task mà employee hiện tại là assignee/watcher/reporter theo rule TASK.
- Không trả task thuộc project private nếu user không phải member và không có scope phù hợp.
- Giới hạn số item mặc định 5-10 để dashboard nhẹ.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "MY_TASKS",
    "widget_name": "Task của tôi hôm nay",
    "status": "Active",
    "source_modules": ["TASK", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, summary.todo, summary.in_progress, items.task_id, task_code, title, priority, status, due_at, project, quick_actions",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.3 GET `/api/v1/dashboard/widgets/task-alerts` - Task quá hạn/sắp đến hạn

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `TASK_ALERTS` |
| Required permission | `DASH.WIDGET.VIEW_TASK_ALERTS` |
| Allowed roles | Employee, Manager, HR nếu được cấp, Admin công ty, Super Admin |
| Data scope | Own, Team, Department, Company, System |
| Module nguồn | TASK, HR |

**Mục đích**

Hiển thị cảnh báo task quá hạn, task sắp đến hạn theo scope người dùng.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Scope Team chỉ lấy nhân viên do manager quản lý hoặc task thuộc project mà manager có quyền.
- Không tính task Done/Cancelled vào cảnh báo quá hạn.
- Khoảng due soon mặc định 3 ngày, có thể cấu hình.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "TASK_ALERTS",
    "widget_name": "Task quá hạn/sắp đến hạn",
    "status": "Active",
    "source_modules": ["TASK", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.overdue, summary.due_today, summary.due_soon, items.task_id, title, assignee, due_at, days_overdue, priority",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.4 GET `/api/v1/dashboard/widgets/leave-balance` - Số ngày phép còn lại

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `LEAVE_BALANCE` |
| Required permission | `DASH.WIDGET.VIEW_LEAVE_BALANCE` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Module nguồn | LEAVE, HR |

**Mục đích**

Hiển thị số ngày phép còn lại của nhân viên hiện tại theo từng loại nghỉ.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Employee phải có leave balance trong kỳ hoặc hệ thống trả empty state phù hợp.
- Không hiển thị số dư phép của người khác trong widget cá nhân.
- Loại nghỉ bị disabled không hiển thị trừ khi có phát sinh trong năm hiện tại.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "LEAVE_BALANCE",
    "widget_name": "Số ngày phép còn lại",
    "status": "Active",
    "source_modules": ["LEAVE", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "year, balances.leave_type_code, leave_type_name, total_entitled, used, pending, remaining, warning_level",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.5 GET `/api/v1/dashboard/widgets/pending-leave` - Đơn nghỉ chờ duyệt

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `PENDING_LEAVE` |
| Required permission | `DASH.WIDGET.VIEW_PENDING_LEAVE` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Module nguồn | LEAVE, HR |

**Mục đích**

Hiển thị danh sách đơn nghỉ Pending cần người dùng xử lý theo phạm vi quyền.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Manager chỉ thấy đơn của nhân viên thuộc team hoặc đơn được chỉ định duyệt.
- HR/Admin thấy theo scope Company nếu có permission.
- Không hiển thị đơn Draft/Cancelled/Rejected.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "PENDING_LEAVE",
    "widget_name": "Đơn nghỉ chờ duyệt",
    "status": "Active",
    "source_modules": ["LEAVE", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total_pending, items.request_id, request_code, employee, leave_type, from_date, to_date, total_days, submitted_at, quick_actions",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.6 GET `/api/v1/dashboard/widgets/leave-calendar` - Lịch nghỉ team/công ty

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `LEAVE_CALENDAR` |
| Required permission | `DASH.WIDGET.VIEW_LEAVE_CALENDAR` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Module nguồn | LEAVE, HR |

**Mục đích**

Hiển thị lịch nghỉ gần nhất của team/phòng ban/công ty theo quyền.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ lấy leave request Approved hoặc Pending nếu người xem có quyền xử lý.
- Dữ liệu lịch nghỉ phải lọc theo data scope trước khi phân trang/limit.
- Thông tin lý do nghỉ có thể bị ẩn nếu không có quyền xem chi tiết.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "LEAVE_CALENDAR",
    "widget_name": "Lịch nghỉ team/công ty",
    "status": "Active",
    "source_modules": ["LEAVE", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "range.from_date, range.to_date, items.employee, leave_type, date, duration_type, status, department",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.7 GET `/api/v1/dashboard/widgets/notifications` - Thông báo mới

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `NOTIFICATIONS` |
| Required permission | `DASH.WIDGET.VIEW_NOTIFICATIONS` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Module nguồn | NOTI |

**Mục đích**

Hiển thị số thông báo chưa đọc và danh sách thông báo mới nhất của user hiện tại.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ lấy notification của recipient_user_id hiện tại.
- Không trả payload nhạy cảm quá mức; điều hướng sang module gốc để xem chi tiết.
- Mặc định limit 5 hoặc 10.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "NOTIFICATIONS",
    "widget_name": "Thông báo mới",
    "status": "Active",
    "source_modules": ["NOTI"],
    "summary": {},
    "items": [],
    "data_fields": "unread_count, items.notification_id, title, message, source_module, target_url, read_at, created_at",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.8 GET `/api/v1/dashboard/widgets/hr-overview` - Tổng quan nhân sự

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `HR_OVERVIEW` |
| Required permission | `DASH.WIDGET.VIEW_HR_OVERVIEW` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Module nguồn | HR |

**Mục đích**

Hiển thị số lượng nhân sự theo trạng thái, phòng ban, hợp đồng và biến động cơ bản.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trả dữ liệu nhạy cảm từng nhân viên.
- HR scope Department chỉ xem phòng ban được phân quyền.
- Dữ liệu nên lấy từ cache nếu số lượng nhân viên lớn.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "HR_OVERVIEW",
    "widget_name": "Tổng quan nhân sự",
    "status": "Active",
    "source_modules": ["HR"],
    "summary": {},
    "items": [],
    "data_fields": "total_employees, active_count, probation_count, resigned_count, by_department, by_status, trend",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.9 GET `/api/v1/dashboard/widgets/new-employees` - Nhân sự mới

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `NEW_EMPLOYEES` |
| Required permission | `DASH.WIDGET.VIEW_NEW_EMPLOYEES` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Module nguồn | HR |

**Mục đích**

Hiển thị danh sách nhân viên mới trong tháng/kỳ.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Mặc định range là tháng hiện tại theo company timezone.
- Ẩn trường nhạy cảm nếu không có HR.EMPLOYEE.VIEW_SENSITIVE.
- Áp dụng scope trước limit.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "NEW_EMPLOYEES",
    "widget_name": "Nhân sự mới",
    "status": "Active",
    "source_modules": ["HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, items.employee_id, employee_code, full_name, department, position, start_date, employment_status",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.10 GET `/api/v1/dashboard/widgets/contract-expiring` - Hợp đồng sắp hết hạn

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `CONTRACT_EXPIRING` |
| Required permission | `DASH.WIDGET.VIEW_CONTRACT_EXPIRING` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Module nguồn | HR |

**Mục đích**

Hiển thị hợp đồng sắp hết hạn để HR xử lý.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Threshold mặc định 30 ngày, có thể cấu hình.
- Chỉ lấy hợp đồng active/current.
- Không trả lương/hồ sơ nhạy cảm trong widget.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "CONTRACT_EXPIRING",
    "widget_name": "Hợp đồng sắp hết hạn",
    "status": "Active",
    "source_modules": ["HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, threshold_days, items.contract_id, employee, contract_type, end_date, days_left, status",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.11 GET `/api/v1/dashboard/widgets/attendance-alerts` - Bất thường chấm công

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `ATTENDANCE_ALERTS` |
| Required permission | `DASH.WIDGET.VIEW_ATTENDANCE_ALERTS` |
| Allowed roles | Manager, HR, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Module nguồn | ATT, HR |

**Mục đích**

Hiển thị đi muộn, về sớm, thiếu check-out, vắng mặt, remote bất thường theo scope.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Manager chỉ xem nhân viên thuộc team.
- Không hiển thị dữ liệu của nhân viên đã nghỉ ngoài scope.
- Khoảng thời gian mặc định là hôm nay hoặc 7 ngày gần nhất tùy config.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "ATTENDANCE_ALERTS",
    "widget_name": "Bất thường chấm công",
    "status": "Active",
    "source_modules": ["ATT", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.late, early_leave, missing_checkout, absent, items.record_id, employee, work_date, status, anomaly_type",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.12 GET `/api/v1/dashboard/widgets/project-progress` - Tiến độ dự án

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `PROJECT_PROGRESS` |
| Required permission | `DASH.WIDGET.VIEW_PROJECT_PROGRESS` |
| Allowed roles | Employee nếu là member, Manager, HR nếu liên quan, Admin công ty, Super Admin |
| Data scope | Own, Team, Project, Department, Company, System |
| Module nguồn | TASK, HR |

**Mục đích**

Hiển thị tiến độ dự án, task theo trạng thái và cảnh báo dự án chậm.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Project private chỉ hiển thị cho member hoặc người có quyền Company/System.
- Progress tính từ task Done/Total, không tính Cancelled nếu policy loại trừ.
- Widget không cập nhật task, chỉ điều hướng sang TASK.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "PROJECT_PROGRESS",
    "widget_name": "Tiến độ dự án",
    "status": "Active",
    "source_modules": ["TASK", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total_projects, active_projects, delayed_projects, items.project_id, name, progress_percent, task_counts, owner, health_status",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.13 GET `/api/v1/dashboard/widgets/user-summary` - Tổng số user

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `USER_SUMMARY` |
| Required permission | `DASH.WIDGET.VIEW_USER_SUMMARY` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | AUTH |

**Mục đích**

Hiển thị tổng số tài khoản, tài khoản active/locked và user mới.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trả password/session/security secret.
- Chỉ Admin có quyền quản trị user được xem.
- Scope Company chỉ xem user trong công ty hiện tại.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "USER_SUMMARY",
    "widget_name": "Tổng số user",
    "status": "Active",
    "source_modules": ["AUTH"],
    "summary": {},
    "items": [],
    "data_fields": "total_users, active_users, locked_users, new_users, by_role",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.14 GET `/api/v1/dashboard/widgets/employee-summary` - Tổng số nhân viên

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `EMPLOYEE_SUMMARY` |
| Required permission | `DASH.WIDGET.VIEW_EMPLOYEE_SUMMARY` |
| Allowed roles | Admin công ty, HR nếu được cấp, Super Admin |
| Data scope | Company, System |
| Module nguồn | HR |

**Mục đích**

Hiển thị tổng số nhân viên ở mức quản trị.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trả thông tin cá nhân chi tiết.
- Chỉ dùng cho dashboard Admin hoặc HR được cấp quyền.
- Dữ liệu cần nhất quán với HR overview.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "EMPLOYEE_SUMMARY",
    "widget_name": "Tổng số nhân viên",
    "status": "Active",
    "source_modules": ["HR"],
    "summary": {},
    "items": [],
    "data_fields": "total_employees, active, probation, suspended, resigned, by_department",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.15 GET `/api/v1/dashboard/widgets/module-status` - Module đang dùng

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `MODULE_STATUS` |
| Required permission | `DASH.WIDGET.VIEW_MODULE_STATUS` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | FOUNDATION |

**Mục đích**

Hiển thị trạng thái bật/tắt module và tình trạng cấu hình cơ bản.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ trả module thuộc company hoặc global.
- Không expose thông tin hạ tầng nhạy cảm.
- Module disabled không được gợi ý quick action nghiệp vụ.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "MODULE_STATUS",
    "widget_name": "Module đang dùng",
    "status": "Active",
    "source_modules": ["FOUNDATION"],
    "summary": {},
    "items": [],
    "data_fields": "items.module_code, module_name, enabled, setup_status, last_health_status",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.16 GET `/api/v1/dashboard/widgets/config-warnings` - Cảnh báo cấu hình

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `CONFIG_WARNINGS` |
| Required permission | `DASH.WIDGET.VIEW_CONFIG_WARNINGS` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | FOUNDATION, AUTH, HR, ATT, LEAVE, NOTI |

**Mục đích**

Hiển thị các cấu hình thiếu hoặc có nguy cơ làm nghiệp vụ không chạy đúng.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ Admin/Super Admin được xem.
- Không trả secret config.
- Severity gồm Info/Warning/Critical.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "CONFIG_WARNINGS",
    "widget_name": "Cảnh báo cấu hình",
    "status": "Active",
    "source_modules": ["FOUNDATION", "AUTH", "HR", "ATT", "LEAVE", "NOTI"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, severity_counts, items.warning_code, severity, module_code, message, target_url",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.17 GET `/api/v1/dashboard/widgets/new-users` - Tài khoản mới

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `NEW_USERS` |
| Required permission | `DASH.WIDGET.VIEW_NEW_USERS` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | AUTH, HR |

**Mục đích**

Hiển thị tài khoản mới tạo trong kỳ để Admin kiểm soát.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trả password hash/token.
- Mặc định range tháng hiện tại.
- Chỉ user có AUTH.USER.VIEW hoặc quyền dashboard tương ứng mới xem được.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "NEW_USERS",
    "widget_name": "Tài khoản mới",
    "status": "Active",
    "source_modules": ["AUTH", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, items.user_id, email, display_name, status, roles, created_at, linked_employee",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.18 GET `/api/v1/dashboard/widgets/system-logs` - Log quan trọng gần đây

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `SYSTEM_LOGS` |
| Required permission | `DASH.WIDGET.VIEW_SYSTEM_LOGS` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | FOUNDATION/AUDIT |

**Mục đích**

Hiển thị audit/security log quan trọng gần đây.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trả old_value/new_value nhạy cảm trong widget.
- Chỉ hiển thị log thuộc company hiện tại.
- Log chi tiết phải mở qua API audit có quyền riêng.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "SYSTEM_LOGS",
    "widget_name": "Log quan trọng gần đây",
    "status": "Active",
    "source_modules": ["FOUNDATION/AUDIT"],
    "summary": {},
    "items": [],
    "data_fields": "items.audit_log_id, module_code, action, target_type, actor, severity, created_at",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Có thể ghi audit log nếu widget chứa dữ liệu quản trị hoặc dữ liệu nhạy cảm theo cấu hình công ty.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.19 GET `/api/v1/dashboard/widgets/system-notifications` - Thông báo hệ thống

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `SYSTEM_NOTIFICATIONS` |
| Required permission | `DASH.WIDGET.VIEW_SYSTEM_NOTIFICATIONS` |
| Allowed roles | Admin công ty, Super Admin |
| Data scope | Company, System |
| Module nguồn | NOTI, FOUNDATION |

**Mục đích**

Hiển thị thông báo hệ thống dành cho quản trị viên.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Không trộn với notification cá nhân thông thường nếu dashboard Admin đang ở scope hệ thống.
- Chỉ lấy event thuộc nhóm system/admin.
- Nếu module NOTI disabled, trả degraded empty state.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "SYSTEM_NOTIFICATIONS",
    "widget_name": "Thông báo hệ thống",
    "status": "Active",
    "source_modules": ["NOTI", "FOUNDATION"],
    "summary": {},
    "items": [],
    "data_fields": "items.notification_id, title, message, severity, source_module, created_at, read_at",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.20 GET `/api/v1/dashboard/widgets/latest-leave` - Đơn nghỉ gần nhất

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `LATEST_LEAVE` |
| Required permission | `DASH.WIDGET.VIEW_LATEST_LEAVE` |
| Allowed roles | Employee, Manager, HR, Admin công ty, Super Admin |
| Data scope | Own |
| Module nguồn | LEAVE |

**Mục đích**

Hiển thị đơn nghỉ gần nhất của employee hiện tại.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Chỉ lấy đơn nghỉ của chính employee hiện tại trong widget cá nhân.
- Nếu chưa có đơn nghỉ, trả empty state kèm quick action tạo đơn.
- Không trả lý do nghỉ nếu policy ẩn lý do trên dashboard.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "LATEST_LEAVE",
    "widget_name": "Đơn nghỉ gần nhất",
    "status": "Active",
    "source_modules": ["LEAVE"],
    "summary": {},
    "items": [],
    "data_fields": "request_id, request_code, leave_type, status, from_date, to_date, total_days, submitted_at, latest_action_at",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.21 GET `/api/v1/dashboard/widgets/team-tasks-today` - Task team hôm nay

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `TEAM_TASKS_TODAY` |
| Required permission | `DASH.WIDGET.VIEW_TEAM_TASKS_TODAY` |
| Allowed roles | Manager, HR nếu được cấp, Admin công ty, Super Admin |
| Data scope | Team, Department, Company, System |
| Module nguồn | TASK, HR |

**Mục đích**

Hiển thị task của team cần xử lý trong ngày.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Manager scope Team dựa vào direct_manager_id hoặc cấu hình team.
- Không lấy task private ngoài phạm vi project.
- Limit mặc định 10-20 item.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "TEAM_TASKS_TODAY",
    "widget_name": "Task team hôm nay",
    "status": "Active",
    "source_modules": ["TASK", "HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, todo, in_progress, done, overdue, items.task_id, title, assignee, status, due_at, priority",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

### 12.22 GET `/api/v1/dashboard/widgets/probation-ending` - Sắp hết thử việc

| Thuộc tính | Nội dung |
| --- | --- |
| Widget code | `PROBATION_ENDING` |
| Required permission | `DASH.WIDGET.VIEW_PROBATION_ENDING` |
| Allowed roles | HR, Admin công ty, Super Admin |
| Data scope | Department, Company, System |
| Module nguồn | HR |

**Mục đích**

Hiển thị nhân viên sắp hết thử việc.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `period` | string | Không | today/current_week/current_month/custom, tùy widget. |
| `from_date` | date | Không | Ngày bắt đầu nếu period=custom. |
| `to_date` | date | Không | Ngày kết thúc nếu period=custom. |
| `limit` | integer | Không | Số item tối đa. |
| `refresh` | boolean | Không | Bỏ qua cache nếu được phép. |

**Business validation**

- Threshold mặc định 7 hoặc 14 ngày tùy company setting.
- Chỉ lấy employee trạng thái Probation.
- Không trả dữ liệu nhạy cảm ngoài danh tính công việc cơ bản.

**Success response - cấu trúc dữ liệu chính**

```json
{
  "success": true,
  "message": "Lấy widget thành công",
  "data": {
    "widget_code": "PROBATION_ENDING",
    "widget_name": "Sắp hết thử việc",
    "status": "Active",
    "source_modules": ["HR"],
    "summary": {},
    "items": [],
    "data_fields": "summary.total, threshold_days, items.employee_id, employee_code, full_name, department, position, probation_end_date, days_left",
    "quick_actions": [],
    "last_updated_at": "2026-06-20T10:00:00+07:00"
  }
}
```

**Audit log**

Không bắt buộc ghi audit log khi chỉ xem dữ liệu summary thông thường.

**Notification event**

Không phát event notification. Event nghiệp vụ do module nguồn phát sinh.

---

## 13. Dashboard Config API chi tiết

Dashboard config cho phép Admin cấu hình widget theo `company_id`, `dashboard_type`, `role_id`, `user_id`, `widget_code`, thứ tự, kích thước, trạng thái bật/tắt và config hiển thị. Backend cần ưu tiên cấu hình theo thứ tự: user-specific > role-specific > company default > global default.

### 13.1 GET `/api/v1/dashboard/configs` - Lấy danh sách cấu hình dashboard/widget

**Mục đích**

Lấy danh sách cấu hình widget theo dashboard type, role, user hoặc widget.

**Required permission**

`DASH.CONFIG.VIEW`

**Allowed roles**

Admin công ty, Super Admin hoặc role được cấp quyền cấu hình

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

| Param | Kiểu | Bắt buộc | Mô tả |
| --- | --- | --- | --- |
| `dashboard_type` | string | Không | Employee/Manager/HR/Admin. |
| `role_id` | uuid | Không | Lọc cấu hình theo role. |
| `user_id` | uuid | Không | Lọc cấu hình cá nhân. |
| `widget_code` | string | Không | Lọc theo widget. |
| `status` | string | Không | Active/Inactive. |

**Business validation**

- Chỉ Admin có scope phù hợp được xem config role/user.
- User scope Company không được xem config công ty khác.

**Success response**

```json
{
  "success": true,
  "message": "Lấy cấu hình thành công",
  "data": [
    {
      "id": "config-id",
      "dashboard_type": "Employee",
      "widget_code": "MY_TASKS",
      "target_type": "Role",
      "target_role_id": "role-id",
      "enabled": true,
      "order_index": 2,
      "size": "medium",
      "config": {
        "limit": 5,
        "show_quick_actions": true
      }
    }
  ]
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Ghi audit log nếu truy vấn config nhạy cảm được bật trong setting; mặc định không bắt buộc cho GET list.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 13.2 POST `/api/v1/dashboard/configs` - Tạo cấu hình widget

**Mục đích**

Tạo cấu hình widget mới cho company/role/user/dashboard type.

**Required permission**

`DASH.CONFIG.UPDATE`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Request body**

```json
{
  "dashboard_type": "Employee",
  "widget_code": "MY_TASKS",
  "target_type": "Role",
  "target_role_id": "role-id",
  "enabled": true,
  "order_index": 2,
  "size": "medium",
  "config": {
    "limit": 5,
    "show_quick_actions": true
  }
}
```

**Business validation**

- `dashboard_type` phải hợp lệ.
- `widget_code` phải tồn tại và active trong dashboard_widgets.
- Không được tạo trùng config cùng target_type + target_id + dashboard_type + widget_code.
- Nếu target_type=User thì user phải thuộc cùng company.
- Nếu target_type=Role thì role phải thuộc cùng company hoặc role global được cho phép.

**Success response**

```json
{
  "success": true,
  "message": "Tạo cấu hình widget thành công",
  "data": {
    "id": "config-id",
    "dashboard_type": "Employee",
    "widget_code": "MY_TASKS",
    "enabled": true
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Bắt buộc ghi audit log `DASH.CONFIG.CREATE`.

**Notification event**

Có thể phát event `DASH_CONFIG_UPDATED` để invalidate cache dashboard liên quan.

**Idempotency**

Khuyến nghị hỗ trợ `Idempotency-Key` để tránh tạo trùng config khi client retry.

---

### 13.3 GET `/api/v1/dashboard/configs/{config_id}` - Xem chi tiết cấu hình widget

**Mục đích**

Xem chi tiết một cấu hình widget.

**Required permission**

`DASH.CONFIG.VIEW`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Business validation**

- Config phải thuộc company hiện tại hoặc global mà user được phép xem.

**Success response**

```json
{
  "success": true,
  "message": "Lấy chi tiết cấu hình thành công",
  "data": {
    "id": "config-id",
    "dashboard_type": "Employee",
    "widget_code": "MY_TASKS",
    "enabled": true,
    "config": {}
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Không bắt buộc, trừ khi xem dữ liệu nhạy cảm hoặc cấu hình bật log analytics.

**Notification event**

Không phát event notification.

**Idempotency**

Không yêu cầu.

---

### 13.4 PATCH `/api/v1/dashboard/configs/{config_id}` - Cập nhật cấu hình widget

**Mục đích**

Cập nhật trạng thái bật/tắt, layout, thứ tự, kích thước hoặc config riêng của widget.

**Required permission**

`DASH.CONFIG.UPDATE`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Request body**

```json
{
  "enabled": true,
  "order_index": 3,
  "size": "large",
  "config": {
    "limit": 10,
    "show_quick_actions": false
  }
}
```

**Business validation**

- Config phải tồn tại và thuộc scope được phép.
- Không cho update widget_code nếu policy không cho đổi resource của config.
- `order_index` không được âm.
- `size` phải thuộc enum `small`, `medium`, `large`, `full`.
- Sau update phải invalidate cache dashboard liên quan.

**Success response**

```json
{
  "success": true,
  "message": "Cập nhật cấu hình widget thành công",
  "data": {
    "id": "config-id",
    "enabled": true,
    "order_index": 3,
    "size": "large"
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Bắt buộc ghi audit log `DASH.CONFIG.UPDATE` với old_value/new_value.

**Notification event**

Phát event nội bộ `DASH_CONFIG_UPDATED` để invalidate cache.

**Idempotency**

Không bắt buộc nhưng có thể dùng optimistic locking `version`.

---

### 13.5 DELETE `/api/v1/dashboard/configs/{config_id}` - Xóa mềm/vô hiệu hóa cấu hình widget

**Mục đích**

Xóa mềm hoặc vô hiệu hóa config, để hệ thống fallback về config mặc định cấp dưới.

**Required permission**

`DASH.CONFIG.UPDATE`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Business validation**

- Không được xóa config global seed bắt buộc nếu không có scope System.
- Config phải thuộc scope được phép.
- Sau delete phải invalidate cache dashboard liên quan.

**Success response**

```json
{
  "success": true,
  "message": "Xóa cấu hình widget thành công",
  "data": null
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Bắt buộc ghi audit log `DASH.CONFIG.DELETE`.

**Notification event**

Phát event nội bộ `DASH_CONFIG_UPDATED`.

**Idempotency**

Không yêu cầu.

---

### 13.6 POST `/api/v1/dashboard/configs/reset-default` - Khôi phục cấu hình mặc định

**Mục đích**

Reset cấu hình dashboard theo target về mặc định seed.

**Required permission**

`DASH.CONFIG.UPDATE`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Request body**

```json
{
  "dashboard_type": "Employee",
  "target_type": "Role",
  "target_role_id": "role-id"
}
```

**Business validation**

- Target phải thuộc scope được phép.
- Nếu reset user-specific, backend chỉ xóa hoặc disable config cá nhân, không sửa global default.
- Sau reset phải invalidate cache.

**Success response**

```json
{
  "success": true,
  "message": "Khôi phục cấu hình mặc định thành công",
  "data": {
    "dashboard_type": "Employee",
    "reset_count": 6
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Bắt buộc ghi audit log `DASH.CONFIG.RESET_DEFAULT`.

**Notification event**

Phát event nội bộ `DASH_CONFIG_UPDATED`.

**Idempotency**

Khuyến nghị hỗ trợ `Idempotency-Key`.

---

### 13.7 POST `/api/v1/dashboard/configs/reorder` - Cập nhật thứ tự widget

**Mục đích**

Cập nhật thứ tự hiển thị nhiều widget trong một dashboard.

**Required permission**

`DASH.CONFIG.UPDATE`

**Allowed roles**

Admin công ty, Super Admin

**Data scope**

Company hoặc System

**Authentication**

Bắt buộc `Authorization: Bearer <access_token>`.

**Query params**

Không có hoặc dùng query params chung trong mục 9.

**Request body**

```json
{
  "dashboard_type": "Manager",
  "target_type": "Role",
  "target_role_id": "role-id",
  "items": [
    { "widget_code": "PENDING_LEAVE", "order_index": 1 },
    { "widget_code": "TEAM_TASKS_TODAY", "order_index": 2 }
  ]
}
```

**Business validation**

- Không được truyền widget_code không tồn tại.
- Không được có order_index trùng nếu policy yêu cầu unique.
- Tất cả widget phải thuộc cùng dashboard_type/target.

**Success response**

```json
{
  "success": true,
  "message": "Cập nhật thứ tự widget thành công",
  "data": {
    "updated_count": 2
  }
}
```

**Error responses**

| HTTP | Error code | Trường hợp |
| --- | --- | --- |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Thiếu hoặc sai access token |
| 403 | `DASH-ERR-FORBIDDEN` | Không có permission hoặc data scope phù hợp |
| 404 | `DASH-ERR-NOT_FOUND` | Dashboard/widget/config không tồn tại hoặc ngoài company |
| 422 | `DASH-ERR-VALIDATION` | Query/body không hợp lệ |
| 500 | `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | Module nguồn hoặc cache service lỗi |

**Audit log**

Bắt buộc ghi audit log `DASH.CONFIG.REORDER`.

**Notification event**

Phát event nội bộ `DASH_CONFIG_UPDATED`.

**Idempotency**

Khuyến nghị hỗ trợ `Idempotency-Key`.

---

## 14. Internal Dashboard Cache API

Các API nội bộ chỉ được gọi bởi backend service, job hoặc event handler. Authentication dùng internal service token hoặc mTLS tùy kiến trúc. Frontend/mobile không được gọi trực tiếp.

### 14.1 POST `/internal/v1/dashboard/cache/invalidate` - Invalidate cache theo event/module/entity

**Authentication**: Internal service token.

**Mục đích**

Invalidate cache theo event/module/entity.

**Request body gợi ý**

```json
{
  "company_id": "company-id",
  "source_module": "TASK",
  "event_code": "TASK_UPDATED",
  "entity_type": "Task",
  "entity_id": "task-id",
  "affected_user_ids": ["user-id"],
  "affected_employee_ids": ["employee-id"],
  "cache_keys": [],
  "reason": "Source module data changed"
}
```

**Business validation**

- Request phải đến từ service nội bộ được cấp quyền.
- `company_id` phải hợp lệ nếu event là company-specific.
- Không tin payload từ frontend; endpoint không public.
- Nếu không xác định được cache key cụ thể, backend có thể invalidate theo pattern an toàn.

**Success response**

```json
{
  "success": true,
  "message": "Xử lý cache dashboard thành công",
  "data": {
    "invalidated_count": 12,
    "refreshed_count": 0
  }
}
```

---

### 14.2 POST `/internal/v1/dashboard/cache/refresh` - Refresh cache widget/dashboard

**Authentication**: Internal service token.

**Mục đích**

Refresh cache widget/dashboard.

**Request body gợi ý**

```json
{
  "company_id": "company-id",
  "source_module": "TASK",
  "event_code": "TASK_UPDATED",
  "entity_type": "Task",
  "entity_id": "task-id",
  "affected_user_ids": ["user-id"],
  "affected_employee_ids": ["employee-id"],
  "cache_keys": [],
  "reason": "Source module data changed"
}
```

**Business validation**

- Request phải đến từ service nội bộ được cấp quyền.
- `company_id` phải hợp lệ nếu event là company-specific.
- Không tin payload từ frontend; endpoint không public.
- Nếu không xác định được cache key cụ thể, backend có thể invalidate theo pattern an toàn.

**Success response**

```json
{
  "success": true,
  "message": "Xử lý cache dashboard thành công",
  "data": {
    "invalidated_count": 12,
    "refreshed_count": 0
  }
}
```

---

### 14.3 POST `/internal/v1/dashboard/events/module-updated` - Nhận event module source thay đổi

**Authentication**: Internal service token.

**Mục đích**

Nhận event module source thay đổi.

**Request body gợi ý**

```json
{
  "company_id": "company-id",
  "source_module": "TASK",
  "event_code": "TASK_UPDATED",
  "entity_type": "Task",
  "entity_id": "task-id",
  "affected_user_ids": ["user-id"],
  "affected_employee_ids": ["employee-id"],
  "cache_keys": [],
  "reason": "Source module data changed"
}
```

**Business validation**

- Request phải đến từ service nội bộ được cấp quyền.
- `company_id` phải hợp lệ nếu event là company-specific.
- Không tin payload từ frontend; endpoint không public.
- Nếu không xác định được cache key cụ thể, backend có thể invalidate theo pattern an toàn.

**Success response**

```json
{
  "success": true,
  "message": "Xử lý cache dashboard thành công",
  "data": {
    "invalidated_count": 12,
    "refreshed_count": 0
  }
}
```

---

### 14.4 POST `/internal/v1/dashboard/jobs/warmup-cache` - Job warm up cache dashboard

**Authentication**: Internal service token.

**Mục đích**

Job warm up cache dashboard.

**Request body gợi ý**

```json
{
  "company_id": "company-id",
  "source_module": "TASK",
  "event_code": "TASK_UPDATED",
  "entity_type": "Task",
  "entity_id": "task-id",
  "affected_user_ids": ["user-id"],
  "affected_employee_ids": ["employee-id"],
  "cache_keys": [],
  "reason": "Source module data changed"
}
```

**Business validation**

- Request phải đến từ service nội bộ được cấp quyền.
- `company_id` phải hợp lệ nếu event là company-specific.
- Không tin payload từ frontend; endpoint không public.
- Nếu không xác định được cache key cụ thể, backend có thể invalidate theo pattern an toàn.

**Success response**

```json
{
  "success": true,
  "message": "Xử lý cache dashboard thành công",
  "data": {
    "invalidated_count": 12,
    "refreshed_count": 0
  }
}
```

---

## 15. Notification event liên quan DASH

DASH chủ yếu tiêu thụ dữ liệu từ NOTI. Trong MVP, DASH không nên phát nhiều thông báo riêng để tránh nhiễu. Các event DASH nếu có chủ yếu phục vụ quản trị hoặc cảnh báo lỗi widget.

| Event code | Khi nào phát | Người nhận | Ghi chú |
| --- | --- | --- | --- |
| `DASH_CONFIG_UPDATED` | Admin cập nhật cấu hình dashboard/widget | Admin/role liên quan nếu bật thông báo | Có thể chỉ audit log trong MVP. |
| `DASH_WIDGET_ERROR_REPEATED` | Widget lỗi nhiều lần liên tiếp | Admin hệ thống | Có thể phát nếu lỗi ảnh hưởng nhiều user. |
| `DASH_ROLE_NOT_RESOLVED` | User không xác định được dashboard do thiếu role/permission | Admin | Có thể giúp Admin cấu hình user. |
| `DASH_CACHE_REFRESH_FAILED` | Job refresh cache lỗi | Admin kỹ thuật/Super Admin | Có thể chỉ ghi system log ở MVP. |

Payload notification không được chứa dữ liệu nhạy cảm; chỉ chứa mã event, module, target_url và thông tin summary an toàn.

---

## 16. Audit log

### 16.1 Hành động bắt buộc ghi audit log

| Action | Target type | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `DASH.CONFIG.CREATE` | DashboardWidgetConfig | Có | Tạo cấu hình widget. |
| `DASH.CONFIG.UPDATE` | DashboardWidgetConfig | Có | Cập nhật bật/tắt/layout/config. |
| `DASH.CONFIG.DELETE` | DashboardWidgetConfig | Có | Xóa mềm/vô hiệu hóa config. |
| `DASH.CONFIG.RESET_DEFAULT` | DashboardConfig | Có | Reset về mặc định. |
| `DASH.CONFIG.REORDER` | DashboardWidgetConfig | Có | Cập nhật thứ tự widget. |
| `DASH.WIDGET.VIEW_SENSITIVE` | DashboardWidget | Tùy setting | Widget HR/system log/contract có thể cần log. |
| `DASH.CACHE.REFRESH` | DashboardWidgetCache | Không bắt buộc | Có thể ghi system log thay audit log. |
| `DASH.EXPORT` | DashboardExport | Phase sau | Nếu triển khai export dashboard. |

### 16.2 Audit payload tối thiểu

```json
{
  "module": "DASH",
  "action": "DASH.CONFIG.UPDATE",
  "target_type": "DashboardWidgetConfig",
  "target_id": "config-id",
  "old_value": {
    "enabled": true,
    "order_index": 2
  },
  "new_value": {
    "enabled": false,
    "order_index": 2
  },
  "metadata": {
    "dashboard_type": "Manager",
    "widget_code": "PENDING_LEAVE"
  }
}
```

Không ghi dữ liệu nhạy cảm nguyên bản vào audit log. Nếu cần ghi diff, phải mask hoặc chỉ ghi field thay đổi.

---

## 17. Error code chuẩn cho DASH

| Error code | HTTP | Trường hợp | Message đề xuất |
| --- | --- | --- | --- |
| `DASH-ERR-FORBIDDEN_DASHBOARD` | 403 | Không có quyền xem dashboard | Bạn không có quyền xem dashboard này |
| `DASH-ERR-FORBIDDEN_WIDGET` | 403 | Không có quyền xem widget | Bạn không có quyền xem widget này |
| `DASH-ERR-DASHBOARD_NOT_RESOLVED` | 422 | Không xác định được dashboard phù hợp | Không xác định được dashboard phù hợp với tài khoản của bạn |
| `DASH-ERR-INVALID_ROLE` | 422 | User chưa có role hợp lệ | Tài khoản của bạn chưa được gán vai trò phù hợp |
| `DASH-ERR-WIDGET_LOAD_FAILED` | 500 | Không lấy được dữ liệu widget | Không thể tải dữ liệu widget |
| `DASH-ERR-WIDGET_NOT_FOUND` | 404 | Widget không tồn tại | Widget không tồn tại |
| `DASH-ERR-CONFIG_INVALID` | 422 | Cấu hình widget không hợp lệ | Cấu hình widget không hợp lệ |
| `DASH-ERR-CONFIG_NOT_FOUND` | 404 | Không tìm thấy config | Cấu hình dashboard không tồn tại |
| `DASH-ERR-EMPLOYEE_NOT_LINKED` | 422 | User chưa có employee liên kết | Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên |
| `DASH-ERR-DATA_SCOPE_INVALID` | 403 | Data scope không hợp lệ | Phạm vi dữ liệu không hợp lệ |
| `DASH-ERR-SOURCE_MODULE_UNAVAILABLE` | 503 | Module nguồn không khả dụng | Module nguồn hiện không khả dụng |
| `DASH-ERR-CACHE_UNAVAILABLE` | 503 | Cache service lỗi | Không thể đọc cache dashboard |
| `DASH-ERR-DUPLICATE_CONFIG` | 409 | Cấu hình trùng | Cấu hình widget đã tồn tại |
| `DASH-ERR-INVALID_WIDGET_CODE` | 422 | Widget code không hợp lệ | Mã widget không hợp lệ |
| `DASH-ERR-INVALID_DASHBOARD_TYPE` | 422 | Dashboard type không hợp lệ | Loại dashboard không hợp lệ |
| `DASH-ERR-VALIDATION` | 422 | Validation error | Dữ liệu gửi lên không hợp lệ |

---

## 18. Business validation tổng hợp

### 18.1 Dashboard

- User phải active, company active và access token hợp lệ.
- User phải có permission `DASH.DASHBOARD.VIEW`.
- Dashboard type chỉ được trả nếu user có permission tương ứng.
- Nếu user có nhiều role, backend resolve dashboard mặc định theo cấu hình hoặc thứ tự ưu tiên.
- Không có dashboard hợp lệ thì trả `DASH-ERR-DASHBOARD_NOT_RESOLVED`.

### 18.2 Widget

- Widget phải tồn tại trong catalog và đang active.
- User phải có permission widget tương ứng.
- Widget phải áp dụng data scope riêng, không lấy scope từ frontend.
- Widget nhạy cảm cần kiểm tra thêm permission module nguồn.
- Widget lỗi không được làm hỏng toàn bộ dashboard tổng hợp.
- Empty state phải trả rõ ràng, không trả lỗi khi nghiệp vụ không có dữ liệu.

### 18.3 Config

- Chỉ role có `DASH.CONFIG.UPDATE` mới được tạo/sửa/xóa config.
- Không được tạo trùng config cho cùng target + dashboard_type + widget_code.
- Target role/user phải thuộc company hiện tại hoặc là global role hợp lệ.
- Config update phải invalidate cache dashboard liên quan.
- Global config chỉ Super Admin hoặc migration/seed service được sửa.

### 18.4 Cache

- Cache key phải bao gồm company_id, dashboard_type, widget_code, user/role/scope và filter quan trọng.
- Không dùng cache của user này cho user khác nếu dữ liệu phụ thuộc Own/Team.
- Cache chứa dữ liệu nhạy cảm phải có TTL ngắn và không lưu ngoài vùng bảo mật.
- Khi module nguồn phát event quan trọng, cache liên quan phải bị invalidate.

---

## 19. Tích hợp với module khác

### 19.1 AUTH

DASH dùng AUTH để xác định user, roles, permissions, data scope, company và trạng thái tài khoản. DASH không tin role/permission do frontend truyền lên.

### 19.2 HR

DASH dùng HR để map user -> employee, xác định phòng ban, quản lý trực tiếp, danh sách nhân viên thuộc team, nhân sự mới, hợp đồng sắp hết hạn và sắp hết thử việc.

### 19.3 ATT

DASH dùng ATT để lấy trạng thái chấm công hôm nay, bất thường chấm công, thiếu checkout, vắng mặt, remote và auto attendance summary. Nút check-in/check-out trên dashboard phải gọi API ATT.

### 19.4 LEAVE

DASH dùng LEAVE để lấy số dư phép, đơn nghỉ gần nhất, đơn chờ duyệt và lịch nghỉ. Hành động duyệt/từ chối đơn nghỉ phải gọi API LEAVE.

### 19.5 TASK

DASH dùng TASK để lấy task cá nhân, task team, task quá hạn/sắp đến hạn và tiến độ dự án. Hành động cập nhật task phải gọi API TASK.

### 19.6 NOTI

DASH dùng NOTI để lấy unread count, notification mới và system notification. Đánh dấu đã đọc phải gọi API NOTI, không xử lý trong DASH trừ khi có proxy endpoint được thiết kế riêng.

### 19.7 FOUNDATION

DASH dùng Foundation để lấy module status, system/company settings, audit log, cache invalidation metadata và company timezone.

---

## 20. Query pattern và hiệu năng

### 20.1 Load dashboard tổng hợp

```text
1. Resolve auth context: user_id, company_id, roles, permissions, data scopes.
2. Resolve dashboard_type nếu endpoint /me.
3. Load widget config theo user/role/company/global.
4. Filter widget theo permission và source module availability.
5. Với mỗi widget:
   - Tạo cache key.
   - Nếu cache hợp lệ -> trả cache.
   - Nếu cache miss -> query module source/service.
   - Normalize response về widget DTO.
6. Trả dashboard response gồm widget thành công, empty, degraded/error.
```

### 20.2 Cache key gợi ý

```text
dashboard:{company_id}:{dashboard_type}:{target_type}:{target_id}:{widget_code}:{scope_hash}:{filter_hash}:v1
```

Ví dụ:

```text
dashboard:company-001:Manager:User:user-001:PENDING_LEAVE:team-employee-hash:period-current-month:v1
```

### 20.3 Tránh N+1 query

- Batch load employee summary cho nhiều widget trong một request.
- Không gọi HR từng employee khi hiển thị task/leave list; dùng projection hoặc join service.
- Widget list chỉ trả các field cần thiết, không trả full entity.
- Dashboard tổng hợp có thể chạy song song các widget độc lập nhưng phải giới hạn concurrency.
- Dùng cache cho widget aggregate nặng như HR overview, attendance alerts, project progress.

### 20.4 Index/query cần chú ý

| Nhóm dữ liệu | Query pattern | Ghi chú index |
| --- | --- | --- |
| Config | company_id + dashboard_type + role_id/user_id + widget_code | Index trên dashboard_widget_configs |
| Cache | company_id + cache_key + expires_at | Unique cache_key, index expires_at |
| Notification | company_id + recipient_user_id + read_at + created_at | Unread count/dropdown |
| Attendance | company_id + employee_id/work_date/status | Today status và alerts |
| Leave | company_id + approver/team/status/submitted_at | Pending leave |
| Task | company_id + assignee/status/due_at | My tasks và alerts |
| HR | company_id + employment_status + department_id | HR overview/new employees |

---

## 21. Security checklist

- Tất cả endpoint public yêu cầu access token.
- Backend kiểm tra permission và data scope, không phụ thuộc frontend.
- Không nhận `company_id` từ body/query cho nghiệp vụ thông thường.
- Không expose dữ liệu nhạy cảm trên dashboard nếu thiếu permission nguồn.
- Không trả old_value/new_value audit chi tiết trong widget system logs.
- Không dùng cache Own/Team chung cho nhiều user nếu dữ liệu khác nhau.
- Internal endpoints phải có service authentication riêng.
- Rate limit endpoint dashboard tổng hợp để tránh spam refresh.
- Không trả stack trace khi widget source module lỗi.
- Mask email/phone/identity/bank/salary nếu xuất hiện trong dữ liệu nguồn.

---

## 22. Test case API gợi ý

### 22.1 Permission test

- Employee không xem được Admin Dashboard.
- Manager chỉ xem pending leave thuộc team.
- HR có scope Department không xem được HR overview toàn công ty.
- User thiếu permission widget không nhận widget trong `/dashboard/me`.
- Admin thiếu permission source `FOUNDATION.AUDIT_LOG.VIEW` không xem được system logs widget.

### 22.2 Data scope test

- Task team hôm nay chỉ gồm nhân viên thuộc team manager.
- Leave calendar Company chỉ dành cho HR/Admin có scope Company.
- Notification widget chỉ trả notification của recipient_user_id hiện tại.
- Project progress private chỉ trả cho project member hoặc role có scope phù hợp.
- Super Admin scope System xem được dashboard công ty khác qua cơ chế riêng nếu được thiết kế.

### 22.3 Business workflow test

- Sau khi check-in ở ATT, widget attendance today đổi trạng thái sau cache invalidation.
- Sau khi task đổi assignee, widget my tasks của assignee mới được cập nhật.
- Sau khi leave request submitted, widget pending leave của manager tăng count.
- Sau khi HR cập nhật contract end date, widget contract expiring cập nhật sau TTL/invalidation.
- Sau khi config widget disabled, dashboard không trả widget đó hoặc trả hidden theo query.

### 22.4 Error/fallback test

- ATT service lỗi -> chỉ widget attendance degraded, dashboard tổng vẫn success.
- Cache service lỗi -> backend query source nếu có thể hoặc trả degraded.
- Widget code không tồn tại -> 404.
- Config trùng -> 409.
- Dashboard type không hợp lệ -> 422.

### 22.5 Performance test

- Dashboard `/me` phản hồi nhanh với 5-8 widget phổ biến.
- Unread notification count không scan toàn bảng notifications.
- HR overview dùng cache hoặc query aggregate tối ưu.
- Không phát sinh N+1 query khi widget task/leave trả employee summary.
- Refresh dashboard liên tục bị rate limit phù hợp.

---

## 23. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/dash.paths.yaml`](openapi/paths/dash.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 23.1 Security

`bearerAuth` (HTTP bearer JWT) cho `/api/v1/dashboard/*`; cache/event nội bộ `/internal/v1/dashboard/*` dùng `internalServiceAuth`.

### 23.2 Tags của module

- `Dashboard` — dashboard tổng hợp (me/types/widgets/employee/manager/hr/admin/summary)
- `Dashboard - Widgets` — 22 widget riêng lẻ
- `Dashboard - Configs` — cấu hình widget
- `Dashboard - Internal` — cache invalidate/refresh/event/warmup

### 23.3 Vendor extensions (đồng nhất toàn hệ thống)

| Extension | Giá trị | Ý nghĩa |
| --------- | ------- | ------- |
| `x-required-permission` | `string` \| `string[]` \| `null` | permission bắt buộc (`null` = Public/Authenticated/Internal) |
| `x-permission-mode` | `allOf` \| `anyOf` | cách kết hợp khi là mảng (mặc định `allOf`) |
| `x-allowed-roles` | `string[]` | role gợi ý (không enforce; DASH dùng permission + dashboard_type + widget_code) |
| `x-data-scope` | `string[]` | Own/Team/Department/Project/Company/System |
| `x-idempotency` | `Required` \| `Optional` \| `No` | header `Idempotency-Key` |
| `x-audit-log` | `always` \| `conditional` \| `none` | mức ghi audit |
| `x-notification-event` | `string` \| `null` | event phát ra |

operationId prefix: `dash`.

### 23.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`, `IfMatch`.

### 23.5 DTO đề xuất cho module

`DashboardResponseDto`, `DashboardTypeDto`, `DashboardWidgetDto`, `WidgetLayoutDto`, `WidgetCacheDto`, `WidgetErrorStateDto`, `QuickActionDto`, `DashboardConfigDto`, `CreateDashboardConfigRequest`, `UpdateDashboardConfigRequest`, `DashboardSummaryDto`, `DashboardErrorResponse`.

---

## 24. Quyết định thiết kế đã chốt

1. DASH chỉ tổng hợp, hiển thị và điều hướng; không xử lý nghiệp vụ gốc.
2. Mọi widget phải kiểm tra permission và data scope ở backend.
3. Dữ liệu dashboard phải multi-tenant ready và không tin `company_id` từ frontend.
4. Widget lỗi không làm toàn bộ dashboard lỗi; response hỗ trợ `Error`/`Degraded` per widget.
5. Cache dashboard có TTL và invalidation theo event module nguồn.
6. Config widget ưu tiên user-specific > role-specific > company default > global default.
7. Quick action trên dashboard chỉ là metadata điều hướng hoặc gọi module gốc.
8. Dữ liệu nhạy cảm không hiển thị trên dashboard nếu thiếu permission nguồn.
9. Internal cache API không public cho frontend/mobile.
10. Audit log bắt buộc cho thay đổi cấu hình dashboard/widget.

---

## 25. Kết luận

API-08 định nghĩa đầy đủ chuẩn API cho module DASH trong MVP. Module này đóng vai trò lớp tổng hợp trải nghiệm sau đăng nhập, giúp Employee, Manager, HR và Admin xem nhanh dữ liệu quan trọng từ HR, ATT, LEAVE, TASK, NOTI và FOUNDATION.

Thiết kế API cần đặc biệt tuân thủ 4 nguyên tắc:

- Backend luôn kiểm tra permission và data scope.
- Dashboard không thay thế nghiệp vụ gốc của module nguồn.
- Widget phải có cache/invalidation để đảm bảo hiệu năng.
- Dữ liệu nhạy cảm phải được kiểm soát và mask theo quyền.

Sau API-08, bước tiếp theo trong bộ API Design là triển khai **API-09: FOUNDATION API Design** để hoàn thiện các API nền tảng như company, modules, settings, audit logs, files, sequence counters và public holidays.
