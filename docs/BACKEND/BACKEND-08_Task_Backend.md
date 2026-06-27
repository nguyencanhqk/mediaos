# BACKEND-08: TASK BACKEND
# TRIỂN KHAI BACKEND MODULE CÔNG VIỆC & DỰ ÁN
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · [BACKEND-05 HR](<BACKEND-05_HR_Backend.md>) · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · **BACKEND-08 Task** · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-06 TASK](<../SPEC/SPEC-06 TASK.md>) · [DB: DB-06 TASK](<../DB/DB-06 TASK Database Design.md>) · [API: API-06 TASK](<../API Design/API-06_TASK_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Frontend: FRONTEND-11](<../FRONTEND/FRONTEND-11_Task_Frontend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-08 |
| Tên tài liệu | Task Backend Implementation |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | TASK - Công việc & Dự án |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-07 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-08 mô tả cách triển khai backend cho module **TASK - Công việc & Dự án**.

Tài liệu này dùng để:

1. Chuyển thiết kế nghiệp vụ trong SPEC-06 thành kiến trúc backend có thể triển khai.
2. Chuyển thiết kế database trong DB-06 thành entity/model, repository, query service và transaction service.
3. Chuyển API-06 thành controller, route, DTO, validation, service, error handling và OpenAPI metadata.
4. Chuẩn hóa permission guard, data scope, project membership guard và task relation guard cho module TASK.
5. Định nghĩa workflow backend cho project, project member, task, assignment, watcher, status, comment, mention, checklist, file và activity log.
6. Định nghĩa cách TASK tích hợp AUTH, HR, FOUNDATION, LEAVE, ATT, NOTI và DASH.
7. Định nghĩa event, background job, dashboard invalidation và notification producer cho task assigned, comment, mention, due soon và overdue.
8. Tạo checklist triển khai, test, bảo mật và hiệu năng cho backend team.

---

## 3. Vị trí BACKEND-08 trong roadmap backend

Chuỗi backend implementation đề xuất:

```text
BACKEND-01: Backend Architecture & Project Setup
BACKEND-02: Database Migration, ORM & Seed Implementation
BACKEND-03: Auth, Session, RBAC & Permission Guard
BACKEND-04: Foundation Backend
BACKEND-05: HR Backend
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
BACKEND-11: File, Audit, Settings & System Jobs
BACKEND-12: API Integration Contract & OpenAPI/Swagger
BACKEND-13: Backend Testing, Security & Performance
BACKEND-14: Backend Release Readiness
```

BACKEND-08 nằm sau Foundation, AUTH/RBAC, HR, ATT và LEAVE vì TASK cần dùng:

1. `auth_context` để xác định `user_id`, `company_id`, permission và data scope.
2. HR để resolve `user -> employee`, lấy phòng ban, quản lý trực tiếp, trạng thái nhân viên.
3. FOUNDATION để dùng audit log, file service, setting service, sequence service và company settings.
4. LEAVE để cảnh báo khi giao task cho nhân viên đang nghỉ phép hoặc deadline trùng kỳ nghỉ.
5. ATT cho liên kết phase sau với remote work/time tracking và dashboard trạng thái làm việc.
6. NOTI/DASH để phát event và invalidate dữ liệu tổng hợp.

---

## 4. Căn cứ triển khai

BACKEND-08 bám theo các quyết định đã chốt:

1. **SPEC-06**: TASK quản lý dự án, thành viên dự án, task, giao việc, trạng thái, deadline, comment, file, Kanban, việc của tôi, task quá hạn, báo cáo tiến độ và activity log.
2. **DB-06**: TASK dùng các bảng chính `projects`, `project_members`, `project_files`, `tasks`, `task_assignees`, `task_watchers`, `task_comments`, `task_comment_mentions`, `task_checklists`, `task_checklist_items`, `task_files`, `task_activity_logs`.
3. **API-06**: TASK dùng prefix `/api/v1/tasks`, không có public endpoint trong MVP, backend resolve `company_id` từ auth context.
4. **API-01**: Response, error, pagination, authentication, permission, business validation, audit log và notification event phải thống nhất toàn hệ thống.
5. **AUTH/RBAC**: Backend không hard-code theo role, mà kiểm tra `permission + data_scope + target relation + business rule`.
6. **HR**: Employee là chủ thể nghiệp vụ; User là actor thao tác.
7. **FOUNDATION**: File private, audit log, setting, sequence counter và public infrastructure dùng chung.
8. **LEAVE**: TASK có thể cảnh báo hoặc chặn giao việc khi assignee đang nghỉ phép/deadline trùng lịch nghỉ, tùy cấu hình.
9. **DASH**: Dashboard chỉ đọc/cached summary từ TASK, không copy dữ liệu gốc.
10. **NOTI**: TASK phát event cho notification khi giao task, comment, mention, due soon, overdue và thay đổi thành viên dự án.

---

## 5. Phạm vi BACKEND-08

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung backend cần triển khai |
| --- | --- |
| Project | CRUD, close, cancel, archive, soft delete, progress summary |
| Project member | List/add/update role/remove member, chống xóa Owner cuối cùng |
| Project file | Link/upload/list/delete file dự án qua file service dùng chung |
| Task | List/detail/create/update/delete soft, task cá nhân hoặc task thuộc project |
| My task | Task được giao, task tôi tạo, task tôi theo dõi, task sắp đến hạn/quá hạn |
| Assignment | Giao task, đổi main assignee, thêm/xóa watcher |
| Status workflow | Cập nhật status, priority, deadline, Kanban drag/drop |
| Comment | Create/update/delete soft comment, sanitize content |
| Mention | Parse/validate mention, tạo mention record, phát notification |
| Checklist | Create/update/delete checklist, item, mark done/undone, order index |
| File | Upload/list/download/delete file task, kiểm tra permission trước signed URL |
| Activity log | Ghi ledger nghiệp vụ project/task |
| Report | Project progress report cơ bản, task count theo status/priority |
| Export | Export task/project theo bộ lọc và quyền, MVP có thể sync hoặc job nếu dữ liệu lớn |
| Job | Due soon/overdue scanner để phát notification và invalidate dashboard |
| Integration | NOTI event producer, DASH cache invalidation, LEAVE warning, AUDIT log |

### 5.2 Không bao gồm trong MVP nhưng phải chừa thiết kế

| Nhóm | Hướng mở rộng |
| --- | --- |
| Sprint/Scrum | Thêm `sprints`, backlog, story point, sprint report |
| Gantt chart | Thêm dependency, milestone, baseline |
| Time tracking | Thêm `task_time_logs`, có thể liên kết ATT |
| Task dependency | Thêm `task_dependencies` |
| Template | Thêm `project_templates`, `task_templates` |
| Automation | Rule engine hoặc workflow automation |
| Task approval | Approval flow cho task quan trọng |
| Calendar integration | Đồng bộ deadline với calendar |
| Chat realtime | Tích hợp CHAT theo `project_id`/`task_id` |
| AI | Summary, suggestion assignee, risk detection |
| BI/reporting | Materialized view/report service riêng |

---

## 6. Nguyên tắc kiến trúc backend module TASK

### 6.1 Backend là nguồn kiểm soát nghiệp vụ cuối cùng

Frontend có thể ẩn/hiện button theo permission, nhưng backend luôn phải kiểm tra lại:

```text
authenticated user
company/tenant
permission
data scope
project membership
task relation
business state
workflow rule
file access rule
```

### 6.2 Không tin dữ liệu nhận từ frontend nếu backend tự resolve được

Không nhận hoặc không tin các field sau trong request nghiệp vụ thông thường:

```text
company_id
created_by
updated_by
actor_user_id
current_employee_id
permission
role
data_scope
```

Các thông tin này phải lấy từ `AuthContext` hoặc service nội bộ.

### 6.3 Phân biệt Employee và User

| Khái niệm | Dùng cho | Ví dụ cột |
| --- | --- | --- |
| `User` | Actor thao tác hệ thống | `created_by`, `updated_by`, `assigned_by`, `actor_user_id` |
| `Employee` | Chủ thể nghiệp vụ nhân sự | `owner_employee_id`, `assignee_employee_id`, `watcher_employee_id`, `reporter_employee_id` |

Quy tắc:

1. User hiện tại phải được resolve sang Employee khi thao tác nghiệp vụ TASK.
2. Có thể giao task cho Employee chưa có User nếu Manager/HR tạo thay.
3. Không giao task cho Employee `Resigned` hoặc `Terminated`.
4. Nếu Employee bị `Temporarily Suspended`, backend xử lý theo company setting.

### 6.4 RBAC hệ thống và project role là hai lớp khác nhau

Backend phải kiểm tra theo thứ tự:

```text
1. Authenticated
2. Permission hệ thống
3. Data scope hệ thống
4. Project visibility/membership/role nếu task thuộc project
5. Task relation nếu thao tác trên task cụ thể
6. Business rule theo trạng thái project/task
```

Project role như `Owner`, `Manager`, `Member`, `Viewer` không được dùng để vượt qua RBAC hệ thống ở API nhạy cảm.

### 6.5 Multi-tenant bắt buộc

Mọi query TASK phải có điều kiện `company_id` hoặc resolve scope System rõ ràng.

```text
WHERE company_id = authContext.companyId
  AND deleted_at IS NULL
```

Các list endpoint phải áp dụng data scope trước pagination.

### 6.6 Soft delete cho dữ liệu quan trọng

Không hard delete các bảng nghiệp vụ:

```text
projects
project_members
project_files
tasks
task_assignees
task_watchers
task_comments
task_checklists
task_checklist_items
task_files
task_activity_logs
```

Dùng:

```text
deleted_at
deleted_by
removed_at
removed_by
```

`task_activity_logs` gần như không xóa trong nghiệp vụ thường.

---

## 7. Module structure đề xuất

Tùy backend stack, có thể áp dụng theo kiến trúc module/layer như sau:

```text
src/modules/task/
  task.module.ts

  controllers/
    project.controller.ts
    project-member.controller.ts
    project-file.controller.ts
    task.controller.ts
    my-task.controller.ts
    task-assignment.controller.ts
    task-status.controller.ts
    task-kanban.controller.ts
    task-comment.controller.ts
    task-checklist.controller.ts
    task-file.controller.ts
    task-activity.controller.ts
    task-report.controller.ts
    task-export.controller.ts
    internal-task.controller.ts

  services/
    project.service.ts
    project-member.service.ts
    project-file.service.ts
    task.service.ts
    my-task.service.ts
    task-assignment.service.ts
    task-status.service.ts
    task-kanban.service.ts
    task-comment.service.ts
    task-mention.service.ts
    task-checklist.service.ts
    task-file.service.ts
    task-activity-log.service.ts
    task-report.service.ts
    task-export.service.ts
    task-due-job.service.ts
    task-dashboard-sync.service.ts
    task-notification-producer.service.ts
    task-leave-warning.service.ts

  repositories/
    project.repository.ts
    project-member.repository.ts
    project-file.repository.ts
    task.repository.ts
    task-assignee.repository.ts
    task-watcher.repository.ts
    task-comment.repository.ts
    task-mention.repository.ts
    task-checklist.repository.ts
    task-file.repository.ts
    task-activity-log.repository.ts
    task-report-query.repository.ts

  dto/
    project.dto.ts
    project-member.dto.ts
    task.dto.ts
    task-assignment.dto.ts
    task-status.dto.ts
    task-comment.dto.ts
    task-checklist.dto.ts
    task-file.dto.ts
    task-query.dto.ts
    task-report.dto.ts

  entities/
    project.entity.ts
    project-member.entity.ts
    project-file.entity.ts
    task.entity.ts
    task-assignee.entity.ts
    task-watcher.entity.ts
    task-comment.entity.ts
    task-comment-mention.entity.ts
    task-checklist.entity.ts
    task-checklist-item.entity.ts
    task-file.entity.ts
    task-activity-log.entity.ts

  guards/
    task-permission.guard.ts
    project-access.guard.ts
    task-access.guard.ts
    task-file-access.guard.ts

  policies/
    task-permission.policy.ts
    task-scope.policy.ts
    project-membership.policy.ts
    task-workflow.policy.ts
    task-file.policy.ts
    task-comment.policy.ts
    task-checklist.policy.ts

  mappers/
    project.mapper.ts
    task.mapper.ts
    task-comment.mapper.ts
    task-checklist.mapper.ts
    task-activity.mapper.ts

  events/
    task.events.ts
    task-event.publisher.ts
    task-event.handlers.ts

  jobs/
    task-due-soon.job.ts
    task-overdue.job.ts
    task-dashboard-cache.job.ts

  constants/
    task-permissions.ts
    task-status.constants.ts
    task-event.constants.ts
    task-error-codes.ts
```

---

## 8. Entity và model mapping

### 8.1 Bảng bắt buộc MVP

| Entity | Bảng | Vai trò |
| --- | --- | --- |
| `Project` | `projects` | Dự án/nhóm công việc |
| `ProjectMember` | `project_members` | Thành viên và role nội bộ dự án |
| `Task` | `tasks` | Công việc chính |
| `TaskAssignee` | `task_assignees` | Người phụ trách task |
| `TaskWatcher` | `task_watchers` | Người theo dõi task |
| `TaskComment` | `task_comments` | Bình luận trong task |
| `TaskChecklist` | `task_checklists` | Nhóm checklist |
| `TaskChecklistItem` | `task_checklist_items` | Item checklist |
| `TaskActivityLog` | `task_activity_logs` | Ledger nghiệp vụ |

### 8.2 Bảng nên triển khai trong MVP nếu có file/mention

| Entity | Bảng | Vai trò |
| --- | --- | --- |
| `ProjectFile` | `project_files` | File gắn với project |
| `TaskFile` | `task_files` | File gắn với task |
| `TaskCommentMention` | `task_comment_mentions` | Người được mention trong comment |

### 8.3 Field snapshot nên có trong `tasks`

Để query nhanh, backend nên dùng snapshot ở `tasks`:

```text
project_id
reporter_employee_id
creator_user_id
main_assignee_employee_id
department_id
status
priority
start_at
due_at
estimated_minutes
completed_at
cancelled_at
created_by
updated_by
deleted_at
```

`main_assignee_employee_id` phải đồng bộ với dòng active trong `task_assignees` có `assignee_role = Main`.

`creator_user_id` (NOT NULL) là user tạo task, phải set khi tạo task và phân biệt với `created_by`. Cột này dùng cho endpoint `/created-by-me`.

---

## 9. Enum và state machine

### 9.1 Project status

```text
Planning
Active
On Hold
Completed
Cancelled
Archived
```

### 9.2 Project visibility

```text
Private
Internal
Public
```

### 9.3 Project role

```text
Owner
Manager
Member
Viewer
```

### 9.4 Task status lưu trong database

```text
Todo
In Progress
In Review
Done
Cancelled
```

`Overdue` là trạng thái dẫn xuất, không lưu cứng trong `tasks.status`.

```text
is_overdue = due_at < now() AND status NOT IN ('Done', 'Cancelled')
```

### 9.5 Task priority

```text
Low
Medium
High
Urgent
```

### 9.6 Assignment role

```text
Main
CoAssignee
Reviewer
```

MVP bắt buộc hỗ trợ `Main`; `CoAssignee` và `Reviewer` giữ thiết kế mở rộng.

### 9.7 Workflow chuyển trạng thái task

| From | To hợp lệ |
| --- | --- |
| Todo | In Progress, Cancelled |
| In Progress | In Review, Done, Cancelled |
| In Review | In Progress, Done, Cancelled |
| Done | In Progress nếu policy cho reopen; không mặc định |
| Cancelled | (terminal — không reopen) |

Khi chuyển sang `Done`, backend kiểm tra:

1. Checklist bắt buộc đã hoàn thành nếu setting bật.
2. User có quyền `TASK.TASK.UPDATE_STATUS`.
3. User là assignee/project manager/manager hoặc có scope phù hợp.
4. Project không ở trạng thái `Archived` hoặc `Cancelled` nếu setting không cho phép cập nhật.

---

## 10. Permission và data scope

### 10.1 Permission TASK MVP

```text
TASK.PROJECT.VIEW
TASK.PROJECT.CREATE
TASK.PROJECT.UPDATE
TASK.PROJECT.DELETE
TASK.PROJECT.CLOSE
TASK.PROJECT.ARCHIVE
TASK.PROJECT.MANAGE_MEMBER
TASK.PROJECT.FILE_UPLOAD
TASK.PROJECT.FILE_DELETE
TASK.PROJECT.VIEW_REPORT

TASK.TASK.VIEW
TASK.TASK.CREATE
TASK.TASK.UPDATE
TASK.TASK.DELETE
TASK.TASK.ASSIGN
TASK.TASK.UPDATE_STATUS
TASK.TASK.UPDATE_PRIORITY
TASK.TASK.UPDATE_DEADLINE
TASK.TASK.COMMENT
TASK.TASK.FILE_UPLOAD
TASK.TASK.FILE_DELETE
TASK.TASK.WATCH
TASK.TASK.VIEW_KANBAN
TASK.TASK.EXPORT

TASK.AUDIT_LOG.VIEW
```

### 10.2 Data scope trong TASK

| Scope | Backend filter |
| --- | --- |
| Own | `created_by = user_id OR assignee = employee_id OR watcher = employee_id OR project_member = employee_id` |
| Team | Assignee/reporter/member thuộc nhân viên có `direct_manager_id = current_employee_id` |
| Department | Task/project thuộc department user quản lý hoặc assignee thuộc department đó |
| Project | Task thuộc project mà current employee là member |
| Company | Toàn bộ dữ liệu trong `company_id` hiện tại |
| System | Liên công ty, chỉ Super Admin hoặc permission đặc biệt |

### 10.3 Policy API access tổng quát

Pseudo flow:

```text
resolve AuthContext
check authenticated
check required permission
resolve current employee if needed
load target project/task with company filter
apply data scope
apply project membership if target thuộc project
apply task relation if action cần liên quan task
apply business validation
execute use case in transaction
write activity/audit log
publish domain events
return response DTO
```

---

## 11. Controller và endpoint mapping

### 11.1 Project API

| Method | Endpoint | Controller | Service | Permission |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/tasks/projects` | `ProjectController.list` | `ProjectService.listProjects` | `TASK.PROJECT.VIEW` |
| POST | `/api/v1/tasks/projects` | `ProjectController.create` | `ProjectService.createProject` | `TASK.PROJECT.CREATE` |
| GET | `/api/v1/tasks/projects/{project_id}` | `ProjectController.detail` | `ProjectService.getProjectDetail` | `TASK.PROJECT.VIEW` |
| PATCH | `/api/v1/tasks/projects/{project_id}` | `ProjectController.update` | `ProjectService.updateProject` | `TASK.PROJECT.UPDATE` |
| POST | `/api/v1/tasks/projects/{project_id}/close` | `ProjectController.close` | `ProjectService.closeProject` | `TASK.PROJECT.CLOSE` |
| POST | `/api/v1/tasks/projects/{project_id}/cancel` | `ProjectController.cancel` | `ProjectService.cancelProject` | `TASK.PROJECT.CLOSE` hoặc `TASK.PROJECT.UPDATE` |
| POST | `/api/v1/tasks/projects/{project_id}/archive` | `ProjectController.archive` | `ProjectService.archiveProject` | `TASK.PROJECT.ARCHIVE` |
| DELETE | `/api/v1/tasks/projects/{project_id}` | `ProjectController.softDelete` | `ProjectService.deleteProject` | `TASK.PROJECT.DELETE` |

### 11.2 Project Member API

| Method | Endpoint | Service | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks/projects/{project_id}/members` | `ProjectMemberService.listMembers` | `TASK.PROJECT.VIEW` |
| POST | `/api/v1/tasks/projects/{project_id}/members` | `ProjectMemberService.addMember` | `TASK.PROJECT.MANAGE_MEMBER` |
| PATCH | `/api/v1/tasks/projects/{project_id}/members/{member_id}` | `ProjectMemberService.updateMemberRole` | `TASK.PROJECT.MANAGE_MEMBER` |
| DELETE | `/api/v1/tasks/projects/{project_id}/members/{member_id}` | `ProjectMemberService.removeMember` | `TASK.PROJECT.MANAGE_MEMBER` |

### 11.3 Task API

| Method | Endpoint | Service | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks` | `TaskService.listTasks` | `TASK.TASK.VIEW` |
| POST | `/api/v1/tasks` | `TaskService.createTask` | `TASK.TASK.CREATE` |
| GET | `/api/v1/tasks/{task_id}` | `TaskService.getTaskDetail` | `TASK.TASK.VIEW` |
| PATCH | `/api/v1/tasks/{task_id}` | `TaskService.updateTask` | `TASK.TASK.UPDATE` |
| DELETE | `/api/v1/tasks/{task_id}` | `TaskService.deleteTask` | `TASK.TASK.DELETE` |

### 11.4 My Task API

| Method | Endpoint | Service | Permission |
| --- | --- | --- | --- |
| GET | `/api/v1/tasks/my-tasks` | `MyTaskService.listMyTasks` | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/assigned-to-me` | `MyTaskService.listAssignedTasks` | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/created-by-me` | `MyTaskService.listCreatedTasks` | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/watching` | `MyTaskService.listWatchingTasks` | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/overdue` | `MyTaskService.listMyOverdueTasks` | `TASK.TASK.VIEW` |
| GET | `/api/v1/tasks/due-soon` | `MyTaskService.listMyDueSoonTasks` | `TASK.TASK.VIEW` |

### 11.5 Assignment, watcher, status, Kanban

| Method | Endpoint | Service | Permission |
| --- | --- | --- | --- |
| POST | `/api/v1/tasks/{task_id}/assign` | `TaskAssignmentService.assignTask` | `TASK.TASK.ASSIGN` |
| PATCH | `/api/v1/tasks/{task_id}/assignee` | `TaskAssignmentService.changeMainAssignee` | `TASK.TASK.ASSIGN` |
| POST | `/api/v1/tasks/{task_id}/watchers` | `TaskAssignmentService.addWatcher` | `TASK.TASK.WATCH` |
| DELETE | `/api/v1/tasks/{task_id}/watchers/{watcher_id}` | `TaskAssignmentService.removeWatcher` | `TASK.TASK.WATCH` |
| POST | `/api/v1/tasks/{task_id}/change-status` | `TaskStatusService.changeStatus` | `TASK.TASK.UPDATE_STATUS` |
| POST | `/api/v1/tasks/{task_id}/change-priority` | `TaskStatusService.changePriority` | `TASK.TASK.UPDATE_PRIORITY` |
| POST | `/api/v1/tasks/{task_id}/change-deadline` | `TaskStatusService.changeDeadline` | `TASK.TASK.UPDATE_DEADLINE` |
| GET | `/api/v1/tasks/projects/{project_id}/kanban` | `TaskKanbanService.getBoard` | `TASK.TASK.VIEW_KANBAN` |

> Kanban drag/drop không có endpoint riêng; frontend gọi lại `POST /api/v1/tasks/{task_id}/change-status` để đổi trạng thái khi kéo thả.

### 11.6 Comment, checklist, file, activity, report

| Nhóm | Endpoint chính | Service |
| --- | --- | --- |
| Comment | `/api/v1/tasks/{task_id}/comments` | `TaskCommentService` |
| Checklist | `/api/v1/tasks/{task_id}/checklists` | `TaskChecklistService` |
| File | `/api/v1/tasks/{task_id}/files` | `TaskFileService` |
| Activity | `/api/v1/tasks/{task_id}/activity-logs` | `TaskActivityLogService` |
| Project activity | `/api/v1/tasks/projects/{project_id}/activity-logs` | `TaskActivityLogService` |
| Report | `/api/v1/tasks/projects/{project_id}/report` | `TaskReportService` |
| Export | `/api/v1/tasks/export` | `TaskExportService` |

---

## 12. DTO và validation

### 12.1 `CreateProjectRequest`

```json
{
  "name": "Triển khai hệ thống quản lý doanh nghiệp",
  "description": "Dự án MVP nội bộ",
  "owner_employee_id": "uuid",
  "department_id": "uuid",
  "priority": "High",
  "visibility": "Private",
  "start_date": "2026-06-20",
  "end_date": "2026-07-31",
  "member_employee_ids": ["uuid"]
}
```

Validation:

1. `name` bắt buộc, tối đa 255 ký tự.
2. `owner_employee_id` bắt buộc và employee phải active hợp lệ.
3. `end_date >= start_date` nếu có cả hai.
4. `priority` thuộc enum hợp lệ.
5. `visibility` thuộc enum hợp lệ.
6. Không cho truyền `company_id`, `project_code`, `created_by`.

### 12.2 `CreateTaskRequest`

```json
{
  "project_id": "uuid hoặc null",
  "title": "Thiết kế API module TASK",
  "description": "Mô tả công việc",
  "main_assignee_employee_id": "uuid",
  "watcher_employee_ids": ["uuid"],
  "priority": "High",
  "status": "Todo",
  "start_at": "2026-06-20T09:00:00+07:00",
  "due_at": "2026-06-25T18:00:00+07:00",
  "checklists": [
    {
      "title": "Checklist chính",
      "items": ["Viết DTO", "Viết service", "Viết test"]
    }
  ]
}
```

Validation:

1. `title` bắt buộc, tối đa 255 ký tự.
2. `project_id` nullable nếu setting cho phép task cá nhân.
3. Nếu có `project_id`, project phải cùng company, chưa archived/cancelled và user được phép tạo task trong project.
4. `main_assignee_employee_id` phải là employee hợp lệ, không resigned/terminated.
5. Nếu task thuộc project, assignee nên là project member hoặc được thêm tự động theo policy.
6. `due_at >= start_at` nếu có cả hai.
7. `status` khi tạo mặc định là `Todo`.
8. Nếu assignee đang nghỉ hoặc deadline trùng kỳ nghỉ, trả warning hoặc chặn theo setting.

### 12.3 `ChangeTaskStatusRequest`

```json
{
  "status": "In Review",
  "note": "Đã hoàn thành phần backend"
}
```

Validation:

1. Status thuộc workflow hợp lệ.
2. Không đổi status nếu task đã Cancelled, trừ policy cho restore.
3. Không đổi Done nếu checklist bắt buộc chưa hoàn thành.
4. Ghi activity log với old/new status.

### 12.4 `CreateTaskCommentRequest`

```json
{
  "content": "@EMP0001 kiểm tra giúp phần DTO nhé",
  "mention_employee_ids": ["uuid"]
}
```

Validation:

1. User phải xem được task.
2. `content` không rỗng sau khi trim/sanitize.
3. Mention employee phải có quyền xem task hoặc backend trả warning/validation error theo setting.
4. Không lưu raw HTML nguy hiểm.

---

## 13. Service layer chi tiết

### 13.1 `ProjectService`

Trách nhiệm:

1. Tạo project kèm owner member trong một transaction.
2. Sinh `project_code` bằng sequence service.
3. Cập nhật thông tin project.
4. Đóng project khi task active đã xử lý xong hoặc policy cho phép.
5. Hủy project với `cancel_reason` bắt buộc.
6. Archive project completed/cancelled.
7. Soft delete project theo policy.
8. Tính progress summary.
9. Phát event và ghi activity log.

Use case tạo project:

```text
validate permission TASK.PROJECT.CREATE
resolve current employee
validate owner employee
validate department/visibility/priority/date
begin transaction
  generate project_code
  insert projects
  insert project_members owner role = Owner
  insert project_members for initial members if provided
  insert task_activity_logs PROJECT_CREATED
commit
publish PROJECT_CREATED / PROJECT_MEMBER_ADDED events
invalidate dashboard project widgets
return ProjectResponse
```

### 13.2 `ProjectMemberService`

Trách nhiệm:

1. Thêm thành viên dự án.
2. Cập nhật role nội bộ project.
3. Remove member bằng `removed_at`, không hard delete.
4. Chống thêm trùng member active.
5. Chống remove/hạ role Owner cuối cùng.
6. Kiểm tra employee status trước khi thêm.
7. Phát notification cho member được thêm/xóa.

Business rules:

```text
Project phải thuộc company hiện tại.
Project Archived/Cancelled không cho sửa member trừ policy đặc biệt.
Phải còn ít nhất một Owner active.
Viewer không được tạo/sửa task nếu chỉ có role Viewer.
```

### 13.3 `TaskService`

Trách nhiệm:

1. List task theo filter/sort/search/pagination và data scope.
2. Detail task có project, assignee, watcher, checklist, comment summary và activity summary.
3. Tạo task cá nhân hoặc task thuộc project.
4. Cập nhật task title/description/start/due/priority/status theo permission riêng.
5. Soft delete task.
6. Tính `is_overdue` động.
7. Ghi activity log và phát event.

Use case tạo task:

```text
check TASK.TASK.CREATE
resolve current employee
validate project if provided
validate project membership/role if project task
validate main assignee
check leave warning
begin transaction
  generate task_code
  insert tasks with main_assignee_employee_id
  insert task_assignees Main
  insert task_watchers: creator, assignee, explicit watchers, project owner/manager theo setting
  insert checklists/items if provided
  insert activity TASK_CREATED
  insert activity TASK_ASSIGNED if has assignee
commit
publish TASK_CREATED
publish TASK_ASSIGNED
publish TASK_LEAVE_WARNING if warning needs notification/internal flag
invalidate dashboard task widgets
return TaskResponse with warnings if any
```

### 13.4 `TaskAssignmentService`

Trách nhiệm:

1. Assign task lần đầu.
2. Change main assignee.
3. Add/remove watcher.
4. Đồng bộ `tasks.main_assignee_employee_id` với `task_assignees`.
5. Ghi activity và notification.

Change main assignee transaction:

```text
load task FOR UPDATE
validate task updatable
validate new assignee employee
validate scope/project membership
begin transaction
  mark old Main assignment removed_at
  insert new Main assignment
  update tasks.main_assignee_employee_id
  upsert watcher for new assignee
  insert activity TASK_ASSIGNEE_CHANGED
commit
publish TASK_ASSIGNED / TASK_ASSIGNEE_CHANGED
invalidate dashboard task widgets
```

### 13.5 `TaskStatusService`

Trách nhiệm:

1. Validate workflow transition.
2. Cập nhật status.
3. Cập nhật priority.
4. Cập nhật deadline.
5. Kiểm tra checklist bắt buộc trước `Done`.
6. Ghi activity và phát event.

Status transition:

```text
load task with project and checklist summary
check TASK.TASK.UPDATE_STATUS
check task relation/project membership/data scope
check workflow from old_status -> new_status
if new_status = Done:
  check required checklist completed
update task status, completed_at if Done, cancelled_at if Cancelled
insert activity TASK_STATUS_CHANGED
publish TASK_STATUS_CHANGED
invalidate kanban and dashboard cache
```

### 13.6 `TaskKanbanService`

Trách nhiệm:

1. Lấy board theo project, group theo status.
2. Hỗ trợ limit mỗi cột.
3. Kéo thả đổi status/order.
4. Không xử lý kéo thả nếu user chỉ có quyền view.
5. Backend kiểm tra workflow hợp lệ như update status thường.

MVP có thể chưa lưu `order_index` theo cột nếu DB chưa chốt. Khi đó board sort theo:

```text
priority desc
due_at asc
updated_at desc
```

Nếu cần drag order thật, thêm `kanban_order` hoặc `status_order_index` vào `tasks`.

### 13.7 `TaskCommentService` và `TaskMentionService`

Trách nhiệm:

1. Tạo comment.
2. Sửa comment của chính mình nếu policy cho phép.
3. Xóa mềm comment.
4. Parse/validate mention.
5. Insert `task_comment_mentions`.
6. Add mentioned employees as watcher nếu setting bật.
7. Phát event `TASK_COMMENT_CREATED` và `TASK_MENTIONED`.

Sanitize:

```text
Trim content
Strip dangerous HTML/script
Normalize mention token
Limit content length
Store original plain text / safe rich text according to editor mode
```

### 13.8 `TaskChecklistService`

Trách nhiệm:

1. Tạo checklist group.
2. Tạo/update/delete item.
3. Mark done/undone.
4. Reorder checklist item.
5. Tính summary: total/done/percent.
6. Ghi activity khi checklist quan trọng thay đổi.

Rule:

```text
Assignee có thể mark done item nếu company setting allow_assignee_complete_checklist = true.
Chỉ người có TASK.TASK.UPDATE mới tạo/xóa checklist group.
Nếu task completed/cancelled thì không cho update checklist trừ policy reopen.
```

### 13.9 `TaskFileService` và `ProjectFileService`

Trách nhiệm:

1. Upload file qua Foundation FileService.
2. Link file với task/project.
3. List file theo quyền.
4. Request signed download URL sau khi kiểm tra access.
5. Soft delete file link.
6. Ghi file access log nếu tải/xem file nhạy cảm.
7. Ghi activity `TASK_FILE_UPLOADED`, `TASK_FILE_DELETED`, `PROJECT_FILE_UPLOADED`.

Không trả:

```text
storage_path
private_url
provider_secret
raw bucket key nếu không cần
```

### 13.10 `TaskActivityLogService`

Trách nhiệm:

1. Ghi ledger nghiệp vụ.
2. Query activity theo project/task.
3. Mask field nhạy cảm nếu user thiếu quyền.
4. Pagination theo `created_at desc`.
5. Không cho sửa log sau khi ghi.

Payload mẫu:

```json
{
  "action": "TASK_STATUS_CHANGED",
  "old_values": { "status": "In Progress" },
  "new_values": { "status": "In Review" },
  "metadata": {
    "source": "api",
    "request_id": "req_..."
  }
}
```

### 13.11 `TaskReportService`

MVP report cơ bản:

1. Tổng task theo status.
2. Tổng task theo priority.
3. Task done/total.
4. Progress percent theo project.
5. Task overdue.
6. Task chưa có assignee.
7. Top assignee theo số task active.

Không tính năng suất cá nhân sâu trong MVP.

---

## 14. Repository và query pattern

### 14.1 Query danh sách task

Pattern:

```sql
SELECT ...
FROM tasks t
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN employees e ON e.id = t.main_assignee_employee_id
WHERE t.company_id = :company_id
  AND t.deleted_at IS NULL
  AND (:status IS NULL OR t.status = :status)
  AND (:priority IS NULL OR t.priority = :priority)
  AND (:project_id IS NULL OR t.project_id = :project_id)
  AND (:due_from IS NULL OR t.due_at >= :due_from)
  AND (:due_to IS NULL OR t.due_at <= :due_to)
ORDER BY t.due_at ASC NULLS LAST, t.updated_at DESC
LIMIT :limit OFFSET :offset;
```

### 14.2 Scope Own

```sql
WHERE (
  t.created_by = :current_user_id
  OR t.main_assignee_employee_id = :current_employee_id
  OR EXISTS (
    SELECT 1 FROM task_assignees ta
    WHERE ta.task_id = t.id
      AND ta.employee_id = :current_employee_id
      AND ta.removed_at IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM task_watchers tw
    WHERE tw.task_id = t.id
      AND tw.employee_id = :current_employee_id
      AND tw.removed_at IS NULL
  )
  OR EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = t.project_id
      AND pm.employee_id = :current_employee_id
      AND pm.removed_at IS NULL
  )
)
```

### 14.3 Scope Team

```sql
WHERE EXISTS (
  SELECT 1
  FROM employees assignee
  WHERE assignee.id = t.main_assignee_employee_id
    AND assignee.direct_manager_id = :current_employee_id
)
```

### 14.4 Scope Project

```sql
WHERE EXISTS (
  SELECT 1
  FROM project_members pm
  WHERE pm.project_id = t.project_id
    AND pm.employee_id = :current_employee_id
    AND pm.removed_at IS NULL
)
```

### 14.5 Query Kanban

```sql
SELECT ...
FROM tasks
WHERE company_id = :company_id
  AND project_id = :project_id
  AND deleted_at IS NULL
  AND status IN ('Todo', 'In Progress', 'In Review', 'Done', 'Cancelled')
