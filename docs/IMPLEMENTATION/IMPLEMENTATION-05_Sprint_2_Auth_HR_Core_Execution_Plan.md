> ✅ **ĐÍNH CHÍNH STACK (đã đồng bộ body 22/06):** Tài liệu này đã được dọn về stack CHỐT: **Vite + React 19 SPA + TanStack Router (KHÔNG Next.js)** · **Drizzle (KHÔNG Prisma)** · **Valkey** · **Vitest**. Nguồn chuẩn: [DECISIONS-02](../DECISIONS/DECISIONS-02_Stack_Lock_And_Invariants.md).

# IMPLEMENTATION-05: Sprint 2 Auth & HR Core Execution Plan
# KẾ HOẠCH THỰC THI SPRINT 2 - AUTH & HR CORE

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | IMPLEMENTATION-05 |
| Tên tài liệu | Sprint 2 Auth & HR Core Execution Plan |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Giai đoạn | MVP Version 1.0 |
| Sprint | Sprint 2 |
| Trạng thái | Draft |
| Ngày tạo | 21/06/2026 |
| Ngày cập nhật | 21/06/2026 |
| Thời lượng đề xuất | 10 ngày làm việc |
| Sprint theme | Xác thực, phân quyền, tài khoản người dùng và dữ liệu nhân sự lõi |
| Tài liệu nguồn | PRD-00, SPEC-01, SPEC-02, SPEC-03, DB-02, DB-03, DB-08, DB-09, DB-10, API-01, API-02, API-03, UI-02, UI-03, UI-04, UI-09, FRONTEND-01 -> FRONTEND-04 |
| Đội tham gia | Product Owner, Tech Lead, Backend, Frontend, QA, DevOps |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả kế hoạch thực thi chi tiết cho **Sprint 2 - Auth & HR Core**.

Sprint này nhằm chuyển các thiết kế đã chốt ở SPEC, Database Design, API Design, UI/UX và Frontend Architecture thành các hạng mục triển khai cụ thể cho đội kỹ thuật.

Sprint 2 tập trung vào hai lớp nền quan trọng nhất của MVP:

1. **AUTH Core**
   - Đăng nhập.
   - Đăng xuất.
   - Refresh/session handling.
   - Current user context.
   - RBAC permission resolver.
   - Data scope resolver.
   - User, role, permission seed.
   - Guard backend và frontend.

2. **HR Core**
   - Cấu trúc tổ chức cơ bản.
   - Hồ sơ nhân viên trung tâm.
   - Mã nhân viên tự sinh.
   - Danh sách nhân viên.
   - Chi tiết nhân viên.
   - Tạo/cập nhật nhân viên.
   - Đổi trạng thái nhân viên.
   - Liên kết employee với user.
   - Hồ sơ cá nhân của tôi ở mức đọc cơ bản.

Sprint này chưa triển khai sâu chấm công, nghỉ phép, task, dashboard và notification nghiệp vụ. Tuy nhiên AUTH và HR Core phải đủ ổn định để các sprint sau có thể dùng lại.

---

## 3. Vị trí của Sprint 2 trong roadmap IMPLEMENTATION

Roadmap triển khai MVP đề xuất:

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

Sprint 1 đã chuẩn bị foundation, môi trường, repository, migration base, API base, frontend shell và CI/CD cơ bản.

Sprint 2 bắt đầu triển khai nghiệp vụ nền đầu tiên: **người dùng là ai, có quyền gì, liên kết với nhân viên nào và được xem dữ liệu nhân sự nào**.

---

## 4. Sprint goal

### 4.1 Sprint goal tổng quát

Hoàn thành nền tảng đăng nhập, phân quyền và dữ liệu nhân sự lõi để người dùng có thể đăng nhập vào hệ thống, được backend/frontend nhận diện đúng quyền, xem được Home/HR Workspace theo quyền và HR/Admin có thể quản lý hồ sơ nhân viên cơ bản.

### 4.2 Business outcome

Sau Sprint 2, hệ thống phải hỗ trợ được các nghiệp vụ tối thiểu:

1. Admin/HR đăng nhập vào hệ thống.
2. Backend xác định được user, company, role, permission, data scope và employee liên kết.
3. HR/Admin xem danh sách nhân viên theo phạm vi quyền.
4. HR/Admin tạo hồ sơ nhân viên mới với mã nhân viên tự sinh.
5. HR/Admin cập nhật thông tin nhân viên cơ bản.
6. HR/Admin đổi trạng thái nhân viên.
7. HR/Admin liên kết nhân viên với tài khoản user.
8. Employee xem hồ sơ cá nhân của chính mình ở mức read-only.
9. Frontend ẩn/hiện route, menu, action theo permission từ backend.
10. QA có thể kiểm thử permission/data scope cơ bản cho AUTH và HR.

### 4.3 Technical outcome

Sau Sprint 2, hệ thống phải có:

1. Database migration cho AUTH/RBAC và HR Core.
2. Seed data cho module, permission, role, role-permission và HR master data cơ bản.
3. Auth middleware/guard trên backend.
4. Permission/data scope resolver dùng lại được cho các module sau.
5. API Auth Core và HR Core có contract ổn định.
6. Frontend auth bootstrap, protected route và permission utility.
7. Login/logout flow hoạt động end-to-end.
8. HR employee list/detail/form hoạt động với API thật hoặc mock tương thích contract.
9. Audit log cho các thao tác nhạy cảm của AUTH/HR.
10. Test case tự động tối thiểu cho login, guard, permission và HR CRUD cơ bản.

---

## 5. Điều kiện đầu vào

Sprint 2 chỉ nên bắt đầu khi các điều kiện sau đã đạt từ Sprint 1:

| Nhóm | Điều kiện |
| --- | --- |
| Repository | Backend và frontend repository đã tạo, có branch strategy, lint, format, test script cơ bản |
| Environment | Local/dev/staging env có thể chạy backend, frontend, database |
| Database | PostgreSQL sẵn sàng, migration runner hoạt động |
| Foundation DB | `companies`, `modules`, `audit_logs`, `files`, `file_links`, `sequence_counters`, `company_settings` đã có hoặc có migration base |
| API base | Response format, error format, pagination convention, exception handler, request id đã có skeleton |
| Frontend base | App shell, provider skeleton, design token/component foundation tối thiểu đã có |
| CI | Pull request chạy lint/test/build cơ bản |
| Issue board | Sprint board có Epic/Story/Task/Bug, label module và priority |

Nếu một số hạng mục Sprint 1 chưa hoàn thành, Sprint 2 vẫn có thể chạy nhưng phải tạo **blocking task** tương ứng trong ngày đầu tiên.

---

## 6. Phạm vi Sprint 2

### 6.1 Phạm vi bắt buộc P0

| Module | Hạng mục P0 |
| --- | --- |
| AUTH DB | `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_sessions`, `password_reset_tokens`, `login_logs`, `user_security_events` |
| AUTH Seed | Module catalog, permission catalog, default roles, role-permission matrix, bootstrap admin |
| AUTH Backend | Login, logout, refresh/session, current user, permission resolver, data scope resolver, password hash, login log |
| AUTH Frontend | Login page, logout, session bootstrap, protected route, permission utility, route/menu/action guard |
| HR DB | `departments`, `positions`, `job_levels`, `contract_types`, `employees`, `employee_status_histories`, `employee_code_configs`, dùng lại `sequence_counters` |
| HR Backend | Employee list/detail/create/update/change-status/link-user, My Profile read, department/position/job level/contract type lookup |
| HR Frontend | HR route, employee list, employee detail, employee create/edit form cơ bản, my profile read-only |
| QA | Auth API tests, HR API tests, permission/data scope tests, frontend smoke tests |
| DevOps | Migration/seed chạy được trên dev/staging, env secret cho token/password hash |

### 6.2 Phạm vi nên làm P1

