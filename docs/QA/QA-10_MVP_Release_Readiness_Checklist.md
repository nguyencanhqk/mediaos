# QA-10: MVP RELEASE READINESS CHECKLIST
# CHECKLIST SẴN SÀNG PHÁT HÀNH MVP

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | QA-10 |
| Tên tài liệu | MVP Release Readiness Checklist |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | QA & Release - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Người viết |  |
| Người duyệt |  |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-14, QA-01 -> QA-09 |

---

## 2. Mục đích tài liệu

QA-10 là checklist cuối cùng dùng để quyết định hệ thống **có đủ điều kiện phát hành MVP hay không**.

Tài liệu này dùng để:

1. Gom toàn bộ tiêu chí nghiệm thu release từ Product, Business, Backend, Frontend, Database, DevOps, Security và QA.
2. Kiểm tra trạng thái hoàn thành của các module MVP: AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION.
3. Kiểm tra kết quả QA trước release: test case, E2E, API, permission, security, performance, regression, bug, UAT.
4. Đưa ra quyết định **Go / Conditional Go / No-Go** cho MVP.
5. Xác định các hạng mục bắt buộc phải hoàn tất trước production release.
6. Xác định các hạng mục có thể defer sang phase sau nếu không ảnh hưởng đến MVP core.
7. Chuẩn hóa sign-off giữa Product Owner, Business Owner, QA Lead, Tech Lead, Backend Lead, Frontend Lead, DevOps và Security.
8. Làm checklist vận hành cho ngày release và giai đoạn hypercare sau release.

QA-10 không thay thế QA-01 đến QA-09. QA-10 chỉ là **release gate tổng hợp** sau khi các hoạt động test chi tiết đã được thực hiện.

---

## 3. Vị trí của QA-10 trong chuỗi QA

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

QA-10 chỉ được thực hiện khi:

1. Test case matrix đã có coverage cho module MVP.
2. E2E P0 flow đã chạy qua staging.
3. API contract test đã hoàn tất cho endpoint trọng yếu.
4. Permission, role và data scope đã test theo matrix.
5. Security test đã hoàn tất ở mức tối thiểu cho MVP.
6. Performance test đã có kết quả hoặc baseline được chấp nhận.
7. Bug list đã được triage và không còn blocker.
8. UAT đã được business review.

---

## 4. Phạm vi release readiness MVP

### 4.1 Module bắt buộc trong MVP

| Module | Tên module | Release critical | Ghi chú |
| --- | --- | --- | --- |
| AUTH | Tài khoản, đăng nhập & phân quyền | Có | Nền tảng xác thực, session, RBAC, data scope |
| HR | Quản lý nhân sự | Có | Employee, department, position, contract, profile change |
| ATT | Chấm công | Có | Check-in/out, bảng công, điều chỉnh công, remote/công tác |
| LEAVE | Nghỉ phép | Có | Tạo đơn, duyệt, số dư phép, đồng bộ ATT |
| TASK | Công việc & dự án | Có | Project, task, assignee, status, comment, checklist |
| NOTI | Thông báo hệ thống | Có | In-app notification, unread count, dropdown/list, event |
| DASH | Dashboard | Có | Dashboard theo vai trò, widget, quick action, cache |
| FOUNDATION | Hệ thống nền tảng | Có | Company, module, settings, audit, file, seed, public holiday |

### 4.2 Module không bắt buộc trong MVP

| Module | Trạng thái release MVP | Điều kiện |
| --- | --- | --- |
| PAYROLL | Không release nghiệp vụ đầy đủ | Có thể chỉ giữ placeholder/permission chuẩn bị |
| RECRUIT | Không release nghiệp vụ đầy đủ | Ẩn hoặc coming soon |
| ASSET | Không release nghiệp vụ đầy đủ | Ẩn hoặc coming soon |
| ROOM | Không release nghiệp vụ đầy đủ | Ẩn hoặc coming soon |
| CHAT | Không release nghiệp vụ đầy đủ | Ẩn hoặc coming soon |
| SOCIAL | Không release nghiệp vụ đầy đủ | Ẩn hoặc coming soon |
| MOBILE | Không release app native | Mobile web cho P0 flow nếu đã cam kết |
| AI | Không release | Chỉ chừa thiết kế mở rộng |

### 4.3 Flow P0 bắt buộc release

| Mã flow | Flow | Module | Release critical |
| --- | --- | --- | --- |
| QA10-FLOW-001 | Login -> Home Portal -> mở module | AUTH, FOUNDATION, UI shell | Có |
| QA10-FLOW-002 | App Switcher đổi module | FOUNDATION, FE shell | Có |
| QA10-FLOW-003 | Check-in / check-out | ATT | Có |
| QA10-FLOW-004 | Xem bảng công cá nhân | ATT | Có |
| QA10-FLOW-005 | Tạo và gửi đơn nghỉ phép | LEAVE | Có |
| QA10-FLOW-006 | Duyệt / từ chối đơn nghỉ | LEAVE, AUTH, HR | Có |
| QA10-FLOW-007 | Đồng bộ leave approved sang attendance | LEAVE, ATT | Có |
| QA10-FLOW-008 | Xem task của tôi | TASK | Có |
| QA10-FLOW-009 | Cập nhật trạng thái task | TASK | Có |
| QA10-FLOW-010 | Notification unread/dropdown/list/deep link | NOTI | Có |
| QA10-FLOW-011 | Dashboard Employee/Manager/HR/Admin | DASH | Có |
| QA10-FLOW-012 | Route guard và forbidden state | AUTH, FE, BE | Có |
| QA10-FLOW-013 | Permission/data scope Own/Team/Company | AUTH, all modules | Có |
| QA10-FLOW-014 | File upload/download private nếu dùng ở HR/LEAVE/TASK/ATT | FOUNDATION | Có nếu bật file MVP |

---

## 5. Nguyên tắc quyết định release

### 5.1 Trạng thái release

| Trạng thái | Ý nghĩa | Điều kiện |
| --- | --- | --- |
| Go | Đủ điều kiện release MVP | Không còn blocker/P0/P1 critical, UAT sign-off, deployment rehearsal đạt |
| Conditional Go | Có thể release có điều kiện | Còn issue nhỏ đã có workaround, không ảnh hưởng flow P0, có owner/deadline rõ |
| No-Go | Không được release | Còn blocker/P0/P1 critical, security high chưa xử lý, UAT chưa đạt, migration/deploy chưa an toàn |

### 5.2 Điều kiện Go tối thiểu

MVP chỉ được Go khi toàn bộ điều kiện sau đạt:

1. Tất cả flow P0 pass trên staging.
2. Không còn bug severity Blocker hoặc Critical đang open.
3. Không còn security issue Critical/High chưa xử lý hoặc chưa có risk acceptance chính thức.
4. Không còn lỗi permission/data scope làm lộ dữ liệu trái quyền.
5. Migration từ database trống chạy thành công trên CI/staging.
6. Seed production không chứa dữ liệu mẫu/dev-only.
7. Login/session/refresh/logout hoạt động ổn định.
8. Dashboard, notification, attendance, leave, task không bị lỗi ở flow chính.
9. Performance baseline đạt ngưỡng MVP hoặc đã được Product/Tech chấp nhận.
10. UAT được Business Owner hoặc Product Owner sign-off.
11. Release runbook, rollback plan và monitoring đã sẵn sàng.
12. DevOps xác nhận môi trường production đã cấu hình đúng.

### 5.3 Điều kiện No-Go bắt buộc

Phải No-Go nếu có một trong các trường hợp:

1. Người dùng không thể login hoặc session bị lỗi diện rộng.
2. User có thể xem/sửa dữ liệu ngoài data scope.
3. Employee có thể check-in sai khi đã có đơn nghỉ full-day approved.
4. Leave approval làm trừ phép sai hoặc đồng bộ sai bảng công.
5. Migration có nguy cơ mất dữ liệu hoặc không rollback được.
6. Seed role/permission sai làm lộ dữ liệu hoặc khóa toàn bộ admin.
7. API trả dữ liệu nhạy cảm không mask cho user thiếu quyền.
8. File private có thể truy cập không cần quyền.
9. Bug P0/P1 chưa có fix hoặc workaround được duyệt.
10. UAT bị business reject cho flow core.
11. Production environment thiếu biến môi trường bắt buộc.
12. Không có rollback plan hoặc người chịu trách nhiệm release.

---

## 6. Release readiness scorecard

| Nhóm | Trọng số | Điều kiện đạt | Trạng thái |
| --- | ---: | --- | --- |
| Product scope | 10% | MVP scope rõ, không có scope creep chưa kiểm soát | Not started / In progress / Passed / Failed |
| Business acceptance | 10% | UAT pass, sign-off business | Not started / In progress / Passed / Failed |
| Functional QA | 15% | P0/P1 test case pass | Not started / In progress / Passed / Failed |
| E2E QA | 10% | E2E flow chính pass | Not started / In progress / Passed / Failed |
| API contract | 10% | Contract, response, error, permission pass | Not started / In progress / Passed / Failed |
| Permission & data scope | 15% | Không lộ dữ liệu trái quyền | Not started / In progress / Passed / Failed |
| Security | 10% | Không còn Critical/High open | Not started / In progress / Passed / Failed |
| Performance | 5% | Baseline đạt hoặc được chấp nhận | Not started / In progress / Passed / Failed |
| Deployment & rollback | 10% | Deploy rehearsal, migration, rollback OK | Not started / In progress / Passed / Failed |
| Monitoring & support | 5% | Logs, alert, hypercare ready | Not started / In progress / Passed / Failed |

Quy tắc chấm:

```text
>= 90% và không có gate fail -> Go
80% - 89% và không có gate fail -> Conditional Go
< 80% hoặc có gate fail -> No-Go
```

Gate fail gồm: security critical/high open, P0/P1 blocker open, permission/data leak, migration destructive chưa duyệt, UAT core fail.

---

## 7. Checklist Product & Business readiness

### 7.1 Scope MVP

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-PROD-001 | Danh sách module MVP đã được chốt | Product Owner | Có |  |  |
| QA10-PROD-002 | Flow P0/P1 đã được chốt và không còn thay đổi lớn | Product Owner | Có |  |  |
| QA10-PROD-003 | Các module phase sau đã ẩn hoặc đánh dấu coming soon đúng policy | Product + FE | Có |  |  |
| QA10-PROD-004 | Scope defer đã có danh sách, owner và lý do | Product Owner | Có |  |  |
| QA10-PROD-005 | Release note MVP draft đã có | Product Owner | Có |  |  |
| QA10-PROD-006 | Known limitations đã được ghi rõ | Product Owner | Có |  |  |
| QA10-PROD-007 | Business rule core đã được xác nhận: ATT, LEAVE, HR, TASK | Business Owner | Có |  |  |
| QA10-PROD-008 | Chính sách dữ liệu nhạy cảm và quyền xem đã được xác nhận | Business + Security | Có |  |  |
| QA10-PROD-009 | Điều kiện Go/No-Go đã được stakeholder đồng thuận | Product + QA | Có |  |  |
| QA10-PROD-010 | Plan truyền thông nội bộ trước release đã có | Product/Operation | Khuyến nghị |  |  |

### 7.2 Business acceptance

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-BA-001 | UAT script đã chạy trên staging | Business Owner + QA | Có |  |  |
| QA10-BA-002 | Employee flow được business accept | Business Owner | Có |  |  |
| QA10-BA-003 | Manager flow được business accept | Business Owner | Có |  |  |
| QA10-BA-004 | HR flow được business accept | HR Owner | Có |  |  |
| QA10-BA-005 | Admin/System flow được accept ở mức MVP | Admin Owner | Có |  |  |
| QA10-BA-006 | UAT issue đã được triage | Product + QA | Có |  |  |
| QA10-BA-007 | UAT blocker đã đóng hoặc có decision defer chính thức | Product Owner | Có |  |  |
| QA10-BA-008 | Business sign-off đã được ghi nhận | Business Owner | Có |  |  |

---

## 8. Checklist Functional QA readiness

### 8.1 Tổng quan test execution

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FUNC-001 | QA-02 test case matrix đã được cập nhật bản cuối | QA Lead | Có |  |  |
| QA10-FUNC-002 | 100% test case P0 đã chạy | QA Lead | Có |  |  |
| QA10-FUNC-003 | 100% test case P0 pass | QA Lead | Có |  |  |
| QA10-FUNC-004 | >= 95% test case P1 pass hoặc remaining có approval | QA Lead | Có |  |  |
| QA10-FUNC-005 | Test case P2/P3 remaining không ảnh hưởng release | QA Lead + Product | Có |  |  |
| QA10-FUNC-006 | Regression suite đã chạy sau bản build release candidate | QA Lead | Có |  |  |
| QA10-FUNC-007 | Smoke test sau deploy staging pass | QA | Có |  |  |
| QA10-FUNC-008 | Cross-browser test tối thiểu đã chạy | QA | Khuyến nghị |  |  |
| QA10-FUNC-009 | Responsive P0 flow đã test desktop/tablet/mobile web | QA | Có nếu mobile web trong scope |  |  |
| QA10-FUNC-010 | Accessibility basic test đã chạy cho flow P0 | QA/FE | Khuyến nghị |  |  |

### 8.2 Module AUTH readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-AUTH-001 | Login thành công với user active | QA/BE/FE | Có |  |  |
| QA10-AUTH-002 | Login sai mật khẩu trả lỗi đúng, không lộ thông tin nhạy cảm | QA/BE | Có |  |  |
| QA10-AUTH-003 | Logout clear session/token/cache đúng | QA/FE/BE | Có |  |  |
| QA10-AUTH-004 | Refresh token/session hết hạn được xử lý đúng | QA/FE/BE | Có |  |  |
| QA10-AUTH-005 | User locked/inactive không truy cập được | QA/BE | Có |  |  |
| QA10-AUTH-006 | Forgot/reset password hoạt động nếu bật trong MVP | QA/BE/FE | Có nếu scope |  |  |
| QA10-AUTH-007 | User có nhiều role được resolve permission đúng | QA/BE | Có |  |  |
| QA10-AUTH-008 | Role-permission matrix seed đúng | QA/BE | Có |  |  |
| QA10-AUTH-009 | Direct URL trái quyền bị chặn | QA/FE/BE | Có |  |  |
| QA10-AUTH-010 | Backend API vẫn trả 403 dù frontend bị bypass | QA/BE | Có |  |  |

### 8.3 Module HR readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-HR-001 | Xem danh sách nhân viên theo permission/data scope | QA/BE/FE | Có |  |  |
| QA10-HR-002 | Tạo nhân viên mới thành công | QA/BE/FE | Có |  |  |
| QA10-HR-003 | Mã nhân viên tự sinh theo cấu hình | QA/BE | Có |  |  |
| QA10-HR-004 | Cập nhật hồ sơ nhân viên có audit log | QA/BE | Có |  |  |
| QA10-HR-005 | Employee self-service tạo yêu cầu thay đổi, không cập nhật trực tiếp hồ sơ chính | QA/BE/FE | Có |  |  |
| QA10-HR-006 | HR/Admin duyệt/từ chối profile change request đúng | QA/BE/FE | Có |  |  |
| QA10-HR-007 | Field nhạy cảm bị mask/ẩn nếu thiếu quyền | QA/BE/FE | Có |  |  |
| QA10-HR-008 | Đổi trạng thái nhân viên ảnh hưởng đúng đến login/check-in nếu có rule | QA/BE | Có |  |  |
| QA10-HR-009 | Department/position/job level hoạt động đúng | QA/BE/FE | Có |  |  |
| QA10-HR-010 | File hồ sơ private kiểm tra quyền trước khi xem/tải | QA/BE | Có nếu bật file |  |  |