ORDER BY status, priority DESC, due_at ASC NULLS LAST, updated_at DESC;
```

Backend group theo status và giới hạn số task mỗi cột nếu project lớn.

### 14.6 Tránh N+1 query

List task phải batch/preload:

1. Project summary.
2. Main assignee employee summary.
3. Checklist summary.
4. Comment count.
5. Watcher count.
6. File count nếu cần.

Không query từng task trong vòng lặp.

---

## 15. Transaction boundaries

Các use case bắt buộc dùng transaction:

| Use case | Lý do |
| --- | --- |
| Create project | Insert project + owner member + activity |
| Add/remove project member | Đảm bảo owner rule và activity nhất quán |
| Create task | Insert task + assignee + watcher + checklist + activity |
| Change assignee | Remove old main + insert new main + update task snapshot |
| Change status | Update task + activity + completed_at/cancelled_at |
| Create comment with mentions | Insert comment + mentions + watchers + activity |
| Upload file | Create file metadata/link + activity |
| Delete task/project | Soft delete + activity + optional cascade policy |
| Close/cancel/archive project | Update project + optional task updates + activity |

Outbox/event publish nên chạy sau commit hoặc dùng transaction outbox để tránh gửi notification khi transaction rollback.

---

## 16. Event và integration

### 16.1 Domain events từ TASK

| Event | Khi nào phát | Người nhận gợi ý |
| --- | --- | --- |
| `PROJECT_CREATED` | Tạo project | Owner, members nếu cấu hình |
| `PROJECT_MEMBER_ADDED` | Thêm member | Member được thêm |
| `PROJECT_MEMBER_REMOVED` | Xóa member | Member bị xóa, owner |
| `PROJECT_MEMBER_ROLE_CHANGED` | Đổi role member | Member liên quan |
| `PROJECT_CLOSED` | Đóng project | Owner, managers, members |
| `PROJECT_CANCELLED` | Hủy project | Owner, managers, members |
| `PROJECT_ARCHIVED` | Archive project | Owner, managers nếu bật |
| `TASK_CREATED` | Tạo task | Assignee/watchers nếu cấu hình |
| `TASK_ASSIGNED` | Giao task | Assignee mới |
| `TASK_ASSIGNEE_CHANGED` | Đổi assignee | Assignee cũ/mới, creator, watchers |
| `TASK_STATUS_CHANGED` | Đổi status | Creator, assignee, watchers |
| `TASK_PRIORITY_CHANGED` | Đổi priority | Assignee/watchers nếu bật |
| `TASK_DUE_DATE_CHANGED` | Đổi deadline | Assignee/watchers |
| `TASK_COMMENT_CREATED` | Comment mới | Assignee/watchers, trừ người comment nếu setting |
| `TASK_MENTIONED` | Có mention | Employee được mention |
| `TASK_FILE_UPLOADED` | Upload file | Watchers nếu bật |
| `TASK_DUE_SOON` | Job phát hiện sắp đến hạn | Assignee/watchers |
| `TASK_OVERDUE` | Job phát hiện quá hạn | Assignee, manager, project owner |

### 16.2 Notification payload rule

Payload không chứa dữ liệu nhạy cảm hoặc file URL private.

```json
{
  "event_code": "TASK_ASSIGNED",
  "module_code": "TASK",
  "company_id": "uuid",
  "actor_user_id": "uuid",
  "target_user_ids": ["uuid"],
  "payload": {
    "project_id": "uuid",
    "task_id": "uuid",
    "task_code": "TASK-0001",
    "title": "Thiết kế API module TASK",
    "action_url": "/tasks/TASK_ID"
  },
  "dedupe_key": "TASK_ASSIGNED:TASK_ID:ASSIGNEE_EMPLOYEE_ID"
}
```

### 16.3 DASH invalidation

Các mutation sau cần invalidate dashboard cache:

| Mutation | Widget/cache cần invalidate |
| --- | --- |
| Create/update/delete task | My tasks, team overdue, project progress |
| Change status | My tasks, kanban, project progress, task counts |
| Change assignee | My tasks của assignee cũ/mới, team task |
| Change deadline | Due soon/overdue widgets |
| Add/remove project member | Project list/report widget |
| Close/cancel/archive project | Active projects, progress widget |
| Comment/mention | Notification widget, task activity widget nếu có |

### 16.4 LEAVE warning integration

Khi tạo/giao task hoặc đổi deadline, backend gọi `TaskLeaveWarningService`:

```text
input: assignee_employee_id, start_at, due_at, project_id
output:
  - has_warning: boolean
  - warning_code: ASSIGNEE_ON_LEAVE | DEADLINE_IN_LEAVE_PERIOD
  - message
  - leave_request_ids if allowed internally
