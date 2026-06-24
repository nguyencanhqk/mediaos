# FRONTEND-10: LEAVE FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · **FRONTEND-10 Leave** · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-05 LEAVE](<../SPEC/SPEC-05 LEAVE.md>) · [LEAVE API: API-05](<../API Design/API-05_LEAVE_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-10 |
| Tên tài liệu | Leave Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | LEAVE - Nghỉ phép |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-09 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-10 mô tả cách triển khai frontend cho module **LEAVE - Nghỉ phép** trong hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình frontend của module Nghỉ phép trong MVP.
2. Chốt route, sidebar, page, component và state cần triển khai.
3. Chốt cách tích hợp API-05 với API client, query layer và error handling đã có ở FRONTEND-04.
4. Chốt cách kiểm soát permission, data scope và action visibility theo FRONTEND-03.
5. Chốt form tạo đơn nghỉ, preview tính ngày nghỉ, lưu nháp, gửi đơn và hủy đơn.
6. Chốt màn duyệt/từ chối đơn nghỉ cho Manager/HR/Admin.
7. Chốt lịch nghỉ cá nhân, team, phòng ban và công ty.
8. Chốt màn quản trị loại nghỉ, chính sách nghỉ và số dư phép.
9. Chốt quy tắc đồng bộ UI với Dashboard, Notification và Attendance sau các thao tác nghỉ phép.
10. Làm checklist cho frontend developer, backend/API và QA khi triển khai module LEAVE.

FRONTEND-10 không thiết kế lại nghiệp vụ gốc của nghỉ phép. Nghiệp vụ gốc đã được xác định trong SPEC-05, DB-05 và API-05. Tài liệu này tập trung vào cách chuyển các quyết định đó thành frontend implementation.

---

## 3. Vị trí FRONTEND-10 trong roadmap frontend

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

FRONTEND-10 phụ thuộc trực tiếp vào:

| Tài liệu | Phụ thuộc |
| --- | --- |
| FRONTEND-02 | Component nền: Form, DataTable, Drawer, Modal, Badge, Calendar, ApprovalBox, PermissionGate |
| FRONTEND-03 | Route guard, permission guard, app/sidebar registry, action visibility |
| FRONTEND-04 | API client, TanStack Query, mutation, error handling, idempotency key |
| FRONTEND-05 | ModuleWorkspaceLayout, Topbar, Sidebar, AppSwitcher |
| FRONTEND-07 | Dashboard quick action điều hướng sang LEAVE |
| FRONTEND-09 | Đồng bộ với Attendance khi đơn nghỉ được duyệt/hủy |

---

## 4. Căn cứ triển khai

FRONTEND-10 bám theo các quyết định đã chốt:

1. Module LEAVE thuộc MVP và quản lý loại nghỉ, chính sách nghỉ, số dư phép, đơn nghỉ, duyệt/từ chối/hủy, lịch nghỉ và đồng bộ chấm công.
2. API LEAVE dùng prefix `/api/v1/leave`.
3. Tất cả API LEAVE yêu cầu access token hợp lệ.
4. Frontend không tự truyền `company_id` cho nghiệp vụ thông thường; backend resolve từ auth context.
5. Frontend không tự tin `employee_id`, `user_id`, `role` hoặc `company_id` do client nhập nếu backend có thể resolve từ token.
6. Permission và data scope là nguồn kiểm soát UI chính; role chỉ dùng để mô tả trải nghiệm mặc định.
7. Backend vẫn là lớp kiểm soát quyền cuối cùng; frontend chỉ hỗ trợ UX bằng hide, disable, masked field và forbidden state.
8. Đơn nghỉ có trạng thái: `Draft`, `Pending`, `Approved`, `Rejected`, `Cancelled`, `Revoked`.
9. Form tạo đơn nghỉ phải có preview tính số ngày/giờ nghỉ trước khi gửi.
10. Từ chối đơn nghỉ bắt buộc nhập lý do.
11. Duyệt đơn nghỉ cần cập nhật số dư phép, đồng bộ sang Attendance và phát Notification.
12. Lịch nghỉ không được làm lộ lý do nghỉ hoặc loại nghỉ nhạy cảm nếu user thiếu quyền.
13. Các action quan trọng phải chống double submit và dùng idempotency key khi phù hợp.
14. Sau mutation, frontend phải invalidate đúng query key: leave request, balance, calendar, dashboard widget, notification badge và attendance today nếu bị ảnh hưởng.

---

## 5. Phạm vi FRONTEND-10

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung |
| --- | --- |
| Leave app shell | App route, sidebar, breadcrumb, page header |
| My balance | Xem số dư phép của user hiện tại |
| My leave requests | Danh sách đơn nghỉ của tôi, lọc trạng thái, xem chi tiết |
| Create leave request | Tạo đơn nghỉ, preview số ngày nghỉ, lưu nháp, gửi đơn |
| Leave request detail | Xem chi tiết đơn, lịch sử xử lý, file, trạng thái đồng bộ |
| Cancel own request | Hủy đơn Draft/Pending hoặc Approved theo rule backend |
| Pending approvals | Manager/HR/Admin xem đơn chờ duyệt theo scope |
| Approve/reject | Duyệt hoặc từ chối đơn nghỉ bằng modal/drawer chuẩn |
| All requests | HR/Admin xem toàn bộ đơn nghỉ theo quyền |
| Leave calendar | Lịch nghỉ cá nhân/team/company theo permission |
| Leave type management | HR/Admin quản lý loại nghỉ |
| Leave policy management | HR/Admin quản lý chính sách nghỉ |
| Leave balance admin | HR/Admin xem số dư phép nhân viên |
| Balance adjustment | HR/Admin điều chỉnh số dư phép |
| Leave history | Lịch sử xử lý đơn nghỉ và giao dịch số dư |
| Export | Xuất đơn nghỉ/lịch nghỉ/số dư nếu có quyền |
| Notification/deep link | Click notification mở đúng request/detail/calendar |
| Dashboard quick action | Dashboard điều hướng sang tạo đơn/duyệt đơn/lịch nghỉ |

### 5.2 Chưa triển khai sâu trong MVP nhưng cần chừa thiết kế

| Nhóm | Giai đoạn | Ghi chú frontend |
| --- | --- | --- |
| Multi-level approval nâng cao | Phase sau | Thiết kế approval timeline có thể hỗ trợ nhiều cấp |
| Accrual job tự động | Phase sau | Chỉ hiển thị transaction/job history khi backend có API |
| Reset phép đầu năm | Phase sau | Admin screen riêng hoặc settings nâng cao |
| Carry over phép tồn | Phase sau | Policy form mở rộng |
| Import số dư phép Excel | Phase sau | Import wizard + batch result |
| Calendar integration | Phase sau | Connect Google/Microsoft Calendar |
| Mobile push | Phase sau | Thuộc Notification/Mobile app |
| AI gợi ý người thay thế | Phase sau | Panel gợi ý trong create/approval |

---

## 6. Actor và use case chính

| Actor | Use case frontend |
| --- | --- |
| Employee | Xem phép còn lại, tạo/lưu nháp/gửi đơn nghỉ, xem/hủy đơn của mình, xem lịch nghỉ của mình |
| Manager | Xem lịch nghỉ team, xem đơn chờ duyệt, duyệt/từ chối đơn của team, xem số dư phép team nếu có quyền |
| HR | Xem toàn bộ đơn nghỉ theo scope, xử lý đơn, quản lý loại nghỉ, policy, số dư phép, lịch nghỉ công ty |
| Admin công ty | Quản trị module LEAVE nếu được cấp quyền |
| Super Admin | Toàn quyền hoặc scope System nếu hệ thống SaaS/multi-tenant bật |
| Payroll Officer | Xem/export dữ liệu nghỉ phục vụ tính lương phase sau nếu được cấp quyền |

---

## 7. Route structure

### 7.1 Route base

```text
/leave
```

Module LEAVE luôn chạy trong `ModuleWorkspaceLayout`.

### 7.2 Route table MVP