### 8.4 Module ATT readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-ATT-001 | Attendance Today load đúng trạng thái hiện tại | QA/BE/FE | Có |  |  |
| QA10-ATT-002 | Check-in thành công và chống double submit | QA/BE/FE | Có |  |  |
| QA10-ATT-003 | Check-out thành công và cập nhật record/timeline | QA/BE/FE | Có |  |  |
| QA10-ATT-004 | Nhân viên có leave full-day approved bị chặn check-in/check-out | QA/BE/FE | Có |  |  |
| QA10-ATT-005 | Bảng công cá nhân đúng dữ liệu own | QA/BE/FE | Có |  |  |
| QA10-ATT-006 | Manager xem bảng công team đúng scope | QA/BE/FE | Có |  |  |
| QA10-ATT-007 | HR/Admin xem bảng công company theo permission | QA/BE/FE | Có |  |  |
| QA10-ATT-008 | Employee gửi yêu cầu điều chỉnh công | QA/BE/FE | Có |  |  |
| QA10-ATT-009 | Manager/HR duyệt/từ chối điều chỉnh công đúng scope | QA/BE/FE | Có |  |  |
| QA10-ATT-010 | Remote/công tác hoạt động đúng rule nếu bật MVP | QA/BE/FE | Có nếu scope |  |  |
| QA10-ATT-011 | Ca làm/rule cơ bản hoạt động đúng | QA/BE | Có |  |  |
| QA10-ATT-012 | Audit log cho điều chỉnh công và HR manual adjustment | QA/BE | Có |  |  |

### 8.5 Module LEAVE readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-LEAVE-001 | Employee xem số dư phép của mình | QA/BE/FE | Có |  |  |
| QA10-LEAVE-002 | Tạo đơn nghỉ, lưu nháp và gửi đơn | QA/BE/FE | Có |  |  |
| QA10-LEAVE-003 | Preview số ngày/giờ nghỉ và check balance đúng | QA/BE/FE | Có |  |  |
| QA10-LEAVE-004 | Thiếu số dư phép xử lý đúng theo policy | QA/BE/FE | Có |  |  |
| QA10-LEAVE-005 | Manager/HR xem đơn cần duyệt đúng scope | QA/BE/FE | Có |  |  |
| QA10-LEAVE-006 | Approve đơn nghỉ đúng state transition | QA/BE/FE | Có |  |  |
| QA10-LEAVE-007 | Reject đơn nghỉ bắt buộc lý do nếu policy yêu cầu | QA/BE/FE | Có |  |  |
| QA10-LEAVE-008 | Hủy/thu hồi đơn nghỉ đúng rule | QA/BE/FE | Có |  |  |
| QA10-LEAVE-009 | Trừ/hoàn phép chính xác, có transaction/locking | QA/BE | Có |  |  |
| QA10-LEAVE-010 | Approved leave đồng bộ sang ATT đúng | QA/BE | Có |  |  |
| QA10-LEAVE-011 | Lịch nghỉ cá nhân/team/company đúng data scope | QA/BE/FE | Có |  |  |
| QA10-LEAVE-012 | Notification event phát đúng khi submit/approve/reject/cancel | QA/BE | Có |  |  |

### 8.6 Module TASK readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-TASK-001 | Tạo project/task đúng permission | QA/BE/FE | Có |  |  |
| QA10-TASK-002 | Giao task cho nhân viên active hợp lệ | QA/BE/FE | Có |  |  |
| QA10-TASK-003 | My Tasks hiển thị đúng task của user | QA/BE/FE | Có |  |  |
| QA10-TASK-004 | Task list/filter/sort/pagination hoạt động | QA/BE/FE | Có |  |  |
| QA10-TASK-005 | Task detail hiển thị summary, assignee, deadline, priority, status | QA/BE/FE | Có |  |  |
| QA10-TASK-006 | Cập nhật trạng thái task đúng permission/business rule | QA/BE/FE | Có |  |  |
| QA10-TASK-007 | Comment và mention hoạt động | QA/BE/FE | Có nếu scope |  |  |
| QA10-TASK-008 | Checklist item update hoạt động | QA/BE/FE | Có nếu scope |  |  |
| QA10-TASK-009 | File task/project private kiểm tra quyền nếu bật file | QA/BE/FE | Có nếu scope |  |  |
| QA10-TASK-010 | Task overdue/due soon đúng logic và dashboard/notification | QA/BE | Có |  |  |
| QA10-TASK-011 | Project membership/data scope không lộ task private | QA/BE | Có |  |  |

### 8.7 Module NOTI readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-NOTI-001 | Notification event được seed đúng | QA/BE | Có |  |  |
| QA10-NOTI-002 | Template in-app hoạt động cho event MVP | QA/BE | Có |  |  |
| QA10-NOTI-003 | Tạo notification đúng recipient | QA/BE | Có |  |  |
| QA10-NOTI-004 | Unread count chính xác | QA/BE/FE | Có |  |  |
| QA10-NOTI-005 | Notification dropdown load danh sách mới nhất | QA/BE/FE | Có |  |  |
| QA10-NOTI-006 | Mark read / mark all read hoạt động | QA/BE/FE | Có |  |  |
| QA10-NOTI-007 | Deep link điều hướng về module gốc và kiểm tra quyền lại | QA/BE/FE | Có |  |  |
| QA10-NOTI-008 | Notification payload không chứa dữ liệu nhạy cảm/URL private | QA/Security/BE | Có |  |  |
| QA10-NOTI-009 | Event duplicate được dedupe/idempotent nếu cần | QA/BE | Khuyến nghị |  |  |
| QA10-NOTI-010 | Không spam notification trong flow lặp | QA/BE/Product | Có |  |  |

### 8.8 Module DASH readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-DASH-001 | Dashboard default resolve đúng theo user/permission | QA/BE/FE | Có |  |  |
| QA10-DASH-002 | Employee Dashboard hiển thị widget đúng scope Own | QA/BE/FE | Có |  |  |
| QA10-DASH-003 | Manager Dashboard hiển thị dữ liệu Team đúng scope | QA/BE/FE | Có |  |  |
| QA10-DASH-004 | HR Dashboard hiển thị dữ liệu Department/Company đúng permission | QA/BE/FE | Có |  |  |
| QA10-DASH-005 | Admin Dashboard không lộ dữ liệu nhạy cảm nếu thiếu permission nguồn | QA/BE/FE | Có |  |  |
| QA10-DASH-006 | Widget lỗi source module trả degraded/fallback, không làm hỏng toàn dashboard | QA/BE/FE | Có |  |  |
| QA10-DASH-007 | Quick action chỉ điều hướng/call module gốc, không xử lý nghiệp vụ gốc trong DASH | QA/BE/FE | Có |  |  |
| QA10-DASH-008 | Dashboard cache/invalidation cơ bản hoạt động | QA/BE | Có |  |  |
| QA10-DASH-009 | Dashboard không cache chung dữ liệu Own/Team giữa user khác nhau | QA/Security/BE | Có |  |  |
| QA10-DASH-010 | Widget config seed đúng | QA/BE | Có |  |  |

