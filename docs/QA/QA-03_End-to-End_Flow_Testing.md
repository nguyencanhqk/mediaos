# QA-03: END-TO-END FLOW TESTING
# KIỂM THỬ LUỒNG NGHIỆP VỤ XUYÊN MODULE

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-03 |
| Tên tài liệu | End-to-End Flow Testing |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release Readiness - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01, QA-02 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

QA-03 định nghĩa chiến lược và bộ kịch bản kiểm thử **End-to-End Flow Testing** cho MVP của hệ thống quản lý doanh nghiệp nội bộ.

Khác với unit test, integration test hoặc test case theo từng module riêng lẻ, QA-03 tập trung kiểm thử các luồng thực tế từ góc nhìn người dùng:

```text
User đăng nhập
-> vào Home Portal
-> mở module
-> thao tác nghiệp vụ
-> dữ liệu được ghi nhận
-> thông báo được tạo
-> dashboard được cập nhật
-> quyền và data scope được kiểm soát
```

Tài liệu này giúp QA, Product, Frontend, Backend và DevOps thống nhất:

1. Luồng E2E nào bắt buộc phải kiểm thử trước khi release MVP.
2. Actor nào tham gia từng luồng.
3. Dữ liệu seed cần chuẩn bị.
4. Môi trường test cần có gì.
5. Test case E2E nào nên tự động hóa.
6. Test case nào kiểm thử thủ công trước UAT.
7. Điều kiện pass/fail và tiêu chí chặn release.
8. Cách kiểm soát regression xuyên module khi thay đổi AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH hoặc FOUNDATION.

---

## 3. Vị trí QA-03 trong roadmap QA

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

QA-03 là cầu nối giữa:

| Tài liệu | Vai trò |
| --- | --- |
| UI-03 | Chốt user flow MVP cần kiểm thử |
| UI-04 | Chốt màn hình P0/P1 cần đi qua trong E2E |
| UI-09 | Chốt state, permission và kỳ vọng UI theo module |
| API-01 -> API-08 | Chốt API contract, permission, data scope, audit, notification event |
| FRONTEND-* | Chốt cách frontend route guard, query invalidation, state handling |
| BACKEND-* | Chốt service, transaction, audit, event, cache, job và release readiness |
| QA-02 | Cung cấp test case theo module để liên kết thành E2E flow |

---

## 4. Nguyên tắc kiểm thử E2E

### 4.1 Kiểm thử theo hành vi thật của người dùng

E2E test phải thao tác gần giống người dùng cuối:

```text
Open browser
-> login
-> click app
-> điền form
-> submit
-> xác nhận
-> kiểm tra UI state
-> kiểm tra notification/dashboard/record liên quan
```

Không thay thế hoàn toàn UI action bằng API, trừ các bước setup dữ liệu hoặc cleanup.

### 4.2 Backend vẫn là nguồn kiểm soát quyền cuối cùng

E2E phải kiểm tra cả hai lớp:

1. Frontend không hiển thị app/menu/button trái quyền.
2. Backend vẫn trả 401/403/422/409 phù hợp nếu gọi trực tiếp API trái quyền hoặc dữ liệu ngoài scope.

### 4.3 Luồng xuyên module phải kiểm tra side-effect

Một flow được xem là pass khi nghiệp vụ chính và các side-effect liên quan đều đúng.

Ví dụ với leave approval:

```text
Employee gửi đơn nghỉ
-> Manager thấy đơn trong scope
-> Manager approve
-> Leave balance bị trừ đúng
-> ATT cập nhật ngày công Leave
-> Notification gửi cho Employee
-> Dashboard Manager giảm pending count
-> Audit log có action approve
```

### 4.4 Không dựa vào dữ liệu ngẫu nhiên

Test E2E phải dùng seed data ổn định, có mã định danh rõ ràng:

```text
e2e.employee01@company.test
e2e.manager01@company.test
e2e.hr01@company.test
e2e.admin01@company.test
```

### 4.5 E2E không thay thế test module

E2E chỉ kiểm thử các đường đi quan trọng. Các biến thể chi tiết theo field, validation, enum, filter, pagination, state nhỏ vẫn nằm ở QA-02 và API/module tests.

### 4.6 Mỗi flow phải có assertion ở nhiều tầng

| Tầng | Assertion |
| --- | --- |
| UI | Màn hình, trạng thái, text, button, badge, route, toast |
| API | Response success/error, status code, error code, allowed_actions |
| Data | Record tạo/cập nhật đúng, không trùng, đúng scope |
| Event | Notification event, dashboard invalidation, audit log |
| Security | Không lộ dữ liệu nhạy cảm, không vượt quyền |
| Performance cơ bản | Flow không timeout, dashboard/widget không làm sập toàn trang |

---

## 5. Phạm vi E2E MVP

### 5.1 Trong phạm vi QA-03

| Nhóm | Nội dung |
| --- | --- |
| AUTH | Login, logout, token expired, refresh, forbidden route |
| HOME | Home Portal, App Switcher, app registry, recent app, dirty form guard |
| DASH | Dashboard theo role, widget source, quick action, degraded widget |
| HR | My Profile, profile change request, HR approve/reject, employee list/detail scope |
| ATT | Today attendance, check-in, check-out, leave block, attendance records, adjustment request |
| LEAVE | Create draft, submit, approve, reject, cancel, balance, ATT sync, notification |
| TASK | My tasks, create/assign task, status update, comment, mention, Kanban, notification |
| NOTI | Unread count, dropdown, mark read, mark all read, deep link, target forbidden |
| SYSTEM | Permission change effect, module disabled, audit visibility cơ bản |
| Cross-module | Leave -> ATT -> NOTI -> DASH, Task -> NOTI -> DASH, HR -> NOTI -> DASH |

### 5.2 Ngoài phạm vi MVP E2E

| Nhóm | Lý do |
| --- | --- |
| Payroll | Phase 2 |
| Recruitment | Phase 2 |
| Asset | Phase 3 |
| Room booking | Phase 3 |
| Chat/Social realtime | Phase 4 |
| AI summary/automation | Phase 5 |
| Native mobile app | Phase riêng |
| Device attendance physical sync | Phase sau |
| Advanced BI/export dashboard | Phase sau |

---

## 6. Actor và tài khoản test chuẩn

### 6.1 Actor

| Actor | Mã | Vai trò test |
| --- | --- | --- |
| Employee | EMP | Chấm công, xin nghỉ, xem task, xem notification |
| Manager | MGR | Duyệt nghỉ, xem team, giao task, xử lý task team |
| HR | HR | Quản lý nhân sự, xử lý hồ sơ, xem bảng công/leave scope rộng |
| Company Admin | ADMIN | Cấu hình user/role/module, dashboard config |
| Super Admin | SA | Kiểm thử scope System nếu MVP bật multi-tenant |
| System/Job | SYS | Missing checkout, dashboard cache invalidation, notification event |

### 6.2 Tài khoản seed đề xuất

