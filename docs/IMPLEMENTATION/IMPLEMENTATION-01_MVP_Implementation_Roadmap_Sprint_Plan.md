# IMPLEMENTATION-01: MVP IMPLEMENTATION ROADMAP & SPRINT PLAN
# LỘ TRÌNH TRIỂN KHAI MVP & KẾ HOẠCH SPRINT
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-01 |
| Tên tài liệu | MVP Implementation Roadmap & Sprint Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12, DECISIONS-01, COMPLIANCE-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này chuyển toàn bộ thiết kế sản phẩm, database, API, UI/UX, frontend, backend, QA và DevOps đã có thành một **lộ trình triển khai MVP có thể thực thi theo sprint**.

IMPLEMENTATION-01 dùng để:

1. Chốt thứ tự triển khai MVP từ nền tảng đến nghiệp vụ.
2. Chia toàn bộ MVP thành các sprint có mục tiêu rõ ràng.
3. Xác định deliverable của từng sprint cho Backend, Frontend, QA, DevOps và Product.
4. Xác định dependency giữa các module AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
5. Xác định milestone kiểm thử, tích hợp, UAT, release candidate và go-live.
6. Giúp team tránh triển khai dàn trải, lệch phụ thuộc hoặc thiếu chuẩn nghiệm thu.
7. Làm checklist quản lý tiến độ, rủi ro, chất lượng và phạm vi MVP.

Tài liệu này không thay thế tài liệu kỹ thuật chi tiết. Khi triển khai một module cụ thể, team vẫn phải tham chiếu tài liệu DB/API/UI/FRONTEND/BACKEND/QA/DEVOPS tương ứng.

---

## 3. Vị trí IMPLEMENTATION-01 trong chuỗi tài liệu

Chuỗi tài liệu dự án tổng thể:

```text
PRD / SPEC
  -> Database Design
  -> API Design
  -> UI/UX Design
  -> Frontend Implementation Design
  -> Backend Implementation Design
  -> QA Plan
  -> DevOps Plan
  -> IMPLEMENTATION Roadmap
  -> Sprint Execution
  -> UAT
  -> Production Go-live
```

