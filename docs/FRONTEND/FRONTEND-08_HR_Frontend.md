# FRONTEND-08: HR FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · **FRONTEND-08 HR** · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-03 HR](<../SPEC/SPEC-03 HR.md>) · [HR API: API-03](<../API Design/API-03_HR_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-08 |
| Tên tài liệu | HR Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | HR - Quản lý nhân sự |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-07 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-08 mô tả cách triển khai frontend cho module **HR - Quản lý nhân sự**.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình HR cần triển khai trong MVP.
2. Chốt route, sidebar, screen code, permission và data scope cho HR Workspace.
3. Chốt cấu trúc thư mục, domain type, API service, query hook và form schema cho HR.
4. Chốt cách triển khai danh sách nhân viên, chi tiết nhân viên, tạo/sửa nhân viên, hồ sơ của tôi, yêu cầu cập nhật hồ sơ, phòng ban, chức vụ, cấp bậc, loại hợp đồng, hợp đồng, file hồ sơ, cấu hình mã nhân viên và sơ đồ tổ chức cơ bản.
5. Chuẩn hóa UX cho dữ liệu nhân sự nhạy cảm: ẩn, mask, disable action và audit-aware UI.
6. Chuẩn hóa luồng Employee Self-Service: Employee gửi yêu cầu sửa hồ sơ, HR/Admin duyệt hoặc từ chối, dữ liệu chính chỉ thay đổi sau khi được duyệt.
7. Chuẩn hóa luồng mã nhân viên tự sinh: preview mã, tự sinh mã khi tạo employee, khóa hoặc cho phép override theo cấu hình và permission.
8. Chốt cách tích hợp HR với AUTH, DASH, NOTI, ATT, LEAVE, TASK và FOUNDATION.
9. Làm checklist cho frontend developer, backend/API và QA khi nghiệm thu module HR.

FRONTEND-08 không thiết kế lại API, database hoặc UI/UX gốc. Tài liệu này chuyển các quyết định đã chốt thành hướng triển khai frontend có thể code được.

---

## 3. Vị trí FRONTEND-08 trong roadmap frontend

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

FRONTEND-08 là module nghiệp vụ lớn đầu tiên sau Dashboard. Vì HR là nguồn dữ liệu nhân sự trung tâm, các module sau như ATT, LEAVE, TASK, DASH và NOTI đều cần dùng lại dữ liệu employee, department, position, direct manager và employment status.

---

## 4. Căn cứ triển khai

FRONTEND-08 bám theo các quyết định đã chốt:

1. HR là module quản lý nhân sự trung tâm, bao gồm hồ sơ nhân viên, thông tin cá nhân, thông tin công việc, phòng ban, chức vụ, cấp bậc, quản lý trực tiếp, hợp đồng, trạng thái làm việc, file hồ sơ, lịch sử thay đổi và liên kết account.
2. Employee Self-Service không cập nhật trực tiếp vào hồ sơ chính. Employee chỉ gửi yêu cầu cập nhật hồ sơ, HR/Admin/Super Admin duyệt thì thay đổi mới có hiệu lực.
3. `employee_code` mặc định do hệ thống sinh tự động theo cấu hình. Manual override chỉ hiển thị khi backend trả cấu hình cho phép và user có permission phù hợp.
4. Frontend được phép ẩn/hiện menu, button, tab, field và widget theo permission/data scope, nhưng backend vẫn là nguồn kiểm tra quyền cuối cùng.
5. Dữ liệu nhân sự nhạy cảm phải dùng `MaskedField`, ẩn field hoặc hiển thị placeholder nếu user thiếu quyền.
6. Mọi screen HR dùng `ModuleWorkspaceLayout`: topbar chung, sidebar riêng theo module HR, content shell, page header, filter bar, table/detail/form/drawer/modal.
7. HR list phải hỗ trợ search, filter, sort, pagination và state đầy đủ.
8. HR detail nên chia tab để giảm độ dài form.
9. Action nguy hiểm như xóa mềm, đổi trạng thái, hủy liên kết user, xóa file, từ chối yêu cầu cần `ConfirmDialog`.
10. API call phải đi qua API client chung và TanStack Query theo convention đã chốt.
11. Dashboard quick action và notification deep link khi đi sang HR phải vào đúng route HR và HR module phải kiểm tra lại permission, data scope và business rule.
12. Khi logout hoặc đổi user, cache HR nhạy cảm phải được clear theo cơ chế query cache chung.

---

## 5. Phạm vi FRONTEND-08

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung triển khai |
| --- | --- |
| HR Workspace | Route `/hr`, sidebar HR, overview cơ bản, breadcrumb, page shell |
| Employee List | Danh sách nhân viên, search, filter, sort, pagination, export theo quyền |
| Employee Detail | Header hồ sơ, tab tổng quan, cá nhân, công việc, hợp đồng, file, lịch sử |
| Employee Form | Tạo mới, cập nhật, validate, preview employee code, link user option |
| Employee Status | Đổi trạng thái nhân viên, reason/effective date, confirm, audit-aware UI |
| My Profile | Employee xem hồ sơ cá nhân, field theo quyền, CTA gửi yêu cầu cập nhật |
| Profile Change Request | Employee tạo/hủy/xem yêu cầu; HR/Admin xem/duyệt/từ chối |
| Department | Danh sách/tree phòng ban, tạo/sửa/xóa mềm, chọn parent, manager |
| Position | Danh sách chức vụ, tạo/sửa/xóa mềm, liên kết department/job level nếu có |
| Job Level | Danh mục cấp bậc cơ bản |
| Contract Type | Danh mục loại hợp đồng cơ bản |
| Employee Contract | Danh sách hợp đồng theo employee, tạo/sửa/xóa mềm, set primary |
| Employee File | Upload, danh sách, tải/xem file theo quyền, xóa mềm file |
| Employee User Link | Liên kết/hủy liên kết employee với user AUTH theo quyền |
| Employee Code Config | Xem/cập nhật cấu hình mã, preview mã tiếp theo, khóa override |
| Org Chart | Sơ đồ tổ chức cơ bản hoặc tree/list organization nếu MVP chưa có graph |
| HR Audit | Timeline/lịch sử thay đổi hồ sơ theo quyền |
| Integration | Query invalidation cho DASH/NOTI/AUTH sau mutation quan trọng |
| Testing | Unit, component, integration, permission, data scope, E2E P0 |

### 5.2 Chưa bao gồm sâu trong MVP

| Nội dung | Giai đoạn đề xuất | Ghi chú frontend |
| --- | --- | --- |
| Import Excel nhân viên | Phase sau | Có thể chừa route `/hr/imports` nhưng ẩn |
| Onboarding workflow | Phase sau | Tách workflow riêng |
| Offboarding workflow nâng cao | Phase sau | MVP chỉ đổi trạng thái + ghi lý do |
| Khen thưởng/kỷ luật | Phase sau | Module/tab mở rộng |
| Đánh giá hiệu suất | Phase sau | Module riêng hoặc tab HR |
| Bảo hiểm/thuế chi tiết | Phase sau | Tách quyền nhạy cảm riêng |
| E-sign hợp đồng | Phase sau | Tích hợp provider |
| Org chart drag/drop | Phase sau | MVP chỉ xem cây tổ chức |
| Đồng bộ Google/Microsoft directory | Phase sau | Thuộc integration/admin |

---

## 6. Nguyên tắc UX riêng cho HR

### 6.1 HR là dữ liệu nhạy cảm

HR chứa dữ liệu cá nhân, giấy tờ, liên hệ, hợp đồng và file riêng tư. Vì vậy frontend phải áp dụng các quy tắc sau:

1. Không hard-code hiển thị dữ liệu nhạy cảm theo role name.
2. Chỉ hiển thị field khi `permissions` và API response cho phép.
3. Nếu API trả masked value, frontend hiển thị đúng masked value, không tự đoán giá trị gốc.
4. Nếu API không trả field, frontend không tạo placeholder gây hiểu nhầm là dữ liệu trống.
5. File hồ sơ mặc định là private, action xem/tải file phải đi qua API cấp quyền.
6. Export có dữ liệu nhạy cảm phải là action riêng hoặc có checkbox xác nhận nếu backend hỗ trợ.
7. Khi user thiếu quyền, action nên ẩn; nếu cần giải thích business rule thì disable kèm tooltip.

### 6.2 Không cập nhật trực tiếp hồ sơ cá nhân bởi Employee

Trong màn **Hồ sơ của tôi**, Employee không gọi `PATCH /hr/employees/{id}` trực tiếp. Khi sửa thông tin cá nhân, frontend phải tạo `profile_change_request`.

Luồng đúng:

```text
Employee mở Hồ sơ của tôi
-> Bấm Chỉnh sửa thông tin
-> Frontend hiển thị form các field được phép đề xuất sửa
-> Employee nhập dữ liệu mới
-> Frontend hiển thị diff old/new
-> Employee gửi yêu cầu
-> API tạo profile_change_request trạng thái Pending
-> Employee theo dõi trong tab Yêu cầu của tôi
-> HR/Admin duyệt/từ chối ở màn Profile Change Request
```

### 6.3 Mã nhân viên tự sinh là mặc định

Khi tạo nhân viên mới:

1. Frontend gọi API preview mã nhân viên nếu user có quyền.
2. Field `employee_code` mặc định read-only.
3. Chỉ bật chỉnh sửa mã thủ công khi cả 2 điều kiện đúng:
   - Cấu hình backend cho phép manual override.
   - User có `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE`.