| Module | Hạng mục P1 |
| --- | --- |
| AUTH | Forgot/reset password API ở mức MVP nếu không phụ thuộc email thật |
| AUTH Admin | User list/detail/lock/unlock cơ bản cho Admin |
| HR | Department/position CRUD cơ bản nếu còn capacity |
| HR | Contract type/job level CRUD cơ bản nếu còn capacity |
| HR | Profile change request skeleton: table + API stub, chưa cần full approval UI |
| Frontend | Role/permission admin read-only screen hoặc placeholder |
| QA | E2E login -> HR list -> detail -> create employee |

### 6.3 Ngoài phạm vi Sprint 2

| Hạng mục | Lý do chuyển sprint sau |
| --- | --- |
| Chấm công check-in/check-out | Thuộc Sprint 3 Attendance |
| Nghỉ phép tạo/duyệt đơn | Thuộc Sprint 3 Leave |
| Task/project | Thuộc Sprint 4 Task |
| Notification realtime | Sprint 4 hoặc sau MVP; Sprint 2 chỉ tạo event hook nếu cần |
| Dashboard widget thật | Sprint 4; Sprint 2 chỉ đảm bảo Auth/HR data sẵn sàng |
| File hồ sơ đầy đủ | Có thể skeleton trong Sprint 2, triển khai sâu ở sprint hardening hoặc HR extension |
| Contract CRUD đầy đủ | P1/P2 tùy capacity, không chặn Sprint 3 nếu employee core đã đủ |
| Employee Self-Service full approval | Có thể để Sprint 4/5 vì cần NOTI và HR review workflow |
| OAuth/SSO/2FA | Phase sau MVP |
| Payroll dữ liệu lương | Phase 2, chỉ tách quyền từ sớm |

---

## 7. Nguyên tắc triển khai bắt buộc

### 7.1 Backend là nguồn kiểm soát quyền cuối cùng

Frontend được phép ẩn/hiện menu, route, button và field để cải thiện UX. Tuy nhiên mọi API trong Sprint 2 phải kiểm tra lại:

1. Authentication.
2. User status.
3. Company status.
4. Module status nếu có.
5. Permission.
6. Data scope.
7. Target resource có thuộc scope không.
8. Business rule.
9. Audit log.

Không chấp nhận logic kiểu:

```ts
if (user.role === 'HR') { ... }
```

Thay vào đó phải dùng:

```text
permission + data_scope + target resource + business rule
```

---

### 7.2 AUTH không phụ thuộc ngược vào HR

Quan hệ chính:

```text
employees.user_id -> users.id
```

Không đặt `employee_id` trong bảng `users` ở MVP.

Lý do:

1. AUTH cần bootstrap độc lập.
2. Không phải employee nào cũng có tài khoản user ngay.
3. User có thể tạo trước, employee liên kết sau.
4. Tránh vòng phụ thuộc khó migration.

---

### 7.3 HR là nguồn dữ liệu nhân sự trung tâm

Tất cả module sau cần dùng HR để lấy:

1. Employee id.
2. Department.
3. Position.
4. Job level.
5. Direct manager.
6. Employment status.
7. User-employee mapping.

Do đó Sprint 2 phải ưu tiên chất lượng model và API HR Core hơn số lượng màn hình phụ.

---

### 7.4 Multi-tenant ready từ đầu

Mọi bảng nghiệp vụ có dữ liệu công ty phải có `company_id`.

Mọi query backend phải lấy `company_id` từ auth context, không tin `company_id` do frontend gửi.

---

### 7.5 Không trả dữ liệu nhạy cảm nếu thiếu quyền

Các field HR nhạy cảm như `date_of_birth`, `identity_number`, `tax_code`, `bank_account_number`, `personal_email`, `phone`, `address`, emergency contact và file nhạy cảm phải được kiểm soát bằng permission.

Mặc định:

```text
Employee list không trả field nhạy cảm.
Employee detail chỉ trả field nhạy cảm nếu user có HR.EMPLOYEE.VIEW_SENSITIVE và target nằm trong scope.
Export không bao gồm sensitive field nếu thiếu quyền.
```

---

### 7.6 Backend stack đã khóa ở BACKEND-01

Backend stack KHÔNG còn là quyết định mở trong Sprint 2 — đã được chốt ở **BACKEND-01** và Sprint 2 chỉ xác nhận tuân thủ, không quyết định lại:

```text
- Framework: NestJS
- ORM: Drizzle + drizzle-kit
- Database: PostgreSQL với khóa chính UUID
- Cache/session store: Valkey
- Test: Vitest
- API prefix: /api/v1
```

Mọi service, migration và test ở Sprint 2 phải bám theo stack này. Câu hỏi mở duy nhất liên quan còn lại là chiến lược token/session (S2-OQ-001), không phải lựa chọn stack.

---

## 8. Workstream tổng thể

| Workstream | Mục tiêu | Owner chính | Phụ thuộc |
| --- | --- | --- | --- |
| WS1 - Database & Seed | Migration AUTH/HR + seed role/permission/master data | Backend Lead | Foundation DB |
| WS2 - Backend AUTH | Auth middleware, login/session/RBAC resolver | Backend | WS1 |
| WS3 - Backend HR | HR Core API, employee service, employee code service | Backend | WS1, WS2 |
| WS4 - Frontend Auth | Login, auth bootstrap, route guard, permission utility | Frontend | WS2, API mock |
| WS5 - Frontend HR | Employee list/detail/form, my profile | Frontend | WS3, WS4 |
| WS6 - QA | API, permission, data scope, E2E smoke | QA | WS2 -> WS5 |
| WS7 - DevOps/Release | Migration deploy, env, CI, smoke staging | DevOps | WS1 -> WS6 |

---

## 9. Sprint backlog chi tiết

### 9.1 Epic AUTH-CORE

| Story ID | User story | Priority | Tasks chính | Definition of Done |
| --- | --- | --- | --- | --- |
| AUTH-S2-001 | Là Admin, tôi muốn đăng nhập để truy cập hệ thống | P0 | Implement password hash verify, login API, login log, token/session issue | Login thành công với user Active; sai mật khẩu ghi log; Locked/Inactive bị chặn |
| AUTH-S2-002 | Là user, tôi muốn đăng xuất để kết thúc phiên làm việc | P0 | Logout API, revoke session/refresh token, frontend clear cache | Logout xóa session phía server nếu dùng session, frontend về login và clear cache |
| AUTH-S2-003 | Là frontend, tôi muốn lấy current user context | P0 | `GET /api/v1/auth/me`, trả user/company/employee/roles/permissions/scopes/modules | Frontend bootstrap được session và guard route |
| AUTH-S2-004 | Là backend module, tôi muốn kiểm tra permission và data scope | P0 | Permission service, scope resolver, guard decorator/middleware | HR API dùng chung được guard này |
| AUTH-S2-005 | Là Admin, tôi muốn seed role/permission mặc định | P0 | Seed permissions, roles, role_permissions, bootstrap admin | Database trống chạy seed xong đăng nhập được |
| AUTH-S2-006 | Là Admin, tôi muốn quản lý user cơ bản | P1 | User list/detail/create/lock/unlock basic | Admin xem user và khóa/mở khóa được nếu còn capacity |
| AUTH-S2-007 | Là user, tôi muốn quên/đặt lại mật khẩu | P1 | Reset token hash, forgot/reset API, email mock | API reset hoạt động với token mock, email thật có thể phase sau |

---

### 9.2 Epic HR-CORE-DB

| Story ID | User story | Priority | Tasks chính | Definition of Done |
| --- | --- | --- | --- | --- |
| HR-S2-001 | Là hệ thống, tôi cần bảng HR Core để lưu nhân sự | P0 | Migration `departments`, `positions`, `job_levels`, `contract_types`, `employees` | Migration chạy từ DB trống không lỗi |
| HR-S2-002 | Là hệ thống, tôi cần lịch sử trạng thái nhân viên | P0 | Migration `employee_status_histories` | Đổi status tạo history |
| HR-S2-003 | Là HR, tôi muốn mã nhân viên tự sinh | P0 | `employee_code_configs`, dùng `sequence_counters`, service generate code | Tạo employee sinh mã không trùng trong transaction |
| HR-S2-004 | Là hệ thống, tôi muốn seed HR master data | P0 | Seed job levels, contract types, employee code config, demo department/position nếu cần | Seed idempotent, chạy lại không trùng |
| HR-S2-005 | Là hệ thống, tôi muốn index tốt cho HR list | P0 | Index company/status/department/full_name/code/joined_date | List employee có filter/sort cơ bản |