### 8.9 FOUNDATION readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FOUND-001 | Company/tenant mặc định hoặc production tenant được tạo đúng | BE/DevOps | Có |  |  |
| QA10-FOUND-002 | Module catalog seed đúng module MVP | BE | Có |  |  |
| QA10-FOUND-003 | System/company settings có default an toàn | BE/DevOps | Có |  |  |
| QA10-FOUND-004 | Audit log ghi action quan trọng | BE/QA | Có |  |  |
| QA10-FOUND-005 | File service private mặc định | BE/Security | Có nếu bật file |  |  |
| QA10-FOUND-006 | File access log hoạt động với file nhạy cảm | BE/Security | Khuyến nghị |  |  |
| QA10-FOUND-007 | Sequence counter sinh mã an toàn, chống race condition | BE/QA | Có |  |  |
| QA10-FOUND-008 | Public holidays dùng chung ATT/LEAVE | BE/QA | Có nếu dùng ngày lễ |  |  |
| QA10-FOUND-009 | Retention policy/log cleanup có plan | DevOps/BE | Khuyến nghị |  |  |
| QA10-FOUND-010 | Seed tracking idempotent | BE/DevOps | Có |  |  |

---

## 9. Checklist API readiness

### 9.1 API contract

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-API-001 | Tất cả endpoint public dùng prefix `/api/v1` | BE Lead | Có |  |  |
| QA10-API-002 | Response success thống nhất | BE Lead | Có |  |  |
| QA10-API-003 | Response error thống nhất, có error code và request_id | BE Lead | Có |  |  |
| QA10-API-004 | Pagination/search/filter/sort dùng whitelist | BE Lead | Có |  |  |
| QA10-API-005 | OpenAPI/Swagger cập nhật cho endpoint MVP | BE Lead | Có |  |  |
| QA10-API-006 | API contract test pass | QA/BE | Có |  |  |
| QA10-API-007 | Validation error 422 map được vào form | BE/FE/QA | Có |  |  |
| QA10-API-008 | Conflict/business rule 409 trả message rõ | BE/QA | Có |  |  |
| QA10-API-009 | 401/403/404/500 được xử lý đúng | BE/FE/QA | Có |  |  |
| QA10-API-010 | Idempotency-Key áp dụng cho action quan trọng | BE/QA | Có với submit/approve/check-in nếu thiết kế |  |  |

### 9.2 API security & authorization

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-APISEC-001 | Mọi API nghiệp vụ yêu cầu authentication | BE/Security | Có |  |  |
| QA10-APISEC-002 | Backend resolve `company_id` từ auth context | BE/Security | Có |  |  |
| QA10-APISEC-003 | Backend không tin `user_id`, `employee_id`, `role`, `permission` từ frontend khi có thể resolve | BE/Security | Có |  |  |
| QA10-APISEC-004 | Mọi API list filter theo company_id/data scope | BE/QA | Có |  |  |
| QA10-APISEC-005 | Field nhạy cảm không trả raw nếu thiếu quyền | BE/Security | Có |  |  |
| QA10-APISEC-006 | File private không trả storage path trực tiếp | BE/Security | Có |  |  |
| QA10-APISEC-007 | Endpoint internal có service authentication hoặc không public | BE/DevOps/Security | Có |  |  |
| QA10-APISEC-008 | CORS production không dùng wildcard khi có credential | DevOps/Security | Có |  |  |
| QA10-APISEC-009 | Rate limit auth/upload/export được cấu hình | BE/DevOps/Security | Có |  |  |
| QA10-APISEC-010 | Không trả stack trace ở production | BE/DevOps | Có |  |  |

---

## 10. Checklist Frontend readiness

### 10.1 App shell & navigation

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FE-001 | App build production thành công | FE Lead | Có |  |  |
| QA10-FE-002 | AuthProvider/session bootstrap hoạt động | FE Lead | Có |  |  |
| QA10-FE-003 | Protected route guard hoạt động | FE Lead | Có |  |  |
| QA10-FE-004 | Home Portal là màn sau login | FE/Product | Có |  |  |
| QA10-FE-005 | App Switcher mở từ mọi màn protected | FE | Có |  |  |
| QA10-FE-006 | ModuleWorkspaceLayout dùng topbar/sidebar đúng | FE | Có |  |  |
| QA10-FE-007 | Sidebar/menu lọc theo permission | FE/QA | Có |  |  |
| QA10-FE-008 | Direct route trái quyền hiển thị forbidden/403 | FE/QA | Có |  |  |
| QA10-FE-009 | Dirty form guard khi đổi route/app | FE/QA | Có với form P0 |  |  |
| QA10-FE-010 | Notification badge/dropdown tích hợp layout | FE/QA | Có |  |  |

### 10.2 API client & state

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FEAPI-001 | API client dùng chung, không gọi fetch rời rạc ở module | FE Lead | Có |  |  |
| QA10-FEAPI-002 | Authorization/request id/client metadata được inject đúng | FE | Có |  |  |
| QA10-FEAPI-003 | 401 refresh/retry hoặc redirect login hoạt động | FE/BE/QA | Có |  |  |
| QA10-FEAPI-004 | Query cache clear khi logout | FE/Security | Có |  |  |
| QA10-FEAPI-005 | Validation error map vào form đúng | FE/QA | Có |  |  |
| QA10-FEAPI-006 | Forbidden/Error/Empty/Loading/Success state hiển thị đúng | FE/QA | Có |  |  |
| QA10-FEAPI-007 | Query invalidation sau mutation P0 hoạt động | FE/QA | Có |  |  |
| QA10-FEAPI-008 | Upload/download helper kiểm tra lỗi đúng | FE/QA | Có nếu file scope |  |  |
| QA10-FEAPI-009 | Không cache/lộ dữ liệu user cũ sau logout/login user khác | FE/Security/QA | Có |  |  |

### 10.3 UI/UX & responsive

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FEUI-001 | Design System component P0 dùng thống nhất | FE/UI | Có |  |  |
| QA10-FEUI-002 | Loading skeleton không làm lộ dữ liệu trái quyền | FE/QA | Có |  |  |
| QA10-FEUI-003 | Empty state phân biệt empty thật và empty do scope | FE/QA | Có |  |  |
| QA10-FEUI-004 | Error state có retry/request id nếu backend trả | FE/QA | Có |  |  |
| QA10-FEUI-005 | Forbidden state không render dữ liệu/menu/action trái quyền | FE/QA | Có |  |  |
| QA10-FEUI-006 | Toast/alert/confirm dialog nhất quán | FE/UI/QA | Có |  |  |
| QA10-FEUI-007 | Mobile web P0 flow hoạt động nếu trong scope | FE/QA | Có nếu scope |  |  |
| QA10-FEUI-008 | Keyboard focus/ESC close modal/drawer cơ bản | FE/QA | Khuyến nghị |  |  |
| QA10-FEUI-009 | Không hard-code role name trong UI logic | FE/QA | Có |  |  |

---

## 11. Checklist Backend readiness

### 11.1 Service & business logic

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-BE-001 | Module service MVP đã hoàn thành | BE Lead | Có |  |  |
| QA10-BE-002 | Business rule P0 được implement ở backend | BE Lead | Có |  |  |
| QA10-BE-003 | Backend guard kiểm tra auth/permission/data scope mọi API | BE Lead | Có |  |  |
| QA10-BE-004 | Transaction dùng cho action quan trọng | BE Lead | Có |  |  |
| QA10-BE-005 | Lock/idempotency xử lý retry/race condition ở flow cần thiết | BE Lead | Có |  |  |
| QA10-BE-006 | Audit log ghi action nhạy cảm | BE Lead | Có |  |  |
| QA10-BE-007 | Notification event phát sau action nghiệp vụ | BE Lead | Có |  |  |
| QA10-BE-008 | Allowed actions hoặc business state trả đủ cho UI | BE/FE | Khuyến nghị |  |  |
| QA10-BE-009 | Export nếu có chạy background hoặc có limit an toàn | BE/DevOps | Có nếu scope |  |  |
| QA10-BE-010 | Background jobs MVP đã test | BE/QA | Có nếu có job |  |  |