| Route | Page | Screen code | Permission chính | Data scope | Priority |
| --- | --- | --- | --- | --- | --- |
| `/leave` | LeaveOverviewPage | UI-LEAVE-SCREEN-001 | `LEAVE.BALANCE.VIEW_OWN` hoặc `LEAVE.REQUEST.VIEW_OWN` | Own | P0 |
| `/leave/me/balances` | MyLeaveBalancePage | UI-LEAVE-SCREEN-001A | `LEAVE.BALANCE.VIEW_OWN` | Own | P0 |
| `/leave/me/requests` | MyLeaveRequestsPage | UI-LEAVE-SCREEN-003 | `LEAVE.REQUEST.VIEW_OWN` | Own | P0 |
| `/leave/requests/new` | CreateLeaveRequestPage | UI-LEAVE-SCREEN-002 | `LEAVE.REQUEST.CREATE` | Own | P0 |
| `/leave/requests/:requestId` | LeaveRequestDetailPage | UI-LEAVE-SCREEN-004 | `LEAVE.REQUEST.VIEW_OWN` hoặc `LEAVE.REQUEST.VIEW` | Own/Team/Company | P0 |
| `/leave/requests/:requestId/edit` | EditLeaveDraftPage | UI-LEAVE-SCREEN-002E | `LEAVE.REQUEST.UPDATE_DRAFT` | Own | P1 |
| `/leave/approvals` | LeaveApprovalListPage | UI-LEAVE-SCREEN-005 | `LEAVE.REQUEST.APPROVE` hoặc `LEAVE.REQUEST.REJECT` | Team/Department/Company | P0 |
| `/leave/requests` | AllLeaveRequestsPage | UI-LEAVE-SCREEN-006 | `LEAVE.REQUEST.VIEW` | Team/Department/Company | P1 |
| `/leave/calendar` | LeaveCalendarPage | UI-LEAVE-SCREEN-007/008/009 | `LEAVE.CALENDAR.VIEW_OWN/TEAM/COMPANY` | Own/Team/Company | P0 |
| `/leave/types` | LeaveTypesPage | UI-LEAVE-SCREEN-010 | `LEAVE.TYPE.VIEW` | Company | P1 |
| `/leave/policies` | LeavePoliciesPage | UI-LEAVE-SCREEN-011 | `LEAVE.POLICY.VIEW` | Company | P1 |
| `/leave/balances` | LeaveBalancesPage | UI-LEAVE-SCREEN-012 | `LEAVE.BALANCE.VIEW` | Team/Department/Company | P1 |
| `/leave/balances/:balanceId/transactions` | LeaveBalanceTransactionsPage | UI-LEAVE-SCREEN-014 | `LEAVE.BALANCE.TRANSACTION_VIEW` | Team/Department/Company | P2 |
| `/leave/reports` | LeaveReportsPage | UI-LEAVE-SCREEN-REPORT | `LEAVE.REQUEST.EXPORT` | Department/Company | P2 |
| `/leave/audit-logs` | LeaveAuditLogsPage | UI-LEAVE-SCREEN-014A | `LEAVE.AUDIT_LOG.VIEW` | Company/System | P2 |

### 7.3 Route redirect rule

| Tình huống | Redirect |
| --- | --- |
| User vào `/leave` và chỉ có quyền employee | `/leave/me/balances` hoặc overview cá nhân |
| User vào `/leave` và là Manager có approval pending | `/leave/approvals` hoặc overview theo cấu hình |
| User vào `/leave` và là HR | `/leave/requests` hoặc overview HR |
| User thiếu toàn bộ quyền LEAVE | ForbiddenPage |
| User mở request không thuộc scope | Detail forbidden state hoặc redirect 403 |
| Request không tồn tại | NotFoundState |

---

## 8. Sidebar module LEAVE

```text
Tổng quan
- Tổng quan nghỉ phép

Cá nhân
- Số dư phép của tôi
- Đơn nghỉ của tôi
- Tạo đơn nghỉ
- Lịch nghỉ của tôi

Duyệt & quản lý
- Đơn chờ duyệt
- Tất cả đơn nghỉ
- Lịch nghỉ team
- Lịch nghỉ công ty

Cấu hình
- Loại nghỉ phép
- Chính sách nghỉ phép
- Số dư phép nhân viên
- Lịch sử giao dịch phép

Báo cáo & lịch sử
- Báo cáo nghỉ phép
- Audit nghỉ phép
```

### 8.1 Permission visibility cho sidebar

| Menu item | Permission hiển thị |
| --- | --- |
| Tổng quan nghỉ phép | Ít nhất một permission LEAVE bất kỳ |
| Số dư phép của tôi | `LEAVE.BALANCE.VIEW_OWN` |
| Đơn nghỉ của tôi | `LEAVE.REQUEST.VIEW_OWN` |
| Tạo đơn nghỉ | `LEAVE.REQUEST.CREATE` |
| Lịch nghỉ của tôi | `LEAVE.CALENDAR.VIEW_OWN` |
| Đơn chờ duyệt | `LEAVE.REQUEST.APPROVE` hoặc `LEAVE.REQUEST.REJECT` |
| Tất cả đơn nghỉ | `LEAVE.REQUEST.VIEW` |
| Lịch nghỉ team | `LEAVE.CALENDAR.VIEW_TEAM` |
| Lịch nghỉ công ty | `LEAVE.CALENDAR.VIEW_COMPANY` |
| Loại nghỉ phép | `LEAVE.TYPE.VIEW` |
| Chính sách nghỉ phép | `LEAVE.POLICY.VIEW` |
| Số dư phép nhân viên | `LEAVE.BALANCE.VIEW` |
| Lịch sử giao dịch phép | `LEAVE.BALANCE.TRANSACTION_VIEW` |
| Báo cáo nghỉ phép | `LEAVE.REQUEST.EXPORT` |
| Audit nghỉ phép | `LEAVE.AUDIT_LOG.VIEW` |

---

## 9. Cấu trúc thư mục đề xuất

```text
src/
  features/
    leave/
      api/
        leaveApi.ts
        leaveQueryKeys.ts
        leaveEndpoints.ts
      components/
        LeaveBalanceCard.tsx
        LeaveBalanceSummaryGrid.tsx
        LeaveRequestForm.tsx
        LeaveCalculationPreview.tsx
        LeaveRequestStatusBadge.tsx
        LeaveRequestTable.tsx
        LeaveRequestDetailHeader.tsx
        LeaveRequestTimeline.tsx
        LeaveApprovalBox.tsx
        LeaveRejectDialog.tsx
        LeaveCancelDialog.tsx
        LeaveCalendar.tsx
        LeaveCalendarEventPopover.tsx
        LeaveTypeFormDrawer.tsx
        LeavePolicyFormDrawer.tsx
        LeaveBalanceAdjustDrawer.tsx
        LeaveSensitiveField.tsx
      hooks/
        useMyLeaveBalances.ts
        useMyLeaveRequests.ts
        useLeaveRequest.ts
        useCreateLeaveRequest.ts
        useUpdateLeaveDraft.ts
        useSubmitLeaveRequest.ts
        useCancelLeaveRequest.ts
        useApproveLeaveRequest.ts
        useRejectLeaveRequest.ts
        useLeaveCalculationPreview.ts
        useLeaveCalendar.ts
        useLeaveTypes.ts
        useLeavePolicies.ts
        useLeaveBalances.ts
      pages/
        LeaveOverviewPage.tsx
        MyLeaveBalancePage.tsx
        MyLeaveRequestsPage.tsx
        CreateLeaveRequestPage.tsx
        EditLeaveDraftPage.tsx
        LeaveRequestDetailPage.tsx
        LeaveApprovalListPage.tsx
        AllLeaveRequestsPage.tsx
        LeaveCalendarPage.tsx
        LeaveTypesPage.tsx
        LeavePoliciesPage.tsx
        LeaveBalancesPage.tsx
        LeaveBalanceTransactionsPage.tsx
        LeaveReportsPage.tsx
        LeaveAuditLogsPage.tsx
      routes/
        leaveRoutes.tsx
        leaveSidebar.ts
      schemas/
        leaveRequestSchema.ts
        leaveTypeSchema.ts
        leavePolicySchema.ts
        leaveBalanceAdjustmentSchema.ts
      types/
        leave.types.ts
        leaveStatus.types.ts
      utils/
        leaveStatusMap.ts
        leaveDurationUtils.ts
        leavePermissionUtils.ts
        leaveDateUtils.ts
        leaveQueryParams.ts
      index.ts
```

---

## 10. TypeScript domain types

### 10.1 Enum/type dùng chung

```ts
export type LeaveRequestStatus =
  | 'Draft'
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Cancelled'
  | 'Revoked';

export type LeaveDurationType =
  | 'FullDay'
  | 'HalfDay'
  | 'Hourly'
  | 'MultipleDays';

export type HalfDaySession = 'Morning' | 'Afternoon';

export type LeaveUnit = 'Day' | 'Hour';

export type LeaveScope = 'Own' | 'Team' | 'Department' | 'Company' | 'System';
```