---

### 9.3 Epic HR-CORE-API

| Story ID | User story | Priority | Tasks chính | Definition of Done |
| --- | --- | --- | --- | --- |
| HR-S2-101 | Là HR/Admin, tôi muốn xem danh sách nhân viên | P0 | `GET /api/v1/hr/employees`, pagination, search, filter, sort, data scope | List trả đúng scope, không lộ sensitive field |
| HR-S2-102 | Là HR/Admin, tôi muốn xem chi tiết nhân viên | P0 | `GET /api/v1/hr/employees/{id}`, sensitive masking | Own/Team/Company/System hoạt động, thiếu quyền bị mask hoặc omit field |
| HR-S2-103 | Là Employee, tôi muốn xem hồ sơ của tôi | P0 | `GET /api/v1/hr/me/profile` | Employee xem đúng hồ sơ liên kết user |
| HR-S2-104 | Là HR/Admin, tôi muốn tạo nhân viên | P0 | `POST /api/v1/hr/employees`, validation, code generation, audit | Tạo nhân viên thành công, mã tự sinh, audit log có |
| HR-S2-105 | Là HR/Admin, tôi muốn cập nhật nhân viên | P0 | `PATCH /api/v1/hr/employees/{id}`, validation, audit | Cập nhật field cơ bản, kiểm tra duplicate email/code |
| HR-S2-106 | Là HR/Admin, tôi muốn đổi trạng thái nhân viên | P0 | `POST /employees/{id}/change-status`, status history, optional user lock | Đổi status có history và audit |
| HR-S2-107 | Là HR/Admin, tôi muốn liên kết employee với user | P0 | `POST /employees/{id}/link-user`, `DELETE /link-user`, unique active user link | Một user chỉ link tối đa một employee active |
| HR-S2-108 | Là frontend, tôi cần lookup HR master data | P0 | Department/position/job level/contract type lookup APIs | Form employee load được dropdown |
| HR-S2-109 | Là HR/Admin, tôi muốn quản lý department/position | P1 | CRUD cơ bản department/position | Có create/update/delete mềm nếu còn capacity |
| HR-S2-110 | Là Employee, tôi muốn gửi yêu cầu sửa hồ sơ | P2/P1 | API skeleton profile change request | Có thể để Sprint 5 nếu quá tải |

---

### 9.4 Epic FE-AUTH-HR

| Story ID | User story | Priority | Tasks chính | Definition of Done |
| --- | --- | --- | --- | --- |
| FE-S2-001 | Là user, tôi muốn đăng nhập bằng email/password | P0 | Login page, form validation, call login API, error state | Login thành công vào Home/HR tùy route; lỗi hiển thị rõ |
| FE-S2-002 | Là frontend, tôi muốn bootstrap session | P0 | Auth provider, call `/auth/me`, store context, loading state | Refresh page vẫn giữ session nếu token hợp lệ |
| FE-S2-003 | Là hệ thống, tôi muốn chặn route trái quyền | P0 | ProtectedRoute, PublicRoute, PermissionGate, ForbiddenState | Direct URL thiếu quyền hiển thị 403 |
| FE-S2-004 | Là user, tôi muốn thấy menu/action theo quyền | P0 | App/sidebar/action visibility filter | Không hard-code theo role name |
| FE-S2-005 | Là HR/Admin, tôi muốn xem danh sách nhân viên | P0 | EmployeeList page, table, filter/search, pagination | List hoạt động với API và state loading/empty/error |
| FE-S2-006 | Là HR/Admin, tôi muốn xem chi tiết nhân viên | P0 | EmployeeDetail page, tabs/sections, masked field state | Detail hiển thị đúng quyền sensitive |
| FE-S2-007 | Là HR/Admin, tôi muốn tạo/cập nhật nhân viên | P0 | EmployeeForm, dropdown lookup, validation, submit mutation | Tạo/sửa thành công, invalidate list/detail |
| FE-S2-008 | Là Employee, tôi muốn xem hồ sơ của tôi | P0 | MyProfile read-only page | Employee chỉ xem hồ sơ của mình |
| FE-S2-009 | Là Admin, tôi muốn xem user/role cơ bản | P1 | User list/role placeholder or read-only | Không chặn Sprint 3 nếu chưa xong |

---

### 9.5 Epic QA-S2

| Story ID | Nội dung | Priority | Definition of Done |
| --- | --- | --- | --- |
| QA-S2-001 | Auth API test suite | P0 | Test login success/fail/locked/logout/me |
| QA-S2-002 | RBAC/data scope API tests | P0 | Test Own/Team/Company/System cho HR list/detail |
| QA-S2-003 | HR API CRUD tests | P0 | Test employee create/update/status/link-user |
| QA-S2-004 | Sensitive data tests | P0 | Thiếu quyền không thấy field nhạy cảm |
| QA-S2-005 | Frontend smoke tests | P0 | Login, route guard, HR list, detail, create employee |
| QA-S2-006 | Regression checklist | P0 | Checklist Sprint 2 được ký xác nhận |

---

## 10. Kế hoạch theo ngày

### Ngày 1 - Sprint kickoff & technical alignment

| Nhóm | Công việc |
| --- | --- |
| PO/Tech Lead | Chốt phạm vi P0/P1/P2, xác nhận sprint goal |
| Backend | Review DB-02/DB-03/API-01/API-02/API-03 (API-02 là AUTH API, API-03 là HR API), chốt Auth token strategy |
| Frontend | Review FRONTEND-03/04, chốt session bootstrap contract |
| QA | Tạo test plan Sprint 2, xác định critical paths |
| DevOps | Kiểm tra dev/staging database, migration runner, secret env |

Deliverables cuối ngày:

```text
- Sprint board đầy đủ ticket.
- Auth token/session strategy được chốt.
- API contract `/auth/login`, `/auth/me`, `/hr/employees` được freeze bản đầu.
- Blocking issue từ Sprint 1 được đánh dấu rõ.
```

---

### Ngày 2 - Database migration AUTH/HR

| Nhóm | Công việc |
| --- | --- |
| Backend DB | Viết migration AUTH/RBAC |
| Backend DB | Viết migration HR Core |
| Backend DB | Viết seed modules/permissions/roles/HR master data |
| QA | Review migration checklist và seed expected data |
| DevOps | Chạy migration trên local/dev, chuẩn hóa rollback/dev reset |

Deliverables cuối ngày:

```text
- Migration AUTH/RBAC chạy được.
- Migration HR Core chạy được.
- Seed admin đăng nhập được hoặc tạo được bằng script.
- Seed role/permission idempotent.
```

---

### Ngày 3 - Backend AUTH Core

| Nhóm | Công việc |
| --- | --- |
| Backend | Implement password hash/verify |
| Backend | Implement login/logout/refresh hoặc session revoke |
| Backend | Implement `/api/v1/auth/me` |
| Backend | Implement login log/security event cơ bản |
| Frontend | Mock contract login/me nếu API chưa merge |
| QA | Viết API tests Auth Core |

Deliverables cuối ngày:

```text
- Login API trả token/session hợp lệ.
- `/auth/me` trả user/company/roles/permissions/scopes/employee mapping nếu có.
- Sai mật khẩu/locked/inactive có error chuẩn.
```

---

### Ngày 4 - Permission/data scope resolver

| Nhóm | Công việc |
| --- | --- |
| Backend | Implement permission guard/decorator/middleware |
| Backend | Implement data scope resolver Own/Team/Department/Company/System |
| Backend | Tích hợp guard vào HR read API skeleton |
| Frontend | Implement Permission utility, AuthProvider, ProtectedRoute |
| QA | Test permission matrix cơ bản |

