# QA-05: PERMISSION, ROLE & DATA SCOPE TESTING
# KIỂM THỬ PHÂN QUYỀN, VAI TRÒ & PHẠM VI DỮ LIỆU
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-05 |
| Tên tài liệu | Permission, Role & Data Scope Testing |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release Readiness - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-04 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

QA-05 định nghĩa chiến lược, ma trận và checklist kiểm thử cho toàn bộ cơ chế **permission**, **role** và **data scope** của hệ thống.

Tài liệu này dùng để đảm bảo:

1. Người dùng chỉ truy cập được đúng module, màn hình, API và dữ liệu được cấp quyền.
2. Backend luôn là lớp kiểm soát quyền cuối cùng, không phụ thuộc vào frontend.
3. Frontend hiển thị app, menu, route, button, field, widget và badge đúng theo permission/data scope.
4. Role chỉ là nhóm quyền được seed/cấu hình, không được hard-code trong backend hoặc frontend.
5. Data scope `Own`, `Team`, `Department`, `Project`, `Company`, `System` được áp dụng chính xác theo từng module.
6. Dữ liệu giữa các company/tenant không bị lộ chéo.
7. Field nhạy cảm được ẩn, mask hoặc không trả về khi người dùng thiếu quyền.
8. Notification deep link, dashboard quick action và direct URL đều phải kiểm tra lại quyền ở module gốc.
9. Thay đổi role/permission được phản ánh đúng sau refresh session hoặc cache invalidation.
10. Các thao tác nhạy cảm như gán role, đổi permission, export, xem log, xem file nhạy cảm đều có kiểm soát và audit log.

---

## 3. Vị trí QA-05 trong roadmap QA

```text
QA-01: QA Strategy & Test Plan
QA-02: Test Case Matrix theo module
QA-03: End-to-End Flow Testing
QA-04: API Testing & Contract Testing
QA-05: Permission, Role & Data Scope Testing
QA-06: Security Testing
QA-07: Performance & Load Testing
QA-08: Bug Tracking, Regression & Release Criteria
QA-09: UAT Plan & Business Acceptance
QA-10: MVP Release Readiness Checklist
```

QA-05 là lớp kiểm thử ngang xuyên module. Kết quả QA-05 phải được dùng làm điều kiện bắt buộc trước khi release MVP vì lỗi phân quyền có thể gây lộ dữ liệu nhân sự, bảng công, nghỉ phép, task, notification hoặc cấu hình hệ thống.

---

## 4. Căn cứ kiểm thử

QA-05 bám theo các quyết định đã chốt:

1. API backend là nguồn kiểm soát quyền cuối cùng.
2. Mỗi API nghiệp vụ phải kiểm tra authentication, user status, company status, permission, data scope, business rule, audit log và notification event nếu có.
3. Backend không phụ thuộc vào state frontend để xác định user, role, company, permission, data scope hoặc employee.
4. AUTH/RBAC dùng các bảng chính: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`.
5. `role_permissions.data_scope` là nơi xác định phạm vi dữ liệu của permission.
6. Một user có thể có nhiều role.
7. Role mặc định MVP gồm `SUPER_ADMIN`, `COMPANY_ADMIN`, `HR`, `MANAGER`, `EMPLOYEE`, `PROJECT_MANAGER`.
8. Permission dùng format `MODULE.RESOURCE.ACTION`.
9. Frontend không hard-code theo role name; phải dùng permission/data scope utility.
10. Frontend guard chỉ hỗ trợ UX; backend vẫn phải chặn API trái quyền.
11. Home Portal, App Switcher, Dashboard và Notification deep link chỉ điều hướng; module gốc phải kiểm tra lại permission/data scope/business rule.
12. Dữ liệu nhạy cảm không được trả về nếu user thiếu quyền, kể cả khi frontend đã mask field.

---

## 5. Phạm vi QA-05

### 5.1 Bao gồm

| Nhóm | Nội dung kiểm thử |
| --- | --- |
| RBAC database | Seed role, seed permission, user_roles, role_permissions, data_scope, inactive/expired role |
| Auth context | `/api/v1/auth/me`, session bootstrap, permission list, scope list, active modules |
| Backend guard | 401, 403, scope filter, tenant isolation, business rule, audit log |
| API permission | Required permission cho API AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION |
| Data scope | Own, Team, Department, Project, Company, System |
| Frontend guard | Route guard, app visibility, sidebar visibility, action visibility, field guard |
| Dashboard scope | Widget theo role/scope, quick action, cache/fallback không lộ dữ liệu |
| Notification scope | Notification list, unread count, target deep link, admin view |
| Field-level permission | Mask/ẩn/không trả field nhạy cảm: thông tin cá nhân, hợp đồng, file, audit, token, storage path |
| Cross-tenant | User company A không truy cập được dữ liệu company B |
| Permission cache | Thay đổi role/permission được cập nhật đúng sau refresh/invalidation/logout-login |
| Negative/bypass | Direct URL, sửa path param, sửa body, query filter vượt scope, replay request, export trái quyền |

### 5.2 Không bao gồm sâu

| Nội dung | Tài liệu xử lý chính |
| --- | --- |
| Penetration test toàn diện | QA-06 Security Testing |
| Load test permission query | QA-07 Performance & Load Testing |
| Test dữ liệu lương/payroll phase sau | QA phase tương ứng PAYROLL |
| SSO/OAuth/MFA nâng cao | Phase sau |
| Role hierarchy phức tạp | Phase sau |
| User permission override cá nhân | Phase sau nếu triển khai |

---

## 6. Nguyên tắc kiểm thử quan trọng

### 6.1 Backend phải chặn được dù frontend bị bypass

Mọi test permission phải có ít nhất một case gọi API trực tiếp bằng Postman/Newman/Playwright API request hoặc test integration backend.

Không được chỉ kiểm tra việc button bị ẩn trên UI.

Ví dụ:

```text
Employee không thấy nút "Duyệt nghỉ" trên UI
-> vẫn phải gọi trực tiếp POST /api/v1/leave/requests/{id}/approve
-> kỳ vọng 403 Forbidden
```

### 6.2 Permission không đồng nghĩa với business rule

User có permission vẫn có thể bị disable action do business rule.

Ví dụ:

| Tình huống | Permission | Business rule | Kỳ vọng |
| --- | --- | --- | --- |
| Employee có quyền check-in | `ATT.ATTENDANCE.CHECK_IN` | Đã có leave full-day Approved | API chặn bằng business error; UI disable nút |
| Manager có quyền approve leave | `LEAVE.REQUEST.APPROVE` | Đơn đã được HR duyệt trước | API chặn state transition sai; UI refresh trạng thái |
| User có quyền update task | `TASK.TASK.UPDATE` | Task đã Cancelled | API chặn update field không hợp lệ |

### 6.3 Role không được hard-code

Không pass test nếu backend hoặc frontend có logic kiểu:

```ts
if (user.role === 'HR') allow();
```

Phải kiểm tra bằng permission/data scope:

```ts
can('HR.EMPLOYEE.UPDATE') && hasScope('HR.EMPLOYEE.UPDATE', 'Company')
```

### 6.4 Data scope phải kiểm tra target data

Không đủ nếu user có permission. Backend phải kiểm tra dữ liệu đích có nằm trong phạm vi không.

Ví dụ:

```text
Manager có HR.EMPLOYEE.VIEW scope Team
-> Xem employee thuộc team: 200 OK
-> Xem employee ngoài team: 403 hoặc 404 theo policy
```

### 6.5 Không tin `company_id`, `employee_id`, `user_id` từ frontend

Với API nghiệp vụ thông thường, backend phải resolve các giá trị này từ auth context hoặc dữ liệu DB.

Nếu request body cố tình gửi `company_id`, `employee_id`, `created_by`, `approved_by`, backend phải bỏ qua hoặc reject theo contract.

---

## 7. Mô hình role, permission và scope cần test

### 7.1 Role MVP

| Role | Mục tiêu nghiệp vụ | Scope mặc định thường gặp |
| --- | --- | --- |
| `SUPER_ADMIN` | Quản trị toàn hệ thống | System |
| `COMPANY_ADMIN` | Quản trị công ty/tenant | Company |
| `HR` | Quản lý nhân sự, bảng công, nghỉ phép theo quyền | Company |
| `MANAGER` | Quản lý team trực tiếp | Team |
| `EMPLOYEE` | Người dùng thường | Own |
| `PROJECT_MANAGER` | Quản lý dự án/task | Project |

> **Ánh xạ với tên vai trò thân thiện dùng ở QA-01/QA-03/QA-09:** `SUPER_ADMIN` = Super Admin · `COMPANY_ADMIN` = Admin · `HR` = HR · `MANAGER` = Manager · `EMPLOYEE` = Employee. `PROJECT_MANAGER` là vai trò theo project (không có ánh xạ 1-1 ở QA-01, chỉ áp dụng trong phạm vi TASK/Project scope).
>
> **Permission field-level nhạy cảm:** `HR.EMPLOYEE.VIEW_SENSITIVE` cho phép xem các field nhạy cảm của hồ sơ nhân viên (CCCD, lương, tài khoản ngân hàng…). User thiếu permission này bị mask/ẩn field tương ứng (xem §12).
>
> **Tên module nền tảng:** Module nền tảng dùng mã `FOUNDATION`; test ID dùng prefix `QA05-SYS-` và tag `@module-system` — đều chỉ cùng một module (FOUNDATION = SYSTEM).

### 7.2 Data scope chuẩn

| Scope | Ý nghĩa kiểm thử | Ví dụ dữ liệu |
| --- | --- | --- |
| Own | Chỉ dữ liệu chính user/employee hiện tại | Hồ sơ của tôi, bảng công của tôi, đơn nghỉ của tôi |
| Team | Nhân viên có `direct_manager_id` là employee hiện tại | Manager xem bảng công/đơn nghỉ team |
| Department | Nhân viên thuộc phòng ban được phân quyền | HR lead phòng ban xem nhân sự phòng ban |
| Project | Project/task mà user là owner/member/watcher/assignee tùy policy | Project manager xem task dự án |
| Company | Dữ liệu toàn công ty hiện tại | HR xem employee/leave/attendance toàn company |
| System | Dữ liệu liên tenant/toàn hệ thống | Super Admin quản trị nhiều company |

### 7.3 Quy tắc hợp nhất nhiều role

| Case | Dữ liệu test | Kỳ vọng |
| --- | --- | --- |
| User có Employee + Manager | `HR.EMPLOYEE.VIEW` Own + Team | Xem được hồ sơ của mình và nhân viên team |
| User có Manager + HR | `LEAVE.REQUEST.APPROVE` Team + Company | Nếu cả hai active, scope hiệu lực tối đa là Company |
| User có role inactive | Role inactive vẫn có permission trong DB | Permission không có hiệu lực |
| User có role expired | `user_roles.expired_at < now()` | Permission không có hiệu lực |
| Permission inactive | `permissions.is_active = false` | User không nhận quyền đó |
| Role permission inactive | `role_permissions.is_active = false` | Permission không có hiệu lực |

---

## 8. Test data chuẩn cho QA-05

### 8.1 Company/tenant

| Mã | Mô tả |
| --- | --- |
| `COMP_A` | Công ty A - tenant chính dùng test MVP |
| `COMP_B` | Công ty B - tenant khác để test cross-tenant isolation |

### 8.2 Department

| Mã | Company | Mô tả |
| --- | --- | --- |
| `DEP_A_HR` | COMP_A | Phòng Nhân sự |
| `DEP_A_ENG` | COMP_A | Phòng Kỹ thuật |
| `DEP_A_SALES` | COMP_A | Phòng Kinh doanh |
| `DEP_B_HR` | COMP_B | Phòng Nhân sự công ty B |

### 8.3 Users/employees

| User | Company | Employee | Department | Direct manager | Role chính | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- |
| `sa@example.com` | N/A (cross-company) | N/A | N/A | N/A | SUPER_ADMIN | Scope System |
| `admin.a@example.com` | COMP_A | Admin A | DEP_A_HR | N/A | COMPANY_ADMIN | Scope Company |
| `hr.a@example.com` | COMP_A | HR A | DEP_A_HR | N/A | HR | Scope Company |
| `manager.eng@example.com` | COMP_A | Manager ENG | DEP_A_ENG | N/A | MANAGER | Scope Team |
| `employee.1@example.com` | COMP_A | Employee 1 | DEP_A_ENG | Manager ENG | EMPLOYEE | Thuộc team Manager ENG |
| `employee.2@example.com` | COMP_A | Employee 2 | DEP_A_ENG | Manager ENG | EMPLOYEE | Thuộc team Manager ENG |
| `employee.out@example.com` | COMP_A | Employee Out | DEP_A_SALES | Manager khác | EMPLOYEE | Ngoài team Manager ENG |
| `pm.a@example.com` | COMP_A | Project Manager A | DEP_A_ENG | N/A | PROJECT_MANAGER | Scope Project |
| `employee.b@example.com` | COMP_B | Employee B | DEP_B_HR | N/A | EMPLOYEE | Test cross-tenant |
| `locked@example.com` | COMP_A | Locked User | DEP_A_ENG | N/A | EMPLOYEE | User Locked |
| `inactive@example.com` | COMP_A | Inactive User | DEP_A_ENG | N/A | EMPLOYEE | User Inactive |

### 8.4 Business records

| Nhóm | Record cần có | Dùng cho test |
| --- | --- | --- |
| HR | Employee 1, Employee 2, Employee Out, Employee B | Own/Team/Department/Company/System |
| HR | Profile change request Pending của Employee 1 | Self-service approval scope |
| ATT | Attendance records tháng hiện tại của Employee 1/2/Out/B | Bảng công theo scope |
| ATT | Adjustment request Pending của Employee 1 | Manager/HR approve scope |
| ATT | Remote work request Pending của Employee 1 | Approve theo scope |
| LEAVE | Leave request Draft/Submitted/Approved/Rejected của Employee 1 | Own và approval scope |
| LEAVE | Leave request Submitted của Employee Out | Manager ngoài scope |
| TASK | Project P1 có PM A, Employee 1 là member | Project scope |
| TASK | Project P2 không có PM A | Ngoài Project scope |
| NOTI | Notification của Employee 1, Manager ENG, HR A | Own notification |
| DASH | Widget cache theo Employee/Manager/HR/Admin | Dashboard scope |
| FOUNDATION | Audit logs, files, settings | Admin/system permission |

---

## 9. Test level áp dụng

| Level | Mục tiêu | Công cụ đề xuất | Owner |
| --- | --- | --- | --- |
| Unit test | Permission utility, scope resolver, policy function | Vitest/Vitest, backend unit | BE/FE |
| DB test | Seed RBAC, constraint, active/inactive role/permission | Migration test, SQL assertion | BE/QA |
| API integration test | Guard, scope filter, 401/403, tenant isolation | Supertest, Vitest, Newman | BE/QA |
| Contract test | Required permission/scope trong OpenAPI và response lỗi | OpenAPI diff, Schemathesis | QA/BE |
| Frontend component test | PermissionGate, FieldGuard, DisabledActionTooltip | Testing Library | FE/QA |
| E2E test | Route guard, menu visibility, direct URL, deep link | Playwright/Cypress | QA/FE |
| Security regression | IDOR, privilege escalation, cross-tenant leak | API fuzz/negative suite | QA/Security |

---

## 10. Ma trận test theo module

### 10.1 AUTH / RBAC

| Mã test | Nhóm | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-AUTH-001 | Login | User Active login đúng mật khẩu | 200, tạo session, trả auth context |
| QA05-AUTH-002 | Login | User Locked login | 403/423, không tạo session |
| QA05-AUTH-003 | Login | User Inactive login | 403, không tạo session |
| QA05-AUTH-004 | Session | Access token hết hạn gọi API protected | 401, refresh hoặc redirect login |
| QA05-AUTH-005 | Session | Logout rồi replay token/session cũ | 401 |
| QA05-AUTH-006 | Auth me | `/auth/me` trả permission + scopes đúng role active | Đúng danh sách quyền |
| QA05-AUTH-007 | Auth me | Role inactive không xuất hiện trong permission hiệu lực | Không có permission role inactive |
| QA05-AUTH-008 | Auth me | User có nhiều role | Permission được hợp nhất đúng |
| QA05-AUTH-009 | Role assign | Gán role trùng active | Bị chặn unique/business rule |
| QA05-AUTH-010 | Role assign | Gỡ role khỏi user | Permission biến mất sau refresh context |
| QA05-AUTH-011 | Permission | Permission inactive | Không có hiệu lực |
| QA05-AUTH-012 | Scope | `role_permissions.data_scope` sai enum | Migration/DB check chặn |
| QA05-AUTH-013 | Audit | Gán/gỡ role | Có audit log |
| QA05-AUTH-014 | Tenant | Company Admin A quản lý user Company B | 403/404 |
| QA05-AUTH-015 | Role hard-code | Custom role có permission HR.EMPLOYEE.VIEW | Được truy cập dù role code không phải HR |

### 10.2 HR

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-HR-001 | `HR.EMPLOYEE.VIEW` Own | Employee xem hồ sơ của chính mình | 200 |
| QA05-HR-002 | `HR.EMPLOYEE.VIEW` Own | Employee xem hồ sơ người khác | 403/404 |
| QA05-HR-003 | `HR.EMPLOYEE.VIEW` Team | Manager xem Employee 1 thuộc team | 200 |
| QA05-HR-004 | `HR.EMPLOYEE.VIEW` Team | Manager xem Employee Out ngoài team | 403/404 |
| QA05-HR-005 | `HR.EMPLOYEE.VIEW` Company | HR xem danh sách toàn công ty | Chỉ COMP_A |
| QA05-HR-006 | `HR.EMPLOYEE.VIEW` Company | HR cố filter `company_id=COMP_B` | Bị bỏ qua hoặc 403 |
| QA05-HR-007 | `HR.EMPLOYEE.CREATE` Company | HR tạo employee | 201 + audit |
| QA05-HR-008 | Thiếu create | Manager gọi POST employee | 403 |
| QA05-HR-009 | `HR.EMPLOYEE.UPDATE` Company | HR cập nhật hồ sơ employee | 200 + audit |
| QA05-HR-010 | Field sensitive | Manager xem employee team không có `VIEW_SENSITIVE` | Field nhạy cảm bị mask/không trả |
| QA05-HR-011 | Self-service | Employee gửi profile change request của mình | 201 |
| QA05-HR-012 | Self-service bypass | Employee gửi request sửa hồ sơ người khác | 403 |
| QA05-HR-013 | Approval | HR duyệt profile change request | 200 + cập nhật hồ sơ + audit + notification |
| QA05-HR-014 | Approval scope | Manager duyệt request ngoài scope | 403 |
| QA05-HR-015 | Export | Employee gọi export employee list | 403 |
| QA05-HR-016 | File | User thiếu quyền tải file hồ sơ nhạy cảm | 403, không cấp download URL |

### 10.3 ATT

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-ATT-001 | `ATT.ATTENDANCE.VIEW_OWN` Own | Employee xem chấm công hôm nay | 200 |
| QA05-ATT-002 | `ATT.ATTENDANCE.CHECK_IN` Own | Employee check-in cho chính mình | 200/201 |
| QA05-ATT-003 | Own bypass | Employee gửi body `employee_id` người khác khi check-in | Backend bỏ qua/reject, không tạo record cho người khác |
| QA05-ATT-004 | Leave rule | Employee có leave full-day Approved check-in | Business error, không tạo log check-in hợp lệ |
| QA05-ATT-005 | `ATT.ATTENDANCE.VIEW_TEAM` Team | Manager xem bảng công Employee 1 | 200 |
| QA05-ATT-006 | Team out scope | Manager xem bảng công Employee Out | 403/404 |
| QA05-ATT-007 | `ATT.ATTENDANCE.VIEW_COMPANY` Company | HR xem bảng công toàn công ty | Chỉ COMP_A |
| QA05-ATT-008 | Cross tenant | HR A xem attendance Employee B | 403/404 |
| QA05-ATT-009 | Adjustment create | Employee tạo yêu cầu điều chỉnh công của mình | 201 |
| QA05-ATT-010 | Adjustment approve Team | Manager duyệt adjustment Employee 1 | 200 |
| QA05-ATT-011 | Adjustment approve out scope | Manager duyệt adjustment Employee Out | 403 |
| QA05-ATT-012 | Manual adjust | HR/Admin điều chỉnh công trực tiếp | 200 + audit + notification |
| QA05-ATT-013 | Manual adjust missing permission | Manager gọi manual adjust nếu không có quyền | 403 |
| QA05-ATT-014 | Shift/rule config | Employee gọi API cấu hình ca/rule | 403 |
| QA05-ATT-015 | Export | HR export bảng công theo Company | File chỉ chứa COMP_A |
| QA05-ATT-016 | Audit logs | User thiếu quyền xem audit ATT | 403 |

### 10.4 LEAVE

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-LEAVE-001 | `LEAVE.REQUEST.CREATE` Own | Employee tạo đơn nghỉ của mình | 201 |
| QA05-LEAVE-002 | Own bypass | Employee tạo đơn nghỉ cho employee khác | 403/reject |
| QA05-LEAVE-003 | `LEAVE.REQUEST.VIEW_OWN` Own | Employee xem đơn của mình | 200 |
| QA05-LEAVE-004 | Own out scope | Employee xem đơn của người khác | 403/404 |
| QA05-LEAVE-005 | `LEAVE.REQUEST.APPROVE` Team | Manager duyệt đơn Employee 1 | 200 |
| QA05-LEAVE-006 | Team out scope | Manager duyệt đơn Employee Out | 403 |
| QA05-LEAVE-007 | Company scope | HR xem đơn pending toàn công ty | Chỉ COMP_A |
| QA05-LEAVE-008 | Leave type config | Employee gọi API tạo leave type | 403 |
| QA05-LEAVE-009 | Leave balance admin | HR điều chỉnh số dư phép | 200 + audit |
| QA05-LEAVE-010 | Leave balance own | Employee xem số dư phép của mình | 200 |
| QA05-LEAVE-011 | Calendar Team | Manager xem lịch nghỉ team | Chỉ team |
| QA05-LEAVE-012 | Calendar Company | HR xem lịch nghỉ công ty | Chỉ COMP_A |
| QA05-LEAVE-013 | Cross tenant | User A xem leave request COMP_B | 403/404 |
| QA05-LEAVE-014 | State transition | Duyệt đơn đã bị hủy/từ chối | Business error |
| QA05-LEAVE-015 | ATT sync | Approve leave hợp lệ | ATT sync chỉ record đúng employee/company |
| QA05-LEAVE-016 | Notification | Approve/reject leave | Notification gửi đúng người, không gửi ngoài scope |

### 10.5 TASK

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-TASK-001 | `TASK.PROJECT.VIEW` Project | Project member xem project P1 | 200 |
| QA05-TASK-002 | Project out scope | Project member P1 xem P2 | 403/404 |
| QA05-TASK-003 | `TASK.PROJECT.CREATE` Company/Department | PM tạo project nếu có quyền | 201 |
| QA05-TASK-004 | Missing create | Employee tạo project khi không có quyền | 403 |
| QA05-TASK-005 | `TASK.TASK.CREATE` Project | PM tạo task trong project P1 | 201 |
| QA05-TASK-006 | Assignment scope | PM giao task cho member trong project | 200 |
| QA05-TASK-007 | Assignment out scope | PM giao task cho employee không hợp lệ | 403/business error |
| QA05-TASK-008 | `TASK.TASK.UPDATE_STATUS` Own/Project | Assignee cập nhật trạng thái task của mình | 200 |
| QA05-TASK-009 | Update out scope | Employee update task không liên quan | 403 |
| QA05-TASK-010 | Comment | Project member comment task P1 | 201 |
| QA05-TASK-011 | Mention | Mention user ngoài quyền/project | Bị chặn hoặc không gửi notification theo policy |
| QA05-TASK-012 | File | User ngoài project tải file task | 403 |
| QA05-TASK-013 | Kanban | User xem Kanban project có quyền | Chỉ task trong scope |
| QA05-TASK-014 | Dashboard task | Employee chỉ thấy task của mình/watched/assigned | Không lộ task ngoài scope |
| QA05-TASK-015 | Cross tenant | User COMP_A gọi task COMP_B | 403/404 |

### 10.6 DASH

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-DASH-001 | `DASH.DASHBOARD.VIEW` Own | Employee mở dashboard | Chỉ widget Own |
| QA05-DASH-002 | Manager dashboard | Manager xem widget team leave/task/attendance | Chỉ dữ liệu team |
| QA05-DASH-003 | HR dashboard | HR xem widget company | Chỉ COMP_A |
| QA05-DASH-004 | Admin dashboard | Company Admin xem system/company widgets | Không có dữ liệu COMP_B |
| QA05-DASH-005 | Widget missing permission | User gọi widget không có quyền | 403 hoặc widget hidden |
| QA05-DASH-006 | Quick action | Quick action duyệt nghỉ điều hướng module LEAVE | Module LEAVE kiểm tra lại quyền |
| QA05-DASH-007 | Cache | Dashboard cache không trộn data user/role/company | Không lộ dữ liệu |
| QA05-DASH-008 | Cache invalidation | User bị gỡ role HR | Widget HR biến mất sau refresh/invalidation |
| QA05-DASH-009 | Degraded state | Module nguồn lỗi 403/500 | Widget degraded không fallback bằng dữ liệu trái scope |
| QA05-DASH-010 | Config | User thiếu quyền cấu hình widget | 403 |

### 10.7 NOTI

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-NOTI-001 | `NOTI.NOTIFICATION.READ` Own | User xem danh sách notification của mình | 200, chỉ của mình |
| QA05-NOTI-002 | Own bypass | User đọc notification id của người khác | 403/404 |
| QA05-NOTI-003 | Unread count | Unread count chỉ tính notification của user hiện tại | Đúng số lượng |
| QA05-NOTI-004 | Mark read | User mark read notification của mình | 200 |
| QA05-NOTI-005 | Mark other read | User mark read notification người khác | 403/404 |
| QA05-NOTI-006 | Deep link | Notification target dẫn tới đơn nghỉ ngoài scope | Module gốc trả 403/404 |
| QA05-NOTI-007 | Admin view | Admin xem notification company nếu có quyền | Chỉ COMP_A |
| QA05-NOTI-008 | Template config | Employee cập nhật notification template | 403 |
| QA05-NOTI-009 | Delivery log | User thiếu quyền xem delivery log | 403 |
| QA05-NOTI-010 | System notification | Admin gửi notification thủ công | Chỉ recipient trong company/scope hợp lệ |

### 10.8 FOUNDATION / SYSTEM

| Mã test | Permission/scope | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SYS-001 | `FOUNDATION.SETTING.VIEW` Company | Admin xem company settings | 200 |
| QA05-SYS-002 | Setting update | Employee cập nhật company settings | 403 |
| QA05-SYS-003 | Audit log view | User có quyền xem audit log | 200 theo scope |
| QA05-SYS-004 | Audit log missing permission | User thường xem audit log | 403 |
| QA05-SYS-005 | File metadata | User xem file metadata trong scope | 200 |
| QA05-SYS-006 | File cross entity | User tải file của record ngoài scope | 403 |
| QA05-SYS-007 | Module catalog | User chỉ thấy active modules được cấp quyền | Không thấy module ẩn |
| QA05-SYS-008 | Company settings tenant | Company Admin A sửa settings Company B | 403/404 |
| QA05-SYS-009 | Sequence config | User thiếu quyền sửa sequence | 403 |
| QA05-SYS-010 | Public holidays | HR/Admin cấu hình ngày nghỉ nếu có quyền | 200 + audit |

---

## 11. Ma trận data scope chi tiết

### 11.1 Scope Own

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-OWN-001 | HR | Employee xem `/hr/me` | 200 |
| QA05-SCOPE-OWN-002 | HR | Employee gọi `/hr/employees/{other_id}` | 403/404 |
| QA05-SCOPE-OWN-003 | ATT | Employee xem bảng công của mình | 200 |
| QA05-SCOPE-OWN-004 | ATT | Employee sửa `employee_id` trong query/body sang người khác | Bị chặn |
| QA05-SCOPE-OWN-005 | LEAVE | Employee xem/tạo/hủy đơn của mình | 200/201 |
| QA05-SCOPE-OWN-006 | LEAVE | Employee hủy đơn của người khác | 403/404 |
| QA05-SCOPE-OWN-007 | TASK | Employee xem task được giao/theo dõi/tạo bởi mình | 200 |
| QA05-SCOPE-OWN-008 | NOTI | User xem notification của mình | 200 |

### 11.2 Scope Team

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-TEAM-001 | HR | Manager xem Employee 1/2 thuộc team | 200 |
| QA05-SCOPE-TEAM-002 | HR | Manager xem Employee Out ngoài team | 403/404 |
| QA05-SCOPE-TEAM-003 | ATT | Manager xem bảng công team | Chỉ Employee 1/2 |
| QA05-SCOPE-TEAM-004 | ATT | Manager duyệt adjustment Employee 1 | 200 |
| QA05-SCOPE-TEAM-005 | ATT | Manager duyệt adjustment Employee Out | 403 |
| QA05-SCOPE-TEAM-006 | LEAVE | Manager duyệt leave Employee 1 | 200 |
| QA05-SCOPE-TEAM-007 | LEAVE | Manager duyệt leave Employee Out | 403 |
| QA05-SCOPE-TEAM-008 | DASH | Manager dashboard team widget | Không có dữ liệu ngoài team |

### 11.3 Scope Department

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-DEP-001 | HR | Department-scoped user xem employee cùng department | 200 |
| QA05-SCOPE-DEP-002 | HR | Xem employee khác department | 403/404 |
| QA05-SCOPE-DEP-003 | ATT | Xem bảng công department | Chỉ department được phân quyền |
| QA05-SCOPE-DEP-004 | LEAVE | Xem lịch nghỉ department | Chỉ department được phân quyền |
| QA05-SCOPE-DEP-005 | DASH | Department dashboard | Chỉ aggregate department |

### 11.4 Scope Project

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-PROJ-001 | TASK | Project member xem project P1 | 200 |
| QA05-SCOPE-PROJ-002 | TASK | Project member xem project P2 không liên quan | 403/404 |
| QA05-SCOPE-PROJ-003 | TASK | PM cập nhật member P1 | 200 nếu có quyền |
| QA05-SCOPE-PROJ-004 | TASK | PM cập nhật member P2 | 403 |
| QA05-SCOPE-PROJ-005 | TASK | Assignee update task trong project | 200 nếu policy cho phép |
| QA05-SCOPE-PROJ-006 | TASK | User tải file task ngoài project | 403 |

### 11.5 Scope Company

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-COMP-001 | HR | HR xem employee list company | Chỉ COMP_A |
| QA05-SCOPE-COMP-002 | ATT | HR xem attendance company | Chỉ COMP_A |
| QA05-SCOPE-COMP-003 | LEAVE | HR xem leave company | Chỉ COMP_A |
| QA05-SCOPE-COMP-004 | DASH | HR/Admin dashboard company | Aggregate COMP_A |
| QA05-SCOPE-COMP-005 | NOTI | Admin xem notification company | Chỉ COMP_A |
| QA05-SCOPE-COMP-006 | SYSTEM | Admin chỉnh company setting | Chỉ COMP_A |

### 11.6 Scope System

| Mã test | Module | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-SCOPE-SYS-001 | AUTH | Super Admin xem users nhiều company | 200 theo endpoint system |
| QA05-SCOPE-SYS-002 | HR | Super Admin truy vấn company cụ thể nếu API cho phép | 200 |
| QA05-SCOPE-SYS-003 | SYSTEM | Super Admin bật/tắt company/module | 200 + audit |
| QA05-SCOPE-SYS-004 | Cross tenant | User không phải Super Admin gọi API system | 403 |
| QA05-SCOPE-SYS-005 | Audit | Super Admin xem audit liên company | 200 nếu có permission System |

---

## 12. Field-level permission testing

### 12.1 Nhóm field nhạy cảm

| Nhóm field | Ví dụ | Rule kiểm thử |
| --- | --- | --- |
| Thông tin cá nhân | Số giấy tờ tùy thân, địa chỉ, ngày sinh, số điện thoại riêng | Chỉ trả khi có permission sensitive phù hợp |
| Thông tin hợp đồng | Lương trong hợp đồng nếu có, file hợp đồng | Không trả cho Manager/Employee nếu thiếu quyền |
| Thông tin bảng công nhạy cảm | Lý do điều chỉnh, bằng chứng, GPS nếu có | Chỉ trả theo permission detail/sensitive |
| File private | Hồ sơ nhân viên, bằng chứng nghỉ/điều chỉnh công | Không expose storage path; chỉ cấp signed URL nếu có quyền |
| Audit raw diff | Dữ liệu before/after có thông tin nhạy cảm | Mask nếu user thiếu quyền audit sensitive |
| Auth secret | Password hash, refresh token hash, reset token hash | Không bao giờ trả ra API |
| System secret | API key, storage path, secret setting | Mask hoặc không trả |

### 12.2 Test cases field-level

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-FIELD-001 | Manager xem hồ sơ Employee 1 không có `HR.EMPLOYEE.VIEW_SENSITIVE` | Field sensitive bị mask/ẩn |
| QA05-FIELD-002 | HR có `HR.EMPLOYEE.VIEW_SENSITIVE` xem hồ sơ | Field sensitive trả đúng |
| QA05-FIELD-003 | Employee xem hồ sơ của mình | Chỉ field self-service được phép xem/sửa |
| QA05-FIELD-004 | User xem API response qua DevTools | Không có field nhạy cảm nếu thiếu quyền |
| QA05-FIELD-005 | File metadata response | Không trả `storage_path`, `bucket_private_path` |
| QA05-FIELD-006 | Auth response | Không trả `password_hash`, `refresh_token_hash` |
| QA05-FIELD-007 | Audit log response cho user thiếu quyền sensitive | Raw diff được mask |
| QA05-FIELD-008 | Export HR bởi user thiếu sensitive | File export không chứa field sensitive |

---

## 13. Frontend permission testing

### 13.1 App visibility

| Mã test | User | Kịch bản | Expected |
| --- | --- | --- | --- |
| QA05-FE-APP-001 | Employee | Home Portal | Chỉ thấy app được cấp quyền như DASH/ATT/LEAVE/TASK/NOTI tùy permission |
| QA05-FE-APP-002 | Employee | App Switcher | Không thấy app HR Admin/System nếu thiếu quyền |
| QA05-FE-APP-003 | HR | Home Portal | Thấy HR, ATT, LEAVE, DASH, NOTI theo permission |
| QA05-FE-APP-004 | Manager | Home Portal | Thấy màn/team app theo permission, không thấy cấu hình hệ thống |
| QA05-FE-APP-005 | Permission removed | Reload app sau khi gỡ role | App/menu biến mất |
| QA05-FE-APP-006 | Module disabled | Module status locked/hidden | UI locked/hidden theo policy |

### 13.2 Route guard

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-FE-ROUTE-001 | Chưa login vào `/hr/employees` | Redirect `/login?returnUrl=...` |
| QA05-FE-ROUTE-002 | Employee nhập direct URL `/hr/employees` | Forbidden/redirect theo policy |
| QA05-FE-ROUTE-003 | Manager direct URL `/leave/approvals` | Cho vào nếu có permission approve scope Team |
| QA05-FE-ROUTE-004 | Employee direct URL `/leave/approvals` | 403 UI; API cũng 403 |
| QA05-FE-ROUTE-005 | Token hết hạn | Refresh một lần hoặc redirect login |
| QA05-FE-ROUTE-006 | User locked trong lúc đang dùng | Sau refresh/auth check -> account locked state |
| QA05-FE-ROUTE-007 | Return URL external | Bị reject, tránh open redirect |

### 13.3 Menu/sidebar/action visibility

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-FE-ACTION-001 | Employee vào LEAVE | Thấy `Tạo đơn nghỉ`, không thấy `Duyệt đơn` |
| QA05-FE-ACTION-002 | Manager vào LEAVE | Thấy `Đơn cần duyệt` nếu có permission |
| QA05-FE-ACTION-003 | HR vào HR employee detail | Thấy nút edit nếu có update permission |
| QA05-FE-ACTION-004 | Manager xem employee detail | Không thấy field/nút sensitive nếu thiếu permission |
| QA05-FE-ACTION-005 | Employee có leave full-day approved | Check-in button disabled + tooltip |
| QA05-FE-ACTION-006 | Task Done/Cancelled | Một số action update bị disable theo business state |
| QA05-FE-ACTION-007 | Dashboard quick action | Quick action ẩn/disable nếu thiếu permission hoặc business rule không cho phép |
| QA05-FE-ACTION-008 | Notification deep link | Vào module gốc và kiểm tra permission lại |

### 13.4 Cache và logout

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-FE-CACHE-001 | Login HR rồi logout, login Employee trên cùng browser | Không còn cache HR/menu/data cũ |
| QA05-FE-CACHE-002 | Gỡ role HR trong lúc user đang mở app | Sau refresh/invalidation, menu/data HR bị ẩn |
| QA05-FE-CACHE-003 | Query cache dashboard theo user | Không trộn widget data giữa user |
| QA05-FE-CACHE-004 | Recent apps | App recent không mở được nếu quyền đã bị gỡ |

---

## 14. API negative/bypass testing

### 14.1 Bypass bằng path param

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-BYPASS-001 | Employee gọi `GET /hr/employees/{other_employee_id}` | 403/404 |
| QA05-BYPASS-002 | Manager gọi record ngoài team | 403/404 |
| QA05-BYPASS-003 | PM gọi project/task không liên quan | 403/404 |
| QA05-BYPASS-004 | User COMP_A gọi ID record COMP_B | 403/404 |

### 14.2 Bypass bằng query params

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-BYPASS-005 | Employee thêm `employee_id=other` vào query | Bị bỏ qua/reject |
| QA05-BYPASS-006 | HR thêm `company_id=COMP_B` | Bị bỏ qua/reject/403 |
| QA05-BYPASS-007 | Manager filter department ngoài scope | Không trả dữ liệu hoặc 403 |
| QA05-BYPASS-008 | User tăng `per_page` cực lớn để scan data | Bị giới hạn theo API policy |

### 14.3 Bypass bằng request body

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-BYPASS-009 | Employee tạo leave với `employee_id` người khác | 403/reject |
| QA05-BYPASS-010 | Employee check-in body có `employee_id` người khác | Không tạo record người khác |
| QA05-BYPASS-011 | User gửi `created_by`, `approved_by` giả | Backend bỏ qua/reject |
| QA05-BYPASS-012 | User gửi `company_id` khác trong create/update | Backend resolve từ auth context |
| QA05-BYPASS-013 | User sửa `role_code` trong body profile | 403/reject |

### 14.4 Bypass bằng export/download

| Mã test | Kịch bản | Expected |
| --- | --- | --- |
| QA05-BYPASS-014 | Employee gọi export HR | 403 |
| QA05-BYPASS-015 | Manager export team nhưng thêm employee ngoài team | File không chứa ngoài scope hoặc 403 |
| QA05-BYPASS-016 | User tải file private ngoài scope | 403, không cấp signed URL |
| QA05-BYPASS-017 | User dùng signed URL hết hạn hoặc của file khác | 403/expired |

---

## 15. API status code và error expectation

| Tình huống | Status đề xuất | Ghi chú |
| --- | --- | --- |
| Chưa đăng nhập/không có token | 401 Unauthorized | Frontend redirect login |
| Token hết hạn | 401 Unauthorized | Cho phép refresh một lần |
| Account locked/inactive | 403 Forbidden hoặc 423 Locked | Theo error code AUTH |
| Thiếu permission | 403 Forbidden | Không xử lý nghiệp vụ |
| Có permission nhưng target ngoài scope | 403 Forbidden hoặc 404 Not Found | Chọn policy nhất quán |
| Dữ liệu không tồn tại trong company | 404 Not Found | Không lộ cross-tenant |
| Business rule không cho phép | 409 Conflict hoặc 422 BusinessRuleError | Ví dụ leave approved chặn check-in |
| Validation sai | 400/422 | Theo chuẩn API error |
| Direct URL frontend thiếu quyền | 403 page | API vẫn phải 403 |

---

## 16. Automation strategy

### 16.1 Test tag

| Tag | Ý nghĩa |
| --- | --- |
| `@permission` | Test permission chung |
| `@role` | Test role/user_roles |
| `@scope-own` | Data scope Own |
| `@scope-team` | Data scope Team |
| `@scope-department` | Data scope Department |
| `@scope-project` | Data scope Project |
| `@scope-company` | Data scope Company |
| `@scope-system` | Data scope System |
| `@tenant-isolation` | Cross-company isolation |
| `@field-level` | Field-level permission/masking |
| `@negative` | Bypass/direct API |
| `@frontend-guard` | Route/menu/action guard |
| `@audit` | Audit log permission-sensitive action |
| `@cache` | Permission/session/cache invalidation |

### 16.2 Test helper cần có

| Helper | Mục đích |
| --- | --- |
| `loginAs(roleOrUser)` | Login bằng user fixture |
| `apiAs(user)` | Tạo API client theo token user |
| `expectForbidden(response)` | Assert lỗi 403 chuẩn |
| `expectUnauthorized(response)` | Assert lỗi 401 chuẩn |
| `expectNoCrossTenantData(data, companyId)` | Assert dữ liệu không lộ tenant khác |
| `expectOnlyEmployees(data, employeeIds)` | Assert scope list |
| `expectMaskedFields(data, fields)` | Assert field nhạy cảm bị mask/không trả |
| `seedRolePermission(role, permission, scope)` | Setup permission test |
| `revokeRole(user, role)` | Test permission cache invalidation |
| `assertAuditLog(action, actor, target)` | Kiểm tra audit log |

### 16.3 CI pipeline đề xuất

```text
Pull Request
  -> Unit test permission utility
  -> API contract permission metadata check
  -> Backend integration RBAC smoke
  -> Frontend guard component test

