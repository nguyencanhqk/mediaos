# IMPLEMENTATION-09: SPRINT 6 STABILIZATION, RELEASE CANDIDATE & GO-LIVE EXECUTION PLAN
# KẾ HOẠCH ỔN ĐỊNH HỆ THỐNG, CHỐT RELEASE CANDIDATE & GO-LIVE MVP

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-09 |
| Tên tài liệu | Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | MVP Version 1.0 - Implementation |
| Sprint | Sprint 6 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch triển khai **Sprint 6 - Stabilization, Release Candidate & Go-live** cho MVP của hệ thống quản lý doanh nghiệp nội bộ.

Sprint 6 là sprint cuối của chuỗi implementation MVP trước khi đưa hệ thống vào vận hành thực tế hoặc UAT production-like. Mục tiêu chính không phải là mở rộng thêm chức năng mới, mà là:

1. Ổn định toàn bộ các module MVP đã triển khai.
2. Khóa phạm vi release và kiểm soát thay đổi.
3. Hoàn thiện kiểm thử hồi quy, kiểm thử tích hợp, kiểm thử quyền và kiểm thử dữ liệu.
4. Chốt phiên bản **Release Candidate**.
5. Diễn tập migration, deployment, rollback và smoke test.
6. Chuẩn bị go-live checklist, vận hành, monitoring, backup và support.
7. Bàn giao hệ thống cho stakeholder/operation team kèm tài liệu nghiệm thu.

Sprint này phải đảm bảo hệ thống MVP đủ điều kiện vận hành với các module lõi:

```text
AUTH
HR
ATT
LEAVE
TASK
DASH
NOTI
FOUNDATION/SYSTEM
```

---

## 3. Vị trí Sprint 6 trong chuỗi IMPLEMENTATION

Chuỗi IMPLEMENTATION đề xuất cho MVP:

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

Sprint 6 nhận đầu vào từ Sprint 1 đến Sprint 5 và tạo đầu ra chính là:

```text
MVP Release Candidate
Go-live Runbook
Rollback Plan
Release Notes
Production Readiness Checklist
UAT Sign-off Package
Post-go-live Hypercare Plan
```

---

## 4. Căn cứ triển khai

Sprint 6 bám theo các nhóm tài liệu đã chốt:

| Nhóm tài liệu | Vai trò trong Sprint 6 |
| --- | --- |
| PRD-00 | Xác nhận mục tiêu sản phẩm, phạm vi MVP, module lõi và giá trị nghiệp vụ cần nghiệm thu |
| SPEC-01 -> SPEC-08 | Xác nhận rule nghiệp vụ, actor, module, quyền, lỗi, trạng thái và liên kết module |
| DB-01 -> DB-10 | Xác nhận migration, seed, rollback, index, query pattern, audit, soft delete và dữ liệu nền |
| API-01 -> API-08 | Xác nhận contract API, authentication, permission, data scope, response/error, endpoint module |
| UI-01 -> UI-10 | Xác nhận flow, screen, route, permission UI, state, responsive, prototype và handoff |
| FRONTEND-01 -> FRONTEND-14 | Xác nhận cấu trúc frontend, route guard, API client, module screen và release readiness |
| BACKEND-01 -> BACKEND-14 | Xác nhận kiến trúc backend, migration, service module, API, security, performance và readiness |
| QA-01 -> QA-10 | Xác nhận test plan, test case, API/E2E/security/performance/UAT/release readiness |
| DEVOPS-01 -> DEVOPS-12 | Xác nhận environment, CI/CD, deployment, backup, monitoring, rollback và release management |
| COMPLIANCE-01 | Personal Data Protection & Backup/DR (Nghị định 13/2023): xác nhận RPO/RTO target theo lớp dữ liệu, DR policy, xử lý dữ liệu cá nhân và sign-off của DPO cho WS4 (Security/Data Protection) |

Nếu một tài liệu nguồn chưa hoàn thiện, Sprint 6 phải ghi rõ thành **release risk** và có owner xử lý trước khi chốt go-live.

---

## 5. Nguyên tắc Sprint 6

### 5.1 Không mở rộng scope MVP

Sprint 6 không dùng để thêm nghiệp vụ lớn mới.

Được phép:

1. Sửa bug.
2. Hoàn thiện thiếu sót nhỏ đã nằm trong scope MVP.
3. Hardening security/performance/UX.
4. Bổ sung test, monitoring, logging, documentation.
5. Tối ưu flow đã có.
6. Bổ sung cấu hình môi trường, seed, runbook.

Không nên:

1. Thêm module mới ngoài MVP.
2. Thêm rule nghiệp vụ phức tạp chưa có trong SPEC/API.
3. Đổi kiến trúc lớn nếu không có lỗi nghiêm trọng.
4. Thay đổi database destructive sát ngày release.
5. Thay đổi permission matrix mà không chạy regression quyền.

### 5.2 Backend là nguồn kiểm soát cuối cùng

Frontend có thể ẩn/hiện menu, button, widget, field theo permission và data scope, nhưng mọi API vẫn phải kiểm tra lại:

1. Authentication.
2. User status.
3. Company/tenant status.
4. Permission.
5. Data scope.
6. Business rule.
7. Audit log.
8. Notification event nếu cần.

### 5.3 Release phải có khả năng rollback

Không được go-live nếu chưa có:

1. Backup trước release.
2. Deployment version có thể rollback.
3. Database migration strategy rõ.
4. Rollback script hoặc restore procedure.
5. Smoke test sau rollback.
6. Owner phê duyệt rollback.

### 5.4 Mọi lỗi P0/P1 phải được triage hằng ngày

Trong Sprint 6, issue board phải ưu tiên theo mức độ release impact, không ưu tiên theo module riêng lẻ.

Thứ tự xử lý:

```text
P0 Blocker
-> P1 Critical
-> Security/Data leakage
-> UAT blocker
-> Regression P1/P2
-> UX polish P2
-> Documentation/support
```

---

## 6. Mục tiêu Sprint 6

### 6.1 Mục tiêu sản phẩm

| Mã | Mục tiêu | Kết quả mong muốn |
| --- | --- | --- |
| IMP09-GOAL-001 | Chốt scope MVP | Không còn thay đổi chức năng lớn trước RC |
| IMP09-GOAL-002 | Chốt release candidate | Có build/tag RC có thể triển khai staging/production |
| IMP09-GOAL-003 | Hoàn tất UAT sign-off | Stakeholder xác nhận các flow P0/P1 đạt yêu cầu |
| IMP09-GOAL-004 | Chuẩn bị go-live | Có runbook, checklist, rollback, monitoring, support |
| IMP09-GOAL-005 | Bàn giao vận hành | Có tài liệu sử dụng, tài liệu admin, tài liệu support, release notes |

### 6.2 Mục tiêu kỹ thuật

| Mã | Mục tiêu | Kết quả mong muốn |
| --- | --- | --- |
| IMP09-TECH-001 | Regression pass | Test suite chính pass trên staging |
| IMP09-TECH-002 | Migration verified | Migration/seed chạy được từ DB trống và staging-like data |
| IMP09-TECH-003 | Permission verified | RBAC + data scope được test theo role Employee/Manager/HR/Admin/Super Admin |
| IMP09-TECH-004 | Performance acceptable | API/module quan trọng đạt SLA MVP hoặc có mitigation |
| IMP09-TECH-005 | Security readiness | Không còn lỗ hổng blocker hoặc dữ liệu nhạy cảm bị lộ |
| IMP09-TECH-006 | Observability ready | Có log, request id, monitoring, alert, health check |
| IMP09-TECH-007 | Backup/rollback ready | Có backup trước release và quy trình rollback rõ |

---

## 7. Phạm vi Sprint 6

### 7.1 Bao gồm

| Nhóm | Nội dung |
| --- | --- |
| Stabilization | Fix bug, xử lý regression, ổn định flow chính |
| Release Candidate | Đóng băng scope, tạo RC build, version/tag, release notes |
| QA final pass | Smoke, regression, E2E, API contract, permission, data scope, responsive, accessibility cơ bản |
| UAT finalization | Chuẩn bị kịch bản UAT, hỗ trợ stakeholder test, xử lý UAT blocker, sign-off |
| Database readiness | Migration/seed verification, backup, rollback, index, query performance |
| Security readiness | Auth/session, RBAC, field masking, file access, audit log, secret/config review |
| Performance readiness | API latency, dashboard cache, notification unread, list pagination, export behavior |
| DevOps readiness | Environment, CI/CD, deployment, monitoring, alerting, rollback, release checklist |
| Go-live execution | Runbook triển khai, smoke sau deploy, war-room, communication plan |
| Handoff | Admin guide, user guide, support guide, known issues, post-go-live backlog |

