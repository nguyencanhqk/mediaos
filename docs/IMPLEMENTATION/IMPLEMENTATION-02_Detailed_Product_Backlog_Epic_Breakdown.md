# IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
# Product Backlog chi tiết & Phân rã Epic MVP

> **Quan hệ:** Đây là nguồn chi tiết backlog/Epic/Story (mã `IMP02-EPIC/STORY`). Cấu trúc board và mã epic cấp board (`EPIC-<MODULE>-NN`) xem [ISSUE-BOARD-01](../ISSUE-BOARD/ISSUE-BOARD-01_MVP_Ticket_Board_Setup.md).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-02 |
| Tên tài liệu | Detailed Product Backlog & Epic Breakdown |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04, BACKEND-01 -> BACKEND-14, QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12, DECISIONS-01, COMPLIANCE-01 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này chuyển toàn bộ phạm vi MVP thành **Product Backlog chi tiết** có thể đưa vào Jira/Linear/Trello/GitHub Issues hoặc công cụ quản lý sprint tương đương.

Tài liệu dùng để:

1. Phân rã MVP thành các Epic, Feature, User Story và Technical Story.
2. Gán priority, estimate, dependency và module owner cho từng story.
3. Chuẩn hóa Acceptance Criteria để Product, Backend, Frontend và QA cùng hiểu đúng.
4. Tạo cơ sở lập Sprint Backlog, Dev Task, Test Case và UAT script.
5. Đảm bảo backlog bám sát PRD/SPEC/DB/API/UI/Frontend/QA/DevOps đã được thiết kế trước đó.
6. Giúp kiểm soát scope MVP, tránh trôi phạm vi sang Phase 2+ khi chưa cần thiết.

---

## 3. Nguyên tắc xây dựng backlog

### 3.1 Backlog phải bám module MVP

MVP Version 1.0 chỉ triển khai các module lõi:

| Module | Phạm vi chính | Vai trò backlog |
| --- | --- | --- |
| FOUNDATION | Company, modules, settings, audit, files, sequence, seed | Epic nền dùng chung |
| AUTH | Login, session, RBAC, permission, user, role | Epic bắt buộc đầu tiên |
| HR | Employee, department, position, contract, profile change | Epic dữ liệu nhân sự trung tâm |
| ATT | Check-in/out, attendance records, shift/rule, adjustment, remote | Epic vận hành hằng ngày |
| LEAVE | Balance, request, approval, calendar, policy, sync ATT | Epic lõi liên kết ATT |
| TASK | Project, task, assignee, Kanban, comment, checklist, file | Epic quản lý công việc |
| NOTI | Event, template, notification, unread, deep link | Epic dùng chung toàn hệ thống |
| DASH | Widget tổng hợp theo role/data scope | Epic tổng hợp và điều hướng |

Các module PAYROLL, RECRUIT, ASSET, ROOM, CHAT, SOCIAL, MOBILE, AI chỉ được giữ ở mức thiết kế mở rộng, không đưa vào story triển khai MVP trừ khi phục vụ trực tiếp kiến trúc nền.

### 3.2 Backend là nguồn kiểm soát quyền cuối cùng

Frontend được phép ẩn/hiện app, menu, button, widget và field để cải thiện trải nghiệm, nhưng mọi API nghiệp vụ phải kiểm tra authentication, permission, data scope, target entity và business rule ở backend.

### 3.3 Mỗi story phải có đầu ra kiểm thử được

Một story chỉ được xem là sẵn sàng đưa vào sprint nếu có:

- Người dùng hoặc system actor rõ ràng.
- Mục tiêu nghiệp vụ/kỹ thuật rõ ràng.
- Acceptance Criteria kiểm thử được.
- Dependency được chỉ ra.
- Impact tới API, DB, UI, permission và notification nếu có.

### 3.4 Ưu tiên theo giá trị MVP

| Priority | Ý nghĩa | Quy tắc xử lý |
| --- | --- | --- |
| P0 | Bắt buộc để MVP chạy được | Không release nếu thiếu hoặc fail nghiêm trọng |
| P1 | Quan trọng cho nghiệp vụ đầy đủ | Có thể release có điều kiện nếu có workaround rõ |
| P2 | Nâng cao trải nghiệm hoặc báo cáo | Có thể chuyển sang phase sau nếu thiếu thời gian |
| P3 | Nice-to-have | Không đưa vào MVP trừ khi chi phí rất thấp |

### 3.5 Estimate theo Story Point

| Point | Độ phức tạp tham chiếu |
| --- | --- |
| 1 | Sửa nhỏ, copy UI, validation đơn giản |
| 2 | Task nhỏ, ít dependency |
| 3 | Story nhỏ, 1 API hoặc 1 UI state |
| 5 | Story vừa, có API + UI + test cơ bản |
| 8 | Story lớn, có nhiều state/quyền/dependency |
| 13 | Story rất lớn, cần tách task kỹ thuật nội bộ |

Nếu một story ước lượng lớn hơn 13 point, cần tách thành nhiều story nhỏ hơn trước khi đưa vào sprint.

---

## 4. Quy ước mã backlog

### 4.1 Mã Epic

```text
IMP02-EPIC-XX
```

Ví dụ:

```text
IMP02-EPIC-02: AUTH, Session, RBAC & Permission Guard
```

### 4.2 Mã Story

```text
IMP02-STORY-XXX
```

### 4.3 Mã Task kỹ thuật

```text
IMP02-TASK-XXX
```

### 4.4 Mã Acceptance Criteria

```text
IMP02-STORY-XXX-AC-YY
```

---

## 5. Definition of Ready

Một story đạt **Ready** khi đáp ứng đủ:

| Nhóm | Điều kiện |
| --- | --- |
| Business | Mô tả user story rõ, actor rõ, outcome rõ |
| Scope | Biết rõ thuộc module nào, P0/P1/P2, không lẫn phase sau |
| UI | Có màn hình/template/state hoặc wireframe/handoff tương ứng |
| API | Biết endpoint hoặc service contract liên quan |
| DB | Biết bảng/entity liên quan và migration nếu cần |
| Permission | Có permission/data scope cần kiểm tra |
| Test | Có Acceptance Criteria và QA focus |
| Dependency | Biết story phụ thuộc hoặc blocker |

---

## 6. Definition of Done

Một story đạt **Done** khi:

1. Code đã merge vào nhánh chính theo quy trình review.
2. Migration/seed chạy được từ database trống nếu story có DB change.
3. API có validation, permission guard, data scope và error contract đúng chuẩn.
4. Frontend có loading, empty, error, forbidden, validation và success state nếu có UI.
5. Audit log/notification event được phát nếu nghiệp vụ yêu cầu.
6. Unit/API/component/E2E test phù hợp đã pass.
7. Acceptance Criteria được QA/Product xác nhận.
8. Không còn bug blocker/critical liên quan story.
9. Tài liệu API/OpenAPI hoặc handoff được cập nhật nếu contract thay đổi.

---

## 7. Product backlog tổng quan theo Epic

| Epic ID | Epic | Priority | Tổng story | Tổng point | Phụ thuộc chính |
| --- | --- | --- | ---: | ---: | --- |
| EPIC-00 | Product Backlog Governance | P0 | 4 | 14 | Không |
| EPIC-01 | Foundation & Shared System | P0 | 8 | 49 | DB-08, DB-10, API-01 |
| EPIC-02 | AUTH, Session, RBAC & Permission Guard | P0 | 12 | 87 | Foundation, DB-02, API-02 |
| EPIC-03 | HR - Human Resource Core | P0 | 13 | 100 | AUTH, Foundation, DB-03, API-03 |
| EPIC-04 | ATT - Attendance | P0 | 14 | 111 | AUTH, HR, Foundation, DB-04, API-04 |
| EPIC-05 | LEAVE - Leave Management | P0 | 13 | 117 | AUTH, HR, ATT, DB-05, API-05 |
| EPIC-06 | TASK - Project & Task Management | P0 | 12 | 87 | AUTH, HR, Foundation, DB-06, API-06 |
| EPIC-07 | NOTI - Notification System | P0 | 8 | 57 | AUTH, HR, module events, DB-07, API-07 |
| EPIC-08 | DASH - Role-based Dashboard | P0 | 8 | 61 | AUTH, HR, ATT, LEAVE, TASK, NOTI, DB-07, API-08 |
| EPIC-09 | Frontend Core Implementation | P0 | 5 | 50 | UI-05 -> UI-10, FRONTEND-01 -> 04 |
| EPIC-10 | Cross-module Integration & Security | P0 | 8 | 68 | AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH |
| EPIC-11 | QA, UAT & Release Readiness | P0 | 7 | 68 | Tất cả epic P0/P1 |
| **Tổng** | **12 epic** | — | **112** | **869** | — |

> Bổ sung sau baseline: **EPIC-12 ME** (§8.13, 8 story / 44 point, 2026-07-13) và **4 story HR** thêm vào EPIC-03 (IMP02-STORY-121..124, 36 point — liên kết tài khoản UI · import Excel kéo từ PMVP-HR-006 · sơ đồ tổ chức trực quan kéo một phần PMVP-HR-007 · hoàn thiện Thông tin công việc, 2026-07-13). Tổng sau đợt 2026-07-13: **124 story / 949 point** (EPIC-03 hiệu dụng: 17 story / 136 point).
>
> Bổ sung 2026-08-03 (story hoá ngược wave hậu-MVP để bảng tiến độ `/progress` gom đúng module thay vì dồn vào rổ "WO nền / hạ tầng"): **EPIC-13 GOAL** (§8.14, 8 story / 45 point, SPEC-10) · **EPIC-14 LMS** (§8.15, 6 story / 34 point) · **EPIC-15 BRAND** (§8.16, 2 story / 8 point) · **EPIC-16 CHAT** (§8.17, 12 story / 97 point, SPEC-15 — **wave S7 đang chạy, epic DUY NHẤT chưa 100%**). Tổng hiệu dụng: **152 story / 1133 point**.
>
> Bổ sung 2026-08-28 (wave S11-OFFICE, Phase 3): **EPIC-17 ASSET** (§8.18, 10 story / 53 point, SPEC-13 — IMP02-STORY-153..162, **chưa bắt đầu code**). Tổng hiệu dụng: **162 story / 1186 point**. EPIC-18 ROOM (§8.19) sẽ thêm ở `S11-ROOM-DOC-1`.
>
> Crosswalk epic: bộ epic theo module trong IMPLEMENTATION-01 §9 (EPIC-FND/AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH) ánh xạ sang bộ epic chi tiết ở đây như sau: EPIC-FND -> EPIC-01; EPIC-AUTH -> EPIC-02; EPIC-HR -> EPIC-03; EPIC-ATT -> EPIC-04; EPIC-LEAVE -> EPIC-05; EPIC-TASK -> EPIC-06; EPIC-NOTI -> EPIC-07; EPIC-DASH -> EPIC-08. Ba epic EPIC-00 (Governance), EPIC-09 (Frontend Core), EPIC-10 (Integration) và EPIC-11 (QA/Release) là epic xuyên suốt, không thuộc một module nghiệp vụ đơn lẻ.

---

## 8.1 EPIC-00: Product Backlog Governance

**Mục tiêu:** Chuẩn hóa cách quản trị backlog, issue, sprint và traceability để đội sản phẩm/kỹ thuật/QA làm việc cùng một nguồn sự thật.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-001 | Product Owner | Là một Product Owner, tôi muốn chuẩn hóa backlog MVP theo module, epic, user story, priority và dependency. | P0 | 3 | Backlog có ID chuẩn, priority, estimate, dependency, DoR/DoD và mapping tài liệu nguồn. |
| IMP02-STORY-002 | Tech Lead | Là một Tech Lead, tôi muốn thiết lập quy ước issue, branch, pull request và release note để theo dõi delivery. | P0 | 3 | Có template issue/PR, label, status workflow, owner và rule review. |
| IMP02-STORY-003 | Scrum Master | Là một Scrum Master, tôi muốn tổ chức sprint backlog theo năng lực team và dependency kỹ thuật. | P0 | 5 | Mỗi sprint có mục tiêu, story list, DoD và tiêu chí demo. |
| IMP02-STORY-004 | QA Lead | Là một QA Lead, tôi muốn liên kết backlog với test case và acceptance criteria. | P0 | 3 | Mỗi P0/P1 story có test focus, AC rõ và trace được sang QA. |

