# IMPLEMENTATION-08: SPRINT 5 INTEGRATION, QA HARDENING & UAT EXECUTION PLAN
# KẾ HOẠCH THỰC THI SPRINT 5 - TÍCH HỢP, QA HARDENING & UAT

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-08 |
| Tên tài liệu | Sprint 5 Integration, QA Hardening & UAT Execution Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | MVP Version 1.0 - Implementation |
| Sprint | Sprint 5 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12, IMPLEMENTATION-01 -> IMPLEMENTATION-07 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch thực thi **Sprint 5 - Integration, QA Hardening & UAT** cho hệ thống quản lý doanh nghiệp nội bộ.

Sprint 5 là sprint chuyển trọng tâm từ xây dựng module riêng lẻ sang **kiểm chứng hệ thống vận hành như một sản phẩm MVP hoàn chỉnh**. Ở sprint này, đội dự án cần tập trung vào:

1. Tích hợp frontend, backend, database, seed data, notification, dashboard và DevOps environment.
2. Kiểm thử end-to-end các flow nghiệp vụ MVP quan trọng.
3. Hardening permission, data scope, error handling, audit log, notification deep link và dashboard widget.
4. Chạy regression test toàn hệ thống sau khi các module lõi đã ghép với nhau.
5. Chuẩn bị dữ liệu, kịch bản và môi trường cho UAT.
6. Tổ chức UAT với stakeholder/business user.
7. Ghi nhận bug, phân loại mức độ, sửa lỗi, retest và regression lại.
8. Chốt mức độ sẵn sàng để bước sang Sprint 6 - Stabilization, Release Candidate & Go-live.

Tài liệu này không thay thế tài liệu QA hoặc DevOps chi tiết. IMPLEMENTATION-08 đóng vai trò **execution plan** để điều phối các nhóm Product, Backend, Frontend, QA, DevOps, UI/UX và Business trong sprint tích hợp/UAT.

---

## 3. Vị trí Sprint 5 trong chuỗi Implementation

```text
IMPLEMENTATION-01: MVP Implementation Roadmap & Sprint Plan
IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
IMPLEMENTATION-03: Sprint 0 Execution Plan & Issue Board Setup
IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan
IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan
IMPLEMENTATION-08: Sprint 5 Integration, QA Hardening & UAT Execution Plan
IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan
```

Sprint 5 nhận đầu vào từ các sprint trước:

```text
Sprint 1
  -> Foundation, database, auth base, project setup, environment base

Sprint 2
  -> AUTH + HR core usable

Sprint 3
  -> ATT + LEAVE core usable

Sprint 4
  -> TASK + NOTI + DASH core usable

Sprint 5
  -> Ghép tất cả thành MVP integrated build
  -> QA hardening
  -> UAT
  -> Bug fixing
  -> Release readiness checkpoint
```

Sau Sprint 5, sản phẩm phải đủ ổn định để chuyển sang Sprint 6 với mục tiêu release candidate và go-live checklist.

---

## 4. Mục tiêu Sprint 5

### 4.1 Mục tiêu tổng quát

Đảm bảo MVP có thể vận hành trọn vẹn theo các flow thực tế của doanh nghiệp, không chỉ chạy đúng ở từng module riêng lẻ.

### 4.2 Mục tiêu nghiệp vụ

Sprint 5 cần xác nhận các nghiệp vụ sau hoạt động xuyên suốt:

1. Người dùng đăng nhập, vào Home Portal, mở module và đổi module bằng App Switcher.
2. Employee check-in/check-out, xem bảng công, gửi yêu cầu điều chỉnh công.
3. Employee tạo đơn nghỉ, xem số dư phép, hủy đơn theo rule.
4. Manager/HR duyệt hoặc từ chối đơn nghỉ, xử lý điều chỉnh công.
5. Employee/Manager tạo, giao, cập nhật task, comment, checklist và nhận notification.
6. Dashboard hiển thị widget đúng theo role, permission và data scope.
7. Notification badge/dropdown/list/deep link hoạt động đúng.
8. HR quản lý nhân viên, hồ sơ cá nhân, yêu cầu chỉnh sửa hồ sơ, phòng ban, chức vụ và hợp đồng ở mức MVP.
9. Admin/System quản lý user, role, permission, module/settings, audit log ở mức cần thiết cho MVP.
10. Mọi dữ liệu nhạy cảm chỉ hiển thị đúng quyền và phạm vi dữ liệu.

### 4.3 Mục tiêu kỹ thuật

Sprint 5 cần xác nhận:

1. Backend guard kiểm tra authentication, permission, data scope và business rule cho mọi API quan trọng.
2. Frontend guard không hard-code role, sử dụng permission/data scope từ backend.
3. API client xử lý chuẩn 401, 403, 404, 409, 422, 500 và network error.
4. Query invalidation hoạt động đúng sau mutation quan trọng.
5. Dashboard widget có fallback/degraded state khi module nguồn lỗi.
6. Notification event tạo đúng recipient, unread count, target link và trạng thái read/unread.
7. Audit log ghi đủ thao tác quan trọng.
8. Seed data đủ để QA/UAT chạy flow mà không phải thao tác thủ công quá nhiều.
9. Migration chạy được từ database trống trên môi trường staging/UAT.
10. Build frontend/backend deploy được lên staging/UAT ổn định.

---

## 5. Phạm vi Sprint 5

### 5.1 Bao gồm trong Sprint 5

| Nhóm | Nội dung |
| --- | --- |
| Integration | Ghép frontend + backend + database + seed + environment |
| E2E flow | Test luồng đăng nhập, Home Portal, module workspace, check-in, nghỉ phép, task, notification, dashboard |
| QA hardening | Regression, smoke, permission, data scope, state, responsive, accessibility cơ bản |
| UAT | Chuẩn bị script, data, user, training ngắn, chạy UAT, ghi nhận feedback |
| Bug fixing | Triage bug P0/P1/P2, sửa lỗi, retest, regression |
| Release readiness | Chốt checklist sẵn sàng chuyển Sprint 6/RC |
| Documentation | Cập nhật known issues, release notes nội bộ, UAT sign-off draft |

### 5.2 Không bao gồm trong Sprint 5

| Không bao gồm | Ghi chú |
| --- | --- |
| Tính năng mới ngoài MVP | Chỉ nhận nếu là blocker cho UAT hoặc release readiness |
| Refactor kiến trúc lớn | Chỉ làm nếu lỗi bảo mật/nghiệp vụ nghiêm trọng |
| Payroll/Recruite/Asset/Room/Chat/Social | Chỉ placeholder nếu đã có trong Home Portal/App Registry |
| Mobile native app | Chỉ kiểm responsive mobile web P0/P1 |
| BI dashboard nâng cao | Chỉ dashboard MVP theo role/widget đã định nghĩa |
| Realtime WebSocket đầy đủ | Có thể dùng polling hoặc refresh thủ công nếu MVP chưa realtime |
| Load test quy mô lớn | Chỉ smoke/performance baseline; load test sâu chuyển sang hardening/release phase nếu cần |

---

## 6. Giả định đầu vào

Sprint 5 chỉ bắt đầu khi các điều kiện sau đã đạt mức tối thiểu:

