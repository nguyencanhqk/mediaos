# TÀI LIỆU CHO ĐỘI DEV

## MediaOS — Internal MVP v1

### Hệ thống quản trị công ty media đa kênh

---

# 1. Mục tiêu tài liệu

Tài liệu này dùng để bàn giao cho đội phát triển phần mềm, bao gồm:

* Backend
* Frontend Web
* Mobile
* UI/UX
* QA
* DevOps
* Product Owner
* Business Analyst

Mục tiêu là giúp đội dev hiểu:

1. Hệ thống cần giải quyết vấn đề gì.
2. Kiến trúc tổng thể nên thiết kế như thế nào.
3. Database cần chia module ra sao.
4. API nên tổ chức thế nào.
5. Các epic/user story chính là gì.
6. Thứ tự triển khai sprint.
7. Quy tắc bảo mật, phân quyền, audit log.
8. Tiêu chí nghiệm thu kỹ thuật cho MVP v1.

---

# 2. Tổng quan sản phẩm

## 2.1. Tên sản phẩm

**MediaOS**

## 2.2. Mô tả ngắn

MediaOS là hệ thống quản trị nội bộ cho công ty media sản xuất video đa kênh, đa nền tảng.

Hệ thống phục vụ công ty có quy mô:

* Khoảng 200 nhân sự
* Khoảng 100 kênh
* Khoảng 300 video/tháng
* Nhiều phòng ban
* Nhiều team/ekip
* Nhiều workflow sản xuất
* Nhiều loại nội dung
* Nhiều cấp duyệt
* Có quản lý KPI, lương, thưởng, phạt, doanh thu, chi phí

---

# 3. Mục tiêu MVP v1

MVP v1 cần làm được các việc chính:

```text
1. Quản lý công ty, phòng ban, team, chức vụ, nhân sự.
2. Quản lý role, permission, scope permission.
3. Quản lý kênh, tài khoản nền tảng, quyền xem tài khoản.
4. Quản lý project gồm nhiều kênh, nhiều video, nhiều team.
5. Quản lý content/video, asset, lịch đăng.
6. Tạo workflow template và áp dụng vào project/content.
7. Tự sinh task từ workflow.
8. Nhân viên nhận task, nộp sản phẩm, comment, upload file.
9. Duyệt sản phẩm tối đa 3 cấp.
10. Trả sửa đúng người, đúng bước, tạo defect/revision task.
11. Chấm điểm sản phẩm và đưa vào KPI.
12. Chấm công, nghỉ phép, bảng lương cơ bản.
13. Nhập doanh thu, chi phí, phân bổ chi phí, tính lợi nhuận.
14. Chat realtime, group chat tự động.
15. Notification center.
16. Meeting và task sau họp.
17. Web app quản trị đầy đủ.
18. Mobile app cho thao tác nhanh.
19. Audit log cho hành động quan trọng.
20. Database sẵn sàng mở rộng SaaS.
```

---

# 4. Định hướng kiến trúc kỹ thuật

## 4.1. Kiến trúc khuyến nghị cho MVP

MVP v1 nên dùng mô hình:

```text
Modular Monolith + API-first + SaaS-ready Database
```

Không nên tách microservices quá sớm vì:

* Domain còn thay đổi nhiều.
* Workflow, KPI, phân quyền cần thử nghiệm nội bộ.
* Microservices làm tăng chi phí DevOps.
* MVP cần ra nhanh và dễ chỉnh.

Tuy nhiên, codebase phải chia module rõ để sau này có thể tách service.

---

## 4.2. Các layer chính

```text
Client Layer
├── Web App
└── Mobile App

API Layer
├── REST API / GraphQL nếu cần
├── WebSocket Gateway
└── File Upload API

Application Layer
├── Auth Module
├── Organization Module
├── Permission Module
├── Channel Module
├── Project Module
├── Workflow Module
├── Task Module
├── Approval Module
├── Evaluation/KPI Module
├── HR Module
├── Payroll Module
├── Finance Module
├── Chat Module
├── Notification Module
├── Meeting Module
└── Audit Module

Data Layer
├── PostgreSQL
├── Redis
├── Object Storage
└── Search Index nếu cần sau này
```

---

# 5. Tech stack đề xuất

Đội dev có thể chọn stack khác, nhưng stack đề xuất:

## 5.1. Backend

```text
Node.js + NestJS
hoặc
Java + Spring Boot
hoặc
.NET Core
```

Khuyến nghị nếu muốn phát triển nhanh:

```text
NestJS + TypeScript
```

Lý do:

* Modular tốt
* Dễ chia module
* Dễ làm REST API/WebSocket
* TypeScript đồng bộ với frontend
* Phù hợp MVP và SaaS sau này

---

## 5.2. Database

```text
PostgreSQL
```

Lý do:

* Quan hệ dữ liệu phức tạp
* Hỗ trợ JSONB cho config workflow/permission/rule
* Dễ mở rộng SaaS
* Phù hợp tài chính, HR, audit log

---

## 5.3. Cache / Queue / Realtime

```text
Redis
```

Dùng cho:

* Cache permission
* Session/token blacklist nếu cần
* Notification queue
* WebSocket presence
* Rate limit
* Job queue

---

## 5.4. Frontend Web

```text
React / Next.js
TypeScript
```

UI library có thể dùng:

```text
Ant Design
MUI
shadcn/ui
```

Với hệ thống quản trị nhiều bảng dữ liệu, Ant Design là lựa chọn nhanh.

---

## 5.5. Mobile

```text
React Native
hoặc
Flutter
```

Nếu backend/frontend dùng TypeScript, React Native thuận lợi hơn.

---

## 5.6. File Storage

```text
S3-compatible storage
```

Ví dụ:

* AWS S3
* Cloudflare R2
* MinIO nếu self-host
* Google Cloud Storage

---

## 5.7. DevOps

```text
Docker
Docker Compose cho dev
CI/CD GitHub Actions / GitLab CI
Staging environment
Production environment
```

---

# 6. Cấu trúc repository đề xuất

## 6.1. Monorepo

Khuyến nghị dùng monorepo:

```text
mediaos/
├── apps/
│   ├── api/
│   ├── web/
│   └── mobile/
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── ui/
│   └── config/
├── docs/
│   ├── api/
│   ├── database/
│   ├── product/
│   └── architecture/
├── docker/
├── scripts/
└── README.md
```

## 6.2. Backend module structure

```text
apps/api/src/
├── main.ts
├── app.module.ts
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── utils/
│   └── constants/
├── modules/
│   ├── auth/
│   ├── company/
│   ├── organization/
│   ├── employee/
│   ├── permission/
│   ├── channel/
│   ├── project/
│   ├── content/
│   ├── workflow/
│   ├── task/
│   ├── approval/
│   ├── evaluation/
│   ├── kpi/
│   ├── attendance/
│   ├── leave/
│   ├── payroll/
│   ├── finance/
│   ├── chat/
│   ├── notification/
│   ├── meeting/
│   └── audit/
└── database/
    ├── migrations/
    ├── seeders/
    └── entities/
```

---

# 7. Quy tắc database

## 7.1. Primary key

Dùng UUID:

```sql
id UUID PRIMARY KEY
```

## 7.2. Các cột chuẩn

Hầu hết bảng chính cần có:

```sql
id UUID PRIMARY KEY
company_id UUID NOT NULL
created_by UUID NULL
created_at TIMESTAMP NOT NULL DEFAULT NOW()
updated_by UUID NULL
updated_at TIMESTAMP NULL
deleted_at TIMESTAMP NULL
status VARCHAR(50)
```

## 7.3. Multi-tenant ready

Tất cả bảng nghiệp vụ chính phải có:

```sql
company_id
```

Ví dụ:

```text
users
employee_profiles
org_units
teams
channels
projects
content_items
workflow_templates
tasks
approval_requests
payslips
revenue_records
cost_records
chat_rooms
notifications
```

## 7.4. Soft delete

Không xóa cứng dữ liệu quan trọng.

Dùng:

```sql
deleted_at
```

Bắt buộc soft delete với:

```text
users
employee_profiles
channels
projects
content_items
tasks
workflow_templates
payslips
revenue_records
cost_records
platform_accounts
```

## 7.5. Dữ liệu nhạy cảm

Các bảng nhạy cảm:

```text
platform_accounts
salary_profiles
payslips
revenue_records
cost_records
profit_snapshots
audit_logs
```

Yêu cầu:

* Không trả dữ liệu nhạy cảm nếu không có permission.
* Mật khẩu tài khoản nền tảng phải mã hóa.
* Mọi lần xem/sửa dữ liệu nhạy cảm phải ghi audit log.

---

# 8. Danh sách bảng MVP v1

## 8.1. Core

```text
companies
users
employee_profiles
org_units
positions
teams
team_members
roles
permissions
role_permissions
user_roles
object_permissions
audit_logs
```

## 8.2. Media

```text
platforms
channels
platform_accounts
channel_accounts
channel_members
projects
project_channels
project_teams
project_members
content_types
content_items
content_channels
content_assets
```

## 8.3. Workflow & Task

```text
workflow_templates
workflow_step_templates
workflow_step_dependencies
workflow_instances
workflow_step_instances
tasks
task_comments
task_attachments
checklists
checklist_items
```

## 8.4. Approval & KPI

```text
approval_rules
approval_requests
approval_steps
defects
defect_histories
evaluation_templates
evaluation_criteria
evaluation_results
evaluation_scores
kpi_definitions
kpi_results
performance_reviews
```

## 8.5. HR & Payroll

```text
work_schedules
attendance_records
attendance_adjustment_requests
leave_types
leave_requests
leave_balances
salary_profiles
payroll_periods
payslips
payslip_items
bonus_penalties
```

## 8.6. Finance

```text
revenue_records
cost_records
cost_allocations
profit_snapshots
expense_requests
expense_approvals
```

## 8.7. Communication

```text
chat_rooms
chat_members
messages
notifications
notification_rules
notification_preferences
meeting_rooms
meetings
meeting_attendees
meeting_notes
meeting_tasks
```

---

# 9. Permission system

## 9.1. Mô hình quyền