### 7.2 Không bao gồm

| Nhóm | Lý do |
| --- | --- |
| Module PAYROLL/RECRUIT/ASSET/ROOM/CHAT/SOCIAL | Ngoài scope MVP |
| Mobile native app | Web app trước, mobile app phase sau |
| AI assistant | Phase sau |
| BI dashboard nâng cao | Phase reporting riêng |
| Thiết bị chấm công vật lý thật | MVP chỉ chuẩn bị khả năng tích hợp, chưa bắt buộc triển khai production |
| Multi-tenant SaaS onboarding đầy đủ | MVP có thể single-company, nhưng schema/API vẫn multi-tenant ready |

---

## 8. Điều kiện đầu vào Sprint 6

Sprint 6 chỉ nên bắt đầu khi các điều kiện sau đạt tối thiểu.

### 8.1 Điều kiện sản phẩm

| Mã | Điều kiện | Bắt buộc |
| --- | --- | --- |
| IMP09-IN-001 | Scope MVP đã được Product/Stakeholder chốt | Có |
| IMP09-IN-002 | Danh sách flow P0/P1 đã xác định | Có |
| IMP09-IN-003 | UAT scenario đã chuẩn bị ở Sprint 5 | Có |
| IMP09-IN-004 | Danh sách known issue đang mở đã được phân loại | Có |
| IMP09-IN-005 | Không còn yêu cầu nghiệp vụ lớn chưa chốt | Có |

### 8.2 Điều kiện kỹ thuật

| Mã | Điều kiện | Bắt buộc |
| --- | --- | --- |
| IMP09-IN-006 | Staging environment hoạt động ổn định | Có |
| IMP09-IN-007 | CI/CD build được backend và frontend | Có |
| IMP09-IN-008 | Migration/seed chạy được ở staging | Có |
| IMP09-IN-009 | Core API của AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH hoạt động | Có |
| IMP09-IN-010 | Frontend gọi API thật hoặc mock contract cuối đã khớp | Có |
| IMP09-IN-011 | QA có test case regression chính | Có |
| IMP09-IN-012 | DevOps có deployment path và rollback path | Có |

### 8.3 Điều kiện tài liệu

| Mã | Điều kiện | Bắt buộc |
| --- | --- | --- |
| IMP09-IN-013 | API/OpenAPI hoặc API mapping đủ cho module MVP | Có |
| IMP09-IN-014 | Permission matrix đủ để test role/scope | Có |
| IMP09-IN-015 | Release checklist có owner | Có |
| IMP09-IN-016 | Go-live communication plan có người chịu trách nhiệm | Nên có |
| IMP09-IN-017 | User/admin guide bản tối thiểu | Nên có |

---

## 9. Workstream Sprint 6

Sprint 6 được chia thành 10 workstream chính.

```text
WS1  Scope Freeze & Release Governance
WS2  Stabilization & Bug Triage
WS3  Regression, E2E & UAT Final Pass
WS4  Security, RBAC & Data Protection Hardening
WS5  Performance, Query & Cache Hardening
WS6  Database Migration, Seed & Backup Verification
WS7  Release Candidate Build & Release Notes
WS8  Go-live Runbook, Deployment & Rollback Rehearsal
WS9  Monitoring, Logging, Alerting & Support Readiness
WS10 Final Sign-off, Go/No-go & Handoff
```

---

# 10. WS1 - Scope Freeze & Release Governance

## 10.1 Mục tiêu

Khóa phạm vi release để team tập trung vào ổn định và đưa MVP ra môi trường vận hành.

## 10.2 Việc cần làm

| Mã task | Task | Owner | Output |
| --- | --- | --- | --- |
| IMP09-WS1-001 | Chốt danh sách module nằm trong release | Product Owner | MVP scope list |
| IMP09-WS1-002 | Chốt danh sách flow P0/P1 phải pass | Product + QA Lead | Critical flow list |
| IMP09-WS1-003 | Thiết lập rule freeze scope | Product + Tech Lead | Scope freeze rule |
| IMP09-WS1-004 | Thiết lập change request process | Product + PM | CR template |
| IMP09-WS1-005 | Tạo release board riêng cho Sprint 6 | PM/Scrum Master | Release issue board |
| IMP09-WS1-006 | Phân loại bug theo severity và module | QA Lead | Bug triage report |
| IMP09-WS1-007 | Thiết lập lịch release standup hằng ngày | PM | Daily release sync |

## 10.3 Quy tắc thay đổi sau scope freeze

Sau khi scope freeze, mọi thay đổi phải thuộc một trong các nhóm sau mới được đưa vào RC:

| Nhóm | Điều kiện được nhận |
| --- | --- |
| Bug fix | Bug ảnh hưởng flow P0/P1, bảo mật, dữ liệu hoặc UAT blocker |
| Security fix | Lỗi liên quan auth, permission, data leakage, file/private data, secret |
| Data integrity fix | Lỗi gây sai dữ liệu chấm công, nghỉ phép, task, audit, notification |
| Operational fix | Lỗi ảnh hưởng backup, deployment, rollback, monitoring |
| UX blocker | Lỗi khiến user không thể hoàn thành flow chính |

Không nhận:

1. Feature mới không bắt buộc cho MVP.
2. Thay đổi UI lớn không ảnh hưởng usability chính.
3. Refactor lớn không cần thiết cho release.
4. Tối ưu hiệu năng không có bằng chứng bottleneck.

## 10.4 Deliverable

| Mã | Deliverable |
| --- | --- |
| IMP09-DEL-WS1-001 | Scope Freeze Note |
| IMP09-DEL-WS1-002 | Release Board |
| IMP09-DEL-WS1-003 | Critical Flow List |
| IMP09-DEL-WS1-004 | Change Request Rule |
| IMP09-DEL-WS1-005 | Bug Severity Matrix |

---

# 11. WS2 - Stabilization & Bug Triage

## 11.1 Mục tiêu

Tập trung xử lý lỗi còn tồn đọng để hệ thống đủ ổn định cho Release Candidate.

## 11.2 Severity matrix

| Severity | Định nghĩa | Ví dụ | Release rule |
| --- | --- | --- | --- |
| P0 - Blocker | Không thể dùng hệ thống hoặc mất dữ liệu nghiêm trọng | Không login được; migration làm mất dữ liệu; permission leak | Không được release |
| P1 - Critical | Flow P0/P1 không hoàn thành được hoặc sai dữ liệu quan trọng | Check-in sai ngày; approve leave không sync ATT; role scope sai | Phải fix trước RC |
| P2 - Major | Có workaround nhưng ảnh hưởng trải nghiệm/nghiệp vụ | Dashboard widget lỗi nhưng module gốc dùng được | Fix nếu còn capacity, nếu không ghi known issue |
| P3 - Minor | Lỗi nhỏ, copy, UI polish | Label chưa chuẩn, spacing chưa đều | Có thể đưa post-go-live backlog |
| P4 - Enhancement | Cải tiến không phải bug | Thêm filter nâng cao | Không đưa Sprint 6 trừ khi approved |

## 11.3 Bug triage cadence

| Thời điểm | Hoạt động |
| --- | --- |
| Đầu ngày | Review P0/P1 mới, gán owner, xác định target fix |
| Giữa ngày | Check blocker, build staging nếu cần |
| Cuối ngày | Verify bug fixed, cập nhật known issue và release risk |
| Trước RC | Bug scrub toàn bộ P0/P1/P2 |

## 11.4 Bug lifecycle trong Sprint 6

```text
New
-> Triage
-> Accepted / Rejected / Duplicate / Defer
-> Assigned
-> In Progress
-> Code Review
-> Ready for QA
-> QA Verified
-> Closed
-> Included in RC
```

Bug không được đóng nếu chưa có:

1. Link commit/PR hoặc giải thích cấu hình.
2. Environment đã verify.
3. QA result.
4. Regression note nếu liên quan module khác.

## 11.5 Module stabilization checklist

### AUTH / RBAC