| Mã | Email | Role | Department | Manager | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| EMP01 | `e2e.employee01@company.test` | Employee | Engineering | MGR01 | Nhân viên chính để test self-service |
| EMP02 | `e2e.employee02@company.test` | Employee | Engineering | MGR01 | Nhân viên cùng team |
| EMP03 | `e2e.employee03@company.test` | Employee | Sales | MGR02 | Nhân viên khác team để test scope denied |
| MGR01 | `e2e.manager01@company.test` | Manager + Employee | Engineering | HR01 | Duyệt team Engineering |
| MGR02 | `e2e.manager02@company.test` | Manager + Employee | Sales | HR01 | Dùng kiểm tra khác team |
| HR01 | `e2e.hr01@company.test` | HR + Employee | HR | ADMIN01 | Scope Company hoặc Department theo seed |
| ADMIN01 | `e2e.admin01@company.test` | Company Admin | Admin |  | Cấu hình hệ thống |
| SA01 | `e2e.superadmin01@system.test` | Super Admin | System |  | Nếu bật System scope |

---

## 7. Dữ liệu seed bắt buộc cho E2E

### 7.1 Foundation

| Nhóm | Dữ liệu |
| --- | --- |
| Company | Company active: `E2E Company` |
| Modules | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION active |
| Settings | Timezone `Asia/Ho_Chi_Minh`, work week Mon-Fri |
| Public holidays | Ít nhất 1 ngày nghỉ lễ để test ATT/LEAVE rule |
| Sequence | Employee code, leave request code, project code |
| Audit | Bật audit cho action nhạy cảm |

### 7.2 HR

| Nhóm | Dữ liệu |
| --- | --- |
| Departments | Engineering, Sales, HR, Admin |
| Positions | Developer, Sales Executive, HR Executive, Manager |
| Employees | EMP01, EMP02, EMP03, MGR01, MGR02, HR01, ADMIN01 |
| Employee status | EMP01/EMP02/EMP03/MGR01/HR01 active hoặc probation |
| Manager relation | EMP01/EMP02 -> MGR01, EMP03 -> MGR02 |
| Profile change fields | Phone, address, emergency contact được phép request |

### 7.3 ATT

| Nhóm | Dữ liệu |
| --- | --- |
| Shift | Fixed shift 08:00-17:00 |
| Attendance rule | Late after 08:00, early leave before 17:00, required minutes 480 |
| Shift assignment | Company default + Engineering override nếu cần |
| Remote rule | Remote request enabled, auto attendance optional |
| Adjustment rule | Employee submit, Manager/HR approve |

### 7.4 LEAVE

| Nhóm | Dữ liệu |
| --- | --- |
| Leave type | Annual Leave, Sick Leave |
| Leave policy | Annual leave có balance |
| Leave balance | EMP01 có đủ balance, EMP02 có balance thấp để test insufficient |
| Approval rule | Manager duyệt team, HR có thể xử lý toàn công ty |
| Sync rule | Approved leave full-day sync sang ATT và block check-in |

### 7.5 TASK

| Nhóm | Dữ liệu |
| --- | --- |
| Project | `E2E Project Alpha` |
| Members | MGR01 owner, EMP01/EMP02 members |
| Task status | Todo, In Progress, In Review, Done, Cancelled |
| Task priority | Low, Medium, High, Urgent |
| Seed task | Một task assigned cho EMP01, một task overdue, một task private |

### 7.6 NOTI/DASH

| Nhóm | Dữ liệu |
| --- | --- |
| Notification events | LEAVE_REQUEST_SUBMITTED, LEAVE_REQUEST_APPROVED, TASK_ASSIGNED, TASK_MENTIONED, ATT_MISSING_CHECKOUT |
| Notification templates | In-app template active |
| Dashboard widgets | Attendance today, My tasks, Pending leave, Unread notifications, HR overview |
| Widget config | Employee, Manager, HR, Admin dashboard active theo role |

---

## 8. Môi trường kiểm thử

### 8.1 Local E2E

Dùng cho developer chạy trước khi merge.

```text
Frontend local
Backend local
PostgreSQL local/test container
Seed E2E deterministic
Email/push external mocked hoặc disabled
```

### 8.2 Staging E2E

Dùng cho QA automation và release candidate.

```text
Frontend staging
Backend staging
Database staging riêng cho E2E hoặc schema/tenant riêng
Valkey/cache/job worker thật
Notification in-app thật
External provider dùng sandbox
```

### 8.3 Production smoke

Chỉ chạy smoke không phá dữ liệu thật.

```text
Login test account
Open Home/Dashboard
Open Notification dropdown
Open read-only page
Không tạo/sửa/xóa dữ liệu nghiệp vụ thật nếu chưa có tenant sandbox
```

---

## 9. Công cụ automation đề xuất

| Nhóm | Công cụ đề xuất |
| --- | --- |
| Browser E2E | Playwright |
| API helper | Playwright request context hoặc custom API client |
| Test runner | Playwright Test |
| Test data | Seed script + API data builder |
| Visual smoke | Screenshot comparison cho P0 layout nếu cần |
| Report | HTML report, JUnit XML, trace viewer |
| CI | GitHub Actions/GitLab CI/Jenkins |
| Test tags | `@smoke`, `@critical`, `@regression`, `@security`, `@cross-module`, `@mobile` |

Có thể dùng Cypress nếu team đã quen, nhưng Playwright phù hợp hơn cho multi-browser, storage state, trace, parallel và mobile viewport.

---

## 10. Cấu trúc thư mục automation đề xuất

```text
tests/
  e2e/
    auth/
      login.spec.ts
      logout-session.spec.ts
    home/
      home-portal.spec.ts
      app-switcher.spec.ts
    attendance/
      attendance-today.spec.ts
      attendance-adjustment.spec.ts
    leave/
      leave-request-approval.spec.ts
      leave-attendance-sync.spec.ts
    task/
      task-assignment-notification.spec.ts
      task-kanban.spec.ts
    notification/
      notification-dropdown-deeplink.spec.ts
    dashboard/
      dashboard-role-widgets.spec.ts
      dashboard-cross-module-refresh.spec.ts
    hr/
      profile-change-request.spec.ts
    security/
      permission-scope-e2e.spec.ts
    responsive/
      employee-mobile-flow.spec.ts
  fixtures/
    users.ts
    test-data.ts
    routes.ts
  pages/
    LoginPage.ts
    HomePage.ts
    AppSwitcher.ts
    AttendanceTodayPage.ts
    LeavePage.ts
    TaskPage.ts
    NotificationPanel.ts
    DashboardPage.ts
  api/
    auth-api.ts
    hr-api.ts
    attendance-api.ts
    leave-api.ts
    task-api.ts
    notification-api.ts
    dashboard-api.ts
  utils/
    seed.ts
    cleanup.ts
    wait-for-event.ts
    assertions.ts
    test-tags.ts
```

---

## 11. Chiến lược setup và cleanup dữ liệu

### 11.1 Setup trước test suite

```text
1. Reset tenant E2E hoặc tạo tenant test mới.
2. Seed company/module/settings.
3. Seed roles/permissions.
4. Seed users/employees/departments.
5. Seed shifts/rules/leave balances/projects/widgets/templates.
6. Verify health check và seed checksum.
```

### 11.2 Setup trước từng test

Ưu tiên tạo dữ liệu riêng theo test code:

```text
QA03-E2E-LEAVE-001
-> employee: emp_leave_001
-> leave_request_code: E2E-LV-001
-> idempotency_key: qa03-leave-001-submit
```

### 11.3 Cleanup sau test

Có 2 hướng:

| Hướng | Khi dùng |
| --- | --- |
| Reset database/tenant sau mỗi suite | CI/staging E2E ổn định |
| Soft cleanup theo test run id | Khi không thể reset DB thường xuyên |

