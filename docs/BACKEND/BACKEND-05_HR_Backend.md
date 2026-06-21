# BACKEND-05: HR BACKEND
# TRIỂN KHAI BACKEND MODULE QUẢN LÝ NHÂN SỰ
# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **📚 Bộ tài liệu BACKEND — Hệ thống Quản lý Doanh nghiệp**
> [BACKEND-01 Kiến trúc/Setup](<BACKEND-01_Backend_Architecture_Project_Setup.md>) · [BACKEND-02 Migration/ORM/Seed](<BACKEND-02_Database_Migration_ORM_Seed_Implementation.md>) · [BACKEND-03 Auth/RBAC](<BACKEND-03_Auth_Session_RBAC_Permission_Guard.md>) · [BACKEND-04 Foundation](<BACKEND-04_Foundation_Backend.md>) · **BACKEND-05 HR** · [BACKEND-06 Attendance](<BACKEND-06_Attendance_Backend.md>) · [BACKEND-07 Leave](<BACKEND-07_Leave_Backend.md>) · [BACKEND-08 Task](<BACKEND-08_Task_Backend.md>) · [BACKEND-09 Notification](<BACKEND-09_Notification_Backend.md>) · [BACKEND-10 Dashboard](<BACKEND-10_Dashboard_Backend.md>) · [BACKEND-11 File/Audit/Settings/Jobs](<BACKEND-11_File_Audit_Settings_System_Jobs.md>) · [BACKEND-12 API Contract/OpenAPI](<BACKEND-12_API_Integration_Contract_OpenAPI_Swagger.md>) · [BACKEND-13 Testing/Security/Perf](<BACKEND-13_Backend_Testing_Security_Performance.md>) · [BACKEND-14 Release Readiness](<BACKEND-14_Backend_Release_Readiness.md>)
>
> **Nguồn & liên quan:** [Đặc tả: SPEC-03 HR](<../SPEC/SPEC-03 HR.md>) · [DB: DB-03 HR](<../DB/DB-03_HR Database Design.md>) · [API: API-03 HR](<../API Design/API-03_HR_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Frontend: FRONTEND-08](<../FRONTEND/FRONTEND-08_HR_Frontend.md>) · [Chỉ mục: README](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | BACKEND-05 |
| Tên tài liệu | HR Backend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | HR - Quản lý nhân sự |
| Giai đoạn | Backend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-10, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-14, BACKEND-01 -> BACKEND-04 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

BACKEND-05 mô tả cách triển khai backend cho module **HR - Quản lý nhân sự**.

Tài liệu này dùng để:

1. Chuyển SPEC-03, DB-03 và API-03 thành kế hoạch triển khai backend cụ thể.
2. Chốt cấu trúc module HR trong backend: controller, DTO, service, repository, guard, mapper, event và test.
3. Định nghĩa business flow backend cho employee, department, position, job level, contract, file, profile change request và employee code config.
4. Đảm bảo backend luôn kiểm tra authentication, permission, data scope, field-level permission và business rule.
5. Đảm bảo HR tích hợp đúng với AUTH, FOUNDATION, NOTI, DASH và các module phụ thuộc HR như ATT, LEAVE, TASK.
6. Làm checklist cho developer triển khai code, reviewer kiểm tra pull request và QA viết test case.

BACKEND-05 không thiết kế lại database hoặc API contract. Database đã được chốt trong DB-03, API đã được chốt trong API-03. Tài liệu này tập trung vào **cách tổ chức và triển khai backend module HR**.

---

## 3. Căn cứ triển khai

BACKEND-05 bám theo các quyết định đã chốt:

1. HR là nguồn dữ liệu nhân sự trung tâm của hệ thống.
2. Employee liên kết với AUTH qua `employees.user_id`, nhưng employee có thể tồn tại trước khi có user đăng nhập.
3. Backend là nguồn kiểm soát quyền cuối cùng, không dựa vào frontend.
4. Mọi query HR phải filter theo `company_id` từ auth context, trừ Super Admin scope System.
5. Dữ liệu nhạy cảm trong hồ sơ nhân viên phải kiểm tra field-level permission trước khi trả response.
6. Employee Self-Service không cập nhật trực tiếp bảng `employees`; phải tạo `profile_change_requests` và chỉ áp dụng sau khi HR/Admin duyệt.
7. Mã nhân viên mặc định sinh tự động theo `employee_code_configs` và `sequence_counters`.
8. Manual override mã nhân viên chỉ cho phép khi user có quyền và company config bật.
9. Không xóa cứng dữ liệu HR quan trọng; dùng soft delete.
10. Mutation quan trọng phải ghi audit log.
11. Các thay đổi quan trọng của HR phải phát notification event và/hoặc dashboard invalidation event khi cần.
12. File hồ sơ nhân viên mặc định là private, không trả storage path trực tiếp cho frontend.
13. API list phải hỗ trợ pagination, search, filter, sort theo whitelist.
14. Backend phải tránh N+1 query ở danh sách employee, org chart và lookup employee.

---

## 4. Vị trí BACKEND-05 trong roadmap backend

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

BACKEND-05 chỉ nên bắt đầu sau khi đã có tối thiểu:

1. Auth context middleware.
2. Permission guard.
3. Data scope resolver nền.
4. Response/error format chung.
5. Transaction manager.
6. Audit service.
7. Sequence service.
8. File service.
9. Notification event publisher hoặc event outbox stub.
10. Migration DB-03 đã chạy.

---

## 5. Phạm vi BACKEND-05

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Employee Core | Danh sách, chi tiết, tạo, cập nhật, đổi trạng thái, xóa mềm nhân viên |
| My Profile | Employee xem hồ sơ cá nhân của chính mình |
| Profile Change Request | Employee gửi yêu cầu cập nhật hồ sơ, HR/Admin duyệt/từ chối, employee hủy request pending |
| Department | CRUD phòng ban, cây phòng ban, chống vòng lặp, chặn xóa khi còn employee active |
| Position | CRUD chức vụ/vị trí, liên kết department/job level nếu cần |
| Job Level | CRUD cấp bậc nhân sự cơ bản |
| Contract Type | CRUD loại hợp đồng |
| Employee Contract | CRUD hợp đồng nhân viên, set primary contract, validate ngày hợp đồng |
| Employee File | Upload, link, list, download, delete soft file hồ sơ nhân viên |
| Employee User Link | Link/unlink employee với user AUTH |
| Employee Code | Preview mã nhân viên, cấu hình rule sinh mã, manual override nếu được phép |
| HR Audit | Query audit log theo employee/module/action |
| Export | Export danh sách nhân viên theo filter và permission |
| Lookup | API nhẹ cho dropdown chọn employee/manager/assignee |
| Org Chart | Sơ đồ tổ chức cơ bản theo department/direct manager |

### 5.2 Chưa bao gồm trong MVP

| Nhóm | Giai đoạn | Ghi chú |
| --- | --- | --- |
| Import Excel nhân viên | Phase sau | Cần import batch, preview, mapping, rollback |
| Onboarding workflow | Phase sau | Tách workflow service hoặc HR extension |
| Offboarding workflow | Phase sau | Có thể liên kết khóa account, thu hồi tài sản |
| Khen thưởng/kỷ luật | Phase sau | Module HR extension |
| Đánh giá hiệu suất | Phase sau | Module performance riêng |
| Bảo hiểm/thuế | Phase sau | Dữ liệu nhạy cảm cao, quyền riêng |
| E-sign hợp đồng | Phase sau | Tích hợp provider ký số |
| Sơ đồ tổ chức nâng cao | Phase sau | Versioning, drag/drop, history |
| Đồng bộ Google/Microsoft directory | Phase sau | Integration job riêng |

---

## 6. Kiến trúc module HR Backend

### 6.1 Module boundary

```text
HR Module
  -> hr.controllers
  -> hr.dto
  -> hr.services
  -> hr.repositories
  -> hr.mappers
  -> hr.guards
  -> hr.policies
  -> hr.events
  -> hr.jobs
  -> hr.tests
```

HR module được phép gọi:

1. AUTH service: kiểm tra user, link/unlink user, kiểm tra user cùng company, kiểm tra trạng thái user.
2. FOUNDATION audit service: ghi audit log.
3. FOUNDATION file service: upload/link/download/delete file.
4. FOUNDATION sequence service: sinh employee code.
5. FOUNDATION setting service: đọc config HR nếu cần.
6. NOTI event publisher: gửi event hồ sơ, hợp đồng, profile change request.
7. DASH cache invalidation publisher: invalidate widget HR nếu có.

HR module không được:

1. Tự xử lý password hoặc session của AUTH.
2. Tự lưu binary file trong bảng HR.
3. Bỏ qua permission/data scope vì frontend đã ẩn UI.
4. Trả dữ liệu nhạy cảm mặc định.
5. Xóa cứng employee, department, position, contract.
6. Tạo mã nhân viên bằng `MAX(code) + 1`.

### 6.2 Dependency flow

```text
HTTP request
  -> Global auth middleware
  -> Permission guard
  -> HR data scope guard/resolver
  -> Controller
  -> DTO validation
  -> Service transaction boundary
  -> Repository query/mutation
  -> Audit service
  -> Event publisher
  -> Mapper/field mask
  -> Response transformer
```

### 6.3 Rule tách trách nhiệm

| Layer | Trách nhiệm |
| --- | --- |
| Controller | Nhận request, gắn decorator permission, gọi service, không chứa business logic phức tạp |
| DTO | Validate shape, type, enum, format, required field |
| Guard/Policy | Kiểm tra authentication, permission, data scope, target ownership |
| Service | Điều phối business rule, transaction, audit, event |
| Repository | Query database, không chứa logic permission ngoài filter bắt buộc |
| Mapper | Convert entity -> response DTO, mask field nhạy cảm |
| Event Publisher | Publish domain event hoặc outbox event |
| Test | Unit, integration, permission, scope, regression |

---

## 7. Cấu trúc thư mục đề xuất

> Có thể điều chỉnh theo framework thực tế, nhưng boundary nên giữ ổn định.

```text
src/modules/hr/
  hr.module.ts

  controllers/
    employee.controller.ts
    my-profile.controller.ts
    profile-change-request.controller.ts
    department.controller.ts
    position.controller.ts
    job-level.controller.ts
    contract-type.controller.ts
    employee-contract.controller.ts
    employee-file.controller.ts
    employee-code.controller.ts
    org-chart.controller.ts
    hr-audit.controller.ts
    hr-export.controller.ts

  dto/
    employee/
      employee-list-query.dto.ts
      create-employee.dto.ts
      update-employee.dto.ts
      change-employee-status.dto.ts
      link-employee-user.dto.ts
      employee-response.dto.ts
      employee-detail-response.dto.ts
      employee-lookup-query.dto.ts
    my-profile/
      my-profile-response.dto.ts
      submit-profile-change.dto.ts
    profile-change-request/
      profile-change-request-query.dto.ts
      approve-profile-change-request.dto.ts
      reject-profile-change-request.dto.ts
    department/
      department-query.dto.ts
      create-department.dto.ts
      update-department.dto.ts
      department-tree-response.dto.ts
    position/
      create-position.dto.ts
      update-position.dto.ts
    job-level/
      create-job-level.dto.ts
      update-job-level.dto.ts
    contract-type/
      create-contract-type.dto.ts
      update-contract-type.dto.ts
    employee-contract/
      create-employee-contract.dto.ts
      update-employee-contract.dto.ts
    employee-file/
      upload-employee-file.dto.ts
      employee-file-query.dto.ts
    employee-code/
      update-employee-code-config.dto.ts
      preview-employee-code-query.dto.ts
    export/
      employee-export-query.dto.ts

  services/
    employee.service.ts
    employee-read.service.ts
    employee-write.service.ts
    employee-status.service.ts
    employee-user-link.service.ts
    employee-sensitive-field.service.ts
    my-profile.service.ts
    profile-change-request.service.ts
    department.service.ts
    organization-tree.service.ts
    position.service.ts
    job-level.service.ts
    contract-type.service.ts
    employee-contract.service.ts
    employee-file.service.ts
    employee-code.service.ts
    hr-audit.service.ts
    hr-export.service.ts
    org-chart.service.ts

  repositories/
    employee.repository.ts
    department.repository.ts
    position.repository.ts
    job-level.repository.ts
    contract-type.repository.ts
    employee-contract.repository.ts
    profile-change-request.repository.ts
    employee-code-config.repository.ts

  policies/
    hr-permission.policy.ts
    hr-data-scope.policy.ts
    employee-field-access.policy.ts
    profile-change-field.policy.ts
    department-policy.ts
    employee-code-policy.ts

  mappers/
    employee.mapper.ts
    department.mapper.ts
    position.mapper.ts
    contract.mapper.ts
    profile-change-request.mapper.ts

  events/
    hr-events.ts
    hr-event.publisher.ts
    hr-dashboard-invalidation.publisher.ts

  constants/
    hr-permissions.ts
    hr-errors.ts
    hr-field-groups.ts
    hr-event-names.ts
    hr-status.ts

  tests/
    unit/
    integration/
    e2e/
```

---

## 8. Permission và data scope

### 8.1 Permission bắt buộc

```text
HR.EMPLOYEE.VIEW
HR.EMPLOYEE.VIEW_SENSITIVE
HR.EMPLOYEE.CREATE
HR.EMPLOYEE.UPDATE
HR.EMPLOYEE.CHANGE_STATUS
HR.EMPLOYEE.DELETE
HR.EMPLOYEE.EXPORT
HR.EMPLOYEE.FILE_VIEW
HR.EMPLOYEE.FILE_UPLOAD
HR.EMPLOYEE.FILE_DELETE
HR.DEPARTMENT.VIEW
HR.DEPARTMENT.CREATE
HR.DEPARTMENT.UPDATE
HR.DEPARTMENT.DELETE
HR.POSITION.VIEW
HR.POSITION.CREATE
HR.POSITION.UPDATE
HR.POSITION.DELETE
HR.CONTRACT.VIEW
HR.CONTRACT.CREATE
HR.CONTRACT.UPDATE
HR.CONTRACT.DELETE
HR.AUDIT_LOG.VIEW
HR.ORG_CHART.VIEW
HR.MASTER_DATA.MANAGE
HR.PROFILE_CHANGE_REQUEST.VIEW
HR.PROFILE_CHANGE_REQUEST.CREATE
HR.PROFILE_CHANGE_REQUEST.APPROVE
HR.PROFILE_CHANGE_REQUEST.REJECT
HR.PROFILE_CHANGE_REQUEST.CANCEL
HR.EMPLOYEE_CODE.CONFIG_VIEW
HR.EMPLOYEE_CODE.CONFIG_UPDATE
HR.EMPLOYEE_CODE.PREVIEW
HR.EMPLOYEE_CODE.MANUAL_OVERRIDE
```

### 8.2 Data scope chuẩn

| Scope | Cách áp dụng trong HR |
| --- | --- |
| Own | Chỉ employee gắn với user hiện tại |
| Team | Employee có `direct_manager_id = current_employee.id` hoặc nằm trong team tree nếu bật cấu hình |
| Department | Employee thuộc department của user hoặc cây department được phân quyền |
| Company | Toàn bộ employee trong company hiện tại |
| System | Dữ liệu nhiều company, chỉ Super Admin/system-level |

### 8.3 HR data scope resolver

Backend cần một service dùng chung:

```text
HrDataScopeResolver.resolveReadableEmployeeFilter(authContext, requiredPermission)
HrDataScopeResolver.assertCanAccessEmployee(authContext, employeeId, requiredPermission)
HrDataScopeResolver.assertCanMutateEmployee(authContext, employeeId, requiredPermission)
HrDataScopeResolver.resolveDepartmentScope(authContext)
```

Pseudo filter:

```ts
interface HrEmployeeScopeFilter {
  companyId?: string;
  employeeIds?: string[];
  departmentIds?: string[];
  directManagerId?: string;
  allowSystemScope: boolean;
}
```

Quy tắc:

1. Nếu scope `System`: không bắt buộc `company_id`, nhưng vẫn phải kiểm tra role/permission system.
2. Nếu scope `Company`: filter `employees.company_id = auth.company_id`.
3. Nếu scope `Department`: filter theo danh sách department user được phép.
4. Nếu scope `Team`: filter theo direct reports hoặc team tree theo cấu hình.
5. Nếu scope `Own`: filter `employees.id = auth.employee_id`.
6. Nếu user có nhiều role/scope, resolver chọn scope mạnh nhất cho permission cụ thể.

### 8.4 Field-level permission

Các field nhạy cảm không được trả về mặc định:

```text
date_of_birth
identity_number
identity_issue_date
identity_issue_place
tax_code
bank_account_number
bank_name
personal_email
phone
current_address
permanent_address
emergency_contact_name
emergency_contact_phone
contract_salary nếu phase sau có
file hồ sơ nhạy cảm
```

> Địa chỉ dùng 2 cột riêng `current_address` và `permanent_address` (khớp DB-03/SPEC/API/FE). Mapper mask **cả hai**. Cột `address` gộp chỉ giữ legacy, không trả trong form/response mới.

Mapper phải kiểm tra:

```text
canViewSensitive = permissionService.can(auth, 'HR.EMPLOYEE.VIEW_SENSITIVE', targetEmployee)
```

Nếu thiếu quyền, có 2 chiến lược:

| Chiến lược | Khi dùng |
| --- | --- |
| Omit field | API list, lookup, export khi không include sensitive |
| Mask field | Detail screen cần giữ layout nhưng không lộ dữ liệu |

Ví dụ response detail:

```json
{
  "id": "employee-uuid",
  "employee_code": "EMP0001",
  "full_name": "Nguyễn Văn A",
  "phone": "********89",
  "identity_number": null,
  "sensitive_fields_masked": true
}
```

---

## 9. API endpoint implementation map

### 9.1 Employee API

| API | Controller | Service | Permission | Scope | Audit |
| --- | --- | --- | --- | --- | --- |
| `GET /api/v1/hr/employees` | EmployeeController.list | EmployeeReadService.list | `HR.EMPLOYEE.VIEW` | Own/Team/Department/Company/System | Không, trừ export/sensitive |
| `GET /api/v1/hr/employees/lookup` | EmployeeController.lookup | EmployeeReadService.lookup | `HR.EMPLOYEE.VIEW` | Team/Department/Company/System | Không |
| `GET /api/v1/hr/employees/{id}` | EmployeeController.detail | EmployeeReadService.detail | `HR.EMPLOYEE.VIEW` | Own/Team/Department/Company/System | Có nếu xem sensitive theo config |
| `POST /api/v1/hr/employees` | EmployeeController.create | EmployeeWriteService.create | `HR.EMPLOYEE.CREATE` | Company/System | Có |
| `PATCH /api/v1/hr/employees/{id}` | EmployeeController.update | EmployeeWriteService.update | `HR.EMPLOYEE.UPDATE` | Company/System hoặc scope được cấp | Có |
| `POST /api/v1/hr/employees/{id}/change-status` | EmployeeController.changeStatus | EmployeeStatusService.changeStatus | `HR.EMPLOYEE.CHANGE_STATUS` | Company/System | Có |
| `DELETE /api/v1/hr/employees/{id}` | EmployeeController.softDelete | EmployeeWriteService.softDelete | `HR.EMPLOYEE.DELETE` | Company/System | Có |
| `POST /api/v1/hr/employees/{id}/link-user` | EmployeeController.linkUser | EmployeeUserLinkService.link | `HR.EMPLOYEE.UPDATE` | Company/System | Có |
| `DELETE /api/v1/hr/employees/{id}/unlink-user` | EmployeeController.unlinkUser | EmployeeUserLinkService.unlink | `HR.EMPLOYEE.UPDATE` | Company/System | Có |

### 9.2 My Profile và Profile Change Request API

| API | Controller | Service | Permission | Scope | Audit/Event |
| --- | --- | --- | --- | --- | --- |
| `GET /api/v1/hr/me/profile` | MyProfileController.get | MyProfileService.get | `HR.EMPLOYEE.VIEW` | Own | Không |
| `POST /api/v1/hr/me/profile-change-requests` | MyProfileController.submitChange | ProfileChangeRequestService.submitByEmployee | `HR.PROFILE_CHANGE_REQUEST.CREATE` | Own | Audit + event |
| `GET /api/v1/hr/profile-change-requests` | ProfileChangeRequestController.list | ProfileChangeRequestService.list | `HR.PROFILE_CHANGE_REQUEST.VIEW` | Team/Department/Company/System | Không |
| `GET /api/v1/hr/profile-change-requests/{id}` | ProfileChangeRequestController.detail | ProfileChangeRequestService.detail | `HR.PROFILE_CHANGE_REQUEST.VIEW` | Own/Team/Department/Company/System | Không |
| `POST /api/v1/hr/profile-change-requests/{id}/approve` | ProfileChangeRequestController.approve | ProfileChangeRequestService.approve | `HR.PROFILE_CHANGE_REQUEST.APPROVE` | Company/System hoặc Team/Department nếu policy cho phép | Audit + event |
| `POST /api/v1/hr/profile-change-requests/{id}/reject` | ProfileChangeRequestController.reject | ProfileChangeRequestService.reject | `HR.PROFILE_CHANGE_REQUEST.REJECT` | Company/System hoặc Team/Department nếu policy cho phép | Audit + event |
| `POST /api/v1/hr/me/profile-change-requests/{id}/cancel` | MyProfileController.cancelChange | ProfileChangeRequestService.cancel | `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` | Own | Audit + event |

### 9.3 Organization master data API

| API group | Endpoint prefix | Permission view | Permission write | Scope |
| --- | --- | --- | --- | --- |
| Department | `/api/v1/hr/departments` | `HR.DEPARTMENT.VIEW` | `HR.DEPARTMENT.CREATE/UPDATE/DELETE` | Company/System |
| Position | `/api/v1/hr/positions` | `HR.POSITION.VIEW` | `HR.POSITION.CREATE/UPDATE/DELETE` | Company/System |
| Job Level | `/api/v1/hr/job-levels` | `HR.MASTER_DATA.MANAGE` hoặc view riêng | `HR.MASTER_DATA.MANAGE` | Company/System |
| Contract Type | `/api/v1/hr/contract-types` | `HR.CONTRACT.VIEW` | `HR.MASTER_DATA.MANAGE` | Company/System |
| Org Chart | `/api/v1/hr/org-chart` | `HR.ORG_CHART.VIEW` | Không | Own/Team/Department/Company/System |

### 9.4 Contract, file, audit, export API

| API group | Endpoint prefix | Service | Ghi chú |
| --- | --- | --- | --- |
| Employee Contract | `/api/v1/hr/employees/{employee_id}/contracts` | EmployeeContractService | Validate employee scope, contract date, primary contract |
| Employee File | `/api/v1/hr/employees/{employee_id}/files` | EmployeeFileService | Gọi Foundation FileService với permission `FOUNDATION.FILE.*` (UPLOAD/DOWNLOAD/DELETE/LINK/UNLINK), file private, audit access |
| Employee Code config | `GET/PATCH /api/v1/hr/employee-code-config` | EmployeeCodeService | Xem/cập nhật rule sinh mã |
| Employee Code preview | `POST /api/v1/hr/employee-code/preview` | EmployeeCodeService.preview | Preview mã tiếp theo (POST, không tăng counter) — `HR.EMPLOYEE_CODE.PREVIEW` |
| Employee Code lock/unlock | `POST /api/v1/hr/employee-code/lock` · `POST /api/v1/hr/employee-code/unlock` | EmployeeCodeService.lock/unlock | Khóa/mở khóa sửa mã thủ công — `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` |
| HR Audit | `/api/v1/hr/employees/{employee_id}/audit-logs` | HrAuditService | Query audit_logs theo target employee |
| Export | `/api/v1/hr/employees/export` | HrExportService | Sync với file nhỏ, async job phase sau |

---

## 10. Entity và repository cần triển khai

### 10.1 Entities

```text
DepartmentEntity
PositionEntity
JobLevelEntity
ContractTypeEntity
EmployeeEntity
EmployeeStatusHistoryEntity
EmployeeContractEntity
ProfileChangeRequestEntity
ProfileChangeRequestItemEntity
EmployeeCodeConfigEntity
```

Nếu dùng `file_links` generic từ Foundation thì không bắt buộc entity `EmployeeFileEntity`; nếu DB đã có `employee_files`, triển khai thêm `EmployeeFileEntity`.

### 10.2 Repository methods chính

#### EmployeeRepository

```ts
findList(params, scopeFilter): Paginated<EmployeeListProjection>
findByIdForRead(employeeId, scopeFilter): EmployeeDetailProjection | null
findByIdForUpdate(employeeId, tx): EmployeeEntity | null
existsByCode(companyId, employeeCode): boolean
existsByCompanyEmail(companyId, email, excludeEmployeeId?): boolean
existsByUserId(userId, excludeEmployeeId?): boolean
createEmployee(payload, tx): EmployeeEntity
updateEmployee(employeeId, patch, tx): EmployeeEntity
softDeleteEmployee(employeeId, actorUserId, tx): void
countActiveByDepartment(companyId, departmentId): number
countActiveByPosition(companyId, positionId): number
findDirectReports(companyId, managerEmployeeId): EmployeeEntity[]
```

#### DepartmentRepository

```ts
findList(companyId, query): Paginated<DepartmentEntity>
findTree(companyId): DepartmentTreeNode[]
findById(companyId, departmentId): DepartmentEntity | null
existsByCode(companyId, code, excludeId?): boolean
create(payload, tx): DepartmentEntity
update(departmentId, patch, tx): DepartmentEntity
softDelete(departmentId, actorUserId, tx): void
hasCycle(companyId, departmentId, parentId): boolean
```

#### ProfileChangeRequestRepository

```ts
createRequest(payload, items, tx): ProfileChangeRequestEntity
findList(params, scopeFilter): Paginated<ProfileChangeRequestProjection>
findById(requestId, scopeFilter): ProfileChangeRequestDetail | null
lockById(requestId, tx): ProfileChangeRequestEntity | null
updateStatus(requestId, statusPatch, tx): void
```

---

## 11. Business flow chi tiết

## 11.1 Tạo nhân viên mới

### Input chính

```json
{
  "full_name": "Nguyễn Văn A",
  "company_email": "a@company.com",
  "department_id": "department-uuid",
  "position_id": "position-uuid",
  "job_level_id": "job-level-uuid",
  "direct_manager_id": "manager-employee-uuid",
  "joined_date": "2026-06-20",
  "employment_status": "Probation",
  "employee_type": "Full-time",
  "employee_code": null,
  "create_user": false
}
```

### Backend steps

```text
1. Auth guard xác thực user.
2. Permission guard kiểm tra HR.EMPLOYEE.CREATE.
3. Data scope guard yêu cầu Company/System.
4. Validate DTO.
5. Bắt đầu transaction.
6. Resolve company_id từ auth context.
7. Validate department active cùng company.
8. Validate position active cùng company.
9. Validate job level nếu có.
10. Validate direct_manager_id nếu có:
    - manager tồn tại cùng company
    - manager đang active/probation/official theo policy
    - direct_manager_id không bằng employee mới
11. Validate company_email không trùng nếu có.
12. Resolve employee_code:
    - Nếu không truyền: gọi EmployeeCodeService.generateNextCode(tx)
    - Nếu truyền: kiểm tra HR.EMPLOYEE_CODE.MANUAL_OVERRIDE + allow_manual_override
13. Insert employees.
14. Insert employee_status_histories bản ghi đầu tiên.
15. Nếu create_user = true:
    - gọi AuthUserService.createUserForEmployee hoặc tạo pending user theo policy
    - update employees.user_id
16. Nếu tạo hợp đồng ban đầu: insert employee_contracts.
17. Ghi audit log HR_EMPLOYEE_CREATED.
18. Publish event HR_EMPLOYEE_CREATED.
19. Invalidate dashboard HR widgets nếu có.
20. Commit transaction.
21. Trả employee detail đã mask theo quyền người tạo.
```

### Validation quan trọng

| Rule | Lỗi |
| --- | --- |
| Thiếu `full_name` | `VALIDATION-ERR-001` |
| Department inactive | `HR-ERR-DEPARTMENT-INACTIVE` |
| Position inactive | `HR-ERR-POSITION-INACTIVE` |
| Email công ty trùng | `HR-ERR-EMPLOYEE-EMAIL-DUPLICATED` |
| Employee code trùng | `HR-ERR-EMPLOYEE-CODE-DUPLICATED` |
| Config sinh mã lỗi | `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID` |
| Manual override thiếu quyền | `AUTH-ERR-403` |

### Transaction boundary

Tạo employee phải nằm trong một transaction vì có thể tác động:

1. `sequence_counters`.
2. `employees`.
3. `employee_status_histories`.
4. `employee_contracts`.
5. `users` hoặc link user nếu tạo kèm.
6. `audit_logs`.
7. outbox event.

---

## 11.2 Cập nhật hồ sơ nhân viên bởi HR/Admin

### Backend steps

```text
1. Auth + permission HR.EMPLOYEE.UPDATE.
2. Resolve target employee theo data scope.
3. Load employee hiện tại.
4. Validate patch DTO.
5. Nếu cập nhật department/position/job_level/direct_manager:
   - validate entity active cùng company.
6. Nếu cập nhật direct_manager_id:
   - không được bằng chính employee.
   - không tạo vòng lặp quản lý nếu bật manager tree validation.
7. Nếu cập nhật email/identity/tax_code theo config unique:
   - kiểm tra duplicate.
8. Nếu patch có field nhạy cảm:
   - yêu cầu HR.EMPLOYEE.VIEW_SENSITIVE hoặc permission riêng theo policy.
9. Tính diff old/new.
10. Nếu không có thay đổi: trả success hoặc business error tùy policy.
11. Update employees.
12. Nếu employment_status thay đổi, chuyển sang flow change status.
13. Ghi audit log với diff đã mask.
14. Publish HR_EMPLOYEE_UPDATED.
15. Invalidate dashboard/cache liên quan.
16. Return employee detail.
```

### Lưu ý

1. Không cho cập nhật `company_id` qua API thường.
2. Không cho cập nhật `employee_code` nếu `is_employee_code_locked = true`, trừ manual override đúng quyền/config.
3. Không cho cập nhật `user_id` trực tiếp qua endpoint update employee; phải dùng link/unlink user endpoint.
4. Không ghi audit raw value của identity/bank/tax nếu audit mask chưa sẵn sàng.

---

## 11.3 Đổi trạng thái nhân viên

### Status đề xuất

```text
Onboarding
Probation
Official
Temporarily Suspended
Resigned
Terminated
```

### Backend steps

```text
1. Permission HR.EMPLOYEE.CHANGE_STATUS.
2. Resolve target employee scope.
3. Validate transition hợp lệ.
4. Lock employee row trong transaction.
5. Update employees.employment_status.
6. Nếu status là Resigned/Terminated:
   - set resigned_date nếu request có hoặc theo ngày hiện tại.
   - tùy policy: gọi AUTH để lock user hoặc để HR chọn.
7. Insert employee_status_histories.
8. Ghi audit HR_EMPLOYEE_STATUS_CHANGED.
9. Publish HR_EMPLOYEE_STATUS_CHANGED.
10. Invalidate HR dashboard.
```

### Transition policy cơ bản

| From | To hợp lệ |
| --- | --- |
| Onboarding | Probation, Official, Terminated |
| Probation | Official, Resigned, Terminated, Temporarily Suspended |
| Official | Temporarily Suspended, Resigned, Terminated |
| Temporarily Suspended | Probation, Official, Resigned, Terminated |
| Resigned | Không cho đổi lại trong MVP, trừ quyền system đặc biệt |
| Terminated | Không cho đổi lại trong MVP, trừ quyền system đặc biệt |

---

## 11.4 Xóa mềm nhân viên

Xóa mềm employee chỉ dùng khi cần loại khỏi danh sách vận hành, không xóa lịch sử.

### Backend steps

```text
1. Permission HR.EMPLOYEE.DELETE.
2. Scope Company/System.
3. Load employee.
4. Chặn xóa chính mình nếu là user đang đăng nhập.
5. Kiểm tra ràng buộc nghiệp vụ:
   - employee có attendance/leave/task/contract không?
   - nếu có, vẫn chỉ soft delete nhưng cần policy rõ.
6. Set deleted_at, deleted_by.
7. Ghi audit HR_EMPLOYEE_DELETED.
8. Publish HR_EMPLOYEE_DELETED.
```

Khuyến nghị MVP: thay vì dùng DELETE để xử lý nghỉ việc, nên dùng **change status Resigned/Terminated**. DELETE chỉ dùng cho hồ sơ tạo nhầm hoặc dữ liệu không còn hợp lệ.

---

## 11.5 Link/unlink employee với user AUTH

### Link user

```text
1. Permission HR.EMPLOYEE.UPDATE.
2. Scope Company/System.
3. Validate employee cùng company.
4. Validate user cùng company.
5. User chưa link với employee active khác.
6. Employee chưa có user_id hoặc cho phép replace theo policy.
7. Update employees.user_id.
8. Ghi audit HR_EMPLOYEE_USER_LINKED.
9. Publish HR_EMPLOYEE_USER_LINKED nếu cần.
```

### Unlink user

```text
1. Permission HR.EMPLOYEE.UPDATE.
2. Scope Company/System.
3. Validate employee đang có user_id.
4. Nếu user hiện tại là chính actor, chặn trừ Super Admin.
5. Set employees.user_id = null.
6. Không tự xóa user AUTH.
7. Ghi audit HR_EMPLOYEE_USER_UNLINKED.
```

---

## 11.6 Employee Self-Service: gửi yêu cầu cập nhật hồ sơ

### Editable fields MVP đề xuất

```text
personal_email
phone
current_address
permanent_address
emergency_contact_name
emergency_contact_phone
avatar_file_id
```

Các field không cho employee tự request trong MVP:

```text
employee_code
company_email
department_id
position_id
job_level_id
direct_manager_id
joined_date
official_date
employment_status
identity_number
bank_account_number
tax_code
```

### Backend steps submit

```text
1. Auth user.
2. Resolve current employee từ auth context.
3. Permission HR.PROFILE_CHANGE_REQUEST.CREATE scope Own.
4. Validate employee status cho phép gửi request.
5. Validate fields nằm trong whitelist editable.
6. Load current employee data.
7. So sánh old_value/new_value.
8. Nếu không có thay đổi: trả HR-ERR-PROFILE-CHANGE-NO-DIFF.
9. Kiểm tra request Pending trùng field nếu policy không cho pending song song.
10. Bắt đầu transaction.
11. Insert profile_change_requests status Pending.
12. Insert profile_change_request_items cho từng field.
13. Ghi audit HR_PROFILE_CHANGE_SUBMITTED.
14. Publish event HR_PROFILE_CHANGE_SUBMITTED đến HR/Admin hoặc manager nếu policy.
15. Commit.
16. Return request detail.
```

### Request item format

```json
{
  "field_name": "phone",
  "old_value": "0900000000",
  "new_value": "0911111111",
  "value_type": "String"
}
```

> Quy ước field (cố ý, không phải lệch): request body **ghi** dùng mảng `changes[]` (mỗi phần tử chỉ `field_name` + `new_value`); response/DTO **đọc** dùng mảng `items[]` (gồm thêm `old_value`, `status`, `is_sensitive`). Service map `changes[]` → bảng `profile_change_request_items` → `items[]` khi đọc.

---

## 11.7 HR/Admin duyệt yêu cầu cập nhật hồ sơ

> **MVP all-or-nothing:** duyệt áp dụng **toàn bộ** item của request, hoặc reject toàn bộ. Không hỗ trợ duyệt một phần — bỏ `approved_item_ids` và bỏ trạng thái `PartiallyApproved`.
> **Self-approval guard (reviewer ≠ submitter):** reviewer (`reviewed_by`) phải khác người gửi request (`submitted_by`/employee chủ request). Chặn ngay cả khi reviewer là HR/Admin nhưng đồng thời là chủ request, trả `HR-ERR-PROFILE-CHANGE-SELF-APPROVAL` (403).

### Backend steps approve

```text
1. Permission HR.PROFILE_CHANGE_REQUEST.APPROVE.
2. Resolve request theo data scope.
3. Self-approval guard: reviewer (current user) phải KHÁC submitter/employee chủ request.
   Nếu trùng → HR-ERR-PROFILE-CHANGE-SELF-APPROVAL (403).
4. Lock profile_change_requests row FOR UPDATE.
5. Nếu status != Pending:
   - trả idempotent success nếu đã Approved và policy cho phép.
   - hoặc business error HR-ERR-PROFILE-CHANGE-NOT-PENDING.
6. Load employee target FOR UPDATE.
7. Re-validate TẤT CẢ field vẫn nằm trong allowed apply list (all-or-nothing; nếu có field không hợp lệ → reject toàn bộ).
8. Re-validate unique constraint nếu field là email/phone theo config.
9. Apply new_value của toàn bộ item vào employees.
10. Update request status Approved, reviewed_by, reviewed_at, review_note.
11. Ghi audit HR_PROFILE_CHANGE_APPROVED với diff.
12. Publish event HR_PROFILE_CHANGE_APPROVED cho employee.
13. Invalidate HR dashboard/profile cache.
14. Commit.
```

### Backend steps reject

```text
1. Permission HR.PROFILE_CHANGE_REQUEST.REJECT.
2. Resolve request theo data scope.
3. Lock request.
4. Validate status Pending.
5. Update status Rejected, reviewed_by, reviewed_at, reject_reason.
6. Không update employees.
7. Ghi audit HR_PROFILE_CHANGE_REJECTED.
8. Publish event HR_PROFILE_CHANGE_REJECTED cho employee.
9. Commit.
```

### Employee cancel

```text
1. Permission HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN.
2. Scope Own (endpoint POST /api/v1/hr/me/profile-change-requests/{id}/cancel).
3. Request phải thuộc employee hiện tại.
4. Chỉ cho cancel status Pending.
5. Update status Cancelled.
6. Ghi audit + event nếu cần.
```

---

## 11.8 Department CRUD và cây phòng ban

### Tạo department

Business validation:

1. `department_code` unique trong company.
2. `parent_id` nếu có phải tồn tại cùng company, active.
3. Không cho `parent_id = id`.
4. Không tạo vòng lặp cây phòng ban.
5. `manager_employee_id` nếu có phải là employee active cùng company.

### Cập nhật department

Business validation:

1. Không đổi parent gây cycle.
2. Không inactive department nếu còn employee active, trừ policy cho phép.
3. Không xóa mềm department nếu còn employee active hoặc department con active.

### Tree query

Repository nên load một lần danh sách department active theo company rồi build tree trong service để tránh N+1.

```text
SELECT * FROM departments
WHERE company_id = :company_id
  AND deleted_at IS NULL
ORDER BY sort_order, name;
```

---

## 11.9 Position, Job Level, Contract Type

### Position

Validation:

1. `position_code` unique trong company.
2. `department_id` nullable, nếu có phải cùng company.
3. `job_level_id` nullable, nếu có phải cùng company.
4. Không xóa mềm position đang có employee active.

### Job Level

Validation:

1. `level_code` unique trong company.
2. `rank_order` dùng để sắp xếp.
3. Không xóa mềm job level đang có employee active nếu không có replacement.

### Contract Type

Validation:

1. `contract_type_code` unique trong company.
2. Nếu `requires_end_date = true`, khi tạo employee contract bắt buộc có `end_date`.
3. Không xóa mềm contract type đang được employee_contracts sử dụng.

---

## 11.10 Employee Contract

### Tạo hợp đồng

Business validation:

1. Employee target nằm trong data scope.
2. Contract type active cùng company.
3. `start_date` bắt buộc.
4. Nếu có `end_date`, `end_date >= start_date`.
5. Nếu contract type `requires_end_date = true`, `end_date` bắt buộc.
6. Nếu `is_primary = true`, unset primary contract khác của employee trong cùng transaction.
7. File hợp đồng nếu có phải đi qua FileService và link đúng entity.

### Cập nhật hợp đồng

1. Không sửa contract đã expired/terminated nếu policy không cho.
2. Nếu đổi primary, unset primary khác.
3. Ghi audit diff.
4. Publish event `HR_CONTRACT_UPDATED` nếu cần.

### Cảnh báo hợp đồng sắp hết hạn

Trong MVP có thể chưa triển khai job riêng, nhưng backend nên chừa service:

```text
EmployeeContractAlertService.findContractsExpiringSoon(companyId, days)
```

DASH/NOTI phase sau có thể dùng.

---

## 11.11 Employee File

### Upload/link file

```text
1. Permission HR.EMPLOYEE.FILE_UPLOAD.
2. Resolve employee scope.
3. Validate file size/MIME qua FileService.
4. Upload file private.
5. Link file với entity:
   - entity_type = Employee hoặc EmployeeContract
   - entity_id = employee_id hoặc contract_id
   - module_code = HR
6. Ghi audit HR_EMPLOYEE_FILE_UPLOADED.
7. Return file metadata, không trả storage_path.
```

### Download file

```text
1. Permission HR.EMPLOYEE.FILE_VIEW.
2. Resolve employee/file scope.
3. File phải cùng company.
4. Ghi file_access_logs nếu file sensitive.
5. FileService cấp signed URL hoặc stream file.
6. Return download_url ngắn hạn hoặc stream response.
```

### Delete file

```text
1. Permission HR.EMPLOYEE.FILE_DELETE.
2. Resolve scope.
3. Soft delete file link hoặc employee_files.
4. Không xóa binary nếu file còn link entity khác.
5. Ghi audit HR_EMPLOYEE_FILE_DELETED.
```

---

## 11.12 Employee Code Service

### Cấu hình mẫu

```json
{
  "prefix": "EMP",
  "padding_length": 4,
  "pattern": "{PREFIX}{NUMBER}",
  "reset_rule": "Never",
  "allow_manual_override": false,
  "lock_after_created": true
}
```

> Tên cột khớp DB-03 `employee_code_configs`: `padding_length`, `lock_after_created`, `allow_manual_override`. Không dùng `number_length` / `is_locked_after_create`. `reset_rule` ánh xạ cột DB `reset_policy` với enum CHECK `Never/Yearly/Monthly/Daily` (không có `Department`).

### Preview code (`POST /api/v1/hr/employee-code/preview`)

```text
1. Permission HR.EMPLOYEE_CODE.PREVIEW hoặc HR.EMPLOYEE.CREATE.
2. Load active employee_code_config.
3. Gọi SequenceService.preview không tăng counter.
4. Format code theo pattern.
5. Return preview.
```

### Lock / Unlock employee code (`POST /api/v1/hr/employee-code/lock` · `/unlock`)

```text
1. Permission HR.EMPLOYEE_CODE.MANUAL_OVERRIDE.
2. lock: set employees.is_employee_code_locked = true (hoặc khóa override theo config).
3. unlock: set employees.is_employee_code_locked = false khi allow_manual_override = true.
4. Ghi audit HR_EMPLOYEE_CODE_LOCKED / HR_EMPLOYEE_CODE_UNLOCKED.
```

### Generate code

```text
1. Chạy trong transaction tạo employee.
2. Lock sequence_counters row FOR UPDATE.
3. Tăng current_value.
4. Format code.
5. Kiểm tra unique lần cuối.
6. Return employee_code.
```

### Không được làm

```text
SELECT MAX(employee_code) FROM employees
```

Vì cách này race condition khi nhiều HR tạo employee cùng lúc.

---

## 12. Validation và error code

### 12.1 Error code đề xuất

| Code | HTTP | Ý nghĩa |
| --- | --- | --- |
| `HR-ERR-EMPLOYEE-NOT-FOUND` | 404 | Không tìm thấy employee hoặc ngoài scope |
| `HR-ERR-EMPLOYEE-CODE-DUPLICATED` | 409 | Mã nhân viên trùng |
| `HR-ERR-EMPLOYEE-EMAIL-DUPLICATED` | 409 | Email công ty trùng |
| `HR-ERR-EMPLOYEE-USER-ALREADY-LINKED` | 409 | User đã link với employee khác |
| `HR-ERR-EMPLOYEE-INVALID-STATUS` | 422 | Trạng thái nhân viên không hợp lệ |
| `HR-ERR-EMPLOYEE-STATUS-TRANSITION` | 422 | Chuyển trạng thái không hợp lệ |
| `HR-ERR-DEPARTMENT-NOT-FOUND` | 404 | Không tìm thấy phòng ban |
| `HR-ERR-DEPARTMENT-CODE-DUPLICATED` | 409 | Mã phòng ban trùng |
| `HR-ERR-DEPARTMENT-HAS-ACTIVE-EMPLOYEES` | 422 | Không thể xóa phòng ban còn employee active |
| `HR-ERR-DEPARTMENT-CYCLE` | 422 | Cây phòng ban bị vòng lặp |
| `HR-ERR-POSITION-CODE-DUPLICATED` | 409 | Mã chức vụ trùng |
| `HR-ERR-POSITION-HAS-ACTIVE-EMPLOYEES` | 422 | Không thể xóa chức vụ còn employee active |
| `HR-ERR-CONTRACT-DATE-INVALID` | 422 | Ngày hợp đồng không hợp lệ |
| `HR-ERR-PROFILE-CHANGE-NO-DIFF` | 422 | Không có thay đổi |
| `HR-ERR-PROFILE-CHANGE-FIELD-NOT-ALLOWED` | 422 | Field không được tự cập nhật |
| `HR-ERR-PROFILE-CHANGE-NOT-PENDING` | 409 | Request không ở trạng thái Pending |
| `HR-ERR-PROFILE-CHANGE-SELF-APPROVAL` | 403 | Reviewer trùng người gửi request (self-approval bị chặn) |
| `HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID` | 422 | Cấu hình mã nhân viên lỗi |
| `HR-ERR-EMPLOYEE-CODE-MANUAL-OVERRIDE-DISABLED` | 403 | Không được sửa mã thủ công |
| `HR-ERR-FILE-NOT-FOUND` | 404 | Không tìm thấy file hoặc ngoài scope |

### 12.2 Response error format

Tất cả lỗi phải đi qua exception filter chung:

```json
{
  "success": false,
  "message": "Mã nhân viên đã tồn tại",
  "error": {
    "code": "HR-ERR-EMPLOYEE-CODE-DUPLICATED",
    "type": "ConflictError",
    "details": null
  },
  "meta": {
    "request_id": "req_20260620_000001",
    "timestamp": "2026-06-20T10:00:00+07:00"
  }
}
```

---

## 13. Audit log strategy

### 13.1 Audit actions

```text
HR_EMPLOYEE_CREATED
HR_EMPLOYEE_UPDATED
HR_EMPLOYEE_STATUS_CHANGED
HR_EMPLOYEE_DELETED
HR_EMPLOYEE_USER_LINKED
HR_EMPLOYEE_USER_UNLINKED
HR_DEPARTMENT_CREATED
HR_DEPARTMENT_UPDATED
HR_DEPARTMENT_DELETED
HR_POSITION_CREATED
HR_POSITION_UPDATED
HR_POSITION_DELETED
HR_JOB_LEVEL_CREATED
HR_JOB_LEVEL_UPDATED
HR_JOB_LEVEL_DELETED
HR_CONTRACT_TYPE_CREATED
HR_CONTRACT_TYPE_UPDATED
HR_CONTRACT_TYPE_DELETED
HR_EMPLOYEE_CONTRACT_CREATED
HR_EMPLOYEE_CONTRACT_UPDATED
HR_EMPLOYEE_CONTRACT_DELETED
HR_EMPLOYEE_FILE_UPLOADED
HR_EMPLOYEE_FILE_DOWNLOADED
HR_EMPLOYEE_FILE_DELETED
HR_PROFILE_CHANGE_SUBMITTED
HR_PROFILE_CHANGE_APPROVED
HR_PROFILE_CHANGE_REJECTED
HR_PROFILE_CHANGE_CANCELLED
HR_EMPLOYEE_CODE_CONFIG_UPDATED
HR_EMPLOYEE_CODE_MANUAL_OVERRIDDEN
HR_EMPLOYEE_EXPORTED
```

### 13.2 Audit payload

```json
{
  "module_code": "HR",
  "action": "HR_EMPLOYEE_UPDATED",
  "target_type": "Employee",
  "target_id": "employee-uuid",
  "actor_user_id": "user-uuid",
  "company_id": "company-uuid",
  "request_id": "req_20260620_000001",
  "old_values": {
    "position_id": "old-position"
  },
  "new_values": {
    "position_id": "new-position"
  },
  "metadata": {
    "source": "web",
    "ip": "127.0.0.1"
  }
}
```

### 13.3 Mask audit diff

Không ghi raw value cho:

```text
identity_number
bank_account_number
tax_code
current_address
permanent_address
phone nếu policy yêu cầu
personal_email nếu policy yêu cầu
```

Ví dụ:

```json
{
  "identity_number": {
    "old": "***MASKED***",
    "new": "***MASKED***"
  }
}
```

---

## 14. Notification và dashboard event

### 14.1 HR domain events

```text
HR_EMPLOYEE_CREATED
HR_EMPLOYEE_UPDATED
HR_EMPLOYEE_STATUS_CHANGED
HR_EMPLOYEE_USER_LINKED
HR_CONTRACT_CREATED
HR_CONTRACT_UPDATED
HR_CONTRACT_EXPIRING_SOON
HR_PROFILE_CHANGE_SUBMITTED
HR_PROFILE_CHANGE_APPROVED
HR_PROFILE_CHANGE_REJECTED
HR_PROFILE_CHANGE_CANCELLED
```

### 14.2 Event payload chuẩn

```json
{
  "event_name": "HR_PROFILE_CHANGE_SUBMITTED",
  "company_id": "company-uuid",
  "actor_user_id": "user-uuid",
  "target_type": "ProfileChangeRequest",
  "target_id": "request-uuid",
  "employee_id": "employee-uuid",
  "department_id": "department-uuid",
  "occurred_at": "2026-06-20T10:00:00+07:00",
  "payload": {
    "employee_name": "Nguyễn Văn A",
    "changed_fields": ["phone"]
  }
}
```

### 14.3 Recipient resolving

| Event | Người nhận đề xuất |
| --- | --- |
| `HR_PROFILE_CHANGE_SUBMITTED` | HR/Admin có quyền duyệt trong company; có thể thêm direct manager nếu policy |
| `HR_PROFILE_CHANGE_APPROVED` | Employee gửi request |
| `HR_PROFILE_CHANGE_REJECTED` | Employee gửi request |
| `HR_EMPLOYEE_CREATED` | HR/Admin hoặc employee nếu đã có user, tùy config |
| `HR_CONTRACT_EXPIRING_SOON` | HR/Admin, direct manager nếu policy |

### 14.4 Dashboard invalidation

Sau các mutation sau, publish cache invalidation:

```text
Create/update/delete employee
Change employee status
Create/update/delete department
Create/update/delete position
Create/update/delete contract
Approve profile change request
```

Affected dashboard widgets:

```text
DASH_WIDGET_HR_EMPLOYEE_OVERVIEW
DASH_WIDGET_NEW_EMPLOYEES
DASH_WIDGET_CONTRACT_EXPIRING
DASH_WIDGET_PENDING_PROFILE_CHANGE_REQUESTS
```

---

## 15. Security implementation

### 15.1 Bắt buộc

1. Không tin `company_id` từ request body.
2. Không trả field nhạy cảm nếu thiếu permission.
3. Không trả file storage path.
4. Không cho direct URL xem employee ngoài scope.
5. Không hard-code theo role `HR`, phải dùng permission + scope.
6. Không expose soft-deleted employee trong list mặc định.
7. Không cho employee tự cập nhật hồ sơ chính.
8. Không log raw dữ liệu nhạy cảm.
9. Không tạo mã nhân viên bằng query max.
10. Không cho link user khác company vào employee.
11. Không cho user bị inactive/locked thao tác HR.
12. Không cho upload file sai MIME/size.
13. Không trả export có field sensitive nếu thiếu `HR.EMPLOYEE.VIEW_SENSITIVE`.
14. Không cache response HR theo key thiếu user/company boundary.

### 15.2 Field protection matrix

| Field group | View list | View detail | Export | Audit diff |
| --- | --- | --- | --- | --- |
| Public work info | Có nếu có `HR.EMPLOYEE.VIEW` | Có | Có | Có |
| Personal contact | Không mặc định | Cần `VIEW_SENSITIVE` hoặc mask | Cần `VIEW_SENSITIVE` | Mask nếu cấu hình |
| Identity/tax/bank | Không | Cần `VIEW_SENSITIVE` | Cần `VIEW_SENSITIVE` | Luôn mask |
| Contract basic | Cần `HR.CONTRACT.VIEW` | Cần `HR.CONTRACT.VIEW` | Cần quyền export + contract view | Có mask nếu sensitive |
| File metadata | Cần `HR.EMPLOYEE.FILE_VIEW` | Cần file view | Không mặc định | Có |
| File content | Signed URL sau permission check | Signed URL sau permission check | Không mặc định | file access log |

---

## 16. Performance và query strategy

### 16.1 Employee list

Query list cần dùng projection, không load toàn bộ entity:

```text
employees.id
employees.employee_code
employees.full_name
employees.company_email
employees.employment_status
employees.joined_date
departments.name AS department_name
positions.name AS position_name
manager.full_name AS direct_manager_name
```

Filter whitelist:

```text
search
department_id
position_id
job_level_id
employment_status
employee_type
joined_from
joined_to
has_user
manager_id
```

Sort whitelist:

```text
employee_code
full_name
joined_date
employment_status
created_at
```

### 16.2 Search

Search fields:

```text
employee_code
full_name
company_email
phone nếu có quyền sensitive và policy cho phép
```

Khuyến nghị dùng normalized text hoặc `pg_trgm` cho `full_name`.

### 16.3 Lookup employee

Lookup dùng response tối giản, limit tối đa 50:

```text
id, employee_code, full_name, department_name, position_name, employment_status
```

Không trả sensitive field trong lookup.

### 16.4 Org chart

MVP có thể hỗ trợ 2 mode:

| Mode | Dữ liệu |
| --- | --- |
| Department tree | departments + employees count |
| Manager tree | employees direct_manager_id |

Tránh recursive query quá sâu nếu chưa có index tốt. Có thể giới hạn depth bằng query param.

### 16.5 Export

MVP có thể export sync nếu dữ liệu nhỏ:

```text
<= 5.000 rows: sync export
> 5.000 rows: trả lỗi yêu cầu dùng async export phase sau hoặc giới hạn filter
```

Export phải:

1. Áp dụng permission + data scope giống list API.
2. Không export sensitive field nếu thiếu quyền.
3. Ghi audit `HR_EMPLOYEE_EXPORTED`.
4. Tạo file private qua FileService.
5. Trả signed download URL có hạn.

---

## 17. DTO validation checklist

### 17.1 Create employee DTO

| Field | Rule |
| --- | --- |
| `full_name` | Required, string, max 255 |
| `company_email` | Optional, email, lower-case normalize |
| `personal_email` | Optional, email, sensitive |
| `phone` | Optional, string, max 50 |
| `department_id` | Required UUID |
| `position_id` | Required UUID |
| `job_level_id` | Optional UUID |
| `direct_manager_id` | Optional UUID, not self |
| `joined_date` | Required date |
| `employment_status` | Required enum |
| `employee_type` | Optional enum |
| `employee_code` | Optional, only if override allowed |
| `create_user` | Optional boolean |

### 17.2 Profile change request DTO

| Field | Rule |
| --- | --- |
| `changes` | Required array/object, min 1 |
| `field_name` | Must be in editable whitelist |
| `new_value` | Validate by field type |
| `note` | Optional max 1000 |
| `attachments` | Optional file ids, must be owned/uploaded and allowed |

### 17.3 Department DTO

| Field | Rule |
| --- | --- |
| `department_code` | Required, uppercase/slug normalize, unique company |
| `name` | Required max 255 |
| `parent_id` | Optional UUID, no cycle |
| `manager_employee_id` | Optional UUID, employee active same company |
| `status` | Active/Inactive |

---

## 18. Integration contract cho module khác

### 18.1 ATT dùng HR

ATT cần HR cung cấp:

```text
resolveEmployeeByUser(user_id)
getEmployeeWorkContext(employee_id)
getEmployeesByScope(manager/team/department/company)
checkEmployeeActiveForAttendance(employee_id)
```

Work context nên trả:

```json
{
  "employee_id": "employee-uuid",
  "company_id": "company-uuid",
  "department_id": "department-uuid",
  "position_id": "position-uuid",
  "direct_manager_id": "manager-uuid",
  "employment_status": "Official",
  "work_location": "HCM Office"
}
```

### 18.2 LEAVE dùng HR

LEAVE cần:

1. Employee status.
2. Joined date.
3. Department.
4. Job level.
5. Direct manager.
6. Contract type nếu policy nghỉ phép phụ thuộc hợp đồng.

### 18.3 TASK dùng HR

TASK cần:

1. Employee lookup.
2. Direct manager/team scope.
3. Employment status để chặn/cảnh báo giao task cho nhân viên đã nghỉ.
4. Department và position để filter/report.

### 18.4 DASH dùng HR

DASH cần:

1. Employee overview count.
2. New employees in month.
3. Probation ending soon.
4. Contract expiring soon.
5. Pending profile change request count.

### 18.5 NOTI dùng HR

NOTI cần:

1. Resolve recipient users từ employee/direct manager/HR role.
2. Kiểm tra user active.
3. Render tên employee, department, position trong notification payload.

---

## 19. Testing strategy

### 19.1 Unit test

| Service/Policy | Test chính |
| --- | --- |
| EmployeeCodeService | Generate/preview, reset rule, race prevention mock, invalid config |
| HrDataScopePolicy | Own/Team/Department/Company/System filter |
| EmployeeFieldAccessPolicy | Mask/omit sensitive fields |
| ProfileChangeFieldPolicy | Field whitelist, no diff, field type validation |
| DepartmentPolicy | Cycle detection, active employee blocking |
| EmployeeStatusService | Transition matrix |
| EmployeeMapper | Projection, mask sensitive, hide file |

### 19.2 Integration test

| Nhóm | Test chính |
| --- | --- |
| Employee CRUD | Create, update, duplicate email/code, detail mask, soft delete |
| Data scope | Employee Own cannot view other, Manager Team, HR Company, Super Admin System |
| Self-Service | Submit, approve, reject, cancel, pending conflict |
| Department | Create tree, prevent cycle, prevent delete with active employee |
| Contract | Date validation, primary contract behavior |
| File | Upload private, permission download, file access audit |
| Employee Code | Sequence transaction, manual override permission/config |
| Audit/Event | Mutation writes audit and outbox event |
| Export | Scope/sensitive filtering, file generated private |

### 19.3 E2E test flow

```text
1. HR tạo department.
2. HR tạo position.
3. HR preview employee code.
4. HR tạo employee.
5. HR link user.
6. Employee login và xem My Profile.
7. Employee gửi request đổi phone.
8. HR xem pending request.
9. HR approve request.
10. Employee profile được cập nhật.
11. Audit log có đủ entry.
12. Notification event được publish.
```

---

## 20. Seed và migration cần kiểm tra trước khi code HR

### 20.1 Bảng bắt buộc

```text
departments
positions
job_levels
contract_types
employees
employee_status_histories
employee_contracts
profile_change_requests
profile_change_request_items
employee_code_configs
sequence_counters
```

### 20.2 Permission seed bắt buộc

Đảm bảo DB seed đã có toàn bộ permission HR ở mục 8.1.

### 20.3 Default data seed

Khuyến nghị seed:

```text
Default departments: Ban Giám đốc, Nhân sự, Kỹ thuật, Kinh doanh
Default job levels: Intern, Fresher, Junior, Middle, Senior, Lead, Manager, Director
Default contract types: Probation, Fixed Term, Indefinite Term, Part-time, Internship
Default employee code config: EMP0001 pattern
```

### 20.4 Default role permission matrix

| Role seed | Quyền HR đề xuất |
| --- | --- |
| Employee | View Own, My Profile, Create profile change request, Cancel own pending request |
| Manager | View Team employee basic, view org chart team, view profile change request team nếu policy |
| HR | Manage company employee, department, position, contract, profile change request |
| Company Admin | Full company HR + config |
| Super Admin | System scope |

---

## 21. Logging và observability

### 21.1 Structured log fields

```text
request_id
correlation_id
company_id
actor_user_id
module_code = HR
action
endpoint
target_type
target_id
status_code
error_code
duration_ms
```

### 21.2 Metrics đề xuất

```text
hr_employee_create_total
hr_employee_update_total
hr_profile_change_submitted_total
hr_profile_change_approved_total
hr_profile_change_rejected_total
hr_employee_export_total
hr_file_download_total
hr_permission_denied_total
hr_sensitive_field_masked_total
```

### 21.3 Alert đề xuất

1. Export employee quá nhiều trong thời gian ngắn.
2. Download file nhạy cảm bất thường.
3. Nhiều lỗi duplicate employee code, có thể sequence config sai.
4. Nhiều lỗi 403 ở HR, có thể frontend hiển thị sai action hoặc permission seed thiếu.
5. Query employee list chậm vượt ngưỡng.

---

## 22. Kế hoạch triển khai theo sprint

## 22.1 Sprint 1 - HR Core Read

Mục tiêu: frontend có thể hiển thị danh sách nhân viên, chi tiết nhân viên, hồ sơ của tôi và dropdown cơ bản.

Checklist:

- [ ] Tạo HR module skeleton.
- [ ] Tạo Employee entity/repository projection.
- [ ] Tạo DTO list/detail/lookup.
- [ ] Tạo HrDataScopeResolver.
- [ ] Tạo EmployeeFieldAccessPolicy.
- [ ] Implement `GET /api/v1/hr/employees`.
- [ ] Implement `GET /api/v1/hr/employees/{id}`.
- [ ] Implement `GET /api/v1/hr/me/profile`.
- [ ] Implement `GET /api/v1/hr/employees/lookup`.
- [ ] Implement department/position list cho dropdown.
- [ ] Unit test mapper mask sensitive.
- [ ] Integration test Own/Team/Company scope.

Definition of Done:

1. API trả đúng format API-01.
2. Không trả sensitive field nếu thiếu quyền.
3. Employee scope Own không xem được người khác.
4. Manager chỉ xem team nếu có scope Team.
5. HR xem company nếu có scope Company.
6. Query có pagination/filter/sort whitelist.

## 22.2 Sprint 2 - HR Core Write

Mục tiêu: HR/Admin tạo, cập nhật, đổi trạng thái, xóa mềm nhân viên và link user.

Checklist:

- [ ] EmployeeCodeService preview/generate.
- [ ] Implement `POST /api/v1/hr/employees`.
- [ ] Implement `PATCH /api/v1/hr/employees/{id}`.
- [ ] Implement `POST /api/v1/hr/employees/{id}/change-status`.
- [ ] Implement `DELETE /api/v1/hr/employees/{id}`.
- [ ] Implement link/unlink user.
- [ ] Validate duplicate email/code.
- [ ] Validate department/position active.
- [ ] Validate direct manager.
- [ ] Write employee status history.
- [ ] Audit log integration.
- [ ] Publish HR events.

Definition of Done:

1. Create employee sinh mã tự động đúng và chống trùng.
2. Manual override bị chặn nếu thiếu quyền/config.
3. Update employee ghi audit diff.
4. Change status tạo status history.
5. Link user chặn user khác company hoặc user đã link.

## 22.3 Sprint 3 - Organization Master Data

Mục tiêu: quản trị cơ cấu tổ chức cơ bản.

Checklist:

- [ ] Department CRUD.
- [ ] Department tree.
- [ ] Prevent department cycle.
- [ ] Prevent delete department with active employees.
- [ ] Position CRUD.
- [ ] Job Level CRUD.
- [ ] Contract Type CRUD.
- [ ] Org chart basic.
- [ ] Audit log cho master data mutations.

Definition of Done:

1. Department tree không N+1.
2. Không tạo vòng lặp phòng ban.
3. Không xóa department/position đang dùng.
4. Org chart trả dữ liệu theo scope.

## 22.4 Sprint 4 - Contract/File/Export

Mục tiêu: quản lý hợp đồng, file hồ sơ và export danh sách nhân viên.

Checklist:

- [ ] Employee contract list/detail/create/update/delete.
- [ ] Primary contract behavior.
- [ ] Contract date validation.
- [ ] Employee file upload/list/download/delete.
- [ ] FileService integration.
- [ ] File access audit.
- [ ] Employee export.
- [ ] Sensitive field filtering trong export.

Definition of Done:

1. File private, không trả storage path.
2. User thiếu file view bị 403.
3. Export áp dụng scope giống list.
4. Export không chứa sensitive field nếu thiếu quyền.

## 22.5 Sprint 5 - Employee Self-Service

Mục tiêu: nhân viên gửi yêu cầu sửa hồ sơ, HR/Admin duyệt/từ chối.

Checklist:

- [ ] Editable fields policy.
- [ ] Submit profile change request.
- [ ] List/detail profile change requests.
- [ ] Approve request.
- [ ] Reject request.
- [ ] Employee cancel own pending request.
- [ ] Apply changes transactionally.
- [ ] Notification events.
- [ ] Audit logs.

Definition of Done:

1. Employee không tự update trực tiếp `employees`.
2. Request không có diff bị chặn.
3. Field không được phép bị chặn.
4. Approve cập nhật employee và ghi audit.
5. Reject không thay đổi employee và gửi notification.

---

## 23. Acceptance criteria tổng thể BACKEND-05

BACKEND-05 được xem là hoàn tất khi:

1. Tất cả endpoint HR MVP trong API-03 được triển khai hoặc có stub rõ ràng theo phase.
2. Tất cả endpoint dùng `/api/v1/hr` và response/error format chuẩn.
3. Backend kiểm tra authentication, permission và data scope ở mọi endpoint.
4. Không có endpoint HR nào tin `company_id` từ frontend.
5. Dữ liệu employee list/detail được mask/omit đúng theo field-level permission.
6. Employee Self-Service chỉ tạo request, không update trực tiếp hồ sơ chính.
7. Approve profile change request chạy trong transaction và có audit/event.
8. Employee code sinh tự động bằng sequence service có lock, không dùng `MAX + 1`.
9. Department tree chống vòng lặp.
10. Không xóa mềm department/position/job level/contract type nếu còn dữ liệu active phụ thuộc, trừ policy rõ ràng.
11. Employee contract validate ngày và primary contract đúng.
12. Employee file đi qua FileService, private mặc định, download cần permission.
13. Export áp dụng scope và sensitive permission.
14. Audit log có đủ action quan trọng.
15. Notification/domain event được publish cho các thay đổi quan trọng.
16. Query list có pagination, filter, sort whitelist.
17. Test pass: unit, integration, permission/scope, e2e core flow.
18. Không có hard-code kiểu `if role === 'HR'` trong service nghiệp vụ.
19. Không có raw sensitive data trong log/audit.
20. Tài liệu OpenAPI/Swagger cập nhật theo endpoint đã triển khai.

---

## 24. Rủi ro và cách giảm thiểu

| Rủi ro | Mức độ | Cách giảm thiểu |
| --- | --- | --- |
| Lộ dữ liệu nhạy cảm HR | Cao | Field-level mapper, permission test, không trả raw sensitive mặc định |
| Sai data scope Team/Department | Cao | HrDataScopeResolver dùng chung, integration test nhiều role/scope |
| Race condition sinh mã nhân viên | Cao | SequenceService dùng transaction + row lock |
| Employee tự sửa trực tiếp hồ sơ | Cao | Tách MyProfile submit request, cấm PATCH `/me/profile` trực tiếp vào employees |
| Department tree bị vòng lặp | Trung bình | Cycle detection trước khi update parent |
| Audit log chứa raw sensitive | Cao | Audit mask service bắt buộc trước insert |
| Export vượt scope | Cao | Export reuse cùng query scope với list API |
| File private bị public URL | Cao | Signed URL ngắn hạn, không trả storage path |
| Link user sai company | Cao | AuthUserService validate company + active status |
| Query employee list chậm | Trung bình | Projection query, index, pagination, avoid N+1 |
| Notification event gửi sai người | Trung bình | Recipient resolver theo permission/scope, test event payload |
| Hard-code role | Trung bình | Code review rule: chỉ permission + scope |

---

## 25. Open questions cần chốt

| Mã | Câu hỏi | Đề xuất MVP |
| --- | --- | --- |
| BE05-OQ-001 | Manager có được duyệt profile change request của team không? | Mặc định HR/Admin duyệt; Manager chỉ xem nếu có permission riêng |
| BE05-OQ-002 | Khi employee Resigned/Terminated có tự khóa user không? | MVP để HR chọn hoặc company setting; không tự khóa cứng nếu chưa chốt |
| BE05-OQ-003 | Phone/personal_email có unique trong company không? | Chỉ company_email unique; phone/personal_email theo config |
| BE05-OQ-004 | Identity number có bắt buộc/unique không? | Không bắt buộc MVP; unique nếu company setting bật |
| BE05-OQ-005 | File hồ sơ lưu local hay object storage? | MVP qua FileService, local/private hoặc MinIO đều được, không ràng buộc HR |
| BE05-OQ-006 | Export sync hay async? | MVP sync giới hạn nhỏ; async phase sau |
| BE05-OQ-007 | Team scope có bao gồm nhiều cấp quản lý không? | MVP direct reports; team tree config phase sau |
| BE05-OQ-008 | Hợp đồng có dữ liệu lương không? | Không trong MVP; nếu có phải tách permission payroll/sensitive |

---

## 26. Kết luận

BACKEND-05 là bước triển khai backend cho module HR, một trong các module nền tảng nhất của hệ thống.

Trọng tâm triển khai không chỉ là CRUD nhân viên, mà là đảm bảo các nguyên tắc cốt lõi:

```text
HR data là nguồn trung tâm
-> Backend kiểm tra permission + data scope
-> Field nhạy cảm được bảo vệ
-> Employee code sinh bằng sequence an toàn
-> Self-service đi qua approval workflow
-> File private qua Foundation FileService
-> Mọi mutation quan trọng có audit + event
-> Dữ liệu HR sẵn sàng cho ATT, LEAVE, TASK, DASH, NOTI
```

Sau BACKEND-05, hệ thống có đủ nền nhân sự để triển khai các module phụ thuộc trực tiếp như:

```text
BACKEND-06: Attendance Backend
BACKEND-07: Leave Backend
BACKEND-08: Task Backend
BACKEND-09: Notification Backend
BACKEND-10: Dashboard Backend
```