- [ ] Login/logout hoạt động ổn định.
- [ ] Refresh token/session hết hạn xử lý đúng.
- [ ] Account locked/inactive không đăng nhập được.
- [ ] User có nhiều role resolve permission đúng.
- [ ] Data scope Own/Team/Department/Company/System hoạt động đúng.
- [ ] Backend chặn API trái quyền.
- [ ] Frontend route/menu/action không hard-code theo role.
- [ ] Audit log cho thao tác quan trọng.

### HR

- [ ] Employee list/detail/form hoạt động.
- [ ] Mã nhân viên tự sinh theo cấu hình.
- [ ] Employee self-service tạo request, không sửa trực tiếp hồ sơ chính.
- [ ] HR/Admin approve/reject profile change đúng.
- [ ] Employee-user link đúng.
- [ ] Sensitive fields được mask/chặn theo quyền.
- [ ] Hợp đồng, phòng ban, chức vụ, job level ổn định.

### ATT

- [ ] Attendance today trả đúng trạng thái.
- [ ] Check-in/check-out dùng server time.
- [ ] Chặn check-in khi có leave full-day Approved.
- [ ] Remote/công tác Approved áp rule đúng.
- [ ] Attendance records list phân trang/lọc đúng.
- [ ] Adjustment request submit/approve/reject đúng scope.
- [ ] Manual adjustment có audit log.
- [ ] Missing checkout job không spam notification.

### LEAVE

- [ ] Leave balance hiển thị đúng.
- [ ] Create draft/submit/cancel request đúng.
- [ ] Preview calculation đúng với full day/half day/hourly.
- [ ] Approve/reject đúng scope Manager/HR.
- [ ] Approved leave sync sang ATT.
- [ ] Cancel/revoke leave tính lại ATT.
- [ ] Balance ledger không bị sai hoặc âm ngoài policy.
- [ ] Notification leave gửi đúng người.

### TASK

- [ ] Project/task CRUD ổn định.
- [ ] Project member role không thay thế RBAC hệ thống.
- [ ] My tasks đúng assignee/watcher/creator.
- [ ] Kanban status update đúng.
- [ ] Comment/mention gửi notification đúng.
- [ ] Checklist update không mất dữ liệu.
- [ ] File attachment kiểm tra quyền tải/xem/xóa.
- [ ] Cảnh báo assignee nghỉ phép nếu có dữ liệu LEAVE.

### NOTI

- [ ] Notification dropdown/latest ổn định.
- [ ] Unread count chính xác.
- [ ] Mark read/mark all read đúng.
- [ ] Deep link sang module gốc và module gốc kiểm tra quyền lại.
- [ ] Không chứa dữ liệu nhạy cảm trong URL/payload.
- [ ] Dedupe event hoạt động với event trùng.
- [ ] Delivery log ghi nhận đúng.

### DASH

- [ ] Dashboard default theo permission đúng.
- [ ] Widget chỉ hiển thị theo permission/data scope.
- [ ] Widget lỗi không làm sập toàn dashboard.
- [ ] Quick action điều hướng hoặc gọi module gốc đúng.
- [ ] Cache/last updated hiển thị rõ.
- [ ] Refresh không blank toàn bộ nếu chỉ reload widget.
- [ ] Dashboard không tự xử lý nghiệp vụ gốc.

### FOUNDATION / SYSTEM

- [ ] Company settings hoạt động.
- [ ] Module catalog đúng active/inactive.
- [ ] File service private by default.
- [ ] Audit log append-only cho thao tác quan trọng.
- [ ] Sequence counters sinh mã ổn định.
- [ ] Public holidays ảnh hưởng ATT/LEAVE đúng nếu đã bật.

---

# 12. WS3 - Regression, E2E & UAT Final Pass

## 12.1 Mục tiêu

Đảm bảo toàn bộ flow người dùng quan trọng hoạt động ổn định sau khi tích hợp tất cả module.

## 12.2 Bộ flow regression P0

| Mã flow | Tên flow | Module liên quan | Kết quả cần đạt |
| --- | --- | --- | --- |
| IMP09-REG-001 | Login -> Home Portal -> mở app | AUTH, FOUNDATION, UI | User vào đúng portal, chỉ thấy app được phép |
| IMP09-REG-002 | Employee check-in/check-out | AUTH, HR, ATT, NOTI, DASH | Trạng thái công cập nhật đúng |
| IMP09-REG-003 | Employee tạo và gửi đơn nghỉ | AUTH, HR, LEAVE, NOTI | Đơn Pending, thông báo đến người duyệt |
| IMP09-REG-004 | Manager/HR duyệt đơn nghỉ | LEAVE, ATT, NOTI, DASH | Leave Approved, ATT được sync, notification gửi đúng |
| IMP09-REG-005 | Employee bị chặn chấm công khi nghỉ cả ngày | ATT, LEAVE | Nút check-in/out disabled và message đúng |
| IMP09-REG-006 | Employee gửi adjustment công | ATT, NOTI | Request Pending, Manager/HR thấy yêu cầu |
| IMP09-REG-007 | Manager/HR duyệt adjustment công | ATT, NOTI, DASH | Attendance record được cập nhật đúng |
| IMP09-REG-008 | HR tạo employee + link user | HR, AUTH, NOTI | Employee có user login được nếu active |
| IMP09-REG-009 | Employee gửi yêu cầu sửa hồ sơ | HR, NOTI | Request Pending, hồ sơ chính chưa đổi |
| IMP09-REG-010 | HR duyệt yêu cầu sửa hồ sơ | HR, NOTI, AUDIT | Hồ sơ chính cập nhật, employee nhận thông báo |
| IMP09-REG-011 | Manager tạo project/task và giao việc | TASK, HR, NOTI | Assignee nhận task/notification |
| IMP09-REG-012 | Employee cập nhật task/comment/checklist | TASK, NOTI, DASH | Task status/activity cập nhật đúng |
| IMP09-REG-013 | Notification dropdown -> deep link | NOTI, target module | Mark read, điều hướng module gốc đúng |
| IMP09-REG-014 | Dashboard theo vai trò | DASH, AUTH, HR, ATT, LEAVE, TASK, NOTI | Widget đúng scope, quick action đúng |
| IMP09-REG-015 | Admin cấu hình role/permission | AUTH, DASH, UI | Permission thay đổi có hiệu lực, không lộ dữ liệu |

## 12.3 Regression theo role

| Role | Flow cần test |
| --- | --- |
| Employee | Login, Home Portal, Dashboard cá nhân, check-in/out, bảng công cá nhân, tạo nghỉ, task của tôi, notification |
| Manager | Dashboard quản lý, team attendance, duyệt leave, duyệt adjustment, task team/project, notification deep link |
| HR | Employee list/detail, profile change approval, attendance company/team, leave admin, dashboard HR, contract alert |
| Company Admin | User/role/permission, company settings, module catalog, dashboard admin, audit log |
| Super Admin | System scope, tenant/module/system settings nếu có trong MVP |

## 12.4 API regression

| Nhóm API | Kiểm tra |
| --- | --- |
| AUTH | Login, refresh, logout, me, permissions, user/role/permission admin |
| HR | Employee list/detail/create/update/status, my profile, profile change, department/position/contract |
| ATT | Today, check-in, check-out, records, adjustment, manual adjustment, shift/rule, remote |
| LEAVE | Balance, request draft/submit/cancel, approve/reject, calendar, type/policy/balance admin |
| TASK | Project, member, task, assignee, status, Kanban, comment, checklist, file, activity |
| NOTI | Dropdown, unread count, list, detail, mark read, template/event admin, internal event |
| DASH | Dashboard me, dashboard by type, widget data, config, cache refresh |
| FOUNDATION | Settings, module catalog, files, audit logs, health check |

## 12.5 UAT final pass

UAT final pass tập trung vào nghiệp vụ thật, không chỉ test kỹ thuật.

| Nhóm người dùng | Kịch bản UAT |
| --- | --- |
| Employee | Đăng nhập, xem portal, chấm công, xin nghỉ, xem task, đọc thông báo |
| Manager | Xem dashboard team, duyệt nghỉ, duyệt điều chỉnh công, giao task, xem task quá hạn |
| HR | Tạo nhân viên, duyệt sửa hồ sơ, xem bảng công, xử lý nghỉ phép, xem hợp đồng/cảnh báo |
| Admin | Quản lý user/role/permission, cấu hình module/settings, xem audit log |

## 12.6 Điều kiện UAT sign-off

UAT được xem là đạt khi:

1. 100% flow P0 pass.
2. Không còn P0/P1 mở.
3. P2 còn lại có workaround rõ và stakeholder chấp nhận.
4. Dữ liệu test đủ đại diện: Employee, Manager, HR, Admin, phòng ban, task, leave, attendance.
5. User guide/admin guide bản tối thiểu đã bàn giao.
6. Release notes có known issues.
7. Stakeholder ký hoặc xác nhận sign-off qua kênh chính thức.

---

# 13. WS4 - Security, RBAC & Data Protection Hardening

## 13.1 Mục tiêu

Giảm rủi ro bảo mật và lộ dữ liệu trước khi go-live, đặc biệt ở các nhóm dữ liệu nhạy cảm như hồ sơ nhân sự, hợp đồng, chấm công, nghỉ phép, file riêng tư và audit log.

## 13.2 Security checklist

### Authentication/session

- [ ] Password hash dùng thuật toán an toàn.
- [ ] Access token/refresh token có TTL.
- [ ] Refresh token/session có thể revoke.
- [ ] Logout clear session/cache nhạy cảm.
- [ ] User locked/inactive không truy cập API.
- [ ] Reset password token chỉ lưu hash và hết hạn đúng.
- [ ] Không log password/token/plain secret.

### Authorization/RBAC

- [ ] Backend kiểm tra permission cho mọi API nghiệp vụ.
- [ ] Data scope áp dụng đúng cho Own/Team/Department/Project/Company/System.
- [ ] API list không trả dữ liệu ngoài scope.
- [ ] Direct URL trái quyền bị frontend guard và backend guard.
- [ ] Widget/dashboard không hiển thị số liệu ngoài scope.
- [ ] Notification target/deep link kiểm tra quyền ở module gốc.
- [ ] Permission matrix không hard-code theo role ở frontend.

### Sensitive data

- [ ] Field nhạy cảm trong HR được mask hoặc không trả về nếu thiếu quyền.
- [ ] File private không tải/xem được nếu thiếu quyền.
- [ ] Notification payload không chứa dữ liệu nhạy cảm.
- [ ] Export dữ liệu nhạy cảm cần permission riêng.
- [ ] Audit log ghi nhận xem/sửa/xuất dữ liệu nhạy cảm nếu cấu hình yêu cầu.

### API security

- [ ] Rate limit hoặc guard tối thiểu cho login/reset password nếu có.
- [ ] Validation 422 đúng cho input không hợp lệ.
- [ ] Không expose stack trace ở production.
- [ ] CORS đúng domain.
- [ ] Security headers đã bật nếu qua web server/proxy.
- [ ] Idempotency key cho action quan trọng như check-in/check-out/approve nếu đã thiết kế.

### Secret/config

- [ ] Không commit secret trong repo.
- [ ] Production seed không chứa password mẫu.
- [ ] Bootstrap admin password lấy từ secret manager/env.
- [ ] ENV production/staging/dev tách rõ.
- [ ] Connection string, storage key, email key được bảo vệ.

## 13.3 Permission regression matrix tối thiểu

| Case | Employee | Manager | HR | Admin | Super Admin |
| --- | --- | --- | --- | --- | --- |
| Xem hồ sơ cá nhân | Own | Own | Own/Company nếu có quyền | Theo quyền | System |
| Xem danh sách nhân viên | Không hoặc Own | Team | Company/Department | Company | System |
| Xem bảng công cá nhân | Own | Own | Own | Own | System |
| Xem bảng công team | Không | Team | Company/Department | Company | System |
| Tạo đơn nghỉ | Own | Own | Own | Theo quyền | System |
| Duyệt đơn nghỉ | Không | Team | Company/Department | Company nếu có quyền | System |
| Tạo task | Theo quyền | Team/Project | Theo quyền | Company nếu có quyền | System |
| Xem notification | Own | Own | Own | Own/Admin theo quyền | System |
| Xem dashboard | Employee | Manager/Employee | HR/Manager/Employee | Admin | System |
| Cấu hình role/permission | Không | Không | Không mặc định | Company | System |

## 13.4 Security release gate

Không được go-live nếu có bất kỳ lỗi nào sau:

1. User không có quyền vẫn đọc được dữ liệu nhân sự/chấm công/nghỉ phép của người khác.
2. Employee có thể tự cập nhật hồ sơ chính mà không qua duyệt nếu flow yêu cầu kiểm duyệt.
3. Token/session vẫn truy cập được sau logout/revoke trong trường hợp cần revoke.
4. Notification hoặc dashboard lộ số liệu ngoài scope.
5. File private tải được bằng URL đoán được hoặc thiếu check permission.
6. Production secret nằm trong repo/log/build artifact.
7. Migration/seed production tạo user admin với password mặc định bị lộ.

---

# 14. WS5 - Performance, Query & Cache Hardening

## 14.1 Mục tiêu

Đảm bảo các API và màn hình quan trọng đủ nhanh cho MVP, tránh dashboard timeout, notification badge chậm, list query thiếu phân trang hoặc export ảnh hưởng realtime.

## 14.2 API latency target đề xuất cho MVP

| Nhóm API | Target đề xuất | Ghi chú |
| --- | ---: | --- |
| Auth login/me | < 500ms P95 | Không tính network chậm |
| Attendance today | < 300ms P95 | Dùng cho flow hằng ngày |
| Check-in/check-out | < 700ms P95 | Có transaction/audit/event |
| Notification unread count | < 100-200ms P95 | Badge topbar cần nhanh |
| Dashboard shell `/dashboard/me` | < 700ms P95 | Có thể lazy load widget |
| Dashboard widget nặng | < 1s P95 hoặc cache | HR/attendance summary có thể cache |
| Employee/task/leave list | < 800ms P95 | Có pagination/filter/index |
| Export | Background hoặc giới hạn range | Không block realtime API |

## 14.3 Query checklist trước RC

- [ ] Query nghiệp vụ có filter `company_id`.
- [ ] Query list có limit/pagination.
- [ ] Query bảng lớn có index phù hợp.
- [ ] Query không trả quá nhiều cột không cần thiết.
- [ ] Query không bị N+1.
- [ ] Dashboard widget có cache/TTL nếu query nặng.
- [ ] Notification unread count có index/partial index.
- [ ] Attendance records query theo employee/date có index.
- [ ] Leave approved day query theo employee/date có index.
- [ ] Task list theo assignee/status/due có index.
- [ ] Audit/log query có index thời gian và retention/partition plan.
- [ ] API quan trọng đã chạy `EXPLAIN ANALYZE` hoặc equivalent profiling.

## 14.4 Frontend performance checklist

- [ ] Route lazy loading nếu bundle lớn.
- [ ] Query cache không giữ dữ liệu nhạy cảm sau logout.
- [ ] Dashboard lazy load widget nặng.
- [ ] Error boundary ở dashboard/widget/module.
- [ ] Table lớn có pagination, không render toàn bộ dữ liệu.
- [ ] Upload/download có loading/error state.
- [ ] Notification badge không polling quá dày nếu chưa có realtime.
- [ ] Không gọi API lặp vô hạn do query key sai.
- [ ] Không refetch toàn dashboard sau mọi mutation nhỏ nếu không cần.

## 14.5 Dashboard cache rule

| Widget | Cache đề xuất | Invalidate khi |
| --- | --- | --- |
| Attendance today | 5-15s hoặc no cache | Check-in/out, adjustment, leave sync |
| My tasks | 30-60s | Task assigned/status/comment/checklist |
| Leave balance | 60-300s | Leave submit/approve/cancel/balance adjust |
| Pending leaves | 30-60s | Leave submit/approve/reject/cancel |
| Notification latest/unread | 5-30s hoặc realtime sau này | Notification create/mark read |
| HR overview | 300s | Employee/contract/status change |
| Admin system alerts | 300s | Config/audit/system event |

## 14.6 Performance release gate

Không nên go-live nếu:

1. Login hoặc Home Portal thường xuyên timeout.
2. Attendance today/check-in/out không ổn định.
3. Dashboard gọi quá nhiều API làm sập staging.
4. Notification unread count scan bảng lớn và chậm rõ rệt.
5. Employee/attendance/leave/task list thiếu pagination.
6. Một flow phổ biến tạo N+1 query nghiêm trọng.
7. Export đồng bộ làm block request realtime.

---

# 15. WS6 - Database Migration, Seed & Backup Verification

## 15.1 Mục tiêu

Đảm bảo database production/staging có thể được dựng, migrate, seed, backup và rollback theo quy trình an toàn.

## 15.2 Migration readiness checklist