Mọi data E2E nên có `test_run_id` hoặc prefix dễ nhận diện:

```text
E2E_20260620_001
```

---

## 12. Test suite phân tầng

### 12.1 Smoke E2E

Chạy mỗi PR hoặc mỗi deploy staging.

| Mã | Flow | Tag |
| --- | --- | --- |
| QA03-SMOKE-001 | Login -> Home Portal -> Dashboard | `@smoke @critical` |
| QA03-SMOKE-002 | Open App Switcher -> Attendance Today | `@smoke` |
| QA03-SMOKE-003 | Check-in hoặc check current status | `@smoke @attendance` |
| QA03-SMOKE-004 | Notification unread/dropdown load | `@smoke @noti` |
| QA03-SMOKE-005 | Employee không vào được Admin route | `@smoke @security` |

### 12.2 Critical E2E

Chạy trước merge vào release branch và trước UAT.

| Mã | Flow | Tag |
| --- | --- | --- |
| QA03-CRIT-001 | Login -> Home -> App -> Workspace -> Logout | `@critical` |
| QA03-CRIT-002 | Check-in -> Check-out -> Attendance record | `@critical @attendance` |
| QA03-CRIT-003 | Create leave -> Submit -> Manager approve -> ATT sync -> NOTI -> DASH | `@critical @cross-module` |
| QA03-CRIT-004 | Task assigned -> NOTI -> deep link -> update status -> comment | `@critical @task` |
| QA03-CRIT-005 | Permission/data scope Team vs Company | `@critical @security` |

### 12.3 Full Regression E2E

Chạy nightly hoặc trước release candidate.

Bao gồm toàn bộ flow E2E từ mục 14 đến mục 43 của tài liệu này.

---

## 13. Quy ước mã test case E2E

Format:

```text
QA03-E2E-{MODULE_OR_FLOW}-{NUMBER}
```

Ví dụ:

```text
QA03-E2E-AUTH-001
QA03-E2E-HOME-001
QA03-E2E-ATT-001
QA03-E2E-LEAVE-001
QA03-E2E-TASK-001
QA03-E2E-NOTI-001
QA03-E2E-DASH-001
QA03-E2E-XMOD-001
QA03-E2E-SEC-001
```

Mỗi test case cần có:

| Trường | Bắt buộc |
| --- | --- |
| Mã test | Có |
| Tên test | Có |
| Priority | Có |
| Actor | Có |
| Preconditions | Có |
| Test data | Có |
| Steps | Có |
| Expected result | Có |
| Assertions | Có |
| Automation | Có/Không/Manual |
| Tags | Có |
| Related flow/screen/API | Có |

---

# PHẦN A: AUTH, HOME PORTAL, APP SWITCHER

---

## 14. QA03-E2E-AUTH-001: Login thành công vào Home Portal

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR, HR, ADMIN |
| Automation | Yes |
| Tags | `@smoke @critical @auth` |
| Related | UI03-FLOW-001, UI-AUTH-SCREEN-001, UI-HOME-SCREEN-001 |

### Preconditions

1. User active.
2. Company active.
3. User có ít nhất một app được phép.
4. Backend auth API hoạt động.

### Steps

| Bước | Thao tác |
| --- | --- |
| 1 | Mở `/login` |
| 2 | Nhập email/password hợp lệ |
| 3 | Click `Đăng nhập` |
| 4 | Chờ redirect |
| 5 | Kiểm tra Home Portal hiển thị |
| 6 | Kiểm tra app grid theo quyền user |
| 7 | Kiểm tra topbar có notification badge/avatar |

### Expected result

1. User được redirect về `/home` nếu không có returnUrl.
2. Home Portal chỉ hiển thị app được cấp quyền.
3. Không có app trái quyền render chớp nhoáng trong lúc loading.
4. Auth context, employee context, permission và data scope được load thành công.
5. Session được giữ khi refresh trang.

### Assertions

| Tầng | Assertion |
| --- | --- |
| UI | URL `/home`, app cards đúng quyền |
| API | `auth/me`, `auth/me/permissions`, `modules/my-apps` success |
| Security | Không thấy app Admin nếu user không có quyền |
| State | Loading không lộ dữ liệu trái quyền |

---

## 15. QA03-E2E-AUTH-002: Return URL và route guard

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@auth @security @route-guard` |

### Scenario A: Có quyền returnUrl

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Logout | Session clear |
| 2 | Mở `/leave/me/requests` | Redirect `/login?returnUrl=/leave/me/requests` |
| 3 | Login bằng EMP01 | Redirect về `/leave/me/requests` |
| 4 | Load màn hình | Danh sách đơn nghỉ của tôi hiển thị |

### Scenario B: Không có quyền returnUrl

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Logout |
| 2 | Mở `/system/users` |
| 3 | Login bằng EMP01 |
| 4 | Hệ thống kiểm tra quyền |
| 5 | Redirect `/home` hoặc `/403` |
| 6 | Backend nếu gọi API vẫn trả 403 |

---

## 16. QA03-E2E-HOME-001: Mở app từ Home Portal

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@home @navigation @smoke` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Tại Home Portal, search `chấm công` |
| 3 | Click app `Chấm công` |
| 4 | Hệ thống điều hướng route mặc định |
| 5 | Workspace ATT hiển thị |
| 6 | Sidebar ATT và Topbar chung hiển thị |
| 7 | Recent app cập nhật nếu API hỗ trợ |

### Expected result

```text
/home
-> click Chấm công
-> /attendance/today
-> Attendance Today screen loaded
```

---

## 17. QA03-E2E-HOME-002: Đổi app bằng App Switcher và dirty form guard

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@home @app-switcher @dirty-form` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/leave/requests/new` |
| 3 | Nhập dữ liệu form nhưng chưa lưu |
| 4 | Click nút `Ứng dụng` trên topbar |
| 5 | Chọn app `Công việc` |
| 6 | Confirm dirty form xuất hiện |
| 7 | Click `Hủy` |
| 8 | Vẫn ở form nghỉ phép, dữ liệu còn nguyên |
| 9 | Mở App Switcher lần nữa, chọn `Công việc`, click `Rời trang` |
| 10 | Điều hướng sang `/tasks/my-tasks` |

### Expected result

1. App Switcher mở được từ màn protected.
2. Dirty form guard chặn rời trang nếu chưa xác nhận.
3. User không mất dữ liệu khi chọn Hủy.
4. Route mới vẫn qua route guard.

---

# PHẦN B: ATTENDANCE E2E

---

## 18. QA03-E2E-ATT-001: Check-in thành công

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@critical @attendance @smoke` |
| Related | UI03-FLOW-005, API-04 ATT |

### Preconditions

1. EMP01 active/probation.
2. Hôm nay là ngày làm việc.
3. EMP01 chưa check-in.
4. EMP01 không có leave full-day approved trong ngày.
5. EMP01 có permission `ATT.ATTENDANCE.CHECK_IN`.

### Steps

| Bước | Thao tác |
| --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/attendance/today` |
| 3 | Kiểm tra trạng thái `Chưa check-in` |
| 4 | Click `Check-in` |
| 5 | Confirm nếu rule yêu cầu |
| 6 | Submit |
| 7 | Chờ toast success |
| 8 | Refresh today status |
| 9 | Mở bảng công cá nhân tháng hiện tại |

### Expected result