### 11.2 Backend quality gate

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-BEQ-001 | Unit test core service pass | BE Lead | Có |  |  |
| QA10-BEQ-002 | Integration test repository/service pass | BE Lead | Có |  |  |
| QA10-BEQ-003 | API test pass trên staging | QA/BE | Có |  |  |
| QA10-BEQ-004 | Lint/typecheck/build pass | BE Lead | Có |  |  |
| QA10-BEQ-005 | Không có TODO/blocker trong code release branch | BE Lead | Có |  |  |
| QA10-BEQ-006 | Error handling không nuốt lỗi quan trọng | BE Lead | Có |  |  |
| QA10-BEQ-007 | Logging có request_id/correlation_id | BE/DevOps | Có |  |  |
| QA10-BEQ-008 | Health check endpoint hoạt động | BE/DevOps | Có |  |  |

---

## 12. Checklist Database & migration readiness

### 12.1 Schema & migration

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-DB-001 | Migration chạy được từ database trống | BE/DevOps | Có |  |  |
| QA10-DB-002 | Migration chạy đúng thứ tự Foundation -> AUTH -> HR -> ATT/LEAVE/TASK -> NOTI/DASH -> FK -> Index -> Seed | BE/DevOps | Có |  |  |
| QA10-DB-003 | Không có destructive migration chưa được duyệt | BE/DevOps/Product | Có |  |  |
| QA10-DB-004 | FK/constraint/index tồn tại đúng | BE/QA | Có |  |  |
| QA10-DB-005 | UUID primary key và company_id áp dụng đúng ở bảng tenant data | BE | Có |  |  |
| QA10-DB-006 | Soft delete dùng cho dữ liệu quan trọng | BE | Có |  |  |
| QA10-DB-007 | Partial/unique index cho business key quan trọng | BE | Có |  |  |
| QA10-DB-008 | Bảng log lớn có index/retention plan | BE/DevOps | Khuyến nghị |  |  |
| QA10-DB-009 | Query pattern quan trọng đã EXPLAIN ANALYZE nếu có dữ liệu lớn | BE/DevOps | Khuyến nghị |  |  |
| QA10-DB-010 | Backup trước migration production đã được chuẩn bị | DevOps | Có |  |  |

### 12.2 Seed data

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-SEED-001 | Seed modules MVP đúng | BE | Có |  |  |
| QA10-SEED-002 | Seed permissions đầy đủ | BE/QA | Có |  |  |
| QA10-SEED-003 | Seed roles mặc định đúng | BE/QA | Có |  |  |
| QA10-SEED-004 | Seed role-permission matrix đúng data scope | BE/QA | Có |  |  |
| QA10-SEED-005 | Seed notification events/templates đúng | BE/QA | Có |  |  |
| QA10-SEED-006 | Seed dashboard widgets/configs đúng | BE/QA | Có |  |  |
| QA10-SEED-007 | Seed leave types/attendance defaults/public holidays đúng | BE/Product/QA | Có |  |  |
| QA10-SEED-008 | Seed production không chứa user/password/sample data dev-only | DevOps/Security/BE | Có |  |  |
| QA10-SEED-009 | Seed idempotent, chạy lại không tạo trùng | BE/DevOps | Có |  |  |
| QA10-SEED-010 | Bootstrap admin dùng secret an toàn và bắt buộc đổi password lần đầu | DevOps/Security | Có |  |  |

---

## 13. Checklist Security readiness

### 13.1 Authentication & session

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-SEC-001 | Password được hash an toàn, không lưu plain text | Security/BE | Có |  |  |
| QA10-SEC-002 | Refresh token/session được lưu/hash/revoke đúng | Security/BE | Có |  |  |
| QA10-SEC-003 | Token/session hết hạn đúng policy | Security/BE | Có |  |  |
| QA10-SEC-004 | Logout revoke/clear session đúng | Security/BE/FE | Có |  |  |
| QA10-SEC-005 | Brute-force/rate limit login/forgot password | Security/BE/DevOps | Có |  |  |
| QA10-SEC-006 | Không lưu access token trong localStorage nếu có lựa chọn an toàn hơn | Security/FE | Khuyến nghị |  |  |

### 13.2 Authorization & data protection

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-SECAUTH-001 | Không có endpoint nghiệp vụ bypass permission | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-002 | Kiểm tra IDOR: biết UUID không xem được dữ liệu công ty/user khác | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-003 | Data scope Own/Team/Department/Company/System được test | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-004 | Dữ liệu HR nhạy cảm được mask/ẩn theo quyền | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-005 | Notification payload không chứa dữ liệu nhạy cảm hoặc private URL | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-006 | Dashboard không expose dữ liệu nguồn nếu thiếu permission module nguồn | Security/QA/BE | Có |  |  |
| QA10-SECAUTH-007 | Audit raw diff nhạy cảm được mask/mã hóa hoặc không ghi nếu không cần | Security/BE | Có |  |  |
| QA10-SECAUTH-008 | File private kiểm tra quyền và link có TTL nếu dùng signed URL | Security/BE | Có nếu file scope |  |  |

### 13.3 Web security

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-WEBSEC-001 | XSS basic test pass ở form/comment/notification/task | Security/QA/FE/BE | Có |  |  |
| QA10-WEBSEC-002 | CSRF strategy rõ nếu dùng cookie auth | Security/BE/FE | Có nếu cookie |  |  |
| QA10-WEBSEC-003 | CORS production allowlist đúng | Security/DevOps | Có |  |  |
| QA10-WEBSEC-004 | Security headers cơ bản đã cấu hình | Security/DevOps | Khuyến nghị |  |  |
| QA10-WEBSEC-005 | Upload file kiểm tra type/size và không execute file | Security/BE | Có nếu file scope |  |  |
| QA10-WEBSEC-006 | Không log token/secret/password/file private URL | Security/BE/DevOps | Có |  |  |
| QA10-WEBSEC-007 | Dependency vulnerability scan không còn Critical/High chưa duyệt | Security/DevOps | Có |  |  |

---

## 14. Checklist Performance readiness

### 14.1 API performance baseline

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-PERF-001 | Login/auth/me phản hồi trong ngưỡng MVP | QA/BE/DevOps | Có |  |  |
| QA10-PERF-002 | Danh sách nhân viên phân trang không timeout | QA/BE | Có |  |  |
| QA10-PERF-003 | Attendance today/check-in/check-out phản hồi ổn định | QA/BE | Có |  |  |
| QA10-PERF-004 | Leave submit/approve không race condition và trong ngưỡng | QA/BE | Có |  |  |
| QA10-PERF-005 | My tasks/task list có pagination/filter/index | QA/BE | Có |  |  |
| QA10-PERF-006 | Notification unread count không scan toàn bảng lớn | QA/BE | Có |  |  |
| QA10-PERF-007 | Dashboard `/me` không timeout với widget phổ biến | QA/BE | Có |  |  |
| QA10-PERF-008 | Export nếu có không làm nghẽn API realtime | QA/BE/DevOps | Có nếu scope |  |  |
| QA10-PERF-009 | Rate limit hoạt động với dashboard refresh/upload/export/login | QA/DevOps | Có |  |  |
| QA10-PERF-010 | Slow query monitoring hoặc log threshold đã bật | DevOps/BE | Khuyến nghị |  |  |

### 14.2 Frontend performance

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-FEPERF-001 | Production bundle build tối ưu | FE | Có |  |  |
| QA10-FEPERF-002 | Route lazy load/module split nếu bundle lớn | FE | Khuyến nghị |  |  |
| QA10-FEPERF-003 | Dashboard widget lazy load/refresh hợp lý | FE/BE | Có |  |  |
| QA10-FEPERF-004 | DataTable không render quá nặng với list lớn | FE | Có |  |  |
| QA10-FEPERF-005 | App không spam API do refetch liên tục | FE/QA | Có |  |  |
| QA10-FEPERF-006 | Loading skeleton/optimistic update không gây flicker nghiêm trọng | FE/QA | Khuyến nghị |  |  |

---

## 15. Checklist Deployment & DevOps readiness