### Trước migration

- [ ] Xác nhận đúng database/environment.
- [ ] Backup database nếu không phải local.
- [ ] Kiểm tra quyền tạo extension nếu cần.
- [ ] Kiểm tra migration chưa bị sửa sau khi đã deploy.
- [ ] Kiểm tra dev-only seed không chạy ở staging/production.
- [ ] Kiểm tra secret bootstrap admin.
- [ ] Có người chịu trách nhiệm approve migration.

### Khi migration

- [ ] Chạy migration theo thứ tự.
- [ ] Log output migration.
- [ ] Dừng ngay khi migration lỗi.
- [ ] Không chạy seed nếu schema migration fail.
- [ ] Không bypass failed migration thủ công nếu chưa root cause.

### Sau migration

- [ ] Kiểm tra bảng MVP tồn tại.
- [ ] Kiểm tra FK/constraint/index quan trọng.
- [ ] Kiểm tra module catalog.
- [ ] Kiểm tra permissions/roles/role_permissions.
- [ ] Kiểm tra company settings/system settings.
- [ ] Kiểm tra leave types, attendance defaults, notification events/templates, dashboard widgets.
- [ ] Tạo/bootstrap admin an toàn.
- [ ] Smoke login/dashboard.
- [ ] Kiểm tra audit log bootstrap.

## 15.3 Seed verification checklist

| Nhóm seed | Checklist |
| --- | --- |
| Module catalog | AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI active; module phase sau inactive |
| System settings | timezone, locale, currency, security, file, audit, notification, dashboard |
| Company settings | company timezone/locale/currency, ATT, LEAVE, TASK, NOTI, DASH defaults |
| RBAC | Permission catalog đủ; role mặc định; role-permission đúng scope |
| HR defaults | job levels, contract types, employee code config |
| ATT defaults | shift, attendance rule, default assignment nếu cần |
| LEAVE defaults | leave types, leave policy, sequence counter |
| NOTI | events/templates cho AUTH/HR/ATT/LEAVE/TASK/DASH |
| DASH | widgets/configs theo role |
| Bootstrap admin | password không hard-code; must_change_password true; audit log có ghi nhận |

## 15.4 Backup verification

| Mã | Kiểm tra | Kết quả cần đạt |
| --- | --- | --- |
| IMP09-DB-001 | Backup trước release | File/snapshot backup tồn tại |
| IMP09-DB-002 | Backup metadata | Có timestamp, environment, DB version, commit/tag |
| IMP09-DB-003 | Restore rehearsal | Ít nhất restore được trên môi trường test/staging nếu có thời gian |
| IMP09-DB-004 | Access control backup | Chỉ người có quyền mới truy cập backup |
| IMP09-DB-005 | Retention | Backup giữ theo policy |

## 15.5 Rollback database rule

Production không nên rollback database destructive nếu có thể tránh.

Nguyên tắc:

1. Migration phải backward-compatible nếu có thể.
2. Không drop column/table trong cùng release.
3. Dùng expand/contract migration.
4. Nếu lỗi application, rollback app trước.
5. Database restore chỉ dùng cho sự cố nghiêm trọng và có approval.
6. Sau rollback phải chạy smoke test.

## 15.6 Database release gate

Không được go-live nếu:

1. Migration fail trên staging.
2. Seed production chứa dữ liệu mẫu/dev-only.
3. Permission seed thiếu làm user không vào được flow P0.
4. Role scope sai làm lộ dữ liệu.
5. Backup trước release chưa có.
6. Bootstrap admin password không an toàn.
7. Migration có lệnh destructive chưa được approval.

---

# 16. WS7 - Release Candidate Build & Release Notes

## 16.1 Mục tiêu

Tạo phiên bản release candidate có thể triển khai staging và production, đồng thời có đủ thông tin để stakeholder/QA/DevOps xác nhận.

## 16.2 Release candidate naming

Format đề xuất:

```text
v1.0.0-rc.1
v1.0.0-rc.2
v1.0.0
```

Hoặc theo ngày build:

```text
mvp-20260621-rc1
mvp-20260621-rc2
mvp-20260621-ga
```

Mỗi RC phải gắn với:

1. Git tag backend.
2. Git tag frontend.
3. Migration version.
4. Docker image tag hoặc deployment artifact.
5. Release notes.
6. Test result.
7. Known issues.

## 16.3 Điều kiện tạo RC

| Mã | Điều kiện | Bắt buộc |
| --- | --- | --- |
| IMP09-RC-001 | Không còn P0 open | Có |
| IMP09-RC-002 | Không còn P1 open chưa có owner/ETA | Có |
| IMP09-RC-003 | Regression P0 pass trên staging | Có |
| IMP09-RC-004 | Migration/seed verified trên staging | Có |
| IMP09-RC-005 | Security blocker = 0 | Có |
| IMP09-RC-006 | Release notes draft có đầy đủ module | Có |
| IMP09-RC-007 | Monitoring/health check hoạt động | Có |
| IMP09-RC-008 | Rollback runbook đã review | Có |

## 16.4 Release notes template

```markdown
# Release Notes - Enterprise Management System MVP v1.0.0 RC

## Release information
- Version:
- Build date:
- Backend tag:
- Frontend tag:
- Migration version:
- Environment:
- Prepared by:

## Scope included
- AUTH:
- HR:
- ATT:
- LEAVE:
- TASK:
- DASH:
- NOTI:
- FOUNDATION:

## Key changes since previous RC
- ...

## Fixed issues
| Issue ID | Severity | Module | Summary |
| --- | --- | --- | --- |

## Known issues
| Issue ID | Severity | Module | Workaround | Accepted by |
| --- | --- | --- | --- | --- |

## Test summary
- Smoke:
- Regression:
- E2E:
- API:
- Security:
- Performance:
- UAT:

## Deployment note
- Migration required: Yes/No
- Seed required: Yes/No
- Config change required: Yes/No
- Rollback compatible: Yes/No

## Approval
- Product:
- QA:
- Tech Lead:
- DevOps:
- Stakeholder:
```

## 16.5 RC lifecycle

```text
RC Build
-> Deploy staging
-> Smoke test
-> Regression/UAT
-> Bug triage
-> Fix accepted issues
-> New RC if needed
-> Go/No-go
-> Promote RC to production release
```

---

# 17. WS8 - Go-live Runbook, Deployment & Rollback Rehearsal

## 17.1 Mục tiêu

Chuẩn bị và diễn tập quy trình go-live để giảm rủi ro khi triển khai thật.

## 17.2 Go-live runbook tổng quan

```text
T-3/T-2 ngày
-> Chốt RC
-> Kiểm tra release checklist
-> Backup rehearsal
-> Deployment rehearsal staging
-> UAT final sign-off

T-1 ngày
-> Freeze code/config
-> Chốt release notes
-> Chốt go/no-go owner
-> Kiểm tra production env/secrets/domain/SSL/monitoring
-> Thông báo lịch go-live

T-0 go-live
-> Backup production
-> Deploy backend
-> Run migration nếu có
-> Run seed nếu có
-> Deploy frontend
-> Warmup cache nếu cần
-> Smoke test
-> Enable users/module
-> Monitor
-> Announce live

T+1/T+3
-> Hypercare
-> Monitor logs/alerts
-> Triage incident
-> Collect feedback
-> Patch nếu cần
```

## 17.3 Deployment sequence đề xuất

> Lưu ý: deployment sequence dưới đây thực thi **theo DEVOPS-01** (Infrastructure/Backup/Deployment) và pipeline CI/CD đã định nghĩa ở các tài liệu DEVOPS, không định nghĩa lại cơ chế deploy/backup từ đầu tại đây. Bảng này chỉ tóm tắt thứ tự để dùng trong go-live; chi tiết kỹ thuật và là nguồn sự thật nằm ở DEVOPS-01.

| Bước | Hành động | Owner | Verify |
| --- | --- | --- | --- |
| 1 | Confirm release window | PM/DevOps | Go-live calendar approved |
| 2 | Freeze deploy artifact | DevOps | Backend/frontend image/tag fixed |
| 3 | Backup DB | DevOps/DBA | Backup ID recorded |
| 4 | Deploy backend | DevOps | Health check OK |
| 5 | Run migration | DevOps/BE Lead | Migration success |
| 6 | Run seed required | DevOps/BE Lead | Seed success/idempotent |
| 7 | Deploy frontend | DevOps/FE Lead | App loads OK |
| 8 | Set env/config/feature flags | DevOps/Tech Lead | Config verified |
| 9 | Smoke test | QA + Product | Smoke pass |
| 10 | Enable production access | Admin/DevOps | Login user OK |
| 11 | Monitor logs/metrics | DevOps + Tech Lead | No critical alert |
| 12 | Announce go-live | PM/Product | Communication sent |