1. Button `Check-in` hiển thị khi backend trả allowed action.
2. Sau submit, hệ thống tạo attendance record.
3. Attendance log có loại `CHECK_IN`.
4. UI hiển thị giờ check-in từ server.
5. Next action là `Check-out`.
6. Dashboard attendance widget cập nhật sau invalidation/cache refresh.

### Assertions

| Tầng | Assertion |
| --- | --- |
| UI | Toast success, status `Checked-in` |
| API | `POST /attendance/check-in` success |
| Data | Có attendance record đúng employee/work_date |
| Dashboard | Widget attendance today đổi trạng thái |
| Security | Không dùng client time để quyết định giờ công |

---

## 19. QA03-E2E-ATT-002: Check-out thành công

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@critical @attendance` |

### Preconditions

1. EMP01 đã check-in.
2. Chưa check-out.
3. Có permission `ATT.ATTENDANCE.CHECK_OUT`.

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/attendance/today` | Status `Checked-in` |
| 3 | Click `Check-out` | Button loading |
| 4 | Submit | API success |
| 5 | UI refresh | Status `Checked-out` hoặc `Present/Late/Missing Hours` |
| 6 | Mở bảng công | Record có check-in/check-out |

### Expected result

1. Check-out ghi nhận giờ server.
2. Hệ thống tính late/early/missing hours theo rule.
3. Không tạo record trùng nếu user double-click.
4. Query attendance today và records được invalidate.

---

## 20. QA03-E2E-ATT-003: Bị chặn check-in khi có leave full-day approved

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@attendance @leave @business-rule @cross-module` |

### Preconditions

1. EMP01 có đơn nghỉ full-day đã Approved cho hôm nay.
2. ATT đã sync hoặc có thể kiểm tra LEAVE khi load today.
3. EMP01 có permission check-in.

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/attendance/today` |
| 3 | Hệ thống load status |
| 4 | Kiểm tra nút Check-in/Check-out |
| 5 | Thử gọi check-in nếu UI vẫn cho bấm hoặc API trực tiếp |

### Expected result

1. UI disable/ẩn check-in/check-out.
2. Message: `Bạn đã có đơn nghỉ phép được duyệt hôm nay`.
3. API check-in trả business error nếu bị gọi trực tiếp.
4. Attendance status là `Leave`.
5. Không tạo attendance log check-in.

---

## 21. QA03-E2E-ATT-004: Employee gửi yêu cầu điều chỉnh công, Manager duyệt

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@attendance @approval @notification @cross-module` |

### Preconditions

1. EMP01 có attendance record thiếu check-out hoặc sai giờ.
2. MGR01 là direct manager của EMP01.
3. EMP01 có permission submit adjustment.
4. MGR01 có permission approve adjustment scope Team.

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | EMP01 | Mở bảng công cá nhân |
| 2 | EMP01 | Mở record cần điều chỉnh |
| 3 | EMP01 | Click `Yêu cầu điều chỉnh` |
| 4 | EMP01 | Nhập giờ đề xuất + lý do |
| 5 | EMP01 | Submit request |
| 6 | SYS | Tạo request Pending + notification cho MGR01 |
| 7 | MGR01 | Login, mở notification hoặc danh sách pending |
| 8 | MGR01 | Approve |
| 9 | SYS | Cập nhật attendance record |
| 10 | EMP01 | Nhận notification kết quả |

### Expected result

1. Adjustment request chuyển `Pending -> Approved`.
2. Record attendance cập nhật theo thay đổi được duyệt.
3. Request đã Approved không thể sửa.
4. Notification gửi đúng người.
5. Dashboard/bảng công cập nhật.

---

# PHẦN C: LEAVE E2E

---

## 22. QA03-E2E-LEAVE-001: Employee tạo, lưu nháp và gửi đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@critical @leave` |

### Preconditions

1. EMP01 active/probation.
2. EMP01 có balance đủ.
3. Có leave type active.
4. Có policy phù hợp.

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/leave/me/requests` |
| 3 | Click `Tạo đơn nghỉ` |
| 4 | Chọn leave type Annual Leave |
| 5 | Chọn ngày nghỉ tương lai |
| 6 | Hệ thống preview số ngày nghỉ và balance |
| 7 | Click `Lưu nháp` |
| 8 | Draft xuất hiện trong My Requests |
| 9 | Mở draft, click `Gửi đơn` |
| 10 | Confirm submit |
| 11 | Đơn chuyển trạng thái Pending |

### Expected result

1. Preview tính ngày nghỉ đúng.
2. Draft lưu thành công.
3. Submit chuyển Draft -> Pending.
4. Balance có trạng thái reserve/hold nếu backend thiết kế.
5. MGR01 nhận notification pending approval.
6. Dashboard Manager pending leave count tăng sau cache invalidation.

---

## 23. QA03-E2E-LEAVE-002: Manager duyệt đơn nghỉ và đồng bộ ATT/NOTI/DASH

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@critical @leave @attendance @notification @dashboard @cross-module` |

### Preconditions

1. EMP01 đã gửi đơn nghỉ Pending.
2. Đơn thuộc team của MGR01.
3. MGR01 có permission `LEAVE.REQUEST.APPROVE` scope Team.
4. EMP01 có đủ balance.

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | MGR01 | Login |
| 2 | MGR01 | Mở Dashboard Manager |
| 3 | MGR01 | Kiểm tra widget Pending Leave |
| 4 | MGR01 | Click quick action hoặc notification |
| 5 | MGR01 | Mở chi tiết đơn nghỉ |
| 6 | MGR01 | Click `Duyệt` |
| 7 | MGR01 | Confirm approve |
| 8 | SYS | LEAVE cập nhật status Approved |
| 9 | SYS | Trừ balance/ghi transaction |
| 10 | SYS | Sync ATT ngày nghỉ |
| 11 | SYS | Tạo notification cho EMP01 |
| 12 | SYS | Invalidate dashboard cache |
| 13 | EMP01 | Login và kiểm tra notification |
| 14 | EMP01 | Mở `/attendance/today` nếu ngày nghỉ là hôm nay |
| 15 | EMP01 | Check-in bị block hoặc attendance status là Leave |

### Expected result

1. Leave request chuyển `Pending -> Approved`.
2. Approval log có actor MGR01.
3. Leave balance bị trừ đúng số ngày/giờ.
4. ATT record hoặc state ngày tương ứng là `Leave`.
5. EMP01 nhận notification đơn đã duyệt.
6. Dashboard Manager pending count giảm.
7. Employee dashboard/my leave balance cập nhật.
8. Audit log có action approve.

---

## 24. QA03-E2E-LEAVE-003: Manager từ chối đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@leave @approval @notification` |

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | EMP01 | Submit leave request | Status Pending |
| 2 | MGR01 | Mở approval detail | Thấy dữ liệu trong team |
| 3 | MGR01 | Click `Từ chối` | Modal yêu cầu lý do |
| 4 | MGR01 | Nhập lý do, submit | Status Rejected |
| 5 | EMP01 | Nhận notification | Thấy đơn bị từ chối |
| 6 | EMP01 | Mở đơn | Hiển thị lý do phù hợp |
| 7 | SYS | Balance hold được release | Balance đúng |

### Expected result

1. Không sync ATT thành Leave.
2. Balance không bị trừ cuối cùng.
3. Notification gửi đúng user.
4. Reason không lộ cho user không có quyền.

---

