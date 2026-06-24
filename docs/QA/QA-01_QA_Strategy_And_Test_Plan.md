# QA-01: QA STRATEGY & TEST PLAN
---

## 1. Thông tin tài liệu

| Trường         | Nội dung                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mã tài liệu    | QA-01                                                                                                                        |
| Tên tài liệu   | QA Strategy & Test Plan                                                                                                      |
| Tên dự án      | Hệ thống quản lý doanh nghiệp nội bộ                                                                                         |
| Tên sản phẩm   | Enterprise Management System                                                                                                 |
| Giai đoạn      | QA / Integration / Release Readiness - MVP Version 1.0                                                                       |
| Trạng thái     | Draft                                                                                                                        |
| Ngày tạo       | 20/06/2026                                                                                                                   |
| Ngày cập nhật  | 20/06/2026                                                                                                                   |
| Tài liệu nguồn | PRD-00, SPEC-01 → SPEC-08, DB-01 → DB-10, API-01 → API-08, UI-01 → UI-10, FRONTEND-01 → FRONTEND-14, BACKEND-01 → BACKEND-14 |
| Người viết     |                                                                                                                              |
| Người duyệt    |                                                                                                                              |

---

## 2. Mục đích tài liệu

Tài liệu **QA-01** định nghĩa chiến lược kiểm thử tổng thể cho MVP của hệ thống quản lý doanh nghiệp nội bộ.

Sau khi hoàn thành các giai đoạn:

```text
PRD/SPEC
→ Database Design
→ API Design
→ UI/UX Design
→ Frontend Implementation
→ Backend Implementation
```

dự án cần bước vào giai đoạn kiểm thử toàn hệ thống để đảm bảo:

1. Frontend và Backend tích hợp đúng.
2. API hoạt động đúng contract đã thiết kế.
3. Database lưu trữ và truy vấn đúng nghiệp vụ.
4. Permission và data scope không bị sai hoặc lộ dữ liệu.
5. Các flow nghiệp vụ chính chạy được end-to-end.
6. Dashboard, Notification, Audit Log, File, Settings hoạt động đúng vai trò nền tảng.
7. Hệ thống đủ ổn định để bước sang UAT và Release MVP.

API-01 đã xác định Backend là lớp kiểm soát cuối cùng, phải kiểm tra đăng nhập, token, trạng thái user/company, permission, data scope, business rule, audit log và notification event trước khi xử lý nghiệp vụ . Vì vậy QA không chỉ test giao diện, mà phải test sâu cả API, dữ liệu, phân quyền, bảo mật và hiệu năng.

---

## 3. Vị trí của QA-01 trong roadmap dự án

Roadmap tổng thể hiện tại:

```text
PRD/SPEC
→ Database Design
→ API Design
→ UI/UX Design
→ Frontend Implementation
→ Backend Implementation
→ QA / Integration / UAT / Release Readiness
→ DevOps / Deployment / Production Operation
```

Bộ tài liệu QA đề xuất:

| Mã    | Tên tài liệu                                | Mục tiêu                                               |
| ----- | ------------------------------------------- | ------------------------------------------------------ |
| QA-01 | QA Strategy & Test Plan                     | Chốt chiến lược kiểm thử toàn MVP                      |
| QA-02 | Test Case Matrix                            | Lập ma trận test case theo module, screen, API, role   |
| QA-03 | End-to-End Flow Testing                     | Kiểm thử flow người dùng từ đầu đến cuối               |
| QA-04 | API Testing & Contract Testing              | Kiểm thử API contract, response, error, validation     |
| QA-05 | Permission, Role & Data Scope Testing       | Kiểm thử RBAC, scope, route/menu/action/widget         |
| QA-06 | Security Testing                            | Kiểm thử bảo mật cơ bản, token, dữ liệu nhạy cảm       |
| QA-07 | Performance & Load Testing                  | Kiểm thử hiệu năng API, query, dashboard, notification |
| QA-08 | Bug Tracking, Regression & Release Criteria | Quy trình bug, regression và điều kiện release         |
| QA-09 | UAT Plan & Business Acceptance              | Kế hoạch nghiệm thu nghiệp vụ với stakeholder          |
| QA-10 | MVP Release Readiness Checklist             | Checklist cuối cùng trước khi release MVP              |

QA-01 là tài liệu nền. Các tài liệu QA sau phải bám theo chiến lược, phạm vi, tiêu chí và quy tắc được chốt trong tài liệu này.

---

## 4. Căn cứ triển khai QA

QA-01 bám theo các quyết định đã chốt trong toàn bộ dự án:

1. **Backend là nguồn kiểm soát quyền cuối cùng**. Frontend chỉ hỗ trợ ẩn/hiện UI để cải thiện trải nghiệm, mọi API vẫn phải được Backend kiểm tra lại.
2. **API theo module**, gồm AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
3. **API phải stateless**, user/company/permission/data scope phải resolve từ token/session và database/cache, không phụ thuộc state frontend.
4. **MVP multi-tenant ready**, mọi dữ liệu vận hành phải gắn với `company_id` và được filter theo auth context.
5. **UI/UX đã có handoff cho QA**, gồm flow, screen, state, responsive, permission/data scope và accessibility. UI-10 xác định QA handoff phải bao gồm checklist theo screen, flow, permission, data scope, responsive và accessibility .
6. **Không hard-code theo role**, permission và data scope mới là cơ sở hiển thị UI và kiểm soát API.
7. **Database performance phải được kiểm thử**, đặc biệt các query danh sách lớn, dashboard, notification unread count, bảng công, đơn nghỉ và task.
8. **Dashboard không xử lý nghiệp vụ gốc**, chỉ tổng hợp, hiển thị, cache và điều hướng sang module nguồn.
9. **Notification deep link phải đi về module gốc**, module gốc phải kiểm tra lại permission, scope và business rule.
10. **Các flow P0 phải chạy end-to-end**, gồm login, mở app, chấm công, xin nghỉ, duyệt nghỉ, task, notification và profile change.

DB-09 cũng đã nêu rõ hệ thống có nhiều truy vấn có khả năng phát sinh tải lớn như danh sách nhân viên, bảng công, đơn nghỉ chờ duyệt, task, notification unread count, dashboard tổng hợp và audit log . Do đó QA phải có kiểm thử hiệu năng, không chỉ test chức năng.

---

## 5. Mục tiêu QA tổng thể

### 5.1 Mục tiêu chất lượng sản phẩm

MVP được xem là đạt chất lượng khi:

1. Người dùng có thể hoàn thành các nghiệp vụ chính mà không gặp lỗi nghiêm trọng.
2. Dữ liệu hiển thị đúng theo vai trò, quyền và phạm vi dữ liệu.
3. Không có lỗi lộ dữ liệu nhạy cảm.
4. Không có lỗi sai nghiệp vụ nghiêm trọng ở chấm công, nghỉ phép, duyệt đơn, task hoặc phân quyền.
5. API trả response/error đúng chuẩn.
6. UI xử lý đầy đủ loading, empty, error, forbidden, validation, success và stale state.
7. Hệ thống có thể chạy ổn định trên môi trường staging.
8. Các lỗi critical/blocker đã được xử lý trước UAT.
9. Có đủ test evidence để stakeholder duyệt MVP.
10. Có checklist release rõ ràng trước khi deploy production.

### 5.2 Mục tiêu kiểm thử kỹ thuật

QA cần xác nhận:

1. Database migration và seed chạy được từ database trống.
2. Auth/session/token hoạt động ổn định.
3. RBAC và data scope áp dụng đúng ở API, UI, menu, widget và action.
4. API contract khớp tài liệu API.
5. FE gọi đúng API, xử lý đúng status code và response.
6. Backend ghi audit log cho các thao tác quan trọng.
7. Backend phát notification event đúng nghiệp vụ.
8. Dashboard cache/lazy load/fallback hoạt động đúng.
9. File upload/download kiểm soát quyền.
10. Query quan trọng không bị chậm bất thường hoặc N+1.

---

## 6. Phạm vi kiểm thử MVP

### 6.1 Module nằm trong phạm vi QA MVP

| Module            | Phạm vi kiểm thử                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| AUTH              | Login, logout, refresh token, forgot/reset password, user, role, permission, session, security event          |
| HR                | Employee, department, position, job level, contract, profile change request, employee code config, file hồ sơ |
| ATT               | Today attendance, check-in/out, attendance record, shift, rule, adjustment, remote work                       |
| LEAVE             | Leave balance, leave request, draft/submit/cancel, approve/reject, leave calendar, leave policy/type          |
| TASK              | Project, member, task, assignee, watcher, comment, mention, checklist, file, Kanban                           |
| NOTI              | Notification dropdown, unread count, list, detail, mark read, deep link, template/event config                |
| DASH              | Employee/Manager/HR/Admin dashboard, widget config, widget data, quick action, cache/fallback                 |
| FOUNDATION/SYSTEM | Company, module catalog, settings, audit log, files, sequence, public holidays                                |

### 6.2 Không nằm sâu trong QA MVP

Các phần sau chỉ kiểm tra ở mức placeholder hoặc smoke test nếu có hiển thị:

| Module/Phần       | Hướng xử lý                                                      |
| ----------------- | ---------------------------------------------------------------- |
| PAYROLL           | Không test nghiệp vụ sâu, chỉ test app hidden/coming soon nếu có |
| RECRUIT           | Không test nghiệp vụ sâu                                         |
| ASSET             | Không test nghiệp vụ sâu                                         |
| ROOM              | Không test nghiệp vụ sâu                                         |
| CHAT/SOCIAL       | Không test nghiệp vụ sâu                                         |
| MOBILE native app | Chưa thuộc MVP nếu chưa triển khai                               |
| AI/Automation     | Chưa thuộc MVP                                                   |

---

## 7. Chiến lược kiểm thử tổng thể

### 7.1 Nguyên tắc kiểm thử

QA phải kiểm thử theo 5 lớp:

```text
Business correctness
→ API correctness
→ Permission/data security
→ UI/UX behavior
→ Performance/release stability
```

Không được chỉ test theo giao diện. Một chức năng chỉ được xem là đạt khi:

1. UI hiển thị đúng.
2. API trả đúng.
3. Database lưu đúng.
4. Permission/scope đúng.
5. Audit/notification đúng nếu nghiệp vụ yêu cầu.
6. Error state đúng khi thao tác thất bại.
7. Regression không làm hỏng flow liên quan.

### 7.2 Test theo risk-based priority

Ưu tiên kiểm thử theo mức độ rủi ro:

| Mức | Loại rủi ro                                          | Ví dụ                                                                    |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| P0  | Gãy flow lõi / sai dữ liệu nghiêm trọng / lộ dữ liệu | Login lỗi, HR xem được dữ liệu trái quyền, chấm công sai, duyệt nghỉ sai |
| P1  | Gây ảnh hưởng lớn nhưng có workaround                | Dashboard lỗi một widget, notification chưa cập nhật ngay                |
| P2  | Lỗi UI/UX hoặc nghiệp vụ phụ                         | Label sai, filter phụ lỗi, responsive chưa đẹp                           |
| P3  | Cải tiến nhỏ                                         | Copy, spacing, icon, polish                                              |

### 7.3 Test theo module + cross-module

Mỗi module phải test riêng và test liên kết với module khác.

Ví dụ:

```text
LEAVE submit request
→ Manager nhận notification
→ Manager approve
→ ATT cập nhật/chặn chấm công ngày nghỉ
→ DASH cập nhật pending count/balance
→ Employee nhận notification kết quả
→ Audit log ghi nhận thao tác
```

### 7.4 Test theo role và data scope

Không test một user admin duy nhất. Tối thiểu phải có các actor:

```text
Employee
Manager
HR
Admin
Super Admin
```

Và các scope:

```text
Own
Team
Department
Project
Company
System
```

---

## 8. Test level

### 8.1 Unit Test

| Nhóm               | Nội dung                                                           |
| ------------------ | ------------------------------------------------------------------ |
| Backend service    | Rule tính công, rule nghỉ phép, scope resolver, permission checker |
| Backend utility    | Date/time, timezone, idempotency, sequence generator               |
| Frontend component | Button, form, table, modal, drawer, PermissionGate, MaskedField    |
| Frontend utility   | Route guard, permission utility, query key, error mapper           |
| Validation schema  | DTO validation, form validation                                    |

Unit test do developer chịu trách nhiệm chính, QA review coverage và case quan trọng.

### 8.2 Integration Test

Kiểm thử tích hợp giữa:

| Tích hợp            | Nội dung                                             |
| ------------------- | ---------------------------------------------------- |
| AUTH → HR           | User liên kết employee                               |
| AUTH → mọi module   | Permission + data scope                              |
| HR → ATT            | Employee status, department, manager                 |
| HR → LEAVE          | Direct manager, employee status, contract/start date |
| LEAVE → ATT         | Đơn nghỉ approved chặn/tính lại công                 |
| TASK → HR           | Giao task cho employee hợp lệ                        |
| TASK → LEAVE        | Cảnh báo assignee đang nghỉ                          |
| NOTI ← nghiệp vụ    | Event tạo notification                               |
| DASH ← module nguồn | Widget đọc dữ liệu đúng scope                        |
| FOUNDATION → all    | Audit, file, settings, sequence                      |

### 8.3 API Test

Kiểm thử:

1. HTTP method đúng.
2. URL đúng.
3. Header đúng.
4. Authentication đúng.
5. Permission đúng.
6. Data scope đúng.
7. Request body validation đúng.
8. Response success đúng format.
9. Response error đúng format.
10. Pagination/search/filter/sort đúng.
11. Idempotency đúng với API quan trọng.
12. Audit log/notification event đúng nếu có.

### 8.4 Contract Test

Đảm bảo Frontend và Backend khớp:

| Nội dung        | Cần kiểm tra                          |
| --------------- | ------------------------------------- |
| Endpoint        | FE gọi đúng URL/method                |
| DTO             | Field request/response đúng           |
| Error code      | FE map đúng 401/403/404/409/422/500   |
| Pagination      | FE đọc đúng pagination                |
| Allowed actions | FE không tự đoán action               |
| Data scope      | FE không hiển thị dữ liệu ngoài scope |
| OpenAPI/Swagger | Khớp implementation thực tế           |

### 8.5 End-to-End Test

E2E test mô phỏng hành trình thật của người dùng:

```text
Login
→ Home Portal
→ Mở module
→ Thao tác nghiệp vụ
→ Nhận notification/dashboard update
→ Kiểm tra dữ liệu sau thao tác
```

E2E nên ưu tiên các flow P0/P1, không cần bao phủ 100% màn hình ở MVP.

### 8.6 Regression Test

Mỗi lần fix bug hoặc release candidate phải chạy regression:

1. Smoke test toàn hệ thống.
2. Regression P0 flow.
3. Regression permission/scope.
4. Regression API contract.
5. Regression module bị ảnh hưởng.
6. Regression bug đã fix.

### 8.7 Security Test

Kiểm thử tối thiểu:

1. Token expired/revoked.
2. Refresh token rotation/revoke nếu có.
3. Truy cập API không token.
4. Truy cập API bằng user thiếu permission.
5. Truy cập data ngoài scope.
6. Field nhạy cảm không bị trả về.
7. File private không tải được nếu thiếu quyền.
8. Không expose password hash, refresh token hash, secret setting.
9. Không bypass bằng sửa payload `company_id`, `user_id`, `employee_id`.
10. Rate limit login/forgot password nếu có.

### 8.8 Performance Test

Tập trung các API/query quan trọng:

1. Login/me/session bootstrap.
2. Employee list.
3. Attendance records theo tháng.
4. Leave approvals.
5. My tasks/task list/Kanban.
6. Notification unread count/dropdown.
7. Dashboard `/dashboard/me`.
8. Widget data API.
9. Audit log list.
10. File list/download metadata.

DB-09 đã yêu cầu tối ưu query theo `company_id`, dashboard cache, notification unread count, chống N+1 và kiểm tra `EXPLAIN ANALYZE` trước release .

### 8.9 UAT

User Acceptance Test do stakeholder/business user thực hiện với sự hỗ trợ của QA/Product.

UAT tập trung vào:

1. Luồng nghiệp vụ có đúng cách doanh nghiệp vận hành không.
2. Vai trò Employee/Manager/HR/Admin có thao tác dễ hiểu không.
3. Thông tin dashboard có hữu ích không.
4. Notification có đúng người, đúng thời điểm không.
5. Quy trình phê duyệt có rõ ràng không.
6. Có điểm nào cần chốt trước release MVP không.

---

## 9. Môi trường kiểm thử

### 9.1 Local

| Mục tiêu                | Người dùng |
| ----------------------- | ---------- |
| Developer test nhanh    | Developer  |
| Unit test               | Developer  |
| Integration test cơ bản | Developer  |
| Debug lỗi chi tiết      | Developer  |

### 9.2 Development

| Mục tiêu                       | Người dùng |
| ------------------------------ | ---------- |
| Test tính năng đang phát triển | Dev + QA   |
| API smoke test                 | QA         |
| FE-BE integration sớm          | FE + BE    |
| Test bug fix nhanh             | QA         |

### 9.3 Staging

| Mục tiêu                        | Người dùng   |
| ------------------------------- | ------------ |
| Test gần production             | QA + Product |
| E2E full flow                   | QA           |
| Regression release candidate    | QA           |
| Performance test nhẹ/trung bình | QA/DevOps    |
| UAT                             | Stakeholder  |

### 9.4 Production

| Mục tiêu                       | Người dùng     |
| ------------------------------ | -------------- |
| Smoke test sau deploy          | QA/DevOps      |
| Monitoring                     | DevOps/Backend |
| Incident verification          | QA/Support     |
| Không dùng để test phá dữ liệu | Tất cả         |

---

## 10. Test data strategy

### 10.1 Nguyên tắc dữ liệu test

Test data phải đủ để kiểm tra:

1. Nhiều role.
2. Nhiều phòng ban.
3. Nhiều direct manager.
4. Nhiều trạng thái nhân viên.
5. Nhiều ca làm/rule.
6. Nhiều loại nghỉ.
7. Nhiều trạng thái đơn nghỉ.
8. Nhiều project/task.
9. Nhiều notification unread/read.
10. Nhiều scope Own/Team/Department/Company/System.

### 10.2 Bộ user seed tối thiểu

| User                | Role        | Scope chính | Mục đích test                                      |
| ------------------- | ----------- | ----------- | -------------------------------------------------- |
| employee01          | Employee    | Own         | Chấm công, xin nghỉ, task của tôi                  |
| employee02          | Employee    | Own         | Dữ liệu cùng team                                  |
| employee_other_team | Employee    | Own         | Kiểm tra không xem trái team                       |
| manager01           | Manager     | Team        | Duyệt nghỉ, xem bảng công team, task team          |
| hr01                | HR          | Company     | Quản lý nhân sự, nghỉ phép, bảng công toàn công ty |
| admin01             | Admin       | Company     | User, role, settings                               |
| superadmin01        | Super Admin | System      | Cross-company/system                               |
| locked_user         | Employee    | Own         | Test tài khoản bị khóa                             |
| inactive_employee   | Employee    | Own         | Test nhân viên không hợp lệ                        |

### 10.3 Dữ liệu HR tối thiểu

| Nhóm            | Dữ liệu cần có                                             |
| --------------- | ---------------------------------------------------------- |
| Company         | 1 company active, 1 company inactive nếu test multi-tenant |
| Department      | HR, Engineering, Sales, Finance                            |
| Position        | HR Executive, Developer, Sales Executive, Manager          |
| Job level       | Intern, Staff, Senior, Manager                             |
| Employee status | Probation, Official, Suspended, Resigned                   |
| Contract        | Active, expiring soon, expired                             |
| Profile change  | Pending, Approved, Rejected                                |

### 10.4 Dữ liệu ATT tối thiểu

| Nhóm              | Dữ liệu cần có                                        |
| ----------------- | ----------------------------------------------------- |
| Shift             | Fixed shift 08:00-17:00, flexible shift               |
| Rule              | Late threshold, early leave, missing checkout         |
| Attendance record | On time, Late, Early, Missing checkout, Leave, Remote |
| Adjustment        | Pending, Approved, Rejected                           |
| Remote request    | Pending, Approved, Rejected                           |
| Holiday           | Ít nhất 1 public holiday                              |