Deliverables cuối ngày:

```text
- Backend có guard dùng lại cho module sau.
- Frontend có route guard và forbidden state.
- Không còn logic hard-code role cho route/action P0.
```

---

### Ngày 5 - Backend HR Read Core

| Nhóm | Công việc |
| --- | --- |
| Backend | Implement employee repository/query service |
| Backend | Implement `GET /hr/employees` |
| Backend | Implement `GET /hr/employees/{id}` |
| Backend | Implement `GET /hr/me/profile` |
| Backend | Implement lookup department/position/job level/contract type |
| Frontend | Start EmployeeList page integration |
| QA | API tests HR read + scope |

Deliverables cuối ngày:

```text
- HR employee list/detail chạy với data thật.
- Pagination/search/filter/sort cơ bản hoạt động.
- Employee thiếu quyền không thấy sensitive field.
```

---

### Ngày 6 - Backend HR Write Core

| Nhóm | Công việc |
| --- | --- |
| Backend | Implement employee code generation transaction |
| Backend | Implement `POST /hr/employees` |
| Backend | Implement `PATCH /hr/employees/{id}` |
| Backend | Implement status change + status history |
| Backend | Implement employee-user link/unlink |
| QA | API tests HR write |

Deliverables cuối ngày:

```text
- Tạo employee sinh mã tự động không trùng.
- Cập nhật employee có audit log.
- Đổi status tạo status history.
- Link user-employee tuân thủ unique active link.
```

---

### Ngày 7 - Frontend Auth + HR integration

| Nhóm | Công việc |
| --- | --- |
| Frontend | Login UI nối API thật |
| Frontend | Auth bootstrap + route guard hoàn chỉnh |
| Frontend | Employee list table nối API thật |
| Frontend | Employee detail nối API thật |
| Frontend | Employee create/edit form nối API thật |
| Backend | Fix API contract issues phát sinh |
| QA | Smoke test FE integration |

Deliverables cuối ngày:

```text
- User đăng nhập được từ UI.
- Vào HR Workspace theo quyền.
- Xem list/detail employee từ UI.
- Tạo/sửa employee từ UI.
```

---

### Ngày 8 - Permission, sensitive data & audit hardening

| Nhóm | Công việc |
| --- | --- |
| Backend | Kiểm tra field-level permission/masking |
| Backend | Bổ sung audit log cho AUTH/HR P0 |
| Frontend | Hiển thị masked/hidden sensitive state |
| QA | Permission negative tests, 403 tests, cross-company tests |
| DevOps | Kiểm tra migration/seed trên staging |

Deliverables cuối ngày:

```text
- Không lộ dữ liệu sensitive khi thiếu quyền.
- API 403/401/422 chuẩn.
- Audit log có cho thao tác quan trọng.
- Staging chạy migration/seed ổn định.
```

---

### Ngày 9 - QA regression & bug fixing

| Nhóm | Công việc |
| --- | --- |
| QA | Chạy full Sprint 2 regression |
| Backend | Fix bug P0/P1 |
| Frontend | Fix UI state, validation, error handling |
| Tech Lead | Review code quality, security, data scope |
| PO | Review flow nghiệp vụ HR cơ bản |

Deliverables cuối ngày:

```text
- Không còn blocker/critical bug.
- P0 acceptance criteria đạt.
- Bug P1 có owner và quyết định fix/defer.
```

---

### Ngày 10 - Sprint review, hardening & handoff

| Nhóm | Công việc |
| --- | --- |
| Team | Demo login, permission, HR employee list/detail/create/update |
| QA | Ký checklist regression Sprint 2 |
| DevOps | Snapshot staging, migration version verified |
| Tech Lead | Chốt technical debt và handoff Sprint 3 |
| PO | Chốt acceptance và scope carry-over |

Deliverables cuối ngày:

```text
- Sprint 2 review demo pass.
- Release note nội bộ Sprint 2.
- Known issues list.
- Backlog Sprint 3 đã nhận dependency từ AUTH/HR.
```

---

## 11. API cần triển khai trong Sprint 2

### 11.1 AUTH API P0

| Mã | Method | Endpoint | Mục đích | Priority |
| --- | --- | --- | --- | --- |
| AUTH-S2-API-001 | POST | `/api/v1/auth/login` | Đăng nhập | P0 |
| AUTH-S2-API-002 | POST | `/api/v1/auth/logout` | Đăng xuất/revoke session | P0 |
| AUTH-S2-API-003 | POST | `/api/v1/auth/refresh` | Refresh access token nếu dùng token endpoint | P0 (conditional) |

> **Ghi chú AUTH-S2-API-003 (`/auth/refresh`):** "P0 conditional on token strategy". Endpoint này phụ thuộc kết quả chốt S2-OQ-001 trong Ngày 1. Dưới mô hình session thuần HttpOnly-cookie, một endpoint refresh riêng có thể không áp dụng (session/cookie được làm mới phía server). Chỉ chốt cuối cùng (giữ là P0 thật sự hay loại bỏ) sau khi S2-OQ-001 được quyết định ở Ngày 1.
| AUTH-S2-API-004 | GET | `/api/v1/auth/me` | Current user context | P0 |
| AUTH-S2-API-005 | GET | `/api/v1/auth/me/permissions` | Quyền của user hiện tại nếu tách khỏi `/me` | P0/P1 |
| AUTH-S2-API-006 | POST | `/api/v1/auth/change-password` | Đổi mật khẩu | P1 |
| AUTH-S2-API-007 | POST | `/api/v1/auth/forgot-password` | Quên mật khẩu | P1 |
| AUTH-S2-API-008 | POST | `/api/v1/auth/reset-password` | Đặt lại mật khẩu | P1 |

### 11.2 AUTH Admin API P1

| Mã | Method | Endpoint | Mục đích | Priority |
| --- | --- | --- | --- | --- |
| AUTH-S2-API-101 | GET | `/api/v1/auth/users` | Danh sách user | P1 |
| AUTH-S2-API-102 | POST | `/api/v1/auth/users` | Tạo user | P1 |
| AUTH-S2-API-103 | GET | `/api/v1/auth/users/{user_id}` | Chi tiết user | P1 |
| AUTH-S2-API-104 | PATCH | `/api/v1/auth/users/{user_id}` | Cập nhật user | P1 |
| AUTH-S2-API-105 | POST | `/api/v1/auth/users/{user_id}/lock` | Khóa user | P1 |
| AUTH-S2-API-106 | POST | `/api/v1/auth/users/{user_id}/unlock` | Mở khóa user | P1 |
| AUTH-S2-API-107 | GET | `/api/v1/auth/roles` | Danh sách role | P1 |
| AUTH-S2-API-108 | GET | `/api/v1/auth/permissions` | Danh sách permission | P1 |

### 11.3 HR API P0