### 10.2 Leave type

```ts
export interface LeaveType {
  id: string;
  leave_type_code: string;
  name: string;
  description?: string | null;
  unit: LeaveUnit;
  is_paid: boolean;
  is_balance_required: boolean;
  is_attachment_required: boolean;
  is_reason_required: boolean;
  is_sensitive: boolean;
  allow_half_day: boolean;
  allow_hourly: boolean;
  allow_negative_balance: boolean;
  max_days_per_request?: number | null;
  min_notice_days?: number | null;
  status: 'Active' | 'Inactive';
  sort_order?: number;
}
```

### 10.3 Leave balance

```ts
export interface LeaveBalance {
  id: string;
  employee: EmployeeLite;
  leave_type: Pick<LeaveType, 'id' | 'leave_type_code' | 'name'>;
  period_year: number;
  opening_balance: number;
  accrued_days: number;
  used_days: number;
  reserved_days: number;
  adjusted_days: number;
  remaining_days: number;
  unit: LeaveUnit;
  last_transaction_at?: string | null;
}
```

### 10.4 Leave request summary

```ts
export interface LeaveRequestSummary {
  id: string;
  request_code: string;
  employee: EmployeeLite;
  leave_type: Pick<LeaveType, 'id' | 'leave_type_code' | 'name' | 'is_sensitive'>;
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_type: LeaveDurationType;
  half_day_session?: HalfDaySession | null;
  calculated_days: number;
  calculated_hours: number;
  status: LeaveRequestStatus;
  approver?: EmployeeLite | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at?: string;
}
```

### 10.5 Leave request detail

```ts
export interface LeaveRequestDetail extends LeaveRequestSummary {
  reason?: string | null;
  handover_note?: string | null;
  balance_snapshot?: {
    before_remaining_days: number;
    requested_days: number;
    after_remaining_days: number;
  } | null;
  days: LeaveRequestDay[];
  files: LeaveFile[];
  approvals: LeaveApproval[];
  submitted_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  revoked_at?: string | null;
}

export interface LeaveRequestDay {
  id?: string;
  date: string;
  duration_type: LeaveDurationType;
  half_day_session?: HalfDaySession | null;
  start_time?: string | null;
  end_time?: string | null;
  leave_days: number;
  leave_hours: number;
  // Khớp DB-05 attendance_sync_status CHECK
  sync_status?:
    | 'Not Required'
    | 'Pending'
    | 'Synced'
    | 'Failed'
    | 'Reverted'
    | 'Pending Revert';
}

export interface LeaveApproval {
  id: string;
  // Khớp DB-05 leave_request_approvals.action (UPPER_SNAKE)
  action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'CANCEL' | 'REVOKE' | 'COMMENT';
  actor: UserLite;
  note?: string | null;
  created_at: string;
}
```

### 10.6 Leave request form values

```ts
export interface LeaveRequestFormValues {
  leave_type_id: string;
  start_date: string;
  end_date: string;
  duration_type: LeaveDurationType;
  half_day_session?: HalfDaySession | null;
  start_time?: string | null;
  end_time?: string | null;
  reason: string;
  handover_note?: string;
  file_ids?: string[];
}
```

---

## 11. API client module

### 11.1 Endpoint constants

```ts
export const leaveEndpoints = {
  myBalances: '/api/v1/leave/me/balances',
  myRequests: '/api/v1/leave/me/requests',
  myRequestDetail: (id: string) => `/api/v1/leave/me/requests/${id}`,
  requests: '/api/v1/leave/requests',
  requestDetail: (id: string) => `/api/v1/leave/requests/${id}`,
  submitRequest: (id: string) => `/api/v1/leave/requests/${id}/submit`,
  approveRequest: (id: string) => `/api/v1/leave/requests/${id}/approve`,
  rejectRequest: (id: string) => `/api/v1/leave/requests/${id}/reject`,
  cancelRequest: (id: string) => `/api/v1/leave/requests/${id}/cancel`,
  cancelByAdmin: (id: string) => `/api/v1/leave/requests/${id}/cancel-by-admin`,
  revokeRequest: (id: string) => `/api/v1/leave/requests/${id}/revoke`,
  calculate: '/api/v1/leave/requests/calculate',
  validate: '/api/v1/leave/requests/validate',
  calendar: '/api/v1/leave/calendar',
  initializeBalance: '/api/v1/leave/balances/initialize',
  types: '/api/v1/leave/types',
  typeDetail: (id: string) => `/api/v1/leave/types/${id}`,
  policies: '/api/v1/leave/policies',
  policyDetail: (id: string) => `/api/v1/leave/policies/${id}`,
  balances: '/api/v1/leave/balances',
  balanceDetail: (id: string) => `/api/v1/leave/balances/${id}`,
  adjustBalance: (id: string) => `/api/v1/leave/balances/${id}/adjust`,
  balanceTransactions: (id: string) => `/api/v1/leave/balances/${id}/transactions`,
  exportRequests: '/api/v1/leave/requests/export',
  exportCalendar: '/api/v1/leave/calendar/export',
  exportBalances: '/api/v1/leave/balances/export',
};
```

### 11.2 API functions

```ts
export const leaveApi = {
  getMyBalances: () => apiClient.get<LeaveBalance[]>(leaveEndpoints.myBalances),

  getMyRequests: (params: LeaveRequestListParams) =>
    apiClient.getPaginated<LeaveRequestSummary>(leaveEndpoints.myRequests, { params }),

  getRequests: (params: LeaveRequestListParams) =>
    apiClient.getPaginated<LeaveRequestSummary>(leaveEndpoints.requests, { params }),

  // Self detail dùng /me/requests/{id}; admin/scope detail dùng /requests/{id}
  getMyRequestDetail: (requestId: string) =>
    apiClient.get<LeaveRequestDetail>(leaveEndpoints.myRequestDetail(requestId)),

  getRequestDetail: (requestId: string) =>
    apiClient.get<LeaveRequestDetail>(leaveEndpoints.requestDetail(requestId)),

  // Tạo đơn: 1 endpoint, body submit_now quyết định Draft hay gửi luôn (bỏ /requests/draft)
  createRequest: (
    payload: LeaveRequestFormValues & { submit_now?: boolean },
    options?: MutationOptions,
  ) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.requests, payload, {
      idempotencyKey: options?.idempotencyKey,
    }),

  updateDraft: (requestId: string, payload: LeaveRequestFormValues) =>
    apiClient.patch<LeaveRequestDetail>(leaveEndpoints.requestDetail(requestId), payload),

  submitRequest: (requestId: string, options?: MutationOptions) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.submitRequest(requestId), null, {
      idempotencyKey: options?.idempotencyKey,
    }),

  cancelRequest: (requestId: string, payload: { reason?: string }) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.cancelRequest(requestId), payload),

  cancelByAdmin: (requestId: string, payload: { reason?: string }) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.cancelByAdmin(requestId), payload),

  revokeRequest: (requestId: string, payload: { reason?: string }) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.revokeRequest(requestId), payload),

  approveRequest: (requestId: string, payload: { note?: string }) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.approveRequest(requestId), payload),

  rejectRequest: (requestId: string, payload: { reason: string }) =>
    apiClient.post<LeaveRequestDetail>(leaveEndpoints.rejectRequest(requestId), payload),

  calculate: (payload: LeaveRequestFormValues) =>
    apiClient.post<LeaveCalculationPreview>(leaveEndpoints.calculate, payload),

  getCalendar: (params: LeaveCalendarParams) =>
    apiClient.get<LeaveCalendarItem[]>(leaveEndpoints.calendar, { params }),

  getTypes: (params?: LeaveTypeListParams) =>
    apiClient.getPaginated<LeaveType>(leaveEndpoints.types, { params }),

  getPolicies: (params?: LeavePolicyListParams) =>
    apiClient.getPaginated<LeavePolicy>(leaveEndpoints.policies, { params }),

  getBalances: (params: LeaveBalanceListParams) =>
    apiClient.getPaginated<LeaveBalance>(leaveEndpoints.balances, { params }),

  adjustBalance: (balanceId: string, payload: LeaveBalanceAdjustmentValues) =>
    apiClient.post<LeaveBalance>(leaveEndpoints.adjustBalance(balanceId), payload),
};
```

---

## 12. Query keys và cache strategy

### 12.1 Query key factory