4. Sau khi tạo employee thành công, nếu backend trả `is_employee_code_locked = true`, form edit phải khóa field mã nhân viên.

---

## 7. Route structure HR

### 7.1 Route root

```text
/hr
```

HR là một app/module trong Module Workspace. User vào HR từ Home Portal, App Switcher, Dashboard quick action hoặc Notification deep link.

### 7.2 Route list MVP

| Route | Screen | Priority | Permission chính | Layout |
| --- | --- | --- | --- | --- |
| `/hr` | HR Overview | P1 | `HR.EMPLOYEE.VIEW` hoặc dashboard HR permission | ModuleWorkspaceLayout |
| `/hr/employees` | Danh sách nhân viên | P0 | `HR.EMPLOYEE.VIEW` | List/Table |
| `/hr/employees/new` | Tạo nhân viên | P0 | `HR.EMPLOYEE.CREATE` | Form |
| `/hr/employees/:employeeId` | Chi tiết nhân viên | P0 | `HR.EMPLOYEE.VIEW` | Detail Tabs |
| `/hr/employees/:employeeId/edit` | Sửa nhân viên | P0 | `HR.EMPLOYEE.UPDATE` | Form |
| `/hr/employees/:employeeId/contracts` | Hợp đồng của nhân viên | P1 | `HR.CONTRACT.VIEW` | List/Table |
| `/hr/employees/:employeeId/files` | File hồ sơ | P1 | `HR.EMPLOYEE.FILE_VIEW` | File List |
| `/hr/me/profile` | Hồ sơ của tôi | P0 | `HR.EMPLOYEE.VIEW` scope Own hoặc profile endpoint | Detail/Form |
| `/hr/me/profile-change-requests` | Yêu cầu cập nhật của tôi | P1 | `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` | List/Table |
| `/hr/profile-change-requests` | Danh sách yêu cầu cập nhật | P0 | `HR.PROFILE_CHANGE_REQUEST.VIEW` | Approval List |
| `/hr/profile-change-requests/:requestId` | Chi tiết yêu cầu cập nhật | P0 | Theo scope + permission | Approval Detail |
| `/hr/departments` | Phòng ban | P0 | `HR.DEPARTMENT.VIEW` | Tree/List |
| `/hr/positions` | Chức vụ | P1 | `HR.POSITION.VIEW` | List/Table |
| `/hr/job-levels` | Cấp bậc | P2 | `HR.MASTER_DATA.MANAGE` hoặc view tương ứng | List/Table |
| `/hr/contract-types` | Loại hợp đồng | P2 | `HR.MASTER_DATA.MANAGE` | List/Table |
| `/hr/contracts` | Danh sách hợp đồng | P2 | `HR.CONTRACT.VIEW` | List/Table |
| `/hr/org-chart` | Sơ đồ tổ chức | P1 | `HR.ORG_CHART.VIEW` | Tree/Chart |
| `/hr/settings/employee-code` | Cấu hình mã nhân viên | P1 | `HR.EMPLOYEE_CODE_CONFIG.VIEW` | Settings Form |
| `/hr/audit` | Audit HR | P2 | `HR.AUDIT_LOG.VIEW` | Audit Table |

### 7.3 Route metadata mẫu

```ts
export const hrRoutes: AppRouteObject[] = [
  {
    path: '/hr',
    moduleCode: 'HR',
    routeKey: 'hr.overview',
    screenCode: 'UI-HR-SCREEN-001',
    layout: 'module-workspace',
    requiredPermissions: ['HR.EMPLOYEE.VIEW'],
    allowedScopes: ['Team', 'Department', 'Company', 'System'],
    element: <HrOverviewPage />,
  },
  {
    path: '/hr/employees',
    moduleCode: 'HR',
    routeKey: 'hr.employee.list',
    screenCode: 'UI-HR-SCREEN-002',
    layout: 'module-workspace',
    requiredPermissions: ['HR.EMPLOYEE.VIEW'],
    allowedScopes: ['Team', 'Department', 'Company', 'System'],
    element: <EmployeeListPage />,
  },
  {
    path: '/hr/me/profile',
    moduleCode: 'HR',
    routeKey: 'hr.me.profile',
    screenCode: 'UI-HR-SCREEN-006',
    layout: 'module-workspace',
    requiredPermissions: ['HR.EMPLOYEE.VIEW'],
    allowedScopes: ['Own', 'Team', 'Department', 'Company', 'System'],
    element: <MyProfilePage />,
  },
];
```

---

## 8. HR sidebar registry

### 8.1 Sidebar structure

```text
Tổng quan
- Tổng quan nhân sự

Nhân viên
- Danh sách nhân viên
- Hồ sơ của tôi
- Yêu cầu cập nhật hồ sơ
- Sơ đồ tổ chức

Hợp đồng & danh mục
- Hợp đồng
- Phòng ban
- Chức vụ
- Cấp bậc
- Loại hợp đồng

Thiết lập
- Cấu hình mã nhân viên
- Audit HR
```

### 8.2 Sidebar config mẫu

```ts
export const hrSidebar: SidebarGroup[] = [
  {
    label: 'Tổng quan',
    items: [
      {
        label: 'Tổng quan nhân sự',
        icon: 'LayoutDashboard',
        to: '/hr',
        routeKey: 'hr.overview',
        permissions: ['HR.EMPLOYEE.VIEW'],
      },
    ],
  },
  {
    label: 'Nhân viên',
    items: [
      {
        label: 'Danh sách nhân viên',
        icon: 'Users',
        to: '/hr/employees',
        routeKey: 'hr.employee.list',
        permissions: ['HR.EMPLOYEE.VIEW'],
      },
      {
        label: 'Hồ sơ của tôi',
        icon: 'UserRound',
        to: '/hr/me/profile',
        routeKey: 'hr.me.profile',
        permissions: ['HR.EMPLOYEE.VIEW'],
        scopes: ['Own', 'Team', 'Department', 'Company', 'System'],
      },
      {
        label: 'Yêu cầu cập nhật hồ sơ',
        icon: 'ClipboardCheck',
        to: '/hr/profile-change-requests',
        routeKey: 'hr.profileChange.list',
        permissionsAny: [
          'HR.PROFILE_CHANGE_REQUEST.VIEW',
          'HR.PROFILE_CHANGE_REQUEST.VIEW_OWN',
        ],
        badgeKey: 'hr.profileChange.pendingCount',
      },
      {
        label: 'Sơ đồ tổ chức',
        icon: 'Network',
        to: '/hr/org-chart',
        routeKey: 'hr.orgChart.view',
        permissions: ['HR.ORG_CHART.VIEW'],
      },
    ],
  },
  {
    label: 'Hợp đồng & danh mục',
    items: [
      {
        label: 'Hợp đồng',
        icon: 'FileSignature',
        to: '/hr/contracts',
        routeKey: 'hr.contract.list',
        permissions: ['HR.CONTRACT.VIEW'],
      },
      {
        label: 'Phòng ban',
        icon: 'Building2',
        to: '/hr/departments',
        routeKey: 'hr.department.list',
        permissions: ['HR.DEPARTMENT.VIEW'],
      },
      {
        label: 'Chức vụ',
        icon: 'BriefcaseBusiness',
        to: '/hr/positions',
        routeKey: 'hr.position.list',
        permissions: ['HR.POSITION.VIEW'],
      },
      {
        label: 'Cấp bậc',
        icon: 'Layers3',
        to: '/hr/job-levels',
        routeKey: 'hr.jobLevel.list',
        permissionsAny: ['HR.MASTER_DATA.MANAGE'],
      },
      {
        label: 'Loại hợp đồng',
        icon: 'Files',
        to: '/hr/contract-types',
        routeKey: 'hr.contractType.list',
        permissionsAny: ['HR.MASTER_DATA.MANAGE'],
      },
    ],
  },
  {
    label: 'Thiết lập',
    items: [
      {
        label: 'Cấu hình mã nhân viên',
        icon: 'Hash',
        to: '/hr/settings/employee-code',
        routeKey: 'hr.employeeCode.settings',
        permissions: ['HR.EMPLOYEE_CODE_CONFIG.VIEW'],
      },
      {
        label: 'Audit HR',
        icon: 'History',
        to: '/hr/audit',
        routeKey: 'hr.audit.list',
        permissions: ['HR.AUDIT_LOG.VIEW'],
      },
    ],
  },
];
```

---

## 9. Permission matrix frontend HR

### 9.1 Permission theo nhóm UI