```

Policy theo company setting:

| Setting | Hành vi |
| --- | --- |
| `task.leave_conflict_mode = warning` | Cho phép lưu, trả warning cho frontend |
| `task.leave_conflict_mode = block` | Chặn lưu bằng business error |
| `task.leave_conflict_mode = ignore` | Không kiểm tra |

### 16.5 ATT integration

MVP chưa tính công theo task. Backend chỉ chừa service contract:

```text
TaskWorkContextService.getTasksForRemoteWork(employee_id, date)
TaskDashboardQueryService.getTodayTasksWithAttendanceContext(employee_id, date)
```

---

## 17. Background jobs

### 17.1 `task-due-soon.job`

Mục tiêu: phát notification trước deadline.

Input setting:

```text
task.due_soon_hours_before = 24
task.due_soon_notification_enabled = true
```

Query:

```sql
SELECT *
FROM tasks
WHERE company_id = :company_id
  AND deleted_at IS NULL
  AND status NOT IN ('Done', 'Cancelled')
  AND due_at BETWEEN now() AND now() + interval '24 hours'
```

Dedup:

```text
TASK_DUE_SOON:{task_id}:{due_at_date_or_hour}
```

### 17.2 `task-overdue.job`

Mục tiêu: phát notification cho task quá hạn, không đổi `tasks.status` thành Overdue.

Query:

```sql
SELECT *
FROM tasks
WHERE deleted_at IS NULL
  AND status NOT IN ('Done', 'Cancelled')
  AND due_at < now()
