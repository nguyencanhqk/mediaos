# IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-07 |
| Tên tài liệu | Sprint 4 Task, Notification & Dashboard Execution Plan |
| Dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Giai đoạn | MVP Version 1.0 |
| Sprint | Sprint 4 |
| Trọng tâm | TASK, NOTI, DASH |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-08, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-04, BACKEND/QA/DEVOPS đã triển khai trước đó |

---

## 2. Mục đích tài liệu

Tài liệu này triển khai kế hoạch thực thi Sprint 4 cho ba nhóm chức năng còn lại của MVP core:

1. Module TASK - Công việc & Dự án.
2. Module NOTI - Thông báo hệ thống.
3. Module DASH - Dashboard tổng hợp theo vai trò.

Mục tiêu của Sprint 4 không chỉ là xây dựng từng module riêng lẻ, mà phải hoàn thành luồng tích hợp end-to-end:

```text
User tạo/cập nhật task
-> TASK ghi dữ liệu, activity log và phát event
-> NOTI nhận event, resolve người nhận và tạo thông báo
-> DASH đọc TASK/NOTI/ATT/LEAVE/HR theo permission + data scope
-> User thấy widget, badge, notification dropdown và deep link về module gốc
```

Tài liệu này dùng để:

1. Chốt phạm vi Sprint 4.
2. Chia nhỏ backlog kỹ thuật và nghiệp vụ.
3. Xác định thứ tự triển khai backend, frontend, database, seed và test.
4. Chốt các luồng tích hợp giữa TASK, NOTI và DASH.
5. Làm checklist thực thi cho Product, Backend, Frontend, QA và DevOps.
6. Làm đầu vào cho Sprint 5 Integration, QA Hardening & UAT (IMPLEMENTATION-08). Release Candidate và Go-live thuộc Sprint 6 (IMPLEMENTATION-09).

---

## 3. Bối cảnh Sprint 4

Sprint 4 được triển khai sau khi các sprint trước đã hoàn thiện nền tảng chính:

```text
Sprint 1
-> Foundation, environment, database base, auth shell, shared infrastructure

Sprint 2
-> AUTH, RBAC, HR core

Sprint 3
-> ATT, LEAVE core workflow

Sprint 4
-> TASK, NOTI, DASH và integration event/widget
```

Trong MVP, TASK tạo nguồn dữ liệu công việc; NOTI giúp người dùng không bỏ sót sự kiện quan trọng; DASH là lớp tổng hợp, hiển thị nhanh và điều hướng về module gốc.

Nguyên tắc quan trọng:

1. TASK là module nghiệp vụ gốc của project/task.
2. NOTI là module tạo, lưu, đọc, đánh dấu và quản lý notification.
3. DASH chỉ đọc/tổng hợp/cache dữ liệu, không xử lý nghiệp vụ gốc.
4. Dashboard quick action và notification deep link luôn quay về module gốc để kiểm tra lại permission, data scope và business rule.
5. Backend luôn là lớp kiểm soát quyền cuối cùng.

---

## 4. Mục tiêu Sprint 4

### 4.1 Mục tiêu sản phẩm

Sau Sprint 4, người dùng MVP có thể:

1. Tạo và quản lý project cơ bản.
2. Thêm/xóa/cập nhật thành viên project.
3. Tạo task, giao task, cập nhật trạng thái, priority và deadline.
4. Xem task của tôi, task team, task quá hạn hoặc sắp đến hạn.
5. Xem Kanban board và kéo thả đổi trạng thái nếu có quyền.
6. Bình luận trong task, mention người dùng và xem activity log.
7. Tạo checklist trong task và đánh dấu hoàn thành.
8. Upload/xem/xóa file task/project nếu bật trong MVP.
9. Nhận notification khi được giao task, được mention, task đổi trạng thái hoặc task sắp/quá hạn.
10. Xem notification badge/dropdown/list/detail và mark read.
11. Xem dashboard cá nhân/quản lý/HR/Admin theo quyền.
12. Xem widget task, notification, pending leave, attendance today và các summary quan trọng.

### 4.2 Mục tiêu kỹ thuật

Sprint 4 cần hoàn thành:

1. Migration và seed cho TASK, NOTI, DASH.
2. Backend service cho project, task, comment, checklist, file link và activity log.
3. Backend event producer từ TASK sang NOTI.
4. Notification event service, template renderer, recipient resolver và delivery log in-app.
5. Dashboard widget registry, widget data query service, cache/invalidation cơ bản.
6. API endpoint theo API-06, API-07 và API-08. Mapping module -> tài liệu API: **TASK = API-06**, **NOTI = API-07**, **DASH = API-08** (header §1 liệt kê dải tổng API-01 -> API-08; Sprint 4 chỉ dùng API-06/07/08).
7. Frontend workspace cho TASK, NOTI và DASH.
8. Query hooks, mutation hooks, optimistic/invalidation rule theo FRONTEND-04.
9. Permission guard, route metadata, sidebar/action registry theo FRONTEND-03.
10. QA test case cho API, permission, data scope, event, notification, dashboard cache và E2E flow.

### 4.3 Kết quả bàn giao cuối Sprint

| Nhóm | Kết quả cần có |
| --- | --- |
| Database | Migration TASK, NOTI, DASH; index chính; seed event/template/widget/permission |
| Backend | API TASK, NOTI, DASH chạy được trên môi trường dev/staging |
| Frontend | Màn TASK, notification dropdown/list/detail, dashboard widget MVP |
| Integration | TASK phát event -> NOTI tạo notification -> DASH hiển thị widget/badge |
| QA | Test suite API + E2E P0/P1; checklist lỗi critical/high đã xử lý |
| DevOps | Migration/seed có thể chạy lại idempotent; staging deploy thành công |
| Docs | OpenAPI cập nhật; release note Sprint 4; known issues rõ ràng |

---

## 5. Phạm vi Sprint 4

### 5.1 Trong phạm vi

#### TASK

| Nhóm | Phạm vi Sprint 4 |
| --- | --- |
| Project | Danh sách, tạo, cập nhật, đóng/hủy/lưu trữ, xóa mềm |
| Project member | Thêm thành viên, đổi role, xóa thành viên |
| Task | Danh sách, chi tiết, tạo, cập nhật, xóa mềm |
| My task | Task được giao, task tôi tạo, task tôi theo dõi |
| Assignment | Giao task, đổi assignee chính, thêm/xóa watcher |
| Status workflow | Todo, In Progress, In Review, Done, Cancelled |
| Priority/deadline | Low, Medium, High, Urgent; due date; overdue/due soon |
| Kanban | Board theo project/status; kéo thả đổi trạng thái nếu có quyền |
| Comment | Tạo/sửa/xóa mềm comment; mention người dùng |
| Checklist | Tạo checklist, tạo item, tick done/undone, reorder cơ bản nếu kịp |
| File | Upload/list/download/delete soft file task/project nếu file service đã sẵn sàng |
| Activity log | Ghi log thay đổi quan trọng trong project/task |
| Report | Summary tiến độ project cơ bản |
| Export | Có thể đưa sang Sprint 5 nếu không đủ thời gian |

#### NOTI

| Nhóm | Phạm vi Sprint 4 |
| --- | --- |
| My notification | List, detail, unread count, dropdown |
| Action | Mark read, mark all read, hide/archive/delete soft nếu kịp |
| Event intake | Internal event endpoint hoặc service method nhận event từ TASK/ATT/LEAVE/HR |
| Template | Seed template tiếng Việt cho event MVP; render biến cơ bản |
| Recipient resolver | Resolve assignee, watcher, manager, requester, actor exclusion |
| Delivery | IN_APP delivery log; trạng thái Pending/Sent/Skipped/Failed |
| Dedupe | Dedupe cơ bản theo event + entity + recipient + window |
| Reminder job | TASK_DUE_SOON, TASK_OVERDUE ở mức job thủ công/scheduled cơ bản |
| Admin config | Xem event/template/channel; update bật/tắt nếu kịp |
| Dashboard integration | Endpoint nhẹ unread count + latest notifications |

#### DASH

| Nhóm | Phạm vi Sprint 4 |
| --- | --- |
| Dashboard me | Resolve dashboard mặc định theo permission |
| Dashboard type | Employee, Manager, HR, Admin |
| Widget catalog | Seed widget MVP và permission required |
| Widget data | Load từng widget hoặc dashboard summary |
| Widget config | Config theo company/role/dashboard type cơ bản |
| Cache | Cache ngắn hạn widget nặng; TTL theo loại widget |
| Invalidation | Invalidate theo event TASK/NOTI/ATT/LEAVE/HR quan trọng |
| Quick action | Trả metadata điều hướng, không xử lý nghiệp vụ gốc |
| Degraded state | Widget lỗi module nguồn trả degraded/error state |
| Mobile compact | `view=compact` cho header/mobile nếu kịp |

### 5.2 Ngoài phạm vi Sprint 4

| Nội dung | Đưa sang giai đoạn sau |
| --- | --- |
| Sprint/Scrum backlog/story point | Phase sau |
| Gantt chart, dependency, milestone | Phase sau |
| Time tracking theo task | Phase sau hoặc tích hợp ATT nâng cao |
| Task automation/workflow rule engine | Phase sau |
| Realtime WebSocket notification | Phase sau |
| Mobile push notification | Phase mobile |
| Email delivery provider đầy đủ | Phase sau |
| Notification digest | Phase sau |
| Dashboard BI/report nâng cao | Phase reporting |
| Drag/drop cá nhân hóa dashboard | Phase sau |
| Export dashboard PDF/Excel | Phase sau |
| AI summary dashboard/notification | Phase 5 |

---

## 6. Điều kiện đầu vào trước khi bắt đầu Sprint 4

### 6.1 Product/Business

- [ ] Đã chốt trạng thái task MVP: Todo, In Progress, In Review, Done, Cancelled.
- [ ] Đã chốt priority MVP: Low, Medium, High, Urgent.
- [ ] Đã chốt project role MVP: Owner, Manager, Member, Viewer.
- [ ] Đã chốt notification event MVP cần bật mặc định.
- [ ] Đã chốt dashboard widget P0/P1 cho Employee, Manager, HR, Admin.
- [ ] Đã chốt rule khi mention người không có quyền xem task.
- [ ] Đã chốt task cá nhân có được phép `project_id = null` trong MVP hay không.

### 6.2 Backend

