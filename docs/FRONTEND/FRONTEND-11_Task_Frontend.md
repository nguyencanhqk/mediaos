# FRONTEND-11: TASK FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · **FRONTEND-11 Task** · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-06 TASK](<../SPEC/SPEC-06 TASK.md>) · [TASK API: API-06](<../API Design/API-06_TASK_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-11 |
| Tên tài liệu | Task Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | TASK - Công việc & Dự án |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Phiên bản | v1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-10 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-11 mô tả cách triển khai frontend cho module **TASK - Công việc & Dự án** trong hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình Task Frontend trong MVP.
2. Chốt route, sidebar, page structure và component structure cho module TASK.
3. Chuẩn hóa cách gọi API TASK theo API-06.
4. Chuẩn hóa query key, query hook, mutation hook và cache invalidation cho project/task.
5. Chuẩn hóa UI state cho My Tasks, Task List, Task Detail, Kanban Board, Project List và Project Detail.
6. Chuẩn hóa permission, data scope, project role và allowed actions ở frontend.
7. Chuẩn hóa interaction cho update status, assign task, comment, mention, checklist, upload file và drag/drop Kanban.
8. Tích hợp TASK với HR, LEAVE, NOTI, DASH và FOUNDATION/File Service.
9. Làm cơ sở để frontend team triển khai code thật, QA viết test case và backend đối chiếu API contract.

FRONTEND-11 không thay thế API-06 hoặc UI-09. Tài liệu này chuyển các quyết định nghiệp vụ, API và UI sang kế hoạch triển khai frontend cụ thể.

---

## 3. Vị trí FRONTEND-11 trong roadmap frontend

```text
FRONTEND-01: Frontend Architecture & Project Setup
FRONTEND-02: Design System Implementation
FRONTEND-03: Routing, Auth Guard & Permission Framework
FRONTEND-04: API Client, Query Layer & Error Handling
FRONTEND-05: Layout Implementation
FRONTEND-06: AUTH & Account Frontend
FRONTEND-07: Dashboard Frontend
FRONTEND-08: HR Frontend
FRONTEND-09: Attendance Frontend
FRONTEND-10: Leave Frontend
FRONTEND-11: Task Frontend
FRONTEND-12: Notification Frontend
FRONTEND-13: System/Foundation Frontend
FRONTEND-14: QA, Performance & Release Readiness
```

FRONTEND-11 phụ thuộc trực tiếp vào:

1. **FRONTEND-03**: route metadata, permission guard, action guard, data scope utility.
2. **FRONTEND-04**: API client, response/error contract, TanStack Query convention.
3. **FRONTEND-05**: ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher, dirty form guard.
4. **FRONTEND-08**: employee picker, department data, employee summary pattern từ HR.
5. **FRONTEND-10**: leave conflict/warning pattern khi task/deadline trùng lịch nghỉ.
6. **FRONTEND-12** sau này: notification deep link vào Task Detail.

---

## 4. Căn cứ triển khai

FRONTEND-11 bám theo các quyết định đã chốt:

1. Module TASK quản lý project, project member, task, assignee, watcher, status, priority, deadline, comment, mention, checklist, file và activity log.
2. TASK API dùng prefix chính `/api/v1/tasks`.
3. Project API vẫn nằm trong module TASK dưới `/api/v1/tasks/projects` để gom nhóm công việc và dự án.
4. Frontend không tự gửi `company_id`; backend resolve từ auth context.
5. Backend là nguồn kiểm tra permission, data scope và business rule cuối cùng.
6. Frontend chỉ dùng permission/action/scope để cải thiện UX: hide, disable, show reason, forbidden route.
7. Project role nội bộ như Owner, Manager, Member, Viewer không thay thế RBAC hệ thống.
8. Task có thể thuộc project hoặc là task cá nhân nếu company bật cấu hình.
9. Overdue là trạng thái dẫn xuất, không phải task status lưu cứng.
10. Comment, mention, file, checklist và activity log là một phần quan trọng của Task Detail.
11. Notification deep link từ task phải điều hướng về route detail của module TASK và kiểm tra quyền lại.
12. Dashboard chỉ hiển thị tóm tắt task/project; mọi thao tác nghiệp vụ phải điều hướng hoặc gọi API TASK.

---

## 5. Phạm vi FRONTEND-11

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung frontend |
| --- | --- |
| Task Workspace | Sidebar TASK, route group, page shell, breadcrumb |
| My Tasks | Việc của tôi, task được giao, task tôi tạo, task tôi theo dõi |
| Task List | Danh sách task theo filter/search/sort/scope |
| Task Detail | Header, metadata, assignee, watcher, status, priority, deadline, comment, checklist, file, activity |
| Task Create/Edit | Form tạo/sửa task, chọn project, assignee, deadline, priority, checklist ban đầu |
| Task Status | Update status, update priority, update deadline, allowed transition |
| Assignment | Giao task, đổi assignee, thêm/xóa watcher |
| Kanban | Board theo project/status, drag/drop đổi trạng thái, forbidden move |
| Comment | Tạo/sửa/xóa comment, mention người dùng |
| Checklist | Tạo checklist, thêm item, đánh dấu hoàn thành, reorder cơ bản nếu có |
| Task File | Upload, danh sách, tải, xóa file task |
| Project List | Danh sách project theo status/owner/department/search |
| Project Detail | Overview, task summary, member, file, activity, report cơ bản |
| Project Member | Danh sách thành viên, thêm/xóa/cập nhật role nếu có quyền |
| Project File | Upload, danh sách, tải, xóa file project |
| Task Report | Báo cáo cơ bản: task theo status, overdue, progress project |
| Integration | HR employee picker, LEAVE warning, NOTI event/deep link, DASH quick action |
| QA/Test | Unit test hook, component test, route guard test, E2E core flow |

### 5.2 Chưa bao gồm sâu trong MVP

| Nội dung | Giai đoạn đề xuất | Ghi chú |
| --- | --- | --- |
| Sprint/Scrum backlog | Phase sau | Có thể thêm `/tasks/sprints`, backlog board |
| Gantt chart | Phase sau | Cần dependency và timeline UI riêng |
| Time tracking | Phase sau | Có thể liên kết ATT hoặc timesheet |
| Task dependency | Phase sau | Cần graph/timeline và validation vòng lặp |
| Automation workflow | Phase sau | Rule builder riêng |
| Calendar integration | Phase sau | Đồng bộ Google/Microsoft calendar |
| AI summary/suggestion | Phase 5 | Tóm tắt project/task/comment có kiểm quyền |
| Realtime collaboration | Phase sau | WebSocket/SSE cho comment, board movement |
| Advanced mobile native | Phase mobile | FRONTEND-11 chỉ xử lý responsive web |

---

## 6. Mục tiêu UX của Task Frontend

### 6.1 Cho Employee

Employee cần thao tác nhanh:

1. Xem việc của tôi trong ngày/tuần.
2. Nhận biết task quá hạn, sắp đến hạn và task cần xử lý.
3. Mở chi tiết task từ list, dashboard hoặc notification.
4. Cập nhật trạng thái task được giao.
5. Comment, mention, cập nhật checklist và upload file nếu có quyền.
6. Theo dõi task quan trọng.

### 6.2 Cho Manager / Project Manager

Manager cần quản lý công việc theo team/project:

1. Xem task team hoặc project theo scope.
2. Tạo task và giao người phụ trách.
3. Kéo thả Kanban để điều phối trạng thái.
4. Theo dõi task quá hạn, task chưa có assignee, task chờ review.
5. Xem lịch sử hoạt động để biết ai đã thay đổi gì.
6. Nhận cảnh báo khi assignee đang nghỉ hoặc deadline rơi vào kỳ nghỉ.