```

Dedup:

```text
TASK_OVERDUE:{task_id}:{yyyy_mm_dd}
```

### 17.3 Job schedule đề xuất

| Job | Tần suất MVP | Ghi chú |
| --- | --- | --- |
| Due soon scan | Mỗi 1 giờ | Có dedupe để không spam |
| Overdue scan | Mỗi 1 giờ hoặc mỗi sáng | Tùy config |
| Dashboard task summary warmup | Mỗi 15-60 phút hoặc event-driven | Nếu dashboard query nặng |
| Export cleanup | Hằng ngày | Nếu export chạy background |

---

## 18. Error code catalog

| HTTP | Code | Khi nào dùng |
| --- | --- | --- |
| 400 | `TASK-ERR-VALIDATION` | Request không hợp lệ |
| 401 | `AUTH-ERR-UNAUTHORIZED` | Chưa đăng nhập/token lỗi |
| 403 | `AUTH-ERR-FORBIDDEN` | Thiếu permission/scope |
| 404 | `TASK-ERR-PROJECT-NOT-FOUND` | Không tìm thấy project hoặc không được xem |
| 404 | `TASK-ERR-TASK-NOT-FOUND` | Không tìm thấy task hoặc không được xem |
| 409 | `TASK-ERR-DUPLICATE-PROJECT-MEMBER` | Thành viên project đã tồn tại |
| 409 | `TASK-ERR-DUPLICATE-WATCHER` | Watcher đã tồn tại |
| 409 | `TASK-ERR-IDEMPOTENCY-CONFLICT` | Idempotency key trùng nhưng payload khác |
| 409 | `TASK-ERR-WORKFLOW-INVALID` | Chuyển trạng thái không hợp lệ |
| 422 | `TASK-ERR-PROJECT-ARCHIVED` | Project archived không cho cập nhật |
| 422 | `TASK-ERR-PROJECT-CANCELLED` | Project cancelled không cho cập nhật |
| 422 | `TASK-ERR-TASK-CLOSED` | Task đã đóng/hủy không cho cập nhật |
| 422 | `TASK-ERR-LAST-OWNER` | Không thể xóa/hạ quyền Owner cuối cùng |
| 422 | `TASK-ERR-ASSIGNEE-INACTIVE` | Assignee không còn trạng thái làm việc hợp lệ |
| 422 | `TASK-ERR-LEAVE-CONFLICT` | Assignee/deadline trùng nghỉ phép và policy đang block |
| 422 | `TASK-ERR-CHECKLIST-INCOMPLETE` | Không thể Done khi checklist bắt buộc chưa xong |
| 413 | `TASK-ERR-FILE-TOO-LARGE` | File vượt dung lượng |
| 415 | `TASK-ERR-FILE-TYPE-NOT-ALLOWED` | Loại file không cho phép |

---

## 19. Security checklist

- [ ] Tất cả endpoint TASK yêu cầu authentication.
- [ ] Backend kiểm tra permission + data scope, không tin frontend.
- [ ] Không nhận `company_id` từ frontend cho nghiệp vụ thường.
- [ ] Không expose project/task của company khác.
- [ ] Project Private chỉ trả cho member/relation hợp lệ hoặc scope Company/System.
- [ ] File private không trả storage path/private URL.
- [ ] File download phải check permission trước signed URL.
- [ ] Comment/description được sanitize chống XSS.
- [ ] Validate MIME type và dung lượng file upload.
- [ ] Không hard delete dữ liệu task/project quan trọng.
- [ ] Ghi activity log cho mọi thay đổi nghiệp vụ quan trọng.
- [ ] Ghi audit log cho export, delete, file access nhạy cảm và thao tác quản trị.
- [ ] Không gửi nội dung comment dài/file URL private trong notification payload.
- [ ] Idempotency key cho create project/task/comment/file nếu cần chống retry trùng.

---

## 20. Performance và index cần kiểm tra

### 20.1 Index quan trọng

| Bảng | Index gợi ý |
| --- | --- |
| `projects` | `(company_id, status, priority)`, `(company_id, owner_employee_id)`, unique `(company_id, project_code)` |
| `project_members` | `(company_id, project_id)`, `(company_id, employee_id, project_id)`, unique active member |
| `tasks` | `(company_id, project_id)`, `(company_id, main_assignee_employee_id, status)`, `(company_id, due_at, status)`, unique `(company_id, task_code)` |
| `task_assignees` | `(company_id, employee_id, task_id)`, active main assignee partial unique |
| `task_watchers` | `(company_id, employee_id, task_id)`, active watcher unique |
| `task_comments` | `(company_id, task_id, created_at desc)` |
| `task_activity_logs` | `(company_id, task_id, created_at desc)`, `(company_id, project_id, created_at desc)` |
| `task_checklist_items` | `(company_id, task_id)`, `(company_id, checklist_id, order_index)` |
| `task_files` | `(company_id, task_id)`, `(company_id, file_id)` |

### 20.2 Query performance checklist

- [ ] Query list luôn có `company_id`.
- [ ] Query list có pagination và max `per_page`.
- [ ] Query search chỉ search whitelist field.
- [ ] Query Kanban có limit theo cột nếu task nhiều.
- [ ] Query activity log dùng pagination.
- [ ] Query dashboard có cache hoặc aggregate query tối ưu.
- [ ] Không N+1 khi trả task list.
- [ ] Dùng projection DTO thay vì trả entity đầy đủ.
- [ ] Dùng `EXPLAIN ANALYZE` cho task list, my task, overdue, kanban, report.

---

## 21. API response DTO

### 21.1 `ProjectListItemResponse`

```json
{
  "project_id": "uuid",
  "project_code": "PRJ-0001",
  "name": "Triển khai hệ thống quản lý doanh nghiệp",
  "status": "Active",
  "priority": "High",
  "visibility": "Private",
  "owner": {
    "employee_id": "uuid",
    "employee_code": "EMP0001",
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
```

### 21.2 `TaskListItemResponse`

```json
{
  "task_id": "uuid",
  "task_code": "TASK-0001",
  "project": {
    "project_id": "uuid",
    "project_code": "PRJ-0001",
    "name": "Triển khai hệ thống quản lý doanh nghiệp"
  },
  "title": "Thiết kế API module TASK",
  "status": "In Progress",
  "priority": "High",
  "due_at": "2026-06-25T18:00:00+07:00",
  "is_overdue": false,
  "main_assignee": {
    "employee_id": "uuid",
    "employee_code": "EMP0002",
    "full_name": "Trần Thị B"
  },
  "checklist_summary": {
    "total": 5,
    "done": 3
  },
  "comment_count": 4,
  "watcher_count": 3,
  "updated_at": "2026-06-20T10:00:00+07:00"
}
```

### 21.3 Warning response khi leave conflict mode là warning

```json
{
  "success": true,
  "message": "Tạo task thành công",
  "data": {
    "task_id": "uuid",
    "task_code": "TASK-0001"
  },
  "meta": {
    "warnings": [
      {
        "code": "TASK-WARN-ASSIGNEE-ON-LEAVE",
        "message": "Người phụ trách có lịch nghỉ trong khoảng thời gian của task"
      }
    ]
  }
}
```

---

## 22. OpenAPI/Swagger yêu cầu

Mỗi endpoint TASK cần khai báo:

1. Bearer Auth security scheme.
2. `x-required-permission`.
3. `x-data-scope` nếu endpoint list/detail cần scope.
4. Standard success response.
5. Standard error response.
6. Validation error schema.
7. Pagination schema cho list.
8. Multipart schema cho upload file.
9. Warning metadata schema cho leave conflict.
10. Idempotency header cho create/update quan trọng.

Schema cần tách:

```text
ProjectCreateRequest
ProjectUpdateRequest
ProjectResponse
ProjectListItemResponse
ProjectMemberCreateRequest
ProjectMemberResponse
TaskCreateRequest
TaskUpdateRequest
TaskResponse
TaskListItemResponse
TaskAssignRequest
TaskChangeStatusRequest
TaskCommentCreateRequest
TaskChecklistCreateRequest
TaskFileResponse
TaskActivityLogResponse
TaskReportResponse
```

---

## 23. Test plan

### 23.1 Unit test

| Service | Test chính |
| --- | --- |
| `ProjectService` | create/update/close/cancel/archive/delete project |
| `ProjectMemberService` | add member, duplicate, remove owner cuối cùng, update role |
| `TaskService` | create/update/delete/list/detail task |
| `TaskAssignmentService` | assign/change assignee/add watcher/remove watcher |
| `TaskStatusService` | workflow valid/invalid, done with checklist incomplete |
| `TaskCommentService` | create/update/delete/sanitize comment |
| `TaskMentionService` | mention valid/invalid user, notification target |
| `TaskChecklistService` | create item, mark done, reorder, completion summary |
| `TaskFileService` | upload/list/download/delete, permission check |
| `TaskScopePolicy` | Own/Team/Department/Project/Company/System filter |
| `TaskDueJobService` | due soon/overdue dedupe |

### 23.2 Integration test

| Test | Kỳ vọng |
| --- | --- |
| Create project | Project + owner member + activity log được tạo trong transaction |
| Add duplicate member | 409 hoặc idempotent success tùy header |
| Create task with assignee | Task + assignee + watcher + activity + notification event |
| Retry create task cùng idempotency key | Trả cùng response |
| Retry create task cùng key khác payload | 409 |
| Change main assignee | Old assignment removed, new assignment active, task snapshot updated |
| Comment with mention | Comment + mention + notification event |
| Delete task | `deleted_at` có giá trị, list mặc định không trả |
| Upload file | File private + link + activity, không trả private URL |
| Done task with incomplete checklist | 422 nếu setting bắt buộc checklist |
| Project archive | Không hiện trong list mặc định nếu không include archived |

### 23.3 Permission/data scope test

| Test | Kỳ vọng |
| --- | --- |
| User không có `TASK.TASK.VIEW` gọi list task | 403 |
| Employee Own xem task người khác không liên quan | 403 hoặc 404 |
| Manager Team xem task nhân viên thuộc team | 200 |
| Manager Team xem task ngoài team | 403 hoặc 404 |
| Project member xem project Private mình tham gia | 200 |
| User ngoài member xem project Private | 403 hoặc 404 |
| Admin Company xem task trong company | 200 |
| User biết UUID task company khác | 404 hoặc 403, không leak dữ liệu |
| Viewer project kéo Kanban | 403 |
| Assignee update status task được giao | 200 nếu có permission/scope hợp lệ |

### 23.4 Notification/event test

| Test | Kỳ vọng |
| --- | --- |
| Tạo task có assignee | Phát `TASK_ASSIGNED` |
| Đổi assignee | Phát `TASK_ASSIGNEE_CHANGED` |
| Comment có mention | Phát `TASK_MENTIONED` |
| Đổi deadline | Phát `TASK_DUE_DATE_CHANGED` |
| Job due soon chạy | Phát `TASK_DUE_SOON`, có dedupe |
| Job overdue chạy | Phát `TASK_OVERDUE`, không đổi status DB |
| Thêm project member | Phát `PROJECT_MEMBER_ADDED` |

### 23.5 Performance test

- [ ] Task list 10.000 record vẫn trả trong ngưỡng chấp nhận.
- [ ] My task query dùng index assignee/watcher/project member.
- [ ] Kanban project nhiều task không timeout, có limit/lazy load.
- [ ] Activity log pagination không scan toàn bảng.
- [ ] Dashboard task widget không query nặng liên tục.
- [ ] Export dữ liệu lớn chuyển background job nếu vượt threshold.

---

## 24. Seed data cần bổ sung

### 24.1 Permission seed

Seed đầy đủ permission TASK trong mục 10.1.

### 24.2 Role-permission matrix mặc định

| Role | Scope gợi ý |
| --- | --- |
| Super Admin | System |
| Company Admin | Company |
| HR | Company hoặc Department tùy cấu hình |
| Manager | Team/Project |
| Employee | Own |
| Project Manager | Project |

Không hard-code theo role trong backend; seed chỉ là mặc định ban đầu.

### 24.3 Sequence seed

```text
PROJECT_CODE: PRJ-{0000}
TASK_CODE: TASK-{0000}
```

Hoặc theo company setting:

```text
{PREFIX}-{YYYY}-{SEQUENCE}
```

### 24.4 Notification event/template seed

```text
TASK_ASSIGNED
TASK_STATUS_CHANGED
TASK_COMMENT_CREATED
TASK_MENTIONED
TASK_DUE_SOON
TASK_OVERDUE
PROJECT_MEMBER_ADDED
PROJECT_CLOSED
PROJECT_CANCELLED
```

### 24.5 Dashboard widget seed liên quan TASK

```text
my_tasks_today
tasks_due_soon
my_overdue_tasks
team_overdue_tasks
active_projects
project_progress_summary
task_status_count
task_priority_count
```

---

## 25. Checklist triển khai BACKEND-08

### 25.1 Migration/model

- [ ] Đảm bảo migration DB-06 đã chạy.
- [ ] Tạo entity/model cho project, task, member, assignee, watcher, comment, mention, checklist, file, activity.
- [ ] Tạo enum/status constants.
- [ ] Tạo index cần thiết theo DB-09.
- [ ] Tạo seed permission TASK.
- [ ] Tạo seed notification event/template liên quan TASK.
- [ ] Tạo seed dashboard widget liên quan TASK.

### 25.2 Core backend

- [ ] Tạo `TaskModule`.
- [ ] Tạo controllers theo nhóm API.
- [ ] Tạo DTO + validation.
- [ ] Tạo repositories.
- [ ] Tạo services/use cases.
- [ ] Tạo policies/guards cho permission, scope, project membership, task relation.
- [ ] Tạo activity log service.
- [ ] Tạo event publisher/outbox integration.

### 25.3 Business workflow

- [ ] Create/update/close/cancel/archive/delete project.
- [ ] Add/update/remove project member.
- [ ] Create/update/delete task.
- [ ] Assign/change assignee.
- [ ] Add/remove watcher.
- [ ] Change status/priority/deadline.
- [ ] Kanban board (drag/drop dùng change-status, không có endpoint move riêng).
- [ ] Comment + mention.
- [ ] Checklist + item.
- [ ] Upload/download/delete project/task file.
- [ ] Activity log list.
- [ ] Project report.
- [ ] Export task/project.

### 25.4 Integration

- [ ] AUTH permission guard.
- [ ] HR employee status validation.
- [ ] Foundation sequence service.
- [ ] Foundation file service.
- [ ] Foundation audit log.
- [ ] LEAVE conflict warning/block.
- [ ] NOTI event producer.
- [ ] DASH cache invalidation.
- [ ] Job due soon/overdue.

### 25.5 QA/security/performance

- [ ] Unit test services/policies.
- [ ] Integration test transaction workflow.
- [ ] Permission/data scope test.
- [ ] File security test.
- [ ] Notification event test.
- [ ] Dashboard invalidation test.
- [ ] `EXPLAIN ANALYZE` cho query chính.
- [ ] Swagger/OpenAPI hoàn chỉnh.
- [ ] Regression test với AUTH/HR/LEAVE/NOTI/DASH.

---

## 26. Rủi ro và quyết định cần chốt

| Vấn đề | Khuyến nghị MVP |
| --- | --- |
| Task cá nhân có được phép không | Có, nhưng bật/tắt bằng company setting |
| Một task nhiều assignee hay một assignee chính | MVP dùng một assignee chính, DB vẫn hỗ trợ nhiều assignee |
| Assignee ngoài project có được giao task project không | Mặc định không; có thể auto add member nếu setting bật |
| Deadline trùng nghỉ phép | MVP trả warning; có setting để block |
| Kanban có lưu order kéo thả không | MVP có thể chưa lưu order; nếu cần thêm `kanban_order` |
| Done task khi checklist chưa xong | Chặn nếu setting `require_checklist_done_before_task_done = true` |
| Comment rich text hay plain text | MVP nên safe rich text hoặc plain text đã sanitize |
| Project archived có cho cập nhật không | Mặc định không |
| Export có background job không | Dữ liệu nhỏ sync; vượt threshold chuyển async/job |

---

## 27. Definition of Done cho BACKEND-08

BACKEND-08 được xem là hoàn thành khi:

1. Toàn bộ endpoint TASK MVP trong API-06 có controller/service/repository/DTO tương ứng.
2. Tất cả endpoint yêu cầu authentication và kiểm tra permission/data scope ở backend.
3. Project Private, data scope Own/Team/Department/Project/Company/System hoạt động đúng.
4. Create/update/delete project/task chạy transaction và ghi activity log.
5. Assignment, watcher, status workflow, Kanban, comment, mention, checklist và file hoạt động đúng.
6. File private không lộ storage path/private URL.
7. Notification events được publish đúng và có dedupe cho job due/overdue.
8. Dashboard cache được invalidate khi task/project thay đổi.
9. LEAVE warning/block hoạt động theo setting khi giao task/deadline trùng nghỉ phép.
10. Unit test, integration test, permission test và query performance test đạt yêu cầu.
11. OpenAPI/Swagger thể hiện đầy đủ request/response/error/permission.
12. Không có N+1 query nghiêm trọng ở task list, my task, kanban và report.

---

## 28. Thứ tự triển khai đề xuất

### Sprint Backend TASK 1 - Foundation của module

1. Tạo `TaskModule` structure.
2. Tạo entity/model/repository cơ bản.
3. Tạo permission constants và seed.
4. Tạo `TaskScopePolicy`, `ProjectMembershipPolicy`, `TaskWorkflowPolicy`.
5. Tạo activity log service.
6. Tạo project CRUD + member management.

### Sprint Backend TASK 2 - Task core

1. Tạo task list/detail/create/update/delete.
2. Tạo assignment/watcher.
3. Tạo status/priority/deadline workflow.
4. Tạo Kanban board.
5. Tích hợp sequence code và activity log.
6. Viết unit/integration test task core.

### Sprint Backend TASK 3 - Collaboration

1. Comment CRUD + sanitize.
2. Mention validation + notification event.
3. Checklist/checklist item.
4. Task/project file upload/download/delete.
5. File access log.
6. Permission test file/comment/checklist.

### Sprint Backend TASK 4 - Integration, report, job

1. Report project progress.
2. My tasks/due soon/overdue endpoints.
3. Due soon/overdue jobs.
4. NOTI producer.
5. DASH invalidation.
6. LEAVE conflict warning/block.
7. Performance test và OpenAPI finalize.

---

## 29. Kết luận

BACKEND-08 hoàn thiện thiết kế triển khai backend cho module **TASK - Công việc & Dự án**.

Trọng tâm kỹ thuật của module này là:

1. Kiểm soát quyền theo `permission + data_scope + project membership + task relation`.
2. Phân biệt rõ Employee là chủ thể nghiệp vụ và User là actor thao tác.
3. Dùng transaction cho các workflow tạo/sửa/giao task/comment/file/checklist.
4. Ghi `task_activity_logs` như ledger nghiệp vụ của project/task.
5. Không lưu cứng `Overdue`; tính động từ deadline và status.
6. Tích hợp Foundation file/audit/sequence, HR employee validation, LEAVE conflict warning, NOTI event và DASH cache.
7. Tối ưu task list, my task, kanban, overdue và activity log từ đầu để tránh N+1 và query chậm.

Sau BACKEND-08, bước tiếp theo hợp lý là triển khai **BACKEND-09: Notification Backend** hoặc **BACKEND-10: Dashboard Backend**, vì TASK đã phát sinh nhiều event và dữ liệu tổng hợp cần NOTI/DASH xử lý chính thức.