- [ ] AUTH/RBAC guard hoạt động ổn định.
- [ ] HR employee/user mapping sẵn sàng.
- [ ] Foundation audit log, file service, sequence counter, settings đã sẵn sàng hoặc có stub.
- [ ] ATT/LEAVE đã có API/query cơ bản cho DASH đọc widget.
- [ ] API response/error/pagination theo API-01 đã thống nhất.
- [ ] Idempotency helper đã có hoặc có plan triển khai trong Sprint 4.

### 6.3 Frontend

- [ ] ModuleWorkspaceLayout, Topbar, Sidebar, App Switcher đã hoạt động.
- [ ] API client, query layer và error mapper đã sẵn sàng.
- [ ] PermissionGate, ForbiddenState, EmptyState, ErrorState, Skeleton đã sẵn sàng.
- [ ] Route registry/sidebar registry/action registry có thể thêm TASK, NOTI, DASH.
- [ ] File upload/download UI component đã có hoặc có fallback.

### 6.4 QA/DevOps

- [ ] Test database/staging có seed company, user, employee, role, permission.
- [ ] Migration pipeline chạy được từ database trống.
- [ ] Test account cho Employee, Manager, HR, Admin, Super Admin.
- [ ] Logging request id và audit log có thể truy vết.
- [ ] CI chạy unit/API test cơ bản.

---

## 7. Kế hoạch thực thi tổng quan

### 7.1 Gợi ý timeline 2 tuần

| Ngày | Trọng tâm | Backend | Frontend | QA |
| --- | --- | --- | --- | --- |
| Day 1 | Sprint kickoff + schema | Chốt migration TASK/NOTI/DASH | Route/sidebar skeleton | Review acceptance criteria |
| Day 2 | TASK core | Project/task entity + repository | Project/task list skeleton | DB/API test design |
| Day 3 | TASK workflow | Create/update/assign/status/comment | Task detail/form | API test TASK core |
| Day 4 | TASK Kanban/checklist/file/activity | Kanban/checklist/file/activity service | Kanban/comment/checklist UI | Permission test TASK |
| Day 5 | NOTI core | Event intake, notification CRUD, template | Badge/dropdown/list/detail | API test NOTI |
| Day 6 | NOTI integration | TASK event producer + recipient resolver | Deep link handling | E2E task -> noti |
| Day 7 | DASH core | Dashboard me/type/widget catalog | Dashboard shell/widget grid | API test DASH |
| Day 8 | DASH widget data/cache | Widget query + cache/invalidation | Widget data integration | Widget data scope test |
| Day 9 | Integration hardening | Due soon/overdue job, audit, seed | State polish, empty/error | E2E regression |
| Day 10 | Sprint stabilization | Bug fix + OpenAPI | Bug fix + responsive | Regression + sign-off |

### 7.2 Ưu tiên P0/P1/P2

| Ưu tiên | Nội dung |
| --- | --- |
| P0 | Project/task CRUD, task assignment, status update, my tasks, notification unread/dropdown, dashboard me, dashboard task/notification widgets |
| P1 | Kanban, comment/mention, checklist, activity log, dashboard manager widgets, NOTI mark all read, template seed |
| P2 | File project/task, admin notification config, dashboard config UI, report/export, archive/hide notification nâng cao |

---

## 8. Workstream 1 - Database, migration và seed

### 8.1 TASK migration

Bảng cần tạo hoặc hoàn thiện:

```text
projects
project_members
project_files
tasks
task_assignees
task_watchers
task_comments
task_comment_mentions
task_checklists
task_checklist_items
task_files
task_activity_logs
```

MVP bắt buộc:

```text
projects
project_members
tasks
task_assignees
task_watchers
task_comments
task_checklists
task_checklist_items
task_activity_logs
```

Các bảng file/mention nên tạo nếu file service và mention notification nằm trong Sprint 4:

```text
project_files
task_files
task_comment_mentions
```

Checklist migration TASK:

- [ ] Tất cả bảng có `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- [ ] Tất cả bảng vận hành có `company_id`.
- [ ] Có FK đến `companies`, `users`, `employees`, `departments`, `files` nếu dùng.
- [ ] Có soft delete: `deleted_at`, `deleted_by` cho bảng nghiệp vụ chính.
- [ ] Có audit columns: `created_at`, `created_by`, `updated_at`, `updated_by`.
- [ ] Có unique chống trùng member/assignee/watcher active.
- [ ] Có index cho my tasks, assignee/status/due date, project Kanban, activity log.
- [ ] Có check constraint cho status, priority, project_role.
- [ ] Có sequence counter hoặc code generator cho project/task code nếu MVP dùng display code.

### 8.2 NOTI migration

Bảng cần tạo hoặc hoàn thiện:

```text
notification_events
notification_templates
notifications
notification_delivery_logs
notification_preferences
```

MVP bắt buộc:

```text
notification_events
notification_templates
notifications
notification_delivery_logs
```

Checklist migration NOTI:

- [ ] `notifications` có `company_id`, `recipient_user_id`, `source_module`, `event_code`, `target_module`, `target_type`, `target_id`, `target_url`.
- [ ] `notifications.status` hỗ trợ Unread, Read, Hidden, Archived, Deleted.
- [ ] Có `read_at`, `hidden_at`, `archived_at`, `deleted_at` nếu cần.
- [ ] `notification_events` có `event_code`, `module_code`, `enabled`, `dedupe_enabled`, `dedupe_window_seconds`, `recipient_resolver`.
- [ ] `notification_templates` hỗ trợ `channel`, `locale`, `title_template`, `short_template`, `content_template`, `variables_schema`, `status`.
- [ ] `notification_delivery_logs` ghi delivery status, retry count, error message, provider response nếu có.
- [ ] Có partial index cho unread count: `company_id`, `recipient_user_id`, `status = 'Unread'`.
- [ ] Có index cho list notification theo user + created_at.

### 8.3 DASH migration

Bảng cần tạo hoặc hoàn thiện:

```text
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
dashboard_user_widget_states
dashboard_cache_invalidations
```

MVP bắt buộc:

```text
dashboard_widgets
dashboard_widget_configs
dashboard_widget_cache
```

Checklist migration DASH:

- [ ] `dashboard_widgets` có `widget_code`, `widget_name`, `widget_type`, `source_modules`, `required_permission`, `status`.
- [ ] `dashboard_widget_configs` hỗ trợ config theo company/role/user/dashboard_type.
- [ ] `dashboard_widget_cache` có `cache_key`, `widget_code`, `dashboard_type`, `data`, `expires_at`, `source_event_version` nếu cần.
- [ ] `dashboard_cache_invalidations` ghi event invalidate nếu triển khai ngay.
- [ ] Có index theo `company_id`, `dashboard_type`, `widget_code`, `expires_at`.
- [ ] Cache không lưu dữ liệu nhạy cảm ngoài scope hoặc dữ liệu chưa mask.

### 8.4 Seed Sprint 4

Seed bắt buộc:

| Nhóm | Seed |
| --- | --- |
| Module | TASK, NOTI, DASH active trong module catalog |
| Permission TASK | Project, member, task, assign, status, kanban, comment, checklist, file, report |
| Permission NOTI | View own, count unread, mark read, mark all read, config event/template/channel, log |
| Permission DASH | View dashboard type, view widget, config, cache refresh |
| Role-permission | Employee, Manager, HR, Admin, Super Admin mapping |
| Notification event | TASK_ASSIGNED, TASK_ASSIGNEE_CHANGED, TASK_STATUS_CHANGED, TASK_PRIORITY_CHANGED, TASK_DUE_DATE_CHANGED, TASK_COMMENT_CREATED, TASK_MENTIONED, TASK_DUE_SOON, TASK_OVERDUE, PROJECT_MEMBER_ADDED, PROJECT_MEMBER_REMOVED, PROJECT_CLOSED (mã chuẩn theo §9.5; event chưa bật MVP để `enabled=false`, không bỏ khỏi catalog) |
| Notification template | Template IN_APP tiếng Việt cho event Sprint 4 |
| Dashboard widget | ATTENDANCE_TODAY, MY_TASKS, TASK_ALERTS, NOTIFICATIONS, PENDING_LEAVE, PROJECT_PROGRESS, HR_OVERVIEW |
| Dashboard config | Default widget theo Employee, Manager, HR, Admin (chỉ widget in-sprint P0/P1, xem §11.3) |

> Mã `Notification event` ở trên là mã chuẩn theo **Event code registry §9.5**; danh sách `Dashboard widget` phải khớp tập widget in-sprint của §11.3 (xem cột **Scope** §11.3).

---

## 9. Workstream 2 - Backend TASK

### 9.1 Cấu trúc module backend đề xuất

```text
src/modules/task
  task.module.ts
  controllers
    project.controller.ts
    project-member.controller.ts
    task.controller.ts
    task-assignment.controller.ts
    task-status.controller.ts
    task-comment.controller.ts
    task-checklist.controller.ts
    task-file.controller.ts
    task-activity.controller.ts
    task-report.controller.ts
  services
    project.service.ts
    project-member.service.ts
    task.service.ts
    task-assignment.service.ts
    task-status.service.ts
    task-comment.service.ts
    task-checklist.service.ts
    task-file.service.ts
    task-activity-log.service.ts
    task-event-producer.service.ts
    task-scope.service.ts
    task-report.service.ts
  repositories
    project.repository.ts
    task.repository.ts
    task-comment.repository.ts
    task-activity.repository.ts
  dto
  policies
  jobs
    task-due-reminder.job.ts
    task-overdue.job.ts