### 6.3 Cho HR/Admin/Super Admin

Nhóm quản trị cần:

1. Xem task/project theo quyền được cấp.
2. Quản lý project liên quan đến nghiệp vụ HR hoặc nội bộ công ty.
3. Kiểm tra activity/audit khi cần truy vết.
4. Xuất dữ liệu task/project nếu có quyền.
5. Không vượt qua backend permission/data scope.

---

## 7. Route structure

### 7.1 Base route

```text
/tasks
```

Module TASK nằm trong `ModuleWorkspaceLayout`.

### 7.2 Route tree MVP

| Route key | Path | Screen | Priority | Permission chính | Scope gợi ý |
| --- | --- | --- | --- | --- | --- |
| `task.myTasks` | `/tasks/my` | Việc của tôi | P0 | `TASK.TASK.VIEW` | Own |
| `task.list` | `/tasks/list` | Danh sách task | P0 | `TASK.TASK.VIEW` | Own/Team/Department/Project/Company |
| `task.detail` | `/tasks/:taskId` | Chi tiết task | P0 | `TASK.TASK.VIEW` | Theo target |
| `task.create` | `/tasks/new` | Tạo task | P1 | `TASK.TASK.CREATE` | Own/Team/Project/Company |
| `task.edit` | `/tasks/:taskId/edit` | Sửa task | P1 | `TASK.TASK.UPDATE` | Theo target |
| `task.kanban` | `/tasks/kanban` | Kanban tổng | P0 | `TASK.TASK.VIEW_KANBAN` | Own/Team/Project/Company |
| `task.projectKanban` | `/tasks/projects/:projectId/kanban` | Kanban project | P0 | `TASK.TASK.VIEW_KANBAN` | Project |
| `task.projects` | `/tasks/projects` | Danh sách project | P1 | `TASK.PROJECT.VIEW` | Own/Team/Department/Company |
| `task.projectDetail` | `/tasks/projects/:projectId` | Chi tiết project | P1 | `TASK.PROJECT.VIEW` | Theo target |
| `task.projectCreate` | `/tasks/projects/new` | Tạo project | P2 | `TASK.PROJECT.CREATE` | Company/Department |
| `task.projectEdit` | `/tasks/projects/:projectId/edit` | Sửa project | P2 | `TASK.PROJECT.UPDATE` | Theo target |
| `task.projectMembers` | `/tasks/projects/:projectId/members` | Thành viên project | P1 | `TASK.PROJECT.VIEW` | Project |
| `task.projectFiles` | `/tasks/projects/:projectId/files` | File project | P2 | `TASK.PROJECT.VIEW` | Project |
| `task.reports` | `/tasks/reports` | Báo cáo task/project | P2 | `TASK.PROJECT.VIEW_REPORT` | Team/Department/Company |
| `task.activity` | `/tasks/activity` | Hoạt động gần đây | P2 | `TASK.AUDIT_LOG.VIEW` | Theo scope |

### 7.3 Route metadata mẫu

```ts
export const taskRoutes = [
  {
    routeKey: 'task.myTasks',
    path: '/tasks/my',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'FE-TASK-SCREEN-001',
    title: 'Việc của tôi',
    requiredPermissions: ['TASK.TASK.VIEW'],
    requiredScopes: ['Own'],
    showInSidebar: true,
    sidebarGroup: 'work',
    order: 10,
  },
  {
    routeKey: 'task.kanban',
    path: '/tasks/kanban',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'TASK',
    screenCode: 'FE-TASK-SCREEN-004',
    title: 'Kanban',
    requiredPermissions: ['TASK.TASK.VIEW_KANBAN'],
    requiredScopes: ['Own', 'Team', 'Project', 'Company'],
    showInSidebar: true,
    sidebarGroup: 'work',
    order: 30,
  },
];
```

---

## 8. Sidebar TASK

### 8.1 Sidebar groups

```text
TASK Workspace
  Tổng quan
    - Việc của tôi
    - Kanban
  Công việc
    - Danh sách task
    - Tạo task
  Dự án
    - Danh sách dự án
    - Báo cáo dự án
  Quản lý
    - Hoạt động gần đây
    - Cấu hình task nếu phase sau
```

### 8.2 Sidebar item visibility

| Sidebar item | Permission | Hiển thị khi |
| --- | --- | --- |
| Việc của tôi | `TASK.TASK.VIEW` | User có employee mapping hoặc có task relation |
| Danh sách task | `TASK.TASK.VIEW` | Có scope Own trở lên |
| Kanban | `TASK.TASK.VIEW_KANBAN` | Có quyền xem Kanban |
| Tạo task | `TASK.TASK.CREATE` | Có quyền tạo task |
| Dự án | `TASK.PROJECT.VIEW` | Có quyền xem project |
| Tạo dự án | `TASK.PROJECT.CREATE` | Có quyền tạo project |
| Báo cáo | `TASK.PROJECT.VIEW_REPORT` | Có quyền xem report |
| Hoạt động | `TASK.AUDIT_LOG.VIEW` | Có quyền xem activity/audit |

Frontend không hard-code theo role. Sidebar phải dùng permission/data scope từ auth context hoặc module registry.

---

## 9. Folder structure đề xuất

```text
src/
  modules/
    task/
      api/
        task.api.ts
        project.api.ts
        task-file.api.ts
        task-report.api.ts
      components/
        assignee-picker.tsx
        checklist-editor.tsx
        deadline-indicator.tsx
        kanban-board.tsx
        kanban-column.tsx
        kanban-task-card.tsx
        priority-badge.tsx
        project-card.tsx
        project-member-table.tsx
        project-status-badge.tsx
        task-activity-timeline.tsx
        task-card.tsx
        task-comment-thread.tsx
        task-detail-header.tsx
        task-file-list.tsx
        task-filter-bar.tsx
        task-status-badge.tsx
        task-status-action-bar.tsx
        watcher-picker.tsx
      constants/
        task.enums.ts
        task.permissions.ts
        task.routes.ts
      hooks/
        use-kanban-board.ts
        use-project-detail.ts
        use-project-members.ts
        use-projects.ts
        use-task-comments.ts
        use-task-detail.ts
        use-task-files.ts
        use-task-list.ts
        use-task-mutations.ts
        use-task-watchers.ts
      pages/
        kanban-page.tsx
        my-tasks-page.tsx
        project-detail-page.tsx
        project-files-page.tsx
        project-list-page.tsx
        project-members-page.tsx
        task-create-page.tsx
        task-detail-page.tsx
        task-edit-page.tsx
        task-list-page.tsx
        task-report-page.tsx
      schemas/
        project.schema.ts
        task.schema.ts
        task-comment.schema.ts
        task-checklist.schema.ts
      types/
        project.types.ts
        task.types.ts
        task-comment.types.ts
        task-file.types.ts
      utils/
        task-formatters.ts
        task-permission.ts
        task-query-params.ts
        task-status-transition.ts
      index.ts
```

---

## 10. TypeScript domain types

### 10.1 Enum

```ts
export type ProjectStatus =
  | 'Planning'
  | 'Active'
  | 'On Hold'
  | 'Completed'
  | 'Cancelled'
  | 'Archived';

export type ProjectVisibility = 'Private' | 'Internal' | 'Public';

export type ProjectMemberRole = 'Owner' | 'Manager' | 'Member' | 'Viewer';

export type TaskStatus =
  | 'Todo'
  | 'In Progress'
  | 'In Review'
  | 'Done'
  | 'Cancelled';

export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export type AssignmentRole = 'Main' | 'CoAssignee' | 'Reviewer';
```

### 10.2 Shared summary types