| Mã | Method | Endpoint | Mục đích | Permission |
| --- | --- | --- | --- | --- |
| HR-S2-API-001 | GET | `/api/v1/hr/employees` | Danh sách nhân viên | `HR.EMPLOYEE.VIEW` |
| HR-S2-API-002 | POST | `/api/v1/hr/employees` | Tạo nhân viên | `HR.EMPLOYEE.CREATE` |
| HR-S2-API-003 | GET | `/api/v1/hr/employees/{employee_id}` | Chi tiết nhân viên | `HR.EMPLOYEE.VIEW` |
| HR-S2-API-004 | PATCH | `/api/v1/hr/employees/{employee_id}` | Cập nhật nhân viên | `HR.EMPLOYEE.UPDATE` |
| HR-S2-API-005 | POST | `/api/v1/hr/employees/{employee_id}/change-status` | Đổi trạng thái | `HR.EMPLOYEE.CHANGE_STATUS` |
| HR-S2-API-006 | POST | `/api/v1/hr/employees/{employee_id}/link-user` | Liên kết employee-user | `HR.EMPLOYEE.UPDATE` |
| HR-S2-API-007 | DELETE | `/api/v1/hr/employees/{employee_id}/link-user` | Hủy liên kết employee-user | `HR.EMPLOYEE.UPDATE` |
| HR-S2-API-008 | GET | `/api/v1/hr/me/profile` | Hồ sơ của tôi | `HR.EMPLOYEE.VIEW` scope Own |
| HR-S2-API-009 | GET | `/api/v1/hr/employees/lookup` | Lookup employee | `HR.EMPLOYEE.VIEW` |
| HR-S2-API-010 | GET | `/api/v1/hr/departments/lookup` | Lookup department | `HR.DEPARTMENT.VIEW` |
| HR-S2-API-011 | GET | `/api/v1/hr/positions/lookup` | Lookup position | `HR.POSITION.VIEW` |
| HR-S2-API-012 | GET | `/api/v1/hr/job-levels/lookup` | Lookup job level | `HR.MASTER_DATA.MANAGE` hoặc `HR.EMPLOYEE.VIEW` tùy policy |
| HR-S2-API-013 | GET | `/api/v1/hr/contract-types/lookup` | Lookup contract type | `HR.MASTER_DATA.MANAGE` hoặc `HR.EMPLOYEE.VIEW` tùy policy |
| HR-S2-API-014 | GET | `/api/v1/hr/employee-code/preview` | Preview mã nhân viên tiếp theo | `HR.EMPLOYEE_CODE.PREVIEW` |

### 11.4 HR API P1

| Mã | Method | Endpoint | Mục đích |
| --- | --- | --- | --- |
| HR-S2-API-101 | GET | `/api/v1/hr/departments` | Danh sách phòng ban |
| HR-S2-API-102 | POST | `/api/v1/hr/departments` | Tạo phòng ban |
| HR-S2-API-103 | PATCH | `/api/v1/hr/departments/{department_id}` | Cập nhật phòng ban |
| HR-S2-API-104 | GET | `/api/v1/hr/positions` | Danh sách chức vụ |
| HR-S2-API-105 | POST | `/api/v1/hr/positions` | Tạo chức vụ |
| HR-S2-API-106 | PATCH | `/api/v1/hr/positions/{position_id}` | Cập nhật chức vụ |
| HR-S2-API-107 | GET | `/api/v1/hr/profile-change-requests` | Skeleton request sửa hồ sơ |

---

## 12. Database execution checklist

### 12.1 AUTH/RBAC tables

| Bảng | P0 | Checklist |
| --- | --- | --- |
| `users` | Có | UUID PK, company_id, normalized_email, password_hash, status, failed_login_count, locked_at, audit columns, soft delete |
| `roles` | Có | Global/company role, role_code, role_type, is_system_role, status |
| `permissions` | Có | module_code, permission_code, resource, action, is_sensitive |
| `user_roles` | Có | user_id, role_id, company_id, is_active, expired_at, unique active |
| `role_permissions` | Có | role_id, permission_id, data_scope, is_active |
| `user_sessions` | Có | refresh token hash/session id, revoked_at, expired_at |
| `password_reset_tokens` | Có | token hash, expired_at, used_at |
| `login_logs` | Có | user/email, success/fail, ip, user_agent, reason |
| `user_security_events` | Nên có | event_type, severity, payload |

### 12.2 HR Core tables

| Bảng | P0 | Checklist |
| --- | --- | --- |
| `departments` | Có | company_id, department_code, name, parent_id, manager_employee_id nullable, status, soft delete |
| `positions` | Có | company_id, position_code, name, department_id nullable, job_level_id nullable, status |
| `job_levels` | Có/Nên có | level_code, name, rank_order, status |
| `contract_types` | Có/Nên có | contract_type_code, name, requires_end_date, status |
| `employees` | Có | company_id, user_id nullable, employee_code, full_name, department_id, position_id, direct_manager_id, employment_status, joined_date |
| `employee_status_histories` | Có | employee_id, old_status, new_status, reason, changed_by, changed_at |
| `employee_code_configs` | Có | prefix/pattern/number_length/allow_manual_override/current config |
| `sequence_counters` | Dùng lại | counter_key, current_value, company_id, transaction-safe |

### 12.3 Migration order

```text
1. Ensure foundation tables exist.
2. Create AUTH tables.
3. Seed permissions and roles.
4. Create HR master tables without circular FK issue.
5. Create employees.
6. Add department manager FK if needed.
7. Create HR history/config tables.
8. Seed HR master data.
9. Create indexes.
10. Run verification script.
```

### 12.4 Required indexes

| Nhóm | Index |
| --- | --- |
| AUTH | unique `(company_id, normalized_email)` where deleted_at is null |
| AUTH | `(user_id, is_active, expired_at)` for user_roles |
| AUTH | `(role_id, permission_id)` for role_permissions |
| HR | unique `(company_id, employee_code)` where deleted_at is null |
| HR | `(company_id, employment_status)` |
| HR | `(company_id, department_id)` |
| HR | `(company_id, direct_manager_id)` |
| HR | `(company_id, joined_date)` |
| HR | full_name/code search index nếu dùng trigram |

---

## 13. Permission matrix MVP cho Sprint 2

| Permission | Employee | Manager | HR | Company Admin | Super Admin |
| --- | --- | --- | --- | --- | --- |
| `AUTH.ME.VIEW` | Own | Own | Own | Own | System |
| `AUTH.USER.VIEW` | - | - | Company nếu được cấp | Company | System |
| `AUTH.USER.CREATE` | - | - | - | Company | System |
| `AUTH.USER.LOCK` | - | - | - | Company | System |
| `AUTH.ROLE.VIEW` | - | - | - | Company | System |
| `AUTH.PERMISSION.VIEW` | - | - | - | Company | System |
| `HR.EMPLOYEE.VIEW` | Own | Team | Company | Company | System |
| `HR.EMPLOYEE.VIEW_SENSITIVE` | Own limited nếu policy cho phép | - | Company | Company | System |
| `HR.EMPLOYEE.CREATE` | - | - | Company | Company | System |
| `HR.EMPLOYEE.UPDATE` | - | - | Company | Company | System |
| `HR.EMPLOYEE.CHANGE_STATUS` | - | - | Company | Company | System |
| `HR.EMPLOYEE.DELETE` | - | - | - hoặc Company tùy policy | Company | System |
| `HR.EMPLOYEE.EXPORT` | - | - | Company | Company | System |
| `HR.DEPARTMENT.VIEW` | Company read basic | Team/Department | Company | Company | System |
| `HR.DEPARTMENT.CREATE` | - | - | Company | Company | System |
| `HR.POSITION.VIEW` | Company read basic | Company read basic | Company | Company | System |
| `HR.PROFILE_CHANGE_REQUEST.CREATE` | Own | Own | Own | Own | System |
| `HR.PROFILE_CHANGE_REQUEST.APPROVE` | - | - | Company | Company | System |

Ghi chú:

1. Role chỉ là seed mặc định, không hard-code theo role name trong code.
2. Nếu một user có nhiều role, permission cuối cùng là hợp nhất theo permission active.
3. Nếu cùng permission có nhiều scope, resolver lấy scope mạnh nhất theo thứ tự policy đã chốt.

> **Mô hình data scope chuẩn (canonical RBAC scope model cho toàn MVP):** Data scope (Own/Team/Department/Company/System) được phân giải qua cột `data_scope` trên bảng `role_permissions`, KHÔNG mã hóa scope vào tên permission. Nhất quán với BACKEND-03. Tất cả module — bao gồm ATT/LEAVE ở Sprint 3 và các module sau — BẮT BUỘC tuân theo một mô hình duy nhất này. Cột "Own/Team/Department/Company/System" trong bảng trên chỉ là giá trị `data_scope` được seed mặc định cho từng role-permission, không phải là biến thể tên permission.

---

## 14. Frontend route và screen scope

### 14.1 Route P0