| Mã | Điều kiện đầu vào | Owner | Trạng thái |
| --- | --- | --- | --- |
| IMPL08-READY-001 | Backend các module AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH có API core chạy được trên staging | Backend Lead | Cần xác nhận |
| IMPL08-READY-002 | Frontend có route, layout, auth guard, permission utility, API client và các màn P0/P1 chính | Frontend Lead | Cần xác nhận |
| IMPL08-READY-003 | Database migration + seed chạy được từ database trống | Backend/DevOps | Cần xác nhận |
| IMPL08-READY-004 | Staging/UAT environment có URL truy cập ổn định | DevOps | Cần xác nhận |
| IMPL08-READY-005 | Test account theo role Employee, Manager, HR, Admin, Super Admin đã có | QA/Backend | Cần xác nhận |
| IMPL08-READY-006 | QA test case matrix và UAT script bản đầu đã có | QA Lead/Product | Cần xác nhận |
| IMPL08-READY-007 | Bug tracker/issue board có workflow triage rõ ràng | PM/QA Lead | Cần xác nhận |
| IMPL08-READY-008 | Business stakeholder sẵn sàng tham gia UAT | Product Owner | Cần xác nhận |

Nếu một điều kiện đầu vào chưa đạt, Sprint 5 vẫn có thể bắt đầu nhưng phải ghi rõ trong **Known Blockers** và ưu tiên xử lý trong 1-2 ngày đầu sprint.

---

## 7. Team tham gia và trách nhiệm

| Vai trò | Trách nhiệm chính trong Sprint 5 |
| --- | --- |
| Product Owner | Chốt phạm vi UAT, ưu tiên bug, quyết định accept/reject feedback |
| Project Manager/Scrum Master | Điều phối sprint, daily tracking, bug triage, risk tracking |
| Business Stakeholder | Chạy UAT theo script, xác nhận nghiệp vụ, gửi feedback |
| Backend Lead | Ổn định API, business rule, permission/data scope, event, audit, migration |
| Frontend Lead | Ổn định UI flow, state, route guard, API integration, responsive, error UX |
| QA Lead | Lập test plan Sprint 5, regression, UAT script, bug severity, sign-off report |
| QA Engineer | Execute test case, log bug, retest, regression, UAT support |
| DevOps Engineer | Staging/UAT environment, deployment, logs, rollback, monitoring cơ bản |
| UI/UX Designer | Hỗ trợ kiểm visual, interaction, state, copy, responsive, UAT feedback UX |
| Security/Tech Lead | Review quyền, dữ liệu nhạy cảm, token/session, audit, OWASP smoke |

---

## 8. Nguyên tắc thực thi Sprint 5

### 8.1 Integration-first

Không ưu tiên thêm tính năng mới khi build tích hợp chưa ổn định. Mọi bug chặn flow P0/P1 phải được ưu tiên trước backlog nice-to-have.

### 8.2 Backend là nguồn kiểm soát quyền cuối cùng

Frontend có thể ẩn/disable menu, route, button, widget, field để cải thiện UX. Tuy nhiên Sprint 5 phải test cả trường hợp gọi API trực tiếp để đảm bảo backend vẫn chặn đúng quyền.

### 8.3 Không hard-code role

Mọi logic UI/route/action phải dựa trên permission và data scope. Không chấp nhận logic kiểu:

```ts
if (user.role === 'HR') showEmployeeMenu();
```

Pattern đúng:

```ts
permission.can('HR.EMPLOYEE.VIEW')
permission.hasAnyScope('HR.EMPLOYEE.VIEW', ['Department', 'Company', 'System'])
```

### 8.4 Mọi action quan trọng phải đi qua module gốc

Dashboard, Home Portal, App Switcher và Notification chỉ tổng hợp/điều hướng. Action nghiệp vụ phải gọi API/module gốc để kiểm tra lại permission, data scope và business rule.

Ví dụ:

```text
Notification: Đơn nghỉ cần duyệt
  -> Click notification
  -> Mark read
  -> Deep link sang LEAVE approval detail
  -> LEAVE kiểm tra quyền/scope/business rule
```

### 8.5 Test theo data scope thật

Không chỉ test user Admin. Sprint 5 bắt buộc test với nhiều role/scope:

```text
Employee + Own
Manager + Team
HR + Department/Company
Admin + Company
Super Admin + System nếu MVP có
```

### 8.6 Ưu tiên sửa bug theo rủi ro release

Một lỗi UI nhỏ có thể để known issue nếu không chặn UAT/release. Một lỗi data scope hoặc business rule phải được xem là blocker dù UI vẫn chạy.

---

## 9. Sprint timeline đề xuất

Sprint 5 được thiết kế theo chu kỳ 2 tuần / 10 ngày làm việc.

| Ngày | Trọng tâm | Kết quả kỳ vọng |
| --- | --- | --- |
| Day 1 | Integration freeze + environment readiness | Staging/UAT deploy được, seed account/test data sẵn sàng |
| Day 2 | Smoke test toàn hệ thống | Danh sách blocker P0/P1 đầu tiên |
| Day 3 | E2E flow Employee + Manager | Flow check-in, nghỉ phép, task, notification chạy xuyên suốt |
| Day 4 | E2E flow HR/Admin + dashboard | HR/system/dashboard/noti admin core chạy được |
| Day 5 | Permission/data scope hardening | Matrix quyền/scope test pass hoặc có bug rõ |
| Day 6 | Regression round 1 + bug fixing | Bug P0/P1 giảm mạnh, build ổn định hơn |
| Day 7 | UAT preparation + dry run | UAT script, account, data, hướng dẫn user hoàn tất |
| Day 8 | UAT execution | Business chạy UAT, feedback được log đầy đủ |
| Day 9 | UAT bug fixing + regression round 2 | Bug UAT critical được sửa/retest |
| Day 10 | Sprint 5 sign-off checkpoint | Báo cáo QA/UAT, known issues, go/no-go sang Sprint 6 |

Nếu sprint thực tế dài 1 tuần, cần cắt giảm phạm vi UAT xuống P0 flow và chuyển một phần regression nâng cao sang Sprint 6.

---

## 10. Workstream A - Integration Freeze & Environment Readiness

### 10.1 Mục tiêu

Đảm bảo toàn bộ nhóm test cùng một build ổn định, cùng một database seed và cùng một environment.

### 10.2 Task chi tiết

| Mã task | Nội dung | Owner | Độ ưu tiên | Output |
| --- | --- | --- | --- | --- |
| IMPL08-A01 | Chốt integration branch/code freeze tạm thời cho Sprint 5 | Tech Lead | P0 | Branch/tag integration |
| IMPL08-A02 | Deploy backend build mới nhất lên staging/UAT | DevOps/BE | P0 | Backend URL/version |
| IMPL08-A03 | Deploy frontend build mới nhất lên staging/UAT | DevOps/FE | P0 | Frontend URL/version |
| IMPL08-A04 | Chạy migration từ database trống trên staging/UAT | BE/DevOps | P0 | Migration pass report |
| IMPL08-A05 | Chạy seed company, module, role, permission, HR, ATT, LEAVE, TASK, NOTI, DASH | BE/QA | P0 | Seed data checklist |
| IMPL08-A06 | Tạo account test theo role/scope | QA/BE | P0 | Account matrix |
| IMPL08-A07 | Bật logging request id, API error, audit log, frontend error boundary | DevOps/BE/FE | P0 | Log access checklist |
| IMPL08-A08 | Xác nhận rollback deploy cơ bản | DevOps | P1 | Rollback note |

### 10.3 Checklist môi trường