```ts
export interface EmployeeSummary {
  employee_id: string;
  employee_code: string;
  full_name: string;
  department?: { id: string; name: string } | null;
  position?: { id: string; name: string } | null;
  avatar_url?: string | null;
}

export interface ProjectSummary {
  project_id: string;
  project_code: string;
  name: string;
  status: ProjectStatus;
  priority: TaskPriority;
  visibility: ProjectVisibility;
  owner?: EmployeeSummary | null;
  start_date?: string | null;
  end_date?: string | null;
  progress_percent?: number;
  member_count?: number;
  task_count?: number;
  overdue_task_count?: number;
}

export interface TaskSummary {
  task_id: string;
  task_code: string;
  project?: ProjectSummary | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at?: string | null;
  is_overdue: boolean;
  is_due_soon?: boolean;
  main_assignee?: EmployeeSummary | null;
  created_by?: EmployeeSummary | null;
  updated_at: string;
  allowed_actions?: TaskAllowedActions;
}
```

### 10.3 Allowed actions

```ts
export interface TaskAllowedActions {
  can_view: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_assign: boolean;
  can_update_status: boolean;
  can_update_priority: boolean;
  can_update_deadline: boolean;
  can_comment: boolean;
  can_upload_file: boolean;
  can_delete_file: boolean;
  can_watch: boolean;
  can_export: boolean;
  disabled_reason?: string | null;
}

export interface ProjectAllowedActions {
  can_view: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_close: boolean;
  can_archive: boolean;
  can_manage_member: boolean;
  can_upload_file: boolean;
  can_delete_file: boolean;
  can_view_report: boolean;
  disabled_reason?: string | null;
}
```

---

## 11. API service mapping

### 11.1 Project service

```ts
export const projectApi = {
  list: (params: ProjectListParams) =>
    apiClient.get<PaginatedResponse<ProjectSummary>>('/api/v1/tasks/projects', { params }),

  detail: (projectId: string) =>
    apiClient.get<ApiResponse<ProjectDetail>>(`/api/v1/tasks/projects/${projectId}`),

  create: (payload: ProjectCreatePayload) =>
    apiClient.post<ApiResponse<ProjectDetail>>('/api/v1/tasks/projects', payload, {
      idempotencyKey: true,
    }),

  update: (projectId: string, payload: ProjectUpdatePayload) =>
    apiClient.patch<ApiResponse<ProjectDetail>>(`/api/v1/tasks/projects/${projectId}`, payload),

  close: (projectId: string) =>
    apiClient.post<ApiResponse<ProjectDetail>>(`/api/v1/tasks/projects/${projectId}/close`),

  cancel: (projectId: string, payload: { cancel_reason: string }) =>
    apiClient.post<ApiResponse<ProjectDetail>>(`/api/v1/tasks/projects/${projectId}/cancel`, payload),

  archive: (projectId: string) =>
    apiClient.post<ApiResponse<ProjectDetail>>(`/api/v1/tasks/projects/${projectId}/archive`),

  remove: (projectId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/projects/${projectId}`),
};
```

### 11.2 Project member service

```ts
export const projectMemberApi = {
  list: (projectId: string) =>
    apiClient.get<ApiResponse<ProjectMember[]>>(`/api/v1/tasks/projects/${projectId}/members`),

  add: (projectId: string, payload: ProjectMemberAddPayload) =>
    apiClient.post<ApiResponse<ProjectMember>>(`/api/v1/tasks/projects/${projectId}/members`, payload),

  update: (projectId: string, memberId: string, payload: ProjectMemberUpdatePayload) =>
    apiClient.patch<ApiResponse<ProjectMember>>(
      `/api/v1/tasks/projects/${projectId}/members/${memberId}`,
      payload,
    ),

  remove: (projectId: string, memberId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/projects/${projectId}/members/${memberId}`),
};
```

### 11.3 Task service

```ts
export const taskApi = {
  list: (params: TaskListParams) =>
    apiClient.get<PaginatedResponse<TaskSummary>>('/api/v1/tasks', { params }),

  myTasks: (params: MyTaskParams) =>
    apiClient.get<PaginatedResponse<TaskSummary>>('/api/v1/tasks/my-tasks', { params }),

  assignedToMe: (params: MyTaskParams) =>
    apiClient.get<PaginatedResponse<TaskSummary>>('/api/v1/tasks/assigned-to-me', { params }),

  createdByMe: (params: MyTaskParams) =>
    apiClient.get<PaginatedResponse<TaskSummary>>('/api/v1/tasks/created-by-me', { params }),

  watching: (params: MyTaskParams) =>
    apiClient.get<PaginatedResponse<TaskSummary>>('/api/v1/tasks/watching', { params }),

  detail: (taskId: string) =>
    apiClient.get<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}`),

  create: (payload: TaskCreatePayload) =>
    apiClient.post<ApiResponse<TaskDetail>>('/api/v1/tasks', payload, {
      idempotencyKey: true,
    }),

  update: (taskId: string, payload: TaskUpdatePayload) =>
    apiClient.patch<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}`, payload),

  remove: (taskId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/${taskId}`),

  updateStatus: (taskId: string, payload: TaskStatusUpdatePayload) =>
    apiClient.post<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}/change-status`, payload),

  updatePriority: (taskId: string, payload: { priority: TaskPriority }) =>
    apiClient.post<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}/change-priority`, payload),

  updateDeadline: (taskId: string, payload: { due_at: string | null }) =>
    apiClient.post<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}/change-deadline`, payload),
};
```

### 11.4 Assignment, watcher, comment, checklist, file