```

### 9.2 API cần hoàn thành

| Mã | Endpoint | Mục đích | Ưu tiên |
| --- | --- | --- | --- |
| TASK-API-001 | `GET /api/v1/projects` | Danh sách project | P0 |
| TASK-API-002 | `POST /api/v1/projects` | Tạo project | P0 |
| TASK-API-003 | `GET /api/v1/projects/{id}` | Chi tiết project | P0 |
| TASK-API-004 | `PATCH /api/v1/projects/{id}` | Cập nhật project | P0 |
| TASK-API-005 | `POST /api/v1/projects/{id}/close` | Đóng project | P1 |
| TASK-API-006 | `DELETE /api/v1/projects/{id}` | Xóa mềm project | P1 |
| TASK-API-101 | `GET /api/v1/projects/{id}/members` | Danh sách member | P0 |
| TASK-API-102 | `POST /api/v1/projects/{id}/members` | Thêm member | P0 |
| TASK-API-103 | `PATCH /api/v1/projects/{id}/members/{member_id}` | Đổi role | P1 |
| TASK-API-104 | `DELETE /api/v1/projects/{id}/members/{member_id}` | Xóa member | P1 |
| TASK-API-201 | `GET /api/v1/tasks` | Danh sách task theo filter | P0 |
| TASK-API-202 | `POST /api/v1/tasks` | Tạo task | P0 |
| TASK-API-203 | `GET /api/v1/tasks/{id}` | Chi tiết task | P0 |
| TASK-API-204 | `PATCH /api/v1/tasks/{id}` | Cập nhật task | P0 |
| TASK-API-205 | `DELETE /api/v1/tasks/{id}` | Xóa mềm task | P1 |
| TASK-API-211 | `GET /api/v1/tasks/my` | Task của tôi | P0 |
| TASK-API-221 | `POST /api/v1/tasks/{id}/assign` | Giao/đổi assignee | P0 |
| TASK-API-222 | `POST /api/v1/tasks/{id}/watchers` | Thêm watcher | P1 |
| TASK-API-223 | `DELETE /api/v1/tasks/{id}/watchers/{employee_id}` | Xóa watcher | P1 |
| TASK-API-231 | `POST /api/v1/tasks/{id}/status` | Đổi trạng thái | P0 |
| TASK-API-232 | `POST /api/v1/tasks/{id}/priority` | Đổi priority | P1 |
| TASK-API-233 | `POST /api/v1/tasks/{id}/deadline` | Đổi deadline | P1 |
| TASK-API-241 | `GET /api/v1/projects/{id}/kanban` | Kanban board | P1 |
| TASK-API-242 | `POST /api/v1/tasks/{id}/move` | Kéo thả Kanban | P1 |
| TASK-API-251 | `GET /api/v1/tasks/{id}/comments` | List comment | P1 |
| TASK-API-252 | `POST /api/v1/tasks/{id}/comments` | Tạo comment/mention | P1 |
| TASK-API-253 | `PATCH /api/v1/tasks/{id}/comments/{comment_id}` | Sửa comment | P2 |
| TASK-API-254 | `DELETE /api/v1/tasks/{id}/comments/{comment_id}` | Xóa mềm comment | P2 |
| TASK-API-261 | `POST /api/v1/tasks/{id}/checklists` | Tạo checklist | P1 |
| TASK-API-262 | `POST /api/v1/tasks/{id}/checklists/{checklist_id}/items` | Tạo item | P1 |
| TASK-API-263 | `PATCH /api/v1/tasks/{id}/checklist-items/{item_id}` | Tick/update item | P1 |
| TASK-API-271 | `POST /api/v1/tasks/{id}/files` | Upload/link file | P2 |
| TASK-API-281 | `GET /api/v1/tasks/{id}/activity` | Activity log | P1 |
| TASK-API-291 | `GET /api/v1/projects/{id}/report` | Project progress report | P2 |

### 9.3 Business rule TASK P0

#### Project

- [ ] Chỉ user có `TASK.PROJECT.CREATE` mới tạo project.
- [ ] Project thuộc `company_id` từ auth context.
- [ ] Người tạo project mặc định là project Owner nếu có employee mapping.
- [ ] Không thêm member là employee đã nghỉ việc/chấm dứt.
- [ ] Không thêm trùng active member.
- [ ] Project đã Closed/Cancelled/Archived không cho tạo task mới trừ quyền override.

#### Task

- [ ] Tạo task bắt buộc có title.
- [ ] Task thuộc project hoặc task cá nhân nếu cấu hình cho phép.
- [ ] Nếu có assignee, assignee phải là employee active và thuộc phạm vi được giao.
- [ ] Nếu task thuộc project, assignee nên là project member hoặc có warning/rule tùy cấu hình.
- [ ] Deadline nằm trong ngày nghỉ đã duyệt của assignee thì cảnh báo; MVP chưa bắt buộc chặn.
- [ ] Status transition phải hợp lệ.
- [ ] Done có thể yêu cầu checklist hoàn thành nếu cấu hình bật.
- [ ] Xóa task là soft delete.

#### Comment/Mention

- [ ] Chỉ người xem được task mới comment.
- [ ] Comment không được rỗng.
- [ ] Mention người không có quyền xem task phải cảnh báo hoặc không cho mention.
- [ ] Comment delete là soft delete.
- [ ] Comment/mention phát event cho NOTI theo cấu hình.

#### Activity log

Các action tối thiểu phải ghi:

```text
PROJECT_CREATED
PROJECT_UPDATED
PROJECT_MEMBER_ADDED
PROJECT_MEMBER_REMOVED
TASK_CREATED
TASK_UPDATED
TASK_ASSIGNED
TASK_STATUS_CHANGED
TASK_PRIORITY_CHANGED
TASK_DUE_DATE_CHANGED
TASK_COMMENT_CREATED
TASK_COMMENT_DELETED
TASK_CHECKLIST_CREATED
TASK_CHECKLIST_ITEM_DONE
TASK_FILE_UPLOADED
TASK_FILE_DELETED
TASK_DELETED
```

### 9.4 Event TASK phát sang NOTI

| Event | Khi nào phát | Recipient |
| --- | --- | --- |
| `TASK_ASSIGNED` | Task được giao cho assignee | Assignee mới |
| `TASK_ASSIGNEE_CHANGED` | Đổi assignee chính | Assignee mới, watcher nếu cấu hình |
| `TASK_STATUS_CHANGED` | Đổi trạng thái | Reporter, watcher, assignee nếu không phải actor |
| `TASK_PRIORITY_CHANGED` | Đổi priority | Assignee, watcher |
| `TASK_DUE_DATE_CHANGED` | Đổi deadline | Assignee, watcher |
| `TASK_COMMENT_CREATED` | Có comment mới | Assignee, watcher, reporter, trừ actor |
| `TASK_MENTIONED` | Comment có mention | Người được mention |
| `TASK_DUE_SOON` | Job phát hiện sắp đến hạn | Assignee |
| `TASK_OVERDUE` | Job phát hiện quá hạn | Assignee, manager nếu cấu hình |
| `PROJECT_MEMBER_ADDED` | Thêm member vào project | Member được thêm |
| `PROJECT_MEMBER_REMOVED` | Xóa member khỏi project | Member bị xóa |
| `PROJECT_CLOSED` | Project đóng | Member/watcher nếu cấu hình |

> Mã event trong bảng này phải khớp **Event code registry §9.5**. Không thêm/đổi tên ngoài registry.

Payload không chứa file URL private, nội dung comment dài hoặc dữ liệu nhạy cảm.

### 9.5 Event code registry (canonical)

Đây là nguồn chân lý duy nhất (single source of truth) cho mã event Sprint 4. Mọi nơi khác phải tham chiếu đúng mã trong bảng này, gồm: **seed event (§8.4)**, **bảng producer TASK (§9.4)**, **template NOTI (§10.4)** và **bảng invalidation DASH (§11.5)**. Không được tự đặt tên mới hoặc dùng biến thể chưa khai báo ở đây.

| Canonical event code | Module phát (producer) | Consumer | Alias / lưu ý |
| --- | --- | --- | --- |
| `TASK_ASSIGNED` | TASK | NOTI, DASH | Phát khi giao task lần đầu hoặc gán assignee mới |
| `TASK_ASSIGNEE_CHANGED` | TASK | NOTI, DASH | Đổi assignee chính (khác với gán lần đầu) |
| `TASK_STATUS_CHANGED` | TASK | NOTI, DASH | - |
| `TASK_PRIORITY_CHANGED` | TASK | NOTI | - |
| `TASK_DUE_DATE_CHANGED` | TASK | NOTI, DASH | DASH invalidate TASK_ALERTS/MY_TASKS |
| `TASK_COMMENT_CREATED` | TASK | NOTI | - |
| `TASK_MENTIONED` | TASK | NOTI | **Canonical.** Alias cũ: `TASK_MENTIONED` (đang dùng ở seed §8.4) -> phải đổi sang `TASK_MENTIONED` |
| `TASK_DUE_SOON` | TASK (job) | NOTI, DASH | DASH invalidate TASK_ALERTS |
| `TASK_OVERDUE` | TASK (job) | NOTI, DASH | DASH invalidate TASK_ALERTS |
| `PROJECT_MEMBER_ADDED` | TASK | NOTI | - |
| `PROJECT_MEMBER_REMOVED` | TASK | NOTI | - |
| `PROJECT_CLOSED` | TASK | NOTI | - |
| `NOTIFICATION_CREATED` | NOTI | DASH | NOTI tự phát khi tạo notification; DASH invalidate widget NOTIFICATIONS |
| `NOTIFICATION_READ` | NOTI | DASH | Phát khi mark read / mark all read; DASH invalidate NOTIFICATIONS |

Ghi chú đồng bộ bắt buộc (BẮT BUỘC reconcile trước khi code freeze Sprint 4):

- **Seed §8.4**: bổ sung các event đang thiếu so với producer (`TASK_ASSIGNEE_CHANGED`, `TASK_PRIORITY_CHANGED`, `TASK_DUE_DATE_CHANGED`, `PROJECT_MEMBER_REMOVED`, `PROJECT_CLOSED`) và đổi `TASK_MENTIONED` -> `TASK_MENTIONED`. Nếu một event không có template/không bật trong MVP thì khai báo `enabled=false` chứ không bỏ khỏi catalog.
- **Producer §9.4**: chỉ phát các mã có trong registry; không phát mã lạ.
- **Template §10.4**: mỗi event `enabled=true` phải có template VI; dùng đúng canonical code (đã dùng `TASK_MENTIONED`, đúng).
- **DASH invalidation §11.5**: chỉ được dùng mã do một producer thực sự phát ra. Các key như `TASK_CREATED`, `LEAVE_*`, `ATTENDANCE_*`, `EMPLOYEE_CREATED`, `CONTRACT_UPDATED` thuộc module ATT/LEAVE/HR (ngoài phạm vi event của Sprint 4 doc này) hoặc chưa có producer trong TASK; phải map về event do module nguồn phát (xem IMPLEMENTATION-06 cho ATT/LEAVE) hoặc loại bỏ khỏi bảng invalidation Sprint 4. `TASK_CREATED` hiện chưa nằm trong producer TASK (§9.4) -> hoặc bổ sung vào producer, hoặc thay bằng `TASK_ASSIGNED`.

---

## 10. Workstream 3 - Backend NOTI

### 10.1 Cấu trúc module backend đề xuất

```text
src/modules/notification
  notification.module.ts
  controllers
    my-notification.controller.ts
    notification-action.controller.ts
    notification-admin.controller.ts
    notification-event.controller.ts
    notification-template.controller.ts
    notification-channel.controller.ts
    notification-delivery-log.controller.ts
    internal-notification.controller.ts
  services
    notification.service.ts
    notification-event.service.ts
    notification-template.service.ts
    notification-renderer.service.ts
    notification-recipient-resolver.service.ts
    notification-delivery.service.ts
    notification-dedupe.service.ts
    notification-target.service.ts
    notification-preference.service.ts
  repositories
    notification.repository.ts
    notification-event.repository.ts
    notification-template.repository.ts
    notification-delivery-log.repository.ts
  jobs
    notification-retry.job.ts