- [ ] Frontend staging truy cập được qua HTTPS hoặc URL nội bộ ổn định.
- [ ] Backend API healthcheck pass.
- [ ] Database migration không lỗi.
- [ ] Seed idempotent, chạy lại không tạo dữ liệu trùng.
- [ ] Test account đăng nhập được.
- [ ] Role/permission seed đúng.
- [ ] Notification event/template seed đủ cho flow P0.
- [ ] Dashboard widget config seed đủ cho Employee/Manager/HR/Admin.
- [ ] File upload/download nếu có sử dụng storage test riêng.
- [ ] Log request id có thể truy vết từ frontend -> backend.

---

## 11. Workstream B - Smoke Test Toàn Hệ Thống

### 11.1 Mục tiêu

Xác nhận build integrated không chết ở các luồng cơ bản trước khi đi vào test sâu.

### 11.2 Smoke checklist P0

| Mã | Kịch bản | Actor | Kỳ vọng |
| --- | --- | --- | --- |
| SMOKE-001 | Mở app frontend | Public | App load không trắng màn |
| SMOKE-002 | Login thành công | Employee | Vào Home Portal |
| SMOKE-003 | Logout | Employee | Clear session, về Login |
| SMOKE-004 | Load Home Portal | Employee | Chỉ thấy app có quyền |
| SMOKE-005 | Mở App Switcher | Employee | Hiển thị app list đúng quyền |
| SMOKE-006 | Mở Dashboard | Employee | Widget cơ bản load được |
| SMOKE-007 | Mở Chấm công hôm nay | Employee | Today status load được |
| SMOKE-008 | Check-in/check-out test | Employee | Mutation success hoặc rule block đúng |
| SMOKE-009 | Tạo đơn nghỉ draft/submit | Employee | Đơn tạo được, status đúng |
| SMOKE-010 | Manager xem đơn chờ duyệt | Manager | Thấy đơn trong scope |
| SMOKE-011 | Duyệt/từ chối đơn nghỉ | Manager/HR | Status update, notification phát sinh |
| SMOKE-012 | Mở My Tasks | Employee | Danh sách task load được |
| SMOKE-013 | Cập nhật task status | Employee/Manager | Status/timeline cập nhật |
| SMOKE-014 | Notification dropdown | User | Unread count/list load được |
| SMOKE-015 | Click notification deep link | User | Vào module gốc hoặc forbidden đúng |
| SMOKE-016 | HR mở Employee list | HR | List load, filter cơ bản hoạt động |
| SMOKE-017 | Admin mở user/role/permission | Admin | Màn load, không lỗi quyền |
| SMOKE-018 | API 403 route trái quyền | Employee | UI hiển thị forbidden, backend chặn |

### 11.3 Exit criteria smoke

- Không còn lỗi trắng màn.
- Không còn lỗi không đăng nhập được bằng account test.
- Không còn lỗi API base URL/env sai.
- Không còn lỗi migration/seed blocker.
- Các module chính mở được và render state cơ bản.

---

## 12. Workstream C - End-to-End Integration Flow

### 12.1 Flow E2E bắt buộc

| Mã flow | Tên flow | Module liên quan | Độ ưu tiên |
| --- | --- | --- | --- |
| E2E-001 | Login -> Home Portal -> mở module -> App Switcher | AUTH, FOUNDATION, UI Shell | P0 |
| E2E-002 | Employee check-in/check-out | AUTH, HR, ATT, NOTI, DASH | P0 |
| E2E-003 | Employee gửi yêu cầu điều chỉnh công | ATT, HR, NOTI, DASH | P0 |
| E2E-004 | Manager/HR duyệt điều chỉnh công | ATT, HR, AUTH, NOTI, DASH | P0 |
| E2E-005 | Employee tạo đơn nghỉ -> Manager duyệt -> ATT chặn/tính lại công | LEAVE, ATT, HR, AUTH, NOTI, DASH | P0 |
| E2E-006 | Employee tạo đơn nghỉ -> HR từ chối -> Employee nhận notification | LEAVE, NOTI, DASH | P0 |
| E2E-007 | Employee xem My Tasks -> cập nhật trạng thái -> notification/dashboard cập nhật | TASK, NOTI, DASH | P0 |
| E2E-008 | Manager tạo task/giao task -> assignee nhận notification | TASK, HR, NOTI | P0 |
| E2E-009 | Comment/mention trong task -> notification deep link | TASK, NOTI, AUTH | P1 |
| E2E-010 | Employee gửi yêu cầu sửa hồ sơ -> HR duyệt/từ chối | HR, AUTH, NOTI, DASH | P1 |
| E2E-011 | HR cập nhật hợp đồng -> Dashboard cảnh báo hợp đồng sắp hết hạn | HR, DASH, NOTI optional | P1 |
| E2E-012 | Admin đổi role/permission -> user bị thay đổi menu/action sau refresh | AUTH, FRONTEND Guard | P1 |

### 12.2 Mẫu kiểm thử E2E chi tiết

#### E2E-005: Leave approved affects attendance

| Bước | Actor | Hành động | Kỳ vọng |
| --- | --- | --- | --- |
| 1 | Employee | Login -> mở Nghỉ phép | Vào Leave workspace |
| 2 | Employee | Tạo đơn nghỉ full-day cho ngày làm việc | Preview số ngày nghỉ, số dư phép đúng |
| 3 | Employee | Submit đơn | Status Pending, Manager nhận notification |
| 4 | Manager | Mở notification/deep link | Vào Leave approval detail đúng scope |
| 5 | Manager | Approve đơn | Status Approved, audit/timeline cập nhật |
| 6 | System | Sync sang ATT | Attendance record ngày đó Leave hoặc check-in bị block |
| 7 | Employee | Mở Attendance Today/ngày nghỉ | Nút check-in/out disable, thông báo lý do rõ |
| 8 | Dashboard | Refresh widget | Pending leave giảm, attendance/leave widget cập nhật |

#### E2E-007: Task status affects notification/dashboard

| Bước | Actor | Hành động | Kỳ vọng |
| --- | --- | --- | --- |
| 1 | Manager | Tạo task/giao cho Employee | Task created, assignee nhận notification |
| 2 | Employee | Click notification | Mark read, vào task detail |
| 3 | Employee | Update status In Progress | Status badge update, activity log ghi nhận |
| 4 | Employee | Mark checklist item | Checklist progress update |
| 5 | Employee | Comment/mention Manager | Manager nhận notification nếu rule bật |
| 6 | Dashboard | Refresh task widget | My tasks/team tasks cập nhật |

---

## 13. Workstream D - API Contract & Frontend Integration Hardening

### 13.1 Mục tiêu

Loại bỏ lỗi tích hợp do response contract, field name, error format, pagination hoặc status mapping không thống nhất.

### 13.2 Checklist API contract

| Nhóm | Checklist |
| --- | --- |
| Response success | `success`, `message`, `data`, `meta`, `pagination` nếu list |
| Response error | `success=false`, `message`, `error.code`, `error.type`, `error.details`, `meta.request_id` |
| Validation error | Field error map được vào form |
| Business rule error | UI giữ dữ liệu và hiển thị alert rõ |
| Pagination | `page`, `per_page`, `total`, `total_pages`, `has_next`, `has_prev` |
| Sorting/filter | Whitelist field, không crash nếu filter rỗng |
| Idempotency | Có cho check-in/out, tạo nghỉ, approve/reject nghỉ, tạo task/employee |
| Auth | 401 refresh/retry hoặc redirect login đúng |
| Forbidden | 403 không trả dữ liệu nhạy cảm |
| Conflict | 409 khi record đã bị xử lý bởi người khác |
| Upload/download | Permission check trước khi trả link/file |