Hệ thống dùng mô hình:

```text
RBAC + Scope Permission + Object Permission + Sensitive Permission
```

Công thức:

```text
User + Role + Scope + Object + Action
```

Ví dụ:

```text
User A có role Project Manager trong Project X.
User B có role Channel Manager trong Channel Y.
User C có quyền đặc biệt xem platform_account của Channel Z trong 24 giờ.
```

---

## 9.2. Các bảng permission

```text
roles
permissions
role_permissions
user_roles
object_permissions
```

## 9.3. Permission code convention

Quy tắc đặt tên:

```text
module.action
```

Ví dụ:

```text
channel.view
channel.create
channel.edit
channel.delete
channel.view_revenue
channel.view_account
project.create
project.assign_member
workflow.create
task.assign
approval.approve
approval.return_revision
payroll.view_own
payroll.view_all
finance.view_profit
finance.export
system.manage_permission
```

---

## 9.4. Scope type

```text
company
org_unit
team
project
channel
own
custom
```

---

## 9.5. Permission guard

Backend cần có permission guard kiểm tra:

```text
1. User đã đăng nhập chưa?
2. User thuộc company nào?
3. User có role nào?
4. Role có permission action không?
5. Permission có đúng scope không?
6. Nếu là object nhạy cảm, user có object permission không?
7. Nếu hành động nhạy cảm, có cần audit log không?
```

Pseudo flow:

```text
request → auth guard → company guard → permission guard → controller
```

---

# 10. API convention

## 10.1. REST API prefix

```text
/api/v1
```

## 10.2. Response format

Thành công:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Thất bại:

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "You do not have permission to perform this action."
  }
}
```

## 10.3. Pagination

Request:

```text
?page=1&pageSize=20&sortBy=created_at&sortOrder=desc
```

Response:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

## 10.4. Filter convention

Ví dụ:

```text
GET /api/v1/tasks?status=waiting_review&assignedTo=USER_ID&projectId=PROJECT_ID
```

## 10.5. Soft delete endpoint

Không dùng hard delete mặc định.

```text
DELETE /api/v1/projects/:id
```

Thực chất update:

```text
deleted_at = now()
status = archived
```

---

# 11. API module list

## 11.1. Auth API

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/me
```

## 11.2. Organization API

```text
GET    /api/v1/org-units
POST   /api/v1/org-units
GET    /api/v1/org-units/:id
PATCH  /api/v1/org-units/:id
DELETE /api/v1/org-units/:id

GET    /api/v1/teams
POST   /api/v1/teams
GET    /api/v1/teams/:id
PATCH  /api/v1/teams/:id
POST   /api/v1/teams/:id/members
DELETE /api/v1/teams/:id/members/:userId
```

## 11.3. Employee API

```text
GET    /api/v1/employees
POST   /api/v1/employees
GET    /api/v1/employees/:id
PATCH  /api/v1/employees/:id
POST   /api/v1/employees/import
GET    /api/v1/employees/:id/tasks
GET    /api/v1/employees/:id/kpi
GET    /api/v1/employees/:id/attendance
GET    /api/v1/employees/:id/payslips
```

## 11.4. Permission API

```text
GET    /api/v1/roles
POST   /api/v1/roles
PATCH  /api/v1/roles/:id
GET    /api/v1/permissions
POST   /api/v1/roles/:id/permissions
POST   /api/v1/users/:id/roles
DELETE /api/v1/users/:id/roles/:roleId
POST   /api/v1/object-permissions
```

## 11.5. Channel API

```text
GET    /api/v1/channels
POST   /api/v1/channels
GET    /api/v1/channels/:id
PATCH  /api/v1/channels/:id
DELETE /api/v1/channels/:id

GET    /api/v1/channels/:id/accounts
POST   /api/v1/channels/:id/accounts
GET    /api/v1/channels/:id/health
PATCH  /api/v1/channels/:id/health
GET    /api/v1/channels/:id/projects
GET    /api/v1/channels/:id/content
GET    /api/v1/channels/:id/revenue
GET    /api/v1/channels/:id/costs
```

## 11.6. Platform Account API

```text
GET    /api/v1/platform-accounts
POST   /api/v1/platform-accounts
GET    /api/v1/platform-accounts/:id
PATCH  /api/v1/platform-accounts/:id
POST   /api/v1/platform-accounts/:id/reveal-secret
```

Lưu ý:

```text
/reveal-secret phải kiểm tra quyền nhạy cảm và ghi audit log.
```

## 11.7. Project API

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id

POST   /api/v1/projects/:id/channels
POST   /api/v1/projects/:id/teams
POST   /api/v1/projects/:id/members

GET    /api/v1/projects/:id/content
GET    /api/v1/projects/:id/tasks
GET    /api/v1/projects/:id/workflows
GET    /api/v1/projects/:id/finance
```

## 11.8. Content API

```text
GET    /api/v1/content-items
POST   /api/v1/content-items
GET    /api/v1/content-items/:id
PATCH  /api/v1/content-items/:id
DELETE /api/v1/content-items/:id