IMPLEMENTATION-01 là tài liệu điều phối triển khai thực tế sau khi các nhóm thiết kế lớn đã được định hình.

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
IMPLEMENTATION-10: Post-MVP Backlog & Phase 2 Planning
```

---

## 4. Nguyên tắc triển khai MVP

### 4.1 Triển khai theo dependency, không triển khai theo cảm tính

Thứ tự ưu tiên kỹ thuật:

```text
Foundation
-> AUTH/RBAC
-> HR
-> ATT + LEAVE
-> TASK
-> NOTI
-> DASH
-> Cross-module integration
-> QA/UAT
-> Release
```

Lý do:

1. AUTH là nền tảng xác thực và phân quyền cho toàn hệ thống.
2. HR là nguồn dữ liệu employee, department, position, manager và employment status.
3. ATT, LEAVE và TASK đều cần dữ liệu employee từ HR.
4. NOTI nhận event từ các module nghiệp vụ.
5. DASH tổng hợp dữ liệu từ HR, ATT, LEAVE, TASK và NOTI.
6. QA và UAT chỉ có giá trị cao khi các luồng cross-module đã đủ dữ liệu thật.

### 4.2 Backend guard là nguồn bảo vệ cuối cùng

Frontend được phép ẩn/hiện menu, app, button, widget và field để cải thiện UX, nhưng backend luôn phải kiểm tra:

1. Authentication.
2. Permission.
3. Data scope.
4. Business rule.
5. Audit log.
6. Notification event nếu có.

### 4.3 Mỗi sprint phải tạo được increment có thể kiểm thử

Mỗi sprint cần có kết quả có thể chạy được trên môi trường development hoặc staging:

```text
Code chạy được
+ migration/seed chạy được
+ API có contract rõ
+ UI gọi được API hoặc mock theo contract
+ test case tối thiểu pass
+ bug critical được xử lý hoặc ghi nhận rõ
```

Không tính là hoàn thành nếu chỉ có thiết kế hoặc code chưa tích hợp.

### 4.4 MVP ưu tiên luồng lõi, không mở rộng quá sớm

Các module sau chỉ giữ thiết kế mở rộng, không triển khai sâu trong MVP:

| Module | Trạng thái MVP |
| --- | --- |
| PAYROLL | Chưa triển khai, chỉ chừa dữ liệu ATT/LEAVE/HR |
| RECRUIT | Chưa triển khai |
| ASSET | Chưa triển khai |
| ROOM | Chưa triển khai |
| CHAT | Chưa triển khai |
| SOCIAL | Chưa triển khai |
| MOBILE | Chưa triển khai native app, chỉ web responsive |
| AI | Chưa triển khai |

### 4.5 Ưu tiên vertical slice thay vì chỉ hoàn thiện từng lớp riêng lẻ

Mỗi module nghiệp vụ nên được triển khai theo lát cắt dọc:

```text
Migration
-> Entity/model
-> Service
-> API endpoint
-> Permission guard
-> Frontend screen
-> QA test
-> Audit/notification nếu có
```

Cách này giúp phát hiện lỗi tích hợp sớm hơn so với việc backend hoặc frontend làm tách rời quá lâu.

---

## 5. Phạm vi MVP triển khai

### 5.1 Module thuộc MVP

| Module | Vai trò trong MVP | Mức ưu tiên |
| --- | --- | --- |
| FOUNDATION | Company, settings, audit, files, sequence, seed, module catalog | P0 |
| AUTH | Login, session, user, role, permission, data scope | P0 |
| HR | Employee, department, position, contract, profile change, employee code | P0 |
| ATT | Check-in/out, attendance records, shift, rule, adjustment, remote work | P0 |
| LEAVE | Leave request, balance, approval, calendar, ATT sync | P0 |
| TASK | Project, task, assignee, kanban, comment, checklist, file | P1 |
| NOTI | In-app notification, unread count, dropdown, event pipeline | P1 |
| DASH | Role dashboard, widgets, quick actions, cache | P1 |

### 5.2 Luồng nghiệp vụ MVP bắt buộc

| Mã luồng | Tên luồng | Module liên quan | Ưu tiên |
| --- | --- | --- | --- |
| FLOW-001 | Login -> Home Portal -> App Switcher -> Module Workspace | AUTH, FOUNDATION, UI Shell | P0 |
| FLOW-002 | Admin tạo user/role/permission và gán quyền | AUTH | P0 |
| FLOW-003 | HR tạo nhân viên, sinh mã, liên kết user | HR, AUTH | P0 |
| FLOW-004 | Employee xem hồ sơ cá nhân và gửi yêu cầu chỉnh sửa | HR, NOTI | P0 |
| FLOW-005 | HR duyệt/từ chối yêu cầu chỉnh sửa hồ sơ | HR, NOTI, DASH | P0 |
| FLOW-006 | Employee check-in/check-out | ATT, HR, AUTH | P0 |
| FLOW-007 | Employee gửi yêu cầu điều chỉnh công | ATT, NOTI | P0 |
| FLOW-008 | Manager/HR duyệt điều chỉnh công | ATT, NOTI, DASH | P0 |
| FLOW-009 | Employee tạo/gửi/hủy đơn nghỉ | LEAVE, HR, ATT, NOTI | P0 |
| FLOW-010 | Manager/HR duyệt/từ chối đơn nghỉ | LEAVE, ATT, NOTI, DASH | P0 |
| FLOW-011 | Manager tạo project/task và giao việc | TASK, HR, NOTI | P1 |
| FLOW-012 | Employee xem task, cập nhật trạng thái, comment | TASK, NOTI, DASH | P1 |
| FLOW-013 | Notification dropdown, unread count, mark read, deep link | NOTI, AUTH, module nguồn | P1 |
| FLOW-014 | Dashboard Employee/Manager/HR/Admin | DASH, HR, ATT, LEAVE, TASK, NOTI | P1 |

### 5.3 Ngoài phạm vi MVP Implementation-01

| Nội dung | Lý do loại khỏi MVP |
| --- | --- |
| Payroll calculation đầy đủ | Phase 2, cần dữ liệu ATT/LEAVE ổn định trước |
| Native mobile app | MVP ưu tiên web responsive |
| Realtime WebSocket production-grade | MVP có thể dùng polling hoặc refresh thủ công |
| BI dashboard nâng cao | MVP chỉ cần widget vận hành |
| Multi-tenant SaaS billing | MVP chỉ thiết kế sẵn company_id |
| Device attendance integration thật | MVP chừa thiết kế, chưa tích hợp thiết bị vật lý |
| AI assistant / automation | Phase sau |

---

## 6. Giả định lập kế hoạch sprint

### 6.1 Sprint length

Khuyến nghị:

```text
1 sprint = 2 tuần
```

Có thể rút xuống 1 tuần nếu team nhỏ và scope ít, hoặc kéo dài 3 tuần nếu phải vừa tuyển team vừa triển khai.

### 6.2 Quy mô team tham chiếu

| Vai trò | Số lượng đề xuất | Ghi chú |
| --- | ---: | --- |
| Product Owner / BA | 1 | Chốt nghiệp vụ, ưu tiên backlog, nghiệm thu |
| Project Manager / Scrum Master | 1 | Điều phối sprint, blocker, timeline |
| Tech Lead / Architect | 1 | Chốt kiến trúc, review kỹ thuật, cross-module |
| Backend Developer | 2 - 4 | Module API, service, migration |
| Frontend Developer | 2 - 4 | UI, integration, state, form, route |
| QA Engineer | 1 - 2 | Test case, regression, UAT support |
| DevOps Engineer | 1 | CI/CD, env, deploy, monitoring |
| UI/UX Designer | 0.5 - 1 | Hỗ trợ chỉnh UI/handoff trong sprint |

### 6.3 Cách đọc effort

| Mức effort | Ý nghĩa |
| --- | --- |
| S | 1 - 2 ngày người |
| M | 3 - 5 ngày người |
| L | 1 - 2 tuần người |
| XL | Cần chia nhỏ thêm |

---

## 7. Roadmap tổng thể MVP

### 7.1 Timeline đề xuất

| Giai đoạn | Sprint | Execution plan | Mục tiêu chính | Kết quả đầu ra |
| --- | --- | --- | --- | --- |
| Phase 0 | Sprint 0 | IMPLEMENTATION-03 | Kickoff & Implementation Readiness | Backlog, repo, env, DoR/DoD, issue board, tracking |
| Phase 1 | Sprint 1 | IMPLEMENTATION-04 | Foundation, Environment & Core Infra | App shell chạy được, DB nền, seed, API client, frontend core |
| Phase 2 | Sprint 2 | IMPLEMENTATION-05 | Auth & HR Core | Login, permission guard, employee/org, profile change, contract |
| Phase 3 | Sprint 3 | IMPLEMENTATION-06 | Attendance & Leave Core | Check-in/out, records, shift/rule, leave approval, ATT-LEAVE sync |
| Phase 4 | Sprint 4 | IMPLEMENTATION-07 | Task, Notification & Dashboard | Task/project, notification, dashboard widget |
| Phase 5 | Sprint 5 | IMPLEMENTATION-08 | Integration, QA Hardening & UAT | End-to-end flows, field/export security, OpenAPI, test, UAT |
| Phase 6 | Sprint 6 | IMPLEMENTATION-09 | Stabilization, RC & Go-live | RC build, production checklist, go-live, hypercare |

### 7.2 Milestone chính

| Milestone | Sprint target | Điều kiện đạt |
| --- | --- | --- |
| M0 - Project ready | Sprint 0 | Repo, board, environments, CI skeleton sẵn sàng |
| M1 - Platform foundation ready | Sprint 1 | App shell, DB nền, seed MVP, API client hoạt động |
| M2 - Auth & HR ready | Sprint 2 | Login, auth context, permission guard, HR core flow chạy từ BE -> FE -> QA |
| M3 - Attendance & Leave ready | Sprint 3 | Check-in/out, leave approval, ATT sync chạy end-to-end |
| M4 - Task/Noti/Dashboard ready | Sprint 4 | Task assigned, notification, dashboard widget hoạt động |
| M5 - MVP integrated & UAT passed | Sprint 5 | Toàn bộ flow P0/P1 tích hợp trên staging, UAT critical pass, bug blocker/critical = 0 |
| M6 - Production go-live | Sprint 6 | Release checklist pass, RC build, rollback plan sẵn sàng |

---

## 8. Sprint Plan tổng hợp (7 sprint)

> MVP triển khai theo **7 sprint (Sprint 0 -> Sprint 6)**, mỗi sprint mặc định 2 tuần (10 ngày làm việc). Mục dưới đây tóm tắt mục tiêu / deliverable / exit criteria từng sprint ở mức roadmap. **Kế hoạch chi tiết theo ngày, task, acceptance criteria và issue board của mỗi sprint nằm trong tài liệu execution plan tương ứng (IMPLEMENTATION-03 -> IMPLEMENTATION-09)** — IMPLEMENTATION-01 không lặp lại chi tiết đó. Tổng point backlog: **869** (xem IMPLEMENTATION-02 §9).

| Sprint | Execution plan | Mục tiêu | Module / Epic | Point |
| --- | --- | --- | --- | ---: |
| Sprint 0 | IMPLEMENTATION-03 | Kickoff, issue board, governance, repo/CI skeleton | EPIC-00 | 14 |
| Sprint 1 | IMPLEMENTATION-04 | Foundation, environment, core infra + frontend core shell | EPIC-01, EPIC-09 | 91 |
| Sprint 2 | IMPLEMENTATION-05 | Auth/RBAC end-to-end + HR core (employee/org/profile/contract) | EPIC-02, EPIC-03 | 200 |
| Sprint 3 | IMPLEMENTATION-06 | Attendance core + Leave core + ATT-LEAVE sync | EPIC-04, EPIC-05 | 241 |
| Sprint 4 | IMPLEMENTATION-07 | Task/project, notification, role dashboard | EPIC-06, EPIC-07, EPIC-08 | 231 |
| Sprint 5 | IMPLEMENTATION-08 | Cross-module integration, field/export security, OpenAPI, QA hardening, UAT | EPIC-10, EPIC-11 (test) | 79 |
| Sprint 6 | IMPLEMENTATION-09 | Stabilization, release candidate, go-live, hypercare | EPIC-11 (UAT/release) | 13 |

### 8.1 Sprint 0 - Kickoff & Implementation Readiness

- **Mục tiêu:** Chuẩn bị đủ để team bắt đầu code nhất quán, không tranh cãi lại scope, convention hoặc môi trường.
- **Deliverable chính:** Backlog MVP, issue board + label/workflow, repo FE/BE/Infra, CI skeleton, DoR/DoD, risk register, traceability matrix.
- **Exit criteria:** Team có thể bắt đầu Sprint 1 mà không thiếu repo, backlog, môi trường local và quy ước làm việc cơ bản.
- **Chi tiết:** IMPLEMENTATION-03.

### 8.2 Sprint 1 - Foundation, Environment & Core Infrastructure

- **Mục tiêu:** Dựng lớp nền dùng chung (company, module catalog, settings, audit, file, sequence, holiday, seed) và bộ khung frontend (design system, layout, API client, route/app registry); chuẩn bị auth skeleton/bootstrap admin.
- **Deliverable chính:** Migration + seed nền idempotent, audit/file/setting/sequence service, app shell + API client + error mapper, route/app/sidebar registry, `/health`, `/auth/me` shell.
- **Exit criteria:** App chạy được end-to-end skeleton, migrate/seed từ DB trống thành công, frontend core sẵn sàng cho module nghiệp vụ.
- **Chi tiết:** IMPLEMENTATION-04.

### 8.3 Sprint 2 - Auth & HR Core

- **Mục tiêu:** Xác thực, session, RBAC, permission/data-scope guard end-to-end; HR core (employee, department, position, contract, profile change có duyệt, employee code).
- **Deliverable chính:** Login/logout, user context, refresh theo chiến lược token đã chốt, user/role/permission admin, employee CRUD + org tree, self-service profile change, employee code generator, tích hợp HR tạo user (098) và manager scope (099).
- **Exit criteria:** Mọi API nghiệp vụ qua guard backend; HR core flow chạy BE -> FE -> QA; field nhạy cảm mask/hide theo quyền.
- **Chi tiết:** IMPLEMENTATION-05.

### 8.4 Sprint 3 - Attendance & Leave Core

- **Mục tiêu:** Chấm công (today/check-in/out/records/shift/rule/adjustment/remote) và nghỉ phép (balance, request, approval, calendar, policy) cùng đồng bộ LEAVE -> ATT.
- **Deliverable chính:** Check-in/out server-time, attendance records + log, shift/rule resolver, adjustment workflow, leave balance ledger, create/approve leave, leave calendar, ATT-LEAVE sync idempotent (100).
- **Exit criteria:** Approve nghỉ ảnh hưởng đúng bảng công; double check-in/approve idempotent; scope Own/Team/Company đúng.
- **Chi tiết:** IMPLEMENTATION-06.

### 8.5 Sprint 4 - Task, Notification & Dashboard

- **Mục tiêu:** Quản lý dự án/task/Kanban/comment/checklist; notification event-driven in-app; dashboard theo role với widget cache.
- **Deliverable chính:** Project/task CRUD + assignment + status, Kanban, comment/mention, notification event catalog + producer + recipient resolver + badge/list, role dashboards + widget lazy load + cache/invalidation, tích hợp TASK-LEAVE (101), module-NOTI (102), module-DASH cache (103).
- **Exit criteria:** Task assigned phát notification đúng recipient; dashboard widget độ trễ chấp nhận được, degraded state khi module nguồn lỗi.
- **Chi tiết:** IMPLEMENTATION-07.

### 8.6 Sprint 5 - Integration, QA Hardening & UAT

- **Mục tiêu:** Tích hợp xuyên module, siết field-level/export permission, chuẩn hóa OpenAPI, chạy test matrix (API/E2E/security/performance), responsive P0 và UAT.
- **Deliverable chính:** Field/export security (104), OpenAPI contract theo module (105), responsive mobile web P0 (097), test case matrix + API/permission test + E2E P0 + security + performance smoke (106-110), UAT script và bug triage.
- **Exit criteria:** Toàn bộ flow P0/P1 tích hợp trên staging; UAT critical pass; bug blocker/critical = 0.
- **Chi tiết:** IMPLEMENTATION-08.

### 8.7 Sprint 6 - Stabilization, Release Candidate & Go-live

- **Mục tiêu:** Ổn định hệ thống, scope freeze, dựng release candidate, diễn tập deploy/rollback, go-live và hypercare.
- **Deliverable chính:** Bug-fix-only stabilization, RC build + release notes, go-live runbook + rollback rehearsal, migration/backup verification, monitoring/alerting readiness, UAT sign-off (111), release readiness checklist (112), go/no-go gate.
- **Exit criteria:** Release checklist pass, RC deploy staging, rollback plan + RTO/RPO (theo COMPLIANCE-01) sẵn sàng, go-live quyết định.
- **Chi tiết:** IMPLEMENTATION-09.

### 8.8 Lưu ý capacity

Mô hình 7 sprint gộp nhiều module lõi vào một sprint nên tải point không đều: Sprint 2 (200), Sprint 3 (241) và Sprint 4 (231) **vượt xa một sprint 2 tuần đơn thuần** với team tham chiếu (velocity thực tế thường 40-80 point/2 tuần). Vì vậy các sprint này bắt buộc một trong các phương án: (a) tăng số dev song song theo module, (b) kéo dài sprint (3-4 tuần), hoặc (c) tách thành 2 sprint nhỏ. Product Owner + Tech Lead chốt velocity thực tế sau Sprint 0-1 rồi điều chỉnh. Xem IMPLEMENTATION-02 §9.1 và mục Capacity & Estimation trong từng execution plan.

---

## 9. Epic Breakdown cấp cao

> Cột Sprint dưới đây theo mô hình 7 sprint (S0-S6); crosswalk epic sang IMPLEMENTATION-02 xem §9 tài liệu đó.

### 9.1 EPIC-FND - Foundation (-> EPIC-01)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| FND-01 | Company/module/settings foundation | S1 |
| FND-02 | Audit log foundation | S1 |
| FND-03 | File metadata/file link/file permission | S1, S4 |
| FND-04 | Sequence counter | S1, S2 |
| FND-05 | Public holidays | S1, S3 |
| FND-06 | Seed tracking | S1 |

### 9.2 EPIC-AUTH - Authentication & RBAC (-> EPIC-02)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| AUTH-01 | Login/logout/refresh/me | S2 |
| AUTH-02 | User management | S2 |
| AUTH-03 | Role/permission management | S2 |
| AUTH-04 | Permission/data scope guard | S2-S5 |
| AUTH-05 | Login/security logs | S2 |

### 9.3 EPIC-HR - Human Resource (-> EPIC-03)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| HR-01 | Employee CRUD | S2 |
| HR-02 | Department/position/job level | S2 |
| HR-03 | Employee code config | S2 |
| HR-04 | Contract management | S2 |
| HR-05 | Employee file | S2 |
| HR-06 | My profile | S2 |
| HR-07 | Profile change approval | S2 |

### 9.4 EPIC-ATT - Attendance (-> EPIC-04)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| ATT-01 | Today attendance | S3 |
| ATT-02 | Check-in/out | S3 |
| ATT-03 | Attendance records/logs | S3 |
| ATT-04 | Shift/rule | S3 |
| ATT-05 | Adjustment request | S3 |
| ATT-06 | Manual adjustment | S3 |
| ATT-07 | Remote work | S3 |
| ATT-08 | Leave sync | S3 |

### 9.5 EPIC-LEAVE - Leave Management (-> EPIC-05)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| LEAVE-01 | Leave type/policy | S3 |
| LEAVE-02 | Leave balance | S3 |
| LEAVE-03 | Leave request draft/submit/cancel | S3 |
| LEAVE-04 | Leave approval | S3 |
| LEAVE-05 | Leave calendar | S3 |
| LEAVE-06 | ATT sync | S3 |

### 9.6 EPIC-TASK - Task & Project (-> EPIC-06)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| TASK-01 | Project CRUD | S4 |
| TASK-02 | Project member | S4 |
| TASK-03 | Task CRUD/assignment | S4 |
| TASK-04 | My tasks | S4 |
| TASK-05 | Kanban | S4 |
| TASK-06 | Comment/mention/checklist/file | S4 |
| TASK-07 | Activity log | S4 |

### 9.7 EPIC-NOTI - Notification (-> EPIC-07)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| NOTI-01 | My notification list/dropdown/unread | S4 |
| NOTI-02 | Mark read/hide/delete | S4 |
| NOTI-03 | Internal event pipeline | S4 |
| NOTI-04 | Template/recipient/dedupe | S4 |
| NOTI-05 | Delivery log IN_APP | S4 |

### 9.8 EPIC-DASH - Dashboard (-> EPIC-08)

| Feature | Nội dung | Sprint |
| --- | --- | --- |
| DASH-01 | Dashboard me/type | S4 |
| DASH-02 | Widget catalog/config | S4 |
| DASH-03 | Employee dashboard | S4 |
| DASH-04 | Manager dashboard | S4 |
| DASH-05 | HR dashboard | S4 |
| DASH-06 | Admin dashboard | S4 |
| DASH-07 | Cache/invalidation | S4-S5 |

---

## 10. Dependency Map

### 10.1 Dependency theo module

```text
FOUNDATION
  -> AUTH
  -> HR
  -> ATT
  -> LEAVE
  -> TASK
  -> NOTI
  -> DASH