```ts
export const leaveQueryKeys = {
  all: ['leave'] as const,

  myBalances: () => [...leaveQueryKeys.all, 'me', 'balances'] as const,

  myRequests: (params: LeaveRequestListParams) =>
    [...leaveQueryKeys.all, 'me', 'requests', params] as const,

  requests: (params: LeaveRequestListParams) =>
    [...leaveQueryKeys.all, 'requests', params] as const,

  requestDetail: (requestId: string) =>
    [...leaveQueryKeys.all, 'requests', requestId] as const,

  calculation: (payloadHash: string) =>
    [...leaveQueryKeys.all, 'calculation', payloadHash] as const,

  calendar: (params: LeaveCalendarParams) =>
    [...leaveQueryKeys.all, 'calendar', params] as const,

  types: (params?: LeaveTypeListParams) =>
    [...leaveQueryKeys.all, 'types', params] as const,

  policies: (params?: LeavePolicyListParams) =>
    [...leaveQueryKeys.all, 'policies', params] as const,

  balances: (params: LeaveBalanceListParams) =>
    [...leaveQueryKeys.all, 'balances', params] as const,

  balanceTransactions: (balanceId: string, params?: ListParams) =>
    [...leaveQueryKeys.all, 'balances', balanceId, 'transactions', params] as const,
};
```

### 12.2 Cache TTL gợi ý

| Dữ liệu | staleTime | Ghi chú |
| --- | ---: | --- |
| My balances | 30s - 60s | Invalidate sau create/submit/approve/cancel/adjust |
| My requests | 30s | Invalidate sau mọi mutation request |
| Request detail | 15s - 30s | Cần tươi khi approve/reject |
| Pending approvals | 15s - 30s | Manager/HR cần cập nhật thường xuyên |
| Calendar | 60s | Invalidate sau Approved/Cancelled/Revoked |
| Leave types | 5m | Ít thay đổi, invalidate sau CRUD type |
| Policies | 5m | Ít thay đổi, invalidate sau CRUD policy |
| Balances admin | 30s - 60s | Invalidate sau adjust/approve/cancel |
| Balance transactions | 60s | Invalidate sau adjust/approve/cancel |

### 12.3 Invalidation sau mutation

| Mutation | Query cần invalidate |
| --- | --- |
| Create draft | `myRequests`, `requestDetail` |
| Update draft | `requestDetail`, `myRequests` |
| Submit request | `myRequests`, `requests`, `requestDetail`, `myBalances`, `dashboard`, `notifications` |
| Cancel request | `myRequests`, `requests`, `requestDetail`, `myBalances`, `calendar`, `attendance`, `dashboard`, `notifications` |
| Approve request | `requests`, `requestDetail`, `balances`, `myBalances`, `calendar`, `attendance`, `dashboard`, `notifications` |
| Reject request | `requests`, `requestDetail`, `myBalances`, `dashboard`, `notifications` |
| Adjust balance | `balances`, `myBalances`, `balanceTransactions`, `dashboard`, `notifications` |
| Update leave type | `types`, `policies`, `calculation` |
| Update leave policy | `policies`, `calculation`, `myBalances`, `balances` |

---

## 13. Form validation

### 13.1 Create leave request schema

Frontend validation chỉ kiểm tra lỗi cơ bản để cải thiện UX. Backend vẫn kiểm tra business rule cuối cùng.

```ts
export const leaveRequestSchema = z
  .object({
    leave_type_id: z.string().uuid('Vui lòng chọn loại nghỉ'),
    start_date: z.string().min(1, 'Vui lòng chọn ngày bắt đầu'),
    end_date: z.string().min(1, 'Vui lòng chọn ngày kết thúc'),
    duration_type: z.enum(['FullDay', 'HalfDay', 'Hourly', 'MultipleDays']),
    half_day_session: z.enum(['Morning', 'Afternoon']).nullable().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    reason: z.string().trim().min(1, 'Vui lòng nhập lý do nghỉ'),
    handover_note: z.string().trim().max(1000).optional(),
    file_ids: z.array(z.string().uuid()).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.end_date < values.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: 'Ngày kết thúc không được trước ngày bắt đầu',
      });
    }

    if (values.duration_type === 'HalfDay' && !values.half_day_session) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['half_day_session'],
        message: 'Vui lòng chọn buổi nghỉ',
      });
    }

    if (values.duration_type === 'Hourly' && (!values.start_time || !values.end_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['start_time'],
        message: 'Vui lòng chọn giờ bắt đầu và giờ kết thúc',
      });
    }
  });
```

### 13.2 Rule validation cần gọi backend preview

Các rule sau không tự quyết định ở frontend, mà gọi Leave Calculation API:

1. Có đủ số dư phép không.
2. Có cho phép nghỉ âm không.
3. Có vượt số ngày tối đa mỗi đơn không.
4. Có trùng thời gian nghỉ không.
5. Có đủ số ngày báo trước không.
6. Có đúng ngày làm việc/ca làm không.
7. Loại nghỉ có bắt buộc file không.
8. Loại nghỉ có cho phép half-day/hourly không.
9. Có người duyệt phù hợp không.
10. Nhân viên có trạng thái hợp lệ để tạo đơn không.

---

## 14. Page implementation detail

## 14.1 LeaveOverviewPage

### Mục tiêu

Hiển thị tổng quan nhanh cho người dùng khi mở module LEAVE.

### Nội dung

| Thành phần | Mô tả |
| --- | --- |
| Balance summary | Tổng phép còn lại, đã dùng, đang chờ duyệt |
| Quick actions | Tạo đơn nghỉ, xem đơn của tôi, xem lịch nghỉ |
| Recent requests | 5 đơn nghỉ gần nhất |
| Pending approvals | Nếu có quyền duyệt, hiển thị số đơn cần xử lý |
| Upcoming leave | Lịch nghỉ sắp tới của user/team |
| Warning cards | Sắp hết phép, policy chưa cấu hình, request pending lâu |

### Component

```text
LeaveBalanceSummaryGrid
QuickActionCard
LeaveRequestTable compact
PendingApprovalList compact
LeaveCalendarMini
AlertCard
```

### API

```http
GET /api/v1/leave/me/balances
GET /api/v1/leave/me/requests?per_page=5&sort=created_at:desc
GET /api/v1/leave/requests?status=Pending&per_page=5
GET /api/v1/leave/calendar?from_date=...&to_date=...
```

### State

| State | UI |
| --- | --- |
| Loading | Skeleton cards + table rows |
| Empty balance | Empty/Degraded: chưa có chính sách hoặc chưa được cấp phép |
| Low balance | Warning badge `Sắp hết phép` |
| Error một widget | Widget degraded, không làm crash toàn page |
| Forbidden widget | Ẩn widget không có quyền |

---

## 14.2 MyLeaveBalancePage

### Mục tiêu

Cho phép employee xem chi tiết số dư phép của mình theo từng loại nghỉ.

### UI layout

```text
PageHeader: Số dư phép của tôi
Filter: Năm / loại nghỉ

Balance cards:
- Phép năm: còn lại, đã dùng, đang giữ chỗ
- Nghỉ ốm: còn lại / chính sách
- Nghỉ bù: còn lại nếu có

Table transaction gần đây:
- Ngày
- Loại phép
- Loại giao dịch
- Số ngày
- Trước / sau
- Lý do
```

### API

```http
GET /api/v1/leave/me/balances?period_year=2026
GET /api/v1/leave/me/balance-transactions?period_year=2026
```

Nếu API chưa có endpoint transaction cá nhân riêng, frontend có thể tạm ẩn transaction hoặc dùng detail drawer theo balance nếu backend cho phép.

---

## 14.3 MyLeaveRequestsPage

### Mục tiêu

Nhân viên xem danh sách đơn nghỉ của chính mình.

### Filter

| Filter | Loại |
| --- | --- |
| Search | request_code, leave type, reason nếu API cho phép |
| Status | Draft, Pending, Approved, Rejected, Cancelled |
| Date range | from_date, to_date |
| Leave type | select |
| Duration type | FullDay, HalfDay, Hourly, MultipleDays |

### Column

| Cột | Nội dung |
| --- | --- |
| Mã đơn | request_code |
| Loại nghỉ | Leave type badge |
| Thời gian | start_date -> end_date |
| Thời lượng | calculated_days / calculated_hours |
| Trạng thái | LeaveRequestStatusBadge |
| Người duyệt | Approver name nếu có |
| Ngày gửi | submitted_at |
| Action | Xem, sửa nháp, gửi, hủy |

### Row action rule