| UI area | Permission cần kiểm tra | Hành vi frontend |
| --- | --- | --- |
| HR app card | Có ít nhất một permission HR | Hiển thị app HR trong Home/App Switcher |
| Employee list | `HR.EMPLOYEE.VIEW` | Cho vào `/hr/employees` |
| Employee create button | `HR.EMPLOYEE.CREATE` | Hiện nút `+ Thêm nhân viên` |
| Employee edit button | `HR.EMPLOYEE.UPDATE` | Hiện action sửa trong detail/row |
| Employee delete action | `HR.EMPLOYEE.DELETE` | Hiện action xóa mềm trong More menu |
| Change status | `HR.EMPLOYEE.CHANGE_STATUS` | Hiện nút đổi trạng thái |
| Sensitive fields | `HR.EMPLOYEE.VIEW_SENSITIVE` | Hiện raw value nếu API trả; nếu không thì MaskedField |
| Export employee | `HR.EMPLOYEE.EXPORT` | Hiện export button |
| File tab | `HR.EMPLOYEE.FILE_VIEW` | Hiện tab file |
| File upload | `HR.EMPLOYEE.FILE_UPLOAD` | Hiện upload button |
| File delete | `HR.EMPLOYEE.FILE_DELETE` | Hiện xóa file |
| Department list | `HR.DEPARTMENT.VIEW` | Hiện menu phòng ban |
| Department create | `HR.DEPARTMENT.CREATE` | Hiện nút tạo phòng ban |
| Position CRUD | `HR.POSITION.*` | Hiện menu/action tương ứng |
| Contract tab | `HR.CONTRACT.VIEW` | Hiện tab hợp đồng |
| Contract create/update/delete | `HR.CONTRACT.CREATE/UPDATE/DELETE` | Hiện action tương ứng |
| Profile change create | `HR.PROFILE_CHANGE_REQUEST.CREATE` | Hiện CTA gửi yêu cầu trong My Profile |
| Profile change approval | `HR.PROFILE_CHANGE_REQUEST.APPROVE/REJECT` | Hiện action duyệt/từ chối |
| Employee code config | `HR.EMPLOYEE_CODE_CONFIG.VIEW/UPDATE` | Hiện settings và submit |
| Manual employee code | `HR.EMPLOYEE_CODE.MANUAL_OVERRIDE` | Cho sửa code nếu config cho phép |
| HR audit | `HR.AUDIT_LOG.VIEW` | Hiện tab audit hoặc route audit |

### 9.2 Data scope ảnh hưởng UI

| Scope | Ảnh hưởng UI |
| --- | --- |
| Own | Chỉ nên thấy Hồ sơ của tôi và yêu cầu của tôi |
| Team | Employee list chỉ hiển thị team theo backend; UI hiển thị note “Dữ liệu trong phạm vi team” |
| Department | Employee list hiển thị dữ liệu phòng ban theo backend; filter phòng ban có thể bị giới hạn |
| Company | HR xem toàn công ty hiện tại |
| System | Super Admin có thể thấy bộ lọc company nếu backend hỗ trợ |

Frontend không tự resolve `company_id`, `employee_id`, `direct_manager_id` để vượt scope. Các filter chỉ gửi theo whitelist API cho phép.

---

## 10. Screen inventory HR

| Screen code | Tên màn hình | Route | Priority | Template | API chính |
| --- | --- | --- | --- | --- | --- |
| UI-HR-SCREEN-001 | HR Overview | `/hr` | P1 | Overview | Dashboard/HR summary hoặc HR list summary |
| UI-HR-SCREEN-002 | Danh sách nhân viên | `/hr/employees` | P0 | List/Table | `GET /api/v1/hr/employees` |
| UI-HR-SCREEN-003 | Tạo nhân viên | `/hr/employees/new` | P0 | Form | `POST /api/v1/hr/employees` |
| UI-HR-SCREEN-004 | Chi tiết nhân viên | `/hr/employees/:employeeId` | P0 | Detail Tabs | `GET /api/v1/hr/employees/{employee_id}` |
| UI-HR-SCREEN-005 | Sửa nhân viên | `/hr/employees/:employeeId/edit` | P0 | Form | `PATCH /api/v1/hr/employees/{employee_id}` |
| UI-HR-SCREEN-006 | Hồ sơ của tôi | `/hr/me/profile` | P0 | Detail/Form | `GET /api/v1/hr/me/profile` |
| UI-HR-SCREEN-007 | Gửi yêu cầu cập nhật hồ sơ | Drawer/Page | P0 | Form + Diff | `POST /api/v1/hr/me/profile-change-requests` |
| UI-HR-SCREEN-008 | Danh sách yêu cầu cập nhật | `/hr/profile-change-requests` | P0 | Approval List | `GET /api/v1/hr/profile-change-requests` |
| UI-HR-SCREEN-009 | Chi tiết yêu cầu cập nhật | `/hr/profile-change-requests/:requestId` | P0 | Approval Detail | `GET /api/v1/hr/profile-change-requests/{id}` |
| UI-HR-SCREEN-010 | Phòng ban | `/hr/departments` | P0 | Tree/List | `GET /api/v1/hr/departments` |
| UI-HR-SCREEN-011 | Chức vụ | `/hr/positions` | P1 | List/Table | `GET /api/v1/hr/positions` |
| UI-HR-SCREEN-012 | Cấp bậc | `/hr/job-levels` | P2 | List/Table | `GET /api/v1/hr/job-levels` |
| UI-HR-SCREEN-013 | Loại hợp đồng | `/hr/contract-types` | P2 | List/Table | `GET /api/v1/hr/contract-types` |
| UI-HR-SCREEN-014 | Hợp đồng | `/hr/contracts` hoặc tab employee | P1 | List/Table | `GET /api/v1/hr/employees/{id}/contracts` |
| UI-HR-SCREEN-015 | File hồ sơ | Tab employee | P1 | File List | `GET /api/v1/hr/employees/{id}/files` |
| UI-HR-SCREEN-016 | Sơ đồ tổ chức | `/hr/org-chart` | P1 | Tree/Chart | `GET /api/v1/hr/org-chart` |
| UI-HR-SCREEN-017 | Cấu hình mã nhân viên | `/hr/settings/employee-code` | P1 | Settings Form | `GET/PUT /api/v1/hr/employee-code-config` |
| UI-HR-SCREEN-018 | HR Audit | `/hr/audit` | P2 | Audit Table | HR audit/foundation audit endpoint |

---

## 11. Cấu trúc thư mục đề xuất

```text
src/
  modules/
    hr/
      api/
        hr.api.ts
        hr.keys.ts
      components/
        EmployeeAvatarCell.tsx
        EmployeeStatusBadge.tsx
        EmployeeProfileHeader.tsx
        EmployeeSummaryCard.tsx
        EmployeeSensitiveField.tsx
        EmployeeCodePreview.tsx
        EmployeeFormSections.tsx
        EmployeeStatusChangeDialog.tsx
        EmployeeUserLinkDialog.tsx
        EmployeeFileList.tsx
        EmployeeContractList.tsx
        DepartmentTree.tsx
        DepartmentFormDrawer.tsx
        PositionFormDrawer.tsx
        ProfileChangeDiffTable.tsx
        ProfileChangeApprovalBox.tsx
        HrAuditTimeline.tsx
      constants/
        hr.constants.ts
        hr.permissions.ts
        hr.routes.ts
        hr.sidebar.ts
      hooks/
        useEmployeeFilters.ts
        useEmployeeForm.ts
        useEmployeeCodePreview.ts
        useProfileChangeRequestForm.ts
        useHrPermissions.ts
      pages/
        HrOverviewPage.tsx
        EmployeeListPage.tsx
        EmployeeCreatePage.tsx
        EmployeeDetailPage.tsx
        EmployeeEditPage.tsx
        MyProfilePage.tsx
        MyProfileChangeRequestsPage.tsx
        ProfileChangeRequestListPage.tsx
        ProfileChangeRequestDetailPage.tsx
        DepartmentListPage.tsx
        PositionListPage.tsx
        JobLevelListPage.tsx
        ContractTypeListPage.tsx
        ContractListPage.tsx
        OrgChartPage.tsx
        EmployeeCodeSettingsPage.tsx
        HrAuditPage.tsx
      schemas/
        employee.schema.ts
        department.schema.ts
        position.schema.ts
        contract.schema.ts
        profile-change.schema.ts
        employee-code.schema.ts
      types/
        hr.types.ts
      utils/
        employee-formatters.ts
        employee-mappers.ts
        hr-field-permission.ts
        profile-change-diff.ts
      index.ts
```

---

## 12. Domain types TypeScript

### 12.1 Common enums

```ts
export type EmploymentStatus =
  | 'Probation'
  | 'Official'
  | 'Temporarily Suspended'
  | 'Resigned'
  | 'Terminated'
  | 'Onboarding';

export type EmployeeType =
  | 'Full-time'
  | 'Part-time'
  | 'Intern'
  | 'Contractor';

export type HrEntityStatus = 'Active' | 'Inactive' | 'Deleted';

export type ProfileChangeStatus =
  | 'Draft'
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Cancelled';
```

### 12.2 Employee summary

```ts
export interface EmployeeSummary {
  id: string;
  employee_code: string;
  full_name: string;
  company_email?: string | null;
  avatar?: FilePreview | null;
  department?: DepartmentSummary | null;
  position?: PositionSummary | null;
  job_level?: JobLevelSummary | null;
  direct_manager?: EmployeeMini | null;
  employment_status: EmploymentStatus;
  employee_type?: EmployeeType | null;
  joined_date?: string | null;
  user?: UserLinkSummary | null;
}
```

### 12.3 Employee detail

```ts
export interface EmployeeDetail extends EmployeeSummary {
  first_name?: string | null;
  last_name?: string | null;
  gender?: 'Male' | 'Female' | 'Other' | null;
  date_of_birth?: string | null;
  personal_email?: string | null;
  phone?: string | null;
  address?: string | null;
  current_address?: string | null;
  permanent_address?: string | null;
  identity_number?: string | null;
  identity_issue_date?: string | null;
  identity_issue_place?: string | null;
  tax_code?: string | null;
  bank_account_number?: string | null;
  bank_name?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  official_date?: string | null;
  probation_end_date?: string | null;
  resigned_date?: string | null;
  work_location?: string | null;
  is_employee_code_locked: boolean;
  editable_fields?: string[];
  field_permissions?: Record<string, FieldPermission>;
  created_at: string;
  updated_at: string;
}

export interface FieldPermission {
  visible: boolean;
  editable: boolean;
  masked?: boolean;
  reason?: string;
}
```

