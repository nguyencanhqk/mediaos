# FRONTEND-09: ATTENDANCE FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · **FRONTEND-09 Attendance** · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · [FRONTEND-13 System/Foundation](<FRONTEND-13_System_Foundation_Frontend.md>) · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-04 ATT](<../SPEC/SPEC-04 ATT.md>) · [ATT API: API-04](<../API Design/API-04_ATT_API_Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-09 |
| Tên tài liệu | Attendance Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ATT - Chấm công |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-08 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-09 mô tả cách triển khai frontend cho module **ATT - Chấm công** trong hệ thống quản lý doanh nghiệp nội bộ.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình Attendance trong MVP.
2. Chốt route, layout, sidebar và page structure cho module chấm công.
3. Chốt cách tổ chức code frontend cho `features/attendance`.
4. Chốt TypeScript model, API service, query hook, mutation hook và query key cho ATT.
5. Chốt UI flow cho check-in/check-out, bảng công, chi tiết ngày công, điều chỉnh công, remote request, ca làm và rule chấm công.
6. Chốt permission/data scope behavior trên frontend.
7. Chốt cách xử lý state: loading, empty, error, forbidden, disabled, conflict, stale data và validation.
8. Chốt tương tác giữa ATT với AUTH, HR, LEAVE, DASH, NOTI và FOUNDATION ở tầng frontend.
9. Làm cơ sở cho developer triển khai code thật, QA viết test case và PM kiểm soát phạm vi MVP.

---

## 3. Vị trí FRONTEND-09 trong roadmap frontend

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

FRONTEND-09 được triển khai sau khi đã có:

1. Layout chung `ModuleWorkspaceLayout`.
2. App registry và sidebar registry.
3. Permission framework.
4. API client và query layer.
5. Design System component nền tảng.
6. Auth context, employee context và route guard.
7. HR frontend cơ bản để chọn employee, department, position khi lọc hoặc gán ca.

---

## 4. Căn cứ triển khai

FRONTEND-09 bám theo các quyết định đã chốt:

1. Module ATT chịu trách nhiệm check-in/check-out, trạng thái hôm nay, bảng công, ca làm, rule, điều chỉnh công, remote/công tác, tự động chấm công và audit log.
2. Backend là nguồn kiểm soát quyền cuối cùng; frontend chỉ hỗ trợ UX bằng route guard, permission gate, hide/disable action và masked field.
3. Frontend không tự gửi `company_id`, `user_id`, `employee_id`, `role`, `permission` nếu backend có thể resolve từ auth context.
4. Mọi API ATT public dùng prefix `/api/v1/attendance`.
5. Mọi nghiệp vụ ATT public yêu cầu access token hợp lệ.
6. Check-in/check-out phải dùng server time, không tin giờ client.
7. Khi có leave approved full day, frontend phải hiển thị trạng thái bị chặn theo response backend.
8. Khi có remote approved, frontend hiển thị rule remote tương ứng: tự check-in/out hoặc tự động chấm công.
9. Khi user bấm nhiều lần, frontend phải chống double submit nhưng backend vẫn phải đảm bảo idempotency/conflict.
10. Dữ liệu nhạy cảm như GPS/IP/device/photo/proof file phải được mask nếu không có quyền.
11. Notification deep link hoặc Dashboard quick action khi điều hướng sang ATT vẫn phải để ATT screen tự load lại dữ liệu và kiểm tra quyền/business rule qua API.
12. ATT cần responsive tốt cho mobile web vì chấm công là nghiệp vụ dùng thường xuyên trên điện thoại.

---

## 5. Phạm vi FRONTEND-09

### 5.1 Bao gồm trong MVP

| Nhóm | Nội dung triển khai |
| --- | --- |
| Today attendance | Màn trạng thái chấm công hôm nay, check-in, check-out, timeline, alert nghiệp vụ |
| Attendance records | Bảng công cá nhân, team, company theo quyền; filter, search, sort, pagination |
| Attendance detail | Chi tiết ngày công, log thô, rule snapshot, adjustment history, audit nếu có quyền |
| Adjustment request | Tạo yêu cầu điều chỉnh công, danh sách yêu cầu, chi tiết, duyệt, từ chối, hủy |
| Manual adjustment | HR/Admin điều chỉnh trực tiếp bản ghi công nếu có quyền |
| Remote work | Tạo, xem, duyệt, từ chối, hủy yêu cầu remote/công tác |
| Shift | Danh sách, tạo, sửa, vô hiệu hóa ca làm việc |
| Shift assignment | Gán ca theo company, department hoặc employee |
| Attendance rule | Danh sách, tạo, sửa rule chấm công theo phạm vi |
| Export | Xuất bảng công theo bộ lọc nếu có quyền |
| Permission UX | Ẩn/disable action, forbidden page, masked sensitive field |
| State UX | Loading, empty, error, stale, forbidden, conflict, validation, no data due to scope |

### 5.2 Chưa triển khai sâu trong MVP nhưng chừa đường mở rộng

| Nhóm | Giai đoạn | Ghi chú frontend |
| --- | --- | --- |
| Thiết bị chấm công vật lý | Phase sau | Thêm `/attendance/devices`, sync status, mapping device log |
| Import Excel/CSV | Phase sau | Thêm import wizard, preview, validation row |
| Overtime | Phase sau | Tách overtime request hoặc tích hợp vào attendance detail |
| Khóa kỳ công | Phase sau | Thêm period lock badge, disable adjustment sau khi khóa |
| GPS/geofence nâng cao | Phase sau | Thêm map preview, geofence picker, anti-spoofing state |
| QR attendance | Phase sau | Thêm QR session, camera flow mobile |
| Face recognition | Phase sau | Tích hợp service riêng, chỉ hiển thị metadata/private file |
| Payroll integration | Phase 2 | Payroll đọc ATT, ATT không sửa dữ liệu payroll |
| AI anomaly detection | Phase 5 | Thêm anomaly flag, explanation, review workflow |

---

## 6. Route architecture

### 6.1 Base route

Tất cả màn Attendance nằm trong Module Workspace:

```text
/attendance
```

### 6.2 Route list