### Phạm vi kỹ thuật chính

- Issue/PR template
- Sprint board
- Backlog label/status
- Traceability matrix
- Review workflow

### Ghi chú dependency

Nên hoàn tất trước khi sprint execution bắt đầu.


## 8.2 EPIC-01: Foundation & Shared System

**Mục tiêu:** Xây dựng lớp nền dùng chung: company, module catalog, settings, audit, file, sequence, holiday và seed data.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-005 | System Admin | Là một System Admin, tôi muốn quản lý công ty/tenant mặc định cho MVP. | P0 | 5 | Có company seed, company context, trạng thái active/inactive và guard theo company. |
| IMP02-STORY-006 | Admin | Là một Admin, tôi muốn quản lý module catalog và trạng thái bật/tắt module. | P0 | 5 | Module MVP được seed, có status, route/app mapping và kiểm soát visibility. |
| IMP02-STORY-007 | Admin | Là một Admin, tôi muốn quản lý system settings và company settings cơ bản. | P0 | 8 | Có CRUD cấu hình, validation, audit log và cache/invalidation. |
| IMP02-STORY-008 | Developer | Là một Developer, tôi muốn xây dựng audit log dùng chung cho thao tác quan trọng. | P0 | 8 | Audit ghi actor, action, entity, before/after diff, request id và company_id. |
| IMP02-STORY-009 | Employee/HR | Là một Employee/HR, tôi muốn upload, xem, tải và xóa mềm file nghiệp vụ theo quyền. | P0 | 8 | File private mặc định, có metadata, file_links, permission check và access log. |
| IMP02-STORY-010 | System | Là một System, tôi muốn sinh mã tự động bằng sequence counter dùng chung. | P0 | 5 | Hỗ trợ prefix, padding, scope theo company và transaction an toàn. |
| IMP02-STORY-011 | HR/ATT/LEAVE | Là một HR/ATT/LEAVE, tôi muốn quản lý ngày nghỉ lễ/ngày không làm việc. | P1 | 5 | Có danh sách holiday theo company/năm, dùng được cho ATT/LEAVE calculation. |
| IMP02-STORY-012 | DevOps/Backend | Là một DevOps/Backend, tôi muốn seed dữ liệu nền tảng idempotent. | P0 | 5 | Seed chạy lại không nhân đôi dữ liệu, có seed_batches/seed_items hoặc log tương đương. |

### Phạm vi kỹ thuật chính

- Foundation DB migration
- Setting service
- Audit middleware
- File service
- Sequence service
- Seed service

### Ghi chú dependency

Phải có trước AUTH/HR/ATT/LEAVE/TASK vì cung cấp company, module, setting, audit, file và seed.


## 8.3 EPIC-02: AUTH, Session, RBAC & Permission Guard

**Mục tiêu:** Xác thực, tài khoản, role, permission, data scope và guard backend/frontend.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-013 | User | Là một User, tôi muốn đăng nhập bằng email/mật khẩu và vào Home Portal. | P0 | 8 | Đăng nhập đúng thành công, sai trả lỗi an toàn, token/session được tạo, user context được load. |
| IMP02-STORY-014 | User | Là một User, tôi muốn đăng xuất và kết thúc phiên làm việc. | P0 | 3 | Logout clear token/cache, refresh không vào lại protected route, server session bị revoke nếu có. |
| IMP02-STORY-015 | User | Là một User, tôi muốn quên mật khẩu và đặt lại mật khẩu bằng token. | P1 | 8 | Token có hạn, dùng một lần, không tiết lộ email tồn tại, đổi mật khẩu xong token vô hiệu. |
| IMP02-STORY-016 | User | Là một User, tôi muốn đổi mật khẩu khi đã đăng nhập. | P1 | 5 | Yêu cầu mật khẩu hiện tại đúng, password policy, success toast và audit/security event. |
| IMP02-STORY-017 | User | Là một User, tôi muốn xem hồ sơ tài khoản cá nhân. | P0 | 3 | Hiển thị user, email, role, employee link, trạng thái tài khoản theo quyền. |
| IMP02-STORY-018 | Admin | Là một Admin, tôi muốn quản lý danh sách user có tìm kiếm/lọc/phân trang. | P0 | 8 | Lọc theo keyword/status/role/department, scope company, không lộ field nhạy cảm. |
| IMP02-STORY-019 | Admin/HR | Là một Admin/HR, tôi muốn tạo và cập nhật user, liên kết employee. | P0 | 8 | Email unique, role hợp lệ, employee link đúng company, gửi activation nếu bật. |
| IMP02-STORY-020 | Admin | Là một Admin, tôi muốn khóa/mở khóa tài khoản. | P0 | 5 | Locked user không login được, active lại login được, có lý do và audit. |
| IMP02-STORY-021 | Admin | Là một Admin, tôi muốn quản lý role và gán permission kèm data scope. | P0 | 13 | Role CRUD, permission matrix, scope Own/Team/Department/Company/System, audit diff. |
| IMP02-STORY-022 | Backend | Là một Backend, tôi muốn middleware auth/permission/data scope guard dùng chung. | P0 | 13 | Mọi API protected kiểm tra token, company, permission, scope, business target. |
| IMP02-STORY-023 | Frontend | Là một Frontend, tôi muốn route guard, app/menu/action/field visibility theo permission. | P0 | 8 | Không hard-code role; route trái quyền hiển thị forbidden; action trái quyền bị ẩn/disable. |
| IMP02-STORY-024 | Admin | Là một Admin, tôi muốn xem login log và security event cơ bản. | P1 | 5 | Có log thành công/thất bại, IP/user agent nếu có, lọc và phân trang. |

### Phạm vi kỹ thuật chính

- Auth service
- Session/token
- RBAC service
- Permission middleware
- Frontend route/action guard
- Security logs

### Ghi chú dependency

Phải hoàn tất phần guard P0 trước khi mở API nghiệp vụ cho HR/ATT/LEAVE/TASK.


## 8.4 EPIC-03: HR - Human Resource Core

**Mục tiêu:** Quản lý nhân viên, phòng ban, chức vụ, hợp đồng, file hồ sơ, self-service có duyệt và mã nhân viên tự sinh.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-025 | HR/Manager | Là một HR/Manager, tôi muốn xem danh sách nhân viên theo scope. | P0 | 8 | Có search/filter/sort/pagination, Manager chỉ thấy team, HR thấy company theo quyền. |
| IMP02-STORY-026 | HR/Manager/Employee | Là một HR/Manager/Employee, tôi muốn xem chi tiết hồ sơ nhân viên. | P0 | 8 | Field nhạy cảm mask/hide theo quyền, có tab công việc, hợp đồng, file, history. |
| IMP02-STORY-027 | HR | Là một HR, tôi muốn tạo nhân viên mới với mã nhân viên tự sinh. | P0 | 13 | Sinh employee_code theo config, validate duplicate, tạo employee trong transaction. |
| IMP02-STORY-028 | HR | Là một HR, tôi muốn cập nhật hồ sơ và trạng thái nhân viên. | P0 | 8 | Có validation, soft delete/status history, audit diff và ảnh hưởng module liên quan. |
| IMP02-STORY-029 | HR/Admin | Là một HR/Admin, tôi muốn quản lý phòng ban dạng cây. | P0 | 8 | CRUD department, parent-child hợp lệ, không tạo vòng lặp, scope theo company. |
| IMP02-STORY-030 | HR/Admin | Là một HR/Admin, tôi muốn quản lý chức vụ, cấp bậc và loại hợp đồng. | P1 | 8 | CRUD master data, unique theo company, không xóa cứng nếu đang dùng. |
| IMP02-STORY-031 | HR | Là một HR, tôi muốn quản lý hợp đồng lao động của nhân viên. | P1 | 8 | Tạo/cập nhật/đổi trạng thái hợp đồng, file hợp đồng, cảnh báo hết hạn. |
| IMP02-STORY-032 | Employee | Là một Employee, tôi muốn xem hồ sơ cá nhân của chính mình. | P0 | 5 | Employee chỉ thấy Own profile, field nhạy cảm theo policy, có quick action gửi yêu cầu sửa. |
| IMP02-STORY-033 | Employee | Là một Employee, tôi muốn gửi yêu cầu cập nhật hồ sơ cá nhân có kiểm duyệt. | P0 | 8 | Tạo profile_change_request, lưu field cũ/mới, không áp dụng ngay vào hồ sơ chính. |
| IMP02-STORY-034 | HR/Admin | Là một HR/Admin, tôi muốn duyệt hoặc từ chối yêu cầu cập nhật hồ sơ. | P0 | 8 | Approve mới cập nhật hồ sơ chính, reject giữ nguyên, gửi notification và audit. |
| IMP02-STORY-035 | HR/Admin | Là một HR/Admin, tôi muốn cấu hình quy tắc sinh mã nhân viên và preview mã tiếp theo. | P1 | 8 | Có prefix/padding/reset rule, lock manual edit, preview không tăng counter thật. |
| IMP02-STORY-036 | HR | Là một HR, tôi muốn upload/quản lý file hồ sơ nhân viên. | P1 | 5 | File liên kết employee, quyền xem/tải/xóa theo HR permission, log truy cập. |
| IMP02-STORY-037 | Manager/HR | Là một Manager/HR, tôi muốn xem org chart cơ bản. | P2 | 5 | Hiển thị cây phòng ban/quản lý trực tiếp theo scope, không lộ người ngoài quyền. |
| IMP02-STORY-121 | HR/Admin | Là một HR/Admin, tôi muốn liên kết hoặc hủy liên kết hồ sơ nhân viên với tài khoản đăng nhập có sẵn ngay trên giao diện HR. | P1 | 5 | UI trên trang chi tiết nhân viên gọi HR-API-009/010 (BE đã ship S2-HR-BE-2), chọn user có sẵn cùng company, hủy liên kết có confirm, lỗi HR-ERR-027/028 hiển thị rõ, gate quyền update employee. |
| IMP02-STORY-122 | HR | Là một HR, tôi muốn tạo hồ sơ nhân viên hàng loạt bằng cách upload file Excel/CSV. | P1 | 13 | Có template cột chuẩn, validate từng dòng + preview lỗi (dry-run không ghi), apply sinh mã nhân viên tự sinh qua sequence, báo cáo kết quả từng dòng, permission import riêng, audit phiên import. |
| IMP02-STORY-123 | HR/Manager/Employee | Là một người dùng, tôi muốn xem sơ đồ tổ chức trực quan dạng biểu đồ: cây phòng ban và cây nhân sự theo quản lý trực tiếp. | P1 | 13 | Tab Phòng ban dạng node-chart (trưởng đơn vị + headcount), tab Nhân sự reporting-line theo quản lý trực tiếp chỉ field directory-class (tên, chức danh, phòng ban, avatar), lọc theo data-scope, không lộ PII/salary, orphan/cycle xử lý an toàn. |
| IMP02-STORY-124 | HR/Manager/Employee | Là một người xem hồ sơ, tôi muốn khối Thông tin công việc đầy đủ: cấp bậc, loại hợp đồng chuẩn, quản lý trực tiếp/gián tiếp và thông tin nghỉ việc. | P1 | 5 | DTO đọc bổ sung jobLevelName/contractTypeName/tên quản lý (additive, directory-class), FE thêm dòng tương ứng + khối Thông tin nghỉ việc khi status nghỉ; field ngoài phạm vi MVP (mã chấm công, ngày nghỉ hưu, danh sách đen…) KHÔNG thêm. |

> Bổ sung 2026-07-13 (owner soát Epic HR): IMP02-STORY-121 tách phần UI của HR-FUNC-011 (SPEC-03 §14.11 — BE link/unlink đã ship, chưa có màn hình); IMP02-STORY-122 kéo PMVP-HR-006 (IMPLEMENTATION-10 §11.2) từ Post-MVP vào MVP; IMP02-STORY-123 nâng sơ đồ tổ chức từ list thụt-dòng (S2-FE-HR-6) thành biểu đồ trực quan + cây nhân sự (kéo một phần PMVP-HR-007); IMP02-STORY-124 hoàn thiện khối Thông tin công việc trang chi tiết. Mã story dùng 121-124 vì dải 113-120 đã thuộc EPIC-12 ME.