### 13.3 Query invalidation bắt buộc sau mutation

| Mutation | Query/cache cần refresh |
| --- | --- |
| Login/logout | Auth context, app registry, sidebar, sensitive query cache |
| Check-in/check-out | Attendance today, attendance records, dashboard attendance widget |
| Submit attendance adjustment | Adjustment list/detail, dashboard pending approval, notification |
| Approve attendance adjustment | Attendance records, adjustment list, dashboard, notification |
| Create leave request | My leave requests, balances, calendar, dashboard, notification |
| Approve/reject leave | Leave approvals, balances, calendar, attendance records/today, dashboard, notification |
| Create/update employee | Employee list/detail, HR dashboard, notification nếu có |
| Submit profile change | My profile, profile request list, HR notification |
| Create/update task | Task list, my tasks, project detail, kanban, dashboard, notification |
| Comment/mention task | Task detail/comment/activity, notification |
| Mark notification read | Unread count, dropdown, notification list/detail |
| Update dashboard config | Dashboard me/type/widgets, widget config list |
| Update role/permission | Auth context của user sau reload, route/menu/action visibility |

---

## 14. Workstream E - Permission & Data Scope Hardening

### 14.1 Mục tiêu

Đảm bảo user chỉ xem và thao tác đúng dữ liệu được phép, cả ở UI và API.

### 14.2 Role/scope test matrix

| Actor | Scope chính | Cần test |
| --- | --- | --- |
| Employee | Own | Chỉ xem hồ sơ/bảng công/đơn nghỉ/task/notification của mình |
| Manager | Team | Xem/duyệt dữ liệu team, không thấy dữ liệu ngoài team |
| HR | Department/Company | Xem HR/ATT/LEAVE theo scope được cấp |
| Admin | Company | Quản trị user/role/settings trong company |
| Super Admin | System | Chỉ nếu MVP bật multi-company/system scope |

### 14.3 Checklist permission/data scope

- [ ] Employee không gọi được API danh sách toàn công ty.
- [ ] Employee không duyệt được đơn nghỉ.
- [ ] Manager không duyệt đơn ngoài team.
- [ ] Manager không xem bảng công phòng ban khác nếu không có scope.
- [ ] HR scope Department không xem dữ liệu Company nếu không được cấp.
- [ ] Admin không xem field nhạy cảm HR nếu thiếu field-level permission.
- [ ] Widget Dashboard không trả dữ liệu nguồn nếu thiếu permission module nguồn.
- [ ] Notification chỉ trả notification của recipient hiện tại.
- [ ] Deep link notification vẫn bị route/API guard nếu user không còn quyền.
- [ ] File private không tải được nếu không có quyền record gốc.
- [ ] Audit log chỉ xem được bởi user có quyền.
- [ ] Frontend không hard-code theo role name.
- [ ] Backend không tin `company_id`, `employee_id`, `user_id` do frontend tự gửi ở nghiệp vụ thông thường.

### 14.4 Negative test bắt buộc

| Mã | Kịch bản | Kỳ vọng |
| --- | --- | --- |
| NEG-PERM-001 | Employee gọi API approve leave bằng Postman | 403 |
| NEG-PERM-002 | Manager đổi request id của employee ngoài team | 403 hoặc 404 theo policy |
| NEG-PERM-003 | Employee mở `/system/users` trực tiếp | UI 403, API 403 |
| NEG-PERM-004 | User click notification target đã mất quyền | Module gốc forbidden |
| NEG-PERM-005 | HR Department gọi dashboard Company overview | 403 hoặc data scoped đúng |
| NEG-PERM-006 | User tải file hồ sơ nhân viên ngoài scope | 403 |

---

## 15. Workstream F - QA Regression & State Hardening

### 15.1 Mục tiêu

Đảm bảo sau khi tích hợp và sửa bug, hệ thống không phá các flow đã chạy đúng ở sprint trước.

### 15.2 Regression suite MVP

| Nhóm | Test chính | Độ ưu tiên |
| --- | --- | --- |
| AUTH | Login/logout/refresh/forgot/reset/change password/session expired | P0 |
| HOME | Home Portal, App Switcher, app visibility, route guard | P0 |
| HR | Employee list/detail/create/update/status/profile change/contract | P0/P1 |
| ATT | Today, check-in/out, records, adjustment, approval, remote request | P0/P1 |
| LEAVE | Balance, create/submit/cancel/approve/reject/calendar/sync ATT | P0 |
| TASK | Project/task/list/detail/status/comment/checklist/kanban/mention | P0/P1 |
| NOTI | Unread count/dropdown/list/detail/mark read/deep link/template | P0/P1 |
| DASH | Dashboard me/type/widget/quick action/cache fallback | P0/P1 |
| SYSTEM | User/role/permission/module settings/audit log | P1 |
| FILE | Upload/download/delete private file | P1 |

### 15.3 UI state checklist

| State | Cần kiểm |
| --- | --- |
| Loading | Skeleton đúng layout, không nhấp nháy dữ liệu trái quyền |
| Empty | Message đúng, CTA chỉ hiện nếu có quyền |
| Error | Có retry, hiển thị request id nếu có |
| Forbidden | Không render menu/action/data trái quyền |
| Disabled | Tooltip/alert lý do rõ ràng |
| Validation | Inline error đúng field, error summary nếu form dài |
| Success | Toast + refresh/redirect đúng |
| Stale | Last updated/refresh đúng nếu dữ liệu cache |
| Scope empty | Phân biệt không có dữ liệu do scope và không có dữ liệu toàn hệ thống |
| Conflict | Hiển thị record đã thay đổi, yêu cầu refresh |
| Degraded | Widget/module lỗi một phần không làm chết toàn trang |

### 15.4 Responsive/accessibility smoke

| Nhóm | Cần kiểm |
| --- | --- |
| Desktop | Sidebar expanded/collapsed, table, drawer, modal |
| Tablet | Sidebar drawer/collapsed, filter wrap, horizontal table scroll |
| Mobile web | Card list, fullscreen drawer/modal, sticky actions, touch target |
| Keyboard | Tab order, Enter/Space action, ESC close modal/dropdown |
| Focus | Focus ring rõ, focus trap trong modal/drawer |
| Screen reader | Icon-only button có aria-label, lỗi form được announce cơ bản |
| Contrast | Status/error/warning không chỉ dựa vào màu |
| Reduced motion | Không phá UX nếu giảm animation |

---

## 16. Workstream G - Dashboard & Notification Hardening

### 16.1 Mục tiêu

Đảm bảo Dashboard và Notification không chỉ render được mà còn đúng quyền, đúng dữ liệu, đúng event và không xử lý nghiệp vụ thay module gốc.

### 16.2 Dashboard checklist

- [ ] `/dashboard/me` trả dashboard type phù hợp user.
- [ ] Employee không thấy Admin/HR widget nếu thiếu quyền.
- [ ] Manager widget chỉ tổng hợp team data.
- [ ] HR widget scope Department/Company đúng.
- [ ] Widget source lỗi thì widget degraded, dashboard tổng vẫn load nếu có thể.
- [ ] Widget có `cached_at` hoặc `last_updated` nếu dùng cache.
- [ ] Quick action điều hướng/gọi module gốc, không xử lý business rule trong DASH.
- [ ] Sau mutation check-in/leave/task, widget refresh hoặc invalidate đúng.
- [ ] Widget không expose dữ liệu nhạy cảm nếu thiếu permission nguồn.
- [ ] Rate limit/refresh spam được xử lý phù hợp nếu backend có.