| Route | Screen code | Tên màn hình | Priority | Permission tối thiểu | Data scope |
| --- | --- | --- | --- | --- | --- |
| `/attendance` | UI-ATT-SCREEN-001 | Chấm công hôm nay | P0 | `ATT.ATTENDANCE.VIEW_OWN` | Own |
| `/attendance/my-records` | UI-ATT-SCREEN-002 | Bảng công cá nhân | P0 | `ATT.ATTENDANCE.VIEW_OWN` | Own |
| `/attendance/team-records` | UI-ATT-SCREEN-003 | Bảng công team | P1 | `ATT.ATTENDANCE.VIEW_TEAM` | Team |
| `/attendance/records` | UI-ATT-SCREEN-004 | Bảng công toàn công ty | P1 | `ATT.ATTENDANCE.VIEW_COMPANY` | Company |
| `/attendance/records/:id` | UI-ATT-SCREEN-005 | Chi tiết ngày công | P0 | `ATT.ATTENDANCE.VIEW_DETAIL` | Own/Team/Company |
| `/attendance/records/:id/adjust` | UI-ATT-SCREEN-006 | Điều chỉnh công trực tiếp | P1 | `ATT.ATTENDANCE.ADJUST_DIRECT` | Team/Company |
| `/attendance/adjustment-requests/my` | UI-ATT-SCREEN-007 | Yêu cầu điều chỉnh của tôi | P1 | `ATT.ADJUSTMENT.VIEW_OWN` | Own |
| `/attendance/adjustment-requests` | UI-ATT-SCREEN-008 | Danh sách yêu cầu điều chỉnh | P1 | `ATT.ADJUSTMENT.VIEW_TEAM` hoặc `ATT.ADJUSTMENT.VIEW_COMPANY` | Team/Company |
| `/attendance/adjustment-requests/new` | UI-ATT-SCREEN-009 | Tạo yêu cầu điều chỉnh | P0 | `ATT.ADJUSTMENT.CREATE_OWN` | Own |
| `/attendance/adjustment-requests/:id` | UI-ATT-SCREEN-010 | Chi tiết/duyệt điều chỉnh | P1 | `ATT.ADJUSTMENT.VIEW_OWN/TEAM/COMPANY` | Own/Team/Company |
| `/attendance/remote-work-requests/my` | UI-ATT-SCREEN-011 | Remote/công tác của tôi | P1 | `ATT.REMOTE_REQUEST.VIEW_OWN` | Own |
| `/attendance/remote-work-requests` | UI-ATT-SCREEN-012 | Danh sách remote/công tác | P1 | `ATT.REMOTE_REQUEST.VIEW_TEAM` hoặc `ATT.REMOTE_REQUEST.VIEW_COMPANY` | Team/Company |
| `/attendance/remote-work-requests/new` | UI-ATT-SCREEN-013 | Tạo remote/công tác | P1 | `ATT.REMOTE_REQUEST.CREATE_OWN` | Own |
| `/attendance/remote-work-requests/:id` | UI-ATT-SCREEN-014 | Chi tiết/duyệt remote | P1 | `ATT.REMOTE_REQUEST.VIEW_OWN/TEAM/COMPANY` | Own/Team/Company |
| `/attendance/shifts` | UI-ATT-SCREEN-015 | Ca làm việc | P1 | `ATT.SHIFT.VIEW` | Company |
| `/attendance/shift-assignments` | UI-ATT-SCREEN-016 | Gán ca | P1 | `ATT.SHIFT_ASSIGNMENT.VIEW` | Company |
| `/attendance/rules` | UI-ATT-SCREEN-017 | Rule chấm công | P1 | `ATT.RULE.VIEW` | Company |
| `/attendance/reports` | UI-ATT-SCREEN-018 | Báo cáo chấm công | P2 | `ATT.ATTENDANCE.VIEW_TEAM/COMPANY` | Team/Company |
| `/attendance/audit-logs` | UI-ATT-SCREEN-019 | Audit chấm công | P2 | `ATT.AUDIT_LOG.VIEW` | Company/System |

---

## 7. Sidebar Attendance

```text
Chấm công
- Hôm nay
- Bảng công cá nhân
- Bảng công team
- Bảng công công ty

Yêu cầu
- Điều chỉnh công của tôi
- Duyệt điều chỉnh công
- Remote/Công tác của tôi
- Duyệt remote/công tác

Cấu hình
- Ca làm việc
- Gán ca
- Rule chấm công

Báo cáo & nhật ký
- Báo cáo chấm công
- Audit chấm công
```

### 7.1 Quy tắc hiển thị sidebar

| Menu | Điều kiện hiển thị |
| --- | --- |
| Hôm nay | Có `ATT.ATTENDANCE.VIEW_OWN` |
| Bảng công cá nhân | Có `ATT.ATTENDANCE.VIEW_OWN` |
| Bảng công team | Có `ATT.ATTENDANCE.VIEW_TEAM` |
| Bảng công công ty | Có `ATT.ATTENDANCE.VIEW_COMPANY` |
| Điều chỉnh công của tôi | Có `ATT.ADJUSTMENT.VIEW_OWN` hoặc `ATT.ADJUSTMENT.CREATE_OWN` |
| Duyệt điều chỉnh công | Có `ATT.ADJUSTMENT.VIEW_TEAM/COMPANY` hoặc `ATT.ADJUSTMENT.APPROVE` |
| Remote/Công tác của tôi | Có `ATT.REMOTE_REQUEST.VIEW_OWN` hoặc `ATT.REMOTE_REQUEST.CREATE_OWN` |
| Duyệt remote/công tác | Có `ATT.REMOTE_REQUEST.VIEW_TEAM/COMPANY` hoặc `ATT.REMOTE_REQUEST.APPROVE` |
| Ca làm việc | Có `ATT.SHIFT.VIEW` |
| Gán ca | Có `ATT.SHIFT_ASSIGNMENT.VIEW` |
| Rule chấm công | Có `ATT.RULE.VIEW` |
| Báo cáo chấm công | Có quyền xem team/company |
| Audit chấm công | Có `ATT.AUDIT_LOG.VIEW` |

---

## 8. Folder structure đề xuất

```text
src/
  features/
    attendance/
      api/
        attendance.api.ts
        attendance.types.ts
        attendance.keys.ts
      hooks/
        useAttendanceToday.ts
        useAttendanceRecords.ts
        useAttendanceRecordDetail.ts
        useAttendanceAdjustments.ts
        useRemoteWorkRequests.ts
        useShifts.ts
        useShiftAssignments.ts
        useAttendanceRules.ts
      routes/
        attendance.routes.tsx
        attendance.sidebar.ts
      pages/
        AttendanceTodayPage.tsx
        MyAttendanceRecordsPage.tsx
        TeamAttendanceRecordsPage.tsx
        CompanyAttendanceRecordsPage.tsx
        AttendanceRecordDetailPage.tsx
        CreateAdjustmentRequestPage.tsx
        AdjustmentRequestListPage.tsx
        AdjustmentRequestDetailPage.tsx
        RemoteWorkRequestListPage.tsx
        CreateRemoteWorkRequestPage.tsx
        RemoteWorkRequestDetailPage.tsx
        ShiftListPage.tsx
        ShiftAssignmentPage.tsx
        AttendanceRuleListPage.tsx
        AttendanceReportPage.tsx
      components/
        AttendanceStatusCard.tsx
        CheckInOutAction.tsx
        AttendanceTimeline.tsx
        AttendanceRuleSummary.tsx
        AttendanceRecordTable.tsx
        AttendanceStatusBadge.tsx
        AttendanceSourceBadge.tsx
        AttendanceSensitiveField.tsx
        AdjustmentRequestForm.tsx
        AdjustmentDiffTable.tsx
        AdjustmentApprovalPanel.tsx
        RemoteWorkRequestForm.tsx
        RemoteWorkApprovalPanel.tsx
        ShiftFormDrawer.tsx
        ShiftAssignmentMatrix.tsx
        AttendanceRuleFormDrawer.tsx
        AttendanceExportButton.tsx
      schemas/
        adjustment.schema.ts
        remoteWork.schema.ts
        shift.schema.ts
        rule.schema.ts
      utils/
        attendanceStatus.ts
        attendanceFormat.ts
        attendancePermission.ts
        attendanceFilters.ts
      __tests__/
        AttendanceTodayPage.test.tsx
        attendancePermission.test.ts
        attendanceQueries.test.ts
```