### 15.1 Environment readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-ENV-001 | Production environment đã được tạo | DevOps | Có |  |  |
| QA10-ENV-002 | Environment variables đầy đủ và không dùng dev secret | DevOps/Security | Có |  |  |
| QA10-ENV-003 | Database production connection an toàn | DevOps | Có |  |  |
| QA10-ENV-004 | Storage/file bucket production sẵn sàng | DevOps | Có nếu file scope |  |  |
| QA10-ENV-005 | Domain/SSL/TLS sẵn sàng | DevOps | Có |  |  |
| QA10-ENV-006 | CORS allowed origins đúng production/staging | DevOps/Security | Có |  |  |
| QA10-ENV-007 | Email service nếu dùng forgot password/notification sẵn sàng | DevOps/BE | Có nếu scope |  |  |
| QA10-ENV-008 | Feature flags/module status cấu hình đúng | DevOps/Product | Có |  |  |
| QA10-ENV-009 | Dev-only debug tools tắt trên production | DevOps/FE/BE | Có |  |  |

### 15.2 CI/CD readiness

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-CICD-001 | Pipeline build frontend pass | DevOps/FE | Có |  |  |
| QA10-CICD-002 | Pipeline build backend pass | DevOps/BE | Có |  |  |
| QA10-CICD-003 | Unit/integration tests chạy trong CI | DevOps/QA | Có |  |  |
| QA10-CICD-004 | Migration test từ DB trống chạy trong CI hoặc staging rehearsal | DevOps/BE | Có |  |  |
| QA10-CICD-005 | Artifact/image version được tag rõ | DevOps | Có |  |  |
| QA10-CICD-006 | Release branch/tag đã được tạo | DevOps/Tech Lead | Có |  |  |
| QA10-CICD-007 | Rollback artifact/version cũ còn sẵn | DevOps | Có |  |  |
| QA10-CICD-008 | Manual approval gate cho production deploy | DevOps/Product/Tech | Có |  |  |

### 15.3 Backup & rollback

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-ROLL-001 | Backup database trước deploy đã chạy hoặc được schedule | DevOps | Có |  |  |
| QA10-ROLL-002 | Restore backup đã được test tối thiểu ở môi trường test | DevOps | Khuyến nghị |  |  |
| QA10-ROLL-003 | Rollback app version có hướng dẫn rõ | DevOps | Có |  |  |
| QA10-ROLL-004 | Rollback migration có plan hoặc forward-fix plan | BE/DevOps | Có |  |  |
| QA10-ROLL-005 | Destructive migration cần approval riêng | Product/Tech/DevOps | Có |  |  |
| QA10-ROLL-006 | Thời điểm quyết định rollback được định nghĩa | Release Manager | Có |  |  |
| QA10-ROLL-007 | Người quyết định rollback được chỉ định | Release Manager | Có |  |  |

---

## 16. Checklist Observability & Support readiness

### 16.1 Monitoring/logging

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-OBS-001 | App health check hoạt động | DevOps/BE | Có |  |  |
| QA10-OBS-002 | API logs có request_id/correlation_id | BE/DevOps | Có |  |  |
| QA10-OBS-003 | Error logs production không chứa dữ liệu nhạy cảm | Security/DevOps/BE | Có |  |  |
| QA10-OBS-004 | Alert cho 5xx spike | DevOps | Có |  |  |
| QA10-OBS-005 | Alert cho database connection/pool issue | DevOps | Có |  |  |
| QA10-OBS-006 | Alert cho job failure nếu có job | DevOps/BE | Có nếu có job |  |  |
| QA10-OBS-007 | Dashboard monitoring cho latency/error rate | DevOps | Khuyến nghị |  |  |
| QA10-OBS-008 | Audit log có thể tra cứu theo user/action/entity | BE/QA | Có |  |  |

### 16.2 Support & hypercare

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-SUP-001 | Hypercare window sau release đã định nghĩa | Release Manager | Có |  |  |
| QA10-SUP-002 | Người trực support BE/FE/DevOps/QA đã được phân công | Release Manager | Có |  |  |
| QA10-SUP-003 | Kênh tiếp nhận bug production đã có | Product/QA | Có |  |  |
| QA10-SUP-004 | Quy trình phân loại incident P0/P1/P2 đã có | QA/Support | Có |  |  |
| QA10-SUP-005 | Mẫu bug report production có request_id, user, time, screen, steps | QA | Có |  |  |
| QA10-SUP-006 | Tài liệu hướng dẫn user/admin tối thiểu đã có | Product/Support | Khuyến nghị |  |  |
| QA10-SUP-007 | Known issues/workaround đã được chia sẻ cho support | Product/QA | Có nếu có known issue |  |  |

---

## 17. Bug readiness & release criteria

### 17.1 Severity definition

| Severity | Định nghĩa | Ví dụ |
| --- | --- | --- |
| Blocker | Không thể release hoặc làm hệ thống không dùng được | Không login được, migration fail, data leak |
| Critical / P0 | Hỏng flow core hoặc dữ liệu sai nghiêm trọng | Approve leave trừ phép sai, user xem dữ liệu ngoài scope |
| High / P1 | Ảnh hưởng lớn nhưng có workaround hạn chế | Dashboard manager sai một widget quan trọng, check-out lỗi với một rule |
| Medium / P2 | Ảnh hưởng vừa, không chặn release nếu có workaround | UI state lỗi nhẹ, filter chưa đúng một case phụ |
| Low / P3 | Lỗi nhỏ/cosmetic | Label, spacing, copy chưa chuẩn |

> **Ánh xạ về thang severity chuẩn S0–S4 ([QA-08 §9](QA-08_Bug_Tracking_Regression_Release_Criteria.md)):** Blocker và Critical/P0 → **S0**; High/P1 → **S1**; Medium/P2 → **S2**; Low/P3 → **S3**. Bảng trên gộp severity + priority để phục vụ release gate; chuẩn ghi nhận bug trong bug tracker là S0–S4 theo QA-08.

### 17.2 Bug threshold trước release

| Severity | Ngưỡng release | Ghi chú |
| --- | --- | --- |
| Blocker | 0 open | Bắt buộc |
| Critical / P0 | 0 open | Bắt buộc |
| High / P1 | 0 open nếu ảnh hưởng P0; nếu không thì phải có risk acceptance | Bắt buộc review |
| Medium / P2 | Có thể còn nếu không ảnh hưởng P0/P1 và có owner/deadline | Conditional |
| Low / P3 | Có thể defer | Không chặn release |

### 17.3 Bug triage checklist

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-BUG-001 | Tất cả bug open đã có severity/priority/module/owner | QA Lead | Có |  |  |
| QA10-BUG-002 | Không còn bug Blocker/Critical open | QA Lead | Có |  |  |
| QA10-BUG-003 | Bug P1 remaining đã có decision fix/defer/risk accept | Product + QA + Tech | Có |  |  |
| QA10-BUG-004 | Bug deferred có target sprint và owner | Product + QA | Có |  |  |
| QA10-BUG-005 | Regression test đã chạy lại sau fix P0/P1 | QA | Có |  |  |
| QA10-BUG-006 | Known issues được đưa vào release note nếu ảnh hưởng user | Product/QA | Có nếu có |  |  |

---

## 18. Release candidate checklist

### 18.1 Trước khi tạo release candidate

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-RC-001 | Code freeze hoặc scope freeze được thông báo | Release Manager | Có |  |  |
| QA10-RC-002 | Release branch được tạo | DevOps/Tech Lead | Có |  |  |
| QA10-RC-003 | Version/tag release candidate được đánh số | DevOps | Có |  |  |
| QA10-RC-004 | Migration đã lock/chốt version | BE/DevOps | Có |  |  |
| QA10-RC-005 | Seed đã lock/chốt version | BE/DevOps | Có |  |  |
| QA10-RC-006 | Feature flags production đã được review | Product/DevOps | Có |  |  |
| QA10-RC-007 | Environment config staging giống production nhất có thể | DevOps | Có |  |  |