AUTH
  -> HR, ATT, LEAVE, TASK, NOTI, DASH

HR
  -> ATT, LEAVE, TASK, DASH, NOTI

ATT
  -> LEAVE sync, DASH, NOTI, Payroll phase sau

LEAVE
  -> ATT sync, DASH, NOTI, Payroll phase sau

TASK
  -> DASH, NOTI

NOTI
  -> DASH header badge/widget

DASH
  -> Read-only aggregate from HR/ATT/LEAVE/TASK/NOTI
```

### 10.2 Dependency theo dữ liệu

| Dữ liệu | Nguồn chính | Module sử dụng |
| --- | --- | --- |
| user/session/permission | AUTH | Tất cả module |
| employee/department/manager | HR | ATT, LEAVE, TASK, DASH, NOTI |
| attendance_records | ATT | DASH, LEAVE sync, Payroll phase sau |
| leave_requests/leave_days | LEAVE | ATT, DASH, TASK warning, Payroll phase sau |
| projects/tasks | TASK | DASH, NOTI, ATT remote phase sau |
| notifications | NOTI | DASH, Header/Topbar |
| dashboard_widget_cache | DASH | Frontend dashboard |
| audit_logs | FOUNDATION | Admin/System, QA, compliance |
| files/file_links | FOUNDATION | HR, ATT, LEAVE, TASK |

---

## 11. Definition of Ready

Một user story được đưa vào sprint khi đạt các điều kiện sau:

- [ ] Có mô tả nghiệp vụ rõ ràng.
- [ ] Có actor chính.
- [ ] Có acceptance criteria.
- [ ] Có permission/data scope liên quan.
- [ ] Có API hoặc mock API contract.
- [ ] Có màn hình/UI reference hoặc component cần dùng.
- [ ] Có database/table liên quan đã biết.
- [ ] Có business rule lỗi chính.
- [ ] Có test scenario tối thiểu.
- [ ] Không còn blocker thiết kế nghiêm trọng.

---

## 12. Definition of Done

Một user story được xem là Done khi:

- [ ] Code đã merge vào nhánh chính theo quy trình.
- [ ] Migration/seed nếu có đã chạy được từ DB trống hoặc DB hiện tại.
- [ ] API đã validate input, permission, data scope và business rule.
- [ ] API trả response/error đúng chuẩn.
- [ ] Frontend hiển thị đủ loading, empty, error, forbidden và success state.
- [ ] Frontend không hard-code role nếu đã có permission/data scope.
- [ ] Audit log được ghi cho thao tác quan trọng.
- [ ] Notification event được phát nếu story yêu cầu.
- [ ] Unit/integration test tối thiểu pass.
- [ ] QA test case pass hoặc bug được ghi nhận rõ.
- [ ] Không còn bug blocker/critical mở.
- [ ] Tài liệu API/README/handoff được cập nhật nếu có thay đổi.

---

## 13. Release Gates

### 13.1 Gate 1 - Foundation Ready

Điều kiện:

- [ ] Database foundation migration pass.
- [ ] AUTH/RBAC hoạt động.
- [ ] Login/logout/refresh/me pass.
- [ ] Permission seed pass.
- [ ] Frontend route guard hoạt động.
- [ ] CI basic pass.

### 13.2 Gate 2 - Core Business Ready

Điều kiện:

- [ ] HR employee data ổn định.
- [ ] Attendance check-in/out pass.
- [ ] Leave request/approval pass.
- [ ] ATT-LEAVE sync pass.
- [ ] Audit log P0 pass.
- [ ] Permission matrix P0 pass.

### 13.3 Gate 3 - Experience Ready

Điều kiện:

- [ ] Task P1 flow pass.
- [ ] Notification unread/dropdown pass.
- [ ] Dashboard role widgets pass.
- [ ] Deep link pass.
- [ ] Cache/invalidation basic pass.

### 13.4 Gate 4 - UAT Ready

Điều kiện:

- [ ] E2E P0 pass.
- [ ] Regression pass.
- [ ] Security testing không còn critical.
- [ ] Performance không có endpoint P0 vượt ngưỡng nghiêm trọng.
- [ ] Staging stable.
- [ ] UAT script sẵn sàng.

### 13.5 Gate 5 - Production Ready

Điều kiện:

- [ ] UAT sign-off.
- [ ] Blocker/Critical = 0.
- [ ] High bug có quyết định fix hoặc workaround.
- [ ] Backup/rollback plan đã diễn tập.
- [ ] Monitoring/logging/alerting hoạt động.
- [ ] Production migration/seed được review.
- [ ] Go-live approval.

---

## 14. Bug Severity & Release Rule

| Severity | Định nghĩa | Release rule |
| --- | --- | --- |
| Blocker | Không thể login, không thể chạy app, mất dữ liệu, crash toàn hệ thống | Không được release |
| Critical | Sai quyền, lộ dữ liệu, sai công/nghỉ phép nghiêm trọng, migration lỗi | Không được release |
| High | Luồng chính lỗi nhưng có workaround hạn chế | Cần Product/Tech Lead approve nếu release |
| Medium | Lỗi phụ, ảnh hưởng một số case | Có thể release nếu được ghi known issue |
| Low | UI/copy/edge case nhỏ | Có thể release |

---

## 15. Test Strategy theo giai đoạn

### 15.1 Sprint-level testing

Mỗi sprint phải có:

- [ ] Unit test cho service/helper quan trọng.
- [ ] API test cho endpoint mới.
- [ ] Permission/data scope test cho endpoint nhạy cảm.
- [ ] Frontend component/page smoke.
- [ ] Manual QA flow theo acceptance criteria.

### 15.2 Integration testing

Tập trung từ Sprint 4 và đặc biệt Sprint 5 (IMPLEMENTATION-08):

- [ ] HR -> AUTH user link.
- [ ] ATT -> HR employee status.
- [ ] LEAVE -> ATT sync.
- [ ] TASK -> HR assignee.
- [ ] Module event -> NOTI.
- [ ] Module data -> DASH widget.
- [ ] NOTI deep link -> module source.

### 15.3 Regression testing

Tập trung từ Sprint 5 (IMPLEMENTATION-08) và Sprint 6 (IMPLEMENTATION-09):

- [ ] Login/session.
- [ ] HR employee/profile.
- [ ] Check-in/out.
- [ ] Adjustment approval.
- [ ] Leave approval.
- [ ] Task assignment.
- [ ] Notification unread/mark read.
- [ ] Dashboard widgets.
- [ ] Permission matrix.

### 15.4 UAT testing

Tập trung Sprint 5 (IMPLEMENTATION-08), sign-off cuối ở Sprint 6 (IMPLEMENTATION-09):

| Actor | UAT scenario |
| --- | --- |
| Employee | Login, xem hồ sơ, check-in/out, xin nghỉ, xem task, đọc notification |
| Manager | Xem team, duyệt nghỉ, duyệt điều chỉnh công, giao task, xem dashboard |
| HR | Quản lý nhân viên, hợp đồng, bảng công, nghỉ phép, profile change |
| Admin | Quản lý user/role/permission, cấu hình hệ thống, xem audit/dashboard |

---

## 16. DevOps & Environment Roadmap

### 16.1 Environment timeline

| Sprint | Environment target |
| --- | --- |
| S0 | Repo + CI skeleton |
| S1 | Local/dev environment chạy được |
| S2 | Dev deploy tự động backend/frontend, seed demo data |
| S3 | Staging environment bắt đầu dùng cho QA integration |
| S4 | Staging stable cho feature testing |
| S5 | Production-like staging cho full regression + UAT |
| S6 | Production go-live |

### 16.2 CI/CD gate đề xuất

```text
Pull Request
-> lint
-> typecheck
-> unit test
-> build
-> migration check nếu backend
-> security/dependency scan basic
-> review approval
-> merge
-> deploy dev/staging theo branch/tag
```

### 16.3 Monitoring tối thiểu cho MVP

- [ ] Backend health check.
- [ ] API error rate.
- [ ] Login failure rate.
- [ ] Check-in/out error rate.
- [ ] Slow query log.
- [ ] Migration failure alert.
- [ ] Notification event failure.
- [ ] Dashboard widget error.
- [ ] Storage/file error.
- [ ] CPU/memory/disk/database connection.

---

## 17. Product Backlog Prioritization

### 17.1 P0 - Bắt buộc để MVP chạy được

- [ ] AUTH login/session/RBAC.
- [ ] HR employee/department/position/user link.
- [ ] Attendance check-in/out/records.
- [ ] Leave request/approval/balance/ATT sync.
- [ ] Permission/data scope guard backend.
- [ ] Audit log thao tác quan trọng.
- [ ] Basic notification for approval/task events.
- [ ] Basic dashboard role widgets.
- [ ] QA regression P0.
- [ ] DevOps deploy staging/production.

### 17.2 P1 - Nên có trong MVP

- [ ] HR contract/file/self-service.
- [ ] Attendance adjustment/remote work.
- [ ] Task/project/kanban/comment/checklist.
- [ ] Notification admin template/config cơ bản.
- [ ] Dashboard cache/config cơ bản.
- [ ] Export cơ bản.
- [ ] Responsive mobile web cho P0 screens.

### 17.3 P2 - Có thể cắt nếu trễ tiến độ

- [ ] Dashboard personalization.
- [ ] Advanced notification preferences.
- [ ] Advanced report/chart.
- [ ] Bulk import/export phức tạp.
- [ ] Multi-level approval nâng cao.
- [ ] Advanced remote GPS proof.
- [ ] Advanced task tags/dependencies/time tracking.

---

## 18. Rủi ro triển khai và hướng xử lý

| Rủi ro | Mức độ | Dấu hiệu sớm | Hướng xử lý |
| --- | --- | --- | --- |
| MVP scope quá lớn | Cao | Sprint liên tục spillover | Cắt P2, giữ P0/P1; chia feature flag |
| RBAC/data scope sai | Rất cao | QA phát hiện user thấy dữ liệu ngoài scope | Test matrix permission từ S2, backend guard bắt buộc |
| ATT-LEAVE sync sai | Rất cao | Bảng công không khớp đơn nghỉ | Viết integration test S3 (và regression S5), lock business rule rõ |
| HR data chưa ổn định | Cao | ATT/LEAVE/TASK thiếu employee/manager data | Hoàn thành HR core trước operation module |
| Dashboard query chậm | Trung bình | Dashboard load lâu, DB CPU cao | Widget lazy load, cache TTL, index theo DB-09 |
| Notification spam/trùng | Trung bình | Một event tạo nhiều notification | Idempotency + dedupe + event key |
| File private bị lộ | Rất cao | Frontend thấy storage path/raw URL | Signed URL, permission check, audit file access |
| Migration lỗi staging/prod | Cao | Migration chạy local nhưng fail staging | CI dựng DB từ trống, backup trước deploy |
| FE/BE contract lệch | Cao | FE phải sửa nhiều khi API đổi | OpenAPI/mock API, contract review cuối sprint |
| QA dồn cuối dự án | Cao | Bug lớn chỉ xuất hiện ở Sprint 5 hardening | QA tham gia từ Sprint 1, test story trong sprint |
| DevOps làm muộn | Cao | Sản phẩm chạy local nhưng không deploy được | DevOps từ Sprint 0/Sprint 1, staging sẵn sàng từ Sprint 3 |
| Sprint 2-4 quá tải point (200/241/231) | Cao | Module lõi dồn vào một sprint 2 tuần | Tăng dev song song, kéo dài sprint hoặc tách sprint; chốt velocity sau Sprint 0-1 (xem §8.8) |

---

## 19. Sprint Ceremony đề xuất

### 19.1 Sprint Planning

Tần suất: đầu mỗi sprint.

Nội dung:

1. Review sprint goal.
2. Chọn story đạt Definition of Ready.
3. Ước lượng effort.
4. Chốt owner cho từng story.
5. Chốt dependency và blocker.
6. Chốt QA scope trong sprint.

### 19.2 Daily Standup

Tần suất: hằng ngày.

Mỗi thành viên trả lời:

1. Hôm qua đã làm gì?
2. Hôm nay làm gì?
3. Có blocker nào không?
4. Có dependency với ai/module nào không?

### 19.3 Backlog Refinement

Tần suất: giữa sprint.

Nội dung:

1. Làm rõ story sprint sau.
2. Chia nhỏ story XL.
3. Chốt acceptance criteria.
4. Chốt API/UI/DB dependency.

### 19.4 Sprint Review

Tần suất: cuối sprint.

Nội dung:

1. Demo increment chạy được.
2. Product/Business feedback.
3. QA report.
4. Bug/risk review.
5. Quyết định accept/reopen story.

### 19.5 Retrospective

Tần suất: cuối sprint.

Nội dung:

1. Điều gì tốt?
2. Điều gì chưa tốt?
3. Cần thay đổi gì sprint sau?
4. Action item có owner và deadline.

---

## 20. Tracking Template đề xuất

### 20.1 Sprint board columns

```text
Backlog
-> Ready
-> In Progress
-> Code Review
-> QA Ready
-> QA Testing
-> UAT Ready
-> Done
-> Blocked
```

### 20.2 Story fields

| Field | Ý nghĩa |
| --- | --- |
| Story ID | Mã story duy nhất |
| Epic | Epic/module liên quan |
| Priority | P0/P1/P2 |
| Actor | Người dùng chính |
| Description | Mô tả ngắn |
| Acceptance Criteria | Điều kiện nghiệm thu |
| API | Endpoint liên quan |
| DB | Bảng/migration liên quan |
| UI | Screen/component liên quan |
| Permission | Permission/data scope |
| Owner BE | Backend owner |
| Owner FE | Frontend owner |
| Owner QA | QA owner |
| Sprint | Sprint target |
| Status | Trạng thái hiện tại |
| Risk/Blocker | Ghi chú blocker |

---

## 21. Sample Story Template

```text
Story ID: LEAVE-STORY-001
Epic: EPIC-LEAVE
Priority: P0
Actor: Employee
Title: Employee tạo và gửi đơn nghỉ phép