POST   /api/v1/content-items/:id/channels
POST   /api/v1/content-items/:id/assets
GET    /api/v1/content-items/:id/workflow
GET    /api/v1/content-items/:id/tasks
GET    /api/v1/content-items/:id/approvals
GET    /api/v1/content-items/:id/defects
GET    /api/v1/content-items/:id/evaluations
```

## 11.9. Workflow API

```text
GET    /api/v1/workflow-templates
POST   /api/v1/workflow-templates
GET    /api/v1/workflow-templates/:id
PATCH  /api/v1/workflow-templates/:id
DELETE /api/v1/workflow-templates/:id

POST   /api/v1/workflow-templates/:id/steps
PATCH  /api/v1/workflow-steps/:id
DELETE /api/v1/workflow-steps/:id

POST   /api/v1/workflows/apply
GET    /api/v1/workflow-instances/:id
PATCH  /api/v1/workflow-step-instances/:id
```

## 11.10. Task API

```text
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/:id
PATCH  /api/v1/tasks/:id
DELETE /api/v1/tasks/:id

POST   /api/v1/tasks/:id/comments
POST   /api/v1/tasks/:id/attachments
POST   /api/v1/tasks/:id/submit
POST   /api/v1/tasks/:id/start
POST   /api/v1/tasks/:id/complete
```

## 11.11. Approval API

```text
GET    /api/v1/approvals/inbox
GET    /api/v1/approval-requests/:id
POST   /api/v1/approval-requests
POST   /api/v1/approval-requests/:id/approve
POST   /api/v1/approval-requests/:id/reject
POST   /api/v1/approval-requests/:id/return-revision
```

## 11.12. Defect API

```text
GET    /api/v1/defects
POST   /api/v1/defects
GET    /api/v1/defects/:id
PATCH  /api/v1/defects/:id
POST   /api/v1/defects/:id/resolve
POST   /api/v1/defects/:id/reopen
```

## 11.13. Evaluation & KPI API

```text
GET    /api/v1/evaluation-templates
POST   /api/v1/evaluation-templates
POST   /api/v1/evaluation-results

GET    /api/v1/kpi/my
GET    /api/v1/kpi/users/:userId
GET    /api/v1/kpi/teams/:teamId
GET    /api/v1/kpi/departments/:orgUnitId
POST   /api/v1/kpi/calculate
POST   /api/v1/kpi/lock-period
```

## 11.14. HR API

```text
POST   /api/v1/attendance/check-in
POST   /api/v1/attendance/check-out
GET    /api/v1/attendance/my
GET    /api/v1/attendance
POST   /api/v1/attendance-adjustments
POST   /api/v1/attendance-adjustments/:id/approve
POST   /api/v1/attendance-adjustments/:id/reject

GET    /api/v1/leave-requests
POST   /api/v1/leave-requests
POST   /api/v1/leave-requests/:id/approve
POST   /api/v1/leave-requests/:id/reject
```

## 11.15. Payroll API

```text
GET    /api/v1/salary-profiles
POST   /api/v1/salary-profiles
PATCH  /api/v1/salary-profiles/:id

GET    /api/v1/payroll-periods
POST   /api/v1/payroll-periods
POST   /api/v1/payroll-periods/:id/generate-payslips

GET    /api/v1/payslips
GET    /api/v1/payslips/my
GET    /api/v1/payslips/:id
POST   /api/v1/payslips/:id/approve
POST   /api/v1/payslips/:id/confirm
POST   /api/v1/payslips/:id/dispute
```

## 11.16. Finance API

```text
GET    /api/v1/revenue-records
POST   /api/v1/revenue-records
PATCH  /api/v1/revenue-records/:id

GET    /api/v1/cost-records
POST   /api/v1/cost-records
PATCH  /api/v1/cost-records/:id

POST   /api/v1/cost-allocations/calculate
GET    /api/v1/profit-snapshots

GET    /api/v1/expense-requests
POST   /api/v1/expense-requests
POST   /api/v1/expense-requests/:id/approve
POST   /api/v1/expense-requests/:id/reject
```

## 11.17. Chat API / WebSocket

REST:

```text
GET    /api/v1/chat-rooms
POST   /api/v1/chat-rooms
GET    /api/v1/chat-rooms/:id/messages
POST   /api/v1/chat-rooms/:id/members
```

WebSocket events:

```text
message.send
message.receive
message.read
room.join
room.leave
typing.start
typing.stop
notification.receive
```

## 11.18. Notification API

```text
GET    /api/v1/notifications
POST   /api/v1/notifications/:id/read
POST   /api/v1/notifications/read-all
GET    /api/v1/notification-preferences
PATCH  /api/v1/notification-preferences
GET    /api/v1/notification-rules
PATCH  /api/v1/notification-rules/:id
```

## 11.19. Meeting API

```text
GET    /api/v1/meeting-rooms
POST   /api/v1/meeting-rooms

GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/:id
PATCH  /api/v1/meetings/:id
DELETE /api/v1/meetings/:id