| Action | Điều kiện |
| --- | --- |
| Xem | Có quyền view own |
| Sửa | Status = Draft và có `LEAVE.REQUEST.UPDATE_DRAFT` |
| Gửi | Status = Draft và có `LEAVE.REQUEST.SUBMIT` |
| Hủy | Status Draft/Pending hoặc Approved nếu backend cho phép; có `LEAVE.REQUEST.CANCEL_OWN` |

---

## 14.4 CreateLeaveRequestPage

### Mục tiêu

Nhân viên tạo đơn nghỉ, xem preview số ngày nghỉ và số dư trước khi lưu nháp/gửi đơn.

### Layout desktop

```text
+---------------------------------------------------------------+
| Breadcrumb: Nghỉ phép / Tạo đơn nghỉ                           |
| PageHeader: Tạo đơn nghỉ phép                                  |
+-------------------------------+-------------------------------+
| Form                          | Preview side panel            |
| - Loại nghỉ                   | - Số ngày/giờ nghỉ             |
| - Ngày bắt đầu/kết thúc       | - Số dư hiện tại               |
| - Kiểu nghỉ                   | - Số dư sau khi gửi            |
| - Buổi/giờ nghỉ               | - Cảnh báo rule                |
| - Lý do                       | - Người duyệt dự kiến          |
| - Bàn giao công việc          | - Ngày bị loại trừ             |
| - File đính kèm               |                               |
+-------------------------------+-------------------------------+
| [Hủy] [Lưu nháp] [Gửi đơn]                                    |
+---------------------------------------------------------------+
```

### Layout mobile

1. Form full width.
2. Preview chuyển thành collapsible sticky bottom hoặc section dưới form.
3. File upload dùng compact list.
4. Action bar sticky bottom.

### API flow

```text
Load page
-> GET leave types
-> GET my balances
-> User nhập form
-> Debounce 400-600ms khi đủ field quan trọng
-> POST /api/v1/leave/calculate
-> Hiển thị preview
-> User bấm Lưu nháp hoặc Gửi đơn
-> POST /api/v1/leave/requests
-> Nếu gửi đơn ngay, gọi submit hoặc truyền mode tùy API
-> Invalidate balance/request/dashboard/notification
```

### Submit behavior

| Button | Hành vi |
| --- | --- |
| Lưu nháp | Tạo request Draft, không bắt buộc đủ mọi field nếu backend cho phép |
| Gửi đơn | Cần preview hợp lệ, đủ required field, dùng idempotency key |
| Hủy | Nếu dirty form, mở ConfirmDialog |

### Preview state

| State | UI |
| --- | --- |
| Chưa đủ dữ liệu | Empty preview: “Chọn loại nghỉ và thời gian để xem tính toán” |
| Đang tính | Skeleton/inline loading |
| Hợp lệ | Hiển thị số ngày, số giờ, balance sau gửi |
| Không đủ phép | Warning/Danger, disable submit nếu backend trả blocking |
| Trùng lịch nghỉ | Danger alert, link xem đơn trùng nếu được trả |
| Không có người duyệt | Danger alert |
| Loại nghỉ cần file | Warning nếu chưa upload file |

---

## 14.5 EditLeaveDraftPage

### Mục tiêu

Cho phép sửa đơn nháp.

### Rule

1. Chỉ đơn `Draft` mới được sửa.
2. Nếu user truy cập đơn không phải Draft, hiển thị disabled state và CTA quay về detail.
3. Sau khi update, refresh detail và danh sách đơn của tôi.
4. Nếu user gửi đơn sau khi sửa, chạy lại calculation preview trước submit.

---

## 14.6 LeaveRequestDetailPage

### Mục tiêu

Hiển thị chi tiết đơn nghỉ, action theo trạng thái và quyền.

### Layout

```text
Breadcrumb
PageHeader:
  LR-2026-0001 | StatusBadge
  Actions: Submit / Edit / Cancel / Approve / Reject / Revoke / Export

Summary cards:
- Employee
- Leave type
- Date range
- Calculated duration
- Balance impact
- Approver

Tabs:
- Tổng quan
- Ngày nghỉ chi tiết
- File đính kèm
- Lịch sử xử lý
- Audit nếu có quyền
```

### Action visibility

| Action | Điều kiện |
| --- | --- |
| Edit | Owner + Draft + `LEAVE.REQUEST.UPDATE_DRAFT` |
| Submit | Owner + Draft + `LEAVE.REQUEST.SUBMIT` |
| Cancel | Owner + allowed status + `LEAVE.REQUEST.CANCEL_OWN` hoặc HR/Admin + `LEAVE.REQUEST.CANCEL_ANY` |
| Approve | Pending + approver/scope hợp lệ + `LEAVE.REQUEST.APPROVE` |
| Reject | Pending + approver/scope hợp lệ + `LEAVE.REQUEST.REJECT` |
| Revoke | Approved + HR/Admin + `LEAVE.REQUEST.REVOKE` |
| Export | Có `LEAVE.REQUEST.EXPORT` |

### Sensitive data rule

1. Nếu thiếu quyền xem lý do nghỉ, `reason` hiển thị qua `MaskedField` hoặc ẩn.
2. Nếu `leave_type.is_sensitive = true`, calendar/list có thể hiển thị “Nghỉ phép” thay tên chi tiết.
3. File đính kèm chỉ hiển thị metadata nếu có quyền; tải file qua signed URL/endpoint bảo mật.

---

## 14.7 LeaveApprovalListPage

### Mục tiêu

Manager/HR/Admin xem danh sách đơn cần duyệt.

### Filter mặc định

```text
status=Pending
sort=submitted_at:asc
```

### Column

| Cột | Nội dung |
| --- | --- |
| Người xin nghỉ | Avatar, name, employee_code, department |
| Loại nghỉ | Type badge, masking nếu sensitive |
| Thời gian | Start -> end |
| Số ngày | calculated_days |
| Ngày gửi | submitted_at |
| Cảnh báo | Trùng lịch team, nghỉ dài, balance thấp nếu API trả |
| Action | Xem, Duyệt, Từ chối |

### Quick approve rule

Trong MVP, không duyệt trực tiếp bằng một click ở table nếu chưa xem chi tiết. Có thể dùng drawer preview:

```text
Click Xem/Duyệt
-> Mở LeaveApprovalDrawer
-> Load detail
-> Hiển thị thông tin đơn + balance impact + team calendar mini
-> User bấm Duyệt hoặc Từ chối
```

---

## 14.8 Approve/reject interaction

### Approve dialog

```text
Title: Duyệt đơn nghỉ?
Nội dung:
- Người xin nghỉ
- Thời gian nghỉ
- Số ngày nghỉ
- Tác động số dư phép
- Ghi chú duyệt optional
Actions: [Hủy] [Duyệt đơn]
```

### Reject dialog

```text
Title: Từ chối đơn nghỉ
Field bắt buộc: Lý do từ chối
Helper: Lý do này sẽ được gửi cho nhân viên.
Actions: [Hủy] [Từ chối]
```

### Mutation success

| Action | Success UI |
| --- | --- |
| Approve | Toast `Đã duyệt đơn nghỉ`, row biến mất khỏi pending, calendar/balance refresh |
| Reject | Toast `Đã từ chối đơn nghỉ`, row biến mất khỏi pending |
| Cancel | Toast `Đã hủy đơn nghỉ`, status cập nhật Cancelled |
| Revoke | Toast `Đã thu hồi đơn nghỉ`, attendance/calendar refresh |

---

## 14.9 AllLeaveRequestsPage

### Mục tiêu

HR/Admin xem danh sách đơn nghỉ toàn bộ phạm vi được cấp.

### Filter nâng cao

| Filter | Ghi chú |
| --- | --- |
| Search | request_code, employee_code, name |
| Status | multi-select |
| Department | chỉ phòng ban trong scope |
| Employee | async combobox |
| Leave type | select |
| Date range | ngày nghỉ |
| Submitted range | ngày gửi |
| Reviewed range | ngày xử lý |
| Approver | async combobox |
| Duration type | FullDay/HalfDay/Hourly/MultipleDays |

### Bulk action MVP

MVP không nên duyệt bulk nếu nghiệp vụ chưa chốt. Bulk export có thể có nếu quyền `LEAVE.REQUEST.EXPORT`.

---

## 14.10 LeaveCalendarPage

### Mục tiêu

Hiển thị lịch nghỉ cá nhân, team, phòng ban hoặc công ty theo permission.

### View mode