### 18.2 Sau khi deploy release candidate lên staging

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-RCSTG-001 | Smoke test staging pass | QA | Có |  |  |
| QA10-RCSTG-002 | Migration/seed staging log không lỗi | BE/DevOps | Có |  |  |
| QA10-RCSTG-003 | E2E P0 suite pass | QA | Có |  |  |
| QA10-RCSTG-004 | API contract suite pass | QA/BE | Có |  |  |
| QA10-RCSTG-005 | Permission/data scope suite pass | QA/BE/FE | Có |  |  |
| QA10-RCSTG-006 | Security smoke pass | Security/QA | Có |  |  |
| QA10-RCSTG-007 | Performance baseline smoke pass | QA/DevOps | Khuyến nghị |  |  |
| QA10-RCSTG-008 | UAT confirmation trên RC nếu cần | Business/Product | Có nếu UAT yêu cầu |  |  |

---

## 19. Production release runbook checklist

### 19.1 Trước deploy production

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-PREPROD-001 | Go/No-Go meeting hoàn tất | Release Manager | Có |  |  |
| QA10-PREPROD-002 | Release checklist QA-10 được sign-off | Release Manager | Có |  |  |
| QA10-PREPROD-003 | Backup database production hoàn tất | DevOps | Có |  |  |
| QA10-PREPROD-004 | Maintenance window hoặc release time được thông báo | Release Manager | Có |  |  |
| QA10-PREPROD-005 | Rollback version xác định | DevOps | Có |  |  |
| QA10-PREPROD-006 | Team trực release online | Release Manager | Có |  |  |
| QA10-PREPROD-007 | Production env variables được kiểm tra lần cuối | DevOps | Có |  |  |
| QA10-PREPROD-008 | Feature flags/module status đúng | Product/DevOps | Có |  |  |

### 19.2 Trong khi deploy production

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-DEPLOY-001 | Deploy backend release artifact | DevOps | Có |  |  |
| QA10-DEPLOY-002 | Chạy migration production theo runbook | DevOps/BE | Có |  |  |
| QA10-DEPLOY-003 | Chạy seed production cần thiết | DevOps/BE | Có |  |  |
| QA10-DEPLOY-004 | Deploy frontend release artifact | DevOps/FE | Có |  |  |
| QA10-DEPLOY-005 | Verify health check | DevOps | Có |  |  |
| QA10-DEPLOY-006 | Verify logs không có lỗi nghiêm trọng | DevOps/BE/FE | Có |  |  |
| QA10-DEPLOY-007 | Verify background jobs/queues nếu có | DevOps/BE | Có nếu có job |  |  |
| QA10-DEPLOY-008 | Không tiếp tục nếu migration/deploy báo lỗi chưa rõ nguyên nhân | Release Manager | Có |  |  |

### 19.3 Sau deploy production

| Mã | Checklist | Owner | Bắt buộc | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| QA10-POSTDEP-001 | Production smoke test pass | QA | Có |  |  |
| QA10-POSTDEP-002 | Login bằng admin/user test hợp lệ | QA/Support | Có |  |  |
| QA10-POSTDEP-003 | Home Portal/App Switcher hiển thị đúng | QA/FE | Có |  |  |
| QA10-POSTDEP-004 | Attendance Today load được | QA | Có |  |  |
| QA10-POSTDEP-005 | Leave balance/request load được | QA | Có |  |  |
| QA10-POSTDEP-006 | My tasks load được | QA | Có |  |  |
| QA10-POSTDEP-007 | Notification unread/dropdown load được | QA | Có |  |  |
| QA10-POSTDEP-008 | Dashboard mặc định load được | QA | Có |  |  |
| QA10-POSTDEP-009 | Audit/log/monitoring nhận dữ liệu | DevOps/BE | Có |  |  |
| QA10-POSTDEP-010 | Release announcement gửi cho stakeholder | Product/Release Manager | Có |  |  |

---

## 20. Production smoke test checklist

| Mã | Smoke test | Actor | Kết quả mong đợi | Trạng thái |
| --- | --- | --- | --- | --- |
| QA10-SMOKE-001 | Mở web app production | Anonymous | App load không lỗi trắng màn hình |  |
| QA10-SMOKE-002 | Login user Employee | Employee | Vào Home Portal |  |
| QA10-SMOKE-003 | Mở Chấm công từ Home Portal | Employee | Vào Attendance Workspace |  |
| QA10-SMOKE-004 | Xem Attendance Today | Employee | Thấy trạng thái và allowed action |  |
| QA10-SMOKE-005 | Mở Nghỉ phép | Employee | Xem balance/request |  |
| QA10-SMOKE-006 | Mở Task của tôi | Employee | Danh sách load đúng |  |
| QA10-SMOKE-007 | Mở Notification dropdown | Employee | Unread/list load đúng |  |
| QA10-SMOKE-008 | Mở Dashboard | Employee/Manager/HR/Admin | Dashboard load theo quyền |  |
| QA10-SMOKE-009 | Login user Manager | Manager | Thấy app/menu theo quyền |  |
| QA10-SMOKE-010 | Manager mở pending approval | Manager | Chỉ thấy dữ liệu team |  |
| QA10-SMOKE-011 | Login user HR | HR | Xem HR workspace theo quyền |  |
| QA10-SMOKE-012 | Direct URL trái quyền | Employee | 403/Forbidden, không lộ dữ liệu |  |
| QA10-SMOKE-013 | Logout | Any user | Clear session và về login |  |
| QA10-SMOKE-014 | Kiểm tra health endpoint | DevOps | Healthy |  |
| QA10-SMOKE-015 | Kiểm tra error logs | DevOps | Không có error critical sau deploy |  |

---

## 21. Rollback decision checklist

Rollback phải được xem xét ngay nếu:

| Mã | Điều kiện rollback | Ngưỡng |
| --- | --- | --- |
| QA10-RB-001 | Login failure diện rộng | > 20% login fail không do sai mật khẩu |
| QA10-RB-002 | 5xx spike sau release | Vượt ngưỡng alert production |
| QA10-RB-003 | Data leak/permission bypass | Bất kỳ case xác nhận nào |
| QA10-RB-004 | Migration làm hỏng dữ liệu production | Bất kỳ case xác nhận nào |
| QA10-RB-005 | Check-in/check-out không dùng được diện rộng | Flow P0 bị hỏng |
| QA10-RB-006 | Leave approval/trừ phép sai dữ liệu production | Flow P0 bị hỏng dữ liệu |
| QA10-RB-007 | Dashboard/notification gây quá tải database/API | Vượt ngưỡng monitoring |
| QA10-RB-008 | File private bị public hoặc truy cập trái quyền | Bất kỳ case xác nhận nào |

Rollback không nên thực hiện nếu lỗi có thể forward-fix nhanh mà không ảnh hưởng dữ liệu, trừ khi Release Manager và Tech Lead đánh giá rủi ro cao.

---

## 22. Hypercare checklist sau release

### 22.1 Khung thời gian hypercare

| Giai đoạn | Thời lượng đề xuất | Mục tiêu |
| --- | --- | --- |
| T+0 đến T+2 giờ | Ngay sau release | Theo dõi lỗi nghiêm trọng, smoke test, rollback window |
| T+2 đến T+24 giờ | Ngày đầu | Theo dõi user thật, bug P0/P1, performance |
| T+1 đến T+3 ngày | Sau release | Fix nhanh bug quan trọng, cập nhật known issues |
| T+1 tuần | Ổn định | Review metrics, tổng kết release, plan patch |

### 22.2 Metric cần theo dõi