## 25. QA03-E2E-LEAVE-004: User ngoài scope không duyệt được đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | MGR02 |
| Automation | Yes |
| Tags | `@leave @security @data-scope` |

### Preconditions

1. EMP01 thuộc team MGR01.
2. MGR02 thuộc Sales, không quản lý EMP01.
3. MGR02 có approve permission scope Team.

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login MGR02 |
| 2 | Mở `/leave/approvals` |
| 3 | Tìm đơn của EMP01 |
| 4 | Gọi deep link trực tiếp `/leave/requests/{id}` |
| 5 | Gọi approve API trực tiếp nếu có API helper |

### Expected result

1. MGR02 không thấy đơn của EMP01 trong list.
2. Deep link trả forbidden hoặc not found theo policy.
3. API approve trả 403 scope denied.
4. Không thay đổi trạng thái đơn.
5. Không tạo audit approve sai.

---

# PHẦN D: TASK E2E

---

## 26. QA03-E2E-TASK-001: Manager tạo task và giao cho Employee

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | MGR, EMP |
| Automation | Yes |
| Tags | `@critical @task @notification @dashboard` |

### Preconditions

1. Project Alpha active.
2. MGR01 là Owner/Manager của project.
3. EMP01 là project member hoặc thuộc team được giao task.
4. MGR01 có permission tạo/giao task.

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | MGR01 | Login |
| 2 | MGR01 | Mở `/tasks/projects/{project_id}` |
| 3 | MGR01 | Click `Tạo task` |
| 4 | MGR01 | Nhập title, deadline, priority |
| 5 | MGR01 | Gán assignee EMP01 |
| 6 | MGR01 | Submit |
| 7 | SYS | Tạo task + assignee + activity |
| 8 | SYS | Tạo notification TASK_ASSIGNED cho EMP01 |
| 9 | EMP01 | Login |
| 10 | EMP01 | Mở notification hoặc `/tasks/my-tasks` |
| 11 | EMP01 | Thấy task mới |

### Expected result

1. Task tạo thành công.
2. EMP01 thấy task trong My Tasks.
3. Notification unread count tăng.
4. Dashboard Employee widget My Tasks cập nhật.
5. Activity log ghi create/assign.

---

## 27. QA03-E2E-TASK-002: Employee cập nhật trạng thái task

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@task @status @kanban` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Mở `/tasks/my-tasks` |
| 3 | Click task được giao |
| 4 | Click `Update status` |
| 5 | Chọn `In Progress` |
| 6 | Submit |
| 7 | Mở Kanban |
| 8 | Kiểm tra task nằm ở cột In Progress |

### Expected result

1. Status transition đúng rule.
2. Task detail, list và Kanban đồng bộ.
3. Activity log ghi status change.
4. Dashboard task widget cập nhật.
5. User không có quyền update chỉ thấy readonly.

---

## 28. QA03-E2E-TASK-003: Comment mention tạo notification và deep link

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP01, EMP02 |
| Automation | Yes |
| Tags | `@task @comment @mention @notification @deep-link` |

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | EMP01 | Mở task detail |
| 2 | EMP01 | Comment có mention `@EMP02` |
| 3 | SYS | Tạo comment + mention |
| 4 | SYS | Tạo notification TASK_MENTIONED cho EMP02 |
| 5 | EMP02 | Mở notification dropdown |
| 6 | EMP02 | Click notification |
| 7 | SYS | Mark notification read |
| 8 | FE | Điều hướng `/tasks/{task_id}` |
| 9 | TASK | Kiểm tra permission EMP02 |
| 10 | UI | Task detail hiển thị và focus comment nếu hỗ trợ |

### Expected result

1. Notification payload không chứa dữ liệu nhạy cảm quá mức.
2. User được mention nhận notification đúng.
3. Deep link qua module TASK để kiểm tra quyền lại.
4. Nếu EMP02 không có quyền xem task, hiển thị forbidden.

---

## 29. QA03-E2E-TASK-004: Cảnh báo khi giao task cho nhân viên đang nghỉ phép

| Trường | Nội dung |
| --- | --- |
| Priority | P2 |
| Actor | MGR |
| Automation | Partial |
| Tags | `@task @leave @business-warning` |

### Preconditions

1. EMP01 có leave approved trong khoảng deadline.
2. MGR01 giao task cho EMP01 với deadline nằm trong kỳ nghỉ.

### Expected result

1. UI hiển thị cảnh báo assignee đang nghỉ hoặc deadline trùng kỳ nghỉ.
2. MVP có thể vẫn cho submit nếu policy chưa chặn.
3. Nếu submit thành công, task vẫn tạo nhưng có warning/audit/activity nếu thiết kế.
4. Không làm thay đổi leave request.

---

# PHẦN E: NOTIFICATION E2E

---

## 30. QA03-E2E-NOTI-001: Notification unread count và dropdown

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@critical @notification @smoke` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Seed notification unread cho EMP01 |
| 2 | Login EMP01 |
| 3 | Kiểm tra badge topbar |
| 4 | Click chuông notification |
| 5 | Dropdown hiển thị latest notifications |
| 6 | Click một notification |
| 7 | Notification chuyển read nếu auto mark read bật |
| 8 | Badge giảm |
| 9 | Click `Mark all read` |
| 10 | Badge về 0 |

### Expected result

1. User chỉ thấy notification của chính mình.
2. Dropdown có loading/empty/error state.
3. Mark read/mark all read invalidate unread count.
4. Không hiện notification của user khác.

---

## 31. QA03-E2E-NOTI-002: Deep link an toàn sang module gốc

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@notification @deep-link @security` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Tạo notification `LEAVE_REQUEST_SUBMITTED` cho MGR01 |
| 2 | Login MGR01 |
| 3 | Click notification |
| 4 | Hệ thống điều hướng `/leave/approvals` hoặc detail |
| 5 | Module LEAVE load entity và kiểm tra quyền |
| 6 | Gỡ permission MGR01 hoặc dùng MGR02 |
| 7 | Click lại target route |
| 8 | Hệ thống hiển thị 403/target unavailable |

### Expected result

1. NOTI không quyết định quyền xem entity gốc.
2. Module gốc kiểm tra permission + data scope + business rule.
3. Target mất quyền hiển thị forbidden thân thiện.
4. Notification không chứa file private URL hoặc dữ liệu nhạy cảm.

---

# PHẦN F: DASHBOARD E2E

---

## 32. QA03-E2E-DASH-001: Dashboard theo role và widget visibility

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR, HR, ADMIN |
| Automation | Yes |
| Tags | `@dashboard @permission @role` |

### Steps

| Actor | Thao tác | Expected |
| --- | --- | --- |
| EMP01 | Login, mở `/dashboard` | Employee dashboard, widget own data |
| MGR01 | Login, mở `/dashboard` | Manager dashboard, team widgets |
| HR01 | Login, mở `/dashboard` | HR dashboard, company/department widgets theo scope |
| ADMIN01 | Login, mở `/dashboard` | Admin/system widgets theo quyền |
| EMP01 | Cố mở `/dashboard/admin` | 403 hoặc không có dashboard type |

### Expected result

1. Dashboard type theo quyền.
2. Widget không có permission không được trả hoặc bị hidden.
3. Data trong widget đúng scope.
4. Sensitive widget bị mask nếu thiếu quyền.
5. Quick action chỉ điều hướng/gọi module gốc, không xử lý nghiệp vụ gốc trong DASH.

---

## 33. QA03-E2E-DASH-002: Dashboard cập nhật sau nghiệp vụ nguồn

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@dashboard @cross-module @cache` |