Description:
Là Employee, tôi muốn tạo đơn nghỉ phép, chọn loại nghỉ, ngày nghỉ, lý do và gửi cho quản lý duyệt để quy trình nghỉ phép được xử lý trên hệ thống.

Acceptance Criteria:
1. Employee chỉ tạo đơn cho chính mình.
2. Hệ thống cho phép lưu nháp.
3. Hệ thống cho phép gửi đơn nếu balance đủ và không trùng đơn khác.
4. Khi gửi đơn, trạng thái chuyển Pending.
5. Manager/HR nhận notification nếu event được bật.
6. Audit log ghi actor/action/target.
7. Nếu dữ liệu không hợp lệ, API trả validation error đúng chuẩn.
8. Nếu thiếu quyền, API trả 403.

API:
POST /api/v1/leave/requests
POST /api/v1/leave/requests/{id}/submit

DB:
leave_requests
leave_request_days
leave_balance_transactions

UI:
UI-LEAVE-CREATE-REQUEST
UI-LEAVE-MY-REQUESTS

Permission:
LEAVE.REQUEST.CREATE scope Own
```

---

## 22. Kế hoạch cắt scope nếu trễ tiến độ

### 22.1 Nguyên tắc cắt scope

Không cắt các phần làm sai nghiệp vụ lõi hoặc giảm an toàn dữ liệu.

Không được cắt:

- [ ] Backend permission/data scope guard.
- [ ] Audit log thao tác quan trọng.
- [ ] ATT-LEAVE sync P0.
- [ ] HR employee source data.
- [ ] Login/session security.
- [ ] File private permission.

Có thể cắt hoặc chuyển phase sau:

- [ ] Dashboard chart nâng cao.
- [ ] Notification preference cá nhân nâng cao.
- [ ] Export nâng cao.
- [ ] Import Excel.
- [ ] Kanban drag/drop nâng cao.
- [ ] Task tags/dependencies.
- [ ] Advanced remote GPS/photo proof.
- [ ] Advanced dashboard personalization.

### 22.2 MVP fallback plan

Nếu tiến độ chậm, có thể điều chỉnh:

| Thành phần | Bản đầy đủ | Fallback MVP |
| --- | --- | --- |
| Dashboard | Nhiều widget + cache | Widget P0 + query nhẹ + manual refresh |
| Notification | Event config/template admin | Seed template cố định + in-app only |
| Task | Project + Kanban + checklist + file | My tasks + task list + status update |
| Remote work | Rule linh hoạt + proof | Request approval + ghi chú cơ bản |
| Export | Multi-format + background | CSV đơn giản hoặc tạm chuyển phase sau |
| Profile change | Config field nâng cao | Danh sách field cố định trong MVP |

---

## 23. Go-live Checklist tổng hợp

### 23.1 Product

- [ ] MVP scope được sign-off.
- [ ] UAT pass.
- [ ] Known issues được chấp nhận.
- [ ] User communication sẵn sàng.
- [ ] Training material sẵn sàng.

### 23.2 Backend

- [ ] Migration reviewed.
- [ ] Seed reviewed.
- [ ] API docs updated.
- [ ] Permission matrix verified.
- [ ] Audit log verified.
- [ ] File private flow verified.
- [ ] No blocker/critical bug.

### 23.3 Frontend

- [ ] Production build pass.
- [ ] Env production đúng.
- [ ] Mock/debug disabled.
- [ ] Main routes pass smoke.
- [ ] Responsive P0 pass.
- [ ] Permission UI pass.

### 23.4 QA

- [ ] Regression pass.
- [ ] E2E P0 pass.
- [ ] Security test critical pass.
- [ ] Performance test acceptable.
- [ ] Test summary report ready.

### 23.5 DevOps

- [ ] Backup before deploy.
- [ ] Rollback plan ready.
- [ ] Monitoring ready.
- [ ] Logging ready.
- [ ] Alerting ready.
- [ ] SSL/domain ready.
- [ ] Production secrets ready.
- [ ] Deployment approval recorded.

---

## 24. Kết luận

IMPLEMENTATION-01 xác định lộ trình triển khai MVP theo hướng:

```text
Chuẩn bị kỹ thuật
-> Dựng Foundation/AUTH
-> Hoàn thiện HR làm nguồn dữ liệu trung tâm
-> Triển khai Attendance và Leave theo luồng vận hành hằng ngày
-> Đồng bộ ATT-LEAVE chính xác
-> Bổ sung Task, Notification, Dashboard
-> Tích hợp cross-module
-> QA/UAT/Hardening
-> Go-live có kiểm soát
```

Các điểm quan trọng cần giữ khi triển khai:

1. Không triển khai dàn trải khi Foundation/AUTH/HR chưa ổn định.
2. Không xem frontend guard là bảo mật chính.
3. Không bỏ audit log cho thao tác nhạy cảm.
4. Không để Dashboard xử lý nghiệp vụ gốc.
5. Không để Notification chứa dữ liệu nhạy cảm quá mức.
6. Không cắt ATT-LEAVE sync khỏi MVP vì đây là luồng cốt lõi.
7. Không đẩy QA và DevOps về cuối dự án.
8. Mỗi sprint phải có increment chạy được và test được.
9. Nếu trễ tiến độ, cắt P2 trước, giữ P0 đúng nghiệp vụ và đúng bảo mật.

Bước tiếp theo sau IMPLEMENTATION-01 nên là:

```text
IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
```

IMPLEMENTATION-02 nên đi sâu vào:

1. Danh sách Epic đầy đủ.
2. Danh sách Feature/User Story theo module.
3. Acceptance Criteria từng story.
4. Mapping story với API, DB, UI, permission và test case.
5. Ước lượng effort.
6. Sprint assignment chi tiết.
7. Dependency/blocker từng story.
8. Tracking template cho Jira/Linear/Trello/Notion.