| Route | Screen | Permission | Ghi chú |
| --- | --- | --- | --- |
| `/login` | Login | Public | Redirect về `/home` nếu đã login |
| `/home` | Home Portal shell | Authenticated | Có thể đơn giản ở Sprint 2 |
| `/hr/employees` | Employee List | `HR.EMPLOYEE.VIEW` | Filter theo scope |
| `/hr/employees/new` | Employee Create | `HR.EMPLOYEE.CREATE` | Form tạo nhân viên |
| `/hr/employees/:id` | Employee Detail | `HR.EMPLOYEE.VIEW` | Mask sensitive nếu thiếu quyền |
| `/hr/employees/:id/edit` | Employee Edit | `HR.EMPLOYEE.UPDATE` | Form cập nhật |
| `/hr/me/profile` | My Profile | `HR.EMPLOYEE.VIEW` scope Own | Read-only Sprint 2 |
| `/403` | Forbidden | - | Dùng cho route trái quyền |

### 14.2 Route P1

| Route | Screen | Permission |
| --- | --- | --- |
| `/system/users` | User List | `AUTH.USER.VIEW` |
| `/system/roles` | Role List | `AUTH.ROLE.VIEW` |
| `/hr/departments` | Department List | `HR.DEPARTMENT.VIEW` |
| `/hr/positions` | Position List | `HR.POSITION.VIEW` |

### 14.3 Component cần dùng

| Nghiệp vụ | Component |
| --- | --- |
| Login | `AuthLayout`, `Input`, `PasswordInput`, `Button`, `Alert`, `FormError` |
| Route guard | `FullPageLoadingState`, `ForbiddenState`, `DisabledModuleState` |
| Employee list | `ModuleWorkspaceLayout`, `PageHeader`, `FilterBar`, `DataTable`, `StatusBadge`, `Pagination` |
| Employee detail | `EmployeeProfileHeader`, `DetailSection`, `Tabs`, `Timeline`, `MaskedField` |
| Employee form | `Form`, `Select`, `DatePicker`, `Combobox`, `ConfirmDialog`, `Toast` |
| My profile | `DetailSection`, `MaskedField`, `EmptyState` |

---

## 15. Backend service design cần hoàn thành

### 15.1 Auth services

| Service | Trách nhiệm |
| --- | --- |
| `AuthService` | Login, logout, refresh, current user |
| `PasswordService` | Hash, verify, reset token hash |
| `SessionService` | Create/revoke/validate session hoặc refresh token |
| `PermissionService` | Load user roles, permissions, scopes |
| `AuthorizationService` | Check permission + scope + target resource |
| `DataScopeService` | Resolve Own/Team/Department/Company/System cho module HR |
| `LoginLogService` | Ghi login success/failure |
| `SecurityEventService` | Ghi event khóa user, reset password, revoke session |

### 15.2 HR services

| Service | Trách nhiệm |
| --- | --- |
| `EmployeeService` | Create/update/detail/status/link-user |
| `EmployeeQueryService` | List/search/filter/sort/scope query |
| `EmployeeCodeService` | Preview/generate employee code bằng sequence transaction |
| `DepartmentService` | Lookup/list cây phòng ban cơ bản |
| `PositionService` | Lookup/list chức vụ |
| `JobLevelService` | Lookup cấp bậc |
| `ContractTypeService` | Lookup loại hợp đồng |
| `SensitiveFieldPolicy` | Mask/omit sensitive fields |
| `EmployeeAuditService` | Ghi audit log cho HR actions |

---

## 16. Validation rule quan trọng

### 16.1 AUTH validation

| Rule | Kỳ vọng |
| --- | --- |
| Email login normalize lowercase | Không phân biệt hoa/thường |
| Password không lưu plain text | Chỉ lưu hash |
| User Locked/Inactive/Deleted | Không cho login |
| Failed login nhiều lần | Tăng counter, có thể lock nếu policy bật |
| Refresh token/session revoked | Không dùng lại được |
| Reset token | Lưu hash, có expired_at, used_at |

### 16.2 HR validation

| Rule | Kỳ vọng |
| --- | --- |
| `employee_code` unique theo company | Trùng thì conflict |
| Auto code transaction-safe | Tạo đồng thời không trùng |
| Department/position phải active cùng company | Không cho chọn dữ liệu khác company |
| Direct manager không là chính employee | Chặn self-manager |
| Direct manager chain không vòng lặp | Chặn recursive loop |
| Company email duplicate nếu cấu hình bật | Conflict |
| User link unique | Một user chỉ link một employee active |
| Đổi status sang Resigned/Terminated | Ghi history, optional lock user theo config |
| Field sensitive | Không trả nếu thiếu quyền |
| Soft delete | Không xóa cứng employee quan trọng |

---

## 17. Test plan Sprint 2

### 17.1 Auth API test cases

| Mã test | Tình huống | Kỳ vọng |
| --- | --- | --- |
| AUTH-S2-TC-001 | Login đúng email/password | 200, trả token/session, ghi login success |
| AUTH-S2-TC-002 | Login sai password | 401, ghi login failed |
| AUTH-S2-TC-003 | Login user Locked | 403 hoặc business error, không cấp token |
| AUTH-S2-TC-004 | Login user Inactive | Bị chặn |
| AUTH-S2-TC-005 | Logout | Session/token bị revoke, frontend clear cache |
| AUTH-S2-TC-006 | `/auth/me` với token hợp lệ | Trả user/company/employee/permissions/scopes |
| AUTH-S2-TC-007 | `/auth/me` không token | 401 |
| AUTH-S2-TC-008 | User thiếu permission gọi HR API | 403 |
| AUTH-S2-TC-009 | Role inactive | Permission không có hiệu lực |
| AUTH-S2-TC-010 | Permission inactive | User không nhận quyền |

### 17.2 HR API test cases

| Mã test | Tình huống | Kỳ vọng |
| --- | --- | --- |
| HR-S2-TC-001 | HR xem danh sách employee | 200, phân trang |
| HR-S2-TC-002 | Employee xem list với scope Own | Chỉ thấy bản thân hoặc bị giới hạn theo policy |
| HR-S2-TC-003 | Manager xem team | Chỉ thấy direct reports/team |
| HR-S2-TC-004 | HR xem Company | Thấy toàn company |
| HR-S2-TC-005 | User company A truy cập employee company B | 403/404, không lộ dữ liệu |
| HR-S2-TC-006 | Tạo employee hợp lệ | 201, sinh employee_code |
| HR-S2-TC-007 | Tạo employee trùng company_email | Conflict nếu unique bật |
| HR-S2-TC-008 | Tạo employee với department inactive | Validation error |
| HR-S2-TC-009 | Update employee | 200, audit log |
| HR-S2-TC-010 | Đổi status employee | 200, status history |
| HR-S2-TC-011 | Link user vào employee | 200, employees.user_id cập nhật |
| HR-S2-TC-012 | Link cùng user vào employee khác | Conflict |
| HR-S2-TC-013 | User thiếu `VIEW_SENSITIVE` xem detail | Field nhạy cảm masked/omitted |
| HR-S2-TC-014 | User có `VIEW_SENSITIVE` xem detail | Field nhạy cảm trả đầy đủ theo scope |
| HR-S2-TC-015 | Direct manager tự trỏ chính mình | Validation error |
| HR-S2-TC-016 | Direct manager tạo vòng lặp | Validation error |

### 17.3 Frontend smoke test cases

| Mã test | Flow | Kỳ vọng |
| --- | --- | --- |
| FE-S2-TC-001 | Login success | Redirect vào Home/HR, auth context loaded |
| FE-S2-TC-002 | Login fail | Hiển thị lỗi đúng, không redirect |
| FE-S2-TC-003 | Direct URL `/hr/employees` khi chưa login | Redirect login với returnUrl |
| FE-S2-TC-004 | User thiếu quyền vào HR route | Hiển thị 403 |
| FE-S2-TC-005 | HR mở employee list | Table load thành công |
| FE-S2-TC-006 | HR search/filter employee | Query params đúng, kết quả update |
| FE-S2-TC-007 | HR mở employee detail | Data hiển thị đúng, sensitive field theo quyền |
| FE-S2-TC-008 | HR tạo employee | Submit thành công, toast, redirect/detail hoặc list refresh |
| FE-S2-TC-009 | HR edit employee | Submit thành công, detail/list invalidate |
| FE-S2-TC-010 | Logout | Cache clear, quay về login |