### 12.4 Department, position, contract

```ts
export interface DepartmentSummary {
  id: string;
  department_code: string;
  name: string;
}

export interface DepartmentNode extends DepartmentSummary {
  description?: string | null;
  parent_id?: string | null;
  manager_employee?: EmployeeMini | null;
  status: HrEntityStatus;
  sort_order?: number;
  children?: DepartmentNode[];
}

export interface PositionSummary {
  id: string;
  position_code: string;
  name: string;
}

export interface JobLevelSummary {
  id: string;
  level_code: string;
  name: string;
}

export interface EmployeeContract {
  id: string;
  employee_id: string;
  contract_code: string;
  title: string;
  contract_type: ContractTypeSummary;
  start_date: string;
  end_date?: string | null;
  signed_date?: string | null;
  status: 'Draft' | 'Active' | 'Expired' | 'Terminated' | 'Cancelled';
  is_primary: boolean;
  file?: FilePreview | null;
}
```

### 12.5 Profile change request

```ts
export interface ProfileChangeRequest {
  id: string;
  request_code: string;
  employee: EmployeeMini;
  status: ProfileChangeStatus;
  reason?: string | null;
  items: ProfileChangeRequestItem[];
  submitted_at?: string | null;
  reviewed_by?: EmployeeMini | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileChangeRequestItem {
  field_name: string;
  field_label?: string;
  old_value: unknown;
  new_value: unknown;
  status?: ProfileChangeStatus;
}

// Body cho POST /api/v1/hr/employee-code/preview (preview là POST, không phải GET)
export interface EmployeeCodePreviewInput {
  department_id?: string | null;
}
```

---

## 13. API service HR

### 13.1 File `hr.api.ts`

```ts
import { apiClient } from '@/shared/api/api-client';
import type {
  EmployeeDetail,
  EmployeeSummary,
  EmployeeContract,
  DepartmentNode,
  PositionSummary,
  ProfileChangeRequest,
  EmployeeCodeConfig,
  EmployeeListParams,
  EmployeeCreateInput,
  EmployeeUpdateInput,
} from '../types/hr.types';
import type { PaginatedResponse } from '@/shared/api/api.types';

const HR_PREFIX = '/hr';

export const hrApi = {
  getEmployees(params: EmployeeListParams, signal?: AbortSignal) {
    return apiClient.get<PaginatedResponse<EmployeeSummary>>(`${HR_PREFIX}/employees`, {
      query: params,
      signal,
    });
  },

  getEmployee(employeeId: string, signal?: AbortSignal) {
    return apiClient.get<EmployeeDetail>(`${HR_PREFIX}/employees/${employeeId}`, { signal });
  },

  createEmployee(input: EmployeeCreateInput) {
    return apiClient.post<EmployeeDetail>(`${HR_PREFIX}/employees`, {
      body: input,
      idempotencyKey: true,
    });
  },

  updateEmployee(employeeId: string, input: EmployeeUpdateInput) {
    return apiClient.patch<EmployeeDetail>(`${HR_PREFIX}/employees/${employeeId}`, {
      body: input,
    });
  },

  deleteEmployee(employeeId: string) {
    return apiClient.delete<void>(`${HR_PREFIX}/employees/${employeeId}`);
  },

  changeEmployeeStatus(employeeId: string, input: ChangeEmployeeStatusInput) {
    return apiClient.post<EmployeeDetail>(`${HR_PREFIX}/employees/${employeeId}/change-status`, {
      body: input,
      idempotencyKey: true,
    });
  },

  linkEmployeeUser(employeeId: string, input: LinkEmployeeUserInput) {
    return apiClient.post<EmployeeDetail>(`${HR_PREFIX}/employees/${employeeId}/link-user`, {
      body: input,
      idempotencyKey: true,
    });
  },

  unlinkEmployeeUser(employeeId: string) {
    return apiClient.delete<EmployeeDetail>(`${HR_PREFIX}/employees/${employeeId}/link-user`);
  },

  getMyProfile(signal?: AbortSignal) {
    return apiClient.get<EmployeeDetail>(`${HR_PREFIX}/me/profile`, { signal });
  },

  getProfileChangeRequests(params: ProfileChangeRequestListParams, signal?: AbortSignal) {
    return apiClient.get<PaginatedResponse<ProfileChangeRequest>>(
      `${HR_PREFIX}/profile-change-requests`,
      { query: params, signal },
    );
  },

  getProfileChangeRequest(requestId: string, signal?: AbortSignal) {
    return apiClient.get<ProfileChangeRequest>(
      `${HR_PREFIX}/profile-change-requests/${requestId}`,
      { signal },
    );
  },

  createProfileChangeRequest(input: CreateProfileChangeRequestInput) {
    return apiClient.post<ProfileChangeRequest>(`${HR_PREFIX}/me/profile-change-requests`, {
      body: input,
      idempotencyKey: true,
    });
  },

  approveProfileChangeRequest(requestId: string, input: ReviewProfileChangeInput) {
    return apiClient.post<ProfileChangeRequest>(
      `${HR_PREFIX}/profile-change-requests/${requestId}/approve`,
      { body: input, idempotencyKey: true },
    );
  },

  rejectProfileChangeRequest(requestId: string, input: ReviewProfileChangeInput) {
    return apiClient.post<ProfileChangeRequest>(
      `${HR_PREFIX}/profile-change-requests/${requestId}/reject`,
      { body: input, idempotencyKey: true },
    );
  },

  cancelProfileChangeRequest(requestId: string) {
    return apiClient.post<void>(`${HR_PREFIX}/me/profile-change-requests/${requestId}/cancel`, {
      body: {},
    });
  },

  getDepartments(signal?: AbortSignal) {
    return apiClient.get<DepartmentNode[]>(`${HR_PREFIX}/departments`, { signal });
  },

  createDepartment(input: DepartmentInput) {
    return apiClient.post<DepartmentNode>(`${HR_PREFIX}/departments`, { body: input });
  },

  updateDepartment(departmentId: string, input: DepartmentInput) {
    return apiClient.patch<DepartmentNode>(`${HR_PREFIX}/departments/${departmentId}`, { body: input });
  },

  deleteDepartment(departmentId: string) {
    return apiClient.delete<void>(`${HR_PREFIX}/departments/${departmentId}`);
  },

  getPositions(params?: PositionListParams, signal?: AbortSignal) {
    return apiClient.get<PaginatedResponse<PositionSummary>>(`${HR_PREFIX}/positions`, {
      query: params,
      signal,
    });
  },

  getEmployeeContracts(employeeId: string, signal?: AbortSignal) {
    return apiClient.get<EmployeeContract[]>(`${HR_PREFIX}/employees/${employeeId}/contracts`, {
      signal,
    });
  },

  getEmployeeCodeConfig(signal?: AbortSignal) {
    return apiClient.get<EmployeeCodeConfig>(`${HR_PREFIX}/employee-code-config`, { signal });
  },

  updateEmployeeCodeConfig(input: EmployeeCodeConfigInput) {
    return apiClient.put<EmployeeCodeConfig>(`${HR_PREFIX}/employee-code-config`, { body: input });
  },

  previewEmployeeCode(input?: EmployeeCodePreviewInput) {
    return apiClient.post<{ next_code: string }>(`${HR_PREFIX}/employee-code/preview`, {
      body: input ?? {},
    });
  },
};
```

### 13.2 Query key factory `hr.keys.ts`

```ts
export const hrKeys = {
  all: ['hr'] as const,

  employees: () => [...hrKeys.all, 'employees'] as const,
  employeeList: (params: EmployeeListParams) => [...hrKeys.employees(), 'list', params] as const,
  employeeDetail: (employeeId: string) => [...hrKeys.employees(), 'detail', employeeId] as const,
  employeeContracts: (employeeId: string) => [...hrKeys.employeeDetail(employeeId), 'contracts'] as const,
  employeeFiles: (employeeId: string) => [...hrKeys.employeeDetail(employeeId), 'files'] as const,

  myProfile: () => [...hrKeys.all, 'me', 'profile'] as const,
  myProfileChangeRequests: (params: ProfileChangeRequestListParams) =>
    [...hrKeys.all, 'me', 'profile-change-requests', params] as const,

  profileChangeRequests: () => [...hrKeys.all, 'profile-change-requests'] as const,
  profileChangeRequestList: (params: ProfileChangeRequestListParams) =>
    [...hrKeys.profileChangeRequests(), 'list', params] as const,
  profileChangeRequestDetail: (requestId: string) =>
    [...hrKeys.profileChangeRequests(), 'detail', requestId] as const,

  departments: () => [...hrKeys.all, 'departments'] as const,
  positions: (params?: PositionListParams) => [...hrKeys.all, 'positions', params ?? {}] as const,
  jobLevels: () => [...hrKeys.all, 'job-levels'] as const,
  contractTypes: () => [...hrKeys.all, 'contract-types'] as const,
  employeeCodeConfig: () => [...hrKeys.all, 'employee-code-config'] as const,
  employeeCodePreview: () => [...hrKeys.employeeCodeConfig(), 'preview'] as const,
  orgChart: () => [...hrKeys.all, 'org-chart'] as const,
  audit: (params: HrAuditParams) => [...hrKeys.all, 'audit', params] as const,
};
```

---

## 14. Query hook và mutation hook

### 14.1 Employee query hooks