### 16.3 Notification checklist

- [ ] Event `USER_CREATED`, `PROFILE_CHANGE_SUBMITTED`, `ATTENDANCE_ADJUSTMENT_SUBMITTED`, `LEAVE_REQUEST_SUBMITTED`, `TASK_ASSIGNED`, `TASK_COMMENT_CREATED`, `TASK_MENTIONED` tạo notification đúng recipient nếu MVP bật.
- [ ] Unread count đúng theo user hiện tại.
- [ ] Dropdown chỉ hiển thị notification mới nhất theo limit.
- [ ] Mark read cập nhật unread count/list/detail.
- [ ] Mark all read hoạt động và có loading state.
- [ ] Deep link đi sang module gốc.
- [ ] Target không còn quyền hiển thị forbidden/target unavailable.
- [ ] Notification không chứa dữ liệu nhạy cảm quá mức trong title/body.
- [ ] Delivery log ghi nhận nếu có email/push mock hoặc in-app delivery.
- [ ] Dedupe/idempotency event tránh tạo notification trùng khi retry.

---

## 17. Workstream H - Performance, Reliability & Observability Smoke

### 17.1 Mục tiêu

Đảm bảo MVP không có điểm nghẽn nghiêm trọng trước UAT và Sprint 6.

### 17.2 Performance smoke checklist

| Nhóm | Kỳ vọng MVP |
| --- | --- |
| Login/auth me | Không chậm bất thường, không gọi lặp vô hạn |
| Employee list | Có pagination/filter, không load toàn bộ dữ liệu |
| Attendance records | Query theo tháng/employee/scope có index phù hợp |
| Leave approvals | Pending list load được với filter/scope |
| Task list/Kanban | Không N+1 employee/project summary nghiêm trọng |
| Notification unread | Không scan toàn bảng lớn |
| Dashboard me | 5-8 widget phổ biến phản hồi ổn định hoặc cache |
| Audit log | Có filter/pagination, không trả toàn bộ log |
| Export | Nếu có export lớn, phải giới hạn hoặc background job |

### 17.3 Observability checklist

- [ ] Mỗi API response có request id.
- [ ] Frontend log error có route/screen code nếu có.
- [ ] Backend log có user id/company id/request id ở mức an toàn.
- [ ] Không log token/password/secret/file private content.
- [ ] Có healthcheck backend.
- [ ] Có log migration/seed.
- [ ] Có log notification event failure.
- [ ] Có dashboard/log hoặc cách truy vấn lỗi 500 trên staging/UAT.
- [ ] Có cách xem slow query hoặc SQL log trong môi trường test.

---

## 18. Workstream I - Security & Audit Hardening Smoke

### 18.1 Mục tiêu

Bắt các lỗi bảo mật cơ bản trước khi UAT rộng và trước khi release candidate.

### 18.2 Security smoke checklist

| Nhóm | Checklist |
| --- | --- |
| Auth/session | Token expired, refresh, logout clear cache, inactive/locked account |
| Password | Không trả password hash, reset token không lộ qua log |
| Permission | Backend chặn API trái quyền |
| Data scope | Query luôn filter company/scope đúng |
| Sensitive fields | Field nhạy cảm HR bị mask/ẩn nếu thiếu quyền |
| File security | File private cần permission record gốc |
| CSRF/CORS | Cấu hình phù hợp auth strategy |
| Rate limit | Login/reset/notification/dashboard nên có guard nếu backend hỗ trợ |
| Error leakage | 500 không trả stack trace cho client |
| Audit | Ghi log create/update/delete/approve/reject/permission change |
| Frontend storage | Không lưu access token trong localStorage nếu tránh được |

### 18.3 Audit log checklist

- [ ] Login/logout/security event có log nếu spec yêu cầu.
- [ ] Create/update employee có audit.
- [ ] Profile change approve/reject có audit.
- [ ] Check-in/out/adjustment/manual adjustment có audit hoặc attendance log.
- [ ] Leave submit/approve/reject/cancel có audit/timeline.
- [ ] Task create/update/status/comment có activity log.
- [ ] Role/permission change có audit.
- [ ] Dashboard/notification config change có audit.
- [ ] File upload/download/delete nhạy cảm có access log nếu đã triển khai.

---

## 19. Workstream J - UAT Preparation

### 19.1 Mục tiêu

Chuẩn bị cho business user chạy UAT có kiểm soát, không biến UAT thành demo tự do thiếu dữ liệu/test script.

### 19.2 UAT deliverable

| Mã | Deliverable | Owner | Bắt buộc |
| --- | --- | --- | --- |
| UAT-DEL-001 | UAT scope & objective | Product/QA | Có |
| UAT-DEL-002 | UAT user/account matrix | QA/BE | Có |
| UAT-DEL-003 | UAT test data set | QA/BE | Có |
| UAT-DEL-004 | UAT script theo role | QA/Product | Có |
| UAT-DEL-005 | UAT feedback form | QA/Product | Có |
| UAT-DEL-006 | UAT bug severity guide | QA Lead | Có |
| UAT-DEL-007 | Short user guide/demo note | Product/UI/QA | Có |
| UAT-DEL-008 | Known limitations list | Product/PM | Có |
| UAT-DEL-009 | UAT sign-off template | Product/PM | Có |

### 19.3 UAT account matrix

| Account | Role | Scope | Dữ liệu test cần có |
| --- | --- | --- | --- |
| employee01@demo.local | Employee | Own | Có hồ sơ, shift, balance, task, notification |
| employee02@demo.local | Employee | Own | Thuộc team Manager 1 |
| manager01@demo.local | Manager | Team | Có nhân viên trong team, đơn pending, task team |
| hr01@demo.local | HR | Company hoặc Department | Xem employee list, leave/attendance approvals, contracts |
| admin01@demo.local | Admin | Company | User/role/module/settings/audit |
| superadmin01@demo.local | Super Admin | System | Optional nếu MVP bật multi-company |

### 19.4 UAT script theo role

#### Employee UAT script

1. Login.
2. Kiểm tra Home Portal chỉ hiện app được phép.
3. Mở Dashboard cá nhân.
4. Check-in hoặc xem lý do không thể check-in.
5. Xem bảng công cá nhân.
6. Tạo đơn nghỉ phép.
7. Xem đơn đã gửi và notification kết quả.
8. Xem My Tasks.
9. Cập nhật trạng thái task.
10. Mở notification dropdown/list và deep link.
11. Gửi yêu cầu chỉnh sửa hồ sơ cá nhân nếu scope UAT bao gồm HR self-service.

#### Manager UAT script

1. Login.
2. Mở Dashboard Manager.
3. Xem đơn nghỉ cần duyệt.
4. Duyệt/từ chối một đơn nghỉ.
5. Xem bảng công team.
6. Duyệt/từ chối yêu cầu điều chỉnh công.
7. Tạo/giao task cho nhân viên.
8. Xem task team và task quá hạn.
9. Kiểm tra notification sau action.

#### HR UAT script

1. Login.
2. Mở Dashboard HR.
3. Xem danh sách nhân viên, lọc/tìm kiếm.
4. Mở hồ sơ nhân viên.
5. Cập nhật thông tin nhân viên hoặc hợp đồng.
6. Duyệt/từ chối yêu cầu sửa hồ sơ cá nhân.
7. Xem bảng công/đơn nghỉ toàn công ty theo quyền.
8. Kiểm tra hợp đồng sắp hết hạn nếu có seed.
9. Kiểm tra audit log nếu có quyền.