---

## 18. Acceptance criteria Sprint 2

Sprint 2 được xem là hoàn thành khi đạt toàn bộ P0 sau:

### 18.1 Product acceptance

1. User Active có thể đăng nhập từ UI.
2. User Locked/Inactive không thể đăng nhập.
3. Sau đăng nhập, frontend load được user context và permission.
4. HR/Admin xem được danh sách nhân viên.
5. HR/Admin xem được chi tiết nhân viên.
6. HR/Admin tạo được nhân viên mới với mã nhân viên tự sinh.
7. HR/Admin cập nhật được thông tin nhân viên cơ bản.
8. HR/Admin đổi được trạng thái nhân viên.
9. HR/Admin liên kết được employee với user.
10. Employee xem được hồ sơ của chính mình.
11. User thiếu quyền bị chặn ở route frontend và API backend.
12. Dữ liệu nhạy cảm không bị lộ cho user thiếu quyền.

### 18.2 Technical acceptance

1. Migration AUTH/HR chạy được từ database trống sau foundation.
2. Seed idempotent, chạy lại không tạo trùng.
3. Password hash dùng thuật toán an toàn như bcrypt/argon2id.
4. Token/session có expired/revoke strategy rõ ràng.
5. Backend có permission guard và data scope resolver dùng lại được.
6. API response/error/pagination theo chuẩn API-01.
7. Audit log ghi thao tác quan trọng của AUTH/HR.
8. Frontend không hard-code theo role name.
9. Query cache được clear khi logout.
10. Unit/API tests P0 pass trong CI.
11. Staging deploy chạy được login và HR core flow.
12. Không còn blocker/critical bug.

---

## 19. Definition of Done cho ticket Sprint 2

Một ticket Sprint 2 chỉ được chuyển Done khi đáp ứng:

1. Code đã merge vào branch sprint/main theo quy trình.
2. Có migration/seed nếu thay đổi database.
3. Có unit test hoặc API test tối thiểu cho logic chính.
4. Có validation và error handling chuẩn.
5. Có permission/data scope check nếu là API protected.
6. Có audit log nếu thao tác nhạy cảm.
7. Có loading/empty/error/forbidden state nếu là UI.
8. Không hard-code role name.
9. Không log secret/token/password.
10. QA đã verify trên môi trường dev/staging.
11. Tài liệu API/README được cập nhật nếu contract thay đổi.

---

## 20. Rủi ro và hướng xử lý

| Rủi ro | Mức độ | Ảnh hưởng | Hướng xử lý |
| --- | --- | --- | --- |
| RBAC/data scope phức tạp vượt sprint | Cao | Chậm toàn bộ module sau | Chỉ làm Own/Team/Company/System P0, Department nâng cơ bản |
| Token strategy chưa chốt | Cao | Frontend/backend lệch contract | Chốt ngày 1: HttpOnly cookie hoặc bearer token memory |
| Seed permission thiếu | Cao | Route/API bị 403 sai | Permission catalog versioned seed, review bởi BE/QA |
| Employee code trùng khi tạo đồng thời | Cao | Lỗi dữ liệu HR | Dùng transaction + lock `sequence_counters` |
| Sensitive field bị lộ qua API | Cao | Rủi ro bảo mật | Backend mask/omit trước khi response, QA negative tests |
| Frontend hard-code role | Trung bình | Sai quyền khi role thay đổi | Code review bắt buộc dùng permission utility |
| Vòng lặp manager/department | Trung bình | Sai scope Team/Org | Validate recursive trước khi save |
| HR scope Team chưa rõ | Trung bình | Manager thấy sai dữ liệu | MVP dùng `direct_manager_id`; mở rộng team tree sau |
| Migration FK vòng departments/employees | Trung bình | Migration fail | Tạo departments trước, add FK manager sau |
| Scope Sprint 2 quá rộng | Cao | Không xong P0 | Department CRUD, password reset, user admin chuyển P1/P2 nếu cần |

---

## 21. Metrics theo dõi Sprint 2

| Metric | Mục tiêu |
| --- | --- |
| P0 completion | 100% |
| Critical/blocker bug cuối sprint | 0 |
| Auth API P0 pass rate | >= 95% |
| HR API P0 pass rate | >= 90% |
| Frontend smoke pass rate | >= 90% |
| Migration/seed staging success | 100% |
| Unauthorized access negative tests | 100% pass |
| Sensitive data leakage tests | 100% pass |
| CI pipeline pass before merge | 100% for protected branch |

---

## 22. Sprint review demo script

Demo Sprint 2 nên chạy theo thứ tự:

```text
1. Mở staging URL.
2. Login bằng HR/Admin user.
3. Xem auth context đang có permission HR.
4. Mở HR Workspace.
5. Xem danh sách nhân viên.
6. Search/filter nhân viên.
7. Mở chi tiết nhân viên.
8. Tạo nhân viên mới, hệ thống tự sinh mã.
9. Cập nhật thông tin nhân viên.
10. Đổi trạng thái nhân viên.
11. Liên kết nhân viên với user.
12. Logout.
13. Login bằng Employee user.
14. Vào My Profile.
15. Thử truy cập direct URL HR admin route và thấy 403.
16. Kiểm tra API thiếu quyền trả 403.
17. Kiểm tra sensitive field bị mask/ẩn.
```

---

## 23. Checklist bàn giao sang Sprint 3

Sprint 3 chỉ nên nhận dependency từ Sprint 2 khi các mục sau đã sẵn sàng:

| Dependency cho Sprint 3 | Trạng thái mong muốn |
| --- | --- |
| Auth middleware | Dùng được cho ATT/LEAVE API |
| Permission guard | Dùng được cho check-in, bảng công, đơn nghỉ |
| Data scope resolver | Own/Team/Company hoạt động |
| Employee mapping | `user -> employee` ổn định |
| Employee status | ATT/LEAVE kiểm tra được nhân viên Active/Official/Probation |
| Department/direct manager | Manager scope cho duyệt điều chỉnh công/nghỉ phép dùng được |
| HR lookup API | ATT/LEAVE form chọn nhân viên/phòng ban dùng được |
| Audit service | ATT/LEAVE ghi log dùng chung được |
| Sequence service | LEAVE request code/ATT request code có thể dùng lại |
| Frontend auth context | Attendance/Leave frontend dùng lại được |
| Protected route | Route ATT/LEAVE dùng chung được |
| API client/auth error handling | Module sau không tự viết lại |

---

## 24. Carry-over policy

Nếu cuối Sprint 2 chưa hoàn thành toàn bộ P1, xử lý như sau:

| Hạng mục chưa xong | Hành động |
| --- | --- |
| Forgot/reset password | Chuyển Sprint hardening nếu login P0 đã ổn |
| User admin CRUD | Chuyển Sprint Admin/System hoặc Sprint 5 |
| Department/position CRUD đầy đủ | Giữ lookup P0, CRUD chuyển Sprint 5 nếu cần |
| Contract/file HR | Chuyển Sprint 5 hoặc Post-MVP tùy ưu tiên |
| Profile change request full workflow | Chuyển Sprint Manager/HR workflow khi NOTI sẵn sàng |
| Org chart | Chuyển Sprint sau, không chặn ATT/LEAVE |

Không được carry-over các hạng mục sau nếu muốn Sprint 3 chạy mượt:

```text
- Login/logout/me P0
- Permission guard P0
- Data scope Own/Team/Company P0
- Employee list/detail P0
- User-employee mapping P0
- Employee status P0
- Department/direct_manager data P0
```

---