| View | Desktop | Mobile |
| --- | --- | --- |
| Month | Default cho HR/Manager | Có thể chuyển thành list |
| Week | Tốt cho team | Default mobile nếu cần |
| List | Dùng cho mobile và lịch nhiều sự kiện | Default mobile |

### Filter

| Filter | Permission |
| --- | --- |
| Scope: My/Team/Company | Theo permission calendar |
| Department | HR/Admin/Manager scope phù hợp |
| Employee | HR/Admin/Manager scope phù hợp |
| Leave type | Nếu không sensitive hoặc có quyền |
| Status | Approved mặc định; Pending optional nếu có quyền |
| Date range | Bắt buộc |

### Calendar event rule

1. Approved hiển thị rõ hơn Pending.
2. Pending có thể hiển thị dạng nhạt nếu user có quyền xem.
3. Không hiển thị lý do nghỉ trong calendar list nếu thiếu quyền.
4. Click event mở popover hoặc detail drawer.
5. Mobile dùng list theo ngày để tránh lịch tháng quá nhỏ.

---

## 14.11 LeaveTypesPage

### Mục tiêu

HR/Admin quản lý danh mục loại nghỉ.

### Column

| Cột | Nội dung |
| --- | --- |
| Mã loại | leave_type_code |
| Tên loại | name |
| Đơn vị | Day/Hour |
| Có hưởng lương | is_paid |
| Có trừ số dư | is_balance_required |
| Bắt buộc lý do/file | flags |
| Cho nửa ngày/theo giờ | allow_half_day/allow_hourly |
| Nhạy cảm | is_sensitive |
| Trạng thái | Active/Inactive |
| Action | Sửa, vô hiệu hóa |

### Form drawer

Fields:

1. Mã loại nghỉ.
2. Tên loại nghỉ.
3. Mô tả.
4. Đơn vị.
5. Có hưởng lương.
6. Có trừ số dư.
7. Bắt buộc lý do.
8. Bắt buộc file.
9. Có cho nửa ngày.
10. Có cho nghỉ theo giờ.
11. Có cho âm phép.
12. Số ngày tối đa mỗi đơn.
13. Số ngày báo trước tối thiểu.
14. Đánh dấu nhạy cảm.
15. Trạng thái.

---

## 14.12 LeavePoliciesPage

### Mục tiêu

HR/Admin cấu hình chính sách nghỉ phép.

### MVP form fields gợi ý

| Field | Mô tả |
| --- | --- |
| Policy name | Tên chính sách |
| Leave type | Loại nghỉ áp dụng |
| Scope | Company/Department/Employee/Job level nếu backend hỗ trợ |
| Annual entitlement | Số ngày được cấp/năm |
| Accrual method | Manual/Monthly/Yearly nếu có |
| Prorate by start date | Tính theo ngày vào làm |
| Allow negative balance | Có cho âm phép |
| Negative limit | Giới hạn âm |
| Max days per request | Số ngày tối đa mỗi đơn |
| Min notice days | Số ngày báo trước tối thiểu |
| Allow half day/hourly | Cho nửa ngày/theo giờ |
| Exclude weekends/holidays | Loại trừ cuối tuần/ngày lễ |
| Status | Active/Inactive |

### UX rule

1. Policy thay đổi có thể ảnh hưởng nhiều employee nên phải có ConfirmDialog.
2. Nếu backend trả impact preview, hiển thị số nhân viên bị ảnh hưởng.
3. Không cho xóa cứng policy đã có dữ liệu request/balance; dùng inactive/soft delete.

---

## 14.13 LeaveBalancesPage

### Mục tiêu

HR/Admin xem số dư phép của nhân viên và điều chỉnh nếu có quyền.

### Column

| Cột | Nội dung |
| --- | --- |
| Nhân viên | name, employee_code |
| Phòng ban | department |
| Loại phép | leave_type |
| Năm/kỳ | period_year |
| Đầu kỳ | opening_balance |
| Được cấp | accrued_days |
| Đã dùng | used_days |
| Đang giữ chỗ | reserved_days |
| Điều chỉnh | adjusted_days |
| Còn lại | remaining_days |
| Action | Xem transaction, Điều chỉnh |

### Adjust drawer

Fields:

1. Employee readonly.
2. Leave type readonly.
3. Current remaining readonly.
4. Adjustment type: Add/Subtract/Set balance nếu backend hỗ trợ.
5. Amount days/hours.
6. Reason required.
7. Effective date optional.
8. Confirm checkbox nếu adjustment lớn.

### Business warning

1. Điều chỉnh âm số dư phải warning.
2. Điều chỉnh số dư có audit log và transaction.
3. Sau adjust phải refresh balance + transaction + dashboard balance widget nếu user bị ảnh hưởng.

---

## 15. Component inventory

| Component | Vai trò |
| --- | --- |
| `LeaveBalanceCard` | Hiển thị một loại số dư phép |
| `LeaveBalanceSummaryGrid` | Grid số dư nhiều loại nghỉ |
| `LeaveRequestForm` | Form tạo/sửa đơn nghỉ |
| `LeaveCalculationPreview` | Side panel preview tính ngày/số dư/cảnh báo |
| `LeaveRequestStatusBadge` | Badge trạng thái Draft/Pending/Approved/... |
| `LeaveRequestTable` | Table dùng cho my requests, approvals, all requests |
| `LeaveRequestDetailHeader` | Header chi tiết đơn nghỉ |
| `LeaveRequestTimeline` | Lịch sử xử lý đơn |
| `LeaveApprovalBox` | Khối duyệt/từ chối trong detail/drawer |
| `LeaveRejectDialog` | Modal từ chối có lý do bắt buộc |
| `LeaveCancelDialog` | Modal hủy đơn |
| `LeaveCalendar` | Calendar month/week/list |
| `LeaveCalendarEventPopover` | Popover event lịch nghỉ |
| `LeaveTypeFormDrawer` | Tạo/sửa loại nghỉ |
| `LeavePolicyFormDrawer` | Tạo/sửa chính sách |
| `LeaveBalanceAdjustDrawer` | Điều chỉnh số dư phép |
| `LeaveSensitiveField` | Mask/ẩn dữ liệu nhạy cảm |

---

## 16. Permission và action guard

### 16.1 Permission constants

```ts
export const LEAVE_PERMISSIONS = {
  BALANCE_VIEW_OWN: 'LEAVE.BALANCE.VIEW_OWN',
  BALANCE_VIEW: 'LEAVE.BALANCE.VIEW',
  BALANCE_ADJUST: 'LEAVE.BALANCE.ADJUST',
  BALANCE_TRANSACTION_VIEW: 'LEAVE.BALANCE.TRANSACTION_VIEW',

  REQUEST_CREATE: 'LEAVE.REQUEST.CREATE',
  REQUEST_SUBMIT: 'LEAVE.REQUEST.SUBMIT',
  REQUEST_VIEW_OWN: 'LEAVE.REQUEST.VIEW_OWN',
  REQUEST_VIEW: 'LEAVE.REQUEST.VIEW',
  REQUEST_UPDATE_DRAFT: 'LEAVE.REQUEST.UPDATE_DRAFT',
  REQUEST_CANCEL_OWN: 'LEAVE.REQUEST.CANCEL_OWN',
  REQUEST_APPROVE: 'LEAVE.REQUEST.APPROVE',
  REQUEST_REJECT: 'LEAVE.REQUEST.REJECT',
  REQUEST_CANCEL_ANY: 'LEAVE.REQUEST.CANCEL_ANY',
  REQUEST_REVOKE: 'LEAVE.REQUEST.REVOKE',
  REQUEST_EXPORT: 'LEAVE.REQUEST.EXPORT',

  CALENDAR_VIEW_OWN: 'LEAVE.CALENDAR.VIEW_OWN',
  CALENDAR_VIEW_TEAM: 'LEAVE.CALENDAR.VIEW_TEAM',
  CALENDAR_VIEW_COMPANY: 'LEAVE.CALENDAR.VIEW_COMPANY',

  TYPE_VIEW: 'LEAVE.TYPE.VIEW',
  TYPE_CREATE: 'LEAVE.TYPE.CREATE',
  TYPE_UPDATE: 'LEAVE.TYPE.UPDATE',
  TYPE_DELETE: 'LEAVE.TYPE.DELETE',

  POLICY_VIEW: 'LEAVE.POLICY.VIEW',
  POLICY_CREATE: 'LEAVE.POLICY.CREATE',
  POLICY_UPDATE: 'LEAVE.POLICY.UPDATE',
  POLICY_DELETE: 'LEAVE.POLICY.DELETE',

  FILE_VIEW: 'LEAVE.FILE.VIEW',
  FILE_UPLOAD: 'LEAVE.FILE.UPLOAD',
  FILE_DELETE: 'LEAVE.FILE.DELETE',
  AUDIT_LOG_VIEW: 'LEAVE.AUDIT_LOG.VIEW',
} as const;
```

