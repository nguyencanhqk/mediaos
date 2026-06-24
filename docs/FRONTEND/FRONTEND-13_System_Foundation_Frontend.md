# FRONTEND-13: SYSTEM / FOUNDATION FRONTEND

> **📚 Bộ tài liệu FRONTEND — Hệ thống Quản lý Doanh nghiệp**
> [FRONTEND-01 Kiến trúc & Setup](<FRONTEND-01_Frontend_Architecture_Project_Setup.md>) · [FRONTEND-02 Design System](<FRONTEND-02_Design_System_Implementation.md>) · [FRONTEND-03 Routing/Auth/Permission](<FRONTEND-03_Routing_Auth_Guard_Permission_Framework.md>) · [FRONTEND-04 API Client](<FRONTEND-04_API_Client_Query_Layer_Error_Handling.md>) · [FRONTEND-05 Layout](<FRONTEND-05_Layout_Implementation.md>) · [FRONTEND-06 AUTH/Account](<FRONTEND-06_AUTH_Account_Frontend.md>) · [FRONTEND-07 Dashboard](<FRONTEND-07_Dashboard_Frontend.md>) · [FRONTEND-08 HR](<FRONTEND-08_HR_Frontend.md>) · [FRONTEND-09 Attendance](<FRONTEND-09_Attendance_Frontend.md>) · [FRONTEND-10 Leave](<FRONTEND-10_Leave_Frontend.md>) · [FRONTEND-11 Task](<FRONTEND-11_Task_Frontend.md>) · [FRONTEND-12 Notification](<FRONTEND-12_Notification_Frontend.md>) · **FRONTEND-13 System/Foundation** · [FRONTEND-14 QA & Release](<FRONTEND-14_QA_Performance_Release_Readiness.md>)
>
> **Liên quan:** [Đặc tả: SPEC-01 §16](<../SPEC/SPEC-01 Tổng quan.md>) · [FOUNDATION API: API-09](<../API Design/API-09_FOUNDATION_API_Design.md>) · [Audit/Files/Settings: DB-08](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [Màn hình: UI-09](<../UI/UI-09_Module_UI_Design.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | FRONTEND-13 |
| Tên tài liệu | System / Foundation Frontend |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | SYSTEM / FOUNDATION |
| Giai đoạn | Frontend Implementation - MVP Version 1.0 |
| Trạng thái | Draft |
| Ngày tạo | 20/06/2026 |
| Ngày cập nhật | 20/06/2026 |
| Tài liệu nguồn | PRD-00, SPEC-01 -> SPEC-08, DB-01 -> DB-10, API-01 -> API-09, UI-01 -> UI-10, FRONTEND-01 -> FRONTEND-12 |
| Người viết |  |
| Người duyệt |  |

---

## 2. Mục đích tài liệu

FRONTEND-13 mô tả cách triển khai frontend cho nhóm màn hình **System / Foundation** của hệ thống quản lý doanh nghiệp nội bộ.

Nhóm System / Foundation không phải là một nghiệp vụ riêng như HR, ATT, LEAVE, TASK hoặc NOTI. Đây là lớp quản trị nền tảng giúp Admin/Super Admin và một số vai trò có quyền cao cấu hình, giám sát và vận hành các thành phần dùng chung của hệ thống.

Tài liệu này dùng để:

1. Chốt phạm vi màn hình System/Foundation trong MVP.
2. Chốt route, sidebar, permission, data scope và screen code cho từng màn hình.
3. Chốt cấu trúc thư mục frontend cho module `system` hoặc `foundation`.
4. Chốt API service, query hook và mutation hook cho Foundation API.
5. Chuẩn hóa UI cho company settings, system settings, module catalog, file metadata, audit log, public holidays, sequence preview và seed/status nếu có.
6. Chuẩn hóa cách hiển thị dữ liệu nhạy cảm, cấu hình nhạy cảm, file private và audit log.
7. Đảm bảo frontend chỉ hỗ trợ UX bằng guard, hide, disable, mask; backend vẫn là nguồn kiểm tra quyền cuối cùng.
8. Làm checklist cho FE, BE/API và QA khi hoàn thiện System/Foundation MVP.

---

## 3. Vị trí FRONTEND-13 trong roadmap frontend

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

FRONTEND-13 là bước hoàn thiện nhóm quản trị nền tảng sau khi các module nghiệp vụ chính đã có màn hình frontend riêng.

---

## 4. Căn cứ triển khai

FRONTEND-13 bám theo các quyết định đã chốt:

1. Frontend dùng **ModuleWorkspaceLayout** cho mọi màn protected thuộc module System/Foundation.
2. System/Foundation là nơi hiển thị và cấu hình các thành phần nền tảng: company, module catalog, system settings, company settings, audit log, file metadata, file links, sequence, public holidays, retention và seed status.
3. API foundation dùng prefix đề xuất `/api/v1/foundation`.
4. Frontend không tự gửi `company_id`, `user_id`, `role`, `permission`, `data_scope` nếu backend có thể resolve từ auth context.
5. Mọi route, menu, tab, button, bulk action và field nhạy cảm phải kiểm tra permission + data scope.
6. Backend vẫn là guard cuối cùng cho authentication, authorization, data scope, business validation, audit log và file permission.
7. File private là mặc định; frontend không được hiển thị storage path hoặc public URL cố định của file private.
8. Audit log là dữ liệu nhạy cảm; frontend cần hỗ trợ filter, detail, diff view, mask field và export theo quyền.
9. System settings và company settings có thể chứa giá trị sensitive; frontend phải dùng masked field và không cố render raw value nếu API đã mask.
10. Module catalog ảnh hưởng Home Portal, App Switcher, Sidebar, Dashboard, Permission và Feature Flag; mutation module cần invalidation đúng các cache liên quan.
11. Sequence/public holidays là dữ liệu dùng chung cho HR/ATT/LEAVE/TASK; frontend cần tránh chỉnh nhầm vì có thể ảnh hưởng nhiều module.
12. Seed/migration status nếu hiển thị trong MVP chỉ dành cho Super Admin hoặc system operator.

---

## 5. Phạm vi FRONTEND-13

### 5.1 Bao gồm trong MVP

| Nhóm | Màn hình / chức năng |
| --- | --- |
| System overview | Tổng quan trạng thái hệ thống nền tảng, module active, cảnh báo cấu hình |
| Company settings | Xem/cập nhật cấu hình công ty cơ bản, locale, timezone, branding nhẹ |
| System settings | Xem/cập nhật cấu hình hệ thống theo key/category/module, mask sensitive |
| Module catalog | Danh sách module, trạng thái active/disabled/coming soon, dependency, sort order |
| File metadata | Danh sách file, chi tiết file, trạng thái upload/scan, visibility, entity links |
| File access log | Log xem/tải/xóa file nhạy cảm nếu API hỗ trợ MVP |
| Audit logs | Danh sách audit log, filter, chi tiết audit, diff before/after, actor/target/module |
| Public holidays | Danh sách ngày nghỉ lễ/ngày không làm việc, tạo/sửa/xóa mềm theo quyền |
| Sequence preview | Xem cấu hình/bộ đếm sequence, preview mã tiếp theo nếu API cho phép |
| Data retention | Xem policy retention log/file/cache nếu có trong MVP |
| Seed status | Xem seed batches/items hoặc migration/seed health nếu có trong MVP |
| Foundation shared hooks | API service, query key, hook, permission UI, table/form/page state dùng chung |

### 5.2 Không bao gồm hoặc chỉ liên kết trong MVP

| Nội dung | Chuyển sang / Ghi chú |
| --- | --- |
| User/Role/Permission CRUD chi tiết | FRONTEND-06 AUTH & Account Frontend; System workspace có thể đặt menu/link |
| Notification event/template config chi tiết | FRONTEND-12 Notification Frontend |
| Dashboard widget config chi tiết | FRONTEND-07 Dashboard Frontend; Foundation chỉ hiển thị module/settings liên quan |
| Attendance rules, leave policies, employee code config | Module nghiệp vụ tương ứng |
| Storage provider nâng cao, S3 bucket, signed upload multipart | Phase sau hoặc DevOps/Admin riêng |
| Data retention job execution thủ công | Phase sau; MVP chỉ nên xem policy/status |
| Migration runner UI | Không khuyến nghị cho MVP public admin UI |
| SaaS subscription/billing tenant | Phase SaaS sau |
| Branch/location management nâng cao | Phase sau hoặc HR/Foundation mở rộng |

---

## 6. Nguyên tắc thiết kế quan trọng

### 6.1 Foundation là hạ tầng, không xử lý nghiệp vụ gốc

System/Foundation frontend chỉ nên hiển thị và cấu hình hạ tầng dùng chung. Không để màn Foundation tự quyết định nghiệp vụ như:

1. Ai được duyệt nghỉ.
2. Ai được chấm công.
3. Task nào được chuyển trạng thái.
4. Dashboard nào được lấy dữ liệu nhạy cảm.
5. Notification nào gửi cho ai.

Các quyết định đó phải nằm trong module nghiệp vụ tương ứng và backend service tương ứng.

### 6.2 Không hard-code role trong UI

Không viết:

```ts
if (user.role === 'SUPER_ADMIN') {
  showSystemSettings();
}
```

Phải viết:

```ts
if (permission.can('FOUNDATION.SETTING.SYSTEM_MANAGE')) {
  showSystemSettings();
}
```

Role chỉ là nhóm quyền được seed. Frontend hiển thị theo permission/data scope thực tế từ backend.

### 6.3 Cấu hình nhạy cảm phải được mask

Các key như SMTP password, storage secret, API key, OAuth client secret, security policy secret, token secret không được hiển thị raw.

UI behavior:

1. Nếu API trả `is_sensitive = true`, render bằng `MaskedField`.
2. Không cho copy raw nếu API không trả raw.
3. Nếu có quyền rotate/update secret, dùng form nhập giá trị mới, không cần hiển thị giá trị cũ.
4. Khi submit, không log value ra console, toast hoặc error boundary.

### 6.4 File private là mặc định

Frontend không được:

```text
- Hiển thị storage_path.
- Gắn trực tiếp storage URL cố định vào href.
- Cache signed URL quá lâu.
- Cho download nếu API trả 403/404.
```

Frontend nên:

1. Gọi API xin download URL hoặc blob theo file id.
2. Hiển thị loading/download state.
3. Ghi nhận lỗi 403 bằng ForbiddenState hoặc toast phù hợp.
4. Không persist signed URL trong localStorage/sessionStorage.

### 6.5 Audit log là dữ liệu truy vết nhạy cảm

Audit log có thể chứa thông tin actor, target, IP, user agent, before/after diff, module, action và dữ liệu nhạy cảm đã mask.

UI cần:

1. Filter rõ theo module/action/actor/time/entity.
2. Không tự unmask dữ liệu.
3. Không render HTML từ diff nếu chưa sanitize.
4. Không cho export nếu thiếu quyền.
5. Hiển thị `request_id`/`correlation_id` để debug.

### 6.6 Mutation Foundation cần confirm rõ hậu quả

Các action sau phải có ConfirmDialog:

1. Tắt module.
2. Cập nhật setting quan trọng.
3. Xóa mềm file metadata hoặc unlink file.
4. Xóa ngày nghỉ lễ.
5. Cập nhật retention policy.
6. Reset hoặc cập nhật sequence counter nếu API cho phép.

Confirm copy phải nói rõ ảnh hưởng đến module liên quan.

---

## 7. Route và screen map FRONTEND-13

### 7.1 Route tổng quan

| Route | Screen code | Tên màn hình | Template | Permission đề xuất | Scope |
| --- | --- | --- | --- | --- | --- |
| `/system` | UI-SYSTEM-SCREEN-001 | System Overview | OVERVIEW | `FOUNDATION.SYSTEM.VIEW` | Company/System |
| `/system/company` | UI-SYSTEM-SCREEN-002 | Thông tin công ty | DETAIL/FORM | `FOUNDATION.COMPANY.VIEW` | Company/System |
| `/system/company/settings` | UI-SYSTEM-SCREEN-003 | Company Settings | SETTINGS | `FOUNDATION.SETTING.VIEW` | Company/System |
| `/system/settings` | UI-SYSTEM-SCREEN-004 | System Settings | SETTINGS | `FOUNDATION.SETTING.SYSTEM_MANAGE` | System |
| `/system/modules` | UI-SYSTEM-SCREEN-005 | Module Catalog | LIST | `FOUNDATION.MODULE.VIEW` | Company/System |
| `/system/modules/:moduleCode` | UI-SYSTEM-SCREEN-006 | Module Detail | DETAIL | `FOUNDATION.MODULE.VIEW` | Company/System |
| `/system/files` | UI-SYSTEM-SCREEN-007 | File Metadata | LIST | `FOUNDATION.FILE.VIEW` | Company/System |
| `/system/files/:fileId` | UI-SYSTEM-SCREEN-008 | File Detail | DETAIL | `FOUNDATION.FILE.VIEW` | Company/System |
| `/system/file-access-logs` | UI-SYSTEM-SCREEN-009 | File Access Logs | AUDIT | `FOUNDATION.FILE_ACCESS_LOG.VIEW` | Company/System |
| `/system/audit-logs` | UI-SYSTEM-SCREEN-010 | Audit Logs | AUDIT | `FOUNDATION.AUDIT_LOG.VIEW` | Company/System |
| `/system/audit-logs/:auditLogId` | UI-SYSTEM-SCREEN-011 | Audit Log Detail | DETAIL | `FOUNDATION.AUDIT_LOG.VIEW` | Company/System |
| `/system/public-holidays` | UI-SYSTEM-SCREEN-012 | Public Holidays | LIST/SETTINGS | `FOUNDATION.HOLIDAY.VIEW` | Company/System |
| `/system/sequences` | UI-SYSTEM-SCREEN-013 | Sequence Counters | LIST/SETTINGS | `FOUNDATION.SEQUENCE.VIEW` | Company/System |
| `/system/retention` | UI-SYSTEM-SCREEN-014 | Retention Policies | SETTINGS | `FOUNDATION.RETENTION.VIEW` | System |
| `/system/seeds` | UI-SYSTEM-SCREEN-015 | Seed Status | AUDIT | `FOUNDATION.SEED.VIEW` | System |
| `/system/health` | UI-SYSTEM-SCREEN-016 | Health Check | OVERVIEW | `FOUNDATION.HEALTH.VIEW` | System |

### 7.2 Route metadata ví dụ

```ts
export const systemRoutes: RouteMeta[] = [
  {
    routeKey: 'system.overview',
    path: '/system',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'UI-SYSTEM-SCREEN-001',
    title: 'Tổng quan hệ thống',
    sidebarKey: 'system.overview',
    requiredAnyPermissions: ['FOUNDATION.SYSTEM.VIEW'],
    requiredScopes: ['Company', 'System'],
    showInSidebar: true,
    order: 10,
    icon: 'settings',
    pageTemplate: 'OVERVIEW',
  },
  {
    routeKey: 'system.company.settings',
    path: '/system/company/settings',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'UI-SYSTEM-SCREEN-003',
    title: 'Cấu hình công ty',
    sidebarKey: 'system.company.settings',
    requiredAnyPermissions: ['FOUNDATION.SETTING.VIEW'],
    requiredScopes: ['Company', 'System'],
    showInSidebar: true,
    order: 30,
    icon: 'sliders',
    pageTemplate: 'SETTINGS',
  },
  {
    routeKey: 'system.auditLogs',
    path: '/system/audit-logs',
    layout: 'MODULE_WORKSPACE',
    moduleCode: 'FOUNDATION',
    screenCode: 'UI-SYSTEM-SCREEN-010',
    title: 'Audit Logs',
    sidebarKey: 'system.auditLogs',
    requiredAnyPermissions: ['FOUNDATION.AUDIT_LOG.VIEW'],
    requiredScopes: ['Company', 'System'],
    showInSidebar: true,
    order: 80,
    icon: 'activity',
    pageTemplate: 'AUDIT_LOG',
  },
];
```

---

## 8. Sidebar System/Foundation

### 8.1 Nhóm menu đề xuất

```text
System / Foundation
  Tổng quan

  Công ty & Cấu hình
    Thông tin công ty
    Cấu hình công ty
    System Settings

  Ứng dụng & Module
    Module Catalog
    App visibility / Module status

  File & Storage
    File Metadata
    File Access Logs

  Audit & Vận hành
    Audit Logs
    Public Holidays
    Sequence Counters
    Retention Policies
    Seed Status
    Health Check
```

### 8.2 Sidebar registry ví dụ

```ts
export const systemSidebarItems: SidebarItemMeta[] = [
  {
    key: 'system.overview',
    label: 'Tổng quan',
    path: '/system',
    icon: 'layout-dashboard',
    requiredAnyPermissions: ['FOUNDATION.SYSTEM.VIEW'],
    requiredScopes: ['Company', 'System'],
    order: 10,
  },
  {
    key: 'system.company.group',
    label: 'Công ty & Cấu hình',
    type: 'group',
    order: 20,
  },
  {
    key: 'system.company.info',
    label: 'Thông tin công ty',
    path: '/system/company',
    icon: 'building',
    groupKey: 'system.company.group',
    requiredAnyPermissions: ['FOUNDATION.COMPANY.VIEW'],
    requiredScopes: ['Company', 'System'],
    order: 21,
  },
  {
    key: 'system.company.settings',
    label: 'Cấu hình công ty',
    path: '/system/company/settings',
    icon: 'sliders',
    groupKey: 'system.company.group',
    requiredAnyPermissions: ['FOUNDATION.SETTING.VIEW'],
    requiredScopes: ['Company', 'System'],
    order: 22,
  },
  {
    key: 'system.settings',
    label: 'System Settings',
    path: '/system/settings',
    icon: 'shield-cog',
    groupKey: 'system.company.group',
    requiredAnyPermissions: ['FOUNDATION.SETTING.SYSTEM_MANAGE'],
    requiredScopes: ['System'],
    order: 23,
  },
];
```

---

## 9. Cấu trúc thư mục đề xuất

```text
src/
  app/
    (protected)/
      system/
        page.tsx
        company/
          page.tsx
          settings/page.tsx
        settings/page.tsx
        modules/
          page.tsx
          [moduleCode]/page.tsx
        files/
          page.tsx
          [fileId]/page.tsx
        file-access-logs/page.tsx
        audit-logs/
          page.tsx
          [auditLogId]/page.tsx
        public-holidays/page.tsx
        sequences/page.tsx
        retention/page.tsx
        seeds/page.tsx
        health/page.tsx

  modules/
    system/
      api/
        foundation.api.ts
        foundation.types.ts
      hooks/
        foundation.keys.ts
        useCompanySettings.ts
        useSystemSettings.ts
        useModuleCatalog.ts
        useFiles.ts
        useAuditLogs.ts
        usePublicHolidays.ts
        useSequences.ts
        useRetentionPolicies.ts
        useSeedStatus.ts
      components/
        SystemOverviewCards.tsx
        SettingGroupCard.tsx
        SettingValueField.tsx
        SensitiveSettingInput.tsx
        ModuleStatusBadge.tsx
        ModuleDependencyList.tsx
        FileVisibilityBadge.tsx
        FileLinkList.tsx
        AuditDiffViewer.tsx
        AuditActorCell.tsx
        AuditTargetCell.tsx
        HolidayFormDrawer.tsx
        SequencePreviewBox.tsx
        RetentionPolicyCard.tsx
        SeedBatchTable.tsx
      pages/
        SystemOverviewPage.tsx
        CompanyProfilePage.tsx
        CompanySettingsPage.tsx
        SystemSettingsPage.tsx
        ModuleCatalogPage.tsx
        ModuleDetailPage.tsx
        FileListPage.tsx
        FileDetailPage.tsx
        FileAccessLogPage.tsx
        AuditLogListPage.tsx
        AuditLogDetailPage.tsx
        PublicHolidayPage.tsx
        SequenceCounterPage.tsx
        RetentionPolicyPage.tsx
        SeedStatusPage.tsx
        HealthCheckPage.tsx
      utils/
        settingValue.ts
        auditDiff.ts
        foundationPermission.ts
        fileDownload.ts
      mocks/
        foundation.handlers.ts
        foundation.fixtures.ts
      tests/
        foundationPermission.test.ts
        auditDiff.test.ts
        settingValue.test.ts
```

---

## 10. API service contract

### 10.1 Foundation API service

```ts
import { apiClient } from '@/services/api/apiClient';
import type {
  AuditLogDetail,
  AuditLogListParams,
  AuditLogListResponse,
  CompanyDetail,
  CompanySetting,
  FileDetail,
  FileListParams,
  FileListResponse,
  FoundationHealth,
  ModuleCatalogItem,
  PublicHoliday,
  SequenceCounter,
  SettingListParams,
  SystemSetting,
  UpdateCompanySettingPayload,
  UpdateSystemSettingPayload,
} from './foundation.types';

export const foundationApi = {
  getCompany() {
    return apiClient.get<CompanyDetail>('/foundation/company/current');
  },

  updateCompany(payload: Partial<CompanyDetail>) {
    return apiClient.patch<CompanyDetail>('/foundation/company/current', { body: payload });
  },

  getCompanySettings(params?: SettingListParams) {
    return apiClient.get<CompanySetting[]>('/foundation/settings', { query: params });
  },

  updateCompanySetting(settingKey: string, payload: UpdateCompanySettingPayload) {
    return apiClient.patch<CompanySetting>(`/foundation/settings/${settingKey}`, {
      body: payload,
      idempotencyKey: true,
    });
  },

  getSystemSettings(params?: SettingListParams) {
    return apiClient.get<SystemSetting[]>('/foundation/system-settings', { query: params });
  },

  updateSystemSetting(settingKey: string, payload: UpdateSystemSettingPayload) {
    return apiClient.patch<SystemSetting>(`/foundation/system-settings/${settingKey}`, {
      body: payload,
      idempotencyKey: true,
    });
  },

  getModules() {
    return apiClient.get<ModuleCatalogItem[]>('/foundation/modules');
  },

  updateModule(moduleCode: string, payload: Partial<ModuleCatalogItem>) {
    return apiClient.patch<ModuleCatalogItem>(`/foundation/modules/${moduleCode}`, {
      body: payload,
      idempotencyKey: true,
    });
  },

  getFiles(params?: FileListParams) {
    return apiClient.get<FileListResponse>('/foundation/files', { query: params });
  },

  getFile(fileId: string) {
    return apiClient.get<FileDetail>(`/foundation/files/${fileId}`);
  },

  getFileDownloadUrl(fileId: string) {
    return apiClient.get<{ downloadUrl: string; expiresAt: string }>(
      `/foundation/files/${fileId}/download-url`,
    );
  },

  getAuditLogs(params?: AuditLogListParams) {
    return apiClient.get<AuditLogListResponse>('/foundation/audit-logs', { query: params });
  },

  getAuditLog(auditLogId: string) {
    return apiClient.get<AuditLogDetail>(`/foundation/audit-logs/${auditLogId}`);
  },

  getPublicHolidays(params?: { year?: number; countryCode?: string }) {
    return apiClient.get<PublicHoliday[]>('/foundation/public-holidays', { query: params });
  },

  createPublicHoliday(payload: Partial<PublicHoliday>) {
    return apiClient.post<PublicHoliday>('/foundation/public-holidays', {
      body: payload,
      idempotencyKey: true,
    });
  },

  updatePublicHoliday(holidayId: string, payload: Partial<PublicHoliday>) {
    return apiClient.patch<PublicHoliday>(`/foundation/public-holidays/${holidayId}`, {
      body: payload,
      idempotencyKey: true,
    });
  },

  deletePublicHoliday(holidayId: string) {
    return apiClient.delete<null>(`/foundation/public-holidays/${holidayId}`);
  },

  getSequences() {
    return apiClient.get<SequenceCounter[]>('/foundation/sequences');
  },

  previewSequence(sequenceKey: string) {
    return apiClient.post<{ nextValue: number; previewCode: string }>(
      `/foundation/sequences/${sequenceKey}/preview`,
    );
  },

  getHealth() {
    return apiClient.get<FoundationHealth>('/foundation/health');
  },
};
```

### 10.2 Query key factory

```ts
export const foundationKeys = {
  all: ['foundation'] as const,

  company: () => [...foundationKeys.all, 'company'] as const,

  companySettings: (params?: SettingListParams) =>
    [...foundationKeys.all, 'company-settings', params ?? {}] as const,

  systemSettings: (params?: SettingListParams) =>
    [...foundationKeys.all, 'system-settings', params ?? {}] as const,

  modules: () => [...foundationKeys.all, 'modules'] as const,
  module: (moduleCode: string) => [...foundationKeys.modules(), moduleCode] as const,

  files: (params?: FileListParams) => [...foundationKeys.all, 'files', params ?? {}] as const,
  file: (fileId: string) => [...foundationKeys.all, 'files', fileId] as const,

  auditLogs: (params?: AuditLogListParams) =>
    [...foundationKeys.all, 'audit-logs', params ?? {}] as const,
  auditLog: (auditLogId: string) =>
    [...foundationKeys.all, 'audit-logs', auditLogId] as const,

  publicHolidays: (params?: { year?: number; countryCode?: string }) =>
    [...foundationKeys.all, 'public-holidays', params ?? {}] as const,

  sequences: () => [...foundationKeys.all, 'sequences'] as const,
  retentionPolicies: () => [...foundationKeys.all, 'retention-policies'] as const,
  seedStatus: () => [...foundationKeys.all, 'seed-status'] as const,
  health: () => [...foundationKeys.all, 'health'] as const,
};
```

---

## 11. TypeScript types nền tảng

```ts
export type FoundationStatus = 'Active' | 'Inactive' | 'Suspended' | 'Deleted';

export type SettingValueType =
  | 'String'
  | 'Number'
  | 'Boolean'
  | 'JSON'
  | 'Array'
  | 'SecretRef';

export interface FoundationBaseEntity {
  id: string;
  createdAt: string;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface CompanyDetail extends FoundationBaseEntity {
  companyCode: string;
  name: string;
  legalName?: string | null;
  taxCode?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  countryCode?: string | null;
  timezone: string;
  defaultLocale: string;
  currencyCode?: string | null;
  logoFileId?: string | null;
  status: FoundationStatus;
}

export interface FoundationSetting extends FoundationBaseEntity {
  settingKey: string;
  settingValue: unknown;
  displayValue?: string | null;
  valueType: SettingValueType;
  category: string;
  moduleCode?: string | null;
  description?: string | null;
  isPublic: boolean;
  isSensitive: boolean;
  isEncrypted: boolean;
  status: 'Active' | 'Inactive';
  validationSchema?: unknown;
  allowedActions?: string[];
}

export interface CompanySetting extends FoundationSetting {
  companyId: string;
  inheritedFromSystem?: boolean;
}

export interface SystemSetting extends FoundationSetting {}

export interface ModuleCatalogItem extends FoundationBaseEntity {
  moduleCode: string;
  name: string;
  description?: string | null;
  moduleGroup?: string | null;
  version?: string | null;
  isCore: boolean;
  isMvp: boolean;
  isActive: boolean;
  status?: 'active' | 'disabled' | 'coming_soon' | 'maintenance' | 'hidden';
  sortOrder?: number | null;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
  allowedActions?: string[];
}

export interface FileListItem extends FoundationBaseEntity {
  fileName: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'Private' | 'Public' | 'Internal';
  uploadStatus: 'Pending' | 'Uploaded' | 'Failed' | 'Deleted';
  scanStatus?: 'NotRequired' | 'Pending' | 'Clean' | 'Infected' | 'Failed';
  moduleCode?: string | null;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  linkCount: number;
  createdAt: string;
}

export interface FileDetail extends FileListItem {
  checksum?: string | null;
  storageProvider?: string | null;
  storagePathMasked?: string | null;
  links: FileEntityLink[];
  accessLogs?: FileAccessLogItem[];
  allowedActions?: string[];
}

export interface FileEntityLink {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  moduleCode: string;
  createdAt: string;
  createdByName?: string | null;
}

export interface AuditLogListItem {
  id: string;
  requestId?: string | null;
  correlationId?: string | null;
  moduleCode: string;
  action: string;
  actorUserId?: string | null;
  actorName?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  targetLabel?: string | null;
  status: 'Success' | 'Failed' | 'Denied';
  ipAddress?: string | null;
  createdAt: string;
}

export interface AuditLogDetail extends AuditLogListItem {
  userAgent?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  diff?: AuditDiffItem[];
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditDiffItem {
  field: string;
  before: unknown;
  after: unknown;
  masked?: boolean;
}

export interface PublicHoliday extends FoundationBaseEntity {
  holidayDate: string;
  name: string;
  countryCode?: string | null;
  isRecurring: boolean;
  isWorkingDayOverride?: boolean;
  status: 'Active' | 'Inactive';
}

export interface SequenceCounter extends FoundationBaseEntity {
  sequenceKey: string;
  moduleCode?: string | null;
  currentValue: number;
  prefix?: string | null;
  suffix?: string | null;
  paddingLength?: number | null;
  nextPreview?: string | null;
}
```

---

## 12. Hook convention

### 12.1 Company settings hooks

```ts
export function useCompanySettings(params?: SettingListParams) {
  return useQuery({
    queryKey: foundationKeys.companySettings(params),
    queryFn: () => foundationApi.getCompanySettings(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateCompanySettingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ settingId, payload }: {
      settingId: string;
      payload: UpdateCompanySettingPayload;
    }) => foundationApi.updateCompanySetting(settingId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foundationKeys.all });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['app-registry'] });
    },
  });
}
```

### 12.2 Module catalog hooks

```ts
export function useModuleCatalog() {
  return useQuery({
    queryKey: foundationKeys.modules(),
    queryFn: foundationApi.getModules,
    staleTime: 2 * 60 * 1000,
  });
}

export function useUpdateModuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ moduleCode, payload }: {
      moduleCode: string;
      payload: Partial<ModuleCatalogItem>;
    }) => foundationApi.updateModule(moduleCode, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foundationKeys.modules() });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['home', 'apps'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
```

### 12.3 Audit log hooks

```ts
export function useAuditLogs(params: AuditLogListParams) {
  return useQuery({
    queryKey: foundationKeys.auditLogs(params),
    queryFn: () => foundationApi.getAuditLogs(params),
    staleTime: 30 * 1000,
    keepPreviousData: true,
  });
}

export function useAuditLogDetail(auditLogId: string) {
  return useQuery({
    queryKey: foundationKeys.auditLog(auditLogId),
    queryFn: () => foundationApi.getAuditLog(auditLogId),
    enabled: Boolean(auditLogId),
    staleTime: 5 * 60 * 1000,
  });
}
```

---

## 13. System Overview Page

### 13.1 Mục tiêu

System Overview là màn tổng quan dành cho Admin/Super Admin để kiểm tra nhanh trạng thái nền tảng hệ thống.

### 13.2 Nội dung hiển thị

| Khu vực | Nội dung |
| --- | --- |
| Header | Tên module, mô tả, thời gian cập nhật, nút refresh |
| System health cards | API health, database health, storage health, queue/job health nếu API hỗ trợ |
| Module summary | Tổng module active, disabled, coming soon, maintenance |
| Configuration alerts | Setting thiếu, module dependency lỗi, file storage warning |
| Audit summary | Số audit log quan trọng gần đây, failed/denied actions |
| File summary | Tổng file, file private, file scan pending/failed nếu có |
| Quick links | Company settings, Module catalog, Audit logs, Files |

### 13.3 State bắt buộc

1. Loading skeleton.
2. Empty state nếu API health chưa hỗ trợ.
3. Error state có retry.
4. Degraded state nếu một số nguồn lỗi nhưng vẫn render phần còn lại.
5. Forbidden state nếu thiếu quyền.

---

## 14. Company Profile Page

### 14.1 Mục tiêu

Cho phép người có quyền xem/cập nhật thông tin công ty/tenant hiện tại.

### 14.2 Trường hiển thị

| Nhóm | Field |
| --- | --- |
| Nhận diện | Company code, tên công ty, legal name, logo |
| Liên hệ | Email, phone, website, address |
| Vận hành | Country code, timezone, default locale, currency |
| Trạng thái | Active/Inactive/Suspended |
| Metadata | Created/updated by, created/updated at |

### 14.3 Action

| Action | Permission | UI behavior |
| --- | --- | --- |
| Edit company | `FOUNDATION.COMPANY.UPDATE` | Mở drawer/form |
| Upload logo | `FOUNDATION.COMPANY.UPDATE` + `FOUNDATION.FILE.UPLOAD` | Gọi file service |
| View audit | `FOUNDATION.AUDIT_LOG.VIEW` | Link audit logs filter theo company |

### 14.4 Lưu ý

1. Không cho tự sửa `company_id`.
2. Nếu đổi timezone/default locale, cần cảnh báo ảnh hưởng ATT/LEAVE/DASH.
3. Nếu đổi status company, cần confirm đặc biệt và có thể chỉ Super Admin được làm.

---

## 15. Company Settings Page

### 15.1 Mục tiêu

Quản lý cấu hình theo công ty, override system default.

### 15.2 Layout

```text
PageHeader
  Title: Cấu hình công ty
  Actions: Save all / Reset group / Export config nếu có quyền

FilterBar
  Search setting key
  Category select
  Module select
  Public/Sensitive filter

Content
  SettingGroupCard: General
  SettingGroupCard: Security
  SettingGroupCard: File
  SettingGroupCard: Notification
  SettingGroupCard: Dashboard
  SettingGroupCard: Module flags
```

### 15.3 Component `SettingGroupCard`

| Props | Ý nghĩa |
| --- | --- |
| `category` | Nhóm setting |
| `settings` | Danh sách setting |
| `readonly` | Thiếu quyền update |
| `onSave` | Save từng setting hoặc cả group |
| `onReset` | Reset về system default nếu API hỗ trợ |

### 15.4 Validation UI

1. Text/number/boolean/JSON render theo `valueType`.
2. JSON setting dùng JSON editor đơn giản hoặc textarea có validation.
3. Sensitive setting dùng `SensitiveSettingInput`.
4. Validation error map theo field path.
5. Save setting quan trọng cần ConfirmDialog.

---

## 16. System Settings Page

### 16.1 Mục tiêu

Quản lý global default cấp hệ thống. Chỉ user có scope `System` mới được truy cập.

### 16.2 Khác biệt với Company Settings

| Tiêu chí | Company Settings | System Settings |
| --- | --- | --- |
| Scope | Company/System | System |
| Đối tượng | Tenant hiện tại | Global default toàn hệ thống |
| Rủi ro | Ảnh hưởng một công ty | Ảnh hưởng nhiều công ty |
| Confirm | Có với setting quan trọng | Bắt buộc với hầu hết mutation |
| Audit | Bắt buộc | Bắt buộc |

### 16.3 UI behavior

1. Hiển thị cảnh báo đầu trang: “Thay đổi System Settings có thể ảnh hưởng toàn hệ thống.”
2. Chỉ hiện update button nếu có `FOUNDATION.SETTING.SYSTEM_MANAGE`.
3. Sensitive setting luôn mask.
4. Nếu API trả `secret_ref`, hiển thị dạng “Secret reference configured”.
5. Không render raw secret trong DOM.

---

## 17. Module Catalog Page

### 17.1 Mục tiêu

Quản lý danh mục module của hệ thống và trạng thái module để phục vụ Home Portal, App Switcher, route guard, permission, dashboard và notification.

### 17.2 Data table columns

| Cột | Nội dung |
| --- | --- |
| Module | Icon, name, module_code |
| Group | Core/Operation/Experience/Extension |
| MVP | Badge MVP/Phase sau |
| Core | Badge Core nếu không được tắt tùy tiện |
| Status | Active/Disabled/Coming soon/Maintenance/Hidden |
| Dependencies | Danh sách module phụ thuộc |
| Version | Version module |
| Sort order | Thứ tự hiển thị |
| Actions | View detail, toggle status, edit metadata |

### 17.3 Action rules

| Action | Điều kiện |
| --- | --- |
| Toggle active | Có `FOUNDATION.MODULE.UPDATE`, không phải core hoặc backend cho phép |
| Set maintenance | Có quyền update, cần confirm |
| Edit sort order | Có quyền update |
| View dependencies | Có quyền view |
| Open related permissions | Link sang AUTH permission matrix nếu có quyền |

### 17.4 Invalidation sau mutation

Khi module thay đổi trạng thái, frontend phải invalidate:

```text
- auth/me hoặc session context
- app registry
- home app list
- app switcher
- sidebar registry
- dashboard widgets nếu liên quan
- notification event/template config nếu liên quan
```

---

## 18. Module Detail Page

### 18.1 Tabs đề xuất

| Tab | Nội dung |
| --- | --- |
| Overview | Thông tin module, status, version, group, description |
| Dependencies | Module phụ thuộc và module phụ thuộc ngược |
| Settings | Company/system settings liên quan module đó |
| Permissions | Link permission thuộc module nếu AUTH UI tích hợp |
| Audit | Audit log filter theo module_code |

### 18.2 Lưu ý

1. Không edit permission matrix sâu nếu thuộc FRONTEND-06.
2. Không tự bật module nếu dependency chưa active; phải dựa backend validation.
3. Khi module disabled, route guard vẫn phải chặn direct URL.

---

## 19. File Metadata Page

### 19.1 Mục tiêu

Quản lý metadata file dùng chung, không phải file browser public.

### 19.2 FilterBar

| Filter | Ghi chú |
| --- | --- |
| Search | File name/original name/checksum nếu API hỗ trợ |
| Module | HR/ATT/LEAVE/TASK/... |
| Visibility | Private/Internal/Public |
| MIME type | Image/PDF/Doc/Sheet/Other |
| Upload status | Pending/Uploaded/Failed/Deleted |
| Scan status | Pending/Clean/Infected/Failed |
| Uploaded by | Actor |
| Date range | Created at |

### 19.3 DataTable columns

| Cột | Nội dung |
| --- | --- |
| File | Icon, original filename, MIME |
| Size | Human readable size |
| Visibility | Badge |
| Module | Module code/source |
| Links | Số entity đang gắn file |
| Upload status | Badge |
| Scan status | Badge |
| Uploaded by | Avatar/name |
| Created at | Date time |
| Actions | Detail/download/unlink/delete nếu có quyền |

### 19.4 Download flow

```text
User click Download
  -> Check PermissionGate FOUNDATION.FILE.DOWNLOAD
  -> Call GET /foundation/files/:id/download-url
  -> Backend kiểm tra permission theo file/entity/module
  -> API trả signed URL ngắn hạn hoặc blob endpoint
  -> Browser download
  -> Nếu 403: toast + ForbiddenState nếu cần
```

---

## 20. File Detail Page

### 20.1 Sections

| Section | Nội dung |
| --- | --- |
| Metadata | File name, MIME, size, checksum masked nếu cần |
| Storage | Provider, storage path masked, visibility |
| Upload info | Uploaded by, created at, upload status, scan status |
| Entity links | Danh sách entity đang gắn file |
| Access logs | Lịch sử truy cập file nếu có quyền |
| Audit | Link audit logs liên quan file |

### 20.2 Dangerous actions

| Action | Yêu cầu |
| --- | --- |
| Delete metadata / soft delete file | Confirm, permission, backend validation |
| Unlink file from entity | Confirm, module permission + foundation permission |
| Re-scan file | Chỉ nếu API hỗ trợ, Super Admin/System |
| Change visibility | Cần confirm, đặc biệt từ Private sang Public/Internal |

---

## 21. Audit Logs Page

### 21.1 Mục tiêu

Cho phép người có quyền truy vấn, lọc và xem chi tiết audit log để truy vết thao tác quan trọng.

### 21.2 FilterBar

| Filter | Ghi chú |
| --- | --- |
| Date range | Bắt buộc có default 7 ngày gần nhất hoặc 30 ngày gần nhất |
| Module | AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/FOUNDATION |
| Action | CREATE/UPDATE/DELETE/APPROVE/REJECT/LOGIN/... |
| Actor | User thực hiện |
| Target entity type | Employee/LeaveRequest/Task/File/Setting/... |
| Target entity id | UUID nếu cần debug |
| Request id | Truy vết request cụ thể |
| Status | Success/Failed/Denied |
| IP | Nếu API hỗ trợ |

### 21.3 DataTable columns

| Cột | Nội dung |
| --- | --- |
| Time | created_at |
| Actor | actor name/email/avatar nếu có |
| Module | module badge |
| Action | action badge |
| Target | entity type + label/id |
| Status | success/failed/denied |
| Request ID | Copyable short id |
| IP | Mask một phần nếu policy yêu cầu |
| Actions | View detail |

### 21.4 Pagination strategy

Audit log có thể lớn. Frontend nên:

1. Dùng server-side pagination.
2. Không load toàn bộ log.
3. Default date range ngắn.
4. Debounce search/filter.
5. Dùng keyset/cursor nếu backend hỗ trợ.
6. Chỉ export theo quyền và bộ lọc hiện tại.

---

## 22. Audit Log Detail Page

### 22.1 Layout

```text
PageHeader
  Title: Audit Log Detail
  Badges: module, action, status

Summary Card
  Actor, target, company, request id, correlation id, time, IP, user agent

Diff Viewer
  Before / After / Changed fields

Metadata
  Raw metadata đã mask

Related Links
  Open target entity nếu có quyền
  Filter same request id
```

### 22.2 Audit diff viewer

```ts
export function normalizeAuditDiff(detail: AuditLogDetail): AuditDiffItem[] {
  if (detail.diff?.length) return detail.diff;

  const before = detail.beforeData ?? {};
  const after = detail.afterData ?? {};
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);

  return Array.from(fields)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      before: before[field],
      after: after[field],
      masked: isMaskedValue(before[field]) || isMaskedValue(after[field]),
    }));
}
```

### 22.3 Security note

Không dùng `dangerouslySetInnerHTML` để render audit diff. Nếu API trả string có HTML, render như plain text.

---

## 23. Public Holidays Page

### 23.1 Mục tiêu

Quản lý ngày nghỉ lễ/ngày không làm việc dùng chung cho ATT và LEAVE.

### 23.2 UI

| Khu vực | Nội dung |
| --- | --- |
| Year switcher | Chọn năm |
| Country/company filter | Nếu API hỗ trợ global/company holiday |
| Calendar/list toggle | List table trong MVP là đủ; calendar có thể optional |
| Holiday table | Date, name, recurring, country, status, working day override |
| Form drawer | Tạo/sửa holiday |

### 23.3 Business warning

Khi thêm/sửa/xóa holiday, UI cần cảnh báo:

```text
Thay đổi ngày nghỉ có thể ảnh hưởng tính công, tính phép và dashboard liên quan.
```

Không tự recalculation ở frontend. Nếu backend yêu cầu job tính lại, frontend chỉ hiển thị trạng thái hoặc thông báo cần chạy job.

---

## 24. Sequence Counters Page

### 24.1 Mục tiêu

Cho phép xem bộ đếm sinh mã tự động dùng chung. MVP nên ưu tiên **view + preview**, hạn chế chỉnh trực tiếp.

### 24.2 DataTable columns

| Cột | Nội dung |
| --- | --- |
| Sequence key | employee_code, leave_request_code, project_code, task_code |
| Module | HR/LEAVE/TASK/FOUNDATION |
| Current value | Số hiện tại |
| Prefix/Suffix | Format |
| Padding | Độ dài |
| Next preview | Mã tiếp theo dự kiến |
| Updated at | Thời điểm cập nhật |
| Actions | Preview, view audit, update nếu quyền cao |

### 24.3 Rule quan trọng

Frontend không tự tính mã cuối cùng để submit nghiệp vụ. Preview chỉ là tham khảo. Backend sequence service mới là nơi sinh mã chính thức trong transaction.

---

## 25. Retention Policies Page

### 25.1 Mục tiêu

Hiển thị và cấu hình chính sách lưu trữ log/file/cache nếu MVP cần.

### 25.2 Nhóm retention

| Nhóm | Ví dụ |
| --- | --- |
| Audit log | Retain 365 ngày / archive sau 90 ngày |
| File access log | Retain 180 ngày |
| Notification delivery log | Retain 90 ngày |
| Dashboard cache | TTL ngắn, cleanup tự động |
| File metadata | Không xóa nếu còn entity link |

### 25.3 UI behavior

1. Chỉ user scope `System` nên được sửa.
2. Update retention cần confirm.
3. Không chạy cleanup job trực tiếp nếu API không hỗ trợ an toàn.
4. Hiển thị next cleanup schedule nếu backend trả.

---

## 26. Seed Status Page

### 26.1 Mục tiêu

Cho phép Super Admin/System Operator kiểm tra seed data nền tảng đã chạy, version, checksum và lỗi nếu có.

### 26.2 Data hiển thị

| Khu vực | Nội dung |
| --- | --- |
| Seed batch table | Batch key, version, status, started/finished at |
| Seed item table | Seed key, entity type, checksum, status, error |
| Filters | Module, status, date range |
| Detail drawer | Payload summary đã mask, error stack nếu API cho phép |

### 26.3 Không khuyến nghị trong MVP

Không nên có nút “Run seed” trong admin UI thông thường. Nếu cần, tách vào internal tool hoặc CLI/DevOps pipeline.

---

## 27. Health Check Page

### 27.1 Mục tiêu

Hiển thị trạng thái các thành phần hạ tầng ở mức đọc-only.

### 27.2 Cards đề xuất

| Card | Status |
| --- | --- |
| API | Healthy/Degraded/Down |
| Database | Healthy/Degraded/Down |
| Storage | Healthy/Degraded/Down |
| Queue/Job | Healthy/Degraded/Down nếu có |
| Notification worker | Healthy/Degraded/Down nếu có |
| Dashboard cache | Healthy/Degraded/Down nếu có |

### 27.3 Lưu ý

1. Không hiển thị secret/env raw.
2. Không hiển thị connection string.
3. Không expose thông tin hạ tầng quá chi tiết cho user không đủ quyền.

---

## 28. Permission matrix đề xuất cho Foundation

| Permission | Ý nghĩa | Scope đề xuất |
| --- | --- | --- |
| `FOUNDATION.SYSTEM.VIEW` | Xem tổng quan hệ thống | Company/System |
| `FOUNDATION.COMPANY.VIEW` | Xem thông tin công ty | Company/System |
| `FOUNDATION.COMPANY.UPDATE` | Cập nhật thông tin công ty | Company/System |
| `FOUNDATION.SETTING.VIEW` | Xem cấu hình công ty (company setting) | Company/System |
| `FOUNDATION.SETTING.UPDATE` | Cập nhật cấu hình công ty (company setting) | Company/System |
| `FOUNDATION.SETTING.SYSTEM_MANAGE` | Xem/cập nhật system setting | System |
| `FOUNDATION.MODULE.VIEW` | Xem module catalog | Company/System |
| `FOUNDATION.MODULE.UPDATE` | Cập nhật trạng thái/module metadata | System |
| `FOUNDATION.FILE.VIEW` | Xem file metadata | Company/System |
| `FOUNDATION.FILE.DOWNLOAD` | Tải file theo quyền | Company/System + module guard |
| `FOUNDATION.FILE.DELETE` | Xóa mềm/unlink file | Company/System + module guard |
| `FOUNDATION.FILE_ACCESS_LOG.VIEW` | Xem file access log | Company/System |
| `FOUNDATION.AUDIT_LOG.VIEW` | Xem audit log | Company/System |
| `FOUNDATION.AUDIT_LOG.EXPORT` | Xuất audit log | System hoặc Company theo policy |
| `FOUNDATION.HOLIDAY.VIEW` | Xem ngày nghỉ lễ | Company/System |
| `FOUNDATION.HOLIDAY.MANAGE` | Quản lý ngày nghỉ lễ | Company/System |
| `FOUNDATION.SEQUENCE.VIEW` | Xem sequence counter | Company/System |
| `FOUNDATION.SEQUENCE.UPDATE` | Cập nhật sequence counter | System |
| `FOUNDATION.RETENTION.VIEW` | Xem retention policy | System |
| `FOUNDATION.RETENTION.MANAGE` | Cập nhật retention policy | System |
| `FOUNDATION.SEED.VIEW` | Xem seed status | System |
| `FOUNDATION.HEALTH.VIEW` | Xem health check | System |

---

## 29. Component cần triển khai

### 29.1 Component dùng chung

| Component | Vai trò |
| --- | --- |
| `SystemOverviewCards` | Hiển thị health/module/file/audit summary |
| `SettingGroupCard` | Nhóm setting theo category/module |
| `SettingValueField` | Render value theo type |
| `SensitiveSettingInput` | Nhập giá trị mới cho setting nhạy cảm |
| `ModuleStatusBadge` | Badge trạng thái module |
| `ModuleDependencyList` | Hiển thị dependencies |
| `FileVisibilityBadge` | Badge Private/Internal/Public |
| `FileStatusBadge` | Upload/scan status |
| `FileLinkList` | Entity links của file |
| `AuditDiffViewer` | Before/after diff |
| `AuditActorCell` | Actor cell trong audit table |
| `AuditTargetCell` | Target entity cell |
| `HolidayFormDrawer` | Tạo/sửa holiday |
| `SequencePreviewBox` | Preview mã tiếp theo |
| `RetentionPolicyCard` | Retention policy display/edit |
| `SeedBatchTable` | Seed status table |

### 29.2 Component phải tái sử dụng từ Design System

1. `ModuleWorkspaceLayout`.
2. `WorkspacePageHeader`.
3. `DataTable`.
4. `FilterBar` hoặc form/filter composition.
5. `Drawer`.
6. `Modal` / `ConfirmDialog`.
7. `Badge` / `StatusBadge`.
8. `PermissionGate`.
9. `MaskedField`.
10. `EmptyState`.
11. `ErrorState`.
12. `Skeleton`.
13. `Toast`.
14. `Tabs`.
15. `DetailSection`.
16. `ActivityLog` nếu đã có.

---

## 30. Form và validation

### 30.1 Setting form schema ví dụ

```ts
import { z } from 'zod';

export const updateSettingSchema = z.object({
  settingKey: z.string().min(1),
  valueType: z.enum(['String', 'Number', 'Boolean', 'JSON', 'Array', 'SecretRef']),
  settingValue: z.unknown(),
  reason: z.string().max(500).optional(),
});
```

### 30.2 Public holiday schema ví dụ

```ts
export const publicHolidaySchema = z.object({
  holidayDate: z.string().min(1),
  name: z.string().min(1).max(255),
  countryCode: z.string().max(10).optional().nullable(),
  isRecurring: z.boolean().default(false),
  isWorkingDayOverride: z.boolean().default(false),
  status: z.enum(['Active', 'Inactive']).default('Active'),
});
```

### 30.3 Validation nguyên tắc

1. Frontend validate để tăng UX.
2. Backend validate là nguồn cuối cùng.
3. Validation error từ API map về field.
4. JSON setting cần parse trước khi submit.
5. Sensitive setting không cần show old value.

---

## 31. State handling

| State | Áp dụng |
| --- | --- |
| Loading | Skeleton cho table/detail/card |
| Empty | Chưa có data hoặc filter không có kết quả |
| Error | API lỗi, có retry |
| Forbidden | Thiếu permission/scope |
| Disabled module | Module bị disabled/maintenance |
| Validation | Form invalid hoặc API 422 |
| Success | Toast sau mutation thành công |
| Stale | Dữ liệu cũ, có nút refresh nếu cần |
| Degraded | Một phần health/config lỗi nhưng page vẫn render |
| Masked | Field nhạy cảm không render raw |

---

## 32. Cache và invalidation

### 32.1 Stale time đề xuất

| Data | Stale time |
| --- | --- |
| Company detail | 5 phút |
| Company settings | 5 phút |
| System settings | 5 phút |
| Module catalog | 2 phút |
| File list | 30 giây - 1 phút |
| File detail | 1 phút |
| Audit log list | 30 giây |
| Audit log detail | 5 phút |
| Public holidays | 10 phút |
| Sequence counters | 30 giây - 1 phút |
| Health check | 15-30 giây |

### 32.2 Invalidation matrix

| Mutation | Invalidate |
| --- | --- |
| Update company | company, auth/me, app shell, audit logs |
| Update company setting | company settings, auth/me nếu setting ảnh hưởng session, app registry/sidebar/dashboard nếu liên quan |
| Update system setting | system settings, app registry/sidebar/dashboard nếu liên quan |
| Update module | modules, auth/me, home apps, app switcher, sidebar, dashboard, notification config |
| Delete/unlink file | files, file detail, related entity detail, audit logs |
| Update public holiday | holidays, attendance records cache nếu có, leave calendar cache nếu có, dashboard cache nếu có |
| Update sequence | sequences, audit logs |
| Update retention | retention policies, audit logs |

---

## 33. Responsive behavior

### 33.1 Desktop

1. Sidebar đầy đủ nhóm menu.
2. DataTable nhiều cột, filter bar ngang.
3. Detail page dùng 2 cột nếu phù hợp.
4. Audit diff side-by-side.

### 33.2 Tablet

1. Sidebar collapsible.
2. Filter bar chuyển thành wrapping hoặc drawer.
3. DataTable ẩn cột phụ.
4. Audit diff có thể chuyển stacked view.

### 33.3 Mobile web

1. System/Foundation admin screen không phải P0 mobile, nhưng vẫn không được vỡ layout.
2. Sidebar dùng drawer.
3. Table ưu tiên card/list mode cho file/audit nếu cần.
4. Form setting dùng một cột.
5. Audit diff stacked.

---

## 34. Accessibility checklist

1. Tất cả form input có label rõ.
2. Badge trạng thái không chỉ dựa vào màu; có text.
3. ConfirmDialog focus đúng vào title/content/action.
4. DataTable có keyboard navigation tối thiểu.
5. Drawer/modal trap focus.
6. Sensitive field có aria-label phù hợp.
7. Copy request id/file id có label cho screen reader.
8. Error message liên kết với field.
9. Loading state không làm mất focus bất ngờ.
10. Audit diff có text mô tả field changed.

---

## 35. Testing plan

### 35.1 Unit test

| Test | Nội dung |
| --- | --- |
| setting value parser | String/Number/Boolean/JSON/Array/SecretRef |
| sensitive setting render | Không render raw secret |
| audit diff normalize | Tính diff before/after đúng |
| permission utility | Route/action/field theo permission/scope |
| file size formatter | Bytes -> KB/MB/GB |
| module status mapper | Active/Disabled/Coming soon/Maintenance |

### 35.2 Component test

1. `SettingGroupCard` render readonly/update mode.
2. `SensitiveSettingInput` không giữ giá trị cũ.
3. `ModuleCatalogPage` hide action khi thiếu quyền.
4. `FileListPage` render forbidden download đúng.
5. `AuditLogListPage` filter + pagination.
6. `AuditDiffViewer` render masked field.
7. `HolidayFormDrawer` validation.

### 35.3 E2E test

| Flow | Kịch bản |
| --- | --- |
| System route guard | User thiếu quyền vào `/system/settings` -> 403 |
| Company settings update | Admin cập nhật setting public -> success + audit log |
| Sensitive setting | Admin update secret -> không thấy raw value sau save |
| Module disable | Super Admin disable module phase sau -> Home/App Switcher cập nhật |
| File download forbidden | User thiếu quyền download -> 403/toast |
| Audit log filter | Filter module/action/date -> table cập nhật |
| Public holiday create | Tạo holiday -> list cập nhật + toast |
| Sequence preview | Click preview -> hiển thị code preview, không submit nghiệp vụ |

---

## 36. Mock API strategy

Trong khi backend API-09 chưa hoàn thiện, frontend có thể dùng MSW theo contract tạm:

```ts
export const foundationHandlers = [
  http.get('/api/v1/foundation/company/current', () => HttpResponse.json(success(companyFixture))),
  http.get('/api/v1/foundation/settings', () => HttpResponse.json(success(companySettingsFixture))),
  http.get('/api/v1/foundation/modules', () => HttpResponse.json(success(moduleCatalogFixture))),
  http.get('/api/v1/foundation/files', ({ request }) => {
    return HttpResponse.json(paginated(filesFixture, request));
  }),
  http.get('/api/v1/foundation/audit-logs', ({ request }) => {
    return HttpResponse.json(paginated(auditLogsFixture, request));
  }),
];
```

Mock data cần có đủ:

1. Active/disabled/coming soon module.
2. Sensitive/non-sensitive setting.
3. File private/internal/public.
4. Audit success/failed/denied.
5. Company/System scope user.
6. Forbidden response cho thiếu quyền.

---

## 37. Security checklist frontend

- [ ] Không lưu token trong localStorage nếu có thể tránh.
- [ ] Clear query cache nhạy cảm khi logout.
- [ ] Không log setting value, secret, token, signed URL vào console.
- [ ] Không hiển thị storage path raw của file private.
- [ ] Không persist signed download URL.
- [ ] Không render audit diff bằng raw HTML.
- [ ] Không hard-code role.
- [ ] Không tự gửi company_id từ form nếu backend resolve từ auth context.
- [ ] Không cho action nguy hiểm thiếu ConfirmDialog.
- [ ] Không cho export audit/file nếu thiếu quyền.
- [ ] Mask field nhạy cảm theo API metadata.
- [ ] Handle 401/403 đúng chuẩn, không retry vô hạn.
- [ ] Validate MIME/size ở frontend chỉ là UX; backend vẫn validate.

---

## 38. Performance checklist

- [ ] Audit log list dùng server pagination.
- [ ] File list dùng server pagination.
- [ ] Filter debounce 300-500ms.
- [ ] Default date range cho audit logs.
- [ ] Không prefetch toàn bộ audit/file data.
- [ ] Virtualize table nếu số dòng lớn trên client.
- [ ] Query key có params ổn định.
- [ ] Không invalidate toàn bộ app nếu mutation chỉ ảnh hưởng một setting nhỏ.
- [ ] Health check polling có interval hợp lý, pause khi tab hidden nếu có thể.
- [ ] JSON setting editor lazy load nếu nặng.

---

## 39. Implementation checklist

### 39.1 Setup module

- [ ] Tạo `src/modules/system`.
- [ ] Tạo `foundation.types.ts`.
- [ ] Tạo `foundation.api.ts`.
- [ ] Tạo `foundation.keys.ts`.
- [ ] Tạo hooks cho company/settings/modules/files/audit/holidays/sequences.
- [ ] Tạo route files trong `src/app/(protected)/system`.
- [ ] Đăng ký route metadata vào route registry.
- [ ] Đăng ký sidebar items vào sidebar registry.
- [ ] Đăng ký app/module trong app registry nếu cần.

### 39.2 Pages

- [ ] System Overview Page.
- [ ] Company Profile Page.
- [ ] Company Settings Page.
- [ ] System Settings Page.
- [ ] Module Catalog Page.
- [ ] Module Detail Page.
- [ ] File Metadata List Page.
- [ ] File Detail Page.
- [ ] File Access Logs Page nếu API hỗ trợ.
- [ ] Audit Logs Page.
- [ ] Audit Log Detail Page.
- [ ] Public Holidays Page.
- [ ] Sequence Counters Page.
- [ ] Retention Policies Page nếu API hỗ trợ.
- [ ] Seed Status Page nếu API hỗ trợ.
- [ ] Health Check Page nếu API hỗ trợ.

### 39.3 Components

- [ ] SettingGroupCard.
- [ ] SettingValueField.
- [ ] SensitiveSettingInput.
- [ ] ModuleStatusBadge.
- [ ] FileVisibilityBadge.
- [ ] FileLinkList.
- [ ] AuditDiffViewer.
- [ ] HolidayFormDrawer.
- [ ] SequencePreviewBox.
- [ ] RetentionPolicyCard.

### 39.4 Integration

- [ ] PermissionGate cho route/menu/action.
- [ ] ConfirmDialog cho action nguy hiểm.
- [ ] Toast success/error.
- [ ] Form validation + API validation mapping.
- [ ] Query invalidation matrix.
- [ ] Mock API handlers.
- [ ] Unit/component/E2E tests.

---

## 40. Definition of Done cho FRONTEND-13

FRONTEND-13 được xem là hoàn thành khi:

1. Có route và sidebar System/Foundation theo permission/data scope.
2. Có Foundation API service dùng chung, không gọi `fetch` rời rạc.
3. Có query key factory và hook convention cho toàn bộ foundation data.
4. Có trang Company Profile và Company Settings hoạt động với loading/empty/error/forbidden/success state.
5. Có trang System Settings có mask sensitive value và confirm khi update setting quan trọng.
6. Có Module Catalog hiển thị status, dependency, MVP/core/phase sau và update/invalidate app registry đúng.
7. Có File Metadata list/detail, không expose storage path raw, download qua API kiểm quyền.
8. Có Audit Log list/detail với filter, pagination, diff viewer và masked field.
9. Có Public Holidays page tối thiểu để xem/tạo/sửa/xóa mềm nếu API cho phép.
10. Có Sequence Counter page tối thiểu để xem/preview, không tự sinh mã ở frontend.
11. Các action nguy hiểm đều có ConfirmDialog.
12. Không có hard-code role trong route/action/field.
13. Có test cho setting parser, audit diff, permission guard và các component quan trọng.
14. Có security checklist được review.
15. Có mock API để frontend không bị chờ backend API-09 hoàn thiện.
16. Có open questions rõ để BE/FE/Product chốt trước khi release MVP.

---

## 41. Rủi ro và cách giảm thiểu

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Expose secret setting | Lộ dữ liệu nhạy cảm | API mask + frontend MaskedField, không log raw value |
| Expose storage path file private | Lộ hạ tầng/file | Chỉ dùng download API/signed URL ngắn hạn |
| Audit log query chậm | Admin UI chậm | Date range mặc định, pagination, filter server-side |
| Tắt module core nhầm | Hệ thống lỗi | Backend validate, frontend confirm, disable action cho core module |
| Update holiday ảnh hưởng ATT/LEAVE | Sai bảng công/số phép | Cảnh báo rõ, backend handle recalculation |
| Frontend tự sinh mã sequence | Race condition/sai mã | Preview only, mã chính thức do backend sinh |
| Hard-code role Admin/Super Admin | Sai quyền custom role | Dùng permission + data scope |
| Cache app registry cũ sau đổi module | Menu/app sai | Invalidate auth/me, app registry, sidebar, dashboard |
| Render audit diff không sanitize | XSS | Render plain text, không dùng raw HTML |
| Health page lộ infra detail | Lộ thông tin hệ thống | Chỉ hiển thị status high-level theo quyền |

---

## 42. Open questions cần chốt

| Mã | Câu hỏi | Owner | Mức độ |
| --- | --- | --- | --- |
| FE13-OQ-001 | API-09 endpoint chính xác cho company/system settings là gì? | BE Lead | Cao |
| FE13-OQ-002 | Foundation permission seed dùng tên như đề xuất hay backend đã có tên khác? | BE/FE Lead | Cao |
| FE13-OQ-003 | System Settings có cho update trong MVP không hay chỉ read-only? | Product/BE | Cao |
| FE13-OQ-004 | Module Catalog có cho bật/tắt module trong MVP không hay chỉ xem trạng thái? | Product/BE | Cao |
| FE13-OQ-005 | File download dùng signed URL hay stream/blob qua API? | BE/FE | Cao |
| FE13-OQ-006 | Audit log có trả before/after diff đã mask hay frontend phải tự diff từ before/after? | BE/FE | Trung bình |
| FE13-OQ-007 | File access log có nằm trong MVP không? | Product/BE | Trung bình |
| FE13-OQ-008 | Public holiday thay đổi có cần trigger recalculate ATT/LEAVE không? | Product/BE | Cao |
| FE13-OQ-009 | Sequence counter có cho update/reset thủ công trong UI không? | Product/BE | Trung bình |
| FE13-OQ-010 | Seed status/health check có expose cho frontend admin không? | Product/DevOps | Thấp |
| FE13-OQ-011 | Retention policy UI có nằm trong MVP không? | Product/BE | Thấp |
| FE13-OQ-012 | Có cần export audit/file metadata trong MVP không? | Product/QA | Trung bình |

---

## 43. Thứ tự triển khai đề xuất

### Sprint FE13.1 - Foundation shell & read-only core

1. Route `/system` và sidebar System.
2. Foundation API service + query keys.
3. System Overview read-only.
4. Company Profile read-only.
5. Module Catalog read-only.
6. Permission guard + forbidden state.

### Sprint FE13.2 - Settings

1. Company Settings page.
2. System Settings page read-only/update nếu được chốt.
3. SettingGroupCard.
4. SettingValueField.
5. SensitiveSettingInput.
6. Confirm update + validation mapping.

### Sprint FE13.3 - Audit & Files

1. File Metadata list/detail.
2. Download URL flow.
3. File access log nếu có.
4. Audit Logs list.
5. Audit Log detail.
6. AuditDiffViewer.

### Sprint FE13.4 - Calendar/Sequence/Operations

1. Public Holidays list/form.
2. Sequence Counter list/preview.
3. Retention/Seed/Health read-only nếu API hỗ trợ.
4. Cache invalidation hoàn chỉnh.
5. Component/unit/E2E tests.

---

## 44. Kết luận

FRONTEND-13 hoàn thiện lớp System/Foundation frontend cho MVP.

Tư duy triển khai chính:

```text
System/Foundation là hạ tầng quản trị dùng chung
-> Route/menu/action theo permission + data scope
-> Settings phải mask sensitive
-> File private không expose storage path
-> Audit log phải filter/paginate/mask
-> Module catalog ảnh hưởng toàn app nên phải invalidate cache đúng
-> Holiday/sequence/retention ảnh hưởng nhiều module nên cần confirm rõ
-> Frontend chỉ hỗ trợ UX, backend vẫn là guard cuối cùng
```

Sau FRONTEND-13, bước tiếp theo nên triển khai:

```text
FRONTEND-14: QA, Performance & Release Readiness
```

FRONTEND-14 cần tập trung kiểm thử xuyên suốt toàn bộ MVP: route guard, permission/data scope, API error state, responsive, accessibility, performance, build environment, release checklist và regression test các flow chính.