#### Admin UAT script

1. Login.
2. Mở module System/Auth.
3. Xem user list.
4. Mở role/permission matrix.
5. Kiểm tra module catalog/settings.
6. Kiểm tra notification template/event UI nếu MVP bật admin config.
7. Xem audit log.
8. Kiểm tra app visibility sau khi thay đổi quyền/module status nếu nằm trong scope UAT.

---

## 20. Workstream K - UAT Execution

### 20.1 Quy trình UAT

```text
UAT kickoff
  -> Giới thiệu scope + known limitations
  -> Cấp tài khoản test
  -> Business chạy script theo role
  -> QA hỗ trợ ghi nhận bug/feedback
  -> Product phân loại feedback thành bug/change request/out of scope
  -> Dev fix bug blocker
  -> QA retest
  -> Business xác nhận lại flow chính
  -> UAT sign-off hoặc conditional sign-off
```

### 20.2 Quy tắc ghi nhận UAT feedback

| Loại | Cách xử lý |
| --- | --- |
| Bug | Log vào bug tracker, có severity, bước tái hiện, expected/actual |
| UX issue | Log riêng, Product quyết định fix trong Sprint 5 hay chuyển phase sau |
| Missing feature | Nếu ngoài MVP thì đưa Post-MVP backlog |
| Business rule change | Product đánh giá impact, không sửa ngay nếu phá scope/release |
| Data issue | QA/BE xác định do seed/test data hay bug nghiệp vụ |
| Training issue | Cập nhật user guide/tooltip/copy nếu cần |

### 20.3 UAT pass criteria

- Business user hoàn thành P0 script theo role.
- Không còn bug P0 blocker.
- Bug P1 còn lại có workaround rõ hoặc được Product chấp nhận defer.
- Dữ liệu hiển thị đúng quyền/scope trong các flow UAT.
- Action chính có feedback rõ ràng: loading, success, error, validation.
- Known limitations được stakeholder biết trước khi sign-off.

---

## 21. Workstream L - Bug Triage, Fixing & Retest

### 21.1 Bug severity

| Severity | Định nghĩa | Ví dụ | SLA Sprint 5 |
| --- | --- | --- | --- |
| P0 - Blocker | Không thể tiếp tục UAT hoặc lỗi bảo mật/dữ liệu nghiêm trọng | Không login được, lộ dữ liệu ngoài scope, approve sai đơn | Fix ngay trong ngày |
| P1 - Critical | Chặn flow MVP quan trọng nhưng có thể test phần khác | Không tạo được đơn nghỉ, dashboard chết toàn trang | Fix trong 24-48h |
| P2 - Major | Ảnh hưởng UX/nghiệp vụ nhưng có workaround | Error copy chưa rõ, filter sai case hiếm | Fix nếu còn capacity hoặc trước RC |
| P3 - Minor | Lỗi nhỏ không ảnh hưởng flow chính | Spacing, label, icon, typo | Backlog hardening |
| P4 - Enhancement | Đề xuất cải tiến ngoài bug | Thêm chart, thêm filter nâng cao | Post-MVP backlog |

> **Chuẩn severity:** Thang **P0-P4 ở §21.1 là thang severity chuẩn (canonical)** cho toàn bộ tài liệu. P0/P1/P2 dùng ở §5, §20, §25, §26 là **tập con chặn release** (release-blocking) cần theo dõi trong sprint; **P3/P4** được phân loại là **known issue / backlog** (P3 vào backlog hardening, P4 vào Post-MVP backlog) và không chặn sign-off Sprint 5. P0 được gắn nhãn "Blocker" theo đúng định nghĩa ở §21.1; tránh dùng lại nhãn "Blocker" cho mức severity khác để không trùng nghĩa.

### 21.2 Bug report template

```text
Title:
Severity: P0/P1/P2/P3/P4
Module:
Environment:
Build version:
Actor/account:
Permission/scope:
Precondition:
Steps to reproduce:
Expected result:
Actual result:
Evidence: screenshot/video/log/request id
Impact:
Workaround:
Owner:
Status:
Retest result:
```

### 21.3 Bug workflow

```text
New
  -> Triage
  -> Accepted / Need Info / Duplicate / Won't Fix / Out of Scope
  -> In Progress
  -> Ready for Retest
  -> Retested Pass / Reopen
  -> Closed
```

### 21.4 Daily bug triage agenda

1. Review bug mới từ QA/UAT.
2. Xác nhận severity.
3. Gán owner.
4. Xác định bug nào cần hotfix cùng ngày.
5. Xác định bug nào defer sang Sprint 6.
6. Kiểm tra bug reopen.
7. Cập nhật release readiness risk.

---

## 22. Workstream M - Documentation & Handoff sang Sprint 6

### 22.1 Tài liệu cần cập nhật cuối Sprint 5

| Tài liệu/Artifact | Nội dung cập nhật |
| --- | --- |
| QA execution report | Test pass/fail, coverage, bug summary |
| UAT report | Script result, stakeholder feedback, sign-off status |
| Known issues | Bug còn lại, workaround, owner, target sprint |
| Release readiness checklist | Điều kiện sang Sprint 6/RC |
| API known contract gaps | Endpoint/response còn lệch cần fix trước RC |
| Environment note | Version build, migration, seed, deploy note |
| Product backlog | Feedback UAT chuyển thành backlog hoặc change request |
| Risk register | Rủi ro còn lại trước go-live |

### 22.2 Handoff sang Sprint 6

Cuối Sprint 5, team phải bàn giao cho Sprint 6:

1. Danh sách bug P0/P1 còn mở.
2. Danh sách bug P2/P3 được chấp nhận defer.
3. UAT sign-off hoặc conditional sign-off.
4. Build version ổn định nhất.
5. Migration/seed version đã test.
6. Regression suite cần chạy lại trong Sprint 6.
7. Checklist release candidate còn thiếu.
8. Known limitations cần thông báo stakeholder.

---

## 23. Sprint backlog đề xuất

### 23.1 Epic list

| Epic | Tên epic | Mục tiêu |
| --- | --- | --- |
| IMPL08-EPIC-01 | Environment & Integration Freeze | Có build staging/UAT ổn định |
| IMPL08-EPIC-02 | E2E Integration Testing | Xác nhận flow xuyên module |
| IMPL08-EPIC-03 | Permission & Data Scope Hardening | Không lộ dữ liệu/trái quyền |
| IMPL08-EPIC-04 | Regression & State QA | Không phá flow đã hoàn thành |
| IMPL08-EPIC-05 | Dashboard & Notification Hardening | Widget/event/deep link đúng |
| IMPL08-EPIC-06 | UAT Preparation & Execution | Business kiểm chứng MVP |
| IMPL08-EPIC-07 | Bug Triage & Stabilization | Sửa blocker/critical trước Sprint 6 |
| IMPL08-EPIC-08 | Sprint 6 Handoff | Release readiness checkpoint |

### 23.2 Story/task breakdown