### Phạm vi kỹ thuật chính

- Employee service
- Department/position service
- Contract service
- Profile change workflow
- Employee code generator
- HR file/audit

### Ghi chú dependency

Là nguồn employee/department/manager cho ATT, LEAVE, TASK, DASH và NOTI.


## 8.5 EPIC-04: ATT - Attendance

**Mục tiêu:** Check-in/out, bảng công, ca/rule, điều chỉnh công, remote/công tác và export.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-038 | Employee | Là một Employee, tôi muốn xem trạng thái chấm công hôm nay. | P0 | 8 | Hiển thị shift/rule, check-in/out state, lý do disable nếu nghỉ phép/remote/config. |
| IMP02-STORY-039 | Employee | Là một Employee, tôi muốn check-in bằng web/mobile web. | P0 | 8 | Server time, chống check-in trùng, chặn nếu nghỉ cả ngày Approved, ghi attendance log. |
| IMP02-STORY-040 | Employee | Là một Employee, tôi muốn check-out bằng web/mobile web. | P0 | 8 | Check-out đúng record, tính work minutes, late/early/missing, ghi log và audit. |
| IMP02-STORY-041 | Employee/Manager/HR | Là một Employee/Manager/HR, tôi muốn xem bảng công theo cá nhân/team/company. | P0 | 13 | Scope Own/Team/Company, lọc theo tháng, trạng thái, phân trang và tổng hợp. |
| IMP02-STORY-042 | Employee | Là một Employee, tôi muốn xem chi tiết ngày công và log chấm công. | P1 | 5 | Hiển thị log raw, adjustment history, leave/remote liên quan và audit note. |
| IMP02-STORY-043 | HR/Admin | Là một HR/Admin, tôi muốn quản lý ca làm việc cố định và linh hoạt. | P0 | 8 | CRUD shifts, validate giờ, break, effective date và inactive nếu đang dùng. |
| IMP02-STORY-044 | HR/Admin | Là một HR/Admin, tôi muốn gán ca theo company/department/employee. | P0 | 8 | Priority employee > department > company, effective date, không conflict. |
| IMP02-STORY-045 | HR/Admin | Là một HR/Admin, tôi muốn cấu hình rule chấm công theo phạm vi. | P0 | 8 | Late/early/missing/required minutes, remote rule, auto attendance rule, audit. |
| IMP02-STORY-046 | Employee | Là một Employee, tôi muốn gửi yêu cầu điều chỉnh công. | P0 | 8 | Chọn ngày, field cần sửa, lý do/file bằng chứng, trạng thái Pending. |
| IMP02-STORY-047 | Manager/HR | Là một Manager/HR, tôi muốn duyệt hoặc từ chối điều chỉnh công. | P0 | 8 | Manager duyệt team, HR company, approve cập nhật record, reject giữ nguyên. |
| IMP02-STORY-048 | HR/Admin | Là một HR/Admin, tôi muốn điều chỉnh công trực tiếp. | P1 | 8 | Chỉ role có quyền, bắt buộc lý do, ghi audit diff và thông báo nếu cần. |
| IMP02-STORY-049 | Employee | Là một Employee, tôi muốn tạo request remote/công tác. | P1 | 8 | Request có ngày, lý do, rule áp dụng, optional file/location/task link. |
| IMP02-STORY-050 | Manager/HR | Là một Manager/HR, tôi muốn duyệt remote/công tác và áp dụng rule remote. | P1 | 8 | Approve cho phép auto attendance hoặc remote check-in theo rule, phát notification. |
| IMP02-STORY-051 | HR | Là một HR, tôi muốn export bảng công theo quyền. | P2 | 5 | Export theo filter, permission export, audit log, không xuất field ngoài quyền. |

### Phạm vi kỹ thuật chính

- Attendance rule engine
- Check-in/out service
- Attendance record calculation
- Shift assignment resolver
- Adjustment/remote workflow
- Export

### Ghi chú dependency

Phụ thuộc HR employee và LEAVE Approved để chặn/tính lại công.


## 8.6 EPIC-05: LEAVE - Leave Management

**Mục tiêu:** Số dư phép, đơn nghỉ, duyệt nghỉ, lịch nghỉ, chính sách, đồng bộ sang chấm công.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-052 | Employee | Là một Employee, tôi muốn xem số dư phép của chính mình. | P0 | 5 | Hiển thị entitled/used/pending/remaining theo leave type/năm. |
| IMP02-STORY-053 | Employee | Là một Employee, tôi muốn preview tính ngày nghỉ trước khi gửi. | P0 | 8 | Tính full day/half day/hourly/multiple days, trừ holiday/weekend/shift rule. |
| IMP02-STORY-054 | Employee | Là một Employee, tôi muốn tạo, lưu nháp và gửi đơn nghỉ. | P0 | 13 | Validate overlap, balance, working day, approval target, file nếu yêu cầu. |
| IMP02-STORY-055 | Employee | Là một Employee, tôi muốn xem danh sách và chi tiết đơn nghỉ của mình. | P0 | 5 | Own scope, trạng thái Draft/Pending/Approved/Rejected/Cancelled/Revoked. |
| IMP02-STORY-056 | Employee | Là một Employee, tôi muốn hủy đơn nghỉ theo rule. | P1 | 5 | Chỉ hủy khi trạng thái và thời điểm cho phép; nếu approved phải sync lại ATT. |
| IMP02-STORY-057 | Manager/HR | Là một Manager/HR, tôi muốn xem danh sách đơn nghỉ chờ duyệt theo scope. | P0 | 8 | Manager team, HR company, lọc status/type/date/employee. |
| IMP02-STORY-058 | Manager/HR | Là một Manager/HR, tôi muốn duyệt hoặc từ chối đơn nghỉ. | P0 | 13 | Approve trừ/hold balance, tạo leave_request_days, sync ATT, gửi notification. |
| IMP02-STORY-059 | HR/Admin | Là một HR/Admin, tôi muốn hủy/thu hồi đơn nghỉ đã duyệt. | P1 | 8 | Hoàn phép nếu cần, sync lại attendance, lưu approval history. |
| IMP02-STORY-060 | User | Là một User, tôi muốn xem lịch nghỉ cá nhân/team/phòng ban/company. | P1 | 8 | Dữ liệu theo scope, hiển thị calendar/list, không lộ lý do nếu thiếu quyền. |
| IMP02-STORY-061 | HR/Admin | Là một HR/Admin, tôi muốn quản lý loại nghỉ phép. | P0 | 5 | CRUD leave types, paid/unpaid, require attachment, active/inactive. |
| IMP02-STORY-062 | HR/Admin | Là một HR/Admin, tôi muốn quản lý chính sách nghỉ phép. | P0 | 13 | Policy theo company/department/employee/job level, accrual rule cơ bản, effective date. |
| IMP02-STORY-063 | HR/Admin | Là một HR/Admin, tôi muốn quản lý số dư phép và giao dịch số dư. | P0 | 13 | Ledger không sửa trực tiếp mất dấu; adjustment bắt buộc lý do/audit. |
| IMP02-STORY-064 | System | Là một System, tôi muốn đồng bộ Leave Approved/Cancelled/Revoked sang Attendance. | P0 | 13 | Idempotent sync, full/half/hour leave cập nhật required minutes và record status. |

### Phạm vi kỹ thuật chính

- Leave calculation service
- Balance ledger
- Approval workflow
- Leave calendar query
- ATT sync service
- Leave policy service

### Ghi chú dependency

Phụ thuộc ATT để đồng bộ trạng thái nghỉ vào bảng công; phụ thuộc HR để resolve manager/department.


## 8.7 EPIC-06: TASK - Project & Task Management

**Mục tiêu:** Dự án, thành viên, task, assignee, Kanban, comment, checklist, file và activity log.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-065 | Manager/Project Owner | Là một Manager/Project Owner, tôi muốn tạo và quản lý dự án. | P0 | 8 | CRUD project, status Active/Closed/Archived, owner, department, audit. |
| IMP02-STORY-066 | Project Owner | Là một Project Owner, tôi muốn quản lý thành viên dự án và vai trò trong dự án. | P0 | 8 | Owner/Manager/Member/Viewer, chỉ employee active, không trùng member. |
| IMP02-STORY-067 | User | Là một User, tôi muốn xem danh sách dự án theo quyền. | P0 | 5 | Project scope theo membership hoặc permission company/team. |
| IMP02-STORY-068 | Manager/User | Là một Manager/User, tôi muốn tạo task cá nhân hoặc task trong dự án. | P0 | 8 | Task có title, assignee, priority, deadline, project optional, validation. |
| IMP02-STORY-069 | User | Là một User, tôi muốn xem task của tôi. | P0 | 8 | Task assigned/created/watched, lọc status/priority/due date, sort overdue first. |
| IMP02-STORY-070 | Manager/Project Member | Là một Manager/Project Member, tôi muốn giao task, đổi assignee và watcher. | P0 | 8 | Chỉ gán người trong scope/project, cảnh báo nếu assignee đang nghỉ phép. |
| IMP02-STORY-071 | Assignee | Là một Assignee, tôi muốn cập nhật trạng thái và priority/deadline task theo quyền. | P0 | 8 | State Todo/In Progress/In Review/Done/Cancelled, ghi activity log. |
| IMP02-STORY-072 | User | Là một User, tôi muốn xem và kéo thả Kanban board. | P1 | 8 | Board theo project/status, drag drop gọi API status, optimistic update có rollback. |
| IMP02-STORY-073 | User | Là một User, tôi muốn comment và mention trong task. | P1 | 8 | Comment CRUD theo quyền, mention tạo notification, không mention người ngoài scope. |
| IMP02-STORY-074 | User | Là một User, tôi muốn quản lý checklist trong task. | P1 | 5 | Tạo checklist/item, tick done, progress, activity log. |
| IMP02-STORY-075 | User | Là một User, tôi muốn upload file cho project/task. | P1 | 5 | Dùng file service, permission theo project/task, log truy cập. |
| IMP02-STORY-076 | Manager | Là một Manager, tôi muốn xem báo cáo tiến độ dự án/task cơ bản. | P2 | 8 | Số task theo status, overdue, assignee workload, export phase sau. |

### Phạm vi kỹ thuật chính

- Project service
- Task service
- Assignment/watcher
- Kanban/status transition
- Comment/mention
- Checklist/file/activity log

### Ghi chú dependency

Phụ thuộc HR employee active và AUTH permission; liên kết LEAVE ở mức cảnh báo trong MVP.


## 8.8 EPIC-07: NOTI - Notification System

**Mục tiêu:** Event, template, notification in-app, unread count, mark read, deep link và config.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-077 | System | Là một System, tôi muốn định nghĩa notification event catalog và template seed. | P0 | 8 | Có event cho AUTH/HR/ATT/LEAVE/TASK/DASH/system, template in-app mặc định. |
| IMP02-STORY-078 | System | Là một System, tôi muốn tạo notification từ event nghiệp vụ. | P0 | 13 | Event payload chuẩn, recipient resolver, dedupe/idempotency, audit/delivery log. |
| IMP02-STORY-079 | User | Là một User, tôi muốn xem notification badge/dropdown. | P0 | 8 | Unread count nhanh, danh sách mới nhất, loading/error/empty state. |
| IMP02-STORY-080 | User | Là một User, tôi muốn xem danh sách và chi tiết thông báo. | P0 | 5 | Pagination, filter read/unread/type, detail không lộ dữ liệu ngoài quyền. |
| IMP02-STORY-081 | User | Là một User, tôi muốn đánh dấu đã đọc hoặc tất cả đã đọc. | P0 | 5 | Mark read cập nhật unread count, idempotent, chỉ notification của chính mình. |
| IMP02-STORY-082 | User | Là một User, tôi muốn điều hướng từ notification sang module gốc. | P0 | 5 | Target link an toàn, module gốc kiểm tra quyền/business rule lại. |
| IMP02-STORY-083 | Admin | Là một Admin, tôi muốn cấu hình bật/tắt event và template thông báo. | P1 | 8 | Admin xem/sửa template, enable/disable event, audit log. |
| IMP02-STORY-084 | Admin | Là một Admin, tôi muốn xem delivery log và retry kênh gửi ngoài. | P2 | 5 | MVP in-app; email/push có thể để phase sau nhưng schema/API sẵn. |