---

## 9. TypeScript model cốt lõi

### 9.1 Enum/status

```ts
export type AttendanceStatus =
  | 'Not Checked-in'
  | 'Checked-in'
  | 'Checked-out'
  | 'Present'
  | 'Late'
  | 'Early Leave'
  | 'Missing Hours'
  | 'Missing Check-in'
  | 'Missing Check-out'
  | 'Absent'
  | 'Leave'
  | 'Remote Work'
  | 'Auto Attendance'
  | 'Adjusted'
  | 'Pending Adjustment'
  | 'Invalid';

export type AttendanceSource =
  | 'WEB'
  | 'MOBILE'
  | 'MANUAL'
  | 'AUTO'
  | 'REMOTE'
  | 'DEVICE'
  | 'IMPORT'
  | 'API';

export type AdjustmentStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type RemoteRequestStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type ShiftType = 'Fixed' | 'Flexible';
```

### 9.2 Attendance today DTO

```ts
export interface AttendanceTodayDto {
  work_date: string;
  timezone: string;
  employee: EmployeeSummaryDto;
  attendance_record: AttendanceRecordDto | null;
  shift: ShiftSummaryDto | null;
  rule: AttendanceRuleSummaryDto | null;
  leave: {
    has_approved_leave: boolean;
    leave_type: string | null;
    leave_period: 'FULL_DAY' | 'AM' | 'PM' | 'HOURLY' | null;
  };
  remote: {
    has_approved_remote: boolean;
    remote_request_id: string | null;
    attendance_mode: 'SELF_CHECK_IN' | 'AUTO_ATTENDANCE' | 'NO_ATTENDANCE' | null;
  };
  actions: {
    can_check_in: boolean;
    can_check_out: boolean;
    can_create_adjustment_request: boolean;
    can_create_remote_request: boolean;
    disabled_reason: string | null;
  };
  alerts?: AttendanceAlertDto[];
}
```

### 9.3 Attendance record DTO