POST   /api/v1/meetings/:id/notes
POST   /api/v1/meetings/:id/tasks
```

---

# 12. Backend service design

## 12.1. AuthService

Nhiệm vụ:

```text
Login
Logout
Refresh token
Password hash
Password reset
Current user
2FA nếu có
```

## 12.2. PermissionService

Nhiệm vụ:

```text
Load user roles
Load role permissions
Check permission by action
Check scope
Check object permission
Cache permission
Invalidate cache khi role thay đổi
```

Core method:

```text
can(user, action, objectType, objectId, context)
```

Ví dụ:

```text
can(user, "project.edit", "project", projectId, { companyId })
```

## 12.3. AuditService

Nhiệm vụ:

```text
Log action
Log old/new value
Log sensitive access
Log permission changes
Log finance/payroll changes
```

## 12.4. WorkflowService

Nhiệm vụ:

```text
Create workflow template
Create step templates
Apply template to target
Generate workflow instance
Generate step instances
Generate tasks
Handle dependencies
Lock/unlock related steps
```

## 12.5. TaskService

Nhiệm vụ:

```text
Create task
Assign task
Update status
Submit work
Attach files
Check deadline
Mark overdue
```

## 12.6. ApprovalService

Nhiệm vụ:

```text
Create approval request
Find next approver
Approve step
Reject
Return revision
Move to next approval level
Complete approval
```

## 12.7. DefectService

Nhiệm vụ:

```text
Create defect
Assign responsible user
Create revision task
Mark severity
Affect KPI flag
Lock related scope
Resolve defect
Reopen defect
```

## 12.8. KPIService

Nhiệm vụ:

```text
Aggregate task data
Aggregate evaluation data
Aggregate defect data
Calculate KPI result
Lock KPI period
Provide KPI dashboard
```

## 12.9. PayrollService

Nhiệm vụ:

```text
Generate payroll period
Pull attendance data
Pull KPI data
Pull bonus/penalty
Generate payslip
Approve payslip
Publish payslip
Employee confirm/dispute
```

## 12.10. FinanceService

Nhiệm vụ:

```text
Create revenue
Create cost
Allocate cost
Calculate profit snapshot
Handle expense approval
```

## 12.11. NotificationService

Nhiệm vụ:

```text
Create notification
Dispatch web notification
Dispatch mobile push
Dispatch chat notification
Handle required notification
Handle preferences
```

## 12.12. ChatService

Nhiệm vụ:

```text
Create direct room
Create group room
Auto create project/channel rooms
Send message
Store message
Broadcast via WebSocket
Manage chat members
```

---

# 13. Event-driven internal logic

Dù chưa cần microservices, backend nên có internal events.

## 13.1. Event examples

```text
task.created
task.assigned
task.submitted
task.approved
task.returned_revision
task.overdue

approval.requested
approval.approved
approval.rejected
approval.revision_requested

defect.created
defect.resolved
defect.serious_created

workflow.applied
workflow.step_completed
workflow.completed

payroll.generated
payroll.published
payslip.confirmed

revenue.created
cost.created
expense.approved

meeting.created
meeting.task_created

chat.message_sent
notification.created
```

## 13.2. Event usage

Ví dụ:

```text
task.assigned
→ create notification
→ send mobile push
→ add message to project chat nếu cấu hình bật
```

Ví dụ:

```text
approval.revision_requested
→ create defect
→ create revision task
→ notify responsible user
→ update workflow step status
→ update KPI data if needed
```

---

# 14. Frontend web structure

## 14.1. Web route structure

```text
/login

/dashboard
/dashboard/company
/dashboard/production
/dashboard/finance
/dashboard/hr

/organization
/organization/org-units
/organization/teams
/organization/positions

/employees
/employees/:id

/channels
/channels/:id

/projects
/projects/:id

/content
/content/:id

/workflows
/workflows/templates
/workflows/templates/:id
/workflows/instances/:id

/tasks
/tasks/my
/tasks/team
/tasks/project
/tasks/:id

/approvals
/approvals/:id

/defects
/defects/:id

/evaluations
/kpi

/hr/attendance
/hr/leave

/payroll
/payroll/periods
/payroll/payslips

/finance/revenue
/finance/costs
/finance/profit
/finance/expenses

/chat
/notifications
/meetings

/settings/roles
/settings/permissions
/settings/notification-rules
/settings/audit-logs
```

---

## 14.2. Shared UI components

```text
DataTable
FilterBar
SearchInput
StatusBadge
PriorityBadge
UserAvatar
UserSelect
TeamSelect
ChannelSelect
ProjectSelect
PermissionGate
SensitiveDataMask
AuditLogTimeline
WorkflowTimeline
TaskCard
TaskDrawer
ApprovalPanel
RevisionForm
EvaluationForm
KpiCard
FinanceSummaryCard
NotificationItem
ChatRoomList
ChatMessageBubble
FileUploader
```

---

## 14.3. PermissionGate component

Frontend cần component để ẩn/hiện UI theo quyền.

Ví dụ:

```tsx
<PermissionGate permission="channel.view_account" objectType="channel" objectId={channelId}>
  <Button>View account</Button>