```ts
export function useEmployeeListQuery(params: EmployeeListParams) {
  return useQuery({
    queryKey: hrKeys.employeeList(params),
    queryFn: ({ signal }) => hrApi.getEmployees(params, signal),
    keepPreviousData: true,
    staleTime: 30_000,
  });
}

export function useEmployeeDetailQuery(employeeId: string) {
  return useQuery({
    queryKey: hrKeys.employeeDetail(employeeId),
    queryFn: ({ signal }) => hrApi.getEmployee(employeeId, signal),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  });
}
```

### 14.2 Employee mutation hooks

```ts
export function useCreateEmployeeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: hrApi.createEmployee,
    onSuccess: async (employee) => {
      await queryClient.invalidateQueries({ queryKey: hrKeys.employees() });
      await queryClient.invalidateQueries({ queryKey: hrKeys.employeeCodePreview() });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Đã tạo nhân viên mới');
      return employee;
    },
  });
}

export function useUpdateEmployeeMutation(employeeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EmployeeUpdateInput) => hrApi.updateEmployee(employeeId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hrKeys.employeeDetail(employeeId) }),
        queryClient.invalidateQueries({ queryKey: hrKeys.employees() }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success('Đã cập nhật hồ sơ nhân viên');
    },
  });
}
```

### 14.3 Profile change hooks

```ts
export function useCreateProfileChangeRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: hrApi.createProfileChangeRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hrKeys.myProfile() }),
        queryClient.invalidateQueries({ queryKey: hrKeys.profileChangeRequests() }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      toast.success('Đã gửi yêu cầu cập nhật hồ sơ');
    },
  });
}

export function useApproveProfileChangeRequestMutation(requestId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ReviewProfileChangeInput) =>
      hrApi.approveProfileChangeRequest(requestId, input),
    onSuccess: async (request) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hrKeys.profileChangeRequests() }),
        queryClient.invalidateQueries({ queryKey: hrKeys.profileChangeRequestDetail(requestId) }),
        queryClient.invalidateQueries({ queryKey: hrKeys.employeeDetail(request.employee.id) }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      toast.success('Đã duyệt yêu cầu cập nhật hồ sơ');
    },
  });
}
```

---

## 15. Form schema và validation

### 15.1 Employee create/update schema

```ts
import { z } from 'zod';

export const employeeBaseSchema = z.object({
  employee_code: z.string().trim().optional(),
  first_name: z.string().trim().min(1, 'Vui lòng nhập tên'),
  last_name: z.string().trim().min(1, 'Vui lòng nhập họ'),
  full_name: z.string().trim().min(1, 'Vui lòng nhập họ tên'),
  gender: z.enum(['Male', 'Female', 'Other']).optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  personal_email: z.string().email('Email cá nhân không hợp lệ').optional().or(z.literal('')),
  company_email: z.string().email('Email công ty không hợp lệ'),
  phone: z.string().trim().optional().nullable(),
  identity_number: z.string().trim().optional().nullable(),
  tax_code: z.string().trim().optional().nullable(),
  bank_account_number: z.string().trim().optional().nullable(),
  bank_name: z.string().trim().optional().nullable(),
  department_id: z.string().uuid('Vui lòng chọn phòng ban'),
  position_id: z.string().uuid('Vui lòng chọn chức vụ'),
  job_level_id: z.string().uuid().optional().nullable(),
  direct_manager_id: z.string().uuid().optional().nullable(),
  joined_date: z.string().min(1, 'Vui lòng chọn ngày vào làm'),
  official_date: z.string().optional().nullable(),
  probation_end_date: z.string().optional().nullable(),
  employment_status: z.enum([
    'Probation',
    'Official',
    'Temporarily Suspended',
    'Resigned',
    'Terminated',
    'Onboarding',
  ]),
  employee_type: z.enum(['Full-time', 'Part-time', 'Intern', 'Contractor']).optional(),
  work_location: z.string().trim().optional().nullable(),
  create_user_account: z.boolean().optional(),
});

export const employeeCreateSchema = employeeBaseSchema.superRefine((value, ctx) => {
  if (value.official_date && value.joined_date && value.official_date < value.joined_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['official_date'],
      message: 'Ngày chính thức không được trước ngày vào làm',
    });
  }
});
```

### 15.2 Profile change schema

```ts
export const profileChangeRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do cập nhật'),
  changes: z
    .array(
      z.object({
        field_name: z.string(),
        old_value: z.unknown().optional(),
        new_value: z.unknown(),
      }),
    )
    .min(1, 'Vui lòng thay đổi ít nhất một thông tin'),
});
```

### 15.3 Employee status change schema

```ts
export const employeeStatusChangeSchema = z.object({
  status: z.enum(['Probation', 'Official', 'Temporarily Suspended', 'Resigned', 'Terminated']),
  effective_date: z.string().min(1, 'Vui lòng chọn ngày hiệu lực'),
  reason: z.string().trim().min(1, 'Vui lòng nhập lý do'),
  lock_user_account: z.boolean().optional(),
});
```

---

## 16. Component thiết kế riêng cho HR

### 16.1 `EmployeeProfileHeader`

Vai trò: hiển thị header trong detail page.

Props đề xuất:

```ts
interface EmployeeProfileHeaderProps {
  employee: EmployeeDetail;
  canEdit: boolean;
  canChangeStatus: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onChangeStatus: () => void;
  onDelete: () => void;
}
```

Hiển thị:

1. Avatar.
2. Họ tên.
3. Mã nhân viên.
4. Company email.
5. Department.
6. Position.
7. Employment status badge.
8. User link badge: đã liên kết/chưa liên kết.
9. Action: Sửa, đổi trạng thái, liên kết user, More.

### 16.2 `EmployeeSensitiveField`

Vai trò: hiển thị field nhạy cảm an toàn.

```tsx
export function EmployeeSensitiveField({
  label,
  value,
  permission,
}: EmployeeSensitiveFieldProps) {
  if (!permission.visible) return null;

  return (
    <DetailField
      label={label}
      value={permission.masked ? <MaskedField value={String(value ?? '')} /> : value || '-'}
      helperText={permission.reason}
    />
  );
}
```

### 16.3 `ProfileChangeDiffTable`

Vai trò: so sánh dữ liệu cũ và mới.

Cột:

| Field | Nội dung |
| --- | --- |
| Trường | Tên field người dùng hiểu được |
| Giá trị hiện tại | Old value, masked nếu nhạy cảm |
| Giá trị đề xuất | New value |
| Trạng thái | Pending/Approved/Rejected |

### 16.4 `EmployeeCodePreview`

Vai trò: hiển thị mã nhân viên dự kiến khi tạo mới.

State:

| State | UI |
| --- | --- |
| Loading | Skeleton nhỏ |
| Success | Badge mã dự kiến |
| Error | Alert nhỏ + retry |
| Manual override allowed | Checkbox/nút “Sửa thủ công” |
| Locked | Tooltip “Mã sẽ được khóa sau khi tạo” |

---

## 17. Triển khai màn danh sách nhân viên

### 17.1 Mục tiêu

Màn danh sách nhân viên là màn P0 của HR. Màn này cần hỗ trợ HR/Manager tìm kiếm nhanh, lọc dữ liệu và điều hướng vào chi tiết hồ sơ.

### 17.2 Layout

```text
Breadcrumb: Home / Nhân sự / Danh sách nhân viên
PageHeader:
  Title: Nhân viên
  Description: Quản lý hồ sơ nhân viên trong phạm vi được phân quyền
  Actions: Export, + Thêm nhân viên

FilterBar:
  Search keyword
  Department
  Position
  Employment status
  Employee type
  Has user
  Joined date range
  More filters

DataTable:
  Employee
  Department
  Position
  Direct manager
  Status
  Joined date
  User link
  Actions

Pagination
```

### 17.3 Column đề xuất

| Cột | Nội dung | Ghi chú |
| --- | --- | --- |
| Nhân viên | Avatar, full_name, employee_code, company_email | Link detail |
| Phòng ban | department.name | Có filter |
| Chức vụ | position.name | Có filter |
| Quản lý trực tiếp | direct_manager.full_name | Optional |
| Trạng thái | employment_status badge | Color theo status token |
| Ngày vào làm | joined_date | Format ngày |
| Tài khoản | Linked/Unlinked badge | Liên kết AUTH |
| Action | Xem, sửa, đổi trạng thái, xóa mềm | Theo quyền |

### 17.4 Filter state

```ts
export interface EmployeeListParams {
  page: number;
  per_page: number;
  search?: string;
  department_id?: string;
  position_id?: string;
  job_level_id?: string;
  direct_manager_id?: string;
  employment_status?: EmploymentStatus;
  employee_type?: EmployeeType;
  joined_from?: string;
  joined_to?: string;
  contract_type_id?: string;
  has_user?: boolean;
  sort?: string;
}
```

### 17.5 State bắt buộc

| State | UI |
| --- | --- |
| Loading | Table skeleton 10 rows |
| Empty no filter | EmptyState + CTA thêm nhân viên nếu có quyền |
| Empty with filter | EmptyState “Không tìm thấy nhân viên phù hợp” + clear filters |
| Error | ErrorState + retry + request id |
| Forbidden | ForbiddenState không lộ dữ liệu |
| Scope limited | Info banner nhỏ: “Bạn đang xem dữ liệu trong phạm vi được phân quyền” |
| Export loading | Disable export button + progress/toast |

---

## 18. Triển khai Employee Detail

### 18.1 Route