```

### 10.2 API cần hoàn thành

| Mã | Endpoint | Mục đích | Ưu tiên |
| --- | --- | --- | --- |
| NOTI-API-001 | `GET /api/v1/notifications` | Danh sách notification của tôi | P0 |
| NOTI-API-002 | `GET /api/v1/notifications/dropdown` | Dropdown/header latest | P0 |
| NOTI-API-003 | `GET /api/v1/notifications/unread-count` | Đếm unread | P0 |
| NOTI-API-004 | `GET /api/v1/notifications/{id}` | Chi tiết notification | P0 |
| NOTI-API-005 | `POST /api/v1/notifications/{id}/mark-read` | Mark read một notification | P0 |
| NOTI-API-006 | `POST /api/v1/notifications/mark-all-read` | Mark all read | P1 |
| NOTI-API-007 | `DELETE /api/v1/notifications/{id}` | Xóa mềm notification của tôi | P2 |
| NOTI-API-101 | `GET /api/v1/notifications/events` | Xem event catalog | P2 |
| NOTI-API-102 | `PATCH /api/v1/notifications/events/{id}` | Bật/tắt event | P2 |
| NOTI-API-201 | `GET /api/v1/notifications/templates` | Xem template | P2 |
| NOTI-API-202 | `PATCH /api/v1/notifications/templates/{id}` | Cập nhật template | P2 |
| NOTI-API-301 | `GET /api/v1/notifications/delivery-logs` | Xem delivery log | P2 |
| NOTI-API-901 | `POST /internal/v1/notifications/events` | Module khác gửi event | P0 |
| NOTI-API-902 | `POST /internal/v1/notifications/send` | Gửi direct notification | P1 |
| NOTI-API-903 | `POST /internal/v1/notifications/bulk-send` | Gửi bulk | P2 |

### 10.3 Business rule NOTI P0

- [ ] User chỉ xem notification của chính mình qua API cá nhân.
- [ ] Mọi query notification filter theo `company_id` và `recipient_user_id`.
- [ ] Notification target URL phải là route nội bộ hợp lệ, không nhận URL ngoài tùy ý.
- [ ] Mark read chỉ áp dụng notification thuộc user hiện tại.
- [ ] Unread count dùng index/partial index, không scan toàn bảng.
- [ ] Internal event phải có service token hoặc queue trusted context.
- [ ] Event disabled thì delivery log ghi Skipped nếu cần.
- [ ] Template disabled/missing phải fallback template mặc định hoặc ghi Failed rõ ràng.
- [ ] Dedupe window áp dụng cho event dễ spam như comment/status update.
- [ ] Không gửi notification cho actor nếu actor cũng là recipient, trừ event security/system bắt buộc.

### 10.4 Template tiếng Việt P0

| Event | Title | Short content |
| --- | --- | --- |
| `TASK_ASSIGNED` | Bạn có công việc mới | Bạn được giao task {task_title} |
| `TASK_STATUS_CHANGED` | Công việc đã đổi trạng thái | Task {task_title} chuyển sang {new_status} |
| `TASK_COMMENT_CREATED` | Có bình luận mới | {actor_name} đã bình luận trong task {task_title} |
| `TASK_MENTIONED` | Bạn được nhắc đến trong task | {actor_name} đã nhắc đến bạn trong {task_title} |
| `TASK_DUE_SOON` | Công việc sắp đến hạn | Task {task_title} sắp đến hạn vào {due_at} |
| `TASK_OVERDUE` | Công việc quá hạn | Task {task_title} đã quá hạn |
| `PROJECT_MEMBER_ADDED` | Bạn được thêm vào dự án | Bạn đã được thêm vào dự án {project_name} |

> Cột `Event` phải dùng mã chuẩn theo **Event code registry §9.5** (đã dùng `TASK_MENTIONED`, đúng — không dùng alias `TASK_MENTIONED`). Mỗi event `enabled=true` trong seed §8.4 cần có template VI tương ứng.

### 10.5 Notification target/deep link

Target URL phải theo route module gốc:

| Source | Target URL |
| --- | --- |
| Task detail | `/tasks/{task_id}` hoặc `/projects/{project_id}/tasks/{task_id}` theo route final |
| Project detail | `/projects/{project_id}` |
| Comment mention | `/tasks/{task_id}?comment_id={comment_id}` |
| Dashboard notification widget | Điều hướng notification detail hoặc target module gốc |

Frontend không được bỏ qua route guard khi deep link. Module gốc phải gọi API chi tiết và backend kiểm tra quyền lại.

---

## 11. Workstream 4 - Backend DASH

### 11.1 Cấu trúc module backend đề xuất

```text
src/modules/dashboard
  dashboard.module.ts
  controllers
    dashboard-me.controller.ts
    dashboard-type.controller.ts
    dashboard-widget.controller.ts
    dashboard-config.controller.ts
    internal-dashboard-cache.controller.ts
  services
    dashboard-resolver.service.ts
    dashboard-widget-registry.service.ts
    dashboard-widget-data.service.ts
    dashboard-permission.service.ts
    dashboard-cache.service.ts
    dashboard-cache-invalidation.service.ts
    dashboard-config.service.ts
    widgets
      attendance-today.widget.ts
      my-tasks.widget.ts
      task-alerts.widget.ts
      notifications.widget.ts
      pending-leave.widget.ts
      leave-balance.widget.ts
      project-progress.widget.ts
      hr-overview.widget.ts