</PermissionGate>
```

Lưu ý:

```text
Frontend chỉ hỗ trợ UX.
Backend vẫn phải kiểm tra quyền thật.
```

---

# 15. Mobile app structure

## 15.1. Bottom tabs

```text
Home
Tasks
Chat
Notifications
Profile
```

Nếu user có quyền duyệt, hiển thị thêm entry:

```text
Approval
```

## 15.2. Mobile screens

```text
Login
Home
MyTasks
TaskDetail
SubmitWork
ApprovalInbox
ApprovalDetail
ReturnRevision
ChatList
ChatRoom
NotificationCenter
Attendance
LeaveRequest
MeetingList
MeetingDetail
Payslip
KPI
Profile
```

## 15.3. Mobile ưu tiên P0

```text
Login
Home
My Tasks
Task Detail
Submit Work
Approval Inbox
Return Revision
Chat
Notification
Attendance
Meeting
Profile
```

---

# 16. Sprint plan đề xuất

## Sprint 0 — Setup

Mục tiêu:

```text
Setup repo, CI/CD, database, auth skeleton, coding convention.
```

Tasks:

```text
Create monorepo
Setup backend app
Setup web app
Setup mobile app
Setup PostgreSQL
Setup Redis
Setup Docker Compose
Setup migration tool
Setup lint/format
Setup CI pipeline
Create base auth module skeleton
Create base response format
```

Deliverable:

```text
Dev environment chạy được.
API health check hoạt động.
Web/mobile mở được màn hình login mock.
```

---

## Sprint 1 — Auth, Company, User

Tasks:

```text
Login API
Refresh token
Current user API
Company table
User table
Employee profile table
Company settings screen
Employee list basic
Employee detail basic
```

Acceptance:

```text
Admin đăng nhập được.
Tạo được user/employee.
Xem được danh sách nhân sự.
```

---

## Sprint 2 — Organization, Team, Position

Tasks:

```text
Org unit CRUD
Tree structure
Team CRUD
Team member assignment
Position CRUD
Direct manager assignment
Organization chart basic
```

Acceptance:

```text
Tạo được phòng ban nhiều cấp.
Tạo được team.
Gán nhân sự vào team.
Gán quản lý trực tiếp.
```

---

## Sprint 3 — Role & Permission

Tasks:

```text
Role CRUD
Permission seed
Role permission assignment
User role assignment
Scope permission
Permission guard backend
PermissionGate frontend
Audit log for permission changes
```

Acceptance:

```text
User chỉ thấy menu theo quyền.
API chặn user không có quyền.
Thay đổi quyền có audit log.
```

---

## Sprint 4 — Channel Core

Tasks:

```text
Platform seed
Channel CRUD
Channel member
Channel manager assignment
Channel list
Channel detail
Channel health basic
```

Acceptance:

```text
Tạo được kênh.
Gán được manager/team.
Xem được danh sách 100 kênh.
```

---

## Sprint 5 — Platform Account Security

Tasks:

```text
Platform account CRUD
Encrypt secret
Channel-account relation
Reveal secret endpoint
Sensitive permission check
Audit log reveal secret
UI mask/unmask account info
```

Acceptance:

```text
Chỉ người có quyền mới xem tài khoản.
Mọi lần xem mật khẩu ghi audit log.
```

---

## Sprint 6 — Project Core

Tasks:

```text
Project CRUD
Project channels
Project teams
Project members
Project detail tabs
Project permission scope
```

Acceptance:

```text
Một project gắn được nhiều kênh, nhiều team, nhiều thành viên.
```

---

## Sprint 7 — Content Core

Tasks:

```text
Content type CRUD
Content item CRUD
Content channels
Content assets
Content detail
Asset upload/link
```

Acceptance:

```text
Tạo được video/content trong project.
Một content đăng được nhiều kênh.
Upload/link được asset.
```

---

## Sprint 8 — Workflow Template

Tasks:

```text
Workflow template CRUD
Step template CRUD
Step dependency
Checklist config
Default assignee/reviewer config
Workflow builder basic UI
```

Acceptance:

```text
Tạo được workflow mẫu có nhiều bước.
Cấu hình được bước tuần tự/song song cơ bản.
```

---

## Sprint 9 — Workflow Instance & Auto Task

Tasks:

```text
Apply workflow to content/project
Create workflow instance
Create step instances
Generate tasks
Workflow timeline UI
Step status update
```

Acceptance:

```text
Áp workflow vào video.
Hệ thống sinh task.
Workflow timeline hiển thị đúng.
```

---

## Sprint 10 — Task Management

Tasks:

```text
Task board
My tasks
Task detail
Task comments
Task attachments
Submit work
Task status flow
Overdue logic
Mobile My Tasks
Mobile Submit Work
```

Acceptance:

```text
Nhân viên nhận task.
Nộp sản phẩm.
Comment/upload file được.
Task quá hạn hiển thị.
```

---

## Sprint 11 — Approval

Tasks:

```text
Approval rules basic
Approval request
Approval steps
Approval inbox
Approve/reject
Approval level flow
Mobile approval inbox
```

Acceptance:

```text
Duyệt được tối đa 3 cấp.
Người duyệt thấy hàng chờ duyệt.
```

---

## Sprint 12 — Revision / Defect

Tasks:

```text
Return revision
Defect create
Responsible user
Defect type
Revision task
Lock related scope basic
Defect center
Mobile return revision
```

Acceptance:

```text
Trả sửa đúng người, đúng bước.
Tạo revision task.
Lỗi nghiêm trọng flag được KPI/thưởng/phạt.
```

---

## Sprint 13 — Evaluation & KPI Basic

Tasks:

```text
Evaluation template
Evaluation criteria
Evaluation result
Score calculation
KPI definition basic
KPI result calculation
My KPI
Manager KPI view
```

Acceptance:

```text
Chấm điểm sản phẩm.
KPI cá nhân tổng hợp từ task/deadline/lỗi/điểm.
```

---

## Sprint 14 — Chat Realtime

Tasks:

```text
Chat room
Chat member
Direct chat
Group chat
Project auto group
Channel auto group
Message WebSocket
File message basic
Mention basic
Mobile chat
```

Acceptance:

```text
Chat realtime hoạt động.
Tạo project/kênh tự tạo group nếu bật.
```

---

## Sprint 15 — Notification

Tasks:

```text
Notification table
Notification center
Notification rules
Required notification
Task notification
Approval notification
Revision notification
Mobile push skeleton
Read/unread
```

Acceptance:

```text
User nhận notification.
Thông báo bắt buộc không tắt được.
```

---

## Sprint 16 — Meeting

Tasks:

```text
Meeting room
Meeting CRUD
Meeting attendees
Meeting notes
Meeting task
Calendar view basic
Meeting notification
Mobile meeting list
```

Acceptance:

```text
Tạo lịch họp.
Ghi biên bản.
Tạo task sau họp.
```

---

## Sprint 17 — Attendance & Leave

Tasks:

```text
Work schedule
Check-in/check-out
Attendance table
Adjustment request
Approve adjustment
Leave type
Leave request
Leave balance
Approve leave
Mobile attendance
Mobile leave request
```

Acceptance:

```text
Nhân viên chấm công mobile.
Gửi đơn nghỉ.
HR/quản lý duyệt được.
```

---

## Sprint 18 — Payroll Basic

Tasks:

```text
Salary profile
Payroll period
Generate payslip
Payslip items
Bonus/penalty
Approve payslip
Publish payslip
Employee confirm/dispute
Mobile payslip
```

Acceptance:

```text
Tạo bảng lương.
Thưởng/phạt vào payslip.
Nhân viên xem và xác nhận.
```

---

## Sprint 19 — Finance Basic

Tasks:

```text
Revenue record
Cost record
Cost allocation basic
Profit snapshot
Expense request
Expense approval
Finance dashboard basic
```

Acceptance:

```text
Nhập doanh thu/chi phí.
Phân bổ chi phí.
Tính lợi nhuận theo kênh/project/video.
```

---

## Sprint 20 — Dashboard & Internal Rollout

Tasks:

```text
Leadership dashboard
Manager dashboard
Employee dashboard
HR dashboard
Finance dashboard
Bug fixing
Performance optimization
Internal pilot support
User guide
```

Acceptance:

```text
Mỗi nhóm user có dashboard.
Pilot nội bộ dùng được.
```

---

# 17. QA test plan

## 17.1. Unit test

Ưu tiên test:

```text
PermissionService
WorkflowService
TaskService
ApprovalService
DefectService
KPIService
PayrollService
FinanceService
```

## 17.2. Integration test

Test các luồng:

```text
Create project → create content → apply workflow → generate tasks
Submit task → approval request → approve
Submit task → return revision → defect → revision task
Evaluation result → KPI calculation
Attendance + KPI + bonus/penalty → payslip
Revenue + cost + allocation → profit
```

## 17.3. Permission test

Bắt buộc test:

```text
Employee không xem được tài chính.
Team leader không xem được lương team nếu không có quyền.
Project manager chỉ xem project được cấp.
Channel manager chỉ xem kênh được cấp.
Freelancer chỉ xem task được giao.
Người không có quyền không reveal account secret được.
```

## 17.4. Security test

Test:

```text
Password hash
Encrypted platform account password
Token expiration
Permission bypass
Object permission
Audit log sensitive access
File access permission
```

---

# 18. Definition of Done

Một task dev chỉ được coi là done khi:

```text
1. Code hoàn thành.
2. Có migration nếu thay đổi database.
3. API có validation.
4. API có permission guard nếu cần.
5. Frontend xử lý loading/error/empty state.
6. Có test cơ bản.
7. Có audit log nếu là hành động quan trọng.
8. QA đã test pass.
9. Không phá luồng chính.
10. Có cập nhật tài liệu nếu cần.
```

---

# 19. Coding rules

## 19.1. Backend

```text
Không viết business logic trong controller.
Controller chỉ nhận request và trả response.
Service xử lý business logic.
Repository/ORM xử lý database.
DTO phải validate input.
Mọi API phải check company_id.
Mọi API nhạy cảm phải check permission.
```

## 19.2. Frontend

```text
Không hard-code permission.
Không hard-code status text rải rác.
Dùng shared constants.
Dùng reusable components.
Form phải có validation.
Table phải có pagination/filter.
Dữ liệu nhạy cảm phải mask mặc định.
```

## 19.3. Database

```text
Không hard delete dữ liệu quan trọng.
Không lưu password plain text.
Không bỏ company_id ở bảng nghiệp vụ.
Không hard-code workflow.
Không hard-code phòng ban.
Không hard-code role vào business logic.
```

---

# 20. Seed data cần có

## 20.1. Roles

```text
Company Owner
System Admin
Board
Department Manager
Team Leader
Project Manager
Channel Manager
HR Manager
Finance Manager
Employee
Freelancer
```

## 20.2. Platforms

```text
YouTube
TikTok
Facebook
Instagram
Website
Podcast
Other
```

## 20.3. Task status

```text
not_started
in_progress
waiting_review
revision_required
approved
completed
overdue
cancelled
```

## 20.4. Workflow type

```text
production
office
hr
finance
recruitment
training
equipment
approval
```

## 20.5. Defect type

```text
fix_required
serious
```

## 20.6. Notification priority

```text
low
normal
high
critical
```

---

# 21. Các luồng nghiệp vụ phải demo được

## Demo 1 — Core Organization

```text
Admin tạo phòng ban.
Admin tạo team.
Admin tạo nhân sự.
Admin gán role.
User đăng nhập và thấy menu theo quyền.
```

## Demo 2 — Media Production

```text
Tạo kênh.
Tạo project.
Gắn nhiều kênh vào project.
Tạo video/content.
Chọn workflow.
Hệ thống sinh task.
Nhân viên nộp sản phẩm.
Quản lý duyệt.
```

## Demo 3 — Revision

```text
Editor nộp video.
QA trả sửa.
QA chọn lỗi thuộc bước dựng video.
Hệ thống tạo defect.
Hệ thống tạo revision task cho editor.
Editor sửa và nộp lại.
QA duyệt.
```

## Demo 4 — KPI

```text
Task hoàn thành.
Sản phẩm được chấm điểm.
Có một lỗi loại 1 hoặc loại 2.
Hệ thống tính KPI cá nhân.
Nhân viên xem KPI.
Quản lý xem KPI team.
```

## Demo 5 — Payroll

```text
Nhân viên chấm công.
HR duyệt công.
Hệ thống tạo bảng lương.
Thêm thưởng/phạt.
Kế toán duyệt.
Nhân viên xem payslip.
```

## Demo 6 — Finance

```text
Kế toán nhập doanh thu kênh.
Kế toán nhập chi phí project.
Hệ thống phân bổ chi phí.
Dashboard hiển thị lợi nhuận kênh/project.
```

## Demo 7 — Chat & Notification

```text
Tạo project.
Hệ thống tạo group chat project.
Gán task cho user.
User nhận notification.
User chat trong group project.
```

---

# 22. Các rủi ro kỹ thuật cần chú ý

## 22.1. Permission phức tạp

Giải pháp:

```text
Làm PermissionService thật chắc.
Viết test permission nhiều.
Cache permission nhưng phải invalidate đúng.
```

## 22.2. Workflow quá linh hoạt

Giải pháp:

```text
MVP chỉ làm dependency cơ bản.
Canvas nâng cao để sau.
Không cho người dùng cấu hình rule quá phức tạp ở v1.
```

## 22.3. Chat realtime

Giải pháp:

```text
Dùng WebSocket module riêng.
Không để chat ảnh hưởng core API.
Có thể tách service sau.
```

## 22.4. KPI và payroll

Giải pháp:

```text
KPI ban đầu là dữ liệu gợi ý.
Payroll phải có draft.
HR/Finance duyệt trước khi phát hành.
Mọi thay đổi lương phải audit log.
```

## 22.5. Finance accuracy

Giải pháp:

```text
Cho phép điều chỉnh thủ công.
Lưu snapshot.
Không ghi đè dữ liệu cũ không có log.
```

---

# 23. Roadmap kỹ thuật sau MVP

Sau MVP v1, có thể mở rộng:

```text
YouTube API integration
AdSense API integration
Advanced channel analytics
Advanced workflow canvas
Document knowledge base
Training LMS
Recruitment ATS
Equipment QR management
Advanced cost allocation
AI assistant for workflow/task
SaaS billing
Template marketplace
White-label
SSO
Advanced audit/security
```

---

# 24. Kết luận cho đội dev

MediaOS không phải app task đơn giản. Đây là hệ thống vận hành doanh nghiệp media.

Điểm kỹ thuật quan trọng nhất:

```text
1. Không hard-code workflow.
2. Không hard-code phòng ban/team.
3. Không hard-code role.
4. Không bỏ qua company_id.
5. Không để lộ dữ liệu nhạy cảm.
6. Phân quyền phải kiểm tra ở backend.
7. Hành động quan trọng phải có audit log.
8. Workflow → Task → Approval → Defect → KPI → Payroll/Finance là luồng lõi.
9. Web dùng cho quản trị đầy đủ.
10. Mobile dùng cho thao tác nhanh.
```

Nếu đội dev bám đúng tài liệu này, MVP v1 có thể vận hành nội bộ trước, sau đó mở rộng thành SaaS mà không phải viết lại kiến trúc từ đầu.
