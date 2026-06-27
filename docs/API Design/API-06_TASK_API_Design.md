# API-06: TASK API DESIGN

**MODULE CÔNG VIỆC & DỰ ÁN - TASK API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · **API-06 TASK** · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>)
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-06 TASK](<../SPEC/SPEC-06 TASK.md>) · [Thiết kế DB: DB-06 TASK](<../DB/DB-06 TASK Database Design.md>) · [Sản phẩm: PRD-00 §9.5](<../PRD/PRD-00 Enterprise Management System .md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-06 |
| Tên tài liệu | TASK API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | TASK - Công việc & Dự án |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Giai đoạn | MVP Version 1.0 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01, API-02, API-03, API-04, API-05 |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả chi tiết thiết kế API cho module **TASK - Công việc & Dự án** của hệ thống quản lý doanh nghiệp nội bộ.

Module TASK cung cấp API cho các nghiệp vụ:

1. Quản lý dự án.
2. Quản lý thành viên dự án.
3. Phân vai trò nội bộ trong dự án: Owner, Manager, Member, Viewer.
4. Tạo, cập nhật, xóa mềm, đóng, hủy và lưu trữ dự án.
5. Quản lý task/công việc thuộc dự án hoặc task cá nhân nếu cấu hình cho phép.
6. Giao task cho nhân viên.
7. Quản lý assignee chính, watcher/follower và người tạo task.
8. Cập nhật trạng thái, độ ưu tiên và deadline task.
9. Hiển thị danh sách task, việc của tôi, task quá hạn, task sắp đến hạn.
10. Hiển thị Kanban board theo trạng thái task.
11. Bình luận trong task và mention người dùng.
12. Quản lý checklist/checklist item trong task.
13. Upload, xem, tải và xóa file đính kèm project/task.
14. Ghi activity log cho project/task.
15. Cung cấp dữ liệu cho Dashboard.
16. Phát event cho Notification.
17. Chừa khả năng mở rộng cho Gantt chart, Sprint/Scrum, Time Tracking, Automation, Calendar Integration, AI và báo cáo năng suất.

Tài liệu API-06 dùng làm cơ sở cho:

1. Backend triển khai route/controller, DTO, validation, service, repository và permission guard cho module TASK.
2. Frontend triển khai màn hình dự án, task list, task detail, Kanban board, comment, checklist, file và report.
3. QA viết test case API, permission test, data scope test, workflow test và regression test.
4. DevOps/API documentation tạo OpenAPI/Swagger cho module TASK.
5. Các module DASH, NOTI, ATT, LEAVE tích hợp dữ liệu TASK đúng chuẩn.

---

## 3. Căn cứ thiết kế

API-06 tuân thủ các quyết định đã chốt trong bộ tài liệu dự án:

1. **API-01** quy định prefix `/api/v1`, response/error/pagination thống nhất, backend bắt buộc kiểm tra authentication, permission, data scope, business validation, audit log và notification event.
2. **SPEC-06** xác định TASK là module quản lý dự án, task, assignee, deadline, Kanban, comment, file, checklist và activity log.
3. **DB-06** xác định các bảng chính: `projects`, `project_members`, `project_files`, `tasks`, `task_assignees`, `task_watchers`, `task_comments`, `task_comment_mentions`, `task_checklists`, `task_checklist_items`, `task_files`, `task_activity_logs`.
4. **SPEC-02/API-02 AUTH** là nền tảng xác thực, RBAC, permission và data scope.
5. **SPEC-03/API-03 HR** cung cấp employee, department, position, direct manager, employment status và user mapping.
6. **DB-08 FOUNDATION** cung cấp audit log, file service, setting service, sequence service và shared infrastructure.
7. **SPEC-05 LEAVE** cung cấp lịch nghỉ để TASK cảnh báo khi giao task/deadline trùng ngày nghỉ đã duyệt.
8. **SPEC-04 ATT** có thể liên kết TASK cho remote work, dashboard trạng thái làm việc và time tracking phase sau.
9. **SPEC-07 DASH** lấy dữ liệu task/project để hiển thị widget việc của tôi, task quá hạn, tiến độ dự án.
10. **SPEC-08 NOTI** nhận event từ TASK để gửi thông báo task assigned, comment, mention, due soon, overdue và project member change.

---

## 4. Phạm vi API-06

### 4.1 Bao gồm trong MVP

| Nhóm API | Mô tả |
| --- | --- |
| Project API | Danh sách, chi tiết, tạo, cập nhật, đóng, hủy, lưu trữ, xóa mềm dự án |
| Project Member API | Danh sách thành viên, thêm thành viên, cập nhật role, xóa thành viên |
| Project File API | Upload, danh sách, tải, xóa file dự án |
| Task API | Danh sách task, chi tiết task, tạo, cập nhật, xóa mềm task |
| My Task API | Việc của tôi, task được giao, task tôi tạo, task tôi theo dõi |
| Assignment API | Giao task, đổi assignee, thêm/xóa watcher |
| Task Status API | Cập nhật trạng thái task, đổi priority, đổi deadline |
| Kanban API | Lấy board theo project/status và kéo thả đổi trạng thái |
| Task Comment API | Tạo, sửa, xóa comment, mention người dùng |
| Task Checklist API | Tạo checklist, tạo item, cập nhật item, đánh dấu hoàn thành |
| Task File API | Upload, danh sách, tải, xóa file task |
| Activity API | Xem lịch sử hoạt động project/task |
| Report API | Báo cáo tiến độ dự án cơ bản |
| Export API | Xuất danh sách task/project theo bộ lọc và quyền |

---

### 4.2 Chưa bao gồm trong MVP nhưng API cần chừa khả năng mở rộng

| Nhóm | Giai đoạn | Hướng mở rộng API |
| --- | --- | --- |
| Sprint/Scrum | Phase sau | `/api/v1/tasks/sprints`, `/api/v1/tasks/backlog` |
| Gantt chart | Phase sau | `/api/v1/tasks/projects/{project_id}/gantt` |
| Task dependency | Phase sau | `/api/v1/tasks/{task_id}/dependencies` |
| Time tracking | Phase sau | `/api/v1/tasks/{task_id}/time-logs` |
| Template dự án/task | Phase sau | `/api/v1/tasks/project-templates`, `/api/v1/tasks/task-templates` |
| Automation workflow | Phase sau | `/api/v1/tasks/automation-rules` |
| Approval task quan trọng | Phase sau | `/api/v1/tasks/{task_id}/approval-requests` |
| Calendar integration | Phase sau | `/api/v1/tasks/calendar-sync` |
| Chat realtime trong dự án | Phase 4 | Tích hợp module CHAT, không xử lý trực tiếp trong TASK MVP |
| AI summary/suggestion | Phase 5 | `/api/v1/tasks/projects/{project_id}/ai-summary` |
| Báo cáo năng suất nâng cao | Phase sau | Có thể tách sang reporting/BI service |

---

## 5. API prefix và nguyên tắc chung

### 5.1 Base prefix

Tất cả endpoint TASK dùng prefix chính:

```http
/api/v1/tasks
```

Các endpoint project vẫn nằm dưới prefix TASK để gom module công việc/dự án vào một nhóm thống nhất:

```http
GET    /api/v1/tasks/projects
POST   /api/v1/tasks/projects
GET    /api/v1/tasks/projects/{project_id}
PATCH  /api/v1/tasks/projects/{project_id}
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/{task_id}
PATCH  /api/v1/tasks/{task_id}
```

> Ghi chú: Nếu muốn tách project thành resource top-level, có thể bổ sung alias `/api/v1/projects`, nhưng MVP khuyến nghị giữ `/api/v1/tasks/projects` để tránh phân tán module.

---

### 5.2 Authentication

Tất cả API TASK yêu cầu access token hợp lệ:

```http
Authorization: Bearer <access_token>
```

Không có endpoint TASK public trong MVP.

---

### 5.3 Multi-tenant

Backend resolve `company_id` từ auth context. Frontend không được tự truyền `company_id` trong request body cho nghiệp vụ TASK thông thường.

Quy tắc:

1. Mọi query TASK phải filter theo `company_id`.
2. Super Admin có scope `System` mới được truy vấn liên công ty.
3. Nếu request body/query cố tình truyền `company_id` ở endpoint không cho phép, backend trả validation error hoặc bỏ qua theo policy bảo mật.
4. Không trả dữ liệu project/task của công ty khác kể cả khi biết UUID.
5. Các endpoint danh sách phải áp dụng data scope trước khi phân trang.

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
permission + data_scope + project membership + task relation + business validation
```

`Allowed roles` trong tài liệu chỉ là gợi ý nghiệp vụ dựa trên seed role mặc định.

---

### 6.2 Scope chuẩn trong TASK

| Scope | Ý nghĩa trong TASK | Cách xác định gợi ý |
| --- | --- | --- |
| `Own` | Task do mình tạo, được giao, theo dõi hoặc project mình tham gia | `created_by`, `task_assignees`, `task_watchers`, `project_members` |
| `Team` | Task của nhân viên thuộc team mình quản lý | `employees.direct_manager_id = current_employee_id` |
| `Department` | Task thuộc phòng ban mình quản lý hoặc assignee thuộc phòng ban | `tasks.department_id`, `employees.department_id` |
| `Project` | Task thuộc dự án user là member | `project_members.employee_id = current_employee_id` |
| `Company` | Tất cả project/task trong công ty hiện tại | `company_id` |
| `System` | Tất cả project/task toàn hệ thống | Super Admin only |

---

### 6.3 Project role nội bộ

Project role không thay thế RBAC hệ thống. Backend phải kiểm tra RBAC trước, sau đó kiểm tra project role nếu task thuộc project.

| Project role | Ý nghĩa | Quyền nghiệp vụ gợi ý trong project |
| --- | --- | --- |
| `Owner` | Chủ dự án | Quản lý project, member, task, report, close/archive nếu có permission hệ thống |
| `Manager` | Quản lý dự án | Tạo/giao/cập nhật task trong project nếu có permission hệ thống |
| `Member` | Thành viên | Xem project, xử lý task được giao, comment |
| `Viewer` | Chỉ xem | Xem project/task theo scope, không cập nhật |

---

### 6.4 Danh sách permission TASK trong MVP

| Permission | Mục đích |
| --- | --- |
| `TASK.PROJECT.VIEW` | Xem danh sách và chi tiết dự án |
| `TASK.PROJECT.CREATE` | Tạo dự án |
| `TASK.PROJECT.UPDATE` | Cập nhật dự án |
| `TASK.PROJECT.DELETE` | Xóa mềm dự án |
| `TASK.PROJECT.CLOSE` | Đóng/hoàn thành dự án |
| `TASK.PROJECT.ARCHIVE` | Lưu trữ dự án |
| `TASK.PROJECT.MANAGE_MEMBER` | Thêm/xóa/cập nhật thành viên dự án |
| `TASK.PROJECT.FILE_UPLOAD` | Upload file dự án |
| `TASK.PROJECT.FILE_DELETE` | Xóa file dự án |
| `TASK.PROJECT.VIEW_REPORT` | Xem báo cáo tiến độ dự án |
| `TASK.TASK.VIEW` | Xem task |
| `TASK.TASK.CREATE` | Tạo task |
| `TASK.TASK.UPDATE` | Cập nhật task |
| `TASK.TASK.DELETE` | Xóa mềm task |
| `TASK.TASK.ASSIGN` | Giao task hoặc đổi assignee |
| `TASK.TASK.UPDATE_STATUS` | Cập nhật trạng thái task |
| `TASK.TASK.UPDATE_PRIORITY` | Cập nhật độ ưu tiên |
| `TASK.TASK.UPDATE_DEADLINE` | Cập nhật deadline |
| `TASK.TASK.COMMENT` | Bình luận trong task |
| `TASK.TASK.FILE_UPLOAD` | Upload file vào task |
| `TASK.TASK.FILE_DELETE` | Xóa file trong task |
| `TASK.TASK.WATCH` | Theo dõi/bỏ theo dõi task |
| `TASK.TASK.VIEW_KANBAN` | Xem Kanban board |
| `TASK.TASK.EXPORT` | Xuất danh sách task |
| `TASK.AUDIT_LOG.VIEW` | Xem lịch sử hoạt động task/project |

---

### 6.5 Role mặc định gợi ý

| Role | Quyền gợi ý trong TASK |
| --- | --- |
| Super Admin | Toàn quyền scope System |
| Admin công ty | Quản lý project/task scope Company nếu được cấp |
| HR | Có thể tạo/xem task nghiệp vụ HR nếu được cấp |
| Manager | Tạo project/task, giao task, xem task team/project nếu được cấp |
| Project Manager | Quản lý trong project cụ thể, phụ thuộc permission hệ thống và project role |
| Employee | Xem/cập nhật task được giao, comment, checklist theo quyền |
| Watcher | Xem task được theo dõi nếu có quyền và scope hợp lệ |

---

## 7. Enum và quy ước trạng thái

### 7.1 Project status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Planning` | Đang lên kế hoạch |
| `Active` | Đang thực hiện |
| `On Hold` | Tạm dừng |
| `Completed` | Hoàn thành |
| `Cancelled` | Đã hủy |
| `Archived` | Lưu trữ |

### 7.2 Project visibility

| Giá trị | Ý nghĩa |
| --- | --- |
| `Private` | Chỉ member/project manager/owner và người có quyền cao hơn xem được |
| `Internal` | Nội bộ công ty, vẫn kiểm tra permission |
| `Public` | Tất cả user trong company có quyền `TASK.PROJECT.VIEW` có thể xem |

### 7.3 Task status

| Giá trị | Ý nghĩa |
| --- | --- |
| `Todo` | Chưa bắt đầu |
| `In Progress` | Đang làm |
| `In Review` | Chờ kiểm tra |
| `Done` | Hoàn thành |
| `Cancelled` | Đã hủy |

> `Overdue` là trạng thái dẫn xuất, không lưu cứng trong `tasks.status`. Một task được xem là quá hạn khi `due_at < now()` và `status NOT IN ('Done', 'Cancelled')`.

### 7.4 Task priority

| Giá trị | Ý nghĩa |
| --- | --- |
| `Low` | Thấp |
| `Medium` | Trung bình |
| `High` | Cao |
| `Urgent` | Khẩn cấp |

### 7.5 Project member role

```text
Owner
Manager
Member
Viewer
```

### 7.6 Assignment role

```text
Main
CoAssignee
Reviewer
```

MVP bắt buộc có `Main`. `CoAssignee` và `Reviewer` có thể giữ thiết kế mở rộng.

---

## 8. DTO dùng chung

### 8.1 Employee summary DTO

```json
{
  "employee_id": "550e8400-e29b-41d4-a716-446655440000",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "department": {
    "id": "...",
    "name": "Phòng Kỹ thuật"
  },
  "position": {
    "id": "...",
    "name": "Developer"
  },
  "avatar_url": null
}
```

### 8.2 Project summary DTO

```json
{
  "project_id": "...",
  "project_code": "PRJ-0001",
  "name": "Triển khai hệ thống quản lý doanh nghiệp",
  "status": "Active",
  "priority": "High",
  "visibility": "Private",
  "owner": {},
  "start_date": "2026-06-20",
  "end_date": "2026-07-31",
  "progress_percent": 45.5,
  "member_count": 8,
  "task_count": 32,
  "overdue_task_count": 3
}
```

### 8.3 Task summary DTO

```json
{
  "task_id": "...",
  "task_code": "TASK-0001",
  "project": {
    "project_id": "...",
    "project_code": "PRJ-0001",
    "name": "Triển khai hệ thống quản lý doanh nghiệp"
  },
  "title": "Thiết kế API module TASK",
  "status": "In Progress",
  "priority": "High",
  "due_at": "2026-06-25T18:00:00+07:00",
  "is_overdue": false,
  "main_assignee": {},
  "created_by": {},
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

---

## 9. Chuẩn query list, search, filter, sort

### 9.1 Pagination

API list mặc định dùng:

```http
?page=1&per_page=20
```

Giới hạn đề xuất:

| Tham số | Mặc định | Tối đa |
| --- | ---: | ---: |
| `page` | 1 | - |
| `per_page` | 20 | 100 |

Với danh sách rất lớn như activity log, có thể hỗ trợ thêm cursor/keyset pagination ở phase sau.

---

### 9.2 Search

Tham số chung:

```http
?search=keyword
```

Search áp dụng theo whitelist:

| Resource | Field search |
| --- | --- |
| Project | `project_code`, `name`, `description` |
| Task | `task_code`, `title`, `description` |
| Comment | Không search mặc định trong MVP, có thể phase sau |

---

### 9.3 Filter project

```http
GET /api/v1/tasks/projects?status=Active&priority=High&owner_employee_id=...&department_id=...&visibility=Private&start_date_from=2026-06-01&start_date_to=2026-06-30
```

Filter whitelist:

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `status` | enum | Planning, Active, On Hold, Completed, Cancelled, Archived |
| `priority` | enum | Low, Medium, High, Urgent |
| `owner_employee_id` | UUID | Theo quyền/scope |
| `department_id` | UUID | Theo quyền/scope |
| `visibility` | enum | Private, Internal, Public |
| `start_date_from` | date | ISO date |
| `start_date_to` | date | ISO date |
| `end_date_from` | date | ISO date |
| `end_date_to` | date | ISO date |

---

### 9.4 Filter task

```http
GET /api/v1/tasks?project_id=...&status=Todo&priority=High&assignee_employee_id=...&due_from=2026-06-20&due_to=2026-06-30&is_overdue=true
```

Filter whitelist:

| Field | Kiểu | Ghi chú |
| --- | --- | --- |
| `project_id` | UUID | Nullable nếu task cá nhân |
| `status` | enum | Todo, In Progress, In Review, Done, Cancelled |
| `priority` | enum | Low, Medium, High, Urgent |
| `assignee_employee_id` | UUID | Theo data scope |
| `reporter_employee_id` | UUID | Người tạo/người báo cáo task |
| `watcher_employee_id` | UUID | Người theo dõi |
| `department_id` | UUID | Theo department snapshot hoặc assignee department |
| `due_from` | date/datetime | ISO 8601 |
| `due_to` | date/datetime | ISO 8601 |
| `is_overdue` | boolean | Tính động |
| `has_assignee` | boolean | Tìm task chưa giao |
| `created_from` | date/datetime | ISO 8601 |
| `created_to` | date/datetime | ISO 8601 |

---

### 9.5 Sort

Sort dùng format:

```http
?sort=created_at:desc,due_at:asc
```

Project sort whitelist:

```text
created_at
updated_at
start_date
end_date
priority
status
name
progress_percent
```

Task sort whitelist:

```text
created_at
updated_at
due_at
priority
status
title
```

---

## 10. Tổng quan endpoint

### 10.1 Project endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks/projects` | Danh sách dự án | `TASK.PROJECT.VIEW` |
| POST | `/api/v1/tasks/projects` | Tạo dự án | `TASK.PROJECT.CREATE` |
| GET | `/api/v1/tasks/projects/{project_id}` | Chi tiết dự án | `TASK.PROJECT.VIEW` |
| PATCH | `/api/v1/tasks/projects/{project_id}` | Cập nhật dự án | `TASK.PROJECT.UPDATE` |
| POST | `/api/v1/tasks/projects/{project_id}/close` | Đóng/hoàn thành dự án | `TASK.PROJECT.CLOSE` |
| POST | `/api/v1/tasks/projects/{project_id}/cancel` | Hủy dự án | `TASK.PROJECT.CLOSE` hoặc `TASK.PROJECT.UPDATE` |
| POST | `/api/v1/tasks/projects/{project_id}/archive` | Lưu trữ dự án | `TASK.PROJECT.ARCHIVE` |
| DELETE | `/api/v1/tasks/projects/{project_id}` | Xóa mềm dự án | `TASK.PROJECT.DELETE` |

### 10.2 Project member endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks/projects/{project_id}/members` | Danh sách member | `TASK.PROJECT.VIEW` |
| POST | `/api/v1/tasks/projects/{project_id}/members` | Thêm member | `TASK.PROJECT.MANAGE_MEMBER` |
| PATCH | `/api/v1/tasks/projects/{project_id}/members/{member_id}` | Cập nhật role member | `TASK.PROJECT.MANAGE_MEMBER` |
| DELETE | `/api/v1/tasks/projects/{project_id}/members/{member_id}` | Xóa member | `TASK.PROJECT.MANAGE_MEMBER` |

### 10.3 Task endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks` | Danh sách task | `TASK.TASK.VIEW` |
| POST | `/api/v1/tasks` | Tạo task | `TASK.TASK.CREATE` |
| GET | `/api/v1/tasks/my-tasks` | Việc của tôi | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/assigned-to-me` | Task được giao cho tôi | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/created-by-me` | Task tôi tạo | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/watching` | Task tôi theo dõi | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/overdue` | Task quá hạn | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/due-soon` | Task sắp đến hạn | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/{task_id}` | Chi tiết task | `TASK.TASK.VIEW` |
| PATCH | `/api/v1/tasks/{task_id}` | Cập nhật task | `TASK.TASK.UPDATE` |
| DELETE | `/api/v1/tasks/{task_id}` | Xóa mềm task | `TASK.TASK.DELETE` |

### 10.4 Task action endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| POST | `/api/v1/tasks/{task_id}/assign` | Giao/đổi assignee | `TASK.TASK.ASSIGN` |
| POST | `/api/v1/tasks/{task_id}/change-status` | Đổi trạng thái | `TASK.TASK.UPDATE_STATUS` |
| POST | `/api/v1/tasks/{task_id}/change-priority` | Đổi priority | `TASK.TASK.UPDATE_PRIORITY` |
| POST | `/api/v1/tasks/{task_id}/change-deadline` | Đổi deadline | `TASK.TASK.UPDATE_DEADLINE` |
| POST | `/api/v1/tasks/{task_id}/watchers` | Theo dõi task | `TASK.TASK.WATCH` |
| DELETE | `/api/v1/tasks/{task_id}/watchers/{watcher_id}` | Bỏ theo dõi task | `TASK.TASK.WATCH` |

### 10.5 Kanban, comment, checklist, file, activity endpoints

| Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks/projects/{project_id}/kanban` | Lấy Kanban board | `TASK.TASK.VIEW_KANBAN` |
| POST | `/api/v1/tasks/{task_id}/comments` | Tạo comment | `TASK.TASK.COMMENT` |
| PATCH | `/api/v1/tasks/{task_id}/comments/{comment_id}` | Sửa comment | `TASK.TASK.COMMENT` |
| DELETE | `/api/v1/tasks/{task_id}/comments/{comment_id}` | Xóa comment | `TASK.TASK.COMMENT` |
| GET | `/api/v1/tasks/{task_id}/checklists` | Danh sách checklist | `TASK.TASK.VIEW` |
| POST | `/api/v1/tasks/{task_id}/checklists` | Tạo checklist | `TASK.TASK.UPDATE` |
| POST | `/api/v1/tasks/{task_id}/files` | Upload file task | `TASK.TASK.FILE_UPLOAD` |
| GET | `/api/v1/tasks/{task_id}/activity-logs` | Xem activity task | `TASK.AUDIT_LOG.VIEW` hoặc `TASK.TASK.VIEW` |

---

## 11. Project API chi tiết

### 11.1 GET `/api/v1/tasks/projects` - Xem danh sách dự án

**Mục đích**  
Lấy danh sách project theo quyền và data scope.

**Required permission**  
`TASK.PROJECT.VIEW`

**Allowed roles**  
Super Admin, Admin công ty, HR nếu được cấp quyền, Manager, Project Manager, Employee là member.

**Data scope**  
`Own`, `Team`, `Department`, `Project`, `Company`, `System`

**Query params**

| Field | Bắt buộc | Mô tả |
| --- | --- | --- |
| `page` | Không | Trang hiện tại |
| `per_page` | Không | Số dòng/trang |
| `search` | Không | Tìm theo project_code, name |
| `status` | Không | Filter trạng thái |
| `priority` | Không | Filter priority |
| `owner_employee_id` | Không | Filter owner |
| `department_id` | Không | Filter phòng ban |
| `visibility` | Không | Filter visibility |
| `sort` | Không | Sort whitelist |

**Business validation**

1. Backend resolve `company_id` từ auth context.
2. Backend áp dụng data scope trước khi phân trang.
3. Project `Private` chỉ trả nếu user là member/owner hoặc có scope Company/System.
4. Không trả project đã `deleted_at` nếu không có endpoint riêng.

**Audit log**  
Không bắt buộc cho đọc danh sách, trừ khi công ty bật audit đọc dữ liệu nhạy cảm.

**Notification event**  
Không có.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy danh sách dự án thành công",
  "data": [
    {
      "project_id": "550e8400-e29b-41d4-a716-446655440000",
      "project_code": "PRJ-0001",
      "name": "Triển khai hệ thống quản lý doanh nghiệp",
      "status": "Active",
      "priority": "High",
      "visibility": "Private",
      "owner": {
        "employee_id": "...",
        "full_name": "Nguyễn Văn A"
      },
      "start_date": "2026-06-20",
      "end_date": "2026-07-31",
      "progress_percent": 45.5,
      "member_count": 8,
      "task_count": 32,
      "overdue_task_count": 3,
      "updated_at": "2026-06-20T10:00:00+07:00"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000101",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.2 POST `/api/v1/tasks/projects` - Tạo dự án

**Mục đích**  
Tạo project mới, có thể tạo kèm danh sách thành viên ban đầu.

**Required permission**  
`TASK.PROJECT.CREATE`

**Allowed roles**  
Super Admin, Admin công ty, Manager, Project Manager, HR nếu được cấp quyền.

**Data scope**  
`Team`, `Department`, `Company`, `System`

**Headers**

```http
Idempotency-Key: <uuid>
```

**Request body**

```json
{
  "name": "Triển khai hệ thống quản lý doanh nghiệp",
  "description": "Dự án triển khai hệ thống quản lý nội bộ MVP",
  "owner_employee_id": "550e8400-e29b-41d4-a716-446655440000",
  "department_id": "550e8400-e29b-41d4-a716-446655440001",
  "priority": "High",
  "visibility": "Private",
  "status": "Planning",
  "start_date": "2026-06-20",
  "end_date": "2026-07-31",
  "members": [
    {
      "employee_id": "550e8400-e29b-41d4-a716-446655440002",
      "project_role": "Manager"
    },
    {
      "employee_id": "550e8400-e29b-41d4-a716-446655440003",
      "project_role": "Member"
    }
  ]
}
```

**Validation**

| Field | Rule |
| --- | --- |
| `name` | Bắt buộc, 1-255 ký tự |
| `owner_employee_id` | Bắt buộc, UUID, employee active/probation |
| `priority` | Low/Medium/High/Urgent |
| `visibility` | Private/Internal/Public |
| `status` | Planning hoặc Active khi tạo, tùy cấu hình |
| `start_date`, `end_date` | `end_date >= start_date` nếu cả hai có giá trị |
| `members[].employee_id` | Không trùng, employee hợp lệ |
| `members[].project_role` | Owner/Manager/Member/Viewer |

**Business validation**

1. User có quyền tạo project trong scope được cấp.
2. Owner phải là employee đang làm việc hợp lệ.
3. Nếu scope Team, owner/member phải thuộc team user hoặc backend chỉ cho tạo project user là owner.
4. Nếu scope Department, owner/member phải thuộc department được phép.
5. Không thêm employee `Resigned`, `Terminated` vào project.
6. Backend sinh `project_code` bằng sequence service, không tin code từ frontend.
7. Tạo project và member phải nằm trong một transaction.

**Audit log / Activity log**

| Log | Nội dung |
| --- | --- |
| `audit_logs` | `TASK.PROJECT.CREATE` |
| `task_activity_logs` | `PROJECT_CREATED`, `PROJECT_MEMBER_ADDED` |

**Notification event**

| Event | Người nhận |
| --- | --- |
| `PROJECT_MEMBER_ADDED` | Thành viên được thêm |

**Response 201**

```json
{
  "success": true,
  "message": "Tạo dự án thành công",
  "data": {
    "project_id": "550e8400-e29b-41d4-a716-446655440000",
    "project_code": "PRJ-0001",
    "name": "Triển khai hệ thống quản lý doanh nghiệp",
    "status": "Planning",
    "created_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000102",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.3 GET `/api/v1/tasks/projects/{project_id}` - Xem chi tiết dự án

**Required permission**  
`TASK.PROJECT.VIEW`

**Data scope**  
`Own`, `Team`, `Department`, `Project`, `Company`, `System`

**Business validation**

1. Project phải tồn tại trong company hiện tại.
2. User phải có quyền xem project theo visibility và data scope.
3. Trả kèm summary task nhưng không trả toàn bộ danh sách task nếu không yêu cầu.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy chi tiết dự án thành công",
  "data": {
    "project_id": "...",
    "project_code": "PRJ-0001",
    "name": "Triển khai hệ thống quản lý doanh nghiệp",
    "description": "Dự án triển khai MVP",
    "status": "Active",
    "priority": "High",
    "visibility": "Private",
    "owner": {},
    "department": {},
    "start_date": "2026-06-20",
    "end_date": "2026-07-31",
    "progress_percent": 45.5,
    "summary": {
      "total_tasks": 32,
      "todo": 8,
      "in_progress": 12,
      "in_review": 4,
      "done": 8,
      "cancelled": 0,
      "overdue": 3
    },
    "created_at": "2026-06-20T10:00:00+07:00",
    "updated_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000103",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 11.4 PATCH `/api/v1/tasks/projects/{project_id}` - Cập nhật dự án

**Required permission**  
`TASK.PROJECT.UPDATE`

**Data scope**  
`Project`, `Team`, `Department`, `Company`, `System`

**Request body**

```json
{
  "name": "Triển khai hệ thống EMS MVP",
  "description": "Cập nhật phạm vi MVP",
  "owner_employee_id": "...",
  "department_id": "...",
  "priority": "High",
  "visibility": "Private",
  "start_date": "2026-06-20",
  "end_date": "2026-08-15"
}
```

**Business validation**

1. Project không được `Archived` hoặc `Cancelled` nếu cấu hình không cho sửa.
2. Nếu đổi owner, owner mới phải là employee hợp lệ.
3. Nếu đổi `end_date`, backend có thể cảnh báo task đang có `due_at` vượt quá ngày kết thúc project.
4. Project role Owner/Manager có thể sửa project trong phạm vi project nếu có permission hệ thống.

**Audit log / Activity log**

| Log | Nội dung |
| --- | --- |
| `audit_logs` | `TASK.PROJECT.UPDATE` nếu thay đổi trường quan trọng |
| `task_activity_logs` | `PROJECT_UPDATED` |

**Notification event**

`PROJECT_UPDATED` nếu thay đổi quan trọng và cấu hình bật thông báo.

---

### 11.5 POST `/api/v1/tasks/projects/{project_id}/close` - Đóng/hoàn thành dự án

**Required permission**  
`TASK.PROJECT.CLOSE`

**Request body**

```json
{
  "note": "Dự án đã hoàn tất MVP"
}
```

**Business validation**

1. Project phải ở `Active` hoặc `On Hold`.
2. Nếu còn task chưa Done/Cancelled, backend xử lý theo cấu hình:
   - Chặn đóng project.
   - Cho phép đóng nhưng cảnh báo.
   - Tự chuyển các task còn lại sang Cancelled nếu user xác nhận bằng flag riêng.
3. Ghi `completed_at`, `closed_at`, `closed_by`.

**Audit log / Activity log**

`PROJECT_STATUS_CHANGED`, `PROJECT_CLOSED`

**Notification event**

`PROJECT_CLOSED` gửi cho owner, manager, member liên quan.

---

### 11.6 POST `/api/v1/tasks/projects/{project_id}/cancel` - Hủy dự án

**Required permission**  
`TASK.PROJECT.CLOSE` hoặc `TASK.PROJECT.UPDATE` tùy policy.

**Request body**

```json
{
  "cancel_reason": "Không tiếp tục triển khai trong MVP"
}
```

**Business validation**

1. `cancel_reason` bắt buộc.
2. Project chưa được `Completed` hoặc `Archived`.
3. Nếu còn task active, backend có thể tự chuyển task sang `Cancelled` hoặc yêu cầu xử lý trước theo cấu hình.
4. Ghi `cancelled_at`, `cancelled_by`, `cancel_reason`.

**Notification event**

`PROJECT_CANCELLED`

---

### 11.7 POST `/api/v1/tasks/projects/{project_id}/archive` - Lưu trữ dự án

**Required permission**  
`TASK.PROJECT.ARCHIVE`

**Business validation**

1. Chỉ project `Completed` hoặc `Cancelled` nên được archive.
2. Archive không xóa dữ liệu, chỉ ẩn khỏi danh sách mặc định.
3. Ghi `archived_at`, `archived_by`.

**Notification event**

`PROJECT_ARCHIVED` nếu cấu hình bật.

---

### 11.8 DELETE `/api/v1/tasks/projects/{project_id}` - Xóa mềm dự án

**Required permission**  
`TASK.PROJECT.DELETE`

**Business validation**

1. Chỉ cho xóa mềm nếu project chưa có dữ liệu nhạy cảm hoặc policy cho phép.
2. Nếu project có task, backend xử lý theo policy:
   - Chặn xóa.
   - Cho phép xóa mềm cascade logic sang task.
3. Không xóa cứng `projects`, `project_members`, `tasks`, `task_activity_logs`.

**Audit log / Activity log**

`PROJECT_DELETED`

---

## 12. Project Member API chi tiết

### 12.1 GET `/api/v1/tasks/projects/{project_id}/members`

**Required permission**  
`TASK.PROJECT.VIEW`

**Business validation**

1. User xem được project mới xem được member.
2. Không trả member đã bị xóa/removed nếu không có tham số `include_removed=true` và quyền phù hợp.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy danh sách thành viên dự án thành công",
  "data": [
    {
      "member_id": "...",
      "employee": {},
      "project_role": "Owner",
      "joined_at": "2026-06-20T10:00:00+07:00",
      "added_by": {}
    }
  ],
  "meta": {
    "request_id": "req_20260620_000201",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 12.2 POST `/api/v1/tasks/projects/{project_id}/members`

**Required permission**  
`TASK.PROJECT.MANAGE_MEMBER`

**Headers**

```http
Idempotency-Key: <uuid>
```

**Request body**

```json
{
  "members": [
    {
      "employee_id": "...",
      "project_role": "Member"
    }
  ]
}
```

**Business validation**

1. Project phải tồn tại và chưa bị archived/cancelled nếu policy không cho sửa.
2. Employee phải active/probation.
3. Không thêm trùng member đang active.
4. User phải có quyền quản lý member theo RBAC và project role.
5. Nếu project visibility là Private, member mới mới được xem project sau khi thêm.

**Audit log / Activity log**

`PROJECT_MEMBER_ADDED`

**Notification event**

`PROJECT_MEMBER_ADDED` gửi cho member mới.

---

### 12.3 PATCH `/api/v1/tasks/projects/{project_id}/members/{member_id}`

**Required permission**  
`TASK.PROJECT.MANAGE_MEMBER`

**Request body**

```json
{
  "project_role": "Manager"
}
```

**Business validation**

1. Không được hạ role Owner cuối cùng của project nếu không có Owner thay thế.
2. Không được tự hạ quyền bản thân nếu điều đó khiến project không còn người quản lý.
3. Role mới phải hợp lệ.

**Activity log**  
`PROJECT_MEMBER_ROLE_CHANGED`

**Notification event**  
`PROJECT_MEMBER_ROLE_CHANGED`

---

### 12.4 DELETE `/api/v1/tasks/projects/{project_id}/members/{member_id}`

**Required permission**  
`TASK.PROJECT.MANAGE_MEMBER`

**Business validation**

1. Không xóa Owner cuối cùng.
2. Nếu member đang là assignee của task chưa hoàn thành, backend xử lý theo policy:
   - Chặn xóa.
   - Cho xóa nhưng cảnh báo danh sách task liên quan.
   - Cho xóa và giữ assignee hiện tại, nhưng member mất quyền xem project nếu không còn relation khác.
3. Soft remove bằng `removed_at`, `removed_by`, không xóa cứng.

**Activity log**  
`PROJECT_MEMBER_REMOVED`

**Notification event**  
`PROJECT_MEMBER_REMOVED`

---

## 13. Task API chi tiết

### 13.1 GET `/api/v1/tasks` - Xem danh sách task

**Required permission**  
`TASK.TASK.VIEW`

**Data scope**  
`Own`, `Team`, `Department`, `Project`, `Company`, `System`

**Query params**

| Field | Mô tả |
| --- | --- |
| `page`, `per_page` | Phân trang |
| `search` | Search task_code/title/description |
| `project_id` | Lọc theo project |
| `status` | Todo/In Progress/In Review/Done/Cancelled |
| `priority` | Low/Medium/High/Urgent |
| `assignee_employee_id` | Lọc assignee |
| `reporter_employee_id` | Lọc reporter |
| `watcher_employee_id` | Lọc watcher |
| `department_id` | Lọc department |
| `due_from`, `due_to` | Lọc deadline |
| `is_overdue` | true/false |
| `has_assignee` | true/false |
| `sort` | Sort whitelist |

**Business validation**

1. Backend áp dụng data scope trước khi phân trang.
2. Nếu filter `assignee_employee_id`, user vẫn chỉ thấy dữ liệu trong scope.
3. `is_overdue=true` được tính động từ `due_at` và `status`.
4. Không trả task thuộc project `Private` nếu user không có quyền xem project.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy danh sách task thành công",
  "data": [
    {
      "task_id": "...",
      "task_code": "TASK-0001",
      "title": "Thiết kế API module TASK",
      "project": {
        "project_id": "...",
        "project_code": "PRJ-0001",
        "name": "EMS MVP"
      },
      "status": "In Progress",
      "priority": "High",
      "due_at": "2026-06-25T18:00:00+07:00",
      "is_overdue": false,
      "main_assignee": {},
      "watcher_count": 3,
      "comment_count": 5,
      "checklist_summary": {
        "total": 8,
        "done": 3
      },
      "updated_at": "2026-06-20T10:00:00+07:00"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 1,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  },
  "meta": {
    "request_id": "req_20260620_000301",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 13.2 POST `/api/v1/tasks` - Tạo task

**Required permission**  
`TASK.TASK.CREATE`

**Headers**

```http
Idempotency-Key: <uuid>
```

**Request body**

```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "parent_task_id": null,
  "title": "Thiết kế API module TASK",
  "description": "Viết tài liệu API-06 chi tiết cho module TASK",
  "priority": "High",
  "status": "Todo",
  "main_assignee_employee_id": "550e8400-e29b-41d4-a716-446655440001",
  "watcher_employee_ids": [
    "550e8400-e29b-41d4-a716-446655440002"
  ],
  "start_at": "2026-06-20T09:00:00+07:00",
  "due_at": "2026-06-25T18:00:00+07:00",
  "estimated_minutes": 480,
  "checklists": [
    {
      "title": "Checklist triển khai",
      "items": [
        "Xác định endpoint",
        "Viết request/response",
        "Bổ sung permission"
      ]
    }
  ]
}
```

**Validation**

| Field | Rule |
| --- | --- |
| `project_id` | UUID, nullable nếu company cho phép task cá nhân |
| `title` | Bắt buộc, 1-255 ký tự |
| `description` | Không bắt buộc |
| `priority` | Low/Medium/High/Urgent |
| `status` | Mặc định Todo, không cho tạo trực tiếp Done nếu policy không cho phép |
| `main_assignee_employee_id` | UUID, employee hợp lệ, nullable nếu policy cho phép task chưa giao |
| `watcher_employee_ids` | Danh sách UUID, không trùng |
| `start_at`, `due_at` | `due_at >= start_at` nếu cả hai có giá trị |
| `estimated_minutes` | Số nguyên >= 0 |
| `checklists[].title` | Không rỗng |
| `checklists[].items[]` | Không rỗng |

**Business validation**

1. Nếu có `project_id`, user phải có quyền tạo task trong project đó.
2. Nếu `project_id = null`, company setting phải cho phép task cá nhân.
3. Assignee phải là employee đang làm việc hợp lệ.
4. Nếu task thuộc project, assignee nên là project member; nếu không phải member thì:
   - Chặn, hoặc
   - Cho phép và tự thêm member, tùy company setting.
5. Nếu assignee đang nghỉ phép trong khoảng deadline, backend trả warning trong response hoặc validation warning tùy cấu hình, không bắt buộc chặn MVP.
6. Nếu `due_at` vượt quá `project.end_date`, backend trả warning hoặc chặn theo cấu hình.
7. Backend sinh `task_code` bằng sequence service.
8. Tạo task, assignee, watcher, checklist phải nằm trong một transaction.

**Audit log / Activity log**

| Log | Nội dung |
| --- | --- |
| `audit_logs` | `TASK.TASK.CREATE` nếu cấu hình audit thao tác task |
| `task_activity_logs` | `TASK_CREATED`, `TASK_ASSIGNED`, `TASK_CHECKLIST_CREATED` |

**Notification event**

| Event | Người nhận |
| --- | --- |
| `TASK_ASSIGNED` | Main assignee |
| `TASK_WATCHER_ADDED` | Watcher mới nếu cấu hình bật |

**Response 201**

```json
{
  "success": true,
  "message": "Tạo task thành công",
  "data": {
    "task_id": "550e8400-e29b-41d4-a716-446655440010",
    "task_code": "TASK-0001",
    "title": "Thiết kế API module TASK",
    "status": "Todo",
    "priority": "High",
    "main_assignee": {},
    "created_at": "2026-06-20T10:00:00+07:00",
    "warnings": [
      {
        "code": "TASK-WARN-ASSIGNEE-ON-LEAVE",
        "message": "Assignee có lịch nghỉ trùng một phần với thời hạn task"
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000302",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 13.3 GET `/api/v1/tasks/my-tasks` - Xem việc của tôi

**Required permission**  
`TASK.TASK.VIEW`

**Data scope**  
`Own`

**Mục đích**  
Lấy các task liên quan trực tiếp đến user hiện tại:

1. Task được giao.
2. Task user tạo.
3. Task user đang theo dõi.
4. Task thuộc project user là member.

**Query params**

```http
GET /api/v1/tasks/my-tasks?status=Todo&priority=High&is_overdue=false&sort=due_at:asc
```

**Business validation**

1. User phải liên kết với employee nếu muốn lấy assignee/watcher/member theo employee.
2. Nếu user chưa liên kết employee, chỉ trả task tạo bởi user nếu có.

---

### 13.4 GET `/api/v1/tasks/{task_id}` - Xem chi tiết task

**Required permission**  
`TASK.TASK.VIEW`

**Data scope**  
`Own`, `Team`, `Department`, `Project`, `Company`, `System`

**Business validation**

1. Task phải thuộc company hiện tại.
2. User phải có quyền xem task theo scope hoặc project membership.
3. Nếu task thuộc project Private, user phải là member/relation hợp lệ hoặc có scope Company/System.
4. File private chỉ trả metadata, không trả storage path.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy chi tiết task thành công",
  "data": {
    "task_id": "...",
    "task_code": "TASK-0001",
    "project": {},
    "parent_task": null,
    "title": "Thiết kế API module TASK",
    "description": "Viết tài liệu API-06",
    "status": "In Progress",
    "priority": "High",
    "start_at": "2026-06-20T09:00:00+07:00",
    "due_at": "2026-06-25T18:00:00+07:00",
    "is_overdue": false,
    "estimated_minutes": 480,
    "main_assignee": {},
    "assignees": [],
    "watchers": [],
    "checklist_summary": {
      "total": 8,
      "done": 3
    },
    "file_count": 2,
    "comment_count": 5,
    "created_by": {},
    "created_at": "2026-06-20T10:00:00+07:00",
    "updated_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000303",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 13.5 PATCH `/api/v1/tasks/{task_id}` - Cập nhật thông tin task

**Required permission**  
`TASK.TASK.UPDATE`

**Request body**

```json
{
  "title": "Thiết kế API-06 TASK",
  "description": "Bổ sung endpoint Kanban, comment, checklist",
  "priority": "Urgent",
  "start_at": "2026-06-20T09:00:00+07:00",
  "due_at": "2026-06-24T18:00:00+07:00",
  "estimated_minutes": 600
}
```

**Business validation**

1. Task không được `Done` hoặc `Cancelled` nếu policy không cho sửa.
2. Nếu user chỉ là assignee, có thể giới hạn chỉ sửa một số trường như description/checklist/status theo cấu hình.
3. Nếu đổi `due_at`, kiểm tra trùng lịch nghỉ của assignee và `project.end_date` để cảnh báo.
4. Nếu đổi priority, có thể yêu cầu permission `TASK.TASK.UPDATE_PRIORITY` tùy cấu hình.
5. Nếu đổi deadline, có thể yêu cầu permission `TASK.TASK.UPDATE_DEADLINE` tùy cấu hình.

**Activity log**

`TASK_UPDATED`, `TASK_PRIORITY_CHANGED`, `TASK_DUE_DATE_CHANGED`

**Notification event**

`TASK_UPDATED` gửi cho assignee, watcher, creator nếu cấu hình bật.

---

### 13.6 DELETE `/api/v1/tasks/{task_id}` - Xóa mềm task

**Required permission**  
`TASK.TASK.DELETE`

**Business validation**

1. Không xóa cứng task.
2. Nếu task có sub-task active, backend chặn hoặc xóa mềm cascade theo cấu hình.
3. Nếu task đã Done, chỉ Owner/Manager/Admin có quyền phù hợp được xóa nếu policy cho phép.
4. Ghi `deleted_at`, `deleted_by`.

**Activity log**  
`TASK_DELETED`

**Notification event**  
`TASK_DELETED` nếu cấu hình bật.

---

## 14. Task action API chi tiết

### 14.1 POST `/api/v1/tasks/{task_id}/assign` - Giao/đổi assignee

**Required permission**  
`TASK.TASK.ASSIGN`

**Headers**

```http
Idempotency-Key: <uuid>
```

**Request body**

```json
{
  "main_assignee_employee_id": "550e8400-e29b-41d4-a716-446655440001",
  "co_assignee_employee_ids": [
    "550e8400-e29b-41d4-a716-446655440002"
  ],
  "reason": "Điều phối lại nhân sự xử lý task"
}
```

**Business validation**

1. Assignee mới phải là employee hợp lệ, chưa nghỉ việc/chấm dứt.
2. Nếu task thuộc project, assignee mới phải là member hoặc backend xử lý tự thêm member theo setting.
3. Không giao task cho employee không thuộc scope người giao việc.
4. Nếu assignee đang nghỉ phép hoặc deadline nằm trong kỳ nghỉ đã duyệt, backend trả warning.
5. Cập nhật `tasks.main_assignee_employee_id` và `task_assignees` nhất quán trong transaction.

**Activity log**  
`TASK_ASSIGNED` hoặc `TASK_ASSIGNEE_CHANGED`

**Notification event**

| Event | Người nhận |
| --- | --- |
| `TASK_ASSIGNED` | Assignee mới |
| `TASK_ASSIGNEE_CHANGED` | Assignee cũ, assignee mới, watcher nếu cấu hình |

---

### 14.2 POST `/api/v1/tasks/{task_id}/change-status` - Cập nhật trạng thái task

**Required permission**  
`TASK.TASK.UPDATE_STATUS`

**Headers**

```http
Idempotency-Key: <uuid>
```

**Request body**

```json
{
  "status": "In Review",
  "note": "Đã hoàn thành phần thiết kế, chờ review"
}
```

**Business validation**

1. Trạng thái mới phải hợp lệ.
2. Backend kiểm tra workflow chuyển trạng thái:

```text
Todo        -> In Progress | Cancelled
In Progress -> In Review | Done | Cancelled
In Review   -> In Progress | Done | Cancelled
Done        -> In Progress (reopen, chỉ khi policy cho phép)
Cancelled   -> (terminal; không reopen)
```

Bảng transition chuẩn theo SPEC-06; API-06 conform.

1. Nếu chuyển sang `Done` và company setting yêu cầu checklist hoàn thành, tất cả checklist item bắt buộc phải done.
2. Nếu task thuộc project Archived/Cancelled, không cho đổi trạng thái.
3. Assignee có thể đổi trạng thái task của mình nếu có quyền và scope.

**Activity log**  
`TASK_STATUS_CHANGED`

**Notification event**

`TASK_STATUS_CHANGED`, `TASK_COMPLETED` nếu status = Done.

---

### 14.3 POST `/api/v1/tasks/{task_id}/change-priority`

**Required permission**  
`TASK.TASK.UPDATE_PRIORITY`

**Request body**

```json
{
  "priority": "Urgent",
  "reason": "Cần hoàn thành trước buổi họp"
}
```

**Business validation**

1. Priority phải thuộc enum hợp lệ.
2. Nếu nâng lên `Urgent`, có thể yêu cầu note/reason theo cấu hình.

**Activity log**  
`TASK_PRIORITY_CHANGED`

**Notification event**  
`TASK_PRIORITY_CHANGED` nếu cấu hình bật.

---

### 14.4 POST `/api/v1/tasks/{task_id}/change-deadline`

**Required permission**  
`TASK.TASK.UPDATE_DEADLINE`

**Request body**

```json
{
  "due_at": "2026-06-24T18:00:00+07:00",
  "reason": "Rút ngắn deadline theo yêu cầu quản lý"
}
```

**Business validation**

1. `due_at` không được trước `start_at` nếu có.
2. Nếu task thuộc project, deadline không nên vượt quá `project.end_date`; chặn hoặc warning theo cấu hình.
3. Nếu deadline trùng kỳ nghỉ approved của assignee, trả warning.
4. Nếu rút ngắn deadline, có thể yêu cầu reason.

**Activity log**  
`TASK_DUE_DATE_CHANGED`

**Notification event**  
`TASK_DUE_DATE_CHANGED`

---

### 14.5 POST `/api/v1/tasks/{task_id}/watchers`

**Required permission**  
`TASK.TASK.WATCH`

**Business validation**

1. User phải xem được task.
2. Nếu đã watch, trả success idempotent, không tạo trùng.
3. Tạo `task_watchers` theo employee hiện tại hoặc `employee_id` trong body nếu được phép thêm watcher khác.

**Activity log**  
`TASK_WATCHER_ADDED`

---

### 14.6 DELETE `/api/v1/tasks/{task_id}/watchers/{watcher_id}`

**Required permission**  
`TASK.TASK.WATCH`

**Business validation**

1. `watcher_id` phải là watcher hợp lệ của task.
2. Nếu không watch, có thể trả success idempotent.
3. Soft remove watcher bằng `removed_at` nếu cần truy vết.

**Activity log**  
`TASK_WATCHER_REMOVED`

---

## 15. Kanban API

### 15.1 GET `/api/v1/tasks/projects/{project_id}/kanban` - Lấy Kanban board

**Required permission**  
`TASK.TASK.VIEW_KANBAN`

**Query params**

| Field | Mô tả |
| --- | --- |
| `assignee_employee_id` | Lọc assignee |
| `priority` | Lọc priority |
| `due_from`, `due_to` | Lọc deadline |
| `include_done` | Có lấy Done hay không |
| `include_cancelled` | Có lấy Cancelled hay không |

**Business validation**

1. User phải xem được project.
2. Board chỉ trả task trong project đó.
3. Nếu user không có `TASK.TASK.UPDATE_STATUS`, frontend chỉ cho xem, không cho kéo thả.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy Kanban board thành công",
  "data": {
    "project": {
      "project_id": "...",
      "name": "EMS MVP"
    },
    "columns": [
      {
        "status": "Todo",
        "title": "Cần làm",
        "total": 8,
        "tasks": []
      },
      {
        "status": "In Progress",
        "title": "Đang làm",
        "total": 12,
        "tasks": []
      },
      {
        "status": "In Review",
        "title": "Chờ kiểm tra",
        "total": 4,
        "tasks": []
      },
      {
        "status": "Done",
        "title": "Hoàn thành",
        "total": 8,
        "tasks": []
      }
    ],
    "permissions": {
      "can_drag_drop": true,
      "can_create_task": true
    }
  },
  "meta": {
    "request_id": "req_20260620_000401",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 15.2 POST `/api/v1/tasks/{task_id}/change-status` dùng cho kéo thả

Kanban drag/drop không có endpoint riêng trong MVP. Frontend gọi lại endpoint đổi trạng thái task.

Quy tắc:

1. Kéo thả từ cột này sang cột khác gọi `POST /api/v1/tasks/{task_id}/change-status`.
2. Backend kiểm tra workflow hợp lệ.
3. Nếu frontend có thứ tự task trong cột, phase sau có thể bổ sung `order_index` và endpoint reorder.

---

## 16. Task Comment API

### 16.1 GET `/api/v1/tasks/{task_id}/comments`

**Required permission**  
`TASK.TASK.VIEW`

**Query params**

```http
?page=1&per_page=20&sort=created_at:asc
```

**Business validation**

1. User phải xem được task.
2. Comment deleted chỉ hiển thị dạng placeholder nếu policy yêu cầu.

---

### 16.2 POST `/api/v1/tasks/{task_id}/comments`

**Required permission**  
`TASK.TASK.COMMENT`

**Request body**

```json
{
  "content": "Mình đã cập nhật xong phần endpoint Kanban.",
  "mention_employee_ids": [
    "550e8400-e29b-41d4-a716-446655440001"
  ]
}
```

**Validation**

1. `content` bắt buộc, không được rỗng.
2. `content` giới hạn độ dài theo cấu hình, ví dụ 5000 ký tự.
3. Mention list không trùng.

**Business validation**

1. Chỉ user xem được task mới comment được.
2. Người được mention phải xem được task; nếu không, backend trả warning hoặc validation error theo cấu hình.
3. Comment dùng soft delete khi xóa.
4. Không đưa nội dung comment dài vào notification payload.

**Activity log**  
`TASK_COMMENT_CREATED`

**Notification event**

| Event | Người nhận |
| --- | --- |
| `TASK_COMMENT_CREATED` | Assignee/watcher nếu cấu hình |
| `TASK_MENTIONED` | Người được mention |

**Response 201**

```json
{
  "success": true,
  "message": "Tạo bình luận thành công",
  "data": {
    "comment_id": "...",
    "task_id": "...",
    "content": "Mình đã cập nhật xong phần endpoint Kanban.",
    "created_by": {},
    "mentions": [],
    "created_at": "2026-06-20T10:00:00+07:00"
  },
  "meta": {
    "request_id": "req_20260620_000501",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

### 16.3 PATCH `/api/v1/tasks/{task_id}/comments/{comment_id}`

**Required permission**  
`TASK.TASK.COMMENT`

**Request body**

```json
{
  "content": "Cập nhật nội dung bình luận sau khi review.",
  "mention_employee_ids": []
}
```

**Business validation**

1. Người tạo comment được sửa comment của chính mình nếu cấu hình cho phép.
2. Manager/Admin có thể sửa comment người khác chỉ khi có quyền nâng cao, nếu MVP không hỗ trợ thì chặn.
3. Comment đã bị xóa không được sửa.

**Activity log**  
`TASK_COMMENT_UPDATED`

---

### 16.4 DELETE `/api/v1/tasks/{task_id}/comments/{comment_id}`

**Required permission**  
`TASK.TASK.COMMENT`

**Business validation**

1. Người tạo comment được xóa comment của chính mình nếu cấu hình cho phép.
2. Project Owner/Manager hoặc Admin có thể xóa comment nếu có quyền phù hợp.
3. Xóa mềm comment, không xóa cứng.

**Activity log**  
`TASK_COMMENT_DELETED`

---

## 17. Checklist API

### 17.1 GET `/api/v1/tasks/{task_id}/checklists`

**Required permission**  
`TASK.TASK.VIEW`

**Business validation**  
User phải xem được task.

---

### 17.2 POST `/api/v1/tasks/{task_id}/checklists`

**Required permission**  
`TASK.TASK.UPDATE`

**Request body**

```json
{
  "title": "Checklist triển khai API",
  "items": [
    "Viết endpoint list",
    "Viết endpoint detail",
    "Viết validation",
    "Viết test case"
  ]
}
```

**Business validation**

1. Task chưa bị Done/Cancelled nếu cấu hình không cho sửa checklist sau khi đóng.
2. `title` và item không được rỗng.
3. `order_index` do backend tự tính nếu không truyền.

**Activity log**  
`TASK_CHECKLIST_CREATED`

---

### 17.3 PATCH `/api/v1/tasks/{task_id}/checklists/{checklist_id}`

**Required permission**  
`TASK.TASK.UPDATE`

**Request body**

```json
{
  "title": "Checklist review API",
  "order_index": 2
}
```

**Activity log**  
`TASK_CHECKLIST_UPDATED`

---

### 17.4 DELETE `/api/v1/tasks/{task_id}/checklists/{checklist_id}`

**Required permission**  
`TASK.TASK.UPDATE`

**Business validation**

1. Xóa mềm checklist và item.
2. Nếu task đã Done, chặn nếu policy không cho sửa.

**Activity log**  
`TASK_CHECKLIST_DELETED`

---

### 17.5 POST `/api/v1/tasks/{task_id}/checklists/{checklist_id}/items`

**Required permission**  
`TASK.TASK.UPDATE`

**Request body**

```json
{
  "title": "Bổ sung error code",
  "order_index": 4
}
```

**Activity log**  
`TASK_CHECKLIST_ITEM_CREATED`

---

### 17.6 PATCH `/api/v1/tasks/{task_id}/checklists/{checklist_id}/items/{item_id}`

**Required permission**  
`TASK.TASK.UPDATE`

**Request body**

```json
{
  "title": "Bổ sung error code TASK",
  "is_done": true,
  "order_index": 4
}
```

**Business validation**

1. Assignee có thể tick `is_done=true` nếu cấu hình cho phép.
2. Khi `is_done=true`, backend tự ghi `done_by`, `done_at`.
3. Khi `is_done=false`, backend có thể clear `done_by`, `done_at` hoặc ghi lịch sử theo policy.

**Activity log**

`TASK_CHECKLIST_ITEM_DONE` hoặc `TASK_CHECKLIST_ITEM_UPDATED`

---

### 17.7 DELETE `/api/v1/tasks/{task_id}/checklists/{checklist_id}/items/{item_id}`

**Required permission**  
`TASK.TASK.UPDATE`

**Activity log**  
`TASK_CHECKLIST_ITEM_DELETED`

---

## 18. File API

### 18.1 Project file API

#### POST `/api/v1/tasks/projects/{project_id}/files`

**Required permission**  
`TASK.PROJECT.FILE_UPLOAD`

**Content-Type**  
`multipart/form-data`

**Form data**

| Field | Bắt buộc | Mô tả |
| --- | --- | --- |
| `file` | Có | File upload |
| `description` | Không | Mô tả file |
| `file_category` | Không | Tài liệu, hợp đồng, thiết kế, khác |

**Business validation**

1. User phải xem được project và có quyền upload file.
2. File upload dùng file service chung.
3. File private là mặc định.
4. Kiểm tra MIME type, dung lượng, extension theo setting.
5. Không trả storage path private.

**Activity log**  
`PROJECT_FILE_UPLOADED`

---

#### GET `/api/v1/tasks/projects/{project_id}/files`

**Required permission**  
`TASK.PROJECT.VIEW`

Trả metadata file. Link tải phải lấy qua endpoint download riêng hoặc file service có kiểm quyền.

---

#### DELETE `/api/v1/tasks/projects/{project_id}/files/{file_id}`

**Required permission**  
`TASK.PROJECT.FILE_DELETE`

**Business validation**

1. Xóa liên kết file bằng soft delete.
2. Không xóa binary nếu file còn liên kết entity khác.
3. Ghi file access/audit log nếu file nhạy cảm.

**Activity log**  
`PROJECT_FILE_DELETED`

---

### 18.2 Task file API

#### POST `/api/v1/tasks/{task_id}/files`

**Required permission**  
`TASK.TASK.FILE_UPLOAD`

**Content-Type**  
`multipart/form-data`

**Business validation**

1. User phải xem được task và có quyền upload file.
2. Task chưa bị xóa mềm.
3. File dùng service chung.
4. File bị xóa là soft delete.

**Activity log**  
`TASK_FILE_UPLOADED`

**Notification event**  
`TASK_FILE_UPLOADED` nếu cấu hình bật.

---

#### GET `/api/v1/tasks/{task_id}/files`

**Required permission**  
`TASK.TASK.VIEW`

**Response 200**

```json
{
  "success": true,
  "message": "Lấy danh sách file task thành công",
  "data": [
    {
      "file_id": "...",
      "file_name": "api-06-task-design.pdf",
      "mime_type": "application/pdf",
      "size_bytes": 102400,
      "uploaded_by": {},
      "uploaded_at": "2026-06-20T10:00:00+07:00"
    }
  ],
  "meta": {
    "request_id": "req_20260620_000601",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

#### GET `/api/v1/tasks/{task_id}/files/{file_id}/download-url`

**Required permission**  
`TASK.TASK.VIEW`

**Business validation**

1. User phải xem được task.
2. File phải thuộc task.
3. Backend kiểm tra permission trước khi cấp signed URL.
4. Signed URL có TTL ngắn, ví dụ 5 phút.
5. Ghi `file_access_logs` nếu file nhạy cảm.

---

#### DELETE `/api/v1/tasks/{task_id}/files/{file_id}`

**Required permission**  
`TASK.TASK.FILE_DELETE`

**Activity log**  
`TASK_FILE_DELETED`

---

## 19. Activity API

### 19.1 GET `/api/v1/tasks/{task_id}/activity-logs`

**Required permission**  
`TASK.AUDIT_LOG.VIEW` hoặc `TASK.TASK.VIEW` tùy policy.

**Query params**

| Field | Mô tả |
| --- | --- |
| `page`, `per_page` | Phân trang |
| `activity_type` | Filter loại hoạt động |
| `actor_user_id` | Filter người thao tác |
| `from`, `to` | Khoảng thời gian |

**Business validation**

1. User phải xem được task.
2. Nếu log chứa dữ liệu nhạy cảm, cần permission `TASK.AUDIT_LOG.VIEW`.
3. Log là append-only, không sửa/xóa qua API nghiệp vụ.

---

### 19.2 GET `/api/v1/tasks/projects/{project_id}/activity-logs`

**Required permission**  
`TASK.AUDIT_LOG.VIEW` hoặc `TASK.PROJECT.VIEW` tùy policy.

Trả activity của project và các task thuộc project nếu `include_tasks=true`.

---

## 20. Report API

### 20.1 GET `/api/v1/tasks/projects/{project_id}/report`

**Required permission**  
`TASK.PROJECT.VIEW_REPORT`

**Mục đích**  
Lấy báo cáo tiến độ dự án cơ bản.

**Response 200**

```json
{
  "success": true,
  "message": "Lấy báo cáo dự án thành công",
  "data": {
    "project_id": "...",
    "project_code": "PRJ-0001",
    "name": "EMS MVP",
    "progress_percent": 45.5,
    "task_summary": {
      "total": 32,
      "todo": 8,
      "in_progress": 12,
      "in_review": 4,
      "done": 8,
      "cancelled": 0,
      "overdue": 3,
      "unassigned": 1
    },
    "priority_summary": {
      "low": 3,
      "medium": 12,
      "high": 14,
      "urgent": 3
    },
    "assignee_summary": [
      {
        "employee": {},
        "total": 8,
        "done": 3,
        "overdue": 1
      }
    ]
  },
  "meta": {
    "request_id": "req_20260620_000701",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

**Business validation**

1. User phải xem được project và có quyền report.
2. Report chỉ là dữ liệu tổng hợp, không thay đổi dữ liệu gốc.
3. Có thể cache ngắn hạn nếu query nặng.

---

### 20.2 GET `/api/v1/tasks/reports/summary`

**Required permission**  
`TASK.PROJECT.VIEW_REPORT` hoặc `TASK.TASK.VIEW`

**Query params**

| Field | Mô tả |
| --- | --- |
| `scope` | `my`, `team`, `department`, `company` |
| `from`, `to` | Khoảng thời gian |
| `department_id` | Filter department nếu có quyền |
| `project_id` | Filter project |

**Business validation**

1. Scope query không được vượt data scope của permission.
2. Manager scope Team chỉ xem task của team hoặc project được tham gia/quản lý.
3. HR/Admin scope Company xem toàn công ty nếu được cấp quyền.

---

## 21. Export API

### 21.1 GET `/api/v1/tasks/export`

**Required permission**  
`TASK.TASK.EXPORT`

**Query params**  
Giống `GET /api/v1/tasks`.

**Business validation**

1. Export phải áp dụng cùng filter và data scope như list API.
2. Giới hạn số dòng export đồng bộ, ví dụ tối đa 10.000 dòng.
3. Nếu vượt giới hạn, backend tạo async export job ở phase sau.
4. Ghi audit log bắt buộc.
5. Không export dữ liệu người dùng không có quyền xem.

**Audit log**  
`TASK.TASK.EXPORT`

---

### 21.2 GET `/api/v1/tasks/projects/export`

**Required permission**  
`TASK.PROJECT.VIEW_REPORT` hoặc permission export project riêng nếu tách sau.

**Business validation**

1. Áp dụng scope project.
2. Ghi audit log.

---

## 22. Notification event từ TASK

### 22.1 Danh sách event MVP

| Event code | Khi nào phát sinh | Người nhận gợi ý |
| --- | --- | --- |
| `PROJECT_CREATED` | Project mới được tạo | Owner nếu khác actor, Admin/Manager nếu cấu hình |
| `PROJECT_UPDATED` | Project thay đổi quan trọng | Owner, Manager, Member nếu cấu hình |
| `PROJECT_MEMBER_ADDED` | Thêm member | Member mới |
| `PROJECT_MEMBER_REMOVED` | Xóa member | Member bị xóa |
| `PROJECT_MEMBER_ROLE_CHANGED` | Đổi role member | Member bị đổi role |
| `PROJECT_CLOSED` | Project hoàn thành/đóng | Owner, Manager, Member |
| `PROJECT_CANCELLED` | Project bị hủy | Owner, Manager, Member |
| `PROJECT_ARCHIVED` | Project bị lưu trữ | Owner, Manager nếu cấu hình |
| `TASK_CREATED` | Task được tạo | Assignee/watcher nếu cấu hình |
| `TASK_ASSIGNED` | User được giao task | Assignee mới |
| `TASK_ASSIGNEE_CHANGED` | Đổi assignee | Assignee cũ, assignee mới, watcher |
| `TASK_UPDATED` | Task thay đổi quan trọng | Assignee, watcher, creator |
| `TASK_STATUS_CHANGED` | Task đổi trạng thái | Assignee, watcher, creator |
| `TASK_COMPLETED` | Task Done | Creator, watcher, project manager |
| `TASK_PRIORITY_CHANGED` | Đổi priority | Assignee, watcher |
| `TASK_DUE_DATE_CHANGED` | Đổi deadline | Assignee, watcher |
| `TASK_COMMENT_CREATED` | Có comment mới | Assignee, watcher nếu cấu hình |
| `TASK_MENTIONED` | Có mention trong comment | Người được mention |
| `TASK_FILE_UPLOADED` | Upload file task | Assignee/watcher nếu cấu hình |
| `TASK_DUE_SOON` | Task sắp đến hạn | Assignee, watcher |
| `TASK_OVERDUE` | Task quá hạn | Assignee, creator, manager nếu cấu hình |

---

### 22.2 Payload notification chuẩn

```json
{
  "source_module": "TASK",
  "event_code": "TASK_ASSIGNED",
  "target_type": "task",
  "target_id": "550e8400-e29b-41d4-a716-446655440000",
  "project_id": "550e8400-e29b-41d4-a716-446655440001",
  "display_code": "TASK-0001",
  "title": "Thiết kế API module TASK",
  "action_url": "/tasks/550e8400-e29b-41d4-a716-446655440000"
}
```

Không đưa vào notification payload:

1. Nội dung comment dài.
2. File private URL.
3. Dữ liệu nhạy cảm của employee.
4. Metadata bảo mật.

---

## 23. Audit log và activity log

### 23.1 Audit log cấp hệ thống

Các action bắt buộc ghi `audit_logs`:

1. Tạo/cập nhật/xóa mềm project.
2. Đóng/hủy/lưu trữ project.
3. Thêm/xóa/đổi role project member.
4. Tạo/cập nhật/xóa task quan trọng.
5. Giao task/đổi assignee.
6. Export task/project.
7. Upload/xóa file nếu file nhạy cảm.
8. Truy cập/tải file nhạy cảm nếu cấu hình.

Thông tin audit log tối thiểu:

```json
{
  "module_code": "TASK",
  "action": "TASK.TASK.ASSIGN",
  "target_type": "task",
  "target_id": "...",
  "actor_user_id": "...",
  "company_id": "...",
  "old_values": {},
  "new_values": {},
  "request_id": "req_...",
  "ip_address": "...",
  "user_agent": "..."
}
```

---

### 23.2 Activity log nghiệp vụ TASK

Activity log dùng cho UI lịch sử hoạt động trong project/task.

Danh sách activity type đề xuất:

```text
PROJECT_CREATED
PROJECT_UPDATED
PROJECT_STATUS_CHANGED
PROJECT_MEMBER_ADDED
PROJECT_MEMBER_REMOVED
PROJECT_MEMBER_ROLE_CHANGED
PROJECT_FILE_UPLOADED
PROJECT_FILE_DELETED
TASK_CREATED
TASK_UPDATED
TASK_ASSIGNED
TASK_ASSIGNEE_CHANGED
TASK_STATUS_CHANGED
TASK_PRIORITY_CHANGED
TASK_DUE_DATE_CHANGED
TASK_COMMENT_CREATED
TASK_COMMENT_UPDATED
TASK_COMMENT_DELETED
TASK_FILE_UPLOADED
TASK_FILE_DELETED
TASK_CHECKLIST_CREATED
TASK_CHECKLIST_UPDATED
TASK_CHECKLIST_DELETED
TASK_CHECKLIST_ITEM_CREATED
TASK_CHECKLIST_ITEM_UPDATED
TASK_CHECKLIST_ITEM_DONE
TASK_CHECKLIST_ITEM_DELETED
TASK_WATCHER_ADDED
TASK_WATCHER_REMOVED
TASK_DELETED
```

---

## 24. Idempotency

Các API quan trọng cần hỗ trợ `Idempotency-Key`:

| Endpoint | Lý do |
| --- | --- |
| `POST /api/v1/tasks/projects` | Tránh tạo trùng project khi retry |
| `POST /api/v1/tasks/projects/{project_id}/members` | Tránh thêm trùng member |
| `POST /api/v1/tasks` | Tránh tạo trùng task |
| `POST /api/v1/tasks/{task_id}/assign` | Tránh đổi assignee lặp |
| `POST /api/v1/tasks/{task_id}/change-status` | Tránh đổi trạng thái lặp khi kéo thả/retry |
| `POST /api/v1/tasks/{task_id}/comments` | Tránh tạo trùng comment khi retry |
| `POST /api/v1/tasks/{task_id}/files` | Tránh tạo trùng metadata file nếu upload retry |

Quy tắc:

1. Idempotency key unique theo `company_id + actor_user_id + endpoint + key`.
2. Nếu request lặp cùng key và cùng payload, trả lại response cũ.
3. Nếu request lặp cùng key nhưng payload khác, trả `409 Conflict`.
4. TTL idempotency key đề xuất 24 giờ.

---

## 25. Error code chuẩn cho TASK

| HTTP | Error code | Mô tả |
| --- | --- | --- |
| 400 | `TASK-ERR-INVALID-STATUS` | Trạng thái không hợp lệ |
| 400 | `TASK-ERR-INVALID-PRIORITY` | Priority không hợp lệ |
| 400 | `TASK-ERR-INVALID-DATE-RANGE` | Khoảng ngày không hợp lệ |
| 400 | `TASK-ERR-CHECKLIST-REQUIRED` | Checklist bắt buộc chưa hoàn thành |
| 400 | `TASK-ERR-ASSIGNEE-INVALID` | Assignee không hợp lệ |
| 400 | `TASK-ERR-PROJECT-MEMBER-INVALID` | Member dự án không hợp lệ |
| 400 | `TASK-ERR-TASK-PERSONAL-DISABLED` | Company không cho phép task cá nhân |
| 403 | `TASK-ERR-FORBIDDEN` | Không có quyền TASK hoặc ngoài scope |
| 404 | `TASK-ERR-PROJECT-NOT-FOUND` | Không tìm thấy project hoặc không có quyền xem |
| 404 | `TASK-ERR-TASK-NOT-FOUND` | Không tìm thấy task hoặc không có quyền xem |
| 404 | `TASK-ERR-COMMENT-NOT-FOUND` | Không tìm thấy comment |
| 409 | `TASK-ERR-DUPLICATE-MEMBER` | Member đã tồn tại |
| 409 | `TASK-ERR-DUPLICATE-WATCHER` | Watcher đã tồn tại |
| 409 | `TASK-ERR-IDEMPOTENCY-CONFLICT` | Idempotency key trùng nhưng payload khác |
| 409 | `TASK-ERR-WORKFLOW-INVALID` | Chuyển trạng thái không hợp lệ |
| 422 | `TASK-ERR-PROJECT-ARCHIVED` | Project đã archive, không cho cập nhật |
| 422 | `TASK-ERR-PROJECT-CANCELLED` | Project đã hủy, không cho cập nhật |
| 422 | `TASK-ERR-TASK-CLOSED` | Task đã đóng, không cho cập nhật |
| 413 | `TASK-ERR-FILE-TOO-LARGE` | File vượt dung lượng |
| 415 | `TASK-ERR-FILE-TYPE-NOT-ALLOWED` | Loại file không được phép |

---

## 26. Business validation tổng hợp

### 26.1 Project

1. `project_code` do backend sinh, unique theo company.
2. Project phải thuộc company hiện tại.
3. Project `Archived`, `Cancelled`, `Completed` có giới hạn cập nhật theo setting.
4. Project phải có ít nhất một Owner.
5. Không xóa/hạ role Owner cuối cùng.
6. Không thêm employee nghỉ việc/chấm dứt vào project.
7. `end_date >= start_date` nếu có cả hai.
8. Project Private chỉ member/relation hợp lệ hoặc scope Company/System mới xem được.

### 26.2 Task

1. `task_code` do backend sinh, unique theo company.
2. Task phải thuộc company hiện tại.
3. Task có thể thuộc project hoặc là task cá nhân nếu setting cho phép.
4. Nếu thuộc project, task phải tuân theo quyền project membership.
5. Assignee phải là employee hợp lệ.
6. `due_at >= start_at` nếu có cả hai.
7. `Overdue` tính động, không lưu cứng vào status.
8. Không đổi trạng thái trái workflow.
9. Không chuyển Done nếu checklist bắt buộc chưa hoàn thành.
10. Không cập nhật task thuộc project Archived/Cancelled nếu setting không cho phép.
11. Khi giao task, nếu assignee đang nghỉ phép/deadline trùng lịch nghỉ, backend trả warning hoặc chặn theo setting.

### 26.3 Comment

1. Chỉ người xem được task mới comment được.
2. Comment không được rỗng.
3. Comment xóa mềm.
4. Mention người không có quyền xem task cần warning hoặc validation error.
5. Nội dung comment cần sanitize để chống XSS khi hiển thị frontend.

### 26.4 File

1. File upload dùng file service chung.
2. File private là mặc định.
3. Không trả storage path/private URL trong response.
4. File download phải kiểm tra permission trước khi cấp signed URL.
5. Upload/xóa file ghi activity log.
6. File nhạy cảm ghi file access log khi xem/tải.

---

## 27. Tích hợp với module khác

### 27.1 AUTH

TASK dùng AUTH để:

1. Xác thực access token.
2. Resolve `user_id`, `company_id`, session.
3. Lấy permission và data scope.
4. Kiểm tra backend permission cho từng endpoint.
5. Ghi actor user vào created_by/updated_by/activity log.

### 27.2 HR

TASK dùng HR để:

1. Resolve user hiện tại sang employee.
2. Kiểm tra employee status.
3. Lấy direct manager để tính Team scope.
4. Lấy department để tính Department scope.
5. Hiển thị employee summary cho owner, assignee, watcher, commenter.

### 27.3 LEAVE

TASK dùng LEAVE để:

1. Cảnh báo khi giao task cho nhân viên đang nghỉ phép.
2. Cảnh báo deadline nằm trong kỳ nghỉ approved của assignee.
3. Hỗ trợ manager điều phối lại task khi nhân viên nghỉ dài ngày.

MVP chỉ cần warning, chưa bắt buộc chặn.

### 27.4 ATT

TASK có thể dùng ATT để:

1. Hiển thị task hôm nay kết hợp trạng thái chấm công trên dashboard.
2. Remote work phase sau có thể yêu cầu chọn project/task.
3. Time tracking phase sau có thể liên kết `task_time_logs` với attendance.

### 27.5 NOTI

TASK phát event cho NOTI, không tự gửi notification trực tiếp nếu hệ thống dùng event bus.

### 27.6 DASH

DASH lấy dữ liệu TASK để hiển thị:

1. Task của tôi hôm nay.
2. Task quá hạn.
3. Task sắp đến hạn.
4. Task team quá hạn.
5. Dự án đang chạy.
6. Tiến độ dự án.
7. Số task theo status/priority.

---

## 28. Query pattern và hiệu năng

### 28.1 Query danh sách task

Pattern chính:

```sql
WHERE company_id = :company_id
  AND deleted_at IS NULL
  AND status = :status
  AND due_at BETWEEN :from AND :to
ORDER BY due_at ASC
LIMIT :limit OFFSET :offset
```

Index gợi ý:

```text
tasks(company_id, project_id)
tasks(company_id, main_assignee_employee_id, status)
tasks(company_id, due_at, status)
task_assignees(company_id, employee_id, task_id)
task_watchers(company_id, employee_id, task_id)
```

### 28.2 Query Kanban

Nên lấy task theo project và group ở backend:

```text
tasks(company_id, project_id, status, priority, due_at)
```

Với project nhiều task, cần giới hạn số task mỗi cột hoặc lazy load theo cột.

### 28.3 Query activity log

Activity log có thể tăng nhanh, nên hỗ trợ pagination và index:

```text
task_activity_logs(company_id, task_id, created_at DESC)
task_activity_logs(company_id, project_id, created_at DESC)
```

### 28.4 Tránh N+1 query

Khi trả list task, backend nên batch/preload:

1. Project summary.
2. Main assignee employee summary.
3. Checklist summary.
4. Comment count.
5. Watcher count.

Không query từng task riêng lẻ trong vòng lặp.

---

## 29. Security checklist

1. Tất cả endpoint TASK yêu cầu authentication.
2. Backend kiểm tra permission + data scope, không tin frontend.
3. Không tin `company_id`, `user_id`, `employee_id` nếu có thể resolve từ auth context.
4. Không trả file private URL trực tiếp.
5. Sanitize nội dung comment/description khi hiển thị.
6. Validate MIME type và dung lượng file upload.
7. Ghi audit log cho export và thao tác quan trọng.
8. Không expose task/project của company khác.
9. Không expose project Private cho user ngoài scope.
10. Không hard delete dữ liệu quan trọng.

---

## 30. Test case API gợi ý

### 30.1 Permission test

| Test | Kỳ vọng |
| --- | --- |
| User không có `TASK.TASK.VIEW` gọi list task | 403 |
| Employee scope Own xem task người khác không liên quan | 404 hoặc 403 |
| Manager scope Team xem task team | 200 |
| Manager scope Team xem task ngoài team | 403/404 |
| Project member xem project Private mình tham gia | 200 |
| User không là member xem project Private | 403/404 |
| Admin scope Company xem toàn bộ task company | 200 |

### 30.2 Business workflow test

| Test | Kỳ vọng |
| --- | --- |
| Tạo task không title | 400 validation |
| Tạo task với assignee đã nghỉ việc | 400/422 |
| Tạo task cá nhân khi setting tắt | 400/422 |
| Đổi Todo -> In Progress | 200 |
| Đổi Todo -> Done nếu workflow không cho | 409 |
| Đổi Done -> In Progress khi không cho reopen | 409 |
| Done task khi checklist bắt buộc chưa hoàn thành | 400/422 |
| Giao task cho assignee không thuộc project | Warning hoặc 422 theo setting |
| Deadline trước start_at | 400 |

### 30.3 Data integrity test

| Test | Kỳ vọng |
| --- | --- |
| Retry tạo task cùng Idempotency-Key cùng payload | Trả cùng response |
| Retry tạo task cùng Idempotency-Key khác payload | 409 |
| Thêm trùng project member | 409 hoặc success idempotent nếu cùng request |
| Watch task nhiều lần | Không tạo trùng watcher |
| Xóa task | `deleted_at` có giá trị, list mặc định không trả |

### 30.4 Notification test

| Test | Kỳ vọng |
| --- | --- |
| Tạo task có assignee | Phát `TASK_ASSIGNED` |
| Comment có mention | Phát `TASK_MENTIONED` |
| Đổi deadline | Phát `TASK_DUE_DATE_CHANGED` |
| Job due soon chạy | Phát `TASK_DUE_SOON` |
| Job overdue chạy | Phát `TASK_OVERDUE` |

---

## 31. OpenAPI / Swagger

> Đặc tả OpenAPI 3.1 máy đọc cho toàn hệ thống: [`openapi/enterprise-api.yaml`](openapi/enterprise-api.yaml). Fragment của module: [`openapi/paths/task.paths.yaml`](openapi/paths/task.paths.yaml). Quy ước build & vendor extension: [`openapi/README.md`](openapi/README.md). Phân quyền: [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [Audit Report](<API-10 PERMISSION AUDIT REPORT.md>).

### 31.1 Security

`bearerAuth` (HTTP bearer JWT) cho mọi endpoint TASK (`/api/v1/tasks/*`). File upload dùng `multipart/form-data`.

### 31.2 Tags của module

- `Tasks - Projects` — dự án (CRUD/close/cancel/archive)
- `Tasks - Project Members` — thành viên dự án
- `Tasks - Tasks` — công việc (list/detail/create/update/delete + danh sách tổng hợp)
- `Tasks - Task Actions` — giao/đổi trạng thái/ưu tiên/deadline/watch
- `Tasks - Kanban` — bảng Kanban
- `Tasks - Comments` — bình luận
- `Tasks - Checklists` — checklist & item
- `Tasks - Files` — file task/project
- `Tasks - Activity Logs` — nhật ký hoạt động
- `Tasks - Reports` — báo cáo tiến độ
- `Tasks - Exports` — xuất dữ liệu task/project

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

operationId prefix: `task`.

### 31.4 Schema & response dùng chung

Tái dùng từ spec tổng (định nghĩa trong `enterprise-api.base.yaml`): envelope `SuccessResponse` / `SuccessListResponse` / `CursorListResponse`, lỗi `ErrorResponse` / `ValidationErrorResponse`, kèm `Meta` / `Pagination` / `CursorPagination`. Common responses 400/401/403/404/409/413/415/422/429/500. Common params `PageParam`, `PerPageParam`, `SearchParam`, `SortParam`, `IdempotencyKey`.

### 31.5 DTO đề xuất cho module

`ProjectCreateRequest`, `ProjectUpdateRequest`, `ProjectResponse`, `ProjectListItemResponse`, `ProjectMemberRequest`, `ProjectMemberResponse`, `TaskCreateRequest`, `TaskUpdateRequest`, `TaskResponse`, `TaskListItemResponse`, `TaskAssignRequest`, `TaskChangeStatusRequest`, `TaskCommentCreateRequest`, `TaskChecklistCreateRequest`, `TaskFileResponse`, `TaskActivityLogResponse`, `TaskReportResponse`.

---

## 32. Kết luận

API-06 hoàn thiện thiết kế API cho module **TASK - Công việc & Dự án** trong MVP Version 1.0.

Tài liệu này chốt các nhóm endpoint chính:

1. Project API.
2. Project Member API.
3. Project File API.
4. Task API.
5. Assignment và status workflow API.
6. Kanban API.
7. Comment và mention API.
8. Checklist API.
9. Task File API.
10. Activity log API.
11. Report và Export API.

Nguyên tắc quan trọng nhất của API-06:

1. Backend luôn kiểm tra permission và data scope.
2. Project role chỉ bổ sung quyền trong phạm vi project, không thay thế RBAC hệ thống.
3. Employee là chủ thể nghiệp vụ, User là actor thao tác.
4. Task có thể thuộc project hoặc là task cá nhân nếu company bật cấu hình.
5. Overdue là trạng thái tính toán, không lưu cứng vào task status.
6. File dùng file service chung và private mặc định.
7. Activity log dùng cho lịch sử nghiệp vụ TASK, audit log dùng cho truy vết cấp hệ thống.
8. Notification được phát qua event, payload không chứa dữ liệu nhạy cảm quá mức.
9. API được thiết kế đủ mở để phát triển Sprint, Gantt, Time Tracking, Automation, Calendar và AI ở các phase sau.