Nightly / Pre-release
  -> Full QA-05 API suite
  -> Full E2E route/menu/action suite
  -> Cross-tenant isolation suite
  -> Field-level permission suite
  -> Permission cache/logout regression
```

---

## 17. OpenAPI/contract checklist cho QA-05

Mỗi endpoint trong OpenAPI/API docs phải có:

| Checklist | Required |
| --- | --- |
| `security`/auth requirement | Có với API protected |
| Required permission | Có |
| Allowed roles mô tả nghiệp vụ | Có, nhưng không dùng làm guard chính |
| Data scope | Có |
| Error 401 | Có |
| Error 403 | Có |
| Error 404 nếu target không tồn tại/ngoài scope | Có |
| Business rule error nếu action có workflow | Có |
| Audit log note nếu thao tác nhạy cảm | Có |
| Notification event nếu phát event | Có |
| Field-level response note nếu có dữ liệu nhạy cảm | Có |

Fail QA-05 nếu endpoint nghiệp vụ không khai báo permission/data scope rõ ràng.

---

## 18. Regression checklist theo thay đổi quyền

Khi có thay đổi permission/role/scope, phải chạy regression tối thiểu:

1. `/api/v1/auth/me` trả permission mới đúng.
2. Frontend app/menu/sidebar/action cập nhật đúng.
3. Direct URL với quyền mới hoạt động đúng.
4. Direct URL với quyền đã bị gỡ bị chặn.
5. API list filter theo scope mới đúng.
6. API detail/action chặn target ngoài scope.
7. Dashboard widget không còn dữ liệu trái quyền.
8. Notification deep link không bỏ qua permission.
9. Export/download không lộ dữ liệu ngoài scope.
10. Logout/login user khác không dùng cache permission cũ.
11. Audit log ghi nhận thay đổi role/permission.

---

## 19. Definition of Done cho QA-05

QA-05 được xem là hoàn thành khi:

1. Có test users/fixtures đủ role và data scope chuẩn.
2. Có test data cross-tenant tối thiểu 2 company.
3. 100% API nghiệp vụ có test thiếu token, thiếu permission và ngoài scope.
4. 100% module MVP có test Own/Team/Company tối thiểu; TASK có thêm Project; Super Admin có System nếu triển khai.
5. 100% direct URL quan trọng có E2E guard test.
6. 100% app/menu/sidebar/action P0/P1 có visibility test theo permission.
7. Field nhạy cảm không bị trả ra API khi thiếu quyền.
8. Export/download không vượt scope.
9. Role inactive/expired/permission inactive không còn hiệu lực.
10. Gỡ role/permission phản ánh đúng sau refresh session hoặc logout-login.
11. Cross-tenant isolation pass cho HR, ATT, LEAVE, TASK, NOTI, DASH, FOUNDATION.
12. Không có hard-code role trong logic guard chính.
13. Tất cả lỗi permission trả response chuẩn, không leak thông tin nội bộ.
14. Audit log có cho thao tác nhạy cảm: gán role, sửa permission, manual adjust, approve/reject, export, file access nếu cấu hình.

---

## 20. Exit criteria trước release MVP

| Điều kiện | Mức yêu cầu |
| --- | --- |
| Critical permission bug | 0 |
| Cross-tenant data leak | 0 |
| Sensitive field leak | 0 |
| Unauthorized write action pass | 0 |
| Unauthorized export/download pass | 0 |
| P0 route guard bug | 0 |
| P0 API missing permission guard | 0 |
| P1 permission UI mismatch | Có workaround hoặc fix trước release |
| Test automation pass rate | >= 95% cho suite QA-05 |
| Manual exploratory sign-off | Bắt buộc cho HR/ATT/LEAVE/TASK/DASH/NOTI |

---

## 21. Bug severity guideline cho QA-05

| Severity | Ví dụ |
| --- | --- |
| Blocker | User company A xem/sửa dữ liệu company B |
| Blocker | Employee duyệt được đơn nghỉ hoặc điều chỉnh công của người khác |
| Critical | API trả field nhạy cảm cho user thiếu quyền |
| Critical | Direct API bỏ qua permission dù UI đã ẩn nút |
| Critical | Export/download vượt scope |
| High | Dashboard widget hiển thị dữ liệu ngoài team/company |
| High | Notification deep link mở được record ngoài scope |
| High | Gỡ role nhưng user vẫn dùng quyền cũ lâu bất thường |
| Medium | UI hiện button nhưng API trả 403 do thiếu permission |
| Medium | UI ẩn button dù user có quyền hợp lệ |
| Low | Tooltip/forbidden message chưa rõ ràng |

> **Ánh xạ về thang chuẩn S0–S4 ([QA-08 §9](QA-08_Bug_Tracking_Regression_Release_Criteria.md)):** Blocker/Critical (lộ dữ liệu, cross-tenant, bypass quyền) → **S0**; High → **S1**; Medium → **S2**; Low → **S3**. QA-08 là tài liệu chuẩn cho severity bug.

---

## 22. Traceability matrix

| Nguồn yêu cầu | Nội dung | QA-05 coverage |
| --- | --- | --- |
| SPEC-02 AUTH | User, role, permission, data scope | AUTH/RBAC tests |
| DB-02 AUTH/RBAC | `users`, `roles`, `permissions`, `user_roles`, `role_permissions` | DB + permission seed tests |
| API-01 | Backend kiểm tra auth/permission/scope/business rule | API guard tests |
| API-03 HR | Employee, profile, field sensitive | HR scope + field-level tests |
| API-04 ATT | Check-in/out, records, adjustment, manual adjust | ATT permission/scope tests |
| API-05 LEAVE | My leave, approval, balance, calendar | LEAVE permission/scope tests |
| API-06 TASK | Project/task/member/comment/file | TASK project scope tests |
| API-07 NOTI | Notification list, unread, target, template | NOTI own/admin/deep link tests |
| API-08 DASH | Widget theo role/scope/cache | DASH widget/cache tests |
| FRONTEND-03 | Route guard, permission utility, field guard | FE route/menu/action tests |
| UI-02/UI-03/UI-04 | App/menu/route/action theo permission | E2E visibility tests |

---

## 23. Deliverables của QA-05

| Deliverable | Định dạng | Owner |
| --- | --- | --- |
| Permission test matrix | Markdown/Spreadsheet | QA |
| RBAC fixture seed | SQL/seed script | BE/QA |
| API permission test collection | Postman/Newman hoặc automated test | QA/BE |
| E2E permission test suite | Playwright/Cypress | QA/FE |
| Field-level permission checklist | Markdown | QA/BE |
| Cross-tenant isolation report | Test report | QA |
| Defect list và sign-off | QA report | QA Lead/Product |

---

## 24. Kết luận

QA-05 là lớp kiểm thử bắt buộc để bảo vệ dữ liệu và luồng vận hành của hệ thống quản lý doanh nghiệp nội bộ.

Tư duy kiểm thử cần giữ nhất quán:

```text
Role chỉ là nhóm quyền
-> Permission là điều kiện thao tác
-> Data scope là phạm vi dữ liệu
-> Backend là guard cuối cùng
-> Frontend chỉ hỗ trợ UX
-> Direct API/direct URL luôn phải bị kiểm soát
-> Không lộ cross-tenant, không lộ field nhạy cảm
```

Sau QA-05, bước tiếp theo nên là:

```text
QA-06: Security Testing
```

---

## 25. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: role/scope matrix tổng quan |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Ma trận test case theo module/role/scope |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Flow nghiệp vụ xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| **QA-05 (tài liệu này)** | Permission, Role & Data Scope Testing | RBAC, data scope, field/route/menu/action guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