### 10.5 Dữ liệu LEAVE tối thiểu

| Nhóm          | Dữ liệu cần có                                |
| ------------- | --------------------------------------------- |
| Leave type    | Annual leave, Sick leave, Unpaid leave        |
| Leave balance | Đủ phép, thiếu phép, 0 phép                   |
| Leave request | Draft, Pending, Approved, Rejected, Cancelled |
| Leave day     | Full day, half day, hourly, multiple days     |
| Conflict      | Trùng ngày nghỉ, trùng ngày lễ, ngoài policy  |

### 10.6 Dữ liệu TASK tối thiểu

| Nhóm           | Dữ liệu cần có                                |
| -------------- | --------------------------------------------- |
| Project        | Active, archived/cancelled                    |
| Project member | Owner, Manager, Member, Viewer                |
| Task           | Todo, In Progress, In Review, Done, Cancelled |
| Deadline       | Due today, due soon, overdue                  |
| Assignment     | One assignee, multiple assignees nếu hỗ trợ   |
| Comment        | Comment thường, mention                       |
| Checklist      | Completed, incomplete                         |
| File           | File task/project nếu MVP hỗ trợ              |

### 10.7 Dữ liệu NOTI/DASH tối thiểu

| Nhóm         | Dữ liệu cần có                               |
| ------------ | -------------------------------------------- |
| Notification | Unread, read, hidden/archived nếu có         |
| Event        | AUTH, HR, ATT, LEAVE, TASK                   |
| Template     | Active, inactive                             |
| Dashboard    | Employee, Manager, HR, Admin                 |
| Widget       | Allowed, hidden, error/degraded, stale cache |

---

## 11. Role, permission và data scope test matrix

### 11.1 Actor chính

| Actor             | Nên test gì                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Employee          | Chỉ xem dữ liệu của mình, tự chấm công, xin nghỉ, xem task được giao                      |
| Manager           | Xem team, duyệt yêu cầu thuộc team, không xem team khác                                   |
| HR                | Xem/quản lý dữ liệu nhân sự công ty, bảng công, nghỉ phép theo quyền                      |
| Admin             | Quản trị user/role/setting, không nhất thiết được xem dữ liệu HR nhạy cảm nếu thiếu quyền |
| Super Admin       | Quản trị system/cross-company nếu được thiết kế                                           |
| Unauthorized user | Không truy cập protected route/API                                                        |
| Locked user       | Không đăng nhập hoặc không refresh session                                                |
| Inactive employee | Không thực hiện nghiệp vụ nhân viên nếu rule chặn                                         |

### 11.2 Scope chính cần test

| Scope      | Test bắt buộc                                  |
| ---------- | ---------------------------------------------- |
| Own        | Không xem/sửa dữ liệu người khác               |
| Team       | Chỉ xem nhân viên direct/subordinate theo rule |
| Department | Chỉ xem phòng ban được phép                    |
| Project    | Chỉ xem task/project có liên quan              |
| Company    | Xem toàn công ty trong tenant hiện tại         |
| System     | Xem nhiều company nếu là quyền hệ thống        |
| No scope   | API trả 403 hoặc empty due to scope            |

### 11.3 Loại kiểm thử phân quyền

| Lớp                    | Cần test                                                    |
| ---------------------- | ----------------------------------------------------------- |
| Route guard            | URL trái quyền bị chặn                                      |
| Menu visibility        | Không hiện menu thiếu quyền                                 |
| App visibility         | Không hiện app thiếu quyền hoặc hiển thị locked theo policy |
| Button/action          | Không hiện hoặc disable action thiếu quyền                  |
| Field-level permission | Field nhạy cảm bị mask/ẩn                                   |
| API guard              | Backend trả 401/403 đúng                                    |
| Data filter            | List không chứa dữ liệu ngoài scope                         |
| Target entity          | Không thao tác được entity ngoài scope                      |
| Dashboard widget       | Widget/data theo đúng permission/scope                      |
| Notification target    | Deep link vẫn kiểm tra lại quyền ở module gốc               |

---

## 12. Critical E2E flows MVP

### 12.1 E2E-001: Login → Home Portal → mở app

```text
User nhập email/password
→ Login thành công
→ Vào Home Portal
→ App grid chỉ hiện app có quyền
→ Mở Chấm công/Nhân sự/Công việc
→ Vào Module Workspace đúng layout
```

Expected:

1. Không đi thẳng vào dashboard nghiệp vụ sau login.
2. App/menu theo permission.
3. Direct URL trái quyền bị chặn.
4. Token/session được lưu và refresh đúng.
5. Logout clear session/cache.

### 12.2 E2E-002: Employee check-in/check-out

```text
Employee login
→ Mở Attendance Today
→ Hệ thống load trạng thái hôm nay
→ Check-in
→ Timeline cập nhật
→ Check-out
→ Attendance record cập nhật
→ Dashboard cập nhật trạng thái
→ Audit log ghi nhận
```

Expected:

1. Không double submit.
2. Không check-in nếu bị chặn bởi leave approved.
3. Business error hiển thị đúng.
4. Record/log lưu đúng.

### 12.3 E2E-003: Employee tạo đơn nghỉ → Manager duyệt

```text
Employee tạo đơn nghỉ
→ Preview số ngày nghỉ
→ Submit
→ Manager nhận notification
→ Manager mở approval
→ Approve
→ Employee nhận notification
→ LEAVE cập nhật Approved
→ ATT chặn/tính lại công ngày nghỉ
→ DASH cập nhật dữ liệu
```

Expected:

1. Balance tính đúng.
2. Manager chỉ duyệt đơn trong team.
3. Approve/reject conflict xử lý đúng.
4. ATT đồng bộ đúng.
5. Notification đúng người.

### 12.4 E2E-004: HR quản lý hồ sơ nhân viên

```text
HR login
→ Mở HR Employee List
→ Search/filter employee
→ Tạo employee mới
→ Employee code tự sinh
→ Gán department/position/manager
→ Link user account
→ Upload file hồ sơ
→ Xem audit log
```

Expected:

1. Mã nhân viên unique.
2. File private không truy cập trái quyền.
3. Field nhạy cảm theo permission.
4. Audit log có actor/action/target.

### 12.5 E2E-005: Employee gửi yêu cầu sửa hồ sơ → HR duyệt

```text
Employee mở My Profile
→ Gửi yêu cầu chỉnh sửa
→ Request Pending
→ HR nhận notification
→ HR so sánh dữ liệu cũ/mới
→ Approve hoặc Reject
→ Employee nhận kết quả
→ Nếu approve, hồ sơ chính mới cập nhật
```