```ts
export const taskRelationApi = {
  assign: (taskId: string, payload: TaskAssignPayload) =>
    apiClient.post<ApiResponse<TaskDetail>>(`/api/v1/tasks/${taskId}/assign`, payload),

  addWatcher: (taskId: string, payload: { employee_id: string }) =>
    apiClient.post<ApiResponse<TaskWatcher>>(`/api/v1/tasks/${taskId}/watchers`, payload),

  removeWatcher: (taskId: string, watcherId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/${taskId}/watchers/${watcherId}`),

  comments: (taskId: string) =>
    apiClient.get<ApiResponse<TaskComment[]>>(`/api/v1/tasks/${taskId}/comments`),

  createComment: (taskId: string, payload: TaskCommentCreatePayload) =>
    apiClient.post<ApiResponse<TaskComment>>(`/api/v1/tasks/${taskId}/comments`, payload, {
      idempotencyKey: true,
    }),

  updateComment: (taskId: string, commentId: string, payload: TaskCommentUpdatePayload) =>
    apiClient.patch<ApiResponse<TaskComment>>(`/api/v1/tasks/${taskId}/comments/${commentId}`, payload),

  deleteComment: (taskId: string, commentId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/${taskId}/comments/${commentId}`),

  checklists: (taskId: string) =>
    apiClient.get<ApiResponse<TaskChecklist[]>>(`/api/v1/tasks/${taskId}/checklists`),

  createChecklist: (taskId: string, payload: ChecklistCreatePayload) =>
    apiClient.post<ApiResponse<TaskChecklist>>(`/api/v1/tasks/${taskId}/checklists`, payload),

  createChecklistItem: (taskId: string, checklistId: string, payload: ChecklistItemCreatePayload) =>
    apiClient.post<ApiResponse<TaskChecklistItem>>(
      `/api/v1/tasks/${taskId}/checklists/${checklistId}/items`,
      payload,
    ),

  updateChecklistItem: (
    taskId: string,
    checklistId: string,
    itemId: string,
    payload: ChecklistItemUpdatePayload,
  ) =>
    apiClient.patch<ApiResponse<TaskChecklistItem>>(
      `/api/v1/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`,
      payload,
    ),

  uploadFile: (taskId: string, formData: FormData) =>
    apiClient.upload<ApiResponse<TaskFile>>(`/api/v1/tasks/${taskId}/files`, formData),

  deleteFile: (taskId: string, fileId: string) =>
    apiClient.delete<ApiResponse<null>>(`/api/v1/tasks/${taskId}/files/${fileId}`),

  activity: (taskId: string) =>
    apiClient.get<ApiResponse<TaskActivityLog[]>>(`/api/v1/tasks/${taskId}/activity-logs`),
};
```

---

## 12. Query key factory

```ts
export const taskKeys = {
  all: ['task'] as const,

  projects: () => [...taskKeys.all, 'projects'] as const,
  projectList: (params: ProjectListParams) => [...taskKeys.projects(), 'list', params] as const,
  projectDetail: (projectId: string) => [...taskKeys.projects(), 'detail', projectId] as const,
  projectMembers: (projectId: string) => [...taskKeys.projects(), 'members', projectId] as const,
  projectFiles: (projectId: string) => [...taskKeys.projects(), 'files', projectId] as const,
  projectReport: (projectId: string) => [...taskKeys.projects(), 'report', projectId] as const,

  tasks: () => [...taskKeys.all, 'tasks'] as const,
  taskList: (params: TaskListParams) => [...taskKeys.tasks(), 'list', params] as const,
  myTasks: (params: MyTaskParams) => [...taskKeys.tasks(), 'my', params] as const,
  taskDetail: (taskId: string) => [...taskKeys.tasks(), 'detail', taskId] as const,
  taskComments: (taskId: string) => [...taskKeys.tasks(), 'comments', taskId] as const,
  taskChecklists: (taskId: string) => [...taskKeys.tasks(), 'checklists', taskId] as const,
  taskFiles: (taskId: string) => [...taskKeys.tasks(), 'files', taskId] as const,
  taskActivity: (taskId: string) => [...taskKeys.tasks(), 'activity', taskId] as const,

  kanban: (params: KanbanParams) => [...taskKeys.all, 'kanban', params] as const,
  reports: (params: TaskReportParams) => [...taskKeys.all, 'reports', params] as const,
};
```

---

## 13. Query hook convention

### 13.1 List hooks

```ts
export function useTaskList(params: TaskListParams) {
  return useQuery({
    queryKey: taskKeys.taskList(params),
    queryFn: () => taskApi.list(params),
    select: (res) => res,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useMyTasks(params: MyTaskParams) {
  return useQuery({
    queryKey: taskKeys.myTasks(params),
    queryFn: () => taskApi.myTasks(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
```

### 13.2 Detail hooks

```ts
export function useTaskDetail(taskId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.taskDetail(taskId ?? ''),
    queryFn: () => taskApi.detail(taskId!),
    enabled: Boolean(taskId),
    staleTime: 15_000,
  });
}

export function useProjectDetail(projectId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.projectDetail(projectId ?? ''),
    queryFn: () => projectApi.detail(projectId!),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}
```

### 13.3 Mutation hooks

```ts
export function useUpdateTaskStatus(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: TaskStatusUpdatePayload) => taskApi.updateStatus(taskId, payload),
    onSuccess: (res) => {
      queryClient.setQueryData(taskKeys.taskDetail(taskId), res);
      queryClient.invalidateQueries({ queryKey: taskKeys.tasks() });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
```

---

## 14. Cache và invalidation matrix

| Mutation | Invalidate / update |
| --- | --- |
| Create project | `projectList`, dashboard task/project widgets |
| Update project | `projectDetail`, `projectList`, `kanban`, report |
| Close/cancel/archive project | `projectDetail`, `projectList`, `taskList`, `kanban` |
| Add/update/remove member | `projectMembers`, `projectDetail`, permission/action state nếu cần |
| Create task | `taskList`, `myTasks`, `kanban`, `projectDetail`, `projectReport`, dashboard widgets |
| Update task | `taskDetail`, `taskList`, `myTasks`, `kanban` |
| Delete task | `taskList`, `myTasks`, `kanban`, `projectDetail` |
| Assign task | `taskDetail`, `taskList`, `myTasks`, `kanban`, notification badge có thể thay đổi |
| Update status | `taskDetail`, `taskList`, `myTasks`, `kanban`, `taskActivity`, dashboard widgets |
| Update priority/deadline | `taskDetail`, `taskList`, `myTasks`, `kanban`, dashboard widgets |
| Create/update/delete comment | `taskComments`, `taskActivity`, notification badge nếu mention |
| Create/update checklist item | `taskChecklists`, `taskDetail`, `taskActivity` |
| Upload/delete file | `taskFiles`, `taskActivity` |

Nguyên tắc:

1. List và board không nên refetch quá nhiều khi chỉ update detail nhỏ.
2. Status update trong Kanban có thể optimistic update nhưng phải rollback nếu API lỗi.
3. Comment và checklist có thể invalidate riêng để tránh refetch toàn bộ task detail.
4. Sau mutation có event notification, frontend không tự tạo notification; chỉ invalidate unread/dropdown nếu module NOTI đã có hook dùng chung.

---

## 15. Page implementation detail

## 15.1 FE-TASK-SCREEN-001: My Tasks

### Mục tiêu

Hiển thị các công việc liên quan trực tiếp đến user hiện tại.

### Route

```text
/tasks/my
```

### Layout

`ModuleWorkspaceLayout` + `PageHeader` + tabs + filter bar + task card/list.

### Tabs đề xuất

| Tab | Query/API | Ý nghĩa |
| --- | --- | --- |
| Tất cả | `GET /api/v1/tasks/my-tasks` | Task liên quan đến tôi |
| Được giao cho tôi | `GET /api/v1/tasks/assigned-to-me` | Tôi là assignee |
| Tôi tạo | `GET /api/v1/tasks/created-by-me` | Tôi tạo/reporter |
| Tôi theo dõi | `GET /api/v1/tasks/watching` | Tôi là watcher |
| Quá hạn | `GET /api/v1/tasks/my-tasks?is_overdue=true` | Task trễ hạn |
| Sắp đến hạn | `GET /api/v1/tasks/my-tasks?due_to=...` | Task cần chú ý |

### UI content

1. Summary cards: Tổng task, quá hạn, sắp đến hạn, chờ review.
2. Filter: search, status, priority, project, due range.
3. Sort: due date, priority, updated_at.
4. Task list: card compact hoặc table tùy breakpoint.
5. Quick action: tạo task nếu có quyền.

### State bắt buộc

| State | UI |
| --- | --- |
| Loading | Skeleton list + summary skeleton |
| Empty | EmptyState “Bạn chưa có công việc nào” + CTA tạo task nếu có quyền |
| Error | ErrorState + retry |
| Forbidden | ForbiddenPage nếu direct route thiếu quyền |
| Scope empty | EmptyState “Không có task trong phạm vi dữ liệu hiện tại” |
| Overdue | Badge danger + deadline rõ |
| Due soon | Badge warning + deadline rõ |

---

## 15.2 FE-TASK-SCREEN-002: Task List

### Route

```text
/tasks/list
```

### Mục tiêu

Dành cho Manager/Project Manager/HR/Admin xem danh sách task theo scope.

### Template

`ListPageTemplate` với DataTable desktop và CardList mobile.

### Columns desktop

| Column | Nội dung |
| --- | --- |
| Task | Code, title, project |
| Status | TaskStatusBadge |
| Priority | PriorityBadge |
| Assignee | Avatar + name |
| Deadline | DeadlineIndicator |
| Updated | Relative time |
| Actions | View, edit, assign, delete theo allowed actions |

### Filter

1. Search theo code/title/description.
2. Project.
3. Status.
4. Priority.
5. Assignee.
6. Department.
7. Due range.
8. Overdue.
9. Has assignee.

### API

```http
GET /api/v1/tasks?page=1&per_page=20&search=&project_id=&status=&priority=&assignee_employee_id=&due_from=&due_to=&is_overdue=
```

### Permission behavior

1. Không có `TASK.TASK.VIEW`: forbidden.
2. Có scope Own: chỉ hiển thị task liên quan.
3. Có scope Team: hiển thị task nhân viên thuộc team.
4. Có scope Company: có thêm filter rộng hơn.
5. Action edit/delete/assign phải dựa vào `allowed_actions` từng row.

---

## 15.3 FE-TASK-SCREEN-003: Task Detail

### Route

```text
/tasks/:taskId
```

### Mục tiêu

Là màn hình trung tâm của module TASK.

### Layout desktop

```text
PageHeader: Task code + title + status + action group

Main content 2 columns:
  Left 70%
    - Description
    - Checklist
    - File attachments
    - Comment thread
    - Activity timeline
  Right 30%
    - Metadata panel
    - Assignee/watcher
    - Project info
    - Deadline/priority
    - Allowed actions
    - Leave/deadline warning
```

### Layout mobile

1. Header compact.
2. Metadata accordion.
3. Description.
4. Checklist.
5. Comments.
6. Files.
7. Activity.
8. Bottom sticky action bar nếu có action status chính.

### Sections

| Section | Component | Ghi chú |
| --- | --- | --- |
| Header | `TaskDetailHeader` | Title, code, status, priority, project |
| Status action | `TaskStatusActionBar` | Start, submit review, complete, cancel theo allowed transition |
| Metadata | `TaskMetadataPanel` | Assignee, watcher, deadline, reporter, created/updated |
| Description | `TaskDescription` | Markdown/plain text tùy MVP |
| Checklist | `ChecklistEditor` | Progress, item done/undone |
| Files | `TaskFileList` | Upload/delete/download theo quyền |
| Comments | `TaskCommentThread` | Create/update/delete, mention picker |
| Activity | `TaskActivityTimeline` | Lịch sử thay đổi |

### API

```http
GET /api/v1/tasks/{task_id}
GET /api/v1/tasks/{task_id}/comments
GET /api/v1/tasks/{task_id}/checklists
GET /api/v1/tasks/{task_id}/files
GET /api/v1/tasks/{task_id}/activity-logs
```

### Action API

```http
POST  /api/v1/tasks/{task_id}/change-status
POST  /api/v1/tasks/{task_id}/change-priority
POST  /api/v1/tasks/{task_id}/change-deadline
POST  /api/v1/tasks/{task_id}/assign
POST  /api/v1/tasks/{task_id}/comments
POST  /api/v1/tasks/{task_id}/checklists
POST  /api/v1/tasks/{task_id}/files
```

### Business UI rule

| Rule | UI behavior |
| --- | --- |
| Task Done | Disable update status nếu thiếu quyền reopen |
| Task Cancelled | Disable hầu hết action, cho phép view/comment nếu policy cho phép |
| Project Archived | Banner “Dự án đã lưu trữ”, disable edit/status/comment nếu backend trả disabled |
| Deadline trùng kỳ nghỉ assignee | Hiển thị warning khi tạo/giao/đổi deadline |
| Checklist chưa xong nhưng bấm Done | Nếu backend trả validation, hiển thị Alert và scroll đến checklist |
| User thiếu quyền comment | Ẩn composer, vẫn hiển thị comment nếu có quyền view |

---

## 15.4 FE-TASK-SCREEN-004: Kanban Board

### Route

```text
/tasks/kanban
/tasks/projects/:projectId/kanban
```

### Mục tiêu

Giúp quản lý trạng thái task theo cột Todo, In Progress, In Review, Done, Cancelled.

### Columns

```text
Todo
In Progress
In Review
Done
Cancelled
```

### Card content

1. Task title + task code.
2. Priority badge.
3. Due date + overdue/due soon.
4. Main assignee avatar.
5. Checklist progress.
6. Comment/file count.
7. Project name nếu board tổng.

### Drag/drop rule

| Tình huống | UI behavior |
| --- | --- |
| User có quyền transition | Cho kéo thả, optimistic update |
| User thiếu quyền | Không cho drag hoặc revert + toast forbidden |
| Transition không hợp lệ | Revert, hiển thị error từ API |
| Network/API lỗi | Rollback card về cột cũ, toast + retry |
| Board quá nhiều card | Lazy load/card virtualize hoặc pagination từng cột |

### API gợi ý

```http
GET /api/v1/tasks/kanban?project_id=&assignee_employee_id=&priority=&due_from=&due_to=
POST /api/v1/tasks/{task_id}/change-status
```

Nếu backend chưa có endpoint Kanban riêng, frontend có thể dùng `GET /api/v1/tasks` rồi group theo status cho MVP nhỏ. Tuy nhiên giải pháp chính thức nên có endpoint trả board theo cột để tối ưu.

---

## 15.5 FE-TASK-SCREEN-005: Task Create/Edit

### Route

```text
/tasks/new
/tasks/:taskId/edit
```

### Form fields

| Field | Bắt buộc | Component | Ghi chú |
| --- | --- | --- | --- |
| Title | Có | Input | 3-255 ký tự |
| Description | Không | Textarea/RichText | Có thể plain text MVP |
| Project | Không/tùy config | ProjectPicker | Null nếu task cá nhân được bật |
| Assignee | Có nếu giao ngay | AssigneePicker | Employee active từ HR |
| Watchers | Không | WatcherPicker | Multi select |
| Priority | Có | Select | Low/Medium/High/Urgent |
| Status | Có | Select | Mặc định Todo |
| Due date | Không | DateTimePicker | Validate không nằm trước ngày hiện tại nếu policy yêu cầu |
| Checklist initial | Không | ChecklistEditor mini | Có thể thêm sau tạo |
| Files | Không | Upload | Có thể upload sau tạo nếu API đơn giản hơn |

### Zod schema mẫu

```ts
export const taskCreateSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().max(5000).optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  main_assignee_employee_id: z.string().uuid().optional().nullable(),
  watcher_employee_ids: z.array(z.string().uuid()).default([]),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']),
  status: z.enum(['Todo', 'In Progress', 'In Review', 'Done', 'Cancelled']).default('Todo'),
  due_at: z.string().datetime().optional().nullable(),
});
```

### Leave conflict warning

Khi chọn assignee hoặc deadline, frontend có thể gọi API preview nếu backend hỗ trợ:

```http
POST /api/v1/tasks/validate-assignment
```

Nếu chưa có API preview, backend validate khi submit. Frontend hiển thị warning dựa trên response lỗi hoặc response `warnings`.

### Dirty form guard

Tạo/sửa task phải bật dirty form guard khi:

1. Người dùng đổi route.
2. Người dùng mở App Switcher đổi app.
3. Người dùng đóng tab nếu có thể hỗ trợ browser beforeunload.

---

## 15.6 FE-TASK-SCREEN-006: Project List

### Route

```text
/tasks/projects
```

### UI

1. Page header + CTA tạo project.
2. Filter: status, priority, owner, department, visibility, date range.
3. View mode: table / card grid.
4. Project card: status, owner, progress, task count, overdue count.
5. Empty state nếu chưa có project.

### API

```http
GET /api/v1/tasks/projects?status=&priority=&owner_employee_id=&department_id=&visibility=&start_date_from=&start_date_to=
```

---

## 15.7 FE-TASK-SCREEN-007: Project Detail

### Route

```text
/tasks/projects/:projectId
```

### Tabs

| Tab | Nội dung | API |
| --- | --- | --- |
| Overview | Mô tả, progress, status, owner, deadline | `GET /projects/{id}` |
| Tasks | Task thuộc project | `GET /api/v1/tasks?project_id=` |
| Kanban | Board project | `GET /kanban?project_id=` |
| Members | Thành viên project | `GET /projects/{id}/members` |
| Files | File project | `GET /projects/{id}/files` |
| Activity | Hoạt động project/task | `GET /projects/{id}/activity-logs` nếu có |
| Report | Tiến độ cơ bản | `GET /projects/{id}/report` |

### Banner state

| Project status | UI |
| --- | --- |
| Planning | Badge info |
| Active | Badge success/info |
| On Hold | Warning banner |
| Completed | Success banner, disable update nếu policy |
| Cancelled | Danger/neutral banner, read-only |
| Archived | Neutral banner, read-only |

---

## 15.8 FE-TASK-SCREEN-008: Project Members

### Route

```text
/tasks/projects/:projectId/members
```

### UI

1. Member table: employee, department, role, joined_at, actions.
2. Add member drawer.
3. Update role dropdown.
4. Remove confirm dialog.

### Permission

1. View member: `TASK.PROJECT.VIEW`.
2. Add/update/remove member: `TASK.PROJECT.MANAGE_MEMBER` + project role phù hợp.
3. Nếu project archived/cancelled: disable action.

---

## 15.9 FE-TASK-SCREEN-009: Task Report

### Route

```text
/tasks/reports
```

### MVP report widgets

1. Tổng số task theo status.
2. Task quá hạn.
3. Task theo priority.
4. Project active/completed/cancelled.
5. Top project có nhiều task quá hạn.
6. Task chưa có assignee.

### UI

1. Filter by project/department/date range.
2. MetricCard + chart placeholder.
3. Link sang task list đã apply filter.
4. Export nếu có `TASK.TASK.EXPORT` hoặc `TASK.PROJECT.VIEW_REPORT`.

---

## 16. Component design

### 16.1 TaskCard

Props:

```ts
interface TaskCardProps {
  task: TaskSummary;
  variant?: 'compact' | 'kanban' | 'list';
  onClick?: () => void;
  actions?: React.ReactNode;
}
```

Hiển thị:

1. Task code.
2. Title.
3. Status badge.
4. Priority badge.
5. Deadline indicator.
6. Assignee avatar.
7. Project name.
8. Overdue/due soon state.

### 16.2 TaskStatusBadge

| Status | Tone |
| --- | --- |
| Todo | Neutral |
| In Progress | Info |
| In Review | Warning |
| Done | Success |
| Cancelled | Danger/Neutral |

### 16.3 PriorityBadge

| Priority | Tone |
| --- | --- |
| Low | Neutral |
| Medium | Info |
| High | Warning |
| Urgent | Danger |

### 16.4 DeadlineIndicator

Cases:

1. No deadline: muted text.
2. Due soon: warning icon + text.
3. Overdue: danger icon + text.
4. Done: muted or success if completed before deadline.

### 16.5 AssigneePicker

Yêu cầu:

1. Search employee theo HR API.
2. Chỉ hiển thị employee active/probation/official nếu backend trả.
3. Hỗ trợ avatar, code, department, position.
4. Hỗ trợ warning nếu employee đang nghỉ hoặc deadline trùng nghỉ.
5. Không tự filter quyền thay backend; chỉ truyền search/filter hợp lệ.

### 16.6 TaskCommentThread

Yêu cầu:

1. Composer có mention support.
2. Comment item hiển thị author, time, content, edited state.
3. Action edit/delete theo allowed action từng comment nếu backend trả.
4. Mention chips dùng employee/user summary.
5. Submit loading, retry khi lỗi.
6. Không hiển thị nội dung bị mask nếu backend đã ẩn.

### 16.7 ChecklistEditor

Yêu cầu:

1. Hiển thị progress percent.
2. Tạo checklist group.
3. Tạo item.
4. Toggle done/undone.
5. Inline edit title nếu có quyền.
6. Disabled state nếu task/project readonly.

### 16.8 TaskActivityTimeline

Hiển thị activity log theo thời gian:

1. Actor.
2. Action label.
3. Before/after summary nếu có.
4. Timestamp.
5. Link đến comment/file nếu phù hợp.

Không dùng activity timeline thay audit log hệ thống.

---

## 17. Permission và action guard

### 17.1 Permission constants

```ts
export const TASK_PERMISSIONS = {
  PROJECT_VIEW: 'TASK.PROJECT.VIEW',
  PROJECT_CREATE: 'TASK.PROJECT.CREATE',
  PROJECT_UPDATE: 'TASK.PROJECT.UPDATE',
  PROJECT_DELETE: 'TASK.PROJECT.DELETE',
  PROJECT_CLOSE: 'TASK.PROJECT.CLOSE',
  PROJECT_ARCHIVE: 'TASK.PROJECT.ARCHIVE',
  PROJECT_MANAGE_MEMBER: 'TASK.PROJECT.MANAGE_MEMBER',
  PROJECT_FILE_UPLOAD: 'TASK.PROJECT.FILE_UPLOAD',
  PROJECT_FILE_DELETE: 'TASK.PROJECT.FILE_DELETE',
  PROJECT_VIEW_REPORT: 'TASK.PROJECT.VIEW_REPORT',
  TASK_VIEW: 'TASK.TASK.VIEW',
  TASK_CREATE: 'TASK.TASK.CREATE',
  TASK_UPDATE: 'TASK.TASK.UPDATE',
  TASK_DELETE: 'TASK.TASK.DELETE',
  TASK_ASSIGN: 'TASK.TASK.ASSIGN',
  TASK_UPDATE_STATUS: 'TASK.TASK.UPDATE_STATUS',
  TASK_UPDATE_PRIORITY: 'TASK.TASK.UPDATE_PRIORITY',
  TASK_UPDATE_DEADLINE: 'TASK.TASK.UPDATE_DEADLINE',
  TASK_COMMENT: 'TASK.TASK.COMMENT',
  TASK_FILE_UPLOAD: 'TASK.TASK.FILE_UPLOAD',
  TASK_FILE_DELETE: 'TASK.TASK.FILE_DELETE',
  TASK_WATCH: 'TASK.TASK.WATCH',
  TASK_VIEW_KANBAN: 'TASK.TASK.VIEW_KANBAN',
  TASK_EXPORT: 'TASK.TASK.EXPORT',
  AUDIT_LOG_VIEW: 'TASK.AUDIT_LOG.VIEW',
} as const;
```

### 17.2 Guard layers

| Layer | Mục đích | Nguồn dữ liệu |
| --- | --- | --- |
| Route guard | Chặn direct URL trái quyền | Auth permissions/scopes |
| Sidebar guard | Ẩn menu không có quyền | App/sidebar registry |
| Page guard | Hiển thị forbidden/disabled/scope empty | API error + permissions |
| Action guard | Ẩn/disable button | `allowed_actions` từ API + permission local |
| Field guard | Mask/ẩn field nhạy cảm nếu có | API response đã filter + UI config |

### 17.3 Nguyên tắc action guard

1. Ưu tiên dùng `allowed_actions` từ API detail/row.
2. Nếu API chưa trả `allowed_actions`, frontend chỉ được dùng permission local để ẩn/disable sơ bộ.
3. Khi click action, vẫn gọi API và xử lý 403/409 từ backend.
4. Disabled action nên có tooltip lý do nếu có `disabled_reason`.
5. Action nguy hiểm như delete/cancel/archive phải có ConfirmDialog.

---

## 18. Data scope handling

### 18.1 Scope trong UI

| Scope | UI impact |
| --- | --- |
| Own | Default My Tasks, filter hạn chế, không hiển thị team/company filter |
| Team | Có filter team/assignee thuộc team nếu backend hỗ trợ |
| Department | Có department filter theo scope |
| Project | Có project-specific view nếu là member |
| Company | Có filter rộng trong công ty |
| System | Chỉ Super Admin, hạn chế sử dụng trong UI MVP |

### 18.2 Scope empty

Nếu user có quyền màn hình nhưng không có dữ liệu trong scope:

```text
Không có công việc nào trong phạm vi dữ liệu hiện tại.
```

Không hiển thị như lỗi.

---

## 19. Cross-module integration

### 19.1 HR integration

TASK cần HR để:

1. Employee picker.
2. Assignee summary.
3. Project member summary.
4. Department filter.
5. Direct manager/team scope.
6. Chặn hoặc cảnh báo employee không active nếu backend trả.

Frontend dùng HR query hooks hoặc shared employee search component đã triển khai từ FRONTEND-08.

### 19.2 LEAVE integration

TASK cần LEAVE để:

1. Cảnh báo khi assignee đang nghỉ trong khoảng deadline.
2. Cảnh báo khi giao task có deadline nằm trong kỳ nghỉ đã duyệt.
3. Hiển thị warning trong Task Create/Edit hoặc Assign Drawer.

Trong MVP, frontend không tự quyết định chặn. Backend trả warning/error, frontend hiển thị rõ.

### 19.3 NOTI integration

TASK phát event qua backend. Frontend cần:

1. Deep link notification vào `/tasks/:taskId` hoặc `/tasks/projects/:projectId`.
2. Nếu user không còn quyền xem task, hiển thị Forbidden/Target unavailable.
3. Sau comment mention hoặc assign, không tự tạo notification giả.
4. Có thể invalidate notification unread count nếu hook dùng chung hỗ trợ.

### 19.4 DASH integration

Dashboard quick action và widget task phải điều hướng sang TASK:

| Dashboard item | Target |
| --- | --- |
| Task của tôi | `/tasks/my` |
| Task quá hạn | `/tasks/my?is_overdue=true` |
| Task team quá hạn | `/tasks/list?is_overdue=true&scope=team` |
| Project progress | `/tasks/projects/:projectId` |
| Kanban project | `/tasks/projects/:projectId/kanban` |

### 19.5 FOUNDATION/File integration

File upload/download phải dùng service chung:

1. File private mặc định.
2. Tải/xóa file cần permission.
3. UI không hiển thị raw private URL nếu backend không cấp.
4. Upload progress cần rõ.
5. Lỗi file quá lớn/sai định dạng hiển thị inline hoặc toast.

---

## 20. Error handling

| Error | UI behavior |
| --- | --- |
| 400 validation | Map vào field nếu là form; nếu list/filter thì alert |
| 401 expired | API client xử lý refresh/logout theo FRONTEND-04 |
| 403 forbidden | Forbidden state hoặc disable action |
| 404 not found | NotFoundState “Task không tồn tại hoặc đã bị xóa” |
| 409 business conflict | Alert trong page/drawer, ví dụ status transition không hợp lệ |
| 422 validation business | Hiển thị field/form error từ API |
| 500 server | ErrorState + retry + request_id |
| Network | Toast + retry action |

Các lỗi quan trọng cần hiển thị `request_id` nếu API trả để hỗ trợ debug.

---

## 21. Optimistic update strategy

### 21.1 Được phép optimistic

| Action | Ghi chú |
| --- | --- |
| Toggle checklist item | Rollback nếu lỗi |
| Mark watch/unwatch | Rollback nếu lỗi |
| Kanban drag status | Rollback nếu API lỗi/forbidden |
| Update status button | Có thể optimistic nhẹ hoặc đợi API |

### 21.2 Không nên optimistic trong MVP

| Action | Lý do |
| --- | --- |
| Create task | Cần backend sinh code/id và validate rule |
| Assign task | Có thể phát notification và validate nghỉ phép/scope |
| Delete task | Cần confirm và xử lý quyền |
| Upload file | Cần file service trả metadata |
| Close/cancel/archive project | Nghiệp vụ quan trọng, cần API success trước |

---

## 22. Responsive behavior

| Screen | Desktop | Tablet | Mobile |
| --- | --- | --- | --- |
| My Tasks | Table/card hybrid | Card list + filter drawer | Card list, sticky filter button |
| Task List | DataTable full | Table scroll + filter drawer | Card list |
| Task Detail | 2 columns | Metadata collapsible | Single column + bottom action bar |
| Kanban | Horizontal columns | Horizontal scroll | Column switcher/list-by-status |
| Task Create/Edit | Form 2 columns nếu rộng | Single column | Fullscreen form |
| Project List | Table/card grid | Card grid | Card list |
| Project Detail | Tabs + 2 columns | Tabs scroll | Accordion/stacked tabs |

Mobile web không bắt buộc drag/drop Kanban đầy đủ trong MVP. Có thể dùng status dropdown hoặc “Move to” action thay thế.

---

## 23. Accessibility

Checklist:

1. Kanban card phải keyboard accessible hoặc có action menu thay thế drag/drop.
2. Icon-only button phải có `aria-label`.
3. Status/priority không chỉ dựa vào màu, phải có text.
4. Comment composer focus rõ.
5. Modal/drawer trap focus.
6. Confirm delete/cancel/archive có title, description rõ.
7. Form error liên kết với input bằng `aria-describedby`.
8. Timeline/activity đọc được bằng screen reader.
9. Drag/drop thông báo trạng thái bằng live region nếu dùng thư viện hỗ trợ.
10. Deadline overdue/due soon có label text rõ.

---

## 24. Test plan

### 24.1 Unit test

| Nhóm | Test |
| --- | --- |
| Formatter | Format deadline, overdue, priority label, status label |
| Permission util | `canShowAction`, `canDragTask`, `canEditTask` |
| Query params | Parse/stringify filter, sort, pagination |
| Status transition | Allowed transition theo status hiện tại |
| Validation schema | Task create/edit, project create/edit, comment |

### 24.2 Component test

| Component | Test |
| --- | --- |
| TaskCard | Render title, status, overdue, click |
| TaskStatusBadge | Render đúng label/tone |
| DeadlineIndicator | Overdue/due soon/no due date |
| TaskDetailHeader | Action hiển thị theo allowed_actions |
| ChecklistEditor | Toggle item, disabled state |
| CommentThread | Submit comment, mention render, empty state |
| KanbanColumn | Card render, empty column, disabled drag |
| ProjectMemberTable | Role change, remove confirm |

### 24.3 Hook/API test

1. `useTaskList` gọi đúng query key và params.
2. `useTaskDetail` không chạy khi thiếu taskId.
3. `useUpdateTaskStatus` invalidate đúng query.
4. Mutation map validation error đúng.
5. 403 từ API chuyển thành forbidden/disabled state.

### 24.4 E2E core flow

| Flow | Kỳ vọng |
| --- | --- |
| Mở My Tasks | Hiển thị task thuộc scope của user |
| Mở Task Detail | Hiển thị metadata, comment, checklist, activity |
| Update status | Status đổi, activity cập nhật, toast success |
| Kanban drag | Card chuyển cột nếu có quyền, rollback nếu API lỗi |
| Create task | Tạo thành công, redirect detail/list, form validation rõ |
| Assign task | Assignee đổi, warning nghỉ phép nếu có |
| Comment mention | Comment tạo, mention hiển thị, notification event backend xử lý |
| Checklist | Toggle done cập nhật progress |
| Upload file | File xuất hiện trong danh sách, xóa cần confirm |
| Direct route trái quyền | Forbidden state |
| Notification deep link | Vào đúng Task Detail hoặc target unavailable |

---

## 25. Mock data strategy

Khi backend chưa sẵn API:

1. Dùng MSW/mock handler theo contract API-06.
2. Mock response có `allowed_actions` để test permission UI.
3. Mock các trạng thái task: Todo, In Progress, In Review, Done, Cancelled.
4. Mock overdue/due soon.
5. Mock project archived để test readonly state.
6. Mock 403/404/409/422 để test error behavior.
7. Mock comment mention và file upload metadata.

Mock chỉ phục vụ phát triển UI, không thay đổi contract API thật.

---

## 26. Thứ tự triển khai đề xuất

### Sprint FE-11.1 - Nền TASK module

1. Tạo folder `modules/task`.
2. Tạo route registry và sidebar TASK.
3. Tạo enum/permission/type cơ bản.
4. Tạo API service project/task.
5. Tạo query key factory và hook list/detail.
6. Tạo status/priority/deadline components.

### Sprint FE-11.2 - Employee daily task flow

1. My Tasks page.
2. Task Detail page read-only.
3. Update status action.
4. Comment thread cơ bản.
5. Checklist cơ bản.
6. Empty/loading/error/forbidden state.

### Sprint FE-11.3 - Task management

1. Task List page.
2. Task Create/Edit form.
3. Assign drawer.
4. Watcher picker.
5. File upload/list/delete.
6. Validation/error mapping.

### Sprint FE-11.4 - Kanban

1. Kanban board tổng.
2. Project Kanban.
3. Drag/drop với permission guard.
4. Optimistic update + rollback.
5. Mobile alternative interaction.

### Sprint FE-11.5 - Project workspace

1. Project List.
2. Project Detail overview.
3. Project members.
4. Project files.
5. Project task tab.
6. Project report cơ bản.

### Sprint FE-11.6 - Integration, QA, polish

1. HR employee picker integration.
2. LEAVE warning handling.
3. NOTI deep link readiness.
4. DASH quick action route params.
5. Responsive pass.
6. Accessibility pass.
7. Unit/component/E2E tests.
8. Storybook/component preview nếu dùng.

---

## 27. File checklist cần tạo

```text
src/modules/task/index.ts
src/modules/task/constants/task.enums.ts
src/modules/task/constants/task.permissions.ts
src/modules/task/constants/task.routes.ts
src/modules/task/types/task.types.ts
src/modules/task/types/project.types.ts
src/modules/task/api/task.api.ts
src/modules/task/api/project.api.ts
src/modules/task/hooks/use-task-list.ts
src/modules/task/hooks/use-task-detail.ts
src/modules/task/hooks/use-task-mutations.ts
src/modules/task/hooks/use-projects.ts
src/modules/task/hooks/use-project-detail.ts
src/modules/task/pages/my-tasks-page.tsx
src/modules/task/pages/task-list-page.tsx
src/modules/task/pages/task-detail-page.tsx
src/modules/task/pages/task-create-page.tsx
src/modules/task/pages/task-edit-page.tsx
src/modules/task/pages/kanban-page.tsx
src/modules/task/pages/project-list-page.tsx
src/modules/task/pages/project-detail-page.tsx
src/modules/task/components/task-card.tsx
src/modules/task/components/task-status-badge.tsx
src/modules/task/components/priority-badge.tsx
src/modules/task/components/deadline-indicator.tsx
src/modules/task/components/task-comment-thread.tsx
src/modules/task/components/checklist-editor.tsx
src/modules/task/components/kanban-board.tsx
src/modules/task/components/kanban-column.tsx
src/modules/task/components/task-file-list.tsx
src/modules/task/schemas/task.schema.ts
src/modules/task/schemas/project.schema.ts
src/modules/task/utils/task-formatters.ts
src/modules/task/utils/task-status-transition.ts
```

---

## 28. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Kanban drag/drop phức tạp trên mobile | UX kém | Mobile dùng status dropdown/move action |
| Permission RBAC + project role dễ lệch | Lộ hoặc thiếu action | Ưu tiên `allowed_actions` từ backend, QA theo matrix |
| Task detail gọi quá nhiều API | Chậm | Lazy load comment/file/activity, cache riêng |
| Optimistic update sai | UI lệch backend | Chỉ optimistic cho action an toàn, rollback rõ |
| Employee nghỉ phép khi assign | Giao việc sai | Backend validate, frontend hiển thị warning |
| Comment mention gây spam notification | UX khó chịu | Backend dedupe event, frontend không tự tạo notification |
| File private URL bị lộ | Rủi ro bảo mật | Dùng file service, không lưu raw URL ngoài thời hạn |
| Filter/list phức tạp | Query params rối | Dùng helper parse/stringify và whitelist field |
| Project archived nhưng UI vẫn cho sửa | Sai nghiệp vụ | Dùng allowed_actions + readonly banner |
| Backend chưa có Kanban API | Delay | Tạm group từ task list trong MVP nhỏ, chốt endpoint chính thức sau |

---

## 29. Definition of Done cho FRONTEND-11

FRONTEND-11 được xem là hoàn thành khi:

1. Có route registry cho toàn bộ màn TASK MVP.
2. Sidebar TASK hiển thị theo permission, không hard-code role.
3. Có API service cho Project, Project Member, Task, Assignment, Comment, Checklist, File và Report tối thiểu.
4. Có query key factory và hook convention cho list/detail/mutation.
5. My Tasks page hoạt động với loading, empty, error, forbidden và overdue/due soon state.
6. Task List page có pagination, search, filter, sort và row action theo allowed actions.
7. Task Detail page hiển thị đủ metadata, description, status action, comment, checklist, file và activity.
8. Task Create/Edit form có validation, dirty form guard và submit state.
9. Update status hoạt động, hiển thị success/error, invalidate cache đúng.
10. Kanban board hoạt động trên desktop, có fallback mobile, có rollback khi API lỗi.
11. Project List/Detail/Members cơ bản hoạt động.
12. File upload/delete dùng file service và permission guard.
13. Comment mention hiển thị đúng UI và không tự tạo notification ở frontend.
14. Frontend xử lý 403/404/409/422 đúng state.
15. Responsive desktop/tablet/mobile web cho P0 screens đạt yêu cầu.
16. Accessibility checklist cơ bản đạt: keyboard, focus, aria-label, text label cho trạng thái.
17. Có unit/component test cho component/hook quan trọng.
18. Có E2E test cho My Tasks -> Task Detail -> Update Status -> Comment/Checklist.
19. Có mock API bằng MSW hoặc cơ chế tương đương nếu backend chưa sẵn.
20. QA checklist permission/data scope/direct route/deep link được kiểm thử.

---

## 30. Kết luận

FRONTEND-11 chốt kế hoạch triển khai frontend cho module **TASK - Công việc & Dự án**.

Tư duy triển khai chính:

```text
Module Workspace TASK
-> Route/sidebar theo permission
-> API service + query hook chuẩn
-> My Tasks và Task Detail là lõi Employee daily flow
-> Task List/Kanban là lõi Manager/Project workflow
-> Project workspace bổ sung quản lý dự án
-> Comment, checklist, file, activity làm Task Detail đủ dùng
-> Permission/data scope/project role chỉ hỗ trợ UX, backend vẫn quyết định cuối
-> Tích hợp HR/LEAVE/NOTI/DASH qua contract rõ ràng
```

Sau FRONTEND-11, bước tiếp theo nên triển khai:

```text
FRONTEND-12: Notification Frontend
```

FRONTEND-12 cần bám theo các deep link/task event đã chốt để notification từ TASK mở đúng màn Task Detail, Project Detail hoặc Kanban theo quyền của user.