### Scenario A: Sau check-in

```text
EMP01 check-in
-> mở Dashboard Employee
-> widget Attendance Today đổi trạng thái
```

### Scenario B: Sau submit leave

```text
EMP01 submit leave
-> MGR01 mở Dashboard Manager
-> widget Pending Leave tăng count
```

### Scenario C: Sau task assigned

```text
MGR01 giao task cho EMP01
-> EMP01 mở Dashboard Employee
-> widget My Tasks có task mới
```

### Expected result

1. Cache được invalidate hoặc refresh trong TTL chấp nhận.
2. Dashboard tổng không lỗi nếu một widget source lỗi.
3. Widget lỗi hiển thị degraded state, không làm sập toàn dashboard.
4. Không phát sinh dữ liệu sai scope sau cache.

---

# PHẦN G: HR E2E

---

## 34. QA03-E2E-HR-001: Employee gửi yêu cầu cập nhật hồ sơ cá nhân, HR duyệt

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP, HR |
| Automation | Yes |
| Tags | `@hr @self-service @approval @notification` |

### Preconditions

1. EMP01 có quyền xem hồ sơ của mình.
2. Field phone/address được phép gửi yêu cầu cập nhật.
3. HR01 có quyền duyệt profile change.

### Steps

| Bước | Actor | Thao tác | Expected |
| --- | --- | --- | --- |
| 1 | EMP01 | Mở `/hr/me` |
| 2 | EMP01 | Click `Yêu cầu chỉnh sửa` |
| 3 | EMP01 | Cập nhật số điện thoại |
| 4 | EMP01 | Submit |
| 5 | SYS | Tạo profile_change_request Pending |
| 6 | SYS | Notification cho HR01 |
| 7 | HR01 | Mở danh sách request |
| 8 | HR01 | Mở detail so sánh old/new |
| 9 | HR01 | Approve |
| 10 | SYS | Apply dữ liệu vào employee profile |
| 11 | SYS | Notification cho EMP01 |
| 12 | EMP01 | Refresh `/hr/me` thấy dữ liệu mới |

### Expected result

1. Hồ sơ chính không đổi trước khi HR duyệt.
2. Sau approve, dữ liệu mới được áp dụng.
3. Audit log ghi người duyệt và field thay đổi.
4. Nếu reject, hồ sơ giữ nguyên.
5. Field nhạy cảm vẫn mask theo quyền.

---

## 35. QA03-E2E-HR-002: HR xem danh sách nhân viên theo scope

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | HR, MGR |
| Automation | Yes |
| Tags | `@hr @scope @security` |

### Expected result

| Actor | Kỳ vọng |
| --- | --- |
| EMP01 | Chỉ xem hồ sơ của chính mình |
| MGR01 | Xem EMP01/EMP02 trong team, không thấy EMP03 nếu khác team |
| HR01 scope Department | Chỉ thấy nhân viên phòng ban được cấp |
| HR01 scope Company | Thấy toàn công ty |
| ADMIN01 | Quản trị theo company |
| SA01 | Chỉ xem cross-company nếu dùng endpoint/system scope riêng |

---

# PHẦN H: SECURITY, PERMISSION, DATA SCOPE E2E

---

## 36. QA03-E2E-SEC-001: Không hard-code theo role, kiểm tra permission thực tế

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | User custom role |
| Automation | Yes |
| Tags | `@security @rbac @permission` |

### Scenario

Tạo user có role custom:

```text
Role name: CUSTOM_APPROVER
Permissions:
- LEAVE.REQUEST.VIEW
- LEAVE.REQUEST.APPROVE scope Team
Không có:
- HR.EMPLOYEE.UPDATE
- SYSTEM.USER.VIEW
```

### Expected result

1. User thấy leave approval menu nếu có permission.
2. User không thấy menu HR update/system users.
3. User approve được đơn thuộc team.
4. User không approve được đơn ngoài team.
5. Backend không check theo tên role cứng.

---

## 37. QA03-E2E-SEC-002: Direct API trái quyền bị chặn

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@security @api @forbidden` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Login EMP01 |
| 2 | Lấy access token |
| 3 | Gọi `GET /api/v1/hr/employees` nếu EMP thiếu quyền company |
| 4 | Gọi `POST /api/v1/leave/requests/{id}/approve` với đơn của người khác |
| 5 | Gọi `GET /api/v1/dashboard/admin` |
| 6 | Gọi `GET /api/v1/notifications` với filter user khác nếu có |

### Expected result

1. API trả 403 hoặc scope denied đúng code.
2. Không có dữ liệu nhạy cảm trong response.
3. Không ghi thay đổi dữ liệu.
4. Audit/security event ghi nhận nếu policy bật.

---

## 38. QA03-E2E-SEC-003: Multi-tenant isolation

| Trường | Nội dung |
| --- | --- |
| Priority | P0 nếu bật SaaS/multi-tenant; P1 nếu MVP single-company |
| Actor | ADMIN/SA |
| Automation | Partial |
| Tags | `@security @tenant` |

### Expected result

1. User Company A không thấy employee/attendance/leave/task/notification Company B.
2. Frontend không gửi `company_id` cho nghiệp vụ thông thường.
3. Backend resolve company từ auth context.
4. Cache dashboard/notification không dùng chung giữa tenant.
5. Super Admin chỉ truy vấn cross-company qua cơ chế endpoint riêng nếu được thiết kế.

---

# PHẦN I: RESPONSIVE & ACCESSIBILITY E2E

---

## 39. QA03-E2E-RESP-001: Employee mobile web critical flow

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@mobile @responsive @employee` |
| Viewport | Mobile web `< 768px` |

### Flow

```text
Login
-> Home Portal mobile
-> Open App Switcher
-> Open Attendance Today
-> Check-in status
-> Open Leave create form
-> Submit leave
-> Open Notification dropdown/list
```

### Expected result

1. Home Portal dùng app grid/card phù hợp mobile.
2. App Switcher fullscreen/drawer không vỡ layout.
3. Form full width, không bị che bởi keyboard.
4. Data table chuyển sang card list nếu cần.
5. Button có hit area đủ lớn.
6. Không mất khả năng điều hướng module.

---

## 40. QA03-E2E-A11Y-001: Keyboard và focus cho flow P0

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | All |
| Automation | Partial |
| Tags | `@accessibility @keyboard` |

### Expected result

1. Login form dùng keyboard hoàn chỉnh.
2. App Switcher mở/đóng được bằng keyboard.
3. Modal confirm trap focus đúng.
4. Notification dropdown có aria-label cho icon-only button.
5. Focus visible rõ.
6. Error message liên kết đúng với input.
7. Không chỉ dùng màu để biểu đạt status quan trọng.

---

# PHẦN J: ERROR, CONCURRENCY, IDEMPOTENCY E2E

---

## 41. QA03-E2E-ERR-001: Network/API error state không làm mất dữ liệu form

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | EMP |
| Automation | Yes |
| Tags | `@error @form @resilience` |

### Steps

| Bước | Thao tác | Expected |
| --- | --- | --- |
| 1 | Mở form tạo leave |
| 2 | Nhập dữ liệu hợp lệ |
| 3 | Mock/trigger API submit lỗi 500 hoặc network |
| 4 | Submit |
| 5 | UI hiển thị toast/alert lỗi |
| 6 | Form vẫn giữ dữ liệu |
| 7 | Retry thành công |