Expected:

1. Employee không sửa trực tiếp hồ sơ chính.
2. Field được phép chỉnh sửa theo config.
3. Dữ liệu chỉ cập nhật sau khi HR duyệt.
4. Notification và audit log đầy đủ.

### 12.6 E2E-006: Manager/HR xử lý điều chỉnh công

```text
Employee gửi yêu cầu điều chỉnh công
→ Manager/HR xem danh sách pending
→ Mở detail
→ Approve/Reject
→ Attendance record cập nhật hoặc giữ nguyên
→ Employee nhận notification
```

Expected:

1. Manager chỉ xử lý nhân viên trong scope.
2. HR xử lý theo quyền company.
3. Reject bắt buộc lý do.
4. Record thay đổi có audit log.

### 12.7 E2E-007: Task assignment và notification

```text
Manager tạo task
→ Giao cho Employee
→ Employee nhận notification
→ Employee mở task detail
→ Cập nhật status
→ Comment/mention user
→ Mentioned user nhận notification
→ Dashboard task cập nhật
```

Expected:

1. Assignee hợp lệ.
2. Không giao task cho employee inactive nếu rule chặn.
3. Warning nếu assignee đang nghỉ phép.
4. Notification đúng event.
5. Task list không lộ project/task trái quyền.

### 12.8 E2E-008: Dashboard theo vai trò

```text
Employee/Manager/HR/Admin login
→ Mở Dashboard
→ Widget hiển thị theo role/permission/scope
→ Quick action điều hướng đúng module gốc
→ Widget lỗi không làm sập dashboard
→ Refresh widget cập nhật dữ liệu
```

Expected:

1. Không render widget thiếu quyền.
2. Data scope đúng.
3. Widget error isolated.
4. Dashboard không xử lý nghiệp vụ gốc.
5. Cache/stale timestamp rõ.

### 12.9 E2E-009: Notification dropdown → deep link

```text
User nhận notification
→ Mở dropdown
→ Click notification
→ Mark read
→ Deep link sang module gốc
→ Module gốc kiểm tra quyền lại
```

Expected:

1. Unread count đúng.
2. Mark read đúng.
3. Deep link không bypass permission.
4. Target không còn tồn tại thì UI xử lý 404.
5. Target ngoài scope thì module gốc trả forbidden.

### 12.10 E2E-010: Admin chỉnh role-permission

```text
Admin mở Role Permission Matrix
→ Thay đổi permission/scope
→ Save
→ Permission cache invalidate
→ User bị ảnh hưởng login/refresh lại
→ Menu/API/action thay đổi đúng
```

Expected:

1. Không hard-code role.
2. Permission/scope mới có hiệu lực.
3. User thiếu quyền bị chặn API.
4. Audit log ghi diff thay đổi.

---

## 13. API testing strategy

### 13.1 API success response

Mọi API success phải kiểm tra:

```text
success = true
message có nội dung phù hợp
data đúng schema
meta.request_id tồn tại
pagination tồn tại với API list
timestamp đúng format
không trả field nhạy cảm
```

### 13.2 API error response

Mọi API error phải kiểm tra:

```text
success = false
message rõ ràng
error.code đúng convention
error.type đúng
error.details đúng context
meta.request_id tồn tại
HTTP status đúng
```

### 13.3 Status code cần test

| Status | Case                                          |
| ------ | --------------------------------------------- |
| 200    | GET/update action thành công nếu dùng 200     |
| 201    | Create thành công nếu backend dùng 201        |
| 204    | Delete/no content nếu backend chọn dùng       |
| 400    | Bad request/ID format sai                     |
| 401    | Chưa login/token invalid/token expired        |
| 403    | Thiếu permission/scope                        |
| 404    | Resource không tồn tại hoặc không được reveal |
| 409    | Conflict/business state đã thay đổi           |
| 422    | Validation error                              |
| 429    | Rate limit nếu có                             |
| 500    | Server error có request id                    |

### 13.4 Idempotency test

API quan trọng cần test chống xử lý trùng:

| API                     | Test                                               |
| ----------------------- | -------------------------------------------------- |
| Check-in                | Gửi 2 request cùng idempotency key                 |
| Check-out               | Không tạo log trùng                                |
| Submit leave            | Không tạo nhiều request do double click            |
| Approve leave           | Không approve nhiều lần                            |
| Create task             | Không tạo task trùng nếu retry                     |
| Upload file             | Không link trùng file nếu retry                    |
| Send notification event | Không tạo notification duplicate nếu có dedupe key |

### 13.5 Pagination/search/filter/sort

Với API list, cần test:

1. Page mặc định.
2. Per page tối đa.
3. Page vượt quá total.
4. Search tiếng Việt có dấu/không dấu nếu hỗ trợ.
5. Filter nhiều điều kiện.
6. Sort whitelist.
7. Không cho sort/filter field không được phép.
8. Scope filter không bị bypass.

---

## 14. UI testing strategy

### 14.1 State bắt buộc

Mỗi màn P0/P1 phải có các state:

| State       | Cần test                                              |
| ----------- | ----------------------------------------------------- |
| Loading     | Skeleton/spinner đúng, không flash dữ liệu trái quyền |
| Empty       | Message đúng, CTA chỉ hiện nếu có quyền               |
| Error       | Retry hoạt động, có request id nếu backend trả        |
| Forbidden   | Không lộ dữ liệu/menu/action trái quyền               |
| Disabled    | Tooltip/alert lý do rõ                                |
| Validation  | Inline error đúng field                               |
| Success     | Toast + refresh/redirect đúng                         |
| Stale       | Last updated/refresh đúng                             |
| Scope empty | Phân biệt rõ với empty toàn hệ thống                  |

### 14.2 Responsive test

| Viewport    | Cần test                                                        |
| ----------- | --------------------------------------------------------------- |
| Desktop     | Sidebar expanded/collapsed, table columns, drawer width         |
| Tablet      | Sidebar drawer/collapsed, filter wrap, table horizontal scroll  |
| Mobile web  | Card list, fullscreen drawer/modal, sticky action, touch target |
| Wide screen | Content không giãn quá khó đọc, dashboard grid hợp lý           |

### 14.3 Accessibility test tối thiểu

| Nhóm          | Cần test                                    |
| ------------- | ------------------------------------------- |
| Keyboard      | Tab order, Enter/Space, ESC close overlay   |
| Focus         | Focus ring, focus trap modal/drawer         |
| Screen reader | aria-label icon button, error announcement  |
| Contrast      | Text và semantic color đủ tương phản        |
| Motion        | Reduced motion không phá trải nghiệm        |
| Form          | Label, required indicator, error message rõ |

### 14.4 Permission UI test

UI-10 đã yêu cầu frontend không hard-code theo role, mà phải dựa vào permission, scope, module active, feature flag và backend allowed actions . Vì vậy QA phải test:

1. User thiếu permission không thấy app/menu/action.
2. User có permission nhưng scope rỗng thấy empty due to scope.
3. User direct URL trái quyền thấy forbidden.
4. Backend trả 403 thì UI không lộ dữ liệu cũ.
5. Widget/action bị backend disable thì UI hiển thị lý do đúng.
6. Field nhạy cảm bị mask nếu thiếu quyền.

---

## 15. Database validation strategy

QA không cần kiểm tra trực tiếp toàn bộ database trong mọi case, nhưng các flow quan trọng cần xác nhận dữ liệu lưu đúng.

### 15.1 Kiểm tra migration/seed

| Case                               | Expected                                           |
| ---------------------------------- | -------------------------------------------------- |
| Chạy migration từ DB trống         | Thành công                                         |
| Re-run seed                        | Không duplicate                                    |
| Seed roles/permissions             | Đủ quyền MVP                                       |
| Seed modules                       | AUTH, HR, ATT, LEAVE, TASK, DASH, NOTI, FOUNDATION |
| Seed dashboard widgets             | Có widget mặc định                                 |
| Seed notification events/templates | Có event/template lõi                              |
| Seed leave/attendance defaults     | Có dữ liệu mặc định                                |
| Rollback migration                 | Có kế hoạch/không phá dữ liệu ngoài dự kiến        |

### 15.2 Kiểm tra dữ liệu nghiệp vụ

| Flow            | Bảng cần kiểm                                                                      |
| --------------- | ---------------------------------------------------------------------------------- |
| Login           | users, user_sessions, login_logs                                                   |
| Create employee | employees, sequence_counters, audit_logs                                           |
| Profile change  | profile_change_requests, profile_change_request_items                              |
| Check-in/out    | attendance_records, attendance_logs                                                |
| Adjustment      | attendance_adjustment_requests/items                                               |
| Leave approve   | leave_requests, leave_request_days, leave_balance_transactions, attendance_records |
| Task update     | tasks, task_activity_logs, task_comments                                           |
| Notification    | notifications, notification_delivery_logs                                          |
| Dashboard       | dashboard_widget_cache nếu có                                                      |
| File upload     | files, file_links, file_access_logs                                                |

### 15.3 Query performance validation

DB-09 đã yêu cầu mọi query nghiệp vụ filter theo `company_id` và index tenant-specific nên đặt `company_id` ở đầu để tránh scan dữ liệu công ty khác . QA/Backend cần kiểm tra:

1. Query list không thiếu `company_id`.
2. Query list có limit.
3. Query scope không bị N+1.
4. Dashboard widget nặng có cache/TTL.
5. Notification unread count có index phù hợp.
6. `EXPLAIN ANALYZE` cho API P0 không có sequential scan bất hợp lý.
7. Export lớn không làm chậm realtime API.

---

## 16. Security testing strategy

### 16.1 Authentication

| Case                          | Expected                           |
| ----------------------------- | ---------------------------------- |
| Không token gọi API nghiệp vụ | 401                                |
| Token sai format              | 401                                |
| Token expired                 | 401 hoặc refresh flow              |
| Refresh token revoked         | Không refresh được                 |
| Logout xong dùng lại token    | Bị chặn nếu backend revoke session |
| User locked                   | Không login/refresh được           |
| Company inactive              | Không truy cập hệ thống            |

### 16.2 Authorization

| Case                                      | Expected                   |
| ----------------------------------------- | -------------------------- |
| Thiếu permission                          | 403                        |
| Có permission nhưng ngoài scope           | 403 hoặc empty scoped list |
| Sửa payload `company_id`                  | Backend bỏ qua/chặn        |
| Sửa payload `employee_id` sang người khác | Bị chặn nếu ngoài scope    |
| Direct URL trái quyền                     | FE guard + BE guard        |
| Deep link notification ngoài scope        | Module gốc trả forbidden   |
| Dashboard widget thiếu quyền              | Không render hoặc trả 403  |

### 16.3 Sensitive data

| Dữ liệu               | Rule                             |
| --------------------- | -------------------------------- |
| Password hash         | Không bao giờ trả về             |
| Refresh token hash    | Không bao giờ trả về             |
| Secret setting        | Không trả nếu thiếu quyền        |
| HR sensitive fields   | Mask/ẩn theo permission          |
| File private path     | Không trả storage path trực tiếp |
| Audit detail nhạy cảm | Chỉ user có quyền xem            |
| Cross-company data    | Không trả trừ scope System       |

### 16.4 File security

| Case                         | Expected                      |
| ---------------------------- | ----------------------------- |
| Upload file sai loại         | Bị chặn nếu policy không cho  |
| Upload file quá size         | Bị chặn                       |
| Download file thiếu quyền    | 403                           |
| File link ngoài module/scope | 403                           |
| File deleted                 | Không tải được                |
| File access log              | Ghi nhận nếu là file nhạy cảm |

---

## 17. Performance testing strategy

### 17.1 Mục tiêu hiệu năng MVP đề xuất

| Nhóm API                     | Mục tiêu đề xuất                     |
| ---------------------------- | ------------------------------------ |
| Auth `/me`                   | < 500ms ở tải bình thường            |
| API list phổ biến            | < 800ms với dữ liệu seed trung bình  |
| Dashboard shell              | < 1000ms nếu widget lazy load        |
| Widget riêng                 | < 1000ms với cache hoặc query tối ưu |
| Notification unread/dropdown | < 500ms                              |
| Check-in/out                 | < 800ms                              |
| Leave submit/approve         | < 1000ms                             |
| Task list                    | < 800ms                              |
| Export                       | Có thể async nếu dữ liệu lớn         |

Các con số trên là mục tiêu MVP ban đầu, có thể điều chỉnh khi có hạ tầng thật.

### 17.2 API cần performance test

| Module     | API/Flow                                         |
| ---------- | ------------------------------------------------ |
| AUTH       | login, refresh, me                               |
| HR         | employee list/search/filter, employee detail     |
| ATT        | today, check-in, monthly records, team records   |
| LEAVE      | my balance, my requests, approval list, calendar |
| TASK       | my tasks, project task list, Kanban              |
| NOTI       | unread count, dropdown, list                     |
| DASH       | dashboard/me, widget data                        |
| FOUNDATION | audit logs, file metadata                        |

### 17.3 Loại performance test

| Loại                   | Mục tiêu                                              |
| ---------------------- | ----------------------------------------------------- |
| Baseline test          | Đo tốc độ với tải thấp                                |
| Load test nhẹ          | Kiểm tra nhiều user đồng thời cơ bản                  |
| Spike test nhỏ         | Kiểm tra notification/dashboard/check-in giờ cao điểm |
| Query profiling        | Kiểm tra query P0 bằng EXPLAIN                        |
| Frontend performance   | Bundle size, route load, dashboard lazy load          |
| Regression performance | So sánh trước/sau release candidate                   |