## 25. Open questions cần chốt trong ngày 1

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| S2-OQ-001 | MVP dùng HttpOnly cookie hay bearer token memory? | Tech Lead/BE/FE | Cao |
| S2-OQ-002 | `/auth/me` trả permissions inline hay tách `/me/permissions`? | BE/FE | Cao |
| S2-OQ-003 | Scope Team chỉ dùng direct reports hay gồm cây cấp dưới nhiều tầng? | PO/BE | Cao |
| S2-OQ-004 | Employee có được xem sensitive field của chính mình không? | PO/HR | Trung bình |
| S2-OQ-005 | Khi employee Resigned thì tự lock user hay chỉ cảnh báo? | PO/HR/BE | Trung bình |
| S2-OQ-006 | Có bắt buộc forgot/reset password trong Sprint 2 không? | PO | Trung bình |
| S2-OQ-007 | Department/position CRUD full có P0 không hay chỉ lookup? | PO/HR | Trung bình |
| S2-OQ-008 | Frontend Home Portal ở Sprint 2 làm full hay simple shell? | PO/FE | Thấp |

---

## 26. Capacity & Estimation

Sprint 2 hiện thực hóa các story của IMPLEMENTATION-02: AUTH **EPIC-02** (stories 013-024 = 87pt) + HR **EPIC-03** (stories 025-037 = 100pt) + tích hợp cross-module 098-099 (13pt). Tổng cộng = **200 story point**.

### 26.1 Thang story point

Sử dụng thang story point chuẩn của dự án, tham chiếu **IMPLEMENTATION-02 §3.5** (1 = sửa nhỏ; 2 = task nhỏ; 3 = story nhỏ 1 API hoặc 1 UI state; 5 = story vừa có API + UI + test; 8 = story lớn nhiều state/quyền/dependency; 13 = story rất lớn cần tách task kỹ thuật nội bộ). Story lớn hơn 13 point phải tách trước khi đưa vào sprint.

### 26.2 Giả định capacity

| Tham số | Giả định |
| --- | --- |
| Thời lượng sprint | 2 tuần (10 ngày làm việc) |
| Backend | 2-4 dev |
| Frontend | 2-4 dev |
| QA | 1-2 |
| DevOps | 1 |
| Velocity tham chiếu | ~40-80 point mỗi sprint 2 tuần |

### 26.3 Bảng story và story point

| Story ID | Epic | Mô tả ngắn | Priority | Point |
| --- | --- | --- | --- | ---: |
| IMP02-STORY-013 | EPIC-02 AUTH | Đăng nhập email/mật khẩu vào Home Portal | P0 | 8 |
| IMP02-STORY-014 | EPIC-02 AUTH | Đăng xuất, kết thúc phiên | P0 | 3 |
| IMP02-STORY-015 | EPIC-02 AUTH | Quên/đặt lại mật khẩu bằng token | P1 | 8 |
| IMP02-STORY-016 | EPIC-02 AUTH | Đổi mật khẩu khi đã đăng nhập | P1 | 5 |
| IMP02-STORY-017 | EPIC-02 AUTH | Xem hồ sơ tài khoản cá nhân | P0 | 3 |
| IMP02-STORY-018 | EPIC-02 AUTH | Quản lý danh sách user (search/filter/paginate) | P0 | 8 |
| IMP02-STORY-019 | EPIC-02 AUTH | Tạo/cập nhật user, liên kết employee | P0 | 8 |
| IMP02-STORY-020 | EPIC-02 AUTH | Khóa/mở khóa tài khoản | P0 | 5 |
| IMP02-STORY-021 | EPIC-02 AUTH | Quản lý role và gán permission kèm data scope | P0 | 13 |
| IMP02-STORY-022 | EPIC-02 AUTH | Middleware auth/permission/data scope guard dùng chung | P0 | 13 |
| IMP02-STORY-023 | EPIC-02 AUTH | Route/menu/action/field visibility theo permission | P0 | 8 |
| IMP02-STORY-024 | EPIC-02 AUTH | Xem login log và security event cơ bản | P1 | 5 |
| IMP02-STORY-025 | EPIC-03 HR | Xem danh sách nhân viên theo scope | P0 | 8 |
| IMP02-STORY-026 | EPIC-03 HR | Xem chi tiết hồ sơ nhân viên | P0 | 8 |
| IMP02-STORY-027 | EPIC-03 HR | Tạo nhân viên mới với mã tự sinh | P0 | 13 |
| IMP02-STORY-028 | EPIC-03 HR | Cập nhật hồ sơ và trạng thái nhân viên | P0 | 8 |
| IMP02-STORY-029 | EPIC-03 HR | Quản lý phòng ban dạng cây | P0 | 8 |
| IMP02-STORY-030 | EPIC-03 HR | Quản lý chức vụ, cấp bậc, loại hợp đồng | P1 | 8 |
| IMP02-STORY-031 | EPIC-03 HR | Quản lý hợp đồng lao động | P1 | 8 |
| IMP02-STORY-032 | EPIC-03 HR | Employee xem hồ sơ cá nhân của chính mình | P0 | 5 |
| IMP02-STORY-033 | EPIC-03 HR | Gửi yêu cầu cập nhật hồ sơ có kiểm duyệt | P0 | 8 |
| IMP02-STORY-034 | EPIC-03 HR | Duyệt/từ chối yêu cầu cập nhật hồ sơ | P0 | 8 |
| IMP02-STORY-035 | EPIC-03 HR | Cấu hình quy tắc sinh mã + preview | P1 | 8 |
| IMP02-STORY-036 | EPIC-03 HR | Upload/quản lý file hồ sơ nhân viên | P1 | 5 |
| IMP02-STORY-037 | EPIC-03 HR | Xem org chart cơ bản | P2 | 5 |
| IMP02-STORY-098 | EPIC-10 Integration | Tích hợp HR tạo employee với AUTH tạo user | P0 | 8 |
| IMP02-STORY-099 | EPIC-10 Integration | Tích hợp HR direct manager với approval scope | P0 | 5 |
| **Tổng** | | | | **200** |

Cộng theo epic: AUTH EPIC-02 = 87pt, HR EPIC-03 = 100pt, Integration 098-099 = 13pt.

### 26.4 CẢNH BÁO capacity (quan trọng)

**200 story point gấp khoảng 3-4 lần velocity của một sprint 2 tuần (~40-80pt).** Sprint 2 đang gộp ba khối lớn: AUTH (87pt) + HR Core (100pt) + integration (13pt) trong cùng một sprint 10 ngày — đây là rủi ro nghiêm trọng, gần như không thể hoàn thành toàn bộ P0 đúng hạn với capacity giả định.

BẮT BUỘC chọn **một** trong các phương án sau và chốt với **Product Owner + Tech Lead** trước khi khởi động:

1. **(a) Tách thành 2 sprint** — Sprint AUTH trước, sau đó Sprint HR Core.
2. **(b) Kéo dài Sprint 2 thành 3-4 tuần** thay vì 2 tuần.
3. **(c) Tăng số dev backend chạy song song** để nâng velocity tương ứng.

Nếu không chốt một trong ba phương án trên, phạm vi P0 của Sprint 2 phải được cắt giảm rõ ràng theo carry-over policy (§24) để tránh kéo dài vô hạn.

---

## 27. Kết luận

Sprint 2 là sprint bản lề của MVP.

Nếu Sprint 2 làm chắc, các sprint nghiệp vụ sau sẽ triển khai nhanh hơn vì đã có:

```text
User context ổn định
-> Permission/data scope dùng lại
-> Employee data trung tâm
-> User-employee mapping rõ
-> HR org structure cơ bản
-> Frontend protected route ổn
-> API client/auth error handling ổn
```

Ưu tiên cao nhất của Sprint 2 không phải là làm thật nhiều màn hình, mà là làm đúng nền tảng:

1. Đăng nhập an toàn.
2. Backend guard chắc.
3. Permission/data scope không hard-code.
4. Employee core data sạch.
5. Sensitive data không bị lộ.
6. Migration/seed chạy lặp lại được.
7. Sprint 3 có thể dùng lại AUTH/HR ngay.

Sau Sprint 2, bước tiếp theo đề xuất:

```text
IMPLEMENTATION-06: Sprint 3 Attendance & Leave Core Execution Plan.md
```