### Expected result

1. Không mất dữ liệu form.
2. Không tạo request trùng khi retry cùng idempotency key.
3. Error message thân thiện.

---

## 42. QA03-E2E-IDEMP-001: Double click submit không tạo trùng nghiệp vụ

| Trường | Nội dung |
| --- | --- |
| Priority | P0 |
| Actor | EMP, MGR |
| Automation | Yes |
| Tags | `@idempotency @concurrency @critical` |

### Flows cần kiểm tra

| Flow | Expected |
| --- | --- |
| Double click Check-in | Chỉ một attendance record/log hợp lệ |
| Double click Submit leave | Chỉ một leave request hoặc response cũ |
| Double click Approve leave | Chỉ trừ balance một lần |
| Retry mark all read | Không lỗi hoặc idempotent |
| Double click task status update | Status cuối cùng đúng, activity không spam nếu backend dedupe |

---

## 43. QA03-E2E-CONC-001: Hai người xử lý cùng một đơn nghỉ

| Trường | Nội dung |
| --- | --- |
| Priority | P1 |
| Actor | MGR, HR |
| Automation | Partial |
| Tags | `@concurrency @leave @approval` |

### Scenario

```text
MGR01 và HR01 cùng mở một leave request Pending.
MGR01 approve trước.
HR01 vẫn đang ở màn cũ và click reject/approve sau đó.
```

### Expected result

1. Action thứ hai trả conflict/stale state.
2. UI hiển thị: `Đơn đã được xử lý bởi người khác. Vui lòng tải lại.`
3. Không tạo transaction/balance/audit sai.
4. Notification không gửi trùng.

---

# PHẦN K: TRACEABILITY MATRIX

---

## 44. Traceability theo flow MVP

| E2E code | Flow nguồn | Screen chính | Module | Priority |
| --- | --- | --- | --- | --- |
| QA03-E2E-AUTH-001 | UI03-FLOW-001 | Login, Home Portal | AUTH/HOME | P0 |
| QA03-E2E-AUTH-002 | UI03-FLOW-002 | Login, 403 | AUTH | P0 |
| QA03-E2E-HOME-001 | UI03-FLOW-003 | Home Portal, Workspace | HOME/LAYOUT | P0 |
| QA03-E2E-HOME-002 | UI03-FLOW-004 | App Switcher | HOME/LAYOUT | P0 |
| QA03-E2E-ATT-001 | UI03-FLOW-005 | Attendance Today | ATT | P0 |
| QA03-E2E-ATT-002 | UI03-FLOW-005 | Attendance Today | ATT | P0 |
| QA03-E2E-ATT-003 | UI03-FLOW-005 + LEAVE sync | Attendance Today | ATT/LEAVE | P0 |
| QA03-E2E-ATT-004 | ATT adjustment | Records/Approval | ATT/NOTI | P1 |
| QA03-E2E-LEAVE-001 | UI03-FLOW-007/008 | Leave create/detail | LEAVE | P0 |
| QA03-E2E-LEAVE-002 | UI03-FLOW-010 | Approval/detail | LEAVE/ATT/NOTI/DASH | P0 |
| QA03-E2E-LEAVE-003 | UI03-FLOW-010 | Approval/detail | LEAVE/NOTI | P1 |
| QA03-E2E-LEAVE-004 | Permission scope | Approval/detail | LEAVE/AUTH | P0 |
| QA03-E2E-TASK-001 | UI03-FLOW-013 | Project/task form | TASK/NOTI/DASH | P0 |
| QA03-E2E-TASK-002 | UI03-FLOW-012 | Task detail/Kanban | TASK/DASH | P0 |
| QA03-E2E-TASK-003 | UI03-FLOW-014/016 | Comment/Noti/Task detail | TASK/NOTI | P1 |
| QA03-E2E-NOTI-001 | UI03-FLOW-015 | Notification dropdown/list | NOTI | P0 |
| QA03-E2E-NOTI-002 | UI03-FLOW-016 | Noti detail/deep link | NOTI + module source | P0 |
| QA03-E2E-DASH-001 | Dashboard role | Dashboard | DASH | P0 |
| QA03-E2E-DASH-002 | Cross-module refresh | Dashboard widgets | DASH/source modules | P0 |
| QA03-E2E-HR-001 | HR self-service | My Profile/Profile Request | HR/NOTI | P1 |
| QA03-E2E-HR-002 | HR scope | Employee list/detail | HR/AUTH | P1 |
| QA03-E2E-SEC-001 | RBAC | Menu/API/Approval | AUTH/all | P0 |
| QA03-E2E-SEC-002 | API forbidden | Direct API | AUTH/all | P0 |
| QA03-E2E-RESP-001 | Mobile P0 | Employee critical flow | Multi-module | P1 |
| QA03-E2E-A11Y-001 | Accessibility | P0 screens | Multi-module | P1 |
| QA03-E2E-IDEMP-001 | Idempotency | Critical actions | ATT/LEAVE/TASK/NOTI | P0 |

---

## 45. Traceability theo module

| Module | E2E bắt buộc |
| --- | --- |
| AUTH | AUTH-001, AUTH-002, SEC-001, SEC-002 |
| HOME/FOUNDATION | HOME-001, HOME-002 |
| DASH | DASH-001, DASH-002 |
| HR | HR-001, HR-002 |
| ATT | ATT-001, ATT-002, ATT-003, ATT-004 |
| LEAVE | LEAVE-001, LEAVE-002, LEAVE-003, LEAVE-004 |
| TASK | TASK-001, TASK-002, TASK-003, TASK-004 |
| NOTI | NOTI-001, NOTI-002 |
| SYSTEM | SEC-001, SEC-002, SEC-003 |
| Cross-module | LEAVE-002, TASK-001, TASK-003, DASH-002, ATT-003 |

---

# PHẦN L: CI/CD EXECUTION PLAN

---

## 46. Tần suất chạy test

| Bộ test | Khi chạy | Phạm vi |
| --- | --- | --- |
| PR Smoke | Mỗi pull request frontend/backend | AUTH, Home, route guard, 1 nghiệp vụ P0 |
| Merge to develop | Sau merge | Smoke + critical E2E |
| Nightly | Hằng đêm | Full regression E2E |
| Release Candidate | Trước UAT/release | Full E2E + security scope + responsive P0 |
| Post-deploy smoke | Sau deploy staging/production | Login, Home, Dashboard, notification, read-only |

### 46.1 PR Smoke đề xuất

```text
QA03-SMOKE-001 Login -> Home Portal -> Dashboard
QA03-SMOKE-002 Open App Switcher -> Attendance Today
QA03-SMOKE-003 Check-in hoặc check current status
QA03-SMOKE-004 Notification unread/dropdown load
QA03-SMOKE-005 Employee không vào được Admin route
```

### 46.2 Release Candidate suite

```text
Toàn bộ P0 E2E
+ P1 leave/attendance/task/hr/noti
+ data scope test
+ idempotency/concurrency critical
+ mobile employee flow
+ accessibility smoke
```

---

## 47. Quality gate cho E2E

### 47.1 Gate theo priority