## 17.4 Smoke test sau deploy

Smoke test sau deploy phải ngắn, tập trung xác nhận hệ thống sống và flow chính hoạt động.

| Mã | Smoke test | Expected |
| --- | --- | --- |
| IMP09-SMOKE-001 | Mở frontend URL | App load thành công |
| IMP09-SMOKE-002 | Login admin | Login thành công, vào Home Portal |
| IMP09-SMOKE-003 | Login employee | Login thành công, thấy app đúng quyền |
| IMP09-SMOKE-004 | Gọi `/auth/me` | Trả user context đúng |
| IMP09-SMOKE-005 | Mở Dashboard | Widget chính load hoặc degraded có kiểm soát |
| IMP09-SMOKE-006 | Mở Employee list với HR/Admin | List load, phân trang |
| IMP09-SMOKE-007 | Mở Attendance today | Trạng thái load đúng |
| IMP09-SMOKE-008 | Smoke flow LEAVE trên production: bắt buộc dùng tài khoản test riêng (dedicated test account) hoặc smoke read-only; nếu có tạo bản ghi test thì phải cleanup ngay sau khi verify | Request tạo được bằng test account và đã được xóa/cleanup, hoặc smoke read-only pass; không để lại dữ liệu test trong production |
| IMP09-SMOKE-009 | Mở Notification dropdown | Unread/latest load |
| IMP09-SMOKE-010 | Kiểm tra audit/log/health | Log có request id, health OK |

## 17.5 Rollback triggers

Rollback hoặc hotfix khẩn cấp được kích hoạt nếu xảy ra:

| Trigger | Mức xử lý |
| --- | --- |
| Không login được với đa số user | Rollback/hotfix ngay |
| API auth/session lỗi diện rộng | Rollback/hotfix ngay |
| Lộ dữ liệu ngoài scope/permission | Disable feature/rollback ngay |
| Migration làm sai/mất dữ liệu | Dừng release, restore nếu cần approval |
| Check-in/check-out ghi sai dữ liệu production | Disable ATT action hoặc rollback |
| Leave approval sync sai ATT diện rộng | Disable approve hoặc hotfix |
| Frontend trắng trang toàn hệ thống | Rollback frontend |
| Database CPU/connection tăng bất thường do release | Rollback app hoặc disable feature |
| Notification spam diện rộng | Disable notification job/event |
| Dashboard query làm nghẽn hệ thống | Disable dashboard widget/cache hotfix |

## 17.6 Rollback runbook

> Lưu ý: rollback runbook thực thi **theo DEVOPS-01** (cơ chế deployment/backup/restore là nguồn sự thật kỹ thuật). Phần dưới là quy trình điều phối incident/rollback ở mức release, không định nghĩa lại cơ chế restore từ đầu để tránh drift với DEVOPS-01.

```text
1. Declare incident
2. Freeze all deployments
3. Identify affected layer: frontend / backend / database / config / external service
4. Decide rollback path
5. Notify release war-room
6. Rollback frontend/backend artifact nếu lỗi app
7. Disable feature flag/module nếu lỗi chức năng riêng
8. Rollback config nếu lỗi env/setting
9. Database restore chỉ khi có data corruption nghiêm trọng và approval
10. Run smoke test sau rollback
11. Monitor
12. Communicate status
13. Open post-incident review
```

## 17.7 Rollback checklist theo layer

| Layer | Rollback action | Verify |
| --- | --- | --- |
| Frontend | Deploy previous stable build | App load, login, route main OK |
| Backend | Deploy previous stable image | Health, API smoke OK |
| Config | Restore previous env/feature flag | Behavior trở lại bình thường |
| Database schema | App rollback nếu DB backward-compatible | API vẫn chạy với schema mới |
| Database data | Restore backup hoặc run corrective script | Cần approval, verify dữ liệu |
| Jobs | Disable job/worker | Không còn spam/event lỗi |
| Dashboard widget | Disable widget/cache invalidation | Dashboard không gây tải |
| Notification event | Disable event/template | Không còn gửi sai/spam |

---

# 18. WS9 - Monitoring, Logging, Alerting & Support Readiness

## 18.1 Mục tiêu

Đảm bảo sau go-live team có thể phát hiện lỗi, truy vết nguyên nhân, hỗ trợ người dùng và xử lý incident.

## 18.2 Monitoring checklist

> Lưu ý: các metric/log và alert rule dưới đây triển khai **theo các tài liệu DEVOPS** (DEVOPS-01 Infrastructure/Backup/Deployment và tài liệu DEVOPS-0x monitoring tương ứng) — đây là danh sách readiness cần xác nhận cho go-live, không định nghĩa lại stack monitoring/alerting từ đầu để tránh drift.

| Nhóm | Metric/Log cần có |
| --- | --- |
| Availability | Frontend uptime, backend health, database connection |
| API latency | P95/P99 theo endpoint quan trọng |
| Error rate | 4xx/5xx theo module |
| Auth | Login success/fail, refresh failure, locked account |
| Database | CPU, connection, slow query, migration log |
| Attendance | Check-in/out error, adjustment error, missing checkout job |
| Leave | Submit/approve/reject error, sync ATT error |
| Task | Task update/comment/mention error |
| Notification | Event consume error, delivery log failed, unread count latency |
| Dashboard | Widget error/degraded rate, cache miss/error |
| File | Upload/download error, file access denied |
| Audit | Audit write failure |

## 18.3 Alert rule đề xuất

| Alert | Trigger đề xuất | Owner |
| --- | --- | --- |
| Backend down | Health check fail liên tục | DevOps |
| DB connection high | Connection > threshold | DevOps/BE |
| API 5xx spike | 5xx tăng đột biến | BE Lead |
| Login fail spike | Login fail tăng bất thường | BE/Security |
| Permission denied spike | 403 tăng bất thường sau release | BE/QA |
| Notification failure | Delivery/event failure > threshold | BE/DevOps |
| Dashboard widget failure | Widget degraded/error > threshold | BE/FE |
| Slow query | Query > threshold | BE/DBA |
| Audit write fail | Audit log ghi thất bại | BE Lead |

## 18.4 Logging checklist

- [ ] Mỗi request có request id/correlation id.
- [ ] Error log có module, endpoint, user id hash hoặc safe id, company id nếu an toàn.
- [ ] Không log password/token/secret.
- [ ] Audit log không thay thế system log, và system log không thay thế audit log.
- [ ] Notification event có event id/dedupe key.
- [ ] Background job có job id/status/duration/error.
- [ ] Migration/deployment log được lưu.
- [ ] Export/file access log nếu liên quan dữ liệu nhạy cảm.

## 18.5 Support readiness

| Tài liệu/Quy trình | Nội dung |
| --- | --- |
| User guide | Login, Home Portal, check-in/out, xin nghỉ, task, notification |
| Manager guide | Duyệt nghỉ, duyệt công, task team, dashboard manager |
| HR guide | Nhân viên, profile change, bảng công, leave admin, dashboard HR |
| Admin guide | User/role/permission, settings, module catalog, audit |
| FAQ | Các lỗi thường gặp và cách xử lý |
| Support channel | Kênh tiếp nhận lỗi sau go-live |
| Incident template | Mô tả lỗi, user, thời điểm, bước tái hiện, ảnh chụp, request id |
| Known issues | Danh sách lỗi đã biết, workaround, owner, deadline |
| Escalation path | P0/P1 gọi ai, phản hồi trong bao lâu |

## 18.6 Hypercare đề xuất

| Giai đoạn | Mục tiêu | Hoạt động |
| --- | --- | --- |
| T+0 đến T+1 | Giám sát sát sao | War-room, monitor, xử lý P0/P1 |
| T+2 đến T+3 | Ổn định vận hành | Triage feedback, hotfix nhỏ nếu cần |
| T+4 đến T+7 | Chuyển giao support thường | Tổng hợp issue, post-go-live report |

---

# 19. WS10 - Final Sign-off, Go/No-go & Handoff

## 19.1 Mục tiêu

Chốt quyết định go-live dựa trên dữ liệu kiểm thử, readiness và rủi ro còn lại.