---

## 18. Automation testing strategy

### 18.1 Ưu tiên automation MVP

| Mức | Nên automation                                                                             |
| --- | ------------------------------------------------------------------------------------------ |
| P0  | Login, permission guard, check-in/out, create leave, approve leave, my tasks, notification |
| P1  | HR employee CRUD, attendance adjustment, dashboard widgets                                 |
| P2  | Settings, template config, advanced filters                                                |
| P3  | Visual polish, copy, minor UI                                                              |

### 18.2 Công cụ đề xuất

Tùy stack thực tế, có thể dùng:

| Mục tiêu                 | Công cụ đề xuất                                        |
| ------------------------ | ------------------------------------------------------ |
| Backend unit/integration | Vitest tùy backend stack                   |
| API test                 | Postman/Newman, Bruno, Playwright API, Supertest       |
| E2E web                  | Playwright                                             |
| Component test           | Testing Library                                        |
| Visual regression        | Playwright screenshot, Chromatic/Loki nếu có Storybook |
| Performance API          | k6, Artillery, JMeter                                  |
| Security basic           | OWASP ZAP baseline, dependency audit                   |
| CI                       | GitHub Actions/GitLab CI/Jenkins                       |

### 18.3 Automation smoke suite

Smoke suite nên chạy nhanh trước mỗi release candidate:

```text
1. Login thành công
2. Load /auth/me
3. Home Portal load app registry
4. Open Dashboard
5. Open Attendance Today
6. Check permission route forbidden
7. Open Notification dropdown
8. Open HR Employee List với HR
9. Open Leave My Requests
10. Open Task My Tasks
```

---

## 19. Bug management

### 19.1 Severity

| Severity | Định nghĩa | Ví dụ |
| --- | --- | --- |
| S0 - Critical / Incident | Hệ thống không dùng được, mất/lộ dữ liệu nghiêm trọng, lỗi bảo mật nghiêm trọng | Không login được toàn hệ thống, lộ HR data, approve sai scope hàng loạt |
| S1 - High | Chặn flow P0/P1, ảnh hưởng nhiều user, không có workaround hợp lý | Không check-in được, không submit/duyệt leave được, API sai data scope |
| S2 - Medium | Ảnh hưởng chức năng quan trọng nhưng có workaround hoặc phạm vi hạn chế | Filter sai một điều kiện, dashboard widget lỗi một phần |
| S3 - Low | Lỗi nhỏ, không chặn nghiệp vụ chính | Label sai, spacing lệch, copy chưa rõ |
| S4 - Cosmetic / Improvement | Cải thiện trải nghiệm, không phải lỗi chức năng | Icon chưa đồng nhất, đề xuất UX |

> **Lưu ý nhất quán:** Thang severity chuẩn của toàn bộ bộ QA là **S0–S4 theo [QA-08 §9](QA-08_Bug_Tracking_Regression_Release_Criteria.md)**. Phiên bản trước của QA-01 dùng S1–S5; đã thống nhất lại theo QA-08 để tránh nhầm lẫn ký hiệu (đặc biệt là "S1").

### 19.2 Priority

| Priority | Ý nghĩa                                    |
| -------- | ------------------------------------------ |
| P0       | Phải fix trước release/UAT                 |
| P1       | Nên fix trước release                      |
| P2       | Có thể fix sau MVP nếu không ảnh hưởng lớn |
| P3       | Backlog cải tiến                           |

### 19.3 Thông tin bắt buộc trong bug ticket

Mỗi bug cần có:

```text
- Title rõ ràng
- Environment
- Build/version/commit nếu có
- User/role/scope dùng để test
- Module/screen/API
- Steps to reproduce
- Actual result
- Expected result
- Screenshot/video/log nếu có
- Request id/correlation id nếu lỗi API
- Severity
- Priority
- Assignee
- Related test case
```

### 19.4 Bug lifecycle

```text
New
→ Triaged
→ In Progress
→ Fixed
→ Ready for QA
→ Verified
→ Closed
```

Nếu verify fail thì `Reopened → In Progress`. Các trạng thái đặc biệt khác:

```text
Deferred / Duplicate / Won't Fix / Cannot Reproduce / Need Info
```

> Vòng đời bug chi tiết (kèm người chuyển trạng thái) là chuẩn trong [QA-08 §11](QA-08_Bug_Tracking_Regression_Release_Criteria.md).

---

## 20. Regression strategy

### 20.1 Khi nào cần regression

Regression bắt buộc khi:

1. Fix bug S1/S2.
2. Thay đổi permission/RBAC.
3. Thay đổi API contract.
4. Thay đổi database migration/index.
5. Thay đổi rule ATT/LEAVE.
6. Thay đổi auth/session/token.
7. Thay đổi dashboard/notification event.
8. Trước UAT.
9. Trước release candidate.
10. Sau deployment staging/production.

### 20.2 Regression scope theo mức thay đổi

| Thay đổi           | Regression tối thiểu            |
| ------------------ | ------------------------------- |
| UI copy nhỏ        | Screen liên quan                |
| Component shared   | Tất cả screen dùng component P0 |
| API response       | FE integration + API contract   |
| Permission logic   | QA-05 full permission subset    |
| Attendance rule    | ATT + LEAVE sync + DASH         |
| Leave approval     | LEAVE + ATT + NOTI + DASH       |
| Task assignment    | TASK + NOTI + DASH              |
| Auth/session       | Full smoke + protected route    |
| Database migration | Migration/seed + core API       |

---

## 21. Entry criteria cho QA

Một tính năng chỉ được chuyển sang QA khi đạt:

1. Code đã merge vào branch test/staging.
2. Migration liên quan đã chạy thành công.
3. Seed data cần thiết đã có.
4. API endpoint đã sẵn sàng hoặc mock rõ ràng.
5. FE đã connect API thật hoặc mock được đánh dấu.
6. Dev đã tự smoke test.
7. Không còn lỗi build/lint/type nghiêm trọng.
8. Có mô tả scope tính năng.
9. Có link ticket/spec/API/UI liên quan.
10. Có thông tin role/user test.

---

## 22. Exit criteria cho QA

Một tính năng được QA pass khi:

1. Test case P0/P1 pass.
2. Không còn bug S1/S2 mở.
3. Bug S3 còn lại có owner và quyết định rõ.
4. API contract đúng.
5. Permission/data scope đúng.
6. State UI chính đúng.
7. Responsive P0 chấp nhận được.
8. Audit/notification đúng nếu áp dụng.
9. Regression liên quan pass.
10. Evidence đã được lưu.

---

## 23. Release criteria MVP

MVP chỉ nên release khi:

### 23.1 Functional readiness