| Mức | Điều kiện release |
| --- | --- |
| P0 | 100% pass |
| P1 | >= 95% pass, không có lỗi blocker/critical |
| P2 | Có thể có lỗi nhỏ nếu được Product/QA approve |
| Security/data scope | 100% pass với test bắt buộc |
| Cross-module core | 100% pass với LEAVE -> ATT -> NOTI -> DASH và TASK -> NOTI -> DASH |

### 47.2 Lỗi chặn release

Một lỗi E2E được xem là release blocker nếu thuộc một trong các nhóm:

1. Không login/logout được.
2. Home Portal hoặc App Switcher không mở được app chính.
3. Employee không check-in/check-out được trong điều kiện hợp lệ.
4. Leave approval không cập nhật balance hoặc sync ATT sai.
5. User ngoài scope xem/sửa/duyệt được dữ liệu không thuộc quyền.
6. Notification deep link làm lộ dữ liệu nhạy cảm.
7. Dashboard hiển thị dữ liệu sai người/sai team/sai company.
8. Double submit tạo trùng attendance/leave/balance transaction.
9. Task assignment không hiển thị cho assignee.
10. Hệ thống crash toàn trang ở luồng P0.

---

## 48. Flaky test prevention

| Rủi ro flaky | Cách giảm |
| --- | --- |
| Chờ UI bằng timeout cứng | Chờ network response, locator state, event hoặc DB/API condition |
| Dữ liệu dùng chung bị test khác sửa | Mỗi test dùng test_run_id riêng |
| Cache/dashboard cập nhật chậm | Có helper wait for cache invalidation hoặc polling có timeout rõ |
| Notification event async | Wait theo event API hoặc polling unread count |
| Clock/timezone lệch | Luôn dùng timezone company và server time |
| Parallel test đụng user | Tạo user/data riêng cho từng worker hoặc serialize critical flow |
| Double click gây race | Test idempotency riêng, các test khác disable button khi loading |
| Mobile viewport khác nhau | Chuẩn hóa viewport config |
| Selector dễ vỡ | Dùng `data-testid` ổn định |

---

## 49. Quy ước selector cho frontend E2E

Frontend nên gắn `data-testid` cho P0/P1 component:

```tsx
<button data-testid="login-submit-button" />
<div data-testid="home-app-card-ATT" />
<button data-testid="topbar-app-switcher-button" />
<button data-testid="attendance-check-in-button" />
<button data-testid="leave-submit-button" />
<button data-testid="leave-approve-button" />
<div data-testid="notification-unread-badge" />
<div data-testid="dashboard-widget-attendance-today" />
```

Quy ước:

```text
{module}-{component}-{action/state}
```

Ví dụ:

```text
leave-request-form-submit
task-detail-status-select
noti-dropdown-mark-all-read
dashboard-widget-pending-leave
```

---

## 50. Báo cáo kết quả E2E

Mỗi lần chạy E2E cần sinh report gồm:

| Nội dung | Bắt buộc |
| --- | --- |
| Test run ID | Có |
| Environment | Có |
| Commit SHA / build version | Có |
| Browser/device | Có |
| Pass/fail/skip count | Có |
| Failed tests with screenshot/trace/video | Có |
| Flaky/retry count | Có |
| Duration | Có |
| Linked defects | Có |
| Release gate status | Có |

### 50.1 Format defect từ E2E

```text
Title: [E2E][LEAVE] Manager approve leave không sync ATT record

Environment: staging
Build: web-1.0.0-rc.3 / api-1.0.0-rc.3
Test case: QA03-E2E-LEAVE-002
Actor: MGR01 / EMP01
Steps:
1. EMP01 submit leave full-day
2. MGR01 approve
3. EMP01 open Attendance Today
Actual:
- Attendance Today vẫn cho phép Check-in
Expected:
- Check-in bị block, status Leave
Evidence:
- Screenshot
- Playwright trace
- request_id
Severity: Critical
Module: LEAVE/ATT
```

---

## 51. Manual E2E checklist trước UAT

Dù đã có automation, QA nên chạy thủ công các luồng sau trước UAT:

| Mã | Flow | Người kiểm thử | Ghi chú |
| --- | --- | --- | --- |
| MAN-E2E-001 | Login -> Home -> App Switcher -> Dashboard | QA/Product | Kiểm tra cảm nhận UX |
| MAN-E2E-002 | Check-in/check-out web | QA | Có thể dùng test date |
| MAN-E2E-003 | Employee submit leave -> Manager approve | QA/Product | Kiểm tra copy, state, notification |
| MAN-E2E-004 | Task assign -> comment mention -> notification | QA/Product | Kiểm tra collaboration |
| MAN-E2E-005 | Notification deep link target forbidden | QA | Kiểm tra security UX |
| MAN-E2E-006 | HR profile change approve | QA/HR stakeholder | Kiểm tra nghiệp vụ HR |
| MAN-E2E-007 | Responsive mobile employee flow | QA | Mobile web |
| MAN-E2E-008 | Role permission custom | QA/Tech Lead | Không hard-code role |

---

## 52. Acceptance criteria tổng thể QA-03

| Mã | Tiêu chí |
| --- | --- |
| QA03-AC-001 | Tài liệu xác định đầy đủ phạm vi End-to-End Flow Testing cho MVP |
| QA03-AC-002 | Có danh sách actor, seed data và môi trường test chuẩn |
| QA03-AC-003 | Có E2E test case P0 cho AUTH, HOME, ATT, LEAVE, TASK, NOTI, DASH và permission |
| QA03-AC-004 | Có E2E test case xuyên module: LEAVE -> ATT -> NOTI -> DASH |
| QA03-AC-005 | Có E2E test case xuyên module: TASK -> NOTI -> DASH |
| QA03-AC-006 | Có kiểm thử notification deep link luôn qua module gốc |
| QA03-AC-007 | Có kiểm thử permission/data scope bằng UI và direct API |
| QA03-AC-008 | Có kiểm thử idempotency/double submit cho action quan trọng |
| QA03-AC-009 | Có kế hoạch automation, cấu trúc thư mục, selector và CI execution |
| QA03-AC-010 | Có quality gate rõ để chặn release khi E2E core fail |
| QA03-AC-011 | Có checklist manual E2E trước UAT |
| QA03-AC-012 | Có traceability matrix liên kết flow, screen, module và priority |

---

## 53. Kết luận

QA-03 chốt bộ kiểm thử End-to-End cho MVP theo hướng ưu tiên luồng nghiệp vụ thật và rủi ro xuyên module.

Các luồng bắt buộc không được bỏ qua trước release MVP:

```text
Login -> Home Portal -> App Switcher -> Module Workspace
Attendance check-in/check-out
Leave create -> submit -> approve -> ATT sync -> NOTI -> DASH
Task assign -> notification -> deep link -> update/comment
Notification unread/dropdown/mark read/deep link
Dashboard theo role, permission và data scope
HR profile change request có phê duyệt
Permission/data scope direct UI + API
Idempotency và concurrency cho action nhạy cảm
```

Nếu toàn bộ P0 E2E pass, không có lỗi security/data scope, và các flow cross-module chính hoạt động ổn định, hệ thống đủ điều kiện chuyển sang **QA-04: API Testing & Contract Testing** hoặc chạy song song với UAT tùy kế hoạch release.

---

## 54. Tài liệu liên quan

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: chiến lược, phạm vi, critical E2E flow |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Nguồn test case ghép thành flow E2E |
| **QA-03 (tài liệu này)** | End-to-End Flow Testing | Kiểm thử flow nghiệp vụ xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope, field/route guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