```ts
export interface AttendanceRecordDto {
  id: string;
  work_date: string;
  employee: EmployeeSummaryDto;
  department?: DepartmentSummaryDto;
  shift?: ShiftSummaryDto | null;
  check_in_at: string | null;
  check_out_at: string | null;
  worked_minutes: number;
  required_working_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  missing_minutes: number;
  attendance_status: AttendanceStatus;
  attendance_source: AttendanceSource;
  is_adjusted: boolean;
  has_pending_adjustment: boolean;
  applied_rule_id?: string | null;
  calculation_snapshot?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

### 9.4 Sensitive field DTO

```ts
export interface SensitiveAttendanceMetaDto {
  ip_address?: string | null;
  gps?: {
    is_valid: boolean;
    latitude: number | null;
    longitude: number | null;
    masked: boolean;
  };
  device?: {
    device_type: string | null;
    device_name: string | null;
    masked?: boolean;
  };
}
```

---

## 10. API service layer

### 10.1 API file

```text
src/features/attendance/api/attendance.api.ts
```

### 10.2 Service methods

```ts
export const attendanceApi = {
  getToday: () => apiClient.get<AttendanceTodayDto>('/attendance/today'),

  checkIn: (body: CheckInRequest) =>
    apiClient.post<AttendanceTodayDto>('/attendance/check-in', body, {
      idempotencyKey: true,
    }),

  checkOut: (body: CheckOutRequest) =>
    apiClient.post<AttendanceTodayDto>('/attendance/check-out', body, {
      idempotencyKey: true,
    }),

  getMyRecords: (params: AttendanceRecordQuery) =>
    apiClient.getList<AttendanceRecordDto>('/attendance/my-records', { params }),

  getTeamRecords: (params: AttendanceRecordQuery) =>
    apiClient.getList<AttendanceRecordDto>('/attendance/team-records', { params }),

  getRecords: (params: AttendanceRecordQuery) =>
    apiClient.getList<AttendanceRecordDto>('/attendance/records', { params }),

  getRecordDetail: (id: string) =>
    apiClient.get<AttendanceRecordDetailDto>(`/attendance/records/${id}`),

  exportRecords: (body: AttendanceRecordExportQuery) =>
    apiClient.post<AttendanceExportJobDto>('/attendance/exports', body, {
      idempotencyKey: true,
    }),

  createAdjustmentRequest: (body: CreateAdjustmentRequest) =>
    apiClient.post<AttendanceAdjustmentRequestDto>('/attendance/adjustment-requests', body, {
      idempotencyKey: true,
    }),

  getMyAdjustmentRequests: (params: AdjustmentRequestQuery) =>
    apiClient.getList<AttendanceAdjustmentRequestDto>('/attendance/adjustment-requests/my', { params }),

  getAdjustmentRequests: (params: AdjustmentRequestQuery) =>
    apiClient.getList<AttendanceAdjustmentRequestDto>('/attendance/adjustment-requests', { params }),

  getAdjustmentRequestDetail: (id: string) =>
    apiClient.get<AttendanceAdjustmentRequestDetailDto>(`/attendance/adjustment-requests/${id}`),

  approveAdjustmentRequest: (id: string, body: ReviewAdjustmentRequest) =>
    apiClient.post<AttendanceAdjustmentRequestDetailDto>(`/attendance/adjustment-requests/${id}/approve`, body),

  rejectAdjustmentRequest: (id: string, body: ReviewAdjustmentRequest) =>
    apiClient.post<AttendanceAdjustmentRequestDetailDto>(`/attendance/adjustment-requests/${id}/reject`, body),

  cancelAdjustmentRequest: (id: string) =>
    apiClient.post<AttendanceAdjustmentRequestDetailDto>(`/attendance/adjustment-requests/${id}/cancel`, {}),

  manualAdjustRecord: (recordId: string, body: ManualAdjustAttendanceRequest) =>
    apiClient.post<AttendanceRecordDetailDto>(`/attendance/records/${recordId}/manual-adjust`, body),

  createRemoteWorkRequest: (body: CreateRemoteWorkRequest) =>
    apiClient.post<RemoteWorkRequestDto>('/attendance/remote-requests', body, {
      idempotencyKey: true,
    }),

  getMyRemoteWorkRequests: (params: RemoteWorkRequestQuery) =>
    apiClient.getList<RemoteWorkRequestDto>('/attendance/remote-requests/my', { params }),

  getRemoteWorkRequests: (params: RemoteWorkRequestQuery) =>
    apiClient.getList<RemoteWorkRequestDto>('/attendance/remote-requests', { params }),

  approveRemoteWorkRequest: (id: string, body: ReviewRemoteWorkRequest) =>
    apiClient.post<RemoteWorkRequestDto>(`/attendance/remote-requests/${id}/approve`, body),

  rejectRemoteWorkRequest: (id: string, body: ReviewRemoteWorkRequest) =>
    apiClient.post<RemoteWorkRequestDto>(`/attendance/remote-requests/${id}/reject`, body),

  getShifts: (params: ShiftQuery) =>
    apiClient.getList<ShiftDto>('/attendance/shifts', { params }),

  createShift: (body: CreateShiftRequest) =>
    apiClient.post<ShiftDto>('/attendance/shifts', body),

  updateShift: (id: string, body: UpdateShiftRequest) =>
    apiClient.patch<ShiftDto>(`/attendance/shifts/${id}`, body),

  deleteShift: (id: string) =>
    apiClient.delete<void>(`/attendance/shifts/${id}`),

  getShiftAssignments: (params: ShiftAssignmentQuery) =>
    apiClient.getList<ShiftAssignmentDto>('/attendance/shift-assignments', { params }),

  createOrUpdateShiftAssignment: (body: UpsertShiftAssignmentRequest) =>
    apiClient.post<ShiftAssignmentDto>('/attendance/shift-assignments', body),

  getRules: (params: AttendanceRuleQuery) =>
    apiClient.getList<AttendanceRuleDto>('/attendance/rules', { params }),

  createRule: (body: CreateAttendanceRuleRequest) =>
    apiClient.post<AttendanceRuleDto>('/attendance/rules', body),

  updateRule: (id: string, body: UpdateAttendanceRuleRequest) =>
    apiClient.patch<AttendanceRuleDto>(`/attendance/rules/${id}`, body),
};
```

---

## 11. Query key factory

```ts
export const attendanceKeys = {
  all: ['attendance'] as const,
  today: () => [...attendanceKeys.all, 'today'] as const,
  records: (scope: 'my' | 'team' | 'company', params: AttendanceRecordQuery) =>
    [...attendanceKeys.all, 'records', scope, params] as const,
  recordDetail: (id: string) => [...attendanceKeys.all, 'records', id] as const,
  adjustments: (scope: 'my' | 'managed', params: AdjustmentRequestQuery) =>
    [...attendanceKeys.all, 'adjustments', scope, params] as const,
  adjustmentDetail: (id: string) => [...attendanceKeys.all, 'adjustments', id] as const,
  remoteRequests: (scope: 'my' | 'managed', params: RemoteWorkRequestQuery) =>
    [...attendanceKeys.all, 'remote-requests', scope, params] as const,
  remoteRequestDetail: (id: string) => [...attendanceKeys.all, 'remote-requests', id] as const,
  shifts: (params: ShiftQuery) => [...attendanceKeys.all, 'shifts', params] as const,
  shiftAssignments: (params: ShiftAssignmentQuery) =>
    [...attendanceKeys.all, 'shift-assignments', params] as const,
  rules: (params: AttendanceRuleQuery) => [...attendanceKeys.all, 'rules', params] as const,
};
```

### 11.1 Invalidation rule

| Mutation | Invalidate |
| --- | --- |
| Check-in | `today`, `records(my)`, dashboard attendance widget |
| Check-out | `today`, `records(my)`, `recordDetail(id)`, dashboard attendance widget |
| Create adjustment | `adjustments(my)`, `recordDetail(record_id)`, `records(my)` |
| Approve/reject adjustment | `adjustments(managed)`, `adjustmentDetail(id)`, `recordDetail(record_id)`, `records(team/company)`, dashboard approval widget |
| Manual adjust | `recordDetail(id)`, `records(team/company)`, `adjustments` |
| Create remote request | `remoteRequests(my)`, `today` |
| Approve/reject remote | `remoteRequests(managed)`, `today`, `records(team/company)` |
| Create/update shift | `shifts`, `today` nếu affect current user |
| Update shift assignment | `shiftAssignments`, `today`, `records` |
| Update rule | `rules`, `today`, `records` |

---

## 12. Permission helper

```ts
export function canViewMyAttendance(user: AuthUser) {
  return hasPermission(user, 'ATT.ATTENDANCE.VIEW_OWN');
}

export function canCheckIn(user: AuthUser, today?: AttendanceTodayDto) {
  return hasPermission(user, 'ATT.ATTENDANCE.CHECK_IN') && Boolean(today?.actions.can_check_in);
}

export function canCheckOut(user: AuthUser, today?: AttendanceTodayDto) {
  return hasPermission(user, 'ATT.ATTENDANCE.CHECK_OUT') && Boolean(today?.actions.can_check_out);
}

export function canCreateAdjustment(user: AuthUser, today?: AttendanceTodayDto) {
  return hasPermission(user, 'ATT.ADJUSTMENT.CREATE_OWN') && Boolean(today?.actions.can_create_adjustment_request);
}