```text
/hr/employees/:employeeId
```

### 18.2 Layout

```text
Breadcrumb
EmployeeProfileHeader
Tabs:
- Tổng quan
- Thông tin cá nhân
- Thông tin công việc
- Hợp đồng
- File hồ sơ
- Lịch sử thay đổi
```

### 18.3 Tab Tổng quan

Hiển thị các card:

1. Thông tin cơ bản.
2. Trạng thái làm việc.
3. Phòng ban/chức vụ/quản lý trực tiếp.
4. Tài khoản đăng nhập.
5. Hợp đồng chính.
6. Cảnh báo nếu hợp đồng sắp hết hạn, chưa link user, thiếu thông tin bắt buộc.

### 18.4 Tab Thông tin cá nhân

Các field nhạy cảm dùng `EmployeeSensitiveField`:

1. Ngày sinh.
2. Email cá nhân.
3. Số điện thoại.
4. Địa chỉ.
5. CCCD/CMND.
6. Mã số thuế.
7. Tài khoản ngân hàng.
8. Liên hệ khẩn cấp.

### 18.5 Tab Thông tin công việc

1. Mã nhân viên.
2. Email công ty.
3. Phòng ban.
4. Chức vụ.
5. Cấp bậc.
6. Quản lý trực tiếp.
7. Ngày vào làm.
8. Ngày chính thức.
9. Trạng thái.
10. Loại nhân viên.
11. Địa điểm làm việc.

### 18.6 Tab Hợp đồng

Chỉ hiển thị nếu user có `HR.CONTRACT.VIEW`.

Action:

1. Thêm hợp đồng nếu có `HR.CONTRACT.CREATE`.
2. Sửa hợp đồng nếu có `HR.CONTRACT.UPDATE`.
3. Xóa mềm nếu có `HR.CONTRACT.DELETE`.
4. Xem/tải file hợp đồng nếu có quyền file tương ứng.

### 18.7 Tab File hồ sơ

Chỉ hiển thị nếu user có `HR.EMPLOYEE.FILE_VIEW`.

File item:

1. Tên file.
2. Loại file.
3. Dung lượng.
4. Ngày upload.
5. Người upload.
6. Nhãn nhạy cảm nếu có.
7. Action xem/tải/xóa theo quyền.

### 18.8 Tab Lịch sử thay đổi

Chỉ hiển thị nếu có `HR.AUDIT_LOG.VIEW`.

Hiển thị timeline:

1. Actor.
2. Action.
3. Field thay đổi.
4. Old/new value nếu được phép.
5. Thời điểm.
6. Request id/audit id nếu cần.

---

## 19. Triển khai Employee Form

### 19.1 Route

```text
/hr/employees/new
/hr/employees/:employeeId/edit
```

### 19.2 Form sections

```text
Section 1: Thông tin cơ bản
- Họ tên
- Giới tính
- Ngày sinh
- Email cá nhân
- Số điện thoại

Section 2: Thông tin định danh
- CCCD/CMND
- Ngày cấp
- Nơi cấp
- Mã số thuế

Section 3: Thông tin công việc
- Mã nhân viên
- Email công ty
- Phòng ban
- Chức vụ
- Cấp bậc
- Quản lý trực tiếp
- Ngày vào làm
- Ngày chính thức
- Trạng thái
- Loại nhân viên
- Địa điểm làm việc

Section 4: Tài khoản đăng nhập
- Tạo tài khoản đăng nhập?
- Email tài khoản
- Role mặc định nếu backend hỗ trợ

Section 5: Hợp đồng ban đầu nếu MVP hỗ trợ inline
- Loại hợp đồng
- Mã hợp đồng
- Ngày bắt đầu
- Ngày kết thúc
- File hợp đồng
```

### 19.3 Employee code behavior

Create mode:

1. Gọi preview code khi page load.
2. Hiển thị `EmployeeCodePreview`.
3. Field read-only mặc định.
4. Nếu preview lỗi, cho phép reload preview.
5. Nếu manual override được phép, hiển thị toggle “Nhập mã thủ công”.

Edit mode:

1. Nếu `is_employee_code_locked = true`, luôn read-only.
2. Nếu chưa locked và user có quyền override, cho sửa.
3. Khi submit, chỉ gửi `employee_code` nếu field editable và có thay đổi.

### 19.4 Dropdown data

Form cần preload:

1. Departments.
2. Positions.
3. Job levels.
4. Direct manager candidates.
5. Contract types nếu có inline contract.

Các dropdown này nên cache lâu hơn employee list:

```ts
staleTime: 5 * 60_000
```

### 19.5 Submit behavior

| Case | Behavior |
| --- | --- |
| Create success | Toast + redirect detail employee mới |
| Update success | Toast + redirect hoặc ở lại detail |
| 422 validation | Map lỗi vào field + error summary |
| 403 forbidden | Forbidden toast/dialog, không retry vô hạn |
| Conflict duplicate email/code | Hiển thị lỗi đúng field |
| Dirty form | Confirm khi rời route |
| Double submit | Disable submit khi loading |

---

## 20. Triển khai My Profile

### 20.1 Route

```text
/hr/me/profile
```

### 20.2 API

```http
GET /api/v1/hr/me/profile
```

### 20.3 UI layout

```text
PageHeader: Hồ sơ của tôi
EmployeeProfileHeader compact
Tabs:
- Thông tin cá nhân
- Thông tin công việc
- Yêu cầu cập nhật
```

### 20.4 Action

| Action | Điều kiện |
| --- | --- |
| Gửi yêu cầu cập nhật | Có `HR.PROFILE_CHANGE_REQUEST.CREATE` và API trả editable_fields |
| Xem yêu cầu của tôi | Có `HR.PROFILE_CHANGE_REQUEST.VIEW_OWN` |
| Hủy yêu cầu pending | Có `HR.PROFILE_CHANGE_REQUEST.CANCEL_OWN` và request status Pending |

### 20.5 Không được làm

1. Không gọi update employee trực tiếp khi user là employee thường.
2. Không tự cho sửa field nhạy cảm nếu backend không trả `editable_fields`.
3. Không hiển thị field không tồn tại trong response như dữ liệu trống.

---

## 21. Triển khai Profile Change Request

### 21.1 Employee tạo yêu cầu

Có thể dùng Drawer hoặc Page riêng.

Flow:

```text
My Profile
-> Click Chỉnh sửa thông tin
-> Mở form các field editable
-> User thay đổi field
-> Frontend tạo diff
-> User nhập lý do
-> Submit
-> Toast thành công
-> Invalidate my profile change requests + notifications
```

### 21.2 HR/Admin danh sách yêu cầu

Route:

```text
/hr/profile-change-requests
```

Column:

| Cột | Nội dung |
| --- | --- |
| Mã yêu cầu | request_code |
| Nhân viên | employee summary |
| Số field thay đổi | items.length |
| Trạng thái | Pending/Approved/Rejected/Cancelled |
| Ngày gửi | submitted_at |
| Người duyệt | reviewed_by |
| Action | Xem, duyệt, từ chối |

Filter:

1. Keyword employee.
2. Status.
3. Department.
4. Submitted date range.
5. Reviewed by.

### 21.3 Detail/approval UI

```text
ProfileChangeRequestDetail
- Header: request_code, status, employee
- Reason
- DiffTable old/new
- Timeline
- ApprovalBox: approve/reject note
```

Approve:

1. Confirm dialog nếu field nhạy cảm.
2. Submit `approve`.
3. Invalidate request detail/list, employee detail, my profile nếu liên quan.

Reject:

1. Bắt buộc nhập lý do từ chối.
2. Submit `reject`.
3. Toast + invalidate.

### 21.4 Conflict handling

Nếu backend trả lỗi “Dữ liệu hồ sơ đã thay đổi kể từ khi yêu cầu được tạo”, frontend phải:

1. Hiển thị Alert trong detail.
2. Disable approve.
3. Cho HR xem lại dữ liệu hiện tại nếu API hỗ trợ reload.
4. Gợi ý từ chối yêu cầu cũ và yêu cầu employee gửi lại.

---

## 22. Triển khai Department

### 22.1 Route

```text
/hr/departments
```

### 22.2 UI

Desktop ưu tiên split view:

```text
Left: DepartmentTree
Right: Department detail / form drawer
```

Mobile:

```text
List card -> click mở detail drawer/fullscreen
```

### 22.3 Department actions

| Action | Permission |
| --- | --- |
| Tạo phòng ban | `HR.DEPARTMENT.CREATE` |
| Sửa phòng ban | `HR.DEPARTMENT.UPDATE` |
| Xóa mềm phòng ban | `HR.DEPARTMENT.DELETE` |
| Chọn manager | Cần employee dropdown trong scope |

### 22.4 Business error cần xử lý

| Error | UI |
| --- | --- |
| Trùng department code | Field error |
| Parent tạo vòng lặp | Form error + highlight parent |
| Xóa department còn employee active | BusinessRule alert, không xóa |
| Không có quyền | Ẩn action hoặc ForbiddenState |

---

## 23. Triển khai Position, Job Level, Contract Type

### 23.1 Pattern chung

Các màn danh mục dùng chung `MasterDataPageTemplate`.

```text
PageHeader
Filter/Search
DataTable
Create/Edit Drawer
Confirm Delete Dialog
```

### 23.2 Position

Column:

1. Mã chức vụ.
2. Tên chức vụ.
3. Department nếu có.
4. Job level nếu có.
5. Trạng thái.
6. Action.