## 19.2 Go/No-go checklist

| Nhóm | Câu hỏi | Kết quả |
| --- | --- | --- |
| Scope | Scope MVP đã freeze chưa? |  |
| RC | RC build/tag đã chốt chưa? |  |
| Bug | P0/P1 còn mở không? |  |
| Regression | Flow P0/P1 pass chưa? |  |
| UAT | Stakeholder đã sign-off chưa? |  |
| Security | Có security blocker không? |  |
| Performance | API/flow chính đạt ngưỡng chấp nhận chưa? |  |
| Migration | Migration/seed staging pass chưa? |  |
| Backup | Backup production/pre-release đã sẵn sàng chưa? |  |
| RTO/RPO & DR | RPO/RTO target theo lớp dữ liệu và DR readiness đã đạt chưa? (target theo COMPLIANCE-01, cơ chế backup/restore theo DEVOPS-01) |  |
| Rollback | Rollback runbook đã review chưa? |  |
| Monitoring | Health/log/alert hoạt động chưa? |  |
| Support | Support guide/channel đã có chưa? |  |
| Communication | User/stakeholder đã được thông báo chưa? |  |

## 19.3 Sign-off roles

| Vai trò | Trách nhiệm sign-off |
| --- | --- |
| Product Owner | Scope, business acceptance, known issues |
| QA Lead | Test result, regression, UAT evidence |
| Tech Lead | Technical readiness, architecture, risk |
| Backend Lead | API, DB, migration, performance, security |
| Frontend Lead | UI, route, state, responsive, frontend release |
| DevOps Lead | Deployment, environment, monitoring, rollback |
| Compliance/DPO (COMPLIANCE-01) | Personal data protection, RPO/RTO & DR readiness, tuân thủ Nghị định 13/2023 |
| Business Stakeholder | UAT/business approval |
| Support Owner | Support handoff, user guide, incident path |

## 19.4 Go decision

| Quyết định | Điều kiện |
| --- | --- |
| GO | Tất cả release gate bắt buộc đạt, rủi ro còn lại được chấp nhận |
| CONDITIONAL GO | Có P2/known issue nhưng có workaround và stakeholder chấp nhận |
| NO-GO | Có P0/P1, security/data blocker, migration/rollback chưa sẵn sàng, UAT chưa sign-off |

## 19.5 Handoff package

| Mã | Tài liệu/Artifact | Người nhận |
| --- | --- | --- |
| IMP09-HANDOFF-001 | Release notes | Stakeholder, QA, Support |
| IMP09-HANDOFF-002 | Go-live runbook | DevOps, Tech Lead, QA |
| IMP09-HANDOFF-003 | Rollback plan | DevOps, Tech Lead |
| IMP09-HANDOFF-004 | UAT sign-off package | Product, Stakeholder |
| IMP09-HANDOFF-005 | Test summary report | QA, Product, Tech Lead |
| IMP09-HANDOFF-006 | Known issues list | Support, Product |
| IMP09-HANDOFF-007 | Admin guide | Admin/HR/Super Admin |
| IMP09-HANDOFF-008 | User guide | Employee/Manager/HR |
| IMP09-HANDOFF-009 | Support FAQ | Support team |
| IMP09-HANDOFF-010 | Post-go-live backlog | Product/PM |

---

# 20. Sprint 6 execution schedule đề xuất

Tùy độ dài sprint, có thể áp dụng lịch 5 ngày hoặc 10 ngày. Nếu team còn nhiều bug, nên dùng 10 ngày. Nếu Sprint 5 đã hardening tốt, có thể dùng 5 ngày.

## 20.1 Phương án 5 ngày

| Ngày | Trọng tâm | Output |
| --- | --- | --- |
| Day 1 | Scope freeze, bug triage, release board, finalize UAT | Scope freeze note, bug matrix |
| Day 2 | Fix P0/P1, security/RBAC pass, migration rehearsal | Bug fixes, migration report |
| Day 3 | Regression/E2E/UAT final, performance check | Regression report, UAT feedback |
| Day 4 | RC build, release notes, go-live/rollback rehearsal | RC tag, release notes, runbook |
| Day 5 | Go/No-go, final sign-off, production readiness | Go-live approval package |

## 20.2 Phương án 10 ngày

| Ngày | Trọng tâm | Output |
| --- | --- | --- |
| Day 1 | Scope freeze, release governance | Freeze note, release board |
| Day 2 | Bug triage và fix P0/P1 wave 1 | Bug report |
| Day 3 | Regression pass 1 | Regression result 1 |
| Day 4 | Security/RBAC/data scope pass | Security checklist |
| Day 5 | Migration/seed/backup rehearsal | DB readiness report |
| Day 6 | Performance/query/cache hardening | Performance report |
| Day 7 | UAT final pass | UAT issues/sign-off draft |
| Day 8 | RC1 build + release notes | RC1 package |
| Day 9 | Go-live rehearsal + rollback rehearsal | Runbook verified |
| Day 10 | Go/No-go + final handoff | Signed release package |

---

# 21. Issue board setup cho Sprint 6

## 21.1 Columns

```text
Backlog
Triage
Accepted for RC
In Progress
Code Review
Ready for QA
QA Verifying
Ready for RC
Included in RC
Done
Deferred Post-Go-live
Rejected/Duplicate
```

## 21.2 Labels

| Label | Ý nghĩa |
| --- | --- |
| `release-blocker` | Không thể release nếu chưa xử lý |
| `p0` | Blocker |
| `p1` | Critical |
| `p2` | Major |
| `security` | Liên quan bảo mật |
| `data-integrity` | Liên quan đúng/sai dữ liệu |
| `permission-scope` | Liên quan RBAC/data scope |
| `migration` | Liên quan DB migration/seed |
| `performance` | Liên quan hiệu năng |
| `uat` | Phát hiện từ UAT |
| `known-issue` | Chấp nhận release kèm workaround |
| `post-go-live` | Đẩy sang backlog sau go-live |

## 21.3 Issue template bug Sprint 6

```markdown
## Summary

## Environment
- Env:
- Version/RC:
- User/Role:
- Browser/device:

## Steps to reproduce
1.
2.
3.

## Actual result

## Expected result

## Severity
P0/P1/P2/P3/P4

## Module
AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/FOUNDATION

## Release impact
- Block go-live: Yes/No
- Workaround: Yes/No

## Evidence
- Screenshot/video/log/request_id:

## Root cause

## Fix note

## QA verification

## Regression area
```

---

# 22. Definition of Ready cho Release Candidate

Một build được đưa vào RC khi đạt:

| Mã | Tiêu chí |
| --- | --- |
| IMP09-DOR-RC-001 | Build backend/frontend thành công trên CI |
| IMP09-DOR-RC-002 | Migration/seed tương ứng đã chạy staging thành công |
| IMP09-DOR-RC-003 | Không còn P0 |
| IMP09-DOR-RC-004 | P1 còn lại bằng 0 hoặc được approved defer với lý do rõ ràng |
| IMP09-DOR-RC-005 | Security blocker bằng 0 |
| IMP09-DOR-RC-006 | Smoke test staging pass |
| IMP09-DOR-RC-007 | Release notes đã cập nhật |
| IMP09-DOR-RC-008 | Known issues đã có owner/workaround |
| IMP09-DOR-RC-009 | Rollback compatibility đã review |
| IMP09-DOR-RC-010 | QA Lead đồng ý đưa vào RC |

---

# 23. Definition of Done cho Sprint 6

Sprint 6 được xem là hoàn thành khi:

1. Scope MVP đã freeze và không còn thay đổi lớn.
2. Có ít nhất một Release Candidate được tạo và deploy staging thành công.
3. Smoke test pass trên RC.
4. Regression P0/P1 pass.
5. UAT final pass hoặc có sign-off điều kiện rõ ràng.
6. Không còn P0/P1 chưa xử lý.
7. Security/data leakage blocker bằng 0.
8. Migration/seed/backup đã verify.
9. Go-live runbook và rollback plan đã review.
10. Monitoring/logging/alerting tối thiểu đã sẵn sàng.
11. Release notes, known issues và handoff package đã hoàn thiện.
12. Go/No-go decision được ghi nhận.
13. Nếu GO: sản phẩm được triển khai theo runbook hoặc sẵn sàng triển khai.
14. Nếu NO-GO: có action plan và owner rõ cho các blocker.
15. Post-go-live backlog đã được tạo cho P2/P3/enhancement.

---