### Phạm vi kỹ thuật chính

- Event catalog
- Template renderer
- Recipient resolver
- Notification service
- Unread count
- Delivery log
- Deep link resolver

### Ghi chú dependency

Phụ thuộc event từ các module nghiệp vụ; nên xây event contract sớm để module khác phát event nhất quán.


## 8.9 EPIC-08: DASH - Role-based Dashboard

**Mục tiêu:** Dashboard theo vai trò, widget, quick action, cache và degraded state.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-085 | User | Là một User, tôi muốn mở dashboard mặc định theo quyền. | P0 | 8 | GET /dashboard/me trả dashboard types, widgets allowed, user context. |
| IMP02-STORY-086 | Employee | Là một Employee, tôi muốn xem Employee Dashboard. | P0 | 8 | Widget chấm công hôm nay, phép còn lại, task của tôi, notification mới. |
| IMP02-STORY-087 | Manager | Là một Manager, tôi muốn xem Manager Dashboard. | P0 | 8 | Widget đơn nghỉ chờ duyệt, điều chỉnh công chờ duyệt, task team quá hạn, lịch nghỉ team. |
| IMP02-STORY-088 | HR | Là một HR, tôi muốn xem HR Dashboard. | P1 | 8 | Widget nhân sự active/new, hợp đồng sắp hết hạn, attendance anomaly, leave pending. |
| IMP02-STORY-089 | Admin | Là một Admin, tôi muốn xem Admin Dashboard. | P1 | 8 | Widget user active, module status, system warning, audit/security summary. |
| IMP02-STORY-090 | User | Là một User, tôi muốn lazy load và refresh từng widget. | P0 | 5 | Widget endpoint độc lập, retry, degraded state nếu module nguồn lỗi. |
| IMP02-STORY-091 | Admin | Là một Admin, tôi muốn cấu hình widget theo role/user/dashboard type. | P1 | 8 | CRUD configs, sort/order/enable/size, permission guard và audit. |
| IMP02-STORY-092 | System | Là một System, tôi muốn cache và invalidate dashboard widget. | P1 | 8 | Cache key theo company/user/scope/widget, TTL, invalidation từ event. |

### Phạm vi kỹ thuật chính

- Dashboard registry
- Widget data service
- Permission/data-scope query
- Widget cache
- Cache invalidation
- Degraded state

### Ghi chú dependency

Phụ thuộc dữ liệu từ HR, ATT, LEAVE, TASK, NOTI; có thể phát triển song song bằng mock data trước.


## 8.10 EPIC-09: Frontend Core Implementation

**Mục tiêu:** Design System, layout, registry, API client, permission UI và responsive P0.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-093 | Frontend | Là một Frontend, tôi muốn triển khai Design System foundation. | P0 | 13 | Token, theme, Button/Form/Table/Modal/Drawer/Toast/State/PermissionGate. |
| IMP02-STORY-094 | Frontend | Là một Frontend, tôi muốn triển khai AuthLayout, HomePortalLayout và ModuleWorkspaceLayout. | P0 | 13 | Topbar, sidebar, app switcher, responsive, dirty form guard. |
| IMP02-STORY-095 | Frontend | Là một Frontend, tôi muốn triển khai API client, query layer và error mapper. | P0 | 8 | Token injection, 401/403/422/500 handling, request id, idempotency key, query invalidation. |
| IMP02-STORY-096 | Frontend | Là một Frontend, tôi muốn triển khai app registry, route registry, sidebar registry. | P0 | 8 | Menu/app không hard-code theo role, metadata có permission/scope/module/status. |
| IMP02-STORY-097 | Frontend | Là một Frontend, tôi muốn chuẩn hóa responsive mobile web cho P0 flows. | P1 | 8 | Login, Home, ATT today, create leave, my task, notification dropdown/list. |

### Phạm vi kỹ thuật chính

- Design System
- Layouts
- Registry
- API client
- Query layer
- Responsive
- State components

### Ghi chú dependency

Có thể chạy song song với backend nếu API contract/mock đã ổn định.


## 8.11 EPIC-10: Cross-module Integration & Security

**Mục tiêu:** Luồng tích hợp giữa module, OpenAPI contract, data scope, field permission và audit/export security.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-098 | System | Là một System, tôi muốn tích hợp HR tạo employee với AUTH tạo user. | P0 | 8 | Transaction hoặc compensation, role Employee mặc định, activation notification. |
| IMP02-STORY-099 | System | Là một System, tôi muốn tích hợp HR direct manager với approval scope. | P0 | 5 | Manager duyệt đúng team cho leave/attendance adjustment. |
| IMP02-STORY-100 | System | Là một System, tôi muốn tích hợp LEAVE với ATT để chặn/tính lại công. | P0 | 13 | Approved leave ảnh hưởng check-in/out, attendance status và required minutes. |
| IMP02-STORY-101 | System | Là một System, tôi muốn tích hợp TASK với LEAVE để cảnh báo khi giao việc. | P1 | 5 | Cảnh báo assignee nghỉ phép/deadline trùng kỳ nghỉ, chưa chặn cứng trong MVP. |
| IMP02-STORY-102 | System | Là một System, tôi muốn tích hợp module nghiệp vụ với NOTI event. | P0 | 13 | AUTH/HR/ATT/LEAVE/TASK phát event chuẩn, NOTI tạo đúng recipient. |
| IMP02-STORY-103 | System | Là một System, tôi muốn tích hợp module nguồn với DASH cache. | P1 | 8 | Event invalidation cho leave pending, attendance today, task status, notification unread. |
| IMP02-STORY-104 | Security | Là một Security, tôi muốn kiểm tra field-level permission và export permission. | P0 | 8 | Không lộ dữ liệu nhạy cảm qua API/list/export/log. |
| IMP02-STORY-105 | Backend | Là một Backend, tôi muốn chuẩn hóa OpenAPI/Swagger contract theo module. | P0 | 8 | Contract đủ endpoint, request/response/error, auth, permission note. |

### Phạm vi kỹ thuật chính

- Module event contract
- Cross-module service contract
- OpenAPI
- Field-level permission
- Audit/export/file security

### Ghi chú dependency

Nên được kiểm tra liên tục từ giữa dự án, không để dồn cuối sprint release.


## 8.12 EPIC-11: QA, UAT & Release Readiness

**Mục tiêu:** Test case, API/E2E/security/performance, UAT và checklist release MVP.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-106 | QA | Là một QA, tôi muốn viết test case matrix theo module và role. | P0 | 13 | Test case P0/P1 cho AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI/Foundation. |
| IMP02-STORY-107 | QA/Backend | Là một QA/Backend, tôi muốn API contract test và permission/scope test. | P0 | 13 | Test 401/403/404/422, Own/Team/Company/System, target ngoài scope. |
| IMP02-STORY-108 | QA/Frontend | Là một QA/Frontend, tôi muốn E2E test flow P0. | P0 | 13 | Login, check-in/out, create leave, approve leave, task update, notification deep link. |
| IMP02-STORY-109 | QA/Security | Là một QA/Security, tôi muốn security testing cơ bản. | P0 | 8 | Auth/session, IDOR, file access, export, sensitive fields, rate limit auth endpoints. |
| IMP02-STORY-110 | QA/DevOps | Là một QA/DevOps, tôi muốn performance smoke/load test MVP. | P1 | 8 | Danh sách nhân viên/bảng công/task/notification/dashboard đạt SLA MVP. |
| IMP02-STORY-111 | Business/QA | Là một Business/QA, tôi muốn UAT và business acceptance. | P0 | 8 | UAT script theo role, sign-off từng module, bug triage và release decision. |
| IMP02-STORY-112 | Release Manager | Là một Release Manager, tôi muốn MVP release readiness checklist. | P0 | 5 | Checklist migration, seed, env, monitoring, backup, rollback, known issues. |

### Phạm vi kỹ thuật chính

- Test case matrix
- API tests
- E2E tests
- Security/performance tests
- UAT
- Release checklist

### Ghi chú dependency

QA cần bắt đầu viết test case ngay khi story P0 có AC, không chờ dev xong toàn bộ.

---

## 8.13 EPIC-12: ME - Personal Hub (Trung tâm cá nhân)