* [ ] Login/logout/refresh token ổn định.
* [ ] Home Portal/App Switcher hoạt động.
* [ ] AUTH/RBAC hoạt động đúng.
* [ ] HR core flow hoạt động.
* [ ] ATT check-in/check-out hoạt động.
* [ ] LEAVE request/approval hoạt động.
* [ ] TASK my task/project/task detail hoạt động.
* [ ] NOTI dropdown/list/mark read/deep link hoạt động.
* [ ] DASH theo role hoạt động.
* [ ] FOUNDATION audit/file/settings cơ bản hoạt động.

### 23.2 Security readiness

* [ ] Không có bug S1/S2 về phân quyền.
* [ ] Không lộ field nhạy cảm.
* [ ] Không truy cập được dữ liệu ngoài scope.
* [ ] Không bypass bằng direct URL/API payload.
* [ ] File private có kiểm soát quyền.
* [ ] Token/session hoạt động đúng.

### 23.3 Data readiness

* [ ] Migration chạy được từ database trống.
* [ ] Seed idempotent.
* [ ] Dữ liệu test staging đủ cho UAT.
* [ ] Không có lỗi mất dữ liệu ở flow P0.
* [ ] Audit log cho thao tác quan trọng.
* [ ] Sequence sinh mã không trùng.

### 23.4 Performance readiness

* [ ] API P0 đạt mục tiêu response time cơ bản.
* [ ] Dashboard không timeout.
* [ ] Notification unread count không chậm bất thường.
* [ ] Employee/attendance/task list có pagination/filter ổn.
* [ ] Không có N+1 nghiêm trọng ở API P0.
* [ ] Slow query đã được review.

### 23.5 UX readiness

* [ ] P0 screens có loading/empty/error/forbidden/validation/success state.
* [ ] Responsive mobile web cho Employee P0 đạt.
* [ ] Form dirty guard ở flow quan trọng.
* [ ] Error message đủ rõ.
* [ ] Accessibility tối thiểu pass.
* [ ] UI không hiển thị action thiếu quyền.

### 23.6 Operational readiness

* [ ] Có staging release candidate.
* [ ] Có rollback plan.
* [ ] Có log/request id để debug.
* [ ] Có monitoring cơ bản.
* [ ] Có checklist smoke test sau deploy.
* [ ] Có owner xử lý incident.

---

## 24. Deliverable của QA-01

Sau khi chốt QA-01, cần có:

| Mã           | Deliverable                     | Bắt buộc |
| ------------ | ------------------------------- | -------- |
| QA01-DEL-001 | QA Strategy & Test Plan         | Có       |
| QA01-DEL-002 | Module test scope overview      | Có       |
| QA01-DEL-003 | Critical E2E flow list          | Có       |
| QA01-DEL-004 | Role/data scope test strategy   | Có       |
| QA01-DEL-005 | Test environment plan           | Có       |
| QA01-DEL-006 | Test data strategy              | Có       |
| QA01-DEL-007 | Bug severity/priority guideline | Có       |
| QA01-DEL-008 | Entry/exit criteria             | Có       |
| QA01-DEL-009 | MVP release criteria            | Có       |
| QA01-DEL-010 | Roadmap QA-02 → QA-10           | Có       |

---

## 25. Acceptance criteria QA-01

QA-01 được xem là đạt khi:

| Mã          | Tiêu chí nghiệm thu                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| QA01-AC-001 | Có mục tiêu QA rõ ràng cho MVP                                                                         |
| QA01-AC-002 | Có phạm vi module cần kiểm thử                                                                         |
| QA01-AC-003 | Có chiến lược test theo business, API, permission, UI, performance                                     |
| QA01-AC-004 | Có danh sách test level: unit, integration, API, contract, E2E, regression, security, performance, UAT |
| QA01-AC-005 | Có test environment plan: local, development, staging, production smoke                                |
| QA01-AC-006 | Có test data strategy đủ role, department, employee, attendance, leave, task, notification             |
| QA01-AC-007 | Có role/data scope matrix tổng quan                                                                    |
| QA01-AC-008 | Có critical E2E flow MVP                                                                               |
| QA01-AC-009 | Có bug severity/priority guideline                                                                     |
| QA01-AC-010 | Có entry/exit criteria cho QA                                                                          |
| QA01-AC-011 | Có release criteria cho MVP                                                                            |
| QA01-AC-012 | Có định hướng cho QA-02 Test Case Matrix                                                               |
| QA01-AC-013 | Tài liệu đủ để QA bắt đầu lập test case chi tiết mà không phải suy đoán phạm vi kiểm thử               |

---

## 26. Roadmap tiếp theo sau QA-01

Sau QA-01, bước tiếp theo nên triển khai:

```text
QA-02: Test Case Matrix
```

QA-02 sẽ chuyển chiến lược trong QA-01 thành ma trận test case cụ thể theo:

```text
Module
→ Screen
→ API
→ Role
→ Data scope
→ Test scenario
→ Test case
→ Priority
→ Test data
→ Expected result
→ Automation candidate
```

Thứ tự triển khai QA tiếp theo:

```text
QA-02: Test Case Matrix
QA-03: End-to-End Flow Testing
QA-04: API Testing & Contract Testing
QA-05: Permission, Role & Data Scope Testing
QA-06: Security Testing
QA-07: Performance & Load Testing
QA-08: Bug Tracking, Regression & Release Criteria
QA-09: UAT Plan & Business Acceptance
QA-10: MVP Release Readiness Checklist
```

---

## 27. Kết luận

QA-01 chốt chiến lược kiểm thử tổng thể cho MVP của hệ thống quản lý doanh nghiệp nội bộ.

Tư duy kiểm thử chính:

```text
Không chỉ test màn hình
→ Phải test API contract
→ Phải test database/business rule
→ Phải test permission và data scope
→ Phải test cross-module event
→ Phải test dashboard/notification/audit
→ Phải test performance tối thiểu
→ Phải có release criteria rõ ràng
```

Bước tiếp theo nên triển khai ngay:

```text
QA-02: Test Case Matrix
```

---

## 28. Tài liệu liên quan

Bộ tài liệu QA cho MVP (thứ tự triển khai chuẩn — mọi tài liệu khác phải bám theo roadmap này):

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| **QA-01 (tài liệu này)** | QA Strategy & Test Plan | Tài liệu nền: chiến lược, phạm vi, tiêu chí |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Ma trận test case theo module/role/scope |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | Kiểm thử flow nghiệp vụ xuyên module |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | Kiểm thử API contract/response/error |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | RBAC, data scope, field/route guard |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Bảo mật, OWASP, multi-tenant isolation |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Hiệu năng, tải, SLA/SLO |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug lifecycle, regression, release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Nghiệm thu nghiệp vụ với stakeholder |
| [QA-10](QA-10_MVP_Release_Readiness_Checklist.md) | MVP Release Readiness Checklist | Checklist release gate cuối |