# 24. Acceptance criteria Sprint 6

| Mã | Acceptance criteria |
| --- | --- |
| IMP09-AC-001 | Tài liệu xác định rõ mục tiêu Sprint 6, phạm vi, workstream và deliverable |
| IMP09-AC-002 | Có checklist scope freeze và change request rule |
| IMP09-AC-003 | Có severity matrix và bug lifecycle cho release stabilization |
| IMP09-AC-004 | Có danh sách regression flow P0/P1 theo module và role |
| IMP09-AC-005 | Có UAT sign-off condition rõ ràng |
| IMP09-AC-006 | Có security/RBAC/data protection checklist |
| IMP09-AC-007 | Có performance/query/cache hardening checklist |
| IMP09-AC-008 | Có migration/seed/backup verification checklist |
| IMP09-AC-009 | Có release candidate rule, naming và release notes template |
| IMP09-AC-010 | Có deployment sequence và smoke test sau deploy |
| IMP09-AC-011 | Có rollback triggers và rollback runbook |
| IMP09-AC-012 | Có monitoring/logging/alerting/support readiness checklist |
| IMP09-AC-013 | Có Go/No-go checklist và sign-off roles |
| IMP09-AC-014 | Có schedule đề xuất 5 ngày và 10 ngày |
| IMP09-AC-015 | Có Definition of Ready cho RC và Definition of Done cho Sprint 6 |
| IMP09-AC-016 | Có handoff package cho stakeholder, QA, DevOps và support |

---

# 25. Rủi ro Sprint 6 và phương án xử lý

| Rủi ro | Mức độ | Dấu hiệu | Phương án xử lý |
| --- | --- | --- | --- |
| Scope creep sát ngày release | Cao | Stakeholder yêu cầu thêm feature | Dùng scope freeze + CR process |
| P0/P1 quá nhiều | Cao | Bug board không giảm | Tập trung critical flow, defer P2/P3 |
| Permission scope sai | Rất cao | User thấy dữ liệu ngoài phạm vi | Block release, chạy permission regression |
| Migration lỗi production | Rất cao | Migration staging không ổn | Rehearsal, backup, rollback, không destructive |
| Dashboard gây tải | Trung bình/Cao | Slow query, timeout | Cache/lazy load/disable widget |
| Notification spam | Trung bình/Cao | Nhiều event trùng | Dedupe, rate limit, disable event nếu cần |
| File private lộ quyền | Rất cao | URL tải không kiểm permission | Block release, fix file access guard |
| UAT không kịp sign-off | Cao | Stakeholder chưa test đủ | Ưu tiên P0 flow, lịch UAT cố định, sign-off điều kiện |
| Rollback chưa rõ | Rất cao | Không biết quay lại version nào | Diễn tập rollback trước go-live |
| Monitoring thiếu | Cao | Lỗi production không phát hiện | Bật health/log/alert tối thiểu trước release |
| Support chưa sẵn sàng | Trung bình | User không biết báo lỗi | Chuẩn bị channel, FAQ, incident template |

---

# 26. Checklist cuối trước go-live

## 26.1 Product/Business

- [ ] Scope MVP đã chốt.
- [ ] UAT flow P0/P1 đã pass.
- [ ] Stakeholder đã sign-off.
- [ ] Known issues được chấp nhận.
- [ ] User/admin guide bản tối thiểu đã có.
- [ ] Communication go-live đã chuẩn bị.

## 26.2 QA

- [ ] Smoke test pass.
- [ ] Regression pass.
- [ ] E2E critical flows pass.
- [ ] API contract pass.
- [ ] Permission/data scope pass.
- [ ] Security checklist pass.
- [ ] Performance sanity pass.
- [ ] UAT evidence lưu đầy đủ.

## 26.3 Backend

- [ ] API health OK.
- [ ] Migration/seed OK.
- [ ] RBAC guard OK.
- [ ] Audit log OK.
- [ ] Notification event OK.
- [ ] Dashboard query/cache OK.
- [ ] Background jobs OK.
- [ ] Error response production-safe.

## 26.4 Frontend

- [ ] Build production OK.
- [ ] Login/Home Portal/App Switcher OK.
- [ ] Route guard OK.
- [ ] Permission UI OK.
- [ ] Dashboard/widget degraded state OK.
- [ ] Responsive P0 OK.
- [ ] Error/loading/empty/forbidden state OK.
- [ ] Query cache cleared on logout.

## 26.5 DevOps

- [ ] Production environment ready.
- [ ] Domain/SSL ready.
- [ ] Env/secrets ready.
- [ ] CI/CD pipeline ready.
- [ ] Backup ready.
- [ ] Rollback ready.
- [ ] Monitoring/alert ready.
- [ ] Logs accessible.
- [ ] Release window approved.

## 26.6 Support

- [ ] Support channel ready.
- [ ] Incident escalation path ready.
- [ ] FAQ/known issues ready.
- [ ] Admin/support accounts ready.
- [ ] Hypercare schedule ready.

---

# 27. Capacity & Estimation

## 27.1 Thang điểm tham chiếu

Sprint 6 dùng chung thang Story Point đã định nghĩa ở **IMPLEMENTATION-02 §3.5**:

| Point | Độ phức tạp tham chiếu |
| --- | --- |
| 1 | Sửa nhỏ, copy UI, validation đơn giản |
| 2 | Task nhỏ, ít dependency |
| 3 | Story nhỏ, 1 API hoặc 1 UI state |
| 5 | Story vừa, có API + UI + test cơ bản |
| 8 | Story lớn, có nhiều state/quyền/dependency |
| 13 | Story rất lớn, cần tách task kỹ thuật nội bộ |

## 27.2 Capacity Sprint 6

| Thông số | Giá trị |
| --- | --- |
| Độ dài sprint | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 BE |
| Frontend | 2-4 FE |
| QA | 1-2 QA |
| DevOps | 1 DevOps |

Lưu ý: Sprint 6 phần lớn là **bug-fix / stabilization / release**, không đo bằng story point thuần như các sprint xây tính năng. Phần lớn dung lượng của sprint được dành cho khắc phục bug tồn đọng và diễn tập release (RC build, migration/deploy/rollback rehearsal, go-live), nên story point chỉ phản ánh phần backlog mới được kéo vào, không phản ánh toàn bộ effort của sprint.

## 27.3 Story mới trong Sprint 6

Sprint 6 kéo vào phần backlog mới từ **IMPLEMENTATION-02 §8.12 (EPIC-11)**:

| Story | Mô tả | Point |
| --- | --- | ---: |
| IMP02-STORY-111 | UAT & business acceptance (UAT script theo role, sign-off từng module, bug triage, release decision) | 8 |
| IMP02-STORY-112 | MVP release readiness checklist (migration, seed, env, monitoring, backup, rollback, known issues) | 5 |
| **Tổng story mới** | | **13** |

> Lưu ý: 13 point chỉ là phần **backlog story mới**. Dung lượng cho bug-fix / stabilization / release rehearsal được **reserve riêng** (không tính trong 13 point này) và được điều phối qua release board + daily triage.

## 27.4 Lưu ý điều chỉnh capacity

- Nếu Sprint 5 hardening tốt (số bug P0/P1 tồn đọng thấp), Sprint 6 đủ thời gian cho RC + go-live theo kế hoạch.
- Nếu bug tồn đọng còn cao, ưu tiên **bug-fix-only**, giảm scope rehearsal không bắt buộc và **lùi go-live** thay vì cố ép release.

---

# 28. Kết luận

IMPLEMENTATION-09 chốt cách đưa MVP từ trạng thái đã triển khai chức năng sang trạng thái có thể release.

Tư duy triển khai Sprint 6:

```text
Không thêm scope mới
-> Ổn định flow chính
-> Kiểm thử hồi quy theo role và module
-> Chốt Release Candidate
-> Diễn tập migration/deployment/rollback
-> Chuẩn bị monitoring/support
-> Go/No-go dựa trên bằng chứng
-> Bàn giao vận hành và hypercare
```

Sau IMPLEMENTATION-09, bước tiếp theo nên là:

```text
IMPLEMENTATION-10: Post-MVP Backlog & Phase 2 Planning
```

IMPLEMENTATION-10 sẽ tập trung vào vận hành sau go-live, xử lý feedback thực tế, incident review, đo adoption, cleanup backlog, ổn định support process và lập kế hoạch Phase 2 cho Payroll, Recruitment hoặc các module mở rộng khác.