| ID | Task | Owner | Priority | Acceptance criteria |
| --- | --- | --- | --- | --- |
| IMPL08-T001 | Deploy integrated build lên staging/UAT | DevOps | P0 | FE/BE/API/DB version rõ, healthcheck pass |
| IMPL08-T002 | Verify migration + seed from scratch | BE/QA | P0 | DB trống chạy migration+seed pass |
| IMPL08-T003 | Create UAT test users/data | QA/BE | P0 | Có đủ Employee/Manager/HR/Admin data |
| IMPL08-T004 | Execute smoke suite | QA | P0 | Smoke P0 pass hoặc bug logged |
| IMPL08-T005 | Execute Employee E2E flow | QA | P0 | Check-in/leave/task/noti pass |
| IMPL08-T006 | Execute Manager/HR approval E2E flow | QA | P0 | Approvals + scope pass |
| IMPL08-T007 | Execute Admin/system E2E flow | QA | P1 | User/role/module/audit pass |
| IMPL08-T008 | Test permission/data scope negative cases | QA/BE/FE | P0 | 403/forbidden đúng, không lộ data |
| IMPL08-T009 | Test dashboard widgets by role | QA/FE/BE | P0 | Widget đúng role/scope, fallback đúng |
| IMPL08-T010 | Test notification events/deep links | QA/BE/FE | P0 | Event, unread, mark read, target pass |
| IMPL08-T011 | Run regression suite round 1 | QA | P0 | Report pass/fail |
| IMPL08-T012 | Fix P0/P1 bugs round 1 | BE/FE | P0 | Bug ready for retest |
| IMPL08-T013 | Retest fixed bugs | QA | P0 | Pass/reopen clearly |
| IMPL08-T014 | Prepare UAT scripts | QA/Product | P0 | Script by role approved |
| IMPL08-T015 | Run UAT dry run | QA/Product | P1 | No script blocker |
| IMPL08-T016 | Execute UAT with stakeholder | Product/QA | P0 | Feedback logged |
| IMPL08-T017 | Triage UAT feedback | PM/Product/QA | P0 | Bug/change/out-of-scope categorized |
| IMPL08-T018 | Fix UAT blocker bugs | BE/FE | P0 | P0/P1 UAT bug retested |
| IMPL08-T019 | Run regression round 2 | QA | P0 | Critical regression pass |
| IMPL08-T020 | Prepare Sprint 5 QA/UAT report | QA Lead | P0 | Report ready for sign-off |
| IMPL08-T021 | Prepare Sprint 6 handoff checklist | PM/Tech Lead | P0 | Known issues + readiness status |

---

## 24. Test case matrix tổng hợp Sprint 5

| Module | Smoke | E2E | Regression | Permission/scope | UAT | Ghi chú |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| AUTH | Có | Có | Có | Có | Có | Login/logout/refresh/role |
| HOME/FOUNDATION | Có | Có | Có | Có | Có | Home Portal/App Switcher/module visibility |
| HR | Có | Có | Có | Có | Có | Employee/profile change/contract |
| ATT | Có | Có | Có | Có | Có | Today/records/adjustment/remote |
| LEAVE | Có | Có | Có | Có | Có | Balance/request/approval/calendar/sync ATT |
| TASK | Có | Có | Có | Có | Có | My tasks/detail/status/comment/checklist |
| NOTI | Có | Có | Có | Có | Có | Badge/dropdown/list/deep link |
| DASH | Có | Có | Có | Có | Có | Role widgets/cache/fallback |
| SYSTEM | Có | Một phần | Có | Có | Admin only | User/role/permission/audit/settings |
| FILE | Một phần | Một phần | Có | Có | Optional | Upload/download private file |

### 24.1 Exit metrics (ngưỡng định lượng)

Bảng phủ test ở trên chỉ thể hiện mức độ bao phủ (Có/Một phần). Để tránh đánh giá định tính mơ hồ, Sprint 5 áp dụng các **ngưỡng exit định lượng** sau khi kết sprint:

| Chỉ số | Ngưỡng exit Sprint 5 |
| --- | --- |
| P0 smoke pass-rate | = 100% |
| Regression pass-rate (P0/P1) | >= 95% |
| Tỷ lệ P0 test case đã execute | = 100% (tất cả P0 test case phải được chạy, không để "Not run") |
| Số bug P0 còn mở khi kết sprint | = 0 |
| Số bug P1 còn mở khi kết sprint | <= [ngưỡng thống nhất với Product/QA Lead] và đều có owner + workaround |
| UAT P0 flow pass-rate | = 100% |

> Các ngưỡng trên là điều kiện exit bắt buộc của QA hardening; nếu chưa đạt, Sprint 5 chỉ có thể kết ở trạng thái **Conditional Go** (xem §26.2) với điều kiện và owner rõ ràng.

---

## 25. Definition of Done Sprint 5

Sprint 5 được xem là hoàn thành khi đạt các điều kiện sau:

### 25.1 Build/environment

- [ ] Staging/UAT environment chạy ổn định.
- [ ] Migration + seed chạy được từ database trống.
- [ ] FE/BE build version được ghi nhận.
- [ ] Test account/data có thể tái tạo.

### 25.2 Integration

- [ ] P0 E2E flow pass hoặc có workaround được Product chấp nhận.
- [ ] Dashboard và Notification tích hợp được với module nguồn.
- [ ] Query invalidation sau mutation chính hoạt động.
- [ ] Notification deep link không bypass permission/business rule.

### 25.3 QA hardening

- [ ] Smoke suite pass (P0 smoke pass-rate = 100%, xem §24.1).
- [ ] Regression P0/P1 pass (regression pass-rate >= 95%, xem §24.1).
- [ ] Tất cả P0 test case đã được execute (không còn "Not run").
- [ ] Permission/data scope negative test pass.
- [ ] Không còn bug P0 mở (= 0).
- [ ] Số bug P1 còn mở <= ngưỡng thống nhất, đều có owner + workaround, được Product/Tech Lead chấp nhận.

### 25.4 UAT

- [ ] UAT script theo role đã chạy.
- [ ] Feedback UAT đã phân loại.
- [ ] UAT blocker đã fix/retest hoặc được ghi conditional sign-off.
- [ ] Business stakeholder xác nhận flow MVP đủ điều kiện chuyển Sprint 6 hoặc ghi rõ điều kiện còn lại.

### 25.5 Handoff

- [ ] QA/UAT report hoàn tất.
- [ ] Known issues list hoàn tất.
- [ ] Release readiness checkpoint cập nhật.
- [ ] Sprint 6 backlog gồm stabilization/RC items đã rõ.

---

## 26. Go/No-Go checkpoint sang Sprint 6

### 26.1 Go sang Sprint 6 nếu

1. Không còn P0 bug.
2. P1 bug còn lại không chặn release candidate hoặc có workaround rõ.
3. UAT P0 flow đã pass.
4. Permission/data scope test trọng yếu pass.
5. Build staging/UAT ổn định.
6. Migration/seed pass.
7. QA Lead, Product Owner, Tech Lead đồng ý chuyển sang stabilization/RC.

### 26.2 Conditional Go nếu

1. Còn P1 nhưng có owner và target fix trong 1-2 ngày đầu Sprint 6.
2. UAT đã pass phần lớn nhưng còn feedback UX nhỏ.
3. Performance còn một số cảnh báo nhưng chưa gây timeout/blocker.
4. Documentation còn thiếu nhẹ nhưng không ảnh hưởng test/release.

### 26.3 No-Go nếu

1. Không login được hoặc session/permission lỗi nghiêm trọng.
2. Có lỗi lộ dữ liệu ngoài scope.
3. Flow nghỉ phép/chấm công/task P0 không chạy được.
4. Migration/seed không ổn định.
5. UAT không thể thực hiện do environment/build lỗi.
6. Dashboard/notification gây lỗi toàn app hoặc loop request nghiêm trọng.
7. Không có cách truy vết bug qua log/request id.