### 23.3 Job Level

Column:

1. Mã cấp bậc.
2. Tên cấp bậc.
3. Thứ tự.
4. Mô tả.
5. Trạng thái.

### 23.4 Contract Type

Column:

1. Mã loại hợp đồng.
2. Tên loại hợp đồng.
3. Thời hạn mặc định nếu có.
4. Trạng thái.

---

## 24. Triển khai Employee Contract

### 24.1 Hiển thị

Trong tab hợp đồng của Employee Detail hoặc route contract list.

Column:

1. Mã hợp đồng.
2. Loại hợp đồng.
3. Tiêu đề.
4. Ngày bắt đầu.
5. Ngày kết thúc.
6. Trạng thái.
7. Primary badge.
8. File.
9. Action.

### 24.2 Form hợp đồng

Field:

1. Contract type.
2. Contract code.
3. Title.
4. Start date.
5. End date.
6. Signed date.
7. Status.
8. Is primary.
9. File upload.

Validation frontend:

1. `end_date` không được trước `start_date`.
2. `signed_date` có thể trước hoặc bằng start date tùy rule backend.
3. Nếu set primary, hiển thị note: “Hợp đồng chính hiện tại sẽ bị bỏ đánh dấu chính nếu backend áp dụng rule này.”

---

## 25. Triển khai Employee File

### 25.1 File list

File item:

1. Icon theo mime type.
2. File name.
3. Size.
4. Category.
5. Uploaded by.
6. Uploaded at.
7. Sensitive flag nếu có.
8. Action xem/tải/xóa.

### 25.2 Upload

Dùng upload service chung:

```text
Select file
-> Validate type/size phía frontend
-> Upload qua foundation/file API hoặc HR file endpoint
-> Link file với employee
-> Invalidate employee files
```

### 25.3 Security UX

1. Không render raw download URL nếu API yêu cầu signed URL.
2. Khi user click tải file, gọi API lấy URL hoặc blob.
3. Nếu 403, hiển thị toast “Bạn không có quyền xem file này”.
4. Với file nhạy cảm, có thể hiển thị confirm trước khi tải nếu sản phẩm yêu cầu audit awareness.

---

## 26. Triển khai Employee Code Settings

### 26.1 Route

```text
/hr/settings/employee-code
```

### 26.2 UI

```text
PageHeader: Cấu hình mã nhân viên
Settings Card:
- Prefix
- Padding length (padding_length)
- Separator/pattern
- Reset rule (Never/Yearly/Monthly/Daily)
- Next sequence preview
- Allow manual override (allow_manual_override)
- Lock code after create (lock_after_created)
Actions:
- Preview mã tiếp theo (POST /api/v1/hr/employee-code/preview)
- Lưu cấu hình
```

### 26.3 Validation

1. Prefix không rỗng nếu pattern yêu cầu prefix.
2. `padding_length` trong giới hạn backend quy định (1-12).
3. Pattern phải chứa sequence token nếu backend yêu cầu.
4. Reset rule chỉ nhận giá trị hợp lệ (Never/Yearly/Monthly/Daily).
5. Preview phải gọi backend, frontend không tự tính mã cuối cùng.

### 26.4 UX note

Khi thay đổi cấu hình, hiển thị Alert:

```text
Thay đổi cấu hình mã nhân viên chỉ áp dụng cho nhân viên tạo mới. Mã nhân viên cũ không bị thay đổi.
```

---

## 27. Triển khai Org Chart

### 27.1 MVP approach

Nếu chưa có graph component ổn định, MVP dùng tree/list:

```text
Company
- Ban Giám đốc
  - Phòng Nhân sự
  - Phòng Kỹ thuật
    - Team Backend
    - Team Frontend
```

Mỗi node hiển thị:

1. Department name.
2. Manager.
3. Số nhân viên.
4. Link xem nhân viên trong department.

### 27.2 State

| State | UI |
| --- | --- |
| Loading | Tree skeleton |
| Empty | Chưa có phòng ban |
| Error | ErrorState retry |
| Forbidden | ForbiddenState |

---

## 28. Tích hợp với module khác

### 28.1 AUTH

HR cần AUTH để:

1. Hiển thị trạng thái liên kết tài khoản.
2. Tạo/link/unlink user cho employee nếu có quyền.
3. Dùng auth context để biết permission và data scope.
4. Clear cache HR khi logout.

Frontend HR không tự tạo user bằng API AUTH nếu nghiệp vụ HR đã có endpoint link/create user riêng. Nếu cần gọi AUTH, phải đi qua flow đã được API chốt.

### 28.2 DASH

Sau các mutation sau cần invalidate dashboard cache/query:

1. Tạo nhân viên.
2. Đổi trạng thái nhân viên.
3. Duyệt profile change request.
4. Cập nhật phòng ban/chức vụ quan trọng.
5. Cập nhật hợp đồng nếu dashboard có widget hợp đồng sắp hết hạn.

### 28.3 NOTI

Sau các action phát event backend:

1. Employee gửi profile change request.
2. HR duyệt/từ chối request.
3. Hợp đồng sắp hết hạn hoặc thay đổi trạng thái.

Frontend chỉ invalidate notification dropdown/unread sau mutation thành công, không tự tạo notification.

### 28.4 ATT/LEAVE/TASK

HR cung cấp dropdown employee/department/position cho các module sau. Để tránh duplicate code, nên tạo shared hook hoặc endpoint selector:

```ts
useEmployeeOptionsQuery(params)
useDepartmentOptionsQuery()
usePositionOptionsQuery()
```

Các hook này vẫn nằm trong HR module hoặc shared domain tùy kiến trúc, nhưng không được gọi API rời rạc ngoài API client chung.

---

## 29. State management HR

### 29.1 Server-state

Dùng TanStack Query cho:

1. Employee list/detail.
2. My profile.
3. Profile change requests.
4. Departments.
5. Positions/job levels/contract types.
6. Contracts/files.
7. Employee code config/preview.
8. Org chart.

### 29.2 URL-state

Các state sau nên đồng bộ URL:

1. Employee list search/filter/page/sort.
2. Profile change request list filter/page/sort.
3. Department selected node nếu cần.
4. Active tab detail employee.

Ví dụ:

```text
/hr/employees?page=1&per_page=20&search=nguyen&department_id=...&employment_status=Official
/hr/employees/:id?tab=contracts
```

### 29.3 Form-state

Dùng React Hook Form + Zod:

1. Employee create/update.
2. Department/position/job level/contract type form.
3. Employee contract form.
4. Profile change request form.
5. Employee code config form.
6. Status change dialog.

### 29.4 UI-state local

Dùng local state/Zustand nhẹ nếu cần cho:

1. Drawer open/close.
2. Selected row.
3. Bulk selection.
4. Preview diff.
5. Confirm dialog state.

Không đưa server data HR vào global store nếu TanStack Query đã quản lý.

---

## 30. Error handling HR

### 30.1 Lỗi phổ biến

| HTTP/API case | UI behavior |
| --- | --- |
| 401 | API client refresh token hoặc redirect login |
| 403 | ForbiddenState hoặc toast nếu action-level |
| 404 employee | NotFoundState “Không tìm thấy nhân viên” |
| 409 duplicate code/email | Field error tương ứng |
| 422 validation | Field error + error summary |
| 423/Business rule department has active employee | Alert trong confirm dialog |
| 500 | ErrorState + retry + request id |

### 30.2 Error mapping trong form

```ts
function mapHrFormError(error: unknown, form: UseFormReturn<any>) {
  if (isValidationApiError(error)) {
    applyValidationErrorsToForm(error.details, form);
    return;
  }

  if (isConflictApiError(error)) {
    toast.error(error.message || 'Dữ liệu đã tồn tại');
    return;
  }

  showApiErrorToast(error);
}
```

---

## 31. Responsive behavior

### 31.1 Desktop

1. Employee list dùng full DataTable.
2. Employee detail dùng tab ngang.
3. Employee form dùng 2 cột cho section phù hợp.
4. Department dùng split tree/detail.
5. Profile change diff table hiển thị 3 cột đầy đủ.

### 31.2 Tablet

1. Sidebar collapsed/drawer theo ModuleWorkspaceLayout.
2. Table cho phép horizontal scroll hoặc column priority.
3. Employee detail summary full width, tab ngang hoặc scroll.
4. Form 1-2 cột tùy độ rộng.

### 31.3 Mobile web

1. Employee list chuyển thành card list.
2. Filter mở bằng drawer.
3. Employee detail dùng accordion/tabs stack.
4. Form full width.
5. Profile change diff table chuyển thành card diff từng field.
6. Department tree chuyển thành nested list.
7. Một số màn admin phức tạp có thể hiện banner khuyến nghị dùng desktop.

---

## 32. Performance notes

1. Employee list chỉ lấy summary DTO, không lấy detail nặng.
2. Detail page lazy load contracts/files/audit theo active tab.
3. Dropdown employee manager nên debounce search, không tải toàn bộ nếu công ty lớn.
4. Department/position/job level có thể cache 5 phút.
5. Sensitive file download chỉ lấy URL khi user click.
6. Employee list table nên memo columns theo permission.
7. Không render toàn bộ org chart nếu số phòng ban lớn; dùng lazy expand.
8. Export phải là API/job riêng, không export bằng dữ liệu table hiện tại nếu dữ liệu lớn.

---

## 33. Accessibility checklist HR