| Mã | Metric | Owner | Ghi chú |
| --- | --- | --- | --- |
| QA10-HC-001 | Login success/failure rate | DevOps/BE |  |
| QA10-HC-002 | API 5xx rate | DevOps/BE |  |
| QA10-HC-003 | API latency P95/P99 | DevOps |  |
| QA10-HC-004 | Database slow queries | DevOps/BE |  |
| QA10-HC-005 | Attendance check-in/check-out success | BE/QA |  |
| QA10-HC-006 | Leave submit/approve success | BE/QA |  |
| QA10-HC-007 | Notification creation/read count | BE |  |
| QA10-HC-008 | Dashboard load error/degraded count | BE/FE |  |
| QA10-HC-009 | Frontend error boundary events | FE/DevOps |  |
| QA10-HC-010 | User support tickets by severity | Support/QA |  |

---

## 23. Defer list template

Các hạng mục được defer phải ghi rõ lý do và không được ảnh hưởng đến flow P0.

| Mã defer | Hạng mục | Module | Lý do defer | Ảnh hưởng user | Workaround | Owner | Target sprint | Approved by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QA10-DEF-001 |  |  |  |  |  |  |  |  |
| QA10-DEF-002 |  |  |  |  |  |  |  |  |
| QA10-DEF-003 |  |  |  |  |  |  |  |  |

Không được defer các nhóm sau nếu chưa có risk acceptance chính thức:

1. Authentication/session lỗi.
2. Permission/data scope/data leak.
3. Migration/seed production không an toàn.
4. Trừ/hoàn số dư phép sai.
5. Chấm công sai trạng thái core.
6. File private bị public.
7. Security Critical/High.

---

## 24. Final Go/No-Go meeting agenda

| Thứ tự | Nội dung | Người trình bày | Kết quả cần có |
| --- | --- | --- | --- |
| 1 | Tổng quan release candidate | Release Manager | Version/tag/release window |
| 2 | Scope MVP và defer list | Product Owner | Xác nhận scope |
| 3 | Kết quả QA functional/E2E/API/regression | QA Lead | Pass/fail summary |
| 4 | Bug status và known issues | QA Lead | Xác nhận không còn blocker |
| 5 | UAT/business acceptance | Business Owner | Sign-off hoặc issue |
| 6 | Security readiness | Security Owner | Không còn Critical/High open |
| 7 | Performance readiness | QA/DevOps | Baseline/concern |
| 8 | Database/migration/seed readiness | Backend Lead/DevOps | Migration và rollback plan |
| 9 | Deployment/monitoring readiness | DevOps | Runbook và alert |
| 10 | Support/hypercare readiness | Support/QA | Support plan |
| 11 | Quyết định Go/Conditional Go/No-Go | Release Manager + Approvers | Decision chính thức |

---

## 25. Sign-off matrix

| Vai trò | Người đại diện | Điều kiện sign-off | Quyết định | Ngày ký | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| Product Owner |  | Scope MVP, defer list, release note | Go / Conditional Go / No-Go |  |  |
| Business Owner |  | UAT và business acceptance | Go / Conditional Go / No-Go |  |  |
| QA Lead |  | Test result, bug threshold, regression | Go / Conditional Go / No-Go |  |  |
| Tech Lead |  | Kiến trúc, technical risk, code readiness | Go / Conditional Go / No-Go |  |  |
| Backend Lead |  | API, business logic, database migration | Go / Conditional Go / No-Go |  |  |
| Frontend Lead |  | UI, routing, state, API integration | Go / Conditional Go / No-Go |  |  |
| DevOps Lead |  | Deploy, backup, rollback, monitoring | Go / Conditional Go / No-Go |  |  |
| Security Owner |  | Security testing, risk acceptance | Go / Conditional Go / No-Go |  |  |
| Support/Operation |  | Hypercare, support channel, user guide | Go / Conditional Go / No-Go |  |  |

Final decision:

```text
[ ] Go
[ ] Conditional Go
[ ] No-Go
```

Điều kiện nếu Conditional Go:

| Điều kiện | Owner | Deadline | Cách theo dõi |
| --- | --- | --- | --- |
|  |  |  |  |
|  |  |  |  |

---

## 26. Acceptance criteria QA-10

QA-10 được xem là hoàn thành khi:

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| QA10-AC-001 | Có phạm vi release readiness cho toàn bộ module MVP |
| QA10-AC-002 | Có điều kiện Go / Conditional Go / No-Go rõ ràng |
| QA10-AC-003 | Có checklist Product, Business, Functional QA, API, Frontend, Backend, Database, Security, Performance, DevOps và Support |
| QA10-AC-004 | Có checklist module readiness cho AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH và FOUNDATION |
| QA10-AC-005 | Có bug threshold theo severity trước release |
| QA10-AC-006 | Có release candidate checklist |
| QA10-AC-007 | Có production release runbook checklist |
| QA10-AC-008 | Có production smoke test checklist |
| QA10-AC-009 | Có rollback decision checklist |
| QA10-AC-010 | Có hypercare checklist sau release |
| QA10-AC-011 | Có defer list template và quy tắc không được defer |
| QA10-AC-012 | Có final Go/No-Go meeting agenda |
| QA10-AC-013 | Có sign-off matrix cho các vai trò quyết định release |
| QA10-AC-014 | Tài liệu đủ để dùng làm release gate cuối trước khi phát hành MVP |

---

## 27. Kết luận

QA-10 là cổng kiểm tra cuối cùng trước khi phát hành MVP của hệ thống quản lý doanh nghiệp nội bộ.

Tư duy release chính:

```text
Đúng scope MVP
-> Pass test P0/P1
-> Không còn blocker/security/data leak
-> Migration/seed an toàn
-> Permission/data scope đúng
-> UAT business chấp nhận
-> Deploy/rollback/monitoring sẵn sàng
-> Sign-off đầy đủ
-> Release có hypercare
```

Nếu một hạng mục chưa đạt nhưng không ảnh hưởng flow P0, không gây rủi ro bảo mật/dữ liệu và có workaround rõ, có thể đưa vào **Conditional Go** hoặc **Defer list**.

Nếu hạng mục liên quan đến authentication, permission, data scope, dữ liệu chấm công/nghỉ phép, migration production, file private hoặc security critical/high chưa đạt, phải quyết định **No-Go** cho đến khi xử lý xong hoặc có risk acceptance chính thức từ người có thẩm quyền.

---

## 28. Tài liệu liên quan

QA-10 tổng hợp kết quả từ toàn bộ chuỗi QA. Để tra cứu chi tiết từng hạng mục checklist, xem:

| Mã | Tài liệu | Quan hệ |
| --- | --- | --- |
| [QA-01](QA-01_QA_Strategy_And_Test_Plan.md) | QA Strategy & Test Plan | Tài liệu nền: release criteria tổng quan |
| [QA-02](QA-02_Test_Case_Matrix_theo_module.md) | Test Case Matrix theo module | Coverage functional QA (§8) |
| [QA-03](QA-03_End-to-End_Flow_Testing.md) | End-to-End Flow Testing | E2E flow P0 (§4.3) |
| [QA-04](QA-04_API_Testing_Contract_Testing.md) | API Testing & Contract Testing | API readiness (§9) |
| [QA-05](QA-05_Permission_Role_Data_Scope_Testing.md) | Permission, Role & Data Scope Testing | Permission/data scope readiness |
| [QA-06](QA-06_Security_Testing.md) | Security Testing | Security readiness (§13) |
| [QA-07](QA-07_Performance_Load_Testing.md) | Performance & Load Testing | Performance readiness (§14) |
| [QA-08](QA-08_Bug_Tracking_Regression_Release_Criteria.md) | Bug Tracking, Regression & Release Criteria | **Chuẩn severity (S0–S4)**, bug threshold (§17), release gate |
| [QA-09](QA-09_UAT_Plan_Business_Acceptance.md) | UAT Plan & Business Acceptance | Business acceptance (§7.2) |
| **QA-10 (tài liệu này)** | MVP Release Readiness Checklist | Checklist release gate tổng hợp cuối |