---

## 27. Rủi ro và phương án giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Integration trễ do API/FE contract lệch | Không kịp UAT | Contract review hằng ngày, mock/adapter tạm nếu cần |
| Bug permission/data scope phát hiện muộn | Rủi ro bảo mật/release | Chạy negative test từ Day 5, ưu tiên P0 |
| Seed data không đủ giống thực tế | UAT sai lệch | Tạo data theo role/scope/scenario trước UAT |
| Dashboard query chậm | UX kém, timeout | Cache/TTL, giới hạn widget, fallback degraded |
| Notification trùng hoặc sai recipient | User mất tin tưởng | Idempotency/dedupe, test event-recipient matrix |
| UAT feedback biến thành yêu cầu mới | Trôi scope | Product phân loại bug vs enhancement, đưa post-MVP nếu ngoài scope |
| Fix bug gây regression | Mất ổn định build | Retest + regression focused theo module liên quan |
| Environment không ổn định | Chậm QA/UAT | Freeze deploy window, rollback note, healthcheck |
| Không đủ thời gian responsive/accessibility | UI chưa polish | Smoke P0/P1 trước, chi tiết nâng cao chuyển Sprint 6 |
| Log thiếu request id | Khó debug | Bắt buộc request id trước UAT |

---

## 28. Open questions cần chốt trong Sprint 5

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| IMPL08-OQ-001 | Sprint 5 UAT chạy trên staging chung hay môi trường UAT riêng? | DevOps/PM | Cao |
| IMPL08-OQ-002 | UAT cần bao nhiêu business user thật tham gia? | Product | Cao |
| IMPL08-OQ-003 | Có yêu cầu sign-off chính thức bằng biên bản hay chỉ checkpoint nội bộ? | Product/PM | Cao |
| IMPL08-OQ-004 | Realtime notification có bắt buộc cho MVP không hay polling/refresh là đủ? | Product/Tech Lead | Trung bình |
| IMPL08-OQ-005 | Dashboard widget cache TTL mặc định là bao lâu cho UAT? | BE/Tech Lead | Trung bình |
| IMPL08-OQ-006 | Field nhạy cảm HR nào phải mask trong UAT demo? | Product/HR | Cao |
| IMPL08-OQ-007 | Có cho phép defer bug P1 UX sang Sprint 6 không? | Product/QA Lead | Trung bình |
| IMPL08-OQ-008 | UAT có test export file hay chuyển sang release hardening? | Product/QA | Thấp |
| IMPL08-OQ-009 | Có test mobile web chính thức trong UAT không? | Product/UI/QA | Trung bình |
| IMPL08-OQ-010 | Có cần backup database trước mỗi UAT session không? | DevOps/QA | Trung bình |

---

## 29. Báo cáo cuối Sprint 5 - Template

```text
Sprint: Sprint 5 - Integration, QA Hardening & UAT
Build FE:
Build BE:
Database migration version:
Environment:
Test period:

1. Scope tested
- AUTH:
- HR:
- ATT:
- LEAVE:
- TASK:
- NOTI:
- DASH:
- SYSTEM:

2. Test summary
- Total test cases:
- Passed:
- Failed:
- Blocked:
- Not run:

3. Bug summary
- P0 open/closed:
- P1 open/closed:
- P2 open/closed:
- P3/P4:

4. UAT result
- UAT participants:
- Scripts executed:
- Passed flows:
- Failed flows:
- Key feedback:
- Sign-off status:

5. Release readiness
- Go / Conditional Go / No-Go:
- Conditions if any:

6. Known issues
- Issue:
- Impact:
- Workaround:
- Owner:
- Target sprint:

7. Recommendation for Sprint 6
- Stabilization items:
- RC blockers:
- Documentation updates:
- DevOps/release tasks:
```

---

## 30. Capacity & Estimation

### 30.1 Thang ước lượng tham chiếu

Sprint 5 dùng chung thang Story Point định nghĩa ở **IMPLEMENTATION-02 §3.5** (1 = sửa nhỏ; 2 = task nhỏ ít dependency; 3 = story nhỏ 1 API/1 UI state; 5 = story vừa có API + UI + test cơ bản; 8 = story lớn nhiều state/quyền/dependency; 13 = story rất lớn cần tách task kỹ thuật). Story lớn hơn 13 point phải tách trước khi đưa vào sprint.

### 30.2 Capacity Sprint 5

| Thông số | Giá trị |
| --- | --- |
| Thời lượng sprint | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 BE |
| Frontend | 2-4 FE |
| QA | 1-2 QA |
| DevOps | 1 DevOps |
| Velocity tham chiếu | ~40-80 point/sprint |

### 30.3 Story và point Sprint 5

Sprint 5 nhận các story từ IMPLEMENTATION-02: story 097 (responsive P0, EPIC-09 §8.10), 104-105 (EPIC-10 §8.11) và 106-110 (EPIC-11 §8.12).

| Story ID | EPIC | Nội dung tóm tắt | Priority | Point |
| --- | --- | --- | --- | ---: |
| IMP02-STORY-097 | EPIC-09 | Chuẩn hóa responsive mobile web cho P0 flows | P1 | 8 |
| IMP02-STORY-104 | EPIC-10 | Field-level permission & export permission | P0 | 8 |
| IMP02-STORY-105 | EPIC-10 | Chuẩn hóa OpenAPI/Swagger contract theo module | P0 | 8 |
| IMP02-STORY-106 | EPIC-11 | Test case matrix theo module và role | P0 | 13 |
| IMP02-STORY-107 | EPIC-11 | API contract test + permission/scope test | P0 | 13 |
| IMP02-STORY-108 | EPIC-11 | E2E test flow P0 | P0 | 13 |
| IMP02-STORY-109 | EPIC-11 | Security testing cơ bản | P0 | 8 |
| IMP02-STORY-110 | EPIC-11 | Performance smoke/load test MVP | P1 | 8 |
| **Tổng** | | | | **79** |

### 30.4 Nhận định capacity

79 point về lý thuyết là **khả thi trong 1 sprint 2 tuần** với velocity tham chiếu ~40-80 point/sprint, nhưng đây là sprint tích hợp/QA nên tải thực tế phụ thuộc nhiều vào **số bug tồn từ Sprint 2-4**. Nếu backlog bug lớn, đội phải ưu tiên xử lý theo severity và đảm bảo **UAT chỉ tập trung vào P0** trước; phần regression nâng cao và bug P2 trở xuống có thể defer sang Sprint 6 (xem §22.2 và §26.2). Velocity QA/integration thường khó tuyến tính như sprint xây tính năng, do đó Product Owner và Tech Lead cần theo dõi bug burn-down hằng ngày để điều chỉnh phạm vi UAT.

---

## 31. Kết luận

IMPLEMENTATION-08 là sprint bản lề trước khi hệ thống bước vào release candidate.

Tư duy triển khai Sprint 5:

```text
Không xây thêm tính năng lớn
-> Ghép toàn hệ thống
-> Test luồng thật
-> Siết quyền và data scope
-> Hardening error/state/notification/dashboard
-> Chạy UAT có kiểm soát
-> Sửa bug blocker/critical
-> Bàn giao rõ sang Sprint 6
```

Sau khi hoàn thành Sprint 5, bước tiếp theo là:

```text
IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan
```

Sprint 6 sẽ tập trung vào stabilization cuối cùng, release candidate, security/performance readiness, deployment rehearsal, rollback plan, go-live checklist và post-go-live support.