```

### 11.2 API cần hoàn thành

| Mã | Endpoint | Mục đích | Ưu tiên |
| --- | --- | --- | --- |
| DASH-API-001 | `GET /api/v1/dashboard/me` | Dashboard mặc định của user hiện tại | P0 |
| DASH-API-002 | `GET /api/v1/dashboard/types` | Dashboard type user được xem | P1 |
| DASH-API-003 | `GET /api/v1/dashboard/{type}` | Dashboard theo type | P0 |
| DASH-API-004 | `GET /api/v1/dashboard/widgets` | Widget catalog khả dụng | P1 |
| DASH-API-005 | `GET /api/v1/dashboard/widgets/{slug}` | Dữ liệu một widget | P0 |
| DASH-API-006 | `GET /api/v1/dashboard/configs` | Xem config widget | P2 |
| DASH-API-007 | `PATCH /api/v1/dashboard/configs/{id}` | Cập nhật config widget | P2 |
| DASH-API-901 | `POST /internal/v1/dashboard/cache/invalidate` | Invalidate cache theo event | P1 |
| DASH-API-902 | `POST /internal/v1/dashboard/cache/warmup` | Warmup cache | P2 |

### 11.3 Widget MVP

Đây là **catalog đầy đủ** của widget. Cột **Scope** xác định widget nào nằm trong phạm vi Sprint 4 (`In-sprint`) và widget nào chỉ khai báo catalog/đẩy sang sau (`Catalog-only`). Chỉ widget `In-sprint` mới được seed mặc định (§8.4) và có FE component (§14.2). Widget `Catalog-only` có thể được khai báo trong `dashboard_widgets` nhưng không bật mặc định và không bắt buộc FE trong Sprint 4.

| Widget code | Dashboard | Nguồn | Ưu tiên | Scope |
| --- | --- | --- | --- | --- |
| `ATTENDANCE_TODAY` | Employee | ATT, LEAVE, HR | P0 | In-sprint |
| `MY_TASKS` | Employee, Manager | TASK | P0 | In-sprint |
| `TASK_ALERTS` | Employee, Manager | TASK | P0 | In-sprint |
| `NOTIFICATIONS` | All | NOTI | P0 | In-sprint |
| `PENDING_LEAVE` | Manager, HR | LEAVE | P1 | In-sprint |
| `PROJECT_PROGRESS` | Manager, HR/Admin nếu có quyền | TASK | P1 | In-sprint |
| `HR_OVERVIEW` | HR/Admin | HR | P2 | In-sprint (seed + FE; P2 nếu thiếu thời gian) |
| `LEAVE_BALANCE` | Employee | LEAVE | P1 | Catalog-only (deferred) |
| `LEAVE_CALENDAR` | Manager, HR | LEAVE | P2 | Catalog-only (deferred) |
| `TEAM_TASKS_TODAY` | Manager | TASK, HR | P1 | Catalog-only (deferred) |
| `NEW_EMPLOYEES` | HR | HR | P2 | Catalog-only (deferred) |
| `CONTRACT_EXPIRING` | HR | HR | P2 | Catalog-only (deferred) |
| `ATTENDANCE_ALERTS` | HR/Manager | ATT | P2 | Catalog-only (deferred) |
| `CONFIG_WARNINGS` | Admin | FOUNDATION/AUTH | P2 | Catalog-only (deferred) |

> Tập **In-sprint** ở trên là nguồn chuẩn cho widget Sprint 4. Seed widget (§8.4) phải khớp đúng 7 widget In-sprint này; FE component list (§14.2) cũng bám theo tập này. Nếu PO chốt thêm/bớt widget In-sprint thì cập nhật đồng thời cả §8.4, §11.3 và §14.2.

### 11.4 Nguyên tắc query widget

- [ ] Mọi query dashboard filter theo `company_id`.
- [ ] Widget data phải áp dụng permission và data scope trước khi aggregate.
- [ ] Widget nhạy cảm cần kiểm tra cả permission DASH và permission module nguồn.
- [ ] Widget list phải có limit.
- [ ] Query nặng phải dùng cache TTL ngắn hoặc lazy load.
- [ ] Nếu module nguồn lỗi, widget trả `Degraded` hoặc `Error`, không làm sập toàn dashboard.
- [ ] Dashboard chỉ trả quick action metadata; action thật gọi module gốc.
- [ ] Cache key phải bao gồm company, dashboard_type, widget_code, user/scope context nếu data theo user.
- [ ] Cache không dùng chung giữa user khác nếu dữ liệu là Own/Team/Department nhạy cảm.

### 11.5 Cache và invalidation

| Event | Widget cần invalidate |
| --- | --- |
| `TASK_CREATED` | MY_TASKS, TEAM_TASKS_TODAY, PROJECT_PROGRESS |
| `TASK_ASSIGNED` | MY_TASKS, TEAM_TASKS_TODAY, TASK_ALERTS |
| `TASK_STATUS_CHANGED` | MY_TASKS, TASK_ALERTS, PROJECT_PROGRESS |
| `TASK_DUE_DATE_CHANGED` | TASK_ALERTS, MY_TASKS |
| `TASK_OVERDUE` | TASK_ALERTS |
| `NOTIFICATION_CREATED` | NOTIFICATIONS |
| `NOTIFICATION_READ` | NOTIFICATIONS |
| `LEAVE_REQUEST_SUBMITTED` | PENDING_LEAVE, LEAVE_CALENDAR |
| `LEAVE_APPROVED` | LEAVE_BALANCE, PENDING_LEAVE, LEAVE_CALENDAR, ATTENDANCE_TODAY |
| `ATTENDANCE_CHECKED_IN` | ATTENDANCE_TODAY |
| `ATTENDANCE_CHECKED_OUT` | ATTENDANCE_TODAY |
| `EMPLOYEE_CREATED` | HR_OVERVIEW, NEW_EMPLOYEES |
| `CONTRACT_UPDATED` | CONTRACT_EXPIRING |

> Cột `Event` phải dùng mã do một producer thực sự phát ra theo **Event code registry §9.5**. Cảnh báo reconcile: `TASK_CREATED` hiện chưa có producer trong §9.4 (bổ sung vào producer hoặc thay bằng `TASK_ASSIGNED`); `NOTIFICATION_CREATED`/`NOTIFICATION_READ` do NOTI phát (đã có trong registry); `LEAVE_REQUEST_SUBMITTED`, `LEAVE_APPROVED`, `ATTENDANCE_CHECKED_IN`, `ATTENDANCE_CHECKED_OUT`, `EMPLOYEE_CREATED`, `CONTRACT_UPDATED` thuộc module ATT/LEAVE/HR (xem IMPLEMENTATION-06) — chỉ giữ trong bảng nếu module nguồn thực sự phát đúng mã đó, nếu không phải loại bỏ hoặc map lại.

---

## 12. Workstream 5 - Frontend TASK

### 12.1 Route đề xuất

```text
/tasks
/tasks/my
/tasks/kanban
/tasks/{task_id}
/tasks/{task_id}/activity
/projects
/projects/new
/projects/{project_id}
/projects/{project_id}/tasks
/projects/{project_id}/kanban
/projects/{project_id}/members
/projects/{project_id}/files
```

Nếu sản phẩm muốn route TASK nằm dưới project workspace, có thể dùng:

```text
/task/projects
/task/projects/{project_id}
/task/tasks/{task_id}
```

Điều quan trọng là route metadata phải có module code `TASK`, permission và sidebar group rõ ràng.

### 12.2 Component/page cần triển khai

| Component/Page | Mục đích | Ưu tiên |
| --- | --- | --- |
| `ProjectListPage` | Danh sách project | P0 |
| `ProjectDetailPage` | Overview project + task summary | P0 |
| `ProjectFormDrawer` | Tạo/sửa project | P0 |
| `ProjectMemberTable` | Danh sách/thêm/sửa/xóa member | P1 |
| `TaskListPage` | Danh sách task filter/search | P0 |
| `MyTasksPage` | Việc của tôi | P0 |
| `TaskDetailPage` | Chi tiết task | P0 |
| `TaskFormDrawer` | Tạo/sửa task | P0 |
| `TaskAssignControl` | Assignee/watcher | P0 |
| `TaskStatusSelect` | Đổi status/priority/deadline | P0 |
| `TaskKanbanPage` | Kanban board | P1 |
| `TaskCommentThread` | Comment/mention | P1 |
| `TaskChecklistPanel` | Checklist item | P1 |
| `TaskFilePanel` | File task/project | P2 |
| `TaskActivityTimeline` | Activity log | P1 |
| `ProjectProgressCard` | Summary tiến độ | P1 |

### 12.3 Frontend behavior

- [ ] Sidebar TASK hiển thị theo permission.
- [ ] Button Create Project/Task ẩn hoặc disable theo permission.
- [ ] Direct URL task trái quyền hiển thị Forbidden hoặc Not Found theo policy.
- [ ] Task list hỗ trợ filter: status, priority, assignee, project, due range, overdue.
- [ ] Task detail có optimistic update vừa đủ cho status/checklist, nhưng phải rollback khi API lỗi.
- [ ] Kanban kéo thả chỉ bật khi user có quyền update status.
- [ ] Mention autocomplete chỉ hiển thị user/employee có quyền phù hợp hoặc cảnh báo rõ.
- [ ] Comment/delete dùng confirm khi cần.
- [ ] File upload hiển thị progress nếu có helper.
- [ ] Notification deep link mở đúng task và highlight comment nếu có `comment_id`.

---

## 13. Workstream 6 - Frontend NOTI

### 13.1 Route đề xuất

```text
/notifications
/notifications/{notification_id}
/notifications/settings
/notifications/events
/notifications/templates
/notifications/delivery-logs
```

Các route admin có thể nằm trong System/Admin workspace nếu muốn:

```text
/system/notifications/events
/system/notifications/templates
/system/notifications/delivery-logs
```

### 13.2 Component/page cần triển khai

| Component/Page | Mục đích | Ưu tiên |
| --- | --- | --- |
| `NotificationBadge` | Badge unread ở topbar | P0 |
| `NotificationDropdown` | Dropdown latest notification | P0 |
| `NotificationListPage` | Danh sách notification | P0 |
| `NotificationDetailPage` | Chi tiết notification | P0 |
| `NotificationListItem` | Item trong dropdown/list | P0 |
| `MarkReadButton` | Mark read một item | P0 |
| `MarkAllReadButton` | Mark all read | P1 |
| `NotificationTargetLink` | Deep link an toàn | P0 |
| `NotificationEventConfigPage` | Event config admin | P2 |
| `NotificationTemplatePage` | Template config admin | P2 |
| `DeliveryLogPage` | Log gửi notification | P2 |

### 13.3 Frontend behavior

- [ ] Badge unread gọi endpoint nhẹ, có polling ngắn hoặc refresh theo mutation.
- [ ] Dropdown lấy latest notification, không load toàn bộ list.
- [ ] Click notification có thể mark read rồi navigate target.
- [ ] Nếu target user không còn quyền xem, route/module gốc hiển thị Forbidden/Not Found.
- [ ] Mark all read invalidate unread count, dropdown và dashboard notification widget.
- [ ] Notification deleted/hidden không còn hiện trong list mặc định.
- [ ] Empty state rõ: “Bạn chưa có thông báo mới”.
- [ ] Error state không làm vỡ topbar; badge có fallback.

---

## 14. Workstream 7 - Frontend DASH

### 14.1 Route đề xuất

```text
/dashboard
/dashboard/employee
/dashboard/manager
/dashboard/hr
/dashboard/admin
/dashboard/widgets/{widget_slug}
/dashboard/settings
```

### 14.2 Component/page cần triển khai

| Component/Page | Mục đích | Ưu tiên |
| --- | --- | --- |
| `DashboardMePage` | Dashboard mặc định | P0 |
| `DashboardTypeSwitcher` | Chọn Employee/Manager/HR/Admin nếu có quyền | P1 |
| `DashboardWidgetGrid` | Grid widget responsive | P0 |
| `WidgetCard` | Shell widget dùng chung | P0 |
| `AttendanceTodayWidget` | Chấm công hôm nay | P1 nếu ATT Sprint 3 đã sẵn |
| `MyTasksWidget` | Task của tôi | P0 |
| `TaskAlertsWidget` | Task quá hạn/sắp đến hạn | P0 |
| `NotificationsWidget` | Thông báo mới | P0 |
| `PendingLeaveWidget` | Đơn nghỉ chờ duyệt | P1 |
| `ProjectProgressWidget` | Tiến độ dự án | P1 |
| `HrOverviewWidget` | Tổng quan nhân sự | P2 |
| `DashboardConfigPage` | Cấu hình widget | P2 |

> Danh sách widget component này bám theo tập **In-sprint** của §11.3 (7 widget: ATTENDANCE_TODAY, MY_TASKS, TASK_ALERTS, NOTIFICATIONS, PENDING_LEAVE, PROJECT_PROGRESS, HR_OVERVIEW). Widget `Catalog-only` (LEAVE_BALANCE, LEAVE_CALENDAR, TEAM_TASKS_TODAY, NEW_EMPLOYEES, CONTRACT_EXPIRING, ATTENDANCE_ALERTS, CONFIG_WARNINGS) chưa cần FE component trong Sprint 4.

### 14.3 Frontend behavior

- [ ] Dashboard load shell trước, widget lazy load nếu cần.
- [ ] Widget thiếu quyền bị ẩn hoặc trả Hidden theo backend config.
- [ ] Widget lỗi module nguồn hiển thị Degraded/ErrorState, không làm sập dashboard.
- [ ] Quick action chỉ điều hướng sang module gốc hoặc gọi API module gốc.
- [ ] Refresh widget riêng lẻ hỗ trợ `refresh=true` nếu API cho phép.
- [ ] Compact view cho mobile/header nếu kịp.
- [ ] Widget data hiển thị `last_updated_at` nếu cache hit.
- [ ] Không hard-code dashboard theo role; dựa vào dashboard types/backend response.

---

## 15. Tích hợp end-to-end trọng tâm

### 15.1 Flow E2E 1 - Giao task và nhận thông báo

```text
Manager mở TASK
-> Tạo task mới và gán Employee A
-> Backend TASK tạo task + assignee + activity log
-> TASK phát event TASK_ASSIGNED
-> NOTI resolve Employee A user_id
-> NOTI render template và tạo notification IN_APP
-> Employee A thấy badge unread tăng
-> Employee A mở dropdown, click notification
-> Frontend mark read và navigate task detail
-> TASK detail API kiểm tra quyền Employee A
-> Employee A thấy task được giao
```

Acceptance criteria:

- [ ] Task tạo thành công.
- [ ] Activity log có TASK_CREATED và TASK_ASSIGNED.
- [ ] Notification được tạo đúng recipient.
- [ ] Actor không tự nhận notification nếu actor cũng là assignee và policy exclude actor bật.
- [ ] Unread count tăng đúng.
- [ ] Click notification mở đúng task.
- [ ] Mark read cập nhật unread count.

### 15.2 Flow E2E 2 - Comment mention trong task

```text
Employee A comment trong task và mention Employee B
-> TASK kiểm tra Employee B có quyền xem task hoặc cảnh báo
-> TASK lưu comment + mention
-> TASK phát TASK_MENTIONED
-> NOTI tạo notification cho Employee B
-> Employee B click notification
-> Mở task detail và highlight comment
```

Acceptance criteria:

- [ ] Comment không rỗng.
- [ ] Mention được lưu.
- [ ] Notification không chứa toàn bộ nội dung comment nhạy cảm.
- [ ] Deep link có comment id hoặc highlight logic.

### 15.3 Flow E2E 3 - Dashboard task widget

```text
Employee mở Dashboard
-> DASH resolve Employee Dashboard
-> DASH load MY_TASKS và TASK_ALERTS widget
-> Widget query TASK theo Own scope
-> Employee chỉ thấy task được giao/tạo/theo dõi
-> Click task trong widget
-> Điều hướng sang TASK detail
```

Acceptance criteria:

- [ ] Không hiển thị task ngoài scope.
- [ ] Widget có loading/empty/error state.
- [ ] Quick action điều hướng module gốc.
- [ ] Widget refresh sau khi task status thay đổi.

### 15.4 Flow E2E 4 - Dashboard notification widget

```text
User mở Dashboard
-> DASH load NOTIFICATIONS widget
-> Widget đọc latest notifications từ NOTI
-> User click notification
-> Mark read nếu policy bật
-> Navigate target module
```

Acceptance criteria:

- [ ] Widget chỉ lấy notification của user hiện tại.
- [ ] Unread state đồng bộ với topbar badge.
- [ ] Notification target route an toàn.

### 15.5 Flow E2E 5 - Task due soon/overdue job

```text
Scheduled job chạy
-> TASK tìm task sắp đến hạn/quá hạn
-> TASK phát TASK_DUE_SOON/TASK_OVERDUE
-> NOTI dedupe event theo window
-> DASH invalidate TASK_ALERTS
-> User thấy notification và dashboard alert
```

Acceptance criteria:

- [ ] Không spam notification trùng trong dedupe window.
- [ ] Task Done/Cancelled không bị báo overdue.
- [ ] Dashboard task alerts cập nhật sau invalidate hoặc TTL.

---

## 16. Permission và data scope Sprint 4

### 16.1 Nguyên tắc chung

- [ ] Backend không hard-code theo role name.
- [ ] Frontend chỉ ẩn/disable để cải thiện UX, không thay thế backend guard.
- [ ] Mọi API list/detail/mutation đều check `company_id` từ auth context.
- [ ] Data scope được áp dụng trước khi trả dữ liệu hoặc aggregate.
- [ ] Direct URL trái quyền bị chặn ở frontend route guard và backend API guard.
- [ ] Field hoặc file nhạy cảm phải được backend mask/chặn trước khi response.

### 16.2 TASK data scope

| Scope | Dữ liệu được xem |
| --- | --- |
| Own | Task do mình tạo, được giao, đang theo dõi hoặc project mình tham gia |
| Team | Task của nhân viên thuộc team mình quản lý |
| Department | Task thuộc phòng ban hoặc assignee thuộc phòng ban được phân quyền |
| Project | Task thuộc project mà user là member/owner |
| Company | Tất cả project/task trong công ty |
| System | Liên công ty, chỉ Super Admin |

### 16.3 NOTI data scope

| Scope | Dữ liệu được xem |
| --- | --- |
| Own | Notification của user hiện tại |
| Company | Notification/log toàn công ty nếu có quyền admin |
| System | Notification/log toàn hệ thống nếu Super Admin |

### 16.4 DASH data scope

| Scope | Dữ liệu widget |
| --- | --- |
| Own | Chấm công của tôi, task của tôi, phép của tôi, notification của tôi |
| Team | Task team, leave pending team, attendance team |
| Department | Widget theo phòng ban được phân quyền |
| Project | Widget project/task mà user là member hoặc có quyền |
| Company | HR/Admin summary toàn công ty |
| System | Super Admin/system widget |

---

## 17. Query, cache và hiệu năng

### 17.1 Query P0 cần tối ưu

| Query | Index/chiến lược |
| --- | --- |
| My tasks | `company_id`, `main_assignee_employee_id`, `status`, `due_at` |
| Task list | `company_id`, `project_id`, `status`, `priority`, `due_at` |
| Kanban board | `company_id`, `project_id`, `status`, `order_index` nếu có |
| Task overdue | `company_id`, `due_at`, `status` partial where not Done/Cancelled |
| Notification unread count | Partial index `recipient_user_id`, `status = Unread` |
| Notification dropdown | `recipient_user_id`, `created_at DESC`, exclude deleted/hidden |
| Dashboard widget cache | `cache_key`, `expires_at`, `company_id`, `widget_code` |

### 17.2 Cache TTL đề xuất

| Widget | TTL |
| --- | --- |
| MY_TASKS | 30-60 giây |
| TASK_ALERTS | 30-60 giây |
| NOTIFICATIONS | 0-10 giây hoặc không cache |
| PROJECT_PROGRESS | 60-120 giây |
| ATTENDANCE_TODAY | 10-30 giây |
| PENDING_LEAVE | 30-120 giây |
| HR_OVERVIEW | 5-15 phút |

### 17.3 Performance checklist

- [ ] Không có query thiếu `company_id`.
- [ ] List API có pagination/limit.
- [ ] Dashboard không query toàn bộ dữ liệu để đếm nếu có thể aggregate/index.
- [ ] Notification unread count không scan bảng lớn.
- [ ] Kanban không load quá nhiều task; giới hạn theo project/status.
- [ ] Eager loading có kiểm soát, tránh N+1 assignee/comment/checklist.
- [ ] Query dashboard nặng có cache hoặc TTL.
- [ ] `EXPLAIN ANALYZE` cho query P0 trước release.

---

## 18. QA plan Sprint 4

### 18.1 Test API TASK

| Nhóm | Test chính |
| --- | --- |
| Project | Create/list/detail/update/delete soft |
| Member | Add/update role/remove; trùng member; employee inactive |
| Task | Create/list/detail/update/delete soft |
| Assignment | Assign/change assignee/watcher; scope invalid |
| Status | Valid transition, invalid transition, Done với checklist chưa xong nếu bật rule |
| Kanban | Load board, move card, permission read-only |
| Comment | Create/update/delete, empty comment, mention valid/invalid |
| Checklist | Create item, tick/untick, order nếu có |
| File | Upload/list/delete permission nếu triển khai |
| Activity | Mỗi action quan trọng có log |
| Idempotency | Retry create task/project với cùng Idempotency-Key |
| Data scope | Own/Team/Department/Project/Company/System |

### 18.2 Test API NOTI

| Nhóm | Test chính |
| --- | --- |
| List | User chỉ xem notification của mình |
| Unread | Count đúng, mark read giảm count |
| Dropdown | Latest đúng thứ tự, limit đúng |
| Detail | Detail của người khác trả 403/404 |
| Mark all read | Tất cả notification own chuyển Read |
| Event intake | Internal token bắt buộc, event disabled skipped |
| Template | Render biến, missing variable, fallback |
| Recipient | Resolve đúng assignee/mention/watcher |
| Dedupe | Không tạo notification trùng trong window |
| Delivery log | Ghi Sent/Skipped/Failed đúng |

### 18.3 Test API DASH

| Nhóm | Test chính |
| --- | --- |
| Dashboard me | Resolve đúng dashboard mặc định |
| Type | Chỉ trả dashboard type user có quyền |
| Widget catalog | Chỉ widget được phép hiển thị |
| Widget data | Own/Team/Company scope đúng |
| Widget source permission | Widget nhạy cảm check permission nguồn |
| Cache | Cache hit/miss, refresh, expired |
| Invalidation | Event TASK/NOTI làm widget liên quan refresh |
| Degraded state | Module nguồn lỗi không làm sập dashboard |
| Quick action | Chỉ trả metadata, action thật về module gốc |

### 18.4 E2E test P0

- [ ] Manager tạo project và thêm member.
- [ ] Manager tạo task và giao Employee.
- [ ] Employee nhận notification và mở task detail.
- [ ] Employee cập nhật status task.
- [ ] Dashboard Employee cập nhật MY_TASKS/TASK_ALERTS.
- [ ] Employee comment mention Manager.
- [ ] Manager nhận notification mention.
- [ ] Task due soon/overdue job tạo notification và dashboard alert.
- [ ] User thiếu quyền không vào được task/project/dashboard widget nhạy cảm.

### 18.5 Regression liên module

- [ ] AUTH permission thay đổi -> route/sidebar/widget thay đổi đúng sau reload/session refresh.
- [ ] HR employee inactive -> không giao task mới.
- [ ] LEAVE approved -> TASK cảnh báo khi giao deadline trong kỳ nghỉ.
- [ ] ATT/LEAVE widget hiện trên DASH không vỡ sau Sprint 4.
- [ ] Notification deep link không bỏ qua permission module gốc.

---

## 19. Security checklist Sprint 4

- [ ] Không tin `company_id`, `user_id`, `employee_id`, `role`, `permission`, `data_scope` từ frontend nếu backend tự resolve được.
- [ ] Internal NOTI/DASH endpoint không public cho frontend.
- [ ] Notification target URL chỉ cho route nội bộ allowlist.
- [ ] Notification payload không chứa dữ liệu nhạy cảm, private file URL hoặc comment dài.
- [ ] File task/project private mặc định và kiểm tra permission trước khi download.
- [ ] Dashboard cache không cross-user leak dữ liệu Own/Team.
- [ ] Comment cần sanitize để chống XSS nếu hỗ trợ rich text.
- [ ] Audit log cho thao tác nhạy cảm: delete task/project, remove member, update dashboard config, notification template config.
- [ ] Rate limit hoặc throttling cho comment/notification event nếu cần.
- [ ] Permission test có case direct URL/API call trái quyền.

---

## 20. DevOps, migration và release checklist

### 20.1 Migration/release

- [ ] Migration TASK chạy sau Foundation/AUTH/HR/ATT/LEAVE.
- [ ] Migration NOTI/DASH chạy sau TASK hoặc có FK nullable nếu tránh phụ thuộc vòng.
- [ ] Seed permission chạy trước role-permission.
- [ ] Seed notification events/templates trước khi TASK event producer bật.
- [ ] Seed dashboard widgets/configs trước khi frontend mở Dashboard.
- [ ] Seed idempotent, chạy lại không tạo trùng.
- [ ] Rollback plan cho migration bảng mới và seed Sprint 4.

### 20.2 Environment

- [ ] Dev/staging có biến cấu hình notification in-app enabled.
- [ ] Job due soon/overdue có thể bật/tắt qua env/company setting.
- [ ] Dashboard cache TTL cấu hình được.
- [ ] Log request id giữa TASK -> NOTI -> DASH đủ để trace.
- [ ] Slow query log bật ở staging cho query P0.

### 20.3 Observability

Metric/log cần theo dõi:

```text
task_created_count
task_status_changed_count
notification_created_count
notification_failed_count
notification_unread_count_query_latency
dashboard_widget_load_latency
dashboard_cache_hit_ratio
task_list_query_latency
kanban_query_latency
```

---

## 21. Backlog chi tiết Sprint 4

### 21.1 Epic S4-E01 - TASK backend core

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E01-001 | Tạo migration TASK core | BE | P0 | Bảng projects/tasks/member/assignee/comment/checklist/activity tạo thành công |
| S4-E01-002 | Implement Project API | BE | P0 | CRUD project theo permission + scope |
| S4-E01-003 | Implement Project Member API | BE | P0 | Add/update/remove member, chống trùng |
| S4-E01-004 | Implement Task API | BE | P0 | List/detail/create/update/delete soft |
| S4-E01-005 | Implement Assignment API | BE | P0 | Giao/đổi assignee, watcher, activity log |
| S4-E01-006 | Implement Status/Priority/Deadline API | BE | P0 | Transition hợp lệ, event phát đúng |
| S4-E01-007 | Implement Kanban API | BE | P1 | Load board + move card |
| S4-E01-008 | Implement Comment/Mention API | BE | P1 | Comment và mention phát event |
| S4-E01-009 | Implement Checklist API | BE | P1 | Create/tick item |
| S4-E01-010 | Implement Activity Log API | BE | P1 | Trả timeline đúng thứ tự |
| S4-E01-011 | Implement Task reminder jobs | BE | P1 | Due soon/overdue event có dedupe |

### 21.2 Epic S4-E02 - NOTI backend core

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E02-001 | Tạo migration NOTI | BE | P0 | Bảng event/template/notification/delivery log chạy được |
| S4-E02-002 | Seed notification event/template | BE | P0 | Event TASK P0 có template VI |
| S4-E02-003 | Implement event intake service/API | BE | P0 | Nhận event nội bộ và validate context |
| S4-E02-004 | Implement renderer + recipient resolver | BE | P0 | Resolve assignee/mention/watcher đúng |
| S4-E02-005 | Implement notification create + delivery log | BE | P0 | Notification IN_APP được tạo và log Sent |
| S4-E02-006 | Implement my notification API | BE | P0 | List/detail/dropdown/unread count |
| S4-E02-007 | Implement mark read/all read | BE | P0/P1 | Count cập nhật đúng |
| S4-E02-008 | Implement dedupe | BE | P1 | Comment/status spam không tạo trùng trong window |
| S4-E02-009 | Implement admin event/template view | BE | P2 | Admin xem config/log |

### 21.3 Epic S4-E03 - DASH backend core

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E03-001 | Tạo migration DASH | BE | P0 | Widget/config/cache tables sẵn sàng |
| S4-E03-002 | Seed dashboard widgets/configs | BE | P0 | Employee/Manager/HR/Admin có widget mặc định |
| S4-E03-003 | Implement dashboard resolver | BE | P0 | `/dashboard/me` resolve đúng type |
| S4-E03-004 | Implement widget catalog | BE | P1 | Trả widget theo permission |
| S4-E03-005 | Implement MY_TASKS widget | BE | P0 | Query TASK theo Own/Team scope |
| S4-E03-006 | Implement TASK_ALERTS widget | BE | P0 | Due soon/overdue đúng |
| S4-E03-007 | Implement NOTIFICATIONS widget | BE | P0 | Latest notification + unread count |
| S4-E03-008 | Implement PROJECT_PROGRESS widget | BE | P1 | Summary project progress |
| S4-E03-009 | Implement dashboard cache service | BE | P1 | Cache hit/miss/TTL đúng |
| S4-E03-010 | Implement cache invalidation | BE | P1 | Invalidate theo TASK/NOTI event |

### 21.4 Epic S4-E04 - Frontend TASK

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E04-001 | Thêm route/sidebar TASK | FE | P0 | TASK app/menu hiển thị theo permission |
| S4-E04-002 | Implement task/project API hooks | FE | P0 | Query/mutation hooks chuẩn |
| S4-E04-003 | Project list/detail/form | FE | P0 | CRUD project cơ bản |
| S4-E04-004 | Task list/my task/detail/form | FE | P0 | List/detail/create/update task |
| S4-E04-005 | Assignment/status/priority/deadline UI | FE | P0 | Mutation + invalidate đúng |
| S4-E04-006 | Kanban UI | FE | P1 | Drag/drop theo permission |
| S4-E04-007 | Comment/mention UI | FE | P1 | Comment, mention autocomplete |
| S4-E04-008 | Checklist UI | FE | P1 | Add/tick checklist |
| S4-E04-009 | Activity timeline UI | FE | P1 | Timeline hiển thị đúng |
| S4-E04-010 | File panel UI | FE | P2 | Upload/list/delete nếu backend sẵn |

### 21.5 Epic S4-E05 - Frontend NOTI

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E05-001 | Notification API hooks | FE | P0 | unread/dropdown/list/detail/mutation |
| S4-E05-002 | Notification badge topbar | FE | P0 | Count đúng, fallback khi lỗi |
| S4-E05-003 | Notification dropdown | FE | P0 | Latest + click target |
| S4-E05-004 | Notification list/detail | FE | P0 | List/detail/mark read |
| S4-E05-005 | Mark all read UI | FE | P1 | Count invalidate đúng |
| S4-E05-006 | Deep link handler | FE | P0 | Navigate module gốc an toàn |
| S4-E05-007 | Admin notification config UI | FE | P2 | View event/template/log nếu có quyền |

### 21.6 Epic S4-E06 - Frontend DASH

| ID | User story / Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E06-001 | Dashboard route/sidebar | FE | P0 | DASH app/menu theo permission |
| S4-E06-002 | Dashboard API hooks | FE | P0 | me/type/widget data hooks |
| S4-E06-003 | Dashboard shell/grid | FE | P0 | Responsive grid |
| S4-E06-004 | My Tasks widget | FE | P0 | Hiển thị task cá nhân |
| S4-E06-005 | Task Alerts widget | FE | P0 | Hiển thị overdue/due soon |
| S4-E06-006 | Notifications widget | FE | P0 | Latest notification |
| S4-E06-007 | Project Progress widget | FE | P1 | Summary project |
| S4-E06-008 | Pending Leave/Attendance widgets integration | FE | P1 | Tích hợp dữ liệu Sprint 3 |
| S4-E06-009 | Widget loading/empty/error/degraded | FE | P0 | State chuẩn Design System |

### 21.7 Epic S4-E07 - QA, integration và release

| ID | Task | Owner | Priority | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| S4-E07-001 | Viết API test TASK | QA/BE | P0 | Test CRUD/scope/event |
| S4-E07-002 | Viết API test NOTI | QA/BE | P0 | Test unread/dropdown/mark read/event |
| S4-E07-003 | Viết API test DASH | QA/BE | P0 | Test widget/scope/cache |
| S4-E07-004 | E2E task assigned -> notification -> dashboard | QA/FE/BE | P0 | Flow pass staging |
| S4-E07-005 | Permission/data scope regression | QA | P0 | Employee/Manager/HR/Admin đúng scope |
| S4-E07-006 | Performance smoke test | QA/BE | P1 | Query P0 không timeout |
| S4-E07-007 | OpenAPI update | BE | P1 | Swagger có endpoint Sprint 4 |
| S4-E07-008 | Release note Sprint 4 | PM/QA | P1 | Known issues rõ |

---

## 22. Definition of Done Sprint 4

Sprint 4 được xem là hoàn thành khi:

### 22.1 Product DoD

- [ ] Người dùng có thể quản lý project/task cơ bản end-to-end.
- [ ] Người dùng có thể nhận và xử lý notification task.
- [ ] Dashboard hiển thị được dữ liệu task/notification theo vai trò.
- [ ] Các luồng P0 không còn bug Critical/High mở.
- [ ] Các phần P2 chưa hoàn thiện có documented known issues hoặc backlog rõ.

### 22.2 Backend DoD

- [ ] Migration/seed TASK/NOTI/DASH chạy thành công từ database trống.
- [ ] API TASK/NOTI/DASH có authentication, permission, data scope.
- [ ] TASK phát event cho NOTI đúng các event P0.
- [ ] NOTI tạo notification, unread count, dropdown, mark read đúng.
- [ ] DASH resolve dashboard/widget theo permission và data scope.
- [ ] Dashboard cache/invalidation tối thiểu hoạt động.
- [ ] Activity log/audit log ghi đúng các thao tác quan trọng.
- [ ] OpenAPI/Swagger cập nhật.

### 22.3 Frontend DoD

- [ ] Route/sidebar/app registry có TASK, NOTI, DASH.
- [ ] Màn project/task/my task/detail/status/comment/checklist P0/P1 hoạt động.
- [ ] Notification badge/dropdown/list/detail/mark read hoạt động.
- [ ] Dashboard widget grid và widget P0 hoạt động.
- [ ] Loading/empty/error/forbidden/degraded state đầy đủ.
- [ ] Mutation invalidate query đúng, không hiển thị dữ liệu cũ nghiêm trọng.
- [ ] Responsive desktop/tablet/mobile web đạt mức MVP.

### 22.4 QA DoD

- [ ] API test P0 pass.
- [ ] E2E P0 pass trên staging.
- [ ] Permission/data scope test cho Employee/Manager/HR/Admin pass.
- [ ] Regression ATT/LEAVE/DASH/NOTI không vỡ luồng đã có.
- [ ] Bug Critical = 0, High = 0 hoặc có quyết định defer rõ.

### 22.5 DevOps DoD

- [ ] Staging deploy thành công.
- [ ] Migration/seed rollback/re-run plan rõ.
- [ ] Logs trace được flow TASK -> NOTI -> DASH.
- [ ] Job due soon/overdue có thể bật/tắt.
- [ ] Slow query/performance smoke được kiểm tra.

---

## 23. Rủi ro và phương án giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| TASK quá rộng, làm không kịp Sprint | Chậm release MVP | Chốt P0/P1/P2; file/export/config nâng cao đưa sang Sprint 5 nếu cần |
| Notification spam do comment/status update | UX kém, DB tăng nhanh | Dedupe window, exclude actor, event enabled config |
| Dashboard query chậm | Dashboard timeout | Lazy load widget, cache TTL, index query P0 |
| Scope TASK phức tạp | Lộ dữ liệu task | Viết test Own/Team/Department/Project; scope service riêng |
| Deep link notification bỏ qua quyền | User vào dữ liệu trái quyền | Route guard + API detail guard module gốc |
| Cache dashboard leak dữ liệu user khác | Rủi ro bảo mật cao | Cache key gồm user/scope context; không cache widget nhạy cảm nếu chưa chắc |
| Mention người không có quyền xem task | Notification lỗi hoặc lộ tên task | Validate mention recipient trước khi lưu/gửi |
| File task private bị lộ | Lộ dữ liệu | File service kiểm tra permission, signed URL ngắn hạn |
| Seed permission thiếu | Menu/widget không hiện | Seed checklist + QA permission matrix |
| Frontend/backend contract lệch | Lỗi tích hợp | MSW/mock theo OpenAPI, contract test trước E2E |

---

## 24. Câu hỏi cần chốt trước hoặc trong Sprint 4

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| S4-OQ-001 | MVP có cho phép task cá nhân không thuộc project không? | Product/BE | Cao |
| S4-OQ-002 | Khi deadline trùng ngày nghỉ phép đã duyệt, chỉ cảnh báo hay chặn giao task? | Product | Cao |
| S4-OQ-003 | Project role Owner/Manager có đủ quyền update task trong project hay vẫn cần permission hệ thống riêng? | Product/BE | Cao |
| S4-OQ-004 | Mention user không có quyền xem task xử lý thế nào? | Product/UX/BE | Cao |
| S4-OQ-005 | Notification click có tự mark read không? | Product/UX | Trung bình |
| S4-OQ-006 | Notification dropdown polling bao lâu, hay chỉ refresh khi mở dropdown? | FE/Product | Trung bình |
| S4-OQ-007 | Dashboard mặc định khi user có nhiều role ưu tiên Admin -> HR -> Manager -> Employee hay theo user preference? | Product | Trung bình |
| S4-OQ-008 | Dashboard cache theo user hay theo role cho widget Team/Company? | BE | Cao |
| S4-OQ-009 | File task/project có nằm trong Sprint 4 P1 hay chuyển sang Sprint 5? | Product/BE/FE | Trung bình |
| S4-OQ-010 | Có cần export task/project trong MVP release đầu không? | Product | Thấp |

---

## 25. Kế hoạch sau Sprint 4

Sau khi hoàn thành Sprint 4, bước tiếp theo đề xuất là:

```text
IMPLEMENTATION-08: Sprint 5 Integration, QA Hardening & UAT Execution Plan
```

Sprint 5 nên tập trung:

1. Integration & regression toàn bộ MVP từ AUTH -> HR -> ATT -> LEAVE -> TASK -> NOTI -> DASH.
2. UAT theo vai trò Employee, Manager, HR, Admin.
3. Security hardening: permission, data scope, field/file access.
4. Performance hardening: task list, notification unread count, dashboard widget.
5. Bug triage và QA hardening.
6. Tài liệu vận hành và known limitations.

Lưu ý chuỗi tài liệu: Release Candidate và Go-live thuộc Sprint 6 (IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan), không thuộc Sprint 5.

Vị trí trong chuỗi IMPLEMENTATION (chuẩn 7-sprint):

```text
IMPLEMENTATION-01: MVP Implementation Roadmap & Sprint Plan
IMPLEMENTATION-02: Detailed Product Backlog & Epic Breakdown
IMPLEMENTATION-03: Sprint 0 Execution Plan & Issue Board Setup
IMPLEMENTATION-04: Sprint 1 Foundation, Environment & Core Infrastructure Execution Plan
IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan
IMPLEMENTATION-07: Sprint 4 Task, Notification & Dashboard Execution Plan  <- tài liệu hiện tại
IMPLEMENTATION-08: Sprint 5 Integration, QA Hardening & UAT Execution Plan  <- tài liệu kế tiếp
IMPLEMENTATION-09: Sprint 6 Stabilization, Release Candidate & Go-live Execution Plan
IMPLEMENTATION-10: Post-MVP Backlog & Phase 2 Planning
```

---

## 26. Capacity & Estimation

### 26.1 Thang điểm story point

Story point trong tài liệu này theo thang chuẩn của **IMPLEMENTATION-02 §3.5** (Fibonacci-style: 1, 2, 3, 5, 8, 13, ...), dùng để ước lượng độ phức tạp tương đối, không phải giờ công tuyệt đối.

### 26.2 Giả định capacity

| Yếu tố | Giả định |
| --- | --- |
| Độ dài sprint | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 BE |
| Frontend | 2-4 FE |
| QA | 1-2 QA |
| DevOps | 1 DevOps |
| Velocity tham chiếu | ~40-80 point/sprint |

### 26.3 Story và point Sprint 4

Sprint 4 bao phủ các story của **IMPLEMENTATION-02**: EPIC-06 (TASK, story 065-076), EPIC-07 (NOTI, story 077-084), EPIC-08 (DASH, story 085-092) và phần integration EPIC-10 (story 101, 102, 103).

| Story | Module / Epic | Point |
| --- | --- | ---: |
| IMP02-STORY-065 | TASK (EPIC-06) | 8 |
| IMP02-STORY-066 | TASK (EPIC-06) | 8 |
| IMP02-STORY-067 | TASK (EPIC-06) | 5 |
| IMP02-STORY-068 | TASK (EPIC-06) | 8 |
| IMP02-STORY-069 | TASK (EPIC-06) | 8 |
| IMP02-STORY-070 | TASK (EPIC-06) | 8 |
| IMP02-STORY-071 | TASK (EPIC-06) | 8 |
| IMP02-STORY-072 | TASK (EPIC-06) | 8 |
| IMP02-STORY-073 | TASK (EPIC-06) | 8 |
| IMP02-STORY-074 | TASK (EPIC-06) | 5 |
| IMP02-STORY-075 | TASK (EPIC-06) | 5 |
| IMP02-STORY-076 | TASK (EPIC-06) | 8 |
| **Tổng TASK (EPIC-06)** | | **87** |
| IMP02-STORY-077 | NOTI (EPIC-07) | 8 |
| IMP02-STORY-078 | NOTI (EPIC-07) | 13 |
| IMP02-STORY-079 | NOTI (EPIC-07) | 8 |
| IMP02-STORY-080 | NOTI (EPIC-07) | 5 |
| IMP02-STORY-081 | NOTI (EPIC-07) | 5 |
| IMP02-STORY-082 | NOTI (EPIC-07) | 5 |
| IMP02-STORY-083 | NOTI (EPIC-07) | 8 |
| IMP02-STORY-084 | NOTI (EPIC-07) | 5 |
| **Tổng NOTI (EPIC-07)** | | **57** |
| IMP02-STORY-085 | DASH (EPIC-08) | 8 |
| IMP02-STORY-086 | DASH (EPIC-08) | 8 |
| IMP02-STORY-087 | DASH (EPIC-08) | 8 |
| IMP02-STORY-088 | DASH (EPIC-08) | 8 |
| IMP02-STORY-089 | DASH (EPIC-08) | 8 |
| IMP02-STORY-090 | DASH (EPIC-08) | 5 |
| IMP02-STORY-091 | DASH (EPIC-08) | 8 |
| IMP02-STORY-092 | DASH (EPIC-08) | 8 |
| **Tổng DASH (EPIC-08)** | | **61** |
| IMP02-STORY-101 | Integration TASK-LEAVE (EPIC-10) | 5 |
| IMP02-STORY-102 | Integration module-NOTI (EPIC-10) | 13 |
| IMP02-STORY-103 | Integration module-DASH (EPIC-10) | 8 |
| **Tổng Integration (101-103)** | | **26** |
| **TỔNG SPRINT 4** | | **231** |

### 26.4 CẢNH BÁO capacity

**231 point** vượt xa velocity tham chiếu của một sprint 2 tuần (~40-80 point/sprint). Khối lượng này gồm **3 module mới** (TASK 87 + NOTI 57 + DASH 61 = 205 point) cộng phần **integration 26 point**, tức gần như xây mới ba hệ thống nghiệp vụ trong một sprint duy nhất — không khả thi trong 10 ngày với team giả định.

BẮT BUỘC chọn ít nhất một trong các phương án sau và chốt với **PO + Tech Lead** trước khi vào sprint:

1. **(a) Tách thành 2-3 sprint theo module** — ví dụ Sprint 4a TASK, Sprint 4b NOTI, Sprint 4c DASH + integration. Đây là phương án được khuyến nghị để khớp với chuẩn 7-sprint nếu có thể giãn lịch.
2. **(b) Kéo dài thời lượng sprint** (ví dụ 4-6 tuần) hoặc tăng capacity team tương ứng.
3. **(c) Đẩy phần P1 ra sau** — Kanban (072), comment/mention (073), checklist (074), file (075), admin/config widget (083, 091), cache nâng cao (092), report (076) — chỉ giữ tập P0 để vừa velocity một sprint.

Quyết định cắt phạm vi/giãn lịch phải được PO và Tech Lead ký xác nhận; nếu không, rủi ro trượt release MVP là rất cao (xem thêm Rủi ro §23).

---

## 27. Tóm tắt điều hành

Sprint 4 là sprint kết nối trải nghiệm người dùng của MVP:

```text
TASK tạo dữ liệu công việc
-> NOTI đảm bảo người dùng nhận đúng sự kiện cần xử lý
-> DASH tổng hợp dữ liệu theo vai trò và điều hướng nhanh về module gốc
```

Trọng tâm triển khai không nên tách rời ba module, mà phải bám theo các flow tích hợp:

1. Manager giao task -> Employee nhận notification -> Dashboard cập nhật task widget.
2. Comment mention -> Người được mention nhận notification -> Deep link về task detail.
3. Task sắp/quá hạn -> Job phát event -> Notification + Dashboard alert.
4. Dashboard widget -> Quick action -> Module gốc kiểm tra permission/business rule lại.

Nếu cần cắt phạm vi để đảm bảo release, ưu tiên giữ P0:

```text
Project/task CRUD
Task assignment/status
My tasks
Notification unread/dropdown/mark read
Dashboard me + MY_TASKS + TASK_ALERTS + NOTIFICATIONS
TASK -> NOTI -> DASH integration
Permission/data scope test
```

Các phần có thể đưa sang Sprint 5 hoặc phase sau nếu thiếu thời gian:

```text
File task/project
Dashboard config UI nâng cao
Notification admin config UI
Export task/project
Realtime/WebSocket
Dashboard personalization
```