| Hạng mục | Yêu cầu |
| --- | --- |
| Form label | Mọi input có label rõ ràng |
| Required | Có indicator nhưng không chỉ dùng màu |
| Error | Error message liên kết với field |
| Keyboard | Table action, drawer, modal dùng được bằng keyboard |
| Focus trap | Modal/drawer phải trap focus |
| Confirm dialog | Nút nguy hiểm có label rõ |
| Status badge | Có text, không chỉ màu |
| Masked field | Screen reader không đọc dữ liệu nhạy cảm nếu đã mask |
| File upload | Có mô tả định dạng/kích thước |
| Org tree | Node có role/tree semantics nếu dùng tree component |

---

## 34. Test plan frontend HR

### 34.1 Unit test

| Nhóm | Test |
| --- | --- |
| Formatter | Format employee name/code/status/date |
| Permission utils | canViewSensitive, canEditEmployee, canManualOverrideCode |
| Diff utils | Tạo diff profile change chính xác |
| Mapper | API DTO -> form values -> payload |
| Validation schema | Required, date rule, email, status change reason |

### 34.2 Component test

| Component | Test |
| --- | --- |
| EmployeeStatusBadge | Render đúng status |
| EmployeeSensitiveField | Mask/hide/show đúng permission |
| EmployeeProfileHeader | Action theo permission |
| EmployeeCodePreview | Loading/success/error/manual override |
| ProfileChangeDiffTable | Render old/new/masked values |
| DepartmentTree | Expand/collapse/select node |

### 34.3 Integration test

| Flow | Expected |
| --- | --- |
| Employee list load | Gọi API với query params đúng |
| Search/filter employee | Update URL + refetch |
| Create employee | Submit payload đúng + redirect detail |
| Edit employee | Load default values + patch changed payload |
| My profile change request | Tạo diff + submit request |
| Approve profile change | Invalidate employee detail + request list |
| Department CRUD | Drawer form + invalidate department tree |
| Employee code config | Preview + save + validation error |

### 34.4 E2E P0

1. HR vào danh sách nhân viên, search/filter và mở detail.
2. HR tạo nhân viên mới với mã tự sinh.
3. HR sửa hồ sơ nhân viên.
4. HR đổi trạng thái nhân viên.
5. Employee mở Hồ sơ của tôi và gửi yêu cầu cập nhật.
6. HR duyệt yêu cầu cập nhật hồ sơ.
7. User thiếu quyền sensitive không thấy dữ liệu nhạy cảm.
8. Manager scope Team chỉ thấy dữ liệu trong team.
9. HR tạo phòng ban/chức vụ cơ bản.
10. HR xem/tải file hồ sơ theo quyền.

---

## 35. Acceptance criteria

FRONTEND-08 được xem là đạt khi:

1. HR app hiển thị trong Home Portal/App Switcher theo permission.
2. `/hr` và các route HR chạy trong `ModuleWorkspaceLayout`.
3. Sidebar HR hiển thị menu đúng theo permission/data scope.
4. Employee list có search/filter/sort/pagination và state đầy đủ.
5. Employee detail có header, tab thông tin, hợp đồng, file và lịch sử theo quyền.
6. Employee create/update form validate tốt, chống double submit và có dirty form guard.
7. Mã nhân viên tự sinh hiển thị preview và khóa/override đúng rule.
8. My Profile không cập nhật trực tiếp hồ sơ chính, chỉ tạo profile change request.
9. Profile change request có list/detail/diff/approve/reject/cancel theo quyền.
10. Department/position/job level/contract type dùng chung pattern danh mục và xử lý business error.
11. Contract/file tab hoạt động theo quyền, không lộ file private.
12. Dữ liệu nhạy cảm được mask/ẩn đúng theo API response và permission.
13. Tất cả API call đi qua API client chung và query hook convention.
14. Mutation quan trọng invalidate đúng employee, dashboard, notification và related query.
15. Loading, empty, error, forbidden, validation, stale và no-data-due-to-scope state đầy đủ.
16. Responsive đạt desktop/tablet/mobile web cho P0 screens.
17. Unit/component/integration/E2E test P0 có checklist rõ.
18. Không hard-code role name cho bảo mật; dùng permission/data scope từ auth context và API.
19. Không tự truyền `company_id` cho API HR thông thường.
20. Không lưu dữ liệu nhạy cảm HR vào localStorage/sessionStorage.

---

## 36. Kế hoạch triển khai theo sprint

### Sprint HR-FE-01: HR core read

1. HR route registry.
2. HR sidebar registry.
3. HR API service + query keys.
4. Employee list page.
5. Employee detail read-only.
6. My Profile read-only.
7. Sensitive field masking.

### Sprint HR-FE-02: Employee write

1. Employee create form.
2. Employee edit form.
3. Employee code preview.
4. Employee status change dialog.
5. Employee user link/unlink UI nếu API sẵn sàng.
6. Form validation + dirty guard.

### Sprint HR-FE-03: Organization master data

1. Department tree/list CRUD.
2. Position CRUD.
3. Job level CRUD.
4. Contract type CRUD.
5. Org chart MVP.

### Sprint HR-FE-04: Contract, file, audit

1. Employee contracts tab.
2. Contract form drawer.
3. Employee files tab.
4. File upload/download/delete.
5. HR audit timeline/table.

### Sprint HR-FE-05: Self-service and approval

1. My Profile edit request drawer.
2. Profile change diff.
3. My profile change request list.
4. HR approval list/detail.
5. Approve/reject/cancel mutations.
6. Notification/dashboard invalidation.

### Sprint HR-FE-06: Hardening

1. Permission/data scope regression.
2. Responsive pass.
3. Accessibility pass.
4. E2E P0.
5. Performance review.
6. QA bugfix.

---

## 37. Backend/API dependency checklist

Frontend HR cần backend/API ổn định các nhóm endpoint sau trước khi triển khai đầy đủ:

| Nhóm | Cần có |
| --- | --- |
| Auth context | Current user, permission, data scope, employee link |
| Employee | List, detail, create, update, delete, change status |
| My Profile | Get my profile, editable fields |
| Profile Change | Create, list own, cancel own, list all, detail, approve, reject |
| Department | List tree, create, update, delete |
| Position | List, create, update, delete |
| Job Level | List, create, update, delete |
| Contract Type | List, create, update, delete |
| Contract | Employee contract list/create/update/delete/set primary |
| File | Upload/link/download/delete employee file |
| Employee Code | Config, update config, preview next code, manual override rule |
| Audit | Employee audit/history hoặc foundation audit filter by entity |
| Org Chart | Department/employee tree summary |
| Export | Employee export endpoint nếu MVP làm export |

---

## 38. Rủi ro frontend và hướng xử lý

| Rủi ro | Mô tả | Hướng xử lý |
| --- | --- | --- |
| Form employee quá dài | Người dùng khó nhập, dễ lỗi | Chia section/tab/step, sticky action bar |
| Field nhạy cảm bị lộ | FE render nhầm field hoặc cache sai | Dựa vào API response + MaskedField + clear cache khi logout |
| Permission phức tạp | Nhiều action theo scope | Tạo `useHrPermissions`, không hard-code role |
| API chưa đủ dropdown | Employee form cần department/position/manager | Tạo fallback loading/disabled, mock MSW khi dev |
| Profile change diff khó đọc | Old/new nhiều field | DiffTable + nhóm field + highlight thay đổi |
| Department tree lớn | Render chậm | Lazy expand, search node, virtualization nếu cần |
| Export dữ liệu lớn | FE timeout nếu tự export | Dùng backend export job/download |
| Employee code race condition | Preview code có thể stale | Preview chỉ để hiển thị; backend quyết định code cuối cùng |
| File private | URL hết hạn hoặc 403 | Lấy signed URL khi click, xử lý 403 rõ ràng |

---

## 39. Definition of Done

Một màn hình HR được xem là hoàn thành khi:

1. Có route metadata đúng.
2. Có permission guard route-level.
3. Có action visibility theo permission.
4. Có data scope state nếu cần.
5. Có API hook và query key đúng convention.
6. Có loading/empty/error/forbidden state.
7. Có form validation và map validation error nếu là form.
8. Có dirty form guard nếu có form thay đổi dữ liệu.
9. Có confirm dialog cho action nguy hiểm.
10. Có responsive behavior tối thiểu desktop/tablet/mobile web.
11. Có unit/component/integration test phù hợp.
12. Có QA checklist.
13. Không leak dữ liệu nhạy cảm qua UI, log console hoặc local storage.

---

## 40. Kết luận

FRONTEND-08 chốt cách triển khai frontend cho module HR theo hướng:

1. HR là module dữ liệu nhân sự trung tâm, phải làm chắc phần permission, data scope và field masking.
2. Employee list/detail/form là P0 và cần hoàn thiện trước các phần nâng cao.
3. My Profile và Profile Change Request là luồng quan trọng vì Employee không được tự cập nhật trực tiếp hồ sơ chính.
4. Employee Code Config cần được triển khai đúng để đảm bảo mã nhân viên tự sinh nhất quán.
5. Department, Position, Job Level, Contract Type, Contract và File nên dùng pattern form/table/drawer reusable để giảm code lặp.
6. Tất cả API call phải đi qua API client/query layer chung và invalidate đúng các cache liên quan.
7. HR Frontend phải sẵn sàng làm nguồn dữ liệu ổn định cho các bước tiếp theo: Attendance, Leave, Task, Notification và System/Foundation.

Sau FRONTEND-08, bước tiếp theo nên triển khai:

```text
FRONTEND-09: Attendance Frontend
```