> **Bổ sung 2026-07-13** theo SPEC-09 ME (wave S5-ME, PR #190) — NGOÀI baseline 112 story / 869 point ban đầu. Tổng sau bổ sung: **120 story / 913 point**.

**Mục tiêu:** Trung tâm cá nhân `/me` — cổng self-service hợp nhất: tổng quan cá nhân, hồ sơ & yêu cầu cập nhật, tài khoản & bảo mật, công việc của tôi (ATT/LEAVE/TASK), thông báo và cài đặt cá nhân. ME **không sao chép dữ liệu** — chỉ tổng hợp own-scope từ module nguồn (SPEC-09 §3).

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-113 | Employee | Là một Employee, tôi muốn mở Trung tâm cá nhân /me với tổng quan chấm công hôm nay, phép còn lại, task đang làm, thông báo mới và hành động nhanh. | P0 | 8 | Aggregation own-scope resolve từ token, fail-soft từng section, quick action deep-link module gốc (ME-FUNC-001/017, ME-SCREEN-001). |
| IMP02-STORY-114 | Employee | Là một Employee, tôi muốn xem hồ sơ cá nhân & công việc và gửi/theo dõi yêu cầu cập nhật hồ sơ ngay trong /me. | P0 | 5 | Read-only + change-request workflow TÁI DÙNG HR PCR, own scope (ME-FUNC-002/003/004, ME-SCREEN-002/003/004). |
| IMP02-STORY-115 | User | Là một User, tôi muốn quản lý tài khoản & bảo mật trong /me: thông tin tài khoản, đổi mật khẩu, phiên đăng nhập, 2FA. | P0 | 5 | TÁI DÙNG account/sessions/2FA sẵn có dưới route /me/* (ME-FUNC-005/006/007/008, ME-SCREEN-005/006/007). |
| IMP02-STORY-116 | User | Là một User, tôi muốn xem hoạt động bảo mật gần đây của chính tôi. | P1 | 5 | login_logs + user_security_events CỦA CHÍNH user, mask IP, không lộ trường nhạy cảm (ME-FUNC-016, ME-SCREEN-008). |
| IMP02-STORY-117 | Employee | Là một Employee, tôi muốn xem nhanh chấm công/nghỉ phép/công việc của tôi kèm deep-link về module gốc. | P1 | 5 | Summary own-scope ATT/LEAVE/TASK, deep-link đúng màn nguồn (ME-FUNC-009/010/011/017, ME-SCREEN-009/010/011). |
| IMP02-STORY-118 | User | Là một User, tôi muốn xem thông báo của tôi và cấu hình tùy chọn nhận thông báo trong /me. | P1 | 3 | FE trên NOTI API sẵn có (GET/PUT /notifications/preferences) (ME-FUNC-012/013, ME-SCREEN-012/013). |
| IMP02-STORY-119 | User | Là một User, tôi muốn cài đặt giao diện cá nhân lưu server-side và quản lý avatar. | P1 | 8 | user_preferences RLS+FORCE unique(company_id,user_id), upsert own, theme sync server↔localStorage, avatar qua foundation files (ME-FUNC-014/015, ME-SCREEN-014). |
| IMP02-STORY-120 | QA/Security | Là một QA/Security, tôi muốn kiểm IDOR/cross-user/cross-tenant toàn bộ endpoint /me/*. | P1 | 5 | IDOR sweep mọi endpoint /me/*, aggregation degraded, preference policy, coverage ≥80% apps/api/src/me (SPEC-09 §20). |

### Phạm vi kỹ thuật chính

- MeModule aggregation (compose service own-scope, fail-soft)
- Bảng `user_preferences` + seed module ME + cặp permission user-preference (Own mọi role)
- FE registry + shell /me/* (card "Cá nhân")
- TÁI DÙNG: HR PCR, /auth/sessions, 2FA, NOTI preferences

### Ghi chú dependency

ME phụ thuộc module nguồn đã xong (AUTH/HR/ATT/LEAVE/TASK/NOTI — Sprint 2-4). Docs-sync SPEC-09 (S5-ME-DOC-1) chạy trước/song song, không gắn story người dùng.

---

## 8.14 EPIC-13: GOAL - Mục tiêu & Kết quả then chốt

> **Bổ sung 2026-08-03** theo SPEC-10 GOAL (wave S5-GOAL). Wave đã ship; story hoá ngược từ Work Order để bảng tiến độ gom đúng module thay vì dồn vào rổ "WO nền / hạ tầng".

**Mục tiêu:** Quản trị mục tiêu 3 cấp (công ty → phòng ban → cá nhân) theo kỳ, đo tiến độ 4 mode kèm rollup lên cha, check-in append-only, gắn công việc vào mục tiêu và phân rã mục tiêu thành task từ template. GOAL **không thay TASK** — chỉ neo công việc vào kết quả (SPEC-10 §3).

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-125 | Manager/Admin | Là một Manager/Admin, tôi muốn tạo và quản lý mục tiêu 3 cấp theo kỳ, xem dưới dạng cây hoặc danh sách lọc theo kỳ, cấp và phòng ban. | P0 | 8 | CRUD soft-delete, validate level↔neo↔parent, cây tối đa 3 tầng kèm % từng nút, data-scope own/department/all ở service layer, goal_code cấp qua sequence (GOAL-FUNC-001/002, GOAL-SCREEN-001/003). |
| IMP02-STORY-126 | Owner mục tiêu | Là một Owner mục tiêu, tôi muốn check-in tiến độ định kỳ với giá trị hiện tại, mức tự tin và ghi chú, rồi xem lại toàn bộ lịch sử. | P0 | 5 | Ghi goal_updates append-only (app role không UPDATE/DELETE), lịch sử hiển thị cũ→mới ở tab Lịch sử check-in (GOAL-FUNC-003, GOAL-SCREEN-002). |
| IMP02-STORY-127 | Manager | Là một Manager, tôi muốn tiến độ được tính tự động theo mode đo và tự dồn lên mục tiêu cha. | P0 | 8 | 4 mode đo, rollup theo weight lên cha, job đối soát đêm qua system-jobs, cache progress trên bản ghi goal (GOAL-FUNC-004). |
| IMP02-STORY-128 | Manager/Admin | Là một Manager/Admin, tôi muốn chốt kỳ mục tiêu và mở lại khi cần, có kiểm soát quyền và dấu vết. | P1 | 3 | Cặp quyền finalize riêng, finalized_at/by, audit log bắt buộc cho cả finalize lẫn reopen (GOAL-FUNC-005). |
| IMP02-STORY-129 | Employee/Manager | Là một Employee/Manager, tôi muốn gắn hoặc tháo công việc vào mục tiêu từ panel task hoặc từ trang mục tiêu. | P1 | 5 | tasks.goal_id, picker từ panel task và gắn hàng loạt từ trang goal, tôn trọng quyền cả hai phía (GOAL-FUNC-006). |
| IMP02-STORY-130 | Manager/Admin | Là một Manager/Admin, tôi muốn phân rã mục tiêu thành bộ công việc từ template dựng sẵn và quản lý danh mục template. | P1 | 8 | CRUD task_templates và items với quyền manage riêng, wizard preview cho sửa/xóa/thêm/gán người/cột board, bulk task trong MỘT transaction mang sẵn goal_id (GOAL-FUNC-007/008, GOAL-SCREEN-004/006). |
| IMP02-STORY-131 | Manager/Admin | Là một Manager/Admin, tôi muốn widget "Mục tiêu kỳ này" trên dashboard để nắm tiến độ theo phòng ban. | P2 | 5 | Widget đọc qua cache dashboard, tiến độ theo phòng ban, tôn trọng data-scope của người xem. |
| IMP02-STORY-132 | Thành viên dự án | Là một thành viên dự án, tôi muốn tab Mục tiêu ngay trong trang dự án để thấy mục tiêu của dự án và mục tiêu mà công việc trong dự án đang phục vụ. | P2 | 3 | Tab Mục tiêu trong workspace dự án, gộp mục tiêu neo dự án và mục tiêu phủ từ task, deep-link về trang goal. |

### Phạm vi kỹ thuật chính

- Bảng `goals` + `goal_updates` (append-only) + `tasks.goal_id` + `task_templates`/`task_template_items`, RLS FORCE cả bộ
- Seed module GOAL + 8 cặp permission (7 cặp wave lõi + manage task-template), scope per-(permission,role)
- UNION-ADD `'goal'` vào audit `object_type` CHECK + 2 event NOTI
- Progress engine 4 mode + rollup + job đối soát qua system-jobs

### Ghi chú dependency

GOAL phụ thuộc TASK (gắn task, template sinh task) và Foundation sequence (goal_code). Docs-sync SPEC-10 (S5-GOAL-DOC-1) chạy trước, không gắn story người dùng.

---

## 8.15 EPIC-14: LMS - Đào tạo nội bộ (tích hợp)

> **Bổ sung 2026-08-03** — wave S5-LMS. LMS là ứng dụng RIÊNG (repo git local trong `apps/lms`); MediaOS đóng vai nhà cung cấp danh tính + cổng hiển thị. Story ở đây chỉ mô tả phần người dùng MediaOS nhìn thấy.

**Mục tiêu:** Người dùng MediaOS vào thẳng hệ đào tạo bằng một phiên duy nhất (SSO-only), tài khoản LMS bám theo trạng thái nhân sự, tiến độ học hiện trong `/me`, và sự kiện học tập chảy về NOTI.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-133 | User | Là một User đã đăng nhập MediaOS, tôi muốn vào LMS mà không phải đăng nhập lần hai, và LMS không còn đường tự đăng ký. | P0 | 8 | Cờ SSO_ONLY đóng register/forgot/reset, MỌI điểm tạo phiên đều gate đủ, link SSO dùng-một-lần, ghi audit_logs objectType lms_sso action sso_link_minted tại nơi thực sự cấp link. |
| IMP02-STORY-134 | HR/Admin | Là một HR/Admin, tôi muốn tài khoản LMS tự bám theo trạng thái nhân sự MediaOS mà không phải thao tác tay. | P0 | 5 | Outbox event riêng hr.employee_status_changed đẩy sang LMS, job đối soát CHỈ ghi audit khi có thay đổi thật (không ghi nhiễu mỗi nhịp). |
| IMP02-STORY-135 | Employee | Là một Employee, tôi muốn xem tiến độ đào tạo của mình ngay trong Trung tâm cá nhân /me. | P1 | 5 | LMS phơi GET /api/mediaos/progress với bearer token máy, MediaOS proxy GET /me/training resolve email TỪ TOKEN (không nhận từ client), card Đào tạo fail-soft như các section khác của /me. |
| IMP02-STORY-136 | Employee | Là một Employee, tôi muốn nhận thông báo MediaOS khi có sự kiện học tập như ghi danh được duyệt hay khoá học mới. | P1 | 5 | Route máy lms-events có guard riêng, dedupeKey bắt buộc, seed nhóm eventCode LMS trong catalog NOTI, render đúng target_url. |
| IMP02-STORY-137 | User | Là một User, tôi muốn giao diện LMS trông và dùng giống MediaOS để không phải học lại. | P1 | 8 | Port token màu :root/.dark từ packages/ui, đồng bộ component lõi (button/badge/card/table/input), shell topbar full-width, App Switcher thành launcher toàn hệ. |
| IMP02-STORY-138 | User | Là một User, tôi muốn mở LMS trực tiếp từ MediaOS qua tile Đào tạo và nút Mở LMS. | P2 | 3 | Tile Đào tạo trong App Switcher và nút mở thẳng, vào là đã có phiên (không rơi về màn đăng nhập LMS). |

### Phạm vi kỹ thuật chính

- SSO bridge dùng-một-lần + `SSO_ONLY` ở `apps/lms` (repo git RIÊNG — commit vào repo local đó)
- Outbox event riêng cho đồng bộ tài khoản + job đối soát im-lặng-khi-không-đổi
- Proxy `GET /me/training` (email TỪ token) + card Đào tạo trong `/me`
- Kênh máy `lms-events` → NOTI với dedupeKey bắt buộc

### Ghi chú dependency

LMS phụ thuộc AUTH (phiên + token máy), HR (trạng thái nhân sự), NOTI (catalog event) và ME (nơi hiển thị tiến độ).

---

## 8.16 EPIC-15: BRAND - Thương hiệu công ty

> **Bổ sung 2026-08-03** — wave S5-BRAND. Các Work Order của wave này trước đây gắn nhầm mã module `SYSTEM` (không có trong ISSUE-BOARD-01 §8.2) nên rơi khỏi mọi thẻ module.

**Mục tiêu:** Công ty tự đặt logo và favicon, và thương hiệu đó áp ra toàn bộ vỏ ứng dụng.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-139 | Admin | Là một Admin, tôi muốn tải lên, xem trước và gỡ logo cùng favicon của công ty trong /system/company. | P1 | 5 | Wrapper presign logo và favicon trên FileService theo pattern own-scope (gate ở controller), khối Thương hiệu trong /system/company, gỡ thì trả về mặc định. |
| IMP02-STORY-140 | User | Là một User, tôi muốn thấy logo công ty trên thanh điều hướng và favicon đúng trên tab trình duyệt. | P1 | 3 | GlobalTopbar hiện logo công ty với fallback wordmark khi chưa đặt, favicon áp lúc chạy. |

### Phạm vi kỹ thuật chính

- Presign wrapper logo + favicon trên FileService (gate đặt ở controller)
- Khối Thương hiệu trong `/system/company` + áp ra GlobalTopbar và favicon runtime

### Ghi chú dependency

BRAND phụ thuộc Foundation Files (presign) và Foundation company/settings.

---

## 8.17 EPIC-16: CHAT - Nhắn tin nội bộ

> **Bổ sung 2026-08-03** theo SPEC-15 CHAT (wave S7 — **ĐANG CHẠY**). Đây là epic DUY NHẤT chưa hoàn thành: các story dưới đây phản ánh trạng thái thật của wave, không phải 100%.

**Mục tiêu:** Nhắn tin nội bộ: phòng 1-1, phòng nhóm, phòng phòng-ban và phòng dự án tự động; gửi/đọc theo con trỏ seq; đính kèm qua Foundation Files; tìm kiếm toàn văn tiếng Việt; realtime qua Socket.IO + Valkey; và đường đọc-vượt membership có kiểm soát cho quản trị (CHAT-DEC-004).

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-141 | Employee | Là một Employee, tôi muốn mở hội thoại 1-1 với đồng nghiệp và tạo, quản trị phòng nhóm. | P0 | 8 | Phòng 1-1 idempotent theo direct_key (2 userId sắp xếp tăng dần), quản trị phòng nhóm gồm đổi tên, thêm bớt thành viên, phong admin, rời, lưu trữ; ChatAccessService là điểm khẳng định membership DUY NHẤT, fail-closed trả 404 không tiết lộ phòng có tồn tại (CHAT-FUNC-001/002, CHAT-SCREEN-003). |
| IMP02-STORY-142 | Employee | Là một Employee, tôi muốn phòng chat của phòng ban và dự án tự có sẵn, thành viên tự đồng bộ khi nhân sự hoặc dự án đổi. | P0 | 8 | Tạo và đóng phòng theo org_units cùng projects, thành viên dẫn xuất từ nhân sự đang làm việc và project_members, đồng bộ tại sự kiện cộng job đối soát idempotent (CHAT-FUNC-003/004/005). |
| IMP02-STORY-143 | Employee | Là một Employee, tôi muốn gửi tin nhắn không bị trùng và đọc lịch sử mượt theo con trỏ. | P0 | 13 | Phân trang theo con trỏ seq trước và sau, CẤM offset; chống trùng theo client_message_id; room_seq đánh số PER-PHÒNG (CHAT-FUNC-006/008). |
| IMP02-STORY-144 | Employee | Là một Employee, tôi muốn đính kèm tệp và ảnh vào tin nhắn. | P0 | 5 | Presign upload rồi link vào tin qua file_links; ChatMessageFileResolver BẮT BUỘC đi qua Foundation Files, không dựng đường tệp riêng (CHAT-FUNC-007). |
| IMP02-STORY-145 | Employee | Là một Employee, tôi muốn số tin chưa đọc chính xác và tự giảm khi tôi đã đọc. | P0 | 5 | last_read_seq CHỈ TIẾN không lùi, đếm chưa đọc theo room_seq per-phòng, badge tổng trên header đồng bộ realtime (CHAT-FUNC-009, CHAT-SCREEN-006). |
| IMP02-STORY-146 | Employee | Là một Employee, tôi muốn ghim tin quan trọng và thu hồi tin gửi nhầm. | P1 | 3 | Tối đa 20 tin ghim mỗi phòng; người gửi thu hồi trong cửa sổ N phút, admin phòng nhóm thu hồi bất kỳ lúc nào (CHAT-FUNC-010/011). |
| IMP02-STORY-147 | Employee | Là một Employee, tôi muốn tìm tin nhắn cũ bằng tiếng Việt có dấu hoặc không dấu và nhảy tới tin trong ngữ cảnh. | P1 | 8 | Tìm toàn văn tiếng Việt cả có dấu lẫn không dấu, LUÔN giới hạn trong phòng người tìm là thành viên, kết quả nhảy tới tin kèm ngữ cảnh, kèm tab tệp, tin ghim và thành viên (CHAT-FUNC-012, CHAT-SCREEN-005). |
| IMP02-STORY-148 | Employee | Là một Employee, tôi muốn tin nhắn tới ngay lập tức mà không cần tải lại trang. | P0 | 13 | Gắn ValkeyIoAdapter vào vòng đời app (hiện đã định nghĩa nhưng không nơi nào dùng), join phòng SERVER-SIDE lúc handshake không nhận danh sách phòng từ client, đồng bộ join-leave khi membership đổi (CHAT-FUNC-013). |
| IMP02-STORY-149 | Employee | Là một Employee, tôi muốn được báo khi bị nhắc tên, nhận DM gộp lô khi vắng mặt, và tắt thông báo phòng ồn. | P1 | 5 | Mention gửi ngay, DM gộp lô 15 phút khi người nhận vắng mặt, muted_until không sinh notification nhưng VẪN tăng badge, đi qua OutboxNotificationBridge chung (CHAT-FUNC-014/015). |
| IMP02-STORY-150 | Employee | Là một Employee, tôi muốn trang chat full-screen và panel chat nổi dùng được ở mọi màn hình. | P0 | 13 | Trang /chat ba cột, panel nổi tối đa 3 hội thoại, dùng CHUNG store Zustand và MỘT kết nối WS duy nhất, bảng thông tin phòng có thành viên, tệp và tin ghim (CHAT-SCREEN-001/002/004). |
| IMP02-STORY-151 | Super Admin | Là một Super Admin, tôi muốn tra cứu nội dung phòng bất kỳ khi có yêu cầu điều tra, và mọi lần tra đều để lại dấu vết. | P1 | 8 | Controller và service RIÊNG cho /chat/oversight tách hẳn đường thường, cặp quyền view chat-oversight, mỗi lần đọc-vượt ghi nhật ký ai đọc phòng nào lúc nào, có màn tra cứu và màn nhật ký riêng (CHAT-DEC-004, CHAT-SCREEN-007/008). |
| IMP02-STORY-152 | QA/Security | Là một QA/Security, tôi muốn bộ test trọn vẹn cho CHAT trước khi mở cho người dùng. | P1 | 8 | 12 nhóm scenario SPEC-15 §21 chạy trên LANE_DB, E2E luồng tới hạn, deny-path membership và cross-tenant thực thi thật chứ không bị skip. |

### Phạm vi kỹ thuật chính

- 3 bảng chat đã có được ALTER thêm cột v1, backfill TRƯỚC khi thêm CHECK, GRANT theo cột
- `room_seq` PER-PHÒNG (migration 0539 sửa công thức đếm chưa đọc sai của bản đầu)
- `ChatAccessService` = điểm khẳng định membership duy nhất, fail-closed
- Realtime: ValkeyIoAdapter gắn vào vòng đời app, room `co:{companyId}:…`
- Đường đọc-vượt tách hẳn controller/service, có nhật ký riêng

### Ghi chú dependency

CHAT phụ thuộc AUTH (danh tính + quyền), HR/org_units (phòng ban), TASK/projects (dự án), Foundation Files (đính kèm) và NOTI (mention/DM). **Cảnh báo hạ tầng:** Valkey đang dùng chung cho cả 4 môi trường và KHÔNG có tiền tố kênh — gắn adapter mà không tách kênh sẽ nối test vào cụm Socket.IO của PROD.

---

## 8.18 EPIC-17: ASSET - Quản lý tài sản

> **Bổ sung 2026-08-28** theo SPEC-13 ASSET (wave S11-OFFICE, Phase 3 — owner duyệt 28/08/2026, **chưa bắt đầu code**). Story AS-01..10 của `docs/plans/S11-OFFICE-WAVE.md` §4 ánh xạ 1-1 sang IMP02-STORY-153..162. Trace: `S11-ASSET-DB-1 → BE-1 → FE-1 → QA-1` + `S11-OFFICE-DASH-1`.

**Mục tiêu:** Một nguồn sự thật về tài sản công ty — cái gì · ai giữ · tình trạng: danh mục loại, hồ sơ có mã + QR, cấp phát/thu hồi một bước có biên bản, bảo trì, kiểm kê theo đợt, thanh lý/mất là trạng thái (không workflow phê duyệt), «tài sản của tôi», sự kiện NOTI và widget DASH.

| Story ID | Actor | User Story / Technical Story | Priority | Point | Acceptance Criteria tóm tắt |
| --- | --- | --- | --- | ---: | --- |
| IMP02-STORY-153 | Asset Manager | Là Asset Manager, tôi muốn quản lý danh mục loại tài sản với prefix mã riêng để mã tài sản tự sinh theo loại. | P0 | 3 | CRUD loại (`code`, `name`, `code_prefix` 2–6 ký tự); tạo loại ⇒ tạo `sequence_counters` CÙNG transaction; `code_prefix` khoá sau mã đầu tiên; xoá loại còn tài sản bị chặn (ASSET-ERR-010, ASSET-FUNC-001, ASSET-SCREEN-007). |
| IMP02-STORY-154 | Asset Manager | Là Asset Manager, tôi muốn tạo/sửa hồ sơ tài sản với mã tự sinh và QR để dán nhãn và tra cứu. | P0 | 8 | Mã `TS-<PREFIX>-<seq>` sinh qua `SequenceService`, bất biến; serial unique theo company; PATCH không nhận `assetCode`/`status`; QR render từ mã ở FE, không endpoint QR; xoá mềm chỉ khi `In Stock` + 0 lịch sử (ASSET-FUNC-002/003, ASSET-SCREEN-001/002/003). |
| IMP02-STORY-155 | Asset Manager | Là Asset Manager, tôi muốn cấp phát tài sản cho nhân viên trong một bước và in biên bản. | P0 | 8 | `In Stock → Assigned`; lượt `Active` + partial unique 1 lượt/tài sản (race 2 request ⇒ 1 lượt, 409 không 500); chỉ nhân viên `active` cùng company (404/422); `Idempotency-Key` suy từ payload; audit + `ASSET_ASSIGNED`; biên bản render FE (ASSET-DEC-002, ASSET-FUNC-004, ASSET-SCREEN-004). |
| IMP02-STORY-156 | Asset Manager | Là Asset Manager, tôi muốn thu hồi tài sản và ghi tình trạng khi thu. | P0 | 5 | `returnCondition` ∈ `Good`/`Damaged`/`Lost` (CHECK DB mirror Zod); `Good`/`Damaged` ⇒ `In Stock`, `Lost` ⇒ tài sản `Lost`; lượt → `Returned` qua UPDATE cấp cột; audit + `ASSET_REVOKED` (ASSET-FUNC-005). |
| IMP02-STORY-157 | Asset Manager | Là Asset Manager, tôi muốn mở/đóng lượt bảo trì và biết hạn bảo trì kế tiếp. | P1 | 5 | Mở từ `In Stock` hoặc `Assigned` (lượt cấp phát vẫn Active); 1 lượt `Open`/tài sản; đóng ⇒ trạng thái **dẫn xuất** (`Assigned` nếu còn lượt Active, ngược lại `In Stock`), ghi `next_maintenance_due` (ASSET-FUNC-006/007). |
| IMP02-STORY-158 | Asset Manager | Là Asset Manager, tôi muốn mở đợt kiểm kê, đánh dấu từng tài sản Thấy/Không thấy và đóng đợt có tổng kết. | P1 | 8 | Mở đợt = snapshot dòng (trừ `Disposed`/`Lost`), 1 đợt `Open`/company; đánh dấu 1/nhiều dòng chỉ khi `Open`; đóng ghi 4 số tổng kết một lần; **không** tự chuyển `Missing → Lost` (ASSET-FUNC-008/009/010, ASSET-SCREEN-005). |
| IMP02-STORY-159 | Asset Manager | Là Asset Manager, tôi muốn thanh lý, ghi nhận mất hoặc tìm thấy lại tài sản với lý do bắt buộc. | P1 | 3 | FSM §13.1 ép ở một hàm `assertTransition`; `Disposed` khi còn lượt Active ⇒ 409 ASSET-ERR-008; `Lost` tự đóng lượt Active/bảo trì Open cùng transaction; `Lost → In Stock` cần lý do; audit mọi bước (ASSET-DEC-001, ASSET-FUNC-011/012). |
| IMP02-STORY-160 | Employee | Là một Employee, tôi muốn xem tài sản tôi đang giữ và lịch sử của mình. | P1 | 3 | `GET /me/assets` own-scope, employee resolve từ token (không nhận `employeeId`); **không** trường tài chính (server strip, FE schema `.optional()`); tài sản người khác ⇒ 404 (ASSET-FUNC-013, ASSET-SCREEN-006). |
| IMP02-STORY-161 | Employee / Asset Manager | Là người liên quan, tôi muốn được thông báo khi được cấp/bị thu hồi tài sản và khi tài sản sắp đến hạn bảo trì. | P1 | 5 | 3 event `ASSET_ASSIGNED`/`ASSET_REVOKED`/`ASSET_MAINTENANCE_DUE` (NOTI-EVENT-010..012) seed trước WO backend; CHECK nới CẢ HAI bảng NOTI; job nhắc `@SystemJobHandler` idempotent theo `(asset, hạn)`; payload không có số tiền (SPEC-13 §17). |
| IMP02-STORY-162 | Manager / Admin | Là quản lý, tôi muốn widget dashboard thống kê tài sản theo trạng thái và loại. | P2 | 5 | `GET /assets/summary` theo data_scope người gọi; widget chỉ render khi có `('view','asset')`, không quyền thì không gọi API; mã widget cấp ở `S11-OFFICE-DASH-1` sau khi đo SPEC-07 §14 (ASSET-FUNC-014). |

### Phạm vi kỹ thuật chính

- 6 bảng mới `asset_*` (DB-15): RLS+FORCE, composite tenant FK, 4 bảng sổ không DELETE / UPDATE cấp cột, 3 partial unique là chốt cuối nghiệp vụ
- FSM 5 trạng thái ép ở service, DB chỉ CHECK tập giá trị; "ai đang giữ" dẫn xuất từ lượt `Active`
- 11 cặp quyền `is_sensitive=false` + role hệ thống mới `asset-manager` (không canonical); data scope Own/Department/Company ở service
- Seed nối head thật (`0549+` dự kiến): module · role · quyền · audit UNION-ADD · NOTI catalog (cả hai bảng CHECK)
- Không endpoint QR / PDF biên bản — FE render (ASSET-DEC-001/002)

### Ghi chú dependency

ASSET phụ thuộc AUTH (RBAC per-pair + scope), HR/`employee_profiles` (người giữ, chỉ nhân viên `active`), FOUNDATION (`sequence_counters` · `audit_logs` · Files) và NOTI (outbox bridge). Lane migration **nối tiếp**: `S11-ROOM-DB-1` chỉ chạy sau `S11-ASSET-DB-1` merge. `plan-reviewer` PASS trên SPEC-13 + DB-15 là cổng mở WO DB.

---

## 9. Backlog theo Sprint đề xuất

> Sprint mapping dưới đây bám đúng các IMPLEMENTATION execution plan (IMPLEMENTATION-03 -> IMPLEMENTATION-09): mô hình **7 sprint (Sprint 0 -> Sprint 6)**. Tổng MVP baseline: **112 story / 869 point** (+ EPIC-12 ME bổ sung 2026-07-13: 8 story / 44 point; + 4 story HR bổ sung EPIC-03 2026-07-13: IMP02-STORY-121..124, 36 point → **124 story / 949 point**). Khi biết velocity thực tế, Product Owner và Tech Lead cần điều chỉnh lại số story trong từng sprint (xem cảnh báo capacity ở §9.1).
>
> **Sprint hậu-MVP (bổ sung 2026-08-03):** wave sau go-live không nằm trong mô hình 7 sprint gốc. Sprint 5 nhận thêm GOAL/LMS/BRAND (IMP02-STORY-125..131, 133..140) vì chạy cùng đợt; IMP02-STORY-132 (tab Mục tiêu trong dự án) giao ở Sprint 7. **Sprint 7 = wave CHAT** (IMP02-STORY-141..152, SPEC-15) — đang chạy tại thời điểm cập nhật. **Sprint 11 = wave S11-OFFICE** (Phase 3): IMP02-STORY-153..162 (EPIC-17 ASSET, SPEC-13) + EPIC-18 ROOM (thêm ở `S11-ROOM-DOC-1`) — bổ sung 2026-08-28.

| Sprint | Execution plan | Mục tiêu | Story trọng tâm | Point | Deliverable demo |
| --- | --- | --- | --- | ---: | --- |
| Sprint 0 | IMPLEMENTATION-03 | Setup delivery, issue board, backlog governance | 001-004 | 14 | Board/label/workflow, DoR/DoD, traceability, repo/CI skeleton |
| Sprint 1 | IMPLEMENTATION-04 | Foundation, Environment & Core Infra + Frontend Core | 005-012, 093-096 | 91 | Seed nền, audit/file/setting/sequence, app shell, API client, route/app registry |
| Sprint 2 | IMPLEMENTATION-05 | Auth & HR Core | 013-037, 098-099 | 200 | Login/logout, RBAC guard, user/role admin, employee CRUD, profile change, employee code |
| Sprint 3 | IMPLEMENTATION-06 | Attendance & Leave Core | 038-064, 100 | 241 | Check-in/out, attendance records, shift/rule, leave balance/request/approval, ATT sync |
| Sprint 4 | IMPLEMENTATION-07 | Task, Notification & Dashboard | 065-092, 101-103 | 231 | Project/task/Kanban, event notification, unread/dropdown, role dashboards, widget cache |
| Sprint 5 | IMPLEMENTATION-08 | Integration, QA Hardening & UAT | 097, 104-110, 113-120 (EPIC-12 ME), 121-124 (HR bổ sung) | 159 | Field/export security, OpenAPI contract, test matrix, API/E2E/security/perf test, responsive P0, Trung tâm cá nhân /me (SPEC-09), liên kết tài khoản UI + import Excel nhân viên + sơ đồ tổ chức trực quan + thông tin công việc đầy đủ |
| Sprint 6 | IMPLEMENTATION-09 | Stabilization, Release Candidate & Go-live | 111-112 + bugfix | 13 | UAT sign-off, release readiness, RC build, go-live runbook |
| Sprint 7 | SPEC-15 + docs/plans/S7-CHAT-WAVE.md | CHAT - Nhắn tin nội bộ (hậu go-live) | 132, 141-152 (EPIC-16 CHAT) | 100 | Phòng 1-1/nhóm/phòng-ban/dự án, gửi-đọc theo con trỏ seq, đính kèm qua Foundation Files, tìm kiếm tiếng Việt, realtime Valkey adapter, đọc-vượt membership có nhật ký, tab Mục tiêu trong dự án |
| Sprint 11 | SPEC-13 + docs/plans/S11-OFFICE-WAVE.md | ASSET - Quản lý tài sản (Phase 3, hậu go-live) | 153-162 (EPIC-17 ASSET) | 53 | Danh mục loại + mã/QR, hồ sơ tài sản FSM, cấp phát/thu hồi 1 bước có biên bản, bảo trì, kiểm kê theo đợt, thanh lý/mất, «tài sản của tôi», 3 event NOTI, widget DASH (ROOM/EPIC-18 thêm ở S11-ROOM-DOC-1) |

### 9.1 Lưu ý capacity

Mô hình 7 sprint gộp nhiều module lõi vào một sprint nên tải point không đều:

| Sprint | Point | Mức tải |
| --- | ---: | --- |
| Sprint 0 | 14 | Thấp |
| Sprint 1 | 91 | Trung bình |
| Sprint 2 | 200 | Rất cao |
| Sprint 3 | 241 | Rất cao |
| Sprint 4 | 231 | Rất cao |
| Sprint 5 | 79 | Trung bình |
| Sprint 6 | 13 + bugfix | Thấp |
| **Tổng** | **869** | — |

Với team tham chiếu (2-4 Backend, 2-4 Frontend), velocity 2 tuần thực tế thường ở mức 40-80 point. Do đó **Sprint 2-4 (200/241/231 point) vượt xa một sprint 2 tuần đơn thuần** và bắt buộc một trong các phương án: (a) tăng số dev song song theo module, (b) kéo dài các sprint này (3-4 tuần), hoặc (c) tách mỗi sprint thành 2 sprint nhỏ. Các execution plan IMPLEMENTATION-05/06/07 đã chia nhỏ theo task/ngày; Product Owner + Tech Lead cần chốt velocity thực tế sau Sprint 0-1 rồi điều chỉnh phạm vi từng sprint cho khớp.

---

## 10. Backlog P0 bắt buộc cho MVP

Tổng số story P0: **80**.

| Nhóm | Story P0 bắt buộc |
| --- | --- |
| EPIC-00 - Product Backlog Governance | IMP02-STORY-001, IMP02-STORY-002, IMP02-STORY-003, IMP02-STORY-004 |
| EPIC-01 - Foundation & Shared System | IMP02-STORY-005, IMP02-STORY-006, IMP02-STORY-007, IMP02-STORY-008, IMP02-STORY-009, IMP02-STORY-010, IMP02-STORY-012 |
| EPIC-02 - AUTH, Session, RBAC & Permission Guard | IMP02-STORY-013, IMP02-STORY-014, IMP02-STORY-017, IMP02-STORY-018, IMP02-STORY-019, IMP02-STORY-020, IMP02-STORY-021, IMP02-STORY-022, IMP02-STORY-023 |
| EPIC-03 - HR - Human Resource Core | IMP02-STORY-025, IMP02-STORY-026, IMP02-STORY-027, IMP02-STORY-028, IMP02-STORY-029, IMP02-STORY-032, IMP02-STORY-033, IMP02-STORY-034 |
| EPIC-04 - ATT - Attendance | IMP02-STORY-038, IMP02-STORY-039, IMP02-STORY-040, IMP02-STORY-041, IMP02-STORY-043, IMP02-STORY-044, IMP02-STORY-045, IMP02-STORY-046, IMP02-STORY-047 |
| EPIC-05 - LEAVE - Leave Management | IMP02-STORY-052, IMP02-STORY-053, IMP02-STORY-054, IMP02-STORY-055, IMP02-STORY-057, IMP02-STORY-058, IMP02-STORY-061, IMP02-STORY-062, IMP02-STORY-063, IMP02-STORY-064 |
| EPIC-06 - TASK - Project & Task Management | IMP02-STORY-065, IMP02-STORY-066, IMP02-STORY-067, IMP02-STORY-068, IMP02-STORY-069, IMP02-STORY-070, IMP02-STORY-071 |
| EPIC-07 - NOTI - Notification System | IMP02-STORY-077, IMP02-STORY-078, IMP02-STORY-079, IMP02-STORY-080, IMP02-STORY-081, IMP02-STORY-082 |
| EPIC-08 - DASH - Role-based Dashboard | IMP02-STORY-085, IMP02-STORY-086, IMP02-STORY-087, IMP02-STORY-090 |
| EPIC-09 - Frontend Core Implementation | IMP02-STORY-093, IMP02-STORY-094, IMP02-STORY-095, IMP02-STORY-096 |
| EPIC-10 - Cross-module Integration & Security | IMP02-STORY-098, IMP02-STORY-099, IMP02-STORY-100, IMP02-STORY-102, IMP02-STORY-104, IMP02-STORY-105 |
| EPIC-11 - QA, UAT & Release Readiness | IMP02-STORY-106, IMP02-STORY-107, IMP02-STORY-108, IMP02-STORY-109, IMP02-STORY-111, IMP02-STORY-112 |

P0 chỉ được chuyển khỏi MVP khi Product Owner xác nhận có workaround hoặc business chấp nhận giảm scope.

---

## 11. Acceptance Criteria chi tiết cho các luồng P0 trọng yếu

### CF-01 Login & Permission

**Story liên quan:** IMP02-STORY-013, 018-023

- AC-01: User đăng nhập đúng thông tin thì vào Home Portal.
- AC-02: User sai mật khẩu/email nhận lỗi an toàn, không tiết lộ thông tin nhạy cảm.
- AC-03: User bị khóa/không active không đăng nhập được.
- AC-04: Backend trả user context gồm roles, permissions, scopes, employee link.
- AC-05: Frontend chỉ hiển thị app/menu/action đúng permission.
- AC-06: Direct URL trái quyền bị route guard và API guard chặn.

### CF-02 Employee Creation & User Link

**Story liên quan:** IMP02-STORY-027, 019, 098

- AC-01: HR tạo employee và hệ thống sinh employee_code theo cấu hình.
- AC-02: Nếu chọn tạo user, user được tạo và link với employee đúng company.
- AC-03: Email/employee_code không trùng trong phạm vi company.
- AC-04: Role Employee mặc định được gán nếu cấu hình bật.
- AC-05: Audit log ghi đủ actor/action/entity/diff.
- AC-06: Notification/activation được tạo nếu cấu hình bật.

### CF-03 Employee Self-service Profile Change

**Story liên quan:** IMP02-STORY-032-034

- AC-01: Employee gửi yêu cầu thay đổi hồ sơ nhưng hồ sơ chính chưa đổi ngay.
- AC-02: Request lưu dữ liệu cũ/mới theo từng field.
- AC-03: HR/Admin xem diff và approve/reject.
- AC-04: Approve mới cập nhật hồ sơ chính trong transaction.
- AC-05: Reject giữ nguyên hồ sơ chính.
- AC-06: Employee nhận notification kết quả.

### CF-04 Check-in/Check-out

**Story liên quan:** IMP02-STORY-038-045

- AC-01: Employee xem được trạng thái chấm công hôm nay.
- AC-02: Check-in dùng server time, không cho check-in trùng.
- AC-03: Check-out cập nhật record cùng ngày/ca và tính work minutes.
- AC-04: Nếu có leave Approved cả ngày thì disable check-in/out.
- AC-05: Mỗi lần check-in/out tạo attendance_log raw.
- AC-06: Attendance record phản ánh late/early/missing/complete theo rule.

### CF-05 Attendance Adjustment Approval

**Story liên quan:** IMP02-STORY-046-048

- AC-01: Employee tạo adjustment request có ngày, lý do, field cần sửa và file nếu có.
- AC-02: Manager chỉ duyệt nhân viên thuộc team; HR duyệt theo company scope.
- AC-03: Approve cập nhật attendance record và ghi approval history.
- AC-04: Reject không thay đổi record.
- AC-05: Notification gửi cho người liên quan.
- AC-06: Audit log ghi before/after diff.

### CF-06 Leave Request Approval & Attendance Sync

**Story liên quan:** IMP02-STORY-052-064, 100

- AC-01: Employee preview số ngày nghỉ trước khi gửi.
- AC-02: Submit kiểm tra balance, overlap, working day và approver.
- AC-03: Manager/HR approve đúng scope.
- AC-04: Approved leave tạo leave_request_days và cập nhật balance ledger.
- AC-05: ATT nhận sync để chặn/tính lại công tương ứng.
- AC-06: Cancel/revoke leave sync lại attendance và hoàn phép nếu policy yêu cầu.

### CF-07 Task Assignment & Notification

**Story liên quan:** IMP02-STORY-068-073, 101-102

- AC-01: User có quyền tạo task với assignee hợp lệ.
- AC-02: Assignee trong project/team/company scope theo permission.
- AC-03: Nếu assignee đang nghỉ phép/deadline trùng kỳ nghỉ, hệ thống cảnh báo.
- AC-04: Task assigned tạo activity log.
- AC-05: NOTI tạo notification cho assignee/watcher phù hợp.
- AC-06: Assignee xem task trong My Tasks và cập nhật status theo quyền.

### CF-08 Notification Deep Link

**Story liên quan:** IMP02-STORY-079-082

- AC-01: Notification badge hiển thị unread count đúng user.
- AC-02: Dropdown hiển thị danh sách mới nhất theo quyền.
- AC-03: Mark read cập nhật unread count idempotent.
- AC-04: Click notification điều hướng sang module gốc.
- AC-05: Module gốc kiểm tra quyền và business rule lại.
- AC-06: Nếu user không còn quyền, hiển thị forbidden hoặc target unavailable.

### CF-09 Role Dashboard

**Story liên quan:** IMP02-STORY-085-092

- AC-01: /dashboard/me trả dashboard types/widget allowed theo user.
- AC-02: Employee/Manager/HR/Admin thấy widget phù hợp permission/data scope.
- AC-03: Widget lỗi module nguồn không làm hỏng toàn dashboard.
- AC-04: Quick action điều hướng sang module gốc, không xử lý nghiệp vụ trực tiếp trong DASH.
- AC-05: Cache widget không lộ dữ liệu giữa user/company.
- AC-06: Refresh/invalidation cập nhật dữ liệu sau event quan trọng.

---

## 12. Non-functional backlog

| ID | Nhóm | Yêu cầu | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| NFR-001 | Security | Không lưu mật khẩu plain text; token/session có hạn; refresh/logout an toàn | P0 | Security test pass cho login/logout/reset/change password. |
| NFR-002 | Authorization | Backend kiểm tra permission/data scope cho mọi API protected | P0 | API test 401/403/target ngoài scope pass. |
| NFR-003 | Audit | Thao tác tạo/sửa/xóa/approve/export nhạy cảm có audit log | P0 | Audit log tra được actor, action, entity, diff và request id. |
| NFR-004 | Privacy | Field nhạy cảm bị mask/hide nếu thiếu quyền | P0 | Không lộ CCCD, hợp đồng, file, bảng công chi tiết qua API/UI/export nếu thiếu quyền. |
| NFR-005 | Performance | API list P0 phản hồi trong SLA MVP với dữ liệu seed kiểm thử | P1 | Employee list, attendance records, leave pending, my tasks, notification unread, dashboard widget đạt SLA đã chốt. |
| NFR-006 | Reliability | Migration + seed chạy được từ database trống | P0 | CI hoặc checklist local/staging pass. |
| NFR-007 | Accessibility | P0 flow đạt mức accessibility tối thiểu | P1 | Keyboard focus, aria-label, contrast, modal focus trap, form error announcement. |
| NFR-008 | Responsive | Mobile web dùng được cho Employee daily flows | P1 | Login, Home, check-in/out, create leave, my tasks, notification hoạt động trên mobile viewport. |
| NFR-009 | Observability | API error có request id và log đủ debug | P1 | 500/validation/forbidden có request id; log không chứa dữ liệu nhạy cảm. |
| NFR-010 | Backup/Rollback | Release MVP có kế hoạch rollback migration và app | P0 | Release readiness checklist có backup, rollback và smoke test. |

---

## 13. Dependency matrix

| Module/Story nhóm | Phụ thuộc bắt buộc | Có thể chạy song song | Không nên làm trước khi |
| --- | --- | --- | --- |
| Foundation | DB foundation, seed strategy | Frontend shell mock | Không |
| AUTH | Foundation company/module/audit | Frontend login UI, route guard skeleton | Foundation seed tối thiểu |
| HR | AUTH user/permission, Foundation file/sequence | Employee UI mock, API contract | AUTH guard chưa có |
| ATT | AUTH + HR employee/manager + shift/rule DB | Today UI, table UI | HR employee chưa ổn định |
| LEAVE | AUTH + HR + ATT sync contract | Leave form UI, calculation mock | ATT sync contract chưa rõ |
| TASK | AUTH + HR employee/project permission | Kanban UI mock | HR employee/user mapping chưa có |
| NOTI | AUTH user, HR employee, event contract | Dropdown/list UI | Event catalog chưa chốt |
| DASH | AUTH context + module data APIs | Widget shell/mock | Widget permission model chưa rõ |
| QA/UAT | Story AC + API/UI contract | Test case viết song song | Không nên chờ dev xong toàn bộ |

---

## 14. Traceability matrix theo tài liệu nguồn

| Backlog area | Tài liệu nguồn chính | Ghi chú traceability |
| --- | --- | --- |
| Product scope | PRD-00, SPEC-01 | Xác định module MVP, actor, mục tiêu nghiệp vụ/kỹ thuật |
| AUTH | SPEC-02, DB-02, API-02, UI-09, FRONTEND-03 | User, role, permission, data scope, session, guard |
| HR | SPEC-03, DB-03, API-03, UI-09 | Employee, department, contract, profile change, employee code |
| ATT | SPEC-04, DB-04, API-04, UI-09 | Check-in/out, shift, rule, adjustment, remote, export |
| LEAVE | SPEC-05, DB-05, API-05, UI-09 | Leave balance, request, approval, calendar, ATT sync |
| TASK | SPEC-06, DB-06, API-06, UI-09 | Project, task, member, Kanban, comment, checklist, file |
| DASH/NOTI | SPEC-07, SPEC-08, DB-07, API-07, API-08, UI-08, UI-09 | Widget, event, template, unread, role dashboard |
| Foundation | DB-08, DB-10, API-01 | Company, module, settings, audit, file, sequence, seed |
| Frontend | UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04 | Home Portal, App Switcher, Module Workspace, Design System, API client |
| QA/Release | QA-01 -> QA-10, DEVOPS-01 -> DEVOPS-12 nếu đã triển khai | Test strategy, UAT, release readiness, deployment/rollback |

---

## 15. Rủi ro backlog và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Scope MVP quá rộng | Trễ release | Giữ P0/P1 rõ, P2/P3 chuyển phase sau khi cần |
| Permission/data scope sai | Lộ dữ liệu nhạy cảm | Backend guard bắt buộc, API permission test, field mask test |
| HR chưa ổn định làm ATT/LEAVE/TASK chậm | Block module sau | Ưu tiên HR core + employee/user mapping sớm |
| LEAVE-ATT sync lỗi | Sai bảng công/payroll phase sau | Thiết kế sync idempotent, regression test approve/cancel/revoke |
| Dashboard query nặng | Chậm app | Lazy load widget, cache, index, degraded state |
| Notification gửi sai người | Lộ thông tin/UX kém | Recipient resolver test theo role/scope, notification target check |
| Frontend hard-code theo role | Sai khi role tùy biến | Dùng permission/data scope từ backend, registry metadata |
| File access không kiểm quyền | Lộ hồ sơ/hợp đồng | Private file mặc định, signed URL có hạn, file access log |
| QA bắt đầu muộn | Bug dồn cuối release | QA viết test case theo backlog ngay từ Sprint 0/1 |
| DevOps/seed không ổn định | Môi trường lỗi | Migration/seed idempotent, smoke test, rollback checklist |

---

## 16. Open questions cần chốt trước Sprint 1

| ID | Câu hỏi | Owner đề xuất | Mức ảnh hưởng | Trạng thái |
| --- | --- | --- | --- | --- |
| OQ-001 | API-02 AUTH hiện chưa có file trong thư mục hiện tại; sẽ viết bổ sung hay backend tự triển khai từ SPEC-02/DB-02/API-01? | Product + Backend Lead | Cao | ĐÃ GIẢI QUYẾT: `API Design/API-02 AUTH API Design.md` đã tồn tại (kèm `openapi/paths/auth.paths.yaml`). Đóng OQ. |
| OQ-002 | MVP dùng access token lưu ở HttpOnly cookie hay memory/local storage? | Tech Lead + Security | Cao | Tham chiếu DECISIONS-01; chốt cuối trong Sprint 2 (IMPLEMENTATION-05) trước khi mở API nghiệp vụ. |
| OQ-003 | Email gửi activation/reset password có triển khai thật trong MVP hay mock/in-app trước? | Product + DevOps | Trung bình | Mở |
| OQ-004 | Manager approval scope dựa hoàn toàn vào direct_manager_id hay department hierarchy? | Product + HR | Cao | ĐÃ GIẢI QUYẾT theo DECISIONS-01 D-04: duyệt theo quản lý trực tiếp (`direct_manager_id`), HR scope = Company. |
| OQ-005 | Remote/công tác nằm trong ATT MVP ở mức đầy đủ hay chỉ basic request? | Product + HR | Trung bình | Mở |
| OQ-006 | File storage MVP dùng local/private disk, S3-compatible hay provider khác? | Tech Lead + DevOps | Cao | ĐÃ GIẢI QUYẾT theo DECISIONS-01 D-12: object storage S3-compatible (MinIO self-host). |
| OQ-007 | Dashboard cache dùng DB table, Valkey hay in-memory ở MVP? | Backend Lead | Trung bình | ĐÃ GIẢI QUYẾT theo BACKEND-01: Valkey cache. |
| OQ-008 | Có cần export Excel thật trong MVP hay chỉ chuẩn bị API/report screen? | Product + HR | Trung bình | Mở |

> Các quyết định D-04/D-12 trong DECISIONS-01 hiện ở trạng thái "Đề xuất"; cần được duyệt khóa (Đã chốt) trước khi scope lock Sprint 2.

---

## 17. Checklist nhập backlog vào công cụ quản lý dự án

| Hạng mục | Trạng thái |
| --- | --- |
| Tạo project/board MVP | Chưa thực hiện |
| Tạo label module: FOUNDATION, AUTH, HR, ATT, LEAVE, TASK, NOTI, DASH, FRONTEND, QA, DEVOPS | Chưa thực hiện |
| Tạo label priority: P0, P1, P2, P3 | Chưa thực hiện |
| Tạo label type: Epic, Story, Tech Story, Bug, Test, Spike | Chưa thực hiện |
| Tạo workflow: Backlog -> Ready -> In Progress -> Code Review -> QA -> UAT -> Done | Chưa thực hiện |
| Import Epic EPIC-00 -> EPIC-11 | Chưa thực hiện |
| Import Story IMP02-STORY-001 -> 112 | Chưa thực hiện |
| Gán owner Product/Backend/Frontend/QA/DevOps cho từng story | Chưa thực hiện |
| Gán sprint đề xuất | Chưa thực hiện |
| Liên kết story với tài liệu nguồn | Chưa thực hiện |
| Liên kết story với test case khi QA tạo | Chưa thực hiện |

---

## 18. Kết luận

IMPLEMENTATION-02 chuyển phạm vi MVP từ bộ tài liệu sản phẩm/kỹ thuật sang một backlog có thể triển khai thực tế.

Tư duy triển khai chính:

```text
Backlog rõ scope
-> Epic theo module
-> Story có AC kiểm thử được
-> P0 khóa MVP
-> Sprint mapping theo dependency
-> QA/UAT chạy song song
-> Release có checklist rõ
```

Sau tài liệu này, các tài liệu thực thi trong chuỗi IMPLEMENTATION là:

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