### 16.2 Action resolver

```ts
export function getLeaveRequestActions(
  request: LeaveRequestDetail,
  auth: AuthContextValue,
): LeaveRequestAction[] {
  const actions: LeaveRequestAction[] = [];
  const isOwner = request.employee.id === auth.employee?.id;

  if (
    isOwner &&
    request.status === 'Draft' &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_UPDATE_DRAFT)
  ) {
    actions.push('edit');
  }

  if (
    isOwner &&
    request.status === 'Draft' &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_SUBMIT)
  ) {
    actions.push('submit');
  }

  if (
    isOwner &&
    ['Draft', 'Pending'].includes(request.status) &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_CANCEL_OWN)
  ) {
    actions.push('cancel');
  }

  if (
    request.status === 'Pending' &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_APPROVE)
  ) {
    actions.push('approve');
  }

  if (
    request.status === 'Pending' &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_REJECT)
  ) {
    actions.push('reject');
  }

  if (
    request.status === 'Approved' &&
    auth.can(LEAVE_PERMISSIONS.REQUEST_REVOKE)
  ) {
    actions.push('revoke');
  }

  return actions;
}
```

Lưu ý: resolver trên chỉ quyết định UX sơ bộ. Backend vẫn kiểm tra target resource, data scope và business validation.

---

## 17. Error handling

### 17.1 Error mapping LEAVE

| Error code | UI behavior |
| --- | --- |
| `LEAVE-ERR-001` thiếu loại nghỉ | Field error tại `leave_type_id` |
| `LEAVE-ERR-002` ngày không hợp lệ | Field error tại date range |
| `LEAVE-ERR-013` vượt số ngày phép còn lại | Preview danger + disable submit nếu blocking |
| `LEAVE-ERR-014` vượt giới hạn âm phép | Preview danger |
| `LEAVE-ERR-015` trùng thời gian nghỉ | Preview danger + link đơn trùng nếu có |
| `LEAVE-ERR-016` không có người duyệt | Preview danger, hướng liên hệ HR |
| `LEAVE-ERR-017` đơn không tồn tại | NotFoundState |
| `LEAVE-ERR-018` không có quyền xem đơn | ForbiddenState |
| `LEAVE-ERR-019` không thể sửa đơn | Disable edit + toast/error state |
| `LEAVE-ERR-020` không thể hủy đơn | Disable cancel + tooltip hoặc dialog error |
| `LEAVE-ERR-021` không có quyền duyệt | Forbidden toast + refresh row |
| `LEAVE-ERR-022` không có quyền từ chối | Forbidden toast + refresh row |
| `VALIDATION-ERR-*` | Inline form errors + ErrorSummary |
| `AUTH-ERR-FORBIDDEN` | ForbiddenState hoặc toast tùy ngữ cảnh |
| `NETWORK_ERROR` | ErrorState có retry |

### 17.2 Optimistic update

Không nên optimistic update cho approve/reject/cancel trong MVP vì các action này ảnh hưởng số dư phép, attendance và notification. Chỉ cập nhật UI sau khi API thành công.

---

## 18. Notification và deep link

### 18.1 Deep link mapping

| Notification event | Target route |
| --- | --- |
| `LEAVE_REQUEST_SUBMITTED` | `/leave/requests/:requestId` hoặc `/leave/approvals` |
| `LEAVE_REQUEST_APPROVED` | `/leave/requests/:requestId` |
| `LEAVE_REQUEST_REJECTED` | `/leave/requests/:requestId` |
| `LEAVE_REQUEST_CANCELLED` | `/leave/requests/:requestId` |
| `LEAVE_BALANCE_ADJUSTED` | `/leave/me/balances` hoặc `/leave/balances/:balanceId/transactions` |
| `LEAVE_LOW_BALANCE` | `/leave/me/balances` |

### 18.2 Rule

1. Click notification phải mark read qua NOTI rồi mới navigate hoặc navigate song song với optimistic read nếu đã có chuẩn chung.
2. Khi vào detail từ notification, LEAVE vẫn phải gọi API detail và xử lý 403/404.
3. Không tin payload notification để render dữ liệu nhạy cảm.

---

## 19. Dashboard integration

### 19.1 Quick action từ Dashboard sang LEAVE

| Dashboard action/widget | Route đích |
| --- | --- |
| Tạo đơn nghỉ | `/leave/requests/new` |
| Phép còn lại | `/leave/me/balances` |
| Đơn nghỉ chờ duyệt | `/leave/approvals` |
| Lịch nghỉ team | `/leave/calendar?scope=team` |
| Lịch nghỉ công ty | `/leave/calendar?scope=company` |

### 19.2 Invalidate Dashboard sau mutation

Sau các mutation sau, frontend nên invalidate dashboard query:

1. Submit request.
2. Approve request.
3. Reject request.
4. Cancel/revoke request.
5. Adjust balance.
6. Update policy ảnh hưởng widget phép còn lại.

---

## 20. Attendance integration

LEAVE không trực tiếp sửa attendance ở frontend. Tuy nhiên sau khi approve/cancel/revoke đơn nghỉ, frontend cần invalidate một số query attendance nếu các màn liên quan đang được cache.

| LEAVE event | Attendance query cần refresh |
| --- | --- |
| Approve full-day leave | attendance today, attendance records tháng tương ứng |
| Approve half-day/hourly leave | attendance record ngày tương ứng |
| Cancel/revoke approved leave | attendance record ngày tương ứng |

Frontend chỉ refresh cache. Logic cập nhật bảng công thuộc backend/ATT service.

---

## 21. Responsive behavior

| Màn | Desktop | Tablet | Mobile web |
| --- | --- | --- | --- |
| Overview | Grid 12 cột | 2 cột | 1 cột |
| My balance | Cards + transaction table | Cards + table scroll | Card list |
| My requests | DataTable đầy đủ | Table scroll | Card list theo đơn |
| Create leave | Form + preview side panel | Form + preview dưới/side | Fullscreen form + sticky preview/action |
| Detail | Detail page nhiều tab | Tabs + drawer action | Accordion/tabs + sticky action |
| Approval list | Table + drawer | Table scroll + drawer | Card list + fullscreen drawer |
| Calendar | Month/week/list | Week/list | List theo ngày |
| Types/policies/balances | Table + drawer | Table scroll | Ưu tiên read-only/card; cấu hình phức tạp khuyến nghị desktop |

---

## 22. Accessibility

1. Tất cả icon-only button phải có `aria-label`.
2. Status badge không chỉ dùng màu; phải có text.
3. Calendar event phải focus được bằng keyboard.
4. Modal approve/reject/cancel phải trap focus.
5. Form field có `label`, `aria-describedby` cho helper/error.
6. Error summary phải focus sau submit lỗi.
7. Date picker/time picker phải dùng được bằng keyboard hoặc có fallback input.
8. File upload phải có mô tả loại file/kích thước cho screen reader.
9. Drawer/modal có title rõ ràng.
10. Danger action có confirm text rõ hậu quả.

---

## 23. Security và dữ liệu nhạy cảm

1. Không lưu reason/file private URL vào localStorage/sessionStorage.
2. Không log payload đơn nghỉ ra console ở production.
3. Không hiển thị reason trong table/calendar nếu API đã mask hoặc user thiếu quyền.
4. Không tự dựng URL file từ storage path; chỉ gọi file service/download endpoint.
5. Sau logout phải clear toàn bộ leave query cache.
6. Query cache phải phân tách theo user/session để tránh lộ dữ liệu khi đổi tài khoản.
7. Export phải đi qua API có permission; không export từ dữ liệu table nếu thiếu quyền.
8. Form draft autosave nếu có ở phase sau phải mã hóa/lưu cẩn thận; MVP không bắt buộc autosave local.

---

## 24. Testing plan

### 24.1 Unit test

| Nhóm | Test |
| --- | --- |
| Permission utils | Action visibility theo status/permission |
| Status map | Badge label/color/icon theo status |
| Date utils | Format range, half day, hourly |
| Form schema | Required field, date range, half-day/hourly validation |
| Query params | Build filter/sort/pagination đúng whitelist |

### 24.2 Component test