export function canViewSensitiveAttendance(user: AuthUser) {
  return hasPermission(user, 'ATT.ATTENDANCE.VIEW_SENSITIVE');
}
```

### 12.1 Quy tắc UX theo permission

| Tình huống | UI behavior |
| --- | --- |
| Thiếu permission route | Hiển thị `ForbiddenPage`, không gọi API nghiệp vụ nếu route guard chặn được |
| Có permission route nhưng API trả 403 | Hiển thị `ForbiddenState`, log request id |
| Thiếu permission action | Ẩn action |
| Có permission action nhưng business rule chặn | Disable action + tooltip/alert từ `disabled_reason` |
| Thiếu quyền xem sensitive field | MaskedField, không hiển thị tọa độ/IP/device đầy đủ |
| Dữ liệu ngoài scope | Empty state “Không có dữ liệu trong phạm vi của bạn” hoặc 403/404 theo API |

---

## 13. Screen detail

## 13.1 UI-ATT-SCREEN-001: Chấm công hôm nay

### Route

```text
/attendance
```

### API chính

```http
GET  /api/v1/attendance/today
POST /api/v1/attendance/check-in
POST /api/v1/attendance/check-out
```

### Component

| Component | Vai trò |
| --- | --- |
| `AttendanceStatusCard` | Hiển thị trạng thái hôm nay, ca, rule, giờ vào/ra |
| `CheckInOutAction` | Nút check-in/check-out theo `actions` backend trả |
| `AttendanceTimeline` | Timeline log trong ngày |
| `AttendanceRuleSummary` | Tóm tắt rule áp dụng |
| `AttendanceAlertList` | Cảnh báo nghỉ phép, remote, missing checkout, auto attendance |
| `QuickLinksCard` | Link bảng công cá nhân, tạo điều chỉnh, tạo remote |

### Layout desktop

```text
PageHeader: Chấm công hôm nay                    [Xem bảng công]

[Alert nếu có]

+-----------------------------+-----------------------------+
| AttendanceStatusCard        | AttendanceRuleSummary       |
| - Status                    | - Ca làm                    |
| - Server time               | - Grace late                |
| - Check-in/out time         | - Required minutes          |
| - Worked minutes            | - GPS/note requirement      |
| [Check-in/Check-out]        |                             |
+-----------------------------+-----------------------------+

+-----------------------------+-----------------------------+
| AttendanceTimeline          | QuickLinksCard              |
+-----------------------------+-----------------------------+
```

### State theo backend

| Backend field | UI |
| --- | --- |
| `can_check_in = true` | Hiển thị primary button `Check-in` |
| `can_check_out = true` | Hiển thị primary button `Check-out` |
| `blocked_by_leave = true` hoặc `leave.has_approved_leave = true` | Alert nghỉ phép, disable check-in/out |
| `remote.has_approved_remote = true` | Badge `Remote`, hiển thị remote mode |
| `remote.attendance_mode = AUTO_ATTENDANCE` | Không hiển thị nút check-in/out, hiển thị trạng thái tự động chấm công |
| `actions.disabled_reason` | Tooltip/Alert lý do bị chặn |
| `missing_checkout_yesterday = true` | Alert + CTA tạo yêu cầu điều chỉnh |

### Check-in/check-out UX

1. Click `Check-in` mở confirm dialog nhẹ nếu rule yêu cầu ghi chú/GPS.
2. Submit mutation dùng idempotency key.
3. Button loading trong lúc xử lý.
4. Thành công: toast, cập nhật `today`, timeline và dashboard widget liên quan.
5. Conflict: hiển thị “Dữ liệu đã thay đổi, vui lòng tải lại”, refetch `today`.
6. Validation GPS/note: hiển thị inline trong dialog.
7. Không dùng giờ client để hiển thị kết quả cuối cùng; sau mutation phải refetch hoặc dùng response backend.

---

## 13.2 UI-ATT-SCREEN-002/003/004: Bảng công

### Route

```text
/attendance/my-records
/attendance/team-records
/attendance/records
```

### API

```http
GET  /api/v1/attendance/my-records
GET  /api/v1/attendance/team-records
GET  /api/v1/attendance/records
POST /api/v1/attendance/exports
```

### Filter

| Filter | My records | Team records | Company records |
| --- | --- | --- | --- |
| Tháng | Có | Có | Có |
| Khoảng ngày | Có | Có | Có |
| Trạng thái công | Có | Có | Có |
| Nguồn công | Có | Có | Có |
| Phòng ban | Không | Có nếu scope | Có |
| Nhân viên | Không | Có nếu scope | Có |
| Ca làm | Có | Có | Có |
| Có điều chỉnh | Có | Có | Có |
| Thiếu check-out | Có | Có | Có |

### Column table

| Cột | Nội dung |
| --- | --- |
| Ngày | `work_date`, thứ trong tuần |
| Nhân viên | Ẩn ở my records, hiện ở team/company |
| Phòng ban | Team/company |
| Ca làm | Tên ca, giờ bắt đầu/kết thúc |
| Check-in | Giờ vào + source badge |
| Check-out | Giờ ra + source badge |
| Tổng giờ | `worked_minutes / required_working_minutes` |
| Trạng thái | StatusBadge: Present/Late/Missing/Leave/Remote/Absent |
| Điều chỉnh | Pending/Adjusted badge |
| Action | Xem chi tiết, tạo điều chỉnh, điều chỉnh trực tiếp, export |

### UX rule

1. Default my records: tháng hiện tại.
2. Team/company records bắt buộc filter theo tháng hoặc date range để tránh query quá rộng.
3. Table dùng server-side pagination/sort/filter.
4. Export dùng bộ lọc hiện tại, có confirm nếu số dòng lớn.
5. Row có `has_pending_adjustment = true` thì disable tạo request mới và hiển thị badge.
6. Mobile hiển thị dạng card list thay vì table đầy đủ.

---

## 13.3 UI-ATT-SCREEN-005: Chi tiết ngày công

### Route

```text
/attendance/records/:id
```

### API

```http
GET /api/v1/attendance/records/{id}
POST /api/v1/attendance/records/{id}/manual-adjust
```

### Tab detail

| Tab | Nội dung |
| --- | --- |
| Tổng quan | Summary công, ca, rule, giờ vào/ra, trạng thái |
| Log chấm công | Attendance logs thô |
| Điều chỉnh | Adjustment requests liên quan, diff before/after |
| Remote/Leave | Dữ liệu leave/remote ảnh hưởng record nếu có |
| Audit | Chỉ hiện khi có `ATT.AUDIT_LOG.VIEW` |

### Sensitive fields

| Field | UI nếu thiếu quyền sensitive |
| --- | --- |
| GPS latitude/longitude | Chỉ hiện `GPS hợp lệ/không hợp lệ`, không hiện tọa độ |
| IP address | Mask `113.***.***.25` |
| Device name | Mask một phần |
| Photo/proof file | Chỉ hiện nếu file service cấp quyền |
| Adjustment reason nhạy cảm | Mask nếu backend đánh dấu sensitive |

---

## 13.4 UI-ATT-SCREEN-009: Tạo yêu cầu điều chỉnh công

### Route

```text
/attendance/adjustment-requests/new?record_id=:id
```

### API

```http
POST /api/v1/attendance/adjustment-requests
```

### Form fields

| Field | Loại | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| Ngày công | Select/date | Có | Có thể prefill từ record detail |
| Loại yêu cầu | Select | Có | MISSING_CHECK_IN, MISSING_CHECK_OUT, UPDATE_CHECK_IN, UPDATE_CHECK_OUT, EXPLAIN_LATE, EXPLAIN_EARLY_LEAVE, UPDATE_STATUS, REMOTE_CORRECTION, OTHER |
| Giờ check-in đề xuất | Time/DateTime | Tùy loại | Hiện khi cần sửa check-in |
| Giờ check-out đề xuất | Time/DateTime | Tùy loại | Hiện khi cần sửa check-out |
| Lý do | Textarea | Có | Min length theo schema |
| File bằng chứng | Upload | Tùy rule | Dùng file service private |

### Validation frontend

1. Không cho gửi nếu không chọn ngày công.
2. Với missing check-out phải nhập giờ check-out đề xuất.
3. Với missing check-in phải nhập giờ check-in đề xuất.
4. Giờ đề xuất không được nằm ngoài ngày/ca nếu rule chặn.
5. Lý do không được quá ngắn.
6. Nếu backend trả `ATT-ERR-023` đang có request pending, hiển thị alert và link tới request đang pending nếu backend trả target.

---

## 13.5 UI-ATT-SCREEN-010: Chi tiết/duyệt yêu cầu điều chỉnh

### API

```http
GET  /api/v1/attendance/adjustment-requests/{id}
POST /api/v1/attendance/adjustment-requests/{id}/approve
POST /api/v1/attendance/adjustment-requests/{id}/reject
POST /api/v1/attendance/adjustment-requests/{id}/cancel
```

### Layout

```text
PageHeader: Yêu cầu điều chỉnh ATT-ADJ-2026-0001 [Pending]

Summary request
- Employee
- Work date
- Request type
- Reason
- Created at

Diff table
+----------------+-----------+-----------+
| Field          | Current   | Requested |
+----------------+-----------+-----------+
| check_out_at   | --        | 17:35     |

Approval panel
[Approve] [Reject]
```

### Action rule

| Action | Điều kiện |
| --- | --- |
| Approve | Có `ATT.ADJUSTMENT.APPROVE`, request Pending, thuộc scope |
| Reject | Có `ATT.ADJUSTMENT.REJECT`, request Pending, thuộc scope |
| Cancel | Owner có `ATT.ADJUSTMENT.CANCEL_OWN`, request Pending |
| View evidence | Có quyền file + scope |

---

## 13.6 UI-ATT-SCREEN-011/012/013/014: Remote/Công tác

### API

```http
POST /api/v1/attendance/remote-requests
GET  /api/v1/attendance/remote-requests/my
GET  /api/v1/attendance/remote-requests
POST /api/v1/attendance/remote-requests/{id}/approve
POST /api/v1/attendance/remote-requests/{id}/reject
```

### Form tạo remote/công tác

| Field | Loại | Ghi chú |
| --- | --- | --- |
| Loại request | Remote / Công tác / Làm ngoài văn phòng |
| Khoảng ngày | DateRange |
| Buổi/ngày | Full day, AM, PM, hourly nếu rule cho phép |
| Lý do | Textarea |
| Địa điểm | Text input |
| Ghi chú công việc | Textarea |
| Task/project liên quan | Optional phase sau |
| File đính kèm | Optional |

### UI khi remote approved ảnh hưởng today

1. Badge `Remote Work` trên Today Attendance.
2. Nếu remote tự check-in/out: vẫn hiển thị nút, nhưng label có thể là `Check-in remote`.
3. Nếu remote auto attendance: hiển thị `Tự động chấm công remote`, không yêu cầu bấm.
4. Nếu rule yêu cầu GPS/note: check-in dialog hiển thị field tương ứng.

---

## 13.7 UI-ATT-SCREEN-015: Ca làm việc

### API

```http
GET    /api/v1/attendance/shifts
POST   /api/v1/attendance/shifts
PATCH  /api/v1/attendance/shifts/{id}
DELETE /api/v1/attendance/shifts/{id}
```

### Table columns

| Cột | Nội dung |
| --- | --- |
| Mã ca | `shift_code` |
| Tên ca | `name` |
| Loại ca | Fixed/Flexible |
| Giờ làm | Start - End hoặc flexible window |
| Nghỉ giữa ca | Break minutes |
| Phút yêu cầu | Required working minutes |
| Timezone | Asia/Ho_Chi_Minh |
| Trạng thái | Active/Inactive |
| Action | Edit, deactivate |

### Form drawer

1. Shift code.
2. Name.
3. Shift type.
4. Start time / end time.
5. Flexible check-in window nếu shift type flexible.
6. Break minutes.
7. Required working minutes.
8. Grace late minutes.
9. Allow early check-in.
10. Allow late check-out.
11. Apply weekend/holiday nếu có.
12. Active status.

---

## 13.8 UI-ATT-SCREEN-016: Gán ca

### API

```http
GET  /api/v1/attendance/shift-assignments
POST /api/v1/attendance/shift-assignments
```

### UX đề xuất

1. Tab theo phạm vi: Company, Department, Employee.
2. Filter theo department/employee/active date range.
3. Khi tạo assignment, hiển thị thứ tự ưu tiên:

```text
Employee assignment > Department assignment > Company default
```

4. Nếu gán trùng khoảng thời gian, backend trả conflict; frontend hiển thị conflict detail nếu có.
5. Có preview “Nhân viên bị ảnh hưởng” nếu backend hỗ trợ.

---

## 13.9 UI-ATT-SCREEN-017: Rule chấm công

### API

```http
GET  /api/v1/attendance/rules
POST /api/v1/attendance/rules
PATCH /api/v1/attendance/rules/{id}
```

### Nhóm setting trong form

| Nhóm | Field |
| --- | --- |
| Cơ bản | Name, scope, priority, active |
| Check-in/out | Required check-in, required check-out, allow missing checkout request |
| Đi muộn/về sớm | Grace late, grace early leave |
| Đủ công | Required working minutes, missing threshold |
| Remote | Allow remote check-in, auto attendance remote, requires note |
| GPS/mobile | Requires GPS, allowed radius, proof photo nếu có |
| Auto attendance | Allow auto attendance, default working minutes |
| Ngày lễ/cuối tuần | Allow holiday/weekend attendance |

### UX rule

1. Rule form chia section, không để form quá dài một cột.
2. Field nguy hiểm có warning text.
3. Khi update rule active, confirm vì có thể ảnh hưởng bảng công.
4. Sau khi lưu rule, invalidate `today`, `records`, dashboard widget nếu cần.

---

## 14. Form schema validation

### 14.1 Adjustment schema

```ts
export const adjustmentSchema = z.object({
  attendance_record_id: z.string().uuid(),
  request_type: z.enum([
    'MISSING_CHECK_IN',
    'MISSING_CHECK_OUT',
    'UPDATE_CHECK_IN',
    'UPDATE_CHECK_OUT',
    'EXPLAIN_LATE',
    'EXPLAIN_EARLY_LEAVE',
    'UPDATE_STATUS',
    'REMOTE_CORRECTION',
    'OTHER',
  ]),
  requested_check_in_at: z.string().datetime().optional(),
  requested_check_out_at: z.string().datetime().optional(),
  reason: z.string().min(10).max(1000),
  proof_file_ids: z.array(z.string().uuid()).optional(),
});
```

### 14.2 Remote work schema

```ts
export const remoteWorkSchema = z.object({
  request_type: z.enum(['Remote', 'BusinessTrip', 'Offsite']),
  start_date: z.string().date(),
  end_date: z.string().date(),
  period_type: z.enum(['FULL_DAY', 'AM', 'PM', 'HOURLY']),
  reason: z.string().min(10).max(1000),
  location: z.string().max(255).optional(),
  work_note: z.string().max(1000).optional(),
  proof_file_ids: z.array(z.string().uuid()).optional(),
});
```

---

## 15. Error handling

| Error code / tình huống | UI response |
| --- | --- |
| 401 | Auth interceptor refresh token hoặc logout |
| 403 | ForbiddenState hoặc toast nếu action mutation |
| 404 | NotFoundState cho detail; table refetch nếu row stale |
| 409 Conflict | Alert “Dữ liệu đã thay đổi”, nút tải lại |
| Validation error | Map vào field error + error summary |
| `ATT-ERR-023` đang có request Pending | Alert + link request pending nếu có |
| Kỳ công đã khóa | Disable adjustment/manual adjust + giải thích |
| Check-in trùng | Toast thông báo đã check-in, refetch today |
| Check-out chưa check-in | Alert rule, refetch today |
| Rule yêu cầu GPS nhưng thiếu GPS | Mở dialog yêu cầu cấp quyền vị trí/nhập ghi chú |
| Network error | ErrorState có retry |

---

## 16. Cross-module integration

### 16.1 AUTH

1. Dùng `authContext.user.permissions` để lọc route/menu/action.
2. Dùng `employeeContext` để biết user đã link employee hay chưa.
3. Nếu user chưa link employee, Today Attendance hiển thị blocked state và hướng liên hệ HR/Admin.

### 16.2 HR

1. Attendance list team/company dùng EmployeePicker, DepartmentPicker từ HR shared component.
2. Shift assignment theo department/employee reuse HR query hook hoặc shared lookup API.
3. Không tự lưu HR state trong ATT.

### 16.3 LEAVE

1. Today Attendance hiển thị alert leave approved nếu backend trả.
2. Attendance detail hiển thị leave impact nếu có.
3. Không gọi trực tiếp LEAVE để tự quyết định chặn; lấy quyết định cuối từ ATT API.

### 16.4 DASH

1. Dashboard quick action check-in/check-out điều hướng hoặc gọi ATT mutation shared.
2. Sau check-in/out invalidate dashboard widget liên quan.
3. Dashboard không tự tính trạng thái công.

### 16.5 NOTI

1. Notification deep link vào `/attendance/records/:id`, `/attendance/adjustment-requests/:id`, `/attendance/remote-work-requests/:id`.
2. Khi mở từ notification, screen vẫn gọi API detail để backend kiểm tra quyền/scope.
3. Nếu target không còn quyền, hiển thị forbidden/target unavailable.

### 16.6 FOUNDATION

1. Upload proof file dùng file service private.
2. Export bảng công dùng download service có permission.
3. Audit log nếu có quyền hiển thị từ audit API hoặc ATT detail API.

---

## 17. Responsive behavior

| Màn | Desktop | Tablet | Mobile web |
| --- | --- | --- | --- |
| Today | 2-column card | 1-2 column | Single column, action button sticky bottom |
| Records | Full table | Table scroll/collapse columns | Card list + filter drawer |
| Record detail | Tabs + side summary | Tabs | Accordion sections |
| Adjustment form | Center form/card | Form full width | Fullscreen form |
| Approval detail | Detail + approval side panel | Stacked | Approval action sticky bottom |
| Shift/rule settings | Table + drawer | Table scroll | List + fullscreen drawer |

Mobile Today Attendance cần ưu tiên:

1. Trạng thái hiện tại.
2. Nút check-in/check-out.
3. Alert bị chặn.
4. Giờ server.
5. Timeline ngắn.

---

## 18. Loading, empty, error state

### 18.1 Today Attendance

| State | UI |
| --- | --- |
| Loading | Skeleton status card + action placeholder |
| Empty/no employee | BlockedState: “Tài khoản chưa liên kết nhân viên” |
| Leave approved | Alert + disabled action |
| Remote auto | Status card remote auto |
| Error | ErrorState + Retry + request id |

### 18.2 Records table

| State | UI |
| --- | --- |
| Loading | Table skeleton |
| Empty | “Không có dữ liệu chấm công trong khoảng thời gian này” |
| No data due to scope | “Không có dữ liệu trong phạm vi quản lý của bạn” |
| Error | ErrorState + Retry |
| Stale | Badge “Dữ liệu có thể đã cũ” nếu query cache stale |

---

## 19. Accessibility

1. Nút check-in/check-out phải có label rõ, không chỉ icon.
2. Status badge không chỉ dựa vào màu; phải có text.
3. Dialog xác nhận hỗ trợ keyboard Enter/Escape.
4. Form có label, aria-describedby cho helper/error text.
5. Table row action có aria-label.
6. Timeline log đọc được bằng screen reader.
7. Mobile sticky action không che nội dung form.
8. Focus ring hiển thị rõ sau mutation/dialog.

---

## 20. Testing plan

### 20.1 Unit test

| Nhóm | Test |
| --- | --- |
| Permission helper | Check route/action visibility theo permission |
| Status formatter | Map status -> label/badge/icon đúng |
| Time formatter | Format timezone Asia/Ho_Chi_Minh đúng |
| Query key | Query key ổn định theo filter |
| Validation schema | Adjustment/remote/shift/rule validation |

### 20.2 Component test

| Component | Test |
| --- | --- |
| AttendanceStatusCard | Render status, check-in/out time, disabled reason |
| CheckInOutAction | Button đúng theo can_check_in/can_check_out |
| AttendanceRecordTable | Render records, action theo permission |
| AdjustmentRequestForm | Dynamic field theo request type |
| AdjustmentApprovalPanel | Approve/reject loading, validation reason |
| SensitiveField | Mask/visible theo permission |

### 20.3 Integration test

| Flow | Kỳ vọng |
| --- | --- |
| Load today chưa check-in | Nút check-in hiển thị |
| Check-in thành công | Toast + refetch today + timeline cập nhật |
| Check-out thành công | Status checked-out + worked minutes |
| Leave full day approved | Button disabled + alert |
| Missing checkout | Alert + CTA tạo adjustment |
| Create adjustment | Request Pending + record có pending badge |
| Approve adjustment | Record detail cập nhật before/after |
| Remote approved auto | Today hiển thị auto attendance |
| HR chỉnh rule | Rule saved + today/records invalidated |

### 20.4 Permission/scope test

| Test | Kỳ vọng |
| --- | --- |
| Employee vào company records | Route forbidden |
| Manager xem adjustment ngoài team | API 403/404, UI không lộ dữ liệu |
| HR thiếu sensitive permission | GPS/IP/device masked |
| Thiếu permission export | Ẩn export button |
| Thiếu permission approve | Ẩn approve/reject |

---

## 21. Implementation phases

### Phase 1 - Attendance foundation

1. Tạo folder `features/attendance`.
2. Khai báo route, sidebar và permission mapping.
3. Tạo TypeScript DTO, query keys và API service.
4. Tạo status badge, source badge, time formatter.
5. Tạo `AttendanceTodayPage` và hooks today/check-in/check-out.

### Phase 2 - Records

1. Tạo my/team/company records pages.
2. Tạo filter bar, table/card responsive.
3. Tạo record detail page.
4. Tạo export button theo quyền.
5. Implement sensitive field masking.

### Phase 3 - Adjustment workflow

1. Tạo adjustment list/detail.
2. Tạo create adjustment form.
3. Tạo approval/reject/cancel actions.
4. Link adjustment từ record detail và missing checkout alert.

### Phase 4 - Remote work workflow

1. Tạo remote list/detail/create form.
2. Tạo approval/reject workflow.
3. Tích hợp trạng thái remote vào Today Attendance.

### Phase 5 - Shift/rule settings

1. Tạo shifts page + form drawer.
2. Tạo shift assignment page.
3. Tạo rule list + rule form drawer.
4. Invalidate today/records khi config thay đổi.

### Phase 6 - QA hardening

1. Test permission/data scope.
2. Test responsive mobile.
3. Test double submit/idempotency UI.
4. Test stale/conflict behavior.
5. Test deep link từ notification/dashboard.

---

## 22. Acceptance criteria

| Mã | Tiêu chí nghiệm thu |
| --- | --- |
| FE09-AC-001 | Có route và sidebar Attendance theo permission, không hard-code theo role |
| FE09-AC-002 | Employee xem được trạng thái chấm công hôm nay và check-in/check-out theo response backend |
| FE09-AC-003 | UI xử lý đúng leave approved, remote approved, auto attendance và disabled reason |
| FE09-AC-004 | Có bảng công cá nhân/team/company theo quyền, filter, sort, pagination và responsive |
| FE09-AC-005 | Có trang chi tiết ngày công với log, rule snapshot, adjustment history và masking dữ liệu nhạy cảm |
| FE09-AC-006 | Employee tạo được yêu cầu điều chỉnh công, chống gửi trùng và xử lý pending request |
| FE09-AC-007 | Manager/HR duyệt hoặc từ chối adjustment theo permission/scope |
| FE09-AC-008 | HR/Admin điều chỉnh công trực tiếp nếu có quyền và UI có confirm/audit note |
| FE09-AC-009 | Có remote/công tác request flow: tạo, xem, duyệt, từ chối, hủy |
| FE09-AC-010 | Có màn ca làm, gán ca và rule chấm công cơ bản |
| FE09-AC-011 | Export bảng công chỉ hiện khi có quyền và dùng filter hiện tại |
| FE09-AC-012 | Mọi mutation quan trọng có loading state, success toast, error mapping và query invalidation |
| FE09-AC-013 | Notification deep link và dashboard quick action vào ATT hoạt động đúng, không bỏ qua guard |
| FE09-AC-014 | Mobile web ưu tiên thao tác check-in/check-out nhanh, không vỡ layout |
| FE09-AC-015 | Unit/component/integration test bao phủ các flow P0/P1 |

---

## 23. Checklist bàn giao cho Developer

| Nhóm | Checklist |
| --- | --- |
| Route | Đã đăng ký attendance routes trong protected route tree |
| Sidebar | Đã đăng ký attendance sidebar theo permission |
| API | Đã tạo attendance API service theo `/api/v1/attendance` |
| Query | Đã tạo query key factory và hooks |
| Form | Đã tạo schema validation cho adjustment, remote, shift, rule |
| UI | Đã dùng component Design System, không tạo style rời rạc |
| Permission | Đã dùng PermissionGate/action guard/masked field |
| Error | Đã map 401/403/404/409/validation/business error |
| State | Đã có loading/empty/error/forbidden/stale/no scope |
| Responsive | Đã test desktop/tablet/mobile web |
| QA | Đã có test cases P0/P1 |

---

## 24. Ghi chú triển khai quan trọng

1. Frontend không tự tính đi muộn/về sớm/thiếu giờ làm nguồn sự thật; chỉ hiển thị kết quả từ backend.
2. Frontend có thể hiển thị preview nhẹ trong form, nhưng kết quả hợp lệ cuối cùng phải theo API.
3. Không dùng client time làm giờ check-in/check-out chính thức.
4. Không tự quyết định nhân viên có được chấm công khi có leave/remote; luôn dựa vào `GET /attendance/today`.
5. Không expose GPS/IP/device nếu backend đã mask hoặc user thiếu quyền.
6. Không gọi internal API từ frontend.
7. Mọi action nguy hiểm như approve/reject/manual adjust/update rule/deactivate shift phải có confirm.
8. Sau logout phải clear toàn bộ query cache chứa dữ liệu chấm công.
9. Dashboard và Notification chỉ điều hướng hoặc dùng shared mutation; nghiệp vụ ATT vẫn thuộc ATT module.
10. Khi dữ liệu thay đổi bởi LEAVE/REMOTE/RULE, frontend cần chấp nhận stale state và refetch theo invalidation từ mutation hoặc realtime/event phase sau.

---

## 25. Kết luận

FRONTEND-09 hoàn thiện kế hoạch triển khai frontend cho module **Attendance / Chấm công** theo hướng:

1. Ưu tiên nghiệp vụ hằng ngày của Employee: xem trạng thái, check-in, check-out, xem bảng công và gửi điều chỉnh.
2. Hỗ trợ Manager/HR xử lý bảng công, duyệt điều chỉnh, duyệt remote và quản trị dữ liệu theo scope.
3. Cho phép HR/Admin cấu hình ca làm, gán ca và rule chấm công cơ bản.
4. Bám chặt backend API, permission, data scope và business rule.
5. Tối ưu trải nghiệm mobile web cho thao tác chấm công nhanh.
6. Sẵn sàng mở rộng sang thiết bị chấm công, GPS nâng cao, overtime, payroll và AI anomaly ở các phase sau.