| Component | Test |
| --- | --- |
| LeaveRequestForm | Render field theo loại nghỉ, validate, dirty guard |
| LeaveCalculationPreview | Loading/valid/warning/error states |
| LeaveRequestTable | Row actions theo status/permission |
| LeaveApprovalBox | Approve/reject dialog và required reason |
| LeaveCalendar | Event masking, popover, view switch |
| LeaveBalanceAdjustDrawer | Required reason, dangerous adjustment confirm |

### 24.3 Integration test

| Flow | Kỳ vọng |
| --- | --- |
| Create draft | Tạo Draft, redirect detail hoặc my requests |
| Submit request | Status Pending, invalidate my requests/balance |
| Insufficient balance | Preview báo lỗi, không submit nếu blocking |
| Duplicate leave range | Preview báo trùng, hiển thị lỗi rõ |
| Approve request | Status Approved, pending list refresh, calendar/balance refresh |
| Reject request | Reason required, status Rejected |
| Cancel pending | Status Cancelled, list refresh |
| Calendar scope | Employee chỉ own, Manager team, HR company |
| Sensitive leave type | Không lộ tên/lý do nếu thiếu quyền |
| Notification deep link | Click mở đúng detail hoặc forbidden nếu mất quyền |

### 24.4 E2E test P0

1. Employee login -> Leave -> Create request -> Submit -> thấy Pending.
2. Manager login -> Approvals -> mở request -> Approve -> request biến khỏi pending.
3. Employee reload -> thấy request Approved và balance cập nhật.
4. Employee tạo request vượt phép -> không gửi được hoặc nhận lỗi rõ.
5. HR login -> Calendar company -> thấy leave approved nhưng không lộ dữ liệu nhạy cảm nếu policy mask.
6. HR adjust balance -> transaction được tạo -> employee thấy balance mới.

---

## 25. QA checklist

| Mã | Checklist | Kết quả |
| --- | --- | --- |
| FE10-QA-001 | Sidebar LEAVE chỉ hiện menu theo permission |  |
| FE10-QA-002 | Route guard chặn user thiếu quyền |  |
| FE10-QA-003 | My balance hiển thị đúng số dư và state thấp/âm phép |  |
| FE10-QA-004 | Create form preview số ngày nghỉ trước khi submit |  |
| FE10-QA-005 | Submit dùng loading và chống double click |  |
| FE10-QA-006 | Save draft tạo trạng thái Draft |  |
| FE10-QA-007 | Submit chuyển trạng thái Pending |  |
| FE10-QA-008 | Employee chỉ xem request của mình |  |
| FE10-QA-009 | Manager chỉ duyệt request trong scope |  |
| FE10-QA-010 | Reject bắt buộc nhập lý do |  |
| FE10-QA-011 | Approved request refresh balance/calendar/attendance cache |  |
| FE10-QA-012 | Cancel/revoke request refresh balance/calendar/attendance cache |  |
| FE10-QA-013 | Calendar không lộ lý do nghỉ nhạy cảm |  |
| FE10-QA-014 | File đính kèm không lộ storage path |  |
| FE10-QA-015 | Leave type/policy CRUD có confirm cho action nguy hiểm |  |
| FE10-QA-016 | Balance adjustment tạo transaction và có reason |  |
| FE10-QA-017 | Error API map đúng field/toast/state |  |
| FE10-QA-018 | Responsive mobile dùng card/list/fullscreen form hợp lý |  |
| FE10-QA-019 | Accessibility: keyboard, aria-label, focus trap, focus visible |  |
| FE10-QA-020 | Logout clear toàn bộ leave query cache |  |

---

## 26. Acceptance criteria

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| FE10-AC-001 | Có route và sidebar hoàn chỉnh cho module LEAVE trong ModuleWorkspaceLayout |
| FE10-AC-002 | Có màn số dư phép của tôi và danh sách đơn nghỉ của tôi |
| FE10-AC-003 | Có form tạo đơn nghỉ với preview tính số ngày/số giờ/số dư trước khi gửi |
| FE10-AC-004 | Hỗ trợ lưu nháp, sửa nháp, gửi đơn và hủy đơn theo permission/business rule |
| FE10-AC-005 | Có màn chi tiết đơn nghỉ với timeline xử lý, file, trạng thái và action theo quyền |
| FE10-AC-006 | Có màn đơn chờ duyệt cho Manager/HR/Admin |
| FE10-AC-007 | Duyệt/từ chối đơn đúng state transition; từ chối bắt buộc lý do |
| FE10-AC-008 | Có lịch nghỉ cá nhân/team/company theo permission và data scope |
| FE10-AC-009 | Có màn quản lý loại nghỉ, chính sách nghỉ và số dư phép cho HR/Admin |
| FE10-AC-010 | Mutation LEAVE invalidate đúng query liên quan: leave, dashboard, notification, attendance |
| FE10-AC-011 | Dữ liệu nhạy cảm trong reason/type/file/calendar được mask hoặc ẩn đúng quyền |
| FE10-AC-012 | Table/form/calendar/detail có loading, empty, error, forbidden, validation và success states |
| FE10-AC-013 | Frontend không hard-code theo role; dùng permission/data scope từ auth context |
| FE10-AC-014 | Có test plan unit/component/integration/E2E cho các flow P0 |
| FE10-AC-015 | Responsive desktop/tablet/mobile web đạt yêu cầu cho các màn P0 |

---

## 27. Thứ tự triển khai đề xuất

### Phase 1 - Nền module LEAVE

1. Tạo `features/leave` folder.
2. Tạo routes, sidebar, permission constants.
3. Tạo type definitions.
4. Tạo API client + query keys.
5. Tạo status badge, balance card, request table base.

### Phase 2 - Employee flow P0

1. MyLeaveBalancePage.
2. MyLeaveRequestsPage.
3. CreateLeaveRequestPage.
4. LeaveCalculationPreview.
5. LeaveRequestDetailPage cho owner.
6. Save draft, submit, cancel own.

### Phase 3 - Approval flow P0

1. LeaveApprovalListPage.
2. Approval drawer/detail.
3. Approve dialog.
4. Reject dialog.
5. Mutation invalidation.
6. Notification/deep link handling.

### Phase 4 - Calendar P0/P1

1. LeaveCalendarPage.
2. Month/week/list view.
3. Scope filter.
4. Event popover/detail link.
5. Sensitive data masking.

### Phase 5 - HR/Admin management P1

1. AllLeaveRequestsPage.
2. LeaveTypesPage.
3. LeavePoliciesPage.
4. LeaveBalancesPage.
5. Balance adjustment drawer.
6. Balance transactions.

### Phase 6 - Hardening

1. Error mapping đầy đủ.
2. Responsive tuning.
3. Accessibility pass.
4. Component/integration/E2E tests.
5. Performance check table/calendar.
6. QA regression với ATT/DASH/NOTI.

---

## 28. Definition of Done

Module FRONTEND-10 được xem là hoàn tất khi:

1. Tất cả route LEAVE P0/P1 hoạt động trong ModuleWorkspaceLayout.
2. Tất cả page gọi API qua query layer chuẩn, không gọi `fetch` trực tiếp.
3. Tất cả action quan trọng có permission guard, loading state và error handling.
4. Create leave có preview backend trước khi gửi.
5. Approval flow xử lý đúng approve/reject/cancel/revoke theo trạng thái.
6. Lịch nghỉ hiển thị đúng scope và không lộ dữ liệu nhạy cảm.
7. Mutation invalidate đúng cache liên module.
8. Các màn P0 responsive tốt trên desktop, tablet và mobile web.
9. Unit/component/integration tests cho P0 pass.
10. QA checklist FE10-QA được kiểm tra và không còn lỗi blocker.

---

## 29. Ghi chú triển khai

1. Không tự tính số ngày nghỉ cuối cùng ở frontend. Frontend chỉ preview từ API.
2. Không tự quyết định employee có đủ phép hay không. Backend trả kết quả rule.
3. Không hiển thị reason/file sensitive nếu API không trả hoặc trả masked.
4. Không approve/reject optimistic vì liên quan số dư phép, attendance và notification.
5. Không hard-code role HR/Manager/Employee trong component; dùng permission và data scope.
6. Không để Dashboard xử lý nghiệp vụ nghỉ phép; Dashboard chỉ điều hướng sang LEAVE.
7. Không để Notification payload thay thế API detail; luôn fetch detail khi mở deep link.
8. Không export dữ liệu bằng cách lấy toàn bộ table client-side nếu backend đã có export API kiểm quyền.